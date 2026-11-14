// Re-check every on-chain claim in the README against mainnet, with nothing but node (no packages, no keys, no server/data)
// npm run verify (NEAR_RPC, TX_API, SITE, SOLANA_RPC, KEYS_CONTRACT override the defaults; NEAR reads go through the paid FastNEAR key in ops/rpc.mjs)
// Prints PASS / FAIL / SKIP per claim with the tx or URL it read, exits 1 on any FAIL.
import { RPC as PAID_RPC, ARCHIVAL as PAID_ARCHIVAL, fxHeaders } from './rpc.mjs'
import { createHash, createPublicKey, verify as edVerify } from 'node:crypto'
import fs from 'node:fs'
// the three reviewers print as what each checks, the same words as the Swarm page (their names on chain stay as written)
const role = (n) => ({ Scholar: 'Substance', Contrarian: 'Challenge', Bayesian: 'Odds' })[n] ?? n

const RPC = PAID_RPC   // the paid FastNEAR key (ops/rpc.mjs); NEAR_RPC overrides
const TXAPI = process.env.TX_API || 'https://tx.main.fastnear.com/v0/transactions'   // any tx by hash, no sender needed, archival
const SITE = process.env.SITE || 'https://nearly.trade'
const SOL = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com'
const C = process.env.KEYS_CONTRACT || 'keys.nearlyops.near'
const root = new URL('../', import.meta.url).pathname
const md = fs.readFileSync(root + 'README.md', 'utf8') + '\n' + fs.readFileSync(root + 'docs/FULL.md', 'utf8')   // the short README and the long version, every tx in both

const get = async (url, body, tries = 5) => {   // a public RPC that rate-limits (429) gets a longer wait before the next try
  for (let i = 1; ; i++) {
    try { const r = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...fxHeaders(url) }, body: body && JSON.stringify(body), signal: AbortSignal.timeout(30_000) }); if (!r.ok) throw new Error(`${r.status} ${url}`); return await r.json() }
    catch (e) { if (i >= tries) throw e; await new Promise((s) => setTimeout(s, (/^429 /.test(e.message) ? 8000 : 1500) * i)) }
  }
}
// a rate-limited read is retried with a growing wait, so a 429 never drops a line from the count
const rpc = async (method, params) => { for (let i = 1; ; i++) { const r = await get(RPC, { jsonrpc: '2.0', id: 1, method, params }), e = r.error || r.result?.error; if (e && i < 6 && /429|rate limit/i.test(JSON.stringify(e))) { await new Promise((s) => setTimeout(s, 2000 * i)); continue } if (e) throw new Error(JSON.stringify(e).slice(0, 160)); return r.result } }
const view = async (m, a = {}) => JSON.parse(Buffer.from((await rpc('query', { request_type: 'call_function', finality: 'final', account_id: C, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString('base64') })).result).toString())
const all = async (m) => { const out = []; for (let from = 0; ; from += 100) { const p = await view(m, { from, limit: 100 }); out.push(...p); if (p.length < 100) return out } }
const sha = (s) => createHash('sha256').update(s).digest('hex')
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const b58 = (buf) => { let n = BigInt('0x' + (buf.toString('hex') || '0')), s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n } for (const b of buf) { if (b) break; s = '1' + s } return s }
// a call's args are JSON for this contract; other contracts (NEAR Intents' execute_intents) may send bytes that are not
const json = (x) => { try { return JSON.parse(x || '{}') } catch { return {} } }
const args = (t) => t.transaction.actions.map((a) => a.FunctionCall && { method: a.FunctionCall.method_name, args: json(Buffer.from(a.FunctionCall.args, 'base64').toString()), deposit: a.FunctionCall.deposit }).filter(Boolean)
const logs = (t) => t.receipts.flatMap((r) => r.execution_outcome.outcome.logs)
const failed = (t) => [t.execution_outcome, ...t.receipts.map((r) => r.execution_outcome)].some((o) => o.outcome.status.Failure)

/** a signed receipt: the kept bytes hash to the signed text, the signature verifies under the signer, and the hash the chain stored is
 * sha256(signed_text|signature|signer), which the contract computes itself after its own ed25519_verify. An e2ee receipt
 * (an encrypted call) has no plain bytes to rehash: its signature and the chain's hash are still checked.*/
function receiptOk(R, onchain, mustAsk, mustAnswer) {
  if (!R.bytes) { if (!R.e2ee) return [false, 'no bytes kept']; mustAsk = mustAnswer = null }
  const hashes = !R.bytes || `${R.model}:${sha(R.bytes.request)}:${sha(R.bytes.response)}` === R.signed_text
  const pub = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(R.signer, 'hex')]), format: 'der', type: 'spki' })
  const sig = R.algo === 'ed25519' && edVerify(null, Buffer.from(R.signed_text, 'utf8'), pub, Buffer.from(R.signature, 'hex'))
  const bound = onchain == null || sha(`${R.signed_text}|${R.signature}|${R.signer}`) === onchain
  // a question with quotes or backslashes sits escaped twice in the request (JSON inside JSON), so it is matched the way the
  // contract's signed_voice does: plain, escaped once or escaped twice (markets 103 and 182 have quoted titles)
  const esc = (t) => JSON.stringify(t).slice(1, -1)
  const asked = !mustAsk || [mustAsk, esc(mustAsk), esc(esc(mustAsk))].some((x) => R.bytes.request.includes(x))
  const answered = !mustAnswer || mustAnswer.some((v) => JSON.parse(R.bytes.response).choices[0].message.content.replace(/\s/g, '').includes(v))
  const bad = [!hashes && 'bytes != signed text', !sig && 'signature', !bound && 'chain hash differs', !asked && 'request is about something else', !answered && 'response does not carry the verdict'].filter(Boolean)
  return [!bad.length, bad.join(', ') || `signer ${R.signer.slice(0, 12)}…, model ${R.model}${R.bytes ? '' : ', e2ee (signature + chain hash only)'}`]
}

