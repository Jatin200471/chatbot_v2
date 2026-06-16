class AddBubbleIconSizeToChannelWebWidgets < ActiveRecord::Migration[7.0]
  def change
    return if column_exists?(:channel_web_widgets, :custom_bubble_icon_size)
    add_column :channel_web_widgets, :custom_bubble_icon_size, :integer, default: 60
  end
end
