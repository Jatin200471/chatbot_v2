class AddReplyTimeTextToChannelWebWidgets < ActiveRecord::Migration[7.0]
  def change
    add_column :channel_web_widgets, :reply_time_text, :string unless column_exists?(:channel_web_widgets, :reply_time_text)
  end
end
