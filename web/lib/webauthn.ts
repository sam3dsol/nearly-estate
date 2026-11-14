/** Raw WebAuthn (no library): the JSON shapes @simplewebauthn uses, which the Agent API and our BFF expect.
 *  Registration makes the passkey that owns an agent account; authentication signs each owner intent (webauthn standard). */
const b64u = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0))

type Cred = PublicKeyCredential & { response: AuthenticatorAttestationResponse & AuthenticatorAssertionResponse }
const descriptors = (l?: { id: string; type: string; transports?: string[] }[]) => (l ?? []).map((c) => ({ ...c, id: unb64u(c.id) })) as PublicKeyCredentialDescriptor[]

export const hasPasskeys = () => typeof window !== 'undefined' && !!window.PublicKeyCredential

/** options = what the BFF's /passkey/options returned (challenge and user.id are base64url) */
export async function register(options: Record<string, any>) {
  const pk = { ...options, challenge: unb64u(options.challenge), user: { ...options.user, id: unb64u(options.user.id) }, excludeCredentials: descriptors(options.excludeCredentials) } as unknown as PublicKeyCredentialCreationOptions
  const c = (await navigator.credentials.create({ publicKey: pk })) as Cred | null
  if (!c) throw new Error('passkey_prompt_closed')
  const r = c.response
  return {
    id: c.id, rawId: b64u(c.rawId), type: c.type,
    response: { clientDataJSON: b64u(r.clientDataJSON), attestationObject: b64u(r.attestationObject), transports: r.getTransports?.() ?? [] },
    clientExtensionResults: c.getClientExtensionResults(), authenticatorAttachment: (c as any).authenticatorAttachment ?? undefined,
  }
}

/** options = intent.payload of a webauthn intent from the Agent API (challenge and allowCredentials[].id are base64url) */
export async function authenticate(options: Record<string, any>) {
  const pk = { ...options, challenge: unb64u(options.challenge), allowCredentials: descriptors(options.allowCredentials) } as unknown as PublicKeyCredentialRequestOptions
  const c = (await navigator.credentials.get({ publicKey: pk })) as Cred | null
  if (!c) throw new Error('passkey_prompt_closed')
  const r = c.response
  return {
    id: c.id, rawId: b64u(c.rawId), type: c.type,
    response: { clientDataJSON: b64u(r.clientDataJSON), authenticatorData: b64u(r.authenticatorData), signature: b64u(r.signature), userHandle: r.userHandle ? b64u(r.userHandle) : undefined },
    clientExtensionResults: c.getClientExtensionResults(), authenticatorAttachment: (c as any).authenticatorAttachment ?? undefined,
  }
}
