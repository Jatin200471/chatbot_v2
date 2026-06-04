class AddElevenlabsToChannelWebWidgets < ActiveRecord::Migration[7.0]
  def up
    # column_exists? guard prevents crash when re-pulling image on an existing
    # database that already has this column from a previous run.
    # Existing rows automatically get NULL (no data loss).
    unless column_exists?(:channel_web_widgets, :elevenlabs_agent_id)
      add_column :channel_web_widgets, :elevenlabs_agent_id, :string, default: nil
    end
  end

  def down
    remove_column :channel_web_widgets, :elevenlabs_agent_id if column_exists?(:channel_web_widgets, :elevenlabs_agent_id)
  end
end
