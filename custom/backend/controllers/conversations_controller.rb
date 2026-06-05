require 'net/http'

class Api::V1::Widget::ConversationsController < Api::V1::Widget::BaseController
  include Events::Types
  before_action :render_not_found_if_empty, only: [:toggle_typing, :toggle_status, :set_custom_attributes, :destroy_custom_attributes]
  skip_before_action :set_contact, only: [:inbox_config, :voice_signed_url]

  def index
    @conversation = conversation
  end

  def create
    Rails.logger.info "[CREATE-CONVERSATION] Starting with params: #{permitted_params.except(:email).inspect}"
    
    ActiveRecord::Base.transaction do
      Rails.logger.info "[CREATE-CONVERSATION] Step 1: Calling process_update_contact"
      process_update_contact
      
      Rails.logger.info "[CREATE-CONVERSATION] Step 2: Creating conversation for contact_id=#{@contact.id}, contact_inbox_id=#{@contact_inbox.id}"
      @conversation = create_conversation
      
      Rails.logger.info "[CREATE-CONVERSATION] Step 3: Creating message with content length=#{message_params[:content].to_s.length}"
      @conversation.messages.create!(message_params)
      
      Rails.logger.info "[CREATE-CONVERSATION] Step 4: Reloading conversation"
      @conversation.reload
      
      Rails.logger.info "[CREATE-CONVERSATION] Success: conversation.id=#{@conversation.id}"
      @widget_auth_token = ::Widget::TokenService.new(
        payload: { source_id: @contact_inbox.source_id, inbox_id: @web_widget.inbox.id }
      ).generate_token
    end
  rescue StandardError => e
    Rails.logger.error "[CREATE-CONVERSATION] Error: #{e.class} #{e.message}\n#{e.backtrace.first(5).join("\n")}"
    raise
  end

  def process_update_contact
    Rails.logger.info "[CONTACT-UPDATE] contact_email=#{contact_email.present? ? '[PRESENT]' : 'nil'}, contact_name=#{contact_name.present? ? '[PRESENT]' : 'nil'}, contact_phone=#{contact_phone_number.present? ? '[PRESENT]' : 'nil'}"

    original_contact_id = @contact.id

    # ── Fast-path: email already belongs to a known contact ───────────────────
    # ContactIdentifyAction can raise "Email has already been taken" when the
    # visitor contact (no email yet) is being merged into an existing contact
    # and the merge path tries to write the email onto the wrong record.
    # Pre-lookup avoids the merge entirely in the common case where the visitor
    # re-submits the form with the same email from a previous session.
    if contact_email.present?
      already_exists = @web_widget.inbox.account.contacts.find_by(email: contact_email)
      if already_exists && already_exists.id != @contact.id
        Rails.logger.info "[CONTACT-UPDATE] Email [REDACTED] already belongs to contact #{already_exists.id}; using directly"
        @contact = already_exists
        resync_contact_inbox(original_contact_id)
        return
      end
    end

    @contact = ContactIdentifyAction.new(
      contact: @contact,
      params: { email: contact_email, phone_number: contact_phone_number, name: contact_name },
      retain_original_contact_name: true,
      discard_invalid_attrs: true
    ).perform

    Rails.logger.info "[CONTACT-UPDATE] Success: @contact.id=#{@contact.id}, email=[REDACTED]"

    # ── Re-sync @contact_inbox ─────────────────────────────────────────────
    # ContactIdentifyAction may return a DIFFERENT contact (e.g. it found an
    # existing contact by email and merged the visitor into it). When that
    # happens @contact_inbox still belongs to the OLD visitor contact, so
    # Conversation.create! would receive a mismatched contact_inbox_id whose
    # contact's account/inbox differs → "Account can't be blank" 422.
    #
    # Strategy:
    #   1. Try to find an existing contact_inbox for the new @contact on this inbox.
    #   2. If none exists, move the original contact_inbox to the new contact.
    #   3. This guarantees @contact_inbox.contact_id == @contact.id always.
    resync_contact_inbox(original_contact_id)
  rescue StandardError => e
    Rails.logger.error "[CONTACT-UPDATE] Failed: #{e.class} #{e.message}"
    raise
  end

  def update_last_seen
    head :ok && return if conversation.nil?
    conversation.contact_last_seen_at = DateTime.now.utc
    conversation.save!
    ::Conversations::UpdateMessageStatusJob.perform_later(conversation.id, conversation.contact_last_seen_at)
    head :ok
  end

  def transcript
    return head :too_many_requests if conversation.blank?
    return head :payment_required unless conversation.account.email_transcript_enabled?
    return head :too_many_requests unless conversation.account.within_email_rate_limit?
    send_transcript_email
    head :ok
  end

  def toggle_typing
    case permitted_params[:typing_status]
    when 'on'
      trigger_typing_event(CONVERSATION_TYPING_ON)
    when 'off'
      trigger_typing_event(CONVERSATION_TYPING_OFF)
    end
    head :ok
  end

  def toggle_status
    return head :forbidden unless @web_widget.end_conversation?
    unless conversation.resolved?
      conversation.status = :resolved
      conversation.save!
    end
    head :ok
  end

  def inbox_config
    # Return inbox configuration including voice agent settings
    # Called by widget to fetch voice provider, API key, and config data
    @inbox = @web_widget.inbox
    render json: {
      payload: {
        inbox: {
          id: @inbox.id,
          name: @inbox.name,
          selected_feature_flags: @web_widget.selected_feature_flags || [],
          voice_agent_provider: @web_widget.voice_agent_provider || 'elevenlabs',
          voice_agent_config_data: @web_widget.voice_agent_config_data || {}
          # elevenlabs_agent_id intentionally NOT sent — kept server-side only.
          # Widget uses /voice_signed_url endpoint to get a short-lived signed
          # WebSocket URL so the agent_id is never exposed to the browser.
        }
      }
    }
  end

  # Exchange the inbox's stored ElevenLabs API key for a short-lived signed
  # WebSocket URL. The key NEVER leaves the server. The widget receives only
  # the signed URL and passes it to Conversation.startSession({ signedUrl }).
  # Required for PRIVATE ElevenLabs agents; not needed for Public agents.
  def voice_signed_url
    @inbox = @web_widget.inbox
    api_key = @web_widget.voice_agent_api_key.to_s.strip
    agent_id = @web_widget.elevenlabs_agent_id.to_s.strip

    # Agent ID must always be configured
    if agent_id.blank?
      return render json: { error: 'No agent_id configured on this inbox' }, status: :unprocessable_entity
    end

    # TWO MODES — agent_id never goes to the browser in either case:
    #
    # 1. PRIVATE agent (API key configured):
    #    → Call ElevenLabs to get a short-lived signed WebSocket URL.
    #    → Browser connects to the signed URL (no agent_id visible).
    #
    # 2. PUBLIC agent (no API key):
    #    → Return the standard WebSocket URL directly from backend.
    #    → Agent_id still flows through backend only, not stored in frontend.
    if api_key.present?
      # Private agent — fetch signed URL from ElevenLabs
      uri = URI("https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=#{agent_id}")
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = true
      http.read_timeout = 10
      req = Net::HTTP::Get.new(uri)
      req['xi-api-key'] = api_key
      res = http.request(req)

      if res.is_a?(Net::HTTPSuccess)
        body = JSON.parse(res.body)
        render json: { signed_url: body['signed_url'] }
      else
        Rails.logger.error "[VOICE-AGENT] ElevenLabs signed-url request failed: #{res.code} #{res.body}"
        render json: { error: "ElevenLabs API error: #{res.code} — check Agent ID and API Key in inbox settings" }, status: :unprocessable_entity
      end
    else
      # Public agent — return direct WebSocket URL (agent_id comes from backend, not frontend)
      render json: { signed_url: "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=#{agent_id}" }
    end
  rescue StandardError => e
    Rails.logger.error "[VOICE-AGENT] signed-url exception: #{e.class} #{e.message}"
    render json: { error: e.message }, status: :internal_server_error
  end

  # Append a single transcript chunk (one user turn OR one agent turn) from
  # the live ElevenLabs voice call into the visitor's Chatwoot conversation.
  #
  # Widget calls this on every `onMessage` callback of the ElevenLabs SDK.
  # If the visitor has no open conversation yet (voice-only flow before any
  # text was sent), a fresh one is auto-created so the transcript still has
  # a place to land. Each row carries `content_attributes.voice_transcript`
  # so the dashboard / reports can render it differently if desired.
  def voice_transcript
    source  = params[:source].to_s
    content = params[:content].to_s.strip

    return render json: { error: 'invalid source' }, status: :bad_request unless %w[user ai].include?(source)
    return render json: { error: 'empty content' }, status: :bad_request if content.blank?

    conv = conversation || build_conversation_for_voice
    msg_type = source == 'user' ? :incoming : :outgoing

    # Duplicate guard — skip if the last message of the same type has identical content
    last_msg = conv.messages.where(message_type: msg_type).last
    if last_msg&.content == content
      return render json: { id: last_msg.id, conversation_id: conv.id, duplicate: true }
    end

    # AI messages ka sender — assigned agent > inbox member > account admin
    ai_sender = voice_agent_sender(conv)

    # Preserve last_activity_at so voice transcript messages don't reset
    # the auto-resolve inactivity timer. Voice calls create many messages in a
    # short burst; without this the timer would reset on every turn.
    prev_activity_at = conv.last_activity_at

    msg = conv.messages.create!(
      account_id: conv.account_id,
      inbox_id:   conv.inbox_id,
      message_type: msg_type,
      content:    content,
      sender:     source == 'user' ? @contact : ai_sender,
      content_attributes: { voice_transcript: true, role: source }
    )

    # Restore activity timestamp after message create callbacks updated it
    conv.update_columns(last_activity_at: prev_activity_at) if prev_activity_at

    render json: { id: msg.id, conversation_id: conv.id }
  rescue StandardError => e
    Rails.logger.error "[VOICE-AGENT] voice_transcript failed: #{e.class} #{e.message}"
    render json: { error: e.message }, status: :internal_server_error
  end

  # Poll ElevenLabs API for the latest conversation transcript and sync
  # any new turns into the Chatwoot conversation as messages.
  #
  # Flow:
  #   1. Fetch the most recent conversation for this agent from ElevenLabs
  #   2. Compare against already-synced turn count (sent in params)
  #   3. Post only NEW turns as voice_transcript messages
  #   4. Return new turns so the widget can show them live
  #
  # GET /api/v1/widget/conversations/voice_transcript_poll?synced_count=N
  def voice_transcript_poll
    api_key  = @web_widget.voice_agent_api_key.to_s.strip
    agent_id = @web_widget.elevenlabs_agent_id.to_s.strip
    synced_count = params[:synced_count].to_i

    if api_key.blank? || agent_id.blank?
      return render json: { turns: [], conversation_id: nil }
    end

    # ── Step 1: Get latest conversation for this agent ──────────────────
    conv_id = fetch_latest_elevenlabs_conv_id(api_key, agent_id)
    return render json: { turns: [], conversation_id: nil } if conv_id.blank?

    # ── Step 2: Get full transcript of that conversation ─────────────────
    turns = fetch_elevenlabs_transcript(api_key, conv_id)
    return render json: { turns: [], conversation_id: conv_id } if turns.blank?

    # ── Step 3: Only process NEW turns since last poll ───────────────────
    # If conversation changed (new call started), reset synced count
    last_conv_id = params[:last_conv_id].to_s
    synced_count = 0 if last_conv_id != conv_id

    new_turns = turns[synced_count..]
    return render json: { turns: [], conversation_id: conv_id, total_count: turns.length } if new_turns.blank?

    # ── Step 4: Save new turns to Chatwoot conversation ──────────────────
    chatwoot_conv = conversation || build_conversation_for_voice
    ai_sender     = voice_agent_sender(chatwoot_conv)

    # Preserve activity timestamp — same reason as voice_transcript action:
    # bulk transcript sync should not reset the auto-resolve inactivity timer.
    prev_activity_at = chatwoot_conv.last_activity_at

    new_turns.each do |turn|
      role    = turn['role'].to_s   # 'user' or 'agent'
      content = turn['message'].to_s.strip
      next if content.blank?

      source   = role == 'user' ? 'user' : 'ai'
      msg_type = role == 'user' ? :incoming : :outgoing

      chatwoot_conv.messages.create!(
        account_id:  chatwoot_conv.account_id,
        inbox_id:    chatwoot_conv.inbox_id,
        message_type: msg_type,
        content:     content,
        sender:      role == 'user' ? @contact : ai_sender,
        content_attributes: { voice_transcript: true, role: source }
      )
    end

    chatwoot_conv.update_columns(last_activity_at: prev_activity_at) if prev_activity_at

    render json: {
      turns: new_turns,
      conversation_id: conv_id,
      total_count: turns.length
    }
  rescue StandardError => e
    Rails.logger.error "[VOICE-TRANSCRIPT-POLL] #{e.class} #{e.message}"
    render json: { turns: [], error: e.message }
  end

  def set_custom_attributes
    conversation.update!(custom_attributes: permitted_params[:custom_attributes])
  end

  def destroy_custom_attributes
    conversation.custom_attributes = conversation.custom_attributes.excluding(params[:custom_attribute])
    conversation.save!
    render json: conversation
  end

  private

  # Used by voice_transcript when the visitor starts a voice call before
  # sending any text message. Creates a new conversation tied to the existing
  # contact / inbox / contact_inbox so the SDK's polling layer can pick it up
  # on next fetch.
  def resync_contact_inbox(original_contact_id)
    return if @contact.id == original_contact_id

    Rails.logger.info "[CONTACT-UPDATE] Contact changed #{original_contact_id} → #{@contact.id}; re-syncing contact_inbox"
    existing_ci = @web_widget.inbox.contact_inboxes.find_by(contact_id: @contact.id)
    if existing_ci
      @contact_inbox = existing_ci
      Rails.logger.info "[CONTACT-UPDATE] Found existing contact_inbox #{@contact_inbox.id} for new contact"
    else
      @contact_inbox.update!(contact_id: @contact.id)
      Rails.logger.info "[CONTACT-UPDATE] Moved contact_inbox #{@contact_inbox.id} to contact #{@contact.id}"
    end
  end

  # ── ElevenLabs API helpers ───────────────────────────────────────────────

  def fetch_latest_elevenlabs_conv_id(api_key, agent_id)
    uri = URI("https://api.elevenlabs.io/v1/convai/conversations?agent_id=#{agent_id}&page_size=1")
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    http.read_timeout = 8
    req = Net::HTTP::Get.new(uri)
    req['xi-api-key'] = api_key
    res = http.request(req)
    return nil unless res.is_a?(Net::HTTPSuccess)

    body = JSON.parse(res.body)
    conversations = body['conversations'] || []
    conversations.first&.dig('conversation_id')
  rescue StandardError => e
    Rails.logger.error "[VOICE-POLL] fetch_latest_conv_id failed: #{e.message}"
    nil
  end

  def fetch_elevenlabs_transcript(api_key, conv_id)
    uri = URI("https://api.elevenlabs.io/v1/convai/conversations/#{conv_id}")
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    http.read_timeout = 8
    req = Net::HTTP::Get.new(uri)
    req['xi-api-key'] = api_key
    res = http.request(req)
    return [] unless res.is_a?(Net::HTTPSuccess)

    body = JSON.parse(res.body)
    body['transcript'] || []
  rescue StandardError => e
    Rails.logger.error "[VOICE-POLL] fetch_transcript failed: #{e.message}"
    []
  end

  # ────────────────────────────────────────────────────────────────────────

  # AI voice transcript messages ka sender dhundta hai.
  # Priority order:
  #   1. Conversation ka assigned agent (agar koi assign hai)
  #   2. Inbox ka pehla member/agent (inbox_members order ke hisaab se)
  #   3. Account ka pehla administrator
  # Isse widget mein "Bot" ki jagah real agent ka naam dikhega.
  # Returns nil only if the account has no users at all (degenerate case).
  def voice_agent_sender(conv)
    # 1. Assigned agent
    return conv.assignee if conv.assignee.present?

    # 2. First inbox member (respects the inbox's agent list order)
    inbox_agent = conv.inbox.inbox_members.order(:id).first&.user
    return inbox_agent if inbox_agent.present?

    # 3. First administrator in the account
    admin = conv.account.account_users
                .where(role: :administrator)
                .order(:id)
                .first&.user
    Rails.logger.warn "[VOICE-AGENT] No assigned/inbox agent found for conv #{conv.id}; using admin #{admin&.id}" if admin
    admin
  rescue StandardError => e
    Rails.logger.error "[VOICE-AGENT] voice_agent_sender failed: #{e.message}"
    nil
  end

  def build_conversation_for_voice
    Conversation.create!(
      account_id: @web_widget.inbox.account_id,
      inbox_id:   @web_widget.inbox.id,
      contact_id: @contact.id,
      contact_inbox_id: @contact_inbox.id,
      additional_attributes: { initiated_from: 'voice_agent' }
    )
  end

  def send_transcript_email
    return if conversation.contact&.email.blank?
    ConversationReplyMailer.with(account: conversation.account).conversation_transcript(
      conversation,
      conversation.contact.email
    )&.deliver_later
    conversation.account.increment_email_sent_count
  end

  def trigger_typing_event(event)
    Rails.configuration.dispatcher.dispatch(event, Time.zone.now, conversation: conversation, user: @contact)
  end

  def render_not_found_if_empty
    return head :not_found if conversation.nil?
  end

  def permitted_params
    params.permit(:id, :typing_status, :website_token, :email, contact: [:name, :email, :phone_number],
                                                               message: [:content, :referer_url, :timestamp, :echo_id],
                                                               custom_attributes: {})
  end

  def contact_email
    permitted_params.dig(:contact, :email) || permitted_params[:email]
  end

  def contact_name
    permitted_params.dig(:contact, :name)
  end

  def contact_phone_number
    permitted_params.dig(:contact, :phone_number)
  end

  def message_params
    {
      content: permitted_params.dig(:message, :content),
      account_id: @web_widget.inbox.account_id,
      inbox_id: @web_widget.inbox.id,
      message_type: :incoming,
      sender: @contact
    }.compact
  end

  def create_conversation
    conv = Conversation.create!(
      account_id: @web_widget.inbox.account_id,
      inbox_id: @web_widget.inbox.id,
      contact_id: @contact.id,
      contact_inbox_id: @contact_inbox.id,
      additional_attributes: {}
    )
    # The before_create callback `determine_conversation_status` overrides the
    # status to :pending when inbox.active_bot? is true (n8n / agent-bot inboxes).
    # Widget conversations must be :open so visitors receive bot replies in the
    # same session. update_columns skips callbacks to avoid extra events.
    conv.update_columns(status: Conversation.statuses[:open]) if conv.pending?
    conv
  end
end