module WebsiteTokenHelper
  def auth_token_params
    @auth_token_params ||= ::Widget::TokenService.new(token: request.headers['X-Auth-Token']).decode_token
  end

  def set_web_widget
    @web_widget = ::Channel::WebWidget.find_by!(website_token: permitted_params[:website_token])
    @current_account = @web_widget.inbox.account
    render json: { error: 'Account is suspended' }, status: :unauthorized unless @current_account.active?
  end

  def set_contact
    @contact_inbox = @web_widget.inbox.contact_inboxes.find_by(
      source_id: auth_token_params[:source_id]
    )
    @contact = @contact_inbox&.contact

    if @contact.nil?
      @contact = create_new_contact
      @contact_inbox = create_contact_inbox(@contact)
    end

    # Always set @inbox from web_widget so base_controller inbox method works
    @inbox = @web_widget.inbox

    Current.contact = @contact
  end

  def permitted_params
    params.permit(:website_token)
  end

  def conversation
    @conversation ||= @contact_inbox&.conversations
      &.where(inbox_id: @web_widget.inbox.id)
      &.last
  end

  private

  def create_new_contact
    @current_account.contacts.create!(
      name: params.dig(:contact, :name).presence || 'Visitor',
      email: params.dig(:contact, :email).presence,
      phone_number: params.dig(:contact, :phone_number).presence
    )
  end

  def create_contact_inbox(contact)
    ContactInbox.create!(
      contact: contact,
      inbox: @web_widget.inbox,
      source_id: SecureRandom.uuid,
      hmac_verified: false
    )
  end
end