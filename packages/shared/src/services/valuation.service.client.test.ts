import { describe, it, expect } from 'vitest'
import { valuationService } from './valuation.service'

// ─── Fake client helpers ──────────────────────────────────────────────────────
//
// Mirrors boq.service.client.test.ts. These services use a `.schema('projects')`
// chain; the chain methods are stubbed to return queued result rows. Writes
// (insert/update/upsert) are captured so tests can assert what was persisted.

type Result = { data: unknown; error: { message: string } | null }

/**
 * Build a fake client whose terminal calls (single/maybeSingle/range or an
 * awaited chain) pull successive results from `queue`. `inserts` records every
 * payload passed to `.insert()`/`.upsert()` so carry-forward can be asserted.
 */
function fakeClient(queue: Result[]) {
  const inserts: { table: string; rows: unknown }[] = []
  const updates: { table: string; patch: unknown }[] = []
  let table = ''
  let qi = 0
  const next = (): Result => queue[qi++] ?? { data: null, error: null }
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    neq: () => chain,
    lt: () => chain,
    gt: () => chain,
    order: () => chain,
    is: () => chain,
    in: () => chain,
    limit: () => chain,
    update: (patch?: unknown) => {
      updates.push({ table, patch })
      return chain
    },
    insert: (rows?: unknown) => {
      inserts.push({ table, rows })
      return chain
    },
    upsert: (rows?: unknown) => {
      inserts.push({ table, rows })
      return chain
    },
    maybeSingle: async () => next(),
    single: async () => next(),
    range: async () => next(),
    // Awaiting the chain itself (e.g. a bare `.select().eq(...)`) resolves to next().
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
  return { client, inserts, updates }
}

const ok = (data: unknown): Result => ({ data, error: null })

const valuationRow = (over: Record<string, unknown> = {}) => ({
  id: 'v2',
  project_id: 'p1',
  organisation_id: 'org1',
  boq_import_id: 'imp1',
  valuation_no: 2,
  valuation_date: '2026-06-10',
  status: 'draft',
  retention_pct: '10',
  gross_to_date: null,
  retention_amount: null,
  net_to_date: null,
  previous_net: null,
  due_ex_vat: null,
  vat_amount: null,
  due_incl_vat: null,
  report_id: null,
  notes: null,
  created_by: 'u1',
  certified_by: null,
  certified_at: null,
  ...over,
})

const lineRow = (over: Record<string, unknown> = {}) => ({
  id: 'l1',
  valuation_id: 'v1',
  boq_item_id: 'item1',
  input_method: 'percent',
  percent_complete: '50',
  qty_complete: null,
  value_to_date: '500',
  ...over,
})

// ─── create — carry-forward ─────────────────────────────────────────────────────

describe('valuationService.create', () => {
  it('carries forward the previous valuation lines against the new valuation id', async () => {
    const newVal = valuationRow({ id: 'v2', valuation_no: 2 })
    const prevVal = valuationRow({ id: 'v1', valuation_no: 1, status: 'certified' })
    const prevLines = [
      lineRow({ id: 'l1', valuation_id: 'v1', boq_item_id: 'itemA', input_method: 'percent', percent_complete: '40', qty_complete: null, value_to_date: '400' }),
      lineRow({ id: 'l2', valuation_id: 'v1', boq_item_id: 'itemB', input_method: 'quantity', percent_complete: null, qty_complete: '8', value_to_date: '800' }),
    ]
    // Queue: 1) insert new valuation → single() returns newVal
    //        2) find previous valuation (valuation_no=1) → maybeSingle returns prevVal
    //        3) fetch prev lines → range() returns prevLines
    //        4) bulk-insert carried lines (no read result needed)
    const { client, inserts } = fakeClient([ok(newVal), ok(prevVal), ok(prevLines)])
    const out = await valuationService.create(client, {
      projectId: 'p1',
      organisationId: 'org1',
      boqImportId: 'imp1',
      valuationDate: '2026-06-10',
      retentionPct: 10,
      createdBy: 'u1',
    })
    expect(out.id).toBe('v2')
    expect(out.valuationNo).toBe(2)

    // The carried lines must be inserted against the NEW valuation id, preserving
    // input_method / percent_complete / qty_complete / value_to_date.
    const carried = inserts.find(
      (i) => i.table === 'valuation_lines' && Array.isArray(i.rows),
    )
    expect(carried).toBeDefined()
    const rows = carried!.rows as Record<string, unknown>[]
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.valuation_id === 'v2')).toBe(true)
    expect(rows.map((r) => r.boq_item_id).sort()).toEqual(['itemA', 'itemB'])
    const a = rows.find((r) => r.boq_item_id === 'itemA')!
    expect(a.input_method).toBe('percent')
    expect(a.percent_complete).toBe(40)
    expect(a.value_to_date).toBe(400)
    const b = rows.find((r) => r.boq_item_id === 'itemB')!
    expect(b.input_method).toBe('quantity')
    expect(b.qty_complete).toBe(8)
    expect(b.value_to_date).toBe(800)
  })

  it('first valuation (no previous) inserts no carried lines', async () => {
    const newVal = valuationRow({ id: 'v1', valuation_no: 1 })
    // Queue: 1) insert new valuation → newVal; 2) find previous (no=0) → none
    const { client, inserts } = fakeClient([ok(newVal), ok(null)])
    const out = await valuationService.create(client, {
      projectId: 'p1',
      organisationId: 'org1',
      boqImportId: 'imp1',
      valuationDate: '2026-06-10',
      retentionPct: 10,
      createdBy: 'u1',
    })
    expect(out.valuationNo).toBe(1)
    const carried = inserts.filter((i) => i.table === 'valuation_lines')
    expect(carried).toHaveLength(0)
  })
})

