import { test } from 'node:test'
import assert from 'node:assert/strict'
import { retrying } from '../chain.mjs'

test('a failed read is tried again, then answers', async () => {
  let n = 0
  const v = await retrying(async () => { if (++n < 3) throw new Error('429'); return 'ok' }, [1, 1])
  assert.equal(v, 'ok'); assert.equal(n, 3)
})
test('after the last wait the error comes through', async () => {
  let n = 0
  await assert.rejects(retrying(async () => { n++; throw new Error('down') }, [1, 1]), /down/)
  assert.equal(n, 3)
})
