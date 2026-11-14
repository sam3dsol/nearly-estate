// the bonds the contract holds for whoever posted them are kept out of its free NEAR. The owner sets the
// count from every market's stakes (a recount only recounts). Run from the repo root:
//   node ops/bonds-held.mjs        dry: sums every unsettled market's stakes and shows what is on chain now
//   node ops/bonds-held.mjs --go   calls recount_bonds_held with the owner's key, then checks it against the sum
import { actions } from 'near-api-js'
import { signer, view, CONTRACT } from '../server/near.mjs'

const GO = process.argv.includes('--go')
const N = (x) => Number(BigInt(x || 0)) / 1e24
const all = []
for (let from = 0; ; from += 100) {
  const page = await view(CONTRACT, 'get_markets', { from, limit: 100 })
  all.push(...page); if (page.length < 100) break
}
const open = all.filter((m) => { const s = m.status; return s && typeof s === 'object' && ('Proposed' in s || 'Challenged' in s) })
let sum = 0n
for (const m of open) { const st = await view(CONTRACT, 'get_stakes', { market: String(m.id) }); for (const x of st) sum += BigInt(x.bond) }
const onchain = await view(CONTRACT, 'get_bonds_held').catch(() => undefined)
console.log({ markets: all.length, proposed_or_challenged: open.length, stakes_sum_near: N(sum), get_bonds_held: onchain === undefined ? 'not on chain' : N(onchain) })
if (onchain === undefined) { console.log('get_bonds_held is not on this contract'); process.exit(GO ? 1 : 0) }
if (!GO) { console.log('dry run: nothing sent. node ops/bonds-held.mjs --go'); process.exit(0) }
const owner = signer((process.env.KEYS_DIR || './keys/') + 'mainnet-nearlyops.json'); if (owner.accountId !== 'nearlyops.near') throw new Error('not the owner key')
const t = await owner.signAndSendTransaction({ receiverId: CONTRACT, actions: [actions.functionCall('recount_bonds_held', {}, 300n * 10n ** 12n, 0n)] })
const fail = t.receipts_outcome.find((o) => o.outcome.status.Failure)
console.log('recount_bonds_held', t.transaction.hash, fail ? 'FAILED ' + JSON.stringify(fail.outcome.status.Failure).slice(0, 200) : 'ok')
const after = await view(CONTRACT, 'get_bonds_held')
console.log({ get_bonds_held_near: N(after), matches_the_sum: BigInt(after) === sum })
