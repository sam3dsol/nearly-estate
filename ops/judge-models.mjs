// the owner registers the three judge models on chain; a voice from any other model is refused.
// Run from the repo's server/ directory:  node ops/judge-models.mjs [--go]
import { actions } from 'near-api-js'
import { signer, view, CONTRACT } from '../server/near.mjs'

const GO = process.argv.includes('--go')
const MODELS = ['deepseek-ai/DeepSeek-V4.1-Flash-1017', 'Qwen/Qwen3.8-27B', 'z-ai/glm-5.3-flash']
const live = await view(CONTRACT, 'get_judge_models').catch(() => undefined)
if (live === undefined) { console.log('get_judge_models is not on this contract'); process.exit(1) }
console.log('on chain now:', live)
const panel = await view(CONTRACT, 'get_ruling_panel', { market: '48' }).catch(() => null)
const seen = (panel || []).map((v) => v.model)
if (!MODELS.every((m) => seen.includes(m))) { console.log('STOP: the list differs from the models on market 48:', seen); process.exit(1) }
if (JSON.stringify(live) === JSON.stringify(MODELS)) { console.log('already registered'); process.exit(0) }
if (!GO) { console.log('dry run: would register', MODELS); process.exit(0) }
const owner = signer((process.env.KEYS_DIR || './keys/') + 'mainnet-nearlyops.json'); if (owner.accountId !== 'nearlyops.near') throw new Error('not the owner key')
const t = await owner.signAndSendTransaction({ receiverId: CONTRACT, actions: [actions.functionCall('set_judge_models', { models: MODELS }, 30n * 10n ** 12n, 0n)] })
const fail = t.receipts_outcome.find((o) => o.outcome.status.Failure)
console.log('set_judge_models', t.transaction.hash, fail ? 'FAILED ' + JSON.stringify(fail.outcome.status.Failure).slice(0, 200) : 'ok')
await new Promise((z) => setTimeout(z, 3000))
console.log('on chain:', await view(CONTRACT, 'get_judge_models'))
