import { describe, it, expect } from 'vitest'
import { layoutSummary, layoutBom, bomToCsv, storedSummary, DC_ROUTING_FACTOR } from './summary'
import { GENERIC_INVERTER_50KW as INV, GENERIC_MODULE_550 as M, type LayoutObject } from './types'

const PPM = 10 // 10 px per metre
const quad = (x: number, y: number) => [x, y, x + 10, y, x + 10, y + 20, x, y + 20] // 1 m × 2 m
const ROOF: LayoutObject = {
  id: 'roof1', kind: 'roof', pixelsPerMeter: PPM,
  geometry: { points: [0, 0, 200, 0, 200, 120, 0, 120] }, // 20 m × 12 m
  props: { name: 'Main', roofType: 'flat', pitchDeg: 0, fallBearingDeg: null, heightM: 6, setbackM: 0.5, maxLoadKgM2: null },
}
const ARRAY: LayoutObject = {
  id: 'arr1', kind: 'array', pixelsPerMeter: PPM,
  geometry: { modules: [quad(10, 10), quad(30, 10)] },
  props: { roofId: 'roof1', module: M, orientation: 'portrait', mounting: 'racked', tiltDeg: 15, facingSheetDeg: 0, azimuthOverrideDeg: null, rowPitchM: 3.5, gapM: 0.02 },
}
const INVERTER: LayoutObject = { id: 'inv1', kind: 'inverter', pixelsPerMeter: PPM, geometry: { x: 110, y: 10 }, props: { name: 'INV-1', inverter: INV } }
const STRING: LayoutObject = {
  id: 's1', kind: 'string', pixelsPerMeter: PPM, geometry: {},
  props: { inverterId: 'inv1', mppt: 1, modules: [{ arrayId: 'arr1', index: 0 }, { arrayId: 'arr1', index: 1 }] },
}
const COND = { tMinC: -5, tAmbMaxC: 35 }

describe('layoutSummary', () => {
  it('totals kWp, AC, ratio, counts and utilisation', () => {
    const s = layoutSummary([ROOF, ARRAY, INVERTER, STRING], COND)
    expect(s.moduleCount).toBe(2)
    expect(s.dcKwp).toBeCloseTo(1.1, 12)
    expect(s.acKw).toBe(50)
    expect(s.dcAcRatio).toBeCloseTo(0.022, 12)
    expect(s.modulesByType).toEqual([{ label: 'Generic 550 W mono (edit to the datasheet)', count: 2, kwp: 1.1 }])
    expect(s.inverterCount).toBe(1)
    expect(s.roofAreaM2).toBe(240)
    expect(s.moduleAreaM2).toBe(4)
    expect(s.utilisationPct).toBeCloseTo((4 / 240) * 100, 12)
    expect(s.arraysWithModules).toBe(1)
    expect(s.arraysOutsideRoof).toEqual([])
    expect(s.unstrungModules).toBe(0)
  })
  it('string checks: 2 × 550 W cannot reach the 200 V MPPT minimum when hot — fail', () => {
    const s = layoutSummary([ROOF, ARRAY, INVERTER, STRING], COND)
    expect(s.strings).toEqual({ total: 1, pass: 0, warn: 0, fail: 1 })
  })
  it('flags an array with a module outside every roof', () => {
    const outside: LayoutObject = { ...ARRAY, id: 'arr2', geometry: { modules: [quad(400, 400)] } } as LayoutObject
    expect(layoutSummary([ROOF, ARRAY, outside], COND).arraysOutsideRoof).toEqual(['arr2'])
  })
  it('counts modules not in any string', () => {
    expect(layoutSummary([ROOF, ARRAY, INVERTER], COND).unstrungModules).toBe(2)
  })
  it('no roofs → no utilisation; no inverter → no ratio', () => {
    const s = layoutSummary([ARRAY], COND)
    expect(s.utilisationPct).toBeNull()
    expect(s.dcAcRatio).toBeNull()
  })
})

describe('BOM', () => {
  it('lists modules, inverters, mounting and a DC cable estimate', () => {
    const objs = [ROOF, ARRAY, INVERTER, STRING]
    const rows = layoutBom(objs, layoutSummary(objs, COND))
    expect(rows.map((r) => r.item)).toEqual(['Module', 'Inverter', 'Mounting', 'DC cable'])
    expect(rows[0]).toEqual({ item: 'Module', description: 'Generic 550 W mono (edit to the datasheet)', quantity: 2, unit: 'ea' })
    expect(rows[2]).toEqual({ item: 'Mounting', description: 'Racking positions (estimate)', quantity: 2, unit: 'ea' })
    // Module centres (1.5, 2) and (3.5, 2) m → string centre (2.5, 2); inverter (11, 1) m:
    // Manhattan 8.5 + 1 = 9.5 m, × 2 conductors × routing factor.
    expect(rows[3]!.quantity).toBeCloseTo(9.5 * 2 * DC_ROUTING_FACTOR, 6)
  })
  it('CSV quotes fields that carry commas or quotes', () => {
    const csv = bomToCsv([{ item: 'Module', description: 'Brand "X", 550', quantity: 2, unit: 'ea' }])
    expect(csv).toBe('Item,Description,Quantity,Unit\r\nModule,"Brand ""X"", 550",2,ea\r\n')
  })
})

describe('storedSummary', () => {
  it('keeps only the figures the list and readiness read', () => {
    const s = storedSummary(layoutSummary([ROOF, ARRAY, INVERTER, STRING], COND))
    expect(s).toEqual({ moduleCount: 2, dcKwp: 1.1, acKw: 50, arraysWithModules: 1, arrayOutsideRoof: false, stringsFail: 1 })
  })
})

describe('review fixes', () => {
  it('BOM CSV neutralises spreadsheet formulas in text fields (CSV injection)', () => {
    const csv = bomToCsv([
      { item: 'Module', description: '=HYPERLINK("http://x","d")', quantity: 1, unit: 'ea' },
      { item: '+cmd', description: '-2+3', quantity: 2, unit: '@x' },
    ])
    const cells = csv.split('\r\n').slice(1).filter(Boolean).flatMap((l) => l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/))
    for (const c of cells) expect(/^"?[=+\-@\t\r]/.test(c), c).toBe(false)
    expect(csv).toContain(`"'=HYPERLINK(""http://x"",""d"")"`)
  })
  it('DC cable length uses ONE frame: an inverter saved at another scale sits at its drawn pixels', () => {
    const inv20 = { ...INVERTER, pixelsPerMeter: 20 } as LayoutObject
    const objs = [ROOF, ARRAY, inv20, STRING]
    const rows = layoutBom(objs, layoutSummary(objs, COND))
    expect(rows[3]!.quantity).toBeCloseTo(9.5 * 2 * DC_ROUTING_FACTOR, 6)
  })
  it('unsaved objects use the sheet scale for metre figures', () => {
    const unsavedRoof = { ...ROOF, pixelsPerMeter: null } as LayoutObject
    const unsavedArray = { ...ARRAY, pixelsPerMeter: null } as LayoutObject
    const s = layoutSummary([unsavedRoof, unsavedArray], COND, PPM)
    expect(s.roofAreaM2).toBe(240)
    expect(s.moduleAreaM2).toBe(4)
    expect(layoutSummary([unsavedRoof, unsavedArray], COND).utilisationPct).toBeNull()
  })
})
