<script>
import { mapGetters, mapActions } from 'vuex';
import configMixin from '../mixins/configMixin';
import { API, WEBSITE_TOKEN } from 'widget/helpers/axios';
import { emitter } from 'shared/helpers/mitt';

/**
 * Voice button — popup mode.
 *
 * Instead of running the ElevenLabs SDK inside the widget iframe (which gets
 * destroyed on every parent-page hard refresh), we open a separate popup
 * window that hosts the call. The popup is its own browsing context so it
 * survives parent navigation / F5 / URL changes completely intact.
 *
 * Wire protocol:
 *   popup → window.opener (this iframe) via postMessage
 *   popup → window.opener.parent (the page) via postMessage
 *   popup → BroadcastChannel('cw-voice') heartbeat (same-origin)
 *   this iframe → window.parent (the page) via postMessage (for hide/show)
 */

// URL helper — appends website_token to API requests
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

// Module-level so the popup reference survives Vue re-mounts within the
// same iframe load. On a hard parent-page refresh the iframe is destroyed,
// _popupRef is gone, and we rely on the heartbeat in localStorage +
// BroadcastChannel to re-detect the popup.
let _popupRef = null;
let _broadcast = null;

const HEARTBEAT_KEY        = 'cw_voice_popup_heartbeat';
const HEARTBEAT_MAX_AGE_MS = 4000; // older than this = popup considered dead

function isPopupAlive() {
  if (_popupRef && !_popupRef.closed) return true;
  // Even if we lost the direct reference, an alive popup writes a heartbeat
  try {
    const last = parseInt(localStorage.getItem(HEARTBEAT_KEY) || '0', 10);
    if (last && Date.now() - last < HEARTBEAT_MAX_AGE_MS) return true;
  } catch (_) {}
  return false;
}