// ─── upsertLine — value_to_date from computeLineValue ───────────────────────────

describe('valuationService.upsertLine', () => {
  it('computes value_to_date via computeLineValue and upserts on (valuation_id, boq_item_id)', async () => {
    const item = { amount: 1000, supplyRate: 80, installRate: 20, rate: null, rateModel: 'supply_install' }
    // percent 25 of amount 1000 = 250
    const stored = lineRow({ valuation_id: 'v2', boq_item_id: 'itemA', input_method: 'percent', percent_complete: '25', qty_complete: null, value_to_date: '250' })
    const { client, inserts } = fakeClient([ok(stored)])
    const out = await valuationService.upsertLine(
      client,
      'v2',
      { boqItemId: 'itemA', inputMethod: 'percent', percentComplete: 25, qtyComplete: null },
      item,
    )
    expect(out.valueToDate).toBe(250)
    const up = inserts.find((i) => i.table === 'valuation_lines')!
    const row = up.rows as Record<string, unknown>
    expect(row.valuation_id).toBe('v2')
    expect(row.boq_item_id).toBe('itemA')
    expect(row.input_method).toBe('percent')
    expect(row.value_to_date).toBe(250)
  })

  it('quantity line caps at the contract amount (over-measure) via computeLineValue', async () => {
    const item = { amount: 1000, supplyRate: 80, installRate: 20, rate: null, rateModel: 'supply_install' }
    // 20 × 100 = 2000, capped at 1000
    const stored = lineRow({ valuation_id: 'v2', boq_item_id: 'itemB', input_method: 'quantity', percent_complete: null, qty_complete: '20', value_to_date: '1000' })
    const { client, inserts } = fakeClient([ok(stored)])
    const out = await valuationService.upsertLine(
      client,
      'v2',
      { boqItemId: 'itemB', inputMethod: 'quantity', percentComplete: null, qtyComplete: 20 },
      item,
    )
    expect(out.valueToDate).toBe(1000)
    const row = inserts.find((i) => i.table === 'valuation_lines')!.rows as Record<string, unknown>
    expect(row.value_to_date).toBe(1000)
  })
})

// ─── setSectionPercent — revised cap forwarded to computeLineValue ──────────────

describe('valuationService.setSectionPercent', () => {
  it('forwards revised to computeLineValue so value caps at revised amount, not contract amount', async () => {
    // Contract amount 1000, revised amount 1300 (approved +R300 delta).
    // At 50 % section-percent: value_to_date = 50% × 1300 = 650, NOT 50% × 1000 = 500.
    const item = { amount: 1000, supplyRate: null, installRate: null, rate: 100, rateModel: 'single' }
    const revised = { revisedAmount: 1300, revisedQty: null }
    const { client, inserts } = fakeClient([ok(null)])
    await valuationService.setSectionPercent(
      client,
      'v1',
      [{ boqItemId: 'itemR', item, revised }],
      50,
    )
    const up = inserts.find((i) => i.table === 'valuation_lines')!
    const rows = up.rows as Array<Record<string, unknown>>
    const row = rows[0]
    expect(row.boq_item_id).toBe('itemR')
    expect(row.input_method).toBe('section')
    expect(row.percent_complete).toBe(50)
    // Must be 650 (revised cap), not 500 (contract cap).
    expect(row.value_to_date).toBe(650)
  })
})

