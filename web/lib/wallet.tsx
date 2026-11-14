// Standalone copy of the nearly.trade app's src/lib/wallet.tsx for running web/ on its own. Same code, less one thing:
// the app also lists an EVM wallet row (Rabby, MetaMask as a NEAR account), which needs wagmi and viem; it is left out here.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { NearConnector } from '@hot-labs/near-connect'
import { Warning, X } from '@phosphor-icons/react'
import { NET, NETWORK } from '../brand'
import { signersOf, type Tx } from './pool'
import { errText } from './errors'

/**
 * Wallets come from HOT's near-connect, the connector Rhea uses.
 *
 * Before this the site ran @near-wallet-selector with 4 (later 8) wallet modules baked into a 2.5 MB
 * bundle, and each module wanted a different action shape (HOT/Meteor threw "Unsupported NAJ action"
 * on the shape MyNearWallet needed). near-connect loads each wallet's own script from a live manifest
 * in a sandboxed iframe, takes our `{ type, params }` actions as they are, and is ~40 KB.
 */
interface Ctx {
  accountId: string | null
  /** near-connect id of the connected wallet ('hot-wallet', 'meteor-wallet', 'ethereum-wallets', ...), null when none */
  walletId: string | null
  /** name + icon of the connected wallet from the near-connect manifest (the nav's wallet menu) */
  walletMeta: { name: string; icon: string } | null
  ready: boolean
  signIn: () => void
  signOut: () => Promise<void>
  send: (txs: Tx[]) => Promise<unknown>
  /** NEP-413 message signing */
  signMessage: (p: { message: string; recipient: string; nonce: Uint8Array }) => Promise<{ accountId: string; publicKey: string; signature: string }>
  wallet: () => Promise<unknown>
}
const WalletCtx = createContext<Ctx>({ accountId: null, walletId: null, walletMeta: null, ready: false, signIn: () => {}, signOut: async () => {}, send: async () => null, signMessage: async () => { throw new Error('No wallet connected') }, wallet: async () => null })

type SendWallet = {
  manifest?: { id?: string }
  signAndSendTransactions: (p: { transactions: Tx[] }) => Promise<unknown>
  signAndSendTransaction: (p: Tx) => Promise<unknown>
}
type OkxNear = {
  isSignedIn: () => Promise<boolean> | boolean
  requestSignIn: (p: { contractId: string }) => Promise<{ accountId?: string }>
  getAccountId: () => Promise<string | null> | string | null
  signAndSendTransaction: (p: { receiverId: string; actions: unknown[] }) => Promise<{ txHash?: string; code?: number }>
}
/** Once OKX has broadcast a tx, read its outcome so callers see the same shape every other wallet returns. */
async function txOutcome(hash: string, sender: string): Promise<unknown> {
  for (let i = 0; i < 20; i++) {
    for (const url of NET.rpc) {
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 't', method: 'tx', params: { tx_hash: hash, sender_account_id: sender, wait_until: 'FINAL' } }) })
        const j = await r.json()
        if (j.result?.status) return j.result
      } catch { /* next endpoint */ }
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  return null
}
/**
 * One call for every wallet: near-connect converts per wallet inside its sandbox.
 * Except OKX (a holder saw "sign Error", then "Confirm in wallet" forever): near-connect's OKX
 * executor signs through okxwallet.near.signTransaction / requestSignTransactions, and neither ever
 * opens OKX's approval window. okxwallet.near.signAndSendTransaction does (tested live, tx 8Z6NkJWG…),
 * so OKX gets that, one tx at a time, each landing before the next is signed.
 */
export const signAndSend = async (w: SendWallet, txs: Tx[]) => {
  const okx = (window as unknown as { okxwallet?: { near?: OkxNear } }).okxwallet?.near
  if (w.manifest?.id !== 'okx-wallet' || !okx) return w.signAndSendTransactions({ transactions: txs })
  // near-connect restores the session from storage after a reload, but OKX itself is signed out then
  let sender = (await okx.isSignedIn()) ? await okx.getAccountId() : null
  if (!sender) sender = (await okx.requestSignIn({ contractId: '' })).accountId ?? (await okx.getAccountId())
  if (!sender) throw new Error('OKX Wallet is not signed in')
  const out: unknown[] = []
  for (const t of txs) {
    const r = await okx.signAndSendTransaction({ receiverId: t.receiverId, actions: t.actions.map((a) => (a as { params: unknown }).params) })
    if (!r?.txHash) throw new Error('Cancelled in your wallet')
    out.push(await txOutcome(r.txHash, sender))
  }
  return out
}

