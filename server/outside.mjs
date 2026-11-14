// outside users: every account that signed something on the contract, read from FastNEAR's tx index the way trades.mjs reads
// trades, less the team's own accounts (team.json) and every agent the team owns (read from the contract). A row keeps its tx hash,
// so anyone re-checks it on chain without trusting this server (npm run outside). A swarm agent's own transaction counts for its owner.
import fs from 'node:fs'
import { table, log } from './store.mjs'
import { view, RPC, CONTRACT, WRAP } from './near.mjs'

const FX = 'https://tx.main.fastnear.com'
const KEY = RPC.match(/apiKey=([^&]+)/)?.[1] || ''
const GAP = 400, KEEP = 50_000
const TEAM_FILE = new URL('./team.json', import.meta.url)   // the team list is not in this repo (the live server holds it; GET /api/outside returns it as team): without the file every account counts
export const TEAM = fs.existsSync(TEAM_FILE) ? JSON.parse(fs.readFileSync(TEAM_FILE, 'utf8')) : { rule: 'no team list in this tree: every account counts', who: '', accounts: [] }
const rows = table('outside', {})   // tx hash -> the contract call it made (or null: nothing on the contract succeeded)
const scan = table('outsidescan', { done: false, resume: null, mark: 0, seen: {} })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const json = (s) => { try { return JSON.parse(s) } catch { return null } }
const b64 = (s) => Buffer.from(s || '', 'base64').toString()

// what each call is, by product; anything else is "other" and not counted
const PRODUCT = {
  wiki: ['Buy', 'BuyFor', 'Create', 'Hire', 'FundDesk', 'FundWiki', 'sell', 'dispute', 'finalize', 'redeem', 'redeem_for', 'claim_owed', 'claim_owed_for', 'void_market', 'close_desk', 'set_desk', 'propose', 'propose_panel'],
  keys: ['register_key', 'buy_key', 'set_price', 'set_min_hold', 'reveal_key', 'withdraw_key_fees'],
  swarm: ['post_job', 'join_swarm', 'fund_agent', 'set_brain', 'cancel_job', 'approve_job', 'reject_job', 'claim_job', 'claim_agent', 'withdraw_agent', 'set_daily_cap', 'accept_job', 'submit_job', 'release_stake'],
}
export const productOf = (method) => Object.keys(PRODUCT).find((p) => PRODUCT[p].includes(method)) || 'other'

/** the contract call a transaction made (pure: tests feed it recorded transactions). A deposit through wrap.near is named by its
 *  message (Buy, Create, Hire, …); a buy paid from another chain counts for the owner it names, not for the 1Click relay */
export function callOf(t, contract = CONTRACT) {
  const tx = t?.transaction?.hash, signer = t?.transaction?.signer_id
  for (const r of t?.receipts || []) {
    const rc = r.receipt, eo = r.execution_outcome, st = eo?.outcome?.status || {}
    if (rc?.receiver_id !== contract || typeof st !== 'object' || !('SuccessValue' in st || 'SuccessReceiptId' in st)) continue
    const call = (rc.receipt?.Action?.actions || []).map((a) => a.FunctionCall).filter(Boolean)[0]
    if (!call) continue
    let method = call.method_name, account = signer
    if (method === 'ft_on_transfer') {
      if (rc.predecessor_id !== WRAP) continue
      const args = json(b64(call.args)) || {}, msg = json(args.msg)
      method = typeof msg === 'string' ? msg : msg && typeof msg === 'object' ? Object.keys(msg)[0] : 'deposit'
      account = msg?.BuyFor?.owner || args.sender_id || signer
    }
    return { tx, at: Math.round(Number(eo.block_timestamp) / 1e6), signer, account: String(account), method, product: productOf(method), credited: String(account) !== signer }   // credited: named by someone else's call (a BuyFor owner), not self-signed
  }
  return null
}

/** the outside accounts in these rows (pure): the team and the agents it owns are left out; an agent counts for its owner */
export function summarize(list, team, since) {
  const by = new Map(), per = { wiki: new Set(), keys: new Set(), swarm: new Set() }, credited = new Map()
  let actions = 0
  for (const r of [...list].sort((a, b) => a.at - b.at)) {
    if (!r || r.product === 'other') continue
    const acct = team.ownerOf.get(r.account) || r.account
    if (team.accounts.has(acct)) continue
    if (r.credited && !by.has(acct)) { credited.set(acct, (credited.get(acct) || 0) + 1); continue }   // an owner another account named is a user once it signs for itself (0.01 wNEAR could name anyone)
    credited.delete(acct)   // it signed for itself: a user, not a credited name
    const a = by.get(acct) || { account: acct, products: [], actions: 0, first: { tx: r.tx, at: r.at, method: r.method, signer: r.signer }, last: null }
    if (!a.products.includes(r.product)) a.products.push(r.product)
    a.actions++; actions++
    a.last = { tx: r.tx, at: r.at, method: r.method, signer: r.signer }
    by.set(acct, a); per[r.product].add(acct)
  }
  const accounts = [...by.values()]
  return { accounts: accounts.length, actions, by_product: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, v.size])), since: since ? new Date(since).toISOString() : null, new_since: since ? accounts.filter((a) => a.first.at >= since).length : null, list: accounts, credited_only: [...credited].map(([account, n]) => ({ account, actions: n })) }
}

