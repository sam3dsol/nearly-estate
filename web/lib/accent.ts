/**
 * The one accent colour of the chrome.
 *
 * It has to do two jobs: stay out of the way of the up/down greens and reds, and NOT compete with
 * the warm metal plates on the board — so it is cool by design. `?accent=` switches it live.
 */
export interface Accent {
  key: string
  /** the two stops of the horizontal brand sweep on the primary key */
  a: string; b: string
  /** the same hue taken deep, for light mode — a neon that glows on black is illegible on paper */
  aDeep: string; bDeep: string
  /** solid accent used for text, borders, bars */
  base: string; soft: string
  /** the hard bottom edge of the struck key, and the ink printed on it */
  edge: string; ink: string
}

export const ACCENTS: Record<string, Accent> = {
  // the site default since 2026-09-26: the teal end of spring taken deeper, so accounts and links (accent)
  // no longer read as the same green as profits and up candles
  jade: { key: 'jade', a: '#7AF0DC', b: '#14B8A6', aDeep: '#0F766E', bDeep: '#115E59', base: '#2DD4BF', soft: '#7EE8D8', edge: '#0B4F4A', ink: '#021714' },
  // the live sweep, read off the shipped stylesheet: cyan into mint
  spring: { key: 'spring', a: '#38F2FF', b: '#3DFFA1', aDeep: '#0E7C86', bDeep: '#0B8F57', base: '#38F2FF', soft: '#7FF7FF', edge: '#0E6E78', ink: '#03141A' },
  iris: { key: 'iris', a: '#C3B8FF', b: '#8B7CF6', aDeep: '#5B3FD4', bDeep: '#4326A8', base: '#8B7CF6', soft: '#A99BFF', edge: '#33257A', ink: '#120E2A' },
  ice: { key: 'ice', a: '#A8E6FF', b: '#4EC3F0', aDeep: '#1E6F96', bDeep: '#0F5878', base: '#4EC3F0', soft: '#7FD6F5', edge: '#0E4E6B', ink: '#04202B' },
  rose: { key: 'rose', a: '#FFC2CF', b: '#F2789A', aDeep: '#B33A5E', bDeep: '#8E2545', base: '#F2789A', soft: '#F79BB3', edge: '#7A2438', ink: '#2B0A14' },
  /* ── NEAR ecosystem accents. Hexes read off the live sites on 2026-09-22, not from memory:
     aurora #70D44B (aurora.dev), (hot #F3C447/#FE7109 from hot-labs.org was added, then removed). rhea #00F7A5 was dropped:
     it sat 84/62 away from `spring` and read as the same swatch in the picker.
     near.org itself serves an empty body to non-browser clients, so there is no `near` preset. */
  aurora: { key: 'aurora', a: '#B6F09A', b: '#70D44B', aDeep: '#3F8F24', bDeep: '#2F6E1A', base: '#70D44B', soft: '#9CE47E', edge: '#2A5F17', ink: '#0B1A06' },
  lime: { key: 'lime', a: '#D7FF7A', b: '#7BE83C', aDeep: '#4D8C12', bDeep: '#36710C', base: '#A6F14E', soft: '#C9F98C', edge: '#33630F', ink: '#0F1A04' },
}

/** Order the swatches appear in the picker. */
export const ACCENT_KEYS = ['jade', 'spring', 'aurora', 'iris', 'ice', 'rose', 'lime'] as const
/** since the default moved to jade: a choice saved under the old key was mostly the old default, not a pick.
 * the picker's accent row became the Background row, so a saved accent could never be changed back; everyone
 *  is on jade again (?accent= still works for one visit). */
const STORE = 'nearly.accent.v3'

let current: Accent = ACCENTS.jade

const listeners = new Set<() => void>()
/** Subscribe to accent changes — for anything that reads the colour in JS rather than via CSS vars
 *  (the 3D floor light, canvas art), which cannot re-read a custom property on its own. */
export function onAccentChange(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** A `?accent=` in the url wins for one visit (so a link can show someone a theme), otherwise the
 *  last choice the visitor made, otherwise jade. */
/** Light mode swaps the whole ramp to the deep end. Re-run whenever the mode flips. */
function isLight() { return document.documentElement.getAttribute('data-theme') === 'light' }

export function applyAccent(key?: string) {
  const fromUrl = new URLSearchParams(location.search).get('accent') ?? ''
  let saved = ''
  try { saved = localStorage.getItem(STORE) ?? '' } catch { /* private mode, blocked storage */ }
  const want = key ?? (ACCENTS[fromUrl] ? fromUrl : saved)
  current = ACCENTS[want] ?? ACCENTS.jade
  if (key) { try { localStorage.setItem(STORE, current.key) } catch { /* ignore */ } }
  const r = document.documentElement.style
  const light = isLight()
  const a = light ? current.aDeep : current.a
  const b = light ? current.bDeep : current.b
  r.setProperty('--color-accent', light ? current.bDeep : current.base)
  r.setProperty('--color-accent-2', light ? current.aDeep : current.soft)
  r.setProperty('--color-accent-ink', light ? '#FFFFFF' : current.ink)
  r.setProperty('--accent-a', a)
  r.setProperty('--accent-b', b)
  // the ground tint must stay faint on paper, so it mixes from the bright end either way
  r.setProperty('--accent-tint', current.b)
  r.setProperty('--accent-edge', light ? current.edge : current.edge)
  if (key) listeners.forEach((fn) => fn())
}
export const setAccent = (key: string) => applyAccent(key)
export const accent = () => current
/** the darker end of the sweep, for the 3D floor light */
export const accentLo = () => current.edge
