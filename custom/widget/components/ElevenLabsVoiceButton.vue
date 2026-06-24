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

const vLog = (...args) => {
  try {
    if (localStorage.getItem('cw_voice_debug') === 'true') console.log('[VOICE]', ...args);
  } catch (_) {}
};

let _inlineConversation = null;
let _inlineHeartbeatTimer = null;
let _inlineBackendHeartbeatTimer = null;
let _callGeneration = 0;

// Dograh sends transcripts word-by-word — buffer and flush as sentences
let _dograhUserBuffer = '';
let _dograhBotBuffer = '';
let _dograhUserFlushTimer = null;

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
      inlineStatus: 'idle',
      inlineStatusText: '',
      inlineSpeaking: false,
      inlineConfig: null,
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
    emitter.on('end-voice-call', this.endCall);
    document.addEventListener('visibilitychange', this._onVisibilityChange);
  },

  beforeUnmount() {
    window.removeEventListener('message', this.onWindowMessage);
    emitter.off('end-voice-call', this.endCall);
    this._stopInlineHeartbeat();
    this._stopInlineBackendHeartbeat();
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
  },

  methods: {
    ...mapActions('elevenlabsVoice', ['setActive', 'setConnecting']),

    handleClick() {
      if (this.isConnecting) return;
      if (this.isCallActive || this.inlineStatus === 'connected') {
        this.endInlineCall();
        return;
      }
      if (this.inlineStatus !== 'idle') return;
      this.startCall();
    },

    async startCall() {
      if (!this.hasAnyVoiceEnabled) return;
      if (this.hasDograhVoiceEnabled) {
        await this.startDograhCall();
        return;
      }
      await this.startElevenLabsInlineCall();
    },

    // ── ElevenLabs inline call (no popup) ─────────────────────────────
    async startElevenLabsInlineCall() {
      if (!this.hasElevenLabsVoiceEnabled) return;
      const myGen = ++_callGeneration;
      if (this.isConnecting) return;

      this.isConnecting = true;
      this.inlineStatus = 'connecting';
      this.inlineStatusText = 'Requesting mic…';
      this.setConnecting(true);

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());

        this.inlineStatusText = 'Loading SDK…';
        const config = await this._buildConfig();
        this.inlineConfig = config;

        const mod = await import('https://esm.sh/@11labs/client');
        const Conversation = mod.Conversation;
        if (!Conversation) throw new Error('SDK did not expose Conversation');

        if (myGen !== _callGeneration) return;
        this.inlineStatusText = 'Connecting…';

        const conversation = await Conversation.startSession({
          signedUrl: config.signedUrl,

          dynamicVariables: {
            chatwoot_conversation_id:  config.cwConversationId  || '',
            chatwoot_conversation_url: config.cwConversationUrl || '',
            customer_name:             config.agentName         || 'Customer',
            website:                   config.brand             || '',
          },

          onConnect: () => {
            if (myGen !== _callGeneration) return;
            this.isConnecting = false;
            this.isCallActive = true;
            this.inlineStatus = 'connected';
            this.inlineStatusText = 'Connected';
            this.setActive(true);
            this.setConnecting(false);
            this._callStartTime = Date.now();
            this._startInlineHeartbeat();
            this._startInlineBackendHeartbeat();
            try { window.parent.postMessage({ event: 'cw-voice-call-started' }, '*'); } catch (_) {}
            try { localStorage.setItem('cw_voice_active', '1'); } catch (_) {}

            try {
              const elConvId = typeof conversation.getId === 'function'
                ? conversation.getId()
                : conversation.conversationId || null;
              if (elConvId) {
                const cwConv = this.getCwConversationToken();
                let url = buildConvUrl('/api/v1/widget/conversations/voice_link_elevenlabs');
                if (cwConv) url += `&cw_conversation=${encodeURIComponent(cwConv)}`;
                API.post(url, { elevenlabs_conversation_id: elConvId }).catch(() => {});
              }
            } catch (_) {}
          },

          onDisconnect: () => {
            if (myGen !== _callGeneration) return;
            this.handleInlineCallEnded('Call ended');
          },

          onError: (err) => {
            if (myGen !== _callGeneration) return;
            console.error('[VOICE] ElevenLabs error:', err?.message || err);
            this.handleInlineCallEnded('Error');
          },

          onMessage: ({ message, source }) => {
            if (myGen !== _callGeneration) return;
            const text = (message || '').toString().trim();
            if (!text) return;
            const cwConv = this.getCwConversationToken();
            let url = buildConvUrl('/api/v1/widget/conversations/voice_transcript');
            if (cwConv) url += `&cw_conversation=${encodeURIComponent(cwConv)}`;
            API.post(url, { source, content: text }).catch(() => {});
            try { this.$store.dispatch('conversation/fetchOldConversations'); } catch (_) {}
          },

          onModeChange: (mode) => {
            if (myGen !== _callGeneration) return;
            this.inlineSpeaking = mode === 'speaking';
          },
        });

        _inlineConversation = conversation;

      } catch (error) {
        console.error('[VOICE] startElevenLabsInlineCall failed:', error?.message);
        this.isConnecting = false;
        this.inlineStatus = 'error';
        this.inlineStatusText = (error?.name === 'NotAllowedError') ? 'Mic denied' : 'Failed to connect';
        this.setConnecting(false);
        setTimeout(() => { if (this.inlineStatus === 'error') this.inlineStatus = 'idle'; }, 3000);
      }
    },

    // ── Dograh call (WebRTC + WebSocket signaling) ──────────────────────
    async startDograhCall() {
      if (!this.hasDograhVoiceEnabled) return;
      const myGen = ++_callGeneration;
      if (this.isConnecting) return;

      this.isConnecting = true;
      this.inlineStatus = 'connecting';
      this.inlineStatusText = 'Requesting mic…';
      this.setConnecting(true);

      try {
        const config = await this._buildConfig();
        this.inlineConfig = config;

        const signedUrl = config.dograhSignedUrl;
        const sessionToken = config.dograhSessionToken;
        const workflowRunId = config.dograhWorkflowRunId;
        const voiceAgentApiUrl = config.dograhApiUrl;

        if (!signedUrl || !sessionToken) {
          throw new Error('Backend did not return signed_url / session_token from Dograh');
        }

        let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
        try {
          const turnUrl = `${voiceAgentApiUrl}/api/v1/public/embed/turn-credentials/${sessionToken}`;
          const turnResp = await fetch(turnUrl);
          if (turnResp.ok) {
            const turnData = await turnResp.json();
            if (turnData?.ice_servers?.length) iceServers = turnData.ice_servers;
          }
        } catch (e) {
          vLog('TURN credentials fetch failed, using STUN fallback:', e?.message);
        }

        this.inlineStatusText = 'Connecting to Dograh…';

        const pc = new RTCPeerConnection({ iceServers });
        this._dograhPc = pc;
        const pcId = 'cw_' + Math.random().toString(36).slice(2, 10);
        this._dograhPcId = pcId;

        const audioStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true }
        });
        this._dograhStream = audioStream;
        audioStream.getTracks().forEach(track => pc.addTrack(track, audioStream));

        const remoteAudio = new Audio();
        remoteAudio.autoplay = true;
        this._dograhRemoteAudio = remoteAudio;

        pc.ontrack = (event) => {
          if (myGen !== _callGeneration) return;
          vLog('Dograh remote track received');
          remoteAudio.srcObject = event.streams[0] || new MediaStream([event.track]);
        };

        const ws = new WebSocket(signedUrl);
        this._dograhWs = ws;

        const pendingCandidates = [];
        pc.onicecandidate = (event) => {
          if (!event.candidate) return;
          const msg = { type: 'ice-candidate', payload: event.candidate };
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
          else pendingCandidates.push(msg);
        };

        ws.onopen = async () => {
          if (myGen !== _callGeneration) return;
          vLog('Dograh WS connected, creating SDP offer');
          pendingCandidates.forEach(msg => ws.send(JSON.stringify(msg)));
          pendingCandidates.length = 0;

          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);

          ws.send(JSON.stringify({
            type: 'offer',
            payload: {
              sdp: pc.localDescription.sdp,
              type: 'offer',
              pc_id: pcId,
              workflow_id: null,
              workflow_run_id: workflowRunId,
              call_context_vars: {},
            },
          }));
        };

        ws.onmessage = (event) => {
          if (myGen !== _callGeneration) return;
          try {
            const msg = JSON.parse(event.data);
            vLog('Dograh msg:', msg.type, msg);

            if (msg.type === 'answer' && msg.payload) {
              pc.setRemoteDescription(new RTCSessionDescription({
                type: 'answer', sdp: msg.payload.sdp,
              }));
              this.isConnecting = false;
              this.isCallActive = true;
              this.inlineStatus = 'connected';
              this.inlineStatusText = 'Connected';
              this.setActive(true);
              this.setConnecting(false);
              this._callStartTime = Date.now();
              this._startInlineHeartbeat();
              this._startInlineBackendHeartbeat();
              try { window.parent.postMessage({ event: 'cw-voice-call-started' }, '*'); } catch (_) {}
              try { localStorage.setItem('cw_voice_active', '1'); } catch (_) {}
            }

            if (msg.type === 'ice-candidate' && msg.payload) {
              pc.addIceCandidate(new RTCIceCandidate(msg.payload)).catch(() => {});
            }

            // Dograh sends transcripts word-by-word — buffer and flush as sentences
            const isUserTranscript = msg.type === 'rtf-user-transcription' || msg.type === 'USER_TRANSCRIPTION' || msg.type === 'user_transcription';
            const isBotTranscript = msg.type === 'rtf-bot-text' || msg.type === 'BOT_TEXT' || msg.type === 'bot_text';
            if (isUserTranscript || isBotTranscript) {
              const word = (msg.text || msg.content || msg.transcript || msg.payload?.text || msg.payload?.content || msg.payload?.transcript || '').trim();
              if (word) {
                if (isUserTranscript) {
                  _dograhUserBuffer += (_dograhUserBuffer ? ' ' : '') + word;
                  if (_dograhUserFlushTimer) clearTimeout(_dograhUserFlushTimer);
                  _dograhUserFlushTimer = setTimeout(() => this._flushDograhBuffer('user'), 1500);
                } else {
                  _dograhBotBuffer += (_dograhBotBuffer ? ' ' : '') + word;
                }
              }
            }

            const isBotStopped = msg.type === 'rtf-bot-stopped-speaking' || msg.type === 'BOT_STOPPED_SPEAKING' || msg.type === 'bot_stopped_speaking';
            if (isBotStopped) {
              this.inlineSpeaking = false;
              this._flushDograhBuffer('ai');
            }
            if (isBotTranscript) {
              this.inlineSpeaking = true;
            }

            if (msg.type === 'error') {
              console.error('[VOICE-DOGRAH] Server error:', msg);
              this.handleInlineCallEnded('Error');
            }
          } catch (_) {}
        };

        ws.onclose = () => {
          if (myGen !== _callGeneration) return;
          if (this.isCallActive) this.handleInlineCallEnded('Call ended');
        };

        ws.onerror = (err) => {
          if (myGen !== _callGeneration) return;
          console.error('[VOICE-DOGRAH] WebSocket error:', err);
          this.inlineStatus = 'error';
          this.inlineStatusText = 'Connection failed';
          this.isConnecting = false;
          this.setConnecting(false);
          setTimeout(() => { if (this.inlineStatus === 'error') this.inlineStatus = 'idle'; }, 3000);
        };

      } catch (error) {
        console.error('[VOICE-DOGRAH] startDograhCall failed:', error?.message);
        this.isConnecting = false;
        this.inlineStatus = 'error';
        this.inlineStatusText = (error?.name === 'NotAllowedError') ? 'Mic denied' : 'Failed to connect';
        this.setConnecting(false);
        this._cleanupDograh();
        setTimeout(() => { if (this.inlineStatus === 'error') this.inlineStatus = 'idle'; }, 3000);
      }
    },

    async endInlineCall() {
      // Dograh path
      if (this._dograhWs || this._dograhPc) {
        this._cleanupDograh();
        this.handleInlineCallEnded('Call ended');
        return;
      }

      // ElevenLabs inline path
      const conv = _inlineConversation;
      _inlineConversation = null;
      if (conv) {
        try { await conv.endSession(); }
        catch (e) { console.warn('[VOICE] endSession threw:', e?.message); }
      }
      this.handleInlineCallEnded('Call ended');
    },

    handleInlineCallEnded(label) {
      if (!this.isCallActive && this.inlineStatus === 'idle') return;

      // Flush any remaining buffered transcript before ending
      this._flushDograhBuffer('user');
      this._flushDograhBuffer('ai');

      this.isCallActive = false;
      this.isConnecting = false;
      this.inlineStatus = 'ended';
      this.inlineStatusText = label || 'Call ended';
      this.inlineSpeaking = false;
      _inlineConversation = null;

      this._cleanupDograh();
      this._stopInlineHeartbeat();
      this._stopInlineBackendHeartbeat();

      try {
        const cwConv = this.getCwConversationToken();
        let url = buildConvUrl('/api/v1/widget/conversations/voice_call_ended');
        if (cwConv) url += `&cw_conversation=${encodeURIComponent(cwConv)}`;
        API.post(url, {}).catch(() => {});
      } catch (_) {}

      try { localStorage.setItem('cw_voice_active', '0'); } catch (_) {}
      this.setActive(false);
      this.setConnecting(false);
      try { window.parent.postMessage({ event: 'cw-voice-call-ended' }, '*'); } catch (_) {}

      setTimeout(() => { if (this.inlineStatus === 'ended') this.inlineStatus = 'idle'; }, 1500);
    },

    _startInlineHeartbeat() {
      if (_inlineHeartbeatTimer) return;
      const writeHb = () => {
        try { localStorage.setItem('cw_voice_popup_heartbeat', String(Date.now())); } catch (_) {}
      };
      writeHb();
      _inlineHeartbeatTimer = setInterval(writeHb, 1500);
    },

    _stopInlineHeartbeat() {
      if (_inlineHeartbeatTimer) { clearInterval(_inlineHeartbeatTimer); _inlineHeartbeatTimer = null; }
      try { localStorage.removeItem('cw_voice_popup_heartbeat'); } catch (_) {}
    },

    _startInlineBackendHeartbeat() {
      if (_inlineBackendHeartbeatTimer) return;
      const sendHb = () => {
        if (!this.isCallActive) return;
        const cwConv = this.getCwConversationToken();
        let url = buildConvUrl('/api/v1/widget/conversations/voice_heartbeat');
        if (cwConv) url += `&cw_conversation=${encodeURIComponent(cwConv)}`;
        API.post(url, {})
          .then(r => r?.data)
          .then(d => {
            if (d && d.end_requested) {
              const callAge = Date.now() - (this._callStartTime || 0);
              if (callAge > 5000) this.handleInlineCallEnded('Remote end requested');
            }
          })
          .catch(() => {});
      };
      sendHb();
      _inlineBackendHeartbeatTimer = setInterval(sendHb, 3000);
    },

    _stopInlineBackendHeartbeat() {
      if (_inlineBackendHeartbeatTimer) { clearInterval(_inlineBackendHeartbeatTimer); _inlineBackendHeartbeatTimer = null; }
    },

    _flushDograhBuffer(source) {
      if (_dograhUserFlushTimer) { clearTimeout(_dograhUserFlushTimer); _dograhUserFlushTimer = null; }
      const text = source === 'user' ? _dograhUserBuffer.trim() : _dograhBotBuffer.trim();
      if (source === 'user') _dograhUserBuffer = '';
      else _dograhBotBuffer = '';
      if (!text) return;
      vLog('Dograh flush', source, '→', text);
      const cwConv = this.getCwConversationToken();
      let url = buildConvUrl('/api/v1/widget/conversations/voice_transcript');
      if (cwConv) url += `&cw_conversation=${encodeURIComponent(cwConv)}`;
      API.post(url, { source, content: text }).catch(() => {});
      try { this.$store.dispatch('conversation/fetchOldConversations'); } catch (_) {}
    },

    endCall() {
      try {
        const cwConv = this.getCwConversationToken();
        let url = buildConvUrl('/api/v1/widget/conversations/voice_call_ended');
        if (cwConv) url += `&cw_conversation=${encodeURIComponent(cwConv)}`;
        API.post(url, {}).catch(() => {});
      } catch (_) {}
      this.resetCallState();
    },

    resetCallState() {
      _inlineConversation = null;
      this.isCallActive = false;
      this.isConnecting = false;
      this.inlineStatus = 'idle';
      this.inlineSpeaking = false;
      this.setActive(false);
      this.setConnecting(false);
      this._stopInlineHeartbeat();
      this._stopInlineBackendHeartbeat();
      this._cleanupDograh();
      try { localStorage.setItem('cw_voice_active', '0'); } catch (_) {}
      try { window.parent.postMessage({ event: 'cw-voice-call-ended' }, '*'); } catch (_) {}
    },

    _onVisibilityChange() {
      if (document.visibilityState === 'visible' && this.isCallActive) {
        vLog('Tab visible, call active');
      }
    },

    onWindowMessage(e) {
      const data = e?.data;
      if (!data || typeof data !== 'object') return;
      if (data.event === 'end-voice-call-from-parent') {
        if (this.isCallActive) this.endInlineCall();
      }
    },

    _cleanupDograh() {
      try { this._dograhStream?.getTracks().forEach(t => t.stop()); } catch (_) {}
      try { this._dograhPc?.close(); } catch (_) {}
      try { this._dograhWs?.close(); } catch (_) {}
      if (this._dograhRemoteAudio) {
        try { this._dograhRemoteAudio.srcObject = null; } catch (_) {}
      }
      this._dograhStream = null;
      this._dograhPc = null;
      this._dograhPcId = null;
      this._dograhWs = null;
      this._dograhRemoteAudio = null;
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
