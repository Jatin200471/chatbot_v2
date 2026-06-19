<script>
import { useAlert } from 'dashboard/composables';
import inboxMixin from 'shared/mixins/inboxMixin';
import SettingsSection from '../../../../../components/SettingsSection.vue';
import ImapSettings from '../ImapSettings.vue';
import SmtpSettings from '../SmtpSettings.vue';
import { useVuelidate } from '@vuelidate/core';
import { required } from '@vuelidate/validators';
import NextButton from 'dashboard/components-next/button/Button.vue';
import TextArea from 'next/textarea/TextArea.vue';
import WhatsappReauthorize from '../channels/whatsapp/Reauthorize.vue';
import { sanitizeAllowedDomains } from 'dashboard/helper/URLHelper';

export default {
  components: {
    SettingsSection,
    ImapSettings,
    SmtpSettings,
    NextButton,
    TextArea,
    WhatsappReauthorize,
  },
  mixins: [inboxMixin],
  props: {
    inbox: {
      type: Object,
      default: () => ({}),
    },
  },
  setup() {
    return { v$: useVuelidate() };
  },
  data() {
    return {
      hmacMandatory: false,
      whatsAppInboxAPIKey: '',
      isRequestingReauthorization: false,
      isSyncingTemplates: false,
      allowedDomains: '',
      isUpdatingAllowedDomains: false,
      voiceAgentEnabled: false,
      voiceAgentProvider: 'elevenlabs',
      voiceAgentApiKey: '',
      voiceAgentAgentId: '',
      voiceAgentConfigData: {},
      isUpdatingVoiceAgent: false,
      customBrandingText: '',
      customBrandingUrl: '',
      isUpdatingBranding: false,
      customBubbleIconUrl: '',
      customBubbleIconSize: 60,
      isUpdatingBubbleIcon: false,
      widgetBgColor: '',
      widgetBgImageUrl: '',
      widgetFontFamily: '',
      welcomeHeadingColor: '',
      welcomeHeadingSize: 24,
      welcomeTaglineColor: '',
      welcomeTaglineSize: 14,
      ctaBgColor: '',
      ctaTextColor: '',
      botBubbleBgColor: '',
      botBubbleTextColor: '',
      userBubbleBgColor: '',
      userBubbleTextColor: '',
      inputFocusColor: '',
      isUpdatingAppearance: false,
      
      // Widget Branding / Bubble Icon / Appearance removed in this build.
      // Kept legacy fields for backward compatibility if backend sends them.
    }; 
  },
  validations: {
    whatsAppInboxAPIKey: { required },
  },
  computed: {
    isEmbeddedSignupWhatsApp() {
      return this.inbox.provider_config?.source === 'embedded_signup';
    },
    whatsappAppId() {
      return window.chatwootConfig?.whatsappAppId;
    },
    isForwardingEnabled() {
      return !!this.inbox.forwarding_enabled;
    },
  },
  watch: {
    inbox() {
      this.setDefaults();
    },
  },
  mounted() {
    this.setDefaults();
  },
  methods: {
    setDefaults() {
      this.hmacMandatory = this.inbox.hmac_mandatory || false;
      this.allowedDomains = this.inbox.allowed_domains || '';
      const flags = this.inbox.selected_feature_flags || [];
      // 'elevenlabs_voice' is the real FlagShihTzu bit (bit 5) in web_widget.rb
      this.voiceAgentEnabled = flags.includes('elevenlabs_voice') || flags.includes('voice_agent');
      this.voiceAgentProvider = this.inbox.voice_agent_provider || 'elevenlabs';
      this.voiceAgentApiKey = this.inbox.voice_agent_api_key || '';
      // Prefer the dedicated column; fall back to whatever is inside the JSON blob.
      const rawConfig = this.inbox.voice_agent_config_data || {};
      const parsedConfig = typeof rawConfig === 'string'
        ? (() => { try { return JSON.parse(rawConfig); } catch (_) { return {}; } })()
        : rawConfig;
      this.voiceAgentAgentId = this.inbox.elevenlabs_agent_id || parsedConfig.agent_id || '';
      this.voiceAgentConfigData = JSON.stringify(parsedConfig, null, 2);
      this.customBrandingText = this.inbox.custom_branding_text || '';
      this.customBrandingUrl = this.inbox.custom_branding_url || '';
      this.customBubbleIconUrl = this.inbox.custom_bubble_icon_url || '';
      this.customBubbleIconSize = this.inbox.custom_bubble_icon_size ?? 60;
      this.widgetBgColor = this.inbox.widget_bg_color || '';
      this.widgetBgImageUrl = this.inbox.widget_bg_image_url || '';
      this.widgetFontFamily = this.inbox.widget_font_family || '';
      this.welcomeHeadingColor = this.inbox.welcome_heading_color || '';
      this.welcomeHeadingSize = this.inbox.welcome_heading_size || 24;
      this.welcomeTaglineColor = this.inbox.welcome_tagline_color || '';
      this.welcomeTaglineSize = this.inbox.welcome_tagline_size || 14;
      this.ctaBgColor = this.inbox.cta_bg_color || '';
      this.ctaTextColor = this.inbox.cta_text_color || '';
      this.botBubbleBgColor = this.inbox.bot_bubble_bg_color || '';
      this.botBubbleTextColor = this.inbox.bot_bubble_text_color || '';
      this.userBubbleBgColor = this.inbox.user_bubble_bg_color || '';
      this.userBubbleTextColor = this.inbox.user_bubble_text_color || '';
      this.inputFocusColor = this.inbox.input_focus_color || '';
    },
    handleHmacFlag() {
      this.updateInbox();
    },
    async updateInbox() {
      try {
        const payload = {
          id: this.inbox.id,
          formData: false,
          channel: {
            hmac_mandatory: this.hmacMandatory,
          },
        };
        await this.$store.dispatch('inboxes/updateInbox', payload);
        useAlert(this.$t('INBOX_MGMT.EDIT.API.SUCCESS_MESSAGE'));
      } catch (error) {
        useAlert(this.$t('INBOX_MGMT.EDIT.API.ERROR_MESSAGE'));
      }
    },
    async updateAllowedDomains() {
      this.isUpdatingAllowedDomains = true;
      const sanitizedAllowedDomains = sanitizeAllowedDomains(
        this.allowedDomains
      );
      try {
        const payload = {
          id: this.inbox.id,
          formData: false,
          channel: {
            allowed_domains: sanitizedAllowedDomains,
          },
        };
        await this.$store.dispatch('inboxes/updateInbox', payload);
        this.allowedDomains = sanitizedAllowedDomains;
        useAlert(this.$t('INBOX_MGMT.EDIT.API.SUCCESS_MESSAGE'));
      } catch (error) {
        useAlert(this.$t('INBOX_MGMT.EDIT.API.ERROR_MESSAGE'));
      } finally {
        this.isUpdatingAllowedDomains = false;
      }
    },
    async updateWhatsAppInboxAPIKey() {
      try {
        const payload = {
          id: this.inbox.id,
          formData: false,
          channel: {},
        };

        payload.channel.provider_config = {
          ...this.inbox.provider_config,
          api_key: this.whatsAppInboxAPIKey,
        };

        await this.$store.dispatch('inboxes/updateInbox', payload);
        useAlert(this.$t('INBOX_MGMT.EDIT.API.SUCCESS_MESSAGE'));
      } catch (error) {
        useAlert(this.$t('INBOX_MGMT.EDIT.API.ERROR_MESSAGE'));
      }
    },
    async handleReconfigure() {
      if (this.$refs.whatsappReauth) {
        await this.$refs.whatsappReauth.requestAuthorization();
      }
    },
    async syncTemplates() {
      this.isSyncingTemplates = true;
      try {
        await this.$store.dispatch('inboxes/syncTemplates', this.inbox.id);
        useAlert(
          this.$t('INBOX_MGMT.SETTINGS_POPUP.WHATSAPP_TEMPLATES_SYNC_SUCCESS')
        );
      } catch (error) {
        useAlert(this.$t('INBOX_MGMT.EDIT.API.ERROR_MESSAGE'));
      } finally {
        this.isSyncingTemplates = false;
      }
    },
    async updateBubbleIconSettings() {
      this.isUpdatingBubbleIcon = true;
      try {
        const payload = {
          id: this.inbox.id,
          formData: false,
          channel: {
            custom_bubble_icon_url: this.customBubbleIconUrl.trim() || null,
            custom_bubble_icon_size: Number(this.customBubbleIconSize),
          },
        };
        await this.$store.dispatch('inboxes/updateInbox', payload);
        useAlert(this.$t('INBOX_MGMT.EDIT.API.SUCCESS_MESSAGE'));
      } catch (error) {
        useAlert(this.$t('INBOX_MGMT.EDIT.API.ERROR_MESSAGE'));
      } finally {
        this.isUpdatingBubbleIcon = false;
      }
    },
    async updateBrandingSettings() {
      this.isUpdatingBranding = true;
      try {
        const payload = {
          id: this.inbox.id,
          formData: false,
          channel: {
            custom_branding_text: this.customBrandingText.trim() || null,
            custom_branding_url: this.customBrandingUrl.trim() || null,
          },
        };
        await this.$store.dispatch('inboxes/updateInbox', payload);
        useAlert(this.$t('INBOX_MGMT.EDIT.API.SUCCESS_MESSAGE'));
      } catch (error) {
        useAlert(this.$t('INBOX_MGMT.EDIT.API.ERROR_MESSAGE'));
      } finally {
        this.isUpdatingBranding = false;
      }
    },
    async updateAppearanceSettings() {
      this.isUpdatingAppearance = true;
      try {
        const payload = {
          id: this.inbox.id,
          formData: false,
          channel: {
            widget_bg_color: this.widgetBgColor.trim() || null,
            widget_bg_image_url: this.widgetBgImageUrl.trim() || null,
            widget_font_family: this.widgetFontFamily.trim() || null,
            welcome_heading_color: this.welcomeHeadingColor.trim() || null,
            welcome_heading_size: this.welcomeHeadingSize ? Number(this.welcomeHeadingSize) : null,
            welcome_tagline_color: this.welcomeTaglineColor.trim() || null,
            welcome_tagline_size: this.welcomeTaglineSize ? Number(this.welcomeTaglineSize) : null,
            cta_bg_color: this.ctaBgColor.trim() || null,
            cta_text_color: this.ctaTextColor.trim() || null,
            bot_bubble_bg_color: this.botBubbleBgColor.trim() || null,
            bot_bubble_text_color: this.botBubbleTextColor.trim() || null,
            user_bubble_bg_color: this.userBubbleBgColor.trim() || null,
            user_bubble_text_color: this.userBubbleTextColor.trim() || null,
            input_focus_color: this.inputFocusColor.trim() || null,
          },
        };
        await this.$store.dispatch('inboxes/updateInbox', payload);
        useAlert(this.$t('INBOX_MGMT.EDIT.API.SUCCESS_MESSAGE'));
      } catch (error) {
        useAlert(this.$t('INBOX_MGMT.EDIT.API.ERROR_MESSAGE'));
      } finally {
        this.isUpdatingAppearance = false;
      }
    },
    async updateVoiceAgentSettings() {
      this.isUpdatingVoiceAgent = true;
      try {
        // Parse the optional advanced JSON blob. Empty / invalid → {}.
        let configData = {};
        if (typeof this.voiceAgentConfigData === 'string') {
          const trimmed = this.voiceAgentConfigData.trim();
          if (trimmed) {
            try { configData = JSON.parse(trimmed); } catch (_) { configData = {}; }
          }
        } else if (this.voiceAgentConfigData && typeof this.voiceAgentConfigData === 'object') {
          configData = this.voiceAgentConfigData;
        }

        // Agent ID input wins. Mirror it into the JSON blob so the widget's
        // existing voice_agent_config_data.agent_id read path keeps working.
        const agentId = (this.voiceAgentAgentId || '').trim();
        if (agentId) {
          configData = { ...configData, agent_id: agentId };
        }

        // Dashboard uses the 'elevenlabs_voice' FlagShihTzu bit (bit 5,
        // see web_widget.rb). Strip both legacy names before re-adding.
        const currentFlags = (this.inbox.selected_feature_flags || []).filter(
          f => f !== 'elevenlabs_voice' && f !== 'voice_agent'
        );
        if (this.voiceAgentEnabled) {
          currentFlags.push('elevenlabs_voice');
        }

        // Send config_data as a JSON STRING. EDITABLE_ATTRS lists
        // :voice_agent_config_data as a bare symbol, so Rails strong params
        // would silently drop a nested hash. The controller has matching
        // JSON.parse logic for string input. See inboxes_controller.rb.
        const payload = {
          id: this.inbox.id,
          formData: false,
          channel: {
            selected_feature_flags: currentFlags,
            voice_agent_provider: this.voiceAgentProvider,
            voice_agent_api_key: this.voiceAgentApiKey,
            voice_agent_config_data: JSON.stringify(configData),
            elevenlabs_agent_id: agentId,
          },
        };
        await this.$store.dispatch('inboxes/updateInbox', payload);
        useAlert(this.$t('INBOX_MGMT.EDIT.API.SUCCESS_MESSAGE'));
      } catch (error) {
        useAlert(this.$t('INBOX_MGMT.EDIT.API.ERROR_MESSAGE'));
      } finally {
        this.isUpdatingVoiceAgent = false;
      }
    },
  },
};
</script>

