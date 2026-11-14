// key access: the server trusts its hidden-account record only when it matches the chain's commitment, feed tokens are
// bound to the key, the holder and an expiry, and both sign-in paths check real signatures (no network: implicit accounts)
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import crypto from 'node:crypto'
process.env.DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'keys-test-'))
const { table } = await import('../store.mjs')
const { matches, issueFt, checkFt, challenge, access } = await import('../keys.mjs')
const { verifySolana, verifyNep413, nep413Hash } = await import('../near.mjs')

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const b58 = (buf) => { let n = BigInt('0x' + buf.toString('hex')), s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n } for (const b of buf) { if (b) break; s = '1' + s } return s }
const pair = () => { const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519'); return { pk: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32), sign: (m) => crypto.sign(null, m, privateKey) } }

test('the hidden-account record counts only when owner and commitment match the chain', () => {
  table('keys').v['tok.near'] = { hidden: 'trader.near', salt: 's1', owner: 'alice.near' }
  const commitment = crypto.createHash('sha256').update('trader.near:s1').digest('hex')
  assert.equal(matches({ token: 'tok.near', owner: 'alice.near', commitment }), true)
  assert.equal(matches({ token: 'tok.near', owner: 'mallory.near', commitment }), false)
  assert.equal(matches({ token: 'tok.near', owner: 'alice.near', commitment: '00'.repeat(32) }), false)
  assert.equal(matches({ token: 'other.near', owner: 'alice.near', commitment }), false)
})
test('a feed token opens only its own key, for its holder, until it expires', () => {
  const exp = Date.now() + 60e3, ft = issueFt('tok.near', 'bob.near', exp)
  assert.equal(checkFt(ft, 'tok.near'), 'bob.near')
  assert.equal(checkFt(ft, 'other.near'), null)
  assert.equal(checkFt(issueFt('tok.near', 'bob.near', Date.now() - 1), 'tok.near'), null)
  assert.equal(checkFt(ft.replace('bob.near', 'eve.near'), 'tok.near'), null)
  assert.equal(checkFt(ft.slice(0, -1) + (ft.endsWith('0') ? '1' : '0'), 'tok.near'), null)
  assert.equal(checkFt(ft.slice(0, -2), 'tok.near'), null)
  assert.equal(checkFt('', 'tok.near'), null)
})
test('a Solana challenge names the key, the wallet, a nonce and an expiry; a bad address is refused', () => {
  const addr = b58(pair().pk), c = challenge({ token: 'tok.near', address: addr })
  assert.match(c.message, new RegExp(`Unlock key tok\\.near\\nWallet: ${addr}\\nNonce: [0-9a-f]{32}\\nExpires: `))
  assert.ok(c.exp > Date.now())
  assert.throws(() => challenge({ token: 'tok.near', address: '0xdead' }), /bad Solana address/)
})
test('a Solana signature maps to the wallet\'s Intents id, a changed message does not', () => {
  const k = pair(), message = 'nearly.trade\nUnlock key tok.near'
  const signature = k.sign(Buffer.from(message)).toString('base64')
  assert.equal(verifySolana({ address: b58(k.pk), signature, message }), k.pk.toString('hex'))
  assert.equal(verifySolana({ address: b58(k.pk), signature, message: message + '!' }), null)
})
test('a NEP-413 sign in from an implicit account verifies without the network; another recipient does not', async () => {
  const k = pair(), nonce = crypto.randomBytes(32), message = 'Sign in to nearly.trade'
  const signature = k.sign(nep413Hash(message, nonce, 'nearly.trade')).toString('base64')
  const base = { accountId: k.pk.toString('hex'), publicKey: 'ed25519:' + b58(k.pk), signature, message, nonce: nonce.toString('base64') }
  assert.equal(await verifyNep413({ ...base, recipient: 'nearly.trade' }), true)
  assert.equal(await verifyNep413({ ...base, recipient: 'evil.example' }), false)
})
test("the seller sees their own key's feed without buying it (no chain read needed)", async () => {
  assert.equal(await access({ id: 2, token: 'alice.near', owner: 'alice.near', min_hold: '0' }, 'alice.near'), 'seller')
})
