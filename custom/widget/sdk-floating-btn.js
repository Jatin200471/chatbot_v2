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
  // Widget iframe sends 'cw-custom-bubble-icon' postMessage after mount.
  // We store the URL globally and apply it as soon as the bubble exists.
  var _cwCustomBubbleIconUrl = null;

  function _applyCwBubbleIcon() {
    if (!_cwCustomBubbleIconUrl) return false;

    // Approach 1: replace SVG by ID
    var svg = document.getElementById('woot-widget-bubble-icon');
    if (svg) {
      // Hide SVG, inject img as sibling inside the button
      svg.style.display = 'none';
      var btn = svg.parentNode;
      // Remove any previously injected img
      var old = btn.querySelector('img[data-cw-custom-icon]');
      if (old) old.remove();
      var img = document.createElement('img');
      img.src = _cwCustomBubbleIconUrl;
      img.setAttribute('data-cw-custom-icon', '1');
      img.style.cssText = 'width:28px;height:28px;object-fit:contain;pointer-events:none;display:block;';
      btn.appendChild(img);
      return true;
    }

    // Approach 2: CSS background-image on bubble button (fallback)
    var bubble = document.querySelector('.woot-widget-bubble:not(.woot--close)');
    if (bubble) {
      var styleId = 'cw-custom-bubble-style';
      var existing = document.getElementById(styleId);
      if (existing) existing.remove();
      var style = document.createElement('style');
      style.id = styleId;
      style.textContent = [
        '.woot-widget-bubble:not(.woot--close) svg { display:none !important; }',
        '.woot-widget-bubble:not(.woot--close)::after {',
        '  content:"";',
        '  display:block;',
        '  width:28px;height:28px;',
        '  background:url("' + _cwCustomBubbleIconUrl.replace(/"/g, '\\"') + '") center/contain no-repeat;',
        '}'
      ].join('');
      document.head.appendChild(style);
      return true;
    }

    return false;
  }

  // Listen for postMessage from widget iframe
  window.addEventListener('message', function (e) {
    try {
      var data = e.data;
      // Our widget sends plain object; Chatwoot SDK sends strings — ignore strings
      if (typeof data !== 'object' || !data || data.event !== 'cw-custom-bubble-icon') return;
      var iconUrl = data.iconUrl;
      if (!iconUrl) return;

      _cwCustomBubbleIconUrl = iconUrl;

      // Try immediately; if bubble not yet in DOM, poll until it appears
      if (!_applyCwBubbleIcon()) {
        var attempts = 0;
        var poll = setInterval(function () {
          if (_applyCwBubbleIcon() || ++attempts > 40) clearInterval(poll);
        }, 250);
      }
    } catch (_) {}
  });

  // Also try on chatwoot:ready in case postMessage arrived first
  window.addEventListener('chatwoot:ready', function () {
    setTimeout(function () { _applyCwBubbleIcon(); }, 100);
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
      '<span style="display:flex;align-items:center;justify-content:center;gap:7px;line-height:1;">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" ' +
          'style="flex:0 0 auto;display:block;margin:0;pointer-events:none;">' +
          '<path d="M3.5 14.5c5.5-5 11.5-5 17 0 .8.7.9 2 0 2.7l-2.1 1.6c-.5.4-1.2.4-1.7 0l-2-1.7' +
          'a1.5 1.5 0 0 1-.5-1.1V14a9.8 9.8 0 0 0-4.4 0v0c0 .4-.2.8-.5 1.1l-2 1.6c-.5.4-1.2.4-1.7 0' +
          'L3.5 15c-.5-.6-.4-1.7 0-2.5Z" transform="rotate(135 12 12)"/>' +
        '</svg>' +
        '<span style="font-size:13px;font-weight:600;letter-spacing:.01em;display:block;line-height:1;">End Call</span>' +
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
  // FEATURE 3 — Voice-aware SPA navigation
  // ════════════════════════════════════════════════════════════════════════
  //
  // Elements preserved across SPA swaps:
  //   #woot-widget-holder  — Chatwoot widget container (includes the iframe)
  //   #cw-voice-end-btn    — floating End Call button
  //   #cw-voice-style      — CSS keyframes for the button

  // Scripts that were already loaded — don't reload them on page swap
  var _loadedScripts = {};
  (function () {
    document.querySelectorAll('script[src]').forEach(function (s) {
      _loadedScripts[s.src] = true;
    });
  })();

  // All Chatwoot-owned body elements — never wrap or swap these out.
  // From sdk.js source:
  //   v.id = "cw-widget-holder"   (iframe holder)
  //   C.id = "cw-bubble-holder"   (floating bubble button)
  //   e.id = "cw-widget-styles"   (injected <style> tag)
  //   iframe id = "chatwoot_live_chat_widget"
  var _widgetIds = {
    'cw-widget-holder':         1,   // main widget container
    'cw-bubble-holder':         1,   // floating bubble button
    'cw-widget-styles':         1,   // Chatwoot injected styles
    'woot-widget-holder':       1,   // older Chatwoot builds
    'chatwoot_live_chat_widget':1,   // the iframe itself
    'cw-voice-end-btn':         1,   // our End Call button
    'cw-voice-style':           1,   // our pulse animation style
    'cw-voice-hide-style':      1,   // our hide-widget style
  };

  // Wrap all non-widget body children in a #spa-content div so SPA swaps
  // only replace that div — the Chatwoot widget iframe stays in <body> at
  // all times, which means iframe.contentWindow is NEVER null during a swap.
  function ensureSpaContainer() {
    var existing = document.getElementById('spa-content');
    if (existing) return existing;

    var container = document.createElement('div');
    container.id = 'spa-content';

    var toMove = [];
    Array.from(document.body.children).forEach(function (c) {
      var skip = _widgetIds[c.id] ||
                 c.classList.contains('woot-widget-holder') ||
                 c.classList.contains('woot--bubble-holder');
      if (!skip) toMove.push(c);
    });
    toMove.forEach(function (c) { container.appendChild(c); });
    // Insert before any widget elements that are already in body
    document.body.insertBefore(container, document.body.firstChild);
    return container;
  }

  function spaNavigate(href) {
    if (window._spaNavigating) return;
    window._spaNavigating = true;

    fetch(href, { credentials: 'same-origin' })
      .then(function (r) {
        var ct = r.headers.get('content-type') || '';
        if (!ct.includes('text/html')) {
          window._spaNavigating = false;
          location.href = href;
          return null;
        }
        return r.text();
      })
      .then(function (html) {
        if (!html) return;
        var newDoc = new DOMParser().parseFromString(html, 'text/html');
        var container = ensureSpaContainer();

        // Update <title>
        document.title = newDoc.title;

        // Swap page-specific stylesheets in <head>
        document.querySelectorAll('head link[rel="stylesheet"][data-spa]')
          .forEach(function (l) { l.remove(); });
        newDoc.querySelectorAll('link[rel="stylesheet"]').forEach(function (l) {
          if (!document.querySelector('link[href="' + l.href + '"]')) {
            var clone = l.cloneNode(true);
            clone.setAttribute('data-spa', '1');
            document.head.appendChild(clone);
          }
        });
        var oldStyle = document.querySelector('head style[data-spa]');
        if (oldStyle) oldStyle.remove();
        var newStyle = newDoc.querySelector('head style');
        if (newStyle) {
          var s = newStyle.cloneNode(true);
          s.setAttribute('data-spa', '1');
          document.head.appendChild(s);
        }

        // Collect scripts BEFORE innerHTML wipes them
        var scripts = Array.from(newDoc.body.querySelectorAll('script'));

        // Replace ONLY the content container — widget iframe stays in body untouched.
        // Chatwoot's MutationObserver fires here but finds the iframe still in body,
        // so iframe.contentWindow is never null.
        container.innerHTML = newDoc.body.innerHTML;

        // Re-execute page scripts (sliders, analytics, etc.)
        scripts.forEach(function (oldScript) {
          var newScript = document.createElement('script');
          if (oldScript.src) {
            if (_loadedScripts[oldScript.src]) return;
            newScript.src   = oldScript.src;
            newScript.async = oldScript.async;
            newScript.defer = oldScript.defer;
            _loadedScripts[oldScript.src] = true;
          } else {
            var txt = oldScript.textContent || '';
            // Skip Chatwoot embed snippets — sdk.js is already live
            if (txt.includes('chatwootSDK') || txt.includes('/packs/js/sdk.js') ||
                txt.includes('chatwoot:ready')) return;
            newScript.textContent = txt;
          }
          container.appendChild(newScript);
        });

        history.pushState({}, document.title, href);
        window.scrollTo(0, 0);
        try { window.dispatchEvent(new PopStateEvent('popstate', { state: history.state })); } catch (_) {}
        window._spaNavigating = false;
      })
      .catch(function () {
        window._spaNavigating = false;
        location.href = href;
      });
  }

  // ── Always-on SPA navigation ──────────────────────────────────────────────
  // Intercept ALL same-origin link clicks so the page never fully reloads.
  // This keeps the Chatwoot widget iframe alive across every page change —
  // chat sessions persist, voice WebRTC survives, no popup needed.
  //
  // Skip: anchor links (#), mailto/tel/js links, external domains,
  //       links with target="_blank", download links, and form actions.
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href]');
    if (!a || a.target || a.download) return;

    var raw = a.getAttribute('href') || '';
    if (raw.startsWith('#') || raw.startsWith('mailto:') ||
        raw.startsWith('tel:') || raw.startsWith('javascript:')) return;

    try {
      var url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return; // external links → normal full nav
      // Same page, different hash only → let browser handle scroll
      if (url.pathname === location.pathname && url.search === location.search &&
          url.hash !== location.hash) return;
      e.preventDefault();
      spaNavigate(url.href);
    } catch (_) {}
  });

  // Handle browser Back / Forward buttons
  window.addEventListener('popstate', function () {
    spaNavigate(location.href);
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

}());
