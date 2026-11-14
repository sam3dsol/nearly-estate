// NEAR AI Cloud (OpenAI compatible). No key = stub mode: deterministic answers so every page still renders.
// Two kinds of model:
//  - hosted: NEAR's own TEE fleet (Qwen / DeepSeek ids). Calls go through the NEAR AI Inference SDK: the gateway's and the model's
//    attestation (Intel TDX quote, NVIDIA GPU evidence, TCB status, TLS binding) are verified before the request and the reply's
//    signature is verified against the model's signer after it. A "public" receipt keeps the exact request and response bytes so
//    anyone can recompute the signed hashes (ops/check-receipt.mjs); a "private" call is end-to-end encrypted to the model's key.
//  - proxied: Fable / GPT / Gemini through the Incognito tier (the TEE gateway hides our key, the model runs at its vendor). Plain fetch.
import { createHash, createPublicKey, verify as edVerify } from 'node:crypto'
const BASE = process.env.NEARAI_URL || 'https://cloud-api.near.ai/v1'
const KEY = process.env.NEARAI_KEY || ''
export const MODEL = process.env.NEARAI_MODEL || 'deepseek-ai/DeepSeek-V4.1-Flash-1017'   // the model named in the API; every call passes its own
export const PRIVATE = process.env.NEARAI_MODEL_PRIVATE || 'deepseek-ai/DeepSeek-V4.1-Flash-1017'   // judge + agents: NEAR's own Confidential TEE model
// USD per 1M tokens (in, out) used to charge an agent's fund: the price of THAT model from the cloud's own list (/v1/models,
// cached an hour); the env numbers are only the fallback when the list is unreachable
const FALLBACK = { in: Number(process.env.NEARAI_USD_IN || 0.6), out: Number(process.env.NEARAI_USD_OUT || 2.2) }
let priceList = { at: 0, v: new Map() }
async function priceOf(model) {
  if (!KEY) return FALLBACK
  if (Date.now() - priceList.at > 3600e3) {
    try { const r = await fetch(BASE + '/models', { headers: { authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(15_000) }); const d = await r.json(); priceList = { at: Date.now(), v: new Map((d.data || []).map((m) => [m.id, { in: Number(m.pricing?.input ?? m.pricing?.prompt * 1e6), out: Number(m.pricing?.output ?? m.pricing?.completion * 1e6) }])) } } catch (e) { console.log(new Date().toISOString(), 'near ai: price list unreachable', e.message.slice(0, 80)); priceList.at = Date.now() - 3000e3 }
  }
  const p = priceList.v.get(model)
  return p && p.in >= 0 && p.out >= 0 ? p : FALLBACK
}
export const pricing = async (model) => priceOf(model || PRIVATE)
export const live = () => !!KEY
export const isHosted = (model) => /^(Qwen|deepseek-ai|z-ai)\//.test(model)   // NEAR's own TEE fleet: signed replies

// SDK clients, made on first use: plain (public receipts) and e2ee (prompts encrypted to the attested model key)
const clients = {}
async function client(e2ee) {
  const k = e2ee ? 'e2ee' : 'plain'
  if (!clients[k]) clients[k] = import('@nearai/inference-sdk/node').then(({ InferenceClient }) => new InferenceClient({ baseUrl: BASE, apiKey: KEY, e2ee }))
  return clients[k]
}

/** chat completion. json=true asks for a JSON object and parses it. receipt: 'public' | 'private' (hosted models only).
 *  Returns {text, json, usage, usd, id, model, live, hosted, verified} */
export async function chat(messages, { json = false, max = 1200, temperature = 0.3, model = MODEL, receipt = null } = {}) {
  if (!KEY) return stub(messages, json)
  const hosted = isHosted(model)
  // the NEAR-hosted models think by default and spend the whole budget on it: thinking off, answer only
  const body = { model, messages, max_tokens: max, temperature, ...(json ? { response_format: { type: 'json_object' } } : {}), ...(hosted ? { chat_template_kwargs: { enable_thinking: false } } : {}) }
  const request = JSON.stringify(body)
  const init = { method: 'POST', headers: { 'content-type': 'application/json', ...(hosted ? {} : { authorization: `Bearer ${KEY}` }) }, body: request, signal: AbortSignal.timeout(90_000) }
  const sdk = hosted ? await client(receipt === 'private') : null
  const r = sdk ? await sdk.fetch(BASE + '/chat/completions', init) : await fetch(BASE + '/chat/completions', init)
  const response = await r.text()
  if (!r.ok) throw new Error(`near ai ${r.status} ${response.slice(0, 200)}`)
  const d = JSON.parse(response)
  const text = d.choices?.[0]?.message?.content ?? ''
  if (d.choices?.[0]?.finish_reason === 'length') console.log(new Date().toISOString(), 'near ai: answer cut at max_tokens', max)
  const usage = d.usage || { prompt_tokens: 0, completion_tokens: 0 }
  const price = await priceOf(d.model || model)
  const usd = (usage.prompt_tokens * price.in + usage.completion_tokens * price.out) / 1e6
  let verified = null
  if (sdk) {
    try {
      const v = await sdk.verifyResponse(d.id)
      const a = v.attestation || {}
      verified = {
        ok: v.signatureKind === 'provider_tee', kind: v.signatureKind, model: d.model || model, id: d.id, at: Date.now(),
        signer: v.signature?.signer?.signingAddress, algo: v.signature?.signer?.signingAlgo, signed_text: v.signature?.signedText, signature: v.signature?.signature,
        tcb: a.tcbStatus, advisories: a.advisoryIds || [], gpu: a.gpuEvidence || null, os_image: a.deployment?.runtimeMeasurements?.osImageHash, compose: a.deployment?.runtimeMeasurements?.composeHash, nonce: a.report?.nonce,
        ...(receipt === 'public' ? { bytes: { request, response } } : { e2ee: receipt === 'private' }),
      }
      if (verified.ok && receipt === 'public' && !checkReceipt(verified).ok) verified = { ...verified, ok: false, error: 'stored bytes do not hash to the signed text' }
    } catch (e) { verified = { ok: false, kind: null, error: String(e.message || e).slice(0, 160), id: d.id, at: Date.now() } }
  }
  return { text, json: json ? parseJson(text) : null, usage, usd, id: d.id, model: d.model || model, live: true, hosted, verified }
}
function parseJson(t) { try { return JSON.parse(t) } catch { try { const m = t.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null } catch { return null } } }

/** re-check a public receipt with nothing but node: sha256 of the stored bytes must equal the signed text, the ed25519 signature must verify
 *  under the model's signing key (the address in the attested report). Same code as ops/check-receipt.mjs. */
export function checkReceipt(r) {
  const out = { ok: false, hashes: false, signature: false }
  try {
    if (!r?.bytes || r.algo !== 'ed25519') return { ...out, error: 'no public bytes or unsupported algo' }
    const sha = (s) => createHash('sha256').update(s).digest('hex')
    out.hashes = `${r.model}:${sha(r.bytes.request)}:${sha(r.bytes.response)}` === r.signed_text
    const pub = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(r.signer, 'hex')]), format: 'der', type: 'spki' })
    out.signature = edVerify(null, Buffer.from(r.signed_text, 'utf8'), pub, Buffer.from(r.signature, 'hex'))
    out.ok = out.hashes && out.signature
  } catch (e) { out.error = String(e.message || e).slice(0, 120) }
  return out
}

