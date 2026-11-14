// the wiki's AI agents carry no names or roles, only "AI agent" (Substance/Challenge/Odds are the Swarm reviewers; next to the three judges they read as a second vote)
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { get } from '../lib/keys'
import '../wiki-grid.css'
import { type Band, type Fact, type Home, type PageRow, type TradeRow, type DeskMove, StartBox, words, chance, aiSays, ends, reading, pct, HIDDEN } from './Wiki'
import { timeAgo } from '../lib/format'
import { EstateBar } from '../components/Market'
import { useBarInNav } from '../lib/estateRow'   // from 901px up the bar is in the header // the Estate bar on every wiki page, so the five products link to each other
import { Shell, artOf, odds, pickLead, type Row } from './WikiPress'

/** The wiki's front page as a board of markets: category tabs, the market the AI agents and
 *  the market disagree on most as the featured card, then a card per market in plain market words: a question or a fact, its
 *  chance, what the AI agents say, the two sides, when it ends. Topic pages: WikiMargin. */

const toM = (market: number) => `/wiki/m/${market}`
const slugOf = (r: { page?: { url?: string; slug?: string } | null }) => r.page?.slug ?? r.page?.url?.split('/wiki/')[1] ?? null
const isLogo = (u?: string | null) => !!u && /\.svg|logo/i.test(u)
/** a folded run of one topic's remaining markets, shown as one card */
type More = { more: true; slug: string; title: string; count: number; page?: PageRow }
type Card = Row | More
const isMore = (c: Card): c is More => (c as More).more === true
/** items in turns by a key: the first of each key, then the second of each, so a list shows its breadth first */
function spread<T>(xs: T[], key: (x: T) => string): T[] { const by = new Map<string, T[]>(); for (const x of xs) by.set(key(x), [...(by.get(key(x)) ?? []), x]); const ks = [...by.keys()].sort(); const out: T[] = []; for (let i = 0; ; i++) { let any = false; for (const k of ks) { const x = by.get(k)![i]; if (x) { out.push(x); any = true } } if (!any) return out } }
const ruled = (b: string) => b.startsWith('proposed') || b.startsWith('settled')
// every ruled market, the ones still open to a challenge first
const RULED = 'Ruled'
const TABS_FIRST = ['All', 'Crypto', 'Ending soon', 'New', RULED]
/** category tabs kept off the row (their markets stay under All) */
const HIDE_TAB = new Set(['Nature'])
/** a market as /api/markets lists it, the fields the Ruled tab reads */
type MarketRow = { id: number; question: string; p_yes: number | null; collateral_near: number; resolves_at_ms: number | null; status: string | { Proposed?: { outcome: boolean; at_ms: number }; Resolved?: { outcome: boolean } }; page?: { kind: string; slug: string; title: string } | null }
/** when a ruling's 24 h challenge window closes (null: final) */
const challengeLeft = (closes: number) => { const h = Math.ceil((closes - Date.now()) / 3600e3); return h > 1 ? `${h} h to challenge` : h === 1 ? 'Under 1 h to challenge' : 'Challenge closed' }
/** the featured market: a head to head on coins everyone knows, the first one open */
const FEATURED = [
  'Ethereum beats Bitcoin from Nov 10 to Nov 30, 2026 (CoinGecko daily price, 00:00 UTC).',
  'NEAR beats Solana from Nov 10 to Nov 30, 2026 (CoinGecko daily price, 00:00 UTC).',
  'Ethereum beats Bitcoin from Nov 10 to Nov 13, 2026 (CoinGecko daily price, 00:00 UTC).',
]
/** a head to head's two sides, each with its own page (and logo) */
const SIDE: Record<string, string> = { Ethereum: 'ethereum', Bitcoin: 'bitcoin', NEAR: 'near-blockchain-platform', Solana: 'solana-blockchain-platform' }
/** a crypto topic, wherever Wikipedia files it (Bitcoin and NEAR come back as Technology) */
const isCrypto = (p: PageRow) => p.category === 'Crypto' || /crypto|blockchain|bitcoin|ethereum|solana|dogecoin|stablecoin|token|defi|decentrali[sz]ed finance|mt\. gox|btcpay/i.test(`${p.title} ${p.description || ''}`)

