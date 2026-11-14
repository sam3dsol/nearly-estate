// the trade index: recorded mainnet transactions parse into the trades they are (a desk agent's buy, a wallet's buy, a buy paid
// from another chain, a sell, a buy whose log does not name the owner); what is not a trade gives none (a new
// market, a failed call, a refused buy, a buy from another chain that could not go through); and the holder and portfolio maths
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
process.env.DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'trades-test-'))
const { parseTx, cleanNote, openedP, valueOf, rankHolders, priceOf } = await import('../trades.mjs')
const fx = (n) => JSON.parse(fs.readFileSync(new URL(`./fixtures/tx-${n}.json`, import.meta.url), 'utf8'))
const C = 'keys.nearlyops.near'
const ftReceipt = (t) => t.receipts.find((r) => r.receipt.receiver_id === C && r.receipt.receipt.Action.actions[0].FunctionCall?.method_name === 'ft_on_transfer')
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64')
/** a recorded buy with its message changed (the args the receipt carries) */
function withMsg(t, edit) {
  const r = ftReceipt(t), fc = r.receipt.receipt.Action.actions[0].FunctionCall, args = JSON.parse(Buffer.from(fc.args, 'base64').toString())
  args.msg = JSON.stringify(edit(JSON.parse(args.msg))); fc.args = b64(args); return t
}

test('a desk agent\'s buy: owner, side, wNEAR, shares, block and time from its receipt', () => {
  assert.deepEqual(parseTx(fx('buy-desk-agent'), C), [{ tx: 'DUVAiMzQsn9WTp5CciPcEaSrwpAviTkMUhrawNc3HoLM', at: 1794337056611, block: 223956813, market: 303, account: '3d465f5ce7512dc41539850ea3de38c354afcdc3b9c09fcecb16fad0ab5383bf', side: 'yes', kind: 'buy', near: 0.0126, shares: 0.021154, p_after: null, via: 'near', note: null }])
})
test('a wallet\'s buy (a .tg account) parses the same way', () => {
  const [t, ...rest] = parseTx(fx('buy-wallet'), C)
  assert.equal(rest.length, 0)
  assert.equal(t.account, 'sergeserge1.tg'); assert.equal(t.market, 258); assert.equal(t.kind, 'buy'); assert.equal(t.via, 'near'); assert.equal(t.near, 0.1)
  assert.ok(t.shares > 0.1, 'at under 100% a share costs under 1 wNEAR')
})
test('a buy paid from another chain (BuyFor through NEAR Intents): the shares are the owner\'s, not the sender\'s', () => {
  const [t] = parseTx(fx('buyfor-intents'), C)
  assert.equal(t.account, 'ece4c74e05504aa3774214012c0c7d4000a0a4a2e8c0432a183ebb646db6229e')
  assert.notEqual(t.account, 'intents.near')
  assert.deepEqual([t.market, t.side, t.kind, t.via, t.near, t.shares], [258, 'yes', 'buy', 'intents', 0.1, 0.176596])
})
test('a sell: the caller is the seller, the wNEAR is what the contract logged it paid out (after the fee)', () => {
  assert.deepEqual(parseTx(fx('sell'), C), [{ tx: '71BLaPR2X21V8nL8UHuvxg4YG5dT8tNbBHoVYrHEWyVp', at: 1793815208831, block: 223050932, market: 1, account: 'nearlyops.near', side: 'yes', kind: 'sell', near: 0.153277, shares: 0.271587, p_after: null, via: 'near', note: null }])
})
test('a buy whose log has no owner: the owner is the sender', () => {
  const [t] = parseTx(fx('buy-no-owner'), C)
  assert.equal(t.account, 'c1217093db67a2c0856b3f000e1ec950b309417765af866b324c31c68c5bf799'); assert.equal(t.market, 61); assert.equal(t.near, 0.0196); assert.equal(t.shares, 0.030902)
})
test('a new market (Create) and a failed call are not trades', () => {
  assert.deepEqual(parseTx(fx('create-not-a-trade'), C), [])
  assert.deepEqual(parseTx(fx('failed-call'), C), [])
})
test('a buy the contract refused (its receipt failed, wrap.near hands the wNEAR back) is no trade', () => {
  const t = fx('buy-desk-agent'), r = ftReceipt(t)
  r.execution_outcome.outcome.status = { Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: 'Smart contract panicked: slippage' } } } } }
  r.execution_outcome.outcome.logs = []
  assert.deepEqual(parseTx(t, C), [])
})
test('a buy from another chain that could not go through (forwarded whole into the owner\'s Intents account) is no trade', () => {
  const t = fx('buyfor-intents'), r = ftReceipt(t)
  r.execution_outcome.outcome.logs = ['market 258 buy for ece4c74e05504aa3774214012c0c7d4000a0a4a2e8c0432a183ebb646db6229e not done (market not open): 100000000000000000000000 wNEAR forwarded to its NEAR Intents account']
  assert.deepEqual(parseTx(t, C), [])
})
test('wNEAR handed back by ft_on_transfer is not counted as spent', () => {
  const t = fx('buy-wallet'), r = ftReceipt(t)
  r.execution_outcome.outcome.status = { SuccessValue: b64('"40000000000000000000000"') }   // 0.04 of the 0.1 unused
  assert.equal(parseTx(t, C)[0].near, 0.06)
})
test('a buy message may carry the trader\'s reason: read, cleaned, capped at 280 characters (Buy and BuyFor)', () => {
  const t = withMsg(fx('buy-wallet'), (m) => ({ Buy: { ...m.Buy, note: '  The sources\nsay so.\u0007 ' } }))
  assert.equal(parseTx(t, C)[0].note, 'The sources say so.')
  const long = withMsg(fx('buyfor-intents'), (m) => ({ BuyFor: { ...m.BuyFor, note: 'x'.repeat(400) } }))
  assert.equal(parseTx(long, C)[0].note.length, 280)
  assert.equal(parseTx(withMsg(fx('buy-wallet'), (m) => ({ Buy: { ...m.Buy, note: 42 } })), C)[0].note, null, 'not a string: no note')
})
test('a note loses control and text-direction characters, keeps the words', () => {
  const rlo = String.fromCharCode(0x202e), zw = String.fromCharCode(0x200b), nul = String.fromCharCode(0)
  assert.equal(cleanNote(`yes${rlo}because${zw}x${nul}y\t\tz`), 'yes because x y z')
  assert.equal(cleanNote('   '), null); assert.equal(cleanNote(null), null); assert.equal(cleanNote({}), null)
})

