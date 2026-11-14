import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defendPlan } from '../markets.mjs'

const NOW = 1_700_000_000_000, N = (x) => (BigInt(x) * 10n ** 24n).toString()
const proposed = (outcome, by = 'x.near') => ({ id: 1, status: { Proposed: { outcome, at_ms: NOW - 3600e3, by } } })
const challenged = (outcome, round, bond) => ({ id: 1, status: { Challenged: { outcome, round, bond: N(bond), at_ms: NOW - 3600e3, by: 'x.near' } } })

test('one challenge: a challenged market is never countered, the judges look again and that is final', () => {
  assert.equal(defendPlan(challenged(false, 1, 1), true, { now: NOW }).skip, 'the judges give the final ruling')
  assert.equal(defendPlan(challenged(true, 1, 1), true, { now: NOW }).skip, "the judges' side leads")
})
test("an outsider's proposal against the judges is challenged with 1 NEAR; one on their side is left alone", () => {
  assert.deepEqual(defendPlan(proposed(false), true, { now: NOW }), { bond: 1, round: 1, side: true })
  assert.equal(defendPlan(proposed(true), true, { now: NOW }).skip, "the judges' side leads")
})
test('the caps hold on that challenge: the day cap, the reserve, the window, no ruling', () => {
  assert.match(defendPlan(proposed(false), true, { now: NOW, spent: 9.5 }).skip, /day cap/)
  assert.equal(defendPlan(proposed(false), true, { now: NOW, balance: 1.2 }).skip, 'the defender is short')
  assert.equal(defendPlan(proposed(false), true, { now: NOW + 25 * 3600e3 }).skip, 'window closed')
  assert.equal(defendPlan(proposed(false), null, { now: NOW }).skip, 'the judges did not rule')
  assert.equal(defendPlan({ id: 1, status: 'Open' }, true, { now: NOW }).skip, 'nothing to counter')
})