const rows = []
async function check(claim, fn) {
  let r; try { r = await fn() } catch (e) { r = [false, '', 'could not read: ' + String(e.message || e).slice(0, 140)] }
  const [ok, ref = '', note = ''] = r
  rows.push({ s: ok == null ? 'SKIP' : ok ? 'PASS' : 'FAIL', claim, ref, note })
  console.log(`${rows.at(-1).s}  ${claim}${ref ? `  [${ref}]` : ''}${note ? `  ${note}` : ''}`)
}

// every NEAR tx hash the README cites (base58 in backticks, not named as an intent hash or a deposit address)
const cited = [...new Set([...md.matchAll(/`([1-9A-HJ-NP-Za-km-z]{43,44})`/g)].filter((m) => !/(intent hash|deposit|address|code hash)\s*$/i.test(md.slice(m.index - 24, m.index))).map((m) => m[1]))]
const txs = new Map()
for (let i = 0; i < cited.length; i += 20) for (const t of (await get(TXAPI, { tx_hashes: cited.slice(i, i + 20) })).transactions || []) txs.set(t.transaction.hash, t)
const byMethod = (m) => [...txs.values()].filter((t) => args(t).some((a) => a.method === m)).sort((a, b) => b.execution_outcome.block_height - a.execution_outcome.block_height)
const [owner, , operator, , , feeBps] = await view('get_config')
console.log(`contract ${C}, ${cited.length} tx hashes cited in the README, RPC ${RPC.replace(/\?.*/, '')}\n`)

for (const h of cited) await check(`README tx ${h.slice(0, 10)}… is on mainnet and succeeded`, async () => {
  const t = txs.get(h); if (!t) return [false, h, 'not found']
  return [!failed(t), h, `${t.transaction.signer_id.slice(0, 22)} -> ${t.transaction.receiver_id} ${args(t).map((a) => a.method).join('+') || Object.keys(t.transaction.actions[0])[0]}`]
})

// the build this repo pins: the README cites its deploy tx, and this is the code hash that tx carried
const CODE = '3KQGx1pFFLfZbhY5DiGY5Lf4XMh9cogzpDcqMN2HgPz4'
const liveCode = (await rpc('query', { request_type: 'view_account', finality: 'final', account_id: C })).code_hash
await check('the deployed code is the build the README pins, and the cited deploy tx carried it', async () => {
  const d = [...txs.values()].filter((t) => t.transaction.receiver_id === C && t.transaction.actions.some((a) => a.DeployContract)).sort((a, b) => b.execution_outcome.block_height - a.execution_outcome.block_height)[0]
  if (!d) return [false, '', 'no deploy tx cited']
  const sent = b58(Buffer.from(d.transaction.actions.find((a) => a.DeployContract).DeployContract.code, 'base64'))
  return [liveCode === CODE && sent === CODE && !failed(d), d.transaction.hash, `code hash ${liveCode}`]
})
await check('the wasm built from this tree has that code hash', async () => {
  const f = root + 'target/near/nearly_keys/nearly_keys.wasm'
  if (!fs.existsSync(f)) return [null, '', 'build first: cargo near build non-reproducible-wasm']
  // a wasm older than the contract source on disk is a stale build: it skips instead of failing
  if (fs.statSync(f).mtimeMs < fs.statSync(root + 'contracts/keys/src/lib.rs').mtimeMs) return [null, '', 'the wasm is older than contracts/keys/src/lib.rs, build again: cargo near build non-reproducible-wasm']
  const mine = b58(createHash('sha256').update(fs.readFileSync(f)).digest())
  return [mine === liveCode, f.replace(root, ''), `local ${mine}`]
})
// code changes belong to a council: the upgrade account, its members and threshold, and the keys on the contract account
await check('code upgrades belong to the council: nearly-estate.sputnik-dao.near, 3 members, 2 must approve', async () => {
  const u = await view('get_upgrade')
  const pol = JSON.parse(Buffer.from((await rpc('query', { request_type: 'call_function', finality: 'final', account_id: 'nearly-estate.sputnik-dao.near', method_name: 'get_policy', args_base64: 'e30=' })).result).toString())
  const council = pol.roles.find((r) => r.kind?.Group)?.kind.Group || []
  return [u.account === 'nearly-estate.sputnik-dao.near' && u.pending === null && u.offered_to === null && council.length === 3 && JSON.stringify(pol.default_vote_policy.threshold) === '[1,2]', 'get_upgrade, get_policy', `upgrade account ${u.account}, delay ${u.delay_ms} ms, council ${council.join(', ')}, more than half must approve`]
})
await check('the contract account has no access key: only the council can change its code', async () => {
  const k = (await rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id: C })).keys
  return [k.length === 0, 'view_access_key_list', `${k.length} access keys`]
})
await check('roles: owner nearlyops.near, operator keysop.nearlyops.near, protocol fee 1%', async () => [owner === 'nearlyops.near' && operator === 'keysop.nearlyops.near' && feeBps === 100, 'get_config', `owner ${owner}, operator ${operator}, fee_bps ${feeBps}`])
// the judge's relay key: the operator's latest cited call into this contract that is not a hired desk's trade (those have their own
// key, checked below; the AddKey that created it was signed by the operator account's full-access key, on the account itself)
const DESK_METHODS = ['desk_buy', 'desk_sell', 'desk_charge']
const relayTx = [...txs.values()].filter((x) => x.transaction.signer_id === operator && x.transaction.receiver_id === C && !args(x).some((a) => DESK_METHODS.includes(a.method))).sort((a, b) => b.execution_outcome.block_height - a.execution_outcome.block_height)[0]
await check('the operator signs with a function-call key limited to this contract', async () => {
  const t = relayTx
  const k = await rpc('query', { request_type: 'view_access_key', finality: 'final', account_id: operator, public_key: t.transaction.public_key })
  const fc = k.permission?.FunctionCall
  return [fc?.receiver_id === C, t.transaction.hash, fc ? `${fc.method_names.length} methods, allowance ${(Number(fc.allowance || 0) / 1e24).toFixed(2)} NEAR` : JSON.stringify(k.permission)]
})

