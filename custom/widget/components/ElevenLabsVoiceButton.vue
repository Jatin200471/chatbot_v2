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
      // Dograh path — close WebSocket + audio streaming
      if (this._dograhWs || this._dograhAudioCtx) {
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

    // ── Dograh call (WebSocket audio streaming) ─────────────────────────
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

        // Request mic permission early (8kHz for Twilio-compatible mu-law)
        const audioStream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
        });
        this._dograhStream = audioStream;

        this.inlineStatusText = 'Connecting to Dograh…';

        // Backend returns the full ready-to-use WebSocket URL
        const wsUrl = config.dograhWsUrl;
        vLog('Dograh WS URL:', wsUrl);

        const ws = new WebSocket(wsUrl);
        this._dograhWs = ws;

        // Set up AudioContext for capturing mic PCM and playing back agent audio
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        this._dograhAudioCtx = audioCtx;

        ws.onopen = () => {
          if (myGen !== _callGeneration) return;
          vLog('Dograh WS connected');

          const streamSid = 'cw_' + Math.random().toString(36).slice(2, 10);
          const callSid = 'cw_call_' + Math.random().toString(36).slice(2, 10);

          // Dograh expects Twilio-compatible framing: "connected" then "start"
          ws.send(JSON.stringify({
            event: 'connected',
            protocol: 'Call',
            version: '1.0.0',
          }));

          ws.send(JSON.stringify({
            event: 'start',
            sequenceNumber: '1',
            start: {
              streamSid,
              accountSid: 'cw_acct',
              callSid,
              tracks: ['inbound'],
              mediaFormat: {
                encoding: 'audio/x-mulaw',
                sampleRate: 8000,
                channels: 1,
              },
              customParameters: {
                api_key: config.dograhApiKey || undefined,
              },
            },
            streamSid,
          }));

          // Start capturing mic audio and streaming to Dograh
          this._startMicCapture(audioCtx, audioStream, ws, myGen);

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
        };

        ws.onmessage = (event) => {
          if (myGen !== _callGeneration) return;

          // Binary frame = audio from Dograh agent → play it
          if (event.data instanceof Blob || event.data instanceof ArrayBuffer) {
            this._playAgentAudio(audioCtx, event.data);
            return;
          }

          // JSON message
          try {
            const msg = JSON.parse(event.data);
            vLog('Dograh msg:', msg.event || msg.type, msg);

            // Dograh sends audio as base64 in "media" events (Twilio-style)
            if (msg.event === 'media' && msg.media?.payload) {
              this._playBase64Audio(audioCtx, msg.media.payload);
            }

            // Transcript events → send to Chatwoot
            if (msg.type === 'rtf-user-transcription' || msg.type === 'rtf-bot-text' ||
                msg.event === 'transcription' || msg.event === 'agent_response') {
              const source = (msg.type === 'rtf-user-transcription' || msg.event === 'transcription') ? 'user' : 'ai';
              const text = (msg.text || msg.content || msg.transcript || '').trim();
              if (text) {
                const cwConv = this.getCwConversationToken();
                let url = buildConvUrl('/api/v1/widget/conversations/voice_transcript');
                if (cwConv) url += `&cw_conversation=${encodeURIComponent(cwConv)}`;
                API.post(url, { source, content: text }).catch(() => {});
                try { this.$store.dispatch('conversation/fetchOldConversations'); } catch (_) {}
              }
            }

            if (msg.type === 'call-ended' || msg.event === 'stop' || msg.type === 'error') {
              this.handleInlineCallEnded(msg.type === 'error' ? 'Error' : 'Call ended');
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

    // ── Mu-law codec (ITU-T G.711) ───────────────────────────────────────
    _float32ToMulaw(float32Arr) {
      const BIAS = 0x84;
      const CLIP = 32635;
      const out = new Uint8Array(float32Arr.length);
      for (let i = 0; i < float32Arr.length; i++) {
        let sample = Math.max(-1, Math.min(1, float32Arr[i]));
        let s = Math.round(sample * 32767);
        const sign = (s >> 8) & 0x80;
        if (sign !== 0) s = -s;
        if (s > CLIP) s = CLIP;
        s += BIAS;
        let exponent = 7;
        const expMask = 0x4000;
        for (; exponent > 0; exponent--) { if ((s & expMask) !== 0) break; s <<= 1; }
        const mantissa = (s >> 10) & 0x0F;
        out[i] = ~(sign | (exponent << 4) | mantissa) & 0xFF;
      }
      return out;
    },

    _mulawToFloat32(mulawBytes) {
      const BIAS = 0x84;
      const out = new Float32Array(mulawBytes.length);
      for (let i = 0; i < mulawBytes.length; i++) {
        let mulaw = ~mulawBytes[i] & 0xFF;
        const sign = (mulaw & 0x80) ? -1 : 1;
        const exponent = (mulaw >> 4) & 0x07;
        const mantissa = mulaw & 0x0F;
        let magnitude = ((mantissa << 3) + BIAS) << exponent;
        magnitude -= BIAS;
        out[i] = (sign * magnitude) / 32768;
      }
      return out;
    },

    // Downsample from audioCtx.sampleRate to 8kHz
    _downsample(buffer, fromRate, toRate) {
      if (fromRate === toRate) return buffer;
      const ratio = fromRate / toRate;
      const newLen = Math.round(buffer.length / ratio);
      const result = new Float32Array(newLen);
      for (let i = 0; i < newLen; i++) {
        const idx = Math.round(i * ratio);
        result[i] = buffer[Math.min(idx, buffer.length - 1)];
      }
      return result;
    },

    // Capture mic → downsample to 8kHz → mu-law encode → base64 → WS
    _startMicCapture(audioCtx, stream, ws, myGen) {
      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      this._dograhProcessor = processor;
      this._dograhSeqNum = 2; // 1 was the start event

      processor.onaudioprocess = (e) => {
        if (myGen !== _callGeneration || ws.readyState !== WebSocket.OPEN) return;
        const inputData = e.inputBuffer.getChannelData(0);
        // Downsample to 8kHz
        const downsampled = this._downsample(inputData, audioCtx.sampleRate, 8000);
        // Encode as mu-law
        const mulaw = this._float32ToMulaw(downsampled);
        // Base64 encode
        let binary = '';
        for (let i = 0; i < mulaw.length; i++) binary += String.fromCharCode(mulaw[i]);
        const b64 = btoa(binary);
        // Send as Twilio-compatible media event
        this._dograhSeqNum++;
        ws.send(JSON.stringify({
          event: 'media',
          sequenceNumber: String(this._dograhSeqNum),
          media: {
            track: 'inbound',
            chunk: String(this._dograhSeqNum),
            timestamp: String(Date.now()),
            payload: b64,
          },
        }));
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);
    },

    // Play base64 mu-law audio from Dograh → decode → Float32 → speaker
    _playBase64Audio(audioCtx, base64Data) {
      try {
        const binary = atob(base64Data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const float32 = this._mulawToFloat32(bytes);
        // Create buffer at 8kHz and play
        const audioBuffer = audioCtx.createBuffer(1, float32.length, 8000);
        audioBuffer.getChannelData(0).set(float32);
        const src = audioCtx.createBufferSource();
        src.buffer = audioBuffer;
        src.connect(audioCtx.destination);
        src.start();
      } catch (_) {}
    },

    // Play raw binary audio (ArrayBuffer or Blob) — fallback
    async _playAgentAudio(audioCtx, data) {
      try {
        const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
        try {
          const audioBuffer = await audioCtx.decodeAudioData(buffer.slice(0));
          const src = audioCtx.createBufferSource();
          src.buffer = audioBuffer;
          src.connect(audioCtx.destination);
          src.start();
          return;
        } catch (_) {}
        // Fallback: treat as mu-law
        const bytes = new Uint8Array(buffer);
        const float32 = this._mulawToFloat32(bytes);
        const audioBuffer = audioCtx.createBuffer(1, float32.length, 8000);
        audioBuffer.getChannelData(0).set(float32);
        const src = audioCtx.createBufferSource();
        src.buffer = audioBuffer;
        src.connect(audioCtx.destination);
        src.start();
      } catch (_) {}
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
      try { this._dograhProcessor?.disconnect(); } catch (_) {}
      try { this._dograhAudioCtx?.close(); } catch (_) {}
      try { this._dograhWs?.close(); } catch (_) {}
      this._dograhStream = null;
      this._dograhProcessor = null;
      this._dograhAudioCtx = null;
      this._dograhWs = null;
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
