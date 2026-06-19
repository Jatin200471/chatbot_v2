json.id resource.id
json.avatar_url resource.try(:avatar_url)
json.channel_id resource.channel_id
json.name resource.name
json.channel_type resource.channel_type
json.greeting_enabled resource.greeting_enabled
json.greeting_message resource.greeting_message
json.working_hours_enabled resource.working_hours_enabled
json.enable_email_collect resource.enable_email_collect
json.csat_survey_enabled resource.csat_survey_enabled
json.csat_config resource.csat_config
json.enable_auto_assignment resource.enable_auto_assignment
json.auto_assignment_config resource.auto_assignment_config
json.out_of_office_message resource.out_of_office_message
json.working_hours resource.weekly_schedule
json.timezone resource.timezone
json.callback_webhook_url resource.callback_webhook_url
json.allow_messages_after_resolved resource.allow_messages_after_resolved
json.lock_to_single_conversation resource.lock_to_single_conversation
json.sender_name_type resource.sender_name_type
json.business_name resource.business_name

if resource.portal.present?
  json.help_center do
    json.name resource.portal.name
    json.slug resource.portal.slug
  end
end

## Channel specific settings
## TODO : Clean up and move the attributes into channel sub section

json.tweets_enabled resource.channel.try(:tweets_enabled) if resource.twitter?

## WebWidget Attributes
json.allowed_domains resource.channel.try(:allowed_domains)
json.widget_color resource.channel.try(:widget_color)
json.website_url resource.channel.try(:website_url)
json.hmac_mandatory resource.channel.try(:hmac_mandatory)
json.welcome_title resource.channel.try(:welcome_title)
json.welcome_tagline resource.channel.try(:welcome_tagline)
json.web_widget_script resource.channel.try(:web_widget_script)
json.website_token resource.channel.try(:website_token)
json.selected_feature_flags resource.channel.try(:selected_feature_flags)
json.elevenlabs_agent_id resource.channel.try(:elevenlabs_agent_id)
json.voice_agent_provider resource.channel.try(:voice_agent_provider)
json.voice_agent_api_key resource.channel.try(:voice_agent_api_key) if Current.account_user&.administrator?

# Ensure voice_agent_config_data is properly serialized as JSON
voice_config = resource.channel.try(:voice_agent_config_data) || {}
if voice_config.is_a?(String)
  begin
    voice_config = JSON.parse(voice_config)
  rescue
    voice_config = {}
  end
end
json.voice_agent_config_data voice_config
json.custom_branding_text resource.channel.try(:custom_branding_text)
json.custom_branding_url resource.channel.try(:custom_branding_url)
json.custom_bubble_icon_url resource.channel.try(:custom_bubble_icon_url)
json.custom_bubble_icon_size resource.channel.try(:custom_bubble_icon_size) || 60
json.reply_time resource.channel.try(:reply_time)
json.available_message resource.channel.try(:available_message)
json.unavailable_message resource.channel.try(:unavailable_message)
json.reply_time_text resource.channel.try(:reply_time_text)
if resource.web_widget?
  json.hmac_token resource.channel.try(:hmac_token) if Current.account_user&.administrator?
  json.pre_chat_form_enabled resource.channel.try(:pre_chat_form_enabled)
  json.pre_chat_form_options resource.channel.try(:pre_chat_form_options)
  json.continuity_via_email resource.channel.try(:continuity_via_email)
end

## Facebook Attributes
if resource.facebook?
  json.page_id resource.channel.try(:page_id)
  json.reauthorization_required resource.channel.try(:reauthorization_required?)
end

## Instagram Attributes
json.reauthorization_required resource.channel.try(:reauthorization_required?) if resource.instagram?
json.instagram_id resource.channel.try(:instagram_id) if resource.instagram?

## Tiktok Attributes
json.reauthorization_required resource.channel.try(:reauthorization_required?) if resource.tiktok?

## Twilio Attributes
json.messaging_service_sid resource.channel.try(:messaging_service_sid)
json.phone_number resource.channel.try(:phone_number)
json.medium resource.channel.try(:medium) if resource.twilio?
if resource.twilio?
  json.content_templates resource.channel.try(:content_templates)
  if Current.account_user&.administrator?
    json.auth_token resource.channel.try(:auth_token)
    json.account_sid resource.channel.try(:account_sid)
  end
