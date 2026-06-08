/**
 * gatherUnifiedBoards — pure shaping for the unified "Equipment & Materials" tab.
 *
 * Board-centric (spec D5): iterate every node and attach its procurement, so a
 * board appears because it EXISTS — never because an order row happens to exist.
 * Equipment boards carry one procurement line; tenant/shop boards carry their
 * scope-order lines + a rollup. Groups are kind-based, natural-sorted (D6).
 *
 * No I/O — the page fetches the raw rows and passes them in (testable).
 */
import { computeOrderRequiredBy, computeRagStatus } from '@esite/shared'
import { naturalCompare } from '@/lib/natural-compare'
import type { OrderDoc } from '@/app/(admin)/projects/[id]/materials/_components/OrderDocSlot'
import type { ShopDrawing } from '@/app/(admin)/projects/[id]/materials/_components/ShopDrawingList'

export type ProcStatus = 'by_tenant' | 'required' | 'ordered' | 'received'

export interface RawNode {
  id: string; code: string; name: string | null; kind: string; status: string
  coc_required: boolean; custom_kind_label: string | null; shop_name: string | null; shop_number: string | null
}
export interface RawOrder {
  id: string; node_id: string; label: string; scope_item_type_id: string | null
  status: ProcStatus; ordered_at: string | null; received_at: string | null; notes: string
}
export interface ProcLine {
  orderId: string; scopeLabel: string | null // null = the equipment line
  status: ProcStatus; ordered_at: string | null; received_at: string | null
  required_by: string | null; rag: 'red' | 'amber' | 'green' | 'neutral'
  documents: { quote: OrderDoc | null; order_instruction: OrderDoc | null }
  shopDrawings: ShopDrawing[]
}
export interface UnifiedBoard {
  nodeId: string; code: string; name: string | null; kind: string
  type: 'equipment' | 'tenant'; cocRequired: boolean; status: 'active' | 'decommissioned'
  lines: ProcLine[]
  summary: { status: ProcStatus | 'none'; rollup: string | null; requiredBy: string | null; rag: ProcLine['rag'] }
}
export interface UnifiedGroup { key: string; label: string; boards: UnifiedBoard[] }

export interface GatherInput {
  nodes: RawNode[]; orders: RawOrder[]
  scopeTypeById: Map<string, { id: string; key: string; label: string }>
  boByNode: Map<string, { boPeriodDays: number | null; boDateOverride: string | null }>
  openingDate: string | null; today: string
  docsByOrder: Map<string, ProcLine['documents']>
  drawingsByOrder: Map<string, ShopDrawing[]>
}

const EMPTY_DOCS = (): ProcLine['documents'] => ({ quote: null, order_instruction: null })

const GROUP_LABEL: Record<string, string> = {
  rmu: 'Ring Main Units (RMU)', mini_sub: 'Mini-Substations', generator: 'Generators',
  main_board: 'Main Boards', common_area_board: 'Common Area Boards',
  common_area_lighting: 'Common Area Lighting', tenant_db: 'Tenant / Shop Boards',
}
// built-in display order; custom groups append after, tenant_db last
const GROUP_ORDER = ['rmu', 'mini_sub', 'generator', 'main_board', 'common_area_board', 'common_area_lighting']

const ROLL = { received: '✓', ordered: '◐', required: '○', by_tenant: '·' } as const

export function gatherUnifiedBoards(
  input: GatherInput,
  opts: { showDecommissioned?: boolean } = {},
): UnifiedGroup[] {
  const { nodes, orders, scopeTypeById, boByNode, openingDate, today, docsByOrder, drawingsByOrder } = input

  const ordersByNode = new Map<string, RawOrder[]>()
  for (const o of orders) {
    const list = ordersByNode.get(o.node_id) ?? []
    list.push(o); ordersByNode.set(o.node_id, list)
  }

  const toLine = (o: RawOrder, isTenant: boolean): ProcLine => {
    const bo = isTenant ? boByNode.get(o.node_id) ?? { boPeriodDays: null, boDateOverride: null } : null
    const requiredBy = computeOrderRequiredBy({ openingDate, tenant: bo })
    return {
      orderId: o.id,
      scopeLabel: o.scope_item_type_id ? scopeTypeById.get(o.scope_item_type_id)?.label ?? '—' : null,
      status: o.status, ordered_at: o.ordered_at, received_at: o.received_at,
      required_by: requiredBy, rag: computeRagStatus(requiredBy, o.status, today),
      documents: docsByOrder.get(o.id) ?? EMPTY_DOCS(),
      shopDrawings: drawingsByOrder.get(o.id) ?? [],
    }
  }

  const byKey = new Map<string, UnifiedBoard[]>()
  const customLabel = new Map<string, string>()

  for (const n of nodes) {
    if (!opts.showDecommissioned && n.status !== 'active') continue
    const isTenant = n.kind === 'tenant_db'
    const lines = (ordersByNode.get(n.id) ?? []).map((o) => toLine(o, isTenant))

    let summary: UnifiedBoard['summary']
    if (isTenant) {
      const rollup = lines.length ? lines.map((l) => `${l.scopeLabel} ${ROLL[l.status]}`).join(' · ') : null
      const worst = lines.find((l) => l.rag === 'red') ?? lines.find((l) => l.rag === 'amber') ?? lines[0]
      summary = { status: lines[0]?.status ?? 'none', rollup, requiredBy: worst?.required_by ?? null, rag: worst?.rag ?? 'neutral' }
    } else {
      const l = lines[0]
      summary = { status: l?.status ?? 'none', rollup: null, requiredBy: l?.required_by ?? null, rag: l?.rag ?? 'neutral' }
    }

    const board: UnifiedBoard = {
      nodeId: n.id, code: n.code, name: n.name ?? n.shop_name ?? null, kind: n.kind,
      type: isTenant ? 'tenant' : 'equipment', cocRequired: n.coc_required,
      status: n.status === 'decommissioned' ? 'decommissioned' : 'active', lines, summary,
    }
    const key = n.kind === 'custom' ? `custom:${n.custom_kind_label ?? 'Custom'}` : n.kind
    if (n.kind === 'custom') customLabel.set(key, n.custom_kind_label ?? 'Custom')
    const arr = byKey.get(key) ?? []; arr.push(board); byKey.set(key, arr)
  }

  for (const arr of byKey.values()) arr.sort((a, b) => naturalCompare(a.code, b.code))

  const customKeys = [...byKey.keys()].filter((k) => k.startsWith('custom:')).sort((a, b) => a.localeCompare(b))
  const orderedKeys = [...GROUP_ORDER, ...customKeys, 'tenant_db']
  return orderedKeys
    .filter((k) => (byKey.get(k)?.length ?? 0) > 0)
    .map((k) => ({ key: k, label: GROUP_LABEL[k] ?? customLabel.get(k) ?? 'Custom', boards: byKey.get(k)! }))
}
