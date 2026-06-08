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
// Disable: localStorage.removeItem('cw_voice_debug')
const vLog = (...args) => {
  try {
    if (localStorage.getItem('cw_voice_debug') === 'true') console.log('[VOICE]', ...args);
  } catch (_) {}
};

// ─────────────────────────────────────────────────────────────────────────────
// SESSION PERSISTENCE
// Stores call metadata in sessionStorage so the call can be flagged as
// "was active" after a hard page reload. NOTE: the actual WebRTC audio
// stream cannot survive a page reload — the ElevenLabs SDK must reconnect.
// sessionStorage is used to display the call-active UI immediately while the
// worker reconnects, and to pass the signedUrl back to the worker.
// ─────────────────────────────────────────────────────────────────────────────
const SESSION_CALL_KEY = 'cw_voice_session_data';
const SESSION_TTL_MS   = 5 * 60 * 1000; // 5 minutes — ElevenLabs signed URLs expire

function saveCallToSession(isActive, signedUrl) {
  if (!isActive) {
    try { sessionStorage.removeItem(SESSION_CALL_KEY); } catch (_) {}
    return;
  }
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
// SHARED WORKER SINGLETON
// Module-level so it survives Vue component mount/unmount cycles.
// Only one WebSocket connection per browser session.
// ─────────────────────────────────────────────────────────────────────────────
let _sharedWorker = null;
let _workerPort   = null;

// Map of active component instances listening for worker messages.
// Key: component uid (auto-assigned by Vue), Value: component instance.
// This is the FIX for the original bug — the module-level handleWorkerMessage
// had no reference to `this`, so CALL_STATE messages never updated the UI.
const _listenerMap = new Map();

function _onWorkerMessage(evt) {
  const { type, payload } = evt.data;
  vLog('Worker →', type, payload);

  // Broadcast to every mounted ElevenLabsVoiceButton instance
  for (const instance of _listenerMap.values()) {
    try {
      instance._handleWorkerEvent(type, payload);
    } catch (e) {
      vLog('Instance handler error:', e?.message);
    }
  }
}

function getWorkerPort() {
  if (_workerPort) return _workerPort;

  try {
    // Production path (Docker): file is served from /workers/
    // Dev path: relative import via Vite URL
    const isLocalhost = window.location.hostname === 'localhost' ||
                        window.location.hostname === '127.0.0.1';
    const workerUrl = isLocalhost
      ? new URL('../workers/voice-shared-worker.js', import.meta.url)
      : '/workers/voice-shared-worker.js';

    _sharedWorker = new SharedWorker(workerUrl, { name: 'chatwoot-voice' });
    _workerPort   = _sharedWorker.port;

    // Single message handler for ALL component instances
    _workerPort.onmessage = _onWorkerMessage;
    _workerPort.start();

    vLog('SharedWorker port opened:', workerUrl.toString?.() ?? workerUrl);
    return _workerPort;
  } catch (e) {
    console.error('[VOICE] SharedWorker unavailable:', e?.message);
    return null;
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
      // Local reactive state — updated by _handleWorkerEvent
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
    // Register this instance to receive worker broadcasts
    _listenerMap.set(this.$.uid, this);

    // Open (or reuse) the SharedWorker port
    const port = getWorkerPort();
    if (port) {
      // Ask worker for current state immediately
      port.postMessage({ type: 'SYNC_STATE' });
    }

    // ── Resume after hard page reload ────────────────────────────────────
    // If the user navigated away mid-call, sessionStorage has the signedUrl.
    // We reconnect once per page load (guard: sessionStorage cleared on endCall).
    const sessionCall = getSessionCall();
    if (sessionCall?.signedUrl && port) {
      vLog('Resuming call after page reload…');
      // Optimistically show active UI while worker reconnects
      this.isCallActive  = true;
      this.isConnecting  = true;
      this.setActive(true);
      this.setConnecting(true);

      setTimeout(() => {
        // Give Vue time to render, then tell worker to reconnect
        port.postMessage({
          type: 'START_CALL',
          payload: { signedUrl: sessionCall.signedUrl },
        });
      }, 300);
    }

    // Listen for parent-page "end call" events (floating button, etc.)
    emitter.on('end-voice-call', this.endCall);
  },

  beforeUnmount() {
    _listenerMap.delete(this.$.uid);
    emitter.off('end-voice-call', this.endCall);

    // Do NOT clear sessionStorage here — user may just be navigating between
    // pages. Only clearSessionCall() on explicit endCall.
  },

  methods: {
    ...mapActions('elevenlabsVoice', ['setActive', 'setConnecting']),

    // ── Core fix: called from _onWorkerMessage with `this` bound correctly ──
    _handleWorkerEvent(type, payload) {
      switch (type) {
        case 'CALL_STATE':
          // This is the fix — directly update reactive data from worker state
          this.isActive    = payload.isActive;      // keep in sync (unused but safe)
          this.isCallActive  = payload.isActive;
          this.isConnecting  = payload.isConnecting;
          this.setActive(payload.isActive);
          this.setConnecting(payload.isConnecting);
          vLog(`UI updated → active:${payload.isActive} connecting:${payload.isConnecting}`);
          break;

        case 'TRANSCRIPT': {
          const text = (payload.message || '').toString().trim();
          if (!text) break;
          // Save transcript line to backend
          API.post(
            buildConvUrl('/api/v1/widget/conversations/voice_transcript'),
            { source: payload.source, content: text }
          ).catch(e => {
            vLog('transcript save failed:', e?.response?.status, e?.message);
          });
          break;
        }

        case 'CALL_ENDED':
          // Notify backend to start auto-resolve timer
          API.post(
            buildConvUrl('/api/v1/widget/conversations/voice_call_ended'),
            {}
          ).catch(e => vLog('voice_call_ended notify failed:', e?.message));
          break;

        case 'CALL_ERROR':
          console.error('[VOICE] Worker error:', payload?.error);
          // Reset UI — error means call is dead
          this.isCallActive  = false;
          this.isConnecting  = false;
          this.setActive(false);
          this.setConnecting(false);
          clearSessionCall();
          break;
      }
    },

    handleClick() {
      if (this.isConnecting) return;  // Debounce: ignore clicks while connecting
      this.isCallActive ? this.endCall() : this.startCall();
    },

    // ── Start a new voice call ────────────────────────────────────────────
    async startCall() {
      if (!this.hasElevenLabsVoiceEnabled) return;

      const port = getWorkerPort();
      if (!port) {
        alert('SharedWorker is not supported in this browser. Voice calling is unavailable.');
        return;
      }

      this.isConnecting = true;
      this.setConnecting(true);

      try {
        // 1. Request microphone permission in the page context FIRST.
        //    SharedWorkers cannot call getUserMedia directly — it must be
        //    granted in the page and the browser then allows the SDK (running
        //    inside the worker) to access audio as well.
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          // Release the test stream immediately; ElevenLabs SDK will open its own.
          stream.getTracks().forEach(track => track.stop());
          vLog('Microphone permission granted ✓');
        } catch (micErr) {
          console.error('[VOICE] Mic permission denied:', micErr?.message);
          this.isConnecting = false;
          this.setConnecting(false);
          alert('Microphone permission is required for voice calls. Please allow access in your browser settings and try again.');
          return;
        }

        // 2. Fetch a fresh signed URL from the backend (agent ID stays server-side).
        const { data } = await API.get(
          buildConvUrl('/api/v1/widget/conversations/voice_signed_url')
        );
        const signedUrl = data?.signed_url;
        if (!signedUrl) throw new Error('Backend returned no signed_url');

        vLog('Signed URL received — starting call via worker');

        // 3. Persist to sessionStorage so a page reload can resume the call.
        saveCallToSession(true, signedUrl);

        // 4. Tell the worker to open the ElevenLabs WebSocket.
        //    The worker will broadcast CALL_STATE updates back to us.
        port.postMessage({ type: 'START_CALL', payload: { signedUrl } });

        // 5. Set localStorage bridge so the parent page floating button appears.
        try { localStorage.setItem('cw_voice_active', '1'); } catch (_) {}

        // Note: we do NOT set isCallActive=true here — we wait for the worker's
        // CALL_STATE { isActive: true } broadcast so UI reflects real state.

      } catch (error) {
        console.error('[VOICE] startCall error:', error?.message);
        this.isConnecting = false;
        this.setConnecting(false);
        this.setActive(false);
        clearSessionCall();
        if (error?.name === 'NotAllowedError' || error?.name === 'NotFoundError') {
          alert(this.$t('VOICE_AGENT.MICROPHONE_ACCESS'));
        }
      }
    },

    // ── End the active voice call ─────────────────────────────────────────
    async endCall() {
      const port = getWorkerPort();
      if (port) {
        port.postMessage({ type: 'END_CALL' });
      }

      // Immediately reset local state — worker will also broadcast CALL_STATE
      this.isCallActive  = false;
      this.isConnecting  = false;
      this.setActive(false);
      this.setConnecting(false);

      // Clear session + localStorage bridge
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

/* ── Connecting state ── */
.elevenlabs-connecting {
  opacity: 0.75;
  cursor: wait;
}

/* ── Active call — red pulsing button ── */
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