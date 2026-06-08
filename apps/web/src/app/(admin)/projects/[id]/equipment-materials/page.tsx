/**
 * Equipment & Materials — the unified board-centric tab.
 *
 * One list where the BOARD is the unit of work and its procurement (status,
 * dates, documents) is an expandable detail. Existence-driven: every
 * structure.nodes row appears (D5); procurement is attached from node_orders.
 * Equipment boards carry one order; tenant/shop boards carry their scope-order
 * lines + a rollup.
 *
 * This route is NOT yet linked in the sidebar — it ships alongside the old
 * Equipment Schedule + Materials tabs for testing; Phase 3 does the cutover.
 *
 * Read pattern: .schema('structure') SELECT is safe (the cross-schema gotcha is
 * writes-only). Writes go through the existing node-order.actions.ts /
 * node-order-document.actions.ts / node-order-shop-drawing.actions.ts.
 */

import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { projectService, listNodes } from '@esite/shared'
import { Card, CardBody } from '@/components/ui/Card'
import {
  gatherUnifiedBoards,
  type ProcStatus,
  type RawNode,
  type RawOrder,
  type ProcLine,
} from './_lib/gather-unified-boards'
import type { ShopDrawing } from '@/app/(admin)/projects/[id]/equipment-materials/_lib/order-types'
import { UnifiedBoardGroup } from './_components/UnifiedBoardGroup'
import { AddBoardToolbar } from './_components/AddBoardToolbar'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Equipment & Materials' }

// ---------------------------------------------------------------------------
// Status pills — by_tenant is shown here (unlike the old Materials buy-list)
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<ProcStatus, string> = {
  by_tenant: 'By tenant',
  required: 'Required',
  ordered: 'Ordered',
  received: 'Received',
}
const STATUS_ORDER: ProcStatus[] = ['required', 'ordered', 'received', 'by_tenant']

