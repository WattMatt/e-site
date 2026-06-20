import { describe, it, expect } from 'vitest'
import { gatherUnifiedBoards, type GatherInput } from './gather-unified-boards'

const base: GatherInput = {
  nodes: [
    { id: 'n1', code: 'DB-10', name: null, kind: 'common_area_board', status: 'active', coc_required: true, custom_kind_label: null, shop_name: null, shop_number: null },
    { id: 'n2', code: 'DB-2', name: null, kind: 'common_area_board', status: 'active', coc_required: false, custom_kind_label: null, shop_name: null, shop_number: null },
    { id: 't1', code: 'DB-24', name: null, kind: 'tenant_db', status: 'active', coc_required: false, custom_kind_label: null, shop_name: 'Woolworths', shop_number: '24' },
  ],
  orders: [
    { id: 'o1', node_id: 'n1', label: 'DB-10', scope_item_type_id: null, status: 'required', ordered_at: null, received_at: null, notes: '' },
    { id: 'o2', node_id: 'n2', label: 'DB-2', scope_item_type_id: null, status: 'ordered', ordered_at: '2026-02-01', received_at: null, notes: '' },
    { id: 'o3', node_id: 't1', label: 'DB', scope_item_type_id: 'st-db', status: 'ordered', ordered_at: '2026-02-01', received_at: null, notes: '' },
  ],
  scopeTypeById: new Map([['st-db', { id: 'st-db', key: 'db', label: 'DB' }]]),
  boByNode: new Map(),
  openingDate: null,
  today: '2026-02-15',
  docsByOrder: new Map(),
  drawingsByOrder: new Map(),
}

describe('gatherUnifiedBoards', () => {
  it('groups equipment boards by kind, natural-sorted (DB-2 before DB-10)', () => {
    const groups = gatherUnifiedBoards(base)
    const ca = groups.find((g) => g.key === 'common_area_board')!
    expect(ca.boards.map((b) => b.code)).toEqual(['DB-2', 'DB-10'])
  })

  it('puts tenant_db boards in the Tenant / Shop group with a scope rollup', () => {
    const groups = gatherUnifiedBoards(base)
    const tn = groups.find((g) => g.key === 'tenant_db')!
    expect(tn.label).toBe('Tenant / Shop Boards')
    const b = tn.boards[0]
    expect(b.type).toBe('tenant')
    expect(b.lines).toHaveLength(1)
    expect(b.lines[0].scopeLabel).toBe('DB')
    expect(b.summary.rollup).toBe('DB ◐') // ordered
  })

  it('an equipment board carries exactly one procurement line + its status summary', () => {
    const groups = gatherUnifiedBoards(base)
    // boards are natural-sorted, so boards[0] is DB-2 (ordered); find DB-10 (required) explicitly
    const ca = groups.find((g) => g.key === 'common_area_board')!
    const db10 = ca.boards.find((x) => x.code === 'DB-10')!
    expect(db10.type).toBe('equipment')
    expect(db10.lines).toHaveLength(1)
    expect(db10.summary.status).toBe('required')
    expect(ca.boards.find((x) => x.code === 'DB-2')!.summary.status).toBe('ordered')
  })

  it('hides decommissioned boards by default, includes them (sorted) when asked', () => {
    const nodes = [{ ...base.nodes[0], status: 'decommissioned' }, ...base.nodes.slice(1)]
    const input: GatherInput = { ...base, nodes }
    const def = gatherUnifiedBoards(input).find((g) => g.key === 'common_area_board')!
    expect(def.boards.map((b) => b.code)).toEqual(['DB-2']) // DB-10 hidden
    const all = gatherUnifiedBoards(input, { showDecommissioned: true }).find((g) => g.key === 'common_area_board')!
    expect(all.boards.map((b) => b.code)).toEqual(['DB-2', 'DB-10']) // both, natural-sorted
  })

  it('orders groups RMU…Common Area…then Tenant/Shop last', () => {
    const groups = gatherUnifiedBoards(base)
    expect(groups.map((g) => g.key)).toEqual(['common_area_board', 'tenant_db'])
  })

  it('never drops an unanticipated kind (e.g. sub_board) — it gets a catch-all group', () => {
    const input: GatherInput = {
      ...base,
      nodes: [
        ...base.nodes,
        { id: 's1', code: 'SB-1', name: null, kind: 'sub_board', status: 'active', coc_required: false, custom_kind_label: null, shop_name: null, shop_number: null },
      ],
      orders: [
        ...base.orders,
        { id: 'os1', node_id: 's1', label: 'SB-1', scope_item_type_id: null, status: 'required', ordered_at: null, received_at: null, notes: '' },
      ],
    }
    const sb = gatherUnifiedBoards(input).find((g) => g.key === 'sub_board')
    expect(sb).toBeDefined()
    expect(sb!.label).toBe('Sub-Boards')
    expect(sb!.boards.map((b) => b.code)).toEqual(['SB-1'])
  })

  it('an orderless equipment board reads as required (so it is never hidden)', () => {
    const input: GatherInput = {
      ...base,
      nodes: [{ id: 'e0', code: 'DB-99', name: null, kind: 'main_board', status: 'active', coc_required: false, custom_kind_label: null, shop_name: null, shop_number: null }],
      orders: [],
    }
    const b = gatherUnifiedBoards(input).find((g) => g.key === 'main_board')!.boards[0]
    expect(b.lines).toHaveLength(0)
    expect(b.summary.status).toBe('required')
  })

  it('carries multiple labelled documents per slot (quote + order_instruction lists)', () => {
    const docsByOrder: GatherInput['docsByOrder'] = new Map([
      [
        'o1',
        {
          quote: [
            { id: 'd1', storage_path: 'p/q1', file_name: 'supA.pdf', label: 'Supplier A', kind: 'original' },
            { id: 'd2', storage_path: 'p/q2', file_name: 'supB.pdf', label: 'Supplier B', kind: 'original' },
          ],
          order_instruction: [
            { id: 'd3', storage_path: 'p/o1', file_name: 'order.pdf', label: null, kind: 'original' },
            { id: 'd4', storage_path: 'p/o2', file_name: 'var.pdf', label: 'RFI-12', kind: 'variation' },
          ],
        },
      ],
    ])
    const input: GatherInput = { ...base, docsByOrder }
    const ca = gatherUnifiedBoards(input).find((g) => g.key === 'common_area_board')!
    const db10 = ca.boards.find((x) => x.code === 'DB-10')! // node n1 → order o1
    const line = db10.lines[0]
    expect(line.documents.quote).toHaveLength(2)
    expect(line.documents.quote.map((d) => d.label)).toEqual(['Supplier A', 'Supplier B'])
    expect(line.documents.order_instruction.map((d) => d.kind)).toEqual(['original', 'variation'])
  })
})
