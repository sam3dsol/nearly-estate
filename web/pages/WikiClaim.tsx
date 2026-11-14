import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useWallet } from '../lib/wallet'
import { timeAgo } from '../lib/format'
import { get, recentBets, type MarketRow, type Position } from '../lib/keys'
import '../wiki-claim.css'
import { type ClaimDetail, type TradeRow, Trade as TradeBox, Sources, words, chance, resolvesIf, reading, ends, txLink, aiSays, pct } from './Wiki'
import { Shell, odds } from './WikiPress'
import { Top, Who } from './WikiGrid'

/** A market's own page: the question and what its other side means, the price since it opened, every
 *  trade with its reason, who holds it, the rules; the trade, the AI agents and the sources beside it. /wiki/m/<id>. Also the
 *  reader's own bets across the wiki (/wiki/me). */

/** a settlement step, from the contract's log lines: the judge's proposal, each challenge round and its bond, the end */
type Ev = { type: 'proposed' | 'challenged' | 'resolved' | 'ruled' | 'void'; side?: 'yes' | 'no'; round?: number; bond?: number; by?: string; rounds?: number; tx: string; signer?: string; at: number }
type Book = { trades: TradeRow[]; events?: Ev[]; count: number; volume_near: number; opened_p: number | null; holders: { account: string; yes: number; no: number }[] }
const who = (a: string) => (a.length > 22 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a)
/** our own accounts, named where they act: the challenge demo's two test wallets, the team's accounts */
// ece4c74e05 = the Solana test wallet that bought market 258 through 1Click
const OURS: [string, string][] = [['f94b154c08', 'test wallet (demo)'], ['e7fbb3f76d0e', 'test wallet (demo)'], ['ece4c74e05', 'test wallet (demo)'], ['nearlyops.near', 'team account'], ['nearlyburn.near', 'team account'], ['e0cefe9d', 'our scribe agent (demo)'], ['markets.nearlyops.near', 'the wiki fund'], ['keysop.nearlyops.near', "the judges' relay"], ['ff137ad6', 'Scholar, our AI agent'], ['3d465f5c', 'Contrarian, our AI agent'], ['c1217093', 'Bayesian, our AI agent'], ['356b0b21', 'our defender wallet']]
const whoIs = (a: string) => OURS.find(([p]) => a.startsWith(p))?.[1] ?? who(a)
const ours = (a: string) => OURS.some(([p]) => a.startsWith(p))
/** a judge model's short name: deepseek-ai/DeepSeek-V4.1-Flash-1017 reads DeepSeek */
const modelName = (m: string) => (/deepseek/i.test(m) ? 'DeepSeek' : /qwen/i.test(m) ? 'Qwen' : /glm/i.test(m) ? 'GLM' : m.split('/').pop() ?? m)
const RULE_FACT = 'Resolves True if the judges, three NEAR AI models sealed in a TEE (DeepSeek, Qwen, GLM), rule the claim true from its sources and what readers post, two of three agreeing; the contract checks the signature. Anyone can challenge a ruling within 24 hours with 1 NEAR; the judges then look again with everything posted, and that answer is final: the challenger gets the 1 NEAR back if they change it and loses it if they keep it. If two judges find the wording cannot be settled, the market is void and every bond goes back. A claim nobody can settle goes Invalid and every share pays 0.50 NEAR.'

