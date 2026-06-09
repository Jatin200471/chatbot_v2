<script>
import { mapGetters, mapActions } from 'vuex';
import configMixin from '../mixins/configMixin';
import { API, WEBSITE_TOKEN } from 'widget/helpers/axios';
import { emitter } from 'shared/helpers/mitt';

/**
 * Voice button — official @elevenlabs/convai-widget-embed integration.
 *
 * Architecture:
 *   • We use the OFFICIAL ElevenLabs Web Component (<elevenlabs-convai>)
 *     because it's battle-tested for audio, navigation, and reconnect.
 *   • Mount it off-screen (hidden) and trigger its built-in buttons
 *     programmatically — visitor only sees OUR voice icon in the
 *     ChatInputWrap (matches Chatwoot's design language).
 *   • For PRIVATE agents we fetch a short-lived signed URL from our
 *     backend so the agent_id is never exposed in the page HTML.
 *   • Transcripts are persisted via backend polling
 *     (/api/v1/widget/conversations/voice_transcript_poll) which queries
 *     ElevenLabs directly and writes messages into the Chatwoot
 *     conversation — works even when the visitor disconnects mid-call.
 *
 * Page-change behavior:
 *   • sdk-floating-btn.js intercepts <a> clicks while a call is active
 *     and does SPA-style navigation — the iframe (and the widget inside)
 *     are NEVER destroyed, so the call continues seamlessly.
 *   • For true hard refresh (F5), the saved signed URL in sessionStorage
 *     + voice_history-based prompt override let the new session pick up
 *     the previous conversation in the visitor's NEXT spoken turn.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const buildConvUrl = path => {
  if (!WEBSITE_TOKEN) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}website_token=${WEBSITE_TOKEN}`;
};

const vLog = (...args) => {
  try {
    if (localStorage.getItem('cw_voice_debug') === 'true') console.log('[VOICE]', ...args);
  } catch (_) {}
};

// ─────────────────────────────────────────────────────────────────────────────
// Session persistence — only for F5 fallback
// (Link-click navigation is handled by sdk-floating-btn.js SPA interceptor.)
// ─────────────────────────────────────────────────────────────────────────────
const SESSION_CALL_KEY = 'cw_voice_session_data';
const SESSION_TTL_MS   = 5 * 60 * 1000;

function saveCallToSession(signedUrl) {
  try {
    sessionStorage.setItem(SESSION_CALL_KEY, JSON.stringify({
      isActive: true, signedUrl, timestamp: Date.now(),
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
  } catch (_) { return null; }
}
function clearSessionCall() {
  try { sessionStorage.removeItem(SESSION_CALL_KEY); } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Singletons — survive Vue component re-mounts within same iframe load
// ─────────────────────────────────────────────────────────────────────────────
let _scriptLoadPromise = null;

function loadElevenLabsScript() {
  if (_scriptLoadPromise) return _scriptLoadPromise;
  if (document.querySelector('script[src*="@elevenlabs/convai-widget-embed"]')) {
    _scriptLoadPromise = Promise.resolve();
    return _scriptLoadPromise;
  }
  _scriptLoadPromise = new Promise(resolve => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/@elevenlabs/convai-widget-embed';
    s.async = true;
    s.type = 'text/javascript';
    s.onload  = () => resolve();
    s.onerror = () => resolve(); // don't break the widget if CDN is blocked
    document.head.appendChild(s);
  });
  return _scriptLoadPromise;
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
      widgetElement: null,
      _transcriptTimer: null,
      _syncedCount: 0,
      _lastConvId: '',
    };
  },

  computed: {
    ...mapGetters({
      isVoiceAgentEnabled: 'voiceAgentConfig/isVoiceAgentEnabled',
      voiceAgentProvider:  'voiceAgentConfig/getVoiceAgentProvider',
      widgetColor:         'appConfig/getWidgetColor',
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
    // Preload the SDK so the click-to-start is snappy
    if (this.hasElevenLabsVoiceEnabled) {
      loadElevenLabsScript();
    }

    // Resume after hard page reload (sessionStorage flag)
    const sessionCall = getSessionCall();
    if (sessionCall?.signedUrl) {
      vLog('Found session — auto-resuming call after page reload…');
      // Defer slightly so configMixin/store are ready
      setTimeout(() => this._resumeCall(sessionCall.signedUrl), 300);
    }

    emitter.on('end-voice-call', this.endCall);
  },

  beforeUnmount() {
    emitter.off('end-voice-call', this.endCall);
    this._stopTranscriptPoll();
    this._removeWidget();
  },

  methods: {
    ...mapActions('elevenlabsVoice', ['setActive', 'setConnecting']),

    handleClick() {
      if (this.isConnecting) return;
      this.isCallActive ? this.endCall() : this.startCall();
    },

    // ── Start a new voice call ──────────────────────────────────────────
    async startCall() {
      if (!this.hasElevenLabsVoiceEnabled) return;

      this.isConnecting = true;
      this.setConnecting(true);

      try {
        // 1. Mic permission MUST be requested in the page context
        if (navigator.mediaDevices?.getUserMedia) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(t => t.stop());
          } catch (micErr) {
            console.error('[VOICE] Mic permission denied:', micErr?.message);
            throw micErr;
          }
        }

        // 2. Fetch short-lived signed URL (agent_id stays server-side)
        const { data } = await API.get(
          buildConvUrl('/api/v1/widget/conversations/voice_signed_url')
        );
        const signedUrl = data?.signed_url;
        if (!signedUrl) throw new Error('Backend returned no signed_url');

        // 3. Save to session so hard refresh can reconnect
        saveCallToSession(signedUrl);
        try { localStorage.setItem('cw_voice_active', '1'); } catch (_) {}

        // 4. Load + mount the official ElevenLabs widget (off-screen)
        await loadElevenLabsScript();
        this._mountWidget(signedUrl);

        // 5. Trigger its internal start-call button programmatically
        //    Give the widget ~250ms to render its shadow DOM first
        setTimeout(() => {
          const ok = this._clickWidgetButton({ preferEnd: false });
          if (!ok) {
            vLog('Widget button not found — retrying once');
            setTimeout(() => this._clickWidgetButton({ preferEnd: false }), 500);
          }
        }, 250);

        // 6. Optimistic UI — backend poll will save transcripts
        this.isConnecting = false;
        this.setConnecting(false);
        this.isCallActive = true;
        this.setActive(true);

        // 7. Start polling backend for transcript turns
        this._startTranscriptPoll();

        vLog('Call started ✓');
      } catch (error) {
        console.error('[VOICE] startCall failed:', error?.message || error);
        this.isConnecting = false;
        this.setConnecting(false);
        this.setActive(false);
        clearSessionCall();
        try { localStorage.setItem('cw_voice_active', '0'); } catch (_) {}
        this._removeWidget();
        if (error?.name === 'NotAllowedError' || error?.name === 'NotFoundError') {
          alert(this.$t('VOICE_AGENT.MICROPHONE_ACCESS'));
        }
      }
    },

    // ── End the call ────────────────────────────────────────────────────
    endCall() {
      // Click the widget's internal end button (best effort)
      this._clickWidgetButton({ preferEnd: true });

      // Stop polling + clear state
      this._stopTranscriptPoll();

      this.isCallActive = false;
      this.isConnecting = false;
      this.setActive(false);
      this.setConnecting(false);

      clearSessionCall();
      try { localStorage.setItem('cw_voice_active', '0'); } catch (_) {}

      // Tell backend to reset auto-resolve timer
      API.post(
        buildConvUrl('/api/v1/widget/conversations/voice_call_ended'), {}
      ).catch(() => {});

      // Remove widget DOM (kills any lingering "rating" UI from ElevenLabs)
      this._removeWidget();

      // Close the entire chat panel so visitor doesn't see post-call UI
      this._closeWidgetPanel();
    },

    // ── Close the Chatwoot widget panel (visitor-side) ──────────────────
    // We try every known close signal because Chatwoot SDK versions vary in
    // how they expose the toggle. Most setups respect at least one of these.
    _closeWidgetPanel() {
      // 1. Internal emitter (most modern Chatwoot widget code)
      try { emitter.emit('close-widget'); } catch (_) {}
      try { emitter.emit('chatwoot:toggle'); } catch (_) {}

      // 2. Vuex action — flip isWidgetOpen to false
      try { this.$store.dispatch('appConfig/setIsWidgetOpen', false); } catch (_) {}

      // 3. postMessage to parent — sdk.js listens and toggles the iframe
      const closeMessages = [
        { event: 'toggle-bubble' },
        { event: 'close-widget' },
        'chatwoot-widget:close-widget',
        'chatwoot-widget:toggle-close',
      ];
      closeMessages.forEach(msg => {
        try { window.parent.postMessage(msg, '*'); } catch (_) {}
      });

      // 4. Last resort — call $chatwoot on parent if accessible
      try {
        if (window.parent.$chatwoot && typeof window.parent.$chatwoot.toggle === 'function') {
          window.parent.$chatwoot.toggle('close');
        }
      } catch (_) {}

      // Mark widget as closed in localStorage so it doesn't auto-reopen
      try { localStorage.setItem('cw_widget_open', 'false'); } catch (_) {}
    },

    // ── Resume after hard refresh ───────────────────────────────────────
    async _resumeCall(signedUrl) {
      if (!this.hasElevenLabsVoiceEnabled) return;
      this.isConnecting = true;
      this.setConnecting(true);
      this.isCallActive = true;
      this.setActive(true);
      try { localStorage.setItem('cw_voice_active', '1'); } catch (_) {}

      try {
        await loadElevenLabsScript();
        this._mountWidget(signedUrl);
        setTimeout(() => this._clickWidgetButton({ preferEnd: false }), 300);
        this._startTranscriptPoll();
        this.isConnecting = false;
        this.setConnecting(false);
      } catch (e) {
        console.error('[VOICE] resume failed:', e?.message);
        this.endCall();
      }
    },

    // ── Widget DOM management ───────────────────────────────────────────
    _mountWidget(signedUrl) {
      const host = this.$refs.widgetHost;
      if (!host) return;

      // Re-use existing widget element if present
      if (this.widgetElement) {
        this.widgetElement.setAttribute('signed-url', signedUrl);
        return;
      }

      const el = document.createElement('elevenlabs-convai');
      el.setAttribute('signed-url', signedUrl);
      el.setAttribute('data-chatwoot', 'true');

      // ── Theme tokens via CSS custom properties ──────────────────────
      // The widget reads these to color its primary button, animations, etc.
      // Setting them on the element (and globally below) lets the widget
      // pick up the Chatwoot widget color automatically.
      const color = this.widgetColor || this.color || '#1f93ff';
      [
        '--el-color-primary',
        '--el-primary',
        '--elc-color-primary',
        '--convai-color-primary',
        '--brand-color',
      ].forEach(v => el.style.setProperty(v, color));

      host.appendChild(el);
      this.widgetElement = el;

      // ── Inject Chatwoot-styled CSS into the widget's shadow DOM ─────
      // The widget renders inside a closed-ish Shadow DOM; we wait for it
      // to attach, then push a <style> tag in to override branding bits.
      this._injectShadowStyles(el, color);

      // ── Watch for the widget portaling itself to <body> ─────────────
      // ElevenLabs sometimes injects floating UI into document.body
      // independently of our host. Apply the same theme there too.
      this._observePortaledWidget(color);

      // ── Listen for the call-ended signal from inside shadow DOM ─────
      // The rating screen ("How was this conversation?") appears after
      // the widget ends a call — we close the chat panel BEFORE the user
      // ever sees it.
      this._watchForCallEndedInside(el);
    },

    _injectShadowStyles(el, color) {
      const tryInject = (attempt = 0) => {
        const root = el.shadowRoot;
        if (!root) {
          if (attempt < 20) setTimeout(() => tryInject(attempt + 1), 150);
          return;
        }
        if (root.querySelector('style[data-cw-injected]')) return;

        const style = document.createElement('style');
        style.setAttribute('data-cw-injected', 'true');
        style.textContent = `
          /* ── Chatwoot brand integration ── */
          :host, * {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI',
                         Roboto, 'Helvetica Neue', Arial, sans-serif !important;
          }

          /* Primary brand color — applied via common variable names */
          :host {
            --el-color-primary: ${color} !important;
            --el-primary: ${color} !important;
            --convai-color-primary: ${color} !important;
            --brand-color: ${color} !important;
          }

          /* Hide ElevenLabs branding footer ("Powered by ElevenAgents") */
          [class*="powered"], [class*="branding"], [class*="footer"],
          a[href*="elevenlabs"], a[href*="elevenagents"] {
            display: none !important;
          }

          /* Hide the post-call rating screen — we close the panel anyway */
          [class*="rating"], [class*="feedback"], [class*="review"],
          [class*="stars"] {
            display: none !important;
          }

          /* Hide the fullscreen-expand arrow (top-right of widget) */
          [class*="expand"], [class*="fullscreen"], [aria-label*="expand"i] {
            display: none !important;
          }
        `;
        root.appendChild(style);
      };
      tryInject();
    },

    _observePortaledWidget(color) {
      if (this._portalObserver) return;
      const apply = (node) => {
        if (!node || node.nodeType !== 1) return;
        const tag = (node.tagName || '').toLowerCase();
        // Apply theme to any elevenlabs-convai element added anywhere
        if (tag === 'elevenlabs-convai') {
          [
            '--el-color-primary', '--el-primary', '--elc-color-primary',
            '--convai-color-primary', '--brand-color',
          ].forEach(v => node.style.setProperty(v, color));
          this._injectShadowStyles(node, color);
        }
      };
      this._portalObserver = new MutationObserver(mutations => {
        mutations.forEach(m => m.addedNodes.forEach(apply));
      });
      this._portalObserver.observe(document.body, { childList: true, subtree: true });
    },

    _watchForCallEndedInside(el) {
      // Poll shadow root for the rating/feedback screen → once it appears
      // we close the Chatwoot widget panel so the visitor never sees it.
      const checkInterval = setInterval(() => {
        if (!this.widgetElement) {
          clearInterval(checkInterval);
          return;
        }
        const root = el.shadowRoot;
        if (!root) return;
        // Look for typical end-of-call markers
        const html = root.innerHTML || '';
        const sawRating =
          /how was|rate|rating|stars|feedback|you ended the conversation/i.test(html);
        if (sawRating && this.isCallActive) {
          clearInterval(checkInterval);
          this._closeWidgetPanel();
          this.endCall();
        }
      }, 600);
      this._endedWatcher = checkInterval;
    },

    _removeWidget() {
      if (this.widgetElement) {
        try { this.widgetElement.remove(); } catch (_) {}
        this.widgetElement = null;
      }
      // Stop watching the shadow DOM
      if (this._endedWatcher) {
        clearInterval(this._endedWatcher);
        this._endedWatcher = null;
      }
      if (this._portalObserver) {
        try { this._portalObserver.disconnect(); } catch (_) {}
        this._portalObserver = null;
      }
      // Also kill any portaled <elevenlabs-convai> instances on <body>
      document.querySelectorAll('elevenlabs-convai').forEach(el => {
        try { el.remove(); } catch (_) {}
      });
    },

    // Heuristic — find the widget's internal Start/End button inside its
    // shadow DOM and click it. The widget renders different button labels
    // depending on state, so we filter by text content.
    _clickWidgetButton({ preferEnd = false } = {}) {
      const el = this.widgetElement;
      if (!el) return false;
      const root = el.shadowRoot;
      if (!root) return false;

      const buttons = Array.from(root.querySelectorAll('button'));
      if (!buttons.length) return false;

      const pick = btn => {
        const text = (btn.textContent || '').toLowerCase();
        if (preferEnd) return text.includes('end') || text.includes('hang') || text.includes('stop');
        return text.includes('start') || text.includes('call') || text.includes('talk');
      };
      const target = buttons.find(pick) || buttons[0];
      try { target.click(); return true; } catch (_) { return false; }
    },

    // ── Backend transcript polling ──────────────────────────────────────
    // Backend's voice_transcript_poll endpoint queries the ElevenLabs API
    // for the latest conversation turns and saves new ones into our DB.
    // Works even if widget events fail or visitor disconnects abruptly.
    _startTranscriptPoll() {
      this._stopTranscriptPoll();
      this._syncedCount = 0;
      this._lastConvId  = '';
      // First poll after 3s, then every 4s
      this._transcriptTimer = setInterval(() => {
        this._pollTranscript();
      }, 4000);
      setTimeout(() => this._pollTranscript(), 3000);
    },

    _stopTranscriptPoll() {
      if (this._transcriptTimer) {
        clearInterval(this._transcriptTimer);
        this._transcriptTimer = null;
      }
    },

    async _pollTranscript() {
      if (!this.isCallActive) return;
      try {
        const url = buildConvUrl(
          `/api/v1/widget/conversations/voice_transcript_poll` +
          `?synced_count=${this._syncedCount}&last_conv_id=${encodeURIComponent(this._lastConvId)}`
        );
        const { data } = await API.get(url);
        if (data?.conversation_id) this._lastConvId = data.conversation_id;
        if (typeof data?.total_count === 'number') this._syncedCount = data.total_count;
        if (data?.turns?.length) {
          vLog(`Saved ${data.turns.length} new transcript turn(s)`);
        }
      } catch (e) {
        vLog('transcript poll failed:', e?.response?.status, e?.message);
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

    <!-- The official ElevenLabs widget lives here, OFF-SCREEN. We control
         it programmatically via its internal Start/End buttons so the
         visitor only ever sees OUR phone icon above. -->
    <div ref="widgetHost" class="elevenlabs-hidden-widget" aria-hidden="true" />
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

/* Off-screen host for the <elevenlabs-convai> web component.
   The element itself can paint its own UI; we tuck it out of view. */
.elevenlabs-hidden-widget {
  position: fixed;
  left: -10000px;
  top:  -10000px;
  width: 1px;
  height: 1px;
  overflow: hidden;
  pointer-events: none;
}
</style>
