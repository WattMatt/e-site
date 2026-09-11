/**
 * Edge Function auth helpers.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE DEPLOYING ANY FUNCTION THAT IMPORTS `requireServiceRole`
 * ─────────────────────────────────────────────────────────────────────────────
 * `requireServiceRole` DECODES the `role` claim. It does NOT verify a
 * signature. That is safe only because the Supabase gateway verifies the JWT
 * before routing — and the gateway only does that when the function is deployed
 * with `verify_jwt = true`.
 *
 * Deploy such a function with `--no-verify-jwt` and this helper becomes
 * decoration: a base64 payload is not a proof of anything, so anyone on the
 * internet can send
 *
 *     Authorization: Bearer <b64 header>.<b64 {"role":"service_role"}>.anything
 *
 * and pass the gate with no credential at all.
 *
 * This is not hypothetical. On 2026-09-11 three deployed functions were found
 * in exactly that state — `send-notification`, `payment-recovery-check` and
 * `calculate-health-scores` — each reachable with a self-made token. Proven
 * live, non-destructively, by sending an unsigned token whose role was
 * deliberately NOT service_role and observing the HANDLER's own 403 rather than
 * the gateway's 401: the handler answering at all is the proof that nothing
 * verified the signature. All three were flipped to `verify_jwt = true`, and
 * the same probe then returned the gateway's 401.
 *
 * ⚠ The rule, because the old comment here is what made the bug invisible:
 *   the comment used to state the gateway verifies the signature as a flat
 *   fact, with no mention that a deploy flag decides it. Anyone reading the
 *   helper concluded it was safe everywhere. It is safe only where the flag
 *   says so, and the flag lives in a deploy command, not in this file.
 *
 * So: a function importing `requireServiceRole` MUST be deployed WITHOUT
 * `--no-verify-jwt`. `assertGatewayVerifiesJwt` below exists so that rule is
 * checkable by a test instead of remembered.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOT COMPARE AGAINST SUPABASE_SERVICE_ROLE_KEY INSTEAD
 * ─────────────────────────────────────────────────────────────────────────────
 * A constant-time compare against the runtime key looks like the stronger fix,
 * and it is the one an open PR proposed. It would have broken production.
 *
 * The edge runtime injects `SUPABASE_SERVICE_ROLE_KEY` in the new
 * `sb_secret_…` format, which is not a JWT (first observed 2026-07-23, when a
 * function-to-function call 403'd on its very first cron tick). Every one of
 * the eight pg_cron jobs, and the web app on Vercel, authenticate with the
 * LEGACY `eyJ…` service-role JWT instead. Those two strings are not equal, so
 * an equality check would have rejected all eight scheduled jobs — health
 * scores, four onboarding mails, re-engagement, payment recovery and cloud
 * sync — while looking like a security improvement.
 *
 * The legacy JWT is HS256, signed with a secret this runtime is never given,
 * so a function cannot verify it locally either. The gateway can, and does.
 * Hence: let the gateway verify, and make that dependency explicit here.
 */

/** Shape of a caller's credential, for diagnostics and for the flag check. */
export type CredentialShape = 'jwt' | 'opaque-secret' | 'absent'

/** Classify the bearer credential WITHOUT revealing any part of its value. */
export function credentialShape(authHeader: string | null): CredentialShape {
  if (!authHeader?.startsWith('Bearer ')) return 'absent'
  const token = authHeader.slice(7)
  if (!token) return 'absent'
  return token.split('.').length === 3 ? 'jwt' : 'opaque-secret'
}

/**
 * Returns the JWT role claim from the Authorization header, or null.
 *
 * ⚠ The signature is NOT checked here — see the header of this file. The claim
 * is trustworthy only when the gateway has already verified the token, i.e.
 * when the function is deployed with verify_jwt = true.
 */
export function getJwtRole(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null
  const parts = authHeader.slice(7).split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload.role === 'string' ? payload.role : null
  } catch {
    return null
  }
}

/**
 * Returns a 403 Response if the caller is not service_role, else null.
 *
 * Trust model: the gateway has verified the signature (verify_jwt = true).
 * Deploying the calling function with --no-verify-jwt voids that and makes this
 * gate forgeable. See the file header.
 */
export function requireServiceRole(req: Request): Response | null {
  const role = getJwtRole(req.headers.get('Authorization'))
  if (role === 'service_role') return null
  return new Response(JSON.stringify({ error: 'Forbidden — service_role required' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * The list of functions whose only authorisation is a decoded role claim, and
 * which therefore MUST be deployed with gateway JWT verification enabled.
 *
 * This exists to be asserted against the deploy workflow by a test, so that
 * adding `--no-verify-jwt` to one of these re-opens the hole LOUDLY, at review
 * time, instead of silently in production.
 *
 * Keep it in sync when a function starts or stops importing requireServiceRole.
 */
export const FUNCTIONS_REQUIRING_GATEWAY_JWT: readonly string[] = [
  'calculate-health-scores',
  'cloud-sync-cron',
  'cloud-sync-project',
  'compliance-complete',
  'conversion-prompt',
  'eft-invoice',
  'onboarding-email-d0',
  'onboarding-email-d1',
  'onboarding-email-d14',
  'onboarding-email-d3',
  'onboarding-email-d7',
  'payment-recovery-check',
  'reengagement-check',
  'send-email',
  'send-notification',
]

/**
 * Throws if `slug` is one of the above and the deploy command disables gateway
 * verification. Intended for build/CI assertions, not for request handling.
 */
export function assertGatewayVerifiesJwt(slug: string, deployCommand: string): void {
  if (!FUNCTIONS_REQUIRING_GATEWAY_JWT.includes(slug)) return
  if (/--no-verify-jwt/.test(deployCommand)) {
    throw new Error(
      `${slug} authorises callers by decoding a JWT role claim, so it must be deployed ` +
      `with gateway JWT verification. Deploying it --no-verify-jwt makes that gate ` +
      `forgeable by any unauthenticated caller.`,
    )
  }
}
