<script>
import { mapGetters, mapActions } from 'vuex';
import configMixin from '../mixins/configMixin';
import { API, WEBSITE_TOKEN } from 'widget/helpers/axios';

// ─────────────────────────────────────────────────────────────────────────────
// Programmatic ElevenLabs Conversational AI integration.
//
// We deliberately do NOT use the <elevenlabs-convai> web component because it
// renders its own floating "Need help? / Start a call" bubble that re-portals
// into document.body and cannot be hidden reliably. Instead we load the
// @elevenlabs/client SDK at runtime and drive the call from our own button.
//
// Two connection modes are supported:
//   1. PUBLIC agent  → Conversation.startSession({ agentId })  (no API key)
//   2. PRIVATE agent → fetch a signed URL from our backend (which uses the
//                      inbox's voice_agent_api_key), then
//                      Conversation.startSession({ signedUrl })
//
// We try public first. If ElevenLabs returns 401/403 (private agent) AND we
// have an API key configured on the inbox, we fall back to the signed-URL
// flow. The API key is NEVER sent to the browser directly — only the signed
// URL is returned to the widget.
// ─────────────────────────────────────────────────────────────────────────────

const SDK_CDN_CANDIDATES = [
  'https://esm.sh/@elevenlabs/client',
  'https://cdn.jsdelivr.net/npm/@elevenlabs/client/+esm',
];

let sdkPromise = null;
const loadSdk = () => {
  if (sdkPromise) return sdkPromise;
  sdkPromise = (async () => {
    let lastErr;
    for (const url of SDK_CDN_CANDIDATES) {
      try {
        const mod = await import(/* @vite-ignore */ url);
        const Conversation = mod?.Conversation || mod?.default?.Conversation;
        if (Conversation) return { Conversation };
        lastErr = new Error('SDK loaded but Conversation export missing: ' + url);
      } catch (e) {
        lastErr = e;
      }
    }
    sdkPromise = null;
    throw lastErr || new Error('All ElevenLabs SDK CDNs failed');
  })();
  return sdkPromise;
};

