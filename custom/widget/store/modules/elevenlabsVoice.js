/**
 * Vuex module: elevenlabsVoice
 *
 * Tracks UI-level voice call state (active, connecting, muted, duration,
 * transcript). The actual WebSocket is managed by the SharedWorker; this
 * module only holds reactive state for the Vue components to display.
 */

const state = {
  isActive:         false,
  isConnecting:     false,
  isMuted:          false,
  callDuration:     0,       // seconds elapsed since call started
  agentName:        'ElevenLabs AI Assistant',
  transcript:       [],
  durationInterval: null,
  error:            null,
  conversationId:   null,
};

const getters = {
  getIsActive:        $s => $s.isActive,
  getIsConnecting:    $s => $s.isConnecting,
  getIsMuted:         $s => $s.isMuted,
  getCallDuration:    $s => $s.callDuration,
  getAgentName:       $s => $s.agentName,
  getTranscript:      $s => $s.transcript,
  getError:           $s => $s.error,
  getConversationId:  $s => $s.conversationId,
};

const mutations = {
  SET_ACTIVE($s, value)           { $s.isActive      = value; },
  SET_CONNECTING($s, value)       { $s.isConnecting  = value; },
  SET_MUTED($s, value)            { $s.isMuted       = value; },
  SET_CALL_DURATION($s, value)    { $s.callDuration  = value; },
  INCREMENT_DURATION($s)          { $s.callDuration += 1;     },
  SET_AGENT_NAME($s, value)       { $s.agentName     = value; },
  SET_ERROR($s, error)            { $s.error         = error; },
  SET_CONVERSATION_ID($s, id)     { $s.conversationId = id;   },

  SET_DURATION_INTERVAL($s, interval) {
    $s.durationInterval = interval;
  },

  ADD_TRANSCRIPT($s, { role, text }) {
    $s.transcript.push({ role, text, timestamp: Date.now() });
  },

  CLEAR_TRANSCRIPT($s) {
    $s.transcript = [];
  },

  RESET_STATE($s) {
    if ($s.durationInterval) {
      clearInterval($s.durationInterval);
      $s.durationInterval = null;
    }
    $s.isActive        = false;
    $s.isConnecting    = false;
    $s.isMuted         = false;
    $s.callDuration    = 0;
    $s.transcript      = [];
    $s.error           = null;
    $s.conversationId  = null;
  },
};

const actions = {
  // Called by ElevenLabsVoiceButton when worker broadcasts CALL_STATE
  setActive({ commit }, value) {
    commit('SET_ACTIVE', value);
    if (value) {
      // Start duration timer when call goes active
      const interval = setInterval(() => {
        commit('INCREMENT_DURATION');
      }, 1000);
      commit('SET_DURATION_INTERVAL', interval);
    } else {
      // Stop timer when call ends
      commit('RESET_STATE');
    }
  },

  setConnecting({ commit }, value) {
    commit('SET_CONNECTING', value);
  },

  setError({ commit }, error) {
    commit('SET_ERROR', error);
  },

  addTranscript({ commit }, { role, text }) {
    commit('ADD_TRANSCRIPT', { role, text });
  },

  toggleMute({ commit, state: $s }) {
    commit('SET_MUTED', !$s.isMuted);
  },

  // Full reset — call this on explicit endCall or error
  endCall({ commit }) {
    commit('RESET_STATE');
  },
};

export default {
  namespaced: true,
  state,
  getters,
  mutations,
  actions,
};