<script>
import { mapGetters, mapActions } from 'vuex';
import configMixin from '../mixins/configMixin';
import { API, WEBSITE_TOKEN } from 'widget/helpers/axios';

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

let _popupWindow = null;
let _popupPollTimer = null;

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
    hasDograhVoiceEnabled() {
      return this.isVoiceAgentEnabled && this.voiceAgentProvider === 'dograh';
    },
    hasAnyVoiceEnabled() {
      return this.hasElevenLabsVoiceEnabled || this.hasDograhVoiceEnabled;
    },
    shouldShowButton() { return this.hasAnyVoiceEnabled; },
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
  },

  beforeUnmount() {
    window.removeEventListener('message', this.onWindowMessage);
    this._stopPopupPoll();
  },

  methods: {
    ...mapActions('elevenlabsVoice', ['setActive', 'setConnecting']),

    handleClick() {
      if (this.isConnecting) return;
      if (this.isCallActive) {
        this.endCall();
        return;
      }
      this.startCall();
    },

    async startCall() {
      if (!this.hasAnyVoiceEnabled) return;
      if (this.isConnecting) return;

      this.isConnecting = true;
      this.setConnecting(true);

      try {
        this._pendingConfig = await this._buildConfig();
        this._openPopup();
      } catch (error) {
        console.error('[VOICE] Failed to get config:', error?.message);
        this.isConnecting = false;
        this.setConnecting(false);
      }
    },

    _openPopup() {
      if (_popupWindow && !_popupWindow.closed) {
        _popupWindow.focus();
        return;
      }

      const w = 280;
      const h = 380;
      const left = window.screenX + Math.round((window.outerWidth - w) / 2);
      const top = window.screenY + Math.round((window.outerHeight - h) / 2);

      _popupWindow = window.open(
        '/voice-popup.html',
        'cw_voice_popup',
        `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,status=no`
      );

      if (!_popupWindow) {
        console.error('[VOICE] Popup blocked — allow popups for this site');
        this.isConnecting = false;
        this.setConnecting(false);
        return;
      }

      this._startPopupPoll();
    },

    _startPopupPoll() {
      this._stopPopupPoll();
      _popupPollTimer = setInterval(() => {
        if (!_popupWindow || _popupWindow.closed) {
          this._stopPopupPoll();
          if (this.isCallActive || this.isConnecting) {
            this._handlePopupClosed();
          }
        }
      }, 500);
    },

    _stopPopupPoll() {
      if (_popupPollTimer) {
        clearInterval(_popupPollTimer);
        _popupPollTimer = null;
      }
    },

    _sendConfigToPopup() {
      if (!_popupWindow || _popupWindow.closed || !this._pendingConfig) return;
      vLog('Sending config to popup');
      _popupWindow.postMessage({
        source: 'cw-widget',
        event: 'config',
        config: this._pendingConfig,
      }, '*');
    },

    onWindowMessage(e) {
      const data = e?.data;
      if (!data || typeof data !== 'object') return;

      // Messages from parent page
      if (data.event === 'end-voice-call-from-parent') {
        this.endCall();
        return;
      }

      // Messages from voice popup
      if (data.source !== 'cw-voice-popup') return;

      vLog('Popup event:', data.event);

      switch (data.event) {
        case 'voice-popup-request-config':
          this._sendConfigToPopup();
          break;

        case 'voice-popup-connected':
          this.isConnecting = false;
          this.isCallActive = true;
          this.setActive(true);
          this.setConnecting(false);
          try { localStorage.setItem('cw_voice_active', '1'); } catch (_) {}
          try { window.parent.postMessage({ event: 'cw-voice-call-started' }, '*'); } catch (_) {}
          break;

        case 'voice-popup-transcript':
          if (data.source_type || data.source) {
            try { this.$store.dispatch('conversation/fetchOldConversations'); } catch (_) {}
          }
          break;

        case 'voice-popup-ended':
        case 'voice-popup-closed':
          this._handlePopupClosed();
          break;

        case 'voice-popup-error':
          vLog('Popup error:', data.error);
          if (!this.isCallActive) {
            this.isConnecting = false;
            this.setConnecting(false);
          }
          break;
      }
    },

    _handlePopupClosed() {
      _popupWindow = null;
      this._stopPopupPoll();

      const wasActive = this.isCallActive;
      this.isCallActive = false;
      this.isConnecting = false;
      this.setActive(false);
      this.setConnecting(false);
      this._pendingConfig = null;

      try { localStorage.setItem('cw_voice_active', '0'); } catch (_) {}
      try { window.parent.postMessage({ event: 'cw-voice-call-ended' }, '*'); } catch (_) {}

      if (wasActive) {
        try { this.$store.dispatch('conversation/fetchOldConversations'); } catch (_) {}
      }
    },

    endCall() {
      if (_popupWindow && !_popupWindow.closed) {
        _popupWindow.postMessage({ source: 'cw-widget', event: 'request-end-call' }, '*');
        setTimeout(() => {
          if (_popupWindow && !_popupWindow.closed) {
            _popupWindow.close();
          }
          this._handlePopupClosed();
        }, 1000);
      } else {
        this._handlePopupClosed();
      }
    },

    async _buildConfig() {
      const { data } = await API.get(
        buildConvUrl('/api/v1/widget/conversations/voice_signed_url')
      );
      const signedUrl = data?.signed_url;
      if (!signedUrl) throw new Error('Backend returned no signed_url');

      const ch = window.chatwootWebChannel || {};
      const convId   = data?.conversation_id   || '';
      const acctId   = data?.account_id        || '';
      const convUrl  = convId && acctId
        ? `${window.location.origin}/app/accounts/${acctId}/conversations/${convId}`
        : '';

      return {
        signedUrl,
        provider:           data?.provider || 'elevenlabs',
        baseUrl:            window.location.origin,
        websiteToken:       WEBSITE_TOKEN || '',
        color:              this.widgetColor || ch.widgetColor || this.color || '#1f93ff',
        avatar:             data?.avatar_url || ch.avatarUrl || '',
        agentName:          data?.agent_name || ch.websiteName || 'AI Assistant',
        agentRole:          'Voice Assistant',
        brand:              data?.brand_name || ch.websiteName || 'Voice Assistant',
        authToken:          window.authToken || '',
        cwConversation:     this.getCwConversationToken() || '',
        cwConversationId:   String(convId),
        cwConversationUrl:  convUrl,
        dograhSignedUrl:    data?.signed_url || '',
        dograhSessionToken: data?.session_token || '',
        dograhWorkflowRunId: data?.workflow_run_id || '',
        dograhApiUrl:       data?.voice_agent_api_url || '',
        dograhWorkflowId:   data?.workflow_id || '',
      };
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
