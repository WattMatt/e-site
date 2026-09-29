import { describe, it, expect } from 'vitest'
import { validateObjectInput, moduleSpecError, inverterSpecError, MAX_MODULES_PER_ARRAY } from './validate'
import { GENERIC_MODULE_550 as M, GENERIC_INVERTER_50KW as INV } from './types'

const ID = '11111111-1111-4111-8111-111111111111'
const roofProps = { name: 'Main', roofType: 'flat', pitchDeg: 0, fallBearingDeg: null, heightM: 6, setbackM: 0.5, maxLoadKgM2: null }
const arrayProps = { roofId: ID, module: M, orientation: 'portrait', mounting: 'racked', tiltDeg: 15, facingSheetDeg: 0, azimuthOverrideDeg: null, rowPitchM: 3.5, gapM: 0.02 }

describe('validateObjectInput', () => {
  it('accepts a well-formed roof, array, inverter, string and equipment', () => {
    expect(validateObjectInput({ id: ID, kind: 'roof', geometry: { points: [0, 0, 10, 0, 10, 10] }, props: roofProps })).toBeNull()
    expect(validateObjectInput({ id: ID, kind: 'array', geometry: { modules: [[0, 0, 1, 0, 1, 1, 0, 1]] }, props: arrayProps })).toBeNull()
    expect(validateObjectInput({ id: ID, kind: 'inverter', geometry: { x: 1, y: 2 }, props: { name: 'INV', inverter: INV } })).toBeNull()
    expect(validateObjectInput({ id: ID, kind: 'string', geometry: {}, props: { inverterId: ID, mppt: 1, modules: [{ arrayId: ID, index: 0 }] } })).toBeNull()
    expect(validateObjectInput({ id: ID, kind: 'equipment', geometry: { x: 1, y: 2 }, props: { equipmentKind: 'db', name: 'DB-1', nodeId: ID } })).toBeNull()
  })
  it('refuses with a sentence, never a TypeError', () => {
    expect(validateObjectInput(null)).toBe('An object in the layout is malformed.')
    expect(validateObjectInput({ id: 'x', kind: 'roof', geometry: { points: [] }, props: roofProps })).toBe('An object in the layout has an invalid id.')
    expect(validateObjectInput({ id: ID, kind: 'wall', geometry: {}, props: {} })).toBe('An object in the layout has an unknown kind.')
    expect(validateObjectInput({ id: ID, kind: 'north', geometry: {}, props: {} })).toBe('North is set on the roof source, not drawn as an object.')
    expect(validateObjectInput({ id: ID, kind: 'roof', geometry: { points: [0, 0, 10, 0] }, props: roofProps })).toBe('A roof outline needs at least three points.')
    expect(validateObjectInput({ id: ID, kind: 'roof', geometry: { points: [0, 0, 10, 0, 10, Number.NaN] }, props: roofProps })).toBe('A roof outline has a point that is not a number.')
    expect(validateObjectInput({ id: ID, kind: 'array', geometry: { modules: [[0, 0, 1]] }, props: arrayProps })).toBe('Every module needs four corners.')
    expect(validateObjectInput({ id: ID, kind: 'array', geometry: { modules: Array.from({ length: MAX_MODULES_PER_ARRAY + 1 }, () => [0, 0, 1, 0, 1, 1, 0, 1]) }, props: arrayProps }))
      .toBe(`An array can hold at most ${MAX_MODULES_PER_ARRAY} modules; split it.`)
    expect(validateObjectInput({ id: ID, kind: 'array', geometry: { modules: [] }, props: { ...arrayProps, module: { ...M, powerW: 0 } } })).toBe('The module needs a positive power rating.')
    expect(validateObjectInput({ id: ID, kind: 'string', geometry: {}, props: { inverterId: ID, mppt: 0, modules: [] } })).toBe('A string must sit on MPPT 1 or higher.')
    expect(validateObjectInput({ id: ID, kind: 'obstruction', geometry: { cx: 1, cy: 1, r: -1 }, props: { name: 'x', setbackM: 0, heightM: 0 } })).toBe('A circular obstruction needs a positive radius.')
  })
  it('spec checks are usable on their own (New layout dialog)', () => {
    expect(moduleSpecError(M)).toBeNull()
    expect(moduleSpecError({ ...M, vocStc: 'x' })).toBe('The module datasheet figures must be numbers.')
    expect(inverterSpecError(INV)).toBeNull()
    expect(inverterSpecError({ ...INV, mppts: 0 })).toBe('The inverter needs at least one MPPT.')
  })
})
