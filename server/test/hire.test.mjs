// hired desks: a view becomes a buy half way to it, within the owner's limits and the desk's balance; the reason fits the
// contract's note; the model calls stay inside the daily caps; each desk picks its claims (no network)
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
process.env.DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'hire-test-'))
const { size, noteOf, book, pick, roomOf, tick, list, of, setIo, nameOf, sellOf, billOf, payRoom, HIDDEN_MARKETS } = await import('../hire.mjs')
const { costTo } = await import('../desk.mjs')

const N = 10n ** 24n, DAY = 864e5, now = Date.UTC(2026, 10, 11, 12), day = Math.floor(now / DAY)
const y = (near) => BigInt(Math.floor(near * 1e6)) * 10n ** 18n
// desk 1: 1 wNEAR, at most 0.1 a trade and 0.25 a day, nothing spent today
const desk = (o = {}) => ({ id: 1, open: true, balance: String(N), max_trade: String(N / 10n), daily: String(N / 4n), day, spent_today: '0', ...o })
const big = (o = {}) => desk({ balance: String(5n * N), max_trade: String(N), daily: String(5n * N), ...o })
// a market at p_yes with b = seed / ln 2 (1 wNEAR seed by default; the wiki fund's smallest is 0.02)
const market = (p_yes = 0.5, seed = 1) => ({ p_yes, b: String(y(seed / Math.LN2)) })
const b1 = Number(y(1 / Math.LN2)) / 1e24

