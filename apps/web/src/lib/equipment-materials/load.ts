/**
 * loadEquipmentMaterialsData — the single I/O seam for the Equipment & Materials
 * board register.
 *
 * Both the admin tab and the PDF report read through this. That is the point:
 * if the report re-derived the register independently it would drift from the
 * screen, and a client would eventually be handed a PDF that disagrees with what
 * staff can see. Every query below was previously inline in the page.
 *
 * The Supabase client is injected so callers choose their own trust model — the
 * page passes the RLS-aware cookie client, the report gates the caller first and
 * then passes the service client. Reads via .schema('structure') are safe on
 * either (the cross-schema gotcha is writes-only).
 *
 * Individual reads fail soft, matching the page's original behaviour: a missing
 * optional table leaves boards rendering with empty slots rather than 500ing the
 * whole tab. `loadError` carries the one failure that matters — node_orders.
 */
import { listNodes } from '@esite/shared'
import type { GatherInput, RawNode, RawOrder, ProcLine } from './gather-unified-boards'
import type { ShopDrawing } from './order-types'

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyClient = any

const EMPTY_DOCS = (): ProcLine['documents'] => ({ quote: [], order_instruction: [] })

export interface EquipmentMaterialsLoad {
  /** Null when the project is missing or not visible to the caller. */
  project: { id: string; name: string; organisationId: string; openingDate: string | null } | null
  gatherInput: GatherInput
  /** Every node code (all kinds) — the uniqueness universe for Add/Edit forms. */
  existingCodes: string[]
  /** Distinct custom equipment-type labels — seeds the Add form datalist. */
  existingCustomTypes: string[]
  /** Count of nodes excluded because they are decommissioned. */
  decommissionedCount: number
  /** Set when procurement lines could not be read; boards still render. */
  loadError: string | null
}

function emptyGatherInput(today: string): GatherInput {
  return {
    nodes: [],
    orders: [],
    scopeTypeById: new Map(),
    boByNode: new Map(),
    openingDate: null,
    today,
    docsByOrder: new Map(),
    drawingsByOrder: new Map(),
  }
}

export async function loadEquipmentMaterialsData(
  client: AnyClient,
  projectId: string,
  opts: { today?: string } = {},
): Promise<EquipmentMaterialsLoad> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10)

  // ── Project ──────────────────────────────────────────────────────────────
  const { data: projRow } = await client
    .schema('projects')
    .from('projects')
    .select('id, name, organisation_id, opening_date')
    .eq('id', projectId)
    .maybeSingle()

  const proj = projRow as {
    id: string
    name: string | null
    organisation_id: string
    opening_date?: string | null
  } | null

  if (!proj) {
    return {
      project: null,
      gatherInput: emptyGatherInput(today),
      existingCodes: [],
      existingCustomTypes: [],
      decommissionedCount: 0,
      loadError: null,
    }
  }

  const openingDate = proj.opening_date ?? null
  const orgId = proj.organisation_id

  // ── Nodes — the board register (existence-driven) ────────────────────────
  let nodeRows: Awaited<ReturnType<typeof listNodes>> = []
  try {
    nodeRows = await listNodes(client as never, projectId)
  } catch {
    // Non-fatal — an empty register still renders.
  }
  const nodes = nodeRows as unknown as RawNode[]
  const decommissionedCount = nodes.filter((n) => n.status !== 'active').length

  // ── Tenant BO inputs for required-by dates ───────────────────────────────
  const boByNode: GatherInput['boByNode'] = new Map()
  const tenantNodeIds = nodes.filter((n) => n.kind === 'tenant_db').map((n) => n.id)
  if (tenantNodeIds.length > 0) {
    try {
      const { data } = await client
        .schema('structure')
        .from('tenant_details')
        .select('node_id, bo_period_days, bo_date_override')
        .in('node_id', tenantNodeIds)
      for (const r of (data ?? []) as Array<{
        node_id: string
        bo_period_days: number | null
        bo_date_override: string | null
      }>) {
        boByNode.set(r.node_id, {
          boPeriodDays: r.bo_period_days,
          boDateOverride: r.bo_date_override,
        })
      }
    } catch {
      // Non-fatal: pre-00093 the columns don't exist — orders get no required-by.
    }
  }

  // ── Scope item types — classify tenant orders ────────────────────────────
  const scopeTypeById: GatherInput['scopeTypeById'] = new Map()
  try {
    const { data } = await client
      .schema('structure')
      .from('scope_item_types')
      .select('id, key, label')
      .eq('organisation_id', orgId)
    for (const t of (data ?? []) as Array<{ id: string; key: string; label: string }>) {
      scopeTypeById.set(t.id, t)
    }
  } catch {
    // Non-fatal — tenant lines fall back to an em dash label.
  }

  // ── node_orders — the procurement lines ──────────────────────────────────
  let orders: RawOrder[] = []
  let loadError: string | null = null
  try {
    const { data, error } = await client
      .schema('structure')
      .from('node_orders')
      .select('id, node_id, label, scope_item_type_id, status, ordered_at, received_at, notes')
      .eq('project_id', projectId)
      .order('label', { ascending: true })
    if (error) throw error
    orders = (data ?? []) as unknown as RawOrder[]
  } catch (err: unknown) {
    loadError = err instanceof Error ? err.message : 'Could not load procurement'
  }

  const orderIds = orders.map((o) => o.id)

  // ── Documents (quote / order instruction) ────────────────────────────────
  const docsByOrder: GatherInput['docsByOrder'] = new Map()
  if (orderIds.length > 0) {
    try {
      const { data: docs } = await client
        .schema('structure')
        .from('node_order_documents')
        .select('id, node_order_id, doc_type, storage_path, file_name, label, kind, created_at')
        .in('node_order_id', orderIds)
        .order('created_at', { ascending: false })
      for (const d of (docs ?? []) as Array<{
        id: string
        node_order_id: string
        doc_type: string
        storage_path: string
        file_name: string
        label: string | null
        kind: 'original' | 'revision' | 'variation'
      }>) {
        let entry = docsByOrder.get(d.node_order_id)
        if (!entry) {
          entry = EMPTY_DOCS()
          docsByOrder.set(d.node_order_id, entry)
        }
        const ref = {
          id: d.id,
          storage_path: d.storage_path,
          file_name: d.file_name,
          label: d.label ?? null,
          kind: d.kind,
        }
        if (d.doc_type === 'quote') entry.quote.push(ref)
        else if (d.doc_type === 'order_instruction') entry.order_instruction.push(ref)
      }
    } catch {
      // Non-fatal — boards still render, with empty doc slots.
    }
  }

  // ── Shop drawings ────────────────────────────────────────────────────────
  const drawingsByOrder: GatherInput['drawingsByOrder'] = new Map()
  if (orderIds.length > 0) {
    try {
      const { data: rows } = await client
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

  const existingCodes = nodes.map((n) => n.code)
  const existingCustomTypes = Array.from(
    new Set(
      nodes
        .filter((n) => n.kind === 'custom' && n.custom_kind_label)
        .map((n) => n.custom_kind_label as string),
    ),
  ).sort((a, b) => a.localeCompare(b))

  return {
    project: {
      id: proj.id,
      name: proj.name ?? '—',
      organisationId: orgId,
      openingDate,
    },
    gatherInput: {
      nodes,
      orders,
      scopeTypeById,
      boByNode,
      openingDate,
      today,
      docsByOrder,
      drawingsByOrder,
    },
    existingCodes,
    existingCustomTypes,
    decommissionedCount,
    loadError,
  }
}
