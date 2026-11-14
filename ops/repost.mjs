// cancel an open bid of ours (bounty comes back to nearlyops) and post it again with new guardrails, same words
//   node ops/repost.mjs --go --job 7 [--near 0.3] [--min-score 0] [--days 7] [--cap 20]
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { webcrypto } from 'node:crypto'
globalThis.crypto ??= webcrypto
import { Account, KeyPair, KeyPairSigner, JsonRpcProvider, actions } from 'near-api-js'
const V = (process.env.KEYS_DIR || './keys/'), C = process.env.KEYS_CONTRACT || 'keys.nearlyops.near'
const p = new JsonRpcProvider({ url: (process.env.NEAR_RPC || 'https://rpc.mainnet.fastnear.com') })
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const job = arg('--job'), near = arg('--near', '0.3'), minScore = arg('--min-score', '0'), days = arg('--days', '7'), cap = arg('--cap', '20')
const view = async (m, a = {}) => JSON.parse(Buffer.from((await p.query({ request_type: 'call_function', finality: 'final', account_id: C, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString('base64') })).result).toString())
const k = JSON.parse(fs.readFileSync(V + 'mainnet-nearlyops.json'))
const me = new Account(k.account_id, p, new KeyPairSigner(KeyPair.fromString(k.private_key)))
const j = await view('get_job', { job })
console.log('job', job, j.status, (Number(j.bounty) / 1e24).toFixed(2), 'N poster', j.poster, 'min_score', j.min_score, '\n ', j.description)
if (j.status !== 'Open' || j.poster !== k.account_id) throw new Error('not our open bid')
if (!process.argv.includes('--go')) { console.log('dry. add --go'); process.exit(0) }
const r = await me.signAndSendTransaction({ receiverId: C, actions: [actions.functionCall('cancel_job', { job }, 60n * 10n ** 12n, 0n)] })
const f = r.receipts_outcome.find((o) => o.outcome.status.Failure); if (f) throw new Error('cancel_job ' + JSON.stringify(f.outcome.status.Failure).slice(0, 300))
console.log('cancel_job', r.transaction.hash)
console.log(execFileSync('node', ['ops/bid.mjs', '--go', j.description, '--near', near, '--min-score', minScore, '--days', days, '--cap', cap], { cwd: new URL('..', import.meta.url).pathname }).toString())
