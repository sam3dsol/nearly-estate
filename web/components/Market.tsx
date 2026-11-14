import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import { applyMode } from '../lib/theme'
import type { Feed, KeyRow } from '../lib/keys'
import '../market.css'
import { Link, NavLink } from 'react-router'
import { Ask } from './Ask'
import { ESTATE_HOST, useBarInNav } from '../lib/estateRow'

/** The hackathon pages (keys, swarm, wiki, agents) as market cards: one system, see market.css. */

/** the saved theme, before this page's first paint: index.html boots the dark chrome, the app re-applies the mode after mount */
export function useThemeBeforePaint() { useLayoutEffect(() => { applyMode() }, []) }

export function Page({ children }: { children: ReactNode }) {
  useThemeBeforePaint()
  const ref = useRef<HTMLDivElement>(null)
  // motion: a pipe or a flow strip plays once when it first scrolls into view (class "run")
  useEffect(() => {
    const root = ref.current; if (!root || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('run'); io.unobserve(e.target) } }), { threshold: 0.35 })
    const scan = () => root.querySelectorAll('.mk-pipe:not(.run), .mk-flow:not(.run)').forEach((el) => io.observe(el))
    scan(); const mo = new MutationObserver(scan); mo.observe(root, { childList: true, subtree: true })
    return () => { io.disconnect(); mo.disconnect() }
  }, [])
  // the Estate helper on every Estate page
  // on the Estate host from 901px up the bar lives in the header instead (lib/estateRow.ts)
  const inNav = useBarInNav()
  return <div ref={ref} className="mk">{inNav ? null : <EstateBar />}{children}<Ask /></div>
}
/** the five products as one place */
const ESTATE: [string, string][] = [['/wiki', 'Wiki'], ['/keys', 'Keys'], ['/swarm', 'Swarm'], ['/agents', 'Agents'], ['/checkout', 'Checkout']]   // the free game left the bar, it is not one of the five; the wiki front links it as Play free
export function EstateBar({ nav }: { nav?: boolean }) {
  const ref = useRef<HTMLElement>(null)
  // at its right end the phone fade comes off, so the last tab (Trust) is not left under it
  const [end, setEnd] = useState(false)
  const check = () => { const n = ref.current; if (n) setEnd(n.scrollLeft + n.clientWidth >= n.scrollWidth - 2) }
  useEffect(() => { const n = ref.current, a = n?.querySelector<HTMLElement>('a.active:not(.home)'); if (n && a) n.scrollLeft = Math.max(0, a.offsetLeft - (n.clientWidth - a.offsetWidth) / 2); check() }, [])   // scrolls the bar only, never the page
  return (
  <nav ref={ref} className={nav ? 'mk-estate nav' : 'mk-estate'} aria-label="Estate" data-end={end ? '' : undefined} onScroll={check}>
    <NavLink to="/estate" end className="home">Estate</NavLink>
    {ESTATE.map(([to, t]) => <NavLink key={to} to={to}>{t}</NavLink>)}
  </nav>
  )
}
type Users = { accounts: number; by_product: Record<string, number>; new_since: number | null }
/** users on chain, the team's own accounts left out. /api/users from the next server image, /api/outside
 *  until then; anyone re-checks the list with npm run users */
