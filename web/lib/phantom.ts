/**
 * + "home card too": one Solana wallet connection for the whole site.
 * a holder's "integrate solflare... not just phantom" (then "Jupiter as well"): Phantom, Solflare or Jupiter, the one picked last stays picked.
 * Connecting from the Connect sheet lands on the NEARLY trade box in SOL mode. The nav key, the Connect sheet rows,
 * the home card key, the trade box and /multichain all read and change it here.
 */
import { useEffect, useState } from 'react'
import { pickSol } from './ix'
import { NEARLY_NEAR, SOL_WALLETS, getSolWallet, onSolWallets, setSolId, solId, type Key, type SolId, type SolWallet } from './solTrade'

export const PHANTOM_ICON = SOL_WALLETS.phantom.icon
export const NEARLY_PATH = `/${NEARLY_NEAR}`
export const SOL_CHART = 'https://dexscreener.com/solana/hg9y5s5dqarvw25v7c4xxgi1fk6rhayjbqnqe976ceba'
/** 'sol' = the trade box trades through NEAR Intents with the Solana/EVM wallet (was the Solana-pool box, key nearly.trade.chain) */
export const IX_PICK = 'nearly.trade.ix'
export const phone = () => /Android|iPhone|iPad/i.test(navigator.userAgent)
const str = (k?: Key | null) => (k ? k.toBase58?.() ?? k.toString() : null)
/** Phantom's connect() resolves the key, Solflare's resolves true and sets .publicKey */
const keyOf = (p: SolWallet, r: unknown) => str((r as { publicKey?: Key } | null)?.publicKey ?? p.publicKey)

let key: string | null = null
let keyId: SolId | null = null
const subs = new Set<(k: string | null) => void>()
// a switch to the other wallet re-renders even when both hold the same address
const put = (k: string | null) => { if (k === key && keyId === solId()) return; key = k; keyId = solId(); subs.forEach((f) => f(k)) }

// the wallet
// keeps trusting the site after disconnect(), so a Disconnect is remembered here and the quiet reconnect waits for a Connect tap
const OFF_KEY = 'nearly.sol.off'
const isOff = () => { try { return localStorage.getItem(OFF_KEY) === '1' } catch { return false } }
const setOff = (off: boolean) => { try { if (off) localStorage.setItem(OFF_KEY, '1'); else localStorage.removeItem(OFF_KEY) } catch { /* private mode */ } }
const wired = new Set<SolId>()
const wire = (id: SolId = solId()) => {
  if (wired.has(id)) return
  const p = SOL_WALLETS[id].get(); if (!p) return
  wired.add(id)
  // approved this site before: Phantom and Jupiter reconnect quietly (Solflare has no quiet mode: it waits for a tap).
  // Follow account switches and disconnects made inside the wallet, but only the wallet in use.
  // A wallet that throws here must never take the page down with it.
  try {
    if (isOff()) { /* disconnected on purpose: no quiet reconnect */ }
    else if (id !== 'solflare') p.connect({ onlyIfTrusted: true }).then((r) => { if (solId() === id) put(keyOf(p, r)) }).catch(() => {})
    else if (p.isConnected && p.publicKey && solId() === id) put(str(p.publicKey))
    p.on?.('accountChanged', (k) => { if (solId() === id) put(str(k)) })
    p.on?.('disconnect', () => { if (solId() === id) put(null) })
  } catch { /* no quiet reconnect in this browser */ }
}

// a wallet that registers after the page loaded (Jupiter can) still gets its quiet reconnect
onSolWallets(() => { if (subs.size) wire() })

/** the connected Solana address (Phantom, Solflare or Jupiter), or null */
export function usePhantom() {
  const [k, setK] = useState(key)
  useEffect(() => { wire(); setK(key); subs.add(setK); return () => { subs.delete(setK) } }, [])
  return k
}
/** name + icon of the wallet in use (or the one a Connect button would open) */
export const solWallet = () => SOL_WALLETS[solId()]

