'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireRole, requireEffectiveRole } from '@/lib/auth/require-role'
import { ORG_WRITE_ROLES, COST_VIEW_ROLES, type OrgRole } from '@esite/shared'

import {
  gcrSettingsSchema,
  gcrZoneSchema,
  gcrGeneratorSchema,
  gcrAssignmentSchema,
  type GcrSettingsInput,
  type GcrZoneInput,
  type GcrGeneratorInput,
  type GcrAssignmentInput,
} from './gcr.schemas'

// ─── Shared helpers ───────────────────────────────────────────────────────────

const GCR_PATH = (projectId: string) =>
  `/projects/${projectId}/generator-cost-recovery`

/**
 * Resolve organisation_id from projects.projects, same pattern as
 * updateProjectAction. Returns null if not found.
 */
async function resolveOrgId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
): Promise<string | null> {
  const { data } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', projectId)
    .maybeSingle()
  return (data as { organisation_id: string } | null)?.organisation_id ?? null
}

// ─── Result type ─────────────────────────────────────────────────────────────

type OkResult   = { ok: true }
type ErrResult  = { error: string }
type ActionResult = OkResult | ErrResult

// ─── loadGcrConfigAction ─────────────────────────────────────────────────────

export interface GcrConfig {
  settings:    Record<string, unknown> | null
  zones:       unknown[]
  generators:  unknown[]
  tenants:     unknown[]
  assignments: unknown[]
}

/**
 * Read-only load — gated by COST_VIEW_ROLES via requireEffectiveRole.
 */
export async function loadGcrConfigAction(
  projectId: string,
): Promise<GcrConfig | { error: string }> {
  const supabase = await createClient()

  const guard = await requireEffectiveRole(supabase, projectId, COST_VIEW_ROLES)
  if (!guard.ok) return { error: guard.error }

  const [settingsRes, zonesRes, generatorsRes, tenantsRes, assignmentsRes] =
    await Promise.all([
      (supabase as any)
        .schema('gcr')
        .from('settings')
        .select('*')
        .eq('project_id', projectId)
        .maybeSingle(),

      (supabase as any)
        .schema('gcr')
        .from('zones')
        .select('*')
        .eq('project_id', projectId)
        .order('zone_number'),

      // generators via a join to zones so we can filter by project
      (supabase as any)
        .schema('gcr')
        .from('zone_generators')
        .select('*, zones!inner(project_id)')
        .eq('zones.project_id', projectId),

      (supabase as any)
        .schema('structure')
        .from('nodes')
        .select('id, shop_number, shop_name, shop_area_m2, shop_category, generator_participation')
        .eq('project_id', projectId)
        .eq('kind', 'tenant_db'),

      (supabase as any)
        .schema('gcr')
        .from('tenant_assignments')
        .select('*')
        .eq('project_id', projectId),
    ])

  return {
    settings:    settingsRes.data ?? null,
    zones:       zonesRes.data ?? [],
    generators:  generatorsRes.data ?? [],
    tenants:     tenantsRes.data ?? [],
    assignments: assignmentsRes.data ?? [],
  }
}

// ─── saveGcrSettingsAction ───────────────────────────────────────────────────

/**
 * Upsert gcr.settings. Conflict target: project_id.
 * Gate: ORG_WRITE_ROLES.
 */
