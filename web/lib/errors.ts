/** Wallets throw plain objects as often as Errors, and a contract panic arrives buried in the execution outcome.
 *  `String(e)` on those printed "[object Object]" in the buy box: dig out the one line that says what went wrong. */
export function errText(x: unknown, fallback = 'Transaction failed'): string {
  const seen = new Set<unknown>()
  const dig = (v: unknown, depth = 0): string | null => {
    if (v == null || depth > 6 || seen.has(v)) return null
    if (typeof v === 'string') return v.includes('panicked') || v.includes('deposit') || v.length < 300 ? v || null : null
    if (typeof v !== 'object') return null
    seen.add(v)
    const o = v as Record<string, unknown>
    for (const k of ['ExecutionError', 'error_message', 'message', 'kind', 'Failure', 'status', 'error']) {
      const hit = dig(o[k], depth + 1)
      if (hit) return hit
    }
    for (const val of Object.values(o)) { const hit = dig(val, depth + 1); if (hit) return hit }
    return null
  }
  const m = (dig(x) ?? fallback).replace(/^Smart contract panicked:\s*/, '')
  if (m === '[object Object]') return fallback
  if (/NotEnoughBalance|LackBalanceForState|insufficient|not enough (balance|funds)|exceeds.*balance/i.test(m)) return `Not enough NEAR left for gas. Keep about ${GAS_RESERVE} NEAR in your wallet and try again.`
  // the chain's own words, in plain English
  if (/E204|min.?out|slippage|output.*less than/i.test(m)) return 'Not filled: the price moved past your slippage before it landed. Nothing was swapped. Raise slippage a little and try again.'
  if (/Exceeded the prepaid gas|GasLimitExceeded|out of gas/i.test(m)) return 'The network ran out of gas on this one. Nothing was swapped. Try again.'
  if (/InvalidNonce|nonce/i.test(m)) return 'Your wallet sent two transactions at once and the network kept the first. Check your balance, then try again.'
  if (/Expired|timed? ?out|timeout/i.test(m)) return 'The network did not answer in time. Check your balance before trying again: it may still have landed.'
  if (/AccountDoesNotExist|UNKNOWN_ACCOUNT|does not exist/i.test(m)) return 'That account does not exist on NEAR. Check the name.'
  if (/storage|not registered|Register the account/i.test(m)) return 'Your wallet is not set up for this token yet. Tap again: the first tap sets it up, the second trades.'
  return m
}

/** a rejected, closed or blocked wallet window: the same words cover all three in most wallets */
export const isRejected = (m: string) => /reject|cancel|closed|denied/i.test(m)

/** NEAR kept back for gas and one-time registrations when a MAX button or a balance check sizes a trade */
export const GAS_RESERVE = 0.1

/** NEAR a wallet can actually spend: view_account's amount minus what its storage locks (1e19 yocto per byte) */
export function spendableYocto(acc: { amount: string; storage_usage?: number } | null): bigint {
  if (!acc) return 0n
  const free = BigInt(acc.amount) - BigInt(acc.storage_usage ?? 0) * 10n ** 19n
  return free > 0n ? free : 0n
}
