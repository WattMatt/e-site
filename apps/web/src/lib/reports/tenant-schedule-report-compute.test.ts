import { describe, it, expect } from 'vitest'
import { computeReportModel, orderStateLabel, scopeStateLabel, type ComputeInput } from './tenant-schedule-report-compute'

const base: ComputeInput = {
  activeNodes: [
    { id: 'n1', shopNumber: 'L01', shopName: 'Woolworths', glaM2: 1240, breakerA: 63, poleConfig: 'TP', loadA: 60 },
    { id: 'n2', shopNumber: 'L02', shopName: 'Mr Price', glaM2: 480, breakerA: null, poleConfig: null, loadA: null },
    { id: 'n3', shopNumber: 'L03', shopName: 'Clicks', glaM2: 320, breakerA: 100, poleConfig: 'TP', loadA: 80 },
  ],
  decommissionedCount: 1,
  scopeTypeIdByKey: { db: 'tdb', lighting: 'tlt' },
  detailsByNode: new Map([
    ['n1', { scopeReceived: true, scopeNotRequired: false, layoutIssued: true }],
    ['n2', { scopeReceived: false, scopeNotRequired: false, layoutIssued: true }],
    ['n3', { scopeReceived: true, scopeNotRequired: false, layoutIssued: false }],
  ]),
  orderStatusByNodeScope: new Map([
    ['n1:tdb', 'ordered'], ['n1:tlt', 'received'],
    ['n2:tdb', 'by_tenant'], ['n2:tlt', 'by_tenant'],
    ['n3:tdb', 'required'],
  ]),
  boByNode: new Map([
    ['n1', { effectiveDate: '2026-08-15' }],
    ['n2', { effectiveDate: '2026-05-01' }],
    ['n3', { effectiveDate: null }],
  ]),
  today: '2026-06-20',
}

describe('orderStateLabel', () => {
  it('maps statuses to display labels and null to dash', () => {
    expect(orderStateLabel('by_tenant')).toBe('By tenant')
    expect(orderStateLabel('required')).toBe('Required')
    expect(orderStateLabel('ordered')).toBe('Ordered')
    expect(orderStateLabel('received')).toBe('Received')
    expect(orderStateLabel(null)).toBe('—')
  })
})

describe('scopeStateLabel', () => {
  it('maps scope states to display labels, with landlord-covered → N/A', () => {
    expect(scopeStateLabel('awaited')).toBe('Awaited')
    expect(scopeStateLabel('received')).toBe('Received')
    expect(scopeStateLabel('not_required')).toBe('N/A')
  })
})

describe('computeReportModel', () => {
  const { kpis, shopRows } = computeReportModel(base)

  it('builds one row per active shop, sorted by shop number, with DB/Lights/Scope states', () => {
    expect(shopRows.map((r) => r.shopNumber)).toEqual(['L01', 'L02', 'L03'])
    expect(shopRows[0]).toMatchObject({ tenantName: 'Woolworths', db: 'ordered', lights: 'received', scope: 'received', layoutIssued: true, boOverdue: false })
    // electrical fields pass through from the node
    expect(shopRows[0]).toMatchObject({ breakerA: 63, poleConfig: 'TP', loadA: 60 })
    expect(shopRows[1]).toMatchObject({ breakerA: null, loadA: null, scope: 'awaited' })
    expect(shopRows[2]).toMatchObject({ db: 'required', lights: null, scope: 'received', layoutIssued: false })
  })

  it('counts shops & GLA (active + decommissioned)', () => {
    expect(kpis.activeShops).toBe(3)
    expect(kpis.decommissionedShops).toBe(1)
    expect(kpis.totalShops).toBe(4)
    expect(kpis.totalGlaM2).toBe(2040)
  })

  it('computes scope & layout completion counts and percentages over active shops', () => {
    // n1 + n3 scope-complete, n1 + n2 layouts-issued → 2 of 3 each.
    expect(kpis.scopeComplete).toBe(2)
    expect(kpis.scopeCompletePct).toBe(67)
    expect(kpis.layoutsIssued).toBe(2)
    expect(kpis.layoutsIssuedPct).toBe(67)
  })

  it('computes landlord-to-order vs ordered for boards & lights', () => {
    expect(kpis.boards).toEqual({ landlord: 2, ordered: 1 })
    expect(kpis.lights).toEqual({ landlord: 1, ordered: 1 })
    expect(kpis.byTenantCount).toBe(2)
  })

  it('buckets BO dates into upcoming / overdue / no-date', () => {
    expect(kpis.bo).toEqual({ upcoming: 1, overdue: 1, noDate: 1 })
  })
})

describe('computeReportModel — landlord-covered scope override (not_required)', () => {
  const input: ComputeInput = {
    activeNodes: [
      { id: 'a', shopNumber: 'L01', shopName: 'Edgars', glaM2: 500, breakerA: null, poleConfig: null, loadA: null },
      { id: 'b', shopNumber: 'L02', shopName: 'Truworths', glaM2: 500, breakerA: null, poleConfig: null, loadA: null },
    ],
    decommissionedCount: 0,
    scopeTypeIdByKey: { db: 'tdb', lighting: 'tlt' },
    detailsByNode: new Map([
      // 'a' received via document; 'b' has NO document but landlord covers full scope.
      ['a', { scopeReceived: true, scopeNotRequired: false, layoutIssued: false }],
      ['b', { scopeReceived: false, scopeNotRequired: true, layoutIssued: false }],
    ]),
    orderStatusByNodeScope: new Map(),
    boByNode: new Map(),
    today: '2026-06-20',
  }

  const { kpis, shopRows } = computeReportModel(input)

  it('renders the override row as not_required (N/A), precedence over awaited', () => {
    expect(shopRows.map((r) => r.scope)).toEqual(['received', 'not_required'])
  })

  it('counts a landlord-covered tenant as scope-complete', () => {
    // Both tenants complete: one received, one not_required → 2 of 2, 100%.
    expect(kpis.scopeComplete).toBe(2)
    expect(kpis.scopeCompletePct).toBe(100)
  })
})