export function UsersLine({ product }: { product?: 'wiki' | 'keys' | 'swarm' }) {
  const [d, setD] = useState<Users | null>(null)
  useEffect(() => {
    const read = (p: string) => fetch(p).then((r) => (r.ok ? r.json() : null))
    read('/api/users').catch(() => null).then((x) => x ?? read('/api/outside')).then((x: Users | null) => { if (x && typeof x.accounts === 'number') setD(x) }).catch(() => {})
  }, [])
  if (!d) return null
  const here = product ? d.by_product[product] ?? 0 : null
  const name = product === 'keys' ? 'Keys' : product === 'swarm' ? 'the Swarm' : 'the wiki'
  return (
    <div className="mk-users">
      <span className="mk-dot" />
      {here != null ? <><b>{here} users on {name}</b><span>· {d.accounts} across the Estate</span></> : <><b>{d.accounts} users on chain</b><span>· on the Wiki, Keys and Swarm</span></>}
      {d.new_since ? <span className="pos">· +{d.new_since} new since Nov 13</span> : null}
    </div>
  )
}
/* his 'these pages are moving': figures no longer count up; they appear at their value */
function Count({ v }: { v: ReactNode }) {
  // a unit after the number ("2.41 NEAR") is set smaller than the figure
  const m = typeof v === 'string' ? /^(.*\d)(\s*[A-Za-z]+)$/.exec(v) : null
  return m ? <>{m[1]}<small>{m[2]}</small></> : <>{v}</>
}
/** a section heading: the plain title on the left, one quiet line on the right */
export const Head = ({ title, sub, right, h1 }: { title: string; sub?: ReactNode; right?: ReactNode; h1?: boolean }) => (
  <div className="mk-sh">{h1 ? <h1>{title}</h1> : <h2>{title}</h2>}{right ? <div className="r">{sub ? <p>{sub}</p> : null}{right}</div> : sub ? <p>{sub}</p> : null}</div>
)
/** the page's opening: the nearly mark in a scene that shows the product, the headline on
 *  its dark left side, the page's actions as buttons that jump to their section. On a phone the art sits above the headline. */
/** bump when an image changes: the files keep their names and browsers keep them 4 h */
export const ART_V = '1114q'   // keys.jpg colour-graded to the neutral steel of the other renders // Swarm hero = the scoreboard panel render (s1), same world as the lockers and the wall // estate.jpg re-cut with blank screens, no baked text in the file (1113b was b3's render of 11:46)
/* estate = the front door's wall of five screens, one per product */
const ART = { checkout: '#050b09', keys: '#090f0f', swarm: '#060e0a', wiki: '#090f0b', agents: '#070b0a', estate: '#0a0f0d' } as const
/** the five products as five doors on the front page: each one a slice of its own page's art (the mark with the
 *  product's object), its name and one line; `pos` is where the object stands in that art. The same slices head the product cards. */
