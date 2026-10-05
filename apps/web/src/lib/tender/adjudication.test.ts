import { describe, it, expect } from 'vitest'
import { adjudicate, median, type AdjBid, type AdjItem } from './adjudication'

const items: AdjItem[] = [
  { id: 'a', sheet_name: 'B1', row_number: 5, bill_code: '1', code: '1.1', description: 'Cable', unit: 'm', quantity: 100, rate_cell_type: 'priced', fixed_amount: null },
  { id: 'b', sheet_name: 'B1', row_number: 6, bill_code: '1', code: '1.2', description: 'Dayworks', unit: 'hr', quantity: null, rate_cell_type: 'rate_only', fixed_amount: null },
  { id: 'c', sheet_name: 'B2', row_number: 5, bill_code: '2', code: '2.1', description: 'PS connection', unit: 'Sum', quantity: 1, rate_cell_type: 'fixed', fixed_amount: 5000 },
  { id: 'd', sheet_name: 'B2', row_number: 6, bill_code: '2', code: '2.2', description: 'Board', unit: 'No', quantity: 3, rate_cell_type: 'priced', fixed_amount: null },
]
const bid = (id: string, rates: Record<string, number | null>, notPriced: string[] = []): AdjBid => ({
  participantId: id,
  company: `Co ${id}`,
  submittedAt: '2026-10-10T10:00:00Z',
  lines: Object.fromEntries(Object.entries(rates).map(([k, r]) => [k, { rate: r, not_priced: notPriced.includes(k) }])),
})

describe('median', () => {
  it('handles odd, even and empty', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBeNull()
  })
})

describe('adjudicate', () => {
  const bids = [
    bid('x', { a: 10, b: 400, d: 1000 }),
    bid('y', { a: 12, b: 450, d: 1500 }), // d is high vs median 1000
    bid('z', { a: 11, b: 0, d: 600 }),    // d is low; b is zero
  ]
  const r = adjudicate(items, { a: { rate: 11, amount: 1100 }, d: { rate: 900, amount: 2700 } }, bids, [], [])

  it('recomputes every amount and adds fixed sums to every bid', () => {
    const byId = Object.fromEntries(r.totals.map((t) => [t.participantId, t.total]))
    expect(byId).toEqual({ x: 1000 + 5000 + 3000, y: 1200 + 5000 + 4500, z: 1100 + 5000 + 1800 })
  })

  it('ranks the lowest total first and compares with the estimate', () => {
    expect(r.totals.map((t) => [t.participantId, t.rank])).toEqual([['z', 1], ['x', 2], ['y', 3]])
    expect(r.estimateTotal).toBe(1100 + 5000 + 2700)
    expect(r.totals[0].vsEstimatePct).toBe(Math.round(((7900 - 8800) / 8800) * 1000) / 10)
  })

  it('flags rates far from the median, zero rates and unpriced rows', () => {
    const d = r.rows.find((x) => x.item.id === 'd')!
    expect(d.medianRate).toBe(1000)
    expect(d.bids.y.flag).toBe('high')
    expect(d.bids.z.flag).toBe('low')
    expect(d.bids.x.flag).toBeNull()
    expect(r.rows.find((x) => x.item.id === 'b')!.bids.z.flag).toBe('zero')
  })

  it('reports a submitted bid missing rates as an integrity failure, not as a cheap bid', () => {
    const r2 = adjudicate(items, {}, [bid('x', { a: 10 }), bid('y', { a: 10, b: 5, d: 2 })], [], [])
    expect(r2.integrity).toEqual([{ participantId: 'x', company: 'Co x', missing: 2 }])
  })

  it('does not count a row the bidder may leave not priced as missing', () => {
    const np: AdjItem = { ...items[0], id: 'e', code: '1.9', rate_cell_type: 'not_priced' }
    const r2 = adjudicate([...items, np], {}, [bid('x', { a: 1, b: 1, d: 1, e: null }, ['e'])], [], [])
    expect(r2.integrity).toEqual([])
    expect(r2.rows.find((x) => x.item.id === 'e')!.bids.x.flag).toBe('not_priced')
  })

  it('flags against the estimate even with one bidder, and never against a median of fewer than three', () => {
    const one = adjudicate(items, { a: { rate: 11, amount: 1100 } }, [bid('x', { a: 40, b: 1, d: 1 })], [], [])
    const a1 = one.rows.find((x) => x.item.id === 'a')!
    expect(a1.bids.x.vsEstimate).toBe('above')
    expect(a1.bids.x.flag).toBeNull()
    expect(one.totals[0].flags.aboveEstimate).toBe(1)
    const two = adjudicate(items, {}, [bid('x', { a: 10, b: 1, d: 1 }), bid('y', { a: 100, b: 1, d: 1 })], [], [])
    const a2 = two.rows.find((x) => x.item.id === 'a')!
    expect(a2.medianRate).toBeNull()
    expect([a2.bids.x.flag, a2.bids.y.flag]).toEqual([null, null])
    expect(a2.bids.y.vsEstimate).toBeNull()
  })

  it('shows no estimate when none was uploaded, even though fixed sums are known', () => {
    const r2 = adjudicate(items, {}, [bid('x', { a: 1, b: 1, d: 1 })], [], [])
    expect(r2.estimateTotal).toBeNull()
    expect(r2.totals[0].vsEstimatePct).toBeNull()
  })

  it('puts the estimate on the bids\u2019 basis (quantity × rate) and reports its own arithmetic errors', () => {
    const r2 = adjudicate(items, { a: { rate: 11, amount: 1200 }, d: { rate: null, amount: 2700 } }, [bid('x', { a: 1, b: 1, d: 1 })], [], [])
    expect(r2.estimateTotal).toBe(1100 + 5000 + 2700)
    expect(r2.arithmetic.estimate).toEqual([
      expect.objectContaining({ itemId: 'a', stated: 1200, computed: 1100 }),
    ])
  })

  it('gives equal totals the same rank', () => {
    const r2 = adjudicate(items, {}, [bid('x', { a: 10, b: 1, d: 1 }), bid('y', { a: 10, b: 2, d: 1 }), bid('z', { a: 20, b: 1, d: 1 })], [], [])
    expect(r2.totals.map((t) => [t.participantId, t.rank])).toEqual([['x', 1], ['y', 1], ['z', 3]])
  })

  it('splits totals by bill', () => {
    expect(r.totals.find((t) => t.participantId === 'x')!.byBill).toEqual({ '1': 1000, '2': 8000 })
    expect(r.estimateByBill).toEqual({ '1': 1100, '2': 7700 })
  })

  it('builds the document and declaration checklist per bidder', () => {
    const r3 = adjudicate(
      items,
      {},
      [bid('x', {}), bid('y', {})],
      [
        { id: 'r1', kind: 'document', label: 'CIDB', mandatory: true },
        { id: 'r2', kind: 'declaration', label: 'Conditions', mandatory: true },
      ],
      [
        { participantId: 'x', documents: { r1: ['cidb.pdf'] }, declarations: ['r2'], profile: null },
        { participantId: 'y', documents: {}, declarations: [], profile: null },
      ],
    )
    expect(r3.checklist.map((c) => [c.requirement.id, c.byBidder.x.ok, c.byBidder.y.ok])).toEqual([
      ['r1', true, false],
      ['r2', true, false],
    ])
    expect(r3.checklist[0].byBidder.x.detail).toBe('cidb.pdf')
  })
})
