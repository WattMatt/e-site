/**
 * The Sentry ingest origin, derived from the DSN in one place so the
 * Content-Security-Policy cannot disagree with where the browser SDK posts.
 *
 * A DSN is `https://<public key>@<ingest host>/<project id>` and the browser
 * SDK sends envelopes to `https://<ingest host>/api/<project id>/envelope/`.
 * E-Site's project is in Sentry's DE region (`o<org>.ingest.de.sentry.io`).
 * Until 2026-10-07 the CSP hard-coded `https://ingest.sentry.io`, which matches
 * no regional org host, so every browser event was refused and client-side
 * error reporting was silently dead in production.
 *
 * Returns null when there is no usable DSN: lib/sentry.ts does not start the
 * browser SDK without one, so the CSP should allow no Sentry host at all.
 */
export function resolveSentryIngestOrigin(dsn: string | undefined): string | null {
  const raw = (dsn ?? '').trim()
  if (!raw || /\s/.test(raw)) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || !url.hostname) return null
    // `origin` drops the userinfo (the DSN public key) and the project path.
    return url.origin
  } catch {
    return null
  }
}

/** The origin this build posts to (NEXT_PUBLIC_ vars are inlined at build time). */
export const sentryIngestOrigin = resolveSentryIngestOrigin(process.env.NEXT_PUBLIC_SENTRY_DSN)
