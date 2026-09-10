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
 * The timestamp check BOUNDS the replay window to five minutes — it does not
 * stop replay, and nothing in this file does. Within those five minutes a
 * captured request replays byte-for-byte and verifies, correctly: it IS a
 * genuine Resend request. What makes the replay a no-op is the UNIQUE
 * constraint on `email_events.webhook_id` (migration 00185), keyed on the
 * `svix-id` this file authenticates. Any caller that stops de-duplicating on
 * that column loses replay protection entirely.
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
 *
 * Null means "this request is not signed at all", which is a different incident
 * from "signed wrongly" — so a present-but-blank header counts as absent. The
 * returned values are deliberately NOT trimmed: `id` and `timestamp` go into
 * the signed string verbatim, so normalising them here would break verification
 * against whatever the sender actually hashed.
 */
export function readSvixHeaders(get: (name: string) => string | null): SvixHeaders | null {
  const id = get('svix-id') ?? get('webhook-id')
  const timestamp = get('svix-timestamp') ?? get('webhook-timestamp')
  const signature = get('svix-signature') ?? get('webhook-signature')
  if (!id?.trim() || !timestamp?.trim() || !signature?.trim()) return null
  return { id, timestamp, signature }
}

/**
 * Contract: returns FALSE for every invalid input — a missing, empty or
 * undecodable secret, an absent, malformed or wrong-length signature, a
 * non-numeric or stale timestamp — and NEVER throws.
 *
 * That is a security property, not tidiness. This is the only gate on a public
 * unauthenticated endpoint, and such handlers are routinely wrapped in
 * `try/catch -> 200` so a provider stops retrying; inside one of those, a throw
 * IS the bypass. `secret: string` also type-checks a
 * `process.env.RESEND_WEBHOOK_SECRET!` that is undefined at runtime, so the
 * missing-input cases are reachable from correct-looking calling code.
 */
export function verifySvixSignature(opts: {
  secret: string
  body: string
  headers: SvixHeaders
  /** Injectable for tests; production always uses the real clock. */
  now?: number
}): boolean {
  const { secret, body, headers } = opts
  const now = opts.now ?? Date.now()

  // Guard first: everything below dereferences these.
  if (!secret || !headers?.signature) return false

  // A NaN timestamp must be rejected, not merely compared: `Math.abs(NaN) > x`
  // is false, so without this line a non-numeric timestamp SKIPS the freshness
  // check below and drops the replay window altogether.
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
