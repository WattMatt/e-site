import { describe, it, expect } from 'vitest'
import {
  removeObjects, removeModules, translateObjects, rotateObjects, selectionPivot, diffObjects,
  applyObjectDelta, cloneLayoutObjects, stringColour, STRING_COLOURS, stableStringify,
} from './doc'
import { GENERIC_INVERTER_50KW as INV, GENERIC_MODULE_550 as M, type LayoutObject } from './types'

const q = (x: number, y: number) => [x, y, x + 10, y, x + 10, y + 20, x, y + 20]
const roof: LayoutObject = { id: 'R', kind: 'roof', pixelsPerMeter: 10, geometry: { points: [0, 0, 100, 0, 100, 50, 0, 50] },
  props: { name: 'R', roofType: 'pitched', pitchDeg: 20, fallBearingDeg: 0, heightM: 5, setbackM: 0.3, maxLoadKgM2: null } }
const arr: LayoutObject = { id: 'A', kind: 'array', pixelsPerMeter: 10, geometry: { modules: [q(0, 0), q(10, 0), q(20, 0)] },
  props: { roofId: 'R', module: M, orientation: 'portrait', mounting: 'flush', tiltDeg: 20, facingSheetDeg: 0, azimuthOverrideDeg: null, rowPitchM: 2, gapM: 0.02 } }
const inv: LayoutObject = { id: 'I', kind: 'inverter', pixelsPerMeter: 10, geometry: { x: 50, y: 60 }, props: { name: 'INV', inverter: INV } }
const str: LayoutObject = { id: 'S', kind: 'string', pixelsPerMeter: 10, geometry: {},
  props: { inverterId: 'I', mppt: 1, modules: [{ arrayId: 'A', index: 0 }, { arrayId: 'A', index: 2 }] } }
const DOC = [roof, arr, inv, str]

describe('removeObjects', () => {
  it('deleting an inverter deletes its strings', () => {
    expect(removeObjects(DOC, ['I']).map((o) => o.id)).toEqual(['R', 'A'])
  })
  it('deleting an array drops its modules from strings, and an empty string goes too', () => {
    expect(removeObjects(DOC, ['A']).map((o) => o.id)).toEqual(['R', 'I'])
  })
})

describe('removeModules (Delete on selected modules)', () => {
  it('re-indexes the survivors in every string', () => {
    const out = removeModules(DOC, [{ arrayId: 'A', index: 1 }])
    const a = out.find((o) => o.id === 'A')!
    expect(a.kind === 'array' && a.geometry.modules.length).toBe(2)
    const s = out.find((o) => o.id === 'S')!
    expect(s.kind === 'string' && s.props.modules).toEqual([{ arrayId: 'A', index: 0 }, { arrayId: 'A', index: 1 }])
  })
  it('a string that loses every module is removed', () => {
    const out = removeModules(DOC, [{ arrayId: 'A', index: 0 }, { arrayId: 'A', index: 2 }])
    expect(out.find((o) => o.id === 'S')).toBeUndefined()
  })
})

describe('translate and rotate', () => {
  it('translates every geometry kind and leaves strings alone', () => {
    const out = translateObjects(DOC, ['R', 'A', 'I', 'S'], 5, -5)
    expect(out[0]!.kind === 'roof' && out[0]!.geometry.points.slice(0, 2)).toEqual([5, -5])
    expect(out[1]!.kind === 'array' && out[1]!.geometry.modules[0]!.slice(0, 2)).toEqual([5, -5])
    expect(out[2]!.kind === 'inverter' && out[2]!.geometry).toEqual({ x: 55, y: 55 })
    expect(out[3]).toBe(str)
  })
  it('rotates about the selection pivot and turns the array facing and the roof fall line with it', () => {
    const pivot = selectionPivot(DOC, ['A'])!
    expect(pivot).toEqual({ x: 15, y: 10 })
    const out = rotateObjects(DOC, ['R', 'A'], 90, { x: 0, y: 0 })
    const a = out.find((o) => o.id === 'A')!
    expect(a.kind === 'array' && a.props.facingSheetDeg).toBe(90)
    const r = out.find((o) => o.id === 'R')!
    expect(r.kind === 'roof' && r.props.fallBearingDeg).toBe(90)
    // (10, 0) → (0, 10) clockwise on screen
    expect(a.kind === 'array' && a.geometry.modules[0]![2]).toBeCloseTo(0, 9)
    expect(a.kind === 'array' && a.geometry.modules[0]![3]).toBeCloseTo(10, 9)
  })
})

describe('diff / apply / clone', () => {
  it('diffs by content, independent of key order', () => {
    const reordered: LayoutObject = { ...inv, props: { inverter: INV, name: 'INV' } } as LayoutObject
    expect(diffObjects(DOC, [roof, arr, reordered, str])).toEqual({ upserts: [], deletes: [] })
    const moved = translateObjects(DOC, ['I'], 1, 0)
    expect(diffObjects(DOC, moved).upserts.map((o) => o.id)).toEqual(['I'])
    expect(diffObjects(DOC, [roof, arr]).deletes).toEqual(['I', 'S'])
  })
  it('stableStringify sorts keys at every depth', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } })).toBe('{"a":{"c":[3,{"e":0,"f":1}],"d":2},"b":1}')
  })
  it('applies a delta: keeps saved scales, stamps new objects with the given scale', () => {
    const neu: LayoutObject = { ...inv, id: 'I2', pixelsPerMeter: null }
    const out = applyObjectDelta(DOC, [{ ...roof, pixelsPerMeter: null }, neu], ['S'], 25)
    expect(out.map((o) => [o.id, o.pixelsPerMeter])).toEqual([['R', 10], ['A', 10], ['I', 10], ['I2', 25]])
  })
  it('clones with fresh ids and remaps every reference', () => {
    let n = 0
    const out = cloneLayoutObjects(DOC, () => `new-${++n}`)
    const ids = new Map(DOC.map((o, i) => [o.id, out[i]!.id]))
    const a = out[1]!
    expect(a.kind === 'array' && a.props.roofId).toBe(ids.get('R'))
    const s = out[3]!
    expect(s.kind === 'string' && s.props.inverterId).toBe(ids.get('I'))
    expect(s.kind === 'string' && s.props.modules[0]!.arrayId).toBe(ids.get('A'))
  })
  it('string colours cycle', () => {
    expect(stringColour(0)).toBe(STRING_COLOURS[0])
    expect(stringColour(STRING_COLOURS.length)).toBe(STRING_COLOURS[0])
  })
})
