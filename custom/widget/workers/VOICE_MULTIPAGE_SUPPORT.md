# Voice Call Multipage Support Guide

## Problem Solved
Your voice calls now persist across multiple page navigations. When you navigate between pages, the call **stays active** and doesn't disconnect.

## How It Works

### SharedWorker Architecture
The solution uses **SharedWorker** — a browser API that runs in the background independent of pages:

```
┌─────────────────────────────────────────────────────────┐
│         Browser SharedWorker (voice-shared-worker.js)   │
│                                                          │
│   - Manages ONE WebSocket connection                    │
│   - Keeps connection alive across page navigation       │
│   - Broadcasts call state to all connected pages        │
│                                                          │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────┐  │
│  │ Connection:    │  │ Connection:    │  │   ...    │  │
│  │ Page 1 (Home)  │  │ Page 2 (FAQ)   │  │ Page N   │  │
│  │ Port          │  │ Port          │  │ Port    │  │
│  └────────────────┘  └────────────────┘  └──────────┘  │
│         ↕                  ↕                   ↕         │
│   postMessage()      postMessage()      postMessage()  │
│                                                          │
└─────────────────────────────────────────────────────────┘
         ↑
         │ WebSocket (ONE connection, all pages share it)
         │
    ElevenLabs API Server
```

### Key Components

#### 1. **Voice Shared Worker** (`workers/voice-shared-worker.js`)
- Manages the only WebSocket connection to ElevenLabs
- When a page navigates, the worker **keeps the connection alive**
- When a new page loads, it connects to the same worker
- Worker broadcasts transcript + call state to all connected pages

#### 2. **Voice Button Component** (`components/ElevenLabsVoiceButton.vue`)
- Connects to the SharedWorker on mount
- Asks worker: "Is there an active call?"
- If yes, syncs the call state
- Listens for worker messages (transcript, call state changes)
- When user navigates away, the connection stays in the worker

#### 3. **Transcript & Backend Sync**
- Worker broadcasts transcript to all pages
- Each page's component saves transcript to backend independently
- Backend gets transcript notifications only once per unique message

## Usage

### Enable Debug Mode
To see what's happening in the console:

```javascript
localStorage.setItem('cw_voice_debug', 'true')
```

Then open DevTools console. You'll see logs like:
```
[VOICE] SharedWorker connected
[VOICE-WORKER] Page connected. Total ports: 1
[VOICE-WORKER] transcript [user]: "Hello"
[VOICE] Worker message: TRANSCRIPT
```

### Disable Debug Mode
```javascript
localStorage.removeItem('cw_voice_debug')
```

## Testing Multipage Support

1. **Start a voice call** on Page 1 (Home)
2. **Navigate to Page 2** (FAQ, Pricing, etc.)
3. **Voice call stays active** ✅
4. **Navigate back to Page 1**
5. **Call still active** ✅
6. **End call** on any page — disconnects from SharedWorker

## Browser Support

| Browser | SharedWorker |
|---------|-------------|
| Chrome  | ✅ Yes      |
| Firefox | ✅ Yes      |
| Safari  | ⚠️ Limited  |
| Edge    | ✅ Yes      |

**Note:** If SharedWorker is not supported, the component falls back to window-local storage (old behavior). No error shown to users.

## Technical Details

### Message Types

**Page → Worker:**
- `START_CALL`: `{ signedUrl: "..." }` — Start new voice call
- `END_CALL`: `{}` — End current call
- `SYNC_STATE`: `{}` — Ask for current call state
- `MUTE`: `{ isMuted: true/false }` — Toggle input device

**Worker → Page:**
- `CALL_STATE`: `{ isActive: true/false, isConnecting: true/false }`
- `TRANSCRIPT`: `{ source: "user"|"agent", message: "..." }`
- `CALL_ERROR`: `{ error: "..." }`
- `CALL_ENDED`: `{}` — Call ended, notify backend

### Transcript Handling

When worker receives transcript:
1. Worker broadcasts to all connected pages
2. Each page independently saves to backend
3. Backend receives only one transcript per message (deduplication)

This ensures:
- ✅ Transcript appears immediately on all pages
- ✅ No duplicate transcript entries
- ✅ Real-time sync across pages

### Connection Lifecycle

```
Page 1 Click "Call"
    ↓
Worker creates WebSocket → ElevenLabs API
    ↓
Connection established → broadcast to Page 1
    ↓
User navigates to Page 2
    ↓
Page 2 connects to worker → worker syncs state
    ↓
WebSocket **STAYS ALIVE** in worker
    ↓
User navigates back to Page 1
    ↓
Page 1 reconnects to worker → gets live call state
    ↓
User clicks "End Call"
    ↓
Worker closes WebSocket → broadcasts to all pages
```

## Performance Impact

- **Memory**: Minimal — SharedWorker runs once per origin
- **CPU**: Minimal — only when actively on a call
- **Network**: No extra traffic — same single WebSocket connection

## Troubleshooting

### Voice call disconnects on page navigation
- **Check**: Is SharedWorker supported? (Open DevTools → Application → Workers)
- **Check**: Debug logs enabled? See console for errors
- **Fix**: Clear cache, refresh page

### SharedWorker not connecting
```javascript
// Check if browser supports SharedWorker
'SharedWorker' in window ? console.log('✅ Supported') : console.log('❌ Not supported')
```

### Transcript not saving
- Check: Is API endpoint `/api/v1/widget/conversations/voice_transcript` reachable?
- Check: Network tab in DevTools for failed requests
- Debug: Enable debug mode and watch console logs

## Future Enhancements

- [ ] Service Worker support for HTTPS-only contexts
- [ ] Automatic reconnect on network failure
- [ ] Multi-tab call state visualization
- [ ] Call recording across page navigations

---

**Last Updated:** 2026-06-08
**Compatibility:** Chatwoot Custom + ElevenLabs Voice Agent
