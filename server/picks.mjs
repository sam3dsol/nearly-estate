// free picks: anyone picks true or false on an open market, with no wallet and no money, and is scored once the market is
// ruled: the three AI judges' ruling on chain is the answer. A random browser id is the player; one pick per id per market, changeable
// until the market closes or is ruled. Nothing goes on chain. The three house AI agents play too, on the views they publish before a
// ruling, so a player sees how they did against the AIs.
import { table, log, own } from './store.mjs'
import * as markets from './markets.mjs'
import * as desk from './desk.mjs'
import { HIDDEN_MARKETS } from './wiki.mjs'

const book = table('picks', {})   // id -> { name, at, picks: { [market]: { yes, at } } }
const meta = table('wikimeta', { seeds: { day: '', n: 0 } })   // shared with wiki.mjs (the store keeps one table per name)
const TEST_NAMES = [/^ui test/i, /^judge nine$/i]
/** the judge rounds left test players on the public board; dropped once, the flag in wikimeta */
export function dropTestPlayers(players, flags, names = TEST_NAMES, flag = 'picks_purged') {
  if (flags[flag]) return 0
  const gone = Object.keys(players).filter((id) => names.some((re) => re.test(String(players[id]?.name || ''))))
  for (const id of gone) delete players[id]
  flags[flag] = new Date().toISOString().slice(0, 10)
  return gone.length
}
if (!meta.v.picks_purged) { const n = dropTestPlayers(book.v, meta.v); book.save(); meta.save(); log('picks: test players dropped once:', n) }
if (!meta.v.picks_purged_2) { const n = dropTestPlayers(book.v, meta.v, [/^judge check$/i], 'picks_purged_2'); book.save(); meta.save(); log('picks: "judge check" dropped once:', n) }
const PER_ID_DAY = 30, ALL_DAY = 2000
export const err = (status, message) => Object.assign(new Error(message), { status })
const ID = /^[a-z0-9]{12,40}$/
/** a name a player chooses: letters, digits, spaces, . _ -, 2 to 24 long; anything else is no name */
export const cleanName = (s) => { const t = String(s ?? '').trim().replace(/\s+/g, ' '); return /^[\p{L}\p{N} ._-]{2,24}$/u.test(t) ? t : null }
export const statusOf = (m) => (typeof m?.status === 'string' ? m.status : Object.keys(m?.status || {})[0] || null)
/** the judges' answer: the outcome of a market once it is proposed (ruled), challenged or resolved; null while open */
export const outcomeOf = (m) => { const s = m?.status; if (!s || typeof s !== 'object') return null; const v = s.Resolved || s.Proposed || s.Challenged; return typeof v?.outcome === 'boolean' ? v.outcome : null }
/** a pick can still change: the market is open, its date (if any) has not passed, and the site does not hide it */
export const pickable = (m, now = Date.now()) => !!m && statusOf(m) === 'Open' && !(m.resolves_at_ms && now >= m.resolves_at_ms) && !HIDDEN_MARKETS.has(String(m.id))

/** the board (pure): every player with a ruled pick, right first, then fewer wrong; the house agents as rows of their own */
export function scoreBoard(players, outcome, agentViews) {
  const rows = []
  const ruledPicked = new Set()
  for (const [id, p] of Object.entries(players)) {
    let ruled = 0, right = 0
    for (const [mk, x] of Object.entries(p.picks || {})) { const o = outcome(Number(mk)); if (o == null) continue; ruled++; ruledPicked.add(Number(mk)); if (x.yes === o) right++ }
    if (ruled) rows.push({ name: p.name || `player ${id.slice(0, 4)}`, ai: false, picks: Object.keys(p.picks || {}).length, ruled, right })
  }
  // each AI agent on the same ruled markets the players picked, by the side its published view held (p above or below one half)
  const ai = new Map()
  for (const mk of ruledPicked) for (const v of agentViews(mk)) {
    if (typeof v.p !== 'number' || v.p === 0.5) continue
    const a = ai.get(v.name) || { name: v.name, ai: true, picks: 0, ruled: 0, right: 0 }
    a.picks++; a.ruled++; if ((v.p > 0.5) === outcome(mk)) a.right++
    ai.set(v.name, a)
  }
  return [...rows, ...ai.values()].sort((a, b) => b.right - a.right || (a.ruled - a.right) - (b.ruled - b.right) || b.picks - a.picks).slice(0, 50)
}
/** how the crowd and the AI agents lean on one market (pure) */
export function lean(players, mk, agentViews) {
  let yes = 0, no = 0
  for (const p of Object.values(players)) { const x = p.picks?.[mk]; if (x) x.yes ? yes++ : no++ }
  return { market: mk, crowd: { yes, no }, ai: agentViews(mk).filter((v) => typeof v.p === 'number').map((v) => ({ name: v.name, p: Math.round(v.p * 100) / 100 })) }
}

