<script>
import { mapGetters, mapActions } from 'vuex';
import { setHeader } from 'widget/helpers/axios';
import addHours from 'date-fns/addHours';
import { IFrameHelper, RNHelper } from 'widget/helpers/utils';
import configMixin from './mixins/configMixin';
import { getLocale } from './helpers/urlParamsHelper';
import { getLanguageDirection } from 'dashboard/components/widgets/conversation/advancedFilterItems/languages';
import { isEmptyObject } from 'widget/helpers/utils';
import Spinner from 'shared/components/Spinner.vue';
import {
  getExtraSpaceToScroll,
  loadedEventConfig,
} from './helpers/IframeEventHelper';
import {
  ON_AGENT_MESSAGE_RECEIVED,
  ON_CAMPAIGN_MESSAGE_CLICK,
  ON_UNREAD_MESSAGE_CLICK,
} from './constants/widgetBusEvents';
import { useDarkMode } from 'widget/composables/useDarkMode';
import { useRouter } from 'vue-router';
import { useAvailability } from 'widget/composables/useAvailability';
import { SDK_SET_BUBBLE_VISIBILITY } from '../shared/constants/sharedFrameEvents';
import { emitter } from 'shared/helpers/mitt';
import { getConversationAPI } from 'widget/api/conversation';

