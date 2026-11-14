import { useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { timeAgo } from '../lib/format'
import { get, type Status } from '../lib/keys'
import '../market.css'
import '../wiki.css'
import '../wiki-margin.css'
import '../wiki-grid.css'
import { type Fact, type WPage, ClaimPanel, Unpriced, NewClaimFree, NewClaim, History, words, chance, resolvesIf, reading, ends, HIDDEN } from './Wiki'
import { artOf, useLight } from './WikiPress'
import { Top } from './WikiGrid'

/** A wiki page that knows how sure it is. NEAR AI's article reads as a plain page; a
 *  sentence the market prices carries a highlighter wash as strong as the market is sure THAT SENTENCE is right, and a note
 *  beside it in the margin (how sure, its line, a ruling's seal). Everything about the claim opens from the sentence. The
 *  front page is WikiPress, whose strip this page wears. */

const SPLIT = /(?<=[.!?\]])\s+(?=[A-Z0-9"'(“])/
const MARKS = /\s*\[(\d{1,2})\]/g
const nums = (t: string) => [...t.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1]))
const strip = (t: string) => String(t || '').replace(MARKS, '')
const HOUR = 36e5
/** markets where our own test money sits, said plainly */
const OURS_NOTE: Record<number, string> = {
  258: 'Most of the money here is a test bet: $0.36 paid from a Solana wallet through NEAR Intents on Nov 10, to prove buying from another chain works.',
  44: 'Both bonds in this challenge were a live test on Nov 10.',
}
/** a page whose picture is a logo (an SVG or a file named logo on Wikipedia, like the Bitcoin coin or the NEAR mark) shows it whole and in its own colours, not cropped into the ink plate */
const isLogo = (u?: string | null) => !!u && /\.svg|logo/i.test(u)

// the paper and its night edition are decided in one place (WikiPress useLight)


/** the ink plate: any photo in the page's two inks, so every topic reads as one book */
const Ink = () => (
  <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>
    <filter id="wm-ink" colorInterpolationFilters="sRGB">
      <feColorMatrix type="matrix" values="0.30 0.59 0.11 0 0  0.30 0.59 0.11 0 0  0.30 0.59 0.11 0 0  0 0 0 1 0" />
      <feComponentTransfer>
        <feFuncR type="table" tableValues="0.07 0.98" />
        <feFuncG type="table" tableValues="0.20 0.99" />
        <feFuncB type="table" tableValues="0.18 0.97" />
      </feComponentTransfer>
    </filter>
  </svg>
)

function Shell({ children }: { children: ReactNode }) {
  useLight()
  return <div className="mk wm"><Ink />{children}</div>
}

const ruling = (s: Status | 'Unpriced') => (typeof s === 'object' ? ('Proposed' in s ? { o: s.Proposed.outcome, at: s.Proposed.at_ms, final: false } : 'Resolved' in s ? { o: s.Resolved.outcome, at: 0, final: true } : null) : null)
const hoursLeft = (at: number) => Math.max(0, Math.ceil((at + 24 * HOUR - Date.now()) / HOUR))

/** how sure the market is that the page's SENTENCE is right. A sentence written while the market leaned false denies the claim,
 *  so its sureness is the price of False; a ruling either backs the sentence or not. null: nobody has bet yet */
type Sure = { v: number | null; tone: 'ok' | 'mid' | 'bad' | 'none'; ruled: ReturnType<typeof ruling> }
function sureOf(f: Fact, p: WPage): Sure {
  const r = ruling(f.status), w = f.market != null ? p.prices?.[String(f.market)] : null
  const asserts = w ? (w[1] !== 'Open' && r ? r.o : w[0] >= 0.5) : true
  if (r) { const v = asserts === r.o ? 1 : 0; return { v, tone: v ? 'ok' : 'bad', ruled: r } }
  if (typeof f.status === 'object' && 'Challenged' in f.status) return { v: 0.5, tone: 'mid', ruled: null }
  if (typeof f.status === 'object' && 'Invalid' in f.status) return { v: null, tone: 'none', ruled: null }
  if (f.band === 'untraded' || f.p_yes == null) return { v: null, tone: 'none', ruled: null }
  const v = asserts ? f.p_yes : 1 - f.p_yes
  return { v, tone: v >= 0.6 ? 'ok' : v > 0.4 ? 'mid' : 'bad', ruled: null }
}
/** the market's odds the way a market prints them ("52% chance", "NEAR 71%"); a ruling reads as the side it went to */
function verdict(f: Fact) {
  const r = ruling(f.status), wd = words(f.claim)
  if (r) return { w: `${r.final ? 'Resolved' : 'Ruled'} ${r.o ? wd.yes : wd.no}`, tone: r.o ? 'ok' : 'bad' }
  if (f.band === 'untraded' || f.p_yes == null) return { w: 'New', tone: 'none' }
  const p = f.p_yes
  return { w: chance(p, wd), tone: wd.vs ? 'ok' : p >= 0.6 ? 'ok' : p <= 0.4 ? 'bad' : 'mid' }
}

