// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { fakeClient, queued } from './__fixtures__/fake-client'
import { emptyCards, loadTenantPlanCards } from './plan-cards'

describe('loadTenantPlanCards', () => {
  it('one card per tool, floor plan first, with sheet / shape / linked counts', async () => {
    const { client } = fakeClient(queued({
      'tenants.status_plans:select': [{ data: [{ id: 'ld', purpose: 'distribution_schematic' }, { id: 'fp', purpose: 'tenant_layout' }] }],
      'tenants.status_plan_sheets:select': [{ data: [{ id: 'a', status_plan_id: 'fp' }, { id: 'b', status_plan_id: 'fp' }, { id: 'c', status_plan_id: 'ld' }] }],
      'tenants.status_plan_shapes:select': [{ data: [
        { id: 's1', status_plan_id: 'fp', node_id: 'n1' },
        { id: 's2', status_plan_id: 'fp', node_id: null },
        { id: 's3', status_plan_id: 'ld', node_id: 'm1' },
      ] }],
    }))
    expect(await loadTenantPlanCards(client, 'p1')).toEqual([
      { purpose: 'tenant_layout', planId: 'fp', sheets: 2, shapes: 2, linked: 1 },
      { purpose: 'distribution_schematic', planId: 'ld', sheets: 1, shapes: 1, linked: 1 },
    ])
  })

  it('no plans yet: two empty cards', async () => {
    const { client } = fakeClient(queued({ 'tenants.status_plans:select': [{ data: [] }] }))
    expect(await loadTenantPlanCards(client, 'p1')).toEqual(emptyCards())
    expect(emptyCards().map((c) => c.purpose)).toEqual(['tenant_layout', 'distribution_schematic'])
  })

  it('never breaks the schedule: a read error is two empty cards', async () => {
    const { client } = fakeClient(queued({ 'tenants.status_plans:select': [{ error: { message: 'relation does not exist' } }] }))
    expect(await loadTenantPlanCards(client, 'p1')).toEqual(emptyCards())
  })
})
