<script>
import { mapGetters, mapActions } from 'vuex';
import configMixin from '../mixins/configMixin';

// ─────────────────────────────────────────────────────────────────────────────
// Programmatic ElevenLabs Conversational AI integration.
//
// We deliberately do NOT use the <elevenlabs-convai> web component anymore:
// it renders its own floating "Need help? / Start a call" bubble on the page
// in addition to whatever we mount, which is confusing for visitors and
// impossible to hide reliably (the embed re-portals into document.body).
//
// Instead we load the @elevenlabs/client SDK from esm.sh at runtime and drive
// the call entirely through OUR call button. Nothing extra appears on the
// page. The SDK's Conversation.startSession() handles WebRTC mic capture,
// signalling and playback — we only need an agent id.
// ─────────────────────────────────────────────────────────────────────────────

const ELEVENLABS_SDK_URL = 'https://esm.sh/@elevenlabs/client@0.1.0';
let elevenLabsSdkPromise = null;
const loadElevenLabsSdk = () => {
  if (elevenLabsSdkPromise) return elevenLabsSdkPromise;
  elevenLabsSdkPromise = (async () => {
    // /* @vite-ignore */ — keep this as a runtime URL import, do not bundle.
    const url = ELEVENLABS_SDK_URL;
    const mod = await import(/* @vite-ignore */ url);
    return mod;
  })().catch(err => {
    elevenLabsSdkPromise = null;
    throw err;
  });
  return elevenLabsSdkPromise;
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

    async startCall() {
      if (this.isConnecting || this.isCallActive) return;
      if (!this.resolvedAgentId || !this.hasElevenLabsVoiceEnabled) return;

      this.isConnecting = true;
      this.setConnecting(true);

      try {
        if (navigator.mediaDevices?.getUserMedia) {
          await navigator.mediaDevices.getUserMedia({ audio: true });
        }

        const sdk = await loadElevenLabsSdk();
        const Conversation = sdk?.Conversation || sdk?.default?.Conversation;
        if (!Conversation) {
          throw new Error('ElevenLabs SDK did not expose Conversation');
        }

        this.conversation = await Conversation.startSession({
          agentId: this.resolvedAgentId,
          onConnect: () => {
            this.isConnecting = false;
            this.setConnecting(false);
            this.isCallActive = true;
            this.setActive(true);
          },
          onDisconnect: () => {
            this._cleanupSession();
          },
          onError: err => {
            // eslint-disable-next-line no-console
            console.error('[VOICE-AGENT] Call error:', err);
            this._cleanupSession();
          },
        });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[VOICE-AGENT] Failed to start call:', error);
        this._cleanupSession();
        if (error?.name === 'NotAllowedError' || error?.name === 'NotFoundError') {
          alert(this.$t('VOICE_AGENT.MICROPHONE_ACCESS'));
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
