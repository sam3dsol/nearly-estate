import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bytesPass } from '../swarm.mjs'

// a review whose result has a line break failed on chain every round ("the signed request is not about this market"),
// because inside the signed request the break is escaped in a way the contract's check does not undo
const wrap = (result) => JSON.stringify({ messages: [{ role: 'user', content: JSON.stringify({ task: 'review', result }) }] })
test('a plain result passes the contract check', () => { assert.equal(bytesPass(wrap('NEAR is up 3% today'), 'NEAR is up 3% today'), true) })
test('a result with quotes passes (escaped twice)', () => { const r = 'the "best" token'; assert.equal(bytesPass(wrap(r), r), true) })
test('a result with a backslash passes', () => { const r = 'a\\b path'; assert.equal(bytesPass(wrap(r), r), true) })
// the contract now undoes JSON's escaping too, so a three-line answer goes on chain with its bytes and its panel
test('a result with a line break passes (JSON-escaped twice)', () => { const r = 'line one\nline two'; assert.equal(bytesPass(wrap(r), r), true) })
test('a result with a tab and a backslash on two lines passes', () => { const r = 'one\ttwo\nC:\\x "q"'; assert.equal(bytesPass(wrap(r), r), true) })
test('the same words on one line are not the reviewed text', () => { const r = 'line one\nline two'; assert.equal(bytesPass(wrap(r), 'line one line two'), false) })
// the review panel: three sealed reviewers, two of three decide, the middle score on the winning side goes on chain
import { panelVerdict, PANEL } from "../swarm.mjs"
const v = (name, ok, score) => ({ name, ok, score })
test("three named reviewers", () => { assert.deepEqual(PANEL.map((p) => p.name), ["Scholar", "Contrarian", "Bayesian"]) })
test("two of three passing approve; the lower passing score decides", () => {
  const r = panelVerdict([v("Scholar", true, 78), v("Contrarian", false, 40), v("Bayesian", true, 70)])
  assert.equal(r.ok, true); assert.equal(r.yes, 2); assert.equal(r.dec.name, "Bayesian")
})
test("two of three failing reject", () => { const r = panelVerdict([v("Scholar", true, 80), v("Contrarian", false, 30), v("Bayesian", false, 45)]); assert.equal(r.ok, false); assert.equal(r.dec.name, "Contrarian") })
test("all three passing: the middle score decides", () => { assert.equal(panelVerdict([v("Scholar", true, 90), v("Contrarian", true, 60), v("Bayesian", true, 75)]).dec.name, "Bayesian") })
test("with two voices both must pass", () => { assert.equal(panelVerdict([v("Scholar", true, 90), v("Contrarian", false, 30)]).ok, false); assert.equal(panelVerdict([v("Scholar", true, 90), v("Bayesian", true, 70)]).ok, true) })

// review: a dissent stored before the fix read "ok: true" (the receipt check), the signed response says false
import { voiceOf } from "../swarm.mjs"
test("a panel voice reads its verdict from its own signed response", () => {
  const response = JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: false, score: 35, note: "unsupported claim" }) } }] })
  const v = voiceOf({ name: "Contrarian", ok: true, score: 35, bytes: { request: "{}", response } })
  assert.equal(v.ok, false); assert.equal(v.score, 35); assert.equal(v.name, "Contrarian")
  assert.deepEqual(voiceOf({ name: "Scholar", ok: true, score: 80 }), { name: "Scholar", ok: true, score: 80 })   // no bytes: as stored
})

// a refused accept or review is remembered across restarts (it was a Map: each enclave start retried it, gas each time)
import { tryLater } from "../swarm.mjs"
import { table as tbl } from "../store.mjs"
test("a refusal recorded on disk keeps the next try away for 6 h", () => {
  tbl("refused").v["accept:16:x.near"] = Date.now() - 60e3
  assert.equal(tryLater("accept:16:x.near"), true)
  tbl("refused").v["accept:16:y.near"] = Date.now() - 7 * 3600e3
  assert.equal(tryLater("accept:16:y.near"), false)
  assert.equal(tryLater("never:seen"), false)
})

// the reviewers' prompt pinned on chain: the system message is the pinned text itself, verbatim; the reviewer line and the lens
// move into the user message; no persona name anywhere in the request. Unpinned, the name opens the system message.
import { reviewMessages, REVIEW_SYS, REVIEWER_LINE } from '../swarm.mjs'
import { createHash } from 'node:crypto'
test('pinned: the system message is the pinned text verbatim and the user message opens with the reviewer line, no name', () => {
  const user = { role: 'user', content: JSON.stringify({ task: 'review', job: 22, bid: 'write three lines', result: 'one\ntwo\nthree' }) }
  for (const p of PANEL) {
    const m = reviewMessages(p, user, REVIEW_SYS)
    assert.equal(m.length, 2)
    assert.deepEqual(m[0], { role: 'system', content: REVIEW_SYS })
    assert.deepEqual(Object.keys(m[1]), ['role', 'content']); assert.equal(m[1].role, 'user')
    assert.ok(m[1].content.startsWith(REVIEWER_LINE + p.lens + '\n'))
    assert.ok(m[1].content.endsWith(user.content))
    for (const n of ['Scholar', 'Contrarian', 'Bayesian']) assert.ok(!m[0].content.includes(n) && !m[1].content.includes(n), 'no persona name')
    assert.ok(JSON.stringify({ messages: m }).includes('\\"job\\":22,'), 'the job is named where the contract reads it')
  }
  assert.equal(REVIEWER_LINE, 'You are one of three reviewers; two of three decide. ')
})
test('unpinned: the name opens the system message and the user message is the job JSON', () => {
  const user = { role: 'user', content: '{"task":"review","job":22}' }
  const m = reviewMessages(PANEL[0], user, null)
  assert.ok(m[0].content.startsWith('You are Scholar, one of three reviewers; two of three decide. ') && m[0].content.endsWith(REVIEW_SYS))
  assert.equal(m[1], user)
})
test('the text the owner pins is REVIEW_SYS as sent: 660 bytes, sha256 f105d56f…', () => {
  assert.equal(REVIEW_SYS.length, 660)
  assert.equal(createHash('sha256').update(REVIEW_SYS).digest('hex'), 'f105d56f009d14e253b4bf20d74f9f797dda2de3b8bd831d67f9ad74d52ffaea')
})
