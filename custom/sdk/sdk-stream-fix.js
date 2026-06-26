;(function(){
  // ── Native API Shield (prefix) ─────────────────────────────────────────
  // Runs BEFORE Chatwoot's SDK code. Snapshots every browser API that any
  // modern framework depends on. A matching restore block at the end of
  // sdk.js puts them all back so the host page is never affected.
  var w = window, d = document;

  // ── 1. Snapshot native APIs ────────────────────────────────────────────
  w.__cwNativeAPIs = {
    // Streaming
    ReadableStream:       w.ReadableStream,
    WritableStream:       w.WritableStream,
    TransformStream:      w.TransformStream,
    // Fetch / Network
    fetch:                w.fetch,
    Request:              w.Request,
    Response:             w.Response,
    Headers:              w.Headers,
    AbortController:      w.AbortController,
    AbortSignal:          w.AbortSignal,
    XMLHttpRequest:       w.XMLHttpRequest,
    EventSource:          w.EventSource,
    WebSocket:            w.WebSocket,
    // Navigation / History
    historyPushState:     w.history && w.history.pushState,
    historyReplaceState:  w.history && w.history.replaceState,
    // URL
    URL:                  w.URL,
    URLSearchParams:      w.URLSearchParams,
    // Observers
    MutationObserver:     w.MutationObserver,
    IntersectionObserver: w.IntersectionObserver,
    ResizeObserver:       w.ResizeObserver,
    PerformanceObserver:  w.PerformanceObserver,
    // Messaging
    MessageChannel:       w.MessageChannel,
    MessagePort:          w.MessagePort,
    BroadcastChannel:     w.BroadcastChannel,
    // Promises / Async
    Promise:              w.Promise,
    queueMicrotask:       w.queueMicrotask,
    // Timers
    setTimeout:           w.setTimeout,
    clearTimeout:         w.clearTimeout,
    setInterval:          w.setInterval,
    clearInterval:        w.clearInterval,
    requestAnimationFrame:    w.requestAnimationFrame,
    cancelAnimationFrame:     w.cancelAnimationFrame,
    requestIdleCallback:      w.requestIdleCallback,
    cancelIdleCallback:       w.cancelIdleCallback,
    // Events
    CustomEvent:          w.CustomEvent,
    Event:                w.Event,
    // DOM
    createElement:        d.createElement && d.createElement.bind(d),
    createElementNS:      d.createElementNS && d.createElementNS.bind(d),
    createTreeWalker:     d.createTreeWalker && d.createTreeWalker.bind(d),
    querySelector:        d.querySelector && d.querySelector.bind(d),
    querySelectorAll:     d.querySelectorAll && d.querySelectorAll.bind(d),
  };

  // ── 1b. Patch ReadableStream to silence "enqueue on closed stream" ──────
  // Chatwoot's bundled axios/fetch adapter sometimes tries to enqueue a chunk
  // after the stream is already closed (race during Next.js App Router nav).
  // Wrap the native ReadableStream so controller.enqueue() is a safe no-op
  // when the stream is already closed. The restore block puts the original back.
  try {
    var NativeRS = w.ReadableStream;
    if (NativeRS) {
      w.ReadableStream = function(underlyingSource, strategy) {
        var wrappedSource;
        if (underlyingSource && typeof underlyingSource.start === 'function') {
          var origStart = underlyingSource.start;
          wrappedSource = Object.create(underlyingSource);
          wrappedSource.start = function(controller) {
            var origEnqueue = controller.enqueue.bind(controller);
            controller.enqueue = function(chunk) {
              try { origEnqueue(chunk); } catch(e) {
                if (e && e.message && e.message.indexOf('closed') !== -1) return;
                throw e;
              }
            };
            return origStart.call(underlyingSource, controller);
          };
        } else {
          wrappedSource = underlyingSource;
        }
        return new NativeRS(wrappedSource, strategy);
      };
      w.ReadableStream.prototype = NativeRS.prototype;
      Object.keys(NativeRS).forEach(function(k) {
        try { w.ReadableStream[k] = NativeRS[k]; } catch(_){}
      });
    }
  } catch (_) {}

  // ── 2. Protect window.onmessage from being overwritten ─────────────────
  w.__cwOnMessageHandlers = [];
  var _origOnMessage = w.onmessage;
  try {
    Object.defineProperty(w, 'onmessage', {
      configurable: true,
      get: function() { return _origOnMessage; },
      set: function(fn) {
        if (typeof fn === 'function') {
          w.__cwOnMessageHandlers.push(fn);
          w.addEventListener('message', fn);
        }
      }
    });
  } catch (_) {}

  // ── 3. Protect key prototypes from pollution ───────────────────────────
  w.__cwProtoSnapshot = {
    ArrayProtoKeys:  Object.getOwnPropertyNames(Array.prototype),
    ObjectProtoKeys: Object.getOwnPropertyNames(Object.prototype),
  };

})();