/** null = that wallet isn't here (phones: `page` opens inside the wallet's own browser; desktop: its download page).
 *  Jupiter's phone app has no such link: the page link is copied and SolLinkNote says where to paste it. */
export async function phantomConnect(id: SolId = solId(), page = NEARLY_PATH): Promise<string | null> {
  const w = SOL_WALLETS[id], p = w.get()
  if (!p) {
    const url = location.origin + page
    if (phone() && !w.browse) {
      // copied here, inside the tap: phones refuse a clipboard write that comes later
      const copied = navigator.clipboard ? navigator.clipboard.writeText(url).then(() => true, () => false) : Promise.resolve(false)
      window.dispatchEvent(new CustomEvent<SolLink>('nearly:sol-link', { detail: { id, url, copied } }))
    } else window.open(phone() ? w.browse!(url) : w.download, '_blank', 'noopener')
    return null
  }
  const k = keyOf(p, await p.connect())
  if (!k) throw new Error(`${w.name} did not share an address`)
  setOff(false); setSolId(id); wire(id); put(k)
  return k
}
export type SolLink = { id: SolId; url: string; copied: Promise<boolean> }
export async function phantomDisconnect() { setOff(true); put(null); await getSolWallet()?.disconnect().catch(() => {}) }

/** the trade box trades with the Solana wallet through NEAR Intents (kept per browser, like its pill); a box already on screen switches at once */
export function setTradeChain(c: 'sol' | 'near') {
  try { localStorage.setItem(IX_PICK, c) } catch { /* private window: this visit only */ }
  window.dispatchEvent(new CustomEvent('nearly:chain', { detail: c }))
}
/** outside React (the Connect sheet): Intents mode; on a token page the box there switches, anywhere else the NEARLY page opens */
export function openNearlyOnSolana() {
  setTradeChain('sol')
  pickSol()
  if (location.pathname === NEARLY_PATH || /^\/[^/]+\.(near|tg)$/.test(location.pathname)) return
  history.pushState(null, '', NEARLY_PATH)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

/**
 * Phantom, Solflare and Jupiter in near-connect's wallet sheet. The sheet only lists NEAR wallets, so our rows go in 3rd to 5th, after Meteor
 * and HOT, above Rabby/MetaMask, and come back whenever the sheet redraws. Picking one closes the
 * sheet (a plain cancel for the NEAR side) and connects it. Own class, not .connect-item, so near-connect never binds it to a NEAR wallet.
 */
export function addPhantomToSheet(): () => void {
  const row = (id: SolId) => {
    const w = SOL_WALLETS[id]
    const el = document.createElement('div')
    el.className = 'np-item'
    el.setAttribute('role', 'button')
    el.tabIndex = 0
    el.innerHTML = `<img src="${w.icon}" alt="${w.name}" /><div class="connect-item-info"><span>${w.name}</span><span class="wallet-address">Solana</span></div>`
    const pick = () => {
      document.querySelector<HTMLElement>('.hot-connector-popup .modal-container')?.click()
      phantomConnect(id).then((k) => { if (k) openNearlyOnSolana() }).catch(() => { /* said no in the wallet */ })
    }
    el.addEventListener('click', pick)
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick() } })
    return el
  }
  const place = () => {
    const items = document.querySelectorAll('.hot-connector-popup .modal-body .connect-item')
    if (!items.length || document.querySelector('.hot-connector-popup .np-item')) return
    const after = items[Math.min(1, items.length - 1)]
    // a holder picked OKX's Solana row here and saw an empty portfolio (the NEARLY sat in OKX's NEAR account): the NEAR OKX row
    // lower in this sheet is the one that matters, so OKX stays only in the Solana wallet sheet (SolPicker)
    after.after(...(Object.keys(SOL_WALLETS) as SolId[]).filter((id) => id !== 'okx').map(row))
  }
  const mo = new MutationObserver(place)
  mo.observe(document.body, { childList: true, subtree: true })
  place()
  return () => mo.disconnect()
}
