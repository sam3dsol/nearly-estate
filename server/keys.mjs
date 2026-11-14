// keys: "sell your viewing keys". The private registry (hidden account + salt per key), unlock by buying the key on chain
// (or holding min_hold of its token), the feed (history + live), copy rules.
import crypto from 'node:crypto'
import WebSocket from 'ws'
import { table, site, sitePost, launchOf, log, nearUsd, own } from './store.mjs'
import { view, CONTRACT, FACTORY, ftBalance, mtBalance, verifyNep413, verifySolana } from './near.mjs'
import { agentsTable, bffTrade, confidentialOf } from './swarm.mjs'

export const SITE_WS = (process.env.SITE || 'https://nearly.trade').replace(/^http/, 'ws') + '/api/ws'
export const err = (status, message) => Object.assign(new Error(message), { status })
const keys = table('keys', {})      // token -> { hidden, salt, commitment, owner, created }
const copies = table('copies', {})  // token -> [{ agent, ratio_bps, owner }]
const SECRET = crypto.randomBytes(32)
const DEPOSIT = '20000000000000000000000' // 0.02 NEAR storage on register_key
// what a key holder sees is rounded (the minute, three figures), so a row cannot be matched to a public transaction
// and name the hidden account; the confidential Intents swaps are unmatchable anyway and stay exact
const minute = (ms) => (ms ? Math.floor(Number(ms) / 60000) * 60000 : null)
const sig3 = (x) => (typeof x === 'number' && Number.isFinite(x) ? Number(x.toPrecision(3)) : x)
const sigRaw = (s) => { try { const n = BigInt(String(s)); const d = n.toString().length; if (d <= 3) return String(s); const p = 10n ** BigInt(d - 3); return ((n / p) * p).toString() } catch { return s } }

// the keys that are on sale: a trader's own account, a price, not retired
export const chainKeys = async () => { const out = []; for (let from = 0; ; from += 200) { const page = await view(CONTRACT, 'get_keys', { from, limit: 200 }).catch(() => null); if (!page) break; out.push(...page); if (page.length < 200) break } return out.filter((k) => !k.revealed && BigInt(k.min_hold || 0) === 0n && k.token === k.owner) }   // paged
// our record is only trusted when it matches the chain: same commitment, same owner. Otherwise the key has no feed.
export const matches = (k) => { const r = own(keys.v, k.token); return !!r && r.owner === k.owner && crypto.createHash('sha256').update(`${r.hidden}:${r.salt}`).digest('hex') === k.commitment }
const hiddenOf = (k) => (matches(k) ? own(keys.v, k.token).hidden : null)
let verified = new Map()   // token -> hidden, refreshed from the chain every 30 s for the live socket
const hiddenSet = () => new Set(verified.values())

/** step 1 of making a key: the creator signs in, the trading account proves itself, we keep the salt and hand back the commitment + the tx to sign */
export async function prepare({ token, hidden, session, proof }) {
  const me = await sitePost('/api/social/me', { session }); if (!me?.account) throw err(401, 'sign in on nearly.trade first')
  // a key is on the seller's own account: the trader sells a view of their own trades
  if (token !== me.account) throw err(400, 'a key is on your own account')
  if (hidden === me.account) throw err(400, 'the trading account must differ from the account selling the key')
  const mine = own(agentsTable().v, hidden)?.owner === me.account   // a swarm agent of yours needs no signature, its keys live with the Agent API
  if (mine && !own(agentsTable().v, hidden)?.agent_id) throw err(400, 'that agent has no Agent API wallet')
  if (!mine) {
    const ok = proof && proof.accountId === hidden && new RegExp(`key ${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\n|$)`).test(String(proof.message)) && (await verifyNep413({ ...proof, recipient: 'nearly.trade' }))
    if (!ok) throw err(401, 'the trading account must sign the message')
  }
  if ((await chainKeys()).some((k) => k.token === token)) throw err(409, 'this token already has a key on chain')
  const salt = crypto.randomBytes(16).toString('hex')
  const commitment = crypto.createHash('sha256').update(`${hidden}:${salt}`).digest('hex')
  keys.v[token] = { hidden, salt, commitment, owner: me.account, created: Date.now() }; keys.save()
  log('key prepared', token, 'by', me.account)
  // the creator keeps the salt too: reveal_key(account, salt) on chain retires the key without us
  return { commitment, salt, tx: { contract: CONTRACT, method: 'register_key', args: { token, commitment, min_hold: '0', price: '0' }, deposit: DEPOSIT } }
}

