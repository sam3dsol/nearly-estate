import { useLayoutEffect, type ReactNode } from 'react'
import { Link } from 'react-router'
import { mode, onModeChange, type Mode } from '../lib/theme'
import '../market.css'
import '../wiki.css'
import '../wiki-press.css'
import { type Band, type Fact, type Home, words, chance, aiSays } from './Wiki'

/** What the wiki's pages share: the cream paper (Shell), the strip the topic pages wear, a topic's picture, a market's odds in
 * plain market words, the featured market. The front page is WikiGrid, topic pages WikiMargin.*/

const today = () => new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

/** a market's odds the way a market prints them: "52% chance", "NEAR 71%"; a ruling reads as the side it went to */
type Say = { word: string; tone: 'yes' | 'no' | 'mid' | 'none' }
export function odds(f: { claim: string; band: Band; p_yes: number | null }): Say {
  const w = words(f.claim)
  if (f.band === 'settled true' || f.band === 'proposed true') return { word: `${f.band.startsWith('settled') ? 'Resolved' : 'Ruled'} ${w.yes}`, tone: 'yes' }
  if (f.band === 'settled false' || f.band === 'proposed false') return { word: `${f.band.startsWith('settled') ? 'Resolved' : 'Ruled'} ${w.no}`, tone: 'no' }
  if (f.band === 'challenged') return { word: 'Challenged', tone: 'mid' }
  if (f.band === 'void') return { word: 'Void', tone: 'none' }
  if (f.band === 'untraded' || f.band === 'unpriced' || f.p_yes == null) return { word: 'New', tone: 'none' }
  return { word: chance(f.p_yes, w), tone: w.vs ? 'yes' : f.p_yes >= 0.6 ? 'yes' : f.p_yes <= 0.4 ? 'no' : 'mid' }
}
const ruled = (b: Band) => b.startsWith('proposed') || b.startsWith('settled')

/** the wiki is printed on white: light while it is open, the visitor's own theme back after */
// (feedback round 1, fesan52, m1halich228, sergeserge1, pn193014: "the wiki opens light when the site is dark, and dark is
// unreadable"; and the same day): the wiki follows the site theme like every other page: paper in light, the night edition
// (the wiki*.css dark palettes) in dark. Only the browser bar colour is the wiki's own.
export function useLight() {
  useLayoutEffect(() => {
    const paint = (m: Mode) => document.querySelector('meta[name="theme-color"]')?.setAttribute('content', m === 'light' ? '#F3EDE1' : '#0F0E0C')
    paint(mode())
    const off = onModeChange(paint)
    return () => { off(); try { localStorage.removeItem('nearly.wiki.mode') } catch { /* ignore */ } }
  }, [])
}
export function Shell({ children }: { children: ReactNode }) {
  useLight()
  return <div className="mk wp">{children}</div>
}

/** a thin strip with the paper's name, worn by the topic pages */
export const Strip = () => <div className="wp-strip"><Link to={`/wiki`} className="wp-name sm">nearly<span>.</span> wiki</Link><span>{today()}</span></div>

export type Row = { market: number; claim: string; p_yes: number | null; band: Band; collateral_near: number; resolves_at_ms: number | null; data: Fact['data']; page: { url: string; title: string } | null; volume_near?: number; trades?: number }
/** a topic Wikipedia has no picture for gets our engraving */
const ART = new Set(['artificial-intelligence', 'blockchain', 'btcpay-server', 'cryptocurrency', 'decentralized-finance', 'money-heist'])
/** a sharp coin icon where Wikipedia's picture reads badly at card size */
const COIN: Record<string, string> = { ethereum: '/wiki-art/ethereum.svg', stablecoin: '/wiki-art/stablecoin.svg' }
export const artOf = (p: { slug: string; image?: string | null }) => COIN[p.slug] || p.image || (ART.has(p.slug) ? `/wiki-art/${p.slug}.jpg` : null)
/** markets carrying our own test money: never featured */
const OWN_TEST = new Set([258, 44])

/** the featured market: the claim where the market and the AI agents disagree most (a traded topic claim, not ruled, not our own test money);
 *  with no agent views, the one with the most money in it */
export function pickLead(h: Home) {
  const ok = [...h.disputed, ...h.movers, ...h.trading].filter((f) => f.page?.kind === 'topic' && !OWN_TEST.has(f.market ?? -1) && f.band !== 'untraded' && !ruled(f.band) && f.band !== 'challenged' && f.p_yes != null)
  const gap = (f: Fact) => { const a = aiSays(f); return a == null ? 0 : Math.abs(a - f.p_yes!) }
  return ok.sort((a, b) => gap(b) - gap(a) || b.collateral_near - a.collateral_near)[0]
}
