// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { fakeClient, queued, opsOf } from './__fixtures__/fake-client'
import { pickOnPlanLinks, loadOnPlanLinks } from './on-plan-links'

const PLANS = [
  { id: 'old', name: 'Ground (2025)', updated_at: '2026-01-01T00:00:00+00:00' },
  { id: 'new', name: 'Ground', updated_at: '2026-10-09T00:00:00+00:00' },
]
const SHAPES = [
  { id: 's-old', status_plan_id: 'old', node_id: 'n1' },
  { id: 's-new', status_plan_id: 'new', node_id: 'n1' },
  { id: 's-2', status_plan_id: 'old', node_id: 'n2' },
]

describe('pickOnPlanLinks', () => {
  it('a shop on several plans links to the most recently updated one', () => {
    expect(pickOnPlanLinks(PLANS, SHAPES)).toEqual({
      n1: { planId: 'new', planName: 'Ground', shapeId: 's-new' },
      n2: { planId: 'old', planName: 'Ground (2025)', shapeId: 's-2' },
    })
  })
})

describe('loadOnPlanLinks', () => {
  it('reads tenant-layout plans of the project and their linked shapes', async () => {
    const { client, calls } = fakeClient(queued({
      'tenants.status_plans:select': [{ data: PLANS }],
      'tenants.status_plan_shapes:select': [{ data: SHAPES }],
    }))
    expect(Object.keys(await loadOnPlanLinks(client, 'p1'))).toEqual(['n1', 'n2'])
    expect(opsOf(calls, 'tenants.status_plans')).toEqual(expect.arrayContaining([
      ['eq', ['project_id', 'p1']], ['eq', ['purpose', 'tenant_layout']],
    ]))
    expect(opsOf(calls, 'tenants.status_plan_shapes')).toContainEqual(['not', ['node_id', 'is', null]])
  })

  it('never breaks the schedule: a read error is an empty map', async () => {
    const { client } = fakeClient(queued({ 'tenants.status_plans:select': [{ error: { message: 'relation does not exist' } }] }))
    expect(await loadOnPlanLinks(client, 'p1')).toEqual({})
  })
})
