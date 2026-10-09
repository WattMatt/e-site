import { describe, it, expect } from 'vitest'
import { toCanvasShape, shapePatchRow, roundPoints, SHAPE_COLUMNS } from './canvas-shape'

const ROW = {
  id: 's1', status_plan_id: 'pl1', shape: 'polygon' as const,
  points: [612.375, -0.5, 1024.125, 2383.9375, 300, 300],
  node_id: 'n1', area_type: null, detected_tag: null, source: 'manual' as const,
  created_by: 'u1', created_at: '2026-10-09T08:00:00.000001+00:00', updated_at: '2026-10-09T09:15:42.123456+00:00',
}

describe('toCanvasShape', () => {
  it('keeps every coordinate exactly and carries updated_at as the write token', () => {
    expect(toCanvasShape(ROW)).toEqual({
      id: 's1', shape: 'polygon',
      points: [612.375, -0.5, 1024.125, 2383.9375, 300, 300],
      nodeId: 'n1', areaType: null, detectedTag: null, source: 'manual',
      updatedAt: '2026-10-09T09:15:42.123456+00:00',
    })
  })
  it('refuses points the database would refuse (slice 1 statusPlanShapeFromRow)', () => {
    expect(() => toCanvasShape({ ...ROW, shape: 'rect' })).toThrow()
  })
  it('selects every column the mapper reads', () => {
    for (const k of Object.keys(ROW)) expect(SHAPE_COLUMNS).toContain(k)
  })
})

describe('roundPoints', () => {
  it('rounds to 2 dp without moving a coordinate by more than 0.005 px', () => {
    expect(roundPoints([612.3751, -0.4949, 10])).toEqual([612.38, -0.49, 10])
  })
})

describe('shapePatchRow', () => {
  it('geometry only', () => {
    expect(shapePatchRow({ points: [1, 2, 3, 4, 5, 6] })).toEqual({ points: [1, 2, 3, 4, 5, 6] })
  })
  it('linking a board clears any area type', () => {
    expect(shapePatchRow({ nodeId: 'n1' })).toEqual({ node_id: 'n1', area_type: null })
  })
  it('setting an area type clears any board', () => {
    expect(shapePatchRow({ areaType: 'common' })).toEqual({ area_type: 'common', node_id: null })
  })
  it('unassign clears both', () => {
    expect(shapePatchRow({ nodeId: null, areaType: null })).toEqual({ node_id: null, area_type: null })
  })
  it('an empty patch writes nothing', () => {
    expect(shapePatchRow({})).toEqual({})
  })
})
