// apps/web/src/lib/auth/require-project-access.ts
import type { SupabaseClient } from '@supabase/supabase-js'

export type ProjectAccessResult = { ok: true } | { ok: false; status: 404; error: string }

/**
 * Site-scoped access gate for code that then uses the SERVICE client.
 * Pass the caller's SESSION client: the check runs as them.
 * Returns a result object, never a boolean — test `.ok`, not truthiness
 * (role-gate-call-sites.contract.test.ts).
 */
export async function requireProjectAccess(sessionClient: SupabaseClient, projectId: string): Promise<ProjectAccessResult> {
  const denied: ProjectAccessResult = { ok: false, status: 404, error: 'Project not found' }
  if (!projectId) return denied
  const { data, error } = await sessionClient.rpc('user_has_project_access', { _project_id: projectId })
  return !error && data === true ? { ok: true } : denied
}
