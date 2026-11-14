// The owner registers the sealed judge's signing key on chain, read from NEAR AI's attestation report for the private model,
// so every ruling that carries the model's signature is verified by the contract itself.   node ops/set-signer.mjs --go
import fs from 'node:fs'
import { webcrypto } from 'node:crypto'
globalThis.crypto ??= webcrypto
import { Account, KeyPair, KeyPairSigner, JsonRpcProvider, actions } from 'near-api-js'
const V = (process.env.KEYS_DIR || './keys/'), C = process.env.KEYS_CONTRACT || 'keys.nearlyops.near'
const env = Object.fromEntries(fs.readFileSync(new URL('../server/.env', import.meta.url)).toString().split('\n').filter((l) => l.includes('=')).map((l) => l.split('=').map((x) => x.trim())))
const model = env.NEARAI_MODEL_PRIVATE || 'deepseek-ai/DeepSeek-V4.1-Flash-1017'
const r = await fetch(`https://cloud-api.near.ai/v1/attestation/report?model=${encodeURIComponent(model)}&provider=near&signing_algo=ed25519`, { headers: { authorization: `Bearer ${env.NEARAI_KEY}` } }).then((x) => x.json())
const reports = r.model_attestations || []
const signers = [...new Set(reports.map((m) => m.signing_address).filter(Boolean))]
console.log({ model, model_reports: reports.length, signers })
if (signers.length !== 1) { console.error('expected exactly one signer for the model'); process.exit(1) }
const p = new JsonRpcProvider({ url: (process.env.NEAR_RPC || 'https://rpc.mainnet.fastnear.com') })
const view = async (m, a = {}) => JSON.parse(Buffer.from((await p.query({ request_type: 'call_function', finality: 'final', account_id: C, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString('base64') })).result).toString())
if (!process.argv.includes('--go')) { console.log('dry. add --go'); process.exit(0) }
const ops = JSON.parse(fs.readFileSync(V + 'mainnet-nearlyops.json'))
const me = new Account(ops.account_id, p, new KeyPairSigner(KeyPair.fromString(ops.private_key)))
const tx = await me.signAndSendTransaction({ receiverId: C, actions: [actions.functionCall('set_model_signer', { signer: signers[0] }, 30n * 10n ** 12n, 0n)] })
console.log('set_model_signer', tx.transaction.hash)