const signerTx = byMethod('set_model_signer')[0], modelSigner = signerTx && args(signerTx)[0].args.signer
// a proposal from an account that is not the resolver carries a bond and the judge's bytes; the chain took it (the signature is checked there)
for (const t of byMethod('propose').filter((t) => t.transaction.signer_id !== operator && Number(args(t).find((x) => x.method === 'propose')?.deposit || 0) > 0)) {
  const a = args(t).find((x) => x.method === 'propose'), bond = Number(a.deposit || 0) / 1e24
  await check(`market ${a.args.market}: proposed by an outside account with a bond and the judge's signed bytes`, async () => {
    const m = await view('get_market', { market: String(a.args.market) }), st = m.status.Proposed || m.status.Challenged || m.status.Resolved
    const by = m.status.Proposed?.by || m.status.Challenged?.by
    return [!failed(t) && bond >= 0.5 && !!a.args.signature && !!a.args.request && (!by || by === t.transaction.signer_id), t.transaction.hash, `${t.transaction.signer_id}, bond ${bond} NEAR, now ${Object.keys(m.status)[0]} ${st?.outcome}`]
  })
}
const markets = await all('get_markets')
// a ruling may be signed by any of the three registered judges (the deciding voice)
const judgeKeys = new Set((await view('get_model_signers').catch(() => [modelSigner])).map((x) => String(x).toLowerCase()))
// in the Challenged state status.outcome is the challenger's side, not the judges' verdict. The verdict is the first ruling the
// contract keeps for a ruling its relay brought (get_first_ruling), else the outcome two of the three stored voices carry; the
// receipt and the panel are then checked against what the judges ruled. A receipt or a voice that does not verify still fails.
async function ruledOutcome(m) {
  const c = m.status.Challenged; if (!c) return (m.status.Proposed || m.status.Resolved)?.outcome
  const first = await view('get_first_ruling', { market: String(m.id) }).catch(() => null)
  if (typeof first === 'boolean') return first
  const panel = await view('get_ruling_panel', { market: String(m.id) }).catch(() => null)
  if (Array.isArray(panel)) for (const o of [true, false]) if (panel.filter((v) => v.outcome === o).length >= 2) return o
  return c.outcome
}
for (const m of markets) {
  const st = m.status.Proposed || m.status.Challenged
  if (!st?.receipt) continue
  await check(`market ${m.id}: the sealed judge's ruling is signed by a registered judge, and the chain stored the hash of exactly that receipt`, async () => {
    const local = `${root}ops/receipts/market-${m.id}.json`
    const r = await get(`${SITE}/api/markets/${m.id}/receipt`).catch(() => (fs.existsSync(local) ? JSON.parse(fs.readFileSync(local, 'utf8')) : null))
    if (!r) return [st.by === operator ? false : null, `${SITE}/api/markets/${m.id}/receipt`, st.by === operator ? 'the relay proposed it and serves no receipt' : `brought by ${st.by} (open settlement): the signed bytes are the bringer's, the chain holds their hash ${st.receipt.slice(0, 8)}…`]
    const [ok, note] = receiptOk(r.receipt, st.receipt, m.question, [`"outcome":${await ruledOutcome(m)}`])
    const sameSigner = judgeKeys.has(String(r.receipt.signer).toLowerCase())
    return [ok && sameSigner, `${SITE}/api/markets/${m.id}/receipt`, sameSigner ? `${note} (judge key ${String(r.receipt.signer).slice(0, 8)}…)` : `signer is not one of the ${judgeKeys.size} registered judge keys (the first was registered in ${signerTx?.transaction.hash})`]
  })
}
// a ruling by three judges keeps every voice on chain (get_ruling_panel): three models under three registered keys, two of three
// on the outcome, each voice the hash of its own signed receipt. Where the server serves only the receipt the market stored, this
// check says so (SKIP) instead of passing on the shape alone
for (const m of markets.filter((x) => x.status.Proposed || x.status.Challenged || x.status.Resolved)) {
  const panel = await view('get_ruling_panel', { market: String(m.id) }).catch((e) => ({ unread: String(e?.message || e).slice(0, 80) }))
  if (!panel) continue
  if (panel.unread) { await check(`market ${m.id}: the three judges' votes on chain (get_ruling_panel) could be read`, async () => [false, 'get_ruling_panel', `read failed, unknown (not a pass): ${panel.unread}`]); continue }
  await check(`market ${m.id}: the three judges' votes on chain (get_ruling_panel) are three models under three registered keys, each the hash of a signed receipt that verifies`, async () => {
    const ruled = await ruledOutcome(m)
    const shape = panel.length === 3 && new Set(panel.map((v) => v.model)).size === 3 && new Set(panel.map((v) => v.signer.toLowerCase())).size === 3 && panel.every((v) => judgeKeys.has(v.signer.toLowerCase())) && panel.filter((v) => v.outcome === ruled).length >= 2
    const short = panel.map((v) => `${v.model.split('/').pop()} ${v.outcome}`).join(', ')
    const local = `${root}ops/receipts/market-${m.id}.json`
    const r = await get(`${SITE}/api/markets/${m.id}/receipt`).catch(() => (fs.existsSync(local) ? JSON.parse(fs.readFileSync(local, 'utf8')) : {}))
    if (!Array.isArray(r.voices)) return [shape ? null : false, `${SITE}/api/markets/${m.id}/receipt`, `${shape ? short + '; three models, three registered keys, two of three on the outcome' : 'the panel on chain is not three models under three registered keys'}; the server serves only the stored receipt`]
    const bad = panel.map((v) => {
      const R = r.voices.find((x) => x.model === v.model); if (!R) return `${v.model}: no receipt served`
      const [ok, note] = receiptOk(R, v.receipt, m.question, [`"outcome":${v.outcome}`])
      return ok && String(R.signer).toLowerCase() === v.signer.toLowerCase() ? null : `${v.model.split('/').pop()}: ${ok ? 'signed by another key' : note}`
    }).filter(Boolean)
    return [shape && !bad.length, `${SITE}/api/markets/${m.id}/receipt`, bad.join('; ') || short]
  })
}
for (const f of fs.readdirSync(root + 'ops/receipts').filter((x) => /^market-\d+\.json$/.test(x))) {
  const r = JSON.parse(fs.readFileSync(root + 'ops/receipts/' + f, 'utf8')), m = markets.find((x) => x.id === r.market)
  // the propose tx carries the signed bytes the contract checked itself: a market that has resolved still proves its ruling
  const p = byMethod('propose').find((x) => String(args(x)[0].args.market) === String(r.market)), pa = p && args(p)[0].args
  const inTx = pa?.signed_text ? !failed(p) && pa.signed_text === r.receipt.signed_text && pa.signature === r.receipt.signature && (!pa.receipt || pa.receipt === sha(`${r.receipt.signed_text}|${r.receipt.signature}|${r.receipt.signer}`))
    : pa?.request ? !failed(p) && pa.request === r.receipt.bytes?.request && pa.response === r.receipt.bytes?.response && pa.signature === r.receipt.signature && pa.model === r.receipt.model : null
  await check(`market ${r.market}: the committed receipt verifies offline and matches the chain's outcome${inTx == null ? '' : ', and is the receipt the contract checked in its propose tx'}`, async () => {
    const [ok, note] = receiptOk(r.receipt, null, m.question, [`"outcome":${r.outcome}`])
    const res = m.status.Resolved || m.status.Proposed || m.status.Challenged
    return [ok && res?.outcome === r.outcome && inTx !== false, p ? p.transaction.hash : 'ops/receipts/' + f, `${note}; on chain ${Object.keys(m.status)[0]} ${res?.outcome}${inTx ? ', same bytes as the propose tx' : ''}${m.status.Proposed?.receipt === '' ? ' (proposed before receipts were bound on chain)' : ''}`]
  })
}
await check('market 2 finalized YES after its unchallenged window', async () => {
  const t = byMethod('finalize').find((x) => args(x)[0].args.market === '2'), m = markets.find((x) => x.id === 2)
  return [m.status.Resolved?.outcome === true && logs(t).some((l) => l === 'market 2 resolved YES'), t.transaction.hash, JSON.stringify(m.status)]
})
await check('markets 4 to 18 were opened by the contract itself from the wiki fund (perpetual, no date)', async () => {
  const f = markets.filter((m) => m.id >= 4 && m.id <= 18), fund = byMethod('ft_transfer_call').find((t) => logs(t).some((l) => l.startsWith('wiki fund +')))
  return [f.length === 15 && f.every((m) => m.creator === C && m.resolves_at_ms == null) && !!fund, fund?.transaction.hash, `${f.length} fact markets, wiki fund now ${(Number(await view('get_wiki_fund')) / 1e24).toFixed(3)} wNEAR`]
})

