/**
 * Sentry initialisation.
 * Call initSentry() once in app/layout.tsx (client) or instrumentation.ts (server).
 * Lightweight stub — only initialises when NEXT_PUBLIC_SENTRY_DSN is set.
 */

let sentryLoaded = false
// The SDK module once initialised. Deliberately NOT on window.__SENTRY__: that
// is the SDK's own global carrier (it holds the client and scopes), and
// replacing it discarded the client so no browser event was ever sent.
let sentry: typeof import('@sentry/nextjs') | null = null

export async function initSentry() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
  if (!dsn || sentryLoaded || typeof window === 'undefined') return
  sentryLoaded = true

  // Dynamic import to keep bundle size down when DSN is not configured
  const Sentry = await import('@sentry/nextjs')
  // No Session Replay, deliberately. /legal/privacy tells users Sentry receives
  // "IP address, stack traces, and limited request metadata only"; a replay is
  // a recording of whatever is on screen (tenant names, costs, rates). Adding
  // it back is a privacy-notice change first — sentry.test.ts guards this.
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'production',
    tracesSampleRate: 0.2,
  })

  sentry = Sentry
}

/** Reports to Sentry when the browser SDK is running; a no-op otherwise. */
export function captureError(err: unknown, context?: Record<string, unknown>) {
  sentry?.captureException(err, { extra: context })
}
