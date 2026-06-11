import { describe, it, expect } from 'vitest'
import { variationService } from './variation.service'

// ─── Fake client helpers ──────────────────────────────────────────────────────
//
// Mirrors valuation.service.client.test.ts, plus an ordered `ops` log (every
// chain call with its table + args) so tests can assert WHICH filters a read
// used (e.g. `.is('materialized_item_id', null)`) and the ORDER of writes
// (materialize before the status flip).

type Result = { data: unknown; error: { message: string } | null }
type Op = { table: string; op: string; args: unknown[] }

function fakeClient(queue: Result[]) {
  const ops: Op[] = []
  let table = ''
  let qi = 0
  const next = (): Result => queue[qi++] ?? { data: null, error: null }
  const record = (op: string, ...args: unknown[]) => {
    ops.push({ table, op, args })
  }
  const chain: Record<string, unknown> = {
    select: (...args: unknown[]) => {
      record('select', ...args)
      return chain
    },
    eq: (...args: unknown[]) => {
      record('eq', ...args)
      return chain
    },
    is: (...args: unknown[]) => {
      record('is', ...args)
      return chain
    },
    order: () => chain,
    limit: () => chain,
    update: (patch?: unknown) => {
      record('update', patch)
      return chain
    },
    insert: (rows?: unknown) => {
      record('insert', rows)
      return chain
    },
    delete: () => {
      record('delete')
      return chain
    },
    maybeSingle: async () => next(),
    single: async () => next(),
    range: async () => next(),
    // Awaiting the chain itself (e.g. a bare `.update().eq(...)`) resolves to next().
    then: (resolve: (r: Result) => unknown) => resolve(next()),
  }
  const client = {
    schema: () => ({
      from: (t: string) => {
        table = t
        return chain
      },
    }),
  } as never
  return { client, ops }
}

const ok = (data: unknown): Result => ({ data, error: null })

const voRow = (over: Record<string, unknown> = {}) => ({
  id: 'vo1',
  project_id: 'p1',
  organisation_id: 'org1',
  boq_import_id: 'imp1',
  vo_no: 1,
  vo_date: '2026-06-11',
  title: 'VO 1 — extra DBs',
  reason: null,
  status: 'draft',
  net_change: null,
  approved_by: null,
  approved_at: null,
  created_by: 'u1',
  ...over,
})

const lineRow = (over: Record<string, unknown> = {}) => ({
  id: 'vl1',
  variation_order_id: 'vo1',
  kind: 'adjust',
  boq_item_id: 'itemA',
  qty_delta: '-3',
  section_id: null,
  code: null,
  description: null,
  unit: null,
  quantity: null,
  rate_model: null,
  supply_rate: null,
  install_rate: null,
  rate: null,
  value_change: '-300',
  materialized_item_id: null,
  ...over,
})

const inserts = (ops: Op[], table: string) => ops.filter((o) => o.table === table && o.op === 'insert')
const updates = (ops: Op[], table: string) => ops.filter((o) => o.table === table && o.op === 'update')
const hasFilter = (ops: Op[], table: string, op: string, args: unknown[]) =>
  ops.some((o) => o.table === table && o.op === op && JSON.stringify(o.args) === JSON.stringify(args))

// ─── list / get / create ────────────────────────────────────────────────────────

describe('variationService.list', () => {
  it('returns mapped VOs for the project', async () => {
    const rows = [voRow({ id: 'vo1', vo_no: 1 }), voRow({ id: 'vo2', vo_no: 2, status: 'approved', net_change: '950' })]
    const { client } = fakeClient([ok(rows)])
    const out = await variationService.list(client, 'p1')
    expect(out).toHaveLength(2)
    expect(out[0].voNo).toBe(1)
    expect(out[1].status).toBe('approved')
    expect(out[1].netChange).toBe(950)
  })
})

