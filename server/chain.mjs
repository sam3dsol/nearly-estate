// "The chain says" markets: claims about what blockchains will show, settled from the chain's own public data. Each
// market's question names its source; the recipe that reads it lives here, in the measured image, so anyone can check how the
// judge got its number. The judge (markets.mjs) gets the reading and the rule as evidence and signs its verdict; the fact desk
// gets today's reading to trade on; the pages show it beside the market.
import { log, table, own } from './store.mjs'

const DAY = 864e5
const day = (s) => Date.parse(`${s}T00:00:00Z`)                       // '2026-11-13' -> ms at 00:00 UTC
const dmy = (ms) => new Date(ms).toISOString().slice(0, 10).split('-').reverse().join('-')   // CoinGecko's DD-MM-YYYY
const usd = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(0)}M` : `$${Math.round(n).toLocaleString('en-US')}`)
const pct = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`
async function get(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'nearly-estate-judge', accept: 'application/json' }, signal: AbortSignal.timeout(25000) })
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`)
  return r.json()
}

/* ---------- readers: one number from one public source ---------- */
const CG = 'https://api.coingecko.com/api/v3'
// CoinGecko's free API refuses bursts, and from the enclave it often does not answer at all. So:
// a past day's price never changes and is read once and kept on disk; calls go one at a time; a failed call is tried again with
// a growing wait; and the live price falls back to Coinbase's spot price, said so in the reading. Settlement never uses the fallback.
const cgPast = table('chain-cg', {})   // 'ethereum:10-11-2026' -> price, kept across restarts
const cgNowMemo = new Map()
let cgLast = 0
export async function retrying(fn, waits = [3000, 9000]) {
  for (let i = 0; ; i++) { try { return await fn() } catch (e) { if (i >= waits.length) throw e; await new Promise((r) => setTimeout(r, waits[i])) } }
}
async function cg(url) { const wait = cgLast + 2500 - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait)); cgLast = Date.now(); return retrying(() => get(url)) }
async function cgOn(id, ms) {
  const k = `${id}:${dmy(ms)}`; if (cgPast.v[k] != null) return cgPast.v[k]
  if (ms > Date.now()) return null
  const v = (await cg(`${CG}/coins/${id}/history?date=${dmy(ms)}&localization=false`)).market_data?.current_price?.usd ?? null
  if (v != null) { cgPast.v[k] = v; cgPast.save() }
  return v
}
const TICKER = { ethereum: 'ETH', bitcoin: 'BTC', near: 'NEAR', solana: 'SOL' }
const CB = 'https://api.coinbase.com/v2/prices', CBX = 'https://api.exchange.coinbase.com/products'
/** a day's price for the live reading: CoinGecko (and kept), else the open of Coinbase's daily candle at 00:00 UTC (kept apart) */
async function priceOn(id, ms) {
  const v = await cgOn(id, ms).catch((e) => { log('chain past', id, e.message); return null }); if (v != null) return { v, via: 'CoinGecko' }
  const k = `cb:${id}:${dmy(ms)}`; if (cgPast.v[k] != null) return { v: cgPast.v[k], via: 'Coinbase' }
  if (!TICKER[id]) return null
  const iso = new Date(ms).toISOString(), rows = await get(`${CBX}/${TICKER[id]}-USD/candles?granularity=86400&start=${iso}&end=${new Date(ms + DAY).toISOString()}`)
  const open = rows.find((r) => r[0] * 1000 === ms)?.[3] ?? null
  if (open != null) { cgPast.v[k] = open; cgPast.save() }
  return open != null ? { v: open, via: 'Coinbase' } : null
}
/** the live price: CoinGecko, else Coinbase spot; 5 minutes memo either way */
async function cgNow(id) {
  const c = cgNowMemo.get(id); if (c && Date.now() - c.at < 5 * 60e3) return c
  let v = null, via = 'CoinGecko'
  try { v = (await cg(`${CG}/simple/price?ids=${id}&vs_currencies=usd`))[id]?.usd ?? null } catch (e) { log('chain now', id, e.message) }
  if (v == null && TICKER[id]) { v = Number((await get(`${CB}/${TICKER[id]}-USD/spot`)).data?.amount) || null; via = 'Coinbase' }
  if (v == null) return null
  const r = { v, via, at: Date.now() }; cgNowMemo.set(id, r); return r
}
const seq = async (fs) => { const out = []; for (const f of fs) out.push(await f()); return out }
const LL = 'https://api.llama.fi', SL = 'https://stablecoins.llama.fi'
const tvlOn = async (chain, ms) => { const a = await get(`${LL}/v2/historicalChainTvl/${chain}`); return ms == null ? a.at(-1)?.tvl ?? null : a.find((x) => x.date * 1000 === ms)?.tvl ?? null }
// DefiLlama's headline total: every peg (dollar, euro, ...) counted in US dollars, not the dollar-pegged coins alone
const stableUsd = (x) => { const o = x?.totalCirculatingUSD; if (!o) return null; const v = Object.values(o).filter((n) => typeof n === 'number'); return v.length ? v.reduce((a, b) => a + b, 0) : null }
const stablesOn = async (chain, ms) => { const a = await get(`${SL}/stablecoincharts/${chain}`); return ms == null ? stableUsd(a.at(-1)) : stableUsd(a.find((x) => Number(x.date) * 1000 === ms) || {}) }
const stablesMax = async (from, to) => { if (Date.now() < to + DAY) return null; const a = await get(`${SL}/stablecoincharts/all`); const v = a.filter((x) => Number(x.date) * 1000 >= from && Number(x.date) * 1000 <= to).map(stableUsd).filter((n) => n != null); return v.length ? Math.max(...v) : null }
const intentsDays = async () => (await get(`${LL}/summary/dexs/near-intents?dataType=dailyVolume`)).totalDataChart || []
const intentsOn = async (ms) => (await intentsDays()).find(([t]) => t * 1000 === ms)?.[1] ?? null
const intentsWeek = async (from) => { const d = (await intentsDays()).filter(([t]) => t * 1000 >= from && t * 1000 < from + 7 * DAY); return d.length === 7 ? d.reduce((a, [, v]) => a + v, 0) : null }
const MP = 'https://mempool.space/api/v1'
const difficultyAt = async (height) => { const a = await get(`${MP}/mining/difficulty-adjustments/3m`); const x = a.find((r) => r[1] === height); return x ? x[3] : null }   // the ratio, 0.93 = -7%
const feeMax = table('chain-fee-max', {})   // window key -> { max, at, last }
async function trackFee(from, to) {
  const a = await get(`${MP}/mining/blocks/fee-rates/24h`); const k = `${from}-${to}`, r = feeMax.v[k] || { max: 0, at: null }
  for (const x of a) { const t = x.timestamp * 1000; if (t >= from && t < to && x.avgFee_50 > r.max) { r.max = x.avgFee_50; r.at = t } }
  r.last = Date.now(); feeMax.v[k] = r; feeMax.save(); return r
}
const medianFeeMax = async (from, to) => { const r = await trackFee(from, to); return Date.now() < to ? null : r.max }
const ethSupplyAt = async (ms) => { const j = await get('https://ultrasound.money/api/v2/fees/supply-over-time'); const s = [...(j.d7 || []), ...(j.d30 || [])].map((x) => [Date.parse(x.timestamp), x.supply]); const near = s.filter(([t]) => Math.abs(t - ms) <= 3600e3).sort((a, b) => Math.abs(a[0] - ms) - Math.abs(b[0] - ms))[0]; return near ? near[1] : null }

/* ---------- the markets: question -> where it settles, the rule, how to read it then and now ---------- */
// a market's question must be exactly the text below; `at` is when the reading is taken (the market's date is a little after)
const beats = (a, b, from, to) => ({
  source: 'CoinGecko', url: `https://www.coingecko.com/en/coins/${a}`,
  rule: `true if ${a}'s price change from ${dmy(from)} to ${dmy(to)} (CoinGecko, 00:00 UTC) is larger than ${b}'s`,
  async settle() { const [a0, a1, b0, b1] = await seq([() => cgOn(a, from), () => cgOn(a, to), () => cgOn(b, from), () => cgOn(b, to)]); if ([a0, a1, b0, b1].some((x) => x == null)) return null; const ra = a1 / a0 - 1, rb = b1 / b0 - 1; return { outcome: ra > rb, reading: `${a} ${pct(ra)} (${a0} -> ${a1}), ${b} ${pct(rb)} (${b0} -> ${b1})` } },
  async now() { const [a0, b0, a1, b1] = await seq([() => priceOn(a, from), () => priceOn(b, from), () => cgNow(a), () => cgNow(b)]); if ([a0, b0, a1, b1].some((x) => x == null)) return null; const cb = [a0, b0, a1, b1].some((x) => x.via === 'Coinbase'); return `so far ${a} ${pct(a1.v / a0.v - 1)}, ${b} ${pct(b1.v / b0.v - 1)}${cb ? ' (live price from Coinbase while CoinGecko does not answer; it settles from CoinGecko)' : ''}` },
})
export const SPECS = {
  "Bitcoin's mining difficulty falls at its next adjustment (block 975,744), as recorded by mempool.space.": {
    source: 'mempool.space', url: 'https://mempool.space/mining', rule: 'true if the difficulty change at block 975,744 is negative',
    async settle() { const r = await difficultyAt(975744); return r == null ? null : { outcome: r < 1, reading: `difficulty change at block 975,744: ${pct(r - 1)}` } },
    async now() { const j = await get(`${MP}/difficulty-adjustment`); return `${j.remainingBlocks} blocks to go, expected change ${j.difficultyChange >= 0 ? '+' : ''}${j.difficultyChange.toFixed(1)}%` },
  },
  'NEAR beats Solana from Nov 10 to Nov 13, 2026 (CoinGecko daily price, 00:00 UTC).': beats('near', 'solana', day('2026-11-10'), day('2026-11-13')),
  'Ethereum beats Bitcoin from Nov 10 to Nov 13, 2026 (CoinGecko daily price, 00:00 UTC).': beats('ethereum', 'bitcoin', day('2026-11-10'), day('2026-11-13')),
  'Stablecoins in circulation are above $292.5 billion on Nov 13, 2026 (DefiLlama daily total).': {
    source: 'DefiLlama', url: 'https://defillama.com/stablecoins', rule: "true if DefiLlama's total stablecoin market cap for Nov 13, 2026 (every peg, in US dollars) is above $292.5B",
    async settle() { const v = await stablesOn('all', day('2026-11-13')); return v == null ? null : { outcome: v > 292.5e9, reading: `stablecoins on Nov 13: ${usd(v)}` } },
    async now() { const v = await stablesOn('all', null); return v == null ? null : `now ${usd(v)}` },
  },
  'NEAR Intents moves more than $130 million on Nov 12, 2026 (DefiLlama daily volume, UTC day).': {
    source: 'DefiLlama', url: 'https://defillama.com/protocol/near-intents', rule: 'true if NEAR Intents volume for the UTC day Nov 12, 2026 is above $130M',
    async settle() { const v = await intentsOn(day('2026-11-12')); return v == null ? null : { outcome: v > 130e6, reading: `NEAR Intents on Nov 12: ${usd(v)}` } },
    async now() { const d = (await intentsDays()).slice(-7); return d.length ? `last 7 days ${d.map(([, v]) => usd(v)).join(', ')}` : null },
  },
  'There is less ETH in existence at 00:00 UTC on Nov 13 than at 00:00 UTC on Nov 10, 2026 (ultrasound.money).': {
    source: 'ultrasound.money', url: 'https://ultrasound.money', rule: 'true if ETH supply at Nov 13 00:00 UTC is below the supply at Nov 10 00:00 UTC',
    async settle() { const [a, b] = await Promise.all([ethSupplyAt(day('2026-11-10')), ethSupplyAt(day('2026-11-13'))]); return a == null || b == null ? null : { outcome: b < a, reading: `ETH supply ${a.toFixed(0)} -> ${b.toFixed(0)} (${b - a >= 0 ? '+' : ''}${(b - a).toFixed(0)} ETH)` } },
    async now() { const [a, b] = await Promise.all([ethSupplyAt(day('2026-11-10')), ethSupplyAt(Date.now())]); return a == null || b == null ? null : `${b - a >= 0 ? '+' : ''}${(b - a).toFixed(0)} ETH since Nov 10` },
  },
  'Stablecoins in circulation pass $300 billion before Dec 31, 2026 (DefiLlama daily total).': {
    source: 'DefiLlama', url: 'https://defillama.com/stablecoins', rule: "true if DefiLlama's total stablecoin market cap (every peg, in US dollars) is above $300B on any day from Nov 10 to Dec 30, 2026",
    async settle() { const v = await stablesMax(day('2026-11-10'), day('2026-12-30')); return v == null ? null : { outcome: v > 300e9, reading: `highest daily total: ${usd(v)}` } },
    async now() { const v = await stablesOn('all', null); return v == null ? null : `now ${usd(v)}` },
  },
  "Solana's DeFi TVL is above Base's on Nov 30, 2026 (DefiLlama).": {
    source: 'DefiLlama', url: 'https://defillama.com/chains', rule: "true if Solana's DefiLlama TVL for Nov 30, 2026 is above Base's",
    async settle() { const [s, b] = await Promise.all([tvlOn('Solana', day('2026-11-30')), tvlOn('Base', day('2026-11-30'))]); return s == null || b == null ? null : { outcome: s > b, reading: `Solana ${usd(s)}, Base ${usd(b)}` } },
    async now() { const [s, b] = await Promise.all([tvlOn('Solana', null), tvlOn('Base', null)]); return s == null || b == null ? null : `now Solana ${usd(s)}, Base ${usd(b)}` },
  },
  "NEAR's DeFi TVL is above $180 million on Nov 30, 2026 (DefiLlama).": {
    source: 'DefiLlama', url: 'https://defillama.com/chain/near', rule: "true if NEAR's DefiLlama TVL for Nov 30, 2026 is above $180M",
    async settle() { const v = await tvlOn('Near', day('2026-11-30')); return v == null ? null : { outcome: v > 180e6, reading: `NEAR TVL on Nov 30: ${usd(v)}` } },
    async now() { const v = await tvlOn('Near', null); return v == null ? null : `now ${usd(v)}` },
  },
  'NEAR Intents moves more than $900 million in the week of Nov 10 to 16, 2026 (DefiLlama daily volume).': {
    source: 'DefiLlama', url: 'https://defillama.com/protocol/near-intents', rule: 'true if NEAR Intents daily volumes for the UTC days Nov 10 to 16, 2026 add up to more than $900M',
    async settle() { const v = await intentsWeek(day('2026-11-10')); return v == null ? null : { outcome: v > 900e6, reading: `NEAR Intents Nov 10 to 16: ${usd(v)}` } },
    async now() { const d = (await intentsDays()).filter(([t]) => t * 1000 >= day('2026-11-10')); return d.length ? `so far ${usd(d.reduce((a, [, v]) => a + v, 0))} in ${d.length} day${d.length > 1 ? 's' : ''}` : 'counting from Nov 10' },
  },
  "A Bitcoin block's median fee reaches 8 sat/vB before Dec 1, 2026 (mempool.space).": {
    source: 'mempool.space', url: 'https://mempool.space/graphs/mining/block-fee-rates', rule: "true if a block's median fee rate on mempool.space reaches 8 sat/vB between Nov 10 and Nov 30, 2026 (its per-block 24-hour series, read every 10 minutes)",
    async settle() { const v = await medianFeeMax(day('2026-11-10'), day('2026-12-01')); return v == null ? null : { outcome: v >= 8, reading: `highest median block fee: ${v} sat/vB` } },
    async now() { const r = await trackFee(day('2026-11-10'), day('2026-12-01')); return `highest so far ${r.max} sat/vB` },
  },
  'NEAR beats Solana from Nov 10 to Nov 30, 2026 (CoinGecko daily price, 00:00 UTC).': beats('near', 'solana', day('2026-11-10'), day('2026-11-30')),
  'Ethereum beats Bitcoin from Nov 10 to Nov 30, 2026 (CoinGecko daily price, 00:00 UTC).': beats('ethereum', 'bitcoin', day('2026-11-10'), day('2026-11-30')),
  'Stablecoins grow more on Solana than on Ethereum from Nov 10 to Nov 30, 2026 (DefiLlama, in dollars).': {
    source: 'DefiLlama', url: 'https://defillama.com/stablecoins/chains', rule: 'true if the stablecoins on Solana grow by more US dollars from Nov 10 to Nov 30, 2026 than those on Ethereum (DefiLlama, every peg)',
    async settle() { const [s0, s1, e0, e1] = await Promise.all([stablesOn('Solana', day('2026-11-10')), stablesOn('Solana', day('2026-11-30')), stablesOn('Ethereum', day('2026-11-10')), stablesOn('Ethereum', day('2026-11-30'))]); if ([s0, s1, e0, e1].some((x) => x == null)) return null; return { outcome: s1 - s0 > e1 - e0, reading: `Solana ${usd(s1 - s0)} (${usd(s0)} -> ${usd(s1)}), Ethereum ${usd(e1 - e0)} (${usd(e0)} -> ${usd(e1)})` } },
    async now() { const [s0, s1, e0, e1] = await Promise.all([stablesOn('Solana', day('2026-11-10')), stablesOn('Solana', null), stablesOn('Ethereum', day('2026-11-10')), stablesOn('Ethereum', null)]); return [s0, s1, e0, e1].some((x) => x == null) ? null : `so far Solana ${usd(s1 - s0)}, Ethereum ${usd(e1 - e0)}` },
  },
}
const norm = (q) => String(q || '').replace(/\s+/g, ' ').trim()
const BY = new Map(Object.entries(SPECS).map(([q, s]) => [norm(q), s]))
export const specOf = (q) => BY.get(norm(q)) || null

