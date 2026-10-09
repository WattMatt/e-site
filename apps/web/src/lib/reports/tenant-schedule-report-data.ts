/**
 * gatherTenantScheduleReportData — I/O seam for the tenant schedule report.
 * Cookie client gates project access; service client does the privileged reads
 * and logo downloads. Per-shop facts come from loadTenantShopFacts, the same
 * loader status plans use, so the report and the plans cannot drift.
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { projectService } from '@esite/shared'
import { loadTenantShopFacts } from '@/lib/tenant-schedule/shop-facts'
import { computeReportModel, type ReportKpis, type ShopRow } from './tenant-schedule-report-compute'

const LOGO_BUCKET = 'report-logos'
/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyService = ReturnType<typeof createServiceClient>

export interface TenantScheduleReportData {
  projectName: string
  kpis: ReportKpis
  shopRows: ShopRow[]
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

/** Download from a bucket → `data:<mime>;base64,…` URI, or null. */
async function downloadToDataUri(service: AnyService, bucket: string, storagePath: string): Promise<string | null> {
  try {
    const { data, error } = await (service as any).storage.from(bucket).download(storagePath)
    if (error || !data) return null
    const bytes = Buffer.from(await data.arrayBuffer())
    return `data:${data.type || 'image/png'};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}

export async function gatherTenantScheduleReportData(projectId: string): Promise<TenantScheduleReportData> {
  // 1. Gate via the RLS-aware cookie client (throws if no access / not found).
  const supabase = await createClient()
  const project = await projectService.getById(supabase as never, projectId).catch(() => null)
  if (!project) throw new Error('Project not found')
  const orgId = project.organisation_id as string
  const openingDate: string | null = (project as { opening_date?: string | null }).opening_date ?? null

  // 2. Service client for privileged reads (RLS bypassed — caller is gated above).
  const service = createServiceClient()

  // 3. Per-shop facts (the shared loader) + the project row for branding, in parallel.
  const [facts, projRes] = await Promise.all([
    loadTenantShopFacts(service, { projectId, orgId, openingDate }),
    (service as any).schema('projects').from('projects')
      .select('name, client_logo_url, project_logo_url, report_accent_color').eq('id', projectId).maybeSingle(),
  ])

  const proj = projRes.data as {
    name: string | null; client_logo_url: string | null; project_logo_url: string | null; report_accent_color: string | null
  } | null

  // 4. Org row + logos.
  const { data: orgData } = await (service as any).from('organisations')
    .select('name, logo_url, report_accent_color').eq('id', orgId).maybeSingle()
  const org = orgData as { name: string | null; logo_url: string | null; report_accent_color: string | null } | null

  const [orgLogoDataUri, clientLogoDataUri, projectMarkDataUri] = await Promise.all([
    org?.logo_url ? downloadToDataUri(service, LOGO_BUCKET, org.logo_url) : Promise.resolve(null),
    proj?.client_logo_url ? downloadToDataUri(service, LOGO_BUCKET, proj.client_logo_url) : Promise.resolve(null),
    proj?.project_logo_url ? downloadToDataUri(service, LOGO_BUCKET, proj.project_logo_url) : Promise.resolve(null),
  ])

  // 5. Compute + assemble.
  const { kpis, shopRows } = computeReportModel({ ...facts, today: new Date().toISOString().slice(0, 10) })

  const projectName = (proj?.name as string | null) ?? (project.name as string) ?? '—'
  return {
    projectName,
    kpis,
    shopRows,
    brandingInput: {
      orgName: (org?.name as string | null) ?? 'Organisation',
      orgLogoDataUri,
      orgAccent: (org?.report_accent_color as string | null) ?? null,
      projectAccent: (proj?.report_accent_color as string | null) ?? null,
      clientLogoDataUri,
      projectMarkDataUri,
      projectSubtitle: 'Tenant coordination',
    },
  }
}