function useBoard() {
  const [h, setH] = useState<Home | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [err, setErr] = useState(false)
  useEffect(() => { get<Home>('/api/wiki/home').then(setH).catch(() => setErr(true)); get<{ claims: Row[] }>('/api/wiki/claims').then((x) => setRows(x.claims)).catch(() => {}) }, [])
  const pages = useMemo(() => new Map((h?.pages ?? []).map((p) => [p.slug, p])), [h])
  // what the AI agents say, where the home feed carries their views
  const ai = useMemo(() => { const m = new Map<number, number>(); for (const f of h ? [...h.disputed, ...h.movers, ...h.trading, ...h.rejected, ...h.settled] : []) { const a = aiSays(f); if (f.market != null && a != null) m.set(f.market, a) } return m }, [h])
  const featured = useMemo(() => FEATURED.map((q) => rows.find((r) => r.claim === q && r.p_yes != null && !ruled(r.band) && !(r.resolves_at_ms && r.resolves_at_ms < Date.now()))).find(Boolean), [rows])
  const lead = useMemo(() => (featured ?? (h ? pickLead(h) : undefined)), [h, featured])
  // every open market is on the board, a launch claim too; one off a topic page files under Crypto
  const live = rows.filter((r) => !HIDDEN.has(r.market))
  const tabOf = (r: Row) => { const p = pages.get(slugOf(r) ?? ''); return !p || p.kind !== 'topic' || isCrypto(p) ? 'Crypto' : p.category }
  const cats = useMemo(() => { const c = new Map<string, number>(); for (const r of live) c.set(tabOf(r), (c.get(tabOf(r)) ?? 0) + 1); return [...c].sort((a, b) => b[1] - a[1]).map(([k]) => k).filter((k) => k !== 'Crypto' && !HIDE_TAB.has(k)) }, [rows, pages]) // eslint-disable-line react-hooks/exhaustive-deps
  // /api/markets is 121 KB gzipped, so it loads on the tab's first click, never with the first screen
  const [ruledRows, setRuledRows] = useState<Row[] | null>(null)
  const [ruledErr, setRuledErr] = useState(false)
  const [closes, setCloses] = useState<Map<number, number | null>>(new Map())
  const asked = useRef(false)
  const loadRuled = () => {
    if (asked.current) return
    asked.current = true; setRuledErr(false)
    get<MarketRow[]>('/api/markets').then((ms) => {
      const c = new Map<number, number | null>(), out: Row[] = []
      for (const m of ms) {
        const s = typeof m.status === 'object' ? m.status : null, p = s?.Proposed, r = s?.Resolved
        if ((!p && !r) || HIDDEN.has(m.id) || (m.page && HIDE_TOPIC.has(m.page.slug))) continue   // a launch claim's ruling too
        out.push({ market: m.id, claim: m.question, p_yes: m.p_yes, band: `${p ? 'proposed' : 'settled'} ${(p ?? r)!.outcome}` as Band, collateral_near: m.collateral_near, resolves_at_ms: m.resolves_at_ms, data: null, page: m.page ? { url: `/wiki/${m.page.slug}`, title: m.page.title } : null })
        c.set(m.id, p ? p.at_ms + 864e5 : null)
      }
      // open to a challenge first, the soonest to close on top; then the final ones, newest first
      out.sort((a, b) => { const x = c.get(a.market) ?? null, y = c.get(b.market) ?? null; return x != null && y != null ? x - y : x != null ? -1 : y != null ? 1 : b.market - a.market })
      setCloses(c); setRuledRows(out)
    }).catch(() => { asked.current = false; setRuledErr(true) })
  }
  const pick = (tab: string) => {
    if (tab === RULED) return ruledRows ?? []
    const traded = (r: Row) => (r.band === 'untraded' ? 0 : 1)
    if (tab === 'New') return live.filter((r) => !ruled(r.band)).sort((a, b) => b.market - a.market).slice(0, 48)
    if (tab === 'Ending soon') return live.filter((r) => r.resolves_at_ms && r.resolves_at_ms > Date.now() && !ruled(r.band)).sort((a, b) => a.resolves_at_ms! - b.resolves_at_ms!)
    const base = tab === 'All' ? live : live.filter((r) => tabOf(r) === tab)
    return [...base].sort((a, b) => traded(b) - traded(a) || Number(ruled(a.band)) - Number(ruled(b.band)) || b.collateral_near - a.collateral_near)
  }
  /** the cards of a tab: topics take turns (no topic twice in a row), at most 3 cards a topic, the rest of that topic as one card */
  const cards = (tab: string): Card[] => {
    const by = new Map<string, Row[]>(); for (const r of pick(tab)) { const k = slugOf(r) ?? `#${r.market}`; by.set(k, [...(by.get(k) ?? []), r]) }   // a market with no page stands alone
    const out: Card[] = []; const lists = [...by.values()]
    for (let i = 0; i < 3; i++) for (const l of lists) if (l[i]) out.push(l[i])
    for (const l of lists) if (l.length > 3) { const p = pages.get(slugOf(l[0])!); out.push({ more: true, slug: slugOf(l[0])!, title: p?.title ?? '', count: l.length - 3, page: p }) }
    return out
  }
  return { h, err, pages, ai, lead, cats, pick, cards, tabOf, count: (tab: string) => pick(tab).length, loadRuled, ruledRows, ruledErr, closes }
}