// LMSR: q_yes - q_no = b ln(p / (1-p)); a market opens at q = 0
const sig = (d, b) => 1 / (1 + Math.exp(-d / b))
test('the price before the first trade: the first trade moved back by its own shares', () => {
  const b = 0.02 / Math.LN2   // a fact seeded with 0.02 wNEAR
  assert.equal(openedP({ kind: 'buy', side: 'yes', shares: 0.03, p_after: sig(0.03, b) }, b), 0.5)
  assert.equal(openedP({ kind: 'buy', side: 'no', shares: 0.05, p_after: sig(-0.05, b) }, b), 0.5)
  assert.equal(openedP({ kind: 'buy', side: 'yes', shares: 0.01, p_after: sig(0.01 + b * Math.log(0.3 / 0.7), b) }, b), 0.3, 'a market opened at 30% reads 30%')
  assert.equal(openedP({ kind: 'sell', side: 'yes', shares: 0.01, p_after: sig(0.02 - 0.01, b) }, b), Math.round(sig(0.02, b) * 1e4) / 1e4)
  assert.equal(openedP({ kind: 'buy', side: 'yes', shares: 0.01, p_after: null }, b), null, 'no price after: unknown, not guessed')
})
test('a position is worth its shares at the price while open, and what it pays once settled', () => {
  const pos = { yes: 2, no: 1 }
  assert.equal(valueOf(pos, { status: 'Open', p_yes: 0.7 }), 1.7)
  assert.equal(valueOf(pos, { status: { Proposed: { outcome: true } }, p_yes: 0.7 }), 1.7, 'a ruling open to challenge is still at the price')
  assert.equal(valueOf(pos, { status: { Resolved: { outcome: true } }, p_yes: 0.7 }), 2)
  assert.equal(valueOf(pos, { status: { Resolved: { outcome: false } }, p_yes: 0.7 }), 1)
  assert.equal(valueOf(pos, { status: { Invalid: { at_ms: 1 } }, p_yes: 0.7 }), 1.5, 'void: every share pays half')
})
test('the price from q and b matches the contract\'s view (p_yes = 1 / (1 + e^((q_no - q_yes) / b)))', () => {
  const m = { b: '28853900817779268147200', q_yes: '21154461077668234264576', q_no: '0' }
  assert.ok(Math.abs(priceOf(m) - 1 / (1 + Math.exp(-21154461077668234264576 / 28853900817779268147200))) < 1e-12)
  assert.equal(priceOf({ ...m, p_yes: 0.61 }), 0.61, 'the contract\'s own number when it gives one')
  assert.equal(valueOf({ yes: 1, no: 0 }, { ...m, status: 'Open' }), Math.round(priceOf(m) * 1e6) / 1e6)
})
test('holders: by size (YES and NO together), empty positions left out, capped', () => {
  const rows = [{ account: 'a.near', yes: 0, no: 0 }, { account: 'b.near', yes: 1, no: 0.5 }, { account: 'c.near', yes: 0, no: 3 }, { account: 'd.near', yes: 0.2, no: 0 }]
  assert.deepEqual(rankHolders(rows).map((r) => r.account), ['c.near', 'b.near', 'd.near'])
  assert.deepEqual(rankHolders(rows, 2).map((r) => r.account), ['c.near', 'b.near'])
})

