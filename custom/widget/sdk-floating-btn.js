// ── Chatwoot Voice + Widget Extensions ───────────────────────────────────────
// Appended to sdk.js at Docker build time — runs on every parent page that
// loads sdk.js. Nothing extra needed in the embed snippet.
//
// HARD-REFRESH image variant: page navigation does a normal FULL page reload.
// An active voice call survives because it runs in its own popup window
// (voice-popup.html), not in the parent iframe.
//
// FEATURES bundled here (all host-page-safe — no global API patching):
//
//  1. WIDGET STATE PERSISTENCE
//     If widget was open when user navigated away, auto-open it on the new page.
//     Works for both text chat and voice. Uses localStorage key 'cw_widget_open'.
//
//  2. FLOATING "END CALL" BUTTON
//     (Defined but disabled in this variant — the popup is the only call UI.)
//
//  4. PRE-CHAT FORM AUTO-FILL from website cookies (see below).
//
//  5. VOICE POPUP — hide the Chatwoot widget while the popup call is open,
//     restore it when the popup closes.
//
//  (Former Feature 3 — voice-aware SPA navigation — was removed; it re-ran
//   host page scripts and broke modern frameworks. See note further down.)
//
// ─────────────────────────────────────────────────────────────────────────────
// ── Native API Shield (restore) — INERT ─────────────────────────────────────
// This block used to restore native browser APIs saved by the prefix script
// (sdk-stream-fix.js). That prefix has been removed, so window.__cwNativeAPIs
// is undefined and this block early-returns (no-op). Kept so old cached builds
// degrade safely; can be deleted in a later cleanup.
;(function () {
  var s = window.__cwNativeAPIs;
  if (!s) return;
  var w = window, d = document, h = w.history;

  function r(obj, key, orig) {
    try {
      if (orig !== undefined && obj[key] !== orig) obj[key] = orig;
    } catch (_) {}
  }

  r(w, 'ReadableStream',       s.ReadableStream);
  r(w, 'WritableStream',       s.WritableStream);
  r(w, 'TransformStream',      s.TransformStream);
  r(w, 'fetch',                s.fetch);
  r(w, 'Request',              s.Request);
  r(w, 'Response',             s.Response);
  r(w, 'Headers',              s.Headers);
  r(w, 'AbortController',      s.AbortController);
  r(w, 'AbortSignal',          s.AbortSignal);
  r(w, 'XMLHttpRequest',       s.XMLHttpRequest);
  r(w, 'EventSource',          s.EventSource);
  r(w, 'WebSocket',            s.WebSocket);
  if (h) {
    r(h, 'pushState',          s.historyPushState);
    r(h, 'replaceState',       s.historyReplaceState);
  }
  r(w, 'URL',                  s.URL);
  r(w, 'URLSearchParams',      s.URLSearchParams);
  r(w, 'MutationObserver',     s.MutationObserver);
  r(w, 'IntersectionObserver', s.IntersectionObserver);
  r(w, 'ResizeObserver',       s.ResizeObserver);
  r(w, 'PerformanceObserver',  s.PerformanceObserver);
  r(w, 'MessageChannel',       s.MessageChannel);
  r(w, 'MessagePort',          s.MessagePort);
  r(w, 'BroadcastChannel',     s.BroadcastChannel);
  r(w, 'Promise',              s.Promise);
  r(w, 'queueMicrotask',       s.queueMicrotask);
  r(w, 'setTimeout',           s.setTimeout);
  r(w, 'clearTimeout',         s.clearTimeout);
  r(w, 'setInterval',          s.setInterval);
  r(w, 'clearInterval',        s.clearInterval);
  r(w, 'requestAnimationFrame',    s.requestAnimationFrame);
  r(w, 'cancelAnimationFrame',     s.cancelAnimationFrame);
  r(w, 'requestIdleCallback',      s.requestIdleCallback);
  r(w, 'cancelIdleCallback',       s.cancelIdleCallback);
  r(w, 'CustomEvent',          s.CustomEvent);
  r(w, 'Event',                s.Event);
  try {
    if (s.createElement)      d.createElement      = s.createElement;
    if (s.createElementNS)    d.createElementNS    = s.createElementNS;
    if (s.createTreeWalker)   d.createTreeWalker   = s.createTreeWalker;
    if (s.querySelector)      d.querySelector      = s.querySelector;
    if (s.querySelectorAll)   d.querySelectorAll   = s.querySelectorAll;
  } catch (_) {}

  try {
    delete w.onmessage;
    if (Object.getOwnPropertyDescriptor(w, 'onmessage')) {
      Object.defineProperty(w, 'onmessage', {
        configurable: true, writable: true, value: null,
      });
    }
    delete w.__cwOnMessageHandlers;
  } catch (_) {}

  try {
    var snap = w.__cwProtoSnapshot;
    if (snap) {
      Object.getOwnPropertyNames(Array.prototype).forEach(function (k) {
        if (snap.ArrayProtoKeys.indexOf(k) === -1) {
          try { delete Array.prototype[k]; } catch (_) {}
        }
      });
      Object.getOwnPropertyNames(Object.prototype).forEach(function (k) {
        if (snap.ObjectProtoKeys.indexOf(k) === -1) {
          try { delete Object.prototype[k]; } catch (_) {}
        }
      });
      delete w.__cwProtoSnapshot;
    }
  } catch (_) {}

  delete w.__cwNativeAPIs;
})();