// ---- the team: team.json, plus every swarm agent a team account owns (refreshed each round)
let team = { accounts: new Set(TEAM.accounts), ownerOf: new Map() }
async function refreshTeam() {
  const agents = []
  for (let from = 0; ; from += 100) { const page = await view(CONTRACT, 'get_agents', { from, limit: 100 }); agents.push(...page); if (page.length < 100) break }
  const accounts = new Set(TEAM.accounts), ownerOf = new Map()
  for (const a of agents) { if (accounts.has(a.owner)) accounts.add(a.account); else ownerOf.set(a.account, a.owner) }
  team = { accounts, ownerOf }
}

// ---- the walk: the same index and paging as trades.mjs, slower
async function fx(path, body) {
  await sleep(GAP)
  const r = await fetch(FX + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(KEY ? { authorization: `Bearer ${KEY}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) })
  if (!r.ok) throw new Error(`tx index ${r.status} ${path}`)
  return r.json()
}
const page = (token) => fx('/v0/account', { account_id: CONTRACT, ...(token ? { resume_token: token } : {}) })
const young = (e) => Date.now() - Number(e.tx_block_timestamp) / 1e6 < 60e3
async function take(entries) {
  let n = 0
  for (let i = 0; i < entries.length; i += 20) {
    const part = entries.slice(i, i + 20)
    const { transactions = [] } = await fx('/v0/transactions', { tx_hashes: part.map((e) => e.transaction_hash) })
    const got = new Map(transactions.map((t) => [t.transaction?.hash, t]))
    for (const e of part) {
      const t = got.get(e.transaction_hash)
      if (!t) continue   // not served this time: asked again next round
      rows.v[e.transaction_hash] = callOf(t); scan.v.seen[e.transaction_hash] = e.tx_block_height; n++
    }
  }
  return n
}
async function backfill() {
  let token = scan.v.resume
  for (;;) {
    const p = await page(token), list = p.account_txs || []
    if (!token && !scan.v.mark) scan.v.mark = list[0]?.tx_block_height || 0
    await take(list.filter((e) => !(e.transaction_hash in rows.v) && !young(e)))
    token = p.resume_token || null; scan.v.resume = token; if (!token || !list.length) scan.v.done = true
    rows.save(); scan.save()
    if (scan.v.done) break
  }
  log('outside: backfilled', Object.keys(rows.v).length, 'txs')
}
async function catchUp() {
  let token = null, top = 0
  for (;;) {
    const p = await page(token), list = p.account_txs || []
    top = Math.max(top, list[0]?.tx_block_height || 0)
    const floor = scan.v.mark - 1000
    await take(list.filter((e) => e.tx_block_height >= floor && !(e.transaction_hash in rows.v) && !young(e)))
    token = p.resume_token || null
    if (!token || !list.length || list[list.length - 1].tx_block_height < floor) break
  }
  scan.v.mark = Math.max(scan.v.mark, top)
  for (const [h, b] of Object.entries(scan.v.seen)) if (b < scan.v.mark - KEEP) delete scan.v.seen[h]
  rows.save(); scan.save()
}
export async function poll() {
  await refreshTeam().catch((e) => log('outside: team read failed, last list kept:', e.message.slice(0, 80)))
  if (!scan.v.done) await backfill()
  await catchUp()
}

// ---- what the API serves
// the users the owner brings arrive on Nov 13 and 14: what came after this is shown as new
export const SINCE = Date.parse(process.env.OUTSIDE_SINCE || '2026-11-13T00:00:00Z')
export function summary(q = {}) {
  const since = q.since ? Date.parse(q.since) : SINCE
  const s = summarize(Object.values(rows.v).filter(Boolean), team, Number.isFinite(since) ? since : SINCE)
  return { ...s, complete: !!scan.v.done, txs_read: Object.keys(rows.v).length, team: TEAM.accounts, team_rule: TEAM.rule, check: 'npm run outside (re-checks every account\'s first transaction on chain)' }
}
export function ofAccount(account) {
  const owned = [...team.ownerOf].filter(([, o]) => o === account).map(([a]) => a)
  return Object.values(rows.v).filter((r) => r && (r.account === account || owned.includes(r.account)) && r.product !== 'other').sort((a, b) => a.at - b.at)
}
