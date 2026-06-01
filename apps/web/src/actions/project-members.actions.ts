'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import { ORG_WRITE_ROLES } from '@esite/shared'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProjectMember {
  id: string
  project_id: string
  organisation_id: string
  user_id: string
  role: string
  is_active: boolean
  created_at: string
  // Joined from profiles (via user_organisations)
  full_name: string | null
  email: string | null
  // Joined org role (may differ from project role)
  org_role: string | null
}

export interface OrgMemberOption {
  user_id: string
  full_name: string | null
  email: string | null
  org_role: string
}

// ─── Schemas (internal — 'use server' files may only export async functions) ──

// project_members.role CHECK constraint: owner/admin are NOT valid in this table.
// Org-level owners/admins get implicit access via user_has_project_access() (00106).
const PROJECT_MEMBER_ROLES = [
  'project_manager',
  'contractor',
  'inspector',
  'supplier',
  'client_viewer',
] as const

const projectRoleSchema = z.enum(PROJECT_MEMBER_ROLES)

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Resolve the project_id + organisation_id for a given project_members row. */
async function resolveMemberOrg(
  supabase: any,
  memberId: string,
): Promise<{ projectId: string; organisationId: string } | null> {
  const { data: member } = await supabase
    .schema('projects')
    .from('project_members')
    .select('project_id, organisation_id')
    .eq('id', memberId)
    .maybeSingle()
  if (!member) return null
  return { projectId: member.project_id, organisationId: member.organisation_id }
}

function bust(projectId: string): void {
  revalidatePath(`/projects/${projectId}/settings/members`)
}

// ─── Actions ─────────────────────────────────────────────────────────────────

/**
 * List all project_members for a project, joined with profile info and org role.
 * Gated to anyone with a valid org role (any role can view).
 */
