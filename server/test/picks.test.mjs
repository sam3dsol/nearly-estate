import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanName, outcomeOf, statusOf, pickable, scoreBoard, lean, dropTestPlayers } from '../picks.mjs'

test('a chosen name: letters, digits, spaces and . _ -, 2 to 24 long; anything else is no name', () => {
  assert.equal(cleanName('  Ana  B. '), 'Ana B.')
  assert.equal(cleanName('nearfan_42'), 'nearfan_42')
  assert.equal(cleanName('a'), null)
  assert.equal(cleanName('<script>'), null)
  assert.equal(cleanName('x'.repeat(25)), null)
})
test('the answer is the judges\' outcome once a market is ruled, challenged or resolved; none while open', () => {
  assert.equal(outcomeOf({ status: 'Open' }), null)
  assert.equal(outcomeOf({ status: { Proposed: { outcome: true, at_ms: 1 } } }), true)
  assert.equal(outcomeOf({ status: { Challenged: { outcome: false } } }), false)
  assert.equal(outcomeOf({ status: { Resolved: { outcome: false } } }), false)
  assert.equal(statusOf({ status: { Resolved: { outcome: true } } }), 'Resolved')
})
test('a pick can change while the market is open and its date has not passed', () => {
  assert.equal(pickable({ id: 5, status: 'Open', resolves_at_ms: null }, 1000), true)
  assert.equal(pickable({ id: 5, status: 'Open', resolves_at_ms: 2000 }, 1000), true)
  assert.equal(pickable({ id: 5, status: 'Open', resolves_at_ms: 2000 }, 2000), false, 'its date has passed')
  assert.equal(pickable({ id: 5, status: { Proposed: { outcome: true } } }, 1000), false, 'ruled')
  assert.equal(pickable({ id: 310, status: 'Open' }, 1000), false, 'a hidden market')
  assert.equal(pickable(undefined), false)
})
test('the board: players with a ruled pick, right first; the AI agents on the same markets by the side of their view', () => {
  const players = {
    aaaa1111bbbb: { name: 'Ana', picks: { 1: { yes: true }, 2: { yes: false }, 3: { yes: true } } },   // 1 right, 2 wrong, 3 open
    cccc2222dddd: { name: null, picks: { 1: { yes: true }, 2: { yes: true } } },                       // both right
    eeee3333ffff: { name: 'Open only', picks: { 3: { yes: false } } },                                 // nothing ruled: not on the board
  }
  const outcome = (mk) => ({ 1: true, 2: true }[mk] ?? null)
  const views = (mk) => ({ 1: [{ name: 'Scholar', p: 0.9 }, { name: 'Contrarian', p: 0.3 }], 2: [{ name: 'Scholar', p: 0.8 }, { name: 'Contrarian', p: 0.5 }] }[mk] ?? [])
  const b = scoreBoard(players, outcome, views)
  assert.deepEqual(b.map((r) => [r.name, r.right, r.ruled, r.ai]), [['player cccc', 2, 2, false], ['Scholar', 2, 2, true], ['Ana', 1, 2, false], ['Contrarian', 0, 1, true]])
  assert.ok(!b.some((r) => r.name === 'Open only'))
})
test('how the crowd and the AIs lean on one market', () => {
  const players = { a: { picks: { 7: { yes: true } } }, b: { picks: { 7: { yes: false } } }, c: { picks: { 7: { yes: true } } }, d: { picks: {} } }
  assert.deepEqual(lean(players, 7, () => [{ name: 'Bayesian', p: 0.734 }]), { market: 7, crowd: { yes: 2, no: 1 }, ai: [{ name: 'Bayesian', p: 0.73 }] })
})

test('the judge rounds\' test players leave the board once: ui test*, judge nine; real players and the flag stay', () => {
  const players = { a: { name: 'ui test', picks: {} }, b: { name: 'UI TEST 3', picks: {} }, c: { name: 'judge nine', picks: {} }, d: { name: 'judge check', picks: {} }, e: { name: 'Ana B.', picks: {} }, f: { name: null, picks: {} } }
  const flags = {}
  assert.equal(dropTestPlayers(players, flags), 3)
  assert.deepEqual(Object.keys(players), ['d', 'e', 'f'])
  assert.ok(flags.picks_purged)
  players.g = { name: 'ui test 9', picks: {} }
  assert.equal(dropTestPlayers(players, flags), 0)   // the flag: it runs once
  assert.ok(players.g)
  assert.equal(dropTestPlayers({ x: { name: 'Judge Check', picks: {} }, y: { name: 'Ana', picks: {} } }, {}, [/^judge check$/i], 'picks_purged_2'), 1)   // the second pass: "judge check" too
})
