/**
 * SharedWorker — manages ElevenLabs voice conversation across ALL pages/tabs.
 *
 * Architecture:
 *   • One SharedWorker instance per browser origin (Chrome/Edge share it across tabs)
 *   • Survives page navigation, tab switching, and Vue component unmounts
 *   • Holds the single WebSocket/WebRTC connection to ElevenLabs
 *   • All connected pages get broadcast messages for state sync
 *
 * Message protocol (page → worker):
 *   START_CALL  { signedUrl }    — start a new ElevenLabs session
 *   END_CALL                     — end the active session
 *   SYNC_STATE                   — ask worker for current call state (on mount)
 *   MUTE        { isMuted }      — toggle microphone
 *
 * Message protocol (worker → page):
 *   CALL_STATE  { isActive, isConnecting }  — authoritative call state
 *   TRANSCRIPT  { source, message }         — live transcript line
 *   CALL_ENDED                               — session ended (trigger backend notify)
 *   CALL_ERROR  { error }                   — something went wrong
 */

let conversationSession = null;   // Active ElevenLabs Conversation instance
let conversationClass   = null;   // Loaded once from esm.sh
let isConnecting        = false;  // Guard: prevent double-start races

// All ports connected to this worker (one per page/tab)
const ports = new Set();

// ─── Debug logger ────────────────────────────────────────────────────────────
// Enable in browser:  localStorage.setItem('cw_voice_debug', 'true')
const vLog = (...args) => {
  try {
    // SharedWorker has no localStorage; rely on importScripts trick or just
    // check a module-level flag that can be toggled via DEBUG_ENABLE message.
    if (_debugEnabled) console.log('[VOICE-WORKER]', ...args);
  } catch (_) {}
};
let _debugEnabled = false;

// ─── Port lifecycle ───────────────────────────────────────────────────────────
self.addEventListener('connect', (e) => {
  const port = e.ports[0];
  ports.add(port);
  vLog(`Port connected. Total: ${ports.size}`);

  port.addEventListener('message', (evt) => {
    handleMessage(evt.data, port);
  });

  // Required: start the port's message queue
  port.start();

  // Immediately sync state so the new page knows call status
  sendToPort(port, {
    type: 'CALL_STATE',
    payload: { isActive: !!conversationSession, isConnecting },
  });
});

// ─── Message handler ──────────────────────────────────────────────────────────
function handleMessage({ type, payload }, port) {
  vLog('← msg:', type, payload);
  switch (type) {
    case 'START_CALL':
      startCall(payload, port);
      break;
    case 'END_CALL':
      endCall();
      break;
    case 'SYNC_STATE':
      sendToPort(port, {
        type: 'CALL_STATE',
        payload: { isActive: !!conversationSession, isConnecting },
      });
      break;
    case 'MUTE':
      if (conversationSession?.setInputDeviceSettings) {
        // ElevenLabs SDK: enabled:false = muted
        conversationSession.setInputDeviceSettings({ enabled: !payload.isMuted });
      }
      break;
    case 'DEBUG_ENABLE':
      _debugEnabled = true;
      break;
    default:
      vLog('Unknown message type:', type);
  }
}

// ─── Start call ───────────────────────────────────────────────────────────────
async function startCall({ signedUrl } = {}, initiatorPort) {
  // Already active — just sync state back to the requesting page
  if (conversationSession) {
    vLog('Call already active — syncing state');
    broadcastToAll({
      type: 'CALL_STATE',
      payload: { isActive: true, isConnecting: false },
    });
    return;
  }

  // Race guard — ignore if another startCall is in-flight
  if (isConnecting) {
    vLog('startCall already in progress — ignoring duplicate');
    return;
  }

  if (!signedUrl) {
    broadcastToAll({
      type: 'CALL_ERROR',
      payload: { error: 'No signedUrl provided to SharedWorker' },
    });
    return;
  }

  isConnecting = true;
  broadcastToAll({
    type: 'CALL_STATE',
    payload: { isActive: false, isConnecting: true },
  });

  try {
    vLog('Loading ElevenLabs SDK…');
    if (!conversationClass) {
      // Load SDK once; esm.sh is cached after first load
      const mod = await import('https://esm.sh/@11labs/client');
      conversationClass = mod.Conversation;
      vLog('SDK loaded ✓');
    }

    vLog('Starting ElevenLabs session…');
    conversationSession = await conversationClass.startSession({
      signedUrl,

      onConnect: () => {
        vLog('Connected ✅');
        isConnecting = false;
        broadcastToAll({
          type: 'CALL_STATE',
          payload: { isActive: true, isConnecting: false },
        });
      },

      onMessage: ({ message, source }) => {
        const text = (message || '').toString().trim();
        if (!text) return;
        vLog(`transcript [${source}]:`, text);
        broadcastToAll({
          type: 'TRANSCRIPT',
          payload: { source, message: text },
        });
      },

      onDisconnect: () => {
        vLog('Disconnected');
        conversationSession = null;
        isConnecting = false;
        broadcastToAll({
          type: 'CALL_STATE',
          payload: { isActive: false, isConnecting: false },
        });
        broadcastToAll({ type: 'CALL_ENDED' });
      },

      onError: (err) => {
        const msg = err?.message || String(err);
        console.error('[VOICE-WORKER] Session error:', msg);
        conversationSession = null;
        isConnecting = false;
        broadcastToAll({
          type: 'CALL_STATE',
          payload: { isActive: false, isConnecting: false },
        });
        broadcastToAll({
          type: 'CALL_ERROR',
          payload: { error: msg },
        });
      },
    });

    // startSession resolves after the session is created but BEFORE onConnect
    // fires. We keep isConnecting=true until onConnect clears it above.
    vLog('startSession returned — waiting for onConnect…');

  } catch (error) {
    const msg = error?.message || String(error);
    console.error('[VOICE-WORKER] startCall failed:', msg);
    conversationSession = null;
    isConnecting = false;
    broadcastToAll({
      type: 'CALL_STATE',
      payload: { isActive: false, isConnecting: false },
    });
    broadcastToAll({
      type: 'CALL_ERROR',
      payload: { error: msg },
    });
  }
}

// ─── End call ─────────────────────────────────────────────────────────────────
async function endCall() {
  if (!conversationSession) {
    // No active session — just reset state in case UI is out of sync
    isConnecting = false;
    broadcastToAll({
      type: 'CALL_STATE',
      payload: { isActive: false, isConnecting: false },
    });
    return;
  }

  try {
    vLog('Ending session…');
    await conversationSession.endSession();
    // onDisconnect callback above handles clearing + broadcasting
  } catch (e) {
    vLog('endSession error (ignored):', e?.message);
    // Force-clear even if endSession threw
    conversationSession = null;
    isConnecting = false;
    broadcastToAll({
      type: 'CALL_STATE',
      payload: { isActive: false, isConnecting: false },
    });
    broadcastToAll({ type: 'CALL_ENDED' });
  }
}

// ─── Broadcast helpers ────────────────────────────────────────────────────────
function sendToPort(port, message) {
  try {
    port.postMessage(message);
  } catch (e) {
    // Port is dead (page closed/navigated away) — remove it
    vLog('Dead port removed:', e?.message);
    ports.delete(port);
  }
}

function broadcastToAll(message) {
  const dead = [];
  for (const port of ports) {
    try {
      port.postMessage(message);
    } catch (e) {
      dead.push(port);
    }
  }
  dead.forEach(p => ports.delete(p));
  vLog(`→ broadcast ${message.type} to ${ports.size} port(s)`);
}

vLog('SharedWorker initialized');