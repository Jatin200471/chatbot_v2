class AddHeaderColorsToChannelWebWidgets < ActiveRecord::Migration[7.0]
  def change
    add_column :channel_web_widgets, :header_bg_color, :string unless column_exists?(:channel_web_widgets, :header_bg_color)
    add_column :channel_web_widgets, :header_text_color, :string unless column_exists?(:channel_web_widgets, :header_text_color)
  end
end
