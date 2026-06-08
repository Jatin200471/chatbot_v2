<script>
import { mapGetters, mapActions } from 'vuex';
import configMixin from '../mixins/configMixin';
import { API, WEBSITE_TOKEN } from 'widget/helpers/axios';
import { emitter } from 'shared/helpers/mitt';

// ─────────────────────────────────────────────────────────────────────────────
// URL helper — appends website_token to API requests made from this component
// ─────────────────────────────────────────────────────────────────────────────
const buildConvUrl = path => {
  if (!WEBSITE_TOKEN) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}website_token=${WEBSITE_TOKEN}`;
};

// ─── Debug logger ─────────────────────────────────────────────────────────────
// Enable:  localStorage.setItem('cw_voice_debug', 'true')
const vLog = (...args) => {
  try {
    if (localStorage.getItem('cw_voice_debug') === 'true') console.log('[VOICE]', ...args);
  } catch (_) {}
};

// ─────────────────────────────────────────────────────────────────────────────
// SESSION PERSISTENCE
// Real WebRTC streams cannot survive a hard page reload. To make the call
// "continue" across page changes, sdk-floating-btn.js intercepts <a> clicks
// when a call is active and does SPA-style navigation so the iframe is never
// destroyed. For true hard refresh (F5), we save the signed URL here and the
// next page load auto-reconnects to the same ElevenLabs session as long as
// the signed URL is still within its TTL.
// ─────────────────────────────────────────────────────────────────────────────
const SESSION_CALL_KEY = 'cw_voice_session_data';
const SESSION_TTL_MS   = 5 * 60 * 1000;

function saveCallToSession(signedUrl) {
  try {
    sessionStorage.setItem(SESSION_CALL_KEY, JSON.stringify({
      isActive: true,
      signedUrl,
      timestamp: Date.now(),
    }));
  } catch (_) {}
}

function getSessionCall() {
  try {
    const raw = sessionStorage.getItem(SESSION_CALL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.isActive || !parsed?.signedUrl) return null;
    if (Date.now() - parsed.timestamp > SESSION_TTL_MS) {
      sessionStorage.removeItem(SESSION_CALL_KEY);
      return null;
    }
    return parsed;
  } catch (_) {
    return null;
  }
}

function clearSessionCall() {
  try { sessionStorage.removeItem(SESSION_CALL_KEY); } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// SDK SINGLETON
// Module-level so the active conversation survives Vue component re-mounts
// (e.g., when the chat view re-renders inside the same iframe).
// ─────────────────────────────────────────────────────────────────────────────
let _conversation     = null;   // active Conversation instance
let _conversationCtor = null;   // cached SDK constructor
let _isConnecting     = false;  // race guard

// All mounted component instances that want broadcasts from the SDK.
const _listeners = new Set();

function _broadcast(type, payload) {
  for (const inst of _listeners) {
    try { inst._handleEvent(type, payload); } catch (e) { vLog('listener error:', e?.message); }
  }
}

async function _loadSdk() {
  if (_conversationCtor) return _conversationCtor;
  vLog('Loading ElevenLabs SDK…');
  const mod = await import('https://esm.sh/@11labs/client');
  _conversationCtor = mod.Conversation;
  vLog('SDK loaded ✓');
  return _conversationCtor;
}

async function _startConversation(signedUrl) {
  if (_conversation) {
    vLog('Conversation already active — syncing state');
    _broadcast('CALL_STATE', { isActive: true, isConnecting: false });
    return _conversation;
  }
  if (_isConnecting) {
    vLog('startConversation already in progress — ignoring duplicate');
    return null;
  }

  _isConnecting = true;
  _broadcast('CALL_STATE', { isActive: false, isConnecting: true });

  try {
    const Conversation = await _loadSdk();

    _conversation = await Conversation.startSession({
      signedUrl,

      onConnect: () => {
        vLog('Connected ✅');
        _isConnecting = false;
        _broadcast('CALL_STATE', { isActive: true, isConnecting: false });
      },

      onMessage: ({ message, source }) => {
        const text = (message || '').toString().trim();
        if (!text) return;
        vLog(`transcript [${source}]:`, text);
        _broadcast('TRANSCRIPT', { source, message: text });
      },

      onDisconnect: () => {
        vLog('Disconnected');
        _conversation = null;
        _isConnecting = false;
        _broadcast('CALL_STATE', { isActive: false, isConnecting: false });
        _broadcast('CALL_ENDED', {});
      },

      onError: (err) => {
        const msg = err?.message || String(err);
        console.error('[VOICE] Session error:', msg);
        _conversation = null;
        _isConnecting = false;
        _broadcast('CALL_STATE', { isActive: false, isConnecting: false });
        _broadcast('CALL_ERROR', { error: msg });
      },
    });

    vLog('startSession returned — waiting for onConnect…');
    return _conversation;
  } catch (error) {
    const msg = error?.message || String(error);
    console.error('[VOICE] startConversation failed:', msg);
    _conversation = null;
    _isConnecting = false;
    _broadcast('CALL_STATE', { isActive: false, isConnecting: false });
    _broadcast('CALL_ERROR', { error: msg });
    return null;
  }
}

async function _endConversation() {
  if (!_conversation) {
    _isConnecting = false;
    _broadcast('CALL_STATE', { isActive: false, isConnecting: false });
    return;
  }
  try {
    vLog('Ending session…');
    await _conversation.endSession();
  } catch (e) {
    vLog('endSession error (ignored):', e?.message);
    _conversation = null;
    _isConnecting = false;
    _broadcast('CALL_STATE', { isActive: false, isConnecting: false });
    _broadcast('CALL_ENDED', {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
export default {
  name: 'ElevenLabsVoiceButton',
  mixins: [configMixin],

  props: {
    color: { type: String, default: '#1f93ff' },
    size:  { type: String, default: 'medium'  },
  },

  data() {
    return {
      isConnecting: false,
      isCallActive: false,
    };
  },

  computed: {
    ...mapGetters({
      isVoiceAgentEnabled: 'voiceAgentConfig/isVoiceAgentEnabled',
      voiceAgentProvider:  'voiceAgentConfig/getVoiceAgentProvider',
    }),

    hasElevenLabsVoiceEnabled() {
      return this.isVoiceAgentEnabled && this.voiceAgentProvider === 'elevenlabs';
    },

    shouldShowButton() {
      return this.hasElevenLabsVoiceEnabled;
    },

    buttonClasses() {
      const sizeMap = { small: 'min-h-7 min-w-7', medium: 'min-h-9 min-w-9', large: 'min-h-10 min-w-10' };
      return [
        'elevenlabs-voice-btn flex items-center justify-center rounded-full transition-all duration-200 cursor-pointer border-0 p-1.5',
        sizeMap[this.size] || sizeMap.medium,
        this.isConnecting ? 'elevenlabs-connecting' : '',
        this.isCallActive  ? 'elevenlabs-active'    : '',
      ];
    },

    iconSize() {
      return { small: 16, medium: 18, large: 22 }[this.size] || 18;
    },

    tooltipText() {
      if (this.isCallActive)  return this.$t('VOICE_AGENT.END_CALL');
      if (this.isConnecting)  return this.$t('VOICE_AGENT.CONNECTING');
      return this.$t('VOICE_AGENT.START_CALL');
    },
  },

  mounted() {
    _listeners.add(this);

    // Reflect global SDK state on first mount
    if (_conversation) {
      this.isCallActive = true;
      this.isConnecting = _isConnecting;
      this.setActive(true);
      this.setConnecting(_isConnecting);
    } else if (_isConnecting) {
      this.isConnecting = true;
      this.setConnecting(true);
    }

    // Resume after hard page reload using stored signedUrl
    const sessionCall = getSessionCall();
    if (sessionCall?.signedUrl && !_conversation && !_isConnecting) {
      vLog('Resuming call after page reload…');
      this.isConnecting = true;
      this.setConnecting(true);
      // Show "live" UI immediately so user sees continuity
      this.isCallActive = true;
      this.setActive(true);
      try { localStorage.setItem('cw_voice_active', '1'); } catch (_) {}

      setTimeout(() => {
        _startConversation(sessionCall.signedUrl).then(conv => {
          if (!conv) {
            // Resume failed — clean up
            clearSessionCall();
            try { localStorage.setItem('cw_voice_active', '0'); } catch (_) {}
          }
        });
      }, 200);
    }

    emitter.on('end-voice-call', this.endCall);
  },

  beforeUnmount() {
    _listeners.delete(this);
    emitter.off('end-voice-call', this.endCall);
    // NOTE: do not end the conversation here — user may just be navigating
    // between routes inside the widget. endCall() is the only kill switch.
  },

  methods: {
    ...mapActions('elevenlabsVoice', ['setActive', 'setConnecting']),

    _handleEvent(type, payload) {
      switch (type) {
        case 'CALL_STATE':
          this.isCallActive = payload.isActive;
          this.isConnecting = payload.isConnecting;
          this.setActive(payload.isActive);
          this.setConnecting(payload.isConnecting);
          try {
            localStorage.setItem('cw_voice_active', payload.isActive ? '1' : '0');
          } catch (_) {}
          vLog(`UI → active:${payload.isActive} connecting:${payload.isConnecting}`);
          break;

        case 'TRANSCRIPT': {
          const text = (payload.message || '').toString().trim();
          if (!text) break;
          API.post(
            buildConvUrl('/api/v1/widget/conversations/voice_transcript'),
            { source: payload.source, content: text }
          ).catch(e => vLog('transcript save failed:', e?.response?.status, e?.message));
          break;
        }

        case 'CALL_ENDED':
          clearSessionCall();
          try { localStorage.setItem('cw_voice_active', '0'); } catch (_) {}
          API.post(
            buildConvUrl('/api/v1/widget/conversations/voice_call_ended'),
            {}
          ).catch(e => vLog('voice_call_ended notify failed:', e?.message));
          break;

        case 'CALL_ERROR':
          console.error('[VOICE] Error:', payload?.error);
          this.isCallActive = false;
          this.isConnecting = false;
          this.setActive(false);
          this.setConnecting(false);
          clearSessionCall();
          try { localStorage.setItem('cw_voice_active', '0'); } catch (_) {}
          break;
      }
    },

    handleClick() {
      if (this.isConnecting) return;
      this.isCallActive ? this.endCall() : this.startCall();
    },

    async startCall() {
      if (!this.hasElevenLabsVoiceEnabled) return;

      this.isConnecting = true;
      this.setConnecting(true);

      try {
        // 1. Mic permission must be granted on the main thread — the SDK then
        //    opens its own stream inside this same browsing context.
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Microphone API not available — voice requires HTTPS.');
        }
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          // Release the test stream; SDK opens its own.
          stream.getTracks().forEach(t => t.stop());
          vLog('Microphone permission granted ✓');
        } catch (micErr) {
          console.error('[VOICE] Mic permission denied:', micErr?.message);
          this.isConnecting = false;
          this.setConnecting(false);
          alert(this.$t('VOICE_AGENT.MICROPHONE_ACCESS') || 'Microphone permission is required for voice calls.');
          return;
        }

        // 2. Fetch a fresh signed URL from the backend (agent id stays server-side).
        const { data } = await API.get(
          buildConvUrl('/api/v1/widget/conversations/voice_signed_url')
        );
        const signedUrl = data?.signed_url;
        if (!signedUrl) throw new Error('Backend returned no signed_url');

        vLog('Signed URL received — starting call on main thread');

        // 3. Persist BEFORE starting so a fast page reload can still resume.
        saveCallToSession(signedUrl);
        try { localStorage.setItem('cw_voice_active', '1'); } catch (_) {}

        // 4. Start the conversation on the main thread (where getUserMedia +
        //    AudioContext + WebSocket all work normally).
        const conv = await _startConversation(signedUrl);
        if (!conv) {
          clearSessionCall();
          try { localStorage.setItem('cw_voice_active', '0'); } catch (_) {}
        }
      } catch (error) {
        console.error('[VOICE] startCall error:', error?.message);
        this.isConnecting = false;
        this.setConnecting(false);
        this.setActive(false);
        clearSessionCall();
        try { localStorage.setItem('cw_voice_active', '0'); } catch (_) {}
        if (error?.name === 'NotAllowedError' || error?.name === 'NotFoundError') {
          alert(this.$t('VOICE_AGENT.MICROPHONE_ACCESS'));
        }
      }
    },

    async endCall() {
      await _endConversation();
      this.isCallActive = false;
      this.isConnecting = false;
      this.setActive(false);
      this.setConnecting(false);
      clearSessionCall();
      try { localStorage.setItem('cw_voice_active', '0'); } catch (_) {}
    },
  },
};
</script>

<template>
  <div class="elevenlabs-container">
    <button
      v-if="shouldShowButton"
      :class="buttonClasses"
      :aria-label="tooltipText"
      :title="tooltipText"
      type="button"
      @click="handleClick"
    >
      <!-- Connecting → spinner -->
      <svg
        v-if="isConnecting"
        :width="iconSize"
        :height="iconSize"
        viewBox="0 0 24 24"
        fill="none"
        class="animate-spin"
      >
        <circle
          cx="12" cy="12" r="10"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-dasharray="31.4 31.4"
          fill="none"
        />
      </svg>

      <!-- Active → red hang-up icon -->
      <svg
        v-else-if="isCallActive"
        :width="iconSize"
        :height="iconSize"
        viewBox="0 0 24 24"
        fill="none"
        class="call-icon"
      >
        <path
          d="M3.5 14.5c5.5-5 11.5-5 17 0 .8.7.9 2 0 2.7l-2.1 1.6c-.5.4-1.2.4-1.7 0l-2-1.7
             a1.5 1.5 0 0 1-.5-1.1V14a9.8 9.8 0 0 0-4.4 0v0c0 .4-.2.8-.5 1.1l-2 1.6c-.5.4-1.2.4-1.7 0
             L3.5 15c-.5-.6-.4-1.7 0-2.5Z"
          fill="currentColor"
          transform="rotate(135 12 12)"
        />
      </svg>

      <!-- Idle → phone icon -->
      <svg
        v-else
        :width="iconSize"
        :height="iconSize"
        viewBox="0 0 24 24"
        fill="none"
        class="call-icon"
      >
        <path
          d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07
             19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3
             a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91
             a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72
             A2 2 0 0 1 22 16.92Z"
          fill="currentColor"
        />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.elevenlabs-container {
  position: relative;
  display: inline-flex;
}

.elevenlabs-voice-btn {
  background: transparent;
  color: var(--widget-color, #1f93ff);
}
.elevenlabs-voice-btn:hover:not(:disabled) {
  background: rgba(31, 147, 255, 0.1);
  transform: scale(1.05);
}
.elevenlabs-voice-btn:active:not(:disabled) {
  transform: scale(0.95);
}

.call-icon {
  transition: transform 0.2s ease;
}

.elevenlabs-connecting {
  opacity: 0.75;
  cursor: wait;
}

.elevenlabs-active {
  background: #ef4444 !important;
  color: #ffffff !important;
  box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.18);
  animation: pulse-active 1.6s ease-in-out infinite;
}
.elevenlabs-active:hover {
  background: #dc2626 !important;
}

@keyframes pulse-active {
  0%,  100% { box-shadow: 0 0 0 0   rgba(239, 68, 68, 0.45); }
  50%        { box-shadow: 0 0 0 8px rgba(239, 68, 68, 0.08); }
}
</style>