/** the picture beside a market: its topic's photo, or a logo shown whole */
function Pic({ p, big, letter }: { p?: PageRow; big?: boolean; letter?: string }) {   // letter = a page-less market's first letter
  const src = p ? artOf(p) : null
  return <span className={`wg-ic${big ? ' big' : ''}${isLogo(src) ? ' logo' : ''}`}>{src ? <img src={src} alt="" /> : <b>{p?.title?.[0] ?? letter ?? '?'}</b>}</span>
}

/** a market's number: "52%" and "chance", or the side in front of a head to head */
function Num({ r }: { r: Row | Fact }) {
  const w = words(r.claim), o = odds(r)
  if (r.p_yes == null || o.tone === 'none' || ruled(r.band) || w.vs) return <span className={`wg-n t-${o.tone}`}><b>{w.vs && r.p_yes != null && !ruled(r.band) ? chance(r.p_yes, w) : o.word}</b></span>
  return <span className={`wg-n t-${o.tone}`}><b>{Math.round(r.p_yes * 100)}%</b><span>chance</span></span>
}

function Tabs({ tab, setTab, cats, count }: { tab: string; setTab: (t: string) => void; cats: string[]; count: (t: string) => number }) {
  // Ruled shows before its list has loaded, with its count once it has
  return <nav className="wg-tabs">{[...TABS_FIRST, ...cats].map((t) => { const n = count(t); return n || t === RULED ? <button key={t} className={t === tab ? 'on' : ''} onClick={() => setTab(t)}>{t}{n ? <i>{n}</i> : null}</button> : null })}</nav>
}

/** pages whose server side is not live yet stay out of the bar: the trade index (Your bets), contract v18 (Hire) */
export const SOON = { mine: false, hire: false }
/** topic pages kept off the front-page grid (their markets stay live and searchable) */
const HIDE_TOPIC = new Set(['pele'])
export function Top() {
  // a Guide link (to /docs#wiki) at the end, like the guide action on the other product pages
  const inNav = useBarInNav()
  return <>{inNav ? null : <EstateBar />}<header className="wg-top"><Link to="/estate" className="wp-name sm">Nearly Estate</Link><div className="wg-search"><StartBox /></div><Link to="/wiki/new" className="wg-mine go">Create a market</Link>{SOON.hire ? null : <Link to="/wiki/hire" className="wg-mine">Hire an agent</Link>}{SOON.mine ? null : <Link to="/wiki/me" className="wg-mine">Your bets</Link>}<Link to="/picks" className="wg-mine" title="Call facts before the judges do. Free, no wallet; your score sits next to our AI agents' on the same facts.">Play free</Link>{/* the free game, reached from the wiki only */}<Link to="/docs#wiki" className="wg-mine" title="How the wiki works, step by step">Guide</Link></header>{/* the line that says what the wiki is, as its headline, not a caption in the toolbar */}<p className="wg-lead">An encyclopedia where every claim is a market. A NEAR AI model writes each page from Wikipedia. Bet YES or NO, and 3 AI judges rule.</p></>
}

