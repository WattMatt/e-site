import 'server-only'
/**
 * Gather everything resolveSolarEntry needs, from the caller's own session.
 * Every read is something the caller is allowed to see (own org membership,
 * own requests, SECURITY DEFINER helpers that answer only for the caller).
 * Fails closed: an RPC error counts as "no".
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { isSolarAccessLevel, resolveSolarEntry, type SolarEntryState } from '@esite/shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export interface SolarEntryContext {
  projectId: string
  projectName: string
  organisationId: string
  userId: string
  state: SolarEntryState
}

interface PendingRow { project_id: string; kind: string; created_at: string }

export async function loadSolarEntry(projectId: string, supabase?: AnyClient): Promise<SolarEntryContext | null> {
  const client = supabase ?? ((await createClient()) as unknown as AnyClient)
  const { data: { user } } = await client.auth.getUser()
  if (!user) return null

  const { data: project } = await client
    .schema('projects').from('projects')
    .select('id, name, organisation_id')
    .eq('id', projectId)
    .maybeSingle()
  if (!project) return null
  const organisationId = project.organisation_id as string

  const [roleRes, levelRes, grantorRes, memberRes, pendingRes] = await Promise.all([
    client.rpc('user_effective_project_role', { p_project_id: projectId, p_user_id: user.id }),
    client.rpc('solar_access_level', { p_project_id: projectId }),
    client.rpc('solar_is_grantor', { p_project_id: projectId }),
    client.from('user_organisations').select('organisation_id')
      .eq('user_id', user.id).eq('organisation_id', organisationId).eq('is_active', true).limit(1),
    client.schema('solar').from('access_requests').select('project_id, kind, created_at')
      .eq('requester_id', user.id).eq('organisation_id', organisationId).eq('status', 'pending'),
  ])

  const isOwnOrgMember = Array.isArray(memberRes.data) && memberRes.data.length > 0
  // org_has_solar is false for non-members of the org; asking it for an
  // external member would read "unsubscribed" when the truth is "unknown".
  const subRes = isOwnOrgMember
    ? await client.rpc('org_has_solar', { p_org_id: organisationId })
    : { data: false, error: null }
  const pending = (pendingRes.data ?? []) as PendingRow[]

  const state = resolveSolarEntry({
    effectiveRole: roleRes.error ? null : ((roleRes.data as string | null) ?? null),
    level: !levelRes.error && isSolarAccessLevel(levelRes.data) ? levelRes.data : null,
    isGrantor: !grantorRes.error && grantorRes.data === true,
    isOwnOrgMember,
    orgSubscribed: !subRes.error && subRes.data === true,
    pendingAccessRequestAt: pending.find((r) => r.kind === 'access' && r.project_id === projectId)?.created_at ?? null,
    pendingSubscribeRequestAt: pending.find((r) => r.kind === 'subscribe')?.created_at ?? null,
  })

  return { projectId, projectName: project.name as string, organisationId, userId: user.id, state }
}
