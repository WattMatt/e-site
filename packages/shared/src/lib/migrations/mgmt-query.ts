// packages/shared/src/lib/migrations/mgmt-query.ts
//
// The read-only Supabase Management API query client the @verify CLI uses
// (scripts/verify-migration-applied.ts).
//
// Why it retries: Deploy DB Migrations run 37289583207 (2026-10-05, 00228)
// reported "✗ 543 verification failure(s) across 40 migration(s)" — and EVERY
// one was `Management API 429: ThrottlerException: Too Many Requests` while two
// other deploys verified at the same time. No predicate was false; 00228 itself
// verified 14/14. A throttled API has not answered the question, so it must
// never be recorded as a ✗ directive.
//
// So: 429, 5xx and network failures are retried with exponential backoff and
// equal jitter, honouring Retry-After. If the API is still refusing after the
// last attempt, or the token itself is rejected (401/403), the call throws a
// ManagementApiUnavailableError — an INFRASTRUCTURE error the CLI reports
// separately. Anything else (a 400 carrying a SQL error, a 200 carrying an
// error object) is the database answering and stays an ordinary Error, which
// runDirectives records as a failure of that directive.
//
// Like verify-header.ts this module has NO imports and no ambient I/O — fetch,
// sleep and random are injected — so it is safe to load from the package
// barrel and from `node --experimental-strip-types` alike (hence plain class
// fields, no TS-only syntax).

export type MgmtQueryFn = (sql: string) => Promise<Array<Record<string, unknown>>>

/**
 * The Management API could not be asked: throttled or failing past the retry
 * budget, unreachable, or refusing the token. NOT a predicate result.
 */
export class ManagementApiUnavailableError extends Error {
  /** Brand read by isInfrastructureError — survives a duplicated module copy. */
  infrastructure = true
  /** Last HTTP status seen, or null when the request never got a response. */
  status: number | null
  attempts: number

  constructor(message: string, status: number | null, attempts: number) {
    super(message)
    this.name = 'ManagementApiUnavailableError'
    this.status = status
    this.attempts = attempts
  }
}

export function isInfrastructureError(e: unknown): e is ManagementApiUnavailableError {
  return typeof e === 'object' && e !== null && (e as { infrastructure?: unknown }).infrastructure === true
}

/** Longest Retry-After we will honour; a larger value is capped, not obeyed. */
const MAX_RETRY_AFTER_MS = 60_000

/** Retry-After as milliseconds: delta-seconds or an HTTP-date. Null if absent or unreadable. */
export function parseRetryAfterMs(header: string | null, nowMs: number): number | null {
  if (header === null) return null
  const v = header.trim()
  let ms: number
  if (/^\d+(\.\d+)?$/.test(v)) ms = Number(v) * 1000
  else {
    const at = Date.parse(v)
    if (Number.isNaN(at)) return null
    ms = at - nowMs
  }
  return Math.min(Math.max(0, Math.round(ms)), MAX_RETRY_AFTER_MS)
}

/**
 * Delay before retry number `attempt` (1-based). Exponential, capped, with
 * EQUAL jitter (half fixed, half random) so concurrent verifiers de-synchronise
 * without ever retrying near-instantly. Never shorter than Retry-After.
 */
export function retryDelayMs(o: {
  attempt: number
  retryAfterMs: number | null
  baseDelayMs: number
  maxDelayMs: number
  random: () => number
}): number {
  const step = Math.min(o.maxDelayMs, o.baseDelayMs * 2 ** (o.attempt - 1))
  const jittered = Math.round(step / 2 + o.random() * (step / 2))
  return Math.max(jittered, o.retryAfterMs ?? 0)
}

const RETRYABLE = new Set([429, 500, 502, 503, 504])
const TOKEN_REJECTED = new Set([401, 403])

export interface ReadOnlyMgmtQueryOptions {
  projectRef: string
  /** Resolved per request, never logged. */
  token: () => string
  fetch: typeof globalThis.fetch
  sleep: (ms: number) => Promise<void>
  random?: () => number
  now?: () => number
  /** Total attempts including the first. Default 8 (≈45–90 s of waiting at worst). */
  maxAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  onRetry?: (info: { attempt: number; status: number | null; delayMs: number; detail: string }) => void
}

/**
 * A query function that posts one statement and returns its rows.
 *
 * READ ONLY BY CONSTRUCTION: the `BEGIN READ ONLY; … COMMIT;` wrapper is
 * applied here, not at call sites, so no caller can route around it. A `sql:`
 * directive's payload is interpolated verbatim out of a migration file, and
 * Postgres refuses any write inside such a transaction (SQLSTATE 25006). The
 * endpoint returns the LAST result-producing statement's rows, so the trailing
 * COMMIT does not swallow the SELECT.
 */
export function createReadOnlyMgmtQuery(o: ReadOnlyMgmtQueryOptions): MgmtQueryFn {
  const maxAttempts = o.maxAttempts ?? 8
  const baseDelayMs = o.baseDelayMs ?? 1000
  const maxDelayMs = o.maxDelayMs ?? 30_000
  const random = o.random ?? Math.random
  const now = o.now ?? Date.now
  const url = `https://api.supabase.com/v1/projects/${o.projectRef}/database/query`

  return async (sql: string) => {
    const body = JSON.stringify({ query: `BEGIN READ ONLY;\n${sql};\nCOMMIT;` })
    let lastStatus: number | null = null
    let lastDetail = ''

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let res: Response
      try {
        res = await o.fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${o.token()}`, 'Content-Type': 'application/json' },
          body,
        })
      } catch (e) {
        lastStatus = null
        lastDetail = `network error: ${e instanceof Error ? e.message : String(e)}`
        if (attempt < maxAttempts) {
          const delayMs = retryDelayMs({ attempt, retryAfterMs: null, baseDelayMs, maxDelayMs, random })
          o.onRetry?.({ attempt, status: null, delayMs, detail: lastDetail })
          await o.sleep(delayMs)
        }
        continue
      }

      const text = await res.text()
      if (res.ok) {
        const parsed = JSON.parse(text)
        // A 200 can still carry an error object rather than a row array.
        if (!Array.isArray(parsed)) throw new Error(`Unexpected response: ${text.slice(0, 300)}`)
        return parsed
      }

      if (TOKEN_REJECTED.has(res.status)) {
        throw new ManagementApiUnavailableError(
          `Management API ${res.status} — the access token was rejected: ${text.slice(0, 300)}`,
          res.status,
          attempt,
        )
      }
      // Not throttling, not a server fault: the database answered (typically a
      // 400 carrying a SQL error). That is a result for this directive.
      if (!RETRYABLE.has(res.status)) throw new Error(`Management API ${res.status}: ${text.slice(0, 300)}`)

      lastStatus = res.status
      lastDetail = text.slice(0, 300)
      if (attempt < maxAttempts) {
        const retryAfterMs = parseRetryAfterMs(res.headers.get('Retry-After'), now())
        const delayMs = retryDelayMs({ attempt, retryAfterMs, baseDelayMs, maxDelayMs, random })
        o.onRetry?.({ attempt, status: res.status, delayMs, detail: lastDetail })
        await o.sleep(delayMs)
      }
    }

    throw new ManagementApiUnavailableError(
      `Management API ${lastStatus ?? 'unreachable'} after ${maxAttempts} attempts: ${lastDetail}`,
      lastStatus,
      maxAttempts,
    )
  }
}
