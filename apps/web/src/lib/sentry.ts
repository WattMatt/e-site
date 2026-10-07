/**
 * Sentry initialisation.
 * Call initSentry() once in app/layout.tsx (client) or instrumentation.ts (server).
 * Lightweight stub — only initialises when NEXT_PUBLIC_SENTRY_DSN is set.
 */

let sentryLoaded = false

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

  // Expose for ErrorBoundary componentDidCatch
  ;(window as any).__SENTRY__ = Sentry
}

export function captureError(err: unknown, context?: Record<string, unknown>) {
  if (typeof window !== 'undefined' && (window as any).__SENTRY__) {
    ;(window as any).__SENTRY__.captureException(err, { extra: context })
  }
}