export const DOORS: { to: string; art: keyof typeof ART; name: string; line: string; pos: string }[] = [
  { to: '/wiki', art: 'wiki', name: 'Wiki', line: 'Every fact a market', pos: '78%' },
  { to: '/keys', art: 'keys', name: 'Keys', line: 'Private trading, public PnL', pos: '76%' },
  { to: '/swarm', art: 'swarm', name: 'Swarm', line: 'AI jobs, paid on chain', pos: '80%' },
  { to: '/agents', art: 'agents', name: 'Agents', line: 'Wallets under rules', pos: '70%' },
  { to: '/checkout', art: 'checkout', name: 'Checkout', line: 'Pay from any chain', pos: '72%' },
]
export const artStyle = (art: keyof typeof ART, pos: string) => ({ '--door-img': `url(/estate/${art}.jpg?v=${ART_V})`, '--door-pos': pos } as CSSProperties)
const Doors = () => (
  <div className="doors">
    {DOORS.map((d) => <Link key={d.to} to={d.to} className="door" style={artStyle(d.art, d.pos)}><b>{d.name}</b><span>{d.line}</span></Link>)}
  </div>
)
/** the first two actions are buttons (one filled, one ghost); from the third on, a text link */
export const Hero = ({ art, eyebrow, title, sub, actions, compact, doors, equal, after, wall, scene }: { art: keyof typeof ART; eyebrow: string; title: string; sub: string; actions: { label: string; href: string }[]; compact?: boolean; doors?: boolean; equal?: boolean; after?: ReactNode; wall?: boolean; scene?: ReactNode }) => (
  <section className={`mk-hero${compact ? ' compact' : ''}${doors ? ' doors' : ''}${after ? ' with-after' : ''}${wall ? ' wall' : ''}`} style={{ '--hero-bg': ART[art], '--hero-img': doors || wall ? 'none' : `url(/estate/${art}.jpg?v=${ART_V})`, '--wall-img': wall ? `url(/estate/${art}.jpg?v=${ART_V})` : 'none' } as CSSProperties}>
    <div className="art" aria-hidden />
    <div className="in">
      <div className="txt">
        {eyebrow ? <div className="eb">{eyebrow}</div> : null}{/* the front door has no eyebrow line */}
        <h1>{title}</h1>
        <div className="side">
          {sub ? <p>{sub}</p> : null}{/* no empty paragraph when a hero has no sub line */}
          {actions.length ? <div className="act">{actions.map((x, i) => equal ? <a key={x.href} href={x.href} className="mk-btn ghost five"><i>0{i + 1}</i>{x.label}</a> : <a key={x.href} href={x.href} className={i < 2 ? `mk-btn${i ? ' ghost' : ''}` : 'lnk'}>{x.label}</a>)}</div> : null}
        </div>
      </div>
      {doors ? <Doors /> : null}
    </div>
    {wall ? <div className="scene">{scene}</div> : null}{/* the screens are real links in the scene */}
    {after ? <div className="after">{after}</div> : null}
  </section>
)
/** small grey labels over figures; a figure in words (txt) reads in the sans, numbers stay in the mono */
export const Stats = ({ items }: { items: { k: string; v: ReactNode; tone?: 'pos' | 'neg' | ''; txt?: boolean }[] }) => (
  <div className="mk-stats">{items.map((i) => <div key={i.k}>{i.k}<b className={[i.tone, i.txt ? 'txt' : ''].filter(Boolean).join(' ') || undefined}>{i.v}</b></div>)}</div>
)
/** a round avatar: the token's or the account's image, else its first letter (no generated print) */
export function Avatar({ icon, name, size = '' }: { icon?: string | null; name: string; size?: '' | 'lg' | 'sm' }) {
  const [bad, setBad] = useState(false)
  return <span className={`mk-av ${size}`}>{icon && !bad ? <img src={icon} alt="" loading="lazy" onError={() => setBad(true)} /> : (name.replace(/[^\p{L}\p{N}]/gu, '')[0] || '?').toUpperCase()}</span>
}

/** a line from real points only; a dashed zero line when the series crosses it */
export function Spark({ points }: { points: number[] }) {
  if (points.length < 2) return null
  const lo = Math.min(...points, 0), hi = Math.max(...points, 0), span = hi - lo || 1
  const y = (v: number) => 4 + (1 - (v - lo) / span) * 40
  const pts = points.map((v, i) => `${(i / (points.length - 1)) * 300},${y(v).toFixed(1)}`).join(' ')
  return <svg className="mk-spark" viewBox="0 0 300 48" preserveAspectRatio="none" aria-label="PnL from the trader's swaps"><line x1="0" x2="300" y1={y(0)} y2={y(0)} /><polyline points={pts} /></svg>
}

/** The trader's PnL over time, from the swaps behind the key: cash in stablecoins at $1, NEAR marked at the price each swap
 *  implies (the last point at today's price), launch tokens at the price of their last trade. One point after every swap. */
