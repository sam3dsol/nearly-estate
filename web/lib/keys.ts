// Keys, markets, swarm and wiki: the client of the keys server and the transactions the pages send.
// NEAR HACKATHON build. The keys server (server/) is the only thing that knows which trading account sits behind a key;
// the pages only ever see numbers.
import { API } from '../data/api'
import type { Tx } from './pool'

export const KEYS_API = ((import.meta.env.VITE_KEYS_API as string | undefined) ?? API).replace(/\/$/, '')
export const KEYS_WS = (KEYS_API || (typeof location !== 'undefined' ? location.origin : '')).replace(/^http/, 'ws')
export const CONTRACT = (import.meta.env.VITE_KEYS_CONTRACT as string | undefined) || 'keys.nearlyops.near'
const WRAP = 'wrap.near'

export class KeysError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status } }
async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(KEYS_API + path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } })
  const b = await r.json().catch(() => ({})) as { error?: string }
  if (!r.ok) throw new KeysError(r.status, b.error || `keys api ${r.status}`)
  return b as T
}
export const get = <T,>(p: string) => j<T>(p)
export const post = <T,>(p: string, body: unknown) => j<T>(p, { method: 'POST', body: JSON.stringify(body) })

/* ---------- shapes the server answers with ---------- */
export type Total = { pnl_usd: number; realized_usd?: number; unrealized_usd?: number; basis_usd?: number; roi?: number | null }
export type KeyRow = {
  id: number; token: string; min_hold: string; price: string; sold: number; confidential: boolean; coin: boolean; created_ms: number; revealed: string | null; live: boolean
  symbol?: string; name?: string; icon?: string | null; price_usd?: number | null; fdv_usd?: number | null; holders?: number; volume_24h_near?: number | null
  /** rounded on purpose (nearest $10, 5% steps): exact numbers would match the account on the public trade stream */
  pnl: { pnl_usd: number | null; roi: number | null } | null; stats: { trades: number; trades_label: string; win_rate: number | null; active: boolean } | null
  preview: { side: 'buy' | 'sell' }[]
  /** how many agents copy this key (a count only) */
  copying?: number
  /** the seller paused the listing (server flag): hidden from buyers, its page says so, holders keep access */
  paused?: boolean
}
export type FeedTrade = { ts_ms: number; token: string; symbol: string; name?: string; icon?: string | null; side: 'buy' | 'sell'; usd: number; tokens: number; mcap_usd: number }
export type IntentOp = { ts_ms: number | null; type: string; status: string | null; origin: string | null; destination: string | null; amount: string | null; amount_out: string | null; in?: string | null; out?: string | null; confidential?: boolean | null; id?: string | null; venue?: 'rhea'; tx?: string }
export type Feed = { trades: FeedTrade[]; bags: { token: string; symbol: string; open_usd: number; pnl_usd: number; roi: number | null }[]; total: Total; stats: KeyRow['stats']; intents?: IntentOp[]; rhea?: IntentOp[]; confidential?: boolean }
export type Status = 'Open' | { Proposed: { outcome: boolean; at_ms: number; by: string; receipt: string } } | { Challenged: { outcome: boolean; round: number; bond: string; by: string; at_ms: number; receipt: string } } | { Resolved: { outcome: boolean } } | { Invalid: { at_ms: number } }
export type MarketRow = {
  id: number; question: string; subject: string | null; creator: string; b: string; q_yes: string; q_no: string; collateral: string; fees: string
  resolves_at_ms: number | null; status: Status; created_ms: number; p_yes: number; symbol?: string; icon?: string | null; b_near: number; collateral_near: number
  resolution: { outcome: boolean | null; reason: string; confidence: number; judge: string; proposed: number; tx: string | null; final?: string; pinned_reading?: boolean; signed_on_chain?: number | null; final_ruling?: { outcome: boolean; tx: string; at: number; reason?: string } | null; panel?: { model: string; outcome: boolean | null; confidence: number; reason: string; verified: boolean }[] | null; verified: { kind: string; model: string; signer: string; tcb: string; gpu: string | null; at: number } | null } | null
}
export type Attestation = { model: string; verified: boolean; reason?: string; verified_at?: number; gateway?: { signer: string; tcb: string; tls: string }; models?: { signer: string; tcb: string; advisories: string[]; gpu: string | null; os_image: string; compose: string }[] }
export type Position = { yes: string; no: string }
/** a hired AI agent: its balance and caps in wNEAR (yocto strings), what it has spent and traded */
export type Desk = { id: number; owner: string; name: string; style: string; balance: string; max_trade: string; daily: string; day: number; spent_today: string; spent: string; trades: number; created_ms: number; open: boolean }
export type AgentRow = { account: string; owner: string | null; mine: boolean; name: string; prompt_hash: string; fund: string; spent: string; jobs_done: number; jobs_failed: number; joined_ms: number; fund_near: number; locked_near: number; score: number | null; spent_near: number; brain: 'set' | 'none'; tools: string[]; knowledge: boolean; confidential: boolean; daily_usd: number | null; last: { t: number; line: string }[]; verified: { ok: boolean; kind: string | null; signer?: string; tcb?: string; gpu?: string | null; e2ee: boolean; at: number; error?: string } | null }
export type JobStatus = 'Open' | 'Cancelled' | { Taken: { agent: string } } | { Submitted: { agent: string; result: string } } | { Approved: { agent: string } }
export type JobRow = { id: number; poster: string; description: string; bounty: string; deadline_ms: number; status: JobStatus; created_ms: number; bounty_near: number; spent: string; spent_near: number; auto_approve: boolean; review: { ok: boolean; note: string; at_ms: number; score: number; receipt: string } | null; max_spend_near: number; min_jobs_done: number; refunded_near: number; locked_near: number; min_score: number; swarm: boolean; max_workers: number; workers: string[]; result: string | null; entries: { agent: string; result: string | null; spent: string; spent_near: number; locked_near: number; review: { ok: boolean; note: string; at_ms: number; score: number; receipt: string } | null; submitted_ms: number }[] }
export type SwarmData = { agents: AgentRow[]; jobs: JobRow[]; model: string; live: boolean; tools: string[] }
export type WikiPage = {
  token: string; symbol: string; name: string; icon?: string | null; updated: number
  numbers: { price_usd: number | null; mcap_usd: number | null; ath_mcap_usd: number | null; holders: number; volume_24h_usd: number | null; trades_24h: number | null; change_24h: number | null; liquidity_usd: number | null; age_days: number; creator_earned_usd: number | null }
  facts: { market: number | null; claim: string; p_yes: number | null; status: Status | 'Unpriced'; resolves_at_ms: number | null; collateral_near: number }[]
  claims?: string[]; summary: string; sections: { h: string; body: string }[]; ai: { model: string; id: string | null; live: boolean }
}

