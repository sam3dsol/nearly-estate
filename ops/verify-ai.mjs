// Prove the private model: verify NEAR AI Cloud's gateway + model attestation, send one judge-style call, verify the response signature.
//   NEARAI_KEY=... node ops/verify-ai.mjs [--e2ee] [--model deepseek-ai/DeepSeek-V4.1-Flash-1017]
import { InferenceClient } from '@nearai/inference-sdk/node'

const BASE = process.env.NEARAI_URL || 'https://cloud-api.near.ai/v1'
const argModel = process.argv.indexOf('--model')
const model = argModel > 0 ? process.argv[argModel + 1] : (process.env.NEARAI_MODEL_PRIVATE || 'deepseek-ai/DeepSeek-V4.1-Flash-1017')
const e2ee = process.argv.includes('--e2ee')
if (!process.env.NEARAI_KEY) throw new Error('NEARAI_KEY missing')

const short = (v, depth = 0) => {
  if (typeof v === 'string') return v.length > 72 ? v.slice(0, 32) + '…' + v.slice(-8) + ` (${v.length} chars)` : v
  if (Array.isArray(v)) return depth > 2 ? `[${v.length}]` : v.slice(0, 6).map((x) => short(x, depth + 1))
  if (v && typeof v === 'object') { if (depth > 3) return '{…}'; const o = {}; for (const [k, x] of Object.entries(v)) o[k] = short(x, depth + 1); return o }
  return v
}
const t0 = Date.now()
const client = new InferenceClient({ baseUrl: BASE, apiKey: process.env.NEARAI_KEY, e2ee })
const att = await client.verify(model)
console.log(`preflight ${Date.now() - t0} ms, e2ee=${e2ee}`)
console.log('gateway', JSON.stringify(short(att.gateway), null, 1))
console.log('models', att.models.length, JSON.stringify(short(att.models), null, 1))

const body = {
  model, max_tokens: 200, temperature: 0.3, response_format: { type: 'json_object' }, chat_template_kwargs: { enable_thinking: false },
  messages: [
    { role: 'system', content: 'You are the judge of a prediction market. Reply as JSON {"outcome": true|false|null, "reason": "...", "confidence": 0..1}.' },
    { role: 'user', content: JSON.stringify({ task: 'judge', question: 'NEARLY holders above 2,500 on Nov 4, 2026', evidence: { holders: 2791, at: '2026-11-04T19:42:09Z' }, now: new Date().toISOString() }) },
  ],
}
const t1 = Date.now()
const r = await client.fetch(BASE + '/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const text = await r.text()
if (!r.ok) throw new Error(`chat ${r.status} ${text.slice(0, 300)}`)
const d = JSON.parse(text)
console.log(`completion ${Date.now() - t1} ms id=${d.id} model=${d.model} usage=${JSON.stringify(d.usage)}`)
console.log('answer', d.choices?.[0]?.message?.content?.slice(0, 300))

const t2 = Date.now()
const v = await client.verifyResponse(d.id)
console.log(`verifyResponse ${Date.now() - t2} ms kind=${v.signatureKind}`)
console.log('signature', JSON.stringify(short(v.signature), null, 1))
console.log('attestation', JSON.stringify(short(v.attestation), null, 1))

// can a third party recompute the signed text from the bytes we hold? (request body as sent, response body as received)
import { createHash, createPublicKey, verify as edVerify } from 'node:crypto'
const sha = (s) => createHash('sha256').update(s).digest('hex')
const expect = `${model}:${sha(JSON.stringify(body))}:${sha(text)}`
console.log('hashes match signedText:', expect === v.signature.signedText)
const pub = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(v.signature.signer.signingAddress, 'hex')]), format: 'der', type: 'spki' })
console.log('ed25519 offline verify:', edVerify(null, Buffer.from(v.signature.signedText, 'utf8'), pub, Buffer.from(v.signature.signature, 'hex')))