describe('variationService.get', () => {
  it('returns the VO and pages past the 1000-row cap for lines', async () => {
    const vo = voRow({ id: 'vo1' })
    const lines = Array.from({ length: 1200 }, (_, i) => lineRow({ id: `vl${i}`, boq_item_id: `item${i}` }))
    // Queue: 1) vo maybeSingle; then range pages of 1000/200.
    const { client } = fakeClient([ok(vo), ok(lines.slice(0, 1000)), ok(lines.slice(1000, 1200))])
    const out = await variationService.get(client, 'vo1')
    expect(out).not.toBeNull()
    expect(out!.vo.id).toBe('vo1')
    expect(out!.lines).toHaveLength(1200)
    expect(out!.lines[1100].boqItemId).toBe('item1100')
  })

  it('returns null when the VO does not exist', async () => {
    const { client } = fakeClient([ok(null)])
    expect(await variationService.get(client, 'missing')).toBeNull()
  })
})

describe('variationService.create', () => {
  it('inserts the VO (trigger numbers it) with NO carry-forward and returns the mapped readback', async () => {
    const created = voRow({ id: 'vo3', vo_no: 3 })
    const { client, ops } = fakeClient([ok(created)])
    const out = await variationService.create(client, {
      projectId: 'p1',
      organisationId: 'org1',
      boqImportId: 'imp1',
      voDate: '2026-06-11',
      title: 'VO 1 — extra DBs',
      reason: 'Client instruction',
      createdBy: 'u1',
    })
    expect(out.id).toBe('vo3')
    expect(out.voNo).toBe(3)
    const ins = inserts(ops, 'variation_orders')
    expect(ins).toHaveLength(1)
    const row = ins[0].args[0] as Record<string, unknown>
    expect(row.project_id).toBe('p1')
    expect(row.organisation_id).toBe('org1')
    expect(row.boq_import_id).toBe('imp1')
    expect(row.vo_date).toBe('2026-06-11')
    expect(row.title).toBe('VO 1 — extra DBs')
    expect(row.reason).toBe('Client instruction')
    expect(row.created_by).toBe('u1')
    // No carry-forward — nothing touches variation_lines.
    expect(inserts(ops, 'variation_lines')).toHaveLength(0)
  })
})

// ─── upsertLine — value_change via computeLineChange ────────────────────────────

describe('variationService.upsertLine', () => {
  it('adjust line: computes value_change = qtyDelta x the ITEM contract rate and inserts when no id', async () => {
    const stored = lineRow({ id: 'vl1', kind: 'adjust', boq_item_id: 'itemA', qty_delta: '-3', value_change: '-300' })
    const { client, ops } = fakeClient([ok(stored)])
    const out = await variationService.upsertLine(
      client,
      'vo1',
      { kind: 'adjust', boqItemId: 'itemA', qtyDelta: -3 },
      { supplyRate: 80, installRate: 20, rate: null, rateModel: 'supply_install' },
    )
    expect(out.valueChange).toBe(-300)
    const ins = inserts(ops, 'variation_lines')
    expect(ins).toHaveLength(1)
    const row = ins[0].args[0] as Record<string, unknown>
    expect(row.variation_order_id).toBe('vo1')
    expect(row.kind).toBe('adjust')
    expect(row.boq_item_id).toBe('itemA')
    expect(row.qty_delta).toBe(-3)
    expect(row.value_change).toBe(-300) // -3 x (80 + 20)
    expect(updates(ops, 'variation_lines')).toHaveLength(0)
  })

  it('add line with patch.id: computes value_change off the LINE own rate and UPDATEs that line', async () => {
    const stored = lineRow({
      id: 'vl9',
      kind: 'add',
      boq_item_id: null,
      qty_delta: null,
      section_id: 'sec1',
      description: 'Extra cabling',
      unit: 'm',
      quantity: '10',
      rate_model: 'single',
      rate: '55',
      value_change: '550',
    })
    const { client, ops } = fakeClient([ok(stored)])
    const out = await variationService.upsertLine(client, 'vo1', {
      id: 'vl9',
      kind: 'add',
      sectionId: 'sec1',
      description: 'Extra cabling',
      unit: 'm',
      quantity: 10,
      rateModel: 'single',
      rate: 55,
    })
    expect(out.valueChange).toBe(550)
    expect(inserts(ops, 'variation_lines')).toHaveLength(0)
    const ups = updates(ops, 'variation_lines')
    expect(ups).toHaveLength(1)
    const patch = ups[0].args[0] as Record<string, unknown>
    expect(patch.value_change).toBe(550) // 10 x 55
    expect(patch.kind).toBe('add')
    expect(hasFilter(ops, 'variation_lines', 'eq', ['id', 'vl9'])).toBe(true)
  })
})

