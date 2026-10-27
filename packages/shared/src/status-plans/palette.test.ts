import { MAIN_BOARD_PALETTE, boardColours, boardShapeStyle, FEED_UNKNOWN_LABEL, FEED_UNKNOWN_STYLE } from './palette'
import { describe, it, expect } from 'vitest'
import {
  COLOURS,
  STROKE_PX,
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
const DB_STATUSES: DbBlockStatus[] = ['received', 'ordered', 'required', 'by_tenant', 'no_order', 'unlinked']

function allColours(s: ShapeStyle): string[] {
  return [s.fill, s.stroke, ...s.hatches.map((h) => h.color)].filter((c): c is string => c !== null)
}

describe('tenant shapes', () => {
  it('complete is green, in progress orange, both filled', () => {
    expect(tenantShapeStyle({ status: 'complete', overdue: false }).fill).toBe(COLOURS.complete)
    expect(tenantShapeStyle({ status: 'in_progress', overdue: false }).fill).toBe(COLOURS.inProgress)
    expect(tenantShapeStyle({ status: 'in_progress', overdue: false }).hatches).toEqual([])
  })
  it('overdue is its own solid red fill with a red outline — no hatch', () => {
    const s = tenantShapeStyle({ status: 'in_progress', overdue: true })
    expect(s.fill).toBe(COLOURS.overdue)
    expect(s.stroke).toBe(COLOURS.overdue)
    expect(s.fillOpacity).toBeGreaterThan(0)
    expect(s.hatches).toEqual([])
  })
  it('no tenant or area style is hatched', () => {
    for (const st of SHOP_STATUSES) for (const overdue of [false, true]) {
      expect(tenantShapeStyle({ status: st, overdue }).hatches, `${st} ${overdue}`).toEqual([])
    }
    for (const t of AREA_TYPES) expect(areaShapeStyle(t).hatches).toEqual([])
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
  const FILLED: Array<[DbBlockStatus, string]> = [
    ['received', COLOURS.complete],
    ['ordered', COLOURS.ordered],
    ['required', COLOURS.overdue],
    ['by_tenant', COLOURS.byTenant],
    ['no_order', COLOURS.noOrder],
  ]
  it.each(FILLED)('%s: a solid translucent fill with a full-strength 3 px outline in the same colour, no hatch', (st, colour) => {
    const s = dbBlockStyle(st)
    expect(s).toMatchObject({ fill: colour, stroke: colour, strokeWidth: STROKE_PX, dash: null, hatches: [] })
    expect(s.fillOpacity).toBeGreaterThanOrEqual(0.4)
    expect(s.fillOpacity).toBeLessThanOrEqual(0.6)
  })
  it('unlinked: a dashed grey outline and no fill', () => {
    expect(dbBlockStyle('unlinked')).toMatchObject({ fill: null, fillOpacity: 0, stroke: COLOURS.unlinked, dash: [10, 6], hatches: [] })
  })
  it('no two block statuses share a colour', () => {
    const colours = DB_STATUSES.map((st) => dbBlockStyle(st).fill ?? `outline:${dbBlockStyle(st).stroke}`)
    expect(new Set(colours).size).toBe(DB_STATUSES.length)
    const fills = FILLED.map(([, c]) => c)
    for (let i = 0; i < fills.length; i++) {
      for (let j = i + 1; j < fills.length; j++) expect(rgbDistance(fills[i]!, fills[j]!), `${fills[i]} vs ${fills[j]}`).toBeGreaterThanOrEqual(60)
    }
  })
  it('the legend says what each colour means', () => {
    expect(Object.fromEntries(SCHEMATIC_LEGEND.map((e) => [e.key, e.label]))).toEqual({
      received: 'Received',
      ordered: 'Ordered',
      required: 'Required — not yet ordered',
      by_tenant: 'Supplied by tenant',
      no_order: 'No order line',
      unlinked: 'Not linked to a board',
    })
    expect(Object.fromEntries(TENANT_LEGEND.slice(0, 5).map((e) => [e.key, e.label]))).toEqual({
      complete: 'Complete',
      in_progress: 'In progress',
      overdue: 'Overdue (past BO date)',
      decommissioned: 'Decommissioned',
      unlinked: 'Unassigned',
    })
  })
})

describe('legends and colours', () => {
  it('the tenant legend lists every shop status, overdue and every area type once', () => {
    expect(TENANT_LEGEND.map((e) => e.key)).toEqual([
      'complete', 'in_progress', 'overdue', 'decommissioned', 'unlinked', ...AREA_TYPES,
    ])
  })
  it('the schematic legend lists every block status once, most advanced first', () => {
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


function luminance(hex: string): number {
  const { r, g, b } = hexToRgb01(hex)
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
const contrastWithWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05)
const rgbDistance = (a: string, b: string) => {
  const x = hexToRgb01(a)
  const y = hexToRgb01(b)
  return 255 * Math.hypot(x.r - y.r, x.g - y.g, x.b - y.b)
}

describe('main-board palette', () => {
  it('has 12 distinct #RRGGBB colours', () => {
    expect(MAIN_BOARD_PALETTE).toHaveLength(12)
    expect(new Set(MAIN_BOARD_PALETTE).size).toBe(12)
    for (const c of MAIN_BOARD_PALETTE) expect(c).toMatch(/^#[0-9A-F]{6}$/)
  })
  it('never looks like a status colour (green complete, orange in progress, red overdue)', () => {
    for (const c of MAIN_BOARD_PALETTE) {
      for (const s of [COLOURS.complete, COLOURS.inProgress, COLOURS.overdue]) {
        expect(rgbDistance(c, s), `${c} vs ${s}`).toBeGreaterThanOrEqual(80)
      }
    }
  })
  it('stays clear of every other plan colour, and of each other', () => {
    for (const c of MAIN_BOARD_PALETTE) {
      for (const o of Object.values(COLOURS)) expect(rgbDistance(c, o), `${c} vs ${o}`).toBeGreaterThanOrEqual(60)
    }
    for (let i = 0; i < MAIN_BOARD_PALETTE.length; i++) {
      for (let j = i + 1; j < MAIN_BOARD_PALETTE.length; j++) {
        expect(rgbDistance(MAIN_BOARD_PALETTE[i]!, MAIN_BOARD_PALETTE[j]!)).toBeGreaterThanOrEqual(60)
      }
    }
  })
  it('each colour reads against the white label halo (contrast ≥ 3:1)', () => {
    for (const c of MAIN_BOARD_PALETTE) expect(contrastWithWhite(c), c).toBeGreaterThanOrEqual(3)
  })
  it('assigns colours by sorted board name, whatever order the boards arrive in; the 13th wraps', () => {
    const a = boardColours([{ id: 'b', name: 'MB 2.1' }, { id: 'a', name: 'MB 1.1' }])
    const b = boardColours([{ id: 'a', name: 'MB 1.1' }, { id: 'b', name: 'MB 2.1' }])
    expect(a).toEqual(b)
    expect(a).toEqual({ a: MAIN_BOARD_PALETTE[0], b: MAIN_BOARD_PALETTE[1] })
    const many = Array.from({ length: 13 }, (_, i) => ({ id: `m${i}`, name: `MB ${i + 1}` }))
    expect(boardColours(many).m12).toBe(MAIN_BOARD_PALETTE[0])
  })
  it('a board-coloured shop is a plain translucent fill: no hatch, no dash', () => {
    const s = boardShapeStyle('#1F5FBF')
    expect(s).toMatchObject({ fill: '#1F5FBF', stroke: '#1F5FBF', hatches: [], dash: null, strikeLabel: false })
    expect(s.fillOpacity).toBeGreaterThan(0)
    expect(boardShapeStyle('#1F5FBF', true).strikeLabel).toBe(true)
  })
  it('a shop with no feed is grey and dashed, never a board colour', () => {
    expect(FEED_UNKNOWN_LABEL).toBe('Feed not in the cable schedule')
    expect(FEED_UNKNOWN_STYLE.dash).toEqual([10, 6])
    expect(MAIN_BOARD_PALETTE as readonly string[]).not.toContain(FEED_UNKNOWN_STYLE.fill)
  })
})
