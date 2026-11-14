// Nearly Estate server: keys + feed, markets + resolver, swarm + jobs, wiki pages, checkout widget. One process, one port.
import http from 'node:http'
import fs from 'node:fs'
import { WebSocketServer } from 'ws'
import { log, nearUsd, sitePost, table } from './store.mjs'
import { signer, CONTRACT, view } from './near.mjs'
import * as ai from './ai.mjs'
import * as keys from './keys.mjs'
import * as redteam from './redteam.mjs'
import * as markets from './markets.mjs'
import * as swarm from './swarm.mjs'
import * as wiki from './wiki.mjs'
import * as ask from './ask.mjs'
import * as desk from './desk.mjs'
import * as chain from './chain.mjs'
import * as trades from './trades.mjs'
import * as outside from './outside.mjs'
import * as picks from './picks.mjs'
import * as hire from './hire.mjs'

const PORT = Number(process.env.PORT || 8830)
const ORIGIN = process.env.ORIGIN || '*'
const ADMIN = process.env.ADMIN_TOKEN || ''   // force rewrites and other paid admin calls need this header
const operator = process.env.OPERATOR_KEY && fs.existsSync(process.env.OPERATOR_KEY) ? signer(process.env.OPERATOR_KEY) : null
const defender = process.env.DEFENDER_KEY && fs.existsSync(process.env.DEFENDER_KEY) ? signer(process.env.DEFENDER_KEY) : null   // counters challenges against the judges (markets.defendDue)
const WIDGET = new URL('../widget/', import.meta.url).pathname

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': ORIGIN, 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) }
const body = (req) => new Promise((ok, no) => { let s = ''; const max = isAdmin(req) ? 4e6 : 64e3; req.on('data', (c) => { s += c; if (s.length > max) { req.destroy(); no(Object.assign(new Error('body too big'), { status: 413 })) } }); req.on('end', () => { try { ok(s ? JSON.parse(s) : {}) } catch { no(Object.assign(new Error('bad json'), { status: 400 })) } }) })
const isAdmin = (req) => ADMIN && req.headers['x-admin'] === ADMIN
/** the dstack guest agent speaks HTTP over a unix socket inside a Phala CVM; outside one, these routes say so */
const DSTACK = process.env.DSTACK_SOCK || '/var/run/dstack.sock'
function dstack(path, body) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(DSTACK)) return reject(Object.assign(new Error('not inside a confidential VM'), { status: 404 }))
    const req = http.request({ socketPath: DSTACK, path, method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' } }, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)) } catch { reject(Object.assign(new Error('guest agent: ' + d.slice(0, 120)), { status: 502 })) } }) })
    req.on('error', (e) => reject(Object.assign(new Error('guest agent: ' + e.message), { status: 502 }))); req.end(body ? JSON.stringify(body) : undefined)
  })
}
/** the quote binds the caller's nonce (up to 32 bytes hex, zero padded to 64) into report_data, so a reply cannot be replayed */
async function attestation(nonce) {
  const n = String(nonce || '').toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 64)
  const q = await dstack('/GetQuote', { report_data: n.padEnd(128, '0') })
  return { nonce: n, ...q, info: await dstack('/Info').catch(() => null) }
}
/** the move into an enclave: the tables come in once, whole, from the server that held them; the in-memory copy is replaced too */
const IMPORTABLE = ['keys', 'agents', 'pages', 'resolutions', 'reviews', 'settled']
function importTables(tables) {
  const done = {}
  for (const [name, v] of Object.entries(tables)) { if (!IMPORTABLE.includes(name) || v == null || typeof v !== 'object') continue; const t = table(name); t.v = v; t.save(); done[name] = Object.keys(v).length }
  log('admin import', JSON.stringify(done)); return { ok: true, imported: done }
}
// who is asking: a nearly.trade session token proves the account; a bare account name proves nothing and gets nothing private
const viewerOf = async (q) => (q.session ? (await sitePost('/api/social/me', { session: q.session }).catch(() => null))?.account || null : null)
const file = (res, name, type) => { const p = WIDGET + name; if (!fs.existsSync(p)) return json(res, 404, { error: 'not_found' }); res.writeHead(200, { 'content-type': type, 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=60' }); res.end(fs.readFileSync(p)) }

import { clientIp } from './ip.mjs'
import { perIp, err, marketId } from './limits.mjs'
const routes = {
  // nearly.trade's own /api/health shadows this server's on the live site: the same answer lives at /api/keys-health too
  'GET /api/keys-health': async () => routes['GET /api/health'](),
  'GET /api/health': async () => ({ ok: true, uptime_s: Math.round(process.uptime()), rss_mb: Math.round(process.memoryUsage().rss / 1048576), contract: CONTRACT, operator: operator?.accountId || null, defender: defender?.accountId || null, ai: ai.live() ? { pages: wiki.WRITER, private: ai.PRIVATE, private_verified: ai.isHosted(ai.PRIVATE), prices_usd_per_m: { pages: await ai.pricing(wiki.WRITER), private: await ai.pricing(ai.PRIVATE) } } : 'stub', config: await view(CONTRACT, 'get_config').catch(() => null), trades: trades.state() }),
  // keys
  'GET /api/keys': () => keys.list(),
  'GET /api/keys-copies': () => keys.copyStats(),   // counts only: see copyStats
  'POST /api/keys-redteam': (p, b) => redteam.attack(b),   // /agents: a typed attack on the demo agent (see redteam.mjs)
  'GET /api/keys-redteam': () => redteam.stats(),   // how many typed attacks were tried, refused, only quoted
  'GET /api/keys/:token': (p) => keys.one(p.token),
  'POST /api/keys/prepare': (p, b) => keys.prepare(b),
  'POST /api/keys/:token/pause': (p, b) => keys.pause({ token: p.token, ...b }),   // the seller pauses or resumes the listing
  'POST /api/keys/:token/challenge': (p, b, req) => { perIp('challenge', clientIp(req), 20); return keys.challenge({ token: p.token, address: b.address }) },
  'POST /api/keys/:token/unlock': (p, b) => keys.unlock({ token: p.token, ...b }),
  'GET /api/keys/:token/feed': (p, q) => keys.feed(p.token, q.ft),
  'POST /api/keys/:token/copy': (p, b) => keys.setCopy({ token: p.token, ...b }),
  'GET /api/keys/:token/copy': (p, q) => keys.myCopies(p.token, q.ft),
  // markets
  'GET /api/markets': () => markets.list(),
  'GET /api/markets/watch': async () => markets.watch(),   // proposals by anyone but the relay that our judge does not share (before :id: first match wins)
  'GET /api/markets/defender': () => markets.defenderInfo(),   // the wallet that counters challenges against the judges' view: caps, balance, every counter
  'GET /api/markets/:id': (p) => markets.one(marketId(p.id)),
  'GET /api/markets/:id/quote': (p, q) => { if (!/^\d{1,40}$/.test(String(q.shares ?? q.amount ?? ''))) throw err(400, 'amount or shares: a whole number of yocto'); return (q.shares ? markets.quoteSell(marketId(p.id), q.yes === 'true', q.shares) : markets.quoteBuy(marketId(p.id), q.yes === 'true', q.amount, /^[a-z0-9._-]{2,64}$/.test(String(q.account || '')) ? q.account : null)) },   // round 11: a first position's storage is in the quote; round 12: validated
  'GET /api/markets/:id/position/:account': (p) => markets.position(marketId(p.id), p.account),
  'GET /api/markets/of/:token': (p) => markets.ofToken(p.token),
  'GET /api/markets/:id/receipt': (p) => markets.receiptOf(marketId(p.id)),   // the AI judge's signed receipt: bytes, signature, attestation
  'POST /api/markets/:id/rule': (p, b, req) => { perIp('rule', clientIp(req), 6); return markets.rule(marketId(p.id), { dry: String(b?.dry) === '1' || b?.dry === true }) },   // 6 rulings asked a day per address, dry or not   // a perpetual claim: ask the judge now (once per 6 h); body {"dry":1} = the signed answer only, propose it yourself with a bond
  // the private model's attestation as the SDK verified it (gateway + model: TDX quote, GPU evidence, TCB)
  'GET /api/ai/attestation': () => ai.attestation(),
  // swarm
  'GET /api/swarm': async (p, q) => swarm.list(await viewerOf(q)),   // a signed-in viewer sees its own workers' owner + trade log
  'POST /api/swarm/register': (p, b) => swarm.register(b),
  'GET /api/attestation': (p, b) => attestation(b.nonce),   // inside a dstack CVM: a TDX quote with the caller's nonce in report_data, plus the event log and app compose
  'GET /api/attestation/info': () => dstack('/Info'),
  'GET /api/swarm/:account/log': async (p, q) => swarm.logOf(p.account, await viewerOf(q)),
  'GET /api/swarm/review/:job': (p) => swarm.reviewReceipt(p.job) || (() => { throw Object.assign(new Error('no verified review for this job'), { status: 404 }) })(),   // the reviewer's signed receipt; its sha256 is on chain
  'POST /api/swarm/hash': (p, b) => ({ prompt_hash: swarm.promptHash(b) }),   // sha256 of the whole brain: prompt + knowledge base + tools
  // wiki: any topic, every claim a market
  'GET /api/wiki': () => wiki.cached(),
  'GET /api/wiki/home': () => wiki.home(),
  'GET /api/wiki/search': (p, q) => wiki.search(q.q),
  'GET /api/wiki/claims': () => wiki.claimsFeed(),   // for agents: every open claim, its price, page, sources, and how to trade it
  'GET /api/wiki/desk': () => ({ agents: desk.agents(), recent: desk.recent(60).filter((x) => !wiki.HIDDEN_MARKETS.has(String(x.market))).slice(0, 40) }),   // markets the site hides are not in the feed
  // trades, read from the chain (trades.mjs): the latest on every claim, and what an account holds (before :token, first match wins)
  'GET /api/wiki/trades': (p, q) => trades.recent(q.limit),
  'GET /api/wiki/portfolio/:account': (p, q) => trades.portfolio(p.account, q.recent),   // ?recent=333,98: markets just traded, read from the contract at once
  // outside users (outside.mjs): every account not the team's that signed something on the contract, each with its first tx; npm run outside re-checks them
  'GET /api/outside': (p, q) => outside.summary(q),
  'GET /api/outside/:account': (p) => outside.ofAccount(p.account),
  'GET /api/users': (p, q) => outside.summary(q),   // the same, under the name the pages use (the pages say users)
  'GET /api/users/:account': (p) => outside.ofAccount(p.account),
  'GET /api/wiki/hire': () => hire.list(),   // hired desks: every desk, newest first, with its latest views and trades
  'GET /api/wiki/hire/of/:owner': (p) => hire.of(p.owner),
  'GET /api/wiki/hire/:desk/receipt/:market': (p) => hire.receiptOf(p.desk, p.market),   // the signed receipt of a desk's view
  'POST /api/wiki/new': (p, b, req) => { if (!isAdmin(req)) perIp('new', clientIp(req), 3); return wiki.create(b.q, { admin: isAdmin(req) }) },   // 3 new topics a day per address   // a phrase or a Wikipedia link: the page, written from the article (living people refused)
  'GET /api/wiki/claim/:id/trades': (p) => trades.ofClaim(marketId(p.id)),   // every trade on the claim, its volume, its opening price, its holders
  'GET /api/wiki/claim/:id': (p) => wiki.claim(marketId(p.id)).then((c) => ({ ...c, ask: ask.ofMarket(marketId(p.id)) })),   // plus the question it was asked as, if any
  'POST /api/wiki/ask': (p, b, req) => { perIp('ask', clientIp(req), 20); return ask.ask(b.q, clientIp(req)) },   // 20 questions a day per address   // ask anything: an answer, its sources, a market to bet against (see ask.mjs)
  // free picks (picks.mjs): true or false on an open market with no wallet, scored against the judges' ruling (before :token: first match wins)
  'POST /api/wiki/picks': (p, b, req) => picks.pick(b, clientIp(req)),
  'GET /api/wiki/picks': (p, q) => picks.read(q),
  'GET /api/wiki/asks': () => ({ recent: ask.recent(12) }),
  'POST /api/wiki/claim/:id/evidence': async (p, b) => wiki.addEvidence(marketId(p.id), await viewerOf(b), b),   // a signed-in reader posts a source for YES or NO
  'POST /api/wiki/claim/:id/anychain': (p, b, req) => wiki.anychainBuyer(marketId(p.id), b.owner, clientIp(req)),   // 5 new owners a day per address // a buyer paying from another chain: their winnings are paid into their Intents account
  'GET /api/wiki/claim/:id/desk/:agent': (p) => desk.receiptOf(marketId(p.id), p.agent),   // the signed receipt of an agent's view
  'GET /api/wiki/:token/receipt': (p) => wiki.receipt(p.token),   // the current version's signed receipt
  'GET /api/wiki/:token/history': (p) => wiki.history(p.token),
  'GET /api/wiki/:token': (p, q, req) => wiki.page(p.token, { force: q.force === '1' && isAdmin(req) }),
  // checkout widget helpers
  'GET /api/checkout/near-usd': async () => ({ near_usd: await nearUsd() }),
  // a USDC payment to a NEAR account that never registered with the token would bounce and refund the payer; the box asks first
  'GET /api/checkout/registered': async (p, q, rq) => { perIp('registered', clientIp(rq), 300); const a = String(q.account || '').toLowerCase(), t = String(q.token || ''); if (!/^[a-z0-9._-]{2,64}$/.test(a) || !/^[a-z0-9._-]{2,64}$/.test(t)) throw err(400, 'account and token'); const r = await view(t, 'storage_balance_of', { account_id: a }).catch(() => undefined); return { account: a, token: t, registered: r === undefined ? null : !!r } },
  // a merchant's server asks here, not the buyer's browser: the status straight from 1Click
  // the merchant's server asks with what it expects (recipient, asset, min_out): "SUCCESS" alone proves nothing, a buyer can quote to himself
  'GET /api/checkout/verify': async (p, q, rq) => {
    perIp('verify', clientIp(rq), 300)   // a loop could get the enclave rate-limited at 1Click
    if (!/^[A-Za-z0-9]{20,80}$/.test(String(q.deposit || ''))) throw Object.assign(new Error('deposit address?'), { status: 400 })
    const r = await fetch(`https://1click.chaindefuser.com/v0/status?depositAddress=${encodeURIComponent(q.deposit)}${q.memo ? `&depositMemo=${encodeURIComponent(q.memo)}` : ''}`, { signal: AbortSignal.timeout(15_000) })
    const d = await r.json().catch(() => ({}))
    const req = d.quoteResponse?.quoteRequest || {}, out = d.swapDetails?.amountOut || null
    if (!q.recipient || !q.asset || !q.min_out) throw Object.assign(new Error('recipient, asset and min_out are required: say what you expect, the record is checked against it'), { status: 400 })
    const checks = { recipient: req.recipient === q.recipient, asset: req.destinationAsset === q.asset, amount: !!out && BigInt(out) >= BigInt(q.min_out), swap_type: (req.swapType || 'EXACT_OUTPUT') === 'EXACT_OUTPUT', settled_to_recipient: (req.recipientType || 'DESTINATION_CHAIN') === 'DESTINATION_CHAIN' }
    const paid = d.status === 'SUCCESS' && Object.values(checks).every(Boolean)
    // a merchant keeps the deposit addresses it has already honoured: one payment, one order
    return { status: d.status || 'UNKNOWN', paid, checks, deposit: q.deposit, recipient: req.recipient || null, asset: req.destinationAsset || null, amount_out: out, amount_out_formatted: d.swapDetails?.amountOutFormatted || null, tx: d.swapDetails?.destinationChainTxHashes?.[0]?.hash || d.swapDetails?.nearTxHashes?.[0] || null, updated: d.updatedAt || null, note: 'store the deposit address once honoured; this record can be asked for again' }
  },
}
function match(method, path) {
  for (const [k, fn] of Object.entries(routes)) {
    const [m, pat] = k.split(' '); if (m !== method) continue
    const a = pat.split('/'), b = path.split('/'); if (a.length !== b.length) continue
    const params = {}; let ok = true
    for (let i = 0; i < a.length; i++) { if (a[i].startsWith(':')) { try { params[a[i].slice(1)] = decodeURIComponent(b[i]) } catch { ok = false; break } } else if (a[i] !== b[i]) { ok = false; break } }
    if (ok) return { fn, params }
  }
  return null
}
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': ORIGIN, 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST' }); return res.end() }
    const u = new URL(req.url, 'http://x')
    if (u.pathname === '/widget/nearly-checkout.js') return file(res, 'nearly-checkout.js', 'application/javascript')
    if (u.pathname === '/widget/' || u.pathname === '/widget/demo.html') return file(res, 'demo.html', 'text/html')
    if (u.pathname === '/widget/claim.js') return file(res, 'claim.js', 'application/javascript')   // a wiki claim's live odds on any page
    const hit = match(req.method, u.pathname.replace(/\/$/, '')); if (!hit) return json(res, 404, { error: 'not_found' })
    const b = req.method === 'POST' ? await body(req) : Object.fromEntries(u.searchParams)
    json(res, 200, await hit.fn(hit.params, b, req))
  } catch (e) {
    // only our own errors carry a status and a message meant for the client; anything else stays in the log (RPC urls carry keys)
    log('fail', req.method, req.url, e.message)
    json(res, e.status || 500, { error: e.status ? e.message : 'something went wrong' })
  }
})
// live feed: ws://host/api/keys/:token/live?ft=<feed token>
const wss = new WebSocketServer({ noServer: true })
server.on('upgrade', (req, socket, head) => {
  try {
    const u = new URL(req.url, 'http://x'), m = /^\/api\/keys\/([^/]+)\/live$/.exec(u.pathname)
    if (!m) return socket.destroy()
    const token = decodeURIComponent(m[1])
    wss.handleUpgrade(req, socket, head, (ws) => { try { keys.subscribe(ws, token, u.searchParams.get('ft')) } catch (e) { log('ws fail', e.message); try { ws.close(1011) } catch {} } })
  } catch (e) { log('upgrade fail', e.message); try { socket.destroy() } catch {} }
})
process.on('uncaughtException', (e) => log('uncaught', e.message))
process.on('unhandledRejection', (e) => log('unhandled', e?.message || e))

