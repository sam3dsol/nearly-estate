// anyone proposes a market ruling: ask the live judge for its signed answer (dry: the server proposes nothing), then
// (for a claim with no date the server answers 409 "the judges rule 72 hours after the first trade" until that time)
// propose it from your own account with the 0.5 NEAR bond. The contract checks the judge's signature, not who brings it; the
// bond comes back at finalize if the ruling stands, and goes to the challengers if it loses. dry unless --go
//   node ops/outsider-propose.mjs <market id> [--go] [--key keys/you.json]
import { RPC as PAID_RPC, ARCHIVAL as PAID_ARCHIVAL, fxHeaders } from './rpc.mjs'
import fs from 'node:fs'
import { webcrypto } from 'node:crypto'
globalThis.crypto ??= webcrypto
import { Account, KeyPair, KeyPairSigner, JsonRpcProvider, actions } from 'near-api-js'
const KEYS_DIR = process.env.KEYS_DIR || './keys/'
const SITE = process.env.SITE || 'https://nearly.trade', C = process.env.KEYS_CONTRACT || 'keys.nearlyops.near'
const p = new JsonRpcProvider({ url: PAID_RPC })
const id = process.argv[2], ki = process.argv.indexOf('--key'), keyFile = ki > 0 ? process.argv[ki + 1] : KEYS_DIR + 'mainnet-nearlyops.json'
if (!id) { console.error('market id?'); process.exit(2) }
const view = async (m, a) => JSON.parse(Buffer.from((await p.query({ request_type: 'call_function', finality: 'final', account_id: C, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString('base64') })).result).toString())
const BOND = 5n * 10n ** 23n
const r = await fetch(`${SITE}/api/markets/${id}/rule`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"dry":1}' }).then((x) => x.json())
console.log({ market: r.market, outcome: r.outcome, confidence: r.confidence, judge: r.judge, reason: String(r.reason || '').slice(0, 160), signed: !!r.proposal?.signature })
if (r.outcome == null) { console.log('the judge did not decide: nothing to propose'); process.exit(1) }
if (!r.proposal?.signature) { console.log('a numbers-only judgement has no signature: only the operator can propose it'); process.exit(1) }
if (!process.argv.includes('--go')) { console.log('dry. add --go'); process.exit(0) }
const k = JSON.parse(fs.readFileSync(keyFile))
const me = new Account(k.account_id, p, new KeyPairSigner(KeyPair.fromString(k.private_key)))
const tx = await me.signAndSendTransaction({ receiverId: C, actions: [actions.functionCall('propose', { market: String(id), outcome: r.outcome, receipt: null, request: r.proposal.request, response: r.proposal.response, model: r.proposal.model, signature: r.proposal.signature }, 100_000_000_000_000n, BOND)] })
const f = tx.receipts_outcome.find((o) => o.outcome.status.Failure); if (f) throw new Error(JSON.stringify(f.outcome.status.Failure).slice(0, 400))
const m = await view('get_market', { market: String(id) }), st = await view('get_stakes', { market: String(id) })
console.log('propose', tx.transaction.hash, 'from', k.account_id, '->', JSON.stringify(m.status).slice(0, 160), 'stakes', JSON.stringify(st.map((s) => ({ who: s.who, side: s.side, bond: Number(s.bond) / 1e24 }))))
