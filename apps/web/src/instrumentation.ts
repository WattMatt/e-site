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

const REQUIRED_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const

function validateEnv() {
  const missing = REQUIRED_ENV.filter(k => !process.env[k])
  if (missing.length > 0) {
    throw new Error(
      `[E-Site] Missing required environment variables:\n${missing.map(k => `  - ${k}`).join('\n')}\nSet these in Vercel dashboard or .env.local and restart.`
    )
  }
}

export async function register() {
  // Only initialise Sentry when a DSN is explicitly configured.
  // Skipping this when DSN is absent (local dev) prevents a startup hang
  // caused by the @sentry/nextjs dynamic import in dev mode.
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
  if (!dsn) {
    if (process.env.NEXT_RUNTIME === 'nodejs') validateEnv()
    return
  }

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    validateEnv()
    // webpackIgnore: true — prevents webpack from bundling @sentry/nextjs at
    // compile time. Without this, webpack tries to statically analyse the entire
    // Sentry package tree, which causes instrumentation compilation to hang.
    const Sentry = await import(/* webpackIgnore: true */ '@sentry/nextjs')
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? 'production',
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      sampleRate: 1.0,
      includeLocalVariables: true,
      integrations: [Sentry.httpIntegration()],
      tracesSampler(ctx) {
        const name = ctx.name ?? ''
        if (name.includes('/_next/') || name.includes('/favicon')) return 0
        if (name.includes('/api/health')) return 0
        return process.env.NODE_ENV === 'production' ? 0.1 : 1.0
      },
      beforeSend(event) {
        if (event.breadcrumbs?.values) {
          const bcs = event.breadcrumbs.values as unknown as any[]
          ;(event.breadcrumbs as any).values = bcs.map((bc: any) => {
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
    const Sentry = await import(/* webpackIgnore: true */ '@sentry/nextjs')
    Sentry.init({ dsn, environment: process.env.NODE_ENV ?? 'production', tracesSampleRate: 0.05 })
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
  const Sentry = await import(/* webpackIgnore: true */ '@sentry/nextjs')
  Sentry.captureException(err, {
    tags: {
      path: request.path,
      method: request.method,
      routePath: context.routePath,
      renderSource: context.renderSource,
    },
  })
}
