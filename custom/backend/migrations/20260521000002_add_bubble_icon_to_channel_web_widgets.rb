class AddBubbleIconToChannelWebWidgets < ActiveRecord::Migration[7.0]
  def up
    unless column_exists?(:channel_web_widgets, :custom_bubble_icon_url)
      add_column :channel_web_widgets, :custom_bubble_icon_url, :string, default: nil
    end
  end

  def down
    remove_column :channel_web_widgets, :custom_bubble_icon_url if column_exists?(:channel_web_widgets, :custom_bubble_icon_url)
  end
end
