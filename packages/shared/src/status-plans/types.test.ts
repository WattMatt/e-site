import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import {
  STATUS_PLAN_PURPOSES,
  AREA_TYPES,
  SHAPE_KINDS,
  SHAPE_SOURCES,
  MAX_POINT_VALUES,
  pointsError,
  statusPlanFromRow,
  statusPlanShapeFromRow,
  type StatusPlanRow,
  type StatusPlanShapeRow,
} from './types'

const MIGRATIONS_DIR = new URL('../../../../apps/edge-functions/supabase/migrations/', import.meta.url)

function migrationSql(): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{5}_status_plans\.sql$/.test(f))
  expect(files).toHaveLength(1)
  return readFileSync(new URL(files[0]!, MIGRATIONS_DIR), 'utf8')
}

/** Every quoted literal on the line that declares the named constraint. */
function checkList(sql: string, constraint: string): string[] {
  const line = sql.split('\n').find((l) => l.includes(`CONSTRAINT ${constraint} CHECK`))
  expect(line, `constraint ${constraint} not found`).toBeDefined()
  return [...line!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!)
}

describe('constants mirror the migration CHECKs', () => {
  const sql = migrationSql()

  it('purposes', () => {
    expect([...STATUS_PLAN_PURPOSES].sort()).toEqual(checkList(sql, 'status_plans_purpose_check').sort())
  })
  it('area types', () => {
    expect([...AREA_TYPES].sort()).toEqual(checkList(sql, 'status_plan_shapes_area_type_check').sort())
  })
  it('shape kinds', () => {
    expect([...SHAPE_KINDS].sort()).toEqual(checkList(sql, 'status_plan_shapes_shape_check').sort())
  })
  it('sources', () => {
    expect([...SHAPE_SOURCES].sort()).toEqual(checkList(sql, 'status_plan_shapes_source_check').sort())
  })
  it('the point cap', () => {
    const line = sql.split('\n').find((l) => l.includes('CONSTRAINT status_plan_shapes_points_shape CHECK'))!
    expect(Number(line.match(/BETWEEN 6 AND (\d+)/)![1])).toBe(MAX_POINT_VALUES)
  })
})

describe('pointsError mirrors status_plan_shapes_points_shape', () => {
  it('accepts a triangle polygon and a four-corner rectangle', () => {
    expect(pointsError('polygon', [0, 0, 10, 0, 10, 10])).toBeNull()
    expect(pointsError('rect', [0, 0, 10, 0, 10, 10, 0, 10])).toBeNull()
  })
  it('refuses a non-array, non-numbers, odd counts and too few corners', () => {
    expect(pointsError('polygon', 'nope')).toBe('A shape needs a list of points.')
    expect(pointsError('polygon', [0, 0, 10, 'x', 10, 10])).toBe('Every point must be a number.')
    expect(pointsError('polygon', [0, 0, 10, Number.NaN, 10, 10])).toBe('Every point must be a number.')
    expect(pointsError('polygon', [0, 0, 10, 0, 10, 10, 5])).toBe('Points come in x, y pairs.')
    expect(pointsError('polygon', [0, 0, 10, 0])).toBe('A shape needs at least three corners.')
  })
  it('refuses a rectangle without exactly four corners', () => {
    expect(pointsError('rect', [0, 0, 10, 0, 10, 10])).toBe('A rectangle has exactly four corners.')
  })
  it('refuses more than the cap and accepts exactly the cap', () => {
    // A convex 1000-gon: the cap test must not trip the crossing check.
    const n = MAX_POINT_VALUES / 2
    const at = Array.from({ length: n }, (_, i) => [
      1000 * Math.cos((2 * Math.PI * i) / n),
      1000 * Math.sin((2 * Math.PI * i) / n),
    ]).flat()
    expect(pointsError('polygon', at)).toBeNull()
    expect(pointsError('polygon', [...at, 1, 2])).toBe('This shape has too many corners (2,000 at most).')
  })
})

describe('row mappers', () => {
  it('maps a plan row', () => {
    const row: StatusPlanRow = {
      id: 'sp-1', project_id: 'p-1', organisation_id: 'o-1', floor_plan_id: 'fp-1', page_index: 2,
      purpose: 'tenant_layout', name: 'Ground floor', source_file_path: 'drawings/zz-100.pdf',
      created_by: 'u-1', created_at: '2026-10-09T08:00:00Z', updated_at: '2026-10-09T09:00:00Z',
    }
    expect(statusPlanFromRow(row)).toEqual({
      id: 'sp-1', projectId: 'p-1', organisationId: 'o-1', floorPlanId: 'fp-1', pageIndex: 2,
      purpose: 'tenant_layout', name: 'Ground floor', sourceFilePath: 'drawings/zz-100.pdf',
      createdBy: 'u-1', createdAt: '2026-10-09T08:00:00Z', updatedAt: '2026-10-09T09:00:00Z',
    })
  })
  it('maps a shape row and coerces points to numbers', () => {
    const row: StatusPlanShapeRow = {
      id: 'sh-1', status_plan_id: 'sp-1', shape: 'rect', points: [0, 0, 10, 0, 10, 5, 0, 5],
      node_id: null, area_type: 'vacant', detected_tag: null, source: 'manual',
      created_by: null, created_at: '2026-10-09T08:00:00Z', updated_at: '2026-10-09T08:00:00Z',
    }
    expect(statusPlanShapeFromRow(row)).toEqual({
      id: 'sh-1', statusPlanId: 'sp-1', shape: 'rect', points: [0, 0, 10, 0, 10, 5, 0, 5],
      nodeId: null, areaType: 'vacant', detectedTag: null, source: 'manual',
      createdBy: null, createdAt: '2026-10-09T08:00:00Z', updatedAt: '2026-10-09T08:00:00Z',
    })
  })
  it('refuses a shape row whose points the database would never have stored', () => {
    const row = { id: 'sh-2', status_plan_id: 'sp-1', shape: 'polygon', points: { not: 'an array' },
      node_id: null, area_type: null, detected_tag: null, source: 'manual',
      created_by: null, created_at: 'x', updated_at: 'x' } as unknown as StatusPlanShapeRow
    expect(() => statusPlanShapeFromRow(row)).toThrow('status_plan_shapes sh-2: A shape needs a list of points.')
  })
})

describe('pointsError self-intersection', () => {
  it('asks for a redraw when the outline crosses itself', () => {
    expect(pointsError('polygon', [0, 0, 10, 10, 10, 0, 0, 10])).toBe(
      'The outline crosses itself — redraw it without crossing lines.',
    )
  })
})
