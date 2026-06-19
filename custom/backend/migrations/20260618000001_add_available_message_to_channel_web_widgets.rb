class AddAvailableMessageToChannelWebWidgets < ActiveRecord::Migration[7.0]
  def change
    add_column :channel_web_widgets, :available_message, :string unless column_exists?(:channel_web_widgets, :available_message)
    add_column :channel_web_widgets, :unavailable_message, :string unless column_exists?(:channel_web_widgets, :unavailable_message)
  end
end
