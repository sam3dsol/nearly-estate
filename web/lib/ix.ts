// Standalone copy of the nearly.trade app's src/lib/ix.ts for running web/ on its own, cut to what the Estate pages use: the chains,
// the Solana or EVM wallet that trades through NEAR Intents, and sending a 1Click deposit from it. The app's Intents trading relay,
// its quotes and the Omni bridge are left out.
/**
 * A Solana wallet (Phantom, Solflare, Jupiter) or any browser EVM wallet trades through NEAR Intents: no NEAR wallet, no gas.
 * Its balance is its own account inside intents.near (Solana: the 64-hex of the key, EVM: the 0x address, both already own
 * their key there).
 */
import { useEffect, useState } from 'react'
import { b64, discoverEvm, type Eth } from './intents'
import { ONECLICK } from './oneclick'
import { getSolWallet } from './solTrade'
import { usePhantom } from './phantom'

/* ---------- chains: where the coin comes from and goes back to ---------- */
export type IxChain = 'sol' | 'base' | 'eth' | 'arb' | 'bsc'
export const IX_CHAINS: Record<IxChain, { name: string; coin: string; asset: string; dec: number; evm?: number; logo: string }> = {
  sol: { name: 'Solana', coin: 'SOL', asset: 'nep141:sol.omft.near', dec: 9, logo: '/logos/solana.png' },
  base: { name: 'Base', coin: 'ETH', asset: 'nep141:base.omft.near', dec: 18, evm: 8453, logo: '/logos/eth.svg' },
  eth: { name: 'Ethereum', coin: 'ETH', asset: 'nep141:eth.omft.near', dec: 18, evm: 1, logo: '/logos/eth.svg' },
  arb: { name: 'Arbitrum', coin: 'ETH', asset: 'nep141:arb.omft.near', dec: 18, evm: 42161, logo: '/logos/eth.svg' },
  bsc: { name: 'BNB Chain', coin: 'BNB', asset: 'nep245:v2_1.omni.hot.tg:56_11111111111111111111', dec: 18, evm: 56, logo: '' },
}

/* ---------- the wallet ---------- */
export type IxWallet = { kind: 'sol' | 'evm'; addr: string; id: string; name: string; icon: string }
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function unbase58(s: string): Uint8Array {
  let x = 0n
  for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error('bad base58'); x = x * 58n + BigInt(i) }
  const out: number[] = []
  while (x > 0n) { out.unshift(Number(x & 0xffn)); x >>= 8n }
  for (const c of s) { if (c !== '1') break; out.unshift(0) }
  return Uint8Array.from(out)
}
const hex = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, '0')).join('')
/** the Intents account of a Solana address: the 64-hex of its 32-byte key */
export const solIntentsId = (addr: string) => hex(unbase58(addr))

/** EVM side: any EIP-6963 wallet, kept apart from near-connect's EVM row (that one makes the 0x a NEAR account) */
type EvmConn = { addr: string; rdns: string; name: string; icon: string; provider: Eth }
const EVM_KEY = 'nearly.ix.evm', PICK_KEY = 'nearly.ix.pick'
let evm: EvmConn | null = null
let pick: 'sol' | 'evm' = (() => { try { return localStorage.getItem(PICK_KEY) === 'evm' ? 'evm' : 'sol' } catch { return 'sol' } })()
const subs = new Set<() => void>()
const ping = () => subs.forEach((f) => f())
const setPick = (p: 'sol' | 'evm') => { pick = p; try { localStorage.setItem(PICK_KEY, p) } catch { /* private window */ } ping() }
const watched = new WeakSet<object>()
function follow(c: EvmConn) {
  const p = c.provider as Eth & { on?: (ev: string, f: (a: string[]) => void) => void }
  if (watched.has(p) || !p.on) return
  watched.add(p)
  p.on('accountsChanged', (a) => {
    if (evm?.provider !== c.provider) return
    const next = a?.[0]?.toLowerCase()
    if (!next) evmDisconnect()
    else { evm = { ...evm, addr: next }; save(); ping() }
  })
}
const save = () => { try { if (evm) localStorage.setItem(EVM_KEY, JSON.stringify({ addr: evm.addr, rdns: evm.rdns })); else localStorage.removeItem(EVM_KEY) } catch { /* private window */ } }
let restoring: Promise<void> | null = null
/** a wallet approved before comes back quietly on reload (eth_accounts asks nothing) */
function restore() {
  if (restoring) return restoring
  restoring = (async () => {
    let s: { addr: string; rdns: string } | null = null
    try { s = JSON.parse(localStorage.getItem(EVM_KEY) ?? 'null') } catch { /* private window */ }
    if (!s) return
    const found = (await discoverEvm()).find((p) => p.info.rdns === s!.rdns)
    if (!found) return
    const accs = ((await found.provider.request({ method: 'eth_accounts' }).catch(() => [])) as string[]).map((a) => a.toLowerCase())
    if (!accs.includes(s.addr)) return
    evm = { addr: s.addr, rdns: found.info.rdns, name: found.info.name, icon: found.info.icon, provider: found.provider }
    follow(evm); ping()
  })().catch(() => {})
  return restoring
}
export function evmDisconnect() { evm = null; save(); if (pick === 'evm') setPick('sol'); else ping() }
/** the Solana key was just connected for Intents trading: it wins over a connected EVM wallet */
export const pickSol = () => setPick('sol')

