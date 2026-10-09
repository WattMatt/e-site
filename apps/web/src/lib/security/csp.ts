import { posthogHosts, type PostHogHosts } from '../analytics/posthog-hosts'
import { sentryIngestOrigin as defaultSentryIngestOrigin } from '../sentry-hosts'

/**
 * Content-Security-Policy, built in one tested place.
 *
 * `frame-src` is the load-bearing directive for in-app document previews: PDFs
 * render inside an <iframe> (equipment-materials DocumentPreviewModal, the GCR
 * report viewer, inspection certificate pages, the public share page). The
 * policy MUST therefore permit the iframe sources we actually use, or every
 * preview opens to a blank frame with no error. Setting it to 'none' silently
 * blanks every preview — see csp.test.ts, which guards against exactly that.
 *
 * PostHog origins come from the same resolver the browser client initialises
 * with (lib/analytics/posthog-hosts.ts), so the policy cannot drift from the
 * hosts posthog-js actually calls: events + flags on the api host, remote
 * config (fetch) and extension scripts (<script>) on the assets host.
 *
 * The Sentry ingest origin comes from the DSN (lib/sentry-hosts.ts), so the
 * policy allows exactly the regional host the browser SDK posts to, and no
 * Sentry host when no DSN is configured.
 */
export function buildContentSecurityPolicy({
  dev,
  posthog = posthogHosts,
  sentryIngestOrigin = defaultSentryIngestOrigin,
}: {
  dev: boolean
  posthog?: PostHogHosts
  sentryIngestOrigin?: string | null
}): string {
  // Sources the preview <iframe>s load: same-origin (streaming + draft-preview
  // routes), Supabase signed URLs (stored docs), and blob: URLs. In development
  // the local Supabase stack is http on 127.0.0.1/localhost, so allow that too
  // — without weakening production — so previews are testable locally.
  const frameSrc = [
    "'self'",
    'https://*.supabase.co',
    'blob:',
    ...(dev ? ['http://127.0.0.1:*', 'http://localhost:*'] : []),
  ].join(' ')

  const posthogConnectSrc = [...new Set([posthog.apiHost, posthog.assetsHost])].join(' ')

  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${posthog.assetsHost} https://js.sentry-cdn.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.supabase.co https://avatars.githubusercontent.com",
    "font-src 'self' data:",
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.powersync.co wss://*.powersync.co ${posthogConnectSrc}${sentryIngestOrigin ? ` ${sentryIngestOrigin}` : ''} https://api.paystack.co https://tiles.openfreemap.org`,
    // MapLibre (the /tariffs/map area-of-supply map) spawns its tile worker from a blob: URL.
    "worker-src 'self' blob:",
    `frame-src ${frameSrc}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // upgrade-insecure-requests rewrites http→https, which would break the local
    // http Supabase preview — apply it everywhere except development.
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ]

  return directives.join('; ')
}
