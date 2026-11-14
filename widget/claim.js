/* A wiki claim's live odds on any page.
   <script src="https://nearly.trade/widget/claim.js" data-claim="42" async></script>
   Optional: data-theme="light". The card reads /api/wiki/claim/<id> from the script's own origin every minute and links to the
   claim on its page, where anyone can trade it. No cookies, no tracking, one shadow root per card. */
(function () {
  var me = document.currentScript
  var scripts = me ? [me] : [].slice.call(document.querySelectorAll('script[data-claim]'))
  var CSS = ':host{all:initial;display:block;max-width:440px;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}' +
    '.c{display:block;padding:16px 18px;border-radius:14px;text-decoration:none;background:var(--bg);color:var(--fg);border:1px solid var(--ln)}' +
    '.c:hover{border-color:var(--ln2)}' +
    '.t{display:flex;align-items:baseline;justify-content:space-between;gap:12px}' +
    '.q{font-weight:600;font-size:15px;line-height:1.4}' +
    '.p{font:600 26px/1 ui-monospace,"SF Mono",Menlo,monospace;color:var(--c);white-space:nowrap}' +
    '.b{height:6px;margin:12px 0 10px;border-radius:9px;background:var(--s2);overflow:hidden}.b i{display:block;height:100%;background:var(--c)}' +
    '.m{display:flex;justify-content:space-between;gap:12px;font-size:12px;color:var(--fg3)}.m b{color:var(--c);font-weight:600}'
  var THEME = { dark: '--bg:#131519;--s2:#1c1f24;--fg:#eceef0;--fg3:#8a9099;--ln:#23272d;--ln2:#3a4048', light: '--bg:#fff;--s2:#eef1f4;--fg:#101318;--fg3:#6b737c;--ln:#dde2e8;--ln2:#b9c1ca' }
  var COLOUR = { dark: { hi: '#2dd4bf', mid: '#8fd9c9', split: '#e2b04a', low: '#f0a37a', no: '#f2777a', none: '#8a9099' }, light: { hi: '#0d7f72', mid: '#2f8f80', split: '#9a6510', low: '#b5532a', no: '#c4383d', none: '#6b737c' } }
  var WORD = { established: 'Established', 'very likely': 'Very likely', likely: 'Likely', disputed: 'Disputed', unlikely: 'Unlikely', 'very unlikely': 'Very unlikely', rejected: 'Rejected', 'settled true': 'Settled true', 'settled false': 'Settled false', void: 'Void', unpriced: 'No market yet' }
  function tone(b) { return /settled true|established|very likely/.test(b) ? 'hi' : b === 'likely' ? 'mid' : b === 'disputed' ? 'split' : b === 'unlikely' ? 'low' : /settled false|rejected|very unlikely/.test(b) ? 'no' : 'none' }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] }) }
  scripts.forEach(function (s) {
    var id = String(s.getAttribute('data-claim') || '').replace(/\D/g, ''); if (!id) return
    var origin = new URL(s.src, location.href).origin
    var mode = s.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
    var host = document.createElement('div'); s.parentNode.insertBefore(host, s.nextSibling)
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host
    function draw(c) {
      var b = c.band || 'unpriced', col = COLOUR[mode][tone(b)]
      var p = c.band === 'settled true' ? 'True' : c.band === 'settled false' ? 'False' : c.p_yes == null ? '–' : Math.round(c.p_yes * 100) + '%'
      var href = origin + (c.page ? '/wiki/' + encodeURIComponent(c.page.slug) + '#m' + id : '/wiki')
      root.innerHTML = '<style>' + CSS + '</style><a class="c" style="' + THEME[mode] + ';--c:' + col + '" href="' + esc(href) + '" target="_blank" rel="noopener">' +
        '<div class="t"><div class="q">' + esc(c.claim) + '</div><div class="p">' + esc(p) + '</div></div>' +
        '<div class="b"><i style="width:' + (c.p_yes == null ? 0 : Math.round(c.p_yes * 100)) + '%"></i></div>' +
        '<div class="m"><span><b>' + esc(WORD[b] || b) + '</b>' + (c.page ? ' · ' + esc(c.page.title) : '') + '</span><span>Trade it on nearly.trade</span></div></a>'
    }
    function load() { fetch(origin + '/api/wiki/claim/' + id).then(function (r) { return r.ok ? r.json() : null }).then(function (c) { if (c) draw(c) }).catch(function () {}) }
    load(); setInterval(load, 60000)
  })
})()