end

if resource.email?
  ## Email Channel Attributes
  json.email resource.channel.try(:email)
  json.forwarding_enabled ENV.fetch('MAILER_INBOUND_EMAIL_DOMAIN', '').present?
  json.forward_to_email resource.channel.try(:forward_to_email) if ENV.fetch('MAILER_INBOUND_EMAIL_DOMAIN', '').present?

  ## IMAP
  if Current.account_user&.administrator?
    json.imap_login resource.channel.try(:imap_login)
    json.imap_password resource.channel.try(:imap_password)
    json.imap_address resource.channel.try(:imap_address)
    json.imap_port resource.channel.try(:imap_port)
    json.imap_enabled resource.channel.try(:imap_enabled)
    json.imap_enable_ssl resource.channel.try(:imap_enable_ssl)

    if resource.channel.try(:microsoft?) || resource.channel.try(:google?) || resource.channel.try(:legacy_google?)
      json.reauthorization_required resource.channel.try(:provider_config).empty? || resource.channel.try(:reauthorization_required?)
    end
  end

  ## SMTP
  if Current.account_user&.administrator?
    json.smtp_login resource.channel.try(:smtp_login)
    json.smtp_password resource.channel.try(:smtp_password)
    json.smtp_address resource.channel.try(:smtp_address)
    json.smtp_port resource.channel.try(:smtp_port)
    json.smtp_enabled resource.channel.try(:smtp_enabled)
    json.smtp_domain resource.channel.try(:smtp_domain)
    json.smtp_enable_ssl_tls resource.channel.try(:smtp_enable_ssl_tls)
    json.smtp_enable_starttls_auto resource.channel.try(:smtp_enable_starttls_auto)
    json.smtp_openssl_verify_mode resource.channel.try(:smtp_openssl_verify_mode)
    json.smtp_authentication resource.channel.try(:smtp_authentication)
  end
end

## API Channel Attributes
if resource.api?
  json.hmac_token resource.channel.try(:hmac_token) if Current.account_user&.administrator?
  json.webhook_url resource.channel.try(:webhook_url)
  json.inbox_identifier resource.channel.try(:identifier)
  json.additional_attributes resource.channel.try(:additional_attributes)
end

json.provider resource.channel.try(:provider)

## Telegram Attributes
json.bot_name resource.channel.try(:bot_name) if resource.telegram?

### WhatsApp Channel
if resource.whatsapp?
  json.message_templates resource.channel.try(:message_templates)
  json.provider_config resource.channel.try(:provider_config) if Current.account_user&.administrator?
  json.reauthorization_required resource.channel.try(:reauthorization_required?)
end

## Voice Channel Attributes
if resource.channel_type == 'Channel::Voice'
  json.voice_call_webhook_url resource.channel.try(:voice_call_webhook_url)
  json.voice_status_webhook_url resource.channel.try(:voice_status_webhook_url)
end
json.widget_bg_color resource.channel.try(:widget_bg_color)
json.widget_bg_image_url resource.channel.try(:widget_bg_image_url)
json.widget_font_family resource.channel.try(:widget_font_family)
json.welcome_heading_color resource.channel.try(:welcome_heading_color)
json.welcome_heading_size resource.channel.try(:welcome_heading_size)
json.welcome_tagline_color resource.channel.try(:welcome_tagline_color)
json.welcome_tagline_size resource.channel.try(:welcome_tagline_size)
json.cta_bg_color resource.channel.try(:cta_bg_color)
json.cta_text_color resource.channel.try(:cta_text_color)
json.bot_bubble_bg_color resource.channel.try(:bot_bubble_bg_color)
json.bot_bubble_text_color resource.channel.try(:bot_bubble_text_color)
json.user_bubble_bg_color resource.channel.try(:user_bubble_bg_color)
json.user_bubble_text_color resource.channel.try(:user_bubble_text_color)
json.input_focus_color resource.channel.try(:input_focus_color)
json.message_font_size resource.channel.try(:message_font_size)
