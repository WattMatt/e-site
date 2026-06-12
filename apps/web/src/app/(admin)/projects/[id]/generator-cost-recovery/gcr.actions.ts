'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireRole, requireEffectiveRole } from '@/lib/auth/require-role'
import {
  ORG_WRITE_ROLES,
  COST_VIEW_ROLES,
  type OrgRole,
  type GcrSettingsRow,
  type GcrZoneRow,
  type GcrZoneGeneratorRow,
  type TenantNodeRow,
  type GcrTenantAssignmentRow,
} from '@esite/shared'

import {
  gcrSettingsSchema,
  gcrZoneSchema,
  gcrGeneratorSchema,
  gcrBulkAssignmentSchema,
  type GcrSettingsInput,
  type GcrZoneInput,
  type GcrGeneratorInput,
  type GcrAssignmentPatch,
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
  settings:    GcrSettingsRow | null
  zones:       GcrZoneRow[]
  generators:  GcrZoneGeneratorRow[]
  tenants:     TenantNodeRow[]
  assignments: GcrTenantAssignmentRow[]
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
        .eq('kind', 'tenant_db')
        .is('deleted_at', null)
        .neq('status', 'decommissioned'),

      (supabase as any)
        .schema('gcr')
        .from('tenant_assignments')
        .select('*')
        .eq('project_id', projectId),
    ])

  return {
    settings:    (settingsRes.data ?? null) as GcrSettingsRow | null,
    zones:       (zonesRes.data ?? []) as GcrZoneRow[],
    generators:  (generatorsRes.data ?? []) as GcrZoneGeneratorRow[],
    tenants:     (tenantsRes.data ?? []) as TenantNodeRow[],
    assignments: (assignmentsRes.data ?? []) as GcrTenantAssignmentRow[],
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

  // Verify the generator belongs to a zone in this project (authz scope check).
  const { data: genRow } = await (supabase as any)
    .schema('gcr')
    .from('zone_generators')
    .select('zone_id')
    .eq('id', generatorId)
    .maybeSingle()

  if (!genRow) return { error: 'Not found' }

  const { data: zoneRow } = await (supabase as any)
    .schema('gcr')
    .from('zones')
    .select('project_id')
    .eq('id', (genRow as { zone_id: string }).zone_id)
    .maybeSingle()

  if (!zoneRow || (zoneRow as { project_id: string }).project_id !== projectId) {
    return { error: 'Not found' }
  }

  const { error } = await (supabase as any)
    .schema('gcr')
    .from('zone_generators')
    .delete()
    .eq('id', generatorId)

  if (error) return { error: error.message ?? 'Failed to delete generator' }

  revalidatePath(GCR_PATH(projectId))
  return { ok: true }
}

// ─── bulkSetUncategorizedTenantsAction ───────────────────────────────────────

/**
 * Set shop_category = 'standard' on every uncategorized (NULL) tenant_db node
 * in the project — the one-click resolution for the readiness gap "N tenant(s)
 * missing category". Deliberately fills NULLs only; never overwrites a category
 * someone chose. Gate: ORG_WRITE_ROLES.
 */
export async function bulkSetUncategorizedTenantsAction(
  projectId: string,
): Promise<{ ok: true; updated: number } | ErrResult> {
  const supabase = await createClient()

  const orgId = await resolveOrgId(supabase, projectId)
  if (!orgId) return { error: 'Project not found' }

  const guard = await requireRole(supabase, orgId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  const { data, error } = await (supabase as any)
    .schema('structure')
    .from('nodes')
    .update({ shop_category: 'standard' })
    .eq('project_id', projectId)
    .eq('kind', 'tenant_db')
    .is('shop_category', null)
    .select('id')

  if (error) return { error: error.message ?? 'Failed to update tenant categories' }

  revalidatePath(GCR_PATH(projectId))
  return { ok: true, updated: ((data ?? []) as unknown[]).length }
}

// ─── bulkSaveTenantAssignmentsAction ─────────────────────────────────────────

/**
 * One save path for single-cell edits AND bulk-bar applies.
 * Transactional via gcr.bulk_save_tenant_assignments (SECURITY INVOKER — RLS
 * applies to the caller). Patch fields absent = untouched; null = cleared.
 */
export async function bulkSaveTenantAssignmentsAction(
  projectId: string,
  nodeIds: string[],
  patch: GcrAssignmentPatch,
): Promise<{ ok: true; updated: number } | ErrResult> {
  const supabase = await createClient()

  const orgId = await resolveOrgId(supabase, projectId)
  if (!orgId) return { error: 'Project not found' }

  const guard = await requireRole(supabase, orgId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  const parsed = gcrBulkAssignmentSchema.safeParse({ nodeIds, patch })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const p = parsed.data.patch

  const { data, error } = await (supabase as any)
    .schema('gcr')
    .rpc('bulk_save_tenant_assignments', {
      p_project_id:        projectId,
      p_node_ids:          parsed.data.nodeIds,
      p_set_zone:          p.zone_id !== undefined,
      p_zone_id:           p.zone_id ?? null,
      p_set_participation: p.participation !== undefined,
      p_participation:     p.participation ?? null,
      p_set_category:      p.shop_category !== undefined,
      p_shop_category:     p.shop_category ?? null,
      p_set_manual_kw:     p.manual_kw_override !== undefined,
      p_manual_kw:         p.manual_kw_override ?? null,
    })

  if (error) {
    console.error('[gcr-bulk-save] failed', {
      projectId, nodeCount: parsed.data.nodeIds.length, patch: p, error: error.message,
    })
    return { error: error.message ?? 'Failed to save tenant assignments' }
  }

  revalidatePath(GCR_PATH(projectId))
  return { ok: true, updated: (data as number | null) ?? parsed.data.nodeIds.length }
}
