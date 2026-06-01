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
  // FEATURE 4 — Notification popup (campaign & AI reply)
  // ════════════════════════════════════════════════════════════════════════
  //
  // Shows a small popup above the widget bubble when:
  //   • A live campaign message is triggered (widget closed)
  //   • A new agent/AI reply arrives (widget closed)
  //
  // The popup auto-dismisses after 8 s. Clicking it opens the widget.

  var NOTIF_ID        = 'cw-notif-popup';
  var NOTIF_STYLE_ID  = 'cw-notif-style';
  var notifDismissTimer = null;

  function injectNotifStyles() {
    if (document.getElementById(NOTIF_STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = NOTIF_STYLE_ID;
    s.textContent = [
      '@keyframes cwSlideUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}',
      '#' + NOTIF_ID + '{',
        'position:fixed;bottom:85px;right:20px;z-index:2147483646;',
        'max-width:280px;min-width:200px;',
        'background:#fff;color:#1f2937;',
        'border-radius:12px;',
        'box-shadow:0 4px 20px rgba(0,0,0,.18);',
        'padding:12px 14px;',
        'cursor:pointer;',
        'animation:cwSlideUp .25s ease-out;',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
        'font-size:13px;line-height:1.4;',
      '}',
      '#' + NOTIF_ID + ':hover{box-shadow:0 6px 24px rgba(0,0,0,.24)}',
      '#cw-notif-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}',
      '#cw-notif-title{font-weight:700;font-size:13px;color:#1f2937}',
      '#cw-notif-close{',
        'background:none;border:none;cursor:pointer;padding:0;margin-left:8px;',
        'color:#9ca3af;font-size:16px;line-height:1;flex-shrink:0',
      '}',
      '#cw-notif-close:hover{color:#6b7280}',
      '#cw-notif-body{color:#374151;font-size:13px;word-break:break-word;',
        'display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden',
      '}',
      '#cw-notif-badge{',
        'display:inline-flex;align-items:center;gap:5px;',
        'background:#eff6ff;color:#2563eb;',
        'border-radius:999px;padding:2px 8px;font-size:11px;font-weight:600;',
        'margin-bottom:6px',
      '}',
    ].join('');
    document.head.appendChild(s);
  }

  function showNotification(type, text, count) {
    injectNotifStyles();
    removeNotification();

    var popup = document.createElement('div');
    popup.id = NOTIF_ID;

    var badge = document.createElement('div');
    badge.id = 'cw-notif-badge';

    var header = document.createElement('div');
    header.id = 'cw-notif-header';

    var title = document.createElement('span');
    title.id = 'cw-notif-title';

    var closeBtn = document.createElement('button');
    closeBtn.id = 'cw-notif-close';
    closeBtn.title = 'Dismiss';
    closeBtn.innerHTML = '&times;';
    closeBtn.onclick = function (e) {
      e.stopPropagation();
      removeNotification();
    };

    var body = document.createElement('div');
    body.id = 'cw-notif-body';

    if (type === 'campaign') {
      badge.innerHTML = '&#128172; Campaign';
      title.textContent = 'Message for you';
      body.textContent = text || 'We have a message for you. Click to read.';
    } else {
      var label = count > 1 ? count + ' new messages' : 'New message';
      badge.innerHTML = '&#128172; ' + label;
      title.textContent = 'Agent replied';
      body.textContent = 'You have ' + label + '. Click to view.';
    }

    header.appendChild(title);
    header.appendChild(closeBtn);
    popup.appendChild(badge);
    popup.appendChild(header);
    popup.appendChild(body);

    popup.onclick = function () {
      removeNotification();
      try {
        if (window.$chatwoot && typeof window.$chatwoot.toggle === 'function') {
          window.$chatwoot.toggle('open');
        }
      } catch (_) {}
    };

    document.body.appendChild(popup);

    // Auto-dismiss after 8 s
    if (notifDismissTimer) clearTimeout(notifDismissTimer);
    notifDismissTimer = setTimeout(removeNotification, 8000);
  }

  function removeNotification() {
    if (notifDismissTimer) { clearTimeout(notifDismissTimer); notifDismissTimer = null; }
    var el = document.getElementById(NOTIF_ID);
    if (el) el.remove();
  }

  // Hide notification when user opens the widget
  window.addEventListener('chatwoot:on-open', function () {
    removeNotification();
  });

  // ════════════════════════════════════════════════════════════════════════
  // postMessage listener — bridges Features 2, 3 & 4
  // ════════════════════════════════════════════════════════════════════════

  window.addEventListener('message', function (e) {
    var data = e.data;

    // Notification popup (campaign / AI reply)
    if (data && typeof data === 'object' && data.event === 'cw-show-notification') {
      showNotification(data.type, data.message, data.count);
      return;
    }

    // Plain object format (direct window.parent.postMessage from App.vue)
    if (data && typeof data === 'object' && data.event === 'voice-call-active') {
      window._cwVoiceActive = !!data.isActive;
      if (data.isActive) {
        showBtn();
        if (data.autoOpen) autoOpenWidget(); // reconnect scenario
      } else {
        hideBtn();
      }
      return;
    }

    // Prefixed string format "chatwoot-widget:{...}" (IFrameHelper fallback)
    if (typeof data === 'string' && data.indexOf('chatwoot-widget:') === 0) {
      try {
        var parsed = JSON.parse(data.slice('chatwoot-widget:'.length));
        if (parsed && parsed.event === 'voice-call-active') {
          window._cwVoiceActive = !!parsed.isActive;
          if (parsed.isActive) {
            showBtn();
            if (parsed.autoOpen) autoOpenWidget();
          } else {
            hideBtn();
          }
        }
      } catch (_) {}
    }
  });

}());
