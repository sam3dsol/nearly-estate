export const yoctoToNear = (y: string | bigint | number): number => Number(BigInt(String(y)) / 10n ** 12n) / 1e12
export const nearToYocto = (n: number): string => {
  const [i, f = ''] = n.toFixed(24).split('.')
  return (BigInt(i) * 10n ** 24n + BigInt(f.padEnd(24, '0').slice(0, 24))).toString()
}
export const rawToToken = (r: string | bigint, dec = 18): number => Number(BigInt(String(r)) / 10n ** BigInt(Math.max(dec - 12, 0))) / 10 ** Math.min(dec, 12)
export const tokenToRaw = (t: number, dec = 18): string => {
  const [i, f = ''] = t.toFixed(dec).split('.')
  return (BigInt(i) * 10n ** BigInt(dec) + BigInt(f.padEnd(dec, '0').slice(0, dec))).toString()
}

export function compact(n: number, digits = 2): string {
  if (!isFinite(n)) return '–'
  const a = Math.abs(n)
  if (a >= 1e9) return (n / 1e9).toFixed(digits) + 'B'
  if (a >= 1e6) return (n / 1e6).toFixed(digits) + 'M'
  if (a >= 1e3) return (n / 1e3).toFixed(digits) + 'K'
  if (a >= 1) return n.toFixed(digits)
  if (a === 0) return '0'
  return plain3(n)
}
/** 3 significant digits as a plain decimal: 7.22e-7 → 0.000000722, never an exponent. */
function plain3(n: number): string {
  const p = Number(n.toPrecision(3))
  return p.toFixed(Math.min(100, Math.max(0, 2 - Math.floor(Math.log10(Math.abs(p))))))
}
/** USD with sub-cent digits kept: right for a per-token price ($0.00000472). Money amounts use usdAmt. */
export function usd(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '–'
  // a loss reads -$5.00, not $-5.00 (the thresholds below only handle positives)
  if (n < 0) return '-' + usd(-n)
  // thresholds sit just under each unit so a figure that rounds up prints in the next one ($999,960 is $1.00M, not $1000.0K)
  if (n >= 999_995e6) return '$' + (n / 1e12).toFixed(2) + 'T'
  if (n >= 999_995e3) return '$' + (n / 1e9).toFixed(2) + 'B'
  if (n >= 999_950) return '$' + (n / 1e6).toFixed(2) + 'M'
  if (n >= 999.95) return '$' + (n / 1e3).toFixed(1) + 'K'
  if (n >= 1) return '$' + n.toFixed(2)
  if (n === 0) return '$0'
  return '$' + plain3(n)
}
/** A money amount (trade size, volume, fees, a balance), never a per-token price: a dust amount reads <$0.01,
 *  not $0 or a 6 decimal debug print. Exactly 0 stays $0. From $1 up it is the same as usd(). */
export function usdAmt(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '–'
  if (n === 0) return '$0'
  if (n < 0) return '-' + usdAmt(-n)
  if (n < 0.01) return '<$0.01'
  if (n < 1) return '$' + n.toFixed(2)
  return usd(n)
}
/** Money for a headline slot: a real figure, never a debug print like $0.0182. */
export function usdHead(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '–'
  if (n > 0 && n < 0.01) return '<$0.01'
  if (n < 1000) return `$${n.toFixed(2)}`
  return usd(n)
}

export function sci(n: number): string {
  if (n === 0) return '0'
  if (n >= 0.01) return n.toFixed(4)
  // 0.0000123 -> 0.0₄123 style
  const s = n.toExponential(3) // 1.230e-7
  const [m, e] = s.split('e')
  const zeros = -Number(e) - 1
  const sub = String(zeros).replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[Number(d)])
  return `0.0${sub}${m.replace('.', '').slice(0, 4)}`
}
export function timeAgo(ms: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ms) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`
  const h = Math.floor(m / 60); if (h < 48) return `${h}h`
  return `${Math.floor(h / 24)}d`
}
export const short = (id: string, n = 6) => (id.length > n * 2 + 3 ? `${id.slice(0, n)}…${id.slice(-n)}` : id)
/** An account as people read it: a named account (nearlytrade.near, alice.tg) in full, only the long hex ones cut
 *  (64-hex implicit → 9705014b…5baa, EVM 0x… → 0x13f577…49fc). short() cut every id, so nearlytrade.near read "nearly…e.near". */
export const acct = (id: string) => (/^[0-9a-f]{64}$/.test(id) ? `${id.slice(0, 8)}…${id.slice(-4)}` : /^0x[0-9a-f]{40}$/i.test(id) ? `${id.slice(0, 8)}…${id.slice(-4)}` : id)
export const pct = (t: number, d = 1) => `${(t * 100).toFixed(d)}%`
