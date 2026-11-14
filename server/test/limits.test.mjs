import { test } from 'node:test'
import assert from 'node:assert/strict'
import { perIp, _reset, marketId } from '../limits.mjs'

test('a daily cap per address: the cap-th call passes, the next is 429, another address is fresh, no address is unlimited', () => {
  _reset()
  for (let i = 0; i < 3; i++) perIp('new', '203.0.113.9', 3)
  assert.throws(() => perIp('new', '203.0.113.9', 3), (e) => e.status === 429)
  perIp('new', '203.0.113.10', 3)
  assert.doesNotThrow(() => perIp('new', '', 3), 'no address, no bucket (the global caps hold)')
})

test('a market id in a path: a non-negative integer that fits u64; anything else is 400, past u64 is 404', () => {
  assert.equal(marketId('22'), '22')
  assert.equal(marketId('007'), '7')
  assert.equal(marketId('18446744073709551615'), '18446744073709551615')
  for (const bad of ['-1', 'abc', '1.5', '', ' 1', '1e3', undefined]) assert.throws(() => marketId(bad), (e) => e.status === 400 && e.message === 'bad market id', String(bad))
  assert.throws(() => marketId('99999999999999999999'), (e) => e.status === 404)
})
