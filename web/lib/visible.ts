/**
 * a hidden tab makes no chain reads.
 * Every poller keeps its own timer. A read started while the tab is hidden waits here until the tab is in front again, and
 * identical reads asked meanwhile share that one wait, so a tab that comes back makes one read per distinct call, not one
 * per missed tick. The tab in front is untouched: its reads go out at once, exactly as before.
 */
const pending = new Map<string, Promise<unknown>>()
let waiters: Array<() => void> = []
let listening = false

const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

function onVisible() {
  if (hidden()) return
  document.removeEventListener('visibilitychange', onVisible)
  listening = false
  const w = waiters
  waiters = []
  pending.clear()
  w.forEach((f) => f())
}

/** Resolves at once in a visible tab; in a hidden one, when it is visible again. */
export function whenVisible(): Promise<void> {
  if (!hidden()) return Promise.resolve()
  if (!listening) { listening = true; document.addEventListener('visibilitychange', onVisible) }
  return new Promise<void>((r) => waiters.push(r))
}

/** Run `go` now in a visible tab; in a hidden one, once it is visible again, one run shared by every identical `key` asked meanwhile. */
export function visibleRead<T>(key: string, go: () => Promise<T>): Promise<T> {
  if (!hidden()) return go()
  const had = pending.get(key) as Promise<T> | undefined
  if (had) return had
  const p = whenVisible().then(go)
  pending.set(key, p)
  return p
}
