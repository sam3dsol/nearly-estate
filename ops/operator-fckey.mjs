// The server signs as the operator with a function-call key limited to the keys contract and the operator's methods; the
// operator account's full key stays offline, off the server.   node ops/operator-fckey.mjs --go
import fs from 'node:fs'
import { webcrypto } from 'node:crypto'
globalThis.crypto ??= webcrypto
import { Account, KeyPair, KeyPairSigner, JsonRpcProvider, actions } from 'near-api-js'
const V = (process.env.KEYS_DIR || './keys/'), C = process.env.KEYS_CONTRACT || 'keys.nearlyops.near', OP = 'keysop.nearlyops.near'
const FULL = `${V}mainnet-${OP}.json`, FC = `${V}mainnet-${OP}-fckey.json`
const METHODS = ['charge_inference', 'propose', 'finalize', 'accept_job', 'submit_job', 'charge_job', 'review_job', 'settle_job', 'open_fact']
const p = new JsonRpcProvider({ url: (process.env.NEAR_RPC || 'https://rpc.mainnet.fastnear.com') })
const full = KeyPair.fromString(JSON.parse(fs.readFileSync(FULL)).private_key)
const fck = fs.existsSync(FC) ? KeyPair.fromString(JSON.parse(fs.readFileSync(FC)).private_key) : KeyPair.fromRandom('ed25519')
console.log({ operator: OP, contract: C, fc_key: fck.getPublicKey().toString(), methods: METHODS, allowance: '2 NEAR of gas' })
if (!process.argv.includes('--go')) { console.log('dry. add --go'); process.exit(0) }
const me = new Account(OP, p, new KeyPairSigner(full))
const r = await me.signAndSendTransaction({ receiverId: OP, actions: [actions.addFunctionCallAccessKey(fck.getPublicKey(), C, METHODS, 2n * 10n ** 24n)] })
console.log('fc key added', r.transaction.hash)
fs.writeFileSync(FC, JSON.stringify({ account_id: OP, public_key: fck.getPublicKey().toString(), private_key: fck.toString(), methods: METHODS, contract: C, made: new Date().toISOString() }), { mode: 0o600 })
console.log('now: OPERATOR_KEY=' + FC + ' in the keys server unit, then restart it; the full key stays offline')
