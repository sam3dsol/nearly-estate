// trades: every buy and sell on the markets, from the contract's first transaction to now. FastNEAR's transaction index lists the
// contract's transactions newest first; each one is read with its receipts, and a trade is what the contract itself logged in a
// receipt that succeeded ("market 303 buy YES <shares> shares for <owner>", "market 1 sell YES <shares> shares -> <wNEAR out>"),
// so the shares and the owner come from the chain, never from a guess. The wNEAR of a buy is what ft_on_transfer kept (the amount
// sent less what it handed back); the price after a trade is the market read at that block from the archival RPC, once.
// A buy message may carry a "note": the trader's reason, kept with the trade (the contract ignores the field, see its tests).
// Kept in the data dir; the first round walks back to the first transaction, then a slow poll keeps it current.
import { table, log } from './store.mjs'
import { view, RPC, CONTRACT, WRAP } from './near.mjs'

const FX = 'https://tx.main.fastnear.com'
const KEY = RPC.match(/apiKey=([^&]+)/)?.[1] || ''   // the same FastNEAR key as the RPC, as a Bearer header (the index rate-limits without it)
// the archival node answers a view at any past block: FastNEAR's, keyed, when the RPC is FastNEAR's
const ARCHIVAL = process.env.NEAR_ARCHIVAL_RPC || (RPC.includes('://rpc.mainnet.fastnear.com') ? RPC.replace('://rpc.mainnet.fastnear.com', '://archival-rpc.mainnet.fastnear.com') : 'https://archival-rpc.mainnet.fastnear.com')
const book = table('trades', [])   // every trade, newest first
// how each market was settled, from the contract's log lines: proposed, challenged (each round and bond), resolved, ruled, void
const evs = table('settles', [])
const evscan = table('settlescan', { done: false, resume: null })
// the walk: done = the backfill reached the first tx; resume = where an interrupted backfill goes on; mark = the newest tx height a
// finished round saw; seen = tx hash -> height for recent txs (older ones are below the mark); miss = hashes the index did not serve
const scan = table('tradescan', { done: false, resume: null, start: 0, mark: 0, seen: {}, miss: {}, ptry: {} })
const err = (status, message) => Object.assign(new Error(message), { status })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- parsing one transaction (pure: the tests feed it recorded mainnet transactions)
const BUY = /^market (\d+) buy (YES|NO) (\d+) shares(?: for (\S+))?$/   // " for <owner>"; before that the owner was the sender
const SELL = /^market (\d+) sell (YES|NO) (\d+) shares -> (\d+)$/
// a hired desk's buy: desk_buy logs the market's buy line, then its own, with the model's reason at the end
const DESK = /^desk (\d+) for (\S+) bought (YES|NO) on market (\d+) with (\d+) wNEAR: (.*)$/
// and a hired desk's sale: desk_sell logs the market's sell line, then its own
const DESK_SOLD = /^desk (\d+) for (\S+) sold (YES|NO) (\d+) shares on market (\d+) for (\d+) wNEAR: (.*)$/
const json = (s) => { try { return JSON.parse(s) } catch { return null } }
const b64 = (s) => Buffer.from(s || '', 'base64').toString()
/** yocto (wNEAR or shares, both 1e24) -> a plain number, 6 decimals */
export const units = (y) => Math.round(Number(BigInt(y)) / 1e18) / 1e6
const r6 = (x) => Math.round(x * 1e6) / 1e6
/** the trader's reason from a buy message: at most 280 characters, no control or text-direction characters */
export function cleanNote(s) {
  if (typeof s !== 'string') return null
  const t = s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim()
  return t ? [...t].slice(0, 280).join('') : null
}
/** the trades in one transaction as the tx index serves it ({transaction, receipts: [{receipt, execution_outcome}]}). A receipt
 *  that failed changed nothing and is skipped; so is a BuyFor that could not go through (forwarded whole to the owner's Intents
 *  account: no shares, no trade) and a buy whose wNEAR all came back. */
