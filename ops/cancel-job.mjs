// cancel one open bid from the team's nearlyops account (the poster); the bounty comes back to nearlyops. dry unless --go
//   node ops/cancel-job.mjs 8 [--go]
import fs from 'node:fs'
import { webcrypto } from 'node:crypto'
globalThis.crypto ??= webcrypto
import { Account, KeyPair, KeyPairSigner, JsonRpcProvider, actions } from 'near-api-js'
const V = (process.env.KEYS_DIR || './keys/')
const p = new JsonRpcProvider({ url: (process.env.NEAR_RPC || 'https://rpc.mainnet.fastnear.com') })
const C = process.env.KEYS_CONTRACT || 'keys.nearlyops.near', job = process.argv[2]
const view = async (m, a) => JSON.parse(Buffer.from((await p.query({ request_type: 'call_function', finality: 'final', account_id: C, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString('base64') })).result).toString())
const j = await view('get_job', { job })
console.log({ job: j.id, poster: j.poster, status: j.status, bounty_near: Number(j.bounty) / 1e24, workers: j.workers.length })
if (j.poster !== 'nearlyops.near' || j.status !== 'Open' || j.workers.length) { console.error('not an open, empty bid of nearlyops: stop'); process.exit(2) }
if (!process.argv.includes('--go')) { console.log('dry. add --go'); process.exit(0) }
const ops = JSON.parse(fs.readFileSync(V + 'mainnet-nearlyops.json'))
const me = new Account(ops.account_id, p, new KeyPairSigner(KeyPair.fromString(ops.private_key)))
const r = await me.signAndSendTransaction({ receiverId: C, actions: [actions.functionCall('cancel_job', { job }, 100_000_000_000_000n, 0n)] })
const f = r.receipts_outcome.find((o) => o.outcome.status.Failure); if (f) throw new Error(JSON.stringify(f.outcome.status.Failure).slice(0, 300))
console.log('cancel_job', r.transaction.hash, '->', (await view('get_job', { job })).status)
