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
let _broadcast = null;

// Inline call state
let _inlineConversation = null;
let _inlineHeartbeatTimer = null;
let _inlineBackendHeartbeatTimer = null;
// Generation counter — incremented every time a NEW call starts.
// Callbacks capture myGen; if myGen !== _callGeneration when they fire,
// they belong to a stale/old session and must not touch current state.
let _callGeneration = 0;

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
      // Inline call state
      inlineStatus: 'idle', // idle | connecting | connected | ended | error
      inlineStatusText: 'Connecting…',
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
    showInlineCallPanel() {
      return this.inlineStatus !== 'idle';
    },
    inlineAgentName() {
      return this.inlineConfig?.agentName || 'AI Assistant';
    },
    inlineAvatarSrc() {
      if (this.inlineConfig?.avatar) return this.inlineConfig.avatar;
      return this._makeFallbackAvatar(this.inlineAgentName, this.inlineConfig?.color || '#1f93ff');
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

    // Event-driven cross-page propagation — NO polling.
    // On mount: check backend immediately + two retries (3s, 6s).
    this._checkAttempt = 0;
    this._checkBackendCallStatus();
    this._mountRetry2 = setTimeout(() => {
      if (!this.isCallActive) this._checkBackendCallStatus();
    }, 3000);
    this._mountRetry3 = setTimeout(() => {
      if (!this.isCallActive) this._checkBackendCallStatus();
    }, 6000);

    document.addEventListener('visibilitychange', this._onVisibilityChange);
    window.addEventListener('storage', this._onStorageEvent);
  },

  beforeUnmount() {
    window.removeEventListener('message', this.onWindowMessage);
    emitter.off('end-voice-call', this.endCall);
    const ch = getBroadcastChannel();
    if (ch) ch.removeEventListener('message', this.onBroadcastMessage);
    if (this._mountRetry2) clearTimeout(this._mountRetry2);
    if (this._mountRetry3) clearTimeout(this._mountRetry3);
    this._stopInlineHeartbeat();
    this._stopInlineBackendHeartbeat();
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
    window.removeEventListener('storage', this._onStorageEvent);
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
      await this.startInlineCall();
    },

    // ── Inline call (SPA mode — no popup window) ───────────────────────────
    async startInlineCall() {
      if (!this.hasAnyVoiceEnabled) return;

      // Increment generation FIRST — any in-flight callbacks from a previous
      // session will see their captured myGen no longer matches and bail out.
      const myGen = ++_callGeneration;

      // Fast double-click guard: if isConnecting is already true from an earlier
      // startInlineCall that hasn't finished the await yet, abort this one.
      if (this.isConnecting) return;

      // Guard against duplicate active call
      try {
        const cwConv = this.getCwConversationToken();
        let guardUrl = buildConvUrl('/api/v1/widget/conversations/voice_call_active');
        if (cwConv) guardUrl += `&cw_conversation=${encodeURIComponent(cwConv)}`;
        const { data } = await API.get(guardUrl);
        if (data?.active) {
          const hbAge = data.last_heartbeat
            ? Date.now() - new Date(data.last_heartbeat).getTime()
            : Infinity;
          if (hbAge < 10000) {
            alert('You already have a voice call active. Please end it first.');
            return;
          }
        }
      } catch (_) {}

      this.isConnecting = true;
      this.inlineStatus = 'connecting';
      this.inlineStatusText = 'Requesting mic…';
      this.setConnecting(true);

      try {
        const config = await this._buildConfig();
        this.inlineConfig = config;

        // Mic permission check
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());

        this.inlineStatusText = 'Loading…';
        const mod = await import('https://esm.sh/@11labs/client');
        const Conversation = mod.Conversation;
        if (!Conversation) throw new Error('ElevenLabs SDK did not expose Conversation');

        this.inlineStatusText = 'Connecting…';

        _inlineConversation = await Conversation.startSession({
          signedUrl: config.signedUrl,
          dynamicVariables: {
            chatwoot_conversation_id:  config.cwConversationId  || '',
            chatwoot_conversation_url: config.cwConversationUrl || '',
            customer_name:             config.agentName         || 'Customer',
            website:                   config.brand             || '',
          },

          onConnect: () => {
            if (myGen !== _callGeneration) return; // stale session
            this.isConnecting = false;
            this.isCallActive = true;
            this.inlineStatus = 'connected';
            this.inlineStatusText = 'Connected';
            this.setActive(true);
            this.setConnecting(false);
            this._callStartTime = Date.now(); // track call start for stale-signal guard
            this._startInlineHeartbeat();
            this._startInlineBackendHeartbeat();
            // Notify parent page so floating End Call button logic can run
            try {
              window.parent.postMessage({ event: 'cw-voice-call-started' }, '*');
            } catch (_) {}
            try { localStorage.setItem('cw_voice_active', '1'); } catch (_) {}
            // Link ElevenLabs conversation ID to Chatwoot conversation
            try {
              const elConvId = typeof _inlineConversation.getId === 'function'
                ? _inlineConversation.getId()
                : _inlineConversation.conversationId || null;
              if (elConvId) {
                const cwConv = this.getCwConversationToken();
                let url = buildConvUrl('/api/v1/widget/conversations/voice_link_elevenlabs');
                if (cwConv) url += `&cw_conversation=${encodeURIComponent(cwConv)}`;
                API.post(url, { elevenlabs_conversation_id: elConvId }).catch(() => {});
              }
            } catch (_) {}
          },

          onDisconnect: () => {
            if (myGen !== _callGeneration) return; // stale session — do NOT reset current call
            this.handleInlineCallEnded('Call ended');
          },

          onError: (err) => {
            if (myGen !== _callGeneration) return; // stale session
            const msg = (err && (err.message || err.toString())) || 'Unknown error';
            console.error('[VOICE-INLINE] error:', msg);
            this.inlineStatus = 'error';
            this.inlineStatusText = 'Error';
            this.isConnecting = false;
            this.setConnecting(false);
          },

          onMessage: ({ message, source }) => {
            if (myGen !== _callGeneration) return; // stale session
            const text = (message || '').toString().trim();
            if (!text) return;
            const cwConv = this.getCwConversationToken();
            let url = buildConvUrl('/api/v1/widget/conversations/voice_transcript');
            if (cwConv) url += `&cw_conversation=${encodeURIComponent(cwConv)}`;
            API.post(url, { source, content: text }).catch(() => {});
            try { this.$store.dispatch('conversation/fetchOldConversations'); } catch (_) {}
            try { this.$store.dispatch('message/fetchAllMessages'); } catch (_) {}
          },

          onModeChange: (mode) => {
            if (myGen !== _callGeneration) return; // stale session
            this.inlineSpeaking = mode === 'speaking';
          },
        });

      } catch (error) {
        const msg = (error && error.message) || 'unknown';
        console.error('[VOICE-INLINE] startInlineCall failed:', msg);
        this.isConnecting = false;
        this.inlineStatus = 'error';
        this.inlineStatusText = (error && (error.name === 'NotAllowedError' || error.name === 'NotFoundError'))
          ? 'Mic denied' : 'Failed to connect';
        this.setConnecting(false);
        // Auto-dismiss error panel after 3s
        setTimeout(() => { if (this.inlineStatus === 'error') this.inlineStatus = 'idle'; }, 3000);
      }
    },

    async endInlineCall() {
      // Dograh path — close WebSocket + WebRTC
      if (this._dograhWs || this._dograhPc) {
        this.inlineStatusText = 'Ending…';
        this._cleanupDograh();
        this.handleInlineCallEnded('Call ended');
        return;
      }

      // ElevenLabs path — grab reference and immediately null it
      const conv = _inlineConversation;
      _inlineConversation = null;

      if (!conv) {
        this.handleInlineCallEnded('Call ended');
        return;
      }

      this.inlineStatusText = 'Ending…';
      try { await conv.endSession(); }
      catch (e) { console.warn('[VOICE-INLINE] endSession threw:', e?.message); }

      this.handleInlineCallEnded('Call ended');
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

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());

        this.inlineStatusText = 'Connecting to Dograh…';

        // Generate peer connection ID
        const pcId = 'cw_' + Math.random().toString(36).slice(2, 10);
        const wsUrl = `${config.dograhWsUrl}/${config.dograhWorkflowId}/${pcId}`;

        // Connect WebSocket for signaling
        const ws = new WebSocket(wsUrl);
        this._dograhWs = ws;

        // Create WebRTC peer connection
        const pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        this._dograhPc = pc;

        // Get mic audio and add to peer connection
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this._dograhStream = audioStream;
        audioStream.getTracks().forEach(track => pc.addTrack(track, audioStream));

        // Handle remote audio
        pc.ontrack = (event) => {
          const audio = new Audio();
          audio.srcObject = event.streams[0];
          audio.play().catch(() => {});
          this._dograhRemoteAudio = audio;
        };

        // ICE candidates → send via WebSocket
        pc.onicecandidate = (event) => {
          if (event.candidate && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ice-candidate', candidate: event.candidate }));
          }
        };

        ws.onopen = async () => {
          if (myGen !== _callGeneration) return;
          // Send auth if API key present
          if (config.dograhApiKey) {
            ws.send(JSON.stringify({ type: 'auth', api_key: config.dograhApiKey }));
          }
          // Create and send SDP offer
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          ws.send(JSON.stringify({ type: 'offer', sdp: offer.sdp }));
        };

        ws.onmessage = async (event) => {
          if (myGen !== _callGeneration) return;
          const msg = JSON.parse(event.data);

          if (msg.type === 'answer') {
            await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: msg.sdp }));
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
          } else if (msg.type === 'ice-candidate' && msg.candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {});
          } else if (msg.type === 'rtf-user-transcription' || msg.type === 'rtf-bot-text') {
            // Dograh transcript events → send to Chatwoot
            const source = msg.type === 'rtf-user-transcription' ? 'user' : 'ai';
            const text = (msg.text || msg.content || '').trim();
            if (text) {
              const cwConv = this.getCwConversationToken();
              let url = buildConvUrl('/api/v1/widget/conversations/voice_transcript');
              if (cwConv) url += `&cw_conversation=${encodeURIComponent(cwConv)}`;
              API.post(url, { source, content: text }).catch(() => {});
              try { this.$store.dispatch('conversation/fetchOldConversations'); } catch (_) {}
            }
          } else if (msg.type === 'call-ended' || msg.type === 'error') {
            this.handleInlineCallEnded(msg.type === 'error' ? 'Error' : 'Call ended');
          }
        };

        ws.onclose = () => {
          if (myGen !== _callGeneration) return;
          if (this.isCallActive) this.handleInlineCallEnded('Call ended');
        };

        ws.onerror = () => {
          if (myGen !== _callGeneration) return;
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
        setTimeout(() => { if (this.inlineStatus === 'error') this.inlineStatus = 'idle'; }, 3000);
      }
    },

    handleInlineCallEnded(label) {
      // Guard — if already cleaned up, don't run again.
      if (!this.isCallActive && this.inlineStatus === 'idle') return;

      this.isCallActive = false;
      this.isConnecting = false;
      this.inlineStatus = 'ended';
      this.inlineStatusText = label || 'Call ended';
      this.inlineSpeaking = false;
      _inlineConversation = null;

      // Clean up Dograh WebRTC/WebSocket resources
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

      // Dismiss panel after short delay — only if a new call hasn't already started
      setTimeout(() => { if (this.inlineStatus === 'ended') this.inlineStatus = 'idle'; }, 1500);
    },

    _startInlineHeartbeat() {
      if (_inlineHeartbeatTimer) return;
      const writeHb = () => {
        try { localStorage.setItem('cw_voice_popup_heartbeat', String(Date.now())); } catch (_) {}
        const ch = getBroadcastChannel();
        if (ch) {
          try { ch.postMessage({ type: 'heartbeat', timestamp: Date.now(), active: true }); } catch (_) {}
        }
      };
      writeHb();
      _inlineHeartbeatTimer = setInterval(writeHb, 1500);
    },

    _stopInlineHeartbeat() {
      if (_inlineHeartbeatTimer) { clearInterval(_inlineHeartbeatTimer); _inlineHeartbeatTimer = null; }
      try { localStorage.removeItem('cw_voice_popup_heartbeat'); } catch (_) {}
      const ch = getBroadcastChannel();
      if (ch) { try { ch.postMessage({ type: 'ended', timestamp: Date.now() }); } catch (_) {} }
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
              // Ignore end_requested within first 5s of a new call.
              // The previous call's voice_ended_at may still be set in the backend,
              // causing the first heartbeat of a new call to falsely return end_requested.
              // Backend clears voice_ended_at after returning this signal, so next
              // heartbeat (3s later) will be clean.
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

    _makeFallbackAvatar(name, color) {
      const initials = (name || 'AI')
        .split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
        `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0%" stop-color="${color}" stop-opacity="1"/>` +
        `<stop offset="100%" stop-color="${color}" stop-opacity="0.82"/>` +
        `</linearGradient></defs>` +
        `<circle cx="50" cy="50" r="50" fill="url(#g)"/>` +
        `<text x="50" y="62" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="36" font-weight="600" fill="white">${initials}</text>` +
        `</svg>`;
      return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    },

    endCall() {
      const ch = getBroadcastChannel();
      if (ch) { try { ch.postMessage({ type: 'request-end-call' }); } catch (_) {} }

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
      try { localStorage.setItem('cw_voice_active', '0'); } catch (_) {}
      this.notifyParentWidgetHide(false);
    },

    _syncCallActiveFromPopup() {
      if (this.isCallActive) return;
      vLog('Detected alive call — syncing UI to active');
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
        // MUST include cw_conversation so backend can identify the contact.
        // withCredentials:false means cookies are not sent → we pass the
        // token explicitly as a query param on every status-check request.
        const cwConv = this.getCwConversationToken();
        let url = buildConvUrl('/api/v1/widget/conversations/voice_call_active');
        if (cwConv) url += `&cw_conversation=${encodeURIComponent(cwConv)}`;
        const { data } = await API.get(url);

        if (data?.active && !this.isCallActive) {
          const hbAge = data.last_heartbeat
            ? Date.now() - new Date(data.last_heartbeat).getTime()
            : Infinity;
          if (hbAge < 20000) {
            this._syncCallActiveFromPopup();
          }
        } else if (!data?.active && this.isCallActive) {
          this.resetCallState();
        }
      } catch (e) {
        console.warn('[VOICE-WIDGET] voice_call_active check failed:', e?.message);
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

    // Page becomes visible again (tab switch back) → check once.
    // Runs ONLY when user actually focuses this tab, not constantly.
    _onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        this._checkBackendCallStatus();
      }
    },

    // Cross-tab storage event — fires INSTANTLY when another tab/window
    // writes to the heartbeat key (popup does this on every heartbeat).
    // True event-driven, zero polling.
    _onStorageEvent(e) {
      if (e.key !== 'cw_voice_popup_heartbeat') return;
      if (e.newValue && !this.isCallActive) {
        // Heartbeat written → call started somewhere → sync to active
        this._checkBackendCallStatus();
      } else if (!e.newValue && this.isCallActive) {
        // Heartbeat cleared → call ended somewhere → reset
        this._checkBackendCallStatus();
      }
    },

    onWindowMessage(e) {
      const data = e?.data;
      if (!data || typeof data !== 'object') return;

      // Floating End Call button on parent page clicked
      if (data.event === 'end-voice-call-from-parent') {
        if (_inlineConversation || this.isCallActive) {
          this.endInlineCall();
        }
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

    _cleanupDograh() {
      try { this._dograhStream?.getTracks().forEach(t => t.stop()); } catch (_) {}
      try { this._dograhPc?.close(); } catch (_) {}
      try { this._dograhWs?.close(); } catch (_) {}
      try { this._dograhRemoteAudio?.pause(); } catch (_) {}
      this._dograhStream = null;
      this._dograhPc = null;
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
      // Numeric conversation ID (e.g. 202) — returned by backend
      const convId   = data?.conversation_id   || '';
      const acctId   = data?.account_id        || '';
      const convUrl  = convId && acctId
        ? `${window.location.origin}/app/accounts/${acctId}/conversations/${convId}`
        : '';

      const config = {
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
        // Dograh-specific
        dograhWsUrl:        data?.signed_url || '',
        dograhWorkflowId:   data?.workflow_id || '',
        dograhApiKey:       data?.api_key || '',
      };
      return config;
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

/* ── Inline call overlay (SPA mode) ────────────────────────────────────── */
.cw-vi-overlay {
  position: fixed;
  inset: 0;
  background: #fff;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  -webkit-font-smoothing: antialiased;
}
.cw-vi-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px 9px;
  border-bottom: 0.5px solid rgba(15, 23, 42, 0.10);
  flex-shrink: 0;
}
.cw-vi-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.07em;
  color: #64748b;
  text-transform: uppercase;
}
.cw-vi-live {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  color: #e8533a;
}
.cw-vi-live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #e8533a;
  animation: cw-vi-pulse-dot 1.4s ease-in-out infinite;
}
@keyframes cw-vi-pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.5; transform: scale(0.8); }
}
.cw-vi-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 12px 16px 8px;
  min-height: 0;
}
.cw-vi-avatar-wrap {
  position: relative;
  width: min(38vmin, 120px);
  height: min(38vmin, 120px);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: min(3vmin, 14px);
  flex-shrink: 0;
}
.cw-vi-ring {
  position: absolute;
  border-radius: 50%;
  border: 1.5px solid rgba(66, 153, 225, 0.22);
}
.cw-vi-ring1 { width: 100%; height: 100%; }
.cw-vi-ring2 { width: 80%; height: 80%; border-color: rgba(66, 153, 225, 0.40); }
.cw-vi-speaking .cw-vi-ring2 { animation: cw-vi-pulse-ring 1.6s ease-in-out infinite; }
.cw-vi-speaking .cw-vi-ring1 { animation: cw-vi-pulse-ring 1.6s ease-in-out infinite 0.4s; }
@keyframes cw-vi-pulse-ring {
  0%, 100% { opacity: 0.6; transform: scale(1); }
  50%       { opacity: 1;   transform: scale(1.04); }
}
.cw-vi-avatar {
  width: 62%;
  height: 62%;
  border-radius: 50%;
  border: 2px solid #3b8fe8;
  object-fit: cover;
  background: rgba(66, 153, 225, 0.22);
  position: relative;
  z-index: 1;
  overflow: hidden;
  transition: transform 240ms ease, box-shadow 240ms ease;
}
.cw-vi-speaking .cw-vi-avatar {
  transform: scale(1.04);
  box-shadow: 0 0 0 5px rgba(66, 153, 225, 0.22);
}
.cw-vi-name {
  font-size: clamp(12px, 4vmin, 16px);
  font-weight: 600;
  color: #0f172a;
  margin-bottom: 2px;
  max-width: 90%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}
