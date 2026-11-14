/** Nearly Agents client: talks to the agents BFF (server.mjs) and signs owner intents with whatever owns the agent:
 *  a NEAR wallet (nep366 to create, nep413 after) or a passkey (webauthn). The BFF holds the Agent API key and the grant. */
import { API } from '../data/api'
import { authenticate } from './webauthn'
import { ONECLICK } from './oneclick'
import { IX_CHAINS, ocSubmit, sendDeposit, type IxChain, type IxWallet } from './ix'

export const AGENTS_KEY = 'nearly.agent'
/** lab override: localStorage nearly.agent.api = http://127.0.0.1:8821 (the BFF through a tunnel) */
// estate.nearly.trade: same origin (data/api.ts sets API to '' there); an absolute nearly.trade URL failed cross-origin
const ESTATE = typeof location !== 'undefined' && location.hostname.startsWith('estate.')
const AGENTS_API = (import.meta.env.VITE_AGENTS_API as string | undefined) ?? (ESTATE ? '/api/agents' : `${API || 'https://nearly.trade'}/api/agents`)
export const base = () => { try { return localStorage.getItem('nearly.agent.api') || AGENTS_API } catch { return AGENTS_API } }

export type Owner = { type: 'near'; account_id: string; public_key: string } | { type: 'passkey'; credential_id: string; public_key: string; rp_id: string; origin: string }
// secret: this agent's key for its own routes, issued when it is made or claimed once by signing; never shared
export type Saved = { owner: Owner; agent_id?: string; name?: string; payout?: { chain: string; address: string; label: string } | null; secret?: string }
export type Intent = { correlation_id: string; agent_id?: string; type: string; intent: { standard: string; payload: any }; signer: any; preview?: any; secret?: string; token?: string }

export const load = (): Saved | null => { try { const s = localStorage.getItem(AGENTS_KEY); return s ? JSON.parse(s) : null } catch { return null } }
export const store = (s: Saved | null) => { try { s ? localStorage.setItem(AGENTS_KEY, JSON.stringify(s)) : localStorage.removeItem(AGENTS_KEY) } catch { /* private window */ } }

