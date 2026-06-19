Rails.application.config.after_initialize do
  Enterprise::Api::V1::AccountsController.class_eval do
    skip_before_action :check_cloud_env, only: [:limits], raise: false
  end
end