/** the public shape of one key: the launch, the trader's numbers, never the account */
async function shape(k) {
  const L = await launchOf(k.token)
  const hidden = hiddenOf(k)
  let pnl = null, stats = null, preview = []
  if (hidden) {
    const t = await site(`/api/trader/${hidden}`, 3600_000).catch(() => null)   // an hour: the public card must not move with each trade
    if (t) {
      // rounded on purpose: exact PnL or a timestamp would match the account on the public trade stream
      const r10 = (x) => (x == null ? null : Math.round(x / 10) * 10)
      // under 10 trades a PnL or win rate is noise, not a record: the card says "under 10" and shows no number until there are 10
      const n = t.stats?.trades ?? 0
      pnl = n >= 10 ? { pnl_usd: r10(t.total?.pnl_usd), roi: t.total?.roi == null ? null : Math.round(t.total.roi * 20) / 20 } : null
      stats = { trades: n < 10 ? null : Math.round(n / 10) * 10, trades_label: n < 10 ? 'under 10' : `about ${Math.round(n / 10) * 10}`, win_rate: n < 10 || t.stats?.win_rate == null ? null : Math.round(t.stats.win_rate * 20) / 20, active: t.stats?.last_ts ? Date.now() - t.stats.last_ts < 7 * 86400e3 : false }
      preview = []   // the sides of recent trades would let anyone match the account against the public trade stream
    }
    // a confidential wallet's Intents swaps never reach the public trade stream, so the card's "active" also counts its last executed
    // swap (a yes/no over 7 days, no time, no size: nothing to match against)
    const agent_id = own(agentsTable().v, hidden)?.agent_id
    // its swaps on Rhea count too: on chain like any swap, but nothing ties them to the seller while the account stays hidden
    const rh = await rheaSwaps(hidden).catch(() => [])
    if (agent_id || rh.length) {
      const ops = agent_id ? await intentsHistory(agent_id).catch(() => []) : []
      const swaps = [...ops.filter((o) => o.type === 'swap' && o.status === 'SUCCESS'), ...rh]
      const last = Math.max(0, ...swaps.map((o) => o.ts_ms || 0))
      // the wallet's confidential swaps are its trades: counted, and marked to market at today's prices (what it holds now vs what it put in)
      const n = (t?.stats?.trades ?? 0) + swaps.length
      const mtm = await intentsPnl(swaps)
      if (swaps.length) {
        stats = { ...(stats || {}), trades: n < 10 ? null : Math.round(n / 10) * 10, trades_label: n < 10 ? 'under 10' : `about ${Math.round(n / 10) * 10}`, win_rate: stats?.win_rate ?? null, active: !!(last && Date.now() - last < 7 * 86400e3) }
        if (n >= 10 && mtm != null) pnl = { pnl_usd: Math.round(((pnl?.pnl_usd || 0) + mtm) / 10) * 10, roi: pnl?.roi ?? null }
      } else if (last && Date.now() - last < 7 * 86400e3) stats = { trades: null, trades_label: 'under 10', win_rate: null, ...(stats || {}), active: true }
    }
  }
  return {
    // a key is named by its seller's account (unique, on chain, never renamed); agent = the trading wallet is a swarm agent of the seller
    id: k.id, token: k.token, agent: !!(hidden && own(agentsTable().v, hidden)), min_hold: k.min_hold, price: k.price ?? '0', sold: k.sold ?? 0, created_ms: k.created_ms, revealed: k.revealed, live: !!hidden,
    // a key on the seller's own account: no coin behind it, the account name is the name
    coin: !!L,
    // the trading account is an Agent API wallet under a confidential policy: its swaps run on NEAR Intents confidentially
    confidential: hidden ? await confidentialOf(own(agentsTable().v, hidden)?.agent_id) : false,
    symbol: L?.symbol || k.token.replace(/\.near$/, ''), name: L?.name || `${k.token}'s key`, icon: L?.icon, price_usd: L?.price_usd, fdv_usd: L?.fdv_usd, holders: L?.holders, volume_24h_near: L?.volume_24h_near,
    pnl, stats, preview,
    copying: copiesOf(k.token),   // how many agents copy this key (a count only)
    // the seller paused the listing; the site hides it from buyers and says so on its page (holders keep access)
    paused: !!own(keys.v, k.token)?.paused,
  }
}
export async function list() { return (await Promise.all((await chainKeys()).map(shape))).filter((k) => !k.paused) }   // a paused key is off the list
/** the seller pauses or resumes the listing. The key stays on
 *  chain (the contract has no delist; buy_key still works for anyone who knows the id) and holders keep their access; the site stops
 *  showing a paused key to buyers and its page says so. Only the account the key is on may do it. */
