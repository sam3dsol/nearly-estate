import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { receiptFor, receiptOfVoice } from '../markets.mjs'

const H = (r) => createHash('sha256').update(`${r.signed_text}|${r.signature}|${r.signer}`).digest('hex')
test('the receipt served is the one the chain hashed: the deciding voice when it matches, else the voice that does', () => {
  const ds = { model: 'deepseek-ai/DeepSeek-V4.1-Flash-1017', request: 'q1', response: 'a1', signature: 's1' }
  const qw = { model: 'Qwen/Qwen3.8-27B', request: 'q2', response: 'a2', signature: 's2' }
  const deciding = receiptOfVoice(qw, 1), onchain = receiptOfVoice(ds, 1)
  const r = { receipt: deciding, voices: [ds, qw], proposed: 1 }
  assert.equal(receiptFor(r, H(deciding)).model, qw.model)
  assert.equal(receiptFor(r, H(onchain)).model, ds.model)
  assert.equal(receiptFor(r, 'nope').model, qw.model, 'no match: the ruling\'s own receipt stands')
  assert.equal(receiptFor(r, null).model, qw.model)
})
