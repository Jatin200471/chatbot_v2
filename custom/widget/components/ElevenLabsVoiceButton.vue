<script>
import { mapGetters, mapActions } from 'vuex';
import configMixin from '../mixins/configMixin';
import { API, WEBSITE_TOKEN } from 'widget/helpers/axios';
import { emitter } from 'shared/helpers/mitt';

// ─────────────────────────────────────────────────────────────────────────────
// ElevenLabs Conversational AI — Direct WebSocket Implementation
//
// Why direct WebSocket instead of <elevenlabs-convai> web component:
//   The web component does not expose shadow DOM or any public API to
//   programmatically start/stop calls. Clicking internal buttons via shadow
//   DOM is fragile and broke when ElevenLabs updated their widget. Direct
//   WebSocket gives us full control over audio capture, playback, and
//   transcript events without any third-party DOM dependency.
//
// Protocol (ElevenLabs Convai WS API):
//   SEND:  { user_audio_chunk: "<base64 PCM16 16kHz>" }
//          { type: "pong", pong_event: { event_id } }
//   RECV:  conversation_initiation_metadata → has conversation_id + output format
//          audio                            → base64 PCM to play
//          agent_response                   → AI text turn (complete)
//          user_transcript                  → User speech text (complete)
//          ping                             → reply with pong
//          interruption                     → clear audio queue
// ─────────────────────────────────────────────────────────────────────────────