/* ---------- helpers ---------- */
export const yocto = (near: number) => (BigInt(Math.round(near * 1e6)) * 10n ** 18n).toString()
export const near = (y: string | number) => Number(BigInt(String(y)) / 10n ** 18n) / 1e6
export const tokens = (raw: string) => Number(BigInt(raw) / 10n ** 14n) / 1e4
export const statusText = (s: Status | 'Unpriced') => (s === 'Unpriced' ? 'unpriced' : s === 'Open' ? 'open' : 'Invalid' in s ? 'invalid' : 'Proposed' in s ? `proposed ${s.Proposed.outcome ? 'YES' : 'NO'}` : 'Challenged' in s ? `challenged, round ${s.Challenged.round}: ${s.Challenged.outcome ? 'YES' : 'NO'} leads` : `resolved ${s.Resolved.outcome ? 'YES' : 'NO'}`)
export const jobText = (s: JobStatus) => (typeof s === 'string' ? s.toLowerCase() : 'Taken' in s ? 'taken' : 'Submitted' in s ? 'submitted' : 'approved')
const G = (t: number) => `${t}000000000000`
const fc = (receiverId: string, methodName: string, args: Record<string, unknown>, gasT: number, deposit: string): Tx => ({ receiverId, actions: [{ type: 'FunctionCall', params: { methodName, args, gas: G(gasT), deposit } }] })
/** wrap `amount` NEAR and hand it to the contract with a message, one transaction */
/** wrap.near keeps 0.00125 NEAR of a wallet's first deposit for its storage: wrap that much extra so the transfer below never
 * comes up short for a new wallet*/
