import { useLayoutEffect, useRef, type ReactNode } from 'react'
import '../estate.css'

/** The hackathon pages' opening: eyebrow, headline, one line, the actions, the live figures on the left; the page's own object on the right. */
export function Hero({ eyebrow, title, sub, actions, tiles, line, aside }: { eyebrow: ReactNode; title: ReactNode; sub?: ReactNode; actions?: ReactNode; tiles: TileSpec[]; line?: TileSpec[]; aside: ReactNode }) {
  return (
    <section className="grid grid-cols-1 items-start gap-x-8 gap-y-6 lg:grid-cols-12">
      <div className="min-w-0 lg:col-span-5">
        <div className="est-eyebrow">{eyebrow}</div>
        <h1 className="est-h1">{title}</h1>
        {sub ? <p className="est-sub">{sub}</p> : null}
        {actions ? <div className="est-cta">{actions}</div> : null}
        {line ? <Tiles tiles={line} inline /> : tiles.length ? <Tiles tiles={tiles} /> : null}
      </div>
      <div className="min-w-0 est-in d1 lg:col-span-7">{aside}</div>
    </section>
  )
}
export type TileSpec = { k: string; v: string | number | null | undefined }
/** four figures. Under ten each they are one mono line, not four near-empty tiles; the first figure is the lead and carries the accent. */
export function Tiles({ tiles, inline }: { tiles: TileSpec[]; inline?: boolean }) {
  const loaded = tiles.every((t) => t.v != null)
  const small = inline || (loaded && tiles.every((t) => Number(String(t.v).replace(/[^\d.]/g, '')) < 10))
  // "1 keys sold" reads wrong: a label ending in a plural noun loses its s at 1
  const label = (k: string, v: string | number | null | undefined) => (String(v) === '1' ? k.toLowerCase().replace(/^(\w+)s\b/, '$1') : k.toLowerCase())
  if (small) return <div className="est-line">{tiles.map((t, i) => <span key={t.k}><b className={i === 0 ? 'acc' : undefined}>{t.v}</b> {label(t.k, t.v)}</span>)}</div>
  return <dl className="est-tiles">{tiles.map((t) => <Tile key={t.k} {...t} />)}</dl>
}
export const Tile = ({ k, v }: TileSpec) => (
  <div className="est-tile">
    {v == null ? <dd className="skel" /> : <dd>{v}</dd>}
    <dt className="lbl">{k}</dt>
  </div>
)

/** a section below the fold: a small heading, a count, something on the right */
export const Section = ({ title, count, right, children, className = '', flush }: { title: string; count?: number | null; right?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) => (
  <section className={`${flush ? '' : 'mt-9'} ${className}`}>
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="flex items-baseline gap-2"><h2 className="display text-[17px] tracking-[-0.01em] text-fg">{title}</h2>{count != null ? <span className="num text-[12px] text-fg-3">{count}</span> : null}</div>
      {right}
    </div>
    {children}
  </section>
)

export const Badge = ({ tone, children, title }: { tone: 'acc' | 'up' | 'sell' | 'gold' | 'mute'; children: ReactNode; title?: string }) => <span className={`est-badge ${tone}`} title={title}>{children}</span>
export const Tag = ({ children }: { children: ReactNode }) => <span className="est-tag">{children}</span>

/** the ticket: the launch page's perforated card. The notch sits where the perforation is, measured, so it is a real cut-out in both themes. */
export function Ticket({ head, main, body, grid, four, bottom, className = '', link, plain }: { head?: ReactNode; main?: ReactNode; body?: ReactNode; grid?: { k: string; v: ReactNode; txt?: boolean }[]; four?: boolean; bottom?: ReactNode; className?: string; link?: boolean; plain?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current, perf = el?.querySelector<HTMLElement>('.est-tix-perf')
    if (!el || !perf) return
    const set = () => el.style.setProperty('--perf', `${perf.offsetTop + 1}px`)
    set(); const ro = new ResizeObserver(set); ro.observe(el); return () => ro.disconnect()
  })
  return (
    <div ref={ref} className={`est-tix ${bottom && !plain ? 'notched' : ''} ${link ? 'link' : ''} ${className}`}>
      {head ? <div className="est-tix-head">{head}</div> : null}
      {main ? <div className="est-tix-main">{main}</div> : null}
      {body ? <div className="est-tix-body">{body}</div> : null}
      {grid?.length ? <div className={`est-tix-grid ${four ? 'four' : ''}`}>{grid.map((g) => <div key={g.k} className="min-w-0"><div className="est-tix-k">{g.k}</div><div className={`est-tix-v ${g.txt ? 'txt' : ''}`}>{g.v}</div></div>)}</div> : null}
      {bottom ? <><div className="est-tix-perf" /><div className="est-tix-bot">{bottom}</div></> : null}
    </div>
  )
}

/* numbers, the way the critics asked: $918K not $918.0K, 0.2 NEAR not 0.2000, NEAR never N */
export const money = (x: number) => (x < 1e3 ? `$${Math.round(x)}` : x < 1e6 ? `$${Math.round(x / 1e3)}K` : `$${(x / 1e6).toFixed(x < 1e7 ? 2 : 1)}M`)
export const signedUsd = (x: number) => `${x < 0 ? '-' : '+'}$${Math.abs(x) >= 100 ? Math.round(Math.abs(x)).toLocaleString('en-US') : Math.abs(x).toFixed(Math.abs(x) >= 10 ? 1 : 2)}`
export const nearAmt = (n: number) => `${n >= 100 ? Math.round(n).toLocaleString('en-US') : n >= 1 ? Number(n.toFixed(2)).toString() : Number(n.toFixed(3)).toString()} NEAR`
/** a fund or a bounty in a list column: always 2 decimals so the column lines up */
export const near2 = (n: number) => `${n.toFixed(2)} NEAR`
/** the PnL as a sub-stat: muted inside a dollar either way, jade up and coral down past it */
export const pnlTone = (x: number) => (x > 1 ? 'pos' : x < -1 ? 'neg' : '')
