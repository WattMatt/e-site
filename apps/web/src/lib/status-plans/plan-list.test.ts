// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { fakeClient, queued, opsOf } from './__fixtures__/fake-client'
import { planListRows, defaultPlanName, loadStatusPlanList } from './plan-list'

const PLANS = [
  { id: 'a', name: 'Ground', purpose: 'tenant_layout', page_index: 1, floor_plan_id: 'fp1', updated_at: '2026-10-09T10:00:00+00:00' },
  { id: 'b', name: '300 sheet 1', purpose: 'distribution_schematic', page_index: 1, floor_plan_id: 'fp-old', updated_at: '2026-10-08T10:00:00+00:00' },
]
const SHAPES = [
  { id: 's1', status_plan_id: 'a', node_id: 'n1', area_type: null },
  { id: 's2', status_plan_id: 'a', node_id: null, area_type: 'common' },
  { id: 's3', status_plan_id: 'a', node_id: null, area_type: null },
]

describe('planListRows', () => {
  it('counts shapes, linked shops and areas per plan, and names the drawing', () => {
    expect(planListRows(PLANS, [{ id: 'fp1', name: 'E-100 Ground' }], SHAPES)).toEqual([
      { id: 'a', name: 'Ground', purpose: 'tenant_layout', purposeLabel: 'Tenant layout', pageIndex: 1, drawingName: 'E-100 Ground', shapes: 3, linked: 1, areas: 1, updatedAt: '2026-10-09T10:00:00+00:00' },
      { id: 'b', name: '300 sheet 1', purpose: 'distribution_schematic', purposeLabel: 'Distribution schematic', pageIndex: 1, drawingName: 'Drawing not available', shapes: 0, linked: 0, areas: 0, updatedAt: '2026-10-08T10:00:00+00:00' },
    ])
  })
})

describe('defaultPlanName', () => {
  it('names by drawing and purpose, adding the page only past page 1', () => {
    expect(defaultPlanName('E-100 Ground', 'tenant_layout', 1)).toBe('E-100 Ground — Tenant layout')
    expect(defaultPlanName('643-E-300', 'distribution_schematic', 3)).toBe('643-E-300 — Distribution schematic (page 3)')
  })
  it('never exceeds the 120-character limit', () => {
    expect(defaultPlanName('x'.repeat(200), 'tenant_layout', 1).length).toBeLessThanOrEqual(120)
  })
})

describe('loadStatusPlanList', () => {
  it('reads plans, drawings and shapes for the project; offers active drawings only', async () => {
    const { client, calls } = fakeClient(queued({
      'tenants.status_plans:select': [{ data: PLANS }],
      'tenants.floor_plans:select': [{ data: [
        { id: 'fp1', name: 'E-100 Ground', file_path: 'x/E-100.pdf', is_active: true },
        { id: 'fp2', name: 'Site DWG', file_path: 'x/site.dwg', is_active: true },
        { id: 'fp-old', name: 'Retired', file_path: 'x/old.pdf', is_active: false },
      ] }],
      'tenants.status_plan_shapes:select': [{ data: SHAPES }],
    }))
    const out = await loadStatusPlanList(client, 'p1')
    expect(out.rows.map((r) => [r.id, r.drawingName, r.shapes])).toEqual([['a', 'E-100 Ground', 3], ['b', 'Retired', 0]])
    expect(out.drawings).toEqual([
      { id: 'fp1', name: 'E-100 Ground', renderable: true },
      { id: 'fp2', name: 'Site DWG', renderable: false },
    ])
    expect(opsOf(calls, 'tenants.status_plans')).toContainEqual(['eq', ['project_id', 'p1']])
    expect(opsOf(calls, 'tenants.status_plan_shapes')).toContainEqual(['in', ['status_plan_id', ['a', 'b']]])
  })

  it('reads no shapes when there are no plans', async () => {
    const { client, calls } = fakeClient(queued({ 'tenants.status_plans:select': [{ data: [] }], 'tenants.floor_plans:select': [{ data: [] }] }))
    expect((await loadStatusPlanList(client, 'p1')).rows).toEqual([])
    expect(calls.map((c) => c.table)).not.toContain('tenants.status_plan_shapes')
  })
})
