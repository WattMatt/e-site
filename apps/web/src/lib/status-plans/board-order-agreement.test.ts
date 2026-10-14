/**
 * The line diagram and the Equipment & Materials schedule must tell the same
 * story about every board. One invented fixture goes through BOTH
 * gatherUnifiedBoards (the schedule) and boardOrderStatusByNode (the plan); any
 * board on which they disagree fails here, so the plan cannot drift again.
 */
import { describe, it, expect } from 'vitest'
import { gatherUnifiedBoards, type GatherInput, type RawNode, type RawOrder } from '@/lib/equipment-materials/gather-unified-boards'
import { boardOrderStatusByNode } from './project-db-orders'

const node = (id: string, kind: string, extra: Partial<RawNode> = {}): RawNode => ({
  id, code: id.toUpperCase(), name: null, kind, status: 'active', coc_required: false,
  custom_kind_label: kind === 'custom' ? 'Kiosk' : null, shop_name: null, shop_number: null, ...extra,
})
const order = (id: string, nodeId: string, label: string, typeId: string | null, status: RawOrder['status']): RawOrder => ({
  id, node_id: nodeId, label, scope_item_type_id: typeId, status, ordered_at: null, received_at: null, notes: '',
})

const TYPES = new Map([
  ['st-db', { id: 'st-db', key: 'db', label: 'DB' }],
  ['st-lt', { id: 'st-lt', key: 'lighting', label: 'Lighting' }],
])

const NODES: RawNode[] = [
  node('mb-a', 'main_board'), node('mb-b', 'main_board'), node('mb-c', 'main_board'),
  node('ms-a', 'mini_sub'), node('ms-b', 'mini_sub'),
  node('rmu-a', 'rmu'), node('ca-a', 'common_area_board'), node('gen-a', 'generator'), node('gen-b', 'generator'),
  node('cal-a', 'common_area_lighting'), node('sb-a', 'sub_board'), node('cu-a', 'custom'),
  node('t-a', 'tenant_db'), node('t-b', 'tenant_db'), node('t-c', 'tenant_db'), node('t-d', 'tenant_db'),
]

// Schedule order: label asc, then id — the order both loaders read.
const ORDERS: RawOrder[] = [
  order('o01', 't-a', 'DB', 'st-db', 'received'),
  order('o02', 't-b', 'DB', 'st-db', 'by_tenant'),
  order('o03', 'gen-a', 'GEN 7', null, 'ordered'),
  order('o04', 't-a', 'Lighting', 'st-lt', 'ordered'),
  order('o05', 't-c', 'Lighting', 'st-lt', 'received'),
  order('o06', 'mb-a', 'MB 9.1', null, 'required'),
  order('o07', 'mb-b', 'MB 9.2', null, 'received'),
  order('o08', 'mb-c', 'MB 9.3', null, 'ordered'),
  order('o09', 'mb-c', 'MB 9.3 spare', null, 'required'),
  order('o10', 'ms-a', 'MS 4', null, 'received'),
  order('o11', 'ms-b', 'MS 5', null, 'ordered'),
  order('o12', 'cal-a', 'Pole lights', null, 'by_tenant'),
  order('o13', 'rmu-a', 'RMU 3', null, 'received'),
  order('o14', 'ca-a', 'CA 1', null, 'ordered'),
  order('o15', 'cu-a', 'Kiosk 2', null, 'received'),
  order('o16', 'sb-a', 'SB 1', 'st-lt', 'ordered'),
]

const INPUT: GatherInput = {
  nodes: NODES, orders: ORDERS, scopeTypeById: TYPES, boByNode: new Map(),
  openingDate: null, today: '2031-03-01', docsByOrder: new Map(), drawingsByOrder: new Map(),
}

describe('line diagram ↔ Equipment & Materials schedule', () => {
  const groups = gatherUnifiedBoards(INPUT)
  const plan = boardOrderStatusByNode({
    nodes: NODES, orders: ORDERS, scopeKeyById: new Map([...TYPES].map(([id, t]) => [id, t.key])),
  })
  const boards = groups.flatMap((g) => g.boards)

  it('the fixture covers every board (none dropped by the schedule)', () => {
    expect(boards.map((b) => b.nodeId).sort()).toEqual(NODES.map((n) => n.id).sort())
  })

  it.each(NODES.filter((n) => n.kind !== 'tenant_db').map((n) => n.id))('equipment board %s: plan = schedule summary', (id) => {
    const b = boards.find((x) => x.nodeId === id)!
    expect(b.type).toBe('equipment')
    expect(plan[id]).toBe(b.summary.status)
  })

  it.each(NODES.filter((n) => n.kind === 'tenant_db').map((n) => n.id))('tenant board %s: plan = the schedule DB line', (id) => {
    const b = boards.find((x) => x.nodeId === id)!
    const dbLine = b.lines.find((l) => ORDERS.find((o) => o.id === l.orderId)!.scope_item_type_id === 'st-db')
    expect(plan[id]).toBe(dbLine?.status)
  })

  it('the fixture exercises every status and the no-line cases', () => {
    expect(new Set(Object.values(plan))).toEqual(new Set(['required', 'ordered', 'received', 'by_tenant']))
    expect(plan['gen-b']).toBe('required') // equipment, no line
    expect(plan['t-c']).toBeUndefined() // tenant, no DB line
    expect(plan['t-d']).toBeUndefined() // tenant, no line at all
  })
})