<template>
  <div v-if="isATwilioChannel" class="mx-8">
    <SettingsSection
      :title="$t('INBOX_MGMT.ADD.TWILIO.API_CALLBACK.TITLE')"
      :sub-title="$t('INBOX_MGMT.ADD.TWILIO.API_CALLBACK.SUBTITLE')"
    >
      <woot-code :script="inbox.callback_webhook_url" lang="html" />
    </SettingsSection>
    <SettingsSection
      v-if="isATwilioWhatsAppChannel"
      :title="$t('INBOX_MGMT.SETTINGS_POPUP.WHATSAPP_TEMPLATES_SYNC_TITLE')"
      :sub-title="$t('INBOX_MGMT.SETTINGS_POPUP.WHATSAPP_TEMPLATES_SYNC_SUBHEADER')"
    >
      <div class="flex justify-start items-center mt-2">
        <NextButton :disabled="isSyncingTemplates" @click="syncTemplates">
          {{ $t('INBOX_MGMT.SETTINGS_POPUP.WHATSAPP_TEMPLATES_SYNC_BUTTON') }}
        </NextButton>
      </div>
    </SettingsSection>
  </div>
  <div v-else-if="isAVoiceChannel" class="mx-8">
    <SettingsSection
      :title="$t('INBOX_MGMT.ADD.VOICE.CONFIGURATION.TWILIO_VOICE_URL_TITLE')"
      :sub-title="$t('INBOX_MGMT.ADD.VOICE.CONFIGURATION.TWILIO_VOICE_URL_SUBTITLE')"
    >
      <woot-code :script="inbox.voice_call_webhook_url" lang="html" />
    </SettingsSection>
    <SettingsSection
      :title="$t('INBOX_MGMT.ADD.VOICE.CONFIGURATION.TWILIO_STATUS_URL_TITLE')"
      :sub-title="$t('INBOX_MGMT.ADD.VOICE.CONFIGURATION.TWILIO_STATUS_URL_SUBTITLE')"
    >
      <woot-code :script="inbox.voice_status_webhook_url" lang="html" />
    </SettingsSection>
  </div>
  <div v-else-if="isALineChannel" class="mx-8">
    <SettingsSection
      :title="$t('INBOX_MGMT.ADD.LINE_CHANNEL.API_CALLBACK.TITLE')"
      :sub-title="$t('INBOX_MGMT.ADD.LINE_CHANNEL.API_CALLBACK.SUBTITLE')"
    >
      <woot-code :script="inbox.callback_webhook_url" lang="html" />
    </SettingsSection>
  </div>
  <div v-else-if="isAWebWidgetInbox">
    <div class="mx-8">
      <SettingsSection
        :title="$t('INBOX_MGMT.SETTINGS_POPUP.MESSENGER_HEADING')"
        :sub-title="$t('INBOX_MGMT.SETTINGS_POPUP.MESSENGER_SUB_HEAD')"
      >
        <woot-code
          :script="inbox.web_widget_script"
          lang="html"
          :codepen-title="`${inbox.name} - Chatwoot Widget Test`"
          enable-code-pen
        />
      </SettingsSection>

      <SettingsSection
        :title="$t('INBOX_MGMT.SETTINGS_POPUP.ALLOWED_DOMAINS.TITLE')"
        :sub-title="$t('INBOX_MGMT.SETTINGS_POPUP.ALLOWED_DOMAINS.SUBTITLE')"
      >
        <div class="flex flex-col w-full max-w-3xl gap-4">
          <TextArea
            v-model="allowedDomains"
            :placeholder="$t('INBOX_MGMT.SETTINGS_POPUP.ALLOWED_DOMAINS.PLACEHOLDER')"
            auto-height
            min-height="8rem"
            class="w-full"
          />
          <div>
            <NextButton
              :label="$t('INBOX_MGMT.SETTINGS_POPUP.UPDATE')"
              :is-loading="isUpdatingAllowedDomains"
              @click="updateAllowedDomains"
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        :title="$t('INBOX_MGMT.SETTINGS_POPUP.HMAC_VERIFICATION')"
      >
        <woot-code :script="inbox.hmac_token" />
        <template #subTitle>
          {{ $t('INBOX_MGMT.SETTINGS_POPUP.HMAC_DESCRIPTION') }}
          <a target="_blank" rel="noopener noreferrer"
            href="https://www.chatwoot.com/docs/product/channels/live-chat/sdk/identity-validation/">
            {{ $t('INBOX_MGMT.SETTINGS_POPUP.HMAC_LINK_TO_DOCS') }}
          </a>
        </template>
      </SettingsSection>

      <SettingsSection
        :title="$t('INBOX_MGMT.SETTINGS_POPUP.HMAC_MANDATORY_VERIFICATION')"
        :sub-title="$t('INBOX_MGMT.SETTINGS_POPUP.HMAC_MANDATORY_DESCRIPTION')"
      >
        <div class="flex gap-2 items-center">
          <input id="hmacMandatory" v-model="hmacMandatory" type="checkbox" @change="handleHmacFlag" />
          <label for="hmacMandatory">
            {{ $t('INBOX_MGMT.EDIT.ENABLE_HMAC.LABEL') }}
          </label>
        </div>
      </SettingsSection>

      <!-- ───────────────────────────────────────────────
           VOICE AGENT CONFIGURATION SECTION
      ─────────────────────────────────────────────── -->
      <SettingsSection
        title="Voice Agent"
        sub-title="Enable a conversational AI voice button in this inbox's chat widget. When enabled, visitors can start a voice call powered by your chosen AI provider."
      >
        <!-- Toggle row — matches the style of "Enable widget in mobile apps" toggle -->
        <div class="flex items-center justify-between w-full max-w-3xl py-2">
          <div class="flex flex-col gap-0.5">
            <span class="text-sm font-medium text-n-slate-12">
              Enable Voice Agent
            </span>
            <span class="text-xs text-n-slate-9">
              {{ voiceAgentEnabled ? 'Voice agent is active on this inbox' : 'Voice agent is currently disabled' }}
            </span>
          </div>

          <!-- Native iOS-style toggle matching Chatwoot's existing toggles -->
          <label class="voice-agent-toggle" :class="{ 'voice-agent-toggle--active': voiceAgentEnabled }">
            <input
              id="voiceAgentEnabled"
              v-model="voiceAgentEnabled"
              type="checkbox"
              class="sr-only"
            />
            <span class="voice-agent-toggle__track" />
          </label>
        </div>

        <!-- Expanded config — only shown when toggle is ON -->
        <transition name="voice-agent-expand">
          <div v-if="voiceAgentEnabled" class="voice-agent-config mt-4 flex flex-col gap-5 w-full max-w-3xl">

            <!-- Status badge -->
            <div class="flex items-center gap-2">
              <span class="voice-agent-badge voice-agent-badge--active">
                <span class="voice-agent-badge__dot" />
                Active
              </span>
              <span class="text-xs text-n-slate-9">Changes take effect after saving</span>
            </div>

            <!-- Provider -->
            <div class="flex flex-col gap-1.5">
              <label class="text-sm font-medium text-n-slate-11" for="voiceAgentProvider">
                Provider
                <span class="text-n-slate-9 font-normal ml-1">e.g. elevenlabs, twilio, google, custom</span>
              </label>
              <input
                id="voiceAgentProvider"
                v-model="voiceAgentProvider"
                type="text"
                placeholder="elevenlabs"
                class="chatwoot-input w-full max-w-lg"
              />
            </div>

            <!-- API Key -->
            <div class="flex flex-col gap-1.5">
              <label class="text-sm font-medium text-n-slate-11" for="voiceAgentApiKey">
                API Key
                <span class="text-n-slate-9 font-normal ml-1">required for authentication</span>
              </label>
              <input
                id="voiceAgentApiKey"
                v-model="voiceAgentApiKey"
                type="password"
                placeholder="your-voice-agent-api-key"
                class="chatwoot-input w-full max-w-lg"
                autocomplete="new-password"
              />
            </div>

            <!-- Agent ID -->
            <div class="flex flex-col gap-1.5">
              <label class="text-sm font-medium text-n-slate-11" for="voiceAgentAgentId">
                Agent ID
                <span class="text-n-slate-9 font-normal ml-1">required — voice agent will not appear in widget without this</span>
              </label>
              <input
                id="voiceAgentAgentId"
                v-model="voiceAgentAgentId"
                type="text"
                placeholder="agent_xxxxxxxxxxxxxxxxxxxxxxxxx"
                class="chatwoot-input w-full max-w-lg"
              />
              <p class="text-xs text-n-slate-10 mt-0.5">
                For ElevenLabs, copy this from your agent dashboard at elevenlabs.io.
              </p>
            </div>

            <!-- Config JSON (advanced / optional) -->
            <details class="flex flex-col gap-1.5">
              <summary class="text-sm font-medium text-n-slate-11 cursor-pointer select-none">
                Advanced configuration
                <span class="text-n-slate-9 font-normal ml-1">optional JSON for provider-specific extras</span>
              </summary>
              <div class="flex flex-col gap-1.5 mt-2">
                <textarea
                  id="voiceAgentConfig"
                  v-model="voiceAgentConfigData"
                  placeholder='{"voice_id": "voice_xxx", "timeout": 300}'
                  class="chatwoot-input chatwoot-input--mono w-full max-w-lg"
                  rows="5"
                />
                <p class="text-xs text-n-slate-10 mt-0.5">
                  Anything extra your provider needs (voice_id, timeout, etc.). The Agent ID field above takes priority.
                </p>
              </div>
            </details>
          </div>
        </transition>

        <!-- Save button — always visible so user can save the toggle state too -->
        <div class="mt-5">
          <NextButton
            label="Save Voice Agent Settings"
            :is-loading="isUpdatingVoiceAgent"
            @click="updateVoiceAgentSettings"
          />
        </div>
      </SettingsSection>
      <!-- ─── END VOICE AGENT ─── -->

    </div>
  </div>
  <div v-else-if="isAPIInbox" class="mx-8">
    <SettingsSection
      :title="$t('INBOX_MGMT.SETTINGS_POPUP.INBOX_IDENTIFIER')"
      :sub-title="$t('INBOX_MGMT.SETTINGS_POPUP.INBOX_IDENTIFIER_SUB_TEXT')"
    >
      <woot-code :script="inbox.inbox_identifier" />
    </SettingsSection>
    <SettingsSection
      :title="$t('INBOX_MGMT.SETTINGS_POPUP.HMAC_VERIFICATION')"
      :sub-title="$t('INBOX_MGMT.SETTINGS_POPUP.HMAC_DESCRIPTION')"
    >
      <woot-code :script="inbox.hmac_token" />
    </SettingsSection>
    <SettingsSection
      :title="$t('INBOX_MGMT.SETTINGS_POPUP.HMAC_MANDATORY_VERIFICATION')"
      :sub-title="$t('INBOX_MGMT.SETTINGS_POPUP.HMAC_MANDATORY_DESCRIPTION')"
    >
      <div class="flex gap-2 items-center">
        <input id="hmacMandatory" v-model="hmacMandatory" type="checkbox" @change="handleHmacFlag" />
        <label for="hmacMandatory">
          {{ $t('INBOX_MGMT.EDIT.ENABLE_HMAC.LABEL') }}
        </label>
      </div>
    </SettingsSection>
  </div>
  <div v-else-if="isAnEmailChannel">
    <div class="mx-8">
      <SettingsSection
        :title="$t('INBOX_MGMT.SETTINGS_POPUP.FORWARD_EMAIL_TITLE')"
        :sub-title="isForwardingEnabled ? $t('INBOX_MGMT.SETTINGS_POPUP.FORWARD_EMAIL_SUB_TEXT') : ''"
      >
        <woot-code v-if="isForwardingEnabled" :script="inbox.forward_to_email" />
        <div v-else class="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <p class="text-sm text-yellow-800 dark:text-yellow-200 mb-0">
            {{ $t('INBOX_MGMT.SETTINGS_POPUP.FORWARD_EMAIL_NOT_CONFIGURED') }}
          </p>
        </div>
      </SettingsSection>
    </div>
    <ImapSettings :inbox="inbox" />
    <SmtpSettings v-if="inbox.imap_enabled" :inbox="inbox" />
  </div>
  <div v-else-if="isAWhatsAppChannel && !isATwilioChannel">
    <div v-if="inbox.provider_config" class="mx-8">
      <template v-if="isEmbeddedSignupWhatsApp">
        <SettingsSection
          v-if="whatsappAppId"
          :title="$t('INBOX_MGMT.SETTINGS_POPUP.WHATSAPP_EMBEDDED_SIGNUP_TITLE')"
          :sub-title="$t('INBOX_MGMT.SETTINGS_POPUP.WHATSAPP_EMBEDDED_SIGNUP_SUBHEADER')"
        >
          <div class="flex gap-4 items-center">
            <p class="text-sm text-n-slate-11">
              {{ $t('INBOX_MGMT.SETTINGS_POPUP.WHATSAPP_EMBEDDED_SIGNUP_DESCRIPTION') }}
            </p>
            <NextButton @click="handleReconfigure">
              {{ $t('INBOX_MGMT.SETTINGS_POPUP.WHATSAPP_RECONFIGURE_BUTTON') }}
            </NextButton>
          </div>
        </SettingsSection>
      </template>
      <template v-else>
        <SettingsSection
          :title="$t('INBOX_MGMT.SETTINGS_POPUP.WHATSAPP_WEBHOOK_TITLE')"
          :sub-title="$t('INBOX_MGMT.SETTINGS_POPUP.WHATSAPP_WEBHOOK_SUBHEADER')"
        >
          <woot-code :script="inbox.provider_config.webhook_verify_token" />
        </SettingsSection>
        <SettingsSection
          :title="$t('INBOX_MGMT.SETTINGS_POPUP.WHATSAPP_SECTION_TITLE')"
          :sub-title="$t('INBOX_MGMT.SETTINGS_POPUP.WHATSAPP_SECTION_SUBHEADER')"
        >
          <woot-code :script="inbox.provider_config.api_key" />
        </SettingsSection>
        <SettingsSection
          :title="$t('INBOX_MGMT.SETTINGS_POPUP.WHATSAPP_SECTION_UPDATE_TITLE')"
          :sub-title="$t('INBOX_MGMT.SETTINGS_POPUP.WHATSAPP_SECTION_UPDATE_SUBHEADER')"
        >
          <div class="flex flex-1 justify-between items-center mt-2 whatsapp-settings--content">
            <woot-input
              v-model="whatsAppInboxAPIKey"
              type="text"
              class="flex-1 mr-2 [&>input]:!mb-0"
              :placeholder="$t('INBOX_MGMT.SETTINGS_POPUP.WHATSAPP_SECTION_UPDATE_PLACEHOLDER')"
            />
            <NextButton :disabled="v$.whatsAppInboxAPIKey.$invalid" @click="updateWhatsAppInboxAPIKey">
              {{ $t('INBOX_MGMT.SETTINGS_POPUP.WHATSAPP_SECTION_UPDATE_BUTTON') }}
            </NextButton>
          </div>
        </SettingsSection>
      </template>
      <SettingsSection
        :title="$t('INBOX_MGMT.SETTINGS_POPUP.WHATSAPP_TEMPLATES_SYNC_TITLE')"
        :sub-title="$t('INBOX_MGMT.SETTINGS_POPUP.WHATSAPP_TEMPLATES_SYNC_SUBHEADER')"
      >
        <div class="flex justify-start items-center mt-2">
          <NextButton :disabled="isSyncingTemplates" @click="syncTemplates">
            {{ $t('INBOX_MGMT.SETTINGS_POPUP.WHATSAPP_TEMPLATES_SYNC_BUTTON') }}
          </NextButton>
        </div>
      </SettingsSection>
    </div>
    <WhatsappReauthorize
      v-if="isEmbeddedSignupWhatsApp"
      ref="whatsappReauth"
      :inbox="inbox"
      class="hidden"
    />
  </div>
