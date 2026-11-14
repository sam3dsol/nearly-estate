import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callOf, summarize, productOf } from '../outside.mjs'

// a transaction as FastNEAR's tx index serves it: the signed transaction and its receipts with their outcomes
const C = 'keys.nearlyops.near'
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
const rc = (receiver, predecessor, method, args, ok = true) => ({
  receipt: { receiver_id: receiver, predecessor_id: predecessor, receipt: { Action: { actions: [{ FunctionCall: { method_name: method, args: b64(args) } }] } } },
  execution_outcome: { block_timestamp: '1794450000000000000', outcome: { status: ok ? { SuccessValue: '' } : { Failure: {} } } },
})
const tx = (hash, signer, ...receipts) => ({ transaction: { hash, signer_id: signer }, receipts })

test('a bet through wrap.near counts for the account that sent the wNEAR', () => {
  const t = tx('h1', 'alice.near', rc('wrap.near', 'alice.near', 'ft_transfer_call', {}), rc(C, 'wrap.near', 'ft_on_transfer', { sender_id: 'alice.near', amount: '1', msg: JSON.stringify({ Buy: { market: '3', yes: true, min_shares: '0' } }) }))
  assert.deepEqual(callOf(t, C), { tx: 'h1', at: 1794450000000, signer: 'alice.near', account: 'alice.near', method: 'Buy', product: 'wiki', credited: false })
})
test('a bet paid from another chain counts for the owner it names, not for the relay', () => {
  const t = tx('h2', 'solver.near', rc(C, 'wrap.near', 'ft_on_transfer', { sender_id: 'intents.near', amount: '1', msg: JSON.stringify({ BuyFor: { market: '3', yes: false, min_shares: '0', owner: 'ab12cd' } }) }))
  assert.equal(callOf(t, C).account, 'ab12cd')
})
test('a unit message (FundWiki) and a direct call are named', () => {
  assert.equal(callOf(tx('h3', 'bob.near', rc(C, 'wrap.near', 'ft_on_transfer', { sender_id: 'bob.near', amount: '1', msg: '"FundWiki"' })), C).method, 'FundWiki')
  assert.deepEqual(callOf(tx('h4', 'carol.tg', rc(C, 'carol.tg', 'register_key', {})), C).product, 'keys')
})
test('a failed call, a deposit not from wrap.near, or a tx that never reached the contract is nothing', () => {
  assert.equal(callOf(tx('h5', 'dan.near', rc(C, 'dan.near', 'buy_key', {}, false)), C), null)
  assert.equal(callOf(tx('h6', 'dan.near', rc(C, 'fake.near', 'ft_on_transfer', { sender_id: 'dan.near', msg: '{"Buy":{}}' })), C), null)
  assert.equal(callOf(tx('h7', 'dan.near', rc('wrap.near', 'dan.near', 'near_deposit', {})), C), null)
})
test('products', () => { assert.equal(productOf('post_job'), 'swarm'); assert.equal(productOf('Create'), 'wiki'); assert.equal(productOf('review_job'), 'other') })

test('the team and the agents it owns are left out; an outside owner\'s agent counts for its owner', () => {
  const team = { accounts: new Set(['nearlyops.near', 'scribe1']), ownerOf: new Map([['king1', 'pn.tg']]) }
  const r = (tx, account, method, product, at) => ({ tx, at, signer: account, account, method, product })
  const s = summarize([
    r('a', 'nearlyops.near', 'post_job', 'swarm', 1), r('b', 'scribe1', 'submit_job', 'swarm', 2),
    r('c', 'king1', 'submit_job', 'swarm', 3), r('d', 'pn.tg', 'Buy', 'wiki', 4), r('e', 'eve.near', 'buy_key', 'keys', 5),
    r('f', 'eve.near', 'storage_deposit', 'other', 6), r('g', 'eve.near', 'Buy', 'wiki', 7),
  ], team, 5)
  assert.equal(s.accounts, 2); assert.equal(s.actions, 4)
  assert.deepEqual(s.by_product, { wiki: 2, keys: 1, swarm: 1 })
  const pn = s.list.find((a) => a.account === 'pn.tg')
  assert.deepEqual(pn.products, ['swarm', 'wiki']); assert.equal(pn.first.tx, 'c')
  assert.equal(s.new_since, 1, 'eve.near first came at 5, pn.tg before')
})

test('an owner a BuyFor names is credited, not self-signed: listed apart until it signs for itself (0.01 wNEAR could name anyone)', () => {
  const t = tx('h2', 'solver.near', rc(C, 'wrap.near', 'ft_on_transfer', { sender_id: 'intents.near', amount: '1', msg: JSON.stringify({ BuyFor: { market: '3', yes: false, min_shares: '0', owner: 'ab12cd' } }) }))
  const r = callOf(t, C); assert.equal(r.account, 'ab12cd'); assert.equal(r.credited, true)
  const team = { accounts: new Set(), ownerOf: new Map() }
  const s1 = summarize([r], team, null); assert.equal(s1.accounts, 0); assert.deepEqual(s1.credited_only, [{ account: 'ab12cd', actions: 1 }])
  const self = { ...r, tx: 'h3', at: r.at + 1, signer: 'ab12cd', credited: false, method: 'sell' }
  const s2 = summarize([r, self], team, null); assert.equal(s2.accounts, 1); assert.deepEqual(s2.credited_only, [])
})
