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
  PURPOSE_LABEL,
  DEFAULT_PLAN_NAME,
  TENANT_PLAN_BUCKET,
  TENANT_PLAN_MAX_BYTES,
  TENANT_PLAN_MIMES,
  SHEET_LABEL_MAX,
  type StatusPlanRow,
  type StatusPlanShapeRow,
  type StatusPlanSheetRow,
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
      id: 'sp-1', project_id: 'p-1', organisation_id: 'o-1', purpose: 'tenant_layout', name: 'Floor plan',
      created_by: 'u-1', created_at: '2026-10-12T08:00:00Z', updated_at: '2026-10-12T09:00:00Z',
    }
    expect(statusPlanFromRow(row)).toEqual({
      id: 'sp-1', projectId: 'p-1', organisationId: 'o-1', purpose: 'tenant_layout', name: 'Floor plan',
      createdBy: 'u-1', createdAt: '2026-10-12T08:00:00Z', updatedAt: '2026-10-12T09:00:00Z',
    })
  })
  it('maps a shape row and coerces points to numbers', () => {
    const row: StatusPlanShapeRow = {
      id: 'sh-1', status_plan_id: 'sp-1', sheet_id: 'sh-1', shape: 'rect', points: [0, 0, 10, 0, 10, 5, 0, 5],
      node_id: null, area_type: 'vacant', detected_tag: null, source: 'manual',
      created_by: null, created_at: '2026-10-09T08:00:00Z', updated_at: '2026-10-09T08:00:00Z',
    }
    expect(statusPlanShapeFromRow(row)).toEqual({
      id: 'sh-1', statusPlanId: 'sp-1', sheetId: 'sh-1', shape: 'rect', points: [0, 0, 10, 0, 10, 5, 0, 5],
      nodeId: null, areaType: 'vacant', detectedTag: null, source: 'manual',
      createdBy: null, createdAt: '2026-10-09T08:00:00Z', updatedAt: '2026-10-09T08:00:00Z',
    })
  })
  it('refuses a shape row whose points the database would never have stored', () => {
    const row = { id: 'sh-2', status_plan_id: 'sp-1', sheet_id: 'sh-1', shape: 'polygon', points: { not: 'an array' },
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

describe('pointsError zero area', () => {
  it('names the rectangle problem before any crossing check', () => {
    expect(pointsError('rect', [100, 100, 100, 100, 100, 260, 100, 260])).toBe('The rectangle has no area — drag it larger.')
    expect(pointsError('rect', [0, 0, 50, 0, 50, 0, 0, 0])).toBe('The rectangle has no area — drag it larger.')
  })
  it('names the polygon problem for collinear corners', () => {
    expect(pointsError('polygon', [0, 0, 10, 10, 20, 20])).toBe('The outline has no area — move the corners apart.')
  })
})

describe('tenant plan constants', () => {
  function tenantPlansSql(): string {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{5}_tenant_plans\.sql$/.test(f))
    expect(files).toHaveLength(1)
    return readFileSync(new URL(files[0]!, MIGRATIONS_DIR), 'utf8')
  }

  it('the two tools are named as the owner names them', () => {
    expect(PURPOSE_LABEL).toEqual({ tenant_layout: 'Tenant floor plan', distribution_schematic: 'Line diagram' })
    expect(DEFAULT_PLAN_NAME).toEqual({ tenant_layout: 'Floor plan', distribution_schematic: 'Line diagram' })
  })

  it('bucket, size limit and file types mirror the migration', () => {
    const sql = tenantPlansSql()
    expect(TENANT_PLAN_BUCKET).toBe('tenant-plan-files')
    expect(sql).toContain(`VALUES ('${TENANT_PLAN_BUCKET}', '${TENANT_PLAN_BUCKET}', false, ${TENANT_PLAN_MAX_BYTES}, ARRAY[${TENANT_PLAN_MIMES.map((m) => `'${m}'`).join(', ')}])`)
    const mimeLine = sql.split('\n').find((l) => l.includes('CONSTRAINT status_plan_sheets_mime_check CHECK'))!
    expect([...TENANT_PLAN_MIMES].sort()).toEqual([...mimeLine.matchAll(/'([a-z]+\/[a-z]+)'/g)].map((m) => m[1]!).sort())
    expect(TENANT_PLAN_MAX_BYTES).toBe(60 * 1024 * 1024)
  })

  it('the label cap mirrors the CHECK', () => {
    const line = tenantPlansSql().split('\n').find((l) => l.includes('CONSTRAINT status_plan_sheets_label_not_blank CHECK'))!
    expect(Number(line.match(/BETWEEN 1 AND (\d+)/)![1])).toBe(SHEET_LABEL_MAX)
  })

  it('a sheet row type carries every column the migration creates', () => {
    const row: StatusPlanSheetRow = {
      id: 'sh', status_plan_id: 'sp', organisation_id: 'o', sort_order: 0, label: 'Sheet 1 of 1',
      file_path: 'o/p/sp/sh/1.pdf', page_index: 1, file_name: 'a.pdf', mime: 'application/pdf', revision: 1,
      replaced_at: null, replaced_from_path: null, pixels_per_meter: null, calibration_points: null,
      calibration_metres: null, created_by: null, created_at: 't', updated_at: 't',
    }
    const created = tenantPlansSql().split('CREATE TABLE IF NOT EXISTS tenants.status_plan_sheets (')[1]!.split(');')[0]!
    const columns = [...created.matchAll(/^\s{4}([a-z_]+)\s+[A-Z]/gm)].map((m) => m[1]!)
    expect(Object.keys(row).sort()).toEqual(columns.sort())
  })
})
