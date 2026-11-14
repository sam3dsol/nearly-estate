// on-chain smoke test from nearlyops.near against keys.nearlyops.near: roles, one market (create, buy, quote, sell), one job.
// Spends ~1.3 NEAR of wNEAR collateral that comes back on sell/cancel, plus gas.  node smoke.mjs --go
import fs from 'node:fs'
import { webcrypto } from 'node:crypto'
globalThis.crypto ??= webcrypto
import { Account, KeyPair, KeyPairSigner, JsonRpcProvider, actions } from 'near-api-js'
const V = (process.env.KEYS_DIR || './keys/')
const p = new JsonRpcProvider({ url: (process.env.NEAR_RPC || 'https://rpc.mainnet.fastnear.com') })
const C = 'keys.nearlyops.near', NEARLY = 'nearly-993927.nearlytrade.near'
const ops = JSON.parse(fs.readFileSync(V + 'mainnet-nearlyops.json'))
const me = new Account(ops.account_id, p, new KeyPairSigner(KeyPair.fromString(ops.private_key)))
const N = (x) => (BigInt(Math.round(x * 1e6)) * 10n ** 18n).toString()
const T = (x) => 10n ** 12n * BigInt(x)
const view = async (m, a = {}) => JSON.parse(Buffer.from((await p.query({ request_type: 'call_function', finality: 'final', account_id: C, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString('base64') })).result).toString())
const call = async (rx, m, a, dep = 0n, gas = 100n) => { const r = await me.signAndSendTransaction({ receiverId: rx, actions: [actions.functionCall(m, a, T(Number(gas)), BigInt(dep))] }); const f = r.receipts_outcome.find((o) => o.outcome.status.Failure); console.log(m, r.transaction.hash, f ? 'FAIL ' + JSON.stringify(f.outcome.status.Failure).slice(0, 240) : 'ok'); return r }
const go = process.argv.includes('--go')
console.log('config', await view('get_config'))
if (!go) { console.log('dry. add --go'); process.exit(0) }

// 1. roles: the server signs as the contract account with a function-call key, so that account is the resolver and operator
await call(C, 'set_roles', { resolver: C, operator: C, fee_bps: null })
// 2. a market on NEARLY: 1 wNEAR subsidy
await call('wrap.near', 'near_deposit', {}, N(1.3), 30n)
const resolves = Date.UTC(2026, 10, 20, 0, 0, 0)
await call('wrap.near', 'ft_transfer_call', { receiver_id: C, amount: N(1), msg: JSON.stringify({ Create: { question: 'NEARLY market cap above $300,000 on Nov 20, 2026', subject: NEARLY, resolves_at_ms: resolves } }) }, 1n, 100n)
let m = (await view('get_markets')).at(-1); console.log('market', m.id, m.question, 'p_yes', m.p_yes, 'b', Number(m.b) / 1e24)
// 3. buy 0.3 wNEAR of YES, then sell half back
const q = await view('quote_buy', { market: String(m.id), yes: true, amount: N(0.3) }); console.log('quote 0.3 -> shares', Number(q) / 1e24)
await call('wrap.near', 'ft_transfer_call', { receiver_id: C, amount: N(0.3), msg: JSON.stringify({ Buy: { market: String(m.id), yes: true, min_shares: '0' } }) }, 1n, 100n)
m = await view('get_market', { market: String(m.id) }); const pos = await view('get_position', { market: String(m.id), account: ops.account_id })
console.log('after buy p_yes', m.p_yes, 'collateral', Number(m.collateral) / 1e24, 'my yes', Number(pos.yes) / 1e24)
const half = (BigInt(pos.yes) / 2n).toString()
console.log('quote sell half ->', Number(await view('quote_sell', { market: String(m.id), yes: true, shares: half })) / 1e24, 'wNEAR')
await call(C, 'sell', { market: String(m.id), yes: true, shares: half, min_out: '0' }, 0n, 60n)
m = await view('get_market', { market: String(m.id) }); console.log('after sell p_yes', m.p_yes, 'collateral', Number(m.collateral) / 1e24)
// 4. a job: the page for NEARLY, 0.2 NEAR bounty, 3 days
await call(C, 'post_job', { description: 'Write the encyclopedia page for NEARLY', deadline_ms: Date.now() + 3 * 86400e3 }, N(0.2), 30n)
console.log('jobs', (await view('get_jobs')).map((j) => [j.id, j.status, Number(j.bounty) / 1e24]))
console.log('config', await view('get_config'))