export function pnlLine(f: Feed, nearUsd: number | null): number[] {
  type Ev = { t: number; run: (p: Book) => void }
  type Book = { cash: number; near: number; px: number | null; qty: Map<string, number>; tpx: Map<string, number> }
  const amt = (s?: string | null) => { const m = /^([\d.]+) (\S+)$/.exec(s || ''); return m ? { n: Number(m[1]), sym: m[2] } : null }
  const stable = (s: string) => /^(USDC|USDT)$/.test(s), isNear = (s: string) => /^w?NEAR$/.test(s)
  const ev: Ev[] = []
  for (const o of [...(f.intents ?? []), ...(f.rhea ?? [])]) {
    if (!o.ts_ms || (o.status && o.status !== 'SUCCESS')) continue
    const a = amt(o.in), b = amt(o.out)
    if (!a || !b) continue
    ev.push({ t: o.ts_ms, run: (p) => {
      for (const [x, sign] of [[a, -1], [b, 1]] as const) { if (stable(x.sym)) p.cash += sign * x.n; else if (isNear(x.sym)) p.near += sign * x.n }
      const usd = stable(a.sym) ? a.n : stable(b.sym) ? b.n : null, n = isNear(a.sym) ? a.n : isNear(b.sym) ? b.n : null
      if (usd && n) p.px = usd / n
    } })
  }
  for (const t of f.trades ?? []) ev.push({ t: t.ts_ms, run: (p) => {
    const s = t.side === 'buy' ? 1 : -1
    p.cash -= s * t.usd; p.qty.set(t.token, (p.qty.get(t.token) ?? 0) + s * t.tokens)
    if (t.tokens > 0) p.tpx.set(t.token, t.usd / t.tokens)
  } })
  ev.sort((a, b) => a.t - b.t)
  const p: Book = { cash: 0, near: 0, px: null, qty: new Map(), tpx: new Map() }
  const value = (px: number | null) => p.cash + p.near * (px ?? 0) + [...p.qty].reduce((s, [k, q]) => s + q * (p.tpx.get(k) ?? 0), 0)
  const out = [0]
  for (const e of ev) { e.run(p); out.push(value(p.px ?? nearUsd)) }
  if (ev.length && nearUsd) out.push(value(nearUsd))
  return ev.length ? out : []
}

/** a key is named by its seller's account, like a handle; never a number and never a free name anyone could copy */
export const keyName = (k: KeyRow) => k.token
/** the facts a key card states as badges: confidential trading, and a swarm agent as the trading wallet (agent, from the API) */
export const keyBadges = (k: KeyRow & { agent?: boolean }) => [...(k.confidential ? ['Confidential'] : []), ...(k.agent ? ['AI agent'] : [])]

/** a token's display name as printable text: on-chain names can carry flipped Unicode (a BATMAN launch is named upside down) */
export const cleanName = (name: string | null | undefined, symbol: string | null | undefined, token: string) => {
  const ok = (s: string) => /^[\x20-\x7E\u00C0-\u024F\u0400-\u04FF\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF$]+$/.test(s)
  for (const c of [name, symbol]) if (c && ok(c)) return c
  return token.split('.')[0]
}
export const suffix = (token: string) => token.split('.')[0]

