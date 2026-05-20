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
    isRTL: {
      immediate: true,
      handler(value) {
        document.documentElement.dir = value ? 'rtl' : 'ltr';
      },
    },
    messageCount(newVal, oldVal) {
      // When user sends a message, start a 30s polling window to catch bot reply.
      // This is a targeted fallback for environments where ActionCable (WebSocket)
      // is unreliable (e.g. ngrok). Stops automatically after 30s.
      if (newVal > oldVal && this.conversationSize > 0) {
        this.startReplyPolling();
      }
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
      // Non-iframe mode: always start from home (no session resume)
      this.clearConversations();
      this.fetchAvailableAgents(websiteToken);
      this.setLocale(getLocale(window.location.search));
    }

    if (this.isRNWebView) {
      this.registerListeners();
      this.sendRNWebViewLoadedEvent();
    }

    this.registerCampaignEvents();

    // ── VOICE AGENT CONFIG: Fetch voice agent settings from inbox config ──
    // This loads provider, API key, and agent ID from admin configuration
    this.fetchVoiceAgentConfig();

    // ── AUTO-CLEAR: Check if conversation was resolved from dashboard ──
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
    ...mapActions('campaign', [
      'initCampaigns',
      'executeCampaign',
      'resetCampaign',
    ]),
    ...mapActions('agent', ['fetchAvailableAgents']),
    ...mapActions('contacts', ['clearCurrentUser']),
    ...mapActions('voiceAgentConfig', ['fetchVoiceAgentConfig']),

    setWidgetColorVariable(widgetColor) {
      if (widgetColor) {
        document.documentElement.style.setProperty(
          '--widget-color',
          widgetColor
        );
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

    registerCampaignEvents() {
      emitter.on(ON_CAMPAIGN_MESSAGE_CLICK, () => {
        if (this.shouldShowPreChatForm) {
          this.router.replace({ name: 'prechat-form' });
        } else {
          this.router.replace({ name: 'messages' });
          emitter.emit('execute-campaign', {
            campaignId: this.activeCampaign.id,
          });
        }
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

    handleUnreadNotificationDot() {
      if (this.isIFrame) {
        IFrameHelper.sendMessage({
          event: 'handleNotificationDot',
          unreadMessageCount: 0,
        });
      }
    },

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
        if (!IFrameHelper.isAValidEvent(e)) {
          return;
        }
        const message = IFrameHelper.getMessage(e);

        if (message.event === 'config-set') {
          this.setLocale(message.locale);
          this.setBubbleLabel();
          this.setAppConfig(message);
          this.configReady = true;

          // ── REHYDRATE EXISTING SESSION ──────────────────────────────────
          // On every iframe load (initial open, refresh, page change) we
          // pull the existing conversation + attributes from the server so
          // the widget continues the same conversation instead of starting
          // a new one. Exit Chat is the ONLY path that wipes session data
          // (handled by contacts/clearCurrentUser → reload), so the storage
          // keys here are guaranteed to point at a real, unresolved chat.
          // ────────────────────────────────────────────────────────────────
          this.fetchOldConversations();
          this.getAttributes();

          this.fetchAvailableAgents(websiteToken);
          this.setCampaignReadData(message.campaignsSnoozedTill);

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
          this.$store.dispatch(
            'contacts/setCustomAttributes',
            message.customAttributes
          );

        } else if (message.event === 'delete-custom-attribute') {
          this.$store.dispatch(
            'contacts/deleteCustomAttribute',
            message.customAttribute
          );

        } else if (message.event === 'set-conversation-custom-attributes') {
          this.$store.dispatch(
            'conversation/setCustomAttributes',
            message.customAttributes
          );

        } else if (message.event === 'delete-conversation-custom-attribute') {
          this.$store.dispatch(
            'conversation/deleteCustomAttribute',
            message.customAttribute
          );

        } else if (message.event === 'set-locale') {
          this.setLocale(message.locale);
          this.setBubbleLabel();

        } else if (message.event === 'set-color-scheme') {
          this.setColorScheme(message.darkMode);

        } else if (message.event === 'toggle-open') {
          this.$store.dispatch('appConfig/toggleWidgetOpen', message.isOpen);

          if (!message.isOpen) {
            this.resetCampaign();
          } else {
            // When widget opens: re-pull inbox/voice config so admin toggle
            // changes take effect without a full page reload, then verify the
            // conversation hasn't been resolved externally.
            this.fetchVoiceAgentConfig();
            this.checkAndClearResolvedConversation();
          }

        } else if (message.event === SDK_SET_BUBBLE_VISIBILITY) {
          this.setBubbleVisibility(message.hideMessageBubble);
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

    startConversationStatusCheck() {
      this.checkAndClearResolvedConversation();
      this.conversationStatusCheckInterval = setInterval(() => {
        if (this.isWidgetOpen && this.conversationSize > 0) {
          this.checkAndClearResolvedConversation();
          // Steady fallback sync: catches any messages ActionCable missed
          this.syncLatestMessages();
        }
      }, 30000);
    },

    startReplyPolling() {
      this.stopReplyPolling();
      this.replyPollInterval = setInterval(() => {
        this.syncLatestMessages();
      }, 3000);
      // Stop burst poll after 60s; steady 30s poll above keeps syncing after that
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
      // Nothing to reset if there isn't an active conversation in this widget.
      if (this.conversationSize === 0) return;

      try {
        const { data } = await getConversationAPI();
        const conversationStatus = data?.payload?.status || data?.status;

        if (conversationStatus !== 'resolved') return;

        // Same behaviour as the Exit Chat button: soft-reset Vuex + storage,
        // go back to home, and collapse the iframe panel. The next time the
        // visitor opens the bubble they land on the prechat form with no
        // residue from the resolved chat. NO window.location.reload().
        this.$store.dispatch('contacts/softExitChat');
        try { this.router.replace({ name: 'home' }); } catch (_) {}
        if (IFrameHelper.isIFrame()) {
          IFrameHelper.sendMessage({ event: 'closeWindow' });
        }
      } catch (error) {
        // 404 = conversation deleted/resolved externally — same handling.
        if (error?.response?.status === 404) {
          this.$store.dispatch('contacts/softExitChat');
          try { this.router.replace({ name: 'home' }); } catch (_) {}
          if (IFrameHelper.isIFrame()) {
            IFrameHelper.sendMessage({ event: 'closeWindow' });
          }
        }
      }
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