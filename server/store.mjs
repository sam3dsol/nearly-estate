// tiny json store: one file per table under DATA, written whole on every change
import fs from 'node:fs'
import path from 'node:path'
export const DATA = process.env.DATA || new URL('./data/', import.meta.url).pathname
fs.mkdirSync(DATA, { recursive: true })
const cache = new Map()
// a table's top-level object has no prototype, so a key a visitor picks ("constructor", "toString", "__proto__")
// reads as absent instead of as Object's own function, and is written as a plain key. own() is the explicit check every
// user-keyed read goes through on top of that (GET /api/wiki/constructor had passed as an existing topic and opened markets).
export const PROTO_NAMES = Object.freeze(Object.getOwnPropertyNames(Object.prototype))
export const isProtoName = (k) => PROTO_NAMES.includes(String(k))
export const own = (o, k) => (o != null && Object.hasOwn(o, k) ? o[k] : undefined)
const bare = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.assign(Object.create(null), x) : x)
export function table(name, init = {}) {
  if (cache.has(name)) return cache.get(name)
  const f = path.join(DATA, name + '.json')
  let v = bare(fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : init)
  const t = { get v() { return v }, set v(x) { v = bare(x) }, save() { fs.writeFileSync(f + '.tmp', JSON.stringify(v)); fs.renameSync(f + '.tmp', f) } }
  cache.set(name, t); return t
}
export const log = (...a) => console.log(new Date().toISOString(), ...a)

// nearly.trade public API, lightly cached
const SITE = process.env.SITE || 'https://nearly.trade'
const mem = new Map()
export async function site(path, ttl = 15_000) {
  const h = mem.get(path); if (h && Date.now() - h.at < ttl) return h.v
  const r = await fetch(SITE + path, { signal: AbortSignal.timeout(15_000) })
  if (!r.ok) throw new Error(`site ${r.status} ${path}`)
  const v = await r.json(); mem.set(path, { at: Date.now(), v }); return v
}
export const sitePost = async (path, body) => { const r = await fetch(SITE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) }); return r.ok ? r.json() : null }
/** every NEAR-pair launch, symbol and contract both ways, refreshed hourly; holders_prev = each launch's holders at the refresh before */
let launches = { at: 0, byToken: new Map(), bySym: new Map(), list: [], holdersPrev: new Map() }
export async function allLaunches() {
  if (Date.now() - launches.at < 3600e3 && launches.list.length) return launches
  const rows = await site('/api/launches-all', 3600e3).catch(() => [])
  const list = rows.filter((x) => x.step === 'Done')
  if (!list.length) return launches
  const byToken = new Map(list.map((x) => [x.token, x])), bySym = new Map()
  for (const x of [...list].sort((a, b) => Number(b.liquidity_near) - Number(a.liquidity_near))) { const s = String(x.symbol).toUpperCase(); if (!bySym.has(s)) bySym.set(s, x) }
  const holdersPrev = launches.list.length ? new Map(launches.list.map((x) => [x.token, x.holders])) : new Map()
  launches = { at: Date.now(), byToken, bySym, list, holdersPrev }; return launches
}
export const launchOf = async (tokenOrSym) => { const l = await allLaunches(); return l.byToken.get(tokenOrSym) || l.bySym.get(String(tokenOrSym).toUpperCase()) || null }
export const nearUsd = async () => Number((await site('/api/stats', 60_000)).near_usd) || 0
