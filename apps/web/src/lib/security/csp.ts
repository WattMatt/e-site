/**
 * Content-Security-Policy, built in one tested place.
 *
 * `frame-src` is the load-bearing directive for in-app document previews: PDFs
 * render inside an <iframe> (equipment-materials DocumentPreviewModal, the GCR
 * report viewer, inspection certificate pages, the public share page). The
 * policy MUST therefore permit the iframe sources we actually use, or every
 * preview opens to a blank frame with no error. Setting it to 'none' silently
 * blanks every preview — see csp.test.ts, which guards against exactly that.
 */
export function buildContentSecurityPolicy({ dev }: { dev: boolean }): string {
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

  const directives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://app.posthog.com https://js.sentry-cdn.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.supabase.co https://avatars.githubusercontent.com",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.powersync.co wss://*.powersync.co https://app.posthog.com https://ingest.sentry.io https://api.paystack.co",
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