const EMPTY_DOCS = (): ProcLine['documents'] => ({ quote: null, order_instruction: null })

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ status?: string; showDecommissioned?: string }>
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function EquipmentMaterialsPage({ params, searchParams }: Props) {
  const { id: projectId } = await params
  const { status: statusFilter, showDecommissioned: showDecomParam } = await searchParams

  const supabase = await createClient()

  const project = await projectService.getById(supabase as never, projectId).catch(() => null)
  if (!project) notFound()

  // ── Nodes — the board register (existence-driven, D5) ────────────────────
  let nodeRows: Awaited<ReturnType<typeof listNodes>> = []
  try {
    nodeRows = await listNodes(supabase as never, projectId)
  } catch {
    // Non-fatal
  }

  // ── BO inputs for required-by dates ──────────────────────────────────────
  // opening_date arrives via select('*'); pre-migration-00093 it is simply
  // absent. Tenant BO columns are read in a separate query so a pre-apply
  // 42703 fails closed — orders just get no required-by date.
  const openingDate: string | null =
    (project as { opening_date?: string | null }).opening_date ?? null

  const boByNode = new Map<string, { boPeriodDays: number | null; boDateOverride: string | null }>()
  const tenantNodeIds = nodeRows.filter((n) => n.kind === 'tenant_db').map((n) => n.id)
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
  // Unlike the old Materials buy-list, we do NOT exclude `by_tenant` — the
  // unified tab shows tenant-supplied scope lines too (spec §4 tenant rollup).
  let rawOrders: RawOrder[] = []
  let loadError: string | null = null
  try {
    const { data, error } = await supabase
      .schema('structure')
      .from('node_orders')
      .select('id, node_id, label, scope_item_type_id, status, ordered_at, received_at, notes')
      .eq('project_id', projectId)
      .order('label', { ascending: true })
    if (error) throw error
    if (data) rawOrders = (data as unknown as RawOrder[])
  } catch (err: unknown) {
    loadError = err instanceof Error ? err.message : 'Could not load procurement'
  }

  // ── node_order_documents — the Quote / Order-instruction slots per order ──
  const docsByOrder = new Map<string, ProcLine['documents']>()
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
        const ref = { storage_path: d.storage_path, file_name: d.file_name }
        if (d.doc_type === 'quote') entry.quote = ref
        else if (d.doc_type === 'order_instruction') entry.order_instruction = ref
      }
    } catch {
      // Non-fatal — boards still render, with empty doc slots.
    }
  }

  // ── node_order_shop_drawings — the multi-drawing list per order ──────────
  const drawingsByOrder = new Map<string, ShopDrawing[]>()
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
          handover_category: (r.handover_category ?? null) as ShopDrawing['handover_category'],
        })
        drawingsByOrder.set(r.node_order_id, list)
      }
    } catch {
      // Non-fatal — boards still render with no drawings.
    }
  }

  // ── Shape: board-centric groups ──────────────────────────────────────────
  const showDecommissioned = showDecomParam === '1' || showDecomParam === 'true'
  const nodes = nodeRows as unknown as RawNode[]
  // All node codes (every kind) — the uniqueness universe for the Add/Edit forms.
  const existingCodes = nodes.map((n) => n.code)
  // Distinct custom equipment-type labels — seeds the Add form's custom datalist.
  const existingCustomTypes = Array.from(
    new Set(
      nodes
        .filter((n) => n.kind === 'custom' && n.custom_kind_label)
        .map((n) => n.custom_kind_label as string),
    ),
  ).sort((a, b) => a.localeCompare(b))
  const groups = gatherUnifiedBoards(
    { nodes, orders: rawOrders, scopeTypeById, boByNode, openingDate, today, docsByOrder, drawingsByOrder },
    { showDecommissioned },
  )

  // ── Status filter ────────────────────────────────────────────────────────
  // A board is shown if ANY of its lines has the active status. Equipment
  // boards have one line; tenant boards may have several. An orderless board
  // (no lines — should not occur post-trigger) is matched by its summary status
  // (equipment → 'required'), so it is never hidden behind a filter.
  const validStatuses = new Set<string>(STATUS_ORDER)
  const activeStatus: ProcStatus | null =
    statusFilter && validStatuses.has(statusFilter) ? (statusFilter as ProcStatus) : null

  const filteredGroups = activeStatus
    ? groups
        .map((g) => ({
          ...g,
          boards: g.boards.filter((b) =>
            b.lines.length
              ? b.lines.some((l) => l.status === activeStatus)
              : b.summary.status === activeStatus,
          ),
        }))
        .filter((g) => g.boards.length > 0)
    : groups

  // Status pill counts — every line, plus orderless boards under their summary.
  const countByStatus: Record<ProcStatus, number> = { by_tenant: 0, required: 0, ordered: 0, received: 0 }
  let totalLines = 0
  for (const g of groups) {
    for (const b of g.boards) {
      if (b.lines.length) {
        for (const l of b.lines) {
          countByStatus[l.status]++
          totalLines++
        }
      } else if (b.summary.status !== 'none') {
        countByStatus[b.summary.status]++
        totalLines++
      }
    }
  }

  const totalBoards = filteredGroups.reduce((sum, g) => sum + g.boards.length, 0)
  const base = `/projects/${projectId}/equipment-materials`
  const decomQuery = showDecommissioned ? '&showDecommissioned=1' : ''
  const toggleHref = showDecommissioned
    ? `${base}${activeStatus ? `?status=${activeStatus}` : ''}`
    : `${base}?showDecommissioned=1${activeStatus ? `&status=${activeStatus}` : ''}`

  return (
    <div className="animate-fadeup" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Equipment &amp; Materials</h1>
          <p className="page-subtitle">{project.name} · one board register + buy-list</p>
        </div>
        <AddBoardToolbar
          projectId={projectId}
          existingCodes={existingCodes}
          existingCustomTypes={existingCustomTypes}
        />
      </div>

      {/* Status filter pills + decommissioned toggle */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        <Link
          href={`${base}${showDecommissioned ? '?showDecommissioned=1' : ''}`}
          className={!activeStatus ? 'badge badge-green' : 'badge badge-muted'}
        >
          All
          <span style={{ marginLeft: '0.3rem', opacity: 0.7 }}>{totalLines}</span>
        </Link>
        {STATUS_ORDER.map((s) => (
          <Link
            key={s}
            href={`${base}?status=${s}${decomQuery}`}
            className={activeStatus === s ? 'badge badge-green' : 'badge badge-muted'}
          >
            {STATUS_LABEL[s]}
            <span style={{ marginLeft: '0.3rem', opacity: 0.7 }}>{countByStatus[s]}</span>
          </Link>
        ))}
        <Link
          href={toggleHref}
          className={showDecommissioned ? 'badge badge-amber' : 'badge badge-muted'}
          style={{ marginLeft: 'auto' }}
        >
          {showDecommissioned ? '✓ ' : ''}Show decommissioned
        </Link>
      </div>

      {!openingDate && totalLines > 0 && (
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
            Could not load procurement.
          </div>
          <div style={{ fontSize: 13, color: 'var(--c-text-mid)' }}>{loadError}</div>
        </div>
      )}

      {!loadError && totalBoards === 0 && (
        <Card>
          <CardBody>
            <p style={{ color: 'var(--c-text-dim)', fontSize: 13, textAlign: 'center', padding: '2rem 0' }}>
              {activeStatus
                ? `No boards with a "${STATUS_LABEL[activeStatus]}" line.`
                : 'No boards yet. Add equipment boards in the Equipment Schedule or set scope items in the Tenant Schedule.'}
            </p>
          </CardBody>
        </Card>
      )}

      {filteredGroups.map((group) => (
        <UnifiedBoardGroup key={group.key} group={group} projectId={projectId} existingCodes={existingCodes} />
      ))}
    </div>
  )
}
