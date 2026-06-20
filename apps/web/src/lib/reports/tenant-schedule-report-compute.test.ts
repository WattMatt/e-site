import { describe, it, expect } from 'vitest'
import { computeReportModel, orderStateLabel, type ComputeInput } from './tenant-schedule-report-compute'

const base: ComputeInput = {
  activeNodes: [
    { id: 'n1', shopNumber: 'L01', shopName: 'Woolworths', glaM2: 1240 },
    { id: 'n2', shopNumber: 'L02', shopName: 'Mr Price', glaM2: 480 },
    { id: 'n3', shopNumber: 'L03', shopName: 'Clicks', glaM2: 320 },
  ],
  decommissionedCount: 1,
  scopeTypeIdByKey: { db: 'tdb', lighting: 'tlt' },
  detailsByNode: new Map([
    ['n1', { scopeReceived: true, layoutIssued: true }],
    ['n2', { scopeReceived: false, layoutIssued: true }],
    ['n3', { scopeReceived: true, layoutIssued: false }],
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

describe('computeReportModel', () => {
  const { kpis, shopRows } = computeReportModel(base)

  it('builds one row per active shop, sorted by shop number, with DB/Lights states', () => {
    expect(shopRows.map((r) => r.shopNumber)).toEqual(['L01', 'L02', 'L03'])
    expect(shopRows[0]).toMatchObject({ tenantName: 'Woolworths', db: 'ordered', lights: 'received', layoutIssued: true, boOverdue: false })
    expect(shopRows[2]).toMatchObject({ db: 'required', lights: null, layoutIssued: false })
  })

  it('counts shops & GLA (active + decommissioned)', () => {
    expect(kpis.activeShops).toBe(3)
    expect(kpis.decommissionedShops).toBe(1)
    expect(kpis.totalShops).toBe(4)
    expect(kpis.totalGlaM2).toBe(2040)
  })

  it('computes scope & layout completion percentages over active shops', () => {
    expect(kpis.scopeReceivedPct).toBe(67)
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
