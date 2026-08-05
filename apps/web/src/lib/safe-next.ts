// Post-login intended-destination guard (Onboarding Standard A7; ported from
// kit/login-safety/loginNext.ts).
//
// Only same-origin relative paths with an allow-listed prefix survive the
// login round-trip; everything else falls back to the caller's default
// (usually '/dashboard'). Prevents open-redirect via ?next=, and resolves
// dot-segments (e.g. /dashboard/../../account-deleted) via URL normalization
// so the allow-list check runs against the actual resolved path, not the raw
// string. Never use `startsWith('/')` alone and never feed a raw ?next value
// to window.location.href / router.replace.
//
// Prefixes are derived from the app's route groups:
//   (admin)       → /dashboard /projects /settings /diary /inspections /rfis
//                   /site /snags /cable-schedule /marketplace
//   (portal)      → /portal
//   (auth)        → /onboarding (the middleware's no-org gate target)
//   (marketplace) → /supplier (supplier portal; /register is a public page,
//                   never a post-login destination)
// The middleware writes ?next=<pathname> for every protected path, so this
// list must cover every signed-in shell. Update it when a new route group
// (or a new top-level segment in (admin)) ships.
const ALLOWED_PREFIXES = [
  '/dashboard',
  '/projects',
  '/settings',
  '/diary',
  '/inspections',
  '/rfis',
  '/site',
  '/snags',
  '/cable-schedule',
  '/marketplace',
  '/portal',
  '/onboarding',
  '/supplier',
]

export function safeNext(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null

  let resolved: URL
  try {
    resolved = new URL(raw, 'http://internal.invalid')
  } catch {
    return null
  }
  if (resolved.origin !== 'http://internal.invalid') return null // defense-in-depth

  const path = resolved.pathname + resolved.search // dot-segments collapsed by URL
  const ok = ALLOWED_PREFIXES.some(
    (p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`),
  )
  return ok ? path : null // return the NORMALIZED value, never raw
}