/** the private model's current attestation, verified by the SDK (cached by it): what the swarm page shows next to the brain */
let attCache = { at: 0, v: null }
export async function attestation() {
  if (!KEY || !isHosted(PRIVATE)) return { model: PRIVATE, verified: false, reason: KEY ? 'not a NEAR-hosted model' : 'no key' }
  if (Date.now() - attCache.at < 10 * 60e3 && attCache.v) return attCache.v
  try {
    const sdk = await client(false), a = await sdk.verify(PRIVATE), m = a.models?.[0]
    attCache = { at: Date.now(), v: { model: PRIVATE, verified: !!m, verified_at: a.verifiedAt, gateway: { signer: a.gateway?.signer?.signingAddress, tcb: a.gateway?.tcbStatus, tls: a.gateway?.tlsBinding?.kind }, models: (a.models || []).map((x) => ({ signer: x.signer?.signingAddress, tcb: x.tcbStatus, advisories: x.advisoryIds || [], gpu: x.gpuEvidence || null, os_image: x.deployment?.runtimeMeasurements?.osImageHash, compose: x.deployment?.runtimeMeasurements?.composeHash })) } }
  } catch (e) { attCache = { at: Date.now(), v: { model: PRIVATE, verified: false, reason: String(e.message || e).slice(0, 160) } } }
  return attCache.v
}

// stub: the last user message carries a {task} hint so the fallback stays sensible
function stub(messages, json) {
  const last = messages[messages.length - 1]?.content || ''
  let out
  if (/"task":\s*"judge"/.test(last)) out = { outcome: null, reason: 'no AI key on this box: not judged', confidence: 0 }
  else if (/"task":\s*"trade"/.test(last)) out = { actions: [], note: 'no AI key on this box: holding' }
  else if (/"task":\s*"page"/.test(last)) out = { summary: 'Page written from the numbers only (no AI key on this box).', sections: [] }
  else out = { text: 'stub' }
  return { text: JSON.stringify(out), json: json ? out : null, usage: { prompt_tokens: 0, completion_tokens: 0 }, usd: 0, id: 'stub', model: 'stub', live: false, verified: null }
}
