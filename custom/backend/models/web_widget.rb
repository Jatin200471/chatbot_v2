# == Schema Information
#
# Table name: channel_web_widgets
#
#  id                    :integer          not null, primary key
#  allowed_domains       :text             default("")
#  continuity_via_email  :boolean          default(TRUE), not null
#  feature_flags         :integer          default(7), not null
#  hmac_mandatory        :boolean          default(FALSE)
#  hmac_token            :string
#  pre_chat_form_enabled :boolean          default(FALSE)
#  pre_chat_form_options :jsonb
#  reply_time            :integer          default("in_a_few_minutes")
#  website_token         :string
#  website_url           :string
#  welcome_tagline       :string
#  welcome_title         :string
#  widget_color          :string           default("#1f93ff")
#  created_at            :datetime         not null
#  updated_at            :datetime         not null
#  account_id            :integer
#
# Indexes
#
#  index_channel_web_widgets_on_hmac_token     (hmac_token) UNIQUE
#  index_channel_web_widgets_on_website_token  (website_token) UNIQUE
#

class Channel::WebWidget < ApplicationRecord
  include Channelable
  include FlagShihTzu

  self.table_name = 'channel_web_widgets'
  EDITABLE_ATTRS = [:website_url, :widget_color, :welcome_title, :welcome_tagline, :reply_time, :pre_chat_form_enabled,
                    :continuity_via_email, :hmac_mandatory, :allowed_domains,
                    { pre_chat_form_options: [:pre_chat_message, :require_email,
                                              { pre_chat_fields:
                                                [:field_type, :label, :placeholder, :name, :enabled, :type, :enabled, :required,
                                                 :locale, { values: [] }, :regex_pattern, :regex_cue] }] },
                    { selected_feature_flags: [] }, :elevenlabs_agent_id,
                    :voice_agent_provider, :voice_agent_api_key, :voice_agent_config_data].freeze

  before_validation :validate_pre_chat_options
  validates :website_url, presence: true
  validates :widget_color, presence: true
  has_many :portals, foreign_key: 'channel_web_widget_id', dependent: :nullify, inverse_of: :channel_web_widget

  has_secure_token :website_token
  has_secure_token :hmac_token

  has_flags 1 => :attachments,
            2 => :emoji_picker,
            3 => :end_conversation,
            4 => :use_inbox_avatar_for_bot,
            5 => :elevenlabs_voice,
            :column => 'feature_flags',
            :check_for_column => false

  enum reply_time: { in_a_few_minutes: 0, in_a_few_hours: 1, in_a_day: 2 }

  def name
    'Website'
  end

  def web_widget_script
    "
    <script>
      (function(d,t) {
        var BASE_URL=\"#{ENV.fetch('FRONTEND_URL', '')}\";
        var g=d.createElement(t),s=d.getElementsByTagName(t)[0];
        g.src=BASE_URL+\"/packs/js/sdk.js\";
        g.async = true;
        s.parentNode.insertBefore(g,s);
        g.onload=function(){
          window.chatwootSDK.run({
            websiteToken: '#{website_token}',
            baseUrl: BASE_URL
          })
        }
      })(document,\"script\");

      /* ── Chatwoot Voice: floating End Call button ──────────────────────────
         Shown on the parent page when a voice call is active + widget is closed.
         Hidden automatically when the widget is opened (user can end from inside).
         Clicking it sends a postMessage to the widget iframe to end the call.
      */
      (function() {
        var BTN_ID = 'cw-voice-end-btn';

        function getBtn() { return document.getElementById(BTN_ID); }

        function showBtn() {
          var btn = getBtn();
          if (btn) { btn.style.display = 'flex'; return; }

          if (!document.getElementById('cw-voice-style')) {
            var s = document.createElement('style');
            s.id = 'cw-voice-style';
            s.textContent = '@keyframes cwPulse{0%,100%{box-shadow:0 4px 16px rgba(239,68,68,.55)}50%{box-shadow:0 4px 28px rgba(239,68,68,.18)}} #cw-voice-end-btn:hover{background:#dc2626!important}';
            document.head.appendChild(s);
          }

          btn = document.createElement('button');
          btn.id = BTN_ID;
          btn.title = 'End Voice Call';
          btn.innerHTML =
            '<svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"currentColor\" style=\"flex-shrink:0\">' +
            '<path d=\"M3.5 14.5c5.5-5 11.5-5 17 0 .8.7.9 2 0 2.7l-2.1 1.6c-.5.4-1.2.4-1.7 0l-2-1.7' +
            'a1.5 1.5 0 0 1-.5-1.1V14a9.8 9.8 0 0 0-4.4 0v0c0 .4-.2.8-.5 1.1l-2 1.6c-.5.4-1.2.4-1.7 0' +
            'L3.5 15c-.5-.6-.4-1.7 0-2.5Z\" transform=\"rotate(135 12 12)\"/></svg>' +
            '<span style=\"margin-left:7px;font-size:13px;font-weight:600;letter-spacing:.01em\">End Call</span>';

          btn.style.cssText = [
            'position:fixed', 'bottom:90px', 'right:20px', 'z-index:2147483647',
            'display:flex', 'align-items:center', 'justify-content:center',
            'background:#ef4444', 'color:#fff', 'border:none', 'outline:none',
            'padding:11px 20px', 'border-radius:999px', 'cursor:pointer',
            'font-family:inherit', 'transition:background .15s',
            'animation:cwPulse 1.6s ease-in-out infinite'
          ].join(';');

          btn.onclick = function() {
            document.querySelectorAll('iframe').forEach(function(f) {
              try { f.contentWindow.postMessage({ event: 'end-voice-call-from-parent' }, '*'); } catch(e) {}
            });
          };

          document.body.appendChild(btn);
        }

        function hideBtn() {
          var btn = getBtn();
          if (btn) btn.style.display = 'none';
        }

        window.addEventListener('message', function(e) {
          if (!e.data || typeof e.data !== 'object') return;
          if (e.data.event === 'voice-call-active') {
            e.data.isActive ? showBtn() : hideBtn();
          }
        });
      })();
    </script>
    "
  end

  def validate_pre_chat_options
    return if pre_chat_form_options.with_indifferent_access['pre_chat_fields'].present?

    self.pre_chat_form_options = {
      pre_chat_message: 'Share your queries or comments here.',
      pre_chat_fields: [
        {
          'field_type': 'standard', 'label': 'Email Id', 'name': 'emailAddress', 'type': 'email', 'required': true, 'enabled': false
        },
        {
          'field_type': 'standard', 'label': 'Full name', 'name': 'fullName', 'type': 'text', 'required': false, 'enabled': false
        },
        {
          'field_type': 'standard', 'label': 'Phone number', 'name': 'phoneNumber', 'type': 'text', 'required': false, 'enabled': false
        }
      ]
    }
  end

  def create_contact_inbox(additional_attributes = {})
    ::ContactInboxWithContactBuilder.new({
                                           inbox: inbox,
                                           contact_attributes: { additional_attributes: additional_attributes }
                                         }).perform
  end
end
