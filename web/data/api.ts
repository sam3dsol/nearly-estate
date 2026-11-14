// Standalone copy of the nearly.trade app's src/data/api.ts for running web/ on its own, cut to what the Estate pages use.
// API is empty by default, so the pages call /api/... on their own origin (`npm run dev` proxies that to nearly.trade).

export const API = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || ''
export const hasApi = () => API.length > 0

export class ApiError extends Error {
  status: number; body: Record<string, unknown>
  constructor(msg: string, status: number, body: Record<string, unknown>) { super(msg); this.status = status; this.body = body }
}
export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({})) as Record<string, unknown>
  if (!r.ok) throw new ApiError(typeof j.error === 'string' ? j.error : `api ${r.status}`, r.status, j)
  return j as T
}
