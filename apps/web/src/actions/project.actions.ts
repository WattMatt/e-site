'use server'

/**
 * Project lifecycle server actions.
 *
 * Today this owns:
 *   - createProjectAction: validates input, enforces the per-tier project
 *     limit (free=1, starter=5, professional=∞), seeds project_members,
 *     fires the conversion-prompt edge function. Returns either
 *     { projectId } or { error, code: 'paywall', currentCount, limit, tier }.
 *
 * Server-side enforcement is the canonical gate. The /projects/new page
 * also does a server-render check up front so users hit the paywall card
 * BEFORE filling out the form, but that's UX — the action is the truth.
 *
 * Mobile: when the mobile project create flow lands, point it at this
 * server action via the same /api proxy pattern used for notifications.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import { trackServer, ANALYTICS_EVENTS } from '@/lib/analytics'
import { createProjectSchema, type CreateProjectInput, PLANS, type PlanTier, ORG_WRITE_ROLES, type OrgRole } from '@esite/shared'

export interface ProjectGateInfo {
  tier: PlanTier
  currentCount: number
  limit: number          // -1 means unlimited
  status: string         // subscription status
}

export type CreateProjectResult =
  | { projectId: string }
  | { error: string; code?: 'paywall'; gate?: ProjectGateInfo }

/**
 * Server-side gate: returns null if the org can create another project,
 * otherwise returns gate info describing why they're blocked. Reused by
 * the /projects/new page to render the paywall pre-flight instead of
 * making the user fill out a form just to hit a 403.
 */
export async function checkProjectQuota(orgId: string): Promise<ProjectGateInfo | null> {
  const supabase = await createClient()

  // Fetch subscription tier + current active project count in parallel.
  const [subRes, projectsRes] = await Promise.all([
    (supabase as any)
      .schema('billing')
      .from('subscriptions')
      .select('tier, status')
      .eq('organisation_id', orgId)
      .maybeSingle(),
    (supabase as any)
      .schema('projects')
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('organisation_id', orgId)
      .neq('status', 'cancelled'),
  ])

  // Defensive default: an org without a billing row is treated as free.
  // (Should only happen for orgs created before the seeding logic landed.)
  const tier: PlanTier = (subRes.data?.tier ?? 'free') as PlanTier
  const status: string = subRes.data?.status ?? 'active'
  const plan = PLANS[tier]
  const limit = plan.limits.projects ?? -1
  const currentCount = projectsRes.count ?? 0

  // -1 means unlimited (professional / enterprise tiers).
  if (limit === -1) return null
  if (currentCount < limit) return null

  return { tier, currentCount, limit, status }
}

export async function createProjectAction(
  input: CreateProjectInput,
): Promise<CreateProjectResult> {
  const parsed = createProjectSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: membership, error: memErr } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .single()
  if (memErr || !membership) return { error: 'No active organisation membership' }
  const orgId = membership.organisation_id

  // Tier-limit gate (canonical enforcement).
  const gate = await checkProjectQuota(orgId)
  if (gate) {
    return {
      error: `Your ${PLANS[gate.tier].name} plan allows ${gate.limit} project${gate.limit === 1 ? '' : 's'}. Upgrade to add another.`,
      code: 'paywall',
      gate,
    }
  }

  const i = parsed.data
  const { data: project, error: insertErr } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .insert({
      organisation_id: orgId,
      created_by: user.id,
      name: i.name,
      description: i.description ?? null,
      address: i.address ?? null,
      city: i.city ?? null,
      province: i.province ?? null,
      status: i.status,
      start_date: i.startDate || null,
      end_date: i.endDate || null,
      contract_value: i.contractValue ?? null,
      client_name: i.clientName ?? null,
      client_contact: i.clientContact ?? null,
    })
    .select('id')
    .single()

  if (insertErr || !project) {
    return { error: insertErr?.message ?? 'Failed to create project' }
  }

  // Add the creator as PM (matches existing /projects/new behaviour).
  await (supabase as any)
    .schema('projects')
    .from('project_members')
    .insert({
      project_id: project.id,
      user_id: user.id,
      organisation_id: orgId,
      role: 'project_manager',
    })

  await trackServer(user.id, ANALYTICS_EVENTS.PROJECT_CREATED, {
    project_id: project.id,
    org_id: orgId,
    source: 'standalone',
  })

  // Best-effort conversion-prompt nudge (mirrors the previous client-side call).
  void supabase.functions
    .invoke('conversion-prompt', { body: { projectId: project.id, organisationId: orgId } })
    .catch(() => {})

  revalidatePath('/projects')
  revalidatePath('/dashboard')
  return { projectId: project.id }
}

// ─── deleteProjectAction ────────────────────────────────────────────────────

export type DeleteProjectResult = { ok: true } | { error: string }

/**
 * Hard-delete a project. Owner-only. Cascade-deletes every child row
 * (snags, RFIs, diary entries, floor plans, the cable schedule, tenant
 * and equipment schedules, material orders, inspections, project_members)
 * via the FK `ON DELETE CASCADE` chain set in 00002_projects_schema.sql
 * and the later schema migrations.
 *
 * Caller must pass `confirmationName` matching the project's name exactly
 * (case-sensitive, trim-tolerant). UI surfaces this as a type-to-confirm
 * input — server check is the canonical gate.
 *
 * NOT REVERSIBLE. Add a soft-delete (status='cancelled') variant if/when
 * a 30-day undo window becomes a requirement.
 */