/** who decides a ruling, in three lines, on the board and every market page */
/** our own accounts on the board: the team, the test wallets, the scribe, the house agents, the defender */
const ours = (a: string) => /^(nearlyburn\.near|nearlyops\.near|markets\.nearlyops\.near|keysop\.nearlyops\.near|f94b154c08|e7fbb3f76d0e|e0cefe9d|ff137ad6|3d465f5c|c1217093|356b0b21)/.test(a)
export function Who() {
  return <div className="wk-who"><b>Who decides</b><span>Three sealed AI judges (DeepSeek, Qwen, GLM) read the page's sources; two of three must agree, and the contract checks the signed ruling.</span><span>Disagree? Challenge within 24 h with 1 NEAR. The judges look again with everything both sides posted, and that answer is final: if they change it you get the 1 NEAR back, if they keep it you lose it.</span><span>Only if two judges find the wording itself cannot be settled is the market void, every bond back. A relay server submits proposals, and the team can upgrade the contract.</span><Link to="/wiki/m/343">See a three-judge ruling →</Link></div>
}

/** users on chain, as a stats tile */
type Users = { accounts: number; by_product?: Record<string, number>; new_since?: number }
function Outside() {
  const [o, setO] = useState<Users | null>(null)
  useEffect(() => { get<Users>('/api/outside').then(setO).catch(() => {}) }, [])
  return o ? <span><b>{o.accounts}</b><a href="/users">users on chain</a><small>{o.by_product?.wiki != null ? `${o.by_product.wiki} on the wiki` : ''}{o.new_since ? `; +${o.new_since} new since Nov 13` : ''}</small></span> : null
}

/** trades as they happen, every market: who, which side, how much, the price it left, and the AI agent's belief and reason; until
 *  the trade index answers, the agents' latest views */
function Live() {
  const [t, setT] = useState<TradeRow[] | null>(null)
  const [v, setV] = useState<DeskMove[]>([])
  useEffect(() => {
    const go = () => get<{ trades: TradeRow[] }>('/api/wiki/trades?limit=6').then((x) => setT(x.trades)).catch(() => { setT(null); get<{ recent: DeskMove[] }>('/api/wiki/desk').then((x) => setV(x.recent.slice(0, 5))).catch(() => {}) })
    go(); const i = setInterval(go, 30e3); return () => clearInterval(i)
  }, [])
  return (
    <section className="wg-live">
      <h3>{t ? 'Live trades' : 'AI agents, live'}<i>{t ? 'on chain' : 'signed, sealed'}</i></h3>
      {t ? t.map((x) => { const w = words(x.claim ?? ''); return (
        <Link key={x.tx + x.side} to={toM(x.market)} className="wg-lt">
          <span className="l1"><b>{x.agent ? 'AI agent' : (ours(x.account) ? `${x.account.length > 20 ? x.account.slice(0, 8) + '…' : x.account}` : x.account.length > 20 ? `${x.account.slice(0, 8)}…` : x.account)}</b> {x.kind === 'buy' ? 'bought' : 'sold'} <em className={x.side}>{x.side === 'yes' ? w.yes : w.no}</em> <span className="mono">{x.near.toFixed(3)} NEAR{x.p_after != null ? ` → ${pct(x.p_after)}` : ''}</span><span className="ago">{timeAgo(x.at)}</span></span>
          <span className="q">{w.title}</span>
          {/* an agent trade whose own view is unknown carries no belief line */}
          {x.agent ? x.agent.p == null ? null : <span className="r"><span className="mono">believes {pct(x.agent.p)}</span> “{x.agent.note}”</span> : x.note && !ours(x.account) ? <span className="r">“{x.note}”</span> : null}
        </Link>
      ) }) : v.map((x) => { const w = words(x.claim); return (
        <Link key={`${x.market}-${x.agent}-${x.at}`} to={toM(x.market)} className="wg-lt">
          <span className="l1"><b>AI agent</b> says <span className="mono">{pct(x.p)}</span><span className="ago">{timeAgo(x.at)}</span></span>
          <span className="q">{w.title}</span>
          <span className="r">“{x.note}”</span>
        </Link>
      ) })}
    </section>
  )
}

