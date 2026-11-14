// chain reads and writes. One keyed RPC (server side only), one signer for the operator / resolver role.
import fs from 'node:fs'
import { webcrypto, createPublicKey, verify as edVerify, createHash } from 'node:crypto'
globalThis.crypto ??= webcrypto
import { Account, KeyPair, KeyPairSigner, JsonRpcProvider, actions } from 'near-api-js'

const KEYFILE = process.env.FASTNEAR_KEY_FILE || './keys/fastnear.key'
// keyed FastNEAR when the key file exists, the public endpoint otherwise (rate limited, fine for a judge's run)
export const RPC = process.env.NEAR_RPC || (fs.existsSync(KEYFILE) ? 'https://rpc.mainnet.fastnear.com?apiKey=' + fs.readFileSync(KEYFILE, 'utf8').trim() : 'https://rpc.mainnet.fastnear.com')
export const provider = new JsonRpcProvider({ url: RPC })
export const WRAP = 'wrap.near', INTENTS = 'intents.near', FACTORY = 'nearlytrade.near'
export const CONTRACT = process.env.KEYS_CONTRACT || 'keys.nearlyops.near'

export async function view(contract, method, args = {}) {
  const r = await provider.query({ request_type: 'call_function', finality: 'final', account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') })
  return JSON.parse(Buffer.from(r.result).toString())
}
export const viewAccount = (id) => provider.query({ request_type: 'view_account', finality: 'final', account_id: id })
export const accessKey = (id, pk) => provider.query({ request_type: 'view_access_key', finality: 'final', account_id: id, public_key: pk }).catch(() => null)

export function signer(file) {
  const k = JSON.parse(fs.readFileSync(file, 'utf8'))
  return new Account(k.account_id, provider, new KeyPairSigner(KeyPair.fromString(k.private_key)))
}
export async function call(acct, contract, method, args, deposit = 0n, gas = 50n * 10n ** 12n) { return (await callFull(acct, contract, method, args, deposit, gas)).hash }
/** the same, with the method's return value (a JSON value, or null) */
export async function callFull(acct, contract, method, args, deposit = 0n, gas = 50n * 10n ** 12n) {
  const r = await acct.signAndSendTransaction({ receiverId: contract, actions: [actions.functionCall(method, args, gas, deposit)] })
  const fail = r.receipts_outcome.find((o) => o.outcome.status.Failure)
  if (fail) throw new Error(JSON.stringify(fail.outcome.status.Failure).slice(0, 300))
  let value = null; try { const v = r.status?.SuccessValue; value = v ? JSON.parse(Buffer.from(v, 'base64').toString('utf8')) : null } catch { value = null }
  return { hash: r.transaction.hash, value }
}

// balances: a NEAR account holds the key token directly; a Solana / EVM wallet holds it inside intents.near
export const ftBalance = (token, account) => view(token, 'ft_balance_of', { account_id: account }).catch(() => '0')
export const mtBalance = (token, intentsId) => view(INTENTS, 'mt_balance_of', { account_id: intentsId, token_id: `nep141:${token}` }).catch(() => '0')

// ---- NEP-413 signed messages (same check as nearly.trade's sign in): sha256(borsh(prefix, {message, nonce, recipient, None}))
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
export function b58decode(s) { let n = 0n; for (const ch of s) { const i = B58.indexOf(ch); if (i < 0) throw new Error('bad base58'); n = n * 58n + BigInt(i) } const out = []; while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n } for (const ch of s) { if (ch === '1') out.unshift(0); else break } return Buffer.from(out) }
const str = (s) => { const b = Buffer.from(s, 'utf8'); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return Buffer.concat([l, b]) }
export function nep413Hash(message, nonce, recipient) {
  const p = Buffer.alloc(4); p.writeUInt32LE(2147484061)
  return createHash('sha256').update(Buffer.concat([p, str(message), nonce, str(recipient), Buffer.from([0])])).digest()
}
const SPKI = Buffer.from('302a300506032b6570032100', 'hex')
export const edOk = (msgHash, pk32, sig64) => edVerify(null, msgHash, createPublicKey({ key: Buffer.concat([SPKI, pk32]), format: 'der', type: 'spki' }), sig64)
export const pkBytes = (publicKey) => b58decode(String(publicKey).replace(/^ed25519:/, ''))
export const sigBytes = (signature) => (String(signature).startsWith('ed25519:') ? b58decode(signature.slice(8)) : Buffer.from(signature, 'base64'))

/** a NEP-413 signature from `account` with one of its full access keys (an implicit account's own key counts) */
export async function verifyNep413({ accountId, publicKey, signature, message, nonce, recipient }) {
  const pk = pkBytes(publicKey), sig = sigBytes(signature), nb = Buffer.from(nonce, 'base64')
  if (pk.length !== 32 || sig.length !== 64 || nb.length !== 32) return false
  if (!edOk(nep413Hash(message, nb, recipient), pk, sig)) return false
  if (/^[0-9a-f]{64}$/.test(accountId) && pk.toString('hex') === accountId) return true
  const k = await accessKey(accountId, publicKey)
  return k?.permission === 'FullAccess'
}
/** a Solana wallet's signMessage: raw ed25519 over the utf8 message; its Intents id is the hex of the key */
export function verifySolana({ address, signature, message }) {
  const pk = b58decode(address), sig = Buffer.from(signature, 'base64')
  if (pk.length !== 32 || sig.length !== 64) return null
  return edOk(Buffer.from(message, 'utf8'), pk, sig) ? pk.toString('hex') : null
}
