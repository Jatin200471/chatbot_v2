require 'net/http'

class Api::V1::Widget::ConversationsController < Api::V1::Widget::BaseController
  include Events::Types
  before_action :render_not_found_if_empty, only: [:toggle_typing, :toggle_status, :set_custom_attributes, :destroy_custom_attributes]
  skip_before_action :set_contact, only: [:inbox_config, :voice_signed_url]

  def index
    @conversation = conversation
  end

  def create
    Rails.logger.info "[CREATE-CONVERSATION] Starting with params: #{permitted_params.inspect}"
    
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
    end
  rescue StandardError => e
    Rails.logger.error "[CREATE-CONVERSATION] Error: #{e.class} #{e.message}\n#{e.backtrace.first(5).join("\n")}"
    raise
  end

  def process_update_contact
    Rails.logger.info "[CONTACT-UPDATE] contact_email=#{contact_email.inspect}, contact_name=#{contact_name.inspect}, contact_phone=#{contact_phone_number.inspect}"

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
        Rails.logger.info "[CONTACT-UPDATE] Email #{contact_email} already belongs to contact #{already_exists.id}; using directly"
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

    Rails.logger.info "[CONTACT-UPDATE] Success: @contact.id=#{@contact.id}, @contact.email=#{@contact.email}"

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
          voice_agent_api_key: @web_widget.voice_agent_api_key || '',
          voice_agent_config_data: @web_widget.voice_agent_config_data || {},
          elevenlabs_agent_id: @web_widget.elevenlabs_agent_id || ''
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

    if agent_id.blank?
      return render json: { error: 'No agent_id configured on this inbox' }, status: :unprocessable_entity
    end
    if api_key.blank?
      return render json: { error: 'No API key configured on this inbox' }, status: :unprocessable_entity
    end

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
      render json: { error: "ElevenLabs API responded #{res.code}" }, status: :bad_gateway
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

    msg = conv.messages.create!(
      account_id: conv.account_id,
      inbox_id:   conv.inbox_id,
      message_type: msg_type,
      content:    content,
      sender:     source == 'user' ? @contact : nil,
      content_attributes: { voice_transcript: true, role: source }
    )

    render json: { id: msg.id, conversation_id: conv.id }
  rescue StandardError => e
    Rails.logger.error "[VOICE-AGENT] voice_transcript failed: #{e.class} #{e.message}"
    render json: { error: e.message }, status: :internal_server_error
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