function getBroadcastChannel() {
  if (_broadcast) return _broadcast;
  try {
    _broadcast = new BroadcastChannel('cw-voice');
  } catch (_) {
    _broadcast = null;
  }
  return _broadcast;
}

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
    // ── Cross-window listeners ───────────────────────────────────────────
    window.addEventListener('message', this.onWindowMessage);
    emitter.on('end-voice-call', this.endCall);

    const ch = getBroadcastChannel();
    if (ch) {
      ch.addEventListener('message', this.onBroadcastMessage);
      // After a parent-page refresh, our _popupRef is gone. Ping the channel
      // so an alive popup will respond with a heartbeat and we can re-sync.
      try { ch.postMessage({ type: 'ping' }); } catch (_) {}
    }

    // ── Detect popup-alive on mount (handles parent hard refresh) ────────
    // Check synchronously via heartbeat in localStorage, then again after
    // a short delay to catch BroadcastChannel responses to our ping.
    if (isPopupAlive()) this._syncCallActiveFromPopup();
    this._popupSyncTimer = setTimeout(() => {
      if (isPopupAlive() && !this.isCallActive) this._syncCallActiveFromPopup();
    }, 600);
  },

  beforeUnmount() {
    window.removeEventListener('message', this.onWindowMessage);
    emitter.off('end-voice-call', this.endCall);
    const ch = getBroadcastChannel();
    if (ch) ch.removeEventListener('message', this.onBroadcastMessage);
    if (this._popupSyncTimer) clearTimeout(this._popupSyncTimer);
  },

  methods: {
    ...mapActions('elevenlabsVoice', ['setActive', 'setConnecting']),

    handleClick() {
      if (this.isConnecting) return;
      if (this.isCallActive && _popupRef && !_popupRef.closed) {
        // Focus the existing popup instead of opening a new one
        try { _popupRef.focus(); } catch (_) {}
        return;
      }
      this.isCallActive ? this.endCall() : this.startCall();
    },

    // ── Open the popup window and start the call ─────────────────────────
    //
    // CRITICAL: window.open() must be called SYNCHRONOUSLY inside the click
    // handler — no `await` allowed before it. If we `await` for the signed
    // URL first, the browser thinks the gesture has expired and either
    // blocks the popup entirely OR opens it as a tab (Chrome 119+).
    //
    // Solution: open the popup IMMEDIATELY with a loading splash page,
    // then fetch the signed URL asynchronously and navigate the popup to
    // the real URL once we have it.
    startCall() {
      if (!this.hasElevenLabsVoiceEnabled) return;

      this.isConnecting = true;
      this.setConnecting(true);

      // ── STEP 1: SYNCHRONOUS window.open (preserves user-gesture) ──────
      const w = 380, h = 620;
      const left = Math.max(0, Math.round((screen.availWidth  - w) / 2));
      const top  = Math.max(0, Math.round((screen.availHeight - h) / 2));
      const features = [
        'popup=yes',          // FORCE popup window mode (NOT tab) — Chrome 119+
        `width=${w}`,
        `height=${h}`,
        `left=${left}`,
        `top=${top}`,
        'resizable=yes',
        'scrollbars=no',
        'toolbar=no',
        'location=no',
        'status=no',
        'menubar=no',
        'noopener=no',        // we NEED window.opener for postMessage
        'noreferrer=no',
      ].join(',');

      // Open synchronously with about:blank — we'll navigate it to the real
      // popup URL in a moment, after fetching the signed URL.
      _popupRef = window.open('about:blank', 'cwVoiceCall', features);

      if (!_popupRef) {
        this.isConnecting = false;
        this.setConnecting(false);
        alert('Popup blocked — please allow popups for this site to start a voice call.');
        return;
      }

      // Show a brief loading state in the popup so the user knows
      // something is happening while we fetch the signed URL.
      try {
        _popupRef.document.write(
          `<!DOCTYPE html><html><head><title>Voice Call</title>
           <style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif;
             background:#f8fafc;color:#64748b;display:grid;place-items:center;height:100vh;}
             .loader{text-align:center;}
             .spinner{width:32px;height:32px;border:3px solid #e2e8f0;
               border-top-color:#1f93ff;border-radius:50%;
               animation:spin .8s linear infinite;margin:0 auto 12px;}
             @keyframes spin{to{transform:rotate(360deg);}}</style></head>
           <body><div class="loader"><div class="spinner"></div>Connecting…</div></body></html>`
        );
      } catch (_) {}

      // ── STEP 2: ASYNC — fetch signed URL, then navigate popup ─────────
      this._completeStartCall(_popupRef);
    },

    async _completeStartCall(popup) {
      try {
        // Fetch fresh signed URL (agent_id stays server-side)
        const { data } = await API.get(
          buildConvUrl('/api/v1/widget/conversations/voice_signed_url')
        );
        const signedUrl = data?.signed_url;
        if (!signedUrl) throw new Error('Backend returned no signed_url');

        // Read widget config for the popup look & feel
        const cfg = window.chatwootWebChannel || {};
        const popupParams = new URLSearchParams({
          signed_url:      signedUrl,
          website_token:   WEBSITE_TOKEN || '',
          base_url:        window.location.origin,
          color:           this.widgetColor || cfg.widgetColor || this.color || '#1f93ff',
          avatar:          cfg.avatarUrl || '',
          agent_name:      cfg.websiteName || 'AI Assistant',
          agent_role:      'Voice Assistant',
          brand:           cfg.websiteName || '',
          auth_token:      window.authToken || '',
          cw_conversation: this.getCwConversationToken() || '',
        });

        const popupUrl = `${window.location.origin}/voice-popup.html?${popupParams.toString()}`;

        // Check popup is still alive (user might have closed it)
        if (!popup || popup.closed) {
          throw new Error('Popup was closed before signed URL arrived');
        }

        // Navigate the already-open popup to the real URL
        popup.location.href = popupUrl;
        try { popup.focus(); } catch (_) {}

        // Notify parent page to hide the widget while the popup is up
        this.notifyParentWidgetHide(true);

        // Flag voice-active so sdk-floating-btn.js intercepts navigation
        try { localStorage.setItem('cw_voice_active', '1'); } catch (_) {}

        // Optimistically reflect active state — popup confirms via msg
        this.isConnecting = false;
        this.setConnecting(false);
        this.isCallActive = true;
        this.setActive(true);

        vLog('Popup navigated to ✓', popupUrl);
      } catch (error) {
        console.error('[VOICE] startCall error:', error?.message || error);
        this.isConnecting = false;
        this.setConnecting(false);
        this.setActive(false);
        try { localStorage.setItem('cw_voice_active', '0'); } catch (_) {}
        try {
          if (popup && !popup.closed) {
            popup.document.write(
              '<p style="font-family:Arial;padding:20px;color:#ef4444;">' +
              'Failed to start voice call: ' + (error?.message || 'unknown') + '</p>'
            );
            setTimeout(() => { try { popup.close(); } catch (_) {} }, 2500);
          }
        } catch (_) {}
        if (error?.name === 'NotAllowedError' || error?.name === 'NotFoundError') {
          alert(this.$t('VOICE_AGENT.MICROPHONE_ACCESS'));
        }
      }
    },

    // ── End the call (closes the popup) ─────────────────────────────────
    endCall() {
      // Path 1 — we still have the direct popup reference (same iframe load)
      if (_popupRef && !_popupRef.closed) {
        try {
          _popupRef.postMessage({ source: 'cw-widget', event: 'request-end-call' }, '*');
        } catch (_) {}
        setTimeout(() => {
          if (_popupRef && !_popupRef.closed) {
            try { _popupRef.close(); } catch (_) {}
          }
        }, 1500);
      }

      // Path 2 — parent was refreshed, no direct ref but popup is alive via
      // heartbeat. Use BroadcastChannel to ask it to end (same origin).
      const ch = getBroadcastChannel();
      if (ch) {
        try { ch.postMessage({ type: 'request-end-call' }); } catch (_) {}
      }

      this.resetCallState();
    },

    resetCallState() {
      _popupRef = null;
      this.isCallActive = false;
      this.isConnecting = false;
      this.setActive(false);
      this.setConnecting(false);
      try { localStorage.setItem('cw_voice_active', '0'); } catch (_) {}
      this.notifyParentWidgetHide(false);
    },

    // ── Reflect "popup is alive" state into the widget UI ───────────────
    _syncCallActiveFromPopup() {
      if (this.isCallActive) return;
      vLog('Detected alive popup via heartbeat — syncing UI to active');
      this.isCallActive = true;
      this.isConnecting = false;
      this.setActive(true);
      this.setConnecting(false);
      try { localStorage.setItem('cw_voice_active', '1'); } catch (_) {}
      this.notifyParentWidgetHide(true);
    },

    // ── BroadcastChannel messages from the popup ────────────────────────
    onBroadcastMessage(e) {
      const m = e?.data;
      if (!m || typeof m !== 'object') return;
      if (m.type === 'heartbeat') {
        if (!this.isCallActive) this._syncCallActiveFromPopup();
      } else if (m.type === 'ended') {
        this.resetCallState();
      }
    },

    // ── Cross-window messages from the popup ────────────────────────────
    onWindowMessage(e) {
      const data = e?.data;
      if (!data || typeof data !== 'object') return;
      if (data.source !== 'cw-voice-popup') return;

      switch (data.event) {
        case 'voice-popup-opened':
          vLog('popup says: opened');
          break;
        case 'voice-popup-connected':
          vLog('popup says: connected ✅');
          this.isCallActive = true;
          this.isConnecting = false;
          this.setActive(true);
          this.setConnecting(false);
          break;
        case 'voice-popup-transcript':
          vLog('popup transcript:', data.source, data.message);
          break;
        case 'voice-popup-error':
          console.error('[VOICE] popup error:', data.error);
          this.resetCallState();
          break;
        case 'voice-popup-ended':
        case 'voice-popup-closed':
          vLog('popup says: ended/closed');
          this.resetCallState();
          break;
      }
    },

    // ── Tell the parent page (sdk-floating-btn.js) to hide/show widget ──
    notifyParentWidgetHide(hide) {
      try {
        window.parent.postMessage({
          event: hide ? 'cw-voice-popup-opened' : 'cw-voice-popup-closed',
        }, '*');
      } catch (_) {}
    },

    // ── Grab the cw_conversation JWT so the popup can hit widget APIs ───
    getCwConversationToken() {
      try {
        const cookieMatch = document.cookie.match(/cw_conversation=([^;]+)/);
        if (cookieMatch) return decodeURIComponent(cookieMatch[1]);
      } catch (_) {}
      try {
        return localStorage.getItem('cw_conversation') || '';
      } catch (_) {
        return '';
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
