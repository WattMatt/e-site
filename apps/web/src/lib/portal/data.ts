/**
 * Client-portal data layer — ALL reads for the viewing-only portal go through
 * here (spec: docs/superpowers/specs/2026-07-06-client-portal.md §2).
 *
 * Access model:
 *  - Every fetch first passes `requirePortalAccess`: the caller must be a
 *    client_viewer in their ACTIVE org AND hold an active project_members row
 *    on the requested project. No row → null → page renders notFound().
 *  - Aspects whose RLS already allows client_viewer project-scoped SELECTs
 *    (diary, snags, QC reports, floor plans, handover, tenant schedule —
 *    migrations 00034/00148/00172) read via the USER client, so RLS remains
 *    the second gate.
 *  - Aspects whose RLS deliberately blocks client_viewer (inspections.*,
 *    cable_schedule.*, gcr.* — see 00034's block comment) read via the
 *    SERVICE client with EXPLICIT COLUMN ALLOW-LISTS after the membership
 *    check. The client's own JWT stays fully blocked at the DB, so the API
 *    surface is fail-closed; only these curated server reads expose data.
 *  - Cable schedule: technical columns only — NO rate/cost fields, matching
 *    the export redaction rule in lib/cable-schedule/export-role.ts.
 *  - projects: explicit columns — contract_value is never selected.
 */

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getOrgContext } from '@/lib/auth-org'
import {
  gatherUnifiedBoards,
  type RawNode,
  type RawOrder,
  type UnifiedGroup,
} from '@/app/(admin)/projects/[id]/equipment-materials/_lib/gather-unified-boards'

export interface PortalAccess {
  userId: string
  organisationId: string
  projectId: string
}

/** Gate: active-org client_viewer with an active membership on this project. */
export async function requirePortalAccess(projectId: string): Promise<PortalAccess | null> {
  const ctx = await getOrgContext()
  if (!ctx || ctx.role !== 'client_viewer') return null

  const service = createServiceClient()
  const { data } = await (service as any)
    .schema('projects')
    .from('project_members')
    .select('id')
    .eq('project_id', projectId)
    .eq('user_id', ctx.userId)
    .eq('is_active', true)
    .maybeSingle()
  if (!data) return null

  return { userId: ctx.userId, organisationId: ctx.organisationId, projectId }
}

// Explicit project columns — contract_value deliberately absent.
const PROJECT_COLS = 'id, name, description, address, province, status, start_date, end_date, client_name'

export interface PortalProject {
  id: string
  name: string
  description: string | null
  address: string | null
  province: string | null
  status: string
  start_date: string | null
  end_date: string | null
  client_name: string | null
}

/** Projects list — user client; RLS scopes a client_viewer to their memberships. */
export async function listPortalProjects(): Promise<PortalProject[]> {
  const supabase = await createClient()
  const { data } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select(PROJECT_COLS)
    .order('created_at', { ascending: false })
  return (data ?? []) as PortalProject[]
}

/** Single project — user client (RLS) + explicit columns (no contract value). */
export async function getPortalProject(projectId: string): Promise<PortalProject | null> {
  const supabase = await createClient()
  const { data } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select(PROJECT_COLS)
    .eq('id', projectId)
    .maybeSingle()
  return (data as PortalProject) ?? null
}

// ─── RLS-allowed aspects — USER client reads ─────────────────────────────────

export async function listPortalDiaryEntries(projectId: string) {
  const supabase = await createClient()
  const { data } = await (supabase as any)
    .schema('projects')
    .from('site_diary_entries')
    .select('id, entry_date, entry_type, weather, workers_on_site, progress_notes, safety_notes, quality_notes, delay_notes, delays, created_at')
    .eq('project_id', projectId)
    .order('entry_date', { ascending: false })
    .limit(100)
  return (data ?? []) as Array<{
    id: string; entry_date: string; entry_type: string | null; weather: string | null
    workers_on_site: number | null; progress_notes: string; safety_notes: string | null
    quality_notes: string | null; delay_notes: string | null; delays: string | null; created_at: string
  }>
}

