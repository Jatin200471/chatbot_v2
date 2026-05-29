// ── Chatwoot Voice: floating End Call button ─────────────────────────────────
// This code is APPENDED to sdk.js at Docker build time.
// It runs on the PARENT PAGE automatically — no extra code needed on the website.
//
// How it works:
//   1. Widget iframe (App.vue) sends { event: 'voice-call-active', isActive: true }
//      when call is active AND widget bubble is closed.
//   2. This listener on parent page shows the red "End Call" button.
//   3. Button click sends { event: 'end-voice-call-from-parent' } back to iframe.
//   4. App.vue receives it → emitter.emit('end-voice-call') → ElevenLabsVoiceButton.endCall()
//
// Guard: _cwVoiceBtnInstalled prevents double-inject if someone also pastes
// the old embed script that contained this code.
// ─────────────────────────────────────────────────────────────────────────────
;(function() {
  if (window._cwVoiceBtnInstalled) return;
  window._cwVoiceBtnInstalled = true;

  var BTN_ID = 'cw-voice-end-btn';

  function getBtn() { return document.getElementById(BTN_ID); }

  function showBtn() {
    var btn = getBtn();
    if (btn) { btn.style.display = 'flex'; return; }

    if (!document.getElementById('cw-voice-style')) {
      var s = document.createElement('style');
      s.id = 'cw-voice-style';
      s.textContent = '@keyframes cwPulse{0%,100%{box-shadow:0 4px 16px rgba(239,68,68,.55)}50%{box-shadow:0 4px 28px rgba(239,68,68,.18)}} #cw-voice-end-btn:hover{background:#dc2626!important}';
      document.head.appendChild(s);
    }

    btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.title = 'End Voice Call';
    btn.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0">' +
      '<path d="M3.5 14.5c5.5-5 11.5-5 17 0 .8.7.9 2 0 2.7l-2.1 1.6c-.5.4-1.2.4-1.7 0l-2-1.7' +
      'a1.5 1.5 0 0 1-.5-1.1V14a9.8 9.8 0 0 0-4.4 0v0c0 .4-.2.8-.5 1.1l-2 1.6c-.5.4-1.2.4-1.7 0' +
      'L3.5 15c-.5-.6-.4-1.7 0-2.5Z" transform="rotate(135 12 12)"/></svg>' +
      '<span style="margin-left:7px;font-size:13px;font-weight:600;letter-spacing:.01em">End Call</span>';

    btn.style.cssText = [
      'position:fixed', 'bottom:90px', 'right:20px', 'z-index:2147483647',
      'display:flex', 'align-items:center', 'justify-content:center',
      'background:#ef4444', 'color:#fff', 'border:none', 'outline:none',
      'padding:11px 20px', 'border-radius:999px', 'cursor:pointer',
      'font-family:inherit', 'transition:background .15s',
      'animation:cwPulse 1.6s ease-in-out infinite'
    ].join(';');

    btn.onclick = function() {
      document.querySelectorAll('iframe').forEach(function(f) {
        try { f.contentWindow.postMessage({ event: 'end-voice-call-from-parent' }, '*'); } catch(e) {}
      });
    };

    document.body.appendChild(btn);
  }

  function hideBtn() {
    var btn = getBtn();
    if (btn) btn.style.display = 'none';
  }

  window.addEventListener('message', function(e) {
    if (!e.data || typeof e.data !== 'object') return;
    if (e.data.event === 'voice-call-active') {
      e.data.isActive ? showBtn() : hideBtn();
    }
  });
})();
