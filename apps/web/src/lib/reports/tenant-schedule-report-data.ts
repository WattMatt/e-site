/**
 * gatherTenantScheduleReportData — I/O seam for the tenant schedule report.
 * Cookie client gates project access; service client does the privileged reads
 * and logo downloads. Pure number-crunching is delegated to the compute module.
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { projectService, listNodes, computeBoDate } from '@esite/shared'
import {
  computeReportModel,
  type ComputeInput,
  type OrderStatus,
  type ReportKpis,
  type ShopRow,
} from './tenant-schedule-report-compute'

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

  // 3. Tenant nodes (active + decommissioned carry a `status`).
  const allNodes = await listNodes(service as never, projectId, { kind: 'tenant_db' })
  const activeNodesRaw = allNodes.filter((n) => (n as { status?: string }).status !== 'decommissioned')
  const decommissionedCount = allNodes.length - activeNodesRaw.length
  const nodeIds = activeNodesRaw.map((n) => n.id)

  // 4. Parallel reads: scope types, tenant_details (scope/layout + BO), node_orders, project/org logo rows.
  const [typesRes, detailsRes, ordersRes, projRes] = await Promise.all([
    (service as any).schema('structure').from('scope_item_types')
      .select('id, key').eq('organisation_id', orgId),
    nodeIds.length
      ? (service as any).schema('structure').from('tenant_details')
          .select('node_id, scope_status, layout_status, bo_period_days, bo_date_override').in('node_id', nodeIds)
      : Promise.resolve({ data: [] }),
    nodeIds.length
      ? (service as any).schema('structure').from('node_orders')
          .select('node_id, scope_item_type_id, status').in('node_id', nodeIds).not('scope_item_type_id', 'is', null)
      : Promise.resolve({ data: [] }),
    (service as any).schema('projects').from('projects')
      .select('name, client_logo_url, project_logo_url, report_accent_color').eq('id', projectId).maybeSingle(),
  ])

  const types = (typesRes.data ?? []) as Array<{ id: string; key: string }>
  const scopeTypeIdByKey = {
    db: types.find((t) => t.key === 'db')?.id ?? null,
    lighting: types.find((t) => t.key === 'lighting')?.id ?? null,
  }

  const detailsByNode: ComputeInput['detailsByNode'] = new Map()
  const boByNode: ComputeInput['boByNode'] = new Map()
  for (const d of (detailsRes.data ?? []) as Array<{
    node_id: string; scope_status: string | null; layout_status: string | null
    bo_period_days: number | null; bo_date_override: string | null
  }>) {
    detailsByNode.set(d.node_id, {
      scopeReceived: d.scope_status === 'received',
      layoutIssued: d.layout_status === 'issued',
    })
    boByNode.set(d.node_id, {
      effectiveDate: computeBoDate(openingDate, d.bo_period_days ?? null, d.bo_date_override ?? null),
    })
  }

  const orderStatusByNodeScope: ComputeInput['orderStatusByNodeScope'] = new Map()
  for (const o of (ordersRes.data ?? []) as Array<{ node_id: string; scope_item_type_id: string; status: OrderStatus }>) {
    orderStatusByNodeScope.set(`${o.node_id}:${o.scope_item_type_id}`, o.status)
  }

  const proj = projRes.data as {
    name: string | null; client_logo_url: string | null; project_logo_url: string | null; report_accent_color: string | null
  } | null

  // 5. Org row + logos.
  const { data: orgData } = await (service as any).from('organisations')
    .select('name, logo_url, report_accent_color').eq('id', orgId).maybeSingle()
  const org = orgData as { name: string | null; logo_url: string | null; report_accent_color: string | null } | null

  const [orgLogoDataUri, clientLogoDataUri, projectMarkDataUri] = await Promise.all([
    org?.logo_url ? downloadToDataUri(service, LOGO_BUCKET, org.logo_url) : Promise.resolve(null),
    proj?.client_logo_url ? downloadToDataUri(service, LOGO_BUCKET, proj.client_logo_url) : Promise.resolve(null),
    proj?.project_logo_url ? downloadToDataUri(service, LOGO_BUCKET, proj.project_logo_url) : Promise.resolve(null),
  ])

  // 6. Compute + assemble.
  const { kpis, shopRows } = computeReportModel({
    activeNodes: activeNodesRaw.map((n) => ({
      id: n.id,
      shopNumber: (n as { shop_number?: string | null }).shop_number ?? (n as { code?: string }).code ?? '—',
      shopName: (n as { shop_name?: string | null }).shop_name ?? (n as { name?: string | null }).name ?? '—',
      glaM2: (n as { shop_area_m2?: number | null }).shop_area_m2 ?? null,
      // Incoming-supply electrical: a manual node breaker wins; otherwise the
      // value derived from the cable schedule (persisted incomer_* columns).
      breakerA:
        (n as { breaker_rating_a?: number | null }).breaker_rating_a ??
        (n as { incomer_breaker_a?: number | null }).incomer_breaker_a ?? null,
      poleConfig:
        (n as { pole_config?: string | null }).pole_config ??
        (n as { incomer_pole_config?: string | null }).incomer_pole_config ?? null,
      loadA: (n as { incomer_load_a?: number | null }).incomer_load_a ?? null,
    })),
    decommissionedCount,
    scopeTypeIdByKey,
    detailsByNode,
    orderStatusByNodeScope,
    boByNode,
    today: new Date().toISOString().slice(0, 10),
  })

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