/** a line of the sentence's sureness over time */
function Line({ pts, flip }: { pts: number[]; flip: boolean }) {
  if (pts.length < 2) return null
  const d = pts.map((x, i) => `${((i / (pts.length - 1)) * 56).toFixed(1)},${(2 + (1 - (flip ? 1 - x : x)) * 12).toFixed(1)}`).join(' ')
  return <svg className="wm-line" viewBox="0 0 56 16" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="56" y1="8" y2="8" /><polyline points={d} /></svg>
}

/** the note in the margin beside a sentence */
function Note({ f, s, p, at, onPick }: { f: Fact; s: Sure; p: WPage; at: string; onPick: (f: Fact) => void }) {
  const w = f.market != null ? p.prices?.[String(f.market)] : null
  const flip = !!w && w[1] === 'Open' && w[0] < 0.5
  let body: ReactNode
  // the seal speaks for the sentence: the judge either backs what the page says or ruled the other way
  if (s.ruled) body = <><span className="seal">{s.v ? '✓' : '✗'}</span><span><b>{s.v ? 'The judges back this' : 'The judges ruled otherwise'}</b><i>{s.ruled.final ? 'settled' : hoursLeft(s.ruled.at) ? `${hoursLeft(s.ruled.at)}h to challenge` : 'stands'}</i></span></>
  else if (s.v == null) body = <span><b className="dim">No bets yet</b><i>be the first</i></span>
  else if (typeof f.status === 'object' && 'Challenged' in f.status) body = <span><b>Challenged</b><i>the judges look again</i></span>
  else { const p = f.p_yes ?? 0.5, wd = words(f.claim)   // the market's own side and number, as the claim panel prints them
    body = <><span><b>{wd.vs ? chance(p, wd) : `${p >= 0.5 ? wd.yes : wd.no} ${Math.round(Math.max(p, 1 - p) * 100)}%`}</b><i>{s.tone === 'mid' ? 'coin flip: ' : ''}{f.claim.length > 46 ? f.claim.slice(0, 44) + '…' : f.claim}</i></span><Line pts={f.spark} flip={flip} /></> }
  return <button className={`wm-sn ${at} t-${s.tone}`} onClick={() => onPick(f)}>{body}</button>
}

/** the page's text cut into sentences, each priced claim given to the first sentence that carries its [n] (pure, so a double
 *  render cannot lose them); the priced claims no sentence carries come back as `rest` */
type Block = { sen: string; fs: Fact[] }[]
function plan(p: WPage) {
  const shown = p.facts.filter((f) => !HIDDEN.has(f.market ?? -1))
  const facts = new Map(shown.map((f) => [f.n, f])), used = new Set<number>()
  const cut = (t: string): Block => String(t || '').split(SPLIT).map((sen) => {
    const fs = [...new Set(nums(sen))].map((k) => facts.get(k)).filter((x): x is Fact => !!x && x.market != null && !used.has(x.n))
    fs.forEach((f) => used.add(f.n))
    return { sen, fs }
  })
  const lede = cut(p.summary), sections = p.sections.map((x) => ({ h: x.h, b: cut(x.body) }))
  return { lede, sections, rest: shown.filter((f) => f.market != null && !used.has(f.n)) }
}

