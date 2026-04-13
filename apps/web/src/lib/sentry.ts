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
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'production',
    tracesSampleRate: 0.2,
    replaysSessionSampleRate: 0.05,
    replaysOnErrorSampleRate: 1.0,
    integrations: [
      Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }),
    ],
  })

  // Expose for ErrorBoundary componentDidCatch
  ;(window as any).__SENTRY__ = Sentry
}

export function captureError(err: unknown, context?: Record<string, unknown>) {
  if (typeof window !== 'undefined' && (window as any).__SENTRY__) {
    ;(window as any).__SENTRY__.captureException(err, { extra: context })
  }
}
