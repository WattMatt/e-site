// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { loadTenantShopFacts } from './shop-facts'
import { fakeTablesClient } from './__fixtures__/fake-tables-client'
import { PROBE_TABLES } from './__fixtures__/probe-mall'

const ARGS = { projectId: 'p-1', orgId: 'org-1', openingDate: '2026-09-01' }

describe('loadTenantShopFacts', () => {
  it('returns the facts the report computes from', async () => {
    const { client } = fakeTablesClient(PROBE_TABLES)
    const facts = await loadTenantShopFacts(client, ARGS)
    expect(facts.activeNodes).toEqual([
      { id: 'n-1', shopNumber: 'ZZ01', shopName: 'Lantern Books', glaM2: 120, breakerA: 63, poleConfig: 'TP', loadA: 48 },
      { id: 'n-2', shopNumber: 'ZZ02', shopName: 'Copper Kettle', glaM2: 80, breakerA: 40, poleConfig: 'SP', loadA: null },
    ])
    expect(facts.decommissionedNodeIds).toEqual(['n-3'])
    expect(facts.decommissionedCount).toBe(1)
    expect(facts.scopeTypeIdByKey).toEqual({ db: 'tdb', lighting: 'tlt' })
    expect(facts.detailsByNode).toEqual(new Map([
      ['n-1', { scopeReceived: true, scopeNotRequired: false, layoutIssued: true }],
      ['n-2', { scopeReceived: false, scopeNotRequired: true, layoutIssued: false }],
    ]))
    expect(facts.orderStatusByNodeScope).toEqual(new Map([
      ['n-1:tdb', 'received'], ['n-1:tlt', 'by_tenant'], ['n-2:tdb', 'ordered'],
    ]))
    expect(facts.boByNode).toEqual(new Map([
      ['n-1', { effectiveDate: '2026-08-02' }],
      ['n-2', { effectiveDate: '2026-06-01' }],
    ]))
  })

  it('queries orders for active tenant nodes only, scoped orders only, and scope types for the org', async () => {
    const { client, calls } = fakeTablesClient(PROBE_TABLES)
    await loadTenantShopFacts(client, ARGS)
    const orders = calls.find((c) => c.table === 'structure.node_orders')!
    expect(orders.ops).toContainEqual(['in', ['node_id', ['n-1', 'n-2']]])
    expect(orders.ops).toContainEqual(['not', ['scope_item_type_id', 'is', null]])
    const types = calls.find((c) => c.table === 'structure.scope_item_types')!
    expect(types.ops).toContainEqual(['eq', ['organisation_id', 'org-1']])
    const nodes = calls.find((c) => c.table === 'structure.nodes')!
    expect(nodes.ops).toContainEqual(['eq', ['kind', 'tenant_db']])
  })

  it('skips the detail and order reads when the project has no active tenants', async () => {
    const { client, calls } = fakeTablesClient({ ...PROBE_TABLES, 'structure.nodes': [] })
    const facts = await loadTenantShopFacts(client, ARGS)
    expect(facts.activeNodes).toEqual([])
    expect(calls.map((c) => c.table)).not.toContain('structure.tenant_details')
    expect(calls.map((c) => c.table)).not.toContain('structure.node_orders')
  })
})