// any topic: pages written from Wikipedia, their fact markets from the wiki fund, deeper seeds, the judge on myths, the desk
await check('markets 41 to 91 were opened by the contract from the wiki fund for 17 topic pages (perpetual, no date)', async () => {
  const f = markets.filter((m) => m.id >= 41 && m.id <= 91), t = byMethod('open_fact').find((x) => logs(x).includes('fact market 41 opened from the wiki fund'))
  const topics = new Set(f.map((m) => m.subject))
  return [f.length === 51 && f.every((m) => m.creator === C && m.resolves_at_ms == null && /\.topic$/.test(m.subject || '')) && topics.size === 17 && !!t, t?.transaction.hash, `${f.length} fact markets on ${topics.size} topic pages`]
})
await check('the wiki fund was topped up (FundWiki deposits)', async () => {
  const f = byMethod('ft_transfer_call').filter((t) => logs(t).some((l) => l.startsWith('wiki fund +')))
  return [f.length >= 2 && f.every((t) => !failed(t)), f.map((t) => t.transaction.hash.slice(0, 10) + '…').join(', '), f.map((t) => `+${(Number(logs(t).find((l) => l.startsWith('wiki fund +')).split(/[+ ]/)[3]) / 1e24).toFixed(2)} wNEAR`).join(', ')]
})
await check("markets 92 to 101 were seeded with 0.3 wNEAR each through open_fact's seed", async () => {
  const f = markets.filter((m) => m.id >= 92 && m.id <= 101), b = 0.3 / Math.LN2
  const t = byMethod('open_fact').find((x) => logs(x).includes('fact market 92 opened from the wiki fund')), seed = t && args(t)[0].args.seed
  return [f.length === 10 && f.every((m) => m.creator === C && Math.abs(Number(m.b) / 1e24 - b) < 1e-6) && seed === '300000000000000000000000', t?.transaction.hash, `b = ${(Number(f[0]?.b) / 1e24).toFixed(4)} wNEAR on each (0.3 / ln 2)`]
})
for (const id of [41, 44, 56, 81, 53, 87]) await check(`market ${id}: the judge proposed NO on a topic page's myth, with signed bytes the contract checked itself`, async () => {
  const t = byMethod('propose').find((x) => String(args(x).find((a) => a.method === 'propose')?.args.market) === String(id)), a = t && args(t).find((x) => x.method === 'propose').args
  const m = markets.find((x) => x.id === id), st = m.status.Proposed || m.status.Challenged || m.status.Resolved
  return [!!t && !failed(t) && a.outcome === false && !!a.signature && !!a.request && st?.outcome === false, t?.transaction.hash, `${m.question.slice(0, 48)}… now ${Object.keys(m.status)[0]} ${st?.outcome}`]
})
await check("a fact desk agent's view is signed by the TEE model, and its buy is on chain from its own account", async () => {
  // the cited buy signed by one of the three desk agents' own accounts (other 64-hex signers are cited too, e.g. the lab scribe's bet)
  const desk = await get(`${SITE}/api/wiki/desk`), isAgent = (id) => desk.agents.some((x) => x.account === id)
  const t = byMethod('ft_transfer_call').find((x) => x.transaction.receiver_id === 'wrap.near' && isAgent(x.transaction.signer_id) && args(x).some((a) => a.method === 'ft_transfer_call' && a.args.receiver_id === C && /"Buy"/.test(a.args.msg || '')))
  const agent = t && desk.agents.find((x) => x.account === t.transaction.signer_id)
  const market = t && JSON.parse(args(t).find((a) => a.method === 'ft_transfer_call').args.msg).Buy.market, m = markets.find((x) => String(x.id) === String(market))
  const r = agent && await get(`${SITE}/api/wiki/claim/${market}/desk/${agent.id}`)
  const [ok, note] = r ? receiptOk(r.receipt, null, m?.question, null) : [false, 'no signed view']
  return [!!t && !failed(t) && !!agent && ok, t?.transaction.hash, `${agent ? 'an AI agent' : '?'} bought on market ${market}; ${note}`]
})
await check('the current version of a topic page is signed by the TEE model that wrote it', async () => {
  const r = await get(`${SITE}/api/wiki/napoleon/receipt`)
  const [ok, note] = receiptOk(r.receipt, null, 'Napoleon', null)
  return [ok, `${SITE}/api/wiki/napoleon/receipt`, note]
})