// ─── deleteLine ─────────────────────────────────────────────────────────────────

describe('variationService.deleteLine', () => {
  it('deletes the line by id', async () => {
    const { client, ops } = fakeClient([ok(null)])
    await variationService.deleteLine(client, 'vl1')
    expect(ops.some((o) => o.table === 'variation_lines' && o.op === 'delete')).toBe(true)
    expect(hasFilter(ops, 'variation_lines', 'eq', ['id', 'vl1'])).toBe(true)
  })
})

// ─── getApprovedAdjustments ─────────────────────────────────────────────────────

describe('variationService.getApprovedAdjustments', () => {
  it('groups qty deltas per boq_item_id, filtering to approved VOs + adjust kind', async () => {
    const rows = [
      { boq_item_id: 'A', qty_delta: '5' },
      { boq_item_id: 'A', qty_delta: '-2' },
      { boq_item_id: 'B', qty_delta: '3' },
    ]
    const { client, ops } = fakeClient([ok(rows)])
    const out = await variationService.getApprovedAdjustments(client, 'p1')
    expect(out.get('A')).toEqual([5, -2])
    expect(out.get('B')).toEqual([3])
    expect(out.size).toBe(2)
    // Draft VOs are excluded by the QUERY — assert the filters were applied.
    expect(hasFilter(ops, 'variation_lines', 'eq', ['variation_orders.project_id', 'p1'])).toBe(true)
    expect(hasFilter(ops, 'variation_lines', 'eq', ['variation_orders.status', 'approved'])).toBe(true)
    expect(hasFilter(ops, 'variation_lines', 'eq', ['kind', 'adjust'])).toBe(true)
  })

  it('returns an empty map when there are no approved adjust lines', async () => {
    const { client } = fakeClient([ok([])])
    const out = await variationService.getApprovedAdjustments(client, 'p1')
    expect(out.size).toBe(0)
  })
})

// ─── approve — materialize, net_change, status LAST ─────────────────────────────

