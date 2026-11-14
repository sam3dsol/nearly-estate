import { NET } from '../brand'
import { visibleRead } from './visible'

const TIMEOUT_MS = 8_000 // healthy calls take 0.2-0.4 s; covers post()'s 429 backoff (0.6+1.2 s + up to 1.2 s jitter) on the single endpoint
let cursor = 0

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/**
 * Mainnet has one endpoint (the /api/rpc proxy to the paid key), so there is nothing to fail over to:
 * a 429 from its rate limit (or a 5xx) waits and tries the same url again instead of failing the read
 * (Eddy's NEAR balance showed 0 on /stocks because one view_account got a 429).
 */
async function post(url: string, body: unknown, signal: AbortSignal) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal })
    if (r.ok) return r.json()
    // 2 retries max: the proxy's per-IP limiter counts retries too, so fast or many retries just drain the bucket
    if (i >= 2 || !(r.status === 429 || r.status >= 500)) throw new Error(`rpc ${r.status}`)
    await sleep(600 * 2 ** i + Math.random() * 600)
  }
}

/** Call a view method. A hidden tab's reads wait until it is in front again (lib/visible), the tab in front reads as before. */
export function view<T = unknown>(account: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  return visibleRead(`${account}|${method}|${JSON.stringify(args)}`, () => viewNow<T>(account, method, args))
}
/** Call a view method, rotating through RPC endpoints on failure. */
async function viewNow<T = unknown>(account: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  const argsB64 = btoa(unescape(encodeURIComponent(JSON.stringify(args))))
  const body = {
    jsonrpc: '2.0', id: 'v', method: 'query',
    params: { request_type: 'call_function', finality: 'final', account_id: account, method_name: method, args_base64: argsB64 },
  }
  let lastErr: unknown
  // Snapshot the cursor: concurrent calls that fail also move it, and reading it live let one call
  // land on the dead endpoint again and again and give up without ever trying the others.
  const start = cursor
  for (let i = 0; i < NET.rpc.length; i++) {
    const idx = (start + i) % NET.rpc.length
    const url = NET.rpc[idx]
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS)
    try {
      const j = await post(url, body, ctl.signal)
      clearTimeout(t)
      if (j.error) throw new Error(j.error?.data || j.error?.message || 'rpc error')
      const res = j.result
      if (res?.error) throw new Error(res.error)
      const bytes = new Uint8Array(res.result)
      const txt = new TextDecoder().decode(bytes)
      return JSON.parse(txt) as T
    } catch (e) {
      clearTimeout(t)
      lastErr = e
      if (cursor === idx) cursor = (idx + 1) % NET.rpc.length
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('rpc failed')
}

export function viewAccount(account: string): Promise<{ amount: string } | null> {
  return visibleRead(`account|${account}`, () => viewAccountNow(account))
}
async function viewAccountNow(account: string): Promise<{ amount: string } | null> {
  const body = { jsonrpc: '2.0', id: 'a', method: 'query', params: { request_type: 'view_account', finality: 'final', account_id: account } }
  for (const url of NET.rpc) {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), TIMEOUT_MS)
      const j = await post(url, body, ctl.signal); clearTimeout(t)
      if (j.error) return null
      return j.result
    } catch { /* next */ }
  }
  return null
}
