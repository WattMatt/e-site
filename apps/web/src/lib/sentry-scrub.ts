/**
 * Redaction for everything handed to Sentry, browser and server alike.
 *
 * /legal/privacy tells users Sentry receives "IP address, stack traces, and
 * limited request metadata". Auth flows put bearer secrets in URLs, and the
 * SDK copies URLs into events verbatim (@sentry/* 8.55.1):
 *   - request.url = location.href, query AND fragment (browser HttpContext);
 *   - request.headers.Referer = document.referrer;
 *   - transaction = location.pathname (Next app-router pageload/navigation);
 *   - breadcrumbs data.from / data.to (history) and data.url (fetch/xhr);
 *   - http.client span description "GET <url>" and data url / http.url.
 * The secrets: /auth/callback?token_hash=… and ?code=…, the #access_token= /
 * #refresh_token= recovery fragment, ?email= on reset-password, signed
 * Storage URLs (?token=<jwt>), and bearer links whose secret IS a path
 * segment: /auth/wa-link/<token>, /tender/invite/<token>, /proposal/<token>.
 *
 * Rather than list fields, scrubEvent walks every string in the event, so a
 * field the SDK adds later is covered too. The patterns only touch
 * token-shaped text, so stack traces and messages survive intact.
 */

const SECRET_PARAMS = [
  'access_token',
  'refresh_token',
  'provider_token',
  'provider_refresh_token',
  'id_token',
  'token',
  'token_hash',
  'code',
  'state',
  'otp',
  'password',
  'secret',
  'signature',
  'sig',
  'email',
].join('|')

// A param starts the string or follows ? & # ; (or their %-encoded forms, for
// a URL carried inside another URL's ?next=). Its value runs to the next
// separator, encoded or not.
const PARAM = new RegExp(
  `(^|[?&#;]|%3F|%26|%23)(${SECRET_PARAMS})(=|%3D)((?:(?!%26|%23)[^&#;\\s"'<>])*)`,
  'gi',
)

// Bearer links whose secret is the path segment itself. A segment already
// written as a route pattern — [token] or %5Btoken%5D in a chunk URL in a
// stack frame — is left alone, so source maps still resolve.
const SLASH = '(?:/|%2F)'
const SECRET_PATH = new RegExp(
  `(${SLASH}(?:auth${SLASH}wa-link|tender${SLASH}invite|proposal)${SLASH})(?!\\[|%5B)((?:(?!%2F|%3F|%23)[^/?#&\\s"'<>])+)`,
  'gi',
)

export const REDACTED = 'REDACTED'

/** Redacts secret query/fragment params and bearer path segments in any string. */
export function redactUrl(value: string): string {
  return value
    .replace(PARAM, (_m, sep: string, key: string, eq: string) => `${sep}${key}${eq}${REDACTED}`)
    .replace(SECRET_PATH, (_m, prefix: string) => `${prefix}[token]`)
}

const MAX_DEPTH = 20

// Never serialised: the SDK strips it before sending. It holds live Scope and
// Span instances, which must not be walked or rewritten.
const SKIP_KEYS = new Set(['sdkProcessingMetadata'])

function isPlainObject(value: object): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function scrubValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactUrl(value)
  if (value === null || typeof value !== 'object' || depth > MAX_DEPTH) return value
  if (seen.has(value)) return value
  seen.add(value)
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = scrubValue(value[i], depth + 1, seen)
    return value
  }
  if (!isPlainObject(value)) return value
  for (const key of Object.keys(value)) {
    if (!SKIP_KEYS.has(key)) value[key] = scrubValue(value[key], depth + 1, seen)
  }
  return value
}

const SECRET_KEY = new RegExp(`^(${SECRET_PARAMS})$`, 'i')

// Sentry's QueryParams is a string, a { key: value } object or [key, value]
// tuples. The string form is covered by redactUrl; the other two split key
// from value, so the value has to be redacted by its key.
function scrubQueryParams(query: unknown): void {
  if (Array.isArray(query)) {
    for (const pair of query) {
      if (Array.isArray(pair) && typeof pair[0] === 'string' && SECRET_KEY.test(pair[0])) pair[1] = REDACTED
    }
  } else if (query && typeof query === 'object') {
    const record = query as Record<string, unknown>
    for (const key of Object.keys(record)) if (SECRET_KEY.test(key)) record[key] = REDACTED
  }
}

/** beforeSend / beforeSendTransaction: redacts in place and returns the event. */
export function scrubEvent<T>(event: T): T {
  const request = (event as { request?: { query_string?: unknown } } | null)?.request
  if (request) scrubQueryParams(request.query_string)
  return scrubValue(event, 0, new WeakSet()) as T
}

/** beforeBreadcrumb: redacts in place and returns the breadcrumb. */
export function scrubBreadcrumb<T>(breadcrumb: T): T {
  return scrubValue(breadcrumb, 0, new WeakSet()) as T
}