/** the wallet that trades through Intents right now: the one picked last of a connected Solana key and EVM account */
export function useIxWallet(): IxWallet | null {
  const sol = usePhantom()
  const [, bump] = useState(0)
  useEffect(() => { const f = () => bump((x) => x + 1); subs.add(f); void restore(); return () => { subs.delete(f) } }, [])
  const s: IxWallet | null = sol ? { kind: 'sol', addr: sol, id: solIntentsId(sol), name: 'Solana', icon: '/logos/solana.png' } : null
  const e: IxWallet | null = evm ? { kind: 'evm', addr: evm.addr, id: evm.addr, name: evm.name, icon: evm.icon || '/logos/eth.svg' } : null
  return pick === 'evm' ? e ?? s : s ?? e
}

/* ---------- 1Click ---------- */
/** tells 1Click about the deposit tx so it does not wait for its own scan */
export const ocSubmit = (txHash: string, depositAddress: string) =>
  fetch(`${ONECLICK}/v0/deposit/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ txHash, depositAddress }) }).catch(() => {})

/* ---------- the deposit itself, sent from the connected wallet ---------- */
async function solRpc<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch('/api/solrpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  const j = (await r.json().catch(() => ({}))) as { result?: T; error?: { message?: string } }
  if (j.error || j.result === undefined) throw new Error(j.error?.message ?? `Solana RPC ${r.status}`)
  return j.result
}
const EVM_RPC: Record<number, string> = { 1: 'https://ethereum-rpc.publicnode.com', 8453: 'https://mainnet.base.org', 42161: 'https://arb1.arbitrum.io/rpc', 56: 'https://bsc-dataseed.binance.org' }
async function toEvmChain(p: Eth, chain: IxChain) {
  const c = IX_CHAINS[chain], id = '0x' + c.evm!.toString(16)
  try { await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: id }] }) }
  catch (e) {
    if ((e as { code?: number })?.code !== 4902) throw e
        await p.request({ method: 'wallet_addEthereumChain', params: [{ chainId: id, chainName: c.name, nativeCurrency: { name: c.coin, symbol: c.coin, decimals: 18 }, rpcUrls: [EVM_RPC[c.evm!]] }] })
  }
}
/** sends `raw` of the chain's coin to the 1Click deposit address; returns the tx id */
export async function sendDeposit(w: IxWallet, chain: IxChain, to: string, raw: bigint): Promise<string> {
  if (w.kind === 'evm') {
    if (!evm) throw new Error('Connect your EVM wallet again')
    await toEvmChain(evm.provider, chain)
    return (await evm.provider.request({ method: 'eth_sendTransaction', params: [{ from: w.addr, to, value: '0x' + raw.toString(16) }] })) as string
  }
  const p = getSolWallet(); if (!p) throw new Error('Connect your Solana wallet again')
  const web3 = await import('@solana/web3.js') // ~100 KB, only once someone deposits
  const from = new web3.PublicKey(w.addr)
  const tx = new web3.Transaction().add(web3.SystemProgram.transfer({ fromPubkey: from, toPubkey: new web3.PublicKey(to), lamports: raw }))
  tx.feePayer = from
  tx.recentBlockhash = (await solRpc<{ value: { blockhash: string } }>('getLatestBlockhash', [{ commitment: 'confirmed' }])).value.blockhash
  const signed = await p.signTransaction(tx)
  return solRpc<string>('sendTransaction', [b64(signed.serialize()), { encoding: 'base64', preflightCommitment: 'confirmed', maxRetries: 5 }])
}