export async function pause({ token, session, paused }) {
  const me = await sitePost('/api/social/me', { session }); if (!me?.account) throw err(401, 'sign in on nearly.trade first')
  const r = own(keys.v, token); if (!r) throw err(404, 'no key for this token')
  if (token !== me.account && r.owner !== me.account) throw err(403, 'not your key')
  r.paused = !!paused; keys.save()
  log('key', token, r.paused ? 'paused' : 'resumed', 'by', me.account)
  return { token, paused: r.paused }
}
export async function one(token) { const k = (await chainKeys()).find((x) => x.token === token); if (!k) throw err(404, 'no key for this token'); return shape(k) }

// Solana unlock: the server writes the message (nonce, 5 min), the wallet signs exactly that, the nonce burns on use
const challenges = new Map()
export function challenge({ token, address }) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(address))) throw err(400, 'bad Solana address')
  const nonce = crypto.randomBytes(16).toString('hex'), exp = Date.now() + 5 * 60e3
  const message = `nearly.trade\nUnlock key ${token}\nWallet: ${address}\nNonce: ${nonce}\nExpires: ${new Date(exp).toISOString()}`
  for (const [n, c] of challenges) if (c.exp < Date.now()) challenges.delete(n)
  while (challenges.size >= 2000) challenges.delete(challenges.keys().next().value)   // the oldest goes when the store is full
  challenges.set(nonce, { message, exp, token, address })
  return { message, exp }
}
/** who may see the feed: bought the key on chain (buy_key), or holds min_hold of its token (on NEAR, or inside Intents for a Solana wallet) */
export async function access(k, id) {
  if (id && id === k.owner) return 'seller'   // the seller always sees their own key's feed
  if (await view(CONTRACT, 'has_key', { key: String(k.id), account: id }).catch(() => false)) return 'bought'
  return null
}
const unlockHint = async (k) => { const sym = (await launchOf(k.token))?.symbol || 'keys'; const parts = []; if (BigInt(k.price || 0) > 0n) parts.push(`buy the key for ${Number(BigInt(k.price) / 10n ** 18n) / 1e6} NEAR`); if (BigInt(k.min_hold) > 0n) parts.push(`hold ${Number(BigInt(k.min_hold) / 10n ** 18n).toLocaleString('en-US')} ${sym}`); return parts.join(' or ') }
/** buying the key (or holding min_hold of its token) unlocks the feed for 12 h */
export async function unlock({ token, session, sol }) {
  const k = (await chainKeys()).find((x) => x.token === token); if (!k) throw err(404, 'no key')
  if (!hiddenOf(k)) throw err(409, 'this key has no feed yet')
  let id
  if (session) { const me = await sitePost('/api/social/me', { session }); if (!me?.account) throw err(401, 'signed out'); id = me.account }
  else if (sol) {
    const n = /Nonce: ([0-9a-f]{32})/.exec(String(sol.message || ''))?.[1], c = n && challenges.get(n)
    if (!c || c.message !== sol.message || c.token !== token || c.address !== sol.address || c.exp < Date.now()) throw err(401, 'ask for a fresh challenge')
    challenges.delete(n)
    id = verifySolana(sol); if (!id) throw err(401, 'bad Solana signature')
  }
  else throw err(400, 'session or sol')
  const how = await access(k, id)
  if (!how) throw err(402, `${await unlockHint(k)} to unlock`)
  const exp = Date.now() + 12 * 3600e3
  const ft = issueFt(token, id, exp)
  return { ft, exp, holder: id, how }
}
/** a feed token: token|holder|expiry|hmac, checked by checkFt */
export const issueFt = (token, id, exp) => `${token}|${id}|${exp}|${crypto.createHmac('sha256', SECRET).update(`${token}|${id}|${exp}`).digest('hex').slice(0, 32)}`
export function checkFt(ft, token) {
  const [t, id, exp, mac] = String(ft || '').split('|')
  if (t !== token || !(Number(exp) > Date.now())) return null
  const want = crypto.createHmac('sha256', SECRET).update(`${t}|${id}|${exp}`).digest('hex').slice(0, 32)
  if (typeof mac !== 'string' || mac.length !== 32) return null
  return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want)) ? id : null
}

