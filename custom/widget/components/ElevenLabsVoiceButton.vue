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
      await this.startPopupCall();
    },

    // ── Popup call (traditional sites — separate window survives page nav) ──
    async startPopupCall() {
      if (!this.hasAnyVoiceEnabled) return;
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
      this.setConnecting(true);

      try {
        const config = await this._buildConfig();
        this.inlineConfig = config;

        // Open voice-popup.html in a separate window — survives page nav
        const origin = config.baseUrl || window.location.origin;
        const popupUrl = `${origin}/voice-popup.html?wt=${encodeURIComponent(config.websiteToken || '')}`;
        this._voicePopup = window.open(
          popupUrl,
          'cw_voice_popup',
          'width=280,height=360,resizable=yes'
        );

        if (!this._voicePopup) {
          throw new Error('Popup blocked — please allow popups for this site');
        }

        // Send config to popup once it's ready (it requests config via postMessage)
        this._popupConfig = config;
        this.isCallActive = true;
        this.isConnecting = false;
        this.setActive(true);
        this.setConnecting(false);

        // Notify parent page
        try {
          window.parent.postMessage({ event: 'cw-voice-call-started' }, '*');
        } catch (_) {}

      } catch (error) {
        const msg = (error && error.message) || 'unknown';
        console.error('[VOICE-POPUP] startPopupCall failed:', msg);
        this.isConnecting = false;
        this.setConnecting(false);
        alert(msg);
      }
    },

    async endInlineCall() {
      // Dograh path — close WebRTC + WebSocket
      if (this._dograhWs || this._dograhPc) {
        this.inlineStatusText = 'Ending…';
        this._cleanupDograh();
        this.handleInlineCallEnded('Call ended');
        return;
      }

      // Popup path — send end request to popup window
      if (this._voicePopup && !this._voicePopup.closed) {
        try {
          this._voicePopup.postMessage({ source: 'cw-widget', event: 'request-end-call' }, '*');
        } catch (_) {}
      }
      // Also broadcast on channel so popup picks it up
      const ch = getBroadcastChannel();
      if (ch) {
        try { ch.postMessage({ type: 'request-end-call' }); } catch (_) {}
      }

      // ElevenLabs inline path (fallback)
      const conv = _inlineConversation;
      _inlineConversation = null;
      if (conv) {
        this.inlineStatusText = 'Ending…';
        try { await conv.endSession(); }
        catch (e) { console.warn('[VOICE] endSession threw:', e?.message); }
      }

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

        const signedUrl = config.dograhSignedUrl;
        const sessionToken = config.dograhSessionToken;
        const workflowRunId = config.dograhWorkflowRunId;
        const voiceAgentApiUrl = config.dograhApiUrl;

        if (!signedUrl || !sessionToken) {
          throw new Error('Backend did not return signed_url / session_token from Dograh');
        }

        // Fetch TURN credentials from Dograh
        let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
        try {
          const turnUrl = `${voiceAgentApiUrl}/api/v1/public/embed/turn-credentials/${sessionToken}`;
          const turnResp = await fetch(turnUrl);
          if (turnResp.ok) {
            const turnData = await turnResp.json();
            if (turnData?.ice_servers?.length) {
              iceServers = turnData.ice_servers;
            }
          }
        } catch (e) {
          vLog('TURN credentials fetch failed, using STUN fallback:', e?.message);
        }

        this.inlineStatusText = 'Connecting to Dograh…';

        // Create RTCPeerConnection
        const pc = new RTCPeerConnection({ iceServers });
        this._dograhPc = pc;
        const pcId = 'cw_' + Math.random().toString(36).slice(2, 10);
        this._dograhPcId = pcId;

        // Get mic stream and add to peer connection
        const audioStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true }
        });
        this._dograhStream = audioStream;
        audioStream.getTracks().forEach(track => pc.addTrack(track, audioStream));

        // Handle remote audio from Dograh agent
        const remoteAudio = new Audio();
        remoteAudio.autoplay = true;
        this._dograhRemoteAudio = remoteAudio;

        pc.ontrack = (event) => {
          if (myGen !== _callGeneration) return;
          vLog('Dograh remote track received');
          remoteAudio.srcObject = event.streams[0] || new MediaStream([event.track]);
        };

        // Open WebSocket to Dograh's signed URL
        const ws = new WebSocket(signedUrl);
        this._dograhWs = ws;

        // Collect ICE candidates to send after WS is open
        const pendingCandidates = [];
        pc.onicecandidate = (event) => {
          if (!event.candidate) return;
          const msg = { type: 'ice-candidate', payload: event.candidate };
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
          } else {
            pendingCandidates.push(msg);
          }
        };

        ws.onopen = async () => {
          if (myGen !== _callGeneration) return;
          vLog('Dograh WS connected, creating SDP offer');

          // Send queued ICE candidates
          pendingCandidates.forEach(msg => ws.send(JSON.stringify(msg)));
          pendingCandidates.length = 0;

          // Create and send SDP offer
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
                type: 'answer',
                sdp: msg.payload.sdp,
              }));
              // Call is now connected
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

            // Transcript events → send to Chatwoot
            if (msg.type === 'rtf-user-transcription' || msg.type === 'rtf-bot-text') {
              const source = msg.type === 'rtf-user-transcription' ? 'user' : 'ai';
              const text = (msg.text || msg.content || msg.transcript || '').trim();
              if (text) {
                const cwConv = this.getCwConversationToken();
                let url = buildConvUrl('/api/v1/widget/conversations/voice_transcript');
                if (cwConv) url += `&cw_conversation=${encodeURIComponent(cwConv)}`;
                API.post(url, { source, content: text }).catch(() => {});
                try { this.$store.dispatch('conversation/fetchOldConversations'); } catch (_) {}
              }
            }

            if (msg.type === 'rtf-bot-stopped-speaking') {
              this.inlineSpeaking = false;
            }

            if (msg.type === 'rtf-bot-text') {
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
      } else if (m.type === 'request-end-call') {
        if (this.isCallActive) this.endInlineCall();
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
        if (this.isCallActive) this.endInlineCall();
      }

      // Popup requesting config — send the saved config
      if (data.source === 'cw-voice-popup' && data.event === 'voice-popup-request-config') {
        const cfg = this._popupConfig || this.inlineConfig;
        if (cfg) {
          try {
            const target = e.source || (this._voicePopup && !this._voicePopup.closed ? this._voicePopup : null);
            if (target) {
              target.postMessage({
                source: 'cw-widget',
                event: 'config',
                config: cfg,
              }, '*');
            }
          } catch (_) {}
        }
      }

      // Popup opened — mark call as active
      if (data.source === 'cw-voice-popup' && data.event === 'voice-popup-opened') {
        this.notifyParentWidgetHide(true);
      }

      // Popup connected — call is live
      if (data.source === 'cw-voice-popup' && data.event === 'voice-popup-connected') {
        this.isCallActive = true;
        this.isConnecting = false;
        this.setActive(true);
        this.setConnecting(false);
      }

      // Popup ended or closed — reset state
      if (data.source === 'cw-voice-popup' &&
          (data.event === 'voice-popup-ended' || data.event === 'voice-popup-closed')) {
        this.resetCallState();
        this.notifyParentWidgetHide(false);
      }

      // Popup error
      if (data.source === 'cw-voice-popup' && data.event === 'voice-popup-error') {
        this.isConnecting = false;
        this.setConnecting(false);
      }
    },

    notifyParentWidgetHide(hide) {
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
        // Dograh-specific (WebRTC signaling)
        dograhSignedUrl:    data?.signed_url || '',
        dograhSessionToken: data?.session_token || '',
        dograhWorkflowRunId: data?.workflow_run_id || '',
        dograhApiUrl:       data?.voice_agent_api_url || '',
        dograhWorkflowId:   data?.workflow_id || '',
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

    <!-- Inline call overlay — shown during Dograh WebRTC calls -->
    <div v-if="showInlineCallPanel" class="cw-vi-overlay">
      <div class="cw-vi-header">
        <span class="cw-vi-title">VOICE CALL</span>
        <span v-if="inlineStatus === 'connected'" class="cw-vi-live">
          <span class="cw-vi-live-dot" />LIVE
        </span>
      </div>

      <div class="cw-vi-body">
        <div class="cw-vi-avatar-wrap" :class="{ 'cw-vi-speaking': inlineSpeaking }">
          <div class="cw-vi-ring cw-vi-ring1" />
          <div class="cw-vi-ring cw-vi-ring2" />
          <img :src="inlineAvatarSrc" :alt="inlineAgentName" class="cw-vi-avatar" />
        </div>
        <div class="cw-vi-name">{{ inlineAgentName }}</div>
        <div class="cw-vi-role">Voice Assistant</div>
        <div class="cw-vi-badge" :data-state="inlineStatus">
          <span class="cw-vi-badge-dot" />
          {{ inlineStatusText }}
        </div>
      </div>

      <div class="cw-vi-footer">
        <button
          class="cw-vi-end-btn"
          :disabled="inlineStatus === 'ended'"
          @click="endInlineCall"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3.5 14.5c5.5-5 11.5-5 17 0 .8.7.9 2 0 2.7l-2.1 1.6c-.5.4-1.2.4-1.7 0l-2-1.7a1.5 1.5 0 0 1-.5-1.1V14a9.8 9.8 0 0 0-4.4 0v0c0 .4-.2.8-.5 1.1l-2 1.6c-.5.4-1.2.4-1.7 0L3.5 15c-.5-.6-.4-1.7 0-2.5Z" transform="rotate(135 12 12)" />
          </svg>
          End Call
        </button>
      </div>
    </div>
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