export async function listPortalSnags(projectId: string) {
  const supabase = await createClient()
  const { data } = await (supabase as any)
    .schema('field')
    .from('snags')
    .select('id, title, description, location, category, priority, status, resolved_at, signed_off_at, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(200)
  return (data ?? []) as Array<{
    id: string; title: string; description: string | null; location: string | null
    category: string; priority: string; status: string
    resolved_at: string | null; signed_off_at: string | null; created_at: string
  }>
}

/**
 * QC reports — user client; 00172's qc_reports SELECT policy only returns
 * `status='issued'` rows to a client_viewer, so drafts and closed reports
 * never reach the portal (DB-enforced, not page logic).
 */
export async function listPortalQcReports(projectId: string) {
  const supabase = await createClient()
  const { data } = await (supabase as any)
    .schema('projects')
    .from('qc_reports')
    .select('id, report_no, title, description, location, inspection_date, status, issued_at, created_at')
    .eq('project_id', projectId)
    .order('report_no', { ascending: false })
    .limit(100)
  return (data ?? []) as Array<{
    id: string; report_no: number; title: string; description: string | null
    location: string | null; inspection_date: string | null; status: string
    issued_at: string | null; created_at: string
  }>
}

export async function listPortalFloorPlans(projectId: string) {
  const supabase = await createClient()
  const { data } = await (supabase as any)
    .schema('tenants')
    .from('floor_plans')
    .select('id, name, level, scale, file_path, width_px, height_px, updated_at')
    .eq('project_id', projectId)
    .eq('is_active', true)
    .order('name')
  return (data ?? []) as Array<{
    id: string; name: string; level: string | null; scale: string | null
    file_path: string; width_px: number | null; height_px: number | null; updated_at: string
  }>
}

export async function listPortalHandover(projectId: string) {
  const supabase = await createClient()
  const { data } = await (supabase as any)
    .schema('projects')
    .from('handover_checklist')
    .select('id, item, is_complete, completed_at, sort_order')
    .eq('project_id', projectId)
    .order('sort_order')
  return (data ?? []) as Array<{
    id: string; item: string; is_complete: boolean; completed_at: string | null; sort_order: number
  }>
}

export async function listPortalTenantSchedule(projectId: string) {
  const supabase = await createClient()
  const { data } = await (supabase as any)
    .schema('structure')
    .from('nodes')
    .select('id, code, shop_number, shop_name, status, section, tenant_details(scope_status, layout_status, layout_issued_at)')
    .eq('project_id', projectId)
    .eq('kind', 'tenant_db')
    .is('deleted_at', null) // recycle-binned shops must not resurface for clients
    .order('shop_number')
  return (data ?? []) as Array<{
    id: string; code: string; shop_number: string | null; shop_name: string | null
    status: string; section: string | null
    tenant_details: { scope_status: string; layout_status: string; layout_issued_at: string | null } | null
  }>
}

// ─── RLS-blocked aspects — curated SERVICE reads (membership-checked) ───────

/** Inspections summary — service read; inspections.* RLS blocks client_viewer. */
export async function listPortalInspections(projectId: string) {
  const access = await requirePortalAccess(projectId)
  if (!access) return null
  const service = createServiceClient()
  const { data } = await (service as any)
    .schema('inspections')
    .from('inspections')
    .select('id, target_label, target_node_type, target_location, status, overall_result, coc_number, scheduled_at, completed_at, certified_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(200)
  return (data ?? []) as Array<{
    id: string; target_label: string; target_node_type: string; target_location: string | null
    status: string; overall_result: string | null; coc_number: string | null
    scheduled_at: string | null; completed_at: string | null; certified_at: string | null
  }>
}

/**
 * Cable-schedule revisions — service read, TECHNICAL columns only. Rate/cost
 * data is never selected here (portal equivalent of export-role.ts redaction).
 */
export async function listPortalCableRevisions(projectId: string) {
  const access = await requirePortalAccess(projectId)
  if (!access) return null
  const service = createServiceClient()
  const { data } = await (service as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('id, code, description, status, issued_at, change_notes, fault_level_ka, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  return (data ?? []) as Array<{
    id: string; code: string; description: string | null; status: string
    issued_at: string | null; change_notes: string | null; fault_level_ka: number | null; created_at: string
  }>
}

/**
 * Generator cost-recovery report revisions — service read. The client is the
 * beneficiary of the recovery, so the issued report list is theirs to see
 * (user decision, spec §2). Metadata only; the report file itself is fetched
 * per-revision via existing signed-URL flows if/when a detail view is added.
 */
export async function listPortalGcrReports(projectId: string) {
  const access = await requirePortalAccess(projectId)
  if (!access) return null
  const service = createServiceClient()
  const { data } = await (service as any)
    .schema('gcr')
    .from('report_revisions')
    .select('id, revision_number, file_name, note, created_at')
    .eq('project_id', projectId)
    .order('revision_number', { ascending: false })
  return (data ?? []) as Array<{
    id: string; revision_number: number; file_name: string; note: string | null; created_at: string
  }>
}

/**
 * Equipment & Materials — the board register with procurement status
 * (user decision 2026-07-07: clients see this tab, strictly view-only).
 *
 * Curated SERVICE read after the membership gate, exactly like cables / gcr /
 * inspections: migration 00166 blocks the client JWT from reading
 * structure.node_orders (its `notes` column + the linked quote / order /
 * shop-drawing documents are commercial), so this explicit column allow-list
 * is the only path that exposes procurement data to a client. Order notes,
 * documents and drawings are never selected (docs/drawings maps stay empty) —
 * 00166 also blocks them at the DB for effective-client_viewer JWTs. The
 * service read also keeps cross-org (sub-org identity) clients working: their
 * JWT is not a member of the project's owning org, so the org-scoped
 * scope_item_types RLS would return zero rows and blank every item label.
 */
export async function getPortalEquipmentMaterials(projectId: string): Promise<UnifiedGroup[] | null> {
  const access = await requirePortalAccess(projectId)
  if (!access) return null
  const service = createServiceClient()

  // opening_date drives required-by dates; organisation_id scopes scope types.
  const { data: project } = await (service as any)
    .schema('projects')
    .from('projects')
    .select('id, organisation_id, opening_date')
    .eq('id', projectId)
    .maybeSingle()
  if (!project) return null
  const { organisation_id: orgId, opening_date: openingDate } = project as {
    organisation_id: string
    opening_date: string | null
  }

  // Recycle-binned nodes (deleted_at set) are hidden from staff surfaces via
  // listNodes' default filter — mirror that here so they never resurface for
  // clients.
  const { data: nodeRows } = await (service as any)
    .schema('structure')
    .from('nodes')
    .select('id, code, name, kind, status, coc_required, custom_kind_label, shop_name, shop_number')
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('code')
  const nodes = (nodeRows ?? []) as RawNode[]

  // `notes` is NOT selected — RawOrder wants the field, so it is blanked.
  const { data: orderRows } = await (service as any)
    .schema('structure')
    .from('node_orders')
    .select('id, node_id, label, scope_item_type_id, status, ordered_at, received_at')
    .eq('project_id', projectId)
    .order('label')
  const orders: RawOrder[] = ((orderRows ?? []) as Array<Omit<RawOrder, 'notes'>>).map((o) => ({
    ...o,
    notes: '',
  }))

  const boByNode = new Map<string, { boPeriodDays: number | null; boDateOverride: string | null }>()
  const tenantNodeIds = nodes.filter((n) => n.kind === 'tenant_db').map((n) => n.id)
  if (tenantNodeIds.length > 0) {
    const { data } = await (service as any)
      .schema('structure')
      .from('tenant_details')
      .select('node_id, bo_period_days, bo_date_override')
      .in('node_id', tenantNodeIds)
    for (const r of (data ?? []) as Array<{
      node_id: string
      bo_period_days: number | null
      bo_date_override: string | null
    }>) {
      boByNode.set(r.node_id, { boPeriodDays: r.bo_period_days, boDateOverride: r.bo_date_override })
    }
  }

  const { data: scopeTypes } = await (service as any)
    .schema('structure')
    .from('scope_item_types')
    .select('id, key, label')
    .eq('organisation_id', orgId)
  const scopeTypeById = new Map(
    ((scopeTypes ?? []) as Array<{ id: string; key: string; label: string }>).map((t) => [t.id, t]),
  )

  return gatherUnifiedBoards(
    {
      nodes,
      orders,
      scopeTypeById,
      boByNode,
      openingDate,
      today: new Date().toISOString().slice(0, 10),
      docsByOrder: new Map(),
      drawingsByOrder: new Map(),
    },
    { showDecommissioned: false },
  )
}
