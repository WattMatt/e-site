import { describe, it, expect } from 'vitest'
import {
  COLOURS,
  HATCH_SPACING_PX,
  tenantShapeStyle,
  areaShapeStyle,
  dbBlockStyle,
  TENANT_LEGEND,
  SCHEMATIC_LEGEND,
  hexToRgb01,
  type ShapeStyle,
} from './palette'
import { AREA_TYPES } from './types'
import type { ShopStatus } from './shop-status'
import type { DbBlockStatus } from './db-block-status'

const SHOP_STATUSES: ShopStatus[] = ['complete', 'in_progress', 'decommissioned', 'unlinked']
const DB_STATUSES: DbBlockStatus[] = ['required', 'ordered', 'received', 'by_tenant', 'no_order', 'unlinked']

function allColours(s: ShapeStyle): string[] {
  return [s.fill, s.stroke, ...s.hatches.map((h) => h.color)].filter((c): c is string => c !== null)
}

describe('tenant shapes', () => {
  it('complete is green, in progress orange, both filled', () => {
    expect(tenantShapeStyle({ status: 'complete', overdue: false }).fill).toBe(COLOURS.complete)
    expect(tenantShapeStyle({ status: 'in_progress', overdue: false }).fill).toBe(COLOURS.inProgress)
    expect(tenantShapeStyle({ status: 'in_progress', overdue: false }).hatches).toEqual([])
  })
  it('overdue keeps the base fill and adds a red outline and red diagonal hatch', () => {
    const s = tenantShapeStyle({ status: 'in_progress', overdue: true })
    expect(s.fill).toBe(COLOURS.inProgress)
    expect(s.stroke).toBe(COLOURS.overdue)
    expect(s.hatches).toEqual([{ angleDeg: 45, spacing: HATCH_SPACING_PX, color: COLOURS.overdue, width: 2 }])
  })
  it('decommissioned strikes its label; unlinked does not', () => {
    expect(tenantShapeStyle({ status: 'decommissioned', overdue: false }).strikeLabel).toBe(true)
    expect(tenantShapeStyle({ status: 'unlinked', overdue: false }).strikeLabel).toBe(false)
  })
  it('area-type fills never collide with a status fill', () => {
    const statusFills = new Set(SHOP_STATUSES.map((s) => tenantShapeStyle({ status: s, overdue: false }).fill))
    for (const t of AREA_TYPES) expect(statusFills.has(areaShapeStyle(t).fill), t).toBe(false)
    expect(new Set(AREA_TYPES.map((t) => areaShapeStyle(t).fill)).size).toBe(AREA_TYPES.length)
  })
})

describe('schematic DB blocks', () => {
  it('required: red outline, no fill', () => {
    const s = dbBlockStyle('required')
    expect(s.fill).toBeNull()
    expect(s.stroke).toBe(COLOURS.overdue)
  })
  it('ordered: amber diagonal hatch', () => {
    expect(dbBlockStyle('ordered').hatches).toEqual([{ angleDeg: 45, spacing: HATCH_SPACING_PX, color: COLOURS.ordered, width: 2 }])
  })
  it('received: translucent green fill', () => {
    const s = dbBlockStyle('received')
    expect(s.fill).toBe(COLOURS.complete)
    expect(s.fillOpacity).toBeGreaterThan(0)
    expect(s.fillOpacity).toBeLessThan(1)
  })
  it('by tenant: grey cross-hatch (two directions)', () => {
    expect(dbBlockStyle('by_tenant').hatches.map((h) => h.angleDeg)).toEqual([45, 135])
  })
  it('no order: thin neutral outline only; unlinked: dashed grey outline', () => {
    expect(dbBlockStyle('no_order')).toMatchObject({ fill: null, hatches: [], dash: null, stroke: COLOURS.neutral })
    expect(dbBlockStyle('no_order').strokeWidth).toBeLessThan(dbBlockStyle('required').strokeWidth)
    expect(dbBlockStyle('unlinked').dash).toEqual([10, 6])
  })
})

describe('legends and colours', () => {
  it('the tenant legend lists every shop status, overdue and every area type once', () => {
    expect(TENANT_LEGEND.map((e) => e.key)).toEqual([
      'complete', 'in_progress', 'overdue', 'decommissioned', 'unlinked', ...AREA_TYPES,
    ])
  })
  it('the schematic legend lists every block status once', () => {
    expect(SCHEMATIC_LEGEND.map((e) => e.key)).toEqual(DB_STATUSES)
  })
  it('every colour used anywhere is a #RRGGBB hex', () => {
    const styles = [...TENANT_LEGEND, ...SCHEMATIC_LEGEND].map((e) => e.style)
    for (const s of styles) for (const c of allColours(s)) expect(c).toMatch(/^#[0-9A-F]{6}$/)
  })
  it('hexToRgb01 converts for pdf-lib', () => {
    expect(hexToRgb01('#2E9E4F')).toEqual({ r: 46 / 255, g: 158 / 255, b: 79 / 255 })
    expect(() => hexToRgb01('green')).toThrow('not a #RRGGBB colour: green')
  })
})
