/**
 * T-061: Next.js Instrumentation hook — server-side Sentry init
 *
 * This file is loaded once when the Next.js server starts.
 * It initialises Sentry for:
 *   - Edge runtime (middleware)
 *   - Node.js runtime (server components, route handlers, server actions)
 *
 * Alert thresholds:
 *   - Error rate > 10 errors/hour → Sentry alert rule (configured in Sentry UI)
 *   - See docs/security-audit.md for deployment checklist.
 *
 * Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const Sentry = await import('@sentry/nextjs')
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.NODE_ENV ?? 'production',
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      // Capture 100% of errors, only sample traces
      sampleRate: 1.0,
      // Attach request data to server-side errors
      includeLocalVariables: true,
      integrations: [
        // Instrument Supabase fetch calls in server components
        Sentry.httpIntegration({ tracing: true }),
      ],
      // Performance: ignore Next.js internal routes in traces
      tracesSampler(ctx) {
        const name = ctx.name ?? ''
        if (name.includes('/_next/') || name.includes('/favicon')) return 0
        if (name.includes('/api/health')) return 0  // skip health check noise
        return process.env.NODE_ENV === 'production' ? 0.1 : 1.0
      },
      // Before sending an event, scrub sensitive fields
      beforeSend(event) {
        // Strip any accidentally captured auth tokens from breadcrumbs
        if (event.breadcrumbs?.values) {
          event.breadcrumbs.values = event.breadcrumbs.values.map(bc => {
            if (bc.data?.url && typeof bc.data.url === 'string') {
              bc.data.url = bc.data.url.replace(/access_token=[^&]+/, 'access_token=REDACTED')
              bc.data.url = bc.data.url.replace(/token=[^&]+/, 'token=REDACTED')
            }
            return bc
          })
        }
        return event
      },
    })
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    const Sentry = await import('@sentry/nextjs')
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.NODE_ENV ?? 'production',
      tracesSampleRate: 0.05,
    })
  }
}

/**
 * onRequestError: Next.js 15 built-in error capture hook.
 * Called for unhandled errors in Server Components and Route Handlers.
 */
export const onRequestError = async (
  err: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; renderSource: string }
) => {
  const Sentry = await import('@sentry/nextjs')
  Sentry.captureException(err, {
    tags: {
      path: request.path,
      method: request.method,
      routePath: context.routePath,
      renderSource: context.renderSource,
    },
  })
}
