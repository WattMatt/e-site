/**
 * PostHog hosts, resolved in one place so the browser client and the
 * Content-Security-Policy cannot disagree.
 *
 * E-Site's PostHog project is in the EU region: /legal/privacy names the
 * European Union as where PostHog processes data. Until 2026-10-06 the client
 * defaulted to `https://eu.posthog.com` while the CSP allowed only
 * `https://app.posthog.com` (US), so every config, flags and event request the
 * browser made was refused and web analytics were silently empty.
 *
 * The mapping mirrors posthog-js's RequestRouter (lib/src/utils/request-router.js):
 * for a PostHog Cloud host, events and flags go to `<region>.i.posthog.com` and
 * the remote config plus lazily loaded extension scripts come from
 * `<region>-assets.i.posthog.com`. Any other host (a reverse proxy) serves all
 * three itself.
 */

export const DEFAULT_POSTHOG_API_HOST = 'https://eu.i.posthog.com'

export interface PostHogHosts {
  /** Passed to posthog.init as api_host: events and flags. */
  apiHost: string
  /** Passed to posthog.init as ui_host: links into the PostHog app only, never requested. */
  uiHost: string
  /** Remote config (fetch) and extension scripts (<script>). */
  assetsHost: string
}

export function resolvePostHogHosts(configured: string | undefined): PostHogHosts {
  const raw = (configured ?? '').trim().replace(/\/$/, '') || DEFAULT_POSTHOG_API_HOST
  // app.posthog.com is the legacy US alias; posthog-js rewrites it the same way.
  const host = raw === 'https://app.posthog.com' ? 'https://us.i.posthog.com' : raw

  const cloud = /^https:\/\/(us|eu)(?:\.i)?\.posthog\.com$/i.exec(host)
  if (cloud) {
    const region = cloud[1].toLowerCase()
    return {
      apiHost: `https://${region}.i.posthog.com`,
      uiHost: `https://${region}.posthog.com`,
      assetsHost: `https://${region}-assets.i.posthog.com`,
    }
  }
  return { apiHost: host, uiHost: host, assetsHost: host }
}

/** The hosts this build talks to (NEXT_PUBLIC_ vars are inlined at build time). */
export const posthogHosts = resolvePostHogHosts(process.env.NEXT_PUBLIC_POSTHOG_HOST)
