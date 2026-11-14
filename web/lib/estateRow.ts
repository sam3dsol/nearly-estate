import { useEffect, useState } from 'react'

/** on estate.nearly.trade the Estate tabs sit in the header row, next to the wordmark, from 901px up
 * narrower than that each page keeps its own scrolling bar under the header.
 *  The header and the pages both read this one switch, so the bar renders exactly once. */
export const ESTATE_HOST = typeof location !== 'undefined' && location.hostname.startsWith('estate.')
const ROW = ESTATE_HOST && typeof matchMedia === 'function' ? matchMedia('(min-width: 901px)') : null
/* html.est-row lets market.css know the bar is in the header (a page that opens without a hero then starts 16px under it) */
const apply = () => { if (typeof document !== 'undefined') document.documentElement.classList.toggle('est-row', !!ROW?.matches) }
apply(); ROW?.addEventListener('change', apply)
export function useBarInNav() {
  const [on, setOn] = useState(!!ROW?.matches)
  useEffect(() => { if (!ROW) return; const f = () => setOn(ROW.matches); ROW.addEventListener('change', f); return () => ROW.removeEventListener('change', f) }, [])
  return on
}