describe('variationService.approve', () => {
  it('materializes ONLY un-materialized add lines (origin=variation + variation_line_id) and flips status LAST', async () => {
    // Fixture: vo1 holds an already-materialized add line (vl1, NOT returned by
    // the filtered read), an un-materialized add line (vl2), and an adjust line.
    const addLine2 = lineRow({
      id: 'vl2',
      kind: 'add',
      boq_item_id: null,
      qty_delta: null,
      section_id: 'sec1',
      code: 'VO-1.1',
      description: 'Extra DB',
      unit: 'No',
      quantity: '4',
      // NULL on purpose: the patch schema lets an `add` omit rateModel while
      // boq_items.rate_model is NOT NULL — approve must coalesce it.
      rate_model: null,
      supply_rate: '200',
      install_rate: '50',
      rate: null,
      value_change: '1000',
      materialized_item_id: null,
    })
    const approved = voRow({ status: 'approved', net_change: '950', approved_by: 'u9', approved_at: '2026-06-11T08:00:00Z' })
    // Queue: 1) un-materialized add lines (range) → [vl2]
    //        2) max sort_order in sec1 (maybeSingle) → 7
    //        3) boq_items insert readback (single) → new item id
    //        4) line update (awaited chain) → ok
    //        5) ALL lines for net_change (range) → 3 lines
    //        6) VO update readback (single) → approved row
    const { client, ops } = fakeClient([
      ok([addLine2]),
      ok({ sort_order: 7 }),
      ok({ id: 'item-new-1' }),
      ok(null),
      ok([{ value_change: '-300' }, { value_change: '1000' }, { value_change: '250' }]),
      ok(approved),
    ])
    const out = await variationService.approve(client, 'vo1', { approvedBy: 'u9' })

    // The pending read targets ONLY un-materialized add lines of this VO.
    expect(hasFilter(ops, 'variation_lines', 'eq', ['variation_order_id', 'vo1'])).toBe(true)
    expect(hasFilter(ops, 'variation_lines', 'eq', ['kind', 'add'])).toBe(true)
    expect(hasFilter(ops, 'variation_lines', 'is', ['materialized_item_id', null])).toBe(true)

    // Exactly ONE boq_items insert, carrying the line's fields + provenance.
    const itemInserts = inserts(ops, 'boq_items')
    expect(itemInserts).toHaveLength(1)
    const item = itemInserts[0].args[0] as Record<string, unknown>
    expect(item.section_id).toBe('sec1')
    expect(item.code).toBe('VO-1.1')
    expect(item.description).toBe('Extra DB')
    expect(item.unit).toBe('No')
    expect(item.quantity).toBe(4)
    expect(item.quantity_mode).toBe('measured')
    expect(item.rate_model).toBe('supply_install') // coalesced from the line's NULL rate_model
    expect(item.supply_rate).toBe(200)
    expect(item.install_rate).toBe(50)
    expect(item.rate).toBeNull()
    expect(item.amount).toBe(1000) // = the line's value_change
    expect(item.origin).toBe('variation')
    expect(item.variation_line_id).toBe('vl2')
    expect(item.sort_order).toBe(8) // max(7) + 1

    // The line gets stamped with the new item id.
    const lineUpdates = updates(ops, 'variation_lines')
    expect(lineUpdates).toHaveLength(1)
    expect((lineUpdates[0].args[0] as Record<string, unknown>).materialized_item_id).toBe('item-new-1')
    expect(hasFilter(ops, 'variation_lines', 'eq', ['id', 'vl2'])).toBe(true)

    // net_change = sum of ALL the VO's lines; status flips LAST.
    const voUpdates = updates(ops, 'variation_orders')
    expect(voUpdates).toHaveLength(1)
    const voPatch = voUpdates[0].args[0] as Record<string, unknown>
    expect(voPatch.status).toBe('approved')
    expect(voPatch.net_change).toBe(950) // -300 + 1000 + 250
    expect(voPatch.approved_by).toBe('u9')
    expect(voPatch.approved_at).toBeDefined()

    const idx = (table: string, op: string) => ops.findIndex((o) => o.table === table && o.op === op)
    expect(idx('variation_orders', 'update')).toBeGreaterThan(idx('boq_items', 'insert'))
    expect(idx('variation_orders', 'update')).toBeGreaterThan(idx('variation_lines', 'update'))

    expect(out.status).toBe('approved')
    expect(out.netChange).toBe(950)
  })

  it('retry after a mid-way failure: no pending lines → no materialization, still recomputes net_change + flips status', async () => {
    const approved = voRow({ status: 'approved', net_change: '1000', approved_by: 'u9', approved_at: '2026-06-11T08:00:00Z' })
    // Queue: 1) un-materialized add lines (range) → none
    //        2) ALL lines for net_change (range) → 1 line
    //        3) VO update readback (single) → approved row
    const { client, ops } = fakeClient([ok([]), ok([{ value_change: '1000' }]), ok(approved)])
    const out = await variationService.approve(client, 'vo1', { approvedBy: 'u9' })
    expect(inserts(ops, 'boq_items')).toHaveLength(0)
    expect(updates(ops, 'variation_lines')).toHaveLength(0)
    const voPatch = updates(ops, 'variation_orders')[0].args[0] as Record<string, unknown>
    expect(voPatch.status).toBe('approved')
    expect(voPatch.net_change).toBe(1000)
    expect(out.status).toBe('approved')
  })
})
