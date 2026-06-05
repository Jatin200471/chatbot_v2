# Web widget conversations are created via the campaign/events flow in original
# Chatwoot code which may leave them in :pending status when an agent-bot is
# active on the inbox. Pending conversations don't show under the "Open" tab in
# the agent dashboard, causing agents to miss campaign-started chats.
#
# This initializer patches Conversation with an after_create callback that
# immediately promotes any pending web-widget conversation to :open so it
# appears in the dashboard.
Rails.application.config.after_initialize do
  Conversation.class_eval do
    after_create :force_open_for_web_widget_inbox, if: :pending?

    private

    def force_open_for_web_widget_inbox
      return unless inbox.channel_type == 'Channel::WebWidget'

      update_columns(status: Conversation.statuses[:open])
    rescue StandardError => e
      Rails.logger.error "[FORCE-OPEN] Failed to promote conversation #{id}: #{e.message}"
    end
  end
end
