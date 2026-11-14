// Standalone copy of the nearly.trade app's src/lib/solTrade.ts for running web/ on its own, cut to the Solana wallets themselves
// (Phantom, Solflare, Jupiter, OKX): which one is connected, and signing with it. The app's NEARLY-on-Solana swaps are left out.

export const NEARLY_NEAR = 'nearly-993927.nearlytrade.near'

export type Key = { toString(): string; toBase58?(): string }
/** Phantom and Solflare inject the same shape; Solflare's connect() resolves true and leaves the key on .publicKey */
export type SolWallet = {
  isPhantom?: boolean; isSolflare?: boolean; isBraveWallet?: boolean; isConnected?: boolean; publicKey: Key | null
  connect(o?: { onlyIfTrusted?: boolean }): Promise<{ publicKey?: Key } | boolean | void>
  disconnect(): Promise<unknown>
  signTransaction<T>(tx: T): Promise<T>
  /** Phantom answers { signature }, Solflare the bare bytes */
  signMessage?(msg: Uint8Array, display?: 'utf8'): Promise<{ signature: Uint8Array } | Uint8Array>
  on?(ev: 'accountChanged' | 'disconnect', f: (k?: Key | null) => void): void
  off?(ev: 'accountChanged' | 'disconnect', f: (k?: Key | null) => void): void
}
type W = { phantom?: { solana?: SolWallet }; solana?: SolWallet; solflare?: SolWallet }
const browse = (base: string) => (url: string) => `${base}${encodeURIComponent(url)}?ref=${encodeURIComponent(location.origin)}`

/** Jupiter support: Jupiter's wallet (the extension, and inside the Jupiter app's browser) only speaks
 *  Wallet Standard, so it gets a small shim in the Phantom shape. The register handshake runs at load; a wallet can also
 *  register later (onSolWallets tells the site). Phantom's own Wallet Standard entry is kept too (see SOL_WALLETS.phantom). */
type StdAccount = { address: string; publicKey: Uint8Array }
type StdWallet = { name: string; accounts: readonly StdAccount[]; features: Record<string, unknown> }
type StdFeatures = {
  'standard:connect': { connect(o?: { silent?: boolean }): Promise<{ accounts: readonly StdAccount[] }> }
  'standard:disconnect'?: { disconnect(): Promise<void> }
  'standard:events'?: { on(ev: 'change', f: (p: { accounts?: readonly StdAccount[] }) => void): () => void }
  'solana:signTransaction': { signTransaction(i: { account: StdAccount; transaction: Uint8Array; chain: string }): Promise<readonly { signedTransaction: Uint8Array }[]> }
  'solana:signMessage'?: { signMessage(i: { account: StdAccount; message: Uint8Array }): Promise<readonly { signature: Uint8Array }[]> }
}
const stdKey = (a?: StdAccount): Key | null => (a ? { toString: () => a.address, toBase58: () => a.address } : null)
const fromStd = (w: StdWallet): SolWallet => {
  const f = w.features as StdFeatures
  const offs = new Map<unknown, () => void>()
  return {
    get publicKey() { return stdKey(w.accounts[0]) },
    get isConnected() { return w.accounts.length > 0 },
    async connect(o) { const r = await f['standard:connect'].connect({ silent: !!o?.onlyIfTrusted }); return { publicKey: stdKey(r.accounts[0] ?? w.accounts[0]) ?? undefined } },
    async disconnect() { await f['standard:disconnect']?.disconnect() },
    async signTransaction<T>(tx: T) {
      const web3 = await import('@solana/web3.js')
      const legacy = tx instanceof web3.Transaction // the bridge burn is legacy, Jupiter swaps are versioned
      const bytes = legacy ? tx.serialize({ requireAllSignatures: false, verifySignatures: false }) : (tx as unknown as InstanceType<typeof web3.VersionedTransaction>).serialize()
      const account = w.accounts[0]; if (!account) throw new Error('Connect Jupiter first')
      const [r] = await f['solana:signTransaction'].signTransaction({ account, transaction: bytes, chain: 'solana:mainnet' })
      return (legacy ? web3.Transaction.from(r.signedTransaction) : web3.VersionedTransaction.deserialize(r.signedTransaction)) as T
    },
    async signMessage(message) {
      const account = w.accounts[0]; if (!account) throw new Error('Connect Jupiter first')
      const sm = f['solana:signMessage']; if (!sm) throw new Error('This wallet cannot sign messages')
      const [r] = await sm.signMessage({ account, message })
      return { signature: r.signature }
    },
    on(ev, cb) {
      const off = f['standard:events']?.on('change', (p) => { if (!p.accounts) return; const a = w.accounts[0]; if (ev === 'disconnect') { if (!a) cb() } else if (a) cb(stdKey(a)) })
      if (off) offs.set(cb, off)
    },
    off(_ev, cb) { offs.get(cb)?.(); offs.delete(cb) },
  }
}
const std: { jupiter?: SolWallet; phantom?: SolWallet } = {}
const stdSubs = new Set<() => void>()
/** a Solana wallet registered after load: the site re-checks (quiet reconnect, Detected) */
export const onSolWallets = (f: () => void) => { stdSubs.add(f); return () => { stdSubs.delete(f) } }
try {
  const api = { register: (...ws: StdWallet[]) => {
    for (const w of ws) {
      if (!('standard:connect' in w.features && 'solana:signTransaction' in w.features)) continue
      const id = /^jupiter/i.test(w.name) ? 'jupiter' : /^phantom$/i.test(w.name) ? 'phantom' : null
      if (id && !std[id]) { std[id] = fromStd(w); stdSubs.forEach((f) => f()) }
    }
    return () => {}
  } }
  window.addEventListener('wallet-standard:register-wallet', (e) => (e as CustomEvent<(a: typeof api) => void>).detail(api))
  window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api }))
} catch { /* a wallet that throws here must never take the page down */ }