export async function saveGcrSettingsAction(
  projectId: string,
  input: GcrSettingsInput,
): Promise<ActionResult> {
  const supabase = await createClient()

  const orgId = await resolveOrgId(supabase, projectId)
  if (!orgId) return { error: 'Project not found' }

  const guard = await requireRole(supabase, orgId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  const parsed = gcrSettingsSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const { error } = await (supabase as any)
    .schema('gcr')
    .from('settings')
    .upsert(
      { project_id: projectId, organisation_id: orgId, ...parsed.data },
      { onConflict: 'project_id' },
    )

  if (error) return { error: error.message ?? 'Failed to save settings' }

  revalidatePath(GCR_PATH(projectId))
  return { ok: true }
}

// ─── upsertZoneAction ────────────────────────────────────────────────────────

export async function upsertZoneAction(
  projectId: string,
  input: GcrZoneInput,
): Promise<ActionResult> {
  const supabase = await createClient()

  const orgId = await resolveOrgId(supabase, projectId)
  if (!orgId) return { error: 'Project not found' }

  const guard = await requireRole(supabase, orgId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  const parsed = gcrZoneSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const row: Record<string, unknown> = {
    project_id: projectId,
    organisation_id: orgId,
    zone_name: parsed.data.zone_name,
    zone_number: parsed.data.zone_number,
  }
  if (parsed.data.id) row.id = parsed.data.id

  const { error } = await (supabase as any)
    .schema('gcr')
    .from('zones')
    .upsert(row, { onConflict: parsed.data.id ? 'id' : 'project_id,zone_number' })

  if (error) return { error: error.message ?? 'Failed to save zone' }

  revalidatePath(GCR_PATH(projectId))
  return { ok: true }
}

// ─── deleteZoneAction ────────────────────────────────────────────────────────

export async function deleteZoneAction(
  projectId: string,
  zoneId: string,
): Promise<ActionResult> {
  const supabase = await createClient()

  const orgId = await resolveOrgId(supabase, projectId)
  if (!orgId) return { error: 'Project not found' }

  const guard = await requireRole(supabase, orgId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  const { error } = await (supabase as any)
    .schema('gcr')
    .from('zones')
    .delete()
    .eq('id', zoneId)
    .eq('project_id', projectId)

  if (error) return { error: error.message ?? 'Failed to delete zone' }

  revalidatePath(GCR_PATH(projectId))
  return { ok: true }
}

// ─── upsertGeneratorAction ───────────────────────────────────────────────────

export async function upsertGeneratorAction(
  projectId: string,
  input: GcrGeneratorInput,
): Promise<ActionResult> {
  const supabase = await createClient()

  const orgId = await resolveOrgId(supabase, projectId)
  if (!orgId) return { error: 'Project not found' }

  const guard = await requireRole(supabase, orgId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  const parsed = gcrGeneratorSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const row: Record<string, unknown> = {
    zone_id: parsed.data.zone_id,
    organisation_id: orgId,
    generator_number: parsed.data.generator_number,
    generator_size: parsed.data.generator_size,
    generator_cost: parsed.data.generator_cost,
  }
  if (parsed.data.id) row.id = parsed.data.id

  const { error } = await (supabase as any)
    .schema('gcr')
    .from('zone_generators')
    .upsert(row, { onConflict: parsed.data.id ? 'id' : 'zone_id,generator_number' })

  if (error) return { error: error.message ?? 'Failed to save generator' }

  revalidatePath(GCR_PATH(projectId))
  return { ok: true }
}

// ─── deleteGeneratorAction ───────────────────────────────────────────────────

export async function deleteGeneratorAction(
  projectId: string,
  generatorId: string,
): Promise<ActionResult> {
  const supabase = await createClient()

  const orgId = await resolveOrgId(supabase, projectId)
  if (!orgId) return { error: 'Project not found' }

  const guard = await requireRole(supabase, orgId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  const { error } = await (supabase as any)
    .schema('gcr')
    .from('zone_generators')
    .delete()
    .eq('id', generatorId)

  if (error) return { error: error.message ?? 'Failed to delete generator' }

  revalidatePath(GCR_PATH(projectId))
  return { ok: true }
}

// ─── saveTenantAssignmentAction ──────────────────────────────────────────────

/**
 * Two writes in one action (single gate):
 *   1. Upsert gcr.tenant_assignments (conflict: node_id).
 *   2. Update structure.nodes shop_category + generator_participation.
 */
export async function saveTenantAssignmentAction(
  projectId: string,
  input: GcrAssignmentInput,
): Promise<ActionResult> {
  const supabase = await createClient()

  const orgId = await resolveOrgId(supabase, projectId)
  if (!orgId) return { error: 'Project not found' }

  const guard = await requireRole(supabase, orgId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  const parsed = gcrAssignmentSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const { node_id, zone_id, participation, manual_kw_override, shop_category } = parsed.data

  // Write 1 — upsert gcr.tenant_assignments
  const { error: upsertErr } = await (supabase as any)
    .schema('gcr')
    .from('tenant_assignments')
    .upsert(
      {
        node_id,
        project_id: projectId,
        organisation_id: orgId,
        zone_id,
        manual_kw_override,
      },
      { onConflict: 'node_id' },
    )

  if (upsertErr) return { error: upsertErr.message ?? 'Failed to save tenant assignment' }

  // Write 2 — update structure.nodes facets
  const nodeUpdate: Record<string, unknown> = {
    generator_participation: participation,
  }
  if (shop_category !== undefined) nodeUpdate.shop_category = shop_category

  const { error: nodeErr } = await (supabase as any)
    .schema('structure')
    .from('nodes')
    .update(nodeUpdate)
    .eq('id', node_id)

  if (nodeErr) return { error: nodeErr.message ?? 'Failed to update tenant node' }

  revalidatePath(GCR_PATH(projectId))
  return { ok: true }
}