/** for the judge, once the market's date has passed: the source, the rule, the reading, the outcome it gives (null = not out yet) */
export async function judgeEvidence(m) {
  const s = specOf(m.question); if (!s) return null
  // a window is read only once it has closed: the market's date is set just after it
  if (m.resolves_at_ms && Date.now() < m.resolves_at_ms) return { source: s.source, url: s.url, rule: s.rule, pending: true }
  const r = await s.settle().catch((e) => { log('chain settle', m.id, e.message); return null })
  return r ? { source: s.source, url: s.url, rule: s.rule, reading: r.reading, outcome_by_rule: r.outcome, read_at: new Date().toISOString() } : { source: s.source, url: s.url, rule: s.rule, pending: true }
}

/** today's reading of every chain market, refreshed every 10 minutes for the desk and the pages */
const cache = table('chain-now', {})   // kept on disk, so a restart shows the last reading and its time instead of nothing
export async function refresh() {
  for (const [q, s] of BY) { try { const t = await s.now(); if (t) { cache.v[q] = { now: t, at: Date.now() }; cache.save() } } catch (e) { log('chain now', q.slice(0, 40), e.message) } await new Promise((r) => setTimeout(r, 1500)) }
}
export function info(q) {
  const s = specOf(q); if (!s) return null
  const c = own(cache.v, norm(q))
  return { source: s.source, url: s.url, rule: s.rule, now: c?.now ?? null, now_at: c?.at ?? null }
}