const EV = [
  [/^market (\d+) proposed (YES|NO) by (\S+) with a (\d+) bond$/, (m) => ({ type: 'proposed', market: +m[1], side: m[2] === 'YES' ? 'yes' : 'no', by: m[3], bond: units(m[4]) })],
  [/^market (\d+) challenged, round (\d+), (\d+) on (YES|NO)$/, (m) => ({ type: 'challenged', market: +m[1], round: +m[2], bond: units(m[3]), side: m[4] === 'YES' ? 'yes' : 'no' })],
  [/^market (\d+) resolved (YES|NO)$/, (m) => ({ type: 'resolved', market: +m[1], side: m[2] === 'YES' ? 'yes' : 'no' })],
  [/^market (\d+) ruled (YES|NO) by the judge after (\d+) rounds/, (m) => ({ type: 'ruled', market: +m[1], side: m[2] === 'YES' ? 'yes' : 'no', rounds: +m[3] })],
  [/^market (\d+) invalid: every share pays half$/, (m) => ({ type: 'void', market: +m[1] })],
]
/** a tx's settlement steps: one per matching log line of a receipt this contract ran without failing; who signed it rides along */
export function parseEvents(t, contract = CONTRACT) {
  const out = [], tx = t?.transaction?.hash, signer = t?.transaction?.signer_id
  for (const r of t?.receipts || []) {
    const rc = r.receipt, eo = r.execution_outcome, o = eo?.outcome, st = o?.status || {}
    if (rc?.receiver_id !== contract || typeof st !== 'object' || !('SuccessValue' in st || 'SuccessReceiptId' in st)) continue
    for (const l of o.logs || []) for (const [re, f] of EV) { const m = re.exec(l); if (m) out.push({ ...f(m), tx, signer, at: Math.round(Number(eo.block_timestamp) / 1e6) }) }
  }
  return out
}
/** book a tx's settlement steps once */
function bookEvents(t) { let n = 0; for (const e of parseEvents(t)) if (!evs.v.some((x) => x.tx === e.tx && x.type === e.type && x.market === e.market && x.round === e.round)) { evs.v.push(e); n++ } return n }
export const eventsOf = (market) => evs.v.filter((e) => e.market === Number(market)).sort((a, b) => a.at - b.at)

export function parseTx(t, contract = CONTRACT) {
  const out = [], tx = t?.transaction?.hash
  for (const r of t?.receipts || []) {
    const rc = r.receipt, eo = r.execution_outcome, o = eo?.outcome, st = o?.status || {}
    if (rc?.receiver_id !== contract || typeof st !== 'object' || !('SuccessValue' in st || 'SuccessReceiptId' in st)) continue
    const base = { tx, at: Math.round(Number(eo.block_timestamp) / 1e6), block: eo.block_height }
    const calls = (rc.receipt?.Action?.actions || []).map((a) => a.FunctionCall).filter(Boolean)
    const ft = calls.find((c) => c.method_name === 'ft_on_transfer')
    if (ft && rc.predecessor_id === WRAP) {
      const args = json(b64(ft.args)), msg = json(args?.msg), m = msg?.Buy || msg?.BuyFor
      const hit = m ? o.logs.map((l) => BUY.exec(l)).find(Boolean) : null
      if (!hit) continue
      const spent = BigInt(args.amount) - BigInt(json(b64(st.SuccessValue)) || 0)   // ft_on_transfer returns what it did not use
      if (spent <= 0n) continue
      out.push({ ...base, market: Number(hit[1]), account: hit[4] || (msg.BuyFor ? m.owner : args.sender_id), side: hit[2] === 'YES' ? 'yes' : 'no', kind: 'buy', near: units(spent), shares: units(hit[3]), p_after: null, via: msg.BuyFor ? 'intents' : 'near', note: cleanNote(m.note) })
    }
    // a sell pays the seller (the caller) in wNEAR; one receipt may carry several sells, each logs its own line
    if (calls.some((c) => c.method_name === 'sell')) for (const l of o.logs) { const s = SELL.exec(l); if (s) out.push({ ...base, market: Number(s[1]), account: rc.predecessor_id, side: s[2] === 'YES' ? 'yes' : 'no', kind: 'sell', near: units(s[4]), shares: units(s[3]), p_after: null, via: 'near', note: null }) }
    // a hired desk's buy: the shares are the owner's (the desk line names it, and the market's line before it must name the same
    // owner, market and side); the wNEAR is what the desk spent, fee included, as a Buy's; the note is the model's reason
    if (calls.some((c) => c.method_name === 'desk_buy')) {
      let b = null
      for (const l of o.logs) {
        const hit = BUY.exec(l); if (hit) { b = hit; continue }
        const d = DESK.exec(l); if (!d) continue
        if (b && b[1] === d[4] && b[2] === d[3] && b[4] === d[2]) out.push({ ...base, market: Number(d[4]), account: d[2], side: d[3] === 'YES' ? 'yes' : 'no', kind: 'buy', near: units(d[5]), shares: units(b[3]), p_after: null, via: 'desk', note: cleanNote(d[6]), desk: { id: Number(d[1]) } })
        b = null
      }
    }
    // a hired desk's sale: the shares were the owner's and the wNEAR went into the desk's balance (never paid out); the market's
    // sell line before the desk's must agree on market, side, shares and wNEAR
    if (calls.some((c) => c.method_name === 'desk_sell')) {
      let sl = null
      for (const l of o.logs) {
        const hit = SELL.exec(l); if (hit) { sl = hit; continue }
        const d = DESK_SOLD.exec(l); if (!d) continue
        if (sl && sl[1] === d[5] && sl[2] === d[3] && sl[3] === d[4] && sl[4] === d[6]) out.push({ ...base, market: Number(d[5]), account: d[2], side: d[3] === 'YES' ? 'yes' : 'no', kind: 'sell', near: units(d[6]), shares: units(d[4]), p_after: null, via: 'desk', note: cleanNote(d[7]), desk: { id: Number(d[1]) } })
        sl = null
      }
    }
  }
  return out
}

