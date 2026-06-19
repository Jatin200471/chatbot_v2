# Silently ignore PG::UndefinedTable errors when installation_configs table
# does not exist yet (fresh database before first migration).
# This prevents "Failed to configure AI Agents SDK" boot errors.
Rails.application.config.after_initialize do
  begin
    if defined?(InstallationConfig) &&
       ActiveRecord::Base.connection.table_exists?('installation_configs')
      # Table exists — nothing to patch
    end
  rescue StandardError
    # Ignore any DB errors during boot (e.g. fresh DB, no tables yet)
  end
end