let cache = { at: 0, v: null }
async function marketMap() { if (!cache.v || Date.now() - cache.at > 60e3) cache = { at: Date.now(), v: new Map((await markets.list()).map((m) => [Number(m.id), m])) }; return cache.v }
const views = (mk) => desk.of(mk)
let day = '', today = 0, perId = new Map()

/** POST /api/wiki/picks {market, yes, id, name?} */
const NEW_IDS_PER_IP_DAY = 5
const newIds = new Map()   // ip -> { day, ids: Set }
export async function pick(b = {}, ip = '') {
  const id = String(b.id || '').toLowerCase(); if (!ID.test(id)) throw err(400, 'no player id')
  const mk = Number(b.market); if (!Number.isInteger(mk) || mk < 1) throw err(400, 'no such market')
  if (typeof b.yes !== 'boolean') throw err(400, 'pick true or false')
  const m = (await marketMap()).get(mk)
  if (!m) throw err(404, 'no such market')
  if (!pickable(m)) throw err(409, 'this market is closed for picks')
  const d = new Date().toISOString().slice(0, 10); if (d !== day) { day = d; today = 0; perId = new Map() }
  const p = own(book.v, id) || { name: null, at: Date.now(), picks: {} }
  if (!p.picks[mk]) {
    if (today >= ALL_DAY) throw err(429, 'picks are full for today, back tomorrow')
    if ((perId.get(id) || 0) >= PER_ID_DAY) throw err(429, '30 new picks a day; more tomorrow')
    if (ip && !own(book.v, id)) { const d = newIds.get(ip); const cur = d && d.day === new Date().toISOString().slice(0, 10) ? d : { day: new Date().toISOString().slice(0, 10), ids: new Set() }; if (!cur.ids.has(id) && cur.ids.size >= NEW_IDS_PER_IP_DAY) throw err(429, 'a few new players a day from one address; more tomorrow'); cur.ids.add(id); newIds.set(ip, cur) }
    today++; perId.set(id, (perId.get(id) || 0) + 1)
  }
  p.picks[mk] = { yes: b.yes, at: Date.now() }
  if (b.name !== undefined) p.name = cleanName(b.name)
  book.v[id] = p; book.save()
  return { ok: true, yes: b.yes, ...lean(book.v, mk, views) }
}
/** GET /api/wiki/picks?id= : your picks (with the answer once ruled), how the crowd and the AIs lean on them, and the board */
export async function read(q = {}) {
  const ms = await marketMap(), id = String(q.id || '').toLowerCase()
  const outcome = (mk) => outcomeOf(ms.get(mk))
  const me = ID.test(id) ? own(book.v, id) : null
  const mine = me ? Object.entries(me.picks).map(([mk, x]) => { const n = Number(mk), o = outcome(n); return { ...lean(book.v, n, views), yes: x.yes, open: pickable(ms.get(n)), outcome: o, right: o == null ? null : x.yes === o } }) : []
  return { players: Object.keys(book.v).length, picks: Object.values(book.v).reduce((t, p) => t + Object.keys(p.picks || {}).length, 0), you: me ? { name: me.name, picks: mine } : null, board: scoreBoard(book.v, outcome, views) }
}
