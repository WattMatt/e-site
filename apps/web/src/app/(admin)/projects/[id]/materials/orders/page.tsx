/**
 * Node Orders view — Task 4.4
 *
 * Lists all node_orders for the project, grouped by type (tenant DB, tenant lighting,
 * tenant other-scope, equipment by kind) with a status filter.
 *
 * Design-doc §6: "a new view alongside the existing 5-stage pages — not a replacement."
 * The existing materials pipeline (plan/quote/order/deliver/pay) is UNTOUCHED.
 *
 * Read pattern: .schema('structure') SELECT is safe (cross-schema gotcha is writes-only).
 * Write pattern: handled in node-order.actions.ts (Task 4.3) via raw PostgREST.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { projectService, listNodes } from '@esite/shared'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { OrderRow, type OrderRowData } from './_components/OrderRow'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Node Orders' }

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

// Grouping keys — tenant DB orders, tenant lighting, tenant other-scope, then
// equipment by kind (rmu, mini_sub, generator, main_board, common_area_board).
type GroupKey =
  | 'tenant_db'
  | 'tenant_lighting'
  | 'tenant_other'
  | 'rmu'
  | 'mini_sub'
  | 'generator'
  | 'main_board'
  | 'common_area_board'

const GROUP_LABEL: Record<GroupKey, string> = {
  tenant_db:           'Tenant DB Orders',
  tenant_lighting:     'Tenant Lighting Orders',
  tenant_other:        'Tenant Other-Scope Orders',
  rmu:                 'Ring Main Units (RMU)',
  mini_sub:            'Mini-Substations',
  generator:           'Generators',
  main_board:          'Main Boards',
  common_area_board:   'Common Area Boards',
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
]

// Status display for the filter pills
const STATUS_LABEL: Record<NodeOrderStatus, string> = {
  by_tenant: 'By tenant',
  required:  'Required',
  ordered:   'Ordered',
  received:  'Received',
}

const STATUS_ORDER: NodeOrderStatus[] = ['by_tenant', 'required', 'ordered', 'received']

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

export default async function NodeOrdersPage({ params, searchParams }: Props) {
  const { id: projectId } = await params
  const { status: statusFilter } = await searchParams

  const supabase = await createClient()

  const project = await projectService
    .getById(supabase as never, projectId)
    .catch(() => null)
  if (!project) notFound()

  // ── Load all nodes so we can enrich orders with code + name ──────────────
  let nodes: Awaited<ReturnType<typeof listNodes>> = []
  try {
    nodes = await listNodes(supabase as never, projectId)
  } catch {
    // Non-fatal: will render orders with node_id as fallback
  }
  const nodeById = new Map(nodes.map((n) => [n.id, n]))

  // ── Load scope_item_types so we can classify tenant orders ───────────────
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

  // Build a map from scope_item_type_id → key (db, lighting, or other)
  const scopeTypeById = new Map(scopeItemTypes.map((t) => [t.id, t]))

  // ── Load node_orders for this project ────────────────────────────────────
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
    loadError = err instanceof Error ? err.message : 'Could not load node orders'
  }

  // ── Apply status filter ───────────────────────────────────────────────────
  const validStatuses = new Set<string>(STATUS_ORDER)
  const activeStatus: NodeOrderStatus | null =
    statusFilter && validStatuses.has(statusFilter)
      ? (statusFilter as NodeOrderStatus)
      : null

  const filteredOrders = activeStatus
    ? rawOrders.filter((o) => o.status === activeStatus)
    : rawOrders

  // ── Build grouped data ───────────────────────────────────────────────────
  // Determine which group each order belongs to:
  //   - scope_item_type_id set → tenant order; classify by the type key
  //     key 'db' → 'tenant_db', key 'lighting' → 'tenant_lighting', other → 'tenant_other'
  //   - scope_item_type_id null → equipment order; classify by the node's kind
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
    }

    if (o.scope_item_type_id !== null) {
      // Tenant order — classify by scope item key
      const stype = scopeTypeById.get(o.scope_item_type_id)
      const key = stype?.key ?? ''
      let groupKey: GroupKey
      if (key === 'db') {
        groupKey = 'tenant_db'
      } else if (key === 'lighting') {
        groupKey = 'tenant_lighting'
      } else {
        groupKey = 'tenant_other'
      }
      grouped.get(groupKey)!.push(row)
    } else {
      // Equipment order — classify by node kind
      const kind = node?.kind
      const groupKey: GroupKey =
        kind === 'rmu'               ? 'rmu'               :
        kind === 'mini_sub'          ? 'mini_sub'          :
        kind === 'generator'         ? 'generator'         :
        kind === 'main_board'        ? 'main_board'        :
        kind === 'common_area_board' ? 'common_area_board' :
        'main_board' // fallback for unknown equipment kinds
      grouped.get(groupKey)!.push(row)
    }
  }

  // Count per status for the filter pills
  const countByStatus: Record<NodeOrderStatus, number> = {
    by_tenant: 0,
    required:  0,
    ordered:   0,
    received:  0,
  }
  for (const o of rawOrders) {
    if (countByStatus[o.status] !== undefined) countByStatus[o.status]++
  }

  const totalFiltered = filteredOrders.length
  const base = `/projects/${projectId}/materials/orders`

  return (
    <div className="animate-fadeup" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Node Orders</h1>
          <p className="page-subtitle">
            {project.name} · order requirements derived from structure nodes
          </p>
        </div>
      </div>

      {/* Status filter pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        <Link
          href={base}
          className={!activeStatus ? 'badge badge-green' : 'badge badge-muted'}
        >
          All
          <span style={{ marginLeft: '0.3rem', opacity: 0.7 }}>{rawOrders.length}</span>
        </Link>
        {STATUS_ORDER.map((s) => {
          const active = activeStatus === s
          return (
            <Link
              key={s}
              href={`${base}?status=${s}`}
              className={active ? 'badge badge-green' : 'badge badge-muted'}
            >
              {STATUS_LABEL[s]}
              <span style={{ marginLeft: '0.3rem', opacity: 0.7 }}>{countByStatus[s]}</span>
            </Link>
          )
        })}
      </div>

      {/* Fetch error */}
      {loadError && (
        <div
          style={{
            padding: '12px 16px',
            background: 'var(--c-red-dim)',
            border: '1px solid var(--c-red)',
            borderRadius: 6,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--c-red)' }}>
            Could not load node orders.
          </div>
          <div style={{ fontSize: 13, color: 'var(--c-text-mid)' }}>{loadError}</div>
        </div>
      )}

      {/* Empty state (post-filter) */}
      {!loadError && totalFiltered === 0 && (
        <Card>
          <CardBody>
            <p style={{ color: 'var(--c-text-dim)', fontSize: 13, textAlign: 'center', padding: '2rem 0' }}>
              {activeStatus
                ? `No orders with status "${STATUS_LABEL[activeStatus]}".`
                : 'No node orders yet. Orders are derived from structure nodes — add tenant nodes via the Tenant Schedule or equipment nodes via the Equipment Schedule.'}
            </p>
          </CardBody>
        </Card>
      )}

      {/* Group cards */}
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
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--c-text-dim)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Node</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--c-text-dim)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Label</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--c-text-dim)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Status</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--c-text-dim)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Ordered</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--c-text-dim)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Received</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--c-text-dim)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Notes</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--c-text-dim)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Actions</th>
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