/** NEAR AI's text, a sentence at a time: priced sentences washed and noted, the rest plain */
function Prose({ block, p, onPick }: { block: Block; p: WPage; onPick: (f: Fact) => void }) {
  return <>{block.map(({ sen, fs }, i) => {
    if (!fs.length) return <span key={i}>{strip(sen)} </span>
    const s = sureOf(fs[0], p)
    const a = s.v == null ? 0 : s.tone === 'ok' ? 0.1 + (s.v - 0.6) * 0.75 : s.tone === 'mid' ? 0.2 : 0.16
    // the note floats into the margin beside the sentence's first line; on a phone the same note sits under the sentence instead
    const notes = (at: string) => fs.map((f) => <Note key={f.n} at={at} f={f} s={sureOf(f, p)} p={p} onPick={onPick} />)
    return <span key={i}>{notes('pre')}<span className={`wm-s t-${s.tone}`} style={{ ['--a' as string]: a.toFixed(3) }} onClick={() => onPick(fs[0])}>{strip(sen)}</span>{notes('post')} </span>
  })}</>
}

/** a coin page's Outlook: the server writes one sentence per market; here each is a market row in plain words */
function Outlook({ block, onPick }: { block: Block; onPick: (f: Fact) => void }) {
  const fs = block.flatMap((b) => b.fs)
  if (!fs.length) return null
  return <section className="wm-chain"><h2>Outlook</h2>{fs.map((f) => { const v = verdict(f); return (
    <button key={f.n} className="wm-cm" onClick={() => onPick(f)}>
      <span className="q">{words(f.claim).title}</span><b className={`t-${v.tone}`}>{v.w}</b>
      <span className="m">{f.resolves_at_ms ? ends(f.resolves_at_ms) : 'Resolves when the judges rule'}{(f.on_pages ?? 1) > 1 ? <> · on {f.on_pages} pages</> : null}{f.data ? <> · {f.data.source}{f.data.now ? <> · <i>{reading(f.data.now)}</i></> : null}</> : null}</span>
    </button>
  ) })}</section>
}

