/**
 * Edge Function auth helpers.
 *
 * These service-to-service functions are deployed with `--no-verify-jwt`, so the
 * Supabase gateway does NOT verify the bearer token's signature before routing.
 * We therefore CANNOT trust a decoded `role` claim — a base64 payload is trivial
 * to forge. Instead we prove the caller holds the service-role secret by
 * comparing the bearer token, in constant time, against SUPABASE_SERVICE_ROLE_KEY
 * (auto-injected into every function). Every legitimate service caller already
 * sends this exact key. Fail-closed: a missing key env or token → 403.
 */

/** Constant-time string equality (avoids leaking the key via compare timing). */
function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ab = enc.encode(a)
  const bb = enc.encode(b)
  // Fold length difference into the accumulator so unequal lengths never match,
  // and loop over the longer of the two so timing doesn't reveal the length.
  let diff = ab.length ^ bb.length
  const len = Math.max(ab.length, bb.length)
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0)
  }
  return diff === 0
}

/** True if the request bears the project's service-role key. */
export function hasServiceRole(req: Request): boolean {
  const authHeader = req.headers.get('Authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!token || !serviceKey) return false
  return constantTimeEqual(token, serviceKey)
}

/** Returns a 403 Response if the caller doesn't present the service-role key. */
export function requireServiceRole(req: Request): Response | null {
  if (hasServiceRole(req)) return null
  return new Response(JSON.stringify({ error: 'Forbidden — service_role required' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  })
}
