/**
 * Server-side Sentry integration. Only imported from instrumentation.ts
 * when NEXT_RUNTIME === 'nodejs' — the import itself is gated so Next.js
 * can tree-shake it out of the Edge runtime bundle.
 */
import * as Sentry from '@sentry/nextjs'

export function initServerSentry(dsn: string) {
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

export function captureRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; renderSource: string },
) {
  Sentry.captureException(err, {
    tags: {
      path: request.path,
      method: request.method,
      routePath: context.routePath,
      renderSource: context.renderSource,
    },
  })
}
