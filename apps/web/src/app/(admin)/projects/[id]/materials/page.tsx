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
import { projectService, listNodes, computeOrderRequiredBy, computeRagStatus, EQUIPMENT_KINDS } from '@esite/shared'
import { naturalCompare } from '@/lib/natural-compare'
import { Card, CardBody } from '@/components/ui/Card'
import type { OrderRowData } from './_components/OrderRow'
import type { OrderDoc } from './_components/OrderDocSlot'
import { MaterialOrderGroup } from './_components/MaterialOrderGroup'

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

// 'by_tenant' is intentionally omitted — tenant-supplied orders are excluded
// from the buy-list query, so there is no pill or status filter for them here.
const STATUS_ORDER: NodeOrderStatus[] = ['required', 'ordered', 'received']

const EMPTY_DOCS = (): OrderRowData['documents'] => ({
  quote: null,
  order_instruction: null,
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

  // ── BO inputs for required-by dates ──────────────────────────────────────
  // opening_date arrives via select('*'); pre-migration-00093 it is simply
  // absent. Tenant BO columns are read in a separate query so a pre-apply
  // 42703 fails closed — orders just get no required-by date.
  const openingDate: string | null =
    (project as { opening_date?: string | null }).opening_date ?? null

  const boByNode = new Map<string, { boPeriodDays: number | null; boDateOverride: string | null }>()
  const tenantNodeIds = nodes.filter((n) => n.kind === 'tenant_db').map((n) => n.id)
  if (tenantNodeIds.length > 0) {
    try {
      const { data } = await supabase
        .schema('structure')
        .from('tenant_details')
        .select('node_id, bo_period_days, bo_date_override')
        .in('node_id', tenantNodeIds)
      // Generated DB types lag migration 00093 — cast at the query boundary.
      for (const r of (data ?? []) as unknown as Array<{
        node_id: string
        bo_period_days: number | null
        bo_date_override: string | null
      }>) {
        boByNode.set(r.node_id, { boPeriodDays: r.bo_period_days, boDateOverride: r.bo_date_override })
      }
    } catch {
      // Non-fatal: pre-migration-00093 the columns don't exist — orders get no required-by.
    }
  }
  const today = new Date().toISOString().slice(0, 10)

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
      // Materials is a procurement buy-list: tenant-supplied items (status
      // 'by_tenant') are excluded — they live in the Tenant Schedule only.
      .neq('status', 'by_tenant')
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
      }
    } catch {
      // Non-fatal — orders still render, with empty doc slots.
    }
  }

  // ── node_order_shop_drawings — the multi-drawing list per order ──────────
  const drawingsByOrder = new Map<string, OrderRowData['shopDrawings']>()
  if (orderIds.length > 0) {
    try {
      const { data: rows } = await (supabase as never as {
        schema: (s: string) => { from: (t: string) => any }
      })
        .schema('structure')
        .from('node_order_shop_drawings')
        .select('id, node_order_id, file_name, storage_path, status, handover_category')
        .in('node_order_id', orderIds)
        .order('created_at', { ascending: true })
      for (const r of (rows ?? []) as Array<{
        id: string
        node_order_id: string
        file_name: string
        storage_path: string
        status: 'awaiting' | 'received' | 'approved'
        handover_category: string | null
      }>) {
        const list = drawingsByOrder.get(r.node_order_id) ?? []
        list.push({
          id: r.id,
          file_name: r.file_name,
          storage_path: r.storage_path,
          status: r.status,
          handover_category: (r.handover_category ?? null) as OrderRowData['shopDrawings'][number]['handover_category'],
        })
        drawingsByOrder.set(r.node_order_id, list)
      }
    } catch {
      // Non-fatal — orders still render with no drawings.
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
  // Built-in kinds use a fixed GroupKey; custom equipment nodes group under a
  // dynamic 'custom:<label>' key — one group per distinct custom type.
  const grouped = new Map<string, OrderRowData[]>()
  const customGroupLabel = new Map<string, string>()

  function pushTo(groupKey: string, row: OrderRowData) {
    let bucket = grouped.get(groupKey)
    if (!bucket) { bucket = []; grouped.set(groupKey, bucket) }
    bucket.push(row)
  }

  for (const o of filteredOrders) {
    const node = nodeById.get(o.node_id)
    // Required-by date: tenant orders (scope_item_type_id set) inherit their
    // tenant's BO date; equipment orders fall back to the project opening date.
    const bo =
      o.scope_item_type_id !== null
        ? boByNode.get(o.node_id) ?? { boPeriodDays: null, boDateOverride: null }
        : null
    const requiredBy = computeOrderRequiredBy({ openingDate, tenant: bo })
    const row: OrderRowData = {
      id: o.id,
      node_code: node?.code ?? o.node_id.slice(0, 8),
      node_name: node?.name ?? node?.shop_name ?? null,
      label: o.label,
      status: o.status,
      ordered_at: o.ordered_at,
      received_at: o.received_at,
      required_by: requiredBy,
      rag: computeRagStatus(requiredBy, o.status, today),
      notes: o.notes ?? '',
      documents: docsByOrder.get(o.id) ?? EMPTY_DOCS(),
      shopDrawings: drawingsByOrder.get(o.id) ?? [],
    }

    if (o.scope_item_type_id !== null) {
      const key = scopeTypeById.get(o.scope_item_type_id)?.key ?? ''
      pushTo(key === 'db' ? 'tenant_db' : key === 'lighting' ? 'tenant_lighting' : 'tenant_other', row)
    } else if (node?.kind === 'custom') {
      const lbl = node.custom_kind_label ?? 'Custom'
      const groupKey = `custom:${lbl}`
      customGroupLabel.set(groupKey, lbl)
      pushTo(groupKey, row)
    } else {
      const kind = node?.kind
      pushTo(
        kind === 'rmu' ? 'rmu' :
        kind === 'mini_sub' ? 'mini_sub' :
        kind === 'generator' ? 'generator' :
        kind === 'main_board' ? 'main_board' :
        kind === 'common_area_board' ? 'common_area_board' :
        kind === 'common_area_lighting' ? 'common_area_lighting' :
        'main_board',
        row,
      )
    }
  }

  // ── Harden the pull-through: surface equipment boards with no order row ───
  // Materials lists node_orders, so an equipment node created outside
  // createEquipmentNodeAction (e.g. a bulk import) has no order and would be
  // silently absent from the buy-list — the exact gap that hid 6 Kings Walk
  // boards. Render any such board as a synthetic 'required' row keyed to the
  // node, so an equipment board can never be silently dropped again. Synthetic
  // rows are read-only (no doc/status actions) until a real order exists —
  // see OrderRow.
  const equipmentKindSet = new Set<string>(EQUIPMENT_KINDS)
  const nodeIdsWithEquipmentOrder = new Set(
    rawOrders.filter((o) => o.scope_item_type_id === null).map((o) => o.node_id),
  )
  if (!activeStatus || activeStatus === 'required') {
    for (const node of nodes) {
      if (!equipmentKindSet.has(node.kind)) continue
      if (node.status !== 'active') continue
      if (nodeIdsWithEquipmentOrder.has(node.id)) continue
      const requiredBy = computeOrderRequiredBy({ openingDate, tenant: null })
      const row: OrderRowData = {
        id: `synthetic:${node.id}`,
        node_code: node.code,
        node_name: node.name ?? null,
        label: node.code,
        status: 'required',
        ordered_at: null,
        received_at: null,
        required_by: requiredBy,
        rag: computeRagStatus(requiredBy, 'required', today),
        notes: '',
        documents: EMPTY_DOCS(),
        shopDrawings: [],
        synthetic: true,
      }
      if (node.kind === 'custom') {
        const lbl = node.custom_kind_label ?? 'Custom'
        const groupKey = `custom:${lbl}`
        customGroupLabel.set(groupKey, lbl)
        pushTo(groupKey, row)
      } else {
        pushTo(node.kind, row)
      }
    }
  }

  // Within each group, order boards alphanumerically by code (natural sort:
  // DB-2 before DB-10). Replaces the prior required-by-date ordering — the RAG
  // pill still flags urgency per row.
  for (const bucket of grouped.values()) {
    bucket.sort((a, b) => naturalCompare(a.node_code, b.node_code))
  }

  // Display order: built-in groups first, then custom-type groups sorted by name.
  const customGroupKeys = [...grouped.keys()]
    .filter((k) => k.startsWith('custom:'))
    .sort((a, b) => a.localeCompare(b))
  const displayGroups: Array<{ key: string; label: string }> = [
    ...GROUP_ORDER.map((k) => ({ key: k as string, label: GROUP_LABEL[k] })),
    ...customGroupKeys.map((k) => ({ key: k, label: customGroupLabel.get(k) ?? 'Custom' })),
  ]

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

      {!openingDate && rawOrders.length > 0 && (
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--c-amber-dim)',
            border: '1px solid var(--c-amber)',
            borderRadius: 6,
            fontSize: 12,
            color: 'var(--c-amber)',
          }}
        >
          Set a project opening date in the Tenant Schedule to track these orders against
          beneficial-occupation deadlines.
        </div>
      )}

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

      {displayGroups.map(({ key: groupKey, label }) => {
        const rows = grouped.get(groupKey) ?? []
        if (rows.length === 0) return null
        return (
          <MaterialOrderGroup
            key={groupKey}
            label={label}
            rows={rows}
            projectId={projectId}
          />
        )
      })}
    </div>
  )
}