const WRAP_STORAGE = 1_250_000_000_000_000_000_000n
const wrapAndSend = (amountYocto: string, msg: unknown): Tx => ({ receiverId: WRAP, actions: [
  { type: 'FunctionCall', params: { methodName: 'near_deposit', args: {}, gas: G(30), deposit: (BigInt(amountYocto) + WRAP_STORAGE).toString() } },
  { type: 'FunctionCall', params: { methodName: 'ft_transfer_call', args: { receiver_id: CONTRACT, amount: amountYocto, msg: JSON.stringify(msg) }, gas: G(100), deposit: '1' } },
] })

/* ---------- the transactions ---------- */
export const tx = {
  registerKey: (token: string, commitment: string, minHoldRaw: string, priceYocto: string) => fc(CONTRACT, 'register_key', { token, commitment, min_hold: minHoldRaw, price: priceYocto }, 60, '20000000000000000000000'),
  setMinHold: (key: number, minHoldRaw: string) => fc(CONTRACT, 'set_min_hold', { key: String(key), min_hold: minHoldRaw }, 30, '0'),
  setPrice: (key: number, priceYocto: string) => fc(CONTRACT, 'set_price', { key: String(key), price: priceYocto }, 30, '0'),
  /** buy the viewing key: the price goes to the trader, the buyer is recorded on chain */
  buyKey: (key: number, priceYocto: string) => fc(CONTRACT, 'buy_key', { key: String(key) }, 30, priceYocto),
  createMarket: (subsidyNear: number, question: string, subject: string | null, resolvesAtMs: number | null) => wrapAndSend(yocto(subsidyNear), { Create: { question, subject, resolves_at_ms: resolvesAtMs } }),
  /** `note`: the trader's reason, kept on chain in the buy message */
  buy: (market: number, yes: boolean, amountNear: number, minSharesRaw: string, note?: string) => wrapAndSend(yocto(amountNear), { Buy: { market: String(market), yes, min_shares: minSharesRaw, ...(note ? { note: note.slice(0, 280) } : {}) } }),
  sell: (market: number, yes: boolean, sharesRaw: string, minOutRaw: string) => fc(CONTRACT, 'sell', { market: String(market), yes, shares: sharesRaw, min_out: minOutRaw }, 60, '1'),
  redeem: (market: number) => fc(CONTRACT, 'redeem', { market: String(market) }, 60, '1'),
  /** challenge a ruling: 1 NEAR on the other side, then the judges look again and that answer is final */
  dispute: (market: number, bondNear = 1) => fc(CONTRACT, 'dispute', { market: String(market) }, 60, yocto(bondNear)),   // 60 TGas, the margin our own challenges used; a user's one challenge must not fail on gas
  finalize: (market: number) => fc(CONTRACT, 'finalize', { market: String(market) }, 30, '0'),
  /** no ruling 7 days after the date: anyone voids it, every share then pays half */
  voidMarket: (market: number) => fc(CONTRACT, 'void_market', { market: String(market) }, 30, '0'),
  joinSwarm: (agent: string, name: string, promptHash: string, fundNear: number) => fc(CONTRACT, 'join_swarm', { agent, name, prompt_hash: promptHash }, 30, yocto(fundNear)),
  fundAgent: (agent: string, amountNear: number) => fc(CONTRACT, 'fund_agent', { agent }, 30, yocto(amountNear)),
  withdrawAgent: (agent: string, amountNear: number) => fc(CONTRACT, 'withdraw_agent', { agent, amount: yocto(amountNear) }, 30, '0'),
  postJob: (description: string, deadlineMs: number, bountyNear: number, autoApprove = false, maxSpendBps = 2000, minJobsDone = 0, minScore = 0, swarm = true, maxWorkers = 3) => fc(CONTRACT, 'post_job', { description, deadline_ms: deadlineMs, auto_approve: autoApprove, max_spend_bps: maxSpendBps, min_jobs_done: minJobsDone, min_score: minScore, swarm, max_workers: maxWorkers }, 30, yocto(bountyNear)),
  settleJob: (job: number) => fc(CONTRACT, 'settle_job', { job: String(job) }, 60, '0'),
  approveJob: (job: number) => fc(CONTRACT, 'approve_job', { job: String(job) }, 30, '0'),
  cancelJob: (job: number) => fc(CONTRACT, 'cancel_job', { job: String(job) }, 30, '0'),
  /** hire an AI agent to trade the wiki: its wNEAR stays in the contract; the operator may only buy for it, within its caps */
  hireDesk: (depositNear: number, name: string, style: string, maxTradeNear: number, dailyNear: number) => wrapAndSend(yocto(depositNear), { Hire: { name, style, max_trade: yocto(maxTradeNear), daily: yocto(dailyNear) } }),
  fundDesk: (desk: number, amountNear: number) => wrapAndSend(yocto(amountNear), { FundDesk: { desk: String(desk) } }),
  closeDesk: (desk: number) => fc(CONTRACT, 'close_desk', { desk: String(desk) }, 60, '1'),
}

