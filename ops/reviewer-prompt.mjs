// the swarm reviewers' system prompt is registered on chain (set_reviewer_prompt, the owner's key), and a signed review whose
// request does not open with it is refused. The text is REVIEW_SYS as server/swarm.mjs sends it, plain (the judges' prompt is stored
// escaped, as it sits inside a request). It is checked first against a live receipt of a review made whose system
// message must be the text itself. Run from the repo root:
//   node ops/reviewer-prompt.mjs <job>          dry: checks the text against that job's live receipt, prints the hash, nothing sent
//   node ops/reviewer-prompt.mjs <job> --go     registers it (set_reviewer_prompt from nearlyops.near)
//   node ops/reviewer-prompt.mjs --new [--go]   with no receipt to check against (reviews are refused until the image that sends it is live)
import crypto from 'node:crypto'
import { actions } from 'near-api-js'
import { signer, view, CONTRACT } from '../server/near.mjs'
import { REVIEW_SYS } from '../server/swarm.mjs'

const GO = process.argv.includes('--go'), NEW = process.argv.includes('--new')
const job = process.argv.slice(2).find((a) => /^\d+$/.test(a))
const hash = crypto.createHash('sha256').update(REVIEW_SYS).digest('hex')
let ok = NEW
if (job) {
  const r = await fetch(`https://estate.nearly.trade/api/swarm/review/${job}`).then((x) => x.json()).catch(() => null)
  const voices = [...(r?.receipt ? [r.receipt] : []), ...(r?.entries || [])].flatMap((e) => e.panel || [e]).filter((v) => v.bytes?.request)
  const same = voices.filter((v) => { try { return JSON.parse(v.bytes.request).messages[0].content === REVIEW_SYS } catch { return false } })
  console.log({ job, voices: voices.length, system_message_is_the_text: same.length })
  ok = voices.length > 0 && same.length === voices.length
}
console.log({ prompt_bytes: REVIEW_SYS.length, sha256: hash })
if (!ok) { console.log('STOP: no live receipt carries this text as its system message (give a job reviewed under the pinned text, or pass --new)'); process.exit(1) }
const live = await view(CONTRACT, 'get_reviewer_prompt').catch(() => undefined)
if (live === undefined) { console.log('get_reviewer_prompt is not on this contract: nothing to send'); process.exit(1) }
console.log('on chain now:', live ? `${live.length} bytes, sha256 ${crypto.createHash('sha256').update(live).digest('hex').slice(0, 16)}…` : 'none')
if (live === REVIEW_SYS) { console.log('already registered, nothing to send'); process.exit(0) }
if (!GO) { console.log('dry run: nothing sent. add --go'); process.exit(0) }
const owner = signer((process.env.KEYS_DIR || './keys/') + 'mainnet-nearlyops.json'); if (owner.accountId !== 'nearlyops.near') throw new Error('not the owner key')
const t = await owner.signAndSendTransaction({ receiverId: CONTRACT, actions: [actions.functionCall('set_reviewer_prompt', { prompt: REVIEW_SYS }, 30n * 10n ** 12n, 0n)] })
const fail = t.receipts_outcome.find((o) => o.outcome.status.Failure)
console.log('set_reviewer_prompt', t.transaction.hash, fail ? 'FAILED ' + JSON.stringify(fail.outcome.status.Failure).slice(0, 200) : 'ok')
const h = await view(CONTRACT, 'get_reviewer_prompt_hash').catch(() => null)
console.log('on chain hash:', h, h === hash ? '= sha256 of the server text' : 'DIFFERS')
