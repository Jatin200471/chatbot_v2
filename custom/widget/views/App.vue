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
      conversationEnded: 'appConfig/getConversationEnded',
      currentUser: 'contacts/getCurrentUser',
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
        const msg = { event: 'voice-call-active', isActive: !!val, autoOpen };

        // 1. localStorage bridge — most reliable, works even if postMessage
        //    is blocked by SDK iframe nesting or CSP restrictions.
        try { localStorage.setItem('cw_voice_active', val ? '1' : '0'); } catch (_) {}

        // 2. window.top — bypasses intermediate SDK iframe if any
        try { window.top.postMessage(msg, '*'); } catch (_) {}

        // 3. window.parent — direct parent (same as window.top when no nesting)
        try { window.parent.postMessage(msg, '*'); } catch (_) {}

        // 4. IFrameHelper — sends as "chatwoot-widget:{...}" string (SDK channel)
        IFrameHelper.sendMessage(msg);
      } catch (_) {}
    },
  },
  mounted() {
    const { websiteToken, locale, widgetColor, customBrandingText, customBrandingUrl, customBubbleIconUrl, customBubbleIconSize } = window.chatwootWebChannel;
    this.setLocale(locale);
    this.setWidgetColor(widgetColor);
    this.setWidgetColorVariable(widgetColor);
    this.setBrandingConfig({ customBrandingText: customBrandingText || '', customBrandingUrl: customBrandingUrl || '' });
    this.applyChannelMessages();
    this.injectCustomAppearance();

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

    // Clear stale cw_voice_active flag on fresh widget load.
    // If the page was reloaded during a voice call, the iframe is destroyed
    // and the call is dead — reset the flag so the floating button hides
    // and SPA navigation intercept is disabled for the new (silent) session.
    // The ElevenLabsVoiceButton will set it back to '1' when a new call starts.
    try { localStorage.setItem('cw_voice_active', '0'); } catch (_) {}

    // Pre-load saved user data (name/email/phone) from localStorage so the
    // pre-chat form is pre-filled after exit-chat reload or auto-resolve restart.
    this.loadSavedUserData();
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
      'setConversationEnded',
      'setBrandingConfig',
    ]),
    ...mapActions('conversation', ['fetchOldConversations', 'clearConversations', 'syncLatestMessages']),
    ...mapActions('conversationAttributes', ['getAttributes']),
    ...mapActions('campaign', ['initCampaigns', 'executeCampaign', 'resetCampaign']),
    ...mapActions('agent', ['fetchAvailableAgents']),
    ...mapActions('contacts', ['clearCurrentUser', 'loadSavedUserData']),
    ...mapActions('voiceAgentConfig', ['fetchVoiceAgentConfig']),

    applyChannelMessages() {
      const ch = window.chatwootWebChannel || {};
      if (ch.availableMessage || ch.unavailableMessage || ch.replyTimeText) {
        this.$store.commit('appConfig/SET_WIDGET_APP_CONFIG', {
          ...this.$store.state.appConfig,
          availableMessage: ch.availableMessage || '',
          unavailableMessage: ch.unavailableMessage || '',
          replyTimeText: ch.replyTimeText || '',
        });
      }
    },

    injectCustomAppearance() {
      const ch = window.chatwootWebChannel || {};
      const rules = [];

      // Hex → relative luminance (0 = black, 1 = white)
      const hexToLuminance = (hex) => {
        let c = hex.replace('#', '');
        if (c.length === 3) c = c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
        const r = parseInt(c.slice(0,2),16)/255;
        const g = parseInt(c.slice(2,4),16)/255;
        const b = parseInt(c.slice(4,6),16)/255;
        const toLinear = v => v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4);
        return 0.2126*toLinear(r) + 0.7152*toLinear(g) + 0.0722*toLinear(b);
      };

      // Extract first hex from any color string (solid or gradient)
      const extractHex = (val) => {
        if (!val) return null;
        const m = val.match(/#[a-fA-F0-9]{3,8}/);
        return m ? m[0] : null;
      };

      // Extract solid color from widget_color (gradient → first hex)
      const widgetColorRaw = ch.widgetColor || '#1f93ff';
      const solidWidgetColor = (() => {
        if (!widgetColorRaw.includes('gradient')) return widgetColorRaw;
        const m = widgetColorRaw.match(/#[a-fA-F0-9]{3,8}/);
        return m ? m[0] : '#1f93ff';
      })();

      // Override Chatwoot's --color-n-brand so focus rings use widget color
      rules.push(`:root{--color-n-brand:${solidWidgetColor}!important}`);

      // Widget body background (solid or gradient)
      if (ch.widgetBgColor) {
        const bg = ch.widgetBgColor.trim();
        rules.push(
          `.bg-n-slate-2{background:${bg}!important}` +
          `.dark .bg-n-solid-1{background:${bg}!important}`
        );

        // Auto-contrast: adjust date separator & agent name based on bg luminance
        const bgHex = extractHex(bg);
        if (bgHex) {
          const lum = hexToLuminance(bgHex);
          const isDark = lum < 0.4;
          const textColor = isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.5)';
          const lineColor = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)';
          const strongText = isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.7)';

          // Date separator text ("Today", "Yesterday") — DateSeparator uses text-n-slate-11
          rules.push(`.conversation-wrap .messages-wrap > .text-n-slate-11{color:${textColor}!important}`);
          // Date separator lines (::before / ::after pseudo-elements use bg-n-slate-4)
          rules.push(
            `.conversation-wrap .messages-wrap > .text-n-slate-11::before,` +
            `.conversation-wrap .messages-wrap > .text-n-slate-11::after` +
            `{background-color:${lineColor}!important}`
          );

          // Agent name label below chat bubbles
          rules.push(`.agent-name{color:${textColor}!important}`);
        }
      }

      // Input focus — override box-shadow (Chatwoot uses shadow-n-brand on focus)
      const focusColor = ch.inputFocusColor || solidWidgetColor;
      rules.push(
        `[class*="rounded-[7px]"]:focus-within,` +
        `.woot-chat-input:focus-within` +
        `{box-shadow:0 0 0 1px ${focusColor},0 0 2px 3px ${focusColor}33!important}`
      );

      // Google Font — load via <link>
      if (ch.widgetFontFamily) {
        const fname = ch.widgetFontFamily.trim();
        if (fname) {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fname).replace(/%20/g,'+')}:wght@400;500;600&display=swap`;
          document.head.appendChild(link);
          rules.push(`body,*{font-family:'${fname}',sans-serif!important}`);
        }
      }

      // Message font size (same for bot + user)
      if (ch.messageFontSize) {
        rules.push(`.chat-bubble,.chat-bubble *{font-size:${ch.messageFontSize}px!important}`);
      }

      // Welcome heading / tagline  (structural selectors — reliable across Chatwoot versions)
      if (ch.welcomeHeadingColor || ch.welcomeHeadingSize) {
        const c = ch.welcomeHeadingColor ? `color:${ch.welcomeHeadingColor}!important;` : '';
        const s = ch.welcomeHeadingSize ? `font-size:${ch.welcomeHeadingSize}px!important;` : '';
        rules.push(`#app h2{${c}${s}}`);
      }
      if (ch.welcomeTaglineColor || ch.welcomeTaglineSize) {
        const c = ch.welcomeTaglineColor ? `color:${ch.welcomeTaglineColor}!important;` : '';
        const s = ch.welcomeTaglineSize ? `font-size:${ch.welcomeTaglineSize}px!important;` : '';
        // tagline is typically the first <p> after the h2 in the home view
        rules.push(`#app h2+p,#app h2~p:first-of-type{${c}${s}}`);
      }

      // Start/Continue Conversation button — gradient support
      // CSS `color` does not support gradients; use background-clip:text on the span only.
      // The button itself gets the solid extracted color (for chevron icon + fallback).
      if (widgetColorRaw.includes('gradient')) {
        // Button & icon: use solid extracted color
        rules.push(`.cw-start-conv-btn{color:${solidWidgetColor}!important}`);
        // Span (text only): gradient-text technique
        rules.push(
          `.cw-start-conv-btn span{` +
          `background:${widgetColorRaw}!important;` +
          `-webkit-background-clip:text!important;` +
          `-webkit-text-fill-color:transparent!important;` +
          `background-clip:text!important` +
          `}`
        );
      }

      // CTA button — targets FormKit submit + all buttons in the widget home
      if (ch.ctaBgColor || ch.ctaTextColor) {
        const bg = ch.ctaBgColor ? `background:${ch.ctaBgColor}!important;` : '';
        const tc = ch.ctaTextColor ? `color:${ch.ctaTextColor}!important;` : '';
        // .formkit-form button = pre-chat form submit button
        // button[data-type="submit"] = FormKit rendered button
        // .button.success = Chatwoot Foundation button
        rules.push(
          `.formkit-form button,button[data-type="submit"],.button.success,` +
          `.start-conversation-button button,.woot-widget-wrap .button` +
          `{${bg}${tc}}`
        );
      }

      // Bot/Agent bubble colors
      if (ch.botBubbleBgColor) {
        rules.push(`.chat-bubble.agent{background:${ch.botBubbleBgColor}!important}`);
      }
      if (ch.botBubbleTextColor) {
        rules.push(
          `.chat-bubble.agent,.chat-bubble.agent .message-content,.chat-bubble.agent *{color:${ch.botBubbleTextColor}!important}`
        );
      }

      // User bubble colors
      if (ch.userBubbleBgColor) {
        rules.push(`.chat-bubble.user{background:${ch.userBubbleBgColor}!important}`);
      }
      if (ch.userBubbleTextColor) {
        rules.push(
          `.chat-bubble.user,.chat-bubble.user .message-content,.chat-bubble.user *{color:${ch.userBubbleTextColor}!important}`
        );
      }

      // Header background & text color — uses widgetColor by default but
      // widgetBgColor can also affect the header area via bg-n-background
      if (ch.headerBgColor) {
        rules.push(`header.bg-n-background,.expanded .bg-n-background{background:${ch.headerBgColor}!important}`);
      }
      if (ch.headerTextColor) {
        rules.push(
          `header .text-n-slate-12,header .text-n-slate-11{color:${ch.headerTextColor}!important}`
        );
      }

      // Online status & reply time text colors
      if (ch.onlineStatusColor) {
        rules.push(`.availability-status .text-n-slate-11{color:${ch.onlineStatusColor}!important}`);
      }
      if (ch.replyTimeColor) {
        rules.push(`.reply-time .text-n-slate-11,.reply-time{color:${ch.replyTimeColor}!important}`);
      }

      // Notification popup: transparent card chrome but give it an explicit
      // white content background so widgetBgColor doesn't bleed through.
      rules.push(
        `.unread-notification-wrap{background:transparent!important;box-shadow:none!important;border:none!important}` +
        `.unread-notification-wrap .notification-message{background:#fff!important;box-shadow:0 1px 4px rgba(0,0,0,.12)!important;border-radius:8px!important}` +
        `.unread-notification{background:transparent!important;box-shadow:none!important;border:none!important}`
      );

      if (rules.length) {
        const style = document.createElement('style');
        style.id = 'cw-custom-appearance';
        style.textContent = rules.join('\n');
        document.head.appendChild(style);
      }
    },

    setWidgetColorVariable(widgetColor) {
      if (!widgetColor) return;
      const isGradient = widgetColor.startsWith('linear-gradient') || widgetColor.startsWith('radial-gradient');
      if (isGradient) {
        // Extract first hex color for CSS properties that need a solid color (text, borders)
        const match = widgetColor.match(/#[a-fA-F0-9]{3,8}/);
        const solidColor = match ? match[0] : '#1f93ff';
        document.documentElement.style.setProperty('--widget-color', solidColor);
        document.documentElement.style.setProperty('--widget-gradient', widgetColor);
      } else {
        document.documentElement.style.setProperty('--widget-color', widgetColor);
        document.documentElement.style.setProperty('--widget-gradient', widgetColor);
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
      emitter.on('execute-campaign', async campaignDetails => {
        const { customAttributes, campaignId } = campaignDetails;
        const { websiteToken } = window.chatwootWebChannel;
        await this.executeCampaign({ campaignId, websiteToken, customAttributes });
        this.router.replace({ name: 'messages' });
        // Backend creates the campaign conversation asynchronously.
        // Without ActionCable we must poll until messages appear.
        const pollForCampaignConversation = (attempts = 0) => {
          if (attempts >= 5) return;
          setTimeout(async () => {
            await this.fetchOldConversations();
            if (this.conversationSize === 0) {
              pollForCampaignConversation(attempts + 1);
            }
          }, 1500);
        };
        pollForCampaignConversation();
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
      const { unreadMessageCount } = this;
      if (this.isIFrame) {
        IFrameHelper.sendMessage({
          event: 'handleNotificationDot',
          unreadMessageCount,
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
          this.applyChannelMessages();
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
        if (this.conversationSize > 0 && !this.conversationEnded) {
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
      if (this.conversationEnded) return; // already handled — stop polling
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
          this.handleResolvedConversation();
        }
      } catch (error) {
        if (error?.response?.status === 404) {
          this.hardResetAndClose();
        }
      }
    },

    // Called when the backend marks the conversation as resolved.
    // Keeps all messages visible so the user can read the conversation history,
    // then replaces the chat input with a "Start New Chat" restart button.
    handleResolvedConversation() {
      if (this.isVoiceActive || this.isVoiceConnecting) return;
      if (this.conversationEnded) return;

      // Persist current user data so the pre-chat form can be pre-filled on restart.
      try {
        const user = this.currentUser;
        if (user?.name || user?.email || user?.phone_number) {
          localStorage.setItem('chatwoot_user_data', JSON.stringify({
            name: user.name || '',
            email: user.email || '',
            phone_number: user.phone_number || '',
          }));
        }
      } catch (_) {}

      this.setConversationEnded(true);
      // Ensure the user can see the last messages before restarting.
      try { this.router.replace({ name: 'messages' }); } catch (_) {}
    },

    // Hard reset — only for cases where the conversation no longer exists (404).
    hardResetAndClose() {
      if (this.isVoiceActive || this.isVoiceConnecting) return;
      this.$store.dispatch('contacts/softExitChat');
      try { this.router.replace({ name: 'home' }); } catch (_) {}
      if (IFrameHelper.isIFrame()) {
        IFrameHelper.sendMessage({ event: 'exitChat' });
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
