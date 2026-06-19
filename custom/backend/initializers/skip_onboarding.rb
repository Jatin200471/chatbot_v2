Rails.application.config.after_initialize do
  Account.class_eval do
    after_save :clear_onboarding_step

    private

    def clear_onboarding_step
      step = custom_attributes&.dig('onboarding_step')
      return unless %w[account_details enrichment].include?(step)

      update_columns(custom_attributes: custom_attributes.except('onboarding_step'))
    rescue StandardError => e
      Rails.logger.error "[SKIP-ONBOARDING] #{e.message}"
    end
  end
end
