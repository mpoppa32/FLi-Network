// Corsair util module — shared formatters and pure helpers
//
// Pure functions only: no DOM, no Firebase, no app state, no side effects.
// Exposed on window.Corsair.util for direct lookup, and also exported for
// future ES-module consumers. Select helpers (bdg, who) are also exposed
// as bare window globals for back-compat with FLiIntel.html callers that
// reference them by name.

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[<>&"']/g, function(c) {
    return ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'})[c];
  });
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function daysBetween(a, b) {
  if (a == null || b == null) return 0;
  return Math.floor((Number(b) - Number(a)) / 86400000);
}

function fmtAge(days) {
  if (days == null || isNaN(days)) return '';
  var d = Math.floor(Math.abs(Number(days)));
  if (d < 7)   return d + 'd';
  if (d < 30)  return Math.floor(d / 7)  + 'w';
  if (d < 365) return Math.floor(d / 30) + 'mo';
  return Math.floor(d / 365) + 'y';
}

function fmtMoney(n) {
  if (n == null || isNaN(n)) return '';
  var v = Number(n);
  var abs = Math.abs(v);
  if (abs >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
  if (abs >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'k';
  return '$' + v.toFixed(0);
}

function fmtDate(ts) {
  if (!ts) return '';
  var d = new Date(Number(ts));
  if (isNaN(d.getTime())) return '';
  return (d.getMonth() + 1) + '/' + d.getDate() + '/' + String(d.getFullYear()).slice(-2);
}

function fmtDateLong(ts) {
  if (!ts) return '';
  var d = new Date(Number(ts));
  if (isNaN(d.getTime())) return '';
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

function tabularNum(n, places) {
  if (n == null || isNaN(n)) return '—';
  var p = (places == null) ? 0 : places;
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: p,
    maximumFractionDigits: p
  });
}

// Badge / who-tag HTML builders (consolidated from FLiIntel.html lines 8668-8669, P10.5)
function bdg(txt, c) {
  return '<span class="bdg" style="background:' + c.b + ';color:' + c.t + '">' + txt + '</span>';
}

function who(name, color) {
  return '<span class="who-tag" style="background:' + color + '22;color:' + color + ';border:1px solid ' + color + '44">' + name + '</span>';
}

if (typeof window !== 'undefined') {
  window.Corsair = window.Corsair || {};
  window.Corsair.util = {
    escapeHtml: escapeHtml,
    clamp: clamp,
    daysBetween: daysBetween,
    fmtAge: fmtAge,
    fmtMoney: fmtMoney,
    fmtDate: fmtDate,
    fmtDateLong: fmtDateLong,
    tabularNum: tabularNum,
    bdg: bdg,
    who: who
  };

  // Back-compat: bare-name globals expected by un-migrated FLiIntel.html callers
  window.bdg = bdg;
  window.who = who;
}

export {
  escapeHtml,
  clamp,
  daysBetween,
  fmtAge,
  fmtMoney,
  fmtDate,
  fmtDateLong,
  tabularNum,
  bdg,
  who
};
