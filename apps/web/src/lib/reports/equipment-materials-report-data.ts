/**
 * gatherEquipmentMaterialsReportData — I/O seam for the Equipment & Materials
 * report.
 *
 * Authorization is ORG_WRITE_ROLES, deliberately stricter than the tenant
 * schedule report's view-level gate. That report is a read-derived snapshot of
 * what any project member can already see; this one prints order notes and
 * quote/order-instruction status, which the client portal withholds as
 * commercial artefacts. See lib/reports/report-kind-access.ts.
 *
 * Gate on the RLS-aware cookie client, then read through the service client —
 * the same shape as gatherTenantScheduleReportData.
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { ORG_WRITE_ROLES } from '@esite/shared'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { loadEquipmentMaterialsData } from '@/lib/equipment-materials/load'
import { gatherUnifiedBoards } from '@/lib/equipment-materials/gather-unified-boards'
import {
  computeEquipmentReportModel,
  type EquipmentReportKpis,
  type EquipmentRegisterRow,
} from './equipment-materials-report-compute'

const LOGO_BUCKET = 'report-logos'
/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyService = ReturnType<typeof createServiceClient>

/** Thrown for an authorization failure so routes can map it to 403, not 500. */
export class ReportAccessError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReportAccessError'
  }
}

export interface EquipmentMaterialsReportData {
  projectName: string
  kpis: EquipmentReportKpis
  rows: EquipmentRegisterRow[]
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

async function downloadToDataUri(
  service: AnyService,
  bucket: string,
  storagePath: string,
): Promise<string | null> {
  try {
    const { data, error } = await (service as any).storage.from(bucket).download(storagePath)
    if (error || !data) return null
    const bytes = Buffer.from(await data.arrayBuffer())
    return `data:${data.type || 'image/png'};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}

export async function gatherEquipmentMaterialsReportData(
  projectId: string,
): Promise<EquipmentMaterialsReportData> {
  // 1. Gate.
  const supabase = await createClient()
  const guard = await requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)
  if (!guard.ok) throw new ReportAccessError(guard.error)

  // 2. Privileged reads through the shared loader — the same one the tab uses,
  //    so the PDF and the screen cannot disagree.
  const service = createServiceClient()
  const load = await loadEquipmentMaterialsData(service, projectId)
  if (!load.project) throw new Error('Project not found')

  // 3. Shape + compute. Decommissioned boards are always excluded: a saved
  //    deliverable must mean one thing, so on-screen filters have no effect here.
  const groups = gatherUnifiedBoards(load.gatherInput, { showDecommissioned: false })
  const { kpis, rows } = computeEquipmentReportModel({
    groups,
    decommissionedCount: load.decommissionedCount,
  })

  // 4. Branding assets.
  const orgId = load.project.organisationId

  const [{ data: projBrandRow }, { data: orgRow }] = await Promise.all([
    (service as any)
      .schema('projects')
      .from('projects')
      .select('client_logo_url, project_logo_url, report_accent_color')
      .eq('id', projectId)
      .maybeSingle(),
    (service as any)
      .from('organisations')
      .select('name, logo_url, report_accent_color')
      .eq('id', orgId)
      .maybeSingle(),
  ])

  const proj = projBrandRow as {
    client_logo_url: string | null
    project_logo_url: string | null
    report_accent_color: string | null
  } | null
  const org = orgRow as {
    name: string | null
    logo_url: string | null
    report_accent_color: string | null
  } | null

  const [orgLogoDataUri, clientLogoDataUri, projectMarkDataUri] = await Promise.all([
    org?.logo_url ? downloadToDataUri(service, LOGO_BUCKET, org.logo_url) : Promise.resolve(null),
    proj?.client_logo_url
      ? downloadToDataUri(service, LOGO_BUCKET, proj.client_logo_url)
      : Promise.resolve(null),
    proj?.project_logo_url
      ? downloadToDataUri(service, LOGO_BUCKET, proj.project_logo_url)
      : Promise.resolve(null),
  ])

  return {
    projectName: load.project.name,
    kpis,
    rows,
    brandingInput: {
      orgName: org?.name ?? 'Organisation',
      orgLogoDataUri,
      orgAccent: org?.report_accent_color ?? null,
      projectAccent: proj?.report_accent_color ?? null,
      clientLogoDataUri,
      projectMarkDataUri,
      projectSubtitle: 'Equipment & materials',
    },
  }
}

/** Headline figures stored on the saved row so the history list never re-gathers. */
export function buildEquipmentReportSummary(kpis: EquipmentReportKpis): Record<string, number> {
  return {
    boards: kpis.totalBoards,
    lines: kpis.totalLines,
    received: kpis.status.received,
    overdue: kpis.schedule.overdue,
    receivedPct: kpis.receivedPct,
  }
}
