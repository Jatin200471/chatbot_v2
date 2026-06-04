class AddVoiceAgentConfigToChannelWebWidgets < ActiveRecord::Migration[7.0]
  def up
    # ── Add new columns (safe for existing data) ──────────────────────────────
    #
    # column_exists? guard prevents crash when re-pulling image on a database
    # that already has these columns from a previous run.
    #
    # PostgreSQL automatically backfills existing rows with the default value
    # when a column is added — no data loss, no manual UPDATE needed.

    unless column_exists?(:channel_web_widgets, :voice_agent_provider)
      add_column :channel_web_widgets, :voice_agent_provider, :string, default: 'elevenlabs'
    end

    unless column_exists?(:channel_web_widgets, :voice_agent_api_key)
      # Stored as encrypted text — never plain text in DB.
      # Rails 7 Active Record Encryption uses RAILS_MASTER_KEY automatically.
      add_column :channel_web_widgets, :voice_agent_api_key, :text, default: nil
    end

    unless column_exists?(:channel_web_widgets, :voice_agent_config_data)
      add_column :channel_web_widgets, :voice_agent_config_data, :jsonb, default: {}
    end

    # ── Backfill existing rows — set safe defaults ────────────────────────────
    # Rows created before this migration have NULL for jsonb column.
    # Update them to {} so application code never needs to handle nil.
    execute <<~SQL
      UPDATE channel_web_widgets
      SET voice_agent_config_data = '{}'::jsonb
      WHERE voice_agent_config_data IS NULL;
    SQL
  end

  def down
    remove_column :channel_web_widgets, :voice_agent_provider   if column_exists?(:channel_web_widgets, :voice_agent_provider)
    remove_column :channel_web_widgets, :voice_agent_api_key    if column_exists?(:channel_web_widgets, :voice_agent_api_key)
    remove_column :channel_web_widgets, :voice_agent_config_data if column_exists?(:channel_web_widgets, :voice_agent_config_data)
  end
end
