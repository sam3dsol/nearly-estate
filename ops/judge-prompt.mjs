// the judges' system prompt is registered on chain, and a ruling signed under any other prompt is refused.
// The registered text is the prompt as it appears inside a signed request (JSON-escaped), checked here against a real signed
// request on chain (market 343) before anything is sent. Run from the repo's server/ directory:
//   node ops/judge-prompt.mjs           dry: derives the text, checks it against market 343's signed bytes, prints its hash
//   node ops/judge-prompt.mjs --go      registers it (set_judge_prompt, the owner's key)
import crypto from 'node:crypto'
import { actions } from 'near-api-js'
import { signer, view, CONTRACT } from '../server/near.mjs'
import { JUDGE_SYSTEM } from '../server/markets.mjs'

const GO = process.argv.includes('--go')
const escaped = JSON.stringify(JUDGE_SYSTEM).slice(1, -1)
const expected = (market) => `"messages":[{"role":"system","content":"${escaped}"},{"role":"user","content":"market ${market} on ${CONTRACT}: `
const hash = crypto.createHash('sha256').update(escaped).digest('hex')
const r = await fetch('https://nearly.trade/api/markets/343/receipt').then((x) => x.json())
const req = r?.receipt?.bytes?.request || ''
const ok = req.includes(expected(343))
console.log({ prompt_bytes: escaped.length, sha256: hash, matches_market_343_signed_request: ok })
const NEW = process.argv.includes('--new')   // a changed prompt: registered before the image that sends it goes live
if (!ok && !NEW) { console.log('STOP: the live prompt differs from the one market 343 was signed under; register only a prompt the relay really sends (or pass --new for a changed prompt)'); process.exit(1) }
const live = await view(CONTRACT, 'get_judge_prompt').catch(() => undefined)
if (live === undefined) { console.log('get_judge_prompt is not on this contract: nothing to send'); process.exit(GO ? 1 : 0) }
console.log('on chain now:', live ? `${live.length} bytes, sha256 ${crypto.createHash('sha256').update(live).digest('hex').slice(0, 16)}…` : 'none')
if (live === escaped) { console.log('already registered, nothing to send'); process.exit(0) }
if (!GO) { console.log('dry run: nothing sent. node ops/judge-prompt.mjs --go'); process.exit(0) }
const owner = signer((process.env.KEYS_DIR || './keys/') + 'mainnet-nearlyops.json'); if (owner.accountId !== 'nearlyops.near') throw new Error('not the owner key')
const t = await owner.signAndSendTransaction({ receiverId: CONTRACT, actions: [actions.functionCall('set_judge_prompt', { prompt: escaped }, 30n * 10n ** 12n, 0n)] })
const fail = t.receipts_outcome.find((o) => o.outcome.status.Failure)
console.log('set_judge_prompt', t.transaction.hash, fail ? 'FAILED ' + JSON.stringify(fail.outcome.status.Failure).slice(0, 200) : 'ok')
console.log('on chain hash:', await view(CONTRACT, 'get_judge_prompt_hash').catch(() => null))