const WALLET_ORDER = ['meteor-wallet', 'hot-wallet', 'ethereum-wallets']
const walletRank = (id: string) => { const i = WALLET_ORDER.indexOf(id); return i < 0 ? WALLET_ORDER.length : i }

import { addPhantomToSheet, phone } from './phantom'

const isCancel = (e: unknown) => /reject|cancel|closed|denied|user/i.test(e instanceof Error ? e.message : String(e))
// OKX's NEAR provider exists only in its browser extension and inside the OKX app's browser; anywhere else connect fails
const OKX_HINT = 'OKX works only in the OKX browser extension or inside the OKX app browser. Open nearly.trade there, or pick another wallet.'
const hasOkx = () => !!(window as unknown as { okxwallet?: { near?: unknown } }).okxwallet?.near
// a holder's "prompts me to download the OKX wallet": on a phone, OKX's universal link opens this page in the OKX app's browser (its download page if not installed)
const okxBrowse = (url: string) => 'https://www.okx.com/download?deeplink=' + encodeURIComponent('okx://wallet/dapp/url?dappUrl=' + encodeURIComponent(url))
// near-connect drops a session it cannot read back (wallet(): no accounts), so every call after that has no wallet
const SESSION_ENDED = 'Your wallet session ended. Nothing was sent. Connect your wallet again.'

