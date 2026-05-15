// Corsair main module — entry orchestrator
//
// Loads sibling modules under js/corsair/. Each imported module
// publishes to window.Corsair.<name> and (where back-compat is required)
// also exposes select helpers as bare window globals.

import './util.js';
import './pipeline.js';

(function init(){
  if (typeof window === 'undefined') return;
  window.Corsair = window.Corsair || {};
  window.Corsair.buildTag = 'P9.9';
  window.Corsair.modules = window.Corsair.modules || {};
  console.log(
    '%c[Corsair] modules loaded · P9.9 · util + pipeline ready · ' + new Date().toISOString(),
    'color:#d4823a;font-weight:bold'
  );
})();
