/**
 * Where to send a payer once Paystack hands them back.
 *
 * Every Paystack purchase route passes the same `callback_url`
 * (`/api/paystack/callback`), and the callback used to destructure
 * `{ org_id, tier }` and bail to `/settings/billing?error=meta` unless both
 * were present. `feature_unlock`, `feature_seat` and `mv_subscription`
 * metadata carry no `tier` (and mv carries no `org_id`), so EVERY
 * non-subscription purchase — R250, R1,999, R2,000 — dumped the customer who
 * had just paid on an unrelated page with no confirmation. That is also the
 * realistic driver of a second charge for something already owned.
 *
 * ⚠ SECURITY. `return_to` is written into Paystack transaction metadata and
 * comes back in the `transaction/verify` response body. The callback feeds it
 * to `new URL(value, req.url)`, and `new URL('//evil.test', 'https://x/y')`
 * resolves to `https://evil.test` — so an unvalidated value is an open
 * redirect on an authenticated endpoint. Validate at BOTH ends: at initialize
 * time so garbage never reaches Paystack, and again on the way back, because
 * the metadata that returns is not necessarily the metadata that was sent.
 */

import type { FeatureKey } from '@esite/shared'

export const DEFAULT_RETURN_TO = '/settings/billing'

const MAX_LENGTH = 512

/** Characters URL parsers strip or normalise before deciding what a scheme is. */
// eslint-disable-next-line no-control-regex
const CONTROL_OR_BACKSLASH = /[\u0000-\u001f\u007f\\]/

/**
 * Reduce an arbitrary value to a same-origin absolute path, or the fallback.
 *
 * Accepts ONLY a string beginning with exactly one `/` and containing no
 * control characters or backslashes. Everything else — protocol-relative
 * (`//host`), absolute (`https://host`), scheme-ish (`javascript:`),
 * backslash variants, bare relative paths, non-strings — becomes the fallback.
 */
export function safeReturnTo(value: unknown, fallback: string = DEFAULT_RETURN_TO): string {
  const safeFallback = isSafePath(fallback) ? fallback : DEFAULT_RETURN_TO
  return isSafePath(value) ? value : safeFallback
}

function isSafePath(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length === 0 || value.length > MAX_LENGTH) return false
  if (CONTROL_OR_BACKSLASH.test(value)) return false
  // Exactly one leading slash: `/x` yes, `//host` and `///host` no.
  if (value[0] !== '/' || value[1] === '/') return false
  return true
}

/**
 * Default landing path per paid feature. Before this existed, every
 * feature-unlock checkout hardcoded `cancel_action` to `/inspections/unlock`,
 * so a JBCC buyer who cancelled was sent to the Inspections paywall — a page
 * about a module they were not buying.
 *
 * JBCC, generator cost-recovery and Solar are project-scoped (`/projects/[id]/…`),
 * so there is no org-level landing page for them; the calling route knows the
 * project and should pass an explicit `return_to` (Solar: solarReturnTo).
 * These are the fallbacks for when it does not.
 */
export function returnToForFeature(featureKey: FeatureKey | string): string {
  switch (featureKey) {
    case 'inspections':
      return '/inspections'
    case 'jbcc':
    case 'generator_cost_recovery':
    case 'solar':
    default:
      return DEFAULT_RETURN_TO
  }
}

/**
 * The project's Solar locked page (Phase 1C). It sits OUTSIDE the gated Solar
 * route group, so it renders for an org that does not (yet) hold Solar. This
 * is where a Solar checkout that is cancelled returns. The id is URI-encoded
 * and the result validated, so even a hostile id cannot leave the origin (the
 * subscribe route also requires a uuid).
 */
export function solarLockedPath(projectId: string): string {
  return safeReturnTo(`/projects/${encodeURIComponent(projectId)}/solar/locked`)
}

/**
 * Where a Solar subscriber returns after Paystack: the locked page of the
 * project they pressed Subscribe on, flagged `payment=received`. The org is
 * bought org-wide (D-01), but the payer started on one project and must see
 * it unlock there. The webhook may land a second or two after the payer does,
 * so the locked page — not the gated Solar page, which would bounce them back
 * to the paywall — shows "activating Solar…" and polls (spec §1.2).
 */
export function solarReturnTo(projectId: string): string {
  return safeReturnTo(`${solarLockedPath(projectId)}?payment=received`)
}