// hired desks: the trade-only key, the proof desk's hire, its two trades and its close, and what the contract says now
const yN = (y) => Number(BigInt(y) / 10n ** 18n) / 1e6   // yocto -> wNEAR, 6 decimals
// desk 1, the proof desk (the README cites later desks too: each check below is about desk 1's own txs)
const hireTx = byMethod('ft_transfer_call').find((t) => /"Hire"/.test(args(t).find((a) => a.method === 'ft_transfer_call')?.args.msg || '') && logs(t).some((l) => l.startsWith('desk 1 hired by ')))
const hireArgs = hireTx && args(hireTx).find((a) => a.method === 'ft_transfer_call').args, hireMsg = hireArgs && JSON.parse(hireArgs.msg).Hire
const deskOwner = hireTx?.transaction.signer_id
const deskArgs = (t) => args(t).find((a) => a.method === 'desk_buy').args
const deskBuys = byMethod('desk_buy').filter((t) => String(deskArgs(t).desk) === '1').reverse()   // desk 1's, oldest first
const DESK_KEY_METHODS = [...DESK_METHODS].sort().join()
const keyAdd = [...txs.values()].find((t) => t.transaction.actions.some((a) => [...(a.AddKey?.access_key.permission.FunctionCall?.method_names || [])].sort().join() === DESK_KEY_METHODS))
const deskKey = keyAdd?.transaction.actions.find((a) => a.AddKey).AddKey
await check('hired desks: a trade-only key was added on the operator account, desk_buy, desk_sell and desk_charge on this contract and nothing else, 1 NEAR allowance', async () => {
  const fc = deskKey?.access_key.permission.FunctionCall
  return [!!fc && !failed(keyAdd) && keyAdd.transaction.signer_id === operator && keyAdd.transaction.receiver_id === operator && fc.receiver_id === C && [...fc.method_names].sort().join() === DESK_KEY_METHODS && fc.allowance === '1000000000000000000000000', keyAdd?.transaction.hash, deskKey ? `${deskKey.public_key.slice(0, 18)}… on ${operator}` : 'no AddKey for the desk methods cited']
})
await check('hired desks: that key is on chain with desk_buy, desk_sell and desk_charge only; it signed every desk call cited, and the judge\'s relay signs with another key', async () => {
  const k = await rpc('query', { request_type: 'view_access_key', finality: 'final', account_id: operator, public_key: deskKey.public_key }), fc = k.permission?.FunctionCall
  const want = DESK_KEY_METHODS
  const deskCalls = DESK_METHODS.flatMap((m) => byMethod(m))
  const same = deskBuys.length > 0 && deskCalls.every((t) => t.transaction.signer_id === operator && t.transaction.public_key === deskKey.public_key)
  return [fc?.receiver_id === C && [...fc.method_names].sort().join() === want && same && relayTx.transaction.public_key !== deskKey.public_key, deskKey.public_key, fc ? `${fc.method_names.join(', ')}; allowance ${(Number(fc.allowance || 0) / 1e24).toFixed(4)} NEAR left, ${deskCalls.length} desk calls signed with it` : JSON.stringify(k.permission)]
})
await check('hired desks: desk 1 was hired with 0.5 wNEAR, 0.05 a trade and 0.1 a day; 0.02 paid its record, 0.48 was its balance', async () => {
  const l = logs(hireTx).find((x) => x.startsWith('desk 1 hired by '))
  return [!failed(hireTx) && hireArgs.receiver_id === C && hireArgs.amount === '500000000000000000000000' && hireMsg.max_trade === '50000000000000000000000' && hireMsg.daily === '100000000000000000000000' && md.includes(deskOwner) && l === `desk 1 hired by ${deskOwner}: 480000000000000000000000 wNEAR, at most 50000000000000000000000 a trade and 100000000000000000000000 a day`, hireTx?.transaction.hash, `"${hireMsg?.name}" by ${deskOwner?.slice(0, 12)}…`]
})
for (const t of deskBuys) {
  const a = deskArgs(t), side = a.yes ? 'YES' : 'NO'
  await check(`hired desks: desk ${a.desk} bought ${side} on market ${a.market}, the shares to its owner and the model's reason in the contract's log`, async () => {
    const d = logs(t).map((l) => /^desk (\d+) for (\S+) bought (YES|NO) on market (\d+) with (\d+) wNEAR: (.*)$/.exec(l)).find(Boolean)
    const buy = logs(t).find((l) => l.startsWith(`market ${a.market} buy ${side} `))
    const ok = !failed(t) && !!d && d[1] === String(a.desk) && d[2] === deskOwner && d[3] === side && d[4] === String(a.market) && d[5] === a.amount && d[6] === a.note && a.note.length > 0 && !!buy && buy.endsWith(` shares for ${deskOwner}`) && t.transaction.actions.every((x) => x.FunctionCall?.deposit === '0')
    return [ok, t.transaction.hash, `${yN(a.amount)} wNEAR: "${a.note.slice(0, 56)}…"`]
  })
}
await check('hired desks: the owner closed desk 1 with 1 yoctoNEAR and got the rest back, 0.48 wNEAR less its trades', async () => {
  const t = byMethod('close_desk').find((x) => String(args(x).find((y) => y.method === 'close_desk')?.args.desk) === '1'), a = t && args(t).find((x) => x.method === 'close_desk')
  const rest = 480000000000000000000000n - deskBuys.reduce((s, x) => s + BigInt(deskArgs(x).amount), 0n)
  const ok = !failed(t) && t.transaction.signer_id === deskOwner && a.args.desk === '1' && a.deposit === '1' && logs(t).includes(`desk 1 closed by ${deskOwner}, ${rest} wNEAR back`) && logs(t).includes(`Transfer ${rest} from ${C} to ${deskOwner}`)
  return [ok, t?.transaction.hash, `${yN(rest)} wNEAR back to ${deskOwner?.slice(0, 12)}…`]
})
await check('hired desks: get_desk 1 now says closed, balance 0, 2 trades, owner the wallet that hired it', async () => {
  const d = await view('get_desk', { desk: '1' })
  return [d?.open === false && d.balance === '0' && d.trades === 2 && d.trades === deskBuys.length && d.owner === deskOwner, 'get_desk 1', `"${d?.name}", ${yN(d?.spent || 0)} wNEAR spent in ${d?.trades} trades`]
})
await check('hired desks: get_desks_today answers, with the 20 wNEAR a day cap across all desks', async () => {
  const [spent, cap] = await view('get_desks_today')
  return [cap === '20000000000000000000000000' && BigInt(spent) <= BigInt(cap), 'get_desks_today', `${yN(spent)} of ${yN(cap)} wNEAR spent by all desks today (UTC)`]
})
await check('the trade index reads each desk trade from the chain: the owner\'s, via desk, the same wNEAR and reason', async () => {
  const bad = []
  for (const t of deskBuys) {
    const a = deskArgs(t), x = (await get(`${SITE}/api/wiki/claim/${a.market}/trades`)).trades.find((y) => y.tx === t.transaction.hash)
    if (!x || x.via !== 'desk' || x.account !== deskOwner || x.note !== a.note || Math.abs(x.near - yN(a.amount)) > 1e-6) bad.push(`market ${a.market}: ${x ? 'differs from the chain' : 'not indexed'}`)
  }
  return [deskBuys.length > 0 && !bad.length, `${SITE}/api/wiki/claim/<id>/trades`, bad.join('; ') || `${deskBuys.length} desk trades, each with its reason`]
})

