// Wikipedia as the writer's source and the judge's evidence: search, the article's plain text, its picture and categories.
// Read inside the enclave over HTTPS; nothing here is trusted as instructions, it is material to write and judge from.
import dns from 'node:dns/promises'
import net from 'node:net'
import https from 'node:https'

const API = 'https://en.wikipedia.org/w/api.php'
const UA = 'nearly-wiki/1.0 (https://nearly.trade/wiki; dev@nearly.trade)'
const mem = new Map()
async function api(params, ttl = 6 * 3600e3) {
  const qs = new URLSearchParams({ format: 'json', formatversion: '2', ...params }).toString()
  const h = mem.get(qs); if (h && Date.now() - h.at < ttl) return h.v
  const r = await fetch(`${API}?${qs}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15_000) })
  if (!r.ok) throw new Error(`wikipedia ${r.status}`)
  const v = await r.json(); mem.set(qs, { at: Date.now(), v }); if (mem.size > 500) mem.delete(mem.keys().next().value); return v
}

/** "Great Wall of China" -> "great-wall-of-china": the page's URL and, with ".topic", the subject its markets sit under on chain */
export const slugOf = (title) => String(title).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56).replace(/-+$/, '')
export const subjectOf = (slug) => `${slug}.topic`
export const isTopicSubject = (s) => /^[a-z0-9-]+\.topic$/.test(String(s || ''))

/** a Wikipedia link or a phrase -> the article title it names (a link's title, else the best search hit) */
export async function resolveTitle(q) {
  const s = String(q || '').trim().slice(0, 200); if (!s) return null
  const link = /^https?:\/\/[a-z-]+\.(?:m\.)?wikipedia\.org\/wiki\/([^?#]+)/i.exec(s)
  if (link) return decodeURIComponent(link[1]).replace(/_/g, ' ')
  const d = await api({ action: 'query', list: 'search', srsearch: s, srlimit: '1', srprop: '' })
  return d.query?.search?.[0]?.title || null
}

/** suggestions for the search box: title + Wikipedia's one-line description */
export async function suggest(q) {
  const s = String(q || '').trim().slice(0, 100); if (s.length < 2) return []
  const d = await api({ action: 'query', generator: 'prefixsearch', gpssearch: s, gpslimit: '8', prop: 'description|pageprops', ppprop: 'disambiguation', redirects: '1' }, 3600e3)
  return (d.query?.pages || []).filter((p) => !p.pageprops || !('disambiguation' in p.pageprops)).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((p) => ({ title: p.title, slug: slugOf(p.title), description: p.description || '' }))
}

/** an article with no lead picture gives its first real picture, in page
 *  order, a photo or drawing of at least 300 px and not an icon, a logo or a map pin */
const NOT_A_PICTURE = /icon|logo|wiki|commons|symbol|ambox|question|edit|padlock|disambig|speaker|sound|pin|arrow|button|star|check|cross|emblem|seal|signature|crystal|nuvola|gnome|oojs|increase|decrease|flag_of_none/i
export async function firstImage(title) {
  const d = await api({ action: 'query', titles: title, redirects: '1', prop: 'images', imlimit: '40' }, 24 * 3600e3)
  const files = (d.query?.pages?.[0]?.images || []).map((x) => x.title).filter((t) => /\.(jpe?g|png|webp)$/i.test(t) && !NOT_A_PICTURE.test(t)).slice(0, 4)
  if (!files.length) return null
  const i = await api({ action: 'query', titles: files.join('|'), prop: 'imageinfo', iiprop: 'url|size|mime', iiurlwidth: '960' }, 24 * 3600e3)
  const by = new Map((i.query?.pages || []).map((p) => [p.title, p.imageinfo?.[0]]))
  for (const f of files) { const x = by.get(f); if (x && /^image\/(jpeg|png|webp)$/.test(x.mime || '') && (x.width || 0) >= 300) return x.thumburl || x.url }
  return null
}
/** the article: title, link, one-line description, picture, plain text (cut), and whether it is about a living person */
export async function article(title, { chars = 14000 } = {}) {
  const d = await api({ action: 'query', titles: title, redirects: '1', prop: 'extracts|pageimages|info|description|categories|pageprops', explaintext: '1', exsectionformat: 'wiki', inprop: 'url', pithumbsize: '960', pilicense: 'any', clcategories: 'Category:Living people', ppprop: 'disambiguation' })
  const p = d.query?.pages?.[0]
  if (!p || p.missing || p.invalid) return null
  const text = String(p.extract || '').replace(/\n{3,}/g, '\n\n')
  return {
    title: p.title, url: p.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`, description: p.description || '', image: p.thumbnail?.source || await firstImage(p.title).catch(() => null),
    living: (p.categories || []).some((c) => c.title === 'Category:Living people'), disambiguation: !!(p.pageprops && 'disambiguation' in p.pageprops),
    text: text.slice(0, chars), length: text.length, revision: p.lastrevid || null,
  }
}

