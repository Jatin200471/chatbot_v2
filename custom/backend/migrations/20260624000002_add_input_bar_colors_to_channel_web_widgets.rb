class AddInputBarColorsToChannelWebWidgets < ActiveRecord::Migration[7.0]
  def change
    add_column :channel_web_widgets, :input_bar_bg_color, :string unless column_exists?(:channel_web_widgets, :input_bar_bg_color)
    add_column :channel_web_widgets, :input_bar_text_color, :string unless column_exists?(:channel_web_widgets, :input_bar_text_color)
  end
end
