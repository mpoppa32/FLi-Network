// Corsair theater module — 3D Entity Graph coordination layer (Phase A)
//
// PHASE A (P10.8) — coordination only. Does not move the heavy 3D scene
// code (still in FLiIntel.html at the <script type="module"> near line
// 35648) or the operator IIFE (line 34313). Phase B + C will migrate
// those in subsequent commits.
//
// What this commit does:
//   1. Wraps window.openEntityInspector so every entity click publishes
//      to CorsairSelection (cross-surface selection state).
//   2. Subscribes to CorsairSelection: when an external surface selects
//      an entity, Theater focal-flies to that node via existing helpers
//      (window._copFocusInGraph or window._goToNetworkHighlight).
//   3. Exposes window.Corsair.theater namespace for introspection.

(function() {
  if (typeof window === 'undefined') return;

  // ── 1. Publish: wrap openEntityInspector so every entity click broadcasts ──
  //
  // We need to handle both cases:
  //   (a) FLiIntel.html has already assigned window.openEntityInspector
  //       before this module ran (the normal load order).
  //   (b) FLiIntel.html has not yet assigned it (defensive — install a
  //       setter that wraps the value on first write).

  var _origOpenEI = window.openEntityInspector;

  function wrappedOpenEI(entityId) {
    if (entityId != null && window.CorsairSelection && typeof window.CorsairSelection.set === 'function') {
      try {
        var node = (window.nodeMap && typeof window.nodeMap.get === 'function')
                 ? (window.nodeMap.get(entityId) || window.nodeMap.get(String(entityId)) || window.nodeMap.get(Number(entityId)))
                 : null;
        var entityType = (node && node.type) ? node.type : 'unknown';
        window.CorsairSelection.set({
          entityType: entityType,
          entityId:   entityId,
          source:     'theater-wrap'
        });
      } catch (e) { /* swallow — Theater wrap must not break entity opens */ }
    }
    if (typeof _origOpenEI === 'function') return _origOpenEI(entityId);
  }

  if (typeof _origOpenEI === 'function') {
    // Case (a): already defined — simple replace
    window.openEntityInspector = wrappedOpenEI;
  } else {
    // Case (b): defer wrap until first assignment
    try {
      Object.defineProperty(window, 'openEntityInspector', {
        configurable: true,
        get: function() { return wrappedOpenEI; },
        set: function(fn) {
          _origOpenEI = fn;
          // Re-define as plain value so later overwrites work normally
          Object.defineProperty(window, 'openEntityInspector', {
            configurable: true,
            writable:     true,
            enumerable:   true,
            value:        wrappedOpenEI
          });
        }
      });
    } catch (e) {
      // If defineProperty fails for any reason, fall back to plain assignment
      window.openEntityInspector = wrappedOpenEI;
    }
  }

  // ── 2. Subscribe: external selections trigger focal-fly to the node ──
  if (window.CorsairSelection && typeof window.CorsairSelection.subscribe === 'function') {
    window.CorsairSelection.subscribe(function(sel) {
      if (!sel || !sel.entityId) return;
      // Ignore our own selections to avoid feedback loops
      if (sel.source === 'theater' || sel.source === 'theater-wrap') return;
      // Use existing window helpers to focal-fly (defined in FLiIntel.html)
      if (typeof window._copFocusInGraph === 'function') {
        try { window._copFocusInGraph(sel.entityId); } catch (e) {}
      } else if (typeof window._goToNetworkHighlight === 'function') {
        try { window._goToNetworkHighlight([sel.entityId]); } catch (e) {}
      }
    });
  }

  // ── 3. Namespace ─────────────────────────────────────────────────────
  window.Corsair = window.Corsair || {};
  window.Corsair.theater = {
    // Programmatic focal-fly to an entity
    focusEntity: function(entityId) {
      if (typeof window._copFocusInGraph === 'function') {
        return window._copFocusInGraph(entityId);
      }
      if (typeof window._goToNetworkHighlight === 'function') {
        return window._goToNetworkHighlight([entityId]);
      }
      return null;
    },
    // Current cross-surface selection (or null)
    currentSelection: function() {
      return (window.CorsairSelection && typeof window.CorsairSelection.current === 'function')
        ? window.CorsairSelection.current()
        : null;
    },
    // Test hook: programmatic publish to CorsairSelection from Theater
    publishSelection: function(entityType, entityId) {
      if (!window.CorsairSelection || typeof window.CorsairSelection.set !== 'function') return null;
      return window.CorsairSelection.set({
        entityType: entityType || 'unknown',
        entityId:   entityId,
        source:     'theater'
      });
    }
  };
})();
