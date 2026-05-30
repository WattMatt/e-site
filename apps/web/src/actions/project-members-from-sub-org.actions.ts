'use server'

/**
 * Add a subset of a sub-org's roster to a project's members. Each inserted
 * project_members row uses the SUB-ORG's id as organisation_id (per the new
 * convention: project_members.organisation_id holds the user's identity org).
 *
 * Gated to ORG_WRITE_ROLES on the PROJECT's org (i.e., the WM admin adding
 * Bob's Building's people to KINGSWALK).
 *
 * See spec §2.3 and §4.4.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import { ORG_WRITE_ROLES } from '@esite/shared'

const PROJECT_MEMBER_ROLES = [
  'project_manager',
  'contractor',
  'inspector',
  'supplier',
  'client_viewer',
] as const

const inputSchema = z.object({
  projectId:   z.string().uuid(),
  subOrgId:    z.string().uuid(),
  userIds:     z.array(z.string().uuid()).min(1).max(100),
  projectRole: z.enum(PROJECT_MEMBER_ROLES),
})

export type AddFromSubOrgStatus = 'added' | 'skipped-already-on-project' | 'failed'

export interface AddFromSubOrgResult {
  ok: true
  summary: { added: number; skipped: number; failed: number }
  details: Array<{ user_id: string; status: AddFromSubOrgStatus; reason?: string }>
}

export async function addProjectMembersFromSubOrg(
  input: z.input<typeof inputSchema>,
): Promise<AddFromSubOrgResult | { ok: false; error: string }> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }
  const { projectId, subOrgId, userIds, projectRole } = parsed.data

  const supabase = await createClient()

  // Resolve project's org for the role gate.
  const { data: project } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', projectId)
    .maybeSingle()
  if (!project) return { ok: false, error: 'Project not found.' }
  const projectOrgId = (project as { organisation_id: string }).organisation_id

  const guard = await requireRole(supabase, projectOrgId, ORG_WRITE_ROLES)
  if (!guard.ok) return { ok: false, error: guard.error }

  // Confirm subOrg belongs to projectOrg (WM admin owns Bob's Building).
  const { data: subOrg } = await (supabase as any)
    .from('organisations')
    .select('id, parent_organisation_id, is_shadow, is_active')
    .eq('id', subOrgId)
    .maybeSingle()
  if (!subOrg) return { ok: false, error: 'Sub-organisation not found.' }
  if ((subOrg as { parent_organisation_id: string | null }).parent_organisation_id !== projectOrgId) {
    return { ok: false, error: "Sub-organisation does not belong to this project's org." }
  }
  if (!(subOrg as { is_active: boolean }).is_active) {
    return { ok: false, error: 'Sub-organisation is deactivated.' }
  }
  if (!(subOrg as { is_shadow: boolean }).is_shadow) {
    return { ok: false, error: 'This organisation has been claimed by its owner; use its own admin to grant access.' }
  }

  // Filter userIds to those actually in the sub-org's active roster (defence in depth).
  const { data: rosterRows } = await (supabase as any)
    .from('user_organisations')
    .select('user_id')
    .eq('organisation_id', subOrgId)
    .eq('is_active', true)
    .in('user_id', userIds)
  const validUserIds = new Set(
    ((rosterRows ?? []) as Array<{ user_id: string }>).map((r) => r.user_id),
  )

  // Find user_ids already on the project.
  const { data: existing } = await (supabase as any)
    .schema('projects')
    .from('project_members')
    .select('user_id')
    .eq('project_id', projectId)
    .in('user_id', userIds)
  const onProject = new Set(
    ((existing ?? []) as Array<{ user_id: string }>).map((r) => r.user_id),
  )

  let added = 0, skipped = 0, failed = 0
  const details: AddFromSubOrgResult['details'] = []

  for (const userId of userIds) {
    if (!validUserIds.has(userId)) {
      failed++
      details.push({ user_id: userId, status: 'failed', reason: 'Not in sub-org roster.' })
      continue
    }
    if (onProject.has(userId)) {
      skipped++
      details.push({ user_id: userId, status: 'skipped-already-on-project' })
      continue
    }
    const { error } = await (supabase as any)
      .schema('projects')
      .from('project_members')
      .insert({
        project_id:      projectId,
        user_id:         userId,
        organisation_id: subOrgId,   // sub-org is the identity org per new convention
        role:            projectRole,
      })
    if (error) {
      failed++
      details.push({ user_id: userId, status: 'failed', reason: error.message })
      continue
    }
    added++
    details.push({ user_id: userId, status: 'added' })
  }

  revalidatePath(`/projects/${projectId}/settings/members`)
  return { ok: true, summary: { added, skipped, failed }, details }
}