/** the feed: last trades and open bags of the hidden account, accounts stripped */
export async function feed(token, ft) {
  const holder = checkFt(ft, token); if (!holder) throw err(401, 'unlock first')
  const k = (await chainKeys()).find((x) => x.token === token); if (!k) throw err(404, 'no key')
  const hidden = hiddenOf(k); if (!hidden) throw err(409, 'this key has no feed yet')
  if (!(await access(k, holder))) throw err(402, 'you no longer have the key')
  const t = await site(`/api/trader/${hidden}`, 10_000).catch(() => { throw err(503, 'the trade history is not available right now') })
  const trades = (t.recent || []).map((r) => ({ ts_ms: minute(r.ts_ms), token: r.token, symbol: r.symbol, name: r.name, icon: r.icon, side: r.side, usd: sig3(r.usd), tokens: sig3(r.tokens), mcap_usd: sig3(r.mcap_usd) }))
  const bags = (t.tokens || []).filter((p) => p.open > 0).map((p) => ({ token: p.token, symbol: p.symbol, open_usd: p.open_usd ?? p.open, pnl_usd: p.pnl_usd, roi: p.roi }))
  // an Agent API wallet behind the key: its own record of what it did on NEAR Intents (confidential swaps included), the
  // part no public explorer shows. This is what the viewing key unlocks.
  const agent_id = own(agentsTable().v, hidden)?.agent_id
  const ops = agent_id ? await intentsHistory(agent_id).catch(() => []) : []
  // shown as a trade list: the swaps only (policy and deposit ops are wallet housekeeping), assets by symbol with human amounts
  const intents = await Promise.all(ops.filter((o) => /swap/i.test(o.type)).map(async (o) => { const [a, b] = await Promise.all([assetOf(o.origin), assetOf(o.destination)]); const { id: _id, ...rest } = o; return { ...rest, ts_ms: minute(o.ts_ms), amount: sigRaw(o.amount), amount_out: sigRaw(o.amount_out), origin: a.symbol, destination: b.symbol, in: sig3(human(o.amount, a)), out: sig3(human(o.amount_out, b)) } }))   // round 12: rounded, no correlation id
  // its swaps on Rhea (the classic AMM and the DCL pools), launches of nearly.trade aside: those are in trades above
  const rhea = await Promise.all((await rheaSwaps(hidden).catch(() => [])).map(async (o) => { const [a, b] = await Promise.all([metaOf(o.token_in), metaOf(o.token_out)]); return { ...o, origin: a.symbol, destination: b.symbol, in: human(o.amount, a), out: human(o.amount_out, b) } }))
  // round 11: no exact totals or last-trade time in the feed (they matched the public stream); bags rounded
  return { trades, bags: bags.map((p) => ({ ...p, open_usd: sig3(Number(p.open_usd)), pnl_usd: sig3(Number(p.pnl_usd)), roi: sig3(Number(p.roi)) })), intents, rhea, confidential: !!agent_id }
}
/** mark-to-market PnL of a list of swaps in USD: each swap's output valued at today's price minus its input at today's price */
async function intentsPnl(swaps) {
  let sum = 0, any = false
  for (const o of swaps) {
    const [a, b] = await Promise.all([assetOf(o.origin), assetOf(o.destination)])
    if (!a.price || !b.price || o.amount == null || o.amount_out == null) continue
    const vin = Number(o.amount) / 10 ** a.decimals * a.price, vout = Number(o.amount_out) / 10 ** b.decimals * b.price
    // round 11: a swap whose rate is more than 30% off today's price ratio (a pool of the seller's own at a made-up rate) is left out
    if (!(vin > 0) || Math.abs(vout / vin - 1) > 0.3) continue
    sum += vout - vin; any = true
  }
  return any ? sum : null
}
/** an Intents asset id -> {symbol, decimals, price} from the public 1Click token list (cached an hour); unknown ids keep a short form of the id */
let assetCache = { at: 0, v: new Map() }
async function assetOf(id) {
  if (!id) return { symbol: '?', decimals: 0 }
  if (Date.now() - assetCache.at > 3600e3) { try { const r = await fetch('https://1click.chaindefuser.com/v0/tokens', { signal: AbortSignal.timeout(10_000) }).then((x) => x.json()); assetCache = { at: Date.now(), v: new Map(r.map((t) => [t.assetId, { symbol: t.symbol, decimals: t.decimals, price: Number(t.price) || 0 }])) } } catch { assetCache.at = Date.now() - 3000e3 } }
  const short = id.replace(/^nep141:/, ''); return assetCache.v.get(id) || { symbol: short.length > 20 ? `${short.slice(0, 6)}…${short.slice(-4)}` : short, decimals: 0 }
}
const human = (raw, a) => (raw == null || !a.decimals ? null : `${(Number(raw) / 10 ** a.decimals).toFixed(a.decimals >= 18 ? 3 : 2)} ${a.symbol}`)

