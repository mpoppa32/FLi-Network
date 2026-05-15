// Corsair util module — shared formatters and pure helpers
//
// Pure functions only: no DOM, no Firebase, no app state, no side effects.
// Exposed on window.Corsair.util for direct lookup, and also exported for
// future ES-module consumers. Existing duplicate helpers in FLiIntel.html
// (escH at 13061 + 22072, escapeHtml at 35458, _formatDate at 40211,
// _formatOppValue at 38741, _formatOppValueShort at 39938) will be retired
// in favor of these as their host modules get extracted in later micro-steps.

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
    tabularNum: tabularNum
  };
}

export {
  escapeHtml,
  clamp,
  daysBetween,
  fmtAge,
  fmtMoney,
  fmtDate,
  fmtDateLong,
  tabularNum
};
