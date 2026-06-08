/**
 * SharedWorker — manages voice conversation across ALL pages
 * Survives page navigation, tab switching, and component unmounts
 * 
 * All pages connect to this worker — only ONE WebSocket per user session
 */

let conversationSession = null;
let conversationClass = null;
let ports = []; // All connected pages

// Debug
const vLog = (...args) => {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('cw_voice_debug') === 'true') {
      console.log('[VOICE-WORKER]', ...args);
    }
  } catch (_) {}
};

// Handle new page connecting to this worker
self.addEventListener('connect', (e) => {
  const port = e.ports[0];
  ports.push(port);
  vLog(`Page connected. Total ports: ${ports.length}`);

  port.addEventListener('message', (evt) => {
    const { type, payload } = evt.data;
    vLog(`Message from page:`, type);

    if (type === 'START_CALL') {
      startCall(payload, port);
    } else if (type === 'END_CALL') {
      endCall(port);
    } else if (type === 'SYNC_STATE') {
      // New page needs to know if call is active
      broadcastState(port);
    } else if (type === 'MUTE') {
      if (conversationSession?.setInputDeviceSettings) {
        conversationSession.setInputDeviceSettings({ enabled: !payload.isMuted });
      }
    }
  });

  port.start();

  // Tell this page the current state
  broadcastState(port);
});

async function startCall(payload, initiatorPort) {
  // If already calling, just sync state to new page
  if (conversationSession) {
    vLog('Call already active, syncing to new page');
    broadcastState(initiatorPort);
    return;
  }

  try {
    vLog('Starting call...');

    // Load SDK if not loaded
    if (!conversationClass) {
      const mod = await import('https://esm.sh/@11labs/client');
      conversationClass = mod.Conversation;
    }

    // Start conversation
    conversationSession = await conversationClass.startSession({
      signedUrl: payload.signedUrl,

      onMessage: ({ message, source }) => {
        vLog(`transcript [${source}]:`, message);
        // Broadcast to all connected pages — they'll save to backend
        broadcastToAllPorts({
          type: 'TRANSCRIPT',
          payload: { source, message }
        });
      },

      onConnect: () => {
        vLog('Connected ✅');
        broadcastToAllPorts({
          type: 'CALL_STATE',
          payload: { isActive: true, isConnecting: false }
        });
      },

      onDisconnect: () => {
        vLog('Disconnected');
        conversationSession = null;
        broadcastToAllPorts({
          type: 'CALL_STATE',
          payload: { isActive: false, isConnecting: false }
        });
        broadcastToAllPorts({
          type: 'CALL_ENDED'
        });
      },

      onError: (err) => {
        vLog('Error:', err);
        broadcastToAllPorts({
          type: 'CALL_ERROR',
          payload: { error: err?.message }
        });
      },
    });

    broadcastToAllPorts({
      type: 'CALL_STATE',
      payload: { isActive: true, isConnecting: false }
    });

  } catch (error) {
    console.error('[VOICE-WORKER] startCall failed:', error?.message);
    conversationSession = null;
    broadcastToAllPorts({
      type: 'CALL_ERROR',
      payload: { error: error?.message }
    });
  }
}

async function endCall(port) {
  if (conversationSession) {
    try {
      await conversationSession.endSession();
    } catch (e) {
      vLog('endSession error:', e?.message);
    }
    conversationSession = null;
  }

  broadcastToAllPorts({
    type: 'CALL_STATE',
    payload: { isActive: false, isConnecting: false }
  });
}

function broadcastState(port) {
  const isActive = !!conversationSession;
  port.postMessage({
    type: 'CALL_STATE',
    payload: { isActive, isConnecting: false }
  });
}

function broadcastToAllPorts(message) {
  ports.forEach(port => {
    try {
      port.postMessage(message);
    } catch (e) {
      vLog('Broadcast failed:', e?.message);
    }
  });
  // Clean dead ports
  ports = ports.filter(p => {
    try {
      return !!p;
    } catch {
      return false;
    }
  });
}

vLog('SharedWorker initialized');