// ---- the walk over FastNEAR's index. Requests a day, steady state: one account page per 90 s round (960), one transactions call
// per round that has new txs (at most 960, about 600 at today's ~600 txs a day), one archival view per new trade (tens): ~2,000
// a day at most. The backfill is a one-time ~400 calls (6,700 txs today), 0.3 s apart.
const GAP = 300
async function fx(path, body) {
  await sleep(GAP)
  const r = await fetch(FX + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(KEY ? { authorization: `Bearer ${KEY}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) })
  if (!r.ok) throw new Error(`tx index ${r.status} ${path}`)
  return r.json()
}
const page = (token) => fx('/v0/account', { account_id: CONTRACT, ...(token ? { resume_token: token } : {}) })
/** read these txs and book their trades; a tx the index does not serve is asked again next round (three rounds, then let go) */
async function take(entries) {
  let n = 0
  for (let i = 0; i < entries.length; i += 20) {
    const part = entries.slice(i, i + 20)
    const { transactions = [] } = await fx('/v0/transactions', { tx_hashes: part.map((e) => e.transaction_hash) })
    const got = new Map(transactions.map((t) => [t.transaction?.hash, t]))
    for (const e of part) {
      const h = e.transaction_hash, t = got.get(h)
      if (!t) { scan.v.miss[h] = (scan.v.miss[h] || 0) + 1; if (scan.v.miss[h] < 3) throw new Error(`tx index did not serve ${h}`); log('trades: the index never served', h) }
      const ts = t ? parseTx(t) : []
      if (t && bookEvents(t)) evs.save()
      for (const x of ts) if (!book.v.some((y) => y.tx === x.tx && y.market === x.market && y.kind === x.kind && y.shares === x.shares)) { book.v.push(x); n++ }
      scan.v.seen[h] = e.tx_block_height; delete scan.v.miss[h]
    }
  }
  if (n) { book.v.sort((a, b) => b.block - a.block || b.at - a.at); idx = null }
  return n
}
const young = (e) => Date.now() - Number(e.tx_block_timestamp) / 1e6 < 60e3   // its receipts may still be running: next round
/** once: from the newest tx back to the contract's first, a page at a time; an interrupted backfill goes on where it stopped */
async function backfill() {
  let token = scan.v.resume, n = 0
  for (;;) {
    const p = await page(token), list = p.account_txs || []
    if (!token && !scan.v.start) scan.v.start = list[0]?.tx_block_height || 0
    n += await take(list.filter((e) => scan.v.seen[e.transaction_hash] == null && !young(e)))
    token = p.resume_token || null
    scan.v.resume = token; if (!token) { scan.v.done = true; scan.v.mark = scan.v.start }
    scan.save(); book.save()
    if (!token) break
  }
  log('trades: backfill done,', book.v.length, 'trades,', n, 'this run')
}
// a round looks back this far below the last mark: txs indexed late or skipped as too young are picked up (about 15 minutes)
const MARGIN = 1000, KEEP = 50_000
/** newest first down to the last round's mark (less the margin); the mark moves only when the round finishes */
async function catchUp() {
  let token = null, top = 0, n = 0
  for (;;) {
    const p = await page(token), list = p.account_txs || []
    top = Math.max(top, list[0]?.tx_block_height || 0)
    const floor = scan.v.mark - MARGIN
    n += await take(list.filter((e) => e.tx_block_height >= floor && scan.v.seen[e.transaction_hash] == null && !young(e)))
    token = p.resume_token || null
    if (!token || !list.length || list[list.length - 1].tx_block_height < floor) break
  }
  scan.v.mark = Math.max(scan.v.mark, top)
  for (const [h, b] of Object.entries(scan.v.seen)) if (b < scan.v.mark - KEEP) delete scan.v.seen[h]
  scan.save(); if (n) { book.save(); log('trades:', n, 'new') }
}
/** the market at a past block, from the archival RPC */
async function marketAt(market, block) {
  await sleep(200)
  const r = await fetch(ARCHIVAL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'call_function', block_id: block, account_id: CONTRACT, method_name: 'get_market', args_base64: Buffer.from(JSON.stringify({ market: String(market) })).toString('base64') } }), signal: AbortSignal.timeout(20_000) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || d.error || !d.result?.result) throw new Error(`archival ${r.status} ${JSON.stringify(d.error || d.result?.error || '').slice(0, 120)}`)
  return JSON.parse(Buffer.from(d.result.result).toString())
}
export const priceOf = (m) => (m?.p_yes != null ? m.p_yes : m ? 1 / (1 + Math.exp((Number(m.q_no) - Number(m.q_yes)) / Number(m.b))) : null)
/** the price after each trade: one archival view per trade (two trades of one market in one block share it), kept forever;
 *  a view that fails is tried in three rounds, then the trade keeps p_after null */
async function fillPrices(max = 100) {
  const todo = book.v.filter((t) => t.p_after == null && (scan.v.ptry[`${t.tx}:${t.market}`] || 0) < 3).slice(0, max), got = new Map()
  for (const t of todo) {
    const k = `${t.market}@${t.block}`
    try {
      if (!got.has(k)) { const m = await marketAt(t.market, t.block); if (!m) throw new Error('no market at that block'); got.set(k, r6(priceOf(m))) }
      t.p_after = got.get(k)
    }
    catch (e) { const id = `${t.tx}:${t.market}`; scan.v.ptry[id] = (scan.v.ptry[id] || 0) + 1; log('trades: price at', t.block, 'market', t.market, e.message.slice(0, 120)) }
  }
  if (todo.length) { idx = null; book.save(); scan.save() }
}
/** a round: the backfill until it is done, then the new txs, then the prices */
/** once: the settlement steps of every tx before the events were kept, a page at a time, then never again */
async function backfillEvents() {
  let token = evscan.v.resume
  for (;;) {
    const p = await page(token), list = (p.account_txs || []).filter((e) => !young(e))
    for (let i = 0; i < list.length; i += 20) {
      const { transactions = [] } = await fx('/v0/transactions', { tx_hashes: list.slice(i, i + 20).map((e) => e.transaction_hash) })
      for (const t of transactions) bookEvents(t)
    }
    token = p.resume_token || null; evscan.v.resume = token; if (!token) evscan.v.done = true
    evscan.save(); evs.save()
    if (!token) break
  }
  log('trades: settlement steps backfilled,', evs.v.length)
}

export async function poll() {
  if (!scan.v.done) await backfill()
  await catchUp()
  await fillPrices()
  if (!evscan.v.done) await backfillEvents().catch((e) => log('trades: settlement backfill paused,', e.message.slice(0, 80)))
}
export const state = () => ({ trades: book.v.length, backfilled: !!scan.v.done, mark: scan.v.mark })

// ---- what the index holds, per market and per account (rebuilt when the book changes)
let idx = null
function index() {
  if (idx) return idx
  const byMarket = new Map(), byAccount = new Map()
  for (const t of book.v) {
    const m = byMarket.get(t.market) || { list: [], volume: 0 }; m.list.push(t); m.volume += t.near; byMarket.set(t.market, m)
    if (!byAccount.has(t.account)) byAccount.set(t.account, new Set()); byAccount.get(t.account).add(t.market)
  }
  idx = { byMarket, byAccount }; return idx
}
/** a market's count of trades and wNEAR traded (buys and sells) */
export const statsOf = (market) => { const m = market == null ? null : index().byMarket.get(Number(market)); return { volume_near: m ? Math.round(m.volume * 1e4) / 1e4 : 0, trades: m ? m.list.length : 0, traders: m ? new Set(m.list.map((t) => t.account)).size : 0 } }   // traders: distinct accounts
export const ofMarket = (market) => index().byMarket.get(Number(market))?.list || []
export const marketsOf = (account) => [...(index().byAccount.get(account) || [])]

// ---- the money math (pure)
/** the price before the first trade: the first trade's price moved back by its own shares (LMSR: q_yes - q_no = b ln(p / (1-p))).
 *  Every market on this contract opens at q_yes = q_no = 0, so this reads 0.5 unless that ever changes. */
export function openedP(first, b) {
  const p = first?.p_after
  if (!(p > 0 && p < 1) || first.shares == null || !(b > 0)) return null
  const d = b * Math.log(p / (1 - p)) - (first.kind === 'buy' ? 1 : -1) * (first.side === 'yes' ? 1 : -1) * first.shares
  return Math.round(1e4 / (1 + Math.exp(-d / b))) / 1e4
}
/** a position's worth in wNEAR: settled, what it pays (a winning share 1, a void market half of every share); otherwise at the
 *  price (a YES share is worth p, a NO share 1 - p) */
export function valueOf(pos, m) {
  const s = m?.status
  if (s && typeof s === 'object' && 'Resolved' in s) return r6(s.Resolved.outcome ? pos.yes : pos.no)
  if (s && typeof s === 'object' && 'Invalid' in s) return r6((pos.yes + pos.no) / 2)
  const p = priceOf(m)
  return r6(pos.yes * p + pos.no * (1 - p))
}
/** holders by size (YES and NO shares together), empty positions left out */
export const rankHolders = (rows, cap = 50) => rows.filter((r) => r.yes + r.no > 0).sort((a, b) => b.yes + b.no - (a.yes + a.no) || (a.account < b.account ? -1 : 1)).slice(0, cap)

// ---- chain reads behind the endpoints
let links = { page: () => null, hidden: () => false, desk: { agents: () => [], of: () => [], tradeTxs: () => new Map() }, hire: { name: () => null } }
/** the wiki says which page a market sits on and which subjects are hidden; the desk says which trades are its own; the hired
 *  desks say their names (no import cycle) */
export const setLinks = (l) => { links = { ...links, ...l } }
let all = { at: 0, v: new Map() }
async function marketsNow() {
  if (Date.now() - all.at < 60e3) return all.v
  const out = new Map()
  for (let from = 0; ; from += 200) { const p = await view(CONTRACT, 'get_markets', { from, limit: 200 }); for (const m of p) out.set(m.id, m); if (p.length < 200) break }
  all = { at: Date.now(), v: out }; return out
}
/** a few reads at a time */
async function eachLimit(list, n, fn) { const out = new Array(list.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) { const k = i++; out[k] = await fn(list[k]) } })); return out }
const position = (market, account) => view(CONTRACT, 'get_position', { market: String(market), account }).then((p) => ({ yes: units(p.yes), no: units(p.no) })).catch(() => null)
/** a desk agent's trade carries its name, its stated belief on that claim and its one-line reason: the view behind that very tx
 *  when the server kept it, else the agent's current view of the claim, but only when that view sides with the trade (a YES buy
 *  beside a view of 50% or more, a NO buy beside 50% or less). A view on the other side, or one whose own
 *  note says the opposite of its number, gives the trade its agent and no belief (p and note null); never "believes 3%" beside
 *  a YES buy */
export function tagger(claimOf = () => '') {
  const ag = links.desk.agents(), byAcct = new Map(ag.filter((a) => a.account).map((a) => [a.account, a.id])), names = new Map(ag.map((a) => [a.id, a.name]))
  const byTx = links.desk.tradeTxs(), mixed = links.desk.mixed || (() => false)
  return (t) => {
    if (t.desk) t = { ...t, desk: { id: t.desk.id, name: links.hire.name(t.desk.id) } }   // a hired desk's buy: its name
    const v = byTx.get(t.tx), own = v?.agent && v.market === t.market ? v : null, id = own ? own.agent : byAcct.get(t.account)
    if (!id) return t
    const yes = (t.side === 'yes') === (t.kind !== 'sell')   // the side the trade bets on: a YES buy, or a NO sale
    const w = own || links.desk.of(t.market).find((x) => x.agent === id)
    const show = w && Number.isFinite(w.p) && !mixed(claimOf(t.market), { p: w.p, note: w.note }) && (own || (yes ? w.p >= 0.5 : w.p <= 0.5))
    return { ...t, agent: { id, name: names.get(id) || id, p: show ? w.p : null, note: show ? w.note ?? null : null } }
  }
}
const label = (m) => ({ claim: m?.question ?? null, page: m?.subject ? links.page(m.subject) : null })

/** GET /api/wiki/claim/:id/trades: the claim's trades (newest first), its volume, its opening price and who holds it now */
export async function ofClaim(id) {
  const m = (await marketsNow()).get(Number(id)); if (!m) throw err(404, 'no market')
  const list = ofMarket(m.id), tag = tagger(() => m.question)
  return { market: m.id, trades: list.slice(0, 200).map(tag), events: eventsOf(m.id), count: list.length, volume_near: statsOf(m.id).volume_near, opened_p: list.length ? openedP(list[list.length - 1], Number(m.b) / 1e24) ?? 0.5 : Math.round(priceOf(m) * 1e4) / 1e4, ...(await holders(m.id, list)) }
}
/** who holds the claim now: get_position for every account that ever traded it, two minutes cached, concurrent asks share one read */
const holdCache = new Map(), holdReading = new Map()
function holders(id, list) {
  const h = holdCache.get(id); if (h && Date.now() - h.at < 120e3) return h.v
  if (!holdReading.has(id)) holdReading.set(id, (async () => {
    const rows = await eachLimit([...new Set(list.map((t) => t.account))], 6, async (a) => { const p = await position(id, a); return p ? { account: a, ...p } : { account: a, unread: true } })
    const unread = rows.filter((r) => r.unread).length, v = { holders: rankHolders(rows.filter((r) => !r.unread)), holders_unread: unread }
    if (!unread) holdCache.set(id, { at: Date.now(), v })   // a read that failed is unknown, not zero: not cached, asked again next time
    return v
  })().finally(() => holdReading.delete(id)))
  return holdReading.get(id)
}
/** GET /api/wiki/trades: the latest trades on every claim (hidden pages left out) */
export async function recent(limit) {
  const n = Math.min(200, Math.max(1, Number(limit) || 40)), ms = await marketsNow(), tag = tagger((id) => ms.get(id)?.question)
  return { trades: book.v.filter((t) => !links.hidden(ms.get(t.market)?.subject)).slice(0, n).map((t) => ({ ...tag(t), ...label(ms.get(t.market)) })), count: book.v.length, volume_near: totals().volume_near }
}
export function totals() { let v = 0; for (const t of book.v) v += t.near; return { volume_near: Math.round(v * 1e4) / 1e4, trades: book.v.length } }
/** GET /api/wiki/portfolio/:account: every position the account holds on a market it ever traded, valued now */
const ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/
// one get_position per market the account traded: a desk agent's ~130 markets is ~130 views at most once a minute
const folio = new Map(), reading = new Map()   // account -> { at, v }: a minute; account -> the read under way (shared)
/** `recent`: market ids the page knows the account just traded (the index polls every 90 s, so a bet made a moment ago is not in
 *  it yet): they are read from the contract at once and the minute's cache is skipped */
export async function portfolio(account, recent = '') {
  const a = String(account || '').trim().toLowerCase(); if (!ACCOUNT.test(a)) throw err(400, 'a NEAR account, please')
  const extra = String(recent || '').split(',').map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0).slice(0, 10)
  const hit = folio.get(a); if (hit && Date.now() - hit.at < 60e3 && !extra.length) return hit.v
  const key = extra.length ? `${a}:${extra.join('.')}` : a
  if (!reading.has(key)) reading.set(key, readFolio(a, extra).finally(() => reading.delete(key)))
  return reading.get(key)
}
async function readFolio(a, extra = []) {
  const ms = await marketsNow(), ids = [...new Set([...marketsOf(a), ...extra])].sort((x, y) => y - x)
  const pos = await eachLimit(ids, 6, (id) => position(id, a))
  const positions = [], unread = []
  ids.forEach((id, i) => {
    const p = pos[i], m = ms.get(id)
    if (!p) return unread.push(id)
    if (!m || p.yes + p.no <= 0) return
    positions.push({ market: id, ...label(m), yes: p.yes, no: p.no, p_yes: r6(priceOf(m)), value_near: valueOf(p, m), status: m.status, resolves_at_ms: m.resolves_at_ms || null })
  })
  const v = { account: a, positions, total_value_near: r6(positions.reduce((s, x) => s + x.value_near, 0)), markets_traded: ids.length, unread }
  if (!unread.length) { folio.set(a, { at: Date.now(), v }); if (folio.size > 500) folio.delete(folio.keys().next().value) }
  return v
}
