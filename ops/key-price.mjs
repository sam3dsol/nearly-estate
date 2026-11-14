// set a key's price from its seller account (the team's nearlyops for keys 1 and 2). dry unless --go
//   node ops/key-price.mjs <key id> <price in NEAR> [--go]
import { RPC as PAID_RPC, ARCHIVAL as PAID_ARCHIVAL, fxHeaders } from './rpc.mjs'
import fs from 'node:fs'
import { webcrypto } from 'node:crypto'
globalThis.crypto ??= webcrypto
import { Account, KeyPair, KeyPairSigner, JsonRpcProvider, actions } from 'near-api-js'
const KEYS_DIR = process.env.KEYS_DIR || './keys/'
const p = new JsonRpcProvider({ url: PAID_RPC })
const C = process.env.KEYS_CONTRACT || 'keys.nearlyops.near', [key, near] = process.argv.slice(2)
const view = async (m, a) => JSON.parse(Buffer.from((await p.query({ request_type: 'call_function', finality: 'final', account_id: C, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString('base64') })).result).toString())
const N = (x) => (BigInt(Math.round(Number(x) * 1e6)) * 10n ** 18n).toString()
const k = await view('get_key', { key })
console.log({ key: k.id, token: k.token, owner: k.owner, price_near: Number(k.price) / 1e24, sold: k.sold, new_price_near: Number(near) })
if (!process.argv.includes('--go')) { console.log('dry. add --go'); process.exit(0) }
const ops = JSON.parse(fs.readFileSync(KEYS_DIR + 'mainnet-nearlyops.json'))
if (k.owner !== ops.account_id) { console.error('not the seller: stop'); process.exit(2) }
const me = new Account(ops.account_id, p, new KeyPairSigner(KeyPair.fromString(ops.private_key)))
const r = await me.signAndSendTransaction({ receiverId: C, actions: [actions.functionCall('set_price', { key, price: N(near) }, 30_000_000_000_000n, 0n)] })
const f = r.receipts_outcome.find((o) => o.outcome.status.Failure); if (f) throw new Error(JSON.stringify(f.outcome.status.Failure).slice(0, 300))
console.log('set_price', r.transaction.hash, '->', Number((await view('get_key', { key })).price) / 1e24, 'NEAR')
