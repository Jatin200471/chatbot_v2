import {
  SET_BUBBLE_VISIBILITY,
  SET_COLOR_SCHEME,
  SET_REFERRER_HOST,
  SET_WIDGET_APP_CONFIG,
  SET_WIDGET_COLOR,
  TOGGLE_WIDGET_OPEN,
  SET_ROUTE_UPDATE_STATE,
} from '../types';

const state = {
  hideMessageBubble: false,
  isCampaignViewClicked: false,
  showUnreadMessagesDialog: true,
  isWebWidgetTriggered: false,
  isWidgetOpen: false,
  position: 'right',
  referrerHost: '',
  showPopoutButton: false,
  widgetColor: '',
  widgetStyle: 'standard',
  darkMode: 'light',
  isUpdatingRoute: false,
  welcomeTitle: '',
  welcomeDescription: '',
  availableMessage: '',
  unavailableMessage: '',
  replyTimeText: '',
  enableFileUpload: true,
  enableEmojiPicker: true,
  enableEndConversation: true,
  // ElevenLabs Voice Agent settings
  // agentId intentionally NOT stored here — server-side only.
  enableElevenLabs: true,
  elevenLabsConfig: {
    voiceId: import.meta.env.VITE_ELEVENLABS_VOICE_ID || '',
    agentName: import.meta.env.VITE_ELEVENLABS_AGENT_NAME || 'AI Assistant',
  },
  // Set to true when the active conversation is resolved/ended.
  // ChatInputWrap replaces the text input with a restart button.
  conversationEnded: false,
  customBrandingText: '',
  customBrandingUrl: '',
};

export const getters = {
  getAppConfig: $state => $state,
  isRightAligned: $state => $state.position === 'right',
  getHideMessageBubble: $state => $state.hideMessageBubble,
  getIsWidgetOpen: $state => $state.isWidgetOpen,
  getWidgetColor: $state => $state.widgetColor,
  getReferrerHost: $state => $state.referrerHost,
  isWidgetStyleFlat: $state => $state.widgetStyle === 'flat',
  darkMode: $state => $state.darkMode,
  getShowUnreadMessagesDialog: $state => $state.showUnreadMessagesDialog,
  getIsUpdatingRoute: _state => _state.isUpdatingRoute,
  getWelcomeHeading: $state => $state.welcomeTitle,
  getWelcomeTagline: $state => $state.welcomeDescription,
  getAvailableMessage: $state => $state.availableMessage,
  getUnavailableMessage: $state => $state.unavailableMessage,
  getReplyTimeText: $state => $state.replyTimeText,
  getShouldShowFilePicker: $state => $state.enableFileUpload,
  getShouldShowEmojiPicker: $state => $state.enableEmojiPicker,
  getCanUserEndConversation: $state => $state.enableEndConversation,
  // ElevenLabs getters — agentId check removed (server-side only now)
  getElevenLabsEnabled: $state => $state.enableElevenLabs,
  getElevenLabsConfig: $state => $state.elevenLabsConfig,
  getConversationEnded: $state => $state.conversationEnded,
  getCustomBrandingText: $state => $state.customBrandingText,
  getCustomBrandingUrl: $state => $state.customBrandingUrl,
};

