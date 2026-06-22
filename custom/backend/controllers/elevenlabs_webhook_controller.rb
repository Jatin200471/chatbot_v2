class Webhooks::ElevenlabsController < ActionController::API
  def tool_call
    conv_id    = params[:chatwoot_conversation_id].to_s.strip
    product_url = params[:product_url].to_s.strip
    product_name = params[:identifier_name].to_s.strip

    if conv_id.blank?
      return render json: { error: 'chatwoot_conversation_id is required' }, status: :bad_request
    end

    conversation = Conversation.find_by(id: conv_id)
    if conversation.nil?
      return render json: { error: "Conversation #{conv_id} not found" }, status: :not_found
    end

    if product_url.blank? && product_name.blank?
      return render json: { error: 'product_url or identifier_name is required' }, status: :bad_request
    end

    # Build the message to send to the customer
    message_content = if product_url.present? && product_name.present?
                        "Here is the link for #{product_name}: #{product_url}"
                      elsif product_url.present?
                        product_url
                      else
                        "Product requested: #{product_name}"
                      end

    # Find an agent sender (assigned agent > inbox member > admin)
    sender = conversation.assignee
    sender ||= conversation.inbox.inbox_members.order(:id).first&.user
    sender ||= conversation.account.account_users
                            .where(role: :administrator)
                            .order(:id).first&.user

    msg = conversation.messages.create!(
      account_id:   conversation.account_id,
      inbox_id:     conversation.inbox_id,
      message_type: :outgoing,
      content:      message_content,
      sender:       sender,
      content_attributes: { source: 'elevenlabs_tool_call' }
    )

    Rails.logger.info "[ELEVENLABS-WEBHOOK] Sent message #{msg.id} to conversation #{conv_id}: #{message_content}"

    render json: {
      success: true,
      message_id: msg.id,
      conversation_id: conversation.id,
      product_url: product_url,
      product_name: product_name,
      message_sent: message_content
    }
  rescue StandardError => e
    Rails.logger.error "[ELEVENLABS-WEBHOOK] tool_call failed: #{e.class} #{e.message}"
    render json: { error: e.message }, status: :internal_server_error
  end
end
