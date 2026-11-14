import { useCallback } from 'react'
import { ApiError, apiPost } from '../data/api'
import { useWallet } from './wallet'
import { errText } from './errors'

/**
 * Posting a thesis needs a session: the wallet signs one NEP-413 message (no transaction, no fee), the
 * server checks it against a full access key of the account and hands back a session good for 30 days.
 * Kept per account in this browser only.
 */
type Signer = (p: { message: string; recipient: string; nonce: Uint8Array }) => Promise<{ accountId: string; publicKey: string; signature: string }>
const KEY = (a: string) => `nearly-social:${a}`
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))

const mem = new Map<string, { session: string; exp: number }>()
export function getSession(account: string): string | null {
  const m = mem.get(account); if (m && m.exp > Date.now() + 60_000) return m.session
  try {
    const j = JSON.parse(localStorage.getItem(KEY(account)) || 'null') as { session: string; exp: number } | null
    return j && j.exp > Date.now() + 60_000 ? j.session : null
  } catch { return null }
}
export function dropSession(account: string) { mem.delete(account); try { localStorage.removeItem(KEY(account)) } catch { /* private window */ } }

export async function socialSignIn(account: string, signMessage: Signer, why = 'Sign in to post theses.'): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(32))
  const message = `nearly.trade\n${why}\nAccount: ${account}\nIssued: ${new Date().toISOString()}`
  const s = await signMessage({ message, recipient: 'nearly.trade', nonce })
  const r = await apiPost<{ session: string; exp: number }>('/api/social/session', { accountId: account, publicKey: s.publicKey, signature: s.signature, message, nonce: b64(nonce) })
  mem.set(account, r)
  try { localStorage.setItem(KEY(account), JSON.stringify(r)) } catch { /* private window: works for this page only */ }
  return r.session
}

// ── one hook for every signed post (chat, theses, creator links): a session in hand, or one signature to get it ──────
// `why` is the line the wallet shows; the server reads only the Account and Issued lines.
export function useSocialSession(why?: string) {
  const { accountId, signMessage } = useWallet()
  const withSession = useCallback(async <T,>(fn: (s: string) => Promise<T>): Promise<T> => {
    if (!accountId) throw new Error('Connect a wallet first')
    const s = getSession(accountId) || await socialSignIn(accountId, signMessage, why)
    try { return await fn(s) } catch (e) {
      if (e instanceof ApiError && e.status === 401 && e.body.signin) { dropSession(accountId); return fn(await socialSignIn(accountId, signMessage, why)) }
      throw e
    }
  }, [accountId, signMessage, why])
  return { withSession, signedIn: accountId ? !!getSession(accountId) : false }
}
export const friendlyError = (e: unknown) => {
  // wallets throw plain objects and
  // contract panics arrive inside the outcome; errText digs out the one line that says what went wrong, in plain words
  const m = errText(e, 'Something went wrong. Nothing was sent.')
  if (/cannot sign messages/i.test(m)) return 'This wallet cannot sign messages. Use HOT, Meteor, Intear or MyNearWallet.'
  if (/reject|cancel|closed|denied|user/i.test(m)) return 'Signing cancelled.'
  return m
}
