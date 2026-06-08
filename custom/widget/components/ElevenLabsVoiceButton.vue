<script>
import { mapGetters, mapActions } from 'vuex';
import configMixin from '../mixins/configMixin';
import { API, WEBSITE_TOKEN } from 'widget/helpers/axios';
import { emitter } from 'shared/helpers/mitt';

const buildConvUrl = path => {
  if (!WEBSITE_TOKEN) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}website_token=${WEBSITE_TOKEN}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// @11labs/client — loaded once via CDN (no package.json change needed).
// Exposes window.ElevenLabsClient.Conversation which handles:
//   • WebSocket connection + ping/pong (no 3-sec cutoff)
//   • onMessage → live transcript per turn
//   • Works across page navigations (stored on window)
// ─────────────────────────────────────────────────────────────────────────────

// Debug logger — console mein sirf tab dikhega jab debug mode ON ho
// ON:  localStorage.setItem('cw_voice_debug', 'true')
// OFF: localStorage.removeItem('cw_voice_debug')
const vLog = (...args) => {
  try {
    if (localStorage.getItem('cw_voice_debug') === 'true') console.log('[VOICE]', ...args);
  } catch (_) {}
};

// ─────────────────────────────────────────────────────────────────────────────
// SESSION PERSISTENCE: Survives page reload on full-page navigation
// When page reloads, we check sessionStorage for active call and resume it
// ─────────────────────────────────────────────────────────────────────────────

const SESSION_CALL_KEY = 'cw_voice_session_data';

function saveCallToSession(isActive, signedUrl) {
  if (!isActive) {
    try { sessionStorage.removeItem(SESSION_CALL_KEY); } catch (_) {}
    return;
  }
  try {
    sessionStorage.setItem(SESSION_CALL_KEY, JSON.stringify({
      isActive: true,
      signedUrl,
      timestamp: Date.now()
    }));
  } catch (_) {}
}

