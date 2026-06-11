// ── Chatwoot Voice + Widget Extensions ───────────────────────────────────────
// Appended to sdk.js at Docker build time — runs on every parent page that
// loads sdk.js. Nothing extra needed in the embed snippet.
//
// THREE FEATURES bundled here:
//
//  1. WIDGET STATE PERSISTENCE
//     If widget was open when user navigated away, auto-open it on the new page.
//     Works for both text chat and voice. Uses localStorage key 'cw_widget_open'.
//
//  2. FLOATING "END CALL" BUTTON
//     Red pulsing button appears on the page when a voice call is active.
//     Visible even when widget bubble is minimized. Click to end the call.
//
//  3. VOICE-AWARE SPA NAVIGATION
//     When a voice call is active, link clicks are intercepted and the new page
//     is loaded via fetch() — replacing only the body content. The Chatwoot
//     widget iframe is detached before the swap and re-attached after, so the
//     WebRTC connection is NEVER destroyed. Voice call continues without dropping.
//     When no voice call is active, normal full-page navigation works as usual.
//
// ─────────────────────────────────────────────────────────────────────────────
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
      var allow = f.getAttribute('allow') || '';
      var needs = ['microphone', 'autoplay', 'camera'];
      var missing = needs.filter(function(p) { return !allow.includes(p); });
      if (missing.length > 0) {
        f.setAttribute('allow', (allow + '; ' + missing.join('; ')).trim());
      }
    });
  }

  // Run immediately and observe for new iframes
  fixIframeAudioPermission();
  var _iframeObserver = new MutationObserver(function() {
    fixIframeAudioPermission();
  });
  _iframeObserver.observe(document.body, { childList: true, subtree: true });

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
  // FEATURE 3 — Voice-aware SPA navigation
  // ════════════════════════════════════════════════════════════════════════
  //
  // Elements preserved across SPA swaps:
  //   #woot-widget-holder  — Chatwoot widget container (includes the iframe)
  //   #cw-voice-end-btn    — floating End Call button
  //   #cw-voice-style      — CSS keyframes for the button

  function spaNavigate(href) {
    // Step 1 — detach Chatwoot elements from DOM (kept alive in JS memory)
    var saved = [];
    document.querySelectorAll('#woot-widget-holder, #cw-voice-end-btn, #cw-voice-style')
      .forEach(function (el) { saved.push(el); el.remove(); });

    // Step 2 — fetch new page HTML
    fetch(href, { credentials: 'same-origin' })
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var newDoc = new DOMParser().parseFromString(html, 'text/html');

        // Step 3 — update URL + title
        document.title = newDoc.title;
        history.pushState({}, document.title, href);

        // Step 4 — swap page-specific styles
        var oldStyle = document.querySelector('head style');
        var newStyle = newDoc.querySelector('head style');
        if (oldStyle && newStyle)      { oldStyle.textContent = newStyle.textContent; }
        else if (newStyle)             { document.head.appendChild(newStyle.cloneNode(true)); }

        // Step 5 — replace body content
        document.body.innerHTML = newDoc.body.innerHTML;

        // Step 6 — re-attach Chatwoot elements (iframe WebRTC = INTACT)
        saved.forEach(function (el) { document.body.appendChild(el); });
      })
      .catch(function () {
        // Fallback: re-attach saved elements then do normal navigation
        saved.forEach(function (el) { document.body.appendChild(el); });
        location.href = href;
      });
  }

  // Intercept <a> clicks — ONLY when a voice call is active
  document.addEventListener('click', function (e) {
    if (!window._cwVoiceActive) return;

    var a = e.target.closest('a[href]');
    if (!a || a.target || a.download) return;

    var raw = a.getAttribute('href') || '';
    if (raw.startsWith('#') || raw.startsWith('mailto:') ||
        raw.startsWith('tel:') || raw.startsWith('javascript:')) return;

    try {
      var url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return; // external links → normal
      e.preventDefault();
      spaNavigate(url.href);
    } catch (_) {}
  });

  // Handle browser Back / Forward during an active voice call
  window.addEventListener('popstate', function () {
    if (window._cwVoiceActive) spaNavigate(location.href);
  });


  // ════════════════════════════════════════════════════════════════════════
  // postMessage listener — bridges Features 2, 3 & 4
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
  // Only flips _cwVoiceActive flag for SPA-nav interception. The actual call
  // lifecycle (start/end detection, popup sync) lives in the widget iframe's
  // keepAlive — that runs on the chatwoot origin so there's no CORS issue.
  // We deliberately do NOT fetch from the parent page: customer.com origin
  // hitting chatwoot.com without CORS allowance would be blocked.
  window.addEventListener('message', function (e) {
    var data = e.data;
    if (!data || typeof data !== 'object') return;
    var ev = data.event;
    if (ev === 'cw-voice-call-started' || ev === 'cw-voice-popup-opened') {
      window._cwVoiceActive = true;
      applyVoiceState(true, false);
    } else if (ev === 'cw-voice-call-ended' || ev === 'voice-popup-ended' || ev === 'cw-voice-popup-ended') {
      window._cwVoiceActive = false;
      applyVoiceState(false, false);
      _showChatwootWidget();
    }
  });

  // ── Warn user before navigating away during active voice call ────────────
  // Catches programmatic navigations (location.href, form submit, etc.) that
  // our click intercept cannot handle.
  window.addEventListener('beforeunload', function (e) {
    if (window._cwVoiceActive) {
      e.preventDefault();
      e.returnValue = 'A voice call is active. Leaving will end your call.';
    }
  });

}());
