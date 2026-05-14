// Vuex module for Voice Agent configuration
// Manages voice agent settings fetched from inbox configuration

import { getInboxConfigAPI } from 'widget/api/inboxConfig';

const state = {
  voiceAgentEnabled: false,
  voiceAgentProvider: 'elevenlabs',
  voiceAgentApiKey: '',
  voiceAgentConfigData: {},
  isLoading: false,
  error: null,
};

const getters = {
  isVoiceAgentEnabled: state => state.voiceAgentEnabled,
  getVoiceAgentProvider: state => state.voiceAgentProvider,
  getVoiceAgentApiKey: state => state.voiceAgentApiKey,
  getVoiceAgentConfig: state => state.voiceAgentConfigData,
  getAgentId: state => {
    // Try to get agent ID from config data first
    if (state.voiceAgentConfigData && state.voiceAgentConfigData.agent_id) {
      return state.voiceAgentConfigData.agent_id;
    }
    // Fallback to environment variable if configured
    if (typeof window !== 'undefined' && window.chatwootConfig) {
      return window.chatwootConfig.elevenLabsAgentId || null;
    }
    return null;
  },
  getVoiceId: state => {
    if (state.voiceAgentConfigData && state.voiceAgentConfigData.voice_id) {
      return state.voiceAgentConfigData.voice_id;
    }
    if (typeof window !== 'undefined' && window.chatwootConfig) {
      return window.chatwootConfig.elevenLabsVoiceId || null;
    }
    return null;
  },
  getAgentName: state => {
    if (state.voiceAgentConfigData && state.voiceAgentConfigData.agent_name) {
      return state.voiceAgentConfigData.agent_name;
    }
    if (typeof window !== 'undefined' && window.chatwootConfig) {
      return window.chatwootConfig.elevenLabsAgentName || 'AI Assistant';
    }
    return 'AI Assistant';
  },
};

const actions = {
  // Fetch voice agent config from inbox API
  async fetchVoiceAgentConfig({ commit }) {
    state.isLoading = true;
    state.error = null;
    try {
      const { data } = await getInboxConfigAPI();
      
      // Extract voice agent settings from response
      if (data && data.payload && data.payload.inbox) {
        const inbox = data.payload.inbox;
        const flags = inbox.selected_feature_flags || [];
        
        commit('setVoiceAgentEnabled', flags.includes('voice_agent'));
        commit('setVoiceAgentProvider', inbox.voice_agent_provider || 'elevenlabs');
        commit('setVoiceAgentApiKey', inbox.voice_agent_api_key || '');
        commit('setVoiceAgentConfigData', inbox.voice_agent_config_data || {});
      }
    } catch (error) {
      console.error('[VOICE-AGENT] Error fetching config:', error);
      state.error = error.message;
    } finally {
      state.isLoading = false;
    }
  },

  // Update voice agent config (e.g., when settings change)
  updateVoiceAgentConfig({ commit }, { enabled, provider, apiKey, configData }) {
    commit('setVoiceAgentEnabled', enabled);
    commit('setVoiceAgentProvider', provider);
    commit('setVoiceAgentApiKey', apiKey);
    commit('setVoiceAgentConfigData', configData);
  },
};

const mutations = {
  setVoiceAgentEnabled(state, enabled) {
    state.voiceAgentEnabled = enabled;
  },
  setVoiceAgentProvider(state, provider) {
    state.voiceAgentProvider = provider;
  },
  setVoiceAgentApiKey(state, apiKey) {
    state.voiceAgentApiKey = apiKey;
  },
  setVoiceAgentConfigData(state, configData) {
    state.voiceAgentConfigData = configData;
  },
  setError(state, error) {
    state.error = error;
  },
};

export default {
  namespaced: true,
  state,
  getters,
  actions,
  mutations,
};