/** the price since the market opened: gridlines at every quarter, the opening price dashed */
function BigChart({ pts, opened, now }: { pts: [number, number][]; opened: number; now: number }) {
  const line = pts.length > 1 ? pts : [[Date.now() - 864e5, opened], [Date.now(), now]] as [number, number][]
  const t0 = line[0][0], t1 = line[line.length - 1][0] || t0 + 1, X = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * 600, Y = (p: number) => 8 + (1 - p) * 204
  const d = line.map(([t, p]) => `${X(t).toFixed(1)},${Y(p).toFixed(1)}`).join(' ')
  const short = t1 - t0 < 2 * 864e5   // a market a day old shows times, not the same date twice
  const day = (t: number) => new Date(t).toLocaleDateString('en-US', short ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' } : { month: 'short', day: 'numeric', timeZone: 'UTC' }) + ' UTC'
  return (
    <div className="wc-chart">
      <svg viewBox="0 0 600 220" preserveAspectRatio="none" aria-label="The price since the market opened">
        {[0, 0.25, 0.5, 0.75, 1].map((g) => <line key={g} className="g" x1="0" x2="600" y1={Y(g)} y2={Y(g)} />)}
        <line className="o" x1="0" x2="600" y1={Y(opened)} y2={Y(opened)} />
        <polygon className="a" points={`0,212 ${d} 600,212`} />
        <polyline className="p" points={d} />
      </svg>
      <span className="ax">{['100%', '75%', '50%', '25%', '0%'].map((x) => <i key={x}>{x}</i>)}</span>
      <span className="tx"><i>{day(t0)}</i><i>{day(t1)}</i></span>
    </div>
  )
}

export function WikiClaim({ id }: { id: number }) {
  const [c, setC] = useState<ClaimDetail | null>(null)
  const [m, setM] = useState<MarketRow | null>(null)
  const [book, setBook] = useState<Book | null>(null)
  const [tab, setTab] = useState<'trades' | 'holders' | 'rules'>('trades')
  const [err, setErr] = useState(false)
  const [noBook, setNoBook] = useState(false)
  const load = () => {
    get<ClaimDetail>(`/api/wiki/claim/${id}`).then(setC).catch(() => setErr(true))
    get<MarketRow>(`/api/markets/${id}`).then(setM).catch(() => {})
    get<Book>(`/api/wiki/claim/${id}/trades`).then(setBook).catch(() => setNoBook(true))
  }
  useEffect(() => { setC(null); setM(null); setBook(null); load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (c) document.title = `${words(c.claim).title} · Nearly Estate` }, [c])
  if (err && !c) return <Shell><Top /><p className="wc-empty">No market #{id}.</p></Shell>
  if (!c) return <Shell><Top /><div className="wp-skel" /></Shell>
  const w = words(c.claim), o = odds(c), ai = aiSays(c), p = c.p_yes ?? 0.5
  const noMeans = w.vs ? null : c.no_means ?? null
  const opened = book?.opened_p ?? 0.5
  // until the trade index answers, the AI agents' own trades on this market (each with its tx) stand in for the list
  // the settlement steps: the contract logs challenges and the end; the judge's own proposal is the market's ruling record (its tx
  // and time), on the side the first challenge went against
  const evs = book?.events ?? [], first = evs.find((e) => e.type === 'challenged'), rs = m?.resolution
  const steps: Ev[] = [
    ...(rs?.proposed && !evs.some((e) => e.type === 'proposed') ? [{ type: 'proposed' as const, side: (first ? (first.side === 'yes' ? 'no' : 'yes') : rs.outcome ? 'yes' : 'no') as 'yes' | 'no', tx: rs.tx || '', at: rs.proposed }] : []),   // a ruling anyone brought has a step too
    ...evs,
    ...(rs?.final && !evs.some((e) => e.type === 'resolved' || e.type === 'ruled') ? [{ type: 'resolved' as const, side: (rs.outcome ? 'yes' : 'no') as 'yes' | 'no', tx: rs.final, at: 0 }] : []),
  ]
  // the wiki's AI agents carry no names or roles, only "AI agent" (Substance/Challenge/Odds are the Swarm reviewers; next to the three judges they read as a second vote)
  const trades: TradeRow[] = book?.trades ?? (noBook ? c.desk.filter((d) => d.trade).map((d) => ({ tx: d.trade!.tx, at: d.at, market: id, account: d.agent, side: d.trade!.side, kind: 'buy' as const, near: d.trade!.near, shares: null, p_after: null, via: 'near' as const, note: null, agent: { id: d.agent, name: d.name, p: d.p, note: d.note } })) : [])
  return (
    <Shell>
      <Top />
      <div className="wc">
        <div className="wc-main">
          <div className="wc-crumb">{c.page ? <Link to={`/wiki/${c.page.slug}`}>← {c.page.title}</Link> : <Link to="/wiki">← Wiki</Link>}<span>Market #{id}</span></div>
          <div className="wc-chips"><span className={`wc-chip t-${o.tone}`}>{o.word}</span>{c.resolves_at_ms || !/^(settled|proposed|challenged)/.test(c.band) ? <span className="wc-chip">{c.resolves_at_ms ? ends(c.resolves_at_ms) : trades.length ? 'Ruling 72 hours after first trade' : 'No end date'}</span> : null}{c.data ? <a className="wc-chip" href={c.data.url} target="_blank" rel="noreferrer">{c.data.source}</a> : null}</div>
          <h1 className="wc-q">{w.title}</h1>
          {c.pages && c.pages.length > 1 ? <p className="wc-pages">Also on {c.pages.filter((p) => p.slug !== c.page?.slug).map((p, i) => <span key={p.slug}>{i ? ', ' : ''}<Link to={`/wiki/${p.slug}`}>{p.title}</Link></span>)}</p> : null}
          {c.ask ? <div className="wc-ask">
            <span className="q">Asked here: “{c.ask.question}”</span>
            <span className="a"><b>{c.ask.answer ? w.yes : w.no}</b>, the AI says {pct(c.ask.p)} likely{c.ask.signed ? ' (signed, sealed)' : ''}. {c.ask.reason}</span>
            <span className="m">The market says <b>{Math.round(p * 100)}%</b>. Think it's wrong? Bet the other side in the trade box.</span>
          </div> : null}
          {noMeans ? <p className="wc-no"><b>{w.no} means:</b> {noMeans}</p> : null}
          <section className="wc-card">
            <div className="wc-head">
              <div className="wc-big">{/^(settled|proposed)/.test(c.band) ? <b>{o.word}</b> : w.vs ? <b>{chance(p, w)}</b> : <><b>{Math.round(p * 100)}%</b><span>chance</span></>}</div>
              <dl className="wc-stats">
                <div><dt>Opened at</dt><dd>{pct(opened)}</dd></div>
                {(book?.volume_near ?? c.volume_near) != null ? <div><dt>Volume</dt><dd>{(book?.volume_near ?? c.volume_near)!.toFixed(2)} NEAR</dd></div> : null}
                {(book?.count ?? c.trades) != null ? <div><dt>Trades</dt><dd>{book?.count ?? c.trades}</dd></div> : null}
                {ai != null ? <div><dt>AI agents' view</dt><dd>{pct(ai)}</dd></div> : null}
              </dl>
            </div>
            <BigChart pts={c.history} opened={opened} now={p} />
            {w.vs ? <p className="wc-legend">The line is {w.yes}'s chance; {w.no}'s is the rest.</p> : null}
            <div className="wc-foot">{(book?.count ?? 0) > 0 ? 'Dashed line: the opening price. ' : ''}{c.collateral_near.toFixed(2)} NEAR in this market{m ? ` · market maker ${m.b_near.toFixed(2)} NEAR` : ''}{c.data?.now && c.status === 'Open' ? ` · ${reading(c.data.now)}${c.data.now_at ? ` as of ${new Date(c.data.now_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC` : ''}` : ''}</div>
          </section>
          {steps.length ? <section className="wc-time">
            <h3>{/^settled/.test(c.band) ? 'How it was settled' : 'Settlement so far'}{steps.filter((e) => e.type === 'challenged').length > 1 || steps.some((e) => e.type === 'ruled' && (e.rounds ?? 0) > 1) ? <span className="wc-old"> · rules before Nov 13</span> : null}</h3>   {/* the review: an old multi-bond ladder next to the one-challenge rule */}
            {steps.map((e, i) => (
              <div key={`${e.tx}-${i}`} className="wc-ev">
                <i className={`dot ${e.type}`} />
                <span className="t">{e.type === 'proposed' ? <>{i === 0 && (m?.resolution?.panel || (m?.resolution?.signed_on_chain ?? 0) >= 3) ? 'The judges ruled' : 'The judge ruled'} <em className={e.side}>{e.side === 'yes' ? w.yes : w.no}</em>{i === 0 && m && typeof m.status === 'object' && 'Proposed' in m.status && m.status.Proposed.by !== 'keysop.nearlyops.near' ? <> · brought by {whoIs(m.status.Proposed.by)} with a 1 NEAR bond</> : null}{i === 0 && m?.resolution?.verified ? <> · <a href={`/api/markets/${id}/receipt`} target="_blank" rel="noreferrer">signed receipt (JSON)</a></> : null}{i === 0 && m?.resolution?.panel ? <span className="panel">{m.resolution.panel.map((v) => `${modelName(v.model)}: ${v.outcome == null ? 'undecided' : v.outcome ? w.yes : w.no}${v.outcome == null || v.confidence == null ? '' : ` ${Math.round(v.confidence * 100)}%`}`).join(' · ')}</span> : null}</>
                  : e.type === 'challenged' ? <>Challenge: <b>{e.bond} NEAR</b> on <em className={e.side}>{e.side === 'yes' ? w.yes : w.no}</em>{e.signer ? <span className="who"> by {whoIs(e.signer)}</span> : null}</>
                  : e.type === 'ruled' ? <>The judge made the final call after {e.rounds} rounds: <em className={e.side}>{e.side === 'yes' ? w.yes : w.no}</em></>
                  : e.type === 'void' ? <>Nobody could settle it: void, every share gets 0.50 NEAR</>
                  : <>Final: <em className={e.side}>{e.side === 'yes' ? w.yes : w.no}</em>. Each {e.side === 'yes' ? w.yes : w.no} share gets 1 NEAR</>}{/* the holder gets paid, so "gets", not "pays" */}</span>
                {e.tx ? <a className="ago" href={txLink(e.tx)} target="_blank" rel="noreferrer">{e.at ? new Date(e.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC' : 'tx'}</a> : <span className="ago">{e.at ? new Date(e.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC' : ''}</span>}
              </div>
            ))}
          </section> : null}
          <nav className="wc-tabs">
            <button className={tab === 'trades' ? 'on' : ''} onClick={() => setTab('trades')}>{noBook ? `AI agents (${c.desk.length})` : `Trades and reasons${book ? ` (${book.count})` : ''}`}</button>
            {book ? <button className={tab === 'holders' ? 'on' : ''} onClick={() => setTab('holders')}>Holders ({book.holders.length})</button> : null}
            <button className={tab === 'rules' ? 'on' : ''} onClick={() => setTab('rules')}>Rules</button>
          </nav>
          {tab === 'trades' ? <div className="wc-list">
            {trades.map((t) => (
              <div key={t.tx + t.side + t.kind} className="wc-tr">
                <span className={`wc-av${t.agent ? ' ai' : ''}`}>{t.agent ? 'A' : t.account[0].toUpperCase()}</span>
                <div className="min-w-0">
                  <div className="l1"><b>{t.agent ? 'AI agent' : whoIs(t.account)}</b> {t.kind === 'buy' ? 'bought' : 'sold'} <em className={t.side}>{t.side === 'yes' ? w.yes : w.no}</em> <span className="mono">{t.near.toFixed(3)} NEAR{t.p_after != null ? ` → ${pct(t.p_after)}` : ''}</span>{t.via === 'intents' ? <span className="via">from another chain</span> : null}<a className="ago" href={txLink(t.tx)} target="_blank" rel="noreferrer">{timeAgo(t.at)} ago</a></div>
                  {/* an agent trade whose own view is unknown carries no belief line */}
                  {t.agent ? t.agent.p == null ? null : <div className="l2"><span className="mono">believes {pct(t.agent.p)}</span> “{t.agent.note}”</div> : t.note && !ours(t.account) ? <div className="l2">“{t.note}”</div> : null}
                </div>
              </div>
            ))}
            {book && !trades.length ? <p className="wc-none">{c.status === 'Open' ? 'No trades yet. Be the first.' : 'Nobody traded it.'}</p> : null}
            {!book && !noBook ? <p className="wc-none">Reading the trades from chain…</p> : null}
            {noBook ? c.desk.filter((d) => !d.trade).map((d) => (
              <div key={d.agent} className="wc-tr">
                <span className="wc-av ai">A</span>
                <div className="min-w-0"><div className="l1"><b>AI agent</b> says <span className="mono">{pct(d.p)}</span><span className="ago">{timeAgo(d.at)} ago</span></div><div className="l2">“{d.note}”</div></div>
              </div>
            )) : null}
          </div> : tab === 'holders' ? <div className="wc-list">
            {(book?.holders ?? []).map((h) => (
              <div key={h.account} className="wc-hold"><span className="mono">{whoIs(h.account)}</span>
                <span>{h.yes > 0.0005 ? <><em className="yes">{w.yes}</em> {h.yes.toFixed(3)}</> : null}{h.no > 0.0005 ? <> <em className="no">{w.no}</em> {h.no.toFixed(3)}</> : null}</span>
                <span className="mono">{(h.yes * p + h.no * (1 - p)).toFixed(3)} NEAR</span></div>
            ))}
            {book && !book.holders.length ? <p className="wc-none">Nobody holds shares yet.</p> : null}
          </div> : <div className="wc-rules">
            <p>{c.data ? resolvesIf(c.data.rule, w) : RULE_FACT}</p>
            {c.data ? <p>The server reads the number from <a href={c.data.url} target="_blank" rel="noreferrer">{c.data.source}</a> inside its enclave when the date comes; the judge must agree with the reading and signs, and trading stops the moment it is read.</p> : null}
            <p className="mono">Market #{id} · the Estate contract{m ? ` · opened by ${who(m.creator)}` : ''} · a share pays 1 NEAR</p>
          </div>}
        </div>
        <aside className="wc-side">
          <div className="wc-box">{m ? <TradeBox m={m} onChange={load} /> : <div className="mk-card skel short" />}</div>
          <div className="wc-box"><Who /></div>
          <div className="wc-box"><Sources c={c} onPosted={load} /></div>
        </aside>
      </div>
    </Shell>
  )
}

type Holding = { market: number; claim: string; page: { slug: string; title: string } | null; yes: number; no: number; p_yes: number; value_near: number; status: unknown; resolves_at_ms: number | null }

/** the reader's own bets across the wiki: every market they hold, what it is worth at today's price */
export function WikiMine() {
  const wl = useWallet()
  const [d, setD] = useState<{ positions: Holding[]; total_value_near: number } | null>(null)
  const [err, setErr] = useState(false)
  // the trade index polls the chain about every 90 s, so
  // the markets this browser just traded are asked for by id (?recent=, read from the contract by the server) and, until that
  // server is live, read here one by one and merged in
  useEffect(() => {
    const a = wl.accountId; if (!a) return
    let on = true
    const recent = recentBets()
    const q = recent.length ? `?recent=${recent.join(',')}` : ''
    get<{ positions: Holding[]; total_value_near: number }>(`/api/wiki/portfolio/${a}${q}`).then(async (d) => {
      const missing = recent.filter((id) => !d.positions.some((h) => h.market === id))
      const extra = (await Promise.all(missing.map(async (id) => {
        try {
          const [p, m] = await Promise.all([get<Position>(`/api/markets/${id}/position/${a}`), get<MarketRow>(`/api/markets/${id}`)])
          const yes = Number(BigInt(p.yes) / 10n ** 18n) / 1e6, no = Number(BigInt(p.no) / 10n ** 18n) / 1e6
          if (yes + no <= 0) return null
          const page = (m as MarketRow & { page?: { slug: string; title: string } | null }).page ?? null
          return { market: id, claim: m.question, page, yes, no, p_yes: m.p_yes, value_near: yes * m.p_yes + no * (1 - m.p_yes), status: m.status, resolves_at_ms: m.resolves_at_ms } as Holding
        } catch { return null }
      }))).filter((h): h is Holding => !!h)
      if (!on) return
      setD(extra.length ? { positions: [...extra, ...d.positions], total_value_near: d.total_value_near + extra.reduce((s, h) => s + h.value_near, 0) } : d)
    }).catch(() => on && setErr(true))
    return () => { on = false }
  }, [wl.accountId])
  return (
    <Shell>
      <Top />
      <div className="wc-mine">
        <h1 className="wc-q">Your bets</h1>
        {!wl.accountId ? <><p className="wc-none">Connect a wallet to see every market you hold.</p><button className="mk-btn auto" onClick={wl.signIn}>Connect wallet</button></>
          : err ? <p className="wc-none">Your bets did not load. Refresh in a moment.</p>
          : !d ? <div className="wp-skel sm" />
          : !d.positions.length ? <p className="wc-none">No bets yet. <Link to="/wiki">Find a market</Link>.</p>
          : <>
            <div className="wc-total"><span>Worth now</span><b>{d.total_value_near.toFixed(3)} NEAR</b><span>{d.positions.length} markets</span></div>
            <p className="wc-none">A new bet shows here within about two minutes of landing on chain.</p>
            <div className="wc-list">{d.positions.map((h) => { const w = words(h.claim); return (
              <Link key={h.market} to={`/wiki/m/${h.market}`} className="wc-pos">
                <span className="q">{w.title}<small>{h.page?.title}{h.resolves_at_ms ? ` · ${ends(h.resolves_at_ms)}` : ''}</small></span>
                <span>{h.yes > 0.0005 ? <><em className="yes">{w.yes}</em> {h.yes.toFixed(3)}</> : null}{h.no > 0.0005 ? <> <em className="no">{w.no}</em> {h.no.toFixed(3)}</> : null}</span>
                <span className="mono">{w.vs ? chance(h.p_yes, w) : `${pct(h.p_yes)} chance`}</span>
                <b className="mono">{h.value_near.toFixed(3)} NEAR</b>
              </Link>
            ) })}</div>
          </>}
      </div>
    </Shell>
  )
}
