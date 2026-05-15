// Corsair main module — entry orchestrator
//
// Loads sibling modules under js/corsair/. Each imported module
// publishes to window.Corsair.<name> and (where back-compat is required)
// also exposes select helpers as bare window globals.

import './util.js';
import './pipeline.js';
import './state.js';
import './inspector.js';
import './cop.js';
import './rhythm.js';
import './brief.js';
import './theater.js';

(function init(){
  if (typeof window === 'undefined') return;
  window.Corsair = window.Corsair || {};
  window.Corsair.buildTag = 'P10.9';
  window.Corsair.modules = window.Corsair.modules || {};

  // Keep the pre-auth footer build tag in sync with whatever is current.
  // The HTML hardcodes a fallback; this overwrites it once modules load.
  if (typeof document !== 'undefined') {
    var el = document.getElementById('auth-build-tag');
    if (el) el.textContent = window.Corsair.buildTag;
  }

  console.log(
    '%c[Corsair] modules loaded · P10.9 · pre-auth visual lock applied · ' + new Date().toISOString(),
    'color:#d4823a;font-weight:bold'
  );
})();