export const actions = {
  setAppConfig(
    { commit },
    {
      showPopoutButton,
      position,
      hideMessageBubble,
      showUnreadMessagesDialog,
      widgetStyle = 'rounded',
      darkMode = 'light',
      welcomeTitle = '',
      welcomeDescription = '',
      availableMessage = '',
      unavailableMessage = '',
      enableFileUpload = true,
      enableEmojiPicker = true,
      enableEndConversation = true,
      enableElevenLabsVoice = true,
      // elevenLabsAgentId intentionally removed — server-side only now.
    }
  ) {
    commit(SET_WIDGET_APP_CONFIG, {
      hideMessageBubble: !!hideMessageBubble,
      position: position || 'right',
      showPopoutButton: !!showPopoutButton,
      showUnreadMessagesDialog: showUnreadMessagesDialog !== false,
      widgetStyle,
      darkMode,
      welcomeTitle,
      welcomeDescription,
      availableMessage,
      unavailableMessage,
      enableFileUpload,
      enableEmojiPicker,
      enableEndConversation,
      enableElevenLabsVoice,
    });
  },
  toggleWidgetOpen({ commit }, isWidgetOpen) {
    commit(TOGGLE_WIDGET_OPEN, isWidgetOpen);
  },
  setWidgetColor({ commit }, widgetColor) {
    commit(SET_WIDGET_COLOR, widgetColor);
  },
  setColorScheme({ commit }, darkMode) {
    commit(SET_COLOR_SCHEME, darkMode);
  },
  setReferrerHost({ commit }, referrerHost) {
    commit(SET_REFERRER_HOST, referrerHost);
  },
  setBubbleVisibility({ commit }, hideMessageBubble) {
    commit(SET_BUBBLE_VISIBILITY, hideMessageBubble);
  },
  setRouteTransitionState: async ({ commit }, status) => {
    commit(SET_ROUTE_UPDATE_STATE, status);
  },
  setConversationEnded({ commit }, value) {
    commit('SET_CONVERSATION_ENDED', !!value);
  },
  setBrandingConfig({ commit }, { customBrandingText, customBrandingUrl }) {
    commit('SET_BRANDING_CONFIG', { customBrandingText, customBrandingUrl });
  },
};

export const mutations = {
  [SET_WIDGET_APP_CONFIG]($state, data) {
    $state.showPopoutButton = data.showPopoutButton;
    $state.position = data.position;
    $state.hideMessageBubble = data.hideMessageBubble;
    $state.widgetStyle = data.widgetStyle;
    $state.darkMode = data.darkMode;
    $state.locale = data.locale || $state.locale;
    $state.showUnreadMessagesDialog = data.showUnreadMessagesDialog;
    $state.welcomeTitle = data.welcomeTitle;
    $state.welcomeDescription = data.welcomeDescription;
    $state.availableMessage = data.availableMessage;
    $state.unavailableMessage = data.unavailableMessage;
    if (data.replyTimeText !== undefined) {
      $state.replyTimeText = data.replyTimeText;
    }
    $state.enableFileUpload = data.enableFileUpload;
    $state.enableEmojiPicker = data.enableEmojiPicker;
    $state.enableEndConversation = data.enableEndConversation;

    if (data.enableElevenLabsVoice !== undefined) {
      $state.enableElevenLabs = data.enableElevenLabsVoice;
    }
    // elevenLabsAgentId removed — agent ID is server-side only now.
  },
  [TOGGLE_WIDGET_OPEN]($state, isWidgetOpen) {
    $state.isWidgetOpen = isWidgetOpen;
  },
  [SET_WIDGET_COLOR]($state, widgetColor) {
    $state.widgetColor = widgetColor;
  },
  [SET_REFERRER_HOST]($state, referrerHost) {
    $state.referrerHost = referrerHost;
  },
  [SET_BUBBLE_VISIBILITY]($state, hideMessageBubble) {
    $state.hideMessageBubble = hideMessageBubble;
  },
  [SET_COLOR_SCHEME]($state, darkMode) {
    $state.darkMode = darkMode;
  },
  [SET_ROUTE_UPDATE_STATE]($state, status) {
    $state.isUpdatingRoute = status;
  },
  SET_CONVERSATION_ENDED($state, value) {
    $state.conversationEnded = value;
  },
  SET_BRANDING_CONFIG($state, { customBrandingText, customBrandingUrl }) {
    $state.customBrandingText = customBrandingText || '';
    $state.customBrandingUrl = customBrandingUrl || '';
  },
};

export default {
  namespaced: true,
  state,
  getters,
  actions,
  mutations,
};
