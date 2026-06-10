<script>
import { mapGetters, mapActions } from 'vuex';
import configMixin from '../mixins/configMixin';
import { API, WEBSITE_TOKEN } from 'widget/helpers/axios';
import { emitter } from 'shared/helpers/mitt';

/**
 * Voice button — secure popup launcher.
 *
 *  • Opens /voice-popup.html in a small floating window
 *  • Delivers signedUrl + tokens via postMessage (NEVER in the URL)
 *  • The popup hosts the @11labs/client SDK call
 *  • Each transcript turn is POSTed to backend so the chat panel
 *    auto-shows live messages via Chatwoot's existing message-poll loop
 *  • End Call closes both the popup AND the chat widget panel
 */

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

// ── Module-level state survives Vue re-mounts within same iframe load ───
let _popupRef = null;
let _broadcast = null;
let _pendingConfigPromise = null;
let _pendingConfig = null;

const HEARTBEAT_KEY        = 'cw_voice_popup_heartbeat';
const HEARTBEAT_MAX_AGE_MS = 4000;

function isPopupAlive() {
  if (_popupRef && !_popupRef.closed) return true;
  try {
    const last = parseInt(localStorage.getItem(HEARTBEAT_KEY) || '0', 10);
    if (last && Date.now() - last < HEARTBEAT_MAX_AGE_MS) return true;
  } catch (_) {}
  return false;
}
function getBroadcastChannel() {
  if (_broadcast) return _broadcast;
  try { _broadcast = new BroadcastChannel('cw-voice'); }
  catch (_) { _broadcast = null; }
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
    shouldShowButton() { return this.hasElevenLabsVoiceEnabled; },
    buttonClasses() {
      const sizeMap = { small: 'min-h-7 min-w-7', medium: 'min-h-9 min-w-9', large: 'min-h-10 min-w-10' };
      return [
        'elevenlabs-voice-btn flex items-center justify-center rounded-full transition-all duration-200 cursor-pointer border-0 p-1.5',
        sizeMap[this.size] || sizeMap.medium,
        this.isConnecting ? 'elevenlabs-connecting' : '',
        this.isCallActive  ? 'elevenlabs-active'    : '',
      ];
    },
    iconSize() { return { small: 16, medium: 18, large: 22 }[this.size] || 18; },
    tooltipText() {
      if (this.isCallActive) return this.$t('VOICE_AGENT.END_CALL');
      if (this.isConnecting) return this.$t('VOICE_AGENT.CONNECTING');
      return this.$t('VOICE_AGENT.START_CALL');
    },
  },

  mounted() {
    window.addEventListener('message', this.onWindowMessage);
    emitter.on('end-voice-call', this.endCall);

    const ch = getBroadcastChannel();
    if (ch) {
      ch.addEventListener('message', this.onBroadcastMessage);
      try { ch.postMessage({ type: 'ping' }); } catch (_) {}
    }

    if (isPopupAlive()) this._syncCallActiveFromPopup();
    this._popupSyncTimer = setTimeout(() => {
      if (isPopupAlive() && !this.isCallActive) this._syncCallActiveFromPopup();
    }, 600);

    // Backend check — survives browser storage partitioning AND covers
    // the "user has voice call open in another tab" case. We poll every
    // 5 seconds while idle so any active call from this visitor reflects
    // immediately on whatever page they're currently viewing.
    this._checkBackendCallStatus();
    this._backendStatusPoll = setInterval(() => {
      this._checkBackendCallStatus();
    }, 5000);
  },

  beforeUnmount() {
    window.removeEventListener('message', this.onWindowMessage);
    emitter.off('end-voice-call', this.endCall);
    const ch = getBroadcastChannel();
    if (ch) ch.removeEventListener('message', this.onBroadcastMessage);
    if (this._popupSyncTimer) clearTimeout(this._popupSyncTimer);
    if (this._backendStatusPoll) clearInterval(this._backendStatusPoll);
  },

  methods: {
    ...mapActions('elevenlabsVoice', ['setActive', 'setConnecting']),

    handleClick() {
      if (this.isConnecting) return;
      if (this.isCallActive && _popupRef && !_popupRef.closed) {
        try { _popupRef.focus(); } catch (_) {}
        return;
      }
      this.isCallActive ? this.endCall() : this.startCall();
    },

    async startCall() {
      if (!this.hasElevenLabsVoiceEnabled) return;

      // Guard — if backend says a call is already active for this visitor
      // (e.g. they have the popup open on another page/tab), focus that
      // instead of starting a SECOND call.
      try {
        const { data } = await API.get(
          buildConvUrl('/api/v1/widget/conversations/voice_call_active')
        );
        if (data?.active) {
          vLog('Call already active for this visitor — refusing duplicate');
          this._syncCallActiveFromPopup();
          // Try to focus the existing popup if we have its reference
          if (_popupRef && !_popupRef.closed) {
            try { _popupRef.focus(); } catch (_) {}
          } else {
            alert('You already have a voice call open in another tab. Please end it there before starting a new one.');
          }
          return;
        }
      } catch (_) { /* network blip — proceed with call */ }

      this.isConnecting = true;
      this.setConnecting(true);

      // Detect mobile — popups behave poorly on phones (open as full tab).
      // On mobile we still open the same URL, but the popup CSS has a
      // dedicated mobile-fullscreen media query that scales the UI up so
      // it fills the screen comfortably.
      const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

      // Window size — generous enough that NOTHING gets cut off regardless
      // of browser chrome (Edge URL bar, Chrome dev-tools, etc.).
      // 320×500 leaves ~80px margin below the End Call button + brand line.
      const w = isMobile ? 280 : 320;
      const h = isMobile ? 580 : 500;
      const left = Math.max(0, Math.round((screen.availWidth  - w) / 2));
      const top  = Math.max(0, Math.round((screen.availHeight - h) / 2));
      const features = `popup=yes,width=${w},height=${h},left=${left},top=${top}`;

      const cleanUrl = `${window.location.origin}/voice-popup.html`;
      _popupRef = window.open(cleanUrl, 'cwVoiceCall', features);

      if (!_popupRef) {
        this.isConnecting = false;
        this.setConnecting(false);
        alert('Popup blocked — please allow popups for this site to start a voice call.');
        return;
      }
      try { _popupRef.focus(); } catch (_) {}

      _pendingConfigPromise = this._buildConfig();

      this.notifyParentWidgetHide(true);
      try { localStorage.setItem('cw_voice_active', '1'); } catch (_) {}

      this.isConnecting = false;
      this.setConnecting(false);
      this.isCallActive = true;
      this.setActive(true);

      vLog('Popup opened ✓ (clean URL, config via postMessage)');
    },

    endCall() {
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
      const ch = getBroadcastChannel();
      if (ch) { try { ch.postMessage({ type: 'request-end-call' }); } catch (_) {} }
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

    // Backend-driven call detection — works across browser storage
    // partitioning (iframe-vs-popup localStorage isolation) AND across
    // tabs (same visitor, different page → same backend state).
    async _checkBackendCallStatus() {
      try {
        const { data } = await API.get(
          buildConvUrl('/api/v1/widget/conversations/voice_call_active')
        );
        const popupHere = _popupRef && !_popupRef.closed;

        if (data?.active && !this.isCallActive) {
          // Backend says active, widget shows idle → sync to active
          vLog('Backend reports active call — syncing UI to active');
          this._syncCallActiveFromPopup();
        } else if (!data?.active && this.isCallActive && !popupHere) {
          // Backend says inactive AND we don't own the popup → call
          // ended elsewhere (other tab) → reset our UI to idle
          vLog('Backend reports inactive call — resetting UI');
          this.resetCallState();
        }
      } catch (e) {
        vLog('voice_call_active check failed:', e?.message);
      }
    },

    onBroadcastMessage(e) {
      const m = e?.data;
      if (!m || typeof m !== 'object') return;
      if (m.type === 'heartbeat') {
        if (!this.isCallActive) this._syncCallActiveFromPopup();
      } else if (m.type === 'ended') {
        this.resetCallState();
      }
    },

    onWindowMessage(e) {
      const data = e?.data;
      if (!data || typeof data !== 'object') return;
      if (data.source !== 'cw-voice-popup') return;

      switch (data.event) {
        case 'voice-popup-opened':
          vLog('popup says: opened');
          break;
        case 'voice-popup-request-config':
          vLog('popup requesting config…');
          this._sendConfigToPopup(e.source || _popupRef);
          break;
        case 'voice-popup-connected':
          vLog('popup says: connected ✅');
          this.isCallActive = true;
          this.isConnecting = false;
          this.setActive(true);
          this.setConnecting(false);
          break;
        case 'voice-popup-transcript':
          vLog('popup transcript →', data.source, data.message);
          try { this.$store.dispatch('conversation/fetchOldConversations'); } catch (_) {}
          try { this.$store.dispatch('message/fetchAllMessages'); } catch (_) {}
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

    notifyParentWidgetHide(hide) {
      // We DO NOT hide the Chatwoot widget while the popup is open —
      // the visitor needs to see the live transcript flowing into the
      // chat panel. We still send the event so the parent script can
      // flip its 'voice-active' state for SPA navigation interception.
      try {
        window.parent.postMessage({
          event: hide ? 'cw-voice-call-started' : 'cw-voice-call-ended',
        }, '*');
      } catch (_) {}
    },

    async _buildConfig() {
      const { data } = await API.get(
        buildConvUrl('/api/v1/widget/conversations/voice_signed_url')
      );
      const signedUrl = data?.signed_url;
      if (!signedUrl) throw new Error('Backend returned no signed_url');

      const ch = window.chatwootWebChannel || {};
      const config = {
        signedUrl,
        baseUrl:        window.location.origin,
        websiteToken:   WEBSITE_TOKEN || '',
        color:          this.widgetColor || ch.widgetColor || this.color || '#1f93ff',
        // Avatar: prefer the agent's own avatar (returned by backend),
        // fall back to the inbox avatar.
        avatar:         data?.avatar_url || ch.avatarUrl || '',
        // Center label — first ASSIGNED AGENT NAME (not inbox name)
        agentName:      data?.agent_name || ch.websiteName || 'AI Assistant',
        agentRole:      'Voice Assistant',
        // Footer brand — account name (e.g. "Visual Graphx"), not inbox name
        brand:          data?.brand_name || ch.websiteName || 'Voice Assistant',
        authToken:      window.authToken || '',
        cwConversation: this.getCwConversationToken() || '',
      };
      _pendingConfig = config;
      return config;
    },

    async _sendConfigToPopup(targetWindow) {
      try {
        const config = _pendingConfig
          || (_pendingConfigPromise && await _pendingConfigPromise)
          || await this._buildConfig();
        if (targetWindow && !targetWindow.closed) {
          targetWindow.postMessage(
            { source: 'cw-widget', event: 'config', config },
            '*'
          );
          vLog('Config sent to popup via postMessage ✓');
        }
      } catch (error) {
        console.error('[VOICE] Failed to build/send config:', error?.message);
        try {
          if (targetWindow && !targetWindow.closed) {
            targetWindow.postMessage(
              { source: 'cw-widget', event: 'config-error', error: error?.message || 'failed' },
              '*'
            );
          }
        } catch (_) {}
      }
    },

    getCwConversationToken() {
      try {
        const cookieMatch = document.cookie.match(/cw_conversation=([^;]+)/);
        if (cookieMatch) return decodeURIComponent(cookieMatch[1]);
      } catch (_) {}
      try { return localStorage.getItem('cw_conversation') || ''; }
      catch (_) { return ''; }
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
.call-icon { transition: transform 0.2s ease; }
.elevenlabs-connecting { opacity: 0.75; cursor: wait; }
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