/* ---------- what this browser did: keys it unlocked, wiki markets it traded ---------- */
const MINE = 'nearly-keys-mine'
/** the tokens of keys unlocked here, newest first (7178321377-hot: "I couldn't find which key I had bought") */
export const myKeys = (): string[] => { try { const l = JSON.parse(localStorage.getItem(MINE) || '[]'); return Array.isArray(l) ? l.filter((x) => typeof x === 'string') : [] } catch { return [] } }
export const rememberKey = (token: string) => { try { localStorage.setItem(MINE, JSON.stringify([token, ...myKeys().filter((t) => t !== token)].slice(0, 50))) } catch { /* private window */ } }
const RECENT = 'nearly-wiki-recent'
/** markets bought or sold from this browser lately: Your bets reads them straight from the contract while the trade index catches up
 *  (m1halich228, 7178321377-hot: "my bet is not on the Your bets page"); the server takes them as ?recent=ids */
export const recentBets = (ageMs = 15 * 60e3): number[] => { try { const l = JSON.parse(localStorage.getItem(RECENT) || '[]') as { id: number; at: number }[]; return l.filter((x) => Date.now() - x.at < ageMs).map((x) => x.id) } catch { return [] } }
export const rememberBet = (id: number) => { try { const l = (JSON.parse(localStorage.getItem(RECENT) || '[]') as { id: number; at: number }[]).filter((x) => x.id !== id); localStorage.setItem(RECENT, JSON.stringify([{ id, at: Date.now() }, ...l].slice(0, 10))) } catch { /* private window */ } }

/* ---------- the feed token of an unlocked key, kept per token in this browser ---------- */
const FT = (token: string) => `nearly-key:${token}`
export const feedToken = (token: string): string | null => { try { const j = JSON.parse(sessionStorage.getItem(FT(token)) || 'null') as { ft: string; exp: number } | null; return j && j.exp > Date.now() ? j.ft : null } catch { return null } }
export const keepFeedToken = (token: string, ft: string, exp: number) => { try { sessionStorage.setItem(FT(token), JSON.stringify({ ft, exp })) } catch { /* private window */ } }