/** a holder's "integrate solflare as sol wallet and not just phantom" (then "Jupiter as well"): the Solana wallets we take,
 *  one connected at a time. No `browse` = no link that opens this site inside that wallet's phone app. */
export type SolId = 'phantom' | 'solflare' | 'jupiter' | 'okx'
export const SOL_WALLETS: Record<SolId, { name: string; icon: string; get: () => SolWallet | null; browse?: (url: string) => string; download: string }> = {
  phantom: {
    name: 'Phantom', icon: '/logos/phantom.svg', download: 'https://phantom.com/download', browse: browse('https://phantom.app/ul/browse/'),
    // Brave Wallet also says isPhantom, and reading.on off its proxy throws: that blanked the whole site on Brave.
    // Jupiter's "Connect as Phantom" setting takes over window.phantom (marked .jupiterWallet): then only Phantom's own
    // Wallet Standard entry is Phantom, so the Phantom key never opens Jupiter under Phantom's name.
    get: () => {
      const w = window as unknown as W, p = w.phantom?.solana ?? (w.solana?.isPhantom && !w.solana.isBraveWallet ? w.solana : null)
      // OKX Wallet set as the default wallet takes over window.phantom / window.solana and says
      // isPhantom, so a Phantom tap opened OKX under Phantom's name. An OKX provider is never Phantom; OKX has its own row.
      let other = false; try { const x = p as { jupiterWallet?: unknown; isOkxWallet?: unknown; isOKExWallet?: unknown } | null; other = !!(x?.jupiterWallet || x?.isOkxWallet || x?.isOKExWallet) } catch { /* a proxy that throws is not Jupiter or OKX */ }
      return p && !other ? p : std.phantom ?? null
    },
  },
  solflare: {
    name: 'Solflare', icon: '/logos/solflare.svg', download: 'https://solflare.com/download', browse: browse('https://solflare.com/ul/v1/browse/'),
    get: () => { const s = (window as unknown as W).solflare; return s?.isSolflare ? s : null },
  },
  jupiter: { name: 'Jupiter', icon: '/logos/jupiter.svg', download: 'https://jup.ag/wallet', get: () => std.jupiter ?? null },
  // OKX's Solana provider under its own name (a tester's ask for native OKX support), extension and in-app browser
  okx: { name: 'OKX Wallet', icon: '/logos/okx.svg', download: 'https://www.okx.com/download', get: () => { const o = (window as unknown as { okxwallet?: { solana?: SolWallet } }).okxwallet?.solana; return o ? o : null } },
}
const PICK_KEY = 'nearly.trade.solwallet'
let picked: SolId | null = (() => { try { const v = localStorage.getItem(PICK_KEY); return v && Object.hasOwn(SOL_WALLETS, v) ? v as SolId : null } catch { return null } })()
/** the wallet last connected here, else the one installed (Phantom, Solflare, Jupiter, OKX) */
export const solId = (): SolId => picked ?? (['phantom', 'solflare', 'jupiter', 'okx'] as const).find((id) => SOL_WALLETS[id].get()) ?? 'phantom'
export const setSolId = (id: SolId) => { picked = id; try { localStorage.setItem(PICK_KEY, id) } catch { /* private window: this visit only */ } }
export const getSolWallet = () => SOL_WALLETS[solId()].get()
