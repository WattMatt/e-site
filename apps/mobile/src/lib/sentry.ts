/**
 * Mobile Sentry initialisation. Mirrors apps/web/src/lib/sentry.ts.
 *
 * Requires `@sentry/react-native` (see docs/t061-observability-runbook.md for
 * the install command). When the package or DSN is missing, init() and
 * captureError() are silent no-ops so unit tests and dev without keys still
 * work. expo-application / expo-device / expo-localization populate context
 * tags so a stack trace tells us "Pixel 8 / Android 14 / en-ZA / build 47"
 * without us shipping a custom diagnostic payload.
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

    // Best-effort context enrichment. Each Expo package is wrapped so a single
    // missing module never aborts init.
    void enrichContext(Sentry)
  } catch (err) {
    // @sentry/react-native not installed — silent no-op.
    if (__DEV__) console.warn('[sentry] package not installed, skipping init')
  }
}

async function enrichContext(Sentry: any) {
  try {
    const Application = await import('expo-application' as any)
    Sentry.setTag?.('app.version', Application.nativeApplicationVersion ?? 'unknown')
    Sentry.setTag?.('app.build', Application.nativeBuildVersion ?? 'unknown')
  } catch {
    /* expo-application missing — skip */
  }
  try {
    const Device = await import('expo-device' as any)
    Sentry.setContext?.('device', {
      model: Device.modelName,
      manufacturer: Device.manufacturer,
      os_name: Device.osName,
      os_version: Device.osVersion,
      device_type: Device.deviceType,
    })
  } catch {
    /* expo-device missing — skip */
  }
  try {
    const Localization = await import('expo-localization' as any)
    const locale = Localization.getLocales?.()?.[0]
    Sentry.setTag?.('locale', locale?.languageTag ?? 'unknown')
    Sentry.setTag?.('region', locale?.regionCode ?? 'unknown')
    Sentry.setTag?.('timezone', Localization.getCalendars?.()?.[0]?.timeZone ?? 'unknown')
  } catch {
    /* expo-localization missing — skip */
  }
}

export function captureError(err: unknown, context?: Record<string, unknown>) {
  const S = (globalThis as any).__SENTRY__
  if (S?.captureException) S.captureException(err, { extra: context })
}