server.listen(PORT, '127.0.0.1', () => log(`nearly-estate on :${PORT} contract ${CONTRACT} operator ${operator?.accountId || 'none'} ai ${ai.live() ? ai.MODEL : 'stub'}`))
markets.setResolver(operator)
markets.setFirstTrade((id) => { const l = trades.ofMarket(id); return l.length ? Math.min(...l.map((t) => t.at)) : null })   // auto ruling: 72 h after the first trade
setTimeout(() => markets.backfillOnChain().catch(() => {}), 20e3)   // how many signatures each older ruling holds on chain, read once
const deskQueue = async () => (await wiki.deskQueue()).filter((m) => !wiki.HIDDEN_MARKETS.has(String(m.id ?? m.market)))   // a hidden market (a twin, junk) gets no agent views
markets.setDefender(defender)
wiki.setOperator(operator)
ask.setOperator(operator)
wiki.setDesk({ of: desk.of, recent: desk.recent, agents: desk.agents })
trades.setLinks({ page: wiki.pageOf, hidden: wiki.isHidden, desk: { agents: desk.agents, of: desk.of, tradeTxs: desk.tradeTxs, mixed: desk.mixed }, hire: { name: hire.nameOf } })
markets.setWiki({ label: wiki.pageOf, evidence: wiki.judgeEvidence })
keys.startLive(keys.SITE_WS)
// one run at a time per loop: a slow round never overlaps the next
const every = (ms, fn) => { let busy = false; const run = async () => { if (busy) return; busy = true; try { await fn() } catch (e) { log('loop fail', e.message) } finally { busy = false } }; setTimeout(run, 5000); setInterval(run, ms) }
every(60e3, () => markets.resolveDue(operator))      // a market past its date is judged within a minute
every(10 * 60e3, () => markets.finalizeDue(operator))
every(10 * 60e3, () => markets.arbitrateDue())         // a challenged market gets the judges' final look
every(5 * 60e3, () => markets.defendDue())            // a challenge leading against the judges is countered within 5 min, inside the caps
every(5 * 60e3, () => swarm.tick(operator))
every(10 * 60e3, () => wiki.snapshot())
every(20 * 60e3, () => wiki.imagesDue())              // a first picture for the topic pages that have none
every(10 * 60e3, () => wiki.payoutsDue())
every(15 * 60e3, () => wiki.stancesDue())             // what each claim's Wikipedia article says, quoted             // winnings of buyers from other chains, into their Intents accounts             // price points for the 24h change and the charts
every(10 * 60e3, () => chain.refresh())               // today's reading of every chain market, for the desk and the pages
every(20 * 60e3, () => desk.tick(deskQueue))    // the fact desk: views on open claims, small trades toward them
every(10 * 60e3, () => hire.tick(deskQueue))   // hired desks: views in each owner's style, buys within its on-chain limits (signed with HIRE_KEY_JSON)
every(2 * 60e3, () => swarm.jobsTick(operator, (tok, o) => wiki.page(tok, { ...o, wait: true })))   // a page job waits for the written page
swarm.reviewerPrompt().catch(() => {})   // the reviewers' prompt pinned on chain, read at start (then before each review, kept 10 min)
every(300e3, () => outside.poll())                    // outside users: the same tx index, every 5 min; ~450 requests once for the backfill
every(90e3, () => trades.poll())                      // every trade on the contract: ~2,000 FastNEAR requests a day (see trades.mjs), the backfill once
every(15 * 60e3, () => wiki.noMeansDue())             // what a NO means, claim by claim: 40 a round, WIKI_NOMEANS_PER_DAY a day, nothing without a key
