class AddWidgetAppearanceToChannelWebWidgets < ActiveRecord::Migration[7.0]
  def change
    cols = {
      widget_bg_color:        :string,
      widget_bg_image_url:    :string,
      widget_font_family:     :string,
      welcome_heading_color:  :string,
      welcome_heading_size:   :integer,
      welcome_tagline_color:  :string,
      welcome_tagline_size:   :integer,
      online_status_color:    :string,
      reply_time_color:       :string,
      cta_bg_color:           :string,
      cta_text_color:         :string,
      bot_bubble_bg_color:    :string,
      bot_bubble_text_color:  :string,
      user_bubble_bg_color:   :string,
      user_bubble_text_color: :string,
      input_focus_color:      :string,
    }
    cols.each do |col, type|
      add_column :channel_web_widgets, col, type unless column_exists?(:channel_web_widgets, col)
    end
  end
end
