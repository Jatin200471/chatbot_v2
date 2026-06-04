<script>
import { mapGetters, mapActions } from 'vuex';
import configMixin from '../mixins/configMixin';
import { API, WEBSITE_TOKEN } from 'widget/helpers/axios';

const buildConvUrl = path => {
  if (!WEBSITE_TOKEN) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}website_token=${WEBSITE_TOKEN}`;
};

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
      scriptLoaded: false,
      scriptLoadPromise: null,
      widgetElement: null,
      // Transcript polling state
      _transcriptPollInterval: null,
      _syncedCount: 0,
      _lastConvId: null,
    };
  },
  computed: {
    ...mapGetters({
      isVoiceAgentEnabled: 'voiceAgentConfig/isVoiceAgentEnabled',
      voiceAgentProvider:  'voiceAgentConfig/getVoiceAgentProvider',
    }),
    hasElevenLabsVoiceEnabled() {
      // Agent ID check removed — server-side only. Button shows if feature flag enabled.
      return this.isVoiceAgentEnabled && this.voiceAgentProvider === 'elevenlabs';
    },
    shouldShowButton() {
      return this.hasElevenLabsVoiceEnabled;
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
      if (this.isCallActive)  return this.$t('VOICE_AGENT.END_CALL');
      if (this.isConnecting)  return this.$t('VOICE_AGENT.CONNECTING');
      return this.$t('VOICE_AGENT.START_CALL');
    },
  },
  mounted() {
    if (this.hasElevenLabsVoiceEnabled) {
      // Preload embed script so call starts instantly on click
      this.loadElevenLabsScript();
    }
  },
  beforeUnmount() {
    // ── IMPORTANT: if call is active (user navigated pages), do NOT remove the
    // widget — the embed is still running. Only clean up polling.
    // The widget element stays alive in the hidden host div until endCall().
    if (!this.isCallActive) {
      this.removeWidget();
    }
    this._stopTranscriptPoll();
  },
  methods: {
    ...mapActions('elevenlabsVoice', ['setActive', 'setConnecting']),

    // ── Load ElevenLabs embed script once ────────────────────────────────────
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
        script.src   = 'https://unpkg.com/@elevenlabs/convai-widget-embed';
        script.async = true;
        script.type  = 'text/javascript';
        script.onload  = () => { this.scriptLoaded = true; resolve(); };
        script.onerror = () => resolve(); // Don't block widget on CDN failure
        document.head.appendChild(script);
      });
      return this.scriptLoadPromise;
    },

    // ── Mount hidden <elevenlabs-convai> element with signed URL ─────────────
    // Uses signed-url instead of agent-id so the agent ID never reaches the browser.
    async ensureWidgetMounted(signedUrl) {
      if (!this.hasElevenLabsVoiceEnabled) { this.removeWidget(); return; }
      if (!signedUrl) return;

      const host = this.$refs.widgetHost;
      if (!host) return;

      if (this.widgetElement) {
        // Update signed URL on existing element (new call = new signed URL)
        this.widgetElement.setAttribute('signed-url', signedUrl);
        return;
      }

      const el = document.createElement('elevenlabs-convai');
      el.setAttribute('signed-url', signedUrl);
      el.setAttribute('data-chatwoot', 'true');
      host.appendChild(el);
      this.widgetElement = el;
    },

    // ── Click the embed widget's internal button via shadow DOM ──────────────
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
      this.isCallActive ? this.endCall() : this.startCall();
    },

    // ── Start voice call ──────────────────────────────────────────────────────
    async startCall() {
      if (!this.hasElevenLabsVoiceEnabled) return;

      this.isConnecting = true;
      this.setConnecting(true);

      try {
        // 1. Request mic permission early (unlocks AudioContext on iOS/Chrome)
        if (navigator.mediaDevices?.getUserMedia) {
          await navigator.mediaDevices.getUserMedia({ audio: true });
        }

        // 2. Load embed script
        await this.loadElevenLabsScript();

        // 3. Fetch short-lived signed URL from backend — agent_id never in browser
        const { data } = await API.get(
          buildConvUrl('/api/v1/widget/conversations/voice_signed_url')
        );
        const signedUrl = data?.signed_url;
        if (!signedUrl) throw new Error('No signed URL from server');

        // 4. Mount widget with signed URL and click start
        await this.ensureWidgetMounted(signedUrl);
        this.clickWidgetButton({ preferEnd: false });

        // 5. Update state
        this.isConnecting = false;
        this.setConnecting(false);
        this.isCallActive = true;
        this.setActive(true);

        // 6. Start transcript polling every 3 seconds
        this._syncedCount = 0;
        this._lastConvId  = null;
        this._startTranscriptPoll();

      } catch (error) {
        console.error('[VOICE] startCall failed:', error?.message);
        this.isConnecting = false;
        this.setConnecting(false);
        this.setActive(false);
        if (error?.name === 'NotAllowedError' || error?.name === 'NotFoundError') {
          alert(this.$t('VOICE_AGENT.MICROPHONE_ACCESS'));
        }
      }
    },

    // ── End voice call ────────────────────────────────────────────────────────
    endCall() {
      this.clickWidgetButton({ preferEnd: true });

      // Stop polling but do one final sync to capture last transcript turn
      this._stopTranscriptPoll();
      this._pollTranscript();

      // Reset widget for next call
      this.removeWidget();

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

    // ── Transcript polling ────────────────────────────────────────────────────
    // Polls the backend every 3 seconds while call is active.
    // Backend fetches transcript from ElevenLabs API and saves new turns to
    // the Chatwoot conversation as messages. Widget syncs them in real-time.
    _startTranscriptPoll() {
      this._stopTranscriptPoll();
      this._transcriptPollInterval = setInterval(() => {
        this._pollTranscript();
      }, 3000);
    },

    _stopTranscriptPoll() {
      if (this._transcriptPollInterval) {
        clearInterval(this._transcriptPollInterval);
        this._transcriptPollInterval = null;
      }
    },

    async _pollTranscript() {
      try {
        const url = buildConvUrl(
          `/api/v1/widget/conversations/voice_transcript_poll?synced_count=${this._syncedCount}&last_conv_id=${this._lastConvId || ''}`
        );
        const { data } = await API.get(url);

        if (!data) return;

        // Update synced count so we don't re-save old turns
        if (data.total_count !== undefined) {
          this._syncedCount = data.total_count;
        }
        if (data.conversation_id) {
          this._lastConvId = data.conversation_id;
        }

        // New turns were saved by backend — sync to widget messages
        if (data.turns?.length > 0) {
          console.log(`[VOICE] ${data.turns.length} new transcript turns saved`);
          try {
            await this.$store.dispatch('conversation/syncLatestMessages');
          } catch (_) {}
        }
      } catch (e) {
        // Silently ignore — polling will retry on next interval
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
      <!-- Connecting → spinner -->
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
          cx="12" cy="12" r="10"
          stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-dasharray="31.4 31.4"
          fill="none"
        />
      </svg>

      <!-- Idle → phone + AI icon -->
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
          d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24
             1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17
             0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"
          fill="#F87171" stroke="#DC2626" stroke-width="0.5"
        />
        <rect x="10" y="1" width="12" height="9" rx="2" fill="#FDE68A" stroke="#F59E0B" stroke-width="0.5"/>
        <path d="M12 10L10 13L14 10H12Z" fill="#FDE68A" stroke="#F59E0B" stroke-width="0.3"/>
        <text x="16" y="7" font-size="5" font-weight="bold" fill="#3B82F6"
              text-anchor="middle" font-family="Arial, sans-serif">AI</text>
      </svg>
    </button>

    <!-- Hidden host for the ElevenLabs embed element -->
    <div ref="widgetHost" class="elevenlabs-hidden-widget" aria-hidden="true" />

    <!-- Floating "End Call" pill — visible while call is active -->
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

/* Hidden host: off-screen but still in the DOM so the embed can run */
.elevenlabs-hidden-widget {
  position: fixed;
  left: -10000px;
  top: -10000px;
  width: 1px;
  height: 1px;
  overflow: hidden;
  pointer-events: none;
}

/* Floating end-call pill */
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