// the reviewers' prompt pinned on chain: a voice's request carries it (the pinned text as the system message, the reviewer line opening
// the user message); a review signed before the pin carries the reviewer's name instead
const reviewerPin = await view('get_reviewer_prompt').catch(() => null)
const underPin = (req) => { try { const m = JSON.parse(req || '').messages; return !!reviewerPin && m[0].role === 'system' && m[0].content === reviewerPin && m[1].role === 'user' && m[1].content.startsWith('You are one of three reviewers; two of three decide. ') } catch { return false } }
for (const j of await all('get_jobs')) {
  const es0 = j.swarm ? await view('get_entries', { job: String(j.id) }) : [], es = es0.length ? es0 : [{ agent: null, review: j.review }]   // the earliest bids kept one review on the job
  const signed = es.filter((e) => e.review?.receipt)
  if (!signed.length) continue
  await check(`job ${j.id}: every AI review on chain is the hash of a signed receipt that verifies`, async () => {
    const api = await get(`${SITE}/api/swarm/review/${j.id}`)
    const bad = signed.map((e) => { const R = e.agent ? api.entries.find((x) => x.agent === e.agent) : api.receipt; if (!R) return `${e.agent?.slice(0, 8)}: no receipt`; const [ok, note] = receiptOk(R, e.review.receipt, null, [`"ok":${e.review.ok}`]); return ok ? null : `${e.agent?.slice(0, 8)}: ${note}` }).filter(Boolean)
    return [!bad.length, `${SITE}/api/swarm/review/${j.id}`, bad.join('; ') || `${signed.length} review(s), scores ${signed.map((e) => e.review.score).join(', ')}`]
  })
  // a panel review keeps all three voices on chain (get_panel). Each voice is the hash of its own signed receipt, its signed request
  // carries the pinned reviewer prompt (or, before the pin, the reviewer's name), and two of three decide the entry's review
  for (const e of es.filter((x) => x.agent && x.review)) {
    const panel = await view('get_panel', { job: String(j.id), agent: e.agent }).catch((x) => ({ unread: String(x?.message || x).slice(0, 80) }))
    if (!panel) continue
    if (panel.unread) { await check(`job ${j.id}: the three reviewers' votes on chain (get_panel) could be read`, async () => [false, 'get_panel', `read failed, unknown (not a pass): ${panel.unread}`]); continue }
    await check(`job ${j.id}: the three reviewers' votes on chain (get_panel) are each the hash of a signed receipt that verifies`, async () => {
      const api = await get(`${SITE}/api/swarm/review/${j.id}`), ent = (api.entries || []).find((x) => x.agent === e.agent)
      const once = JSON.stringify(e.result || '').slice(1, -1)   // the result sits in the request as JSON inside JSON: receiptOk escapes it once more
      const bad = panel.map((v) => {
        const R = (ent?.panel || []).find((x) => x.name === v.name); if (!R) return `${role(v.name)}: no receipt served`
        const [ok, note] = receiptOk(R, v.receipt, e.result ? once : null, [`"ok":${v.ok}`])
        const named = !!R.bytes?.request?.includes(`You are ${v.name}, one of three reviewers`) || underPin(R.bytes?.request)
        return ok && named ? null : `${role(v.name)}: ${ok ? 'its request carries neither its name nor the pinned reviewer prompt' : note}`
      }).filter(Boolean)
      const yes = panel.filter((v) => v.ok).length
      return [!bad.length && panel.length === 3 && (yes >= 2) === !!e.review.ok, `${SITE}/api/swarm/review/${j.id}`, bad.join('; ') || `${panel.map((v) => `${role(v.name)} ${v.ok ? 'ok' : 'no'} ${v.score}`).join(', ')}; ${yes} of 3 passed, review ${e.review.ok ? 'pass' : 'fail'}`]
    })
  }
}
await check('job 6 was settled by the review: scores 78 and 20, the best entry paid', async () => {
  const j = await view('get_job', { job: '6' }), es = await view('get_entries', { job: '6' }), t = byMethod('settle_job').find((x) => args(x)[0].args.job === '6')
  const best = es.reduce((a, b) => (b.review?.score > a.review?.score ? b : a))
  return [j.status.Approved?.agent === best.agent && j.result === best.result && es.map((e) => e.review.score).sort().join() === '20,78', t?.transaction.hash, logs(t || { receipts: [] })[0]]
})
await check('job 9 was cancelled with its NEAR back; job 10, a swarm of 3, was settled to its best entry', async () => { const j9 = await view('get_job', { job: '9' }), j = await view('get_job', { job: '10' }); return [j9.status === 'Cancelled' && !!j.status?.Approved && j.swarm && j.workers.length === 3 && !j.auto_approve, 'get_job 9, 10', `job 10: ${j.workers.length} workers, paid to ${String(j.status?.Approved?.agent).slice(0, 10)}… with score ${j.review?.score}`] })

