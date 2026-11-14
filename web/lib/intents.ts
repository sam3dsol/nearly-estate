// Standalone copy of the nearly.trade app's src/lib/intents.ts for running web/ on its own, cut to what lib/ix.ts uses here:
// base64, and finding the browser's EVM wallets.

export const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))

/* ---- ERC-191: any injected EVM wallet (MetaMask, Rabby, Coinbase, OKX, ...), discovered with EIP-6963 ---- */
export type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown>; isMetaMask?: boolean; isRabby?: boolean }
export interface EvmProvider { info: { uuid: string; name: string; icon: string; rdns: string }; provider: Eth }
export const getEth = (): Eth | null => (window as unknown as { ethereum?: Eth }).ethereum ?? null
export function discoverEvm(): Promise<EvmProvider[]> {
  return new Promise((res) => {
    const found: EvmProvider[] = []
    const h = (e: Event) => { const d = (e as CustomEvent<EvmProvider>).detail; if (d?.info && !found.some((f) => f.info.uuid === d.info.uuid)) found.push(d) }
    window.addEventListener('eip6963:announceProvider', h)
    window.dispatchEvent(new Event('eip6963:requestProvider'))
    setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', h)
      const legacy = getEth()
      if (!found.length && legacy) found.push({ info: { uuid: 'legacy', name: legacy.isRabby ? 'Rabby' : legacy.isMetaMask ? 'MetaMask' : 'Injected EVM wallet', icon: '', rdns: 'legacy' }, provider: legacy })
      res(found)
    }, 350)
  })
}
