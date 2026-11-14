import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseEvents } from '../trades.mjs'

// a market's settlement steps come from the contract's own log lines (proposal, each challenge round and bond, the end)
const tx = (logs, ok = true, receiver = 'keys.nearlyops.near') => ({ transaction: { hash: 'H', signer_id: 'alice.near' }, receipts: [{ receipt: { receiver_id: receiver }, execution_outcome: { block_timestamp: '1794300000000000000', outcome: { logs, status: ok ? { SuccessValue: '' } : { Failure: {} } } } }] })
test('a proposal, two challenge rounds and the resolution are read with their sides and bonds', () => {
  const e = [
    ...parseEvents(tx(['market 44 proposed NO by keysop.nearlyops.near with a 0 bond'])),
    ...parseEvents(tx(['market 44 challenged, round 1, 1000000000000000000000000 on YES'])),
    ...parseEvents(tx(['market 44 challenged, round 2, 2000000000000000000000000 on NO'])),
    ...parseEvents(tx(['market 44 resolved NO'])),
  ]
  assert.deepEqual(e.map((x) => [x.type, x.market, x.side, x.round ?? null, x.bond ?? null]), [['proposed', 44, 'no', null, 0], ['challenged', 44, 'yes', 1, 1], ['challenged', 44, 'no', 2, 2], ['resolved', 44, 'no', null, null]])
  assert.equal(e[1].signer, 'alice.near')
})
test('a failed receipt or another contract books nothing; a void and a final ruling are read', () => {
  assert.equal(parseEvents(tx(['market 9 resolved YES'], false)).length, 0)
  assert.equal(parseEvents(tx(['market 9 resolved YES'], true, 'other.near')).length, 0)
  assert.equal(parseEvents(tx(['market 9 invalid: every share pays half']))[0].type, 'void')
  assert.deepEqual(parseEvents(tx(['market 9 ruled YES by the judge after 4 rounds, receipt abc']))[0].rounds, 4)
})
