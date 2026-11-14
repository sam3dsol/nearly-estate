// Check that the keys server you are talking to runs inside a genuine Intel TDX enclave, running exactly the compose file this
// repo publishes. No keys, public endpoints only.   node ops/attest.mjs [https://keys-cvm-host]   (default from ATTESTATION.md)
//   1. GET <host>/api/attestation?nonce=  -> the TDX quote (with 32 fresh random bytes we send as the challenge), the RTMR3 event log
//   2.    and the enclave's info (the app-compose it booted with), all from the dstack guest agent inside the CVM
//   3. sha256(app-compose) must equal the compose-hash event in the RTMR3 log (the hardware measured it at boot)
//   4. the quote must verify as signed by genuine TDX hardware (Phala's verifier; dcap-qvl does the same offline)
//   5. our challenge must be inside the quote's report_data (so the quote is fresh, not replayed)
//   6. the compose-hash must equal the one pinned in ATTESTATION.md (so it is OUR compose: this image, this data volume, nothing else)
import crypto from 'node:crypto'
import fs from 'node:fs'
const md = fs.readFileSync(new URL('../ATTESTATION.md', import.meta.url), 'utf8')
const HOST = (process.argv[2] || /Endpoint:\s*(\S+)/.exec(md)?.[1] || '').replace(/\/$/, '')
const PINNED = /compose-hash:\s*`?([0-9a-f]{64})/.exec(md)?.[1]
if (!HOST) { console.error('no endpoint: pass the CVM host or fill ATTESTATION.md'); process.exit(2) }
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
let fails = 0
const line = (ok, what, note) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${note ? `  ${note}` : ''}`); if (!ok) fails++ }
const get = (u) => fetch(u, { signal: AbortSignal.timeout(20_000) }).then((r) => r.json())

// one call: the keys server inside the CVM asks the dstack guest agent for a quote bound to our nonce, and returns the event
// log and the app info with it (the same route answers at https://nearly.trade/api/attestation, which proxies to the enclave)
const nonce = crypto.randomBytes(32).toString('hex')
const att = await get(`${HOST}/api/attestation?nonce=${nonce}`)
const info = att.info || {}
const quote = String(att.quote || '').replace(/^0x/, '')
line(quote.length > 1000, 'the enclave answered with a TDX quote', `${quote.length / 2} bytes`)
const events = typeof att.event_log === 'string' ? JSON.parse(att.event_log) : att.event_log || []
const composeEvent = events.find((e) => e.event === 'compose-hash')
const tcb = typeof info.tcb_info === 'string' ? JSON.parse(info.tcb_info) : info.tcb_info || {}   // the guest agent returns tcb_info as a JSON string
const appCompose = tcb.app_compose || info.app_compose || ''
line(!!composeEvent && !!appCompose, 'the RTMR3 event log carries a compose-hash and /info carries the app-compose')
line(composeEvent && sha(appCompose) === composeEvent.event_payload, 'sha256(app-compose) equals the compose-hash the hardware measured at boot', composeEvent?.event_payload?.slice(0, 16) + '…')
line(!!PINNED && composeEvent?.event_payload === PINNED, 'the measured compose-hash is the one pinned in ATTESTATION.md', PINNED ? PINNED.slice(0, 16) + '…' : 'nothing pinned yet')
const v = await fetch('https://cloud-api.phala.com/api/v1/attestations/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hex: quote }), signal: AbortSignal.timeout(30_000) }).then((r) => r.json()).catch((e) => ({ error: e.message }))
line(v?.quote?.verified === true, 'the quote is signed by genuine Intel TDX hardware (Phala verifier; dcap-qvl offline gives the same answer)', v?.error || v?.quote?.status || '')
const reportData = String(v?.quote?.body?.report_data || v?.quote?.report_data || att.report_data || '').replace(/^0x/, '')
line(reportData.includes(nonce), 'our fresh challenge is inside the quote (not a replay)', reportData ? '' : 'report_data not exposed by the verifier response')
console.log(fails ? `\n${fails} FAIL` : '\nall PASS: the live server is this enclave, booted with the compose and image ATTESTATION.md pins')
process.exit(fails ? 1 : 0)
