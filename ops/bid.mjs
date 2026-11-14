// Put a bid on chain from the team's nearlyops account: any work in text, with the guardrails a poster sets.
//   node ops/bid.mjs --go "Write a 5 line thread on why NEARLY is the launchpad on NEAR" --near 0.2 [--cap 20] [--min-done 0] [--min-score 0] [--days 2] [--manual] [--swarm --workers 3]
import fs from 'node:fs'
import { webcrypto } from 'node:crypto'
globalThis.crypto ??= webcrypto
import { Account, KeyPair, KeyPairSigner, JsonRpcProvider, actions } from 'near-api-js'
const V = (process.env.KEYS_DIR || './keys/')
const p = new JsonRpcProvider({ url: (process.env.NEAR_RPC || 'https://rpc.mainnet.fastnear.com') })
const C = process.env.KEYS_CONTRACT || 'keys.nearlyops.near'
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const description = process.argv.slice(2).find((a) => !a.startsWith('--') && a.length > 10 && !/^[\d.]+$/.test(a))
const near = Number(arg('--near', '0.2')), cap = Number(arg('--cap', '20')), minDone = Number(arg('--min-done', '0')), minScore = Number(arg('--min-score', '0')), days = Number(arg('--days', '2')), auto = !process.argv.includes('--manual'), swarm = process.argv.includes('--swarm'), workers = Number(arg('--workers', '3'))
if (!description) { console.error('description?'); process.exit(2) }
console.log({ description, near, cap_pct: cap, min_jobs_done: minDone, min_score: minScore, days, auto_approve: auto, swarm, max_workers: swarm ? workers : 1 })
if (!process.argv.includes('--go')) { console.log('dry. add --go'); process.exit(0) }
const ops = JSON.parse(fs.readFileSync(V + 'mainnet-nearlyops.json'))
const me = new Account(ops.account_id, p, new KeyPairSigner(KeyPair.fromString(ops.private_key)))
const N = (x) => (BigInt(Math.round(x * 1e6)) * 10n ** 18n).toString()
const r = await me.signAndSendTransaction({ receiverId: C, actions: [actions.functionCall('post_job', { description, deadline_ms: Date.now() + days * 86400e3, auto_approve: auto, max_spend_bps: Math.round(cap * 100), min_jobs_done: minDone, min_score: minScore, ...(swarm ? { swarm: true, max_workers: workers } : {}) }, 30n * 10n ** 12n, BigInt(N(near)))] })
const f = r.receipts_outcome.find((o) => o.outcome.status.Failure); if (f) throw new Error(JSON.stringify(f.outcome.status.Failure).slice(0, 300))
console.log('post_job', r.transaction.hash, 'job id', Buffer.from(r.receipts_outcome[0].outcome.status.SuccessValue || '', 'base64').toString())
