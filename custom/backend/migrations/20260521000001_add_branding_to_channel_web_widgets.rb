class AddBrandingToChannelWebWidgets < ActiveRecord::Migration[7.0]
  def up
    unless column_exists?(:channel_web_widgets, :custom_branding_text)
      add_column :channel_web_widgets, :custom_branding_text, :string, default: nil
    end

    unless column_exists?(:channel_web_widgets, :custom_branding_url)
      add_column :channel_web_widgets, :custom_branding_url, :string, default: nil
    end
  end

  def down
    remove_column :channel_web_widgets, :custom_branding_text  if column_exists?(:channel_web_widgets, :custom_branding_text)
    remove_column :channel_web_widgets, :custom_branding_url   if column_exists?(:channel_web_widgets, :custom_branding_url)
  end
end
