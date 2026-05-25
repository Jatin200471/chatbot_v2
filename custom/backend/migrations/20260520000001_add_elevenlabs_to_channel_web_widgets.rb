class AddElevenlabsToChannelWebWidgets < ActiveRecord::Migration[7.0]
  def change
    # add_column_if_not_exists prevents crash when re-pulling image on an
    # existing database that already has this column from a previous run.
    add_column :channel_web_widgets, :elevenlabs_agent_id, :string, default: nil unless
      column_exists?(:channel_web_widgets, :elevenlabs_agent_id)
  end
end