export function WikiGrid() {
  const b = useBoard()
  const [tab, setTab] = useState('All')
  useEffect(() => { document.title = 'Nearly Estate: every claim is a market' }, [])
  const [n, setN] = useState(24)
  const [allTopics, setAllTopics] = useState(false)
  if (b.err) return <Shell><div className="wp-empty">The wiki did not load. Refresh in a moment.</div></Shell>
  const lead = tab === 'All' ? b.lead : undefined
  // one flat list in challenge order, not folded by topic
  const list = (tab === RULED ? b.pick(RULED) as Card[] : b.cards(tab)).filter((r) => isMore(r) || r.market !== lead?.market)
  const openN = b.ruledRows ? b.ruledRows.filter((r) => b.closes.get(r.market) != null).length : 0
  const lw = lead ? words(lead.claim) : null, la = lead && 'desk' in lead ? aiSays(lead) : lead?.market != null ? b.ai.get(lead.market) ?? null : null
  return (
    <Shell>
      <Top />
      <Tabs tab={tab} setTab={(t) => { setTab(t); setN(24); if (t === RULED) b.loadRuled() }} cats={b.cats} count={b.count} />
      {tab === RULED && b.ruledRows ? <div className="wg-sect"><h3>Ruled by the judges</h3><span>{openN} open to a challenge, {b.ruledRows.length - openN} final</span></div> : null}
      {tab === RULED && b.ruledErr ? <div className="wp-empty">The ruled markets did not load. Click Ruled to try again.</div> : null}
      {tab === 'All' && b.h ? <>
        {/* the encyclopedia first: the topic pages, each written by NEAR AI with every claim a market */}
        {(() => { const all = spread([...b.h.pages].filter((p) => p.kind === 'topic' && !HIDE_TOPIC.has(p.slug)).sort((x, y) => y.priced - x.priced), (p) => (isCrypto(p) ? 'Crypto' : p.category || 'Other')); return <>
        <div className="wg-sect"><h3>The encyclopedia</h3><span>{all.length} topics, every claim a market</span></div>
        <div className="wg-topics">{(allTopics ? all : all.slice(0, 11)).map((p) => (
          <Link key={p.slug} to={`/wiki/${p.slug}`} className="wg-topic"><Pic p={p} /><span><b>{p.title}</b><i>{p.priced} markets</i></span></Link>
        ))}{all.length > 11 ? <button className="wg-topic all" onClick={() => setAllTopics(!allTopics)}><span><b>{allTopics ? 'Fewer topics' : `All ${all.length} topics`}</b><i>{allTopics ? '↑' : 'crypto, history, science, space…'}</i></span></button> : null}</div>
        </> })()}
      </> : null}
      {lead && lw ? (
        <Link to={toM(lead.market!)} className="wg-hero">
          {lw.vs && SIDE[lw.yes] && SIDE[lw.no] ? <span className="wg-vs"><Pic p={b.pages.get(SIDE[lw.yes])} big /><b>vs</b><Pic p={b.pages.get(SIDE[lw.no])} big /></span> : <Pic p={b.pages.get(slugOf(lead)!)} big />}
          <span className="wg-hb">
            <span className="wp-kick">{lw.vs ? 'Featured' : la != null && Math.abs(la - lead.p_yes!) >= 0.2 ? 'Market vs AI' : 'Featured'} · {b.tabOf(lead as Row)}</span>
            <span className="wg-hq">{lw.title}</span>
            {lw.vs ? <span className="wg-two"><span><b>{Math.round(lead.p_yes! * 100)}%</b>{lw.yes}</span><span><b>{Math.round((1 - lead.p_yes!) * 100)}%</b>{lw.no}</span></span>
              : <span className="wg-hn"><Num r={lead} />{la != null ? <em>AI agents say {Math.round(la * 100)}%</em> : null}</span>}
            <span className="wg-yn"><span className="y">{lw.yes}</span><span className="n">{lw.no}</span></span>
            <span className="wg-f">{lead.resolves_at_ms ? ends(lead.resolves_at_ms) : 'Resolves when the judge rules'}{lead.data ? <> · {lead.data.source}{lead.data.now ? <> · {reading(lead.data.now)}</> : null}</> : null}</span>
          </span>
        </Link>
      ) : null}
      {tab === 'All' && b.h ? <>
        <div className="wg-stats">
          {/* open and resolved count every market, not only the wiki's claims */}
          {/* one count: the topics stat counts the topics the list shows */}
          <span><b>{b.h.pages.filter((p) => p.kind === 'topic' && !HIDE_TOPIC.has(p.slug)).length}</b>topics</span><span><b>{b.h.stats.open_all ?? b.count('All')}</b>open markets</span>
          {b.h.stats.volume_near != null ? <span><b>{b.h.stats.volume_near.toFixed(1)}</b>NEAR traded</span> : <span><b>{b.h.stats.near_in.toFixed(1)}</b>NEAR in markets</span>}
          {b.h.stats.trades != null ? <span><b>{b.h.stats.trades}</b>trades</span> : null}
          <span><b>{b.h.stats.settled}</b>resolved</span>
          <Outside />
        </div>
        <Who />
        <div className="wg-two-col">
          <section className="wg-moves">
            <h3>Top movers<i>24h</i></h3>
            {b.h.movers.filter((f) => f.market != null && !HIDDEN.has(f.market) && f.change_24h != null && Math.abs(f.change_24h) >= 0.01).slice(0, 6).map((f) => { const w = words(f.claim), up = f.change_24h! > 0; return (
              <Link key={f.market} to={toM(f.market!)} className="wg-mv">
                <span className="q">{w.title}<small>{f.page?.title}</small></span>
                <span className="n"><Num r={f} /><i className={up ? 'up' : 'dn'}>{up ? '▲' : '▼'} {Math.round(Math.abs(f.change_24h!) * 100)}</i></span>
              </Link>
            ) })}
          </section>
          <Live />
        </div>
      </> : null}
      <div className="wg-grid">
        {list.slice(0, n).map((r) => { if (isMore(r)) return (
          <Link key={`more-${r.slug}`} to={`/wiki/${r.slug}`} className="wg-card more">
            <span className="wg-h"><Pic p={r.page} /><span className="wg-q">{r.count} more {r.count === 1 ? 'market' : 'markets'} on {r.title}</span></span>
            <span className="wg-f"><span>{r.title}</span><span>Open the page →</span></span>
          </Link>
        ); const w = words(r.claim), a = r.market != null ? b.ai.get(r.market) : undefined, p = b.pages.get(slugOf(r)!); return (
          <Link key={r.market} to={toM(r.market)} className="wg-card">
            <span className="wg-h"><Pic p={p} letter={w.title[0]} /><span className="wg-q">{w.title}</span></span>
            <span className="wg-o">{r.band === 'untraded' && a != null ? <span className="wg-n t-ai"><b>{Math.round(a * 100)}%</b><span>AI agents say</span></span> : r.band === 'untraded' ? <span className="wg-n t-none"><b>50%</b><span>opening odds, no bets yet</span></span> : <Num r={r} />}{a != null && !ruled(r.band) && r.band !== 'untraded' ? <i>AI {Math.round(a * 100)}%</i> : null}</span>
            {r.p_yes != null && !ruled(r.band) ? <span className="wg-bar"><i style={{ width: `${Math.round(r.p_yes * 100)}%` }} /></span> : <span className="wg-bar none" />}
            {!ruled(r.band) ? <span className="wg-yn"><span className="y">{w.yes}</span><span className="n">{w.no}</span></span> : null}
            <span className="wg-f"><span>{p?.title}{r.volume_near ? ` · ${r.volume_near.toFixed(2)} NEAR vol` : ''}</span><span>{b.closes.has(r.market) ? (b.closes.get(r.market) != null ? challengeLeft(b.closes.get(r.market)!) : 'Final') : r.resolves_at_ms ? ends(r.resolves_at_ms) : ruled(r.band) ? '' : r.trades || r.volume_near ? 'Ruling 72 hours after first trade' : 'No end date'}{/* an undated market is judged 72 h after its first trade */}{/* a ruled market shows its time left to challenge, or Final */}</span></span>
          </Link>
        ) })}
        {!b.h || (tab === RULED && !b.ruledRows && !b.ruledErr) ? [0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="wp-skel sm" />) : null}
      </div>
      {list.length > n ? <button className="wg-more" onClick={() => setN(n + 24)}>Show more</button> : null}
    </Shell>
  )
}