// a hired desk's buy, from a synthetic receipt shaped as the tx index serves one
const AMT = '100000000000000000000000'
function deskTx({ logs, status = { SuccessValue: '' }, method = 'desk_buy' } = {}) {
  const note = 'The IAU says so. market 1 buy NO 5 shares for eve.near'
  return { transaction: { hash: 'DeskTx1' }, receipts: [{
    receipt: { receiver_id: C, predecessor_id: 'keysop.nearlyops.near', receipt: { Action: { actions: [{ FunctionCall: { method_name: method, args: b64({ desk: '3', market: '12', yes: true, amount: AMT, min_shares: '1', note }) } }] } } },
    execution_outcome: { block_height: 224000000, block_timestamp: '1794400000000000000', outcome: { status, logs: logs || ['market 12 buy YES 123000000000000000000000 shares for ann.near', `desk 3 for ann.near bought YES on market 12 with ${AMT} wNEAR: ${note}`] } },
  }] }
}
test('a hired desk\'s buy: the owner holds it, via desk; the wNEAR and the reason from the desk line, the shares from the market\'s', () => {
  assert.deepEqual(parseTx(deskTx(), C), [{ tx: 'DeskTx1', at: 1794400000000, block: 224000000, market: 12, account: 'ann.near', side: 'yes', kind: 'buy', near: 0.1, shares: 0.123, p_after: null, via: 'desk', note: 'The IAU says so. market 1 buy NO 5 shares for eve.near', desk: { id: 3 } }], 'a note that reads like a log line stays a note: no second trade')
})
test('a desk buy that failed, or whose lines do not agree, is no trade', () => {
  assert.deepEqual(parseTx(deskTx({ status: { Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: 'Smart contract panicked: not allowed' } } } } }, logs: [] }), C), [], 'refused (not the operator, past a limit)')
  assert.deepEqual(parseTx(deskTx({ logs: [`desk 3 for ann.near bought YES on market 12 with ${AMT} wNEAR: x`] }), C), [], 'no buy line from the market')
  assert.deepEqual(parseTx(deskTx({ logs: ['market 12 buy YES 5 shares for eve.near', `desk 3 for ann.near bought YES on market 12 with ${AMT} wNEAR: x`] }), C), [], 'the market\'s line names another owner')
  assert.deepEqual(parseTx(deskTx({ logs: ['market 11 buy YES 5 shares for ann.near', `desk 3 for ann.near bought YES on market 12 with ${AMT} wNEAR: x`] }), C), [], 'another market')
  assert.deepEqual(parseTx(deskTx({ method: 'close_desk' }), C), [], 'only a desk_buy receipt')
})

