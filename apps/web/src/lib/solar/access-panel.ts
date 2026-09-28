import 'server-only'
/**
 * Data for /solar/access (spec §1.3). Returns null unless the caller is a
 * grantor (solar_is_grantor). Identities (other members' org roles, names)
 * are read with the service client AFTER that gate — user_organisations and
 * profiles are own-row-only under RLS (the pattern in
 * apps/web/src/actions/project-members.actions.ts:96-125). Grants, requests,
 * sibling projects and the subscription are read through the caller's own
 * session, so RLS still scopes them.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isSolarAccessLevel, SOLAR_EXCLUDED_ROLES } from '@esite/shared'
import type {
  AccessPanelData, AccessPanelMember, AccessPanelRequest, AccessPanelSubscribeRequest,
} from './access-panel-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

const EXCLUDED = SOLAR_EXCLUDED_ROLES as readonly string[]

export async function loadSolarAccessPanel(projectId: string): Promise<AccessPanelData | null> {
  const supabase = (await createClient()) as unknown as AnyClient
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: isGrantor } = await supabase.rpc('solar_is_grantor', { p_project_id: projectId })
  if (isGrantor !== true) return null
  const { data: project } = await supabase.schema('projects').from('projects')
    .select('id, name, organisation_id').eq('id', projectId).maybeSingle()
  if (!project) return null
  const orgId = project.organisation_id as string
  const svc = createServiceClient() as unknown as AnyClient

  const [pmRes, orgRes, grantsRes, reqRes, projRes, subRes, subReqRes, orgSubRes] = await Promise.all([
    svc.schema('projects').from('project_members').select('user_id, role, organisation_id')
      .eq('project_id', projectId).eq('is_active', true),
    svc.from('user_organisations').select('user_id, role').eq('organisation_id', orgId).eq('is_active', true),
    supabase.schema('solar').from('project_access').select('user_id, level, granted_by, granted_at, updated_at')
      .eq('project_id', projectId),
    supabase.schema('solar').from('access_requests').select('id, requester_id, requested_level, note, created_at')
      .eq('project_id', projectId).eq('kind', 'access').eq('status', 'pending').order('created_at'),
    supabase.schema('projects').from('projects').select('id, name')
      .eq('organisation_id', orgId).neq('id', projectId).order('name'),
    supabase.schema('billing').from('org_addon_subscriptions').select('status, current_period_end')
      .eq('organisation_id', orgId).eq('feature_key', 'solar').maybeSingle(),
    // Owner default 3: subscribe requests are org-wide (one subscription covers
    // every project), so list those raised from ANY project of the org. RLS
    // (requester or solar_is_grantor(project)) scopes this to the caller's org.
    supabase.schema('solar').from('access_requests').select('id, project_id, requester_id, note, created_at')
      .eq('organisation_id', orgId).eq('kind', 'subscribe').eq('status', 'pending').order('created_at'),
    supabase.rpc('org_has_solar', { p_org_id: orgId }),
  ])

  const orgRole = new Map<string, string>(((orgRes.data ?? []) as Row[]).map((r) => [r.user_id as string, r.role as string]))
  const entries = new Map<string, { role: string; external: boolean; implicit: boolean }>()
  for (const [uid, role] of orgRole) {
    if (role === 'owner' || role === 'admin') entries.set(uid, { role, external: false, implicit: true })
    else if (role === 'project_manager') entries.set(uid, { role, external: false, implicit: false })
  }
  for (const r of (pmRes.data ?? []) as Row[]) {
    const uid = r.user_id as string
    if (entries.has(uid)) continue
    const own = orgRole.get(uid)
    const role = r.role as string
    if (EXCLUDED.includes(role) || (own !== undefined && EXCLUDED.includes(own))) continue
    entries.set(uid, { role, external: own === undefined, implicit: false })
  }

  const grants = new Map<string, Row>(((grantsRes.data ?? []) as Row[]).map((g) => [g.user_id as string, g]))
  const requests = (reqRes.data ?? []) as Row[]
  const subRequests = (subReqRes.data ?? []) as Row[]
  const ids = new Set<string>([
    ...entries.keys(),
    ...requests.map((r) => r.requester_id as string),
    ...subRequests.map((r) => r.requester_id as string),
    ...[...grants.values()].map((g) => g.granted_by as string | null).filter((v): v is string => Boolean(v)),
  ])
  const { data: profiles } = ids.size
    ? await svc.from('profiles').select('id, full_name, email').in('id', [...ids])
    : { data: [] as Row[] }
  const prof = new Map<string, Row>(((profiles ?? []) as Row[]).map((p) => [p.id as string, p]))
  const nameOf = (id: string): string =>
    (prof.get(id)?.full_name as string | null)?.trim() || (prof.get(id)?.email as string | null) || 'Unknown user'

  const members: AccessPanelMember[] = [...entries].map(([uid, e]) => {
    const g = grants.get(uid)
    return {
      userId: uid,
      name: nameOf(uid),
      email: (prof.get(uid)?.email as string | null) ?? null,
      role: e.role,
      external: e.external,
      implicit: e.implicit,
      level: e.implicit ? 'edit_financials' : g && isSolarAccessLevel(g.level) ? g.level : null,
      grantedByName: g?.granted_by ? nameOf(g.granted_by as string) : null,
      grantedAt: (g?.granted_at as string | undefined) ?? null,
      updatedAt: (g?.updated_at as string | undefined) ?? null,
    }
  }).sort((a, b) => Number(b.implicit) - Number(a.implicit) || a.name.localeCompare(b.name))

  const reqs: AccessPanelRequest[] = requests.map((r) => ({
    id: r.id as string,
    requesterId: r.requester_id as string,
    requesterName: nameOf(r.requester_id as string),
    requestedLevel: isSolarAccessLevel(r.requested_level) ? r.requested_level : null,
    maxLevel: orgRole.has(r.requester_id as string) ? 'edit_financials' : 'view',
    note: (r.note as string | null) ?? null,
    createdAt: r.created_at as string,
  }))

  const otherProjects = ((projRes.data ?? []) as Row[]).map((p) => ({ id: p.id as string, name: p.name as string }))
  const projectNames = new Map<string, string>([[projectId, project.name as string], ...otherProjects.map((p) => [p.id, p.name] as [string, string])])
  const subscribeRequests: AccessPanelSubscribeRequest[] = subRequests.map((r) => ({
    id: r.id as string,
    requesterName: nameOf(r.requester_id as string),
    projectName: projectNames.get(r.project_id as string) ?? 'another project',
    note: (r.note as string | null) ?? null,
    createdAt: r.created_at as string,
  }))

  const sub = subRes.data as Row | null
  return {
    projectId,
    projectName: project.name as string,
    organisationId: orgId,
    members,
    requests: reqs,
    otherProjects,
    subscription: sub ? { status: sub.status as string, currentPeriodEnd: (sub.current_period_end as string | null) ?? null } : null,
    subscribeRequests,
    orgSubscribed: !orgSubRes.error && orgSubRes.data === true,
  }
}
