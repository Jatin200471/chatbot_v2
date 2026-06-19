class AddMessageFontSizeToChannelWebWidgets < ActiveRecord::Migration[7.0]
  def change
    add_column :channel_web_widgets, :message_font_size, :integer unless column_exists?(:channel_web_widgets, :message_font_size)
  end
end
