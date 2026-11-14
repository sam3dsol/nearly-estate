// Re-check an AI judge receipt with nothing but node (no packages, no API key):
//   node ops/check-receipt.mjs <market id> [server, default http://127.0.0.1:8830]
// Pulls /api/markets/<id>/receipt, hashes the exact request and response bytes the server kept, compares them with the text the
// model signed, and verifies the ed25519 signature under the model's signing key (the key in its attested TEE report).
import { RPC as PAID_RPC, ARCHIVAL as PAID_ARCHIVAL, fxHeaders } from './rpc.mjs'
import { createHash, createPublicKey, verify as edVerify } from 'node:crypto'
import fs from 'node:fs'
const [id, base = 'http://127.0.0.1:8830'] = process.argv.slice(2)
if (!id) { console.error('usage: node ops/check-receipt.mjs <market id | receipt.json> [server]'); process.exit(2) }
// a committed receipt file works with no server at all (ops/receipts/market-<id>.json), else the server serves it
const r = /\.json$/.test(id) ? JSON.parse(fs.readFileSync(id, 'utf8')) : await fetch(`${base}/api/markets/${id}/receipt`).then((x) => x.json())
if (!r.receipt) { console.error('no receipt:', r.error || r); process.exit(1) }
const R = r.receipt, sha = (s) => createHash('sha256').update(s).digest('hex')
const expected = `${R.model}:${sha(R.bytes.request)}:${sha(R.bytes.response)}`
const hashes = expected === R.signed_text
const pub = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(R.signer, 'hex')]), format: 'der', type: 'spki' })
const sig = R.algo === 'ed25519' && edVerify(null, Buffer.from(R.signed_text, 'utf8'), pub, Buffer.from(R.signature, 'hex'))
const req = JSON.parse(R.bytes.request), res = JSON.parse(R.bytes.response)
console.log(`market ${r.market}: ${r.outcome ? 'YES' : 'NO'} at confidence ${r.confidence}, proposed on chain ${r.tx || '(not yet)'}`)
console.log(`model ${R.model}  signer ${R.signer}  TCB ${R.tcb}  GPU ${R.gpu}  kind ${R.kind}`)
console.log(`question: ${JSON.parse(req.messages.at(-1).content).question}`)
console.log(`answer:   ${res.choices[0].message.content}`)
console.log(`hashes of the kept bytes equal the signed text: ${hashes ? 'PASS' : 'FAIL'}`)
console.log(`ed25519 signature verifies under the model's key: ${sig ? 'PASS' : 'FAIL'}`)
console.log(`the signer must be the model's signing key in NEAR AI's attestation report: GET https://cloud-api.near.ai/v1/attestation/report?model=${R.model} (any cloud.near.ai key) -> model_attestations[].signing_address == ${R.signer}`)
// the market's proposal on chain, read from FastNEAR (ops/rpc.mjs): the hash the contract stores must equal sha256(signed_text|signature|signer)
const expectOnChain = createHash('sha256').update(`${R.signed_text}|${R.signature}|${R.signer}`).digest('hex')
try {
  const rpc = PAID_RPC
  const q = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'call_function', finality: 'final', account_id: 'keys.nearlyops.near', method_name: 'get_market', args_base64: Buffer.from(JSON.stringify({ market: String(r.market) })).toString('base64') } }) }).then((x) => x.json())
  const m = JSON.parse(Buffer.from(q.result.result).toString()); const st = m.status; const on = st?.Proposed?.receipt ?? st?.Challenged?.receipt ?? null
  if (on == null) console.log(`on chain: market ${r.market} is ${typeof st === 'string' ? st : Object.keys(st)[0]}, no receipt field to compare`)
  else if (on === '') console.log(`on chain: market ${r.market} was proposed without a receipt (before receipts were kept)`)
  else console.log(`on chain: the receipt hash in the proposal ${on === expectOnChain ? 'EQUALS' : 'DIFFERS FROM'} sha256(signed_text|signature|signer) = ${expectOnChain}`)
} catch (e) { console.log('on chain: could not read the market', e.message) }
process.exit(hashes && sig ? 0 : 1)
