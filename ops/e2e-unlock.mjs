// end to end, server side: nearlyops signs the site's NEP-413 sign in, gets a nearly.trade session, unlocks the NEARLY key,
// reads the feed, opens the live socket. Nothing on chain.   node e2e-unlock.mjs
import fs from 'node:fs'
import crypto from 'node:crypto'
import WebSocket from 'ws'
import { nep413Hash, b58decode } from '../server/near.mjs'
const V = (process.env.KEYS_DIR || './keys/'), TOKEN = 'nearly-993927.nearlytrade.near', KEYS = 'http://127.0.0.1:8830'
const ops = JSON.parse(fs.readFileSync(V + 'mainnet-nearlyops.json'))
const raw = b58decode(ops.private_key.replace(/^ed25519:/, ''))   // 64 bytes: seed + public key
const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), raw.subarray(0, 32)])
const key = crypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' })
const nonce = crypto.randomBytes(32)
const message = `nearly.trade\nUnlock a key on nearly.trade\nAccount: ${ops.account_id}\nIssued: ${new Date().toISOString()}`
const sig = crypto.sign(null, nep413Hash(message, nonce, 'nearly.trade'), key)
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const b58 = (b) => { let n = BigInt('0x' + Buffer.from(b).toString('hex')), s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n } for (const x of b) { if (x === 0) s = '1' + s; else break } return s }
const j = async (url, body) => { const r = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}); const t = await r.text(); try { return [r.status, JSON.parse(t)] } catch { return [r.status, t.slice(0, 200)] } }
const [s1, sess] = await j('https://nearly.trade/api/social/session', { accountId: ops.account_id, publicKey: ops.public_key, signature: 'ed25519:' + b58(sig), message, nonce: nonce.toString('base64') })
console.log('session', s1, sess.account || sess)
const [s2, un] = await j(`${KEYS}/api/keys/${TOKEN}/unlock`, { session: sess.session })
console.log('unlock', s2, un.error || { holder: un.holder, balance: un.balance })
if (!un.ft) process.exit(1)
const [s3, feed] = await j(`${KEYS}/api/keys/${TOKEN}/feed?ft=${encodeURIComponent(un.ft)}`)
console.log('feed', s3, 'trades', feed.trades?.length, 'bags', feed.bags?.length, 'first', feed.trades?.[0], 'account leaked?', JSON.stringify(feed).includes(ops.account_id))
const ws = new WebSocket(`ws://127.0.0.1:8830/api/keys/${TOKEN}/live?ft=${encodeURIComponent(un.ft)}`)
ws.on('message', (d) => { console.log('ws', d.toString().slice(0, 120)); ws.close() })
ws.on('close', (c) => { console.log('ws closed', c); process.exit(0) })
setTimeout(() => { console.log('ws timeout'); process.exit(0) }, 8000)
