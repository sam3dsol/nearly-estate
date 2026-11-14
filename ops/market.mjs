// Open a claim (a YES/NO market) from the CLI with the team's nearlyops key. Wraps the NEAR, sends it to the contract as the LMSR seed.
//   node ops/market.mjs --go "Does NEARLY have more than 2,700 holders on Nov 5, 2026?" --near 0.1 --in-min 3 [--subject <token>|none] [--at <ISO date>]
// A templated claim is judged from nearly.trade's numbers; any other wording goes to the
// TEE-tier model, whose signed receipt lands at /api/markets/<id>/receipt once the market is past its date.
import fs from 'node:fs'
import { webcrypto } from 'node:crypto'
globalThis.crypto ??= webcrypto
import { Account, KeyPair, KeyPairSigner, JsonRpcProvider, actions } from 'near-api-js'
const V = (process.env.KEYS_DIR || './keys/')
const p = new JsonRpcProvider({ url: (process.env.NEAR_RPC || 'https://rpc.mainnet.fastnear.com') })
const C = process.env.KEYS_CONTRACT || 'keys.nearlyops.near'
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const question = process.argv.slice(2).find((a) => !a.startsWith('--') && !/^[\d.]+$/.test(a) && !['keys.nearlyops.near'].includes(a) && a.length > 10)
const near = Number(arg('--near', '0.1')), inMin = Number(arg('--in-min', '3')), at = arg('--at', null), subjectArg = arg('--subject', 'nearly-993927.nearlytrade.near'), subject = subjectArg === 'none' ? null : subjectArg
if (!question) { console.error('question?'); process.exit(2) }
const resolves_at_ms = at ? Date.parse(at) : Date.now() + inMin * 60e3  // --at 2026-11-20T23:59:00Z picks the date; --subject none for a claim on no launch
console.log({ question, subject, near, resolves_at: new Date(resolves_at_ms).toISOString() })
if (!process.argv.includes('--go')) { console.log('dry. add --go'); process.exit(0) }
const ops = JSON.parse(fs.readFileSync(V + 'mainnet-nearlyops.json'))
const me = new Account(ops.account_id, p, new KeyPairSigner(KeyPair.fromString(ops.private_key)))
const N = (x) => (BigInt(Math.round(x * 1e6)) * 10n ** 18n).toString()
const T = (x) => 10n ** 12n * BigInt(x)
const call = async (rx, m, a, dep = 0n, gas = 100n) => { const r = await me.signAndSendTransaction({ receiverId: rx, actions: [actions.functionCall(m, a, T(Number(gas)), BigInt(dep))] }); const f = r.receipts_outcome.find((o) => o.outcome.status.Failure); if (f) throw new Error(JSON.stringify(f.outcome.status.Failure).slice(0, 300)); console.log(m, r.transaction.hash); return r }
const view = async (m, a = {}) => JSON.parse(Buffer.from((await p.query({ request_type: 'call_function', finality: 'final', account_id: C, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString('base64') })).result).toString())
await call('wrap.near', 'near_deposit', {}, N(near), 30n)
await call('wrap.near', 'ft_transfer_call', { receiver_id: C, amount: N(near), msg: JSON.stringify({ Create: { question, subject, resolves_at_ms } }) }, 1n, 100n)
const m = (await view('get_markets', { from: 0, limit: 200 })).at(-1)
console.log('market', m.id, m.question, 'p_yes', m.p_yes, 'resolves', new Date(m.resolves_at_ms).toISOString())
