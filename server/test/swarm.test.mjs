// the trade guard: code checks the brain's answer against the owner's rules on the numbers it was shown (no network)
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
process.env.DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'keys-test-'))
const { refused, rulesOf, RETRY_SOON, fromSnapshot } = await import('../swarm.mjs')

const H = 3600e3, now = Date.now()
const L = (token, symbol, age_h, v1h, v6h, holders) => ({ token, symbol, created_at_ms: now - age_h * H, volume_1h_near: v1h, volume_6h_near: v6h, holders })
const mine = L('mine-8.nearlytrade.near', 'MINE', 14, 22, 660, 108), copy = L('mine-10.nearlytrade.near', 'MINE', 13, 0, 20, 3)
const old = L('batman-17.nearlytrade.near', 'BATMAN', 972, 5, 40, 900), young = L('test-1.nearlytrade.near', 'TEST', 2, 10, 12, 20)
const list = [mine, copy, old, young]
const l = { list, byToken: new Map(list.map((x) => [x.token, x])), bySym: new Map([['MINE', mine], ['BATMAN', old], ['TEST', young]]), holdersPrev: new Map([[young.token, 15]]) }
const listed = [{ symbol: 'USDC' }, { symbol: 'wNEAR' }]
const agent = { rules: { max_age_h: 6, rising: true, cooldown_h: 24, skip: ['MINE', 'NEARLY', 'mine-8.nearlytrade.near'] }, trades: [{ t: now - 18.7 * H, side: 'buy', token: 'USDC', usd: 2, route: 'intents' }] }
const buy = (token, usd = 5) => ({ type: 'buy', token, usd })

test('a brain that says hold but asks to buy is held', () => assert.match(refused(agent, { decision: 'hold' }, buy('MINE', 10), l, listed), /decided "hold" but asked to buy/))
test('no decision field is held', () => assert.match(refused(agent, {}, buy('USDC', 2), l, listed), /decided "nothing"/))
test('the skip list holds by symbol', () => assert.match(refused(agent, { decision: 'buy' }, buy('MINE', 10), l, listed), /skip list/))
test('the skip list holds a same-symbol launch named by contract', () => assert.match(refused(agent, { decision: 'buy' }, buy(copy.token), l, listed), /skip list/))
test('a launch older than max_age_h is held', () => assert.match(refused(agent, { decision: 'buy' }, buy('BATMAN'), l, listed), /BATMAN is 97\d\.\dh old, the rule is under 6h/))
test('a second buy inside the cooldown is held', () => assert.match(refused(agent, { decision: 'buy' }, buy('USDC', 2), l, listed), /bought USDC within 24h/))
test('a sell is not held by buy rules', () => assert.equal(refused(agent, { decision: 'sell' }, { type: 'sell', token: 'USDC', usd: 2 }, l, listed), null))
test('a buy after the cooldown passes', () => assert.equal(refused({ ...agent, trades: [{ ...agent.trades[0], t: now - 25 * H }] }, { decision: 'buy' }, buy('USDC', 2), l, listed), null))
test('a young launch with rising volume and holders passes', () => assert.equal(refused(agent, { decision: 'buy' }, buy('TEST'), l, listed), null))
test('holders that did not grow are held', () => {
  const l2 = { ...l, holdersPrev: new Map([[young.token, 25]]) }
  assert.match(refused(agent, { decision: 'buy' }, buy('TEST'), l2, listed), /holders did not grow \(25 -> 20\)/)
})
test('no holder count from an hour ago is held', () => assert.match(refused(agent, { decision: 'buy' }, buy('TEST'), { ...l, holdersPrev: new Map() }, listed), /no count from an hour ago/))
test('1h volume under the 6h hourly average is held', () => {
  const slow = { ...young, volume_1h_near: 1 }, l2 = { ...l, byToken: new Map([[slow.token, slow]]), bySym: new Map([['TEST', slow]]) }
  assert.match(refused(agent, { decision: 'buy' }, buy('TEST'), l2, listed), /1h volume is not above its 6h average/)
})
test('an agent without rules is only held for contradicting itself', () => {
  assert.equal(refused({}, { decision: 'buy' }, buy('BATMAN'), l, listed), null)
  assert.match(refused({}, { decision: 'sell' }, buy('BATMAN'), l, listed), /decided "sell"/)
})
test('rulesOf keeps only well-formed rules', () => {
  assert.deepEqual(rulesOf({ max_age_h: 6, rising: true, cooldown_h: 24, skip: ['A', 1] }), { max_age_h: 6, rising: true, cooldown_h: 24, skip: ['A', '1'] })
  assert.deepEqual(rulesOf({ max_age_h: -1, rising: 'yes', cooldown_h: 'x', skip: 'A' }), { max_age_h: undefined, rising: undefined, cooldown_h: undefined, skip: undefined })
  assert.equal(rulesOf({ skip: Array.from({ length: 80 }, (_, i) => 'T' + i) }).skip.length, 50)
  assert.deepEqual(rulesOf(), { max_age_h: undefined, rising: undefined, cooldown_h: undefined, skip: undefined })
})

test('a review refused for its bytes or the pin is tried again in 10 min, the refusal wording of the pin included', () => {
  for (const m of ['voice Scholar was not signed under the registered reviewer prompt', 'the review was not signed under the registered reviewer prompt', "the signed request is not this reviewer's", 'the review names another job', 'every voice carries signed bytes', "the judge's signature does not verify"]) assert.ok(RETRY_SOON.test(m), m)
  for (const m of ['already reviewed by a panel', 'a receipt used twice', 'note max 300 chars']) assert.ok(!RETRY_SOON.test(m), m)
})
test('a settled bid shows its settlement snapshot; an open bid, fresh or reopened, reads the chain', () => {
  assert.equal(fromSnapshot({ swarm: true, status: { Approved: { agent: 'a' } }, workers: [] }), true)
  assert.equal(fromSnapshot({ swarm: true, status: 'Open', workers: [] }), false)   // reopened after "no passing entry"
  assert.equal(fromSnapshot({ swarm: true, status: 'Open', workers: ['a'] }), false)
  assert.equal(fromSnapshot({ swarm: false, status: 'Open', workers: [] }), false)
})
