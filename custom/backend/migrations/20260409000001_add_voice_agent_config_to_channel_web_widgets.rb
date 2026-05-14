class AddVoiceAgentConfigToChannelWebWidgets < ActiveRecord::Migration[7.0]
  def change
    # Add columns for generic voice agent configuration
    # (not just ElevenLabs, but any provider)
    add_column :channel_web_widgets, :voice_agent_provider, :string, default: 'elevenlabs'
    add_column :channel_web_widgets, :voice_agent_api_key, :string, default: nil
    add_column :channel_web_widgets, :voice_agent_config_data, :jsonb, default: {}
  end
end