await check('key 2 is on the team account (no coin behind it)', async () => { const k = await view('get_key', { key: '2' }), t = byMethod('register_key').find((x) => args(x)[0].args.token === 'nearlyops.near'); return [k.token === 'nearlyops.near' && !!t, t?.transaction.hash, `price ${Number(BigInt(k.price) / 10n ** 21n) / 1000} NEAR, sold ${k.sold}`] })

const co = /Solana tx `(\w+)` \(([\d.]+) SOL to the 1Click deposit `(\w+)`\).*?([\d.]+) NEAR delivered to ([\w.]+) `(\w+)`/s.exec(md)
await check('checkout: the Solana payment went to the 1Click deposit address', async () => {
  const t = (await get(SOL, { jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [co[1], { encoding: 'json', maxSupportedTransactionVersion: 0 }] })).result
  if (!t) return [false, co[1], 'not found on the Solana RPC (try SOLANA_RPC=<archival endpoint>)']
  const i = t.transaction.message.accountKeys.indexOf(co[3]), got = i < 0 ? 0 : (t.meta.postBalances[i] - t.meta.preBalances[i]) / 1e9
  const near = Math.abs(got - Number(co[2])) <= 0.5 * 10 ** -(co[2].split('.')[1] || '').length   // as precise as the README states it
  return [!t.meta.err && near, co[1], `${got} SOL to ${co[3].slice(0, 10)}… (README: ${co[2]})`]
})
await check('checkout: 1Click settled it and delivered NEAR to the merchant', async () => {
  const s = await get(`https://1click.chaindefuser.com/v0/status?depositAddress=${co[3]}`).catch(() => null)
  const t = txs.get(co[6]), w = t && logs(t).map((l) => l.startsWith('EVENT_JSON:') && JSON.parse(l.slice(11))).find((e) => e?.event === 'native_withdraw')?.data[0]
  const near = w ? Number(BigInt(w.amount) / 10n ** 18n) / 1e6 : 0
  return [!!w && w.receiver_id === co[5] && near === Number(co[4]) && (s == null || s.status === 'SUCCESS'), co[6], `${near} NEAR to ${w?.receiver_id}, 1Click status ${s?.status ?? 'unreachable (not counted)'}`]
})
const cb = /Base tx `(0x[0-9a-f]{64})` \(([\d.]+) ETH to the 1Click deposit `(0x[0-9a-fA-F]{40})`\).*?([\d.]+) NEAR delivered to ([\w.]+) `(\w+)`/s.exec(md)
await check('checkout: the Base payment went to the 1Click deposit address', async () => {
  const t = (await get(process.env.BASE_RPC || 'https://mainnet.base.org', { jsonrpc: '2.0', id: 1, method: 'eth_getTransactionByHash', params: [cb[1]] })).result
  if (!t) return [false, cb[1], 'not found on the Base RPC (try BASE_RPC=<archival endpoint>)']
  const eth = Number(BigInt(t.value)) / 1e18, same = t.to.toLowerCase() === cb[3].toLowerCase() && Math.abs(eth - Number(cb[2])) <= 0.5 * 10 ** -(cb[2].split('.')[1] || '').length
  return [!!t.blockNumber && same, cb[1], `${eth} ETH to ${cb[3].slice(0, 10)}… in block ${Number(t.blockNumber)} (README: ${cb[2]})`]
})
await check('checkout: 1Click settled the Base payment and delivered NEAR to the merchant', async () => {
  const s = await get(`https://1click.chaindefuser.com/v0/status?depositAddress=${cb[3]}`).catch(() => null)
  const t = txs.get(cb[6]), w = t && logs(t).map((l) => l.startsWith('EVENT_JSON:') && JSON.parse(l.slice(11))).find((e) => e?.event === 'native_withdraw')?.data[0]
  const near = w ? Number(BigInt(w.amount) / 10n ** 18n) / 1e6 : 0
  return [!!w && w.receiver_id === cb[5] && near === Number(cb[4]) && (s == null || s.status === 'SUCCESS'), cb[6], `${near} NEAR to ${w?.receiver_id}, 1Click status ${s?.status ?? 'unreachable (not counted)'}`]
})
await check('the key 2 trader\'s confidential swap', async () => [null, 'Da7yp5qS…', 'private by design: no public tx; a key 2 holder sees it in the feed'])

