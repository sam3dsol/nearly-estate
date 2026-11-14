/**
 * Light / dark mode. Separate from the accent: the accent is which colour, this is which material.
 * Stored per visitor; falls back to the OS preference so a first visit already matches their system.
 */
export type Mode = 'dark' | 'light' | 'black'
/** the ground under the dark modes is the visitor's pick of five flat fills (the picker's Background row). Black
 *  is the default. A saved pick still wins. Light keeps its paper. The palettes are :root[data-ground=…] blocks at the end of index.css; index.html
 *  sets the attribute before first paint so a saved pick never flashes the default. */
export type Ground = 'black' | 'tint' | 'green' | 'jade' | 'ocean' | 'emerald'
export const GROUNDS: { key: Ground; label: string; bg: string; line: string; light: { label: string; bg: string; line: string } }[] = [
  // Black (the default) leads, then Tinted, Ocean, the rest
  // each key also names a light paper, picked the same way
  { key: 'black', label: 'Black', bg: '#000000', line: '#2E2E33', light: { label: 'Mist', bg: '#E4E7E4', line: '#B7BFBA' } },
  { key: 'tint', label: 'Tinted', bg: '#02100D', line: '#3A4C4D', light: { label: 'Paper', bg: '#F2F4F2', line: '#C9CFCB' } },
  { key: 'ocean', label: 'Ocean jade', bg: '#05242A', line: '#3B5F67', light: { label: 'Cool', bg: '#E1E7EA', line: '#B3BEC4' } },
  { key: 'green', label: 'Green', bg: '#05201A', line: '#466967', light: { label: 'Sage', bg: '#DEE5DE', line: '#AEBBB0' } },
  { key: 'jade', label: 'Deep jade', bg: '#062824', line: '#3D625C', light: { label: 'Mint', bg: '#DEE9E5', line: '#ADC0B9' } },
  { key: 'emerald', label: 'Emerald', bg: '#04261A', line: '#3B6352', light: { label: 'Cream', bg: '#EBE7DD', line: '#C4BDAE' } },
]
// picks saved under an earlier key are dropped once, so every visitor lands on Black; a pick made since is kept
const GSTORE = 'nearly.ground.v2'
const isGround = (g: unknown): g is Ground => GROUNDS.some((x) => x.key === g)
// black became the default for everyone, so choices saved under the old key are dropped once
const STORE = 'nearly.mode.v2'

const listeners = new Set<(m: Mode) => void>()
let current: Mode = 'black'
// a page may hold a mode without saving it (the wiki prints on paper); a pick by the visitor clears the hold
let held: Mode | null = null
let ground: Ground = (() => {
  try {
    const g = localStorage.getItem(GSTORE); if (isGround(g)) return g
  } catch { /* private mode */ }
  return 'black'
})()
function paintGround() {
  document.documentElement.setAttribute('data-ground', ground)
  if (current !== 'light') document.querySelector('meta[name="theme-color"]')?.setAttribute('content', GROUNDS.find((x) => x.key === ground)!.bg)
}

/** estate.nearly.trade opens in a soft light: light, but a grey-green paper rather than white; nearly.trade stays black */
const ESTATE = typeof location !== 'undefined' && location.hostname.startsWith('estate.')
if (ESTATE && typeof document !== 'undefined') document.documentElement.setAttribute('data-site', 'estate')
function systemPrefers(): Mode {
  // Black is the default look; the toggle and a saved choice still win.
  return ESTATE ? 'light' : 'black'
}

export function applyMode(mode?: Mode) {
  let saved: string | null = null
  try { saved = localStorage.getItem(STORE) } catch { /* private mode */ }
  if (mode) held = null
  current = mode ?? held ?? ((saved === 'light' || saved === 'dark' || saved === 'black') ? saved : systemPrefers())
  // `data-theme` rather than a class: the palette overrides live on :root[data-theme='light'] and a
  // stray `dark` class from the old markup must not be able to fight it
  document.documentElement.setAttribute('data-theme', current)
  paintGround()
  // the accent ramp differs per mode, so it has to be re-applied after the attribute flips
  void import('./accent').then((m) => m.applyAccent())
  if (mode) { try { localStorage.setItem(STORE, mode) } catch { /* ignore */ } }
  listeners.forEach((fn) => fn(current))
  return current
}
export const mode = () => current
/** hold the mode for a page (null lets go): the header key shows the held mode, and a pick made while held is saved as usual */
export function holdMode(m: Mode | null) { held = m; applyMode() }
export const heldMode = () => held
export const groundNow = () => ground
/** pick a ground: it shows in the dark modes: a pick made in light mode
 *  is kept for the next dark session and does not flip the mode. */
export function setGround(g: Ground) {
  ground = g
  try { localStorage.setItem(GSTORE, g) } catch { /* ignore */ }
  if (current === 'light') return
  paintGround()
  listeners.forEach((fn) => fn(current))
}
export const setMode = (m: Mode) => applyMode(m)
export const toggleMode = () => applyMode(current === 'dark' ? 'light' : 'dark')
export function onModeChange(fn: (m: Mode) => void) { listeners.add(fn); return () => { listeners.delete(fn) } }