export async function call<T = any>(path: string, body?: unknown): Promise<T> {
  // the owner's agent key rides on every call; the backend reads it only on that agent's own routes
  const key = load()?.secret, auth: Record<string, string> = key ? { 'x-agent-key': key } : {}
  const r = await fetch(`${base()}${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify(body) } : { cache: 'no-store', headers: auth })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error === 'no_api_key' ? 'The agents backend has no API key yet' : j.message || j.error || `api ${r.status}`)
  return j as T
}

/** NEAR wallet pieces the page hands in (from useWallet) */
export type NearSigner = {
  signMessage: (p: { message: string; recipient: string; nonce: Uint8Array }) => Promise<{ accountId: string; publicKey: string; signature: string }>
  wallet: () => Promise<unknown>
}

/** one owner signature for one intent; the wallet signs the server payload unchanged, like the Agent API demo does */
export async function sign(it: Intent, near: NearSigner | null) {
  const { intent, signer } = it
  if (intent.standard === 'webauthn') return { ...intent, credential: await authenticate(intent.payload) }
  if (!near) throw new Error('Connect the NEAR wallet that owns this agent')
  if (intent.standard === 'nep413') {
    const s = await near.signMessage({ ...intent.payload, nonce: Uint8Array.from(atob(intent.payload.nonce), (c) => c.charCodeAt(0)) })
    if (signer?.account_id && s.accountId !== signer.account_id) throw new Error('Wrong NEAR account, connect ' + signer.account_id)
    return { ...intent, public_key: s.publicKey, signature: s.signature }
  }
  if (intent.standard === 'nep366') {
    const w = (await near.wallet()) as { signDelegateActions?: (p: unknown) => Promise<{ signedDelegateActions: string[] }> } | null
    if (!w?.signDelegateActions) throw new Error('This wallet cannot sign delegate actions')
    const r = await w.signDelegateActions({ delegateActions: [intent.payload], signerId: signer?.account_id, network: 'mainnet' })
    if (!r.signedDelegateActions?.[0]) throw new Error('wallet_signature_missing')
    return { ...intent, signed_delegate: r.signedDelegateActions[0] }
  }
  throw new Error(`Unsupported signing standard ${intent.standard}`)
}

/** an agent made before owner login: its owner signs one message with the NEAR wallet that owns it, and gets the agent's key */
export async function claim(agentId: string, near: NearSigner): Promise<string> {
  const it = await call<Intent>(`/${agentId}/claimstart`, {})
  const signed_data = await sign(it, near)
  const r = await call<{ secret: string }>(`/${agentId}/claim`, { token: it.token, signed_data })
  return r.secret
}

/** generate (done by the caller) -> sign -> submit -> poll until the API says SUCCESS or fails */
export async function run(it: Intent, near: NearSigner | null, onStep?: (s: string) => void) {
  onStep?.('Sign in your wallet')
  const signed_data = await sign(it, near)
  onStep?.('Sending')
  let op = await call(`/submit`, { type: it.type, correlation_id: it.correlation_id, signed_data })
  for (let i = 0; i < 40 && !['SUCCESS', 'FAILED', 'REFUSED'].includes(op.status); i++) {
    await new Promise((r) => setTimeout(r, 1500))
    op = await call(`/op/${it.correlation_id}`)
    onStep?.(op.status === 'QUEUED' || op.status === 'PENDING' ? 'Waiting for the chain' : op.status)
  }
  if (op.status !== 'SUCCESS') throw new Error(op.error?.code || op.error?.message || `${op.status}`)
  return op
}

/* ---------- funding the agent's NEAR account from a Solana or EVM wallet: coin -> 1Click -> native NEAR at that address ---------- */
export type FundQuote = { depositAddress?: string; depositMemo?: string; amountIn: string; amountInFormatted: string; amountInUsd: string; amountOutFormatted: string; amountOutUsd: string; timeEstimate: number }
/** same request the Intents box makes for "pay with SOL", with the agent's NEAR account as the recipient on chain near */
export async function fundQuote(o: { w: IxWallet; chain: IxChain; amount: string; nearAccount: string; dry: boolean }): Promise<FundQuote> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20_000)
  try {
    const r = await fetch(`${ONECLICK}/v0/quote`, { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      slippageTolerance: 100, referral: 'nearly', quoteWaitingTimeMs: o.dry ? 0 : 3000, dry: o.dry, swapType: 'EXACT_INPUT',
      originAsset: IX_CHAINS[o.chain].asset, depositType: 'ORIGIN_CHAIN', destinationAsset: 'nep141:wrap.near', amount: o.amount,
      refundTo: o.w.addr, refundType: 'ORIGIN_CHAIN', recipient: o.nearAccount, recipientType: 'DESTINATION_CHAIN', deadline: new Date(Date.now() + 60 * 60_000).toISOString(),
    }) })
    const j = (await r.json().catch(() => ({}))) as { quote?: FundQuote; message?: string }
    if (!r.ok || !j.quote) throw new Error(/amount is too low/i.test(j.message ?? '') ? 'Amount too small for the bridge' : j.message || `1Click ${r.status}`)
    return j.quote
  } finally { clearTimeout(t) }
}
/** quote, send the coin from the wallet, tell 1Click. Returns the tx id; NEAR lands at the agent in about a minute. */
export async function fund(w: IxWallet, chain: IxChain, amount: string, nearAccount: string) {
  const q = await fundQuote({ w, chain, amount, nearAccount, dry: false })
  if (!q.depositAddress) throw new Error('No deposit address from 1Click')
  const tx = await sendDeposit(w, chain, q.depositAddress, BigInt(amount))
  void ocSubmit(tx, q.depositAddress)
  return { tx, q }
}

/** the one NEP-413 signature that tells us a NEAR wallet's public key (the API needs it in the owner descriptor) */
export async function nearOwner(near: NearSigner): Promise<Owner> {
  const nonce = crypto.getRandomValues(new Uint8Array(32))
  const s = await near.signMessage({ message: 'nearly.trade agents: this key will own your agent account', recipient: 'nearly.trade', nonce })
  return { type: 'near', account_id: s.accountId, public_key: s.publicKey }
}
