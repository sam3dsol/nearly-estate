// retune the lab trader's brain: the owner (nearlyops) commits the new brain's hash on chain (set_brain), then registers the
// same brain on the keys server through the real route (a nearly.trade session). The server refuses a brain whose hash is not
// the one on chain, so the order is chain first. dry unless --go
//   node ops/set-brain.mjs [--go] [--rules '{"max_age_h":6,"rising":true,"cooldown_h":0.7,"skip":["MINE","NEARLY"]}']
import { RPC as PAID_RPC, ARCHIVAL as PAID_ARCHIVAL, fxHeaders } from './rpc.mjs'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { webcrypto } from 'node:crypto'
globalThis.crypto ??= webcrypto
import { Account, KeyPair, KeyPairSigner, JsonRpcProvider, actions } from 'near-api-js'
import { nep413Hash, b58decode } from '../server/near.mjs'
import { promptHash } from '../server/swarm.mjs'
const KEYS_DIR = process.env.KEYS_DIR || './keys/', STATE = KEYS_DIR + 'mainnet-keys-lab-trader.json'
const KEYS = process.env.KEYS_API || 'http://127.0.0.1:8830', C = process.env.KEYS_CONTRACT || 'keys.nearlyops.near'
const p = new JsonRpcProvider({ url: PAID_RPC })
const PROMPT = `Momentum on nearly.trade: buy a launch under 6 hours old when its 1h volume is rising and holders are growing, never more than $10 a trade, sell a bag when it is up 40% or down 25%. Besides that, keep the wallet active on NEAR Intents with small confidential swaps, so the key's record is real: look at my_trades; if the last swap was 11 hours ago or more, make one swap of $2: if wallet.intents holds at least $1.50 of wNEAR, buy USDC with it (buy USDC); otherwise, if it holds at least $1.50 of USDC, sell USDC back to wNEAR (sell USDC). Alternate like that. Never more than $2 a swap. One action a round at most. Explain each move in one short line in crypto trader terms: fresh launch (under 6h), volume up, holders up, entry, no entry, take profit, stop loss, rebalance swap. Never say young, qualifying, eligible, criteria or cooldown. Example: "No entry: no fresh launch (<6h) with volume and holders both up. Next rebalance swap in 1h."`
const TOOLS = ['trade']
const state = JSON.parse(fs.readFileSync(STATE)), ops = JSON.parse(fs.readFileSync(KEYS_DIR + 'mainnet-nearlyops.json'))
const ri = process.argv.indexOf('--rules'), rules = ri > 0 ? JSON.parse(process.argv[ri + 1]) : { max_age_h: 6, rising: true, cooldown_h: 11, skip: ['MINE', 'NEARLY', 'mine-8.nearlytrade.near'] }
const brain = { prompt: PROMPT, knowledge: '', tools: TOOLS }, hash = promptHash(brain)
const view = async (m, a) => JSON.parse(Buffer.from((await p.query({ request_type: 'call_function', finality: 'final', account_id: C, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString('base64') })).result).toString())
const onchain = await view('get_agent', { agent: state.near_account })
console.log({ agent: state.near_account, owner: onchain.owner, hash_on_chain: onchain.prompt_hash.slice(0, 12) + '…', new_hash: hash.slice(0, 12) + '…', rules, prompt_chars: PROMPT.length })
if (onchain.owner !== ops.account_id) { console.error('not the owner: stop'); process.exit(2) }
if (!process.argv.includes('--go')) { console.log('dry. add --go'); process.exit(0) }
// 1. the chain: the owner's new commitment
if (onchain.prompt_hash !== hash) {
  const me = new Account(ops.account_id, p, new KeyPairSigner(KeyPair.fromString(ops.private_key)))
  const r = await me.signAndSendTransaction({ receiverId: C, actions: [actions.functionCall('set_brain', { agent: state.near_account, prompt_hash: hash }, 30_000_000_000_000n, 0n)] })
  const f = r.receipts_outcome.find((o) => o.outcome.status.Failure); if (f) throw new Error(JSON.stringify(f.outcome.status.Failure).slice(0, 300))
  console.log('set_brain', r.transaction.hash)
  // the server reads the chain at final; wait for the new hash to be there before registering against it
  for (let i = 0; i < 20 && (await view('get_agent', { agent: state.near_account })).prompt_hash !== hash; i++) await new Promise((r) => setTimeout(r, 1500))
} else console.log('hash already on chain')
// 2. the server, through the real route: a nearly.trade session signed by the owner (NEP-413, nothing on chain)
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const b58 = (b) => { let n = BigInt('0x' + Buffer.from(b).toString('hex')), s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n } for (const x of b) { if (x === 0) s = '1' + s; else break } return s }
const raw = b58decode(ops.private_key.replace(/^ed25519:/, ''))
const edKey = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), raw.subarray(0, 32)]), format: 'der', type: 'pkcs8' })
const j = async (url, body) => { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const t = await r.text(); try { return JSON.parse(t) } catch { return { status: r.status, text: t.slice(0, 200) } } }
const nonce = crypto.randomBytes(32), message = `nearly.trade\nSet my agent’s mandate\nAccount: ${ops.account_id}\nIssued: ${new Date().toISOString()}`
const sig = crypto.sign(null, nep413Hash(message, nonce, 'nearly.trade'), edKey)
const sess = await j('https://nearly.trade/api/social/session', { accountId: ops.account_id, publicKey: ops.public_key, signature: 'ed25519:' + b58(sig), message, nonce: nonce.toString('base64') })
if (!sess?.session) { console.error('no session', sess); process.exit(1) }
const reg = await j(KEYS + '/api/swarm/register', { session: sess.session, agent_id: state.agent_id, near_account: state.near_account, name: 'momentum', prompt: PROMPT, tools: TOOLS, rules, daily_usd: 10 })
console.log('registered', reg)