/** a NEP-141 token -> {symbol, decimals, price}: the 1Click list first, else the token's own ft_metadata (no price) */
const metaCache = new Map()
async function metaOf(token) {
  const a = await assetOf(`nep141:${token}`); if (a.decimals) return a
  if (!metaCache.has(token)) metaCache.set(token, view(token, 'ft_metadata', {}).then((m) => ({ symbol: m.symbol || a.symbol, decimals: m.decimals || 0, price: 0 })).catch(() => a))
  return metaCache.get(token)
}

/** ---- Rhea: the hidden wallet's own swaps on Rhea Finance, read from FastNEAR's transaction index.
 *  The classic AMM logs "Swapped <in> <token> for <out> <token>"; the DCL pools emit a swap event that names the swapper. A route
 *  through several pools is one trade (first input, last output). Launches of nearly.trade are left out: the trade history has them.
 *  Each swap: {ts_ms, type: 'swap', status: 'SUCCESS', venue: 'rhea', origin, destination (nep141 ids), token_in, token_out, amount, amount_out, tx} */
const RHEA_V1 = 'v2.ref-finance.near', RHEA_DCL = 'dclv2.ref-labs.near', FX = 'https://tx.main.fastnear.com'
const FX_KEY = (process.env.NEAR_RPC || '').match(/apiKey=([^&]+)/)?.[1] || ''
const rheaCache = new Map()
const fx = (path, body) => fetch(FX + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(FX_KEY ? { authorization: `Bearer ${FX_KEY}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(12_000) }).then((r) => r.json())
export async function rheaSwaps(account) {
  const hit = rheaCache.get(account); if (hit && Date.now() - hit.at < 60_000) return hit.v
  const list = ((await fx('/v0/account', { account_id: account, limit: 200 })).account_txs || []).filter((t) => t.is_signer || t.is_any_signer || t.is_real_signer).slice(0, 120)   // 120 transactions, not 40
  const at = new Map(list.map((t) => [t.transaction_hash, Math.round(Number(t.tx_block_timestamp) / 1e6)]))
  const out = []
  for (let i = 0; i < list.length; i += 20) {
    const { transactions = [] } = await fx('/v0/transactions', { tx_hashes: list.slice(i, i + 20).map((t) => t.transaction_hash) })
    for (const tx of transactions) {
      const hash = tx.transaction?.hash, viaIntents = tx.transaction?.receiver_id === 'intents.near'
      const hops = []
      for (const r of tx.receipts || []) {
        const o = r.execution_outcome?.outcome || {}, ex = o.executor_id
        if (o.status && (o.status.Failure || o.status.failure)) continue
        for (const l of o.logs || []) {
          let m
          if (ex === RHEA_V1 && !viaIntents && (m = /^Swapped (\d+) (\S+) for (\d+) (\S+)/.exec(l))) hops.push({ tin: m[2], ain: m[1], tout: m[4], aout: m[3] })
          else if (ex === RHEA_DCL && l.startsWith('EVENT_JSON:')) {
            try { const e = JSON.parse(l.slice(11)); if (e.event === 'swap') for (const d of e.data || []) if (d.swapper === account) hops.push({ tin: d.token_in, ain: d.amount_in, tout: d.token_out, aout: d.amount_out }) } catch { /* not ours */ }
          }
        }
      }
      // consecutive hops of one route make one trade
      const trades = []
      for (const h of hops) { const last = trades.at(-1); if (last && last.tout === h.tin && last.aout === h.ain) Object.assign(last, { tout: h.tout, aout: h.aout }); else trades.push({ ...h }) }   // same token AND same amount, or it is another trade
      for (const t of trades) {
        if (/\.nearlytrade\.near$/.test(t.tin) || /\.nearlytrade\.near$/.test(t.tout)) continue
        out.push({ ts_ms: minute(at.get(hash)), type: 'swap', status: 'SUCCESS', venue: 'rhea', origin: `nep141:${t.tin}`, destination: `nep141:${t.tout}`, token_in: t.tin, token_out: t.tout, amount: sigRaw(t.ain), amount_out: sigRaw(t.aout) })   // no tx hash, it names the hidden account
      }
    }
  }
  out.sort((a, b) => (b.ts_ms || 0) - (a.ts_ms || 0))
  rheaCache.set(account, { at: Date.now(), v: out })
  return out
}

/** the wallet's Intents operations from the agents backend (it holds the grant), shaped for the feed, accounts stripped */
async function intentsHistory(agent_id) {
  const r = await fetch(`${process.env.AGENTS_BFF || 'http://127.0.0.1:8821/api/agents'}/${encodeURIComponent(agent_id)}/history?limit=50`, { signal: AbortSignal.timeout(10_000), headers: { ...(process.env.AGENTS_SERVER_KEY ? { 'x-agents-server': process.env.AGENTS_SERVER_KEY } : {}) } })
  const d = await r.json().catch(() => ({}))
  const items = d.items || d.operations || d.data || d.history || (Array.isArray(d) ? d : [])
  return items.map((o) => ({ ts_ms: Date.parse(o.created_at || o.updated_at || o.at || 0) || null, type: o.type || o.execution_type || o.kind || 'op', status: o.status || null, origin: o.details?.request?.origin_asset || o.details?.origin_asset || o.origin_asset || o.swap?.origin_asset || null, destination: o.details?.request?.destination_asset || o.details?.destination_asset || o.destination_asset || o.swap?.destination_asset || null, amount: o.details?.request?.amount || o.details?.amount || o.amount || o.swap?.amount || null, amount_out: o.details?.amount_out || o.amount_out || null, confidential: o.details?.confidential ?? o.confidential ?? null, id: o.correlation_id || o.id || null }))
}

// ---- live: one upstream socket to nearly.trade, trades of hidden accounts fan out to the key's subscribers
const subs = new Map()  // token -> Set<ws>
export async function subscribe(ws, token, ft) {
  if (!checkFt(ft, token)) { ws.close(4001, 'unlock first'); return }
  try { const k = (await chainKeys()).find((x) => x.token === token); if (!k || !(await access(k, checkFt(ft, token)))) { ws.close(4003, 'no key any more'); return } } catch { ws.close(1011, 'try again'); return }
  if (!subs.has(token)) subs.set(token, new Set())
  subs.get(token).add(ws); ws.on('close', () => subs.get(token)?.delete(ws))
  const exp = Number(String(ft).split('|')[2]); setTimeout(() => { try { ws.close(4002, 'unlock again') } catch {} }, Math.max(1000, exp - Date.now())).unref()
  // access is re-checked while the socket lives: sell the key token (or lose the key) and the live feed stops within 10 min
  const holder = checkFt(ft, token)
  const t = setInterval(async () => { try { const k = (await chainKeys()).find((x) => x.token === token); if (!k || !(await access(k, holder))) { clearInterval(t); ws.close(4003, 'no key any more') } } catch {} }, 10 * 60e3); t.unref(); ws.on('close', () => clearInterval(t))
  ws.send(JSON.stringify({ type: 'hello', key: token }))
}
async function refreshVerified() { try { const m = new Map(); for (const k of await chainKeys()) { const h = hiddenOf(k); if (h) m.set(k.token, h) } verified = m } catch {} }
/** agent-backed keys: the wallet's executed Intents swaps (confidential included) reach the key's subscribers and copiers too */
const seenOps = new Map()   // agent_id -> Set of correlation ids already sent
/** an operation's end states: until it reaches one it is looked at again next minute (a swap is PROCESSING for ~45 s) */
export const ENDED = new Set(['SUCCESS', 'FAILED', 'REFUSED', 'CANCELLED', 'EXPIRED'])
async function pollIntents() {
  for (const [token, hidden] of verified) {
    const agent_id = own(agentsTable().v, hidden)?.agent_id; if (!agent_id) continue
    const ops = await intentsHistory(agent_id).catch(() => [])
    const seen = seenOps.get(agent_id) || new Set(); const first = !seenOps.has(agent_id)
    for (const o of ops) {
      if (!o.id || seen.has(o.id)) continue
      // a swap shows up PROCESSING for ~45 s first: it is only marked seen once it ends, else it was never copied
      if (!ENDED.has(o.status)) continue
      seen.add(o.id)
      if (first || o.status !== 'SUCCESS' || !/swap/i.test(o.type)) continue   // the first pass only learns what is there
      const L = o.destination ? await launchOf(o.destination.replace(/^nep141:/, '')).catch(() => null) : null
      const out = JSON.stringify({ type: 'trade', key: token, ts_ms: o.ts_ms, token: o.destination, symbol: L?.symbol || (o.destination || '').replace(/^nep141:/, '').split('.')[0], icon: L?.icon, side: 'swap', usd: null, tokens: null, mcap_usd: null, intents: true, confidential: o.confidential })
      for (const c of subs.get(token) || []) { try { c.send(out) } catch {} }
      mirrorSwap(token, o).catch((e) => log('copy fail', e.message))   // copiers get every swap, confidential ones included
    }
    seenOps.set(agent_id, seen)
  }
}
export function startLive(url) {
  refreshVerified(); setInterval(refreshVerified, 30_000).unref()
  setInterval(() => pollIntents().catch(() => {}), 60_000).unref()
  const connect = () => {
    const up = new WebSocket(url)
    up.on('message', async (d) => {
      let f; try { f = JSON.parse(d.toString()) } catch { return }
      if (f.type !== 'trade') return
      const hid = hiddenSet(); const who = hid.has(f.trader) ? f.trader : hid.has(f.owner) ? f.owner : null
      if (!who) return
      const token = [...verified].find(([, h]) => h === who)?.[0]; if (!token) return
      const L = await launchOf(f.token), nu = await nearUsd().catch(() => 0)
      const usd = Number(f.near) / 1e24 * nu
      const out = JSON.stringify({ type: 'trade', key: token, ts_ms: minute(f.ts), token: f.token, symbol: L?.symbol, icon: L?.icon, side: f.side, usd: sig3(usd), tokens: sig3(Number(f.tokens) / 1e18), mcap_usd: sig3(f.price * nu * 1e9) })
      // held back one to three minutes, rounded, so a holder cannot match it to the public socket by arrival time
      setTimeout(() => { for (const c of subs.get(token) || []) { try { c.send(out) } catch {} } }, 60_000 + Math.floor(Math.random() * 120_000)).unref()
      mirror(token, f.side, f.token, usd).catch((e) => log('copy fail', e.message))
    })
    up.on('close', () => setTimeout(connect, 2000)); up.on('error', () => {})
  }
  connect()
}

// ---- copy: a key holder's agent mirrors the feed at a ratio, inside the agent's own rules
// the agent is a swarm agent of the holder or any Agent API wallet the holder made on the Agents page (its rules signed by
// the same account, its trading key granted). Each copy has a cap per trade on top of the wallet's own Agent API limits.
const BFF = process.env.AGENTS_BFF || 'http://127.0.0.1:8821/api/agents'
const bffGet = (p) => fetch(BFF + p, { signal: AbortSignal.timeout(10_000), headers: { ...(process.env.AGENTS_SERVER_KEY ? { 'x-agents-server': process.env.AGENTS_SERVER_KEY } : {}) } }).then((r) => r.json()).catch(() => null)
const agentIdOf = (c) => c.agent_id || own(agentsTable().v, c.agent)?.agent_id || null
export async function setCopy({ token, session, ft, agent, ratio_bps, max_usd }) {
  const me = await sitePost('/api/social/me', { session }); if (!me?.account) throw err(401, 'signed out')
  const holder = checkFt(ft, token); if (!holder || holder !== me.account) throw err(402, 'unlock the key with this wallet first')
  let agent_id, name
  const a = own(agentsTable().v, agent)
  if (a) { if (a.owner !== me.account) throw err(403, 'not your agent'); if (!a.agent_id) throw err(400, 'that agent has no Agent API wallet'); agent_id = a.agent_id; name = a.name }
  else {
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(String(agent))) throw err(400, 'bad agent')
    const s = await bffGet(`/${encodeURIComponent(agent)}`)
    if (!s || s.owner?.account_id !== me.account) throw err(403, 'that agent wallet is not yours')
    if (!s.grant) throw err(409, 'give the agent its trading key on the Agents page first')
    agent_id = agent; name = 'agent wallet'
  }
  const old = (own(copies.v, token) || []).find((c) => agentIdOf(c) === agent_id)
  const list = (own(copies.v, token) || []).filter((c) => c !== old)
  const cap = Number(max_usd) > 0 ? Math.min(1000, Number(max_usd)) : a?.daily_usd || 10
  if (Number(ratio_bps) > 0) list.push({ agent, agent_id, name, ratio_bps: Math.min(10_000, Math.max(100, Number(ratio_bps))), max_usd: cap, owner: me.account, holder, since: old?.since || Date.now(), n: old?.n || 0, last: old?.last || [] })
  copies.v[token] = list; copies.save()
  return { copies: list.length }
}
/** the holder's own copies of this key: the agent, the ratio, the cap, the last 10 results */
export function myCopies(token, ft) {
  const holder = checkFt(ft, token); if (!holder) throw err(401, 'unlock first')
  return (own(copies.v, token) || []).filter((c) => (c.holder || c.owner) === holder).map((c) => ({ agent: c.agent, name: c.name, ratio_bps: c.ratio_bps, max_usd: c.max_usd, since: c.since, n: c.n || 0, last: c.last || [] }))
}
const lastCopy = new Map()
const MIN_COPY_USD = 1, COPY_GAP_MS = 60_000
async function mirror(token, side, traded, usd) {
  if (traded === token) return   // never mirror a trade in the key's own token: the cheapest way to sell into copiers
  const k = (await chainKeys()).find((x) => x.token === token); if (!k) { log('copy skip (keys unreadable)', token); return }
  const L = await launchOf(traded)
  if (!L || L.creator === k?.owner) { log('copy skip (the key owner launched it)', traded); return }   // nor any coin the seller launched
  if (Number(L.liquidity_near || 0) * (await nearUsd().catch(() => 0)) < 2000 || (L.age_ms || 0) < 6 * 3600e3) { log('copy skip (thin or new)', L.symbol); return }   // copiers are not exit liquidity for a fresh thin coin
  return copyAll(k, { side, token: traded, quote: 'near', price_usd: L.price_usd }, usd, `${side} ${L.symbol}`)
}
// a confidential swap behind the key: into NEAR or USDC it is a sell of what went in, out of NEAR or USDC a buy of what came out.
// Sized from the USD value of what went in; a launch goes through mirror() and its guards.
const WNEAR_ID = 'nep141:wrap.near', USDC_ID = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1'
export const swapOrder = (o) => {
  const q = (id) => (id === USDC_ID ? 'usdc' : id === WNEAR_ID ? 'near' : null)
  return q(o.destination) ? { side: 'sell', asset: o.origin, quote: q(o.destination) } : q(o.origin) ? { side: 'buy', asset: o.destination, quote: q(o.origin) } : null
}
async function mirrorSwap(token, o) {
  const a = await assetOf(o.origin)
  const usd = a.price && a.decimals && o.amount != null ? Number(o.amount) / 10 ** a.decimals * a.price : 0
  const order = swapOrder(o)
  if (!order) { log('copy skip (no NEAR or USDC leg)', token); return }
  if (/\.nearlytrade\.near$/.test(order.asset)) return mirror(token, order.side, order.asset.replace(/^nep141:/, ''), usd)
  const k = (await chainKeys()).find((x) => x.token === token); if (!k) return
  return copyAll(k, { side: order.side, token: order.asset, quote: order.quote }, usd, `${order.side} ${(await assetOf(order.asset)).symbol}`)
}
/** one trade to every copier of the key: ratio, $1 floor, 1 a minute, the copy's own cap, then the wallet's Agent API rules decide */
export async function copyAll(k, trade, usd, label) {
  const list = own(copies.v, k.token) || []; if (!list.length) return
  for (const c of list) {
    const agent_id = agentIdOf(c); if (!agent_id) continue
    const size = Math.min(usd * c.ratio_bps / 10_000, c.max_usd || Infinity)
    if (size < MIN_COPY_USD) { copied(c, label, size, 'skipped: under $1'); continue }
    if (Date.now() - (lastCopy.get(agent_id) || 0) < COPY_GAP_MS) { copied(c, label, size, 'skipped: 1 copy a minute'); continue }
    if (!(await access(k, c.holder || c.owner))) { copied(c, label, size, 'skipped: no key any more'); continue }
    lastCopy.set(agent_id, Date.now())
    // a launch sells in tokens on our pool: the copy's dollars at the launch price
    const { price_usd, ...t } = trade
    const body = t.side === 'sell' && price_usd > 0 ? { ...t, tokens: size / price_usd } : { ...t, usd: size }
    const r = await bffTrade(agent_id, body).catch((e) => ({ error: e.message }))
    copied(c, label, size, r?.error ? `refused: ${r.message || r.error}` : `done${r?.status ? ` (${String(r.status).toLowerCase()})` : ''}`)
  }
  copies.save()
}
const copied = (c, trade, usd, result) => { if (result.startsWith('done')) c.n = (c.n || 0) + 1; c.last = [{ t: Date.now(), trade, usd: Math.round(usd * 100) / 100, result }, ...(c.last || [])].slice(0, 10); log('copy', agentIdOf(c), trade, result) }
export const copiesOf = (token) => (own(copies.v, token) || []).length
/** the public record of copy trading: how many copies went through, how many agents copy, the day of the last one. Never a
 *  size, a side, an asset or a time: a copy mirrors a confidential trade, and those would point back at it */
export function copyStats() {
  let done = 0, copiers = 0, last = 0
  for (const list of Object.values(copies.v)) for (const c of list) { copiers++; done += c.n || 0; for (const l of c.last || []) if (String(l.result).startsWith('done')) last = Math.max(last, l.t || 0) }
  return { copies_done: done, copiers, last_day: last ? new Date(last).toISOString().slice(0, 10) : null }
}
