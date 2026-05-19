<script>
import { mapGetters, mapActions } from 'vuex';
import configMixin from '../mixins/configMixin';
import { API, WEBSITE_TOKEN } from 'widget/helpers/axios';

// ─────────────────────────────────────────────────────────────────────────────
// ElevenLabs Conversational AI integration.
//
// Why <elevenlabs-convai> instead of `@elevenlabs/client`:
//   The npm `@elevenlabs/client` (loaded via esm.sh) bundles LiveKit JS SDK 2.x
//   which negotiates with `protocol=17`. ElevenLabs' production LiveKit server
//   is still on protocol 16 → the WebRTC peer connection times out with
//   `NegotiationError: negotiation timed out` even though the signal channel
//   opens. The `<elevenlabs-convai>` CDN bundle ships its own older LiveKit
//   build that speaks protocol 16, so audio actually works.
//
// We mount the web component OFF-SCREEN and trigger / end calls by clicking
// the buttons inside its shadow DOM. The third-party floating "Need help?"
// bubble is hidden by aggressive CSS scoped to the host. The visitor only
// ever sees OUR call button.
//
// Transcript: ElevenLabs Convai Widget posts CustomEvents on its host element
// for each user / agent turn. We listen for those and POST them to Chatwoot's
// /voice_transcript endpoint so the chat history shows the spoken exchange.
// ─────────────────────────────────────────────────────────────────────────────

