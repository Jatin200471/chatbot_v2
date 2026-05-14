<script>
import { mapGetters, mapActions } from 'vuex';
import configMixin from '../mixins/configMixin';

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
      scriptLoaded: false,
      scriptLoadPromise: null,
      widgetElement: null,
    };
  },
  computed: {
    ...mapGetters({
      isVoiceAgentEnabled: 'voiceAgentConfig/isVoiceAgentEnabled',
      voiceAgentAgentId: 'voiceAgentConfig/getAgentId',
      voiceAgentVoiceId: 'voiceAgentConfig/getVoiceId',
      voiceAgentName: 'voiceAgentConfig/getAgentName',
      voiceAgentProvider: 'voiceAgentConfig/getVoiceAgentProvider',
      voiceAgentApiKey: 'voiceAgentConfig/getVoiceAgentApiKey',
    }),
    hasElevenLabsVoiceEnabled() {
      // Show button only if:
      // 1. Voice agent is enabled in inbox config
      // 2. Provider is elevenlabs
      // 3. We have an agent ID
      return this.isVoiceAgentEnabled && 
             this.voiceAgentProvider === 'elevenlabs' && 
             !!this.voiceAgentAgentId;
    },
    resolvedAgentId() {
      // Return the agent ID from voice agent config
      return this.voiceAgentAgentId || '';
    },
    shouldShowButton() {
      // Admin-controlled per inbox + agent id from voice agent config
      return this.hasElevenLabsVoiceEnabled && !!this.resolvedAgentId;
    },
    buttonClasses() {
      const sizeClasses = {
        small: 'min-h-6 min-w-6',
        medium: 'min-h-8 min-w-8',
        large: 'min-h-10 min-w-10',
      };
      return [
        'elevenlabs-voice-btn flex items-center justify-center rounded-full transition-all duration-200 cursor-pointer border-0 bg-transparent p-1',
        sizeClasses[this.size] || sizeClasses.medium,
        this.isConnecting ? 'elevenlabs-connecting' : '',
      ];
    },
    iconSize() {
      const sizes = { small: 16, medium: 20, large: 24 };
      return sizes[this.size] || sizes.medium;
    },
    tooltipText() {
      if (this.isCallActive) return this.$t('VOICE_AGENT.END_CALL');
      if (this.isConnecting) return this.$t('VOICE_AGENT.CONNECTING');
      return this.$t('VOICE_AGENT.START_CALL');
    },
  },
  watch: {
    resolvedAgentId() {
      // Keep the hidden widget configured for the current inbox/agent id.
      this.ensureWidgetMounted();
    },
    hasElevenLabsVoiceEnabled(enabled) {
      // If an admin disables the feature for this inbox, ensure the embed UI
      // is completely removed. The <elevenlabs-convai> element can render its
      // own floating UI even if we place it off-screen.
      if (!enabled) {
        if (this.isCallActive) this.endCall();
        this.removeWidget();
        return;
      }

      // If enabled, mount (if we have an agent id).
      this.loadElevenLabsScript().then(() => this.ensureWidgetMounted());
    },
  },
  mounted() {
    // Only mount the embed when enabled for this inbox. Otherwise the embed can
    // show its own UI even if we render it off-screen.
    if (this.hasElevenLabsVoiceEnabled) {
      // Preload embed + mount hidden widget so click can synchronously start a call.
      this.loadElevenLabsScript().then(() => this.ensureWidgetMounted());
    }
  },
  beforeUnmount() {
    this.removeWidget();
  },
  methods: {
    ...mapActions('elevenlabsVoice', ['setActive', 'setConnecting']),

    loadElevenLabsScript() {
      if (this.scriptLoadPromise) return this.scriptLoadPromise;

      if (
        this.scriptLoaded ||
        document.querySelector('script[src*="@elevenlabs/convai-widget-embed"]')
      ) {
        this.scriptLoaded = true;
        this.scriptLoadPromise = Promise.resolve();
        return this.scriptLoadPromise;
      }

      this.scriptLoadPromise = new Promise(resolve => {
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/@elevenlabs/convai-widget-embed';
        script.async = true;
        script.type = 'text/javascript';
        script.onload = () => {
          this.scriptLoaded = true;
          resolve();
        };
        // If the CDN is blocked (CSP/network), don't block the rest of the widget.
        script.onerror = () => resolve();
        document.head.appendChild(script);
      });

      return this.scriptLoadPromise;
    },

    ensureWidgetMounted() {
      if (!this.hasElevenLabsVoiceEnabled) {
        this.removeWidget();
        return;
      }

      const agentId = this.resolvedAgentId;
      if (!agentId) return;

      const host = this.$refs.widgetHost;
      if (!host) return;

      if (this.widgetElement) {
        this.widgetElement.setAttribute('agent-id', agentId);
        return;
      }

      const el = document.createElement('elevenlabs-convai');
      el.setAttribute('agent-id', agentId);
      el.setAttribute('data-chatwoot', 'true');
      host.appendChild(el);
      this.widgetElement = el;
    },

    clickWidgetButton({ preferEnd = false } = {}) {
      const el = this.widgetElement;
      if (!el) return false;

      const root = el.shadowRoot;
      if (!root) return false;

      const buttons = Array.from(root.querySelectorAll('button'));
      if (!buttons.length) return false;

      const pick = btn => {
        const text = (btn.textContent || '').toLowerCase();
        if (preferEnd) return text.includes('end') || text.includes('hang');
        return text.includes('start') || text.includes('call');
      };

      const target = buttons.find(pick) || buttons[0];
      target.click();
      return true;
    },

    handleClick() {
      if (this.isConnecting) return;
      if (this.isCallActive) {
        this.endCall();
      } else {
        this.startCall();
      }
    },

    async startCall() {
      const agentId = this.resolvedAgentId;
      if (!agentId) return;
      if (!this.hasElevenLabsVoiceEnabled) return;

      this.isConnecting = true;
      this.setConnecting(true);

      try {
        // In insecure contexts (e.g. http://[::]:8000), mediaDevices may be undefined.
        if (navigator.mediaDevices?.getUserMedia) {
          await navigator.mediaDevices.getUserMedia({ audio: true });
        }

        await this.loadElevenLabsScript();
        this.ensureWidgetMounted();

        // Best-effort: click the embed's start call button.
        this.clickWidgetButton({ preferEnd: false });

        this.isConnecting = false;
        this.setConnecting(false);
        this.isCallActive = true;
        this.setActive(true);
      } catch (error) {
        console.error('Failed to start ElevenLabs call:', error);
        this.isConnecting = false;
        this.setConnecting(false);

        if (error.name === 'NotAllowedError' || error.name === 'NotFoundError') {
          alert(this.$t('VOICE_AGENT.MICROPHONE_ACCESS'));
        }
      }
    },

    endCall() {
      // Best-effort: click the embed's end call button, then reset by remounting.
      this.clickWidgetButton({ preferEnd: true });
      this.removeWidget();
      this.ensureWidgetMounted();

      this.isCallActive = false;
      this.isConnecting = false;
      this.setActive(false);
      this.setConnecting(false);
    },

    removeWidget() {
      if (this.widgetElement) {
        this.widgetElement.remove();
        this.widgetElement = null;
      }
    },
  },
};
</script>

