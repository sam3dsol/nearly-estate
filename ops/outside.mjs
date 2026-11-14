// npm run outside: every outside account the site counts, re-checked on chain without trusting the site. For each account, the first
// transaction it is listed with is read from NEAR's archival RPC: the signer is the one listed, a call on the contract with that method
// succeeded (a bet by its message; a bet paid from another chain names that owner), and the account is not the team's (team.json, and
// every swarm agent a team account owns, read from the contract now). A read that fails is UNKNOWN, never a pass.
//   node ops/outside.mjs [site | list.json]        default https://nearly.trade
import { RPC as PAID_RPC, ARCHIVAL as PAID_ARCHIVAL, fxHeaders } from './rpc.mjs'
import fs from 'node:fs'
const SITE = process.argv[2] || 'https://nearly.trade', C = 'keys.nearlyops.near', WRAP = 'wrap.near'
const RPC = PAID_RPC, ARCHIVAL = PAID_ARCHIVAL
const TEAM_FILE = new URL('../server/team.json', import.meta.url)   // the team list is not in this repo: without the file, the list the site returns (team) is used
let TEAM = fs.existsSync(TEAM_FILE) ? JSON.parse(fs.readFileSync(TEAM_FILE, 'utf8')) : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const json = (s) => { try { return JSON.parse(s) } catch { return null } }
const b64 = (s) => Buffer.from(s || '', 'base64').toString()
async function rpc(url, method, params, tries = 3) {
  for (let i = 0; ; i++) {
    try {
      await sleep(250)
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20_000) })
      const d = await r.json()
      if (d.error) throw new Error(JSON.stringify(d.error.cause || d.error).slice(0, 120))
      return d.result
    } catch (e) { if (i + 1 >= tries) throw e; await sleep(1500 * (i + 1)) }
  }
}
const view = async (m, a) => JSON.parse(Buffer.from((await rpc(RPC, 'query', { request_type: 'call_function', finality: 'final', account_id: C, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString('base64') })).result).toString())

// a saved copy of the list works too: node ops/outside.mjs list.json
const s = SITE.endsWith('.json') ? JSON.parse(fs.readFileSync(SITE, 'utf8')) : await (await fetch(`${SITE}/api/outside`, { signal: AbortSignal.timeout(30_000) })).json()
TEAM ||= { accounts: s.team || [], rule: s.team_rule || '' }
const team = new Set(TEAM.accounts), ownerOf = new Map()
for (let from = 0; ; from += 100) { const p = await view('get_agents', { from, limit: 100 }); for (const a of p) { if (team.has(a.owner)) team.add(a.account); else ownerOf.set(a.account, a.owner) } if (p.length < 100) break }

/** the first listed tx of one account, read from the chain: PASS, FAIL (with why) or UNKNOWN */
async function check(a) {
  if (team.has(a.account)) return ['FAIL', 'a team account']
  let t
  try { t = await rpc(ARCHIVAL, 'EXPERIMENTAL_tx_status', { tx_hash: a.first.tx, sender_account_id: a.first.signer, wait_until: 'FINAL' }) }
  catch (e) { return ['UNKNOWN', `read failed: ${e.message}`] }
  if (t.transaction?.signer_id !== a.first.signer) return ['FAIL', `signed by ${t.transaction?.signer_id}`]
  const ok = new Map((t.receipts_outcome || []).map((o) => [o.id, o.outcome.status]))
  for (const r of t.receipts || []) {
    const st = ok.get(r.receipt_id) || {}
    if (r.receiver_id !== C || !('SuccessValue' in st || 'SuccessReceiptId' in st)) continue
    for (const x of r.receipt?.Action?.actions || []) {
      const f = x.FunctionCall; if (!f) continue
      if (f.method_name === a.first.method) return a.first.signer === a.account || ownerOf.get(a.first.signer) === a.account ? ['PASS', ''] : ['FAIL', 'signed by neither the account nor its agent']
      if (f.method_name === 'ft_on_transfer' && r.predecessor_id === WRAP) {
        const args = json(b64(f.args)) || {}, msg = json(args.msg)
        const kind = typeof msg === 'string' ? msg : msg && Object.keys(msg)[0]
        const who = msg?.BuyFor?.owner || args.sender_id
        if (kind === a.first.method && who === a.account) return ['PASS', '']
      }
    }
  }
  return ['FAIL', `no successful ${a.first.method} by ${a.account} on ${C} in that tx`]
}

const n = { PASS: 0, FAIL: 0, UNKNOWN: 0 }
console.log(`${s.accounts} users on chain, not counting the team's own accounts, listed by ${SITE.endsWith('.json') ? SITE : SITE + '/api/outside'} (${s.actions} actions; wiki ${s.by_product.wiki}, keys ${s.by_product.keys}, swarm ${s.by_product.swarm}); ${s.new_since ?? 0} new since ${s.since}`)
console.log(`team left out: ${TEAM.accounts.length} accounts (${fs.existsSync(TEAM_FILE) ? 'server/team.json' : 'the list the site returns; server/team.json is not in this repo'}), and the swarm agents they own (${team.size - TEAM.accounts.length} now)\n`)
for (const a of s.list) {
  const [v, why] = await check(a); n[v]++
  console.log(`${v.padEnd(7)} ${a.account.length > 40 ? a.account.slice(0, 12) + '…' : a.account}  ${a.products.join('+')}  first: ${a.first.method} ${new Date(a.first.at).toISOString().slice(0, 16)}Z  https://nearblocks.io/txns/${a.first.tx}${why ? '  (' + why + ')' : ''}`)
}
console.log(`\n${n.PASS} PASS, ${n.FAIL} FAIL, ${n.UNKNOWN} UNKNOWN`)
process.exit(n.FAIL ? 1 : 0)
