import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decide, JUDGES, judgeJson } from '../markets.mjs'

const v = (model, outcome, confidence, extra = {}) => ({ model, outcome, confidence, reason: 'r', verified: true, live: true, ai_id: 'x', receipt: { bytes: { request: 'q', response: 'a' }, signature: 's' }, ...extra })

test('three judges are configured, from three labs', () => {
  assert.equal(JUDGES.length, 3)
  assert.equal(new Set(JUDGES.map((m) => m.split('/')[0].toLowerCase())).size, 3)
})
test('two of three decide, the surest on that side is the deciding voice, and all three signed verdicts go on chain, the dissenter too', () => {
  const d = decide([v('a/one', false, 0.8), v('b/two', false, 0.97), v('c/three', true, 0.99)])
  assert.equal(d.outcome, false); assert.equal(d.confidence, 0.97); assert.match(d.judge, /2 of 3/)
  assert.deepEqual(d.voices.map((x) => x.model), ['a/one', 'b/two', 'c/three'])
  assert.equal(d.panel.length, 3)
})
test('no majority, no ruling; an undecided voice does not count for either side', () => {
  assert.equal(decide([v('a/one', true, 0.95), v('b/two', false, 0.95), v('c/three', null, 0)]).outcome, null)
  assert.equal(decide([v('a/one', true, 0.95), v('b/two', null, 0), v('c/three', null, 0)]).outcome, null)
})
test('a majority whose surest voice is under 0.9 does not rule', () => {
  const d = decide([v('a/one', true, 0.85), v('b/two', true, 0.7), v('c/three', false, 0.99)])
  assert.equal(d.outcome, null); assert.match(d.reason, /under 0.9/)
})
test('a voice without a verified signature, or without a verdict, is listed but its bytes never go on chain (so the panel is not three, and the single-receipt path is used)', () => {
  const d = decide([v('a/one', true, 0.95), v('b/two', true, 0.92, { verified: false, receipt: null }), v('c/three', false, 0.5)])
  assert.equal(d.outcome, true); assert.deepEqual(d.voices.map((x) => x.model), ['a/one', 'c/three'])
  const e = decide([v('a/one', true, 0.95), v('b/two', true, 0.92), v('c/three', null, 0)])
  assert.equal(e.outcome, true); assert.deepEqual(e.voices.map((x) => x.model), ['a/one', 'b/two'])
})
test('a judge that abstains in its signed answer ("outcome": null) goes on chain beside the two verdicts, so the panel is three and no single-signature fallback is needed', () => {
  const d = decide([v('a/one', true, 0.95), v('b/two', true, 0.92), v('c/three', null, 0, { receipt: { bytes: { request: 'q', response: '{"outcome": null, "reason": "cannot tell"}' }, signature: 's' } })])
  assert.equal(d.outcome, true); assert.deepEqual(d.voices.map((x) => x.model), ['a/one', 'b/two', 'c/three'])
  const e = decide([v('a/one', true, 0.95), v('b/two', true, 0.92), v('c/three', null, 0, { receipt: { bytes: { request: 'q', response: '{\\"result\\": {\\"outcome\\": null}}' }, signature: 's' } })])
  assert.deepEqual(e.voices.map((x) => x.model), ['a/one', 'b/two', 'c/three'], 'escaped once inside a JSON string counts too')
})
test("a judge who finds the wording invalid stays on chain beside two agreeing judges (the contract takes it as an abstention), and two such judges make an invalid panel", () => {
  const inv = (m) => v(m, null, 0.8, { invalid: true })
  const d = decide([v("a/one", true, 0.97), v("b/two", true, 0.95), inv("c/three")])
  assert.equal(d.outcome, true); assert.deepEqual(d.voices.map((x) => x.model), ["a/one", "b/two", "c/three"])
  const i = decide([inv("a/one"), inv("b/two"), v("c/three", true, 0.99)])
  assert.equal(i.invalid, true); assert.equal(i.outcome, null); assert.equal(i.voices.length, 3)
})
test("half an emoji in the evidence is written well formed, so the contract can read the judge JSON", () => {
  const s = judgeJson({ task: "judge", evidence: { posted_sources: [{ note: "x\ud83d", title: "ok \ud83d\ude00" }] } })
  assert.ok(!/\\ud83d/i.test(s), s); assert.ok(s.includes("\ud83d\ude00")); assert.ok(s.includes("x\ufffd"))
})
