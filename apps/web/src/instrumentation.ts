/**
 * T-061: Next.js Instrumentation hook — server-side Sentry init
 *
 * This file is loaded once when the Next.js server starts.
 * It initialises Sentry for Node.js runtime only (server components,
 * route handlers, server actions). Edge runtime (middleware) is not
 * wired up to Sentry — @sentry/nextjs is not Edge-compatible.
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
  // Edge runtime: nothing to do — Sentry is Node-only here.
  // The NEXT_RUNTIME check is compile-time eliminated by Next.js so the
  // ./lib/sentry-server import (and @sentry/nextjs) is never pulled into
  // the Edge bundle for middleware.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  validateEnv()

  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
  if (!dsn) return

  const { initServerSentry } = await import('./lib/sentry-server')
  initServerSentry(dsn)
}

/**
 * onRequestError: Next.js 15 built-in error capture hook.
 * Called for unhandled errors in Server Components and Route Handlers.
 * Edge-runtime middleware errors are not captured here.
 */
export const onRequestError = async (
  err: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; renderSource: string }
) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { captureRequestError } = await import('./lib/sentry-server')
  captureRequestError(err, request, context)
}
