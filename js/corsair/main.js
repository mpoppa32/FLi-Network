// Corsair main module — entry orchestrator
//
// Loads sibling modules under js/corsair/. Each imported module
// publishes to window.Corsair.<name> and (where back-compat is required)
// also exposes select helpers as bare window globals.

import './util.js';
import './pipeline.js';
import './inspector.js';
import './cop.js';

(function init(){
  if (typeof window === 'undefined') return;
  window.Corsair = window.Corsair || {};
  window.Corsair.buildTag = 'P10.1';
  window.Corsair.modules = window.Corsair.modules || {};
  console.log(
    '%c[Corsair] modules loaded · P10.1 · util + pipeline + inspector + cop ready · ' + new Date().toISOString(),
    'color:#d4823a;font-weight:bold'
  );
})();
