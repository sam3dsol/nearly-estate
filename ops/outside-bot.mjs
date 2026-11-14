// An outside worker: not run by us, no server of ours involved. Any NEAR account joins the swarm with NEAR for its thinking,
// watches the bids, takes one it likes, does the work with whatever model it wants, submits the result. The sealed reviewer
// still checks it and the poster (or the review) pays it on chain. This is the whole loop in 30 lines.
//   NEAR_ACCOUNT=you.near NEAR_KEY=ed25519:... node ops/outside-bot.mjs [--join 0.2] [--take <job id>] [--submit <job id> "the result"]
import { RPC as PAID_RPC, ARCHIVAL as PAID_ARCHIVAL, fxHeaders } from './rpc.mjs'
import { webcrypto } from 'node:crypto'
globalThis.crypto ??= webcrypto
import { Account, KeyPair, KeyPairSigner, JsonRpcProvider, actions } from 'near-api-js'
const C = process.env.KEYS_CONTRACT || 'keys.nearlyops.near'
const p = new JsonRpcProvider({ url: PAID_RPC })
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null }
const writes = arg('--join') || arg('--take') || arg('--submit')
if (writes && !(process.env.NEAR_ACCOUNT && process.env.NEAR_KEY)) { console.error('set NEAR_ACCOUNT=you.near NEAR_KEY=ed25519:... to join, take or submit (listing the bids needs nothing)'); process.exit(2) }
const me = writes ? new Account(process.env.NEAR_ACCOUNT, p, new KeyPairSigner(KeyPair.fromString(process.env.NEAR_KEY))) : null
const N = (x) => (BigInt(Math.round(x * 1e6)) * 10n ** 18n).toString()
const view = async (m, a = {}) => JSON.parse(Buffer.from((await p.query({ request_type: 'call_function', finality: 'final', account_id: C, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString('base64') })).result).toString())
const call = async (m, a, dep = '0') => { const r = await me.signAndSendTransaction({ receiverId: C, actions: [actions.functionCall(m, a, 30n * 10n ** 12n, BigInt(dep))] }); console.log(m, r.transaction.hash); return r }

if (arg('--join')) await call('join_swarm', { agent: me.accountId, name: 'outside bot', prompt_hash: 'none' }, N(Number(arg('--join'))))   // NEAR for thinking + the stake it locks per job
if (arg('--take')) await call('accept_job', { job: arg('--take'), agent: me.accountId })                                                 // the ceiling is locked from the bot's fund until the job ends
if (arg('--submit')) await call('submit_job', { job: arg('--submit'), result: process.argv[process.argv.indexOf('--submit') + 2], agent: me.accountId })   // then the sealed reviewer writes its verdict; the best entry is paid
const open = (await view('get_jobs', { from: 0, limit: 200 })).filter((j) => j.status === 'Open')
if (!open.length) console.log('no open bid right now')
for (const j of open) console.log(`open bid #${j.id}: ${j.description} · ${Number(j.bounty) / 1e24} NEAR · ceiling ${Number(j.max_spend) / 1e24} (${j.swarm ? `whole swarm, ${j.workers.length}/${j.max_workers} on it, stake ${Number(j.max_spend) / 1e24 / j.max_workers} each` : 'first worker'}) · wants ${j.min_jobs_done}+ jobs done, score ${j.min_score}+`)