export async function listProjectMembers(
  projectId: string,
): Promise<{ members: ProjectMember[] } | { error: string }> {
  const supabase = await createClient()

  // Resolve the org for this project (needed for role gate)
  const { data: project } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', projectId)
    .maybeSingle()
  if (!project) return { error: 'Project not found' }

  const guard = await requireRole(
    supabase,
    project.organisation_id,
    ['owner', 'admin', 'project_manager', 'contractor', 'inspector', 'supplier', 'client_viewer'],
  )
  if (!guard.ok) return { error: guard.error }

  // Fetch project_members rows. The RLS SELECT policy lets any org member read all
  // rows for a project they belong to, so this returns every member. We do NOT join
  // profiles / org-role here: public.user_organisations RLS is own-row-only
  // (user_id = auth.uid()) and the profiles policy resolves through it, so the cookie
  // client can only ever see the *viewer's* identity. Every member's identity is
  // resolved below with the service client — safe because requireRole above already
  // authorised the caller (same pattern as the bulk-add / sub-org actions).
  const { data, error } = await (supabase as any)
    .schema('projects')
    .from('project_members')
    .select('id, project_id, organisation_id, user_id, role, is_active, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })

  if (error) return { error: error.message }

  const rows = (data ?? []) as any[]
  const userIds = Array.from(new Set(rows.map((r: any) => r.user_id)))
  const orgIds = Array.from(new Set(rows.map((r: any) => r.organisation_id)))

  // Resolve identity (profiles) + org-role for EVERY member via the service client —
  // an elevated read, after the role gate. org_role is keyed by (user_id,
  // organisation_id) — cross-org safe, since a member's row carries their identity org,
  // which may differ from the project's org for sub-org members.
  const profileMap = new Map<string, { full_name: string | null; email: string | null }>()
  const orgRoleMap = new Map<string, string>() // key: `${user_id}|${organisation_id}`
  if (userIds.length > 0) {
    const service = createServiceClient() as any
    const [{ data: profs }, { data: orgRows }] = await Promise.all([
      service.from('profiles').select('id, full_name, email').in('id', userIds),
      service
        .from('user_organisations')
        .select('user_id, organisation_id, role')
        .in('user_id', userIds)
        .in('organisation_id', orgIds),
    ])
    for (const p of (profs ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) {
      profileMap.set(p.id, { full_name: p.full_name ?? null, email: p.email ?? null })
    }
    for (const row of (orgRows ?? []) as Array<{ user_id: string; organisation_id: string; role: string }>) {
      orgRoleMap.set(`${row.user_id}|${row.organisation_id}`, row.role)
    }
  }

  const members: ProjectMember[] = rows.map((r: any) => ({
    id: r.id,
    project_id: r.project_id,
    organisation_id: r.organisation_id,
    user_id: r.user_id,
    role: r.role,
    is_active: r.is_active,
    created_at: r.created_at,
    full_name: profileMap.get(r.user_id)?.full_name ?? null,
    email: profileMap.get(r.user_id)?.email ?? null,
    org_role: orgRoleMap.get(`${r.user_id}|${r.organisation_id}`) ?? null,
  }))

  return { members }
}

/**
 * Add a user to a project with a specific project role.
 * Gated to ORG_WRITE_ROLES on the project's org.
 */
export async function addProjectMember(
  projectId: string,
  userId: string,
  projectRole: string,
): Promise<{ member: ProjectMember } | { error: string }> {
  const parsed = projectRoleSchema.safeParse(projectRole)
  if (!parsed.success) {
    return { error: `Invalid project role. Allowed: ${PROJECT_MEMBER_ROLES.join(', ')}` }
  }

  const supabase = await createClient()

  const { data: project } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', projectId)
    .maybeSingle()
  if (!project) return { error: 'Project not found' }

  const guard = await requireRole(supabase, project.organisation_id, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  const { data, error } = await (supabase as any)
    .schema('projects')
    .from('project_members')
    .insert({
      project_id: projectId,
      user_id: userId,
      organisation_id: project.organisation_id,
      role: parsed.data,
    })
    .select('id, project_id, organisation_id, user_id, role, is_active, created_at')
    .single()

  if (error) {
    if (error.code === '23505') return { error: 'This user is already a member of this project' }
    return { error: error.message }
  }

  // Resolve display identity + org-role via the service client — profiles and
  // user_organisations are RLS-hidden for other users on the cookie client.
  const service = createServiceClient() as any
  const [{ data: profRow }, { data: orgRow }] = await Promise.all([
    service.from('profiles').select('full_name, email').eq('id', userId).maybeSingle(),
    service
      .from('user_organisations')
      .select('role')
      .eq('organisation_id', project.organisation_id)
      .eq('user_id', userId)
      .maybeSingle(),
  ])

  bust(projectId)
  return {
    member: {
      id: (data as any).id,
      project_id: (data as any).project_id,
      organisation_id: (data as any).organisation_id,
      user_id: (data as any).user_id,
      role: (data as any).role,
      is_active: (data as any).is_active,
      created_at: (data as any).created_at,
      full_name: (profRow as any)?.full_name ?? null,
      email: (profRow as any)?.email ?? null,
      org_role: (orgRow as any)?.role ?? null,
    },
  }
}

/**
 * Update the project role for an existing project_members row.
 * Gated to ORG_WRITE_ROLES (resolves project → org from the member row).
 */
export async function updateProjectMemberRole(
  memberId: string,
  projectRole: string,
): Promise<{ member: ProjectMember } | { error: string }> {
  const parsed = projectRoleSchema.safeParse(projectRole)
  if (!parsed.success) {
    return { error: `Invalid project role. Allowed: ${PROJECT_MEMBER_ROLES.join(', ')}` }
  }

  const supabase = await createClient()
  const resolved = await resolveMemberOrg(supabase, memberId)
  if (!resolved) return { error: 'Member not found' }

  const guard = await requireRole(supabase, resolved.organisationId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  const { data, error } = await (supabase as any)
    .schema('projects')
    .from('project_members')
    .update({ role: parsed.data })
    .eq('id', memberId)
    .select('id, project_id, organisation_id, user_id, role, is_active, created_at')
    .single()

  if (error) return { error: error.message }

  // Resolve display identity + org-role via the service client — profiles and
  // user_organisations are RLS-hidden for other users on the cookie client.
  const service = createServiceClient() as any
  const userId = (data as any).user_id
  const [{ data: profRow }, { data: orgRow }] = await Promise.all([
    service.from('profiles').select('full_name, email').eq('id', userId).maybeSingle(),
    service
      .from('user_organisations')
      .select('role')
      .eq('organisation_id', resolved.organisationId)
      .eq('user_id', userId)
      .maybeSingle(),
  ])

  bust(resolved.projectId)
  return {
    member: {
      id: (data as any).id,
      project_id: (data as any).project_id,
      organisation_id: (data as any).organisation_id,
      user_id: (data as any).user_id,
      role: (data as any).role,
      is_active: (data as any).is_active,
      created_at: (data as any).created_at,
      full_name: (profRow as any)?.full_name ?? null,
      email: (profRow as any)?.email ?? null,
      org_role: (orgRow as any)?.role ?? null,
    },
  }
}

/**
 * Remove a user from a project.
 * Gated to ORG_WRITE_ROLES (resolves project → org from the member row).
 */
export async function removeProjectMember(
  memberId: string,
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient()
  const resolved = await resolveMemberOrg(supabase, memberId)
  if (!resolved) return { error: 'Member not found' }

  const guard = await requireRole(supabase, resolved.organisationId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  const { error } = await (supabase as any)
    .schema('projects')
    .from('project_members')
    .delete()
    .eq('id', memberId)

  if (error) return { error: error.message }
  bust(resolved.projectId)
  return { ok: true }
}

/**
 * Return active org members NOT yet on this project.
 * Used to populate the "+ Add member" picker.
 * Gated to ORG_WRITE_ROLES.
 */
export async function listAvailableOrgMembers(
  projectId: string,
): Promise<{ members: OrgMemberOption[] } | { error: string }> {
  const supabase = await createClient()

  const { data: project } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', projectId)
    .maybeSingle()
  if (!project) return { error: 'Project not found' }

  const guard = await requireRole(supabase, project.organisation_id, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  // Fetch user_ids already in project_members for this project
  const { data: existingRows } = await (supabase as any)
    .schema('projects')
    .from('project_members')
    .select('user_id')
    .eq('project_id', projectId)

  const existingUserIds = new Set(
    ((existingRows ?? []) as Array<{ user_id: string }>).map((r) => r.user_id),
  )

  // Fetch all active org members with profiles. user_organisations RLS is own-row-only,
  // so this uses the service client (after the ORG_WRITE_ROLES gate above) — otherwise
  // the picker would only ever list the viewer themselves.
  const service = createServiceClient() as any
  const { data: orgMembers, error } = await service
    .from('user_organisations')
    .select('user_id, role, profiles!user_organisations_user_id_fkey(full_name, email)')
    .eq('organisation_id', project.organisation_id)
    .eq('is_active', true)
    .order('created_at', { ascending: true })

  if (error) return { error: error.message }

  const available: OrgMemberOption[] = ((orgMembers ?? []) as any[])
    .filter((m: any) => !existingUserIds.has(m.user_id))
    .map((m: any) => ({
      user_id: m.user_id,
      full_name: m.profiles?.full_name ?? null,
      email: m.profiles?.email ?? null,
      org_role: m.role,
    }))

  return { members: available }
}