;(function () {
  if (window._cwVoiceInstalled) return;
  window._cwVoiceInstalled = true;

  // Shared flag — true while a voice call is in progress
  window._cwVoiceActive = false;

  // localStorage key for widget open/close state
  var WIDGET_OPEN_KEY = 'cw_widget_open';

  // ════════════════════════════════════════════════════════════════════════
  // FEATURE 1 — Widget state persistence across page navigation
  // ════════════════════════════════════════════════════════════════════════
  //
  // Flow:
  //   Page A: widget open  → localStorage: cw_widget_open = "true"
  //   Navigate to Page B   → widget closes (browser default)
  //   chatwoot:ready fires → reads "true" → auto-opens widget after 800ms
  //
  // During voice SPA navigation the page is NOT reloaded, so chatwoot:ready
  // does NOT fire — no conflict with feature 3 below.

  // ════════════════════════════════════════════════════════════════════════
  // FEATURE 4 — Pre-chat form auto-fill from website cookies
  // ════════════════════════════════════════════════════════════════════════
  //
  // Reads user data from website cookies (set at login) and sends it to the
  // Chatwoot iframe so the pre-chat form opens pre-filled.
  // Customer can still edit/clear any field before submitting.
  //
  // ⚙️  CONFIGURE: Set your website's cookie names below.
  //     Open DevTools → Application → Cookies → find the keys after login.

  var PREFILL_COOKIE_KEYS = {
    name:  'user_name',   // ← apne cookie ka naam yahan daalo
    email: 'user_email',  // ← apne cookie ka naam yahan daalo
    phone: 'user_phone',  // ← apne cookie ka naam yahan daalo (optional)
  };

  function readCookie(name) {
    var match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function sendPrefillData() {
    var name  = readCookie(PREFILL_COOKIE_KEYS.name);
    var email = readCookie(PREFILL_COOKIE_KEYS.email);
    var phone = readCookie(PREFILL_COOKIE_KEYS.phone);

    if (!name && !email && !phone) return; // not logged in — skip

    document.querySelectorAll('iframe').forEach(function (f) {
      try {
        f.contentWindow.postMessage({
          event: 'prefill-form-data',
          name:  name  || '',
          email: email || '',
          phone: phone || '',
        }, '*');
      } catch (_) {}
    });
  }

  // ── Fix iframe audio autoplay permission ────────────────────────────────
  // Browsers block audio autoplay inside iframes unless explicitly allowed.
  // We patch the iframe's allow attribute as soon as it appears in the DOM.
  function fixIframeAudioPermission() {
    var iframes = document.querySelectorAll('iframe');
    iframes.forEach(function(f) {
      if (!f || !f.getAttribute) return;
      try {
        var allow = f.getAttribute('allow') || '';
        var needs = ['microphone', 'autoplay', 'camera'];
        var missing = needs.filter(function(p) { return !allow.includes(p); });
        if (missing.length > 0) {
          f.setAttribute('allow', (allow + '; ' + missing.join('; ')).trim());
        }
      } catch (_) {}
    });
  }

  // Run immediately and observe for new iframes
  fixIframeAudioPermission();
  var _iframeObserver = new MutationObserver(function() {
    fixIframeAudioPermission();
  });
  _iframeObserver.observe(document.body, { childList: true, subtree: true });

  // ── Custom bubble icon support ───────────────────────────────────────────
  // Intercepts the 'loaded' chatwoot-widget postMessage (sent by the widget
  // iframe) to read customBubbleIconUrl/Size directly from channelConfig.
  // This works regardless of which sdk.js is served.
  var _cwCustomBubbleIconUrl = null;
  var _cwCustomBubbleIconSize = 60;
  var _cwWidgetColor = null;

  function _applyCwBubbleIcon() {
    if (!_cwCustomBubbleIconUrl) return false;
    var bubble = document.querySelector('.woot-widget-bubble:not(.woot--close)');
    if (!bubble) return false;

    // Hide SVG so it doesn't render on top of background layers
    var svg = bubble.querySelector('svg');
    if (svg) svg.style.display = 'none';

    // Layer 1 (top): custom icon centered at configured size
    // Layer 2 (bottom): original widget gradient/color
    var iconUrl = "url('" + _cwCustomBubbleIconUrl.replace(/'/g, "\\'") + "')";
    var sizePct = (_cwCustomBubbleIconSize || 60) + '%';
    var bgColor = _cwWidgetColor || '#1f93ff';

    bubble.style.backgroundImage = iconUrl + ', ' + bgColor;
    bubble.style.backgroundSize = sizePct + ', cover';
    bubble.style.backgroundPosition = 'center, center';
    bubble.style.backgroundRepeat = 'no-repeat, no-repeat';
    return true;
  }

  // Intercept the chatwoot-widget 'loaded' string message to get channelConfig
  window.addEventListener('message', function (e) {
    try {
      if (typeof e.data !== 'string' || e.data.indexOf('chatwoot-widget:') !== 0) return;
      var msg = JSON.parse(e.data.replace('chatwoot-widget:', ''));
      if (msg.event !== 'loaded') return;
      var ch = msg.config && msg.config.channelConfig;
      if (!ch || !ch.customBubbleIconUrl) return;

      _cwCustomBubbleIconUrl = ch.customBubbleIconUrl;
      _cwCustomBubbleIconSize = ch.customBubbleIconSize || 60;
      _cwWidgetColor = ch.widgetColor || '#1f93ff';

      // Bubble may not exist yet — poll until it appears
      var attempts = 0;
      var poll = setInterval(function () {
        if (_applyCwBubbleIcon() || ++attempts > 40) clearInterval(poll);
      }, 150);
    } catch (_) {}
  });

  // Also re-apply on chatwoot:ready (handles page re-navigation edge cases)
  window.addEventListener('chatwoot:ready', function () {
    setTimeout(function () { _applyCwBubbleIcon(); }, 200);
  });

  window.addEventListener('chatwoot:ready', function () {

    // ── Restore widget state from previous page ──────────────────────────
    try {
      if (localStorage.getItem(WIDGET_OPEN_KEY) === 'true') {
        setTimeout(function () {
          try {
            if (window.$chatwoot && !window.$chatwoot.isOpen) {
              window.$chatwoot.toggle('open');
            }
          } catch (_) {}
        }, 800);
      }
    } catch (_) {}

    // ── Save widget state on every open / close ──────────────────────────
    // Primary: use Chatwoot's own open/close events (zero polling overhead).
    window.addEventListener('chatwoot:on-open', function () {
      try { localStorage.setItem(WIDGET_OPEN_KEY, 'true'); } catch (_) {}
      // Send prefill data every time widget opens (in case form re-renders)
      setTimeout(sendPrefillData, 300);
    });
    window.addEventListener('chatwoot:on-close', function () {
      try { localStorage.setItem(WIDGET_OPEN_KEY, 'false'); } catch (_) {}
    });

    // Fallback: poll every second in case events are not fired in this build.
    setInterval(function () {
      try {
        if (window.$chatwoot) {
          localStorage.setItem(WIDGET_OPEN_KEY,
            window.$chatwoot.isOpen ? 'true' : 'false');
        }
      } catch (_) {}
    }, 1000);

  });

  // ════════════════════════════════════════════════════════════════════════
  // FEATURE 2 — Floating "End Call" button
  // ════════════════════════════════════════════════════════════════════════

  var BTN_ID = 'cw-voice-end-btn';

  function getBtn() { return document.getElementById(BTN_ID); }

  function showBtn() {
    var btn = getBtn();
    if (btn) { btn.style.display = 'flex'; return; }

    if (!document.getElementById('cw-voice-style')) {
      var s = document.createElement('style');
      s.id = 'cw-voice-style';
      s.textContent =
        '@keyframes cwPulse{0%,100%{box-shadow:0 4px 16px rgba(239,68,68,.55)}' +
        '50%{box-shadow:0 4px 28px rgba(239,68,68,.18)}}' +
        ' #cw-voice-end-btn:hover{background:#dc2626!important}';
      document.head.appendChild(s);
    }

    btn = document.createElement('button');
    btn.id  = BTN_ID;
    btn.title = 'End Voice Call';
    btn.innerHTML =
      '<span style="position:relative;display:block;min-width:64px;line-height:1;">' +
        '<span style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;align-items:center;justify-content:center;width:16px;height:16px;pointer-events:none;">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="display:block;">' +
            '<path d="M3.5 14.5c5.5-5 11.5-5 17 0 .8.7.9 2 0 2.7l-2.1 1.6c-.5.4-1.2.4-1.7 0l-2-1.7' +
            'a1.5 1.5 0 0 1-.5-1.1V14a9.8 9.8 0 0 0-4.4 0v0c0 .4-.2.8-.5 1.1l-2 1.6c-.5.4-1.2.4-1.7 0' +
            'L3.5 15c-.5-.6-.4-1.7 0-2.5Z" transform="rotate(135 12 12)"/>' +
          '</svg>' +
        '</span>' +
        '<span style="display:block;width:100%;text-align:center;font-size:13px;font-weight:600;letter-spacing:.01em;line-height:1;">End Call</span>' +
      '</span>';

    btn.style.cssText = [
      'position:fixed', 'bottom:90px', 'right:20px', 'z-index:2147483647',
      'display:flex', 'align-items:center', 'justify-content:center',
      'background:#ef4444', 'color:#fff', 'border:none', 'outline:none',
      'padding:11px 20px', 'border-radius:999px', 'cursor:pointer',
      'font-family:inherit', 'transition:background .15s',
      'animation:cwPulse 1.6s ease-in-out infinite'
    ].join(';');

    btn.onclick = function () {
      document.querySelectorAll('iframe').forEach(function (f) {
        try { f.contentWindow.postMessage({ event: 'end-voice-call-from-parent' }, '*'); } catch (e) {}
      });
    };

    document.body.appendChild(btn);
  }

  function hideBtn() {
    var btn = getBtn();
    if (btn) btn.style.display = 'none';
  }

  // Auto-open widget after voice reconnect (idempotent — no-op if already open)
  function autoOpenWidget() {
    try {
      if (window.$chatwoot && typeof window.$chatwoot.toggle === 'function') {
        window.$chatwoot.toggle('open');
      }
    } catch (_) {}
  }

  // ════════════════════════════════════════════════════════════════════════
  // FEATURE 3 — Voice-aware SPA navigation  [REMOVED]
  // ════════════════════════════════════════════════════════════════════════
  //
  // This is the HARD-REFRESH image variant: page navigation does a normal full
  // page reload, and the active voice call survives because it runs in its own
  // popup window (voice-popup.html, Feature 5 below) — NOT in the parent iframe.
  //
  // The old fetch-and-swap SPA navigation re-executed every page <script> on
  // navigation, which:
  //   • contradicted this variant's "always full reload" design, and
  //   • corrupted modern frameworks (React/Next/Vue/Sanity), causing:
  //     "Failed to execute 'enqueue' on 'ReadableStreamDefaultController':
  //      Cannot enqueue a chunk into a readable stream that is closed"
  //
  // So it has been removed entirely. Links now reload normally; the popup keeps
  // the call alive across the reload.

  // ════════════════════════════════════════════════════════════════════════
  // postMessage listener — bridges Features 2 & 4
  // ════════════════════════════════════════════════════════════════════════

  function applyVoiceState(isActive, autoOpen) {
    window._cwVoiceActive = !!isActive;
    // Floating End Call button disabled — popup is the only UI
    // showBtn / hideBtn intentionally not called
    if (isActive && autoOpen) autoOpenWidget();
  }

  // ════════════════════════════════════════════════════════════════════════
  // FEATURE 5 — Voice popup window: hide/show Chatwoot widget while open
  // ════════════════════════════════════════════════════════════════════════
  //
  // When the voice call runs in a separate popup window (see voice-popup.html),
  // we hide the entire Chatwoot widget on the parent page so the popup is the
  // only visible interface. When the popup closes, the widget reappears.
  var WIDGET_SELECTORS = [
    '#chatwoot_live_chat_widget',  // The widget iframe itself
    '#cw-widget-holder',
    '#woot-widget-holder',
    '#cw-bubble-holder',
    '.woot-widget-holder',
    '.woot-widget-bubble',         // Floating bubble launcher
    '.woot--bubble-holder',
    '.woot-elements--right',
    '.woot-elements--left',
  ];

  function _ensureHideStyle() {
    if (document.getElementById('cw-voice-hide-style')) return;
    var s = document.createElement('style');
    s.id = 'cw-voice-hide-style';
    s.textContent =
      '.cw-voice-hidden{display:none !important;visibility:hidden !important;' +
      'opacity:0 !important;pointer-events:none !important;}';
    document.head.appendChild(s);
  }
  function _hideChatwootWidget() {
    _ensureHideStyle();
    WIDGET_SELECTORS.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        el.classList.add('cw-voice-hidden');
      });
    });
  }
  function _showChatwootWidget() {
    document.querySelectorAll('.cw-voice-hidden').forEach(function (el) {
      el.classList.remove('cw-voice-hidden');
    });
  }

  // ── Voice call state tracking on parent page ─────────────────────────────
  // The call runs in the standalone popup window (voice-popup.html). While the
  // popup is open we hide the Chatwoot widget on the parent page so the popup
  // is the only visible interface; when the popup closes we show it again.
  // The call lifecycle (start/end detection) lives in the widget iframe's
  // keepAlive — that runs on the chatwoot origin so there's no CORS issue.
  window.addEventListener('message', function (e) {
    var data = e.data;
    if (!data || typeof data !== 'object') return;
    var ev = data.event;
    if (ev === 'cw-voice-call-started' || ev === 'cw-voice-popup-opened') {
      window._cwVoiceActive = true;
      applyVoiceState(true, false);
      _hideChatwootWidget();   // popup is open → hide widget on parent page
    } else if (ev === 'cw-voice-call-ended' || ev === 'voice-popup-ended' || ev === 'cw-voice-popup-ended') {
      window._cwVoiceActive = false;
      applyVoiceState(false, false);
      _showChatwootWidget();   // popup closed → restore widget
    }
  });

}());