const n = (s) => rows.filter((r) => r.s === s).length
const txOnly = rows.filter((r) => r.s === 'PASS' && /is on mainnet and succeeded/.test(r.claim)).length
const SLACK = 8   // a clean clone runs a few lines fewer than the tree the count was taken in (no team.json, no wasm, settlements between runs), so the floor allows this much
// the README's cited count is a floor net of the lines on rulings awaiting settlement: a proposed or challenged market has a
// single-receipt line that goes once it settles (its panel line stays), every other line only grows as markets are ruled, so the cited
// count less its pending lines must not be above this run's count less this run's pending lines; with a fresh contract build every check
// but the private swap passes
const wasmSkipped = rows.some((r) => r.s === 'SKIP' && /wasm built from this tree/.test(r.claim || ''))
const pendingNow = rows.filter((r) => /the sealed judge's ruling is signed by a registered judge/.test(r.claim || '')).length
let citedPending = 0
await check("the README's cited counts are not above this run's, net of the lines on rulings awaiting settlement (those come and go; the other lines only grow)", async () => {
  const m = /"(\d+) PASS, 0 FAIL, 1 SKIP" \((\d+) and 2 SKIP[^)]*; (\d+) of the lines are on rulings awaiting settlement\)/.exec(md)
  citedPending = m ? Number(m[3]) : 0
  const fresh = n('PASS') + (wasmSkipped ? 1 : 0) + 5, stale = fresh - 1   // +1 for this check, +4 for the four after it (the reviewers' prompt, job 25's review, the judge prompt, the docs)
  return [!!m && Number(m[1]) - citedPending <= fresh - pendingNow + SLACK && Number(m[2]) - citedPending <= stale - pendingNow + SLACK, 'README.md', m ? `cited ${m[1]} with a fresh build, ${m[2]} without, ${m[3]} on rulings awaiting settlement; this run says ${fresh} and ${stale}, ${pendingNow} awaiting settlement` : 'no cited count found']
})
// the swarm reviewers' prompt is pinned on chain, and it is the text server/swarm.mjs sends (REVIEW_SYS), byte for byte
await check("the reviewers' prompt pinned on chain (get_reviewer_prompt_hash) is sha256 of the text the server sends", async () => {
  const src = fs.readFileSync(root + 'server/swarm.mjs', 'utf8'), m = /^export const REVIEW_SYS = ('[^\n]*')$/m.exec(src)
  const text = m ? new Function('return ' + m[1])() : ''
  const h = await view('get_reviewer_prompt_hash').catch(() => null)
  return [!!h && !!text && h === sha(text), 'get_reviewer_prompt_hash', h ? `${h.slice(0, 16)}… ${h === sha(text) ? '=' : '≠'} sha256 of the ${text.length}-byte text` : 'no prompt pinned']
})
// live proof: job 25 (post_job tx FVsWxWcJ…) got the lab agent's entry and a three-voice review at 19:26 UTC Nov 13 under the pin: each
// voice's signed request carries the pinned text as its system message, and the contract stored the review (score 88)
await check("job 25's three-voice review under the pinned reviewer prompt: each signed request's system message hashes to get_reviewer_prompt_hash, and get_entries holds the review", async () => {
  const h = await view('get_reviewer_prompt_hash').catch(() => null), r = await get(`${SITE}/api/swarm/review/25`).catch(() => null)
  const voices = [...(r?.entries || []), ...(r?.receipt ? [r.receipt] : [])].flatMap((e) => (Array.isArray(e.panel) && e.panel.length ? e.panel : [e]))
  const sys = voices.map((v) => { try { return JSON.parse(v.bytes.request).messages[0] } catch { return null } })
  const e = (await view('get_entries', { job: '25' }).catch(() => []))[0]
  const ok = !!h && sys.length === 3 && sys.every((m) => m?.role === 'system' && sha(m.content) === h) && e?.review?.ok === true
  return [ok, `${SITE}/api/swarm/review/25`, `${sys.length} voices, each system message sha256 ${String(h).slice(0, 16)}…; review ${e?.review?.ok ? 'ok' : 'not ok'}, score ${e?.review?.score}`]
})
// the judge prompt is stored as it sits inside the request JSON (escaped once): get_judge_prompt_hash covers that escaped text and the
// contract decodes it before comparing, so a receipt's system message (the decoded text) hashes to sha256 of the decoded prompt, not to the pin
await check("the latest ruling's receipt carries, as its system message, the judge prompt the contract stores (decoded from its JSON-escaped form)", async () => {
  const p = await view('get_judge_prompt').catch(() => null); if (!p) return [false, 'get_judge_prompt', 'no judge prompt pinned']
  const plain = JSON.parse(`"${p}"`), want = sha(plain), stored = sha(p)
  // the latest ruling by time (a proposed or challenged market carries at_ms; a resolved one is older): a ruling from before the current
  // prompt was registered carries the prompt of its day (markets 343 and 308 carry the 962-byte one), so the newest ruling is the one read
  const when = (x) => (x.status.Proposed || x.status.Challenged)?.at_ms || 0
  const latest = markets.filter((x) => x.status.Proposed || x.status.Challenged || x.status.Resolved).sort((a, b) => when(b) - when(a) || b.id - a.id)
  for (const m of latest.slice(0, 5)) {
    const r = await get(`${SITE}/api/markets/${m.id}/receipt`).catch(() => null)
    const voices = r ? [...(Array.isArray(r.voices) ? r.voices : []), ...(r.receipt ? [r.receipt] : [])].filter((v) => v.bytes?.request) : []
    if (!voices.length) continue
    const sys = voices.map((v) => { try { return JSON.parse(v.bytes.request).messages[0] } catch { return null } })
    return [sys.every((x) => x?.role === 'system' && sha(x.content) === want), `${SITE}/api/markets/${m.id}/receipt`, `market ${m.id}, ${sys.length} voice${sys.length > 1 ? 's' : ''}: sha256 of the decoded prompt ${want.slice(0, 16)}… = the system message; get_judge_prompt_hash ${stored.slice(0, 16)}… covers the escaped text`]
  }
  return [false, SITE, 'no ruled market serves a receipt']
})
// no doc may describe a bond ladder: a dispute is one challenge, then the judges' final look
await check('the docs describe the dispute rule that is live: one challenge, then the judges\' final look', async () => {
  const banned = [/each counter doubles/i, /a round nobody answers/i, /up to 4 NEAR over 3 rounds/i, /8 NEAR a round/i, /128 NEAR/, /last bond (standing )?wins/i, /No AI rules last/i, /No judge has the final word/i, /outbids? the caps/i]
  const hits = []
  for (const f of ['README.md', 'JUDGES.md', 'docs/FULL.md']) { const t = fs.readFileSync(root + f, 'utf8'); for (const re of banned) if (re.test(t)) hits.push(`${f}: ${re.source}`) }
  return [hits.length === 0, 'README.md, JUDGES.md, docs/FULL.md', hits.length ? hits.join('; ') : 'no bond-ladder phrase']
})
console.log(`\n${n('PASS')} PASS, ${n('FAIL')} FAIL, ${n('SKIP')} SKIP (${txOnly} check that a cited tx exists and succeeded, ${n('PASS') - txOnly} check what the chain or the server does)`)
process.exit(n('FAIL') ? 1 : 0)