// ─── list / getPreviousNet ──────────────────────────────────────────────────────

describe('valuationService.list', () => {
  it('returns mapped valuations ordered by valuation_no', async () => {
    const rows = [valuationRow({ id: 'v1', valuation_no: 1 }), valuationRow({ id: 'v2', valuation_no: 2 })]
    const { client } = fakeClient([ok(rows)])
    const out = await valuationService.list(client, 'p1')
    expect(out).toHaveLength(2)
    expect(out[0].valuationNo).toBe(1)
    expect(out[1].id).toBe('v2')
  })
})

describe('valuationService.getPreviousNet', () => {
  it('returns the prior certified valuation net_to_date', async () => {
    const prior = valuationRow({ id: 'v1', valuation_no: 1, status: 'certified', net_to_date: '9500' })
    const { client } = fakeClient([ok(prior)])
    const out = await valuationService.getPreviousNet(client, 'p1', 2)
    expect(out).toBe(9500)
  })

  it('returns 0 when there is no prior certified valuation', async () => {
    const { client } = fakeClient([ok(null)])
    const out = await valuationService.getPreviousNet(client, 'p1', 1)
    expect(out).toBe(0)
  })
})

// ─── get — paginates lines ──────────────────────────────────────────────────────

describe('valuationService.get', () => {
  it('returns the valuation and pages past the 1000-row cap for lines', async () => {
    const val = valuationRow({ id: 'v2', valuation_no: 2 })
    const line = (i: number) => lineRow({ id: `l${i}`, valuation_id: 'v2', boq_item_id: `item${i}`, value_to_date: '1' })
    const lines = Array.from({ length: 2300 }, (_, i) => line(i))
    // Queue: 1) valuation maybeSingle; then range pages of 1000/1000/300.
    const { client } = fakeClient([
      ok(val),
      ok(lines.slice(0, 1000)),
      ok(lines.slice(1000, 2000)),
      ok(lines.slice(2000, 2300)),
    ])
    const out = await valuationService.get(client, 'v2')
    expect(out).not.toBeNull()
    expect(out!.valuation.id).toBe('v2')
    expect(out!.lines).toHaveLength(2300)
    expect(out!.lines[1999].boqItemId).toBe('item1999')
  })

  it('returns null when the valuation does not exist', async () => {
    const { client } = fakeClient([ok(null)])
    const out = await valuationService.get(client, 'missing')
    expect(out).toBeNull()
  })
})

// ─── certify ────────────────────────────────────────────────────────────────────

describe('valuationService.certify', () => {
  it('writes the snapshot figures + status=certified', async () => {
    const certified = valuationRow({
      id: 'v2',
      status: 'certified',
      gross_to_date: '10000',
      retention_amount: '500',
      net_to_date: '9500',
      previous_net: '4000',
      due_ex_vat: '5500',
      vat_amount: '825',
      due_incl_vat: '6325',
      certified_by: 'u9',
      report_id: 'rep1',
    })
    const { client, updates } = fakeClient([ok(certified)])
    const out = await valuationService.certify(client, 'v2', {
      certifiedBy: 'u9',
      reportId: 'rep1',
      figures: {
        grossToDate: 10000,
        retention: 500,
        netToDate: 9500,
        previousNet: 4000,
        dueExVat: 5500,
        vat: 825,
        dueInclVat: 6325,
      },
    })
    expect(out.status).toBe('certified')
    const patch = updates.find((u) => u.table === 'valuations')!.patch as Record<string, unknown>
    expect(patch.status).toBe('certified')
    expect(patch.gross_to_date).toBe(10000)
    expect(patch.retention_amount).toBe(500)
    expect(patch.net_to_date).toBe(9500)
    expect(patch.previous_net).toBe(4000)
    expect(patch.due_ex_vat).toBe(5500)
    expect(patch.vat_amount).toBe(825)
    expect(patch.due_incl_vat).toBe(6325)
    expect(patch.certified_by).toBe('u9')
    expect(patch.report_id).toBe('rep1')
    expect(patch.certified_at).toBeDefined()
  })
})