/** the lines of the article that share the most words with a claim: what the judge and the desk read for that claim */
export function passages(text, claim, { n = 6, max = 3500 } = {}) {
  const words = (s) => new Set(String(s).toLowerCase().match(/[a-z0-9]{4,}/g) || [])
  const want = words(claim)
  const paras = String(text || '').split(/\n+/).map((t) => t.trim()).filter((t) => t.length > 60 && !/^=+/.test(t))
  const scored = paras.map((t, i) => { let s = 0; for (const w of words(t)) if (want.has(w)) s++; return { t, i, s } }).filter((x) => x.s > 0)
  const top = scored.sort((a, b) => b.s - a.s).slice(0, n).sort((a, b) => a.i - b.i)
  let out = ''; for (const x of top) { if (out.length + x.t.length > max) break; out += (out ? '\n' : '') + x.t }
  return out || paras.slice(0, 3).join('\n').slice(0, max)
}

/** GET over TLS to the one address the private-range check saw, so the name cannot resolve elsewhere between the check and the
 * connection; a redirect, a wrong type or an error is null, the body is cut at 400 KB*/
function pinnedGet(u, pin) {
  return new Promise((resolve) => {
    const lookup = (host, opts, cb) => (opts?.all ? cb(null, [{ address: pin.address, family: pin.family }]) : cb(null, pin.address, pin.family))
    const req = https.request(u, { method: 'GET', headers: { 'user-agent': UA, accept: 'text/html,text/plain' }, lookup, timeout: 10_000 }, (res) => {
      if (res.statusCode !== 200 || !/text\/(html|plain)/.test(res.headers['content-type'] || '')) { res.resume(); return resolve(null) }
      let got = ''; res.setEncoding('utf8')
      res.on('data', (ch) => { got += ch; if (got.length > 400_000) { req.destroy(); resolve(got) } })
      res.on('end', () => resolve(got)); res.on('error', () => resolve(null))
    })
    req.on('timeout', () => req.destroy()); req.on('error', () => resolve(null)); req.end()
  })
}
/** a source someone posted for a claim, as text for the judge: public https only (no private ranges, no ports), small, plain */
const PRIVATE = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^::1$/, /^f[cd]/i, /^fe80/i, /^::ffff:(127|10|192\.168|169\.254)\./i]
export async function readSource(url) {
  let u; try { u = new URL(url) } catch { return null }
  if (u.protocol !== 'https:' || u.port || u.username || u.password || net.isIP(u.hostname)) return null
  const addrs = await dns.lookup(u.hostname, { all: true }).catch(() => [])
  if (!addrs.length || addrs.some((a) => PRIVATE.some((re) => re.test(a.address)))) return null
  try {
    const got = await pinnedGet(u, addrs[0]); if (got == null) return null
    const title = (/<title[^>]*>([^<]{1,200})<\/title>/i.exec(got)?.[1] || '').trim()
    const text = got.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<nav[\s\S]*?<\/nav>|<footer[\s\S]*?<\/footer>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim()
    return { title, text: text.slice(0, 6000) }
  } catch { return null }
}
