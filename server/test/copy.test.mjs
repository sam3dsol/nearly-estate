// copy trading: a swap behind a key becomes the right order for a copier, sized by its ratio and capped by its own cap,
// with the $1 floor and one copy a minute; the trade goes to the copier's Agent API wallet (a fake agents backend here)
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import http from 'node:http'
process.env.DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-test-'))
const sent = []
const bff = http.createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { sent.push({ url: req.url, body: JSON.parse(b || '{}') }); res.end(JSON.stringify({ route: 'intents', status: 'SUCCESS' })) }) })
await new Promise((r) => bff.listen(0, '127.0.0.1', r))
process.env.AGENTS_BFF = `http://127.0.0.1:${bff.address().port}/api/agents`
const { table } = await import('../store.mjs')
const { swapOrder, copyAll, ENDED, copyStats } = await import('../keys.mjs')
const W = 'nep141:wrap.near', U = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1', BTC = 'nep141:nbtc.bridge.near'

test('a swap into NEAR or USDC is a sell of what went in, out of NEAR or USDC a buy of what came out', () => {
  assert.deepEqual(swapOrder({ origin: W, destination: U }), { side: 'sell', asset: W, quote: 'usdc' })
  assert.deepEqual(swapOrder({ origin: U, destination: W }), { side: 'sell', asset: U, quote: 'near' })
  assert.deepEqual(swapOrder({ origin: W, destination: BTC }), { side: 'buy', asset: BTC, quote: 'near' })
  assert.deepEqual(swapOrder({ origin: BTC, destination: U }), { side: 'sell', asset: BTC, quote: 'usdc' })
  assert.equal(swapOrder({ origin: BTC, destination: 'nep141:eth.bridge.near' }), null)
})
test('each copier gets ratio x size, never above its cap, nothing under $1, one copy a minute', async () => {
  const copies = table('copies')
  const k = { token: 'seller.near', owner: 'seller.near' }   // the seller copying its own key: access needs no chain read
  copies.v['seller.near'] = [
    { agent_id: 'agent-half-00', ratio_bps: 5000, max_usd: 5, holder: 'seller.near', last: [] },
    { agent_id: 'agent-tenth-0', ratio_bps: 1000, max_usd: 50, holder: 'seller.near', last: [] },
  ]
  await copyAll(k, { side: 'sell', token: W, quote: 'usdc' }, 4, 'sell wNEAR')
  assert.equal(sent.length, 1)   // 50% of $4 = $2 goes; 10% = $0.40 is under the floor
  assert.equal(sent[0].url, '/api/agents/agent-half-00/trade')
  assert.deepEqual(sent[0].body, { side: 'sell', token: W, quote: 'usdc', usd: 2 })
  const [half, tenth] = copies.v['seller.near']
  assert.equal(half.n, 1); assert.match(half.last[0].result, /^done/)
  assert.equal(tenth.n || 0, 0); assert.equal(tenth.last[0].result, 'skipped: under $1')
  await copyAll(k, { side: 'buy', token: BTC, quote: 'near' }, 400, 'buy BTC')
  assert.equal(half.last[0].result, 'skipped: 1 copy a minute')   // the same wallet again within a minute
  assert.deepEqual(sent[1].body, { side: 'buy', token: BTC, quote: 'near', usd: 40 })   // 10% of $400, under its $50 cap
  copies.v['seller.near'] = [{ agent_id: 'agent-cap-000', ratio_bps: 10000, max_usd: 5, holder: 'seller.near', last: [] }]
  await copyAll(k, { side: 'buy', token: BTC, quote: 'near' }, 400, 'buy BTC')
  assert.equal(sent[2].body.usd, 5)   // 100% of $400 capped at $5
})
test('a launch sell is sent in tokens at the launch price', async () => {
  const copies = table('copies'), k = { token: 'seller.near', owner: 'seller.near' }
  copies.v['seller.near'] = [{ agent_id: 'agent-sell-00', ratio_bps: 5000, max_usd: 50, holder: 'seller.near', last: [] }]
  await copyAll(k, { side: 'sell', token: 'dragon-1.nearlytrade.near', quote: 'near', price_usd: 0.0005 }, 20, 'sell DRAGON')
  assert.deepEqual(sent.at(-1).body, { side: 'sell', token: 'dragon-1.nearlytrade.near', quote: 'near', tokens: 20000 })   // $10 at $0.0005
})
test('a swap still processing is looked at again; an ended one is final', () => {
  assert.equal(ENDED.has('PROCESSING'), false); assert.equal(ENDED.has('PENDING_DEPOSIT'), false)
  for (const s of ['SUCCESS', 'FAILED', 'REFUSED', 'CANCELLED', 'EXPIRED']) assert.equal(ENDED.has(s), true)
})
test('the public copy record is counts and a day, nothing that points at a trade', async () => {
  const r = copyStats()
  assert.deepEqual(Object.keys(r).sort(), ['copiers', 'copies_done', 'last_day'])
  assert.ok(r.copies_done >= 1); assert.match(r.last_day, /^\d{4}-\d{2}-\d{2}$/)
})
test.after(() => bff.close())