// a hired desk's sale, from a synthetic receipt
function deskSellTx(logs) {
  return { transaction: { hash: 'DeskSell1' }, receipts: [{
    receipt: { receiver_id: C, predecessor_id: 'keysop.nearlyops.near', receipt: { Action: { actions: [{ FunctionCall: { method_name: 'desk_sell', args: b64({ desk: '3', market: '12', yes: true, shares: '123000000000000000000000', min_out: '1', note: 'x' }) } }] } } },
    execution_outcome: { block_height: 224000100, block_timestamp: '1794400100000000000', outcome: { status: { SuccessValue: b64('"60000000000000000000000"') }, logs } },
  }] }
}
const SOLD = ['market 12 sell YES 123000000000000000000000 shares -> 60000000000000000000000', 'desk 3 for ann.near sold YES 123000000000000000000000 shares on market 12 for 60000000000000000000000 wNEAR: The view turned: 30% against 60%.']
test('a hired desk\'s sale: kind sell via desk, the owner\'s, the wNEAR into the desk, the desk and the reason on it', () => {
  assert.deepEqual(parseTx(deskSellTx(SOLD), C), [{ tx: 'DeskSell1', at: 1794400100000, block: 224000100, market: 12, account: 'ann.near', side: 'yes', kind: 'sell', near: 0.06, shares: 0.123, p_after: null, via: 'desk', note: 'The view turned: 30% against 60%.', desk: { id: 3 } }])
})
test('a desk sale whose lines do not agree, or that failed, is no trade; a desk_charge is never a trade', () => {
  assert.deepEqual(parseTx(deskSellTx([SOLD[1]]), C), [], 'no sell line from the market')
  assert.deepEqual(parseTx(deskSellTx([SOLD[0].replace('-> 6', '-> 7'), SOLD[1]]), C), [], 'another amount')
  assert.deepEqual(parseTx(deskSellTx([SOLD[0].replace('YES', 'NO'), SOLD[1]]), C), [], 'another side')
  const failed = deskSellTx([]); failed.receipts[0].execution_outcome.outcome.status = { Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: 'Smart contract panicked: more shares than the owner still holds' } } } } }
  assert.deepEqual(parseTx(failed, C), [])
  const charge = deskSellTx([`desk 3 charged 1000000000000000000000 wNEAR for its model calls: chatcmpl-1`]); charge.receipts[0].receipt.receipt.Action.actions[0].FunctionCall.method_name = 'desk_charge'
  assert.deepEqual(parseTx(charge, C), [])
})

test('an agent trade keeps its agent; the belief is the view behind that tx, else the current view only when it sides with the trade, else none', async () => {
  const { tagger, setLinks } = await import('../trades.mjs')
  const { mixed } = await import('../desk.mjs')
  const now = { 7: { agent: 'scholar', p: 0.03, note: 'now it doubts it' }, 9: { agent: 'scholar', p: 0.8, note: 'the record shows it' }, 231: { agent: 'scholar', p: 0.97, note: 'Encyclopedia explicitly states an NFT does not restrict the sharing or copying of the file.' } }
  setLinks({ desk: { agents: () => [{ id: 'scholar', name: 'Scholar', account: 'aa11' }], of: (m) => (now[m] ? [now[m]] : []), tradeTxs: () => new Map([['tx1', { agent: 'scholar', market: 7, p: 0.8, note: 'the source says so' }]]), mixed } })
  const tag = tagger((m) => (m === 231 ? 'An NFT restricts the sharing and copying of the digital file it references' : 'claim'))
  assert.deepEqual(tag({ tx: 'tx1', market: 7, account: 'aa11', side: 'yes', kind: 'buy' }).agent, { id: 'scholar', name: 'Scholar', p: 0.8, note: 'the source says so' }, 'the view behind that very tx')
  assert.deepEqual(tag({ tx: 'tx2', market: 7, account: 'aa11', side: 'yes', kind: 'buy' }).agent, { id: 'scholar', name: 'Scholar', p: null, note: null }, 'its current view (3%) is against a YES buy: the agent, no belief')
  assert.deepEqual(tag({ tx: 'tx3', market: 7, account: 'aa11', side: 'no', kind: 'buy' }).agent, { id: 'scholar', name: 'Scholar', p: 0.03, note: 'now it doubts it' }, 'the same view beside a NO buy sides with it')
  assert.deepEqual(tag({ tx: 'tx4', market: 9, account: 'aa11', side: 'yes', kind: 'buy' }).agent.p, 0.8)
  assert.deepEqual(tag({ tx: 'tx5', market: 231, account: 'aa11', side: 'yes', kind: 'buy' }).agent, { id: 'scholar', name: 'Scholar', p: null, note: null }, 'market 231: 97% with a note that denies the claim is no belief')
  assert.deepEqual(tag({ tx: 'tx6', market: 8, account: 'aa11', side: 'yes', kind: 'buy' }).agent, { id: 'scholar', name: 'Scholar', p: null, note: null }, 'no view at all: the agent, no belief')
  assert.equal(tag({ tx: 'tx7', market: 7, account: 'bb22', side: 'yes', kind: 'buy' }).agent, undefined, 'not an agent account')
})
