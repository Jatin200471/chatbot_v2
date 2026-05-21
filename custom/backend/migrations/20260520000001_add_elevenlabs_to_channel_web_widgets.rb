class AddElevenlabsToChannelWebWidgets < ActiveRecord::Migration[7.0]
  def change
    add_column :channel_web_widgets, :elevenlabs_agent_id, :string, default: nil
  end
end
