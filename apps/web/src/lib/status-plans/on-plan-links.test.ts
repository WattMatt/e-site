// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { fakeClient, queued, opsOf } from './__fixtures__/fake-client'
import { pickOnPlanLinks, loadOnPlanLinks } from './on-plan-links'

const SHEETS = [
  { id: 'sh2', label: 'Level 1', sort_order: 1 },
  { id: 'sh1', label: 'Ground floor', sort_order: 0 },
]
const SHAPES = [
  { id: 's-1', sheet_id: 'sh1', node_id: 'n1' },
  { id: 's-2', sheet_id: 'sh2', node_id: 'n2' },
]

describe('pickOnPlanLinks', () => {
  it('each linked shop points at its sheet and shape', () => {
    expect(pickOnPlanLinks(SHEETS, SHAPES)).toEqual({
      n1: { sheetId: 'sh1', sheetLabel: 'Ground floor', shapeId: 's-1' },
      n2: { sheetId: 'sh2', sheetLabel: 'Level 1', shapeId: 's-2' },
    })
  })
})

describe('loadOnPlanLinks', () => {
  it('reads the project\'s floor plan, its sheets and its linked shapes', async () => {
    const { client, calls } = fakeClient(queued({
      'tenants.status_plans:select': [{ data: { id: 'fp' } }],
      'tenants.status_plan_sheets:select': [{ data: SHEETS }],
      'tenants.status_plan_shapes:select': [{ data: SHAPES }],
    }))
    expect(Object.keys(await loadOnPlanLinks(client, 'p1')).sort()).toEqual(['n1', 'n2'])
    expect(opsOf(calls, 'tenants.status_plans')).toEqual(expect.arrayContaining([
      ['eq', ['project_id', 'p1']], ['eq', ['purpose', 'tenant_layout']],
    ]))
    expect(opsOf(calls, 'tenants.status_plan_shapes')).toContainEqual(['not', ['node_id', 'is', null]])
  })

  it('no floor plan: no links', async () => {
    const { client } = fakeClient(queued({ 'tenants.status_plans:select': [{ data: null }] }))
    expect(await loadOnPlanLinks(client, 'p1')).toEqual({})
  })

  it('never breaks the schedule: a read error is an empty map', async () => {
    const { client } = fakeClient(queued({ 'tenants.status_plans:select': [{ error: { message: 'relation does not exist' } }] }))
    expect(await loadOnPlanLinks(client, 'p1')).toEqual({})
  })
})
