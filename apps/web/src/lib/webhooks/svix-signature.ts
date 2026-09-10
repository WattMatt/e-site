import { createHmac, timingSafeEqual } from 'crypto'

/**
 * standardwebhooks / Svix signature verification.
 *
 * Resend signs every webhook with Svix: HMAC-SHA256 over `${id}.${timestamp}.${body}`
 * keyed by the base64 body of the `whsec_`-prefixed signing secret, sent as one
 * or more space-separated `v1,<base64>` values. This is the same scheme
 * auth-email-hook verifies with the standardwebhooks package
 * (apps/edge-functions/.../auth-email-hook/index.ts:22,177-180); apps/web
 * carries no such dependency and needs none for thirty lines of node:crypto.
 *
 * The timestamp check is what stops a captured-and-replayed request.
 */

export interface SvixHeaders {
  id: string
  timestamp: string
  signature: string
}

const TOLERANCE_MS = 5 * 60 * 1000
const SECRET_PREFIX = 'whsec_'

/**
 * Resend sends `svix-*`; the standardwebhooks specification names `webhook-*`.
 * Accept either — getting this wrong rejects every request with a 401 that
 * looks exactly like a wrong secret.
 */
export function readSvixHeaders(get: (name: string) => string | null): SvixHeaders | null {
  const id = get('svix-id') ?? get('webhook-id')
  const timestamp = get('svix-timestamp') ?? get('webhook-timestamp')
  const signature = get('svix-signature') ?? get('webhook-signature')
  if (!id || !timestamp || !signature) return null
  return { id, timestamp, signature }
}

export function verifySvixSignature(opts: {
  secret: string
  body: string
  headers: SvixHeaders
  /** Injectable for tests; production always uses the real clock. */
  now?: number
}): boolean {
  const { secret, body, headers } = opts
  const now = opts.now ?? Date.now()

  const seconds = Number(headers.timestamp)
  if (!Number.isFinite(seconds)) return false
  if (Math.abs(now - seconds * 1000) > TOLERANCE_MS) return false

  const raw = secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret
  const key = Buffer.from(raw, 'base64')
  if (key.length === 0) return false

  const expected = createHmac('sha256', key)
    .update(`${headers.id}.${headers.timestamp}.${body}`)
    .digest()

  // Svix sends two signatures while a secret is being rotated. Any v1 match wins.
  // Compare byte-lengths first so a malformed value cannot make timingSafeEqual throw.
  for (const part of headers.signature.split(' ')) {
    const comma = part.indexOf(',')
    if (comma < 0) continue
    if (part.slice(0, comma) !== 'v1') continue
    const provided = Buffer.from(part.slice(comma + 1), 'base64')
    if (provided.length === expected.length && timingSafeEqual(expected, provided)) return true
  }
  return false
}