export async function deleteProjectAction(
  projectId: string,
  confirmationName: string,
): Promise<DeleteProjectResult> {
  if (!projectId || typeof projectId !== 'string') {
    return { error: 'Missing project id' }
  }
  if (typeof confirmationName !== 'string') {
    return { error: 'Confirmation required' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Load project + its org. RLS gates this read — non-members get null.
  const { data: project, error: projErr } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('id, name, organisation_id')
    .eq('id', projectId)
    .maybeSingle()

  if (projErr || !project) return { error: 'Project not found' }

  // Confirmation match — server-side canonical check.
  if (confirmationName.trim() !== project.name.trim()) {
    return { error: 'Confirmation name does not match project name' }
  }

  // Owner-only role gate for the project's org.
  const { data: membership } = await supabase
    .from('user_organisations')
    .select('role')
    .eq('user_id', user.id)
    .eq('organisation_id', project.organisation_id)
    .eq('is_active', true)
    .maybeSingle()

  if (!membership || membership.role !== 'owner') {
    return { error: 'Only org owners can delete projects' }
  }

  // Cascade DELETE. RLS on projects.projects allows owners to delete
  // (FOR ALL policy on org-members in migration 00009_rls_policies.sql).
  const { error: delErr } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .delete()
    .eq('id', projectId)

  if (delErr) return { error: delErr.message ?? 'Delete failed' }

  await trackServer(user.id, ANALYTICS_EVENTS.PROJECT_DELETED, {
    project_id: projectId,
    org_id: project.organisation_id,
    project_name: project.name,
  })

  revalidatePath('/projects')
  revalidatePath('/dashboard')
  return { ok: true }
}

// ─── updateProjectAction ────────────────────────────────────────────────────

// Schema is internal — Next.js 'use server' files can only export async fns.
// Type aliases below are erased at compile time so they're fine to export.
const updateProjectSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  // Mirrors DB CHECK projects_code_format (after migration 00105):
  // ^[A-Z0-9][A-Z0-9-]{1,11}$ — 2-12 chars, uppercase letters/digits/hyphens.
  // NOT NULL in DB; we accept .optional() in the patch (omitting = no change).
  code: z.string().regex(/^[A-Z0-9][A-Z0-9-]{1,11}$/, 'Project code: uppercase letters, digits, and hyphens only — 2–12 chars').optional(),
  address: z.string().max(500).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  province: z.string().max(120).nullable().optional(),
  status: z.enum(['planning', 'active', 'on_hold', 'completed', 'cancelled']).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  clientName: z.string().max(200).nullable().optional(),
  clientContact: z.string().max(500).nullable().optional(),
  contractValue: z.number().nonnegative().nullable().optional(),
  currency: z.string().max(8).nullable().optional(),
})

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>

export type UpdateProjectResult = { ok: true } | { error: string }

/**
 * Patch a subset of projects.projects columns.
 *
 * Role gate: resolves the project's org, then requires one of
 * allowedRoles (default = ORG_WRITE_ROLES). All passed fields are
 * camelCase→snake_case mapped; undefined fields are not included in
 * the UPDATE so they are never zeroed out.
 */
export async function updateProjectAction(
  projectId: string,
  input: UpdateProjectInput,
  allowedRoles: readonly OrgRole[] = ORG_WRITE_ROLES,
): Promise<UpdateProjectResult> {
  const supabase = await createClient()

  const { data: proj } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', projectId)
    .maybeSingle()
  if (!proj) return { error: 'Project not found' }

  const guard = await requireRole(supabase, proj.organisation_id, allowedRoles)
  if (!guard.ok) return { error: guard.error }

  const parsed = updateProjectSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  // camelCase → snake_case row patch — only include keys that were passed.
  const row: Record<string, unknown> = {}
  if (parsed.data.name !== undefined)          row.name = parsed.data.name
  if (parsed.data.description !== undefined)   row.description = parsed.data.description
  if (parsed.data.code !== undefined)          row.code = parsed.data.code
  if (parsed.data.address !== undefined)       row.address = parsed.data.address
  if (parsed.data.city !== undefined)          row.city = parsed.data.city
  if (parsed.data.province !== undefined)      row.province = parsed.data.province
  if (parsed.data.status !== undefined)        row.status = parsed.data.status
  if (parsed.data.projectType !== undefined)   row.project_type = parsed.data.projectType
  if (parsed.data.startDate !== undefined)     row.start_date = parsed.data.startDate
  if (parsed.data.endDate !== undefined)       row.end_date = parsed.data.endDate
  if (parsed.data.clientName !== undefined)    row.client_name = parsed.data.clientName
  if (parsed.data.clientContact !== undefined) row.client_contact = parsed.data.clientContact
  if (parsed.data.contractValue !== undefined) row.contract_value = parsed.data.contractValue
  if (parsed.data.currency !== undefined)      row.currency = parsed.data.currency

  const { error } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .update(row)
    .eq('id', projectId)
  if (error) return { error: error.message }

  revalidatePath(`/projects/${projectId}`, 'layout')
  return { ok: true }
}