function Drawer({ f, page, onClose, onChange }: { f: Fact; page: WPage; onClose: () => void; onChange: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  const v = verdict(f), wd = words(f.claim)
  return (
    <div className="wm-dr" role="dialog" aria-label={wd.title}>
      <div className="wm-scrim" onClick={onClose} />
      <aside className="wm-pn">
        <button className="wm-x" onClick={onClose} aria-label="Close">×</button>
        <div className="wm-pq">{wd.title}</div>
        <div className={`wm-pv t-${v.tone}`}>{v.w}</div>
        {OURS_NOTE[f.market ?? -1] ? <p className="wm-own">{OURS_NOTE[f.market!]}</p> : null}
        {f.data ? <div className="wm-cd"><span>{f.resolves_at_ms ? ends(f.resolves_at_ms) : 'Open'} · <a href={f.data.url} target="_blank" rel="noreferrer">{f.data.source}</a></span>{resolvesIf(f.data.rule, wd)}{f.data.now ? <em>{reading(f.data.now)}</em> : null}</div> : null}
        {f.wiki?.quote ? <blockquote className="wm-wq"><span>Wikipedia{f.wiki.says === 'true' ? ' backs this' : f.wiki.says === 'false' ? ' says otherwise' : ''}</span>{f.wiki.quote}</blockquote> : null}
        {f.market != null ? <ClaimPanel id={f.market} page={page} onChange={onChange} /> : <Unpriced claim={f.claim} subject={page.key} onDone={onChange} />}
      </aside>
    </div>
  )
}

export function WikiArticle({ slug }: { slug: string }) {
  const loc = useLocation()
  const [p, setP] = useState<WPage | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { if (p?.title) document.title = `${p.title} · Nearly Estate` }, [p])
  const [open, setOpen] = useState<Fact | null>(null)
  const [hist, setHist] = useState(false)
  const [add, setAdd] = useState(false)
  const load = () => get<WPage>(`/api/wiki/${encodeURIComponent(slug)}`).then((x) => { setP(x); setErr(null) }).catch((e) => setErr(e instanceof Error ? e.message : 'failed'))
  useEffect(() => { setP(null); setOpen(null); setHist(false); load() }, [slug]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!p?.writing) return; const t = setTimeout(load, 4000); return () => clearTimeout(t) }, [p]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const m = /^#m(\d+)$/.exec(loc.hash); if (p && m) { const f = p.facts.find((x) => x.market === Number(m[1])); if (f) setOpen(f) } }, [p?.key, loc.hash]) // eslint-disable-line react-hooks/exhaustive-deps
  const back = <Top />
  if (err && !p) return <Shell>{back}<div className="wm-page"><p className="wm-empty">{err}.</p></div></Shell>
  if (!p) return <Shell>{back}<div className="wm-page"><div className="wm-skel" /></div></Shell>
  const pl = plan(p)
  // a token page comes without a title: its name and $SYMBOL
  const title = p.title || `${p.name || p.symbol} $${p.symbol}`
  const body = hist ? null : (
    <>
      <p className="wm-lede"><Prose block={pl.lede} p={p} onPick={setOpen} /></p>
      {pl.sections.map((s, i) => s.h === 'Outlook' ? <Outlook key={i} block={s.b} onPick={setOpen} /> : <section key={i}><h2>{s.h}</h2><p><Prose block={s.b} p={p} onPick={setOpen} /></p></section>)}
    </>
  )
  // priced claims the text never says: listed once at the end, so each can still be bet on
  const rest = hist ? [] : pl.rest.filter((f) => !f.data), chainMk = hist ? [] : pl.rest.filter((f) => f.data)
  return (
    <Shell>
      {back}
      <div className="wm-page">
        <article className="wm-col">
          <h1>{title}</h1>
          {p.description ? <p className="wm-dek">{p.description}</p> : null}
          {!hist && !p.writing ? <p className="wm-legend">Highlighted sentences are markets: the stronger the highlight, the surer the market that the sentence is right. Tap one to see its odds and bet.</p> : null}
          <div className="wm-meta">
            {p.writing ? 'NEAR AI is writing this page…' : <>Written by NEAR AI{p.ai?.signed ? <> · <a href={`/api/wiki/${encodeURIComponent(p.slug)}/receipt`} target="_blank" rel="noreferrer">signed</a></> : null} · {timeAgo(p.updated)} ago</>}
            {p.sources?.[0] ? <> · <a href={p.sources[0].url} target="_blank" rel="noreferrer">{p.kind === 'token' ? 'token' : 'Wikipedia'}</a></> : null}
            {p.versions > 1 ? <> · <button onClick={() => setHist(!hist)}>{hist ? 'back to the page' : `history (${p.versions})`}</button></> : null}
          </div>
          {artOf(p) && !hist ? <figure className={`wm-plate${isLogo(artOf(p)) ? ' logo' : ''}`}><img src={artOf(p)!} alt="" /><figcaption>{p.title} · {p.image ? 'picture from its Wikipedia article' : 'an illustration'}.</figcaption></figure> : null}
          {hist ? <History p={p} /> : body}
          {chainMk.length ? <section className="wm-chain"><h2>On-chain markets</h2>{chainMk.map((f) => { const v = verdict(f); return (
            <button key={f.n} className="wm-cm" onClick={() => setOpen(f)}>
              <span className="q">{words(f.claim).title}</span><b className={`t-${v.tone}`}>{v.w}</b>
              <span className="m">{f.resolves_at_ms ? ends(f.resolves_at_ms) : 'Open'} · {f.data!.source}{f.data!.now ? <> · <i>{reading(f.data!.now)}</i></> : null}</span>
            </button>
          ) })}</section> : null}
          {rest.length ? <section className="wm-rest"><h2>More markets</h2><p>{rest.map((f) => { const v = verdict(f); return <button key={f.n} className="wm-q" onClick={() => setOpen(f)}>{f.claim} <b className={`t-${v.tone}`}>{v.w}</b></button> })}</p></section> : null}
          {!hist ? (add ? <div className="wm-addbox">{p.kind === 'topic' ? <NewClaimFree p={p} onDone={() => setTimeout(load, 4000)} /> : <NewClaim token={p.token} symbol={p.symbol || ''} onDone={() => setTimeout(load, 4000)} />}</div> : <button className="wm-add" onClick={() => setAdd(true)}>+ Add a claim</button>) : null}
        </article>
      </div>
      {open ? <Drawer f={open} page={p} onClose={() => setOpen(null)} onChange={load} /> : null}
    </Shell>
  )
}
