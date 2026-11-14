// the sealed judge's receipts: the committed copies re-verify offline, and any change to bytes, signature or signer breaks them
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { createHash } from 'node:crypto'
process.env.DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'keys-test-'))
const { checkReceipt } = await import('../ai.mjs')
const load = (m) => JSON.parse(fs.readFileSync(new URL(`../../ops/receipts/market-${m}.json`, import.meta.url), 'utf8'))
const sha = (s) => createHash('sha256').update(s).digest('hex')

for (const m of [3, 4]) {
  const r = load(m)
  test(`market ${m}: the committed receipt verifies`, () => assert.deepEqual(checkReceipt(r.receipt), { ok: true, hashes: true, signature: true }))
  test(`market ${m}: the hash on chain is sha256(signed_text|signature|signer)`, () => assert.equal(sha(`${r.receipt.signed_text}|${r.receipt.signature}|${r.receipt.signer}`), r.onchain_hash))
  test(`market ${m}: the signed response carries the outcome`, () => assert.match(JSON.parse(r.receipt.bytes.response).choices[0].message.content.replace(/\s/g, ''), new RegExp(`"outcome":${r.outcome}`)))
  test(`market ${m}: one changed byte in the response breaks the hashes`, () => {
    const R = structuredClone(r.receipt); R.bytes.response = R.bytes.response.replace(/(outcome\\":\s*)true/, '$1false')   // the verdict inside the escaped content
    assert.notEqual(R.bytes.response, r.receipt.bytes.response); assert.equal(checkReceipt(R).hashes, false); assert.equal(checkReceipt(R).ok, false)
  })
  test(`market ${m}: a flipped signature bit fails`, () => {
    const R = structuredClone(r.receipt); R.signature = (parseInt(R.signature[0], 16) ^ 1).toString(16) + R.signature.slice(1)
    assert.deepEqual({ hashes: checkReceipt(R).hashes, signature: checkReceipt(R).signature }, { hashes: true, signature: false })
  })
  test(`market ${m}: another signer fails`, () => { const R = structuredClone(r.receipt); R.signer = 'ab'.repeat(32); assert.equal(checkReceipt(R).ok, false) })
}
test('a receipt without bytes is not ok', () => assert.equal(checkReceipt({ algo: 'ed25519' }).ok, false))