</template>

<style lang="scss" scoped>
.whatsapp-settings--content {
  ::v-deep input {
    margin-bottom: 0;
  }
}

/* ── Voice Agent toggle — matches Chatwoot's native toggle style ── */
.voice-agent-toggle {
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  flex-shrink: 0;

  &__track {
    display: block;
    width: 2.75rem;   /* 44px */
    height: 1.5rem;   /* 24px */
    border-radius: 9999px;
    /* Light mode: light gray off-state */
    background-color: #d1d5db;
    border: 2px solid #d1d5db;
    transition: background-color 0.2s ease, border-color 0.2s ease;
    position: relative;

    &::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 2px;
      transform: translateY(-50%);
      width: 1rem;    /* 16px thumb */
      height: 1rem;
      border-radius: 50%;
      background-color: #ffffff;
      transition: left 0.2s ease, background-color 0.2s ease;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
    }
  }

  &--active .voice-agent-toggle__track {
    background-color: #1f93ff;
    border-color: #1f93ff;

    &::after {
      left: calc(100% - 18px);
      background-color: #ffffff;
    }
  }

  &:hover .voice-agent-toggle__track {
    border-color: #3fa9ff;
  }
}

/* Dark mode override for toggle */
:global(.dark) .voice-agent-toggle__track {
  background-color: #3a3f4b;
  border-color: #4a4f5c;

  &::after {
    background-color: #9ca3af;
  }
}

