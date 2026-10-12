import { describe, it, expect } from 'vitest'
import { shopStatus } from '@esite/shared/status-plans'
import { shopLinkFor } from './shop-link'
import type { TenantShopFacts } from '@/lib/tenant-schedule/shop-facts'

const FACTS: TenantShopFacts = {
  activeNodes: [
    { id: 'n-1', shopNumber: 'ZZ01', shopName: 'Lantern Books', glaM2: 120, breakerA: null, poleConfig: null, loadA: null },
    { id: 'n-2', shopNumber: 'ZZ02', shopName: 'Copper Kettle', glaM2: 80, breakerA: null, poleConfig: null, loadA: null },
  ],
  decommissionedCount: 1,
  decommissionedNodeIds: ['n-3'],
  scopeTypeIdByKey: { db: 'tdb', lighting: 'tlt' },
  detailsByNode: new Map([
    ['n-1', { scopeReceived: true, scopeNotRequired: false, layoutIssued: true }],
    ['n-2', { scopeReceived: false, scopeNotRequired: false, layoutIssued: false }],
  ]),
  orderStatusByNodeScope: new Map([
    ['n-1:tdb', 'received'], ['n-1:tlt', 'by_tenant'],
    ['n-2:tdb', 'ordered'],
  ]),
  boByNode: new Map([
    ['n-1', { effectiveDate: '2026-05-01' }],
    ['n-2', { effectiveDate: '2026-05-01' }],
  ]),
}

describe('shopLinkFor', () => {
  it('a shape with no node is unlinked', () => {
    expect(shopLinkFor(FACTS, null)).toEqual({ state: 'unlinked' })
  })
  it('a decommissioned tenant is decommissioned', () => {
    expect(shopLinkFor(FACTS, 'n-3')).toEqual({ state: 'decommissioned' })
  })
  it('a node the facts do not know (soft-deleted, or not a tenant) is unlinked', () => {
    expect(shopLinkFor(FACTS, 'n-gone')).toEqual({ state: 'unlinked' })
  })
  it('an active tenant carries its facts', () => {
    expect(shopLinkFor(FACTS, 'n-1')).toEqual({
      state: 'active',
      facts: { db: 'received', lights: 'by_tenant', scope: 'received', layoutIssued: true, boDate: '2026-05-01' },
    })
  })
  it('feeds shopStatus end to end', () => {
    expect(shopStatus(shopLinkFor(FACTS, 'n-1'), '2026-06-20')).toEqual({ status: 'complete', overdue: false })
    expect(shopStatus(shopLinkFor(FACTS, 'n-2'), '2026-06-20')).toEqual({ status: 'in_progress', overdue: true })
  })
})