const CONVAI_EMBED_URL = 'https://unpkg.com/@elevenlabs/convai-widget-embed';
let convaiScriptPromise = null;
const loadConvaiScript = () => {
  if (convaiScriptPromise) return convaiScriptPromise;
  if (document.querySelector('script[src*="@elevenlabs/convai-widget-embed"]')) {
    convaiScriptPromise = Promise.resolve();
    return convaiScriptPromise;
  }
  convaiScriptPromise = new Promise(resolve => {
    const s = document.createElement('script');
    s.src = CONVAI_EMBED_URL;
    s.async = true;
    s.type = 'text/javascript';
    s.onload = resolve;
    s.onerror = resolve; // resolve anyway; button click will surface failure
    document.head.appendChild(s);
  });
  return convaiScriptPromise;
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
    color: { type: String, default: '#1f93ff' },
    size:  { type: String, default: 'medium' },
  },
  data() {
    return {
      isConnecting: false,
      isCallActive: false,
      widgetElement: null,
      transcriptHandler: null,
      micStream: null,
    };
  },
  computed: {
    ...mapGetters({
      isVoiceAgentEnabled: 'voiceAgentConfig/isVoiceAgentEnabled',
      voiceAgentAgentId:   'voiceAgentConfig/getAgentId',
      voiceAgentProvider:  'voiceAgentConfig/getVoiceAgentProvider',
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
        small:  'min-h-7 min-w-7',
        medium: 'min-h-9 min-w-9',
        large:  'min-h-10 min-w-10',
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
  watch: {
    resolvedAgentId() { this.ensureWidgetMounted(); },
    hasElevenLabsVoiceEnabled(enabled) {
      if (!enabled) {
        if (this.isCallActive) this.endCall();
        this.removeWidget();
      } else {
        loadConvaiScript().then(() => this.ensureWidgetMounted());
      }
    },
  },
  mounted() {
    if (this.hasElevenLabsVoiceEnabled) {
      loadConvaiScript().then(() => this.ensureWidgetMounted());
    }
  },
  beforeUnmount() {
    this.stopAllMediaTracks();
    this.removeWidget();
  },
  methods: {
    ...mapActions('elevenlabsVoice', ['setActive', 'setConnecting']),

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

      // Listen for transcript turns. The convai web component fires custom
      // events with `{ source: 'user'|'ai', message }` once per completed
      // turn. We forward each chunk to /voice_transcript so it lands in
      // the Chatwoot conversation history.
      this.transcriptHandler = ev => {
        const d = ev?.detail || {};
        const raw = d.source || d.role || '';
        const source = raw === 'user' ? 'user'
                     : (raw === 'ai' || raw === 'assistant' || raw === 'agent') ? 'ai'
                     : null;
        if (!source) return;
        const content = d.message || d.text || d.content;
        this._postTranscript(source, content);
      };
      ['convai-message', 'message', 'transcript'].forEach(name =>
        el.addEventListener(name, this.transcriptHandler)
      );
    },

    clickWidgetButton({ preferEnd = false } = {}) {
      const el = this.widgetElement;
      if (!el?.shadowRoot) return false;
      const buttons = Array.from(el.shadowRoot.querySelectorAll('button'));
      if (!buttons.length) return false;
      const matchEnd = btn => {
        const text = (btn.textContent || '').toLowerCase();
        const label = (btn.getAttribute('aria-label') || '').toLowerCase();
        const title = (btn.getAttribute('title') || '').toLowerCase();
        const combined = `${text} ${label} ${title}`;
        return /(end|hang|stop|close|disconnect)/.test(combined);
      };
      const matchStart = btn => {
        const text = (btn.textContent || '').toLowerCase();
        const label = (btn.getAttribute('aria-label') || '').toLowerCase();
        const title = (btn.getAttribute('title') || '').toLowerCase();
        const combined = `${text} ${label} ${title}`;
        return /(start|call|begin|talk)/.test(combined);
      };
      // For END: never fall back to a random button — clicking the wrong one
      // (e.g. buttons[0] = Start) would RESTART the call we just tried to end.
      // Return false so endCall() falls through to forcibly removing the element.
      if (preferEnd) {
        const target = buttons.find(matchEnd);
        if (!target) return false;
        target.click();
        return true;
      }
      // For START: fall back to first button only if nothing matches — older
      // bundles render an unlabeled icon button as the only entry point.
      const target = buttons.find(matchStart) || buttons[0];
      target.click();
      return true;
    },

    stopAllMediaTracks() {
      // 1. Stop the mic stream we explicitly requested in startCall().
      if (this.micStream) {
        try {
          this.micStream.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
        } catch (_) {}
        this.micStream = null;
      }
      // 2. Pause/mute any <audio> elements the embed mounted inside its shadow
      //    root — that's where the agent's voice is playing back. Without this
      //    the AI keeps talking for a moment after the WebRTC peer closes.
      const el = this.widgetElement;
      if (el?.shadowRoot) {
        const players = el.shadowRoot.querySelectorAll('audio, video');
        players.forEach(p => {
          try { p.pause(); } catch (_) {}
          try { p.muted = true; } catch (_) {}
          try {
            if (p.srcObject) {
              p.srcObject.getTracks?.().forEach(t => { try { t.stop(); } catch (_) {} });
              p.srcObject = null;
            }
          } catch (_) {}
          try { p.removeAttribute('src'); p.load?.(); } catch (_) {}
        });
      }
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
      if (this.isConnecting || this.isCallActive) return;
      if (!this.resolvedAgentId || !this.hasElevenLabsVoiceEnabled) return;

      this.isConnecting = true;
      this.setConnecting(true);

      try {
        if (navigator.mediaDevices?.getUserMedia) {
          // Keep a reference so we can stop these tracks on endCall — otherwise
          // the mic LED stays on and audio keeps streaming even after we tear
          // down the embed.
          this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
        await loadConvaiScript();
        this.ensureWidgetMounted();

        // Best-effort: click the embed's "Start call" button.
        const ok = this.clickWidgetButton({ preferEnd: false });
        if (!ok) {
          // The embed sometimes mounts asynchronously; retry once after a
          // short delay so the shadow DOM has time to render its buttons.
          setTimeout(() => this.clickWidgetButton({ preferEnd: false }), 250);
        }

        this.isConnecting = false;
        this.setConnecting(false);
        this.isCallActive = true;
        this.setActive(true);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[VOICE-AGENT] Failed to start call:', error);
        this.stopAllMediaTracks();
        this._cleanupSession();
        if (error?.name === 'NotAllowedError' || error?.name === 'NotFoundError') {
          alert(this.$t('VOICE_AGENT.MICROPHONE_ACCESS'));
        }
      }
    },

    endCall() {
      // The convai web component does NOT reliably close its WebSocket /
      // WebRTC session when we just "click the end button" inside its shadow
      // DOM. The previous implementation also tried a text-matched button
      // click that often resolved to the START button (icon-only END button
      // had no matching text), which RESTARTED the call. This version is
      // unforgiving — kill everything in this order, synchronously:
      //
      //   1. Call any public end method exposed on the element.
      //   2. Try to click a button that clearly looks like END (no fallback
      //      to "first button" — see clickWidgetButton).
      //   3. Stop our mic stream + any <audio>/<video> in the shadow DOM so
      //      the AI's voice cuts out immediately.
      //   4. Remove the custom element NOW (not after 300ms) — its
      //      disconnectedCallback closes the WebSocket + RTCPeerConnection.
      //
      // We deliberately do NOT remount here. The next startCall() will mount
      // a fresh embed; remounting eagerly was creating a second invisible
      // session that occasionally auto-started.
      const el = this.widgetElement;
      if (el) {
        try {
          ['endSession', 'endCall', 'disconnect', 'stop', 'close'].forEach(
            name => {
              if (typeof el[name] === 'function') {
                try { el[name](); } catch (_) {}
              }
            }
          );
        } catch (_) {}
        this.clickWidgetButton({ preferEnd: true });
      }

      this.stopAllMediaTracks();
      this.removeWidget();
      this._cleanupSession();
    },

    removeWidget() {
      if (this.widgetElement) {
        if (this.transcriptHandler) {
          ['convai-message', 'message', 'transcript'].forEach(name =>
            this.widgetElement.removeEventListener(name, this.transcriptHandler)
          );
        }
        this.widgetElement.remove();
        this.widgetElement = null;
      }
      this.transcriptHandler = null;
    },

    _cleanupSession() {
      this.isCallActive = false;
      this.isConnecting = false;
      this.setActive(false);
      this.setConnecting(false);
    },

    async _postTranscript(source, content) {
      const text = (content || '').toString().trim();
      if (!text) return;
      try {
        await API.post(
          buildConvUrl('/api/v1/widget/conversations/voice_transcript'),
          { source, content: text }
        );
        try { await this.$store.dispatch('conversation/syncLatestMessages'); } catch (_) {}
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[VOICE-AGENT] transcript post failed:', e?.message || e);
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
      <svg
        v-if="isConnecting"
        :width="iconSize"
        :height="iconSize"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        class="animate-spin"
      >
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2.5"
                stroke-linecap="round" stroke-dasharray="31.4 31.4" fill="none" />
      </svg>

      <!-- Active → hang-up icon -->
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
          transform="rotate(135 12 12)" />
      </svg>

      <!-- Idle → phone / call icon -->
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
          fill="currentColor" />
      </svg>
    </button>

    <!-- Off-screen host for the <elevenlabs-convai> embed. The embed sometimes
         re-portals its bubble UI to document.body anyway, which is why we
         ALSO inject a stylesheet that hides anything matching its host
         selector (see <style> below). -->
    <div ref="widgetHost" class="elevenlabs-hidden-host" aria-hidden="true" />
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

.call-icon { transition: transform 0.2s ease, filter 0.2s ease; }
.elevenlabs-connecting { opacity: 0.75; cursor: wait; color: var(--widget-color, #1f93ff); }

.elevenlabs-active {
  background: #ef4444 !important;
  color: #ffffff !important;
  box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.18);
  animation: pulse-active 1.6s ease-in-out infinite;
}
.elevenlabs-active:hover { background: #dc2626 !important; }

@keyframes pulse-active {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.45); }
  50%      { box-shadow: 0 0 0 8px rgba(239, 68, 68, 0.08); }
}

.elevenlabs-hidden-host {
  position: fixed;
  left: -10000px;
  top: -10000px;
  width: 1px;
  height: 1px;
  overflow: hidden;
  pointer-events: none;
}
</style>

<!-- Global override: kill any floating UI the convai embed renders outside
     our host. The embed sometimes appends nodes directly to document.body
     (a "Need help? / Start a call" bubble) even when its host element is
     off-screen. The selector targets only OUR instance via the data attr. -->
<style>
elevenlabs-convai[data-chatwoot] {
  position: fixed !important;
  left: -10000px !important;
  top: -10000px !important;
  width: 1px !important;
  height: 1px !important;
  overflow: hidden !important;
  pointer-events: none !important;
  opacity: 0 !important;
  visibility: hidden !important;
}
</style>
