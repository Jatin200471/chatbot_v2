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

const WINDOW_SESSION_KEY = '_cwVoiceSession';
const WINDOW_CONV_CLASS  = '_cwConversationClass';

// Debug logger — console mein sirf tab dikhega jab debug mode ON ho
// ON:  localStorage.setItem('cw_voice_debug', 'true')
// OFF: localStorage.removeItem('cw_voice_debug')
const vLog = (...args) => {
  try {
    if (localStorage.getItem('cw_voice_debug') === 'true') console.log('[VOICE]', ...args);
  } catch (_) {}
};

let _sdkLoadPromise = null;

async function loadSDK() {
  if (_sdkLoadPromise) return _sdkLoadPromise;
  _sdkLoadPromise = (async () => {
    if (window[WINDOW_CONV_CLASS]) return true;
    try {
      // esm.sh converts any npm package to ESM — works without UMD build
      const mod = await import('https://esm.sh/@11labs/client');
      if (mod?.Conversation) {
        window[WINDOW_CONV_CLASS] = mod.Conversation;
        return true;
      }
      return false;
    } catch (e) {
      console.error('[VOICE] SDK load failed:', e?.message);
      _sdkLoadPromise = null;
      return false;
    }
  })();
  return _sdkLoadPromise;
}

function getConversationClass() {
  return window[WINDOW_CONV_CLASS];
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
    // Preload SDK so call starts instantly on first click
    if (this.hasElevenLabsVoiceEnabled) loadSDK();

    // ── Resume after page navigation ────────────────────────────────────
    if (window[WINDOW_SESSION_KEY]) {
      this.isCallActive = true;
      this.setActive(true);
    }

    // ── Floating End Call button (sdk-floating-btn.js) ───────────────────
    // Parent page button → sends event → end call
    emitter.on('end-voice-call', this.endCall);
  },
  beforeUnmount() {
    emitter.off('end-voice-call', this.endCall);
    if (!this.isCallActive) this._cleanupSession();
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
      this.isConnecting = true;
      this.setConnecting(true);

      try {
        // 1. Load @11labs/client SDK
        const loaded = await loadSDK();
        if (!loaded) throw new Error('Failed to load ElevenLabs SDK');

        const Conversation = getConversationClass();
        if (!Conversation) throw new Error('ElevenLabs Conversation class not found');

        // 2. Get signed URL from backend — agent_id never reaches browser
        const { data } = await API.get(
          buildConvUrl('/api/v1/widget/conversations/voice_signed_url')
        );
        const signedUrl = data?.signed_url;
        if (!signedUrl) throw new Error('No signed URL from server');

        // 3. Start session via SDK — handles ALL WebSocket protocol internally
        //    (ping/pong, audio, reconnect) — no 3-sec cutoff ✅
        const session = await Conversation.startSession({
          signedUrl,

          // ── Live transcript ── fires for every AI + user turn ────────────
          onMessage: ({ message, source }) => {
            vLog(`transcript [${source}]:`, message);
            this._saveTranscript(source, message);
          },

          onConnect: () => {
            vLog('Connected ✅');
            this.isConnecting = false;
            this.setConnecting(false);
            this.isCallActive = true;
            this.setActive(true);
          },

          onDisconnect: () => {
            vLog('Disconnected');
            this._cleanupSession();
            this.isCallActive = false;
            this.isConnecting = false;
            this.setActive(false);
            this.setConnecting(false);
          },

          onError: err  => vLog('error:', err),
          onModeChange: ({ mode }) => vLog('mode:', mode),
        });

        // 4. Store session on window — survives Vue component unmount/remount
        //    when user navigates pages
        window[WINDOW_SESSION_KEY] = session;

      } catch (error) {
        console.error('[VOICE] startCall failed:', error?.message);
        this.isConnecting = false;
        this.setConnecting(false);
        this.setActive(false);
        window[WINDOW_SESSION_KEY] = null;
        if (error?.name === 'NotAllowedError' || error?.name === 'NotFoundError') {
          alert(this.$t('VOICE_AGENT.MICROPHONE_ACCESS'));
        }
      }
    },

    // ── End voice call ────────────────────────────────────────────────────
    async endCall() {
      const session = window[WINDOW_SESSION_KEY];
      if (session) {
        try { await session.endSession(); } catch (_) {}
      }
      this._cleanupSession();
      this.isCallActive = false;
      this.isConnecting = false;
      this.setActive(false);
      this.setConnecting(false);
    },

    _cleanupSession() {
      window[WINDOW_SESSION_KEY] = null;
    },

    // ── Save transcript turn to Chatwoot conversation ─────────────────────
    // Called on EVERY message — real-time, no polling needed ✅
    async _saveTranscript(source, content) {
      const text = (content || '').toString().trim();
      if (!text) return;
      try {
        await API.post(
          buildConvUrl('/api/v1/widget/conversations/voice_transcript'),
          { source, content: text }
        );
        // Sync messages so transcript appears in widget immediately
        try {
          await this.$store.dispatch('conversation/syncLatestMessages');
        } catch (_) {}
      } catch (e) {
        console.warn('[VOICE] transcript save failed:', e?.response?.status, e?.message);
      }
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
