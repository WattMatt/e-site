/**
 * Material Order Tracker — the Materials tab.
 *
 * One list of order items, loaded from the Tenant Schedule (one per scope item)
 * and the Equipment Schedule (one per equipment node), each tracked
 * required → ordered → received, with three document slots — Quote, Order
 * Instruction, Shop Drawing.
 *
 * Read pattern: .schema('structure') SELECT is safe (the cross-schema gotcha is
 * writes-only). Writes are in node-order.actions.ts / node-order-document.actions.ts.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { projectService, listNodes } from '@esite/shared'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { OrderRow, type OrderRowData } from './_components/OrderRow'
import type { OrderDoc } from './_components/OrderDocSlot'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Material Orders' }

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NodeOrderStatus = 'by_tenant' | 'required' | 'ordered' | 'received'

interface RawNodeOrder {
  id: string
  node_id: string
  label: string
  scope_item_type_id: string | null
  status: NodeOrderStatus
  ordered_at: string | null
  received_at: string | null
  notes: string
}

type GroupKey =
  | 'tenant_db'
  | 'tenant_lighting'
  | 'tenant_other'
  | 'rmu'
  | 'mini_sub'
  | 'generator'
  | 'main_board'
  | 'common_area_board'
  | 'common_area_lighting'

const GROUP_LABEL: Record<GroupKey, string> = {
  tenant_db: 'Tenant DB Orders',
  tenant_lighting: 'Tenant Lighting Orders',
  tenant_other: 'Tenant Other-Scope Orders',
  rmu: 'Ring Main Units (RMU)',
  mini_sub: 'Mini-Substations',
  generator: 'Generators',
  main_board: 'Main Boards',
  common_area_board: 'Common Area Boards',
  common_area_lighting: 'Common Area Lighting',
}

const GROUP_ORDER: GroupKey[] = [
  'tenant_db',
  'tenant_lighting',
  'tenant_other',
  'rmu',
  'mini_sub',
  'generator',
  'main_board',
  'common_area_board',
  'common_area_lighting',
]

const STATUS_LABEL: Record<NodeOrderStatus, string> = {
  by_tenant: 'By tenant',
  required: 'Required',
  ordered: 'Ordered',
  received: 'Received',
}

const STATUS_ORDER: NodeOrderStatus[] = ['by_tenant', 'required', 'ordered', 'received']

const EMPTY_DOCS = (): OrderRowData['documents'] => ({
  quote: null,
  order_instruction: null,
  shop_drawing: null,
})

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ status?: string }>
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function MaterialOrdersPage({ params, searchParams }: Props) {
  const { id: projectId } = await params
  const { status: statusFilter } = await searchParams

  const supabase = await createClient()

  const project = await projectService.getById(supabase as never, projectId).catch(() => null)
  if (!project) notFound()

  // ── Nodes — enrich orders with code + name + kind ────────────────────────
  let nodes: Awaited<ReturnType<typeof listNodes>> = []
  try {
    nodes = await listNodes(supabase as never, projectId)
  } catch {
    // Non-fatal
  }
  const nodeById = new Map(nodes.map((n) => [n.id, n]))

  // ── Scope item types — classify tenant orders ────────────────────────────
  const orgId = project.organisation_id as string
  let scopeItemTypes: Array<{ id: string; key: string; label: string }> = []
  try {
    const { data } = await supabase
      .schema('structure')
      .from('scope_item_types')
      .select('id, key, label')
      .eq('organisation_id', orgId)
    if (data) scopeItemTypes = data as typeof scopeItemTypes
  } catch {
    // Non-fatal
  }
  const scopeTypeById = new Map(scopeItemTypes.map((t) => [t.id, t]))

  // ── node_orders ──────────────────────────────────────────────────────────
  let rawOrders: RawNodeOrder[] = []
  let loadError: string | null = null
  try {
    const { data, error } = await supabase
      .schema('structure')
      .from('node_orders')
      .select('id, node_id, label, scope_item_type_id, status, ordered_at, received_at, notes')
      .eq('project_id', projectId)
      .order('label', { ascending: true })
    if (error) throw error
    if (data) rawOrders = data as RawNodeOrder[]
  } catch (err: unknown) {
    loadError = err instanceof Error ? err.message : 'Could not load material orders'
  }

  // ── node_order_documents — the three slots per order ─────────────────────
  const docsByOrder = new Map<string, OrderRowData['documents']>()
  const orderIds = rawOrders.map((o) => o.id)
  if (orderIds.length > 0) {
    try {
      const { data: docs } = await (supabase as never as {
        schema: (s: string) => { from: (t: string) => any }
      })
        .schema('structure')
        .from('node_order_documents')
        .select('node_order_id, doc_type, storage_path, file_name')
        .in('node_order_id', orderIds)
      for (const d of (docs ?? []) as Array<{
        node_order_id: string
        doc_type: string
        storage_path: string
        file_name: string
      }>) {
        let entry = docsByOrder.get(d.node_order_id)
        if (!entry) {
          entry = EMPTY_DOCS()
          docsByOrder.set(d.node_order_id, entry)
        }
        const ref: OrderDoc = { storage_path: d.storage_path, file_name: d.file_name }
        if (d.doc_type === 'quote') entry.quote = ref
        else if (d.doc_type === 'order_instruction') entry.order_instruction = ref
        else if (d.doc_type === 'shop_drawing') entry.shop_drawing = ref
      }
    } catch {
      // Non-fatal — orders still render, with empty doc slots.
    }
  }

  // ── Status filter ────────────────────────────────────────────────────────
  const validStatuses = new Set<string>(STATUS_ORDER)
  const activeStatus: NodeOrderStatus | null =
    statusFilter && validStatuses.has(statusFilter) ? (statusFilter as NodeOrderStatus) : null

  const filteredOrders = activeStatus
    ? rawOrders.filter((o) => o.status === activeStatus)
    : rawOrders

  // ── Group ────────────────────────────────────────────────────────────────
  const grouped = new Map<GroupKey, OrderRowData[]>()
  for (const key of GROUP_ORDER) grouped.set(key, [])

  for (const o of filteredOrders) {
    const node = nodeById.get(o.node_id)
    const row: OrderRowData = {
      id: o.id,
      node_code: node?.code ?? o.node_id.slice(0, 8),
      node_name: node?.name ?? node?.shop_name ?? null,
      label: o.label,
      status: o.status,
      ordered_at: o.ordered_at,
      received_at: o.received_at,
      notes: o.notes ?? '',
      documents: docsByOrder.get(o.id) ?? EMPTY_DOCS(),
    }

    if (o.scope_item_type_id !== null) {
      const key = scopeTypeById.get(o.scope_item_type_id)?.key ?? ''
      const groupKey: GroupKey =
        key === 'db' ? 'tenant_db' : key === 'lighting' ? 'tenant_lighting' : 'tenant_other'
      grouped.get(groupKey)!.push(row)
    } else {
      const kind = node?.kind
      const groupKey: GroupKey =
        kind === 'rmu' ? 'rmu' :
        kind === 'mini_sub' ? 'mini_sub' :
        kind === 'generator' ? 'generator' :
        kind === 'main_board' ? 'main_board' :
        kind === 'common_area_board' ? 'common_area_board' :
        kind === 'common_area_lighting' ? 'common_area_lighting' :
        'main_board'
      grouped.get(groupKey)!.push(row)
    }
  }

  const countByStatus: Record<NodeOrderStatus, number> = {
    by_tenant: 0,
    required: 0,
    ordered: 0,
    received: 0,
  }
  for (const o of rawOrders) {
    if (countByStatus[o.status] !== undefined) countByStatus[o.status]++
  }

  const totalFiltered = filteredOrders.length
  const base = `/projects/${projectId}/materials`

  const th: React.CSSProperties = {
    padding: '8px 12px',
    textAlign: 'left',
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--c-text-dim)',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  }

  return (
    <div className="animate-fadeup" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Material Orders</h1>
          <p className="page-subtitle">
            {project.name} · order items from the Tenant &amp; Equipment schedules
          </p>
        </div>
      </div>

      {/* Status filter pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        <Link href={base} className={!activeStatus ? 'badge badge-green' : 'badge badge-muted'}>
          All
          <span style={{ marginLeft: '0.3rem', opacity: 0.7 }}>{rawOrders.length}</span>
        </Link>
        {STATUS_ORDER.map((s) => (
          <Link
            key={s}
            href={`${base}?status=${s}`}
            className={activeStatus === s ? 'badge badge-green' : 'badge badge-muted'}
          >
            {STATUS_LABEL[s]}
            <span style={{ marginLeft: '0.3rem', opacity: 0.7 }}>{countByStatus[s]}</span>
          </Link>
        ))}
      </div>

      {loadError && (
        <div style={{ padding: '12px 16px', background: 'var(--c-red-dim)', border: '1px solid var(--c-red)', borderRadius: 6 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--c-red)' }}>
            Could not load material orders.
          </div>
          <div style={{ fontSize: 13, color: 'var(--c-text-mid)' }}>{loadError}</div>
        </div>
      )}

      {!loadError && totalFiltered === 0 && (
        <Card>
          <CardBody>
            <p style={{ color: 'var(--c-text-dim)', fontSize: 13, textAlign: 'center', padding: '2rem 0' }}>
              {activeStatus
                ? `No orders with status "${STATUS_LABEL[activeStatus]}".`
                : 'No material orders yet. Orders are derived from the schedules — set scope items in the Tenant Schedule or add nodes in the Equipment Schedule.'}
            </p>
          </CardBody>
        </Card>
      )}

      {GROUP_ORDER.map((groupKey) => {
        const rows = grouped.get(groupKey) ?? []
        if (rows.length === 0) return null
        return (
          <Card key={groupKey}>
            <CardHeader>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--c-text)' }}>
                  {GROUP_LABEL[groupKey]}
                </span>
                <Badge variant="ghost">{rows.length}</Badge>
              </div>
            </CardHeader>
            <CardBody>
              <div style={{ overflowX: 'auto', margin: '-14px -18px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--c-border)', background: 'var(--c-panel-alt, var(--c-panel))' }}>
                      <th style={th}>Node</th>
                      <th style={th}>Label</th>
                      <th style={th}>Status</th>
                      <th style={th}>Ordered</th>
                      <th style={th}>Received</th>
                      <th style={th}>Documents</th>
                      <th style={th}>Notes</th>
                      <th style={th}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((order) => (
                      <OrderRow key={order.id} order={order} projectId={projectId} />
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        )
      })}
    </div>
  )
}
