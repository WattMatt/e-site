/**
 * gatherGeneratorReportData — the I/O seam between the GCR data model and
 * the react-pdf generator cost-recovery report document.
 *
 * Mirrors the structure of gatherInspectionReportData: cookie client for the
 * gate; service client for all privileged reads; parallel reads; logos
 * downloaded as data: URIs; plain serializable result returned.
 *
 * RBAC: gated via requireEffectiveRole + COST_VIEW_ROLES (same gate as
 * loadGcrConfigAction in gcr.actions.ts).
 */

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import {
  COST_VIEW_ROLES,
  buildGeneratorCostRecovery,
  mapDbToEngineInput,
  capitalCostBreakdown,
  checkReadiness,
  DEFAULT_REPORT_NARRATIVE,
  type ReportNarrative,
  type GeneratorCostRecoveryModel,
  type GeneratorSettings,
  type CapitalBreakdown,
  type GcrSettingsRow,
  type GcrZoneRow,
  type GcrZoneGeneratorRow,
  type TenantNodeRow,
  type GcrTenantAssignmentRow,
} from '@esite/shared'

// ─── Public, serializable payload shape ──────────────────────────────────────

/** Per-zone (board/centre) load roll-up for the Plant Sizing table. */
export interface ZoneSummary {
  zoneName: string
  tenantCount: number
  totalLoadKw: number
  requiredKva: number
  installedKva: number
}

