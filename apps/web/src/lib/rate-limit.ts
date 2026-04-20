/**
 * Best-effort in-memory rate limiter.
 *
 * Per-Vercel-instance — not globally consistent across multiple serverless
 * instances, but effective against rapid single-source abuse. Clean up entries
 * after expiry to avoid unbounded Map growth.
 */
const store = new Map<string, { count: number; reset: number }>()

/** Returns true if the request is allowed, false if it should be blocked. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || entry.reset < now) {
    store.set(key, { count: 1, reset: now + windowMs })
    // Prune stale entries periodically (every 1000 new keys)
    if (store.size > 1000) {
      for (const [k, v] of store) {
        if (v.reset < now) store.delete(k)
      }
    }
    return true
  }

  if (entry.count >= limit) return false
  entry.count++
  return true
}
