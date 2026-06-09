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

export interface GeneratorReportData {
  projectName: string
  model: GeneratorCostRecoveryModel
  breakdown: CapitalBreakdown
  settings: GeneratorSettings
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
      .eq('kind', 'tenant_db'),

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
