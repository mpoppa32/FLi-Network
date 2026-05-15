// Corsair state module — cross-surface shared selection singleton
//
// window.CorsairSelection: one source of truth for "what entity is the
// operator currently focused on?" Every surface (Theater, Inspector, COP,
// Brief, Ask, future Table) subscribes here. When any surface selects an
// entity, every other surface lights up the same entity.
//
// Phase 3 of the brief. Surfaces are wired to subscribe in subsequent
// commits; this commit only establishes the singleton + history stack.
//
// API:
//   window.CorsairSelection.set({entityType, entityId, source, multi?})
//   window.CorsairSelection.clear()
//   window.CorsairSelection.current()         -> {entityType, entityId, source, timestamp, multi} | null
//   window.CorsairSelection.subscribe(fn)     -> unsubscribe function
//   window.CorsairSelection.back()            -> rewind to previous selection
//   window.CorsairSelection.forward()         -> redo after back()
//   window.CorsairSelection.history()         -> snapshot of back stack
//   window.CorsairSelection.future()          -> snapshot of forward stack
//
// Keyboard:
//   ⌘[ / Ctrl+[   back
//   ⌘] / Ctrl+]   forward
//   Ignored when focus is in input/textarea/contenteditable.

(function() {
  var current     = null;
  var subscribers = [];
  var history     = [];
  var future      = [];
  var HISTORY_LIMIT = 64;

  function emit() {
    subscribers.forEach(function(fn) {
      try { fn(current); }
      catch (e) { console.warn('[CorsairSelection] subscriber error:', e); }
    });
  }

  function set(sel) {
    if (!sel || !sel.entityId) return clear();
    var next = {
      entityType: sel.entityType || 'unknown',
      entityId:   String(sel.entityId),
      source:     sel.source || 'unknown',
      timestamp:  Date.now(),
      multi:      Array.isArray(sel.multi) ? sel.multi.slice() : []
    };
    if (current && current.entityId === next.entityId && current.entityType === next.entityType) {
      // Same target — refresh source/timestamp only, don't push history
      current = next;
    } else {
      if (current) {
        history.push(current);
        if (history.length > HISTORY_LIMIT) history.shift();
      }
      future = [];
      current = next;
    }
    emit();
    return current;
  }

  function clear() {
    if (current) {
      history.push(current);
      if (history.length > HISTORY_LIMIT) history.shift();
    }
    current = null;
    future  = [];
    emit();
    return null;
  }

  function back() {
    if (!history.length) return current;
    if (current) future.unshift(current);
    current = history.pop();
    emit();
    return current;
  }

  function forward() {
    if (!future.length) return current;
    if (current) {
      history.push(current);
      if (history.length > HISTORY_LIMIT) history.shift();
    }
    current = future.shift();
    emit();
    return current;
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return function() {};
    subscribers.push(fn);
    return function unsubscribe() {
      var ix = subscribers.indexOf(fn);
      if (ix >= 0) subscribers.splice(ix, 1);
    };
  }

  if (typeof window === 'undefined') return;

  window.CorsairSelection = {
    set:       set,
    clear:     clear,
    back:      back,
    forward:   forward,
    current:   function() { return current; },
    subscribe: subscribe,
    history:   function() { return history.slice(); },
    future:    function() { return future.slice(); }
  };

  window.Corsair = window.Corsair || {};
  window.Corsair.state = { selection: window.CorsairSelection };

  // Cross-surface keyboard handler — ⌘[ / Ctrl+[  back, ⌘] / Ctrl+]  forward
  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', function(e) {
      var isMac = (navigator.platform || '').toLowerCase().indexOf('mac') >= 0;
      var modKey = isMac ? e.metaKey : e.ctrlKey;
      if (!modKey || e.altKey || e.shiftKey) return;
      var tgt = e.target;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
      if (e.key === '[')      { e.preventDefault(); back(); }
      else if (e.key === ']') { e.preventDefault(); forward(); }
    });
  }
})();