<template>
  <div class="elevenlabs-container">
    <button
      v-if="shouldShowButton && !isCallActive"
      :class="buttonClasses"
      :aria-label="tooltipText"
      :title="tooltipText"
      type="button"
      @click="handleClick"
    >
      <svg
        v-if="isConnecting"
        :width="iconSize"
        :height="iconSize"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        class="animate-spin text-n-slate-11"
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-dasharray="31.4 31.4"
          fill="none"
        />
      </svg>

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
          d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"
          fill="#F87171"
          stroke="#DC2626"
          stroke-width="0.5"
        />
        <rect x="10" y="1" width="12" height="9" rx="2" fill="#FDE68A" stroke="#F59E0B" stroke-width="0.5"/>
        <path d="M12 10L10 13L14 10H12Z" fill="#FDE68A" stroke="#F59E0B" stroke-width="0.3"/>
        <text x="16" y="7" font-size="5" font-weight="bold" fill="#3B82F6" text-anchor="middle" font-family="Arial, sans-serif">AI</text>
      </svg>
    </button>

    <div ref="widgetHost" class="elevenlabs-hidden-widget" aria-hidden="true" />

    <Teleport to="body">
      <div v-if="isCallActive" class="elevenlabs-endcall-shell">
        <button class="elevenlabs-endcall-pill" type="button" @click="endCall">
          <span class="elevenlabs-endcall-icon" aria-hidden="true">☎</span>
          <span class="elevenlabs-endcall-text">{{ $t('VOICE_AGENT.END_CALL') }}</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.elevenlabs-container {
  position: relative;
}

.elevenlabs-voice-btn {
  position: relative;
}

.elevenlabs-voice-btn:hover .call-icon {
  transform: scale(1.1);
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));
}

.call-icon {
  transition: transform 0.2s ease, filter 0.2s ease;
}

.elevenlabs-connecting {
  opacity: 0.7;
  cursor: wait;
}

.elevenlabs-hidden-widget {
  position: fixed;
  left: -10000px;
  top: -10000px;
  width: 1px;
  height: 1px;
  overflow: hidden;
  pointer-events: none;
}

.elevenlabs-endcall-shell {
  position: fixed;
  left: 50%;
  bottom: 96px;
  transform: translateX(-50%);
  z-index: 9999;
  padding: 10px;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 12px 40px rgba(15, 23, 42, 0.2);
  backdrop-filter: blur(10px);
}

.elevenlabs-endcall-pill {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 0;
  border-radius: 9999px;
  padding: 12px 28px;
  cursor: pointer;
  color: #ffffff;
  background: #f87171;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
  transition: transform 0.15s ease, background 0.15s ease;
}

.elevenlabs-endcall-pill:hover {
  background: #ef4444;
  transform: translateY(-1px);
}

.elevenlabs-endcall-icon {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.2);
  font-size: 15px;
  line-height: 1;
}

.elevenlabs-endcall-text {
  font-weight: 700;
  font-size: 16px;
  letter-spacing: 0.01em;
}
</style>