const buildConvUrl = path => {
  if (!WEBSITE_TOKEN) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}website_token=${WEBSITE_TOKEN}`;
};

// Parse sample rate from ElevenLabs format string e.g. "pcm_16000" → 16000
const parseSampleRate = str => {
  const match = (str || '').match(/(\d+)$/);
  return match ? parseInt(match[1], 10) : 16000;
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

      // WebSocket + audio internals
      _ws:               null,
      _audioCtx:         null,
      _micStream:        null,
      _scriptProcessor:  null,
      _audioQueue:       [],
      _isPlayingAudio:   false,
      _outputSampleRate: 16000,
      _conversationId:   null,
      _nextPlayTime:     0,
    };
  },
  computed: {
    ...mapGetters({
      isVoiceAgentEnabled: 'voiceAgentConfig/isVoiceAgentEnabled',
      voiceAgentProvider:  'voiceAgentConfig/getVoiceAgentProvider',
    }),
    hasElevenLabsVoiceEnabled() {
      // Agent ID check removed — ID is server-side only now.
      // Button shows if the feature flag is enabled and provider is elevenlabs.
      return this.isVoiceAgentEnabled && this.voiceAgentProvider === 'elevenlabs';
    },
    shouldShowButton() {
      return this.hasElevenLabsVoiceEnabled;
    },
    buttonClasses() {
      const sizeClasses = { small: 'min-h-7 min-w-7', medium: 'min-h-9 min-w-9', large: 'min-h-10 min-w-10' };
      return [
        'elevenlabs-voice-btn flex items-center justify-center rounded-full transition-all duration-200 cursor-pointer border-0 p-1.5',
        sizeClasses[this.size] || sizeClasses.medium,
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
    emitter.on('end-voice-call', this.endCall);
    // Auto-reconnect if a call was active before page navigation
    if (this.hasElevenLabsVoiceEnabled) this._checkAutoReconnect();
  },
  beforeUnmount() {
    emitter.off('end-voice-call', this.endCall);
    this._cleanup();
  },
  methods: {
    ...mapActions('elevenlabsVoice', ['setActive', 'setConnecting']),

    // ── Public button handler ────────────────────────────────────────────
    handleClick() {
      if (this.isConnecting) return;
      this.isCallActive ? this.endCall() : this.startCall();
    },

    // ── Start call ───────────────────────────────────────────────────────
    async startCall() {
      if (this.isConnecting || this.isCallActive) return;
      if (!this.hasElevenLabsVoiceEnabled) return;

      this.isConnecting = true;
      this.setConnecting(true);
      this._saveReconnectFlag();

      try {
        // 1. Fetch a short-lived signed WebSocket URL from our backend.
        //    The backend calls ElevenLabs with the secret API key and returns
        //    a temporary signed URL — the agent_id is NEVER sent to the browser.
        const { data: signedData } = await API.get(
          buildConvUrl('/api/v1/widget/conversations/voice_signed_url')
        );
        const wsUrl = signedData?.signed_url;
        if (!wsUrl) throw new Error('Could not get signed voice URL from server');

        // 2. Request microphone (user gesture → unlocks AudioContext)
        this._micStream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });

        // 3. Create AudioContext at browser's NATIVE rate (48000Hz usually).
        // We resample mic audio to 16000Hz before sending to ElevenLabs.
        this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (this._audioCtx.state === 'suspended') await this._audioCtx.resume();
        this._nativeSampleRate = this._audioCtx.sampleRate; // e.g. 48000
        this._nextPlayTime = this._audioCtx.currentTime;

        // 4. Connect to ElevenLabs via signed URL — no agent_id in browser
        this._ws = new WebSocket(wsUrl);
        this._ws.onopen    = ()    => this._onWsOpen();
        this._ws.onmessage = e     => this._onWsMessage(e);
        this._ws.onclose   = e     => this._onWsClose(e);
        this._ws.onerror   = err   => this._onWsError(err);

      } catch (err) {
        this._cleanup();
        this._clearReconnectFlag();
        if (err?.name === 'NotAllowedError' || err?.name === 'NotFoundError') {
          alert(this.$t('VOICE_AGENT.MICROPHONE_ACCESS'));
        }
      }
    },

    // ── End call ─────────────────────────────────────────────────────────
    endCall() {
      this._clearReconnectFlag();
      this._cleanup();
    },

    // ── WebSocket handlers ───────────────────────────────────────────────
    _onWsOpen() {
      this.isConnecting = false;
      this.setConnecting(false);
      this.isCallActive = true;
      this.setActive(true);

      // Fallback: if conversation_initiation_metadata never arrives within
      // 2 seconds, start mic capture anyway so ElevenLabs doesn't timeout.
      this._metadataTimeout = setTimeout(() => {
        console.warn('[VOICE] metadata not received — starting mic anyway');
        this._startMicCapture();
      }, 2000);
    },

    _onWsMessage(event) {
      let msg;
      try { msg = JSON.parse(event.data); } catch (_) { return; }

      switch (msg.type) {
        case 'conversation_initiation_metadata': {
          const meta = msg.conversation_initiation_metadata_event || {};
          this._conversationId   = meta.conversation_id;
          this._outputSampleRate = parseSampleRate(meta.agent_output_audio_format);
          console.log('[VOICE] metadata received, conv_id:', this._conversationId, 'output_rate:', this._outputSampleRate);
          // Cancel fallback timeout and start mic now
          clearTimeout(this._metadataTimeout);
          this._startMicCapture();
          break;
        }
        case 'audio': {
          const b64 = msg.audio_event?.audio_base_64;
          if (b64) this._enqueueAudio(b64);
          break;
        }
        case 'agent_response': {
          const text = msg.agent_response_event?.agent_response;
          if (text) this._postTranscript('ai', text);
          break;
        }
        case 'user_transcript': {
          const text = msg.user_transcription_event?.user_transcript;
          if (text) this._postTranscript('user', text);
          break;
        }
        case 'ping': {
          const eventId = msg.ping_event?.event_id;
          if (this._ws?.readyState === WebSocket.OPEN) {
            this._ws.send(JSON.stringify({ type: 'pong', pong_event: { event_id: eventId } }));
          }
          break;
        }
        case 'interruption':
          this._audioQueue = [];
          this._nextPlayTime = this._audioCtx?.currentTime || 0;
          break;
        case 'error':
          console.error('[VOICE] ElevenLabs error:', JSON.stringify(msg));
          break;
      }
    },

    _onWsClose(e) {
      console.warn('[VOICE] WS closed — code:', e?.code, 'reason:', e?.reason);
      if (this.isCallActive) this._cleanup();
    },

    _onWsError(err) {
      console.error('[VOICE] WS error:', err);
      this._cleanup();
      this._clearReconnectFlag();
    },

    // ── Mic capture → send PCM chunks to ElevenLabs ──────────────────────
    async _startMicCapture() {
      if (!this._audioCtx || !this._micStream) return;

      // Inline AudioWorklet (no external file needed — blob URL trick)
      const workletCode = `
        class PCMCapture extends AudioWorkletProcessor {
          constructor() {
            super();
            this._buf = [];
            this._size = 4096;
          }
          process(inputs) {
            const ch = inputs[0]?.[0];
            if (ch) {
              for (let i = 0; i < ch.length; i++) this._buf.push(ch[i]);
              if (this._buf.length >= this._size) {
                this.port.postMessage(this._buf.splice(0, this._size));
              }
            }
            return true;
          }
        }
        registerProcessor('pcm-capture', PCMCapture);
      `;

      try {
        const blob = new Blob([workletCode], { type: 'application/javascript' });
        const url  = URL.createObjectURL(blob);
        await this._audioCtx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);

        const source   = this._audioCtx.createMediaStreamSource(this._micStream);
        this._workletNode = new AudioWorkletNode(this._audioCtx, 'pcm-capture');

        this._workletNode.port.onmessage = e => {
          if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
          const raw       = new Float32Array(e.data);
          const resampled = this._resampleTo16k(raw, this._nativeSampleRate);
          const pcm       = this._float32ToPCM16(resampled);
          const b64       = this._bufferToBase64(pcm);
          this._ws.send(JSON.stringify({ user_audio_chunk: b64 }));
        };

        source.connect(this._workletNode);
        this._workletNode.connect(this._audioCtx.destination);

      } catch (_) {
        // Fallback to ScriptProcessorNode if AudioWorklet not supported
        const source = this._audioCtx.createMediaStreamSource(this._micStream);
        this._scriptProcessor = this._audioCtx.createScriptProcessor(4096, 1, 1);
        this._scriptProcessor.onaudioprocess = e => {
          if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
          const raw       = e.inputBuffer.getChannelData(0);
          const resampled = this._resampleTo16k(raw, this._nativeSampleRate);
          const pcm       = this._float32ToPCM16(resampled);
          const b64       = this._bufferToBase64(pcm);
          this._ws.send(JSON.stringify({ user_audio_chunk: b64 }));
        };
        source.connect(this._scriptProcessor);
        this._scriptProcessor.connect(this._audioCtx.destination);
      }
    },

    // ── Audio playback ────────────────────────────────────────────────────
    _enqueueAudio(base64) {
      this._audioQueue.push(base64);
      if (!this._isPlayingAudio) this._drainAudioQueue();
    },

    async _drainAudioQueue() {
      this._isPlayingAudio = true;
      while (this._audioQueue.length > 0) {
        const b64 = this._audioQueue.shift();
        await this._scheduleAudioChunk(b64);
      }
      this._isPlayingAudio = false;
    },

    _scheduleAudioChunk(base64) {
      return new Promise(resolve => {
        if (!this._audioCtx) { resolve(); return; }
        try {
          // Decode base64 → Int16 PCM → Float32
          const raw   = atob(base64);
          const bytes = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
          const pcm16   = new Int16Array(bytes.buffer);
          const float32 = new Float32Array(pcm16.length);
          for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768;

          const sampleRate = this._outputSampleRate || 16000;
          const buf    = this._audioCtx.createBuffer(1, float32.length, sampleRate);
          buf.getChannelData(0).set(float32);

          const src = this._audioCtx.createBufferSource();
          src.buffer = buf;
          src.connect(this._audioCtx.destination);

          // Schedule seamlessly after the previous chunk
          const startAt = Math.max(this._nextPlayTime, this._audioCtx.currentTime);
          src.start(startAt);
          this._nextPlayTime = startAt + buf.duration;
          src.onended = resolve;
        } catch (_) { resolve(); }
      });
    },

    // ── Transcript → Chatwoot ────────────────────────────────────────────
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
        console.warn('[VOICE] transcript post failed:', e?.message);
      }
    },

    // ── Cleanup ───────────────────────────────────────────────────────────
    _cleanup() {
      clearTimeout(this._metadataTimeout);
      // Stop mic
      if (this._workletNode) {
        try { this._workletNode.disconnect(); } catch (_) {}
        this._workletNode = null;
      }
      if (this._scriptProcessor) {
        try { this._scriptProcessor.disconnect(); } catch (_) {}
        this._scriptProcessor = null;
      }
      if (this._micStream) {
        try { this._micStream.getTracks().forEach(t => t.stop()); } catch (_) {}
        this._micStream = null;
      }
      // Close audio context
      if (this._audioCtx) {
        try { this._audioCtx.close(); } catch (_) {}
        this._audioCtx = null;
      }
      // Close WebSocket
      if (this._ws) {
        try { this._ws.close(); } catch (_) {}
        this._ws = null;
      }
      // Reset state
      this._audioQueue       = [];
      this._isPlayingAudio   = false;
      this._nextPlayTime     = 0;
      this._conversationId   = null;
      this.isCallActive      = false;
      this.isConnecting      = false;
      this.setActive(false);
      this.setConnecting(false);
    },

    // ── Page navigation reconnect ────────────────────────────────────────
    _saveReconnectFlag() {
      try {
        // Store only timestamp — no agent_id (server-side only now)
        localStorage.setItem('cw_voice_reconnect', JSON.stringify({
          startedAt: Date.now(),
        }));
      } catch (_) {}
    },
    _clearReconnectFlag() {
      try { localStorage.removeItem('cw_voice_reconnect'); } catch (_) {}
    },
    _checkAutoReconnect() {
      try {
        const raw = localStorage.getItem('cw_voice_reconnect');
        if (!raw) return;
        const { startedAt } = JSON.parse(raw);
        const withinWindow = Date.now() - startedAt < 2 * 60 * 1000;
        if (withinWindow) {
          setTimeout(() => this.startCall(), 600);
        } else {
          this._clearReconnectFlag();
        }
      } catch (_) { this._clearReconnectFlag(); }
    },

    // ── Audio helpers ────────────────────────────────────────────────────

    // Downsample float32 audio from srcRate → 16000Hz using linear interpolation
    _resampleTo16k(float32, srcRate) {
      if (srcRate === 16000) return float32;
      const ratio      = srcRate / 16000;
      const outLength  = Math.floor(float32.length / ratio);
      const output     = new Float32Array(outLength);
      for (let i = 0; i < outLength; i++) {
        const pos   = i * ratio;
        const index = Math.floor(pos);
        const frac  = pos - index;
        const a     = float32[index]     || 0;
        const b     = float32[index + 1] || 0;
        output[i]   = a + frac * (b - a); // linear interpolation
      }
      return output;
    },

    _float32ToPCM16(float32) {
      const buf  = new ArrayBuffer(float32.length * 2);
      const view = new DataView(buf);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      }
      return buf;
    },
    _bufferToBase64(buffer) {
      const bytes = new Uint8Array(buffer);
      let bin = '';
      for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
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
      <svg v-if="isConnecting" :width="iconSize" :height="iconSize" viewBox="0 0 24 24"
           fill="none" xmlns="http://www.w3.org/2000/svg" class="animate-spin">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2.5"
                stroke-linecap="round" stroke-dasharray="31.4 31.4" fill="none" />
      </svg>

      <!-- Active → hang-up icon -->
      <svg v-else-if="isCallActive" :width="iconSize" :height="iconSize" viewBox="0 0 24 24"
           fill="none" xmlns="http://www.w3.org/2000/svg" class="call-icon">
        <path d="M3.5 14.5c5.5-5 11.5-5 17 0 .8.7.9 2-0 2.7l-2.1 1.6c-.5.4-1.2.4-1.7 0l-2-1.7
                 a1.5 1.5 0 0 1-.5-1.1V14a9.8 9.8 0 0 0-4.4 0v0c0 .4-.2.8-.5 1.1l-2 1.6c-.5.4-1.2.4-1.7 0
                 L3.5 15c-.5-.6-.4-1.7 0-2.5Z"
              fill="currentColor" transform="rotate(135 12 12)" />
      </svg>

      <!-- Idle → phone icon -->
      <svg v-else :width="iconSize" :height="iconSize" viewBox="0 0 24 24"
           fill="none" xmlns="http://www.w3.org/2000/svg" class="call-icon">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07
                 a19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3
                 a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91
                 a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72
                 A2 2 0 0 1 22 16.92Z" fill="currentColor" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.elevenlabs-container { position: relative; display: inline-flex; }

.elevenlabs-voice-btn {
  background: transparent;
  color: var(--widget-color, #1f93ff);
}
.elevenlabs-voice-btn:hover:not(:disabled) {
  background: rgba(31, 147, 255, 0.1);
  transform: scale(1.05);
}
.elevenlabs-voice-btn:active:not(:disabled) { transform: scale(0.95); }

.call-icon { transition: transform 0.2s ease; }
.elevenlabs-connecting { opacity: 0.75; cursor: wait; }

.elevenlabs-active {
  background: #ef4444 !important;
  color: #ffffff !important;
  box-shadow: 0 0 0 4px rgba(239,68,68,.18);
  animation: pulse-active 1.6s ease-in-out infinite;
}
.elevenlabs-active:hover { background: #dc2626 !important; }

@keyframes pulse-active {
  0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,.45); }
  50%     { box-shadow: 0 0 0 8px rgba(239,68,68,.08); }
}
</style>
