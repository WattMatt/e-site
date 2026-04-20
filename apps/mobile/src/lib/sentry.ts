/**
 * Mobile Sentry initialisation. Mirrors apps/web/src/lib/sentry.ts.
 *
 * Requires `@sentry/react-native` (see docs/t061-observability-runbook.md for
 * the install command). When the package or DSN is missing, init() and
 * captureError() are silent no-ops so unit tests and dev without keys still
 * work.
 */

let sentryLoaded = false

export async function initSentry() {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN
  if (!dsn || sentryLoaded) return
  sentryLoaded = true

  try {
    const Sentry = await import('@sentry/react-native' as any)
    Sentry.init({
      dsn,
      environment: __DEV__ ? 'development' : 'production',
      tracesSampleRate: __DEV__ ? 1.0 : 0.2,
      enableAutoSessionTracking: true,
      attachStacktrace: true,
      // Scrub auth tokens from URL breadcrumbs.
      beforeSend(event: any) {
        if (event.breadcrumbs) {
          event.breadcrumbs = event.breadcrumbs.map((bc: any) => {
            if (bc.data?.url && typeof bc.data.url === 'string') {
              bc.data.url = bc.data.url
                .replace(/access_token=[^&]+/, 'access_token=REDACTED')
                .replace(/token=[^&]+/, 'token=REDACTED')
            }
            return bc
          })
        }
        return event
      },
    })
    ;(globalThis as any).__SENTRY__ = Sentry
  } catch (err) {
    // @sentry/react-native not installed — silent no-op.
    if (__DEV__) console.warn('[sentry] package not installed, skipping init')
  }
}

export function captureError(err: unknown, context?: Record<string, unknown>) {
  const S = (globalThis as any).__SENTRY__
  if (S?.captureException) S.captureException(err, { extra: context })
}