export default {
  name: 'App',
  components: {
    Spinner,
  },
  mixins: [configMixin],
  setup() {
    const { prefersDarkMode } = useDarkMode();
    const router = useRouter();
    const { isInWorkingHours } = useAvailability();
    return { prefersDarkMode, router, isInWorkingHours };
  },
  data() {
    return {
      isMobile: false,
      campaignsSnoozedTill: undefined,
      configReady: false,
      conversationStatusCheckInterval: null,
      replyPollInterval: null,
      replyPollTimeout: null,
      _voiceReconnectPending: false,
    };
  },
  computed: {
    ...mapGetters({
      activeCampaign: 'campaign/getActiveCampaign',
      conversationSize: 'conversation/getConversationSize',
      hideMessageBubble: 'appConfig/getHideMessageBubble',
      isFetchingList: 'conversation/getIsFetchingList',
      isRightAligned: 'appConfig/isRightAligned',
      isWidgetOpen: 'appConfig/getIsWidgetOpen',
      messageCount: 'conversation/getMessageCount',
      isVoiceActive: 'elevenlabsVoice/getIsActive',
      isVoiceConnecting: 'elevenlabsVoice/getIsConnecting',
      unreadMessageCount: 'conversation/getUnreadMessageCount',
      isWidgetStyleFlat: 'appConfig/isWidgetStyleFlat',
      showUnreadMessagesDialog: 'appConfig/getShowUnreadMessagesDialog',
    }),
    isIFrame() {
      return IFrameHelper.isIFrame();
    },
    isRNWebView() {
      return RNHelper.isRNWebView();
    },
    isRTL() {
      return this.$root.$i18n.locale
        ? getLanguageDirection(this.$root.$i18n.locale)
        : false;
    },
  },
  watch: {
    // ── Original Chatwoot ──────────────────────────────────────────────────
    activeCampaign() {
      this.setCampaignView();
    },
    isRTL: {
      immediate: true,
      handler(value) {
        document.documentElement.dir = value ? 'rtl' : 'ltr';
      },
    },
    // ── Custom: reply polling ──────────────────────────────────────────────
    messageCount(newVal, oldVal) {
      if (newVal > oldVal && this.conversationSize > 0) {
        this.startReplyPolling();
      }
    },
    // ── Custom: voice call floating button ────────────────────────────────
    isVoiceActive(val) {
      if (!this.isIFrame) return;
      try {
        const autoOpen = !!val && this._voiceReconnectPending;
        if (val) this._voiceReconnectPending = false;
        window.parent.postMessage({
          event: 'voice-call-active',
          isActive: !!val,
          autoOpen,
        }, '*');
      } catch (_) {}
    },
  },
  mounted() {
    const { websiteToken, locale, widgetColor } = window.chatwootWebChannel;
    this.setLocale(locale);
    this.setWidgetColor(widgetColor);
    this.setWidgetColorVariable(widgetColor);
    setHeader(window.authToken);

    if (this.isIFrame) {
      this.registerListeners();
      this.sendLoadedEvent();
    } else {
      this.clearConversations();
      this.fetchAvailableAgents(websiteToken);
      this.setLocale(getLocale(window.location.search));
    }

    if (this.isRNWebView) {
      this.registerListeners();
      this.sendRNWebViewLoadedEvent();
    }

    // Original Chatwoot order
    this.registerUnreadEvents();
    this.registerCampaignEvents();

    // Custom features
    this.fetchVoiceAgentConfig();
    this.startConversationStatusCheck();
  },
  beforeUnmount() {
    if (this.conversationStatusCheckInterval) {
      clearInterval(this.conversationStatusCheckInterval);
    }
    this.stopReplyPolling();
  },
  methods: {
    ...mapActions('appConfig', [
      'setAppConfig',
      'setReferrerHost',
      'setWidgetColor',
      'setBubbleVisibility',
      'setColorScheme',
    ]),
    ...mapActions('conversation', ['fetchOldConversations', 'clearConversations', 'syncLatestMessages']),
    ...mapActions('conversationAttributes', ['getAttributes']),
    ...mapActions('campaign', ['initCampaigns', 'executeCampaign', 'resetCampaign']),
    ...mapActions('agent', ['fetchAvailableAgents']),
    ...mapActions('contacts', ['clearCurrentUser']),
    ...mapActions('voiceAgentConfig', ['fetchVoiceAgentConfig']),

    setWidgetColorVariable(widgetColor) {
      if (widgetColor) {
        document.documentElement.style.setProperty('--widget-color', widgetColor);
      }
    },
    scrollConversationToBottom() {
      const container = this.$el.querySelector('.conversation-wrap');
      container.scrollTop = container.scrollHeight;
    },
    setBubbleLabel() {
      IFrameHelper.sendMessage({
        event: 'setBubbleLabel',
        label: this.$t('BUBBLE.LABEL'),
      });
    },
    setIframeHeight(isFixedHeight) {
      this.$nextTick(() => {
        const extraHeight = getExtraSpaceToScroll();
        IFrameHelper.sendMessage({
          event: 'updateIframeHeight',
          isFixedHeight,
          extraHeight,
        });
      });
    },
    setLocale(localeWithVariation) {
      if (!localeWithVariation) return;
      const { enabledLanguages } = window.chatwootWebChannel;
      const localeWithoutVariation = localeWithVariation.split('_')[0];
      const hasLocaleWithoutVariation = enabledLanguages.some(
        lang => lang.iso_639_1_code === localeWithoutVariation
      );
      const hasLocaleWithVariation = enabledLanguages.some(
        lang => lang.iso_639_1_code === localeWithVariation
      );
      if (hasLocaleWithVariation) {
        this.$root.$i18n.locale = localeWithVariation;
      } else if (hasLocaleWithoutVariation) {
        this.$root.$i18n.locale = localeWithoutVariation;
      }
    },

    // ════════════════════════════════════════════════════════════════════════
    // NOTIFICATION — 100% Original Chatwoot code
    // ════════════════════════════════════════════════════════════════════════
    registerUnreadEvents() {
      emitter.on(ON_AGENT_MESSAGE_RECEIVED, () => {
        const { name: routeName } = this.$route;
        if (this.isWidgetOpen || !this.isIFrame) {
          // Widget open hai — sirf last seen update karo, notification mat dikhao
          if (routeName === 'messages') {
            this.$store.dispatch('conversation/setUserLastSeen');
          }
          return;
        }
        // Widget band hai — default Chatwoot card dikhao
        this.setUnreadView();
      });
      emitter.on(ON_UNREAD_MESSAGE_CLICK, () => {
        this.router
          .replace({ name: 'messages' })
          .then(() => this.unsetUnreadView());
      });
    },

    registerCampaignEvents() {
      emitter.on(ON_CAMPAIGN_MESSAGE_CLICK, () => {
        // Normal flow — same as clicking bubble for first time
        if (this.shouldShowPreChatForm) {
          this.router.replace({ name: 'prechat-form' });
        } else {
          this.router.replace({ name: 'messages' });
          emitter.emit('execute-campaign', {
            campaignId: this.activeCampaign.id,
          });
        }
        this.unsetUnreadView();
      });
      emitter.on('execute-campaign', campaignDetails => {
        const { customAttributes, campaignId } = campaignDetails;
        const { websiteToken } = window.chatwootWebChannel;
        this.executeCampaign({ campaignId, websiteToken, customAttributes });
        this.router.replace({ name: 'messages' });
      });
      emitter.on('snooze-campaigns', () => {
        const expireBy = addHours(new Date(), 1);
        this.campaignsSnoozedTill = Number(expireBy);
      });
    },

    setCampaignView() {
      const { messageCount, activeCampaign } = this;
      const shouldSnoozeCampaign =
        this.campaignsSnoozedTill && this.campaignsSnoozedTill > Date.now();
      const isCampaignReadyToExecute =
        !isEmptyObject(activeCampaign) &&
        !messageCount &&
        !shouldSnoozeCampaign;
      if (this.isIFrame && isCampaignReadyToExecute) {
        this.router.replace({ name: 'campaigns' }).then(() => {
          this.setIframeHeight(true);
          IFrameHelper.sendMessage({ event: 'setUnreadMode' });
        });
      }
    },

    setUnreadView() {
      const { unreadMessageCount } = this;
      if (!this.showUnreadMessagesDialog) {
        this.handleUnreadNotificationDot();
      } else if (this.isIFrame && unreadMessageCount > 0 && !this.isWidgetOpen) {
        this.router.replace({ name: 'unread-messages' }).then(() => {
          this.setIframeHeight(true);
          IFrameHelper.sendMessage({ event: 'setUnreadMode' });
        });
        this.handleUnreadNotificationDot();
      }
    },

    unsetUnreadView() {
      if (this.isIFrame) {
        IFrameHelper.sendMessage({ event: 'resetUnreadMode' });
        this.setIframeHeight(false);
        this.handleUnreadNotificationDot();
      }
    },

    handleUnreadNotificationDot() {
      if (this.isIFrame) {
        // No red dot on bubble — always 0
        IFrameHelper.sendMessage({
          event: 'handleNotificationDot',
          unreadMessageCount: 0,
        });
      }
    },
    // ════════════════════════════════════════════════════════════════════════

    createWidgetEvents(message) {
      const { eventName } = message;
      const isWidgetTriggerEvent = eventName === 'webwidget.triggered';
      if (
        isWidgetTriggerEvent &&
        ['unread-messages', 'campaigns'].includes(this.$route.name)
      ) {
        return;
      }
      this.$store.dispatch('events/create', { name: eventName });
    },

    registerListeners() {
      const { websiteToken } = window.chatwootWebChannel;
      window.addEventListener('message', e => {
        if (!IFrameHelper.isAValidEvent(e)) return;
        const message = IFrameHelper.getMessage(e);

        if (message.event === 'config-set') {
          this.setLocale(message.locale);
          this.setBubbleLabel();
          this.setAppConfig(message);
          this.configReady = true;
          this.fetchAvailableAgents(websiteToken);
          this.setCampaignReadData(message.campaignsSnoozedTill);

          Promise.all([
            this.fetchOldConversations(),
            this.getAttributes(),
          ]).then(() => {
            // Original: show unread view after loading
            this.setUnreadView();
            // Custom: check if resolved
            this.checkAndClearResolvedConversation();
            // Custom: voice reconnect
            try {
              if (localStorage.getItem('cw_voice_reconnect') && this.conversationSize > 0) {
                this._voiceReconnectPending = true;
                this.router.replace({ name: 'messages' }).catch(() => {});
              }
            } catch (_) {}
          });

        } else if (message.event === 'widget-visible') {
          this.scrollConversationToBottom();

        } else if (message.event === 'change-url') {
          const { referrerURL, referrerHost } = message;
          this.initCampaigns({
            currentURL: referrerURL,
            websiteToken,
            isInBusinessHours: this.isInWorkingHours,
          });
          window.referrerURL = referrerURL;
          this.setReferrerHost(referrerHost);

        } else if (message.event === 'toggle-close-button') {
          this.isMobile = message.isMobile;

        } else if (message.event === 'push-event') {
          this.createWidgetEvents(message);

        } else if (message.event === 'set-label') {
          this.$store.dispatch('conversationLabels/create', message.label);

        } else if (message.event === 'remove-label') {
          this.$store.dispatch('conversationLabels/destroy', message.label);

        } else if (message.event === 'set-user') {
          this.$store.dispatch('contacts/setUser', message);

        } else if (message.event === 'set-custom-attributes') {
          this.$store.dispatch('contacts/setCustomAttributes', message.customAttributes);

        } else if (message.event === 'delete-custom-attribute') {
          this.$store.dispatch('contacts/deleteCustomAttribute', message.customAttribute);

        } else if (message.event === 'set-conversation-custom-attributes') {
          this.$store.dispatch('conversation/setCustomAttributes', message.customAttributes);

        } else if (message.event === 'delete-conversation-custom-attribute') {
          this.$store.dispatch('conversation/deleteCustomAttribute', message.customAttribute);

        } else if (message.event === 'set-locale') {
          this.setLocale(message.locale);
          this.setBubbleLabel();

        } else if (message.event === 'set-color-scheme') {
          this.setColorScheme(message.darkMode);

        } else if (message.event === 'toggle-open') {
          this.$store.dispatch('appConfig/toggleWidgetOpen', message.isOpen);

          // ── Original Chatwoot toggle-open logic ──────────────────────────
          const shouldShowMessageView =
            ['home'].includes(this.$route.name) &&
            message.isOpen &&
            this.messageCount;
          const shouldShowHomeView =
            !message.isOpen &&
            ['unread-messages', 'campaigns'].includes(this.$route.name);

          if (shouldShowMessageView) {
            this.router.replace({ name: 'messages' });
          }
          if (shouldShowHomeView) {
            this.$store.dispatch('conversation/setUserLastSeen');
            this.unsetUnreadView();
            this.router.replace({ name: 'home' });
          }
          if (!message.isOpen) {
            this.resetCampaign();
            // Custom: sync on close
            if (this.conversationSize > 0) {
              this.syncLatestMessages();
            }
          } else {
            // Custom: re-fetch voice config on open
            this.fetchVoiceAgentConfig();
            // Custom: resolve check on open
            if (this.conversationSize > 0) {
              this.checkAndClearResolvedConversation();
            }
          }
          // ─────────────────────────────────────────────────────────────────

        } else if (message.event === SDK_SET_BUBBLE_VISIBILITY) {
          this.setBubbleVisibility(message.hideMessageBubble);
        }
      });

      // Custom: floating End Call button
      window.addEventListener('message', e => {
        if (e.data?.event === 'end-voice-call-from-parent') {
          emitter.emit('end-voice-call');
        }
      });

      // Custom: pre-chat form auto-fill from parent page cookies
      window.addEventListener('message', e => {
        if (e.data?.event === 'prefill-form-data') {
          emitter.emit('prefill-form-data', {
            name:  e.data.name  || '',
            email: e.data.email || '',
            phone: e.data.phone || '',
          });
        }
      });
    },

    sendLoadedEvent() {
      IFrameHelper.sendMessage(loadedEventConfig());
    },
    sendRNWebViewLoadedEvent() {
      RNHelper.sendMessage(loadedEventConfig());
    },
    setCampaignReadData(snoozedTill) {
      if (snoozedTill) {
        this.campaignsSnoozedTill = Number(snoozedTill);
      }
    },

    // ════════════════════════════════════════════════════════════════════════
    // CUSTOM: Auto-resolve + Voice features
    // ════════════════════════════════════════════════════════════════════════
    startConversationStatusCheck() {
      this.checkAndClearResolvedConversation();
      this.conversationStatusCheckInterval = setInterval(() => {
        if (this.conversationSize > 0) {
          this.checkAndClearResolvedConversation();
          this.syncLatestMessages();
        }
      }, 3000);
    },

    startReplyPolling() {
      this.stopReplyPolling();
      this.replyPollInterval = setInterval(() => {
        this.syncLatestMessages();
      }, 3000);
      this.replyPollTimeout = setTimeout(() => {
        this.stopReplyPolling();
      }, 60000);
    },

    stopReplyPolling() {
      if (this.replyPollInterval) {
        clearInterval(this.replyPollInterval);
        this.replyPollInterval = null;
      }
      if (this.replyPollTimeout) {
        clearTimeout(this.replyPollTimeout);
        this.replyPollTimeout = null;
      }
    },

    async checkAndClearResolvedConversation() {
      if (this.conversationSize === 0) return;
      try {
        const { data } = await getConversationAPI();
        const payload = data?.payload ?? data;
        const conversations = Array.isArray(payload)
          ? payload
          : (payload ? [payload] : []);
        const hasActiveConversation = conversations.some(
          c => c?.status === 'open' || c?.status === 'pending'
        );
        if (hasActiveConversation) return;
        if (conversations.length > 0) {
          this.softResetAndClose();
        }
      } catch (error) {
        if (error?.response?.status === 404) {
          this.softResetAndClose();
        }
      }
    },

    softResetAndClose() {
      if (this.isVoiceActive || this.isVoiceConnecting) return;
      this.$store.dispatch('contacts/softExitChat');
      try { this.router.replace({ name: 'home' }); } catch (_) {}
      if (IFrameHelper.isIFrame()) {
        IFrameHelper.sendMessage({ event: 'closeWindow' });
      }
      setTimeout(() => {
        window.location.reload();
      }, 400);
    },
  },
};
</script>

<template>
  <div
    class="flex flex-col justify-end h-full"
    :class="{
      'is-mobile': isMobile,
      'is-widget-right': isRightAligned,
      'is-bubble-hidden': hideMessageBubble,
      'is-flat-design': isWidgetStyleFlat,
      dark: prefersDarkMode,
    }"
  >
    <router-view />
  </div>
</template>

<style lang="scss">
@import 'widget/assets/scss/woot.scss';
</style>