/* numbers: NEAR never N, $918K not $918.0K, cents under a dollar */
export const nearAmt = (n: number) => `${n >= 100 ? Math.round(n).toLocaleString('en-US') : n >= 1 ? Number(n.toFixed(2)).toString() : Number(n.toFixed(3)).toString()} NEAR`
export const near2 = (n: number) => `${n.toFixed(2)} NEAR`
export const money = (x: number) => (x < 1 ? `$${x.toFixed(2)}` : x < 1e3 ? `$${Math.round(x)}` : x < 1e6 ? `$${Math.round(x / 1e3)}K` : `$${(x / 1e6).toFixed(x < 1e7 ? 2 : 1)}M`)
/** a key's PnL as the public may see it: under $10 either way reads "under $10" (the public number is rounded to $10) */
export const pnlText = (x: number | null | undefined) => (x == null ? 'new' : Math.abs(x) < 10 ? 'under $10' : signedUsd(x))
export const pnlTone = (x: number | null | undefined) => (x == null || Math.abs(x) < 10 ? '' : x > 0 ? 'pos' : 'neg') as 'pos' | 'neg' | ''
/** the contract every page reads, linked to the explorer */
// the contract's name clashes with the Keys product, so pages say "the Estate contract"; the literal account shows only where a judge copies it (Verify on chain)
export const Contract = ({ literal = false }: { literal?: boolean }) => <a className="mk-link" href="https://nearblocks.io/address/keys.nearlyops.near" title="keys.nearlyops.near" target="_blank" rel="noreferrer">{literal ? 'keys.nearlyops.near' : 'the Estate contract'}</a>
/** the tab title of a page */
/* one suffix on the Estate host */
// ESTATE_HOST now comes from lib/estateRow.ts, shared with the header
export function useTitle(t: string) { useEffect(() => { const was = document.title; document.title = ESTATE_HOST ? (t === 'Nearly Estate' ? t : `${t} · Nearly Estate`) : `${t} · nearly.trade`; return () => { document.title = was } }, [t]) }
export const signedUsd = (x: number) => `${x < 0 ? '−' : '+'}$${Math.abs(x) >= 10 ? Math.round(Math.abs(x)).toLocaleString('en-US') : Math.abs(x).toFixed(2)}`
export const tone = (x: number | null | undefined) => (x == null ? '' : x > 1 ? 'pos' : x < -1 ? 'neg' : '') as 'pos' | 'neg' | ''
export const day = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/** the live console: a band of live numbers under the hero, read from the chain or our APIs on load */
export const Band = ({ items, live, right }: { items: { v: ReactNode; k: string; sub?: ReactNode; tone?: 'pos' | 'neg' | '' }[]; live?: ReactNode; right?: ReactNode }) => (
  <div className="mk-band">{/* the users line rides the live line, right-aligned, so the strip and the steps meet without a stray row */}
    {live ? <div className="lv"><span className="mk-dot" />{live}{right ? <span className="rt">{right}</span> : null}</div> : null}
    <div className="cells">{items.map((i) => <div key={i.k}><b className={i.tone || undefined}><Count v={i.v} /></b><span>{i.k}</span>{i.sub ? <em>{i.sub}</em> : null}</div>)}</div>
  </div>
)
/** how one unit of work moves, in a few words per step */
export const Flow = ({ steps, title = 'How it works' }: { steps: { t: string; d: string }[]; title?: string }) => (<>{/* the steps get a section head and read as panels, not a caption row */}
  <div className="mk-sh mk-flow-head"><h2>{title}</h2></div>
  <ol className="mk-flow">{steps.map((x, i) => <li key={x.t}><span className="n">{String(i + 1).padStart(2, '0')}</span><b>{x.t}</b><p>{x.d}</p></li>)}</ol></>
)
/** the one real example a page leads with */
export const Show = ({ tag, title, right, children }: { tag: string; title?: ReactNode; right?: ReactNode; children: ReactNode }) => (
  <section className="mk-show"><div className="hd"><span className="tag">{tag}</span>{right ? <div className="end">{right}</div> : null}</div>{title ? <h3>{title}</h3> : null}{children}</section>
)
/** a compact record: one row per thing that happened, columns set by the page */
/** on a phone only the columns in `keep` show, laid out by `colsSm` */
export const Log = ({ cols, colsSm, keep, head, rows }: { cols: string; colsSm?: string; keep?: number[]; head: string[]; rows: { key: string | number; cells: ReactNode[]; href?: string; to?: string }[] }) => {
  const cls = (i: number) => (keep && !keep.includes(i) ? 'hide-sm' : undefined)
  const cells = (c: ReactNode[]) => c.map((x, i) => <span key={i} className={cls(i)}>{x}</span>)
  return (
    <div className="mk-log" style={{ '--cols': cols, '--cols-sm': colsSm ?? cols } as CSSProperties}>
      <div className="r th">{cells(head)}</div>
      {rows.map((r) => r.to ? <Link key={r.key} to={r.to} className="r">{cells(r.cells)}</Link> : r.href ? <a key={r.key} href={r.href} className="r">{cells(r.cells)}</a> : <div key={r.key} className="r">{cells(r.cells)}</div>)}
    </div>
  )
}