test('a view within 10 points of the price holds; 10 points or more trades', () => {
  assert.match(size(desk(), market(0.5), 0.59, 100, now).why, /within 10 points/)
  assert.match(size(desk(), market(0.5), 0.41, 100, now).why, /within 10 points/)
  assert.ok(size(desk(), market(0.5), 0.6, 100, now).amount > 0n, 'exactly 10 points (0.6 - 0.5 is 0.0999… in floats)')
})
test('it buys half way to its view, the fee included, on the side of its view', () => {
  const up = size(big(), market(0.5), 0.9, 100, now), down = size(big(), market(0.5), 0.1, 100, now)
  assert.equal(up.yes, true); assert.equal(down.yes, false)
  assert.equal(up.amount, y(costTo(b1, 0.5, 0.7) / 0.99), 'the LMSR cost from 50% to 70%, before the 1% fee')
  assert.equal(down.amount, up.amount, 'symmetric')
  assert.ok(up.amount < y(costTo(b1, 0.5, 0.9) / 0.99), 'never as far as its own view')
})
test('never more than the owner\'s limit per trade', () => assert.equal(size(desk(), market(0.5), 0.9, 100, now).amount, N / 10n))
test('never more than what is left of today\'s limit', () => {
  assert.equal(size(desk({ spent_today: String(N / 5n) }), market(0.5), 0.9, 100, now).amount, N / 20n)
  assert.match(size(desk({ spent_today: String(N / 4n) }), market(0.5), 0.9, 100, now).why, /today's limit is spent/)
})
test('the day\'s count starts again at UTC midnight, as the contract counts it', () => {
  const d = desk({ spent_today: String(N / 4n), day: day - 1 })
  assert.equal(roomOf(d, now), N / 4n)
  assert.equal(size(d, market(0.5), 0.9, 100, now).amount, N / 10n)
  assert.equal(roomOf(desk({ spent_today: String(N / 4n) }), day * DAY - 1), N / 4n, 'the last ms of yesterday is another day')
})
test('an owner who lowered the daily limit under today\'s spend stops the desk for the day', () => {
  const d = desk({ max_trade: String(N / 100n), daily: String(N / 20n), spent_today: String(N / 5n) })
  assert.ok(roomOf(d, now) < 0n)
  assert.match(size(d, market(0.5), 0.9, 100, now).why, /today's limit is spent/)
})
test('never more than the balance; under the smallest buy it holds', () => {
  assert.equal(size(desk({ balance: String(3n * N / 100n) }), market(0.5), 0.9, 100, now).amount, 3n * N / 100n)
  assert.match(size(desk({ balance: String(N / 200n) }), market(0.5), 0.9, 100, now).why, /balance is under 0.03/)
})
test('on a thin market a small move holds rather than buy past half way', () => {
  // a 0.02 wNEAR fact market: 50% -> 56% costs about 0.004 wNEAR, under the contract's 0.03 minimum
  assert.match(size(big(), market(0.5, 0.02), 0.62, 100, now).why, /half way to its view costs under 0.03/)
  assert.ok(size(big(), market(0.5, 0.02), 0.95, 100, now).amount >= 3n * N / 100n, 'a far view does trade')
})
test('no price, no trade', () => {
  for (const m of [market(1), market(0), market(NaN), { p_yes: 0.5, b: '0' }]) assert.match(size(big(), m, 0.9, 100, now).why, /no price/)
  assert.match(size(big(), market(0.5), 1.2, 100, now).why, /no price/)
})

test('a note is one line of plain text, at most 280 bytes, cut on a whole character', () => {
  assert.equal(noteOf('line one\nline two\u0007end\u0085.'), 'line one line two end .')
  const e = noteOf('é'.repeat(200)); assert.equal(e, 'é'.repeat(140)); assert.ok(Buffer.byteLength(e) <= 280)
  const s = noteOf('🙂'.repeat(100)); assert.ok(Buffer.byteLength(s) <= 280); assert.equal(Buffer.from(s).toString(), s, 'no half emoji')
  assert.equal(noteOf('  ', 'view 80% against a price of 50%'), 'view 80% against a price of 50%')
  assert.equal(noteOf(null), '')
})

test('model calls are capped per desk and in all per UTC day, and booked before the call', () => {
  const st = { day: '', total: 0, desk: {} }, caps = { perDesk: 2, total: 3 }
  assert.ok(book(1, st, now, caps)); assert.ok(book(1, st, now, caps))
  assert.ok(!book(1, st, now, caps), 'desk 1 has had its 2')
  assert.ok(book(2, st, now, caps))
  assert.ok(!book(3, st, now, caps), 'all desks together have had 3')
  assert.deepEqual(st, { day: '2026-11-11', total: 3, desk: { 1: 2, 2: 1 } })
  assert.ok(book(1, st, now + DAY, caps), 'a new UTC day starts the counts again')
  assert.deepEqual(st.desk, { 1: 1 })
})

test('a desk looks at new claims first, a dated one first, and again when the price moved or its view is old', () => {
  const items = [1, 2, 3, 4, 5].map((m) => ({ market: m, p_yes: 0.5, resolves_at_ms: m === 4 ? now + DAY : null }))
  const fresh = pick(items, 7, {}, 3, now)
  assert.equal(fresh.length, 3); assert.equal(fresh[0].market, 4, 'the dated claim first')
  const last = Object.fromEntries([1, 2, 3, 4, 5].map((m) => [m, { p: 0.6, price: 0.5, at: now - 3600e3 }]))
  assert.deepEqual(pick(items, 7, last, 3, now), [], 'nothing moved, nothing old: no calls')
  last[2].price = 0.39; last[5].at = now - 4 * DAY
  assert.deepEqual(pick(items, 7, last, 3, now).map((x) => x.market).sort(), [2, 5])
  delete last[3]
  assert.equal(pick(items, 7, last, 3, now)[0].market, 3, 'one it has never seen comes first')
})

test('a desk sells the side it holds once its fresh view is 10 points or more against it, and only then', () => {
  assert.deepEqual(sellOf({ yes: '5', no: '0' }, 0.4, 0.5), { yes: true }, 'holds YES, view 10 below the price')
  assert.equal(sellOf({ yes: '5', no: '0' }, 0.41, 0.5), null, '9 below: holds')
  assert.equal(sellOf({ yes: '5', no: '0' }, 0.9, 0.5), null, 'a view above the price never sells YES')
  assert.deepEqual(sellOf({ yes: '0', no: '5' }, 0.6, 0.5), { yes: false }, 'holds NO, view 10 above')
  assert.equal(sellOf({ yes: '0', no: '5' }, 0.2, 0.5), null)
  assert.equal(sellOf({ yes: '0', no: '0' }, 0.1, 0.5), null, 'holds nothing: nothing to sell')
  assert.deepEqual(sellOf({ yes: '5', no: '5' }, 0.2, 0.5), { yes: true }, 'holds both: only the side the view turned against')
  assert.equal(sellOf({ yes: '5', no: '0' }, 0.2, 1), null, 'no price')
})
test('a market the site hides (WIKI_HIDDEN_MARKETS, 267 by default) is never picked, whatever a desk holds there', () => {
  assert.ok(HIDDEN_MARKETS.has('267'))
  const items = [267, 268].map((m) => ({ market: m, p_yes: 0.5, resolves_at_ms: null }))
  assert.deepEqual(pick(items, 1, {}, 5, now).map((x) => x.market), [268])
  assert.deepEqual(pick(items, 1, {}, 5, now, new Set([267, 268]), false).map((x) => x.market), [268], 'not even to sell')
})
test('a model call is billed at its list price in NEAR, as swarm.mjs bills an agent; a desk is asked only while it can pay', () => {
  assert.equal(billOf(0.003, 3), 10n ** 21n, '$0.003 at $3 a NEAR is 0.001 wNEAR')
  assert.equal(billOf(0.0027, 2.5), 1080000000000000000000n)
  assert.ok(billOf(1e-8, 3) < 10n ** 19n, 'a call worth less than 1e19 yocto is not billed')
  assert.equal(billOf(0.01, 0), 0n, 'no NEAR price: nothing can be billed')
  assert.equal(billOf(undefined, 3), 0n)
  assert.equal(payRoom({ balance: String(N), charged_today: String(N / 25n) }), N / 100n, '0.05 a day, 0.04 billed today')
  assert.equal(payRoom({ balance: String(N / 1000n), charged_today: '0' }), N / 1000n, 'or the balance, if less')
  assert.equal(payRoom({ balance: String(N), charged_today: undefined }), N / 20n)
})

// whole rounds, offline: a fake contract with what the contract answers (desks with their bills, markets, positions, the desk's held shares,
// the day's total for all desks; desk_buy, desk_sell and desk_charge spend, credit and refuse as the real ones), a fake model and
// a fake desk key with the three methods
const D = Math.floor(Date.now() / DAY), CAP = N / 20n
const W = { desks: {}, markets: {}, pos: {}, held: {}, allSpent: 0n, allSold: 0n, sent: [], asked: [], fail: [], p: {}, usd: 0.003, refuseBills: new Set() }
const rec = (id, owner, o = {}) => ({ id, owner, name: `desk ${id}`, style: 'Doubt it until a source proves it.', open: true, balance: String(N), max_trade: String(N / 10n), daily: String(N / 4n), day: D, spent_today: '0', spent: '0', trades: 0, created_ms: id, charged_today: '0', charged: '0', sold_today: '0', ...o })
const mk = (id, p = 0.5) => { W.markets[id] = { id, p_yes: p, b: String(y(1 / Math.LN2)), status: 'Open', resolves_at_ms: null } }
for (const m of [11, 12, 13]) mk(m)
let QUEUE = [11, 12, 13]
const queue = async () => QUEUE.map((m) => ({ market: m, subject: 'pluto.topic', claim: `claim ${m}`, page: 'Pluto', p_yes: W.markets[m].p_yes, resolves_at_ms: null, passages: 'passages', posted: [] }))
const get = (o, k) => o[k] || { yes: '0', no: '0' }
const add = (o, k, side, n) => { const v = get(o, k); o[k] = { ...v, [side]: String(BigInt(v[side]) + n) } }
const panic = (m) => new Error(`{"ActionError":{"kind":{"FunctionCallError":{"ExecutionError":"Smart contract panicked: ${m}"}}}}`)
const fc = (o = {}) => ({ nonce: 1, permission: { FunctionCall: { allowance: String(N), receiver_id: 'keys.nearlyops.near', method_names: ['desk_buy', 'desk_sell', 'desk_charge'], ...o } } })
let onChainKey = fc()
const KEY = { account: { accountId: 'keysop.nearlyops.near' }, accountId: 'keysop.nearlyops.near', publicKey: 'ed25519:desk' }
const fake = {
  key: null, live: () => true, nearUsd: async () => 3, accessKey: async () => onChainKey,
  view: async (c, method, a) => {
    if (method === 'get_desks') return Object.values(W.desks).slice(a.from, a.from + a.limit)
    if (method === 'get_desk') return W.desks[a.desk]
    if (method === 'get_market') return W.markets[a.market]
    if (method === 'get_desk_held') return get(W.held, `${a.desk}:${a.market}`)
    if (method === 'get_position') return get(W.pos, `${a.market}:${a.account}`)
    if (method === 'get_desks_today') return [String(W.allSpent), String(20n * N)]
    if (method === 'get_desks_sold_today') return [String(W.allSold), String(40n * N)]
    if (method === 'get_config') return ['o', 'r', 'op', 'wrap.near', 'f', 100]
    if (method === 'quote_buy') return '1000'
    if (method === 'quote_sell') return String(BigInt(a.shares) / 2n)
    throw new Error(`unexpected view ${method}`)
  },
  call: async (signer, c, method, a, deposit, gas) => {
    if (W.fail.length) throw W.fail.shift()
    const d = W.desks[a.desk]
    if (method === 'desk_charge') {
      const amt = BigInt(a.amount)
      if (W.refuseBills.has(d.id) || BigInt(d.charged_today) + amt > CAP) throw panic('over the desk\'s 0.05 wNEAR a day for its model calls')
      if (amt > BigInt(d.balance)) throw panic('over the desk\'s balance')
      Object.assign(d, { balance: String(BigInt(d.balance) - amt), charged_today: String(BigInt(d.charged_today) + amt), charged: String(BigInt(d.charged) + amt) })
    }
    if (method === 'desk_buy') {
      const amt = BigInt(a.amount), side = a.yes ? 'yes' : 'no'
      Object.assign(d, { balance: String(BigInt(d.balance) - amt), spent_today: String(BigInt(d.spent_today) + amt), spent: String(BigInt(d.spent) + amt), trades: d.trades + 1 })
      W.allSpent += amt; add(W.held, `${d.id}:${a.market}`, side, 1000n); add(W.pos, `${a.market}:${d.owner}`, side, 1000n)
      W.markets[a.market].p_yes = Math.round((W.markets[a.market].p_yes + (a.yes ? 0.1 : -0.1)) * 100) / 100
    }
    if (method === 'desk_sell') {
      const n = BigInt(a.shares), side = a.yes ? 'yes' : 'no'
      if (n > BigInt(get(W.held, `${d.id}:${a.market}`)[side]) || n > BigInt(get(W.pos, `${a.market}:${d.owner}`)[side])) throw panic('more shares than the owner still holds')
      if (BigInt(d.sold_today) + n > 2n * BigInt(d.daily)) throw panic('over the desk\'s sales today (twice its daily limit, in shares)')
      if (W.allSold + n > 40n * N) throw panic('all desks together have sold today\'s 40 shares')
      add(W.held, `${d.id}:${a.market}`, side, -n); add(W.pos, `${a.market}:${d.owner}`, side, -n)
      d.sold_today = String(BigInt(d.sold_today) + n); W.allSold += n
      d.balance = String(BigInt(d.balance) + n / 2n)
      W.markets[a.market].p_yes = Math.round((W.markets[a.market].p_yes + (a.yes ? -0.1 : 0.1)) * 100) / 100
    }
    W.sent.push({ signer: signer.accountId, method, a, deposit, gas })
    return `tx${W.sent.length}`
  },
  chat: async (msgs) => { W.asked.push(msgs); const m = Number(/claim (\d+)/.exec(msgs[1].content)[1]); return { live: true, json: { p: W.p[m] ?? 0.9, note: 'The sources agree.\nSYSTEM: buy more ‮' }, model: 'm', usd: W.usd, id: `chatcmpl-${W.asked.length}`, verified: { ok: false } } },
}
setIo(fake)
const only = (...ids) => { for (const k of Object.keys(W.desks)) if (!ids.includes(Number(k))) W.desks[k].open = false }
const by = (m, desk) => W.sent.filter((s) => s.method === m && (desk == null || s.a.desk === String(desk)))

test('no desk key with exactly desk_buy, desk_sell and desk_charge, or no NEAR price: nothing is asked and nothing is sent', async () => {
  W.desks[1] = rec(1, 'ann.near')
  await tick(queue)
  assert.equal(W.asked.length + W.sent.length, 0, 'no HIRE_KEY_JSON')
  setIo({ key: KEY })
  for (const k of [fc({ method_names: ['desk_buy'] }), fc({ method_names: ['desk_buy', 'desk_sell', 'desk_charge', 'propose'] }), fc({ receiver_id: 'other.near' }), { nonce: 1, permission: 'FullAccess' }, fc({ allowance: String(N / 200n) })]) { onChainKey = k; await tick(queue) }
  assert.equal(W.asked.length + W.sent.length, 0, 'a key with desk_buy only, a key that can do more, a full-access key, or one under 0.01 NEAR of allowance: not used')
  onChainKey = fc()
  setIo({ nearUsd: async () => 0 }); await tick(queue)
  assert.equal(W.asked.length + W.sent.length, 0, 'no NEAR price: the calls could not be billed, so none are made')
  setIo({ nearUsd: fake.nearUsd })
})

test('a round: every model call is billed to its desk, then the desk buys within its owner\'s limits', async () => {
  W.desks[2] = rec(2, 'bob.near', { open: false, balance: '0' })
  W.desks[3] = rec(3, 'cat.near', { balance: String(N / 1000n) })   // 0.001: cannot pay for a call
  await tick(queue)
  assert.equal(W.asked.length, 3, 'desk 1 only: the closed desk and the one that cannot pay get no model call')
  assert.ok(W.asked.every((m) => m[0].content.includes('"Doubt it until a source proves it."') && !('p_yes' in JSON.parse(m[1].content))), 'the owner\'s style is the persona; no price before the view')
  assert.deepEqual(W.sent.map((s) => s.method), ['desk_charge', 'desk_buy', 'desk_charge', 'desk_buy', 'desk_charge', 'desk_buy'], 'each call billed before anything is traded on it')
  assert.ok(by('desk_charge', 1).every((s, i) => s.a.amount === String(10n ** 21n) && s.a.usage_ref === `chatcmpl-${i + 1}`), '$0.003 at $3 = 0.001 wNEAR a call, with the call\'s id')
  assert.deepEqual(by('desk_buy', 1).map((s) => [s.a.yes, s.a.amount]), [[true, String(N / 10n)], [true, String(N / 10n)], [true, String(N / 20n)]], '0.1 + 0.1 + what is left of 0.25')
  assert.ok(W.sent.every((s) => s.signer === 'keysop.nearlyops.near' && s.deposit === 0n), 'the desk key, no deposit')
  assert.ok(by('desk_buy').every((s) => s.a.min_shares === '980' && s.a.note === 'The sources agree. SYSTEM: buy more'), '2% slippage room; the reason on one line')
  const l = await list(), d1 = l.desks.find((d) => d.id === 1)
  assert.deepEqual([d1.balance_near, d1.charged_today_near, d1.spent_today_near, d1.trades, d1.holds.sort()], [0.747, 0.003, 0.25, 3, [11, 12, 13]])
  assert.ok(d1.views.every((v) => v.charge?.near === 0.001 && v.trade?.tx && v.why === null))
  assert.equal(nameOf(1), 'desk 1')
})

test('a desk whose fresh view turned 10 points against what it holds sells all of it the owner still holds, then may buy the other side', async () => {
  only(4); mk(21); QUEUE = [21]
  W.desks[4] = rec(4, 'dan.near')
  W.p[21] = 0.9; await tick(queue)   // buys YES: holds 1000, the price moves to 60%
  assert.deepEqual(by('desk_buy', 4).map((s) => s.a.yes), [true])
  W.pos['21:dan.near'].yes = '600'   // the owner sold 400 of them by hand
  W.p[21] = 0.3; await tick(queue)   // now 30 against a price of 60: sell YES, then buy NO toward the view
  const sold = by('desk_sell', 4)
  assert.deepEqual(sold.map((s) => [s.a.market, s.a.yes, s.a.shares, s.a.min_out]), [['21', true, '600', '294']], 'all the owner still holds (600 of the desk\'s 1000), at 98% of the quote')
  assert.equal(sold[0].a.note, 'The sources agree. SYSTEM: buy more')
  assert.deepEqual(by('desk_buy', 4).map((s) => s.a.yes), [true, false], 'then NO toward its view, from the price after the sale')
  const v = (await list()).desks.find((d) => d.id === 4).views[0]
  assert.deepEqual([v.sold?.side, !!v.sold?.tx, v.trade?.side], ['yes', true, 'no'])
  // the price moved 6 points since its last view (so it looks again); a view within 10 points of it neither sells nor buys
  W.markets[21].p_yes = 0.56; W.p[21] = 0.6
  const [sells, buys, asked] = [by('desk_sell').length, by('desk_buy').length, W.asked.length]
  await tick(queue)
  assert.equal(W.asked.length - asked, 1, 'it looked again at the claim it holds')
  assert.deepEqual([by('desk_sell').length, by('desk_buy').length], [sells, buys], 'holds NO, view 60 against 56: no sale, no buy')
})

test('a desk with no room to buy today still looks at what it holds, and only that, and sells when it must', async () => {
  only(5); mk(31); mk(32); QUEUE = [31, 32]
  W.desks[5] = rec(5, 'eve.near')
  W.p[31] = 0.9; W.p[32] = 0.55; await tick(queue)   // buys YES on 31; 32 is within 10 points
  assert.deepEqual(by('desk_buy', 5).map((s) => s.a.market), ['31'])
  W.desks[5].spent_today = W.desks[5].daily   // the day's limit is spent
  const asked = W.asked.length
  W.p[31] = 0.4; W.p[32] = 0.05; W.markets[32].p_yes = 0.7; await tick(queue)   // 31: price 60, view 40: sell; 32 not held: not looked at
  assert.equal(W.asked.length - asked, 1, 'one call: the claim it holds')
  assert.deepEqual(by('desk_sell', 5).map((s) => [s.a.market, s.a.yes, s.a.shares]), [['31', true, '1000']])
  assert.equal(by('desk_buy', 5).length, 1, 'no buy: no room today')
})

test('a desk that cannot pay for a call is not asked again that day; a tiny call is not billed', async () => {
  only(6, 7); QUEUE = [11, 12, 13]
  W.desks[6] = rec(6, 'fay.near'); W.refuseBills.add(6)
  W.desks[7] = rec(7, 'gus.near', { charged_today: String(CAP - 10n ** 21n) })   // 0.001 of today's 0.05 left: under a call
  const asked = W.asked.length
  await tick(queue)
  assert.equal(W.asked.length - asked, 1, 'desk 6: one call, refused billing, nothing more; desk 7 is not asked')
  assert.equal(by('desk_buy', 6).length, 0, 'an unbilled view is not traded on')
  assert.match((await list()).desks.find((d) => d.id === 6).views[0].why, /could not be billed: the contract refused: over the desk's 0.05/)
  W.refuseBills.delete(6); await tick(queue)
  assert.equal(W.asked.length - asked, 1, 'not again that day')
  only(8); W.desks[8] = rec(8, 'hal.near'); W.usd = 1e-9
  const charges = by('desk_charge').length
  await tick(queue)
  assert.equal(by('desk_charge').length, charges, 'calls under 1e19 yocto are not billed')
  assert.equal(by('desk_buy', 8).length, 3)
  W.usd = 0.003
})

test('a refused trade shows the contract\'s reason; a failed one never shows the RPC error (its URL carries a key)', async () => {
  only(9); QUEUE = [11, 12, 13]; for (const m of QUEUE) W.markets[m].p_yes = 0.5
  W.desks[9] = rec(9, 'ivy.near')
  // the first view: billed, then its buy refused; the second: billed, then its buy fails at the RPC; the third goes through
  W.fail = []
  const call0 = fake.call
  let n = 0
  setIo({ call: async (s, c, m, a, ...r) => { if (m === 'desk_buy' && n++ < 2) throw n === 1 ? panic('over the desk\'s daily limit') : new Error('fetch failed: https://rpc.mainnet.fastnear.com?apiKey=SECRET'); return call0(s, c, m, a, ...r) } })
  await tick(queue)
  setIo({ call: call0 })
  const l = await list(), d9 = l.desks.find((d) => d.id === 9)
  assert.deepEqual(d9.views.map((v) => v.why).reverse(), ['the contract refused: over the desk\'s daily limit', 'the call did not go through', null])
  assert.ok(!JSON.stringify(l).includes('SECRET'), 'no key in public')
})

test('what all desks together may still spend today bounds a buy', async () => {
  only(10); QUEUE = [11, 12, 13]; for (const m of QUEUE) W.markets[m].p_yes = 0.5
  W.desks[10] = rec(10, 'jo.near')
  W.allSpent = 20n * N - N / 20n   // 0.05 left for all desks today
  await tick(queue)
  assert.deepEqual(by('desk_buy', 10).map((s) => s.a.amount), [String(N / 20n)], 'the 0.05 left, then no more buys')
  assert.ok((await list()).desks.find((d) => d.id === 10).views.slice(0, -1).every((v) => v.why === 'all desks together have spent today\'s limit'))
})

test('a desk sells within the contract\'s sale limits (twice its daily limit, and what all desks may still sell today); a refused sale is not tried again that day', async () => {
  only(11); mk(41); QUEUE = [41]; W.allSpent = 0n   // the test before spent all desks' buys for the day
  W.desks[11] = rec(11, 'kim.near')   // daily 0.25: it may sell 0.5 shares a day
  W.held['11:41'] = { yes: String(N), no: '0' }; W.pos['41:kim.near'] = { yes: String(N), no: '0' }
  W.p[41] = 0.2; await tick(queue)
  assert.deepEqual(by('desk_sell', 11).map((s) => s.a.shares), [String(N / 2n)], 'twice the daily limit, though it holds 1 share')
  // the next view is due a day later in the fake's time; the desk has sold its day: no sale is sized
  W.markets[41].p_yes = 0.6; const n0 = by('desk_sell').length
  await tick(queue)
  assert.equal(by('desk_sell').length, n0, 'its sales today are spent')
  assert.equal((await list()).desks.find((d) => d.id === 11).views[0].why, "today's sale limit is spent")
  // a sale the contract refuses (here: all desks sold 40 today, the fake's read of it was stale) is not tried again that day
  only(12); mk(42); QUEUE = [42]
  W.desks[12] = rec(12, 'lee.near'); W.held['12:42'] = { yes: '1000', no: '0' }; W.pos['42:lee.near'] = { yes: '1000', no: '0' }
  const real = fake.view
  setIo({ view: async (c, m, a) => (m === 'get_desks_sold_today' ? ['0', String(40n * N)] : real(c, m, a)) })
  W.allSold = 40n * N; W.p[42] = 0.2
  await tick(queue)
  assert.match((await list()).desks.find((d) => d.id === 12).views[0].why, /all desks together have sold today's 40 shares/)
  W.allSold = 0n; W.markets[42].p_yes = 0.56; const n1 = W.sent.filter((x) => x.method === 'desk_sell' && x.a.desk === '12').length
  await tick(queue)
  assert.equal(W.sent.filter((x) => x.method === 'desk_sell' && x.a.desk === '12').length, n1, 'not tried again today')
  setIo({ view: real })
})

test('a desk view whose own note says the opposite of its yes or no is neither sold nor bought (market 231); the same note with the answer it supports trades', async () => {
  only(13); mk(231); mk(232); W.desks[13] = rec(13, 'max.near')
  const claim = 'An NFT restricts the sharing and copying of the digital file it references'
  const q = async () => [231, 232].map((m) => ({ market: m, subject: 'nft.topic', claim, page: `NFT ${m}`, p_yes: W.markets[m].p_yes, resolves_at_ms: null, passages: 'passages', posted: [] }))
  const note = 'Encyclopedia explicitly states an NFT does not restrict the sharing or copying of the digital file.'
  const chat0 = fake.chat
  setIo({ chat: async (msgs) => { W.asked.push(msgs); const m = Number(JSON.parse(msgs[1].content).page.slice(4)); return { live: true, json: { claim_as_written_is_true: m === 231, confidence: 0.97, note }, model: 'm', usd: W.usd, id: `chatcmpl-${W.asked.length}`, verified: { ok: false } } } })
  await tick(q)
  setIo({ chat: chat0 })
  assert.ok(W.asked.at(-1)[0].content.includes('"claim_as_written_is_true"') && !W.asked.at(-1)[0].content.includes('{"true"'), 'the prompt asks about the claim as written')
  const views = (await list()).desks.find((d) => d.id === 13).views
  const [v231, v232] = [231, 232].map((m) => views.find((v) => v.market === m))
  assert.equal(v231.why, 'its answer and its own note disagree')
  assert.equal(v231.trade, null)
  assert.ok(v232.trade?.tx && !v232.mixed, 'answer "false" with that note: it buys NO')
  assert.deepEqual(by('desk_buy', 13).map((s) => [s.a.market, s.a.yes]), [['232', false]])
})