/* ── Shared input style — light mode by default, dark mode override ── */
.chatwoot-input {
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  border-radius: 0.5rem;
  /* Light mode defaults */
  border: 1px solid #e2e8f0;
  background-color: #ffffff;
  color: #1e293b;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  outline: none;

  &::placeholder {
    color: #94a3b8;
  }

  &:focus {
    border-color: #1f93ff;
    box-shadow: 0 0 0 3px rgba(31, 147, 255, 0.15);
  }

  &--mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.8125rem;
    resize: vertical;
  }
}

/* Dark mode override for inputs */
:global(.dark) .chatwoot-input {
  background-color: #1e2228;
  color: #e2e8f0;
  border-color: #3a3f4b;

  &::placeholder {
    color: #6b7280;
  }
}

/* ── Status badge ── */
.voice-agent-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.625rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;

  &--active {
    background-color: rgba(34, 197, 94, 0.12);
    color: #4ade80;
    border: 1px solid rgba(34, 197, 94, 0.25);
  }

  &__dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: #4ade80;
    animation: pulse-dot 2s ease-in-out infinite;
  }
}

/* ── Expand / collapse animation ── */
.voice-agent-expand-enter-active,
.voice-agent-expand-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease, max-height 0.3s ease;
  overflow: hidden;
  max-height: 600px;
}

.voice-agent-expand-enter-from,
.voice-agent-expand-leave-to {
  opacity: 0;
  transform: translateY(-6px);
  max-height: 0;
}

/* ── Pulsing dot animation ── */
@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
}
</style>