.cw-vi-role {
  font-size: clamp(10px, 3vmin, 12px);
  color: #64748b;
  margin-bottom: min(3vmin, 12px);
}
.cw-vi-badge {
  display: flex;
  align-items: center;
  gap: 5px;
  border-radius: 20px;
  padding: 4px 12px;
  font-size: clamp(9px, 2.8vmin, 11px);
  font-weight: 500;
}
.cw-vi-badge[data-state="connecting"] {
  background: #fffbeb;
  border: 0.5px solid #fde68a;
  color: #b45309;
}
.cw-vi-badge[data-state="connected"] {
  background: #edfaf3;
  border: 0.5px solid #a3e9c0;
  color: #1b7a47;
}
.cw-vi-badge[data-state="ended"],
.cw-vi-badge[data-state="error"] {
  background: #f1f5f9;
  border: 0.5px solid #cbd5e1;
  color: #64748b;
}
.cw-vi-badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}
.cw-vi-footer {
  padding: 0 14px 10px;
  flex-shrink: 0;
}
.cw-vi-end-btn {
  width: 100%;
  background: #e8533a;
  border: none;
  border-radius: 24px;
  color: #fff;
  font-size: clamp(11px, 3.5vmin, 13px);
  font-weight: 600;
  padding: clamp(8px, 2.5vmin, 11px) 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: background 0.15s;
}
.cw-vi-end-btn:hover:not(:disabled) { background: #c93f28; }
.cw-vi-end-btn:active:not(:disabled) { transform: scale(0.98); }
.cw-vi-end-btn:disabled {
  background: #cbd5e1;
  color: #64748b;
  cursor: not-allowed;
}
</style>