export function WalletProvider({ children }: { children: ReactNode }) {
  const connRef = useRef<NearConnector | null>(null)
  const bootRef = useRef<Promise<NearConnector> | null>(null)
  const [accountId, setAccountId] = useState<string | null>(null)
  const [walletId, setWalletId] = useState<string | null>(null)
  const [ready, setReady] = useState(() => { try { return !localStorage.getItem('selected-wallet') } catch { return true } })
  // a failed connect, shown on top of every page (the Connect button has no room for it) until closed or 10 s pass
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 10_000); return () => clearTimeout(t) }, [notice])

  const boot = useCallback(() => {
    if (bootRef.current) return bootRef.current
    bootRef.current = (async () => {
      const { NearConnector } = await import('@hot-labs/near-connect')
      const c = new NearConnector({
        network: NETWORK,
        providers: { [NETWORK]: NET.rpc },
        footerBranding: null,
      })
      connRef.current = c
      // Connect list order: Meteor, HOT, Rabby/MetaMask, then the rest as the manifest lists them.
      // This .then runs after the constructor's own one, which is what fills c.wallets.
      c.whenManifestLoaded.then(() => { c.wallets.sort((a, b) => walletRank(a.manifest.id) - walletRank(b.manifest.id)) }).catch(() => {})
      c.on('wallet:signIn', (t) => { setAccountId(t.accounts[0]?.accountId ?? null); setWalletId(t.wallet?.manifest?.id ?? null) })
      c.on('wallet:signOut', () => { setAccountId(null); setWalletId(null) })
      try { const { wallet, accounts } = await c.getConnectedWallet(); setAccountId(accounts[0]?.accountId ?? null); setWalletId(wallet.manifest.id) } catch { /* nobody connected */ }
      setReady(true)
      return c
    })()
    bootRef.current.catch((e) => { bootRef.current = null; setReady(true); console.error('wallet init', e) })
    return bootRef.current
  }, [])

  const [walletMeta, setWalletMeta] = useState<Ctx['walletMeta']>(null)
  useEffect(() => {
    if (!walletId) { setWalletMeta(null); return }
    let live = true
    boot().then(async (c) => {
      await c.whenManifestLoaded.catch(() => {})
      const m = c.wallets.find((w) => w.manifest.id === walletId)?.manifest
      if (live) setWalletMeta(m ? { name: m.name, icon: m.icon } : null)
    }).catch(() => {})
    return () => { live = false }
  }, [walletId, boot])

  // ~40 KB now, so it boots right after first paint; the wallet list itself loads from the manifest.
  useEffect(() => { const t = setTimeout(() => { boot() }, 0); return () => clearTimeout(t) }, [boot])

  // the picker is opened here (not inside connect) so a failure can name the wallet that was picked
  const signIn = useCallback(() => {
    let picked: string | null = null, name = 'your wallet'
    // Change wallet from the nav menu: connect() points selected-wallet at the new pick before it signs in,
    // so a cancelled or failed change would leave the site on a wallet nobody is signed in to. Put the old one back.
    let prev: string | null = null
    try { prev = localStorage.getItem('selected-wallet') } catch { /* private mode */ }
    setNotice(null)
    boot().then(async (c) => {
      // a Phantom row joins the NEAR wallets while the sheet is open
      const off = addPhantomToSheet()
      try { picked = await c.selectWallet() } finally { off() }
      name = c.wallets.find((x) => x.manifest.id === picked)?.manifest.name ?? name
      // still inside the tap, so the phone lets the link open the app
      if (picked === 'okx-wallet' && !hasOkx() && phone()) { location.href = okxBrowse(location.href); return null }
      return c.connect({ walletId: picked })
    }).then(async (w) => {
      if (!w) return
      const a = await w.getAccounts().catch(() => [])
      if (a[0]?.accountId) setAccountId(a[0].accountId)
      setWalletId(w.manifest.id)
    }).catch((e) => {
      try { if (prev && localStorage.getItem('selected-wallet') !== prev) localStorage.setItem('selected-wallet', prev) } catch { /* private mode */ }
      if (picked === 'okx-wallet' && !hasOkx()) return setNotice(OKX_HINT)
      if (isCancel(e)) return // closed the picker or said no in the wallet: a choice, not an error
      console.error('connect', e)
      const m = errText(e, 'The wallet did not answer').slice(0, 200)
      setNotice(`Could not connect ${name}. ${/[.!?]$/.test(m) ? m : `${m}.`} Try again, or pick another wallet.`)
    })
  }, [boot])
  const signOut = useCallback(async () => { const c = await boot(); await c.disconnect().catch(() => {}); setAccountId(null); setWalletId(null) }, [boot])
  /* A holder report: the site kept showing one account while the wallet signed as another, and a swap paid
   * an account that was never registered (Rhea lost-and-found). The wallet decides who signs, so the site follows it:
   * before signing, ask the wallet which account it is on (Meteor and injected wallets report a switch live; HOT only
   * reports the account it signed in with), and after signing, adopt whoever actually signed. */
  const shownRef = useRef<string | null>(null)
  useEffect(() => { shownRef.current = accountId }, [accountId])
  // a session near-connect could not read back is gone: the nav goes back to Connect instead of showing a dead account
  const dropSession = useCallback(() => { shownRef.current = null; setAccountId(null); setWalletId(null) }, [])
  const send = useCallback(async (txs: Tx[]) => {
    const c = await boot()
    const w = await c.wallet().catch(() => null)
    if (!w) { dropSession(); throw new Error(SESSION_ENDED) }
    const shown = shownRef.current
    const live = (await w.getAccounts().catch(() => [])).map((a) => a.accountId).filter(Boolean)
    if (shown && live.length && !live.includes(shown)) {
      shownRef.current = live[0]; setAccountId(live[0])
      throw new Error(`Your wallet is on ${live[0]} now, not ${shown}. Nothing was sent. Check the trade and press again.`)
    }
    const res = await signAndSend(w as unknown as SendWallet, txs)
    const signer = signersOf(res, txs.map((t) => t.receiverId)).find((s) => s !== shown)
    if (signer) { shownRef.current = signer; setAccountId(signer) }
    return res
  }, [boot, dropSession])
  const signMessage = useCallback(async (p: { message: string; recipient: string; nonce: Uint8Array }) => {
    const c = await boot()
    const w = await c.wallet().catch(() => null) as unknown as { manifest?: { id?: string }; signMessage?: (p: { message: string; recipient: string; nonce: Uint8Array }) => Promise<{ accountId: string; publicKey: string; signature: string }> } | null
    if (!w) { dropSession(); throw new Error(SESSION_ENDED) }
    // OKX's near-connect executor never opens its approval window for signing (see signAndSend above): old flow
    if (!w.signMessage || w.manifest?.id === 'okx-wallet') throw new Error('This wallet cannot sign messages')
    return w.signMessage(p)
  }, [boot, dropSession])
  const wallet = useCallback(async () => {
    const w = await (await boot()).wallet().catch(() => null)
    if (!w) dropSession()
    return w
  }, [boot, dropSession])

  const value = useMemo(() => ({ accountId, walletId, walletMeta, ready, signIn, signOut, send, signMessage, wallet }), [accountId, walletId, walletMeta, ready, signIn, signOut, send, signMessage, wallet])
  return (
    <WalletCtx.Provider value={value}>
      {children}
      {notice && (
        <div role="alert" className="fixed inset-x-4 top-[76px] z-50 mx-auto flex max-w-[440px] items-start gap-2 rounded-sm border border-sell/40 bg-bg-1 px-3 py-2.5 text-[12.5px] text-fg shadow-[0_12px_32px_rgba(0,0,0,0.45)]">
          <Warning size={15} className="mt-0.5 shrink-0 text-sell" />
          <span className="min-w-0 flex-1">{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss" className="-m-1.5 shrink-0 p-1.5 text-fg-3 hover:text-fg"><X size={14} /></button>
        </div>
      )}
    </WalletCtx.Provider>
  )
}
export const useWallet = () => useContext(WalletCtx)
