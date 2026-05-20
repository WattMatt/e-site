import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { projectService, listNodes } from '@esite/shared'
import { Card, CardBody } from '@/components/ui/Card'
import { ScheduleTable } from './_components/ScheduleTable'
import { ImportFlow } from './_components/ImportFlow'
import type { ScopeItemType, TenantScopeItem, TenantDetails } from './_components/ScopeOfWorkPanel'
import type { LayoutDetails } from './_components/LayoutIssuedPanel'
import type { NodeOrderData } from '../equipment-schedule/_components/NodeOrderCell'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Tenant Schedule' }

interface Props {
  params: Promise<{ id: string }>
}

export default async function TenantSchedulePage({ params }: Props) {
  const { id: projectId } = await params
  const supabase = await createClient()

  const project = await projectService
    .getById(supabase as never, projectId)
    .catch(() => null)
  if (!project) notFound()

  const orgId = project.organisation_id as string

  // ── Load nodes ────────────────────────────────────────────────────────────
  // listNodes reads via .schema('structure') SELECT (read-only — no cross-schema
  // write gotcha for SELECTs, only writes are affected).
  let nodes: Awaited<ReturnType<typeof listNodes>> = []
  let loadError: string | null = null

  try {
    nodes = await listNodes(supabase as never, projectId, { kind: 'tenant_db' })
  } catch (err: unknown) {
    loadError = err instanceof Error ? err.message : 'Could not load tenant schedule data'
  }

  // ── Load scope + layout data (best-effort; failures show the table without these) ──
  let scopeItemTypes: ScopeItemType[] = []
  let allScopeItems: TenantScopeItem[] = []
  let allTenantDetails: TenantDetails[] = []
  let allLayoutDetails: LayoutDetails[] = []

  const nodeIds = nodes.map((n) => n.id)

  try {
    // scope_item_types — org-level; READ via supabase-js .schema('structure') is fine
    const { data: types } = await supabase
      .schema('structure')
      .from('scope_item_types')
      .select('id, key, label, sort_order')
      .eq('organisation_id', orgId)
      .order('sort_order', { ascending: true })

    if (types) scopeItemTypes = types as ScopeItemType[]
  } catch {
    // Non-fatal: table may not exist on older staging, show empty columns
  }

  if (nodeIds.length > 0) {
    try {
      const { data: items } = await supabase
        .schema('structure')
        .from('tenant_scope_items')
        .select('id, node_id, scope_item_type_id, party')
        .in('node_id', nodeIds)

      if (items) allScopeItems = items as TenantScopeItem[]
    } catch {
      // Non-fatal
    }

    try {
      // Fetch both scope and layout columns in one query to avoid two round-trips
      const { data: details } = await supabase
        .schema('structure')
        .from('tenant_details')
        .select('node_id, scope_status, scope_document_path, layout_status, layout_issued_at, layout_drawing_path')
        .in('node_id', nodeIds)

      if (details) {
        allTenantDetails = (details as Array<TenantDetails & LayoutDetails>).map((d) => ({
          node_id: d.node_id,
          scope_status: d.scope_status,
          scope_document_path: d.scope_document_path,
        }))
        allLayoutDetails = (details as Array<TenantDetails & LayoutDetails>).map((d) => ({
          node_id: d.node_id,
          layout_status: d.layout_status ?? 'not_issued',
          layout_issued_at: d.layout_issued_at ?? null,
          layout_drawing_path: d.layout_drawing_path ?? null,
        }))
      }
    } catch {
      // Non-fatal
    }
  }

  // ── Load node_orders for tenant nodes (best-effort) ──────────────────────
  // Tenant orders have scope_item_type_id set (design-doc §3).
  // Key: `${node_id}:${scope_item_type_id}` → NodeOrderData
  // READ via .schema('structure') is safe — cross-schema gotcha is writes-only.
  const ordersByNodeAndScope: Record<string, NodeOrderData> = {}

  if (nodeIds.length > 0) {
    try {
      const { data: tenantOrders } = await supabase
        .schema('structure')
        .from('node_orders')
        .select('id, node_id, scope_item_type_id, status')
        .in('node_id', nodeIds)
        .not('scope_item_type_id', 'is', null)

      if (tenantOrders) {
        for (const o of tenantOrders as Array<{ id: string; node_id: string; scope_item_type_id: string; status: NodeOrderData['status'] }>) {
          ordersByNodeAndScope[`${o.node_id}:${o.scope_item_type_id}`] = { id: o.id, status: o.status }
        }
      }
    } catch {
      // Non-fatal: order status cells simply show "—" if unavailable
    }
  }

  // Build lookup maps for the client component
  const scopeItemsByNode: Record<string, TenantScopeItem[]> = {}
  for (const item of allScopeItems) {
    if (!scopeItemsByNode[item.node_id]) scopeItemsByNode[item.node_id] = []
    scopeItemsByNode[item.node_id].push(item)
  }

  const tenantDetailsByNode: Record<string, TenantDetails> = {}
  for (const d of allTenantDetails) {
    tenantDetailsByNode[d.node_id] = d
  }

  const layoutDetailsByNode: Record<string, LayoutDetails> = {}
  for (const d of allLayoutDetails) {
    layoutDetailsByNode[d.node_id] = d
  }

  const activeCount = nodes.filter((n) => n.status !== 'decommissioned').length
  const totalCount = nodes.length

  return (
    <div className="animate-fadeup">
      {/* Breadcrumb */}
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}`}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--c-text-dim)',
            textDecoration: 'none',
            letterSpacing: '0.06em',
          }}
        >
          ← {project.name}
        </Link>
      </div>

      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Tenant Schedule</h1>
          <p className="page-subtitle">
            {project.name}
            {totalCount > 0 &&
              ` · ${activeCount} active shop${activeCount !== 1 ? 's' : ''}${totalCount !== activeCount ? ` (${totalCount} total)` : ''}`}
          </p>
        </div>
        <ImportFlow projectId={projectId} />
      </div>

      {/* Fetch error */}
      {loadError && (
        <div
          style={{
            padding: '12px 16px',
            marginBottom: 16,
            background: 'var(--c-red-dim)',
            border: '1px solid var(--c-red)',
            borderRadius: 6,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--c-red)' }}>
            Could not load the tenant schedule.
          </div>
          <div style={{ fontSize: 13, color: 'var(--c-text-mid)' }}>{loadError}</div>
        </div>
      )}

      {/* Schedule table */}
      <Card>
        <CardBody>
          <ScheduleTable
            nodes={nodes}
            projectId={projectId}
            orgId={orgId}
            scopeItemTypes={scopeItemTypes}
            scopeItemsByNode={scopeItemsByNode}
            tenantDetailsByNode={tenantDetailsByNode}
            layoutDetailsByNode={layoutDetailsByNode}
            ordersByNodeAndScope={ordersByNodeAndScope}
          />
        </CardBody>
      </Card>
    </div>
  )
}