function getSessionCall() {
  try {
    const data = sessionStorage.getItem(SESSION_CALL_KEY);
    if (!data) return null;
    const parsed = JSON.parse(data);
    // Only restore if less than 5 minutes old
    if (Date.now() - parsed.timestamp > 5 * 60 * 1000) {
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

let _sharedWorker = null;
let _workerPort = null;
let _callRestoredFromSession = false; // Track if we already tried restoring

function getSharedWorker() {
  if (!_sharedWorker) {
    try {
      // In production (Docker/CDN), worker is served from /workers/
      // In development, it's in relative path
      const isProduction = typeof WEBSITE_TOKEN !== 'undefined' && !window.location.hostname.includes('localhost');
      const workerPath = isProduction 
        ? '/workers/voice-shared-worker.js'
        : new URL('../workers/voice-shared-worker.js', import.meta.url);
      
      _sharedWorker = new SharedWorker(workerPath, { name: 'chatwoot-voice' });
      _sharedWorker.port.onmessage = handleWorkerMessage;
      _sharedWorker.port.start();
      vLog('SharedWorker connected from:', workerPath);
    } catch (e) {
      console.warn('[VOICE] SharedWorker not supported, falling back to page-local storage:', e?.message);
      return null;
    }
  }
  return _sharedWorker;
}

function handleWorkerMessage(evt) {
  const { type, payload } = evt.data;
  vLog(`Worker message: ${type}`, payload);

  if (type === 'CALL_STATE') {
    // Call state changed in worker or another page
    // Component will update via computed properties
  } else if (type === 'TRANSCRIPT') {
    // Worker received transcript — save to backend
    // Using axios with website_token already included
    const text = (payload.message || '').toString().trim();
    if (text) {
      API.post(
        buildConvUrl('/api/v1/widget/conversations/voice_transcript'),
        { source: payload.source, content: text }
      ).catch(e => {
        console.warn('[VOICE] transcript save failed:', e?.response?.status, e?.message);
      });
    }
  } else if (type === 'CALL_ENDED') {
    // Call ended — notify backend for auto-resolve timer
    API.post(
      buildConvUrl('/api/v1/widget/conversations/voice_call_ended'),
      {}
    ).catch(e => {
      vLog('voice_call_ended notify failed:', e?.message);
    });
  } else if (type === 'CALL_ERROR') {
    console.error('[VOICE]', payload.error);
  }
}

export default {
  name: 'ElevenLabsVoiceButton',
  mixins: [configMixin],
  props: {
    color: { type: String, default: '#1f93ff' },
    size: { type: String, default: 'medium' },
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
      const sizeClasses = {
        small:  'min-h-7 min-w-7',
        medium: 'min-h-9 min-w-9',
        large:  'min-h-10 min-w-10',
      };
      return [
        'elevenlabs-voice-btn flex items-center justify-center rounded-full transition-all duration-200 cursor-pointer border-0 p-1.5',
        sizeClasses[this.size] || sizeClasses.medium,
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
    // Connect to SharedWorker (persistent across page navigations)
    const worker = getSharedWorker();
    if (worker) {
      _workerPort = worker.port;
      // Ask worker for current call state
      _workerPort.postMessage({ type: 'SYNC_STATE' });
    }

    // ── Restore call from page reload ─────────────────────────────────────
    // If page reloaded while voice call was active, resume it
    if (!_callRestoredFromSession) {
      _callRestoredFromSession = true;
      const sessionCall = getSessionCall();
      if (sessionCall && sessionCall.signedUrl) {
        vLog('Resuming voice call after page reload...');
        this.isCallActive = true;
        this.setActive(true);
        // Use setTimeout to ensure component is fully mounted
        setTimeout(() => {
          this._resumeCallFromSession(sessionCall.signedUrl);
        }, 500);
      }
    }

    // Floating End Call button (sdk-floating-btn.js) ───────────────────
    // Parent page button → sends event → end call
    emitter.on('end-voice-call', this.endCall);
  },
  beforeUnmount() {
    emitter.off('end-voice-call', this.endCall);
    if (!this.isCallActive) {
      clearSessionCall();
      this._cleanupSession();
    }
  },
  methods: {
    ...mapActions('elevenlabsVoice', ['setActive', 'setConnecting']),

    handleClick() {
      if (this.isConnecting) return;
      this.isCallActive ? this.endCall() : this.startCall();
    },

    // ── Start voice call ──────────────────────────────────────────────────
    async startCall() {
      if (!this.hasElevenLabsVoiceEnabled) return;
      
      const worker = getSharedWorker();
      if (!worker) {
        alert('SharedWorker not supported. Voice calling unavailable.');
        return;
      }

      this.isConnecting = true;
      this.setConnecting(true);

      try {
        // Get signed URL from backend
        const { data } = await API.get(
          buildConvUrl('/api/v1/widget/conversations/voice_signed_url')
        );
        const signedUrl = data?.signed_url;
        if (!signedUrl) throw new Error('No signed URL from server');

        // Save to sessionStorage — survives page reload
        saveCallToSession(true, signedUrl);
        vLog('Call saved to session');

        // Tell worker to start call — worker handles WebSocket + reconnect
        _workerPort.postMessage({
          type: 'START_CALL',
          payload: { signedUrl }
        });

        // Worker will send CALL_STATE message when connected
        this.isCallActive = true;
        this.setActive(true);

      } catch (error) {
        console.error('[VOICE] startCall failed:', error?.message);
        this.isConnecting = false;
        this.setConnecting(false);
        this.setActive(false);
        clearSessionCall();
        if (error?.name === 'NotAllowedError' || error?.name === 'NotFoundError') {
          alert(this.$t('VOICE_AGENT.MICROPHONE_ACCESS'));
        }
      }
    },

    // ── Resume call after page reload ─────────────────────────────────────
    // User navigated away while on a call, page reloaded, now reconnect
    async _resumeCallFromSession(signedUrl) {
      try {
        const worker = getSharedWorker();
        if (!worker) {
          clearSessionCall();
          return;
        }

        vLog('Resuming voice call from session...');
        // Tell worker to restore the call
        _workerPort.postMessage({
          type: 'START_CALL',
          payload: { signedUrl }
        });
      } catch (error) {
        console.error('[VOICE] resume failed:', error?.message);
        clearSessionCall();
      }
    },

    // ── End voice call ────────────────────────────────────────────────────
    async endCall() {
      const worker = getSharedWorker();
      if (worker && _workerPort) {
        _workerPort.postMessage({ type: 'END_CALL' });
      }
      clearSessionCall(); // Clear call from session when explicitly ended
      this._cleanupSession();
      this.isCallActive = false;
      this.isConnecting = false;
      this.setActive(false);
      this.setConnecting(false);
    },

    _cleanupSession() {
      // Clear localStorage bridge so parent page hides the floating button
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
      <svg v-if="isConnecting"
        :width="iconSize" :height="iconSize"
        viewBox="0 0 24 24" fill="none"
        class="animate-spin"
      >
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2.5"
                stroke-linecap="round" stroke-dasharray="31.4 31.4" fill="none"/>
      </svg>

      <!-- Active → red hangup -->
      <svg v-else-if="isCallActive"
        :width="iconSize" :height="iconSize"
        viewBox="0 0 24 24" fill="none"
        class="call-icon"
      >
        <path d="M3.5 14.5c5.5-5 11.5-5 17 0 .8.7.9 2 0 2.7l-2.1 1.6c-.5.4-1.2.4-1.7 0l-2-1.7
                 a1.5 1.5 0 0 1-.5-1.1V14a9.8 9.8 0 0 0-4.4 0v0c0 .4-.2.8-.5 1.1l-2 1.6c-.5.4-1.2.4-1.7 0
                 L3.5 15c-.5-.6-.4-1.7 0-2.5Z"
              fill="currentColor" transform="rotate(135 12 12)"/>
      </svg>

      <!-- Idle → phone icon -->
      <svg v-else
        :width="iconSize" :height="iconSize"
        viewBox="0 0 24 24" fill="none"
        class="call-icon"
      >
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07
                 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3
                 a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91
                 a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72
                 A2 2 0 0 1 22 16.92Z"
              fill="currentColor"/>
      </svg>
    </button>
  </div>
</template>

<style scoped>
.elevenlabs-container { position: relative; display: inline-flex; }

.elevenlabs-voice-btn {
  background: transparent;
  color: var(--widget-color, #1f93ff);
}
.elevenlabs-voice-btn:hover:not(:disabled) {
  background: rgba(31, 147, 255, 0.1);
  transform: scale(1.05);
}
.elevenlabs-voice-btn:active:not(:disabled) { transform: scale(0.95); }

.call-icon { transition: transform 0.2s ease; }
.elevenlabs-connecting { opacity: 0.75; cursor: wait; }

/* Active call → red pulsing */
.elevenlabs-active {
  background: #ef4444 !important;
  color: #ffffff !important;
  box-shadow: 0 0 0 4px rgba(239,68,68,.18);
  animation: pulse-active 1.6s ease-in-out infinite;
}
.elevenlabs-active:hover { background: #dc2626 !important; }

@keyframes pulse-active {
  0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,.45); }
  50%      { box-shadow: 0 0 0 8px rgba(239,68,68,.08); }
}
</style>
