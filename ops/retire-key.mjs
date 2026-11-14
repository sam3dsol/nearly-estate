// retire a key on chain: its seller reveals the hidden account + salt (reveal_key), which anyone can check against the
// commitment; a revealed key is no longer sold or shown. dry unless --go
//   node ops/retire-key.mjs <key id> <data dir with keys.json> [--go]
import { RPC as PAID_RPC, ARCHIVAL as PAID_ARCHIVAL, fxHeaders } from './rpc.mjs'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { webcrypto } from 'node:crypto'
globalThis.crypto ??= webcrypto
import { Account, KeyPair, KeyPairSigner, JsonRpcProvider, actions } from 'near-api-js'
const KEYS_DIR = process.env.KEYS_DIR || './keys/'
const p = new JsonRpcProvider({ url: PAID_RPC })
const C = process.env.KEYS_CONTRACT || 'keys.nearlyops.near', [key, dir] = process.argv.slice(2)
const view = async (m, a) => JSON.parse(Buffer.from((await p.query({ request_type: 'call_function', finality: 'final', account_id: C, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString('base64') })).result).toString())
const k = await view('get_key', { key })
const rec = JSON.parse(fs.readFileSync(dir + '/keys.json', 'utf8'))[k.token]
if (!rec) { console.error('no hidden account on record for', k.token); process.exit(2) }
const ok = crypto.createHash('sha256').update(`${rec.hidden}:${rec.salt}`).digest('hex') === k.commitment
console.log({ key: k.id, token: k.token, owner: k.owner, revealed: k.revealed, sold: k.sold, matches_commitment: ok })
if (!ok) { console.error('the record does not match the commitment: stop'); process.exit(2) }
if (!process.argv.includes('--go')) { console.log('dry. add --go'); process.exit(0) }
const ops = JSON.parse(fs.readFileSync(KEYS_DIR + 'mainnet-nearlyops.json'))
if (k.owner !== ops.account_id) { console.error('not the seller: stop'); process.exit(2) }
const me = new Account(ops.account_id, p, new KeyPairSigner(KeyPair.fromString(ops.private_key)))
const r = await me.signAndSendTransaction({ receiverId: C, actions: [actions.functionCall('reveal_key', { key, account: rec.hidden, salt: rec.salt }, 30_000_000_000_000n, 0n)] })
const f = r.receipts_outcome.find((o) => o.outcome.status.Failure); if (f) throw new Error(JSON.stringify(f.outcome.status.Failure).slice(0, 300))
console.log('reveal_key', r.transaction.hash)
