// Vuex module for Voice Agent configuration
// Manages voice agent settings fetched from inbox configuration

import { getInboxConfigAPI } from 'widget/api/inboxConfig';

const state = {
  voiceAgentEnabled: false,
  voiceAgentProvider: 'elevenlabs',
  voiceAgentConfigData: {},
  elevenlabsAgentId: '',
  isLoading: false,
  error: null,
};

const getters = {
  isVoiceAgentEnabled: state => state.voiceAgentEnabled,
  getVoiceAgentProvider: state => state.voiceAgentProvider,
  getVoiceAgentConfig: state => state.voiceAgentConfigData,
  getIsLoading: state => state.isLoading,
  getError: state => state.error,
  getAgentId: state => {
    if (state.voiceAgentConfigData && state.voiceAgentConfigData.agent_id) {
      return state.voiceAgentConfigData.agent_id;
    }
    if (state.elevenlabsAgentId) {
      return state.elevenlabsAgentId;
    }
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
    commit('setLoading', true);
    commit('setError', null);
    try {
      const { data } = await getInboxConfigAPI();

      // Extract voice agent settings from response
      if (data && data.payload && data.payload.inbox) {
        const inbox = data.payload.inbox;
        const flags = inbox.selected_feature_flags || [];

        // Dashboard saves 'elevenlabs_voice' (bit 5 in web_widget.rb).
        // Accept legacy 'voice_agent' too for backwards-compat.
        commit(
          'setVoiceAgentEnabled',
          flags.includes('elevenlabs_voice') || flags.includes('voice_agent')
        );
        commit('setVoiceAgentProvider', inbox.voice_agent_provider || 'elevenlabs');
        commit('setVoiceAgentConfigData', inbox.voice_agent_config_data || {});
        commit('setElevenlabsAgentId', inbox.elevenlabs_agent_id || '');
      }
    } catch (error) {
      console.error('[VOICE-AGENT] Error fetching config:', error);
      commit('setError', error.message);
    } finally {
      commit('setLoading', false);
    }
  },

  // Update voice agent config (e.g., when settings change)
  updateVoiceAgentConfig({ commit }, { enabled, provider, configData }) {
    commit('setVoiceAgentEnabled', enabled);
    commit('setVoiceAgentProvider', provider);
    commit('setVoiceAgentConfigData', configData);
  },
};

const mutations = {
  setLoading(state, value) {
    state.isLoading = value;
  },
  setVoiceAgentEnabled(state, enabled) {
    state.voiceAgentEnabled = enabled;
  },
  setVoiceAgentProvider(state, provider) {
    state.voiceAgentProvider = provider;
  },
  setVoiceAgentConfigData(state, configData) {
    state.voiceAgentConfigData = configData;
  },
  setElevenlabsAgentId(state, agentId) {
    state.elevenlabsAgentId = agentId;
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