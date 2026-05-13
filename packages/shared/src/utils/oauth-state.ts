/**
 * OAuth state-token signer/verifier — used to round-trip user/org context
 * through provider redirects without exposing it to the user-controlled
 * URL bar. Signed with HMAC-SHA256 over the base64url-encoded JSON payload;
 * verifies with timing-safe comparison and expiry check.
 *
 * Uses Web Crypto, so it works in both Node (server actions) and Deno (edge
 * functions). Secret comes from env var OAUTH_STATE_SECRET — must be at
 * least 32 ASCII characters.
 */

const STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes — enough for the OAuth round-trip

export type OAuthProvider = 'dropbox' | 'google_drive' | 'onedrive' | 'dropbox_team'

export interface OAuthStatePayload {
  /** auth.uid() of the user who initiated the OAuth flow. */
  uid: string
  /** organisation_id the connection will be filed under. */
  orgId: string
  /** Which provider this state belongs to. */
  provider: OAuthProvider
  /** Random nonce — defends against replay if the secret leaks briefly. */
  nonce: string
  /** Expiry as ms-since-epoch. */
  exp: number
}

declare const Deno: { env: { get: (n: string) => string | undefined } } | undefined
declare const process: { env: Record<string, string | undefined> } | undefined

function getSecret(): string {
  let s: string | undefined
  if (typeof process !== 'undefined' && process?.env) s = process.env.OAUTH_STATE_SECRET
  if (!s && typeof Deno !== 'undefined' && Deno?.env) s = Deno.env.get('OAUTH_STATE_SECRET')
  if (!s || s.length < 32) {
    throw new Error('OAUTH_STATE_SECRET env var must be set (>= 32 chars)')
  }
  return s
}

/**
 * Sign a state token. Returns `<base64url-payload>.<base64url-signature>`.
 * The caller passes the user/org/provider context; nonce + exp are added.
 */
export async function signOAuthState(
  ctx: Pick<OAuthStatePayload, 'uid' | 'orgId' | 'provider'>,
  /** For testing — overrides env-based secret + clock. */
  opts: { secret?: string; now?: number } = {},
): Promise<string> {
  const secret = opts.secret ?? getSecret()
  if (secret.length < 32) {
    throw new Error('OAUTH_STATE_SECRET must be at least 32 chars')
  }
  const now = opts.now ?? Date.now()
  const payload: OAuthStatePayload = {
    uid: ctx.uid,
    orgId: ctx.orgId,
    provider: ctx.provider,
    nonce: randomNonce(),
    exp: now + STATE_TTL_MS,
  }
  const b64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)))
  const sig = await hmacSha256(secret, b64)
  return `${b64}.${sig}`
}

/**
 * Verify a state token. Returns the decoded payload on success; throws on:
 *   - malformed token (wrong number of parts, bad base64)
 *   - signature mismatch
 *   - expiry in the past
 *
 * Note: the caller MUST also assert `payload.provider` matches the
 * provider that the redirect callback came from. Otherwise a state signed
 * for Dropbox could be replayed in a Google callback.
 */
export async function verifyOAuthState(
  state: string,
  opts: { secret?: string; now?: number; expectedProvider?: OAuthProvider } = {},
): Promise<OAuthStatePayload> {
  const secret = opts.secret ?? getSecret()
  const now = opts.now ?? Date.now()
  const parts = state.split('.')
  if (parts.length !== 2) throw new Error('oauth state: malformed (expected 2 parts)')
  const [b64, sig] = parts as [string, string]
  const expected = await hmacSha256(secret, b64)
  if (!timingSafeEqual(sig, expected)) {
    throw new Error('oauth state: signature mismatch')
  }
  let payload: OAuthStatePayload
  try {
    const decoded = new TextDecoder().decode(base64UrlDecode(b64))
    payload = JSON.parse(decoded) as OAuthStatePayload
  } catch {
    throw new Error('oauth state: payload decode failed')
  }
  if (typeof payload.exp !== 'number' || payload.exp < now) {
    throw new Error('oauth state: expired')
  }
  if (opts.expectedProvider && payload.provider !== opts.expectedProvider) {
    throw new Error(
      `oauth state: provider mismatch (expected ${opts.expectedProvider}, got ${payload.provider})`,
    )
  }
  return payload
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function hmacSha256(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret) as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data) as BufferSource)
  return base64UrlEncode(new Uint8Array(sig))
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return base64UrlEncode(bytes)
}

function base64UrlEncode(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i]!)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(s: string): Uint8Array {
  let b = s.replace(/-/g, '+').replace(/_/g, '/')
  while (b.length % 4) b += '='
  const binary = atob(b)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}
