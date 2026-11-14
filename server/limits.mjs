// per-address daily caps on the endpoints that cost money (a model call, a seeded market): one actor cannot use up the shared
// hourly and daily budgets for everyone. In memory, by UTC day; the global caps stay underneath.
const buckets = new Map()   // name -> { day, by: Map(ip -> n) }
export const err = (status, message) => Object.assign(new Error(message), { status })
/** a market id in a path: a non-negative integer that fits u64, leading zeros dropped ("-1", "abc"
 *  and "1.5" never reach the chain); anything else is 400, an integer past u64 is 404 like any market that does not exist */
export const marketId = (s) => { const t = String(s ?? ''); if (!/^\d{1,20}$/.test(t)) throw err(400, 'bad market id'); const n = BigInt(t); if (n > 18446744073709551615n) throw err(404, 'no market'); return n.toString() }
export function perIp(name, ip, max) {
  if (!ip) return
  const day = new Date().toISOString().slice(0, 10)
  let b = buckets.get(name); if (!b || b.day !== day) { b = { day, by: new Map() }; buckets.set(name, b) }
  const n = (b.by.get(ip) || 0) + 1
  if (n > max) throw err(429, `${max} a day from one address; more tomorrow`)
  b.by.set(ip, n)
}
export const _reset = () => buckets.clear()
