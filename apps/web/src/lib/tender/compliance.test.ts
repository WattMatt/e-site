import { describe, it, expect } from 'vitest'
import { checkCompliance, type ComplianceInput } from './compliance'

const NOW = new Date('2026-10-10T10:00:00Z')
const base = (): ComplianceInput => ({
  items: [
    { id: 'a', sheet_name: 'Bill 1', row_number: 5, code: '1.1', description: 'Cable', quantity: 3, rate_cell_type: 'priced', fixed_amount: null },
    { id: 'b', sheet_name: 'Bill 1', row_number: 6, code: '1.2', description: 'Dayworks', quantity: null, rate_cell_type: 'rate_only', fixed_amount: null },
    { id: 'c', sheet_name: 'Bill 1', row_number: 7, code: '1.3', description: 'PS connection', quantity: 1, rate_cell_type: 'fixed', fixed_amount: 50000 },
    { id: 'd', sheet_name: 'Bill 1', row_number: 8, code: '1.4', description: 'Optional extra', quantity: 2, rate_cell_type: 'not_priced', fixed_amount: null },
  ],
  lines: [
    { item_id: 'a', rate: 33.335, not_priced: false },
    { item_id: 'b', rate: 450, not_priced: false },
  ],
  requirements: [
    { id: 'r1', kind: 'document', label: 'CIDB certificate', mandatory: true },
    { id: 'r2', kind: 'document', label: 'Programme', mandatory: false },
    { id: 'r3', kind: 'declaration', label: 'Tender conditions accepted', mandatory: true },
  ],
  uploadedRequirementIds: ['r1'],
  acceptedDeclarationIds: ['r3'],
  profileComplete: true,
  unacknowledgedAddenda: [],
  tender: { status: 'issued', closing_at: '2026-10-20T10:00:00Z' },
  now: NOW,
})

describe('checkCompliance', () => {
  it('passes a complete submission and recomputes every amount', () => {
    const r = checkCompliance(base())
    expect(r.issues).toEqual([])
    expect(r.ok).toBe(true)
    // 3 × 33.335 = 100.005 → R100.01 (rounded once per line); rate-only carries no amount; fixed sum included.
    expect(r.priced).toEqual([
      { item_id: 'a', rate: 33.335, amount: 100.01 },
      { item_id: 'b', rate: 450, amount: 0 },
      { item_id: 'c', rate: null, amount: 50000 },
      { item_id: 'd', rate: null, amount: 0 },
    ])
    expect(r.total).toBe(50100.01)
  })

  it('gives a rate on a not-priced row no amount, as the database does (totals agree)', () => {
    const i = base()
    i.lines.push({ item_id: 'd', rate: 10, not_priced: false })
    const r = checkCompliance(i)
    expect(r.priced.find((p) => p.item_id === 'd')).toEqual({ item_id: 'd', rate: 10, amount: 0 })
    expect(r.total).toBe(50100.01)
  })

  it('blocks an unpriced item, a negative rate and "not priced" where it is not allowed', () => {
    const i = base()
    i.lines = [
      { item_id: 'a', rate: null, not_priced: true },
      { item_id: 'b', rate: -1, not_priced: false },
    ]
    const r = checkCompliance(i)
    expect(r.ok).toBe(false)
    expect(r.issues.map((x) => [x.kind, x.itemId])).toEqual([
      ['not_priced_not_allowed', 'a'],
      ['bad_rate', 'b'],
    ])
  })

  it('blocks a missing rate on a priced or rate-only row', () => {
    const i = base()
    i.lines = []
    expect(checkCompliance(i).issues.map((x) => x.itemId)).toEqual(['a', 'b'])
  })

  it('blocks missing mandatory documents and declarations, not optional ones', () => {
    const i = base()
    i.uploadedRequirementIds = []
    i.acceptedDeclarationIds = []
    expect(checkCompliance(i).issues.map((x) => [x.kind, x.requirementId])).toEqual([
      ['document', 'r1'],
      ['declaration', 'r3'],
    ])
  })

  it('blocks an incomplete profile, an unacknowledged addendum and a closed tender', () => {
    const i = base()
    i.profileComplete = false
    i.unacknowledgedAddenda = [{ id: 'x', title: 'Addendum 1' }]
    i.now = new Date('2026-10-20T10:00:00Z')
    expect(checkCompliance(i).issues.map((x) => x.kind)).toEqual(['closed', 'profile', 'addendum'])
  })

  it('never trusts a non-finite rate', () => {
    const i = base()
    i.lines = [{ item_id: 'a', rate: Number.POSITIVE_INFINITY, not_priced: false }, { item_id: 'b', rate: Number.NaN, not_priced: false }]
    expect(checkCompliance(i).issues.map((x) => x.kind)).toEqual(['bad_rate', 'bad_rate'])
  })
})
