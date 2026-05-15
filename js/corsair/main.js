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

(function init(){
  if (typeof window === 'undefined') return;
  window.Corsair = window.Corsair || {};
  window.Corsair.buildTag = 'P10.3';
  window.Corsair.modules = window.Corsair.modules || {};
  console.log(
    '%c[Corsair] modules loaded · P10.3 · util + pipeline + state + inspector + cop + rhythm ready · ' + new Date().toISOString(),
    'color:#d4823a;font-weight:bold'
  );
})();