export interface GeneratorReportData {
  projectName: string
  model: GeneratorCostRecoveryModel
  breakdown: CapitalBreakdown
  settings: GeneratorSettings
  narrative: ReportNarrative
  /** checkReadiness gaps — empty when the data is complete enough to publish. */
  readinessGaps: string[]
  /** shopNumber → zone (board/centre) name, or null when unassigned. */
  zoneByShop: Record<string, string | null>
  /** Per-zone load roll-up, ordered as zones are returned (display_order). */
  zoneSummaries: ZoneSummary[]
  brandingInput: {
    orgName: string
    orgLogoDataUri: string | null
    orgAccent: string | null
    projectAccent: string | null
    clientLogoDataUri: string | null
    projectMarkDataUri: string | null
    projectSubtitle: string
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyService = ReturnType<typeof createServiceClient>

const LOGO_BUCKET = 'report-logos'

/** Download from a bucket and return a `data:<mime>;base64,…` URI, or null. */
async function downloadToDataUri(
  service: AnyService,
  bucket: string,
  storagePath: string,
): Promise<string | null> {
  try {
    const { data, error } = await (service as any).storage.from(bucket).download(storagePath)
    if (error || !data) return null
    const arrayBuf = await data.arrayBuffer()
    const bytes = Buffer.from(arrayBuf)
    const mime = data.type || 'image/png'
    return `data:${mime};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}

/**
 * Roll allocations up to their zone (board/centre) for the Plant Sizing table
 * and the grouped schedule. Pure presentation — apportionment stays global
 * (percent is of the site total); this only buckets by zone for display.
 */
function summariseZones(args: {
  zones: Array<{ id: string; zone_name: string }>
  generators: Array<{ zone_id: string; generator_size: string | null }>
  tenants: Array<{ id: string; shop_number: string | null }>
  assignments: Array<{ node_id: string; zone_id: string | null }>
  allocations: GeneratorCostRecoveryModel['allocations']
  powerFactor: number
}): { zoneByShop: Record<string, string | null>; zoneSummaries: ZoneSummary[] } {
  const { zones, generators, tenants, assignments, allocations, powerFactor } = args

  const nodeByShop = new Map<string, string>()
  for (const t of tenants) if (t.shop_number) nodeByShop.set(t.shop_number, t.id)

  const zoneIdByNode = new Map<string, string>()
  for (const a of assignments) if (a.zone_id) zoneIdByNode.set(a.node_id, a.zone_id)

  const zoneNameById = new Map<string, string>()
  for (const z of zones) zoneNameById.set(z.id, z.zone_name)

  const zoneIdForShop = (shopNumber: string): string | undefined => {
    const nodeId = nodeByShop.get(shopNumber)
    return nodeId ? zoneIdByNode.get(nodeId) : undefined
  }

  const zoneByShop: Record<string, string | null> = {}
  for (const a of allocations) {
    const zoneId = zoneIdForShop(a.shopNumber)
    zoneByShop[a.shopNumber] = zoneId ? (zoneNameById.get(zoneId) ?? null) : null
  }

  const installedByZone = new Map<string, number>()
  for (const g of generators) {
    const kva = parseInt(g.generator_size ?? '', 10)
    if (!Number.isNaN(kva)) installedByZone.set(g.zone_id, (installedByZone.get(g.zone_id) ?? 0) + kva)
  }

  const pf = powerFactor > 0 ? powerFactor : 1

  const zoneSummaries: ZoneSummary[] = zones.map((z) => {
    const inZone = allocations.filter((a) => zoneIdForShop(a.shopNumber) === z.id)
    const totalLoadKw = inZone.reduce((sum, a) => sum + a.loadingKw, 0)
    return {
      zoneName: z.zone_name,
      tenantCount: inZone.length,
      totalLoadKw,
      requiredKva: totalLoadKw / pf,
      installedKva: installedByZone.get(z.id) ?? 0,
    }
  })

  return { zoneByShop, zoneSummaries }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function gatherGeneratorReportData(
  projectId: string,
): Promise<GeneratorReportData> {
  // 1. Cookie client for the auth gate.
  const supabase = await createClient()

  // 2. Gate: COST_VIEW_ROLES (same as loadGcrConfigAction).
  const gate = await requireEffectiveRole(supabase, projectId, COST_VIEW_ROLES)
  if (!gate.ok) throw new Error(gate.error)

  // 3. Service client — all privileged reads go through it.
  const service = createServiceClient()

  // 4. Parallel reads.
  const [
    settingsRes,
    zonesRes,
    generatorsRes,
    tenantsRes,
    assignmentsRes,
    projectRes,
  ] = await Promise.all([
    (service as any)
      .schema('gcr')
      .from('settings')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle(),

    (service as any)
      .schema('gcr')
      .from('zones')
      .select('*')
      .eq('project_id', projectId)
      .order('display_order'),

    (service as any)
      .schema('gcr')
      .from('zone_generators')
      .select('*, zones!inner(project_id)')
      .eq('zones.project_id', projectId),

    (service as any)
      .schema('structure')
      .from('nodes')
      .select('id, shop_number, shop_name, shop_area_m2, shop_category, generator_participation')
      .eq('project_id', projectId)
      .eq('kind', 'tenant_db')
      // Mirror loadGcrConfigAction: decommissioned / binned tenants must not be
      // billed — without these filters they surfaced (and were charged) under
      // "Unzoned" after a re-import decommissioned them.
      .is('deleted_at', null)
      .neq('status', 'decommissioned'),

    (service as any)
      .schema('gcr')
      .from('tenant_assignments')
      .select('*')
      .eq('project_id', projectId),

    (service as any)
      .schema('projects')
      .from('projects')
      .select('name, organisation_id, client_logo_url, project_logo_url, report_accent_color')
      .eq('id', projectId)
      .maybeSingle(),
  ])

  const project = projectRes.data as {
    name: string | null
    organisation_id: string | null
    client_logo_url: string | null
    project_logo_url: string | null
    report_accent_color: string | null
  } | null

  // 5. Org row — needs organisation_id from project.
  const orgId = project?.organisation_id ?? null
  const { data: orgData } = orgId
    ? await (service as any)
        .from('organisations')
        .select('name, logo_url, report_accent_color')
        .eq('id', orgId)
        .maybeSingle()
    : { data: null }

  const org = orgData as { name: string | null; logo_url: string | null; report_accent_color: string | null } | null

  // 6. Map DB rows → engine input → model + breakdown.
  const engineInput = mapDbToEngineInput({
    settings: (settingsRes.data ?? null) as GcrSettingsRow | null,
    zones: (zonesRes.data ?? []) as GcrZoneRow[],
    generators: (generatorsRes.data ?? []) as GcrZoneGeneratorRow[],
    tenants: (tenantsRes.data ?? []) as TenantNodeRow[],
    assignments: (assignmentsRes.data ?? []) as GcrTenantAssignmentRow[],
  })

  const model = buildGeneratorCostRecovery(engineInput)
  const breakdown = capitalCostBreakdown(engineInput.zones, engineInput.tenants, engineInput.settings)

  // Readiness — same check the UI uses to gate "Generate report".
  const readiness = checkReadiness({
    settings: (settingsRes.data ?? null) as GcrSettingsRow | null,
    zones: (zonesRes.data ?? []) as GcrZoneRow[],
    generators: (generatorsRes.data ?? []) as GcrZoneGeneratorRow[],
    tenantNodes: (tenantsRes.data ?? []) as TenantNodeRow[],
  })

  // Zone roll-up for the Plant Sizing table + grouped schedule (presentation only).
  const { zoneByShop, zoneSummaries } = summariseZones({
    zones: (zonesRes.data ?? []) as never,
    generators: (generatorsRes.data ?? []) as never,
    tenants: (tenantsRes.data ?? []) as never,
    assignments: (assignmentsRes.data ?? []) as never,
    allocations: model.allocations,
    powerFactor: engineInput.settings.powerFactor,
  })

  // 7. Download logos as data: URIs.
  const [orgLogoDataUri, clientLogoDataUri, projectMarkDataUri] = await Promise.all([
    org?.logo_url ? downloadToDataUri(service, LOGO_BUCKET, org.logo_url) : Promise.resolve(null),
    project?.client_logo_url
      ? downloadToDataUri(service, LOGO_BUCKET, project.client_logo_url)
      : Promise.resolve(null),
    project?.project_logo_url
      ? downloadToDataUri(service, LOGO_BUCKET, project.project_logo_url)
      : Promise.resolve(null),
  ])

  // 8. Assemble and return.
  return {
    projectName: (project?.name as string | null) ?? '—',
    model,
    breakdown,
    settings: engineInput.settings,
    // Standing prose sections. Defaults for now; per-project editable text
    // (gcr.settings narrative columns) is wired in a later increment.
    narrative: DEFAULT_REPORT_NARRATIVE,
    readinessGaps: readiness.gaps,
    zoneByShop,
    zoneSummaries,
    brandingInput: {
      orgName: (org?.name as string | null) ?? 'Organisation',
      orgLogoDataUri,
      orgAccent: (org?.report_accent_color as string | null) ?? null,
      projectAccent: (project?.report_accent_color as string | null) ?? null,
      clientLogoDataUri,
      projectMarkDataUri,
      projectSubtitle: (project?.name as string | null) ?? '',
    },
  }
}
