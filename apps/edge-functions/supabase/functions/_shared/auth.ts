/**
 * Edge Function auth helpers.
 *
 * Supabase gateway verifies the JWT signature before routing to functions.
 * Here we decode the (already-verified) payload to check the `role` claim —
 * no need to verify again.
 */

/** Returns the JWT role claim from the Authorization header, or null on error. */
export function getJwtRole(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null
  try {
    const payload = JSON.parse(atob(authHeader.slice(7).split('.')[1]))
    return typeof payload.role === 'string' ? payload.role : null
  } catch {
    return null
  }
}

/** Returns a 403 Response if the caller doesn't have the service_role JWT. */
export function requireServiceRole(req: Request): Response | null {
  const role = getJwtRole(req.headers.get('Authorization'))
  if (role === 'service_role') return null
  return new Response(JSON.stringify({ error: 'Forbidden — service_role required' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  })
}