const buildConvUrl = path => {
  if (!WEBSITE_TOKEN) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}website_token=${WEBSITE_TOKEN}`;
};

export default {
  name: 'ElevenLabsVoiceButton',
  mixins: [configMixin],
  props: {
    color: {
      type: String,
      default: '#1f93ff',
    },
    size: {
      type: String,
      default: 'medium',
    },
  },
  data() {
    return {
      isConnecting: false,
      isCallActive: false,
      conversation: null,
    };
  },
  computed: {
    ...mapGetters({
      isVoiceAgentEnabled: 'voiceAgentConfig/isVoiceAgentEnabled',
      voiceAgentAgentId: 'voiceAgentConfig/getAgentId',
      voiceAgentProvider: 'voiceAgentConfig/getVoiceAgentProvider',
      voiceAgentApiKey: 'voiceAgentConfig/getVoiceAgentApiKey',
    }),
    hasElevenLabsVoiceEnabled() {
      return (
        this.isVoiceAgentEnabled &&
        this.voiceAgentProvider === 'elevenlabs' &&
        !!this.voiceAgentAgentId
      );
    },
    resolvedAgentId() {
      return this.voiceAgentAgentId || '';
    },
    shouldShowButton() {
      return this.hasElevenLabsVoiceEnabled && !!this.resolvedAgentId;
    },
    buttonClasses() {
      const sizeClasses = {
        small: 'min-h-7 min-w-7',
        medium: 'min-h-9 min-w-9',
        large: 'min-h-10 min-w-10',
      };
      return [
        'elevenlabs-voice-btn flex items-center justify-center rounded-full transition-all duration-200 cursor-pointer border-0 p-1.5',
        sizeClasses[this.size] || sizeClasses.medium,
        this.isConnecting ? 'elevenlabs-connecting' : '',
        this.isCallActive ? 'elevenlabs-active' : '',
      ];
    },
    iconSize() {
      const sizes = { small: 16, medium: 18, large: 22 };
      return sizes[this.size] || sizes.medium;
    },
    tooltipText() {
      if (this.isCallActive) return this.$t('VOICE_AGENT.END_CALL');
      if (this.isConnecting) return this.$t('VOICE_AGENT.CONNECTING');
      return this.$t('VOICE_AGENT.START_CALL');
    },
  },
  beforeUnmount() {
    this._cleanupSession();
  },
  methods: {
    ...mapActions('elevenlabsVoice', ['setActive', 'setConnecting']),

    handleClick() {
      if (this.isConnecting) return;
      if (this.isCallActive) {
        this.endCall();
      } else {
        this.startCall();
      }
    },

    async _fetchSignedUrl() {
      // Backend endpoint resolves the inbox's stored API key and returns a
      // short-lived signed WebSocket URL from ElevenLabs.
      const { data } = await API.get(
        buildConvUrl('/api/v1/widget/conversations/voice_signed_url')
      );
      return data?.signed_url;
    },

    // Forward one ElevenLabs onMessage chunk into the Chatwoot conversation
    // as either an incoming (user) or outgoing (ai) message. Failures are
    // logged but never abort the call — transcript is best-effort.
    async _postTranscript(source, content) {
      const text = (content || '').toString().trim();
      if (!text) return;
      try {
        await API.post(
          buildConvUrl('/api/v1/widget/conversations/voice_transcript'),
          { source, content: text }
        );
        // Refresh the widget conversation so the visitor sees their voice
        // turns appear as message bubbles in real-time alongside text.
        try {
          await this.$store.dispatch('conversation/syncLatestMessages');
        } catch (_) {}
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[VOICE-AGENT] transcript post failed:', e?.message || e);
      }
    },

    async _startSessionFor(Conversation, options) {
      return Conversation.startSession({
        ...options,
        onConnect: () => {
          this.isConnecting = false;
          this.setConnecting(false);
          this.isCallActive = true;
          this.setActive(true);
        },
        onDisconnect: () => this._cleanupSession(),
        onError: err => {
          // eslint-disable-next-line no-console
          console.error('[VOICE-AGENT] session error:', err);
          this._cleanupSession();
        },
        // ElevenLabs SDK fires this once per completed turn. The shape is
        // either { source: 'user'|'ai', message } (current SDK) or
        // { role: 'user'|'assistant', message } (older shape) — handle both.
        onMessage: payload => {
          if (!payload) return;
          const raw = payload.source || payload.role || '';
          const source = raw === 'user' ? 'user'
                       : (raw === 'ai' || raw === 'assistant' || raw === 'agent') ? 'ai'
                       : null;
          if (!source) return;
          const content = payload.message || payload.text || payload.content;
          this._postTranscript(source, content);
        },
      });
    },

    async startCall() {
      if (this.isConnecting || this.isCallActive) return;
      if (!this.resolvedAgentId || !this.hasElevenLabsVoiceEnabled) return;

      this.isConnecting = true;
      this.setConnecting(true);

      try {
        // 1. Mic permission must be granted before the WebRTC handshake.
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Browser does not expose getUserMedia (insecure context?)');
        }
        await navigator.mediaDevices.getUserMedia({ audio: true });

        // 2. Load SDK from CDN (with fallback).
        const { Conversation } = await loadSdk();

        // 3. Pick a single connection path up-front.
        //    DO NOT try public→private with try/catch — the public path leaves
        //    a closed RTCPeerConnection behind ("could not createOffer with
        //    closed peer connection") which breaks the subsequent attempt.
        //    The presence of an inbox API key tells us the admin wants the
        //    signed-URL flow (works for both Public and Private agents).
        let sessionOptions;
        if (this.voiceAgentApiKey) {
          const signedUrl = await this._fetchSignedUrl();
          if (!signedUrl) {
            throw new Error(
              'Backend did not return a signed URL. Check inbox API key and /voice_signed_url logs.'
            );
          }
          sessionOptions = { signedUrl };
        } else {
          sessionOptions = { agentId: this.resolvedAgentId };
        }

        this.conversation = await this._startSessionFor(Conversation, sessionOptions);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[VOICE-AGENT] Failed to start call:', error);
        this._cleanupSession();
        if (error?.name === 'NotAllowedError' || error?.name === 'NotFoundError') {
          alert(this.$t('VOICE_AGENT.MICROPHONE_ACCESS'));
        } else if (error?.message) {
          alert('Voice call failed: ' + error.message);
        }
      }
    },

    async endCall() {
      if (this.conversation) {
        try { await this.conversation.endSession(); } catch (_) {}
      }
      this._cleanupSession();
    },

    _cleanupSession() {
      this.conversation = null;
      this.isCallActive = false;
      this.isConnecting = false;
      this.setActive(false);
      this.setConnecting(false);
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
      <!-- Connecting spinner -->
      <svg
        v-if="isConnecting"
        :width="iconSize"
        :height="iconSize"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        class="animate-spin"
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-dasharray="31.4 31.4"
          fill="none"
        />
      </svg>

      <!-- Active call → hang-up icon -->
      <svg
        v-else-if="isCallActive"
        :width="iconSize"
        :height="iconSize"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        class="call-icon"
      >
        <path
          d="M3.5 14.5c5.5-5 11.5-5 17 0 .8.7.9 2-0 2.7l-2.1 1.6c-.5.4-1.2.4-1.7 0l-2-1.7a1.5 1.5 0 0 1-.5-1.1V14a9.8 9.8 0 0 0-4.4 0v0c0 .4-.2.8-.5 1.1l-2 1.6c-.5.4-1.2.4-1.7 0L3.5 15c-.5-.6-.4-1.7 0-2.5Z"
          fill="currentColor"
          transform="rotate(135 12 12)"
        />
      </svg>

      <!-- Idle → phone / start call icon -->
      <svg
        v-else
        :width="iconSize"
        :height="iconSize"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        class="call-icon"
      >
        <path
          d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92Z"
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
  transition: transform 0.2s ease, filter 0.2s ease;
}

.elevenlabs-connecting {
  opacity: 0.75;
  cursor: wait;
  color: var(--widget-color, #1f93ff);
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
  0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.45); }
  50%      { box-shadow: 0 0 0 8px rgba(239, 68, 68, 0.08); }
}
</style>
