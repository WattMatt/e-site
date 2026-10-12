/**
 * Tender links carry secrets: the invitation token in the path, and a
 * single-use sign-in (k, t) plus the bidder's address (e) in the query. None
 * of it may reach analytics.
 */
const SECRET_PARAMS = ['k', 't', 'e', 'token', 'token_hash', 'code']

export function scrubUrl(url: string): string {
  try {
    const u = new URL(url, 'http://x.invalid')
    for (const p of SECRET_PARAMS) u.searchParams.delete(p)
    const path = u.pathname.replace(/^\/tender\/invite\/[^/]+/, '/tender/invite/[token]')
    const q = u.searchParams.toString()
    const rel = path + (q ? `?${q}` : '')
    return url.startsWith('http') ? `${u.origin}${rel}` : rel
  } catch {
    return url
  }
}

/** Every URL-bearing property posthog-js attaches to an event. */
export const URL_PROPS = ['$current_url', '$referrer', '$initial_referrer', '$pathname', '$initial_current_url', '$prev_pageview_pathname']
