// Standalone copy of the nearly.trade app's src/lib/pool.ts for running web/ on its own, cut to what the Estate pages use:
// the transaction shape, who signed a wallet result, and its first tx hash. The launchpad's swap builders and pool reads are left out.

/* ---- transaction builders (wallet-selector shape) ---- */
type Action = { type: 'FunctionCall'; params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string } }
export type Tx = { receiverId: string; actions: Action[] }

/** The account each outcome of a wallet result really acted as. A direct tx to one of `receivers`: its signer.
 *  Relayed: a NEP-366 meta tx acts as the delegate's sender; an EVM wallet (NEP-518) is x-eth-wallet.near signing
 *  rlp_execute on the user's 0x account, so it acts as that receiver. Any other shape is skipped, never guessed. */
type OutAction = { FunctionCall?: { method_name?: string }; Delegate?: { delegate_action?: { sender_id?: string; receiver_id?: string } } }
export const signersOf = (res: unknown, receivers: string[]): string[] =>
  (Array.isArray(res) ? res : [res]).map((o) => {
    const t = (o as { transaction?: { signer_id?: string; receiver_id?: string; actions?: OutAction[] } } | null)?.transaction
    if (!t?.signer_id) return null
    const acts = Array.isArray(t.actions) ? t.actions : []
    const d = acts.find((a) => a?.Delegate)?.Delegate?.delegate_action
    if (d) return d.receiver_id && receivers.includes(d.receiver_id) ? d.sender_id ?? null : null
    if (acts.some((a) => a?.FunctionCall?.method_name === 'rlp_execute')) return t.receiver_id ?? null
    return t.receiver_id && receivers.includes(t.receiver_id) ? t.signer_id : null
  }).filter((s): s is string => !!s)

/** the first tx hash in a wallet result (a Delegate's outer hash is fine for 1Click's scan hint) */
export const hashOf = (res: unknown): string | undefined => ((Array.isArray(res) ? res[0] : res) as { transaction?: { hash?: string } } | null)?.transaction?.hash // 1Click
