class AddVoiceAgentConfigToChannelWebWidgets < ActiveRecord::Migration[7.0]
  def change
    # add_column with column_exists? guard prevents crash when re-pulling image
    # on an existing database that already has these columns from a previous run.
    add_column :channel_web_widgets, :voice_agent_provider, :string, default: 'elevenlabs' unless
      column_exists?(:channel_web_widgets, :voice_agent_provider)
    add_column :channel_web_widgets, :voice_agent_api_key, :string, default: nil unless
      column_exists?(:channel_web_widgets, :voice_agent_api_key)
    add_column :channel_web_widgets, :voice_agent_config_data, :jsonb, default: {} unless
      column_exists?(:channel_web_widgets, :voice_agent_config_data)
  end
end
