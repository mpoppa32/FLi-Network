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

(function init(){
  if (typeof window === 'undefined') return;
  window.Corsair = window.Corsair || {};
  window.Corsair.buildTag = 'P10.4';
  window.Corsair.modules = window.Corsair.modules || {};
  console.log(
    '%c[Corsair] modules loaded · P10.4 · util + pipeline + state + inspector + cop + rhythm + brief ready · ' + new Date().toISOString(),
    'color:#d4823a;font-weight:bold'
  );
})();
