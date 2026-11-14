import { test } from 'node:test'
import assert from 'node:assert/strict'
import { askGate, autoRuleAt, setFirstTrade } from '../markets.mjs'

// an undated market cannot be ruled on an early ask; the judges come at its automatic time
const H = 3600e3, T0 = 1_794_000_000_000
test('an undated market refuses the ask until 72 hours after its first trade', () => {
  setFirstTrade((id) => (id === 7 ? T0 : null))
  const m = { id: 7, resolves_at_ms: null }
  assert.equal(autoRuleAt(m), T0 + 72 * H)
  const early = askGate(m, T0 + 60e3)
  assert.equal(early.status, 409); assert.equal(early.message, 'the judges rule 72 hours after the first trade'); assert.equal(early.rule_at_ms, T0 + 72 * H)
  assert.equal(askGate(m, T0 + 72 * H - 1).status, 409)
  assert.equal(askGate(m, T0 + 72 * H), null)        // the time has come: the ask goes through, as the automatic ruler does
  assert.equal(askGate(m, T0 + 100 * H), null)
})
test('an undated market with no trade yet refuses the ask', () => {
  setFirstTrade(() => null)
  const g = askGate({ id: 8, resolves_at_ms: null }, T0)
  assert.equal(g.status, 409); assert.equal(g.rule_at_ms, null)
})
test('a dated market is not touched by the gate (its own date decides)', () => {
  setFirstTrade(() => T0)
  assert.equal(askGate({ id: 9, resolves_at_ms: T0 + 5 * H }, T0), null)
  assert.equal(askGate({ id: 9, resolves_at_ms: T0 - 5 * H }, T0), null)
})
