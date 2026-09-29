import { describe, expect, it } from 'vitest'
import { decideEnergyUnit, parseUnitToken, randPerKvarh, randPerKwh, unitClass } from './units'

describe('unitClass', () => {
  it('classes every unit', () => {
    expect(unitClass('c_per_kWh')).toBe('per_kwh')
    expect(unitClass('R_per_kWh')).toBe('per_kwh')
    expect(unitClass('R_per_POD_day')).toBe('per_day')
    expect(unitClass('R_per_day')).toBe('per_day')
    expect(unitClass('R_per_kVA_month')).toBe('per_kva_month')
    expect(unitClass('c_per_kVArh')).toBe('per_kvarh')
    expect(unitClass('pct')).toBe('pct')
  })
})

describe('randPerKwh', () => {
  it('converts cents and rand, and refuses anything else', () => {
    expect(randPerKwh({ unit: 'c_per_kWh', amountExclVat: 227.28 })).toBeCloseTo(2.2728, 10)
    expect(randPerKwh({ unit: 'R_per_kWh', amountExclVat: 2.2728 })).toBe(2.2728)
    expect(() => randPerKwh({ unit: 'R_per_month', amountExclVat: 1 })).toThrow(TypeError)
    expect(randPerKvarh({ unit: 'c_per_kVArh', amountExclVat: 37.64 })).toBeCloseTo(0.3764, 10)
  })
})

describe('parseUnitToken', () => {
  it.each([
    ['c/kWh', 'c_per_kWh'],
    ['Approved c/kWh', 'c_per_kWh'],
    ['(c/kWh)supplied;  and', 'c_per_kWh'],
    ['R/kWh', 'R_per_kWh'],
    ['R / kWh', 'R_per_kWh'],
    ['(c/kVArh)', 'c_per_kVArh'],
    ['(R.cents/kvarh)', 'c_per_kVArh'],
    ['[R/POD/day]', 'R_per_POD_day'],
    ['/day', 'R_per_day'],
    ['R/kVA/m', 'R_per_kVA_month'],
    ['//kVA', 'R_per_kVA_month'],
    ['A/kVA NMD/Month', 'R_per_kVA_month'],
    ['(R/Month)', 'R_per_month'],
    ['PER MONTH', 'R_per_month'],
    ['/month', 'R_per_month'],
    ['R/A/m', 'R_per_A_month'],
    ['%', 'pct'],
  ] as const)('%s -> %s', (text, unit) => {
    expect(parseUnitToken(text)).toBe(unit)
  })
  it('never reads a rand-per-kVArh or per-kVA-per-day price as a kVA demand or a daily charge (no such unit)', () => {
    expect(parseUnitToken('R/kVArh')).toBeNull()
    expect(parseUnitToken('Reactive energy [R/kvarh]')).toBeNull()
    expect(parseUnitToken('R/kVA/day')).toBeNull()
    expect(parseUnitToken('(c/kVArh)')).toBe('c_per_kVArh')
  })
  it('needs a rand prefix before a bare /kWh', () => {
    expect(parseUnitToken('/kWh')).toBeNull()
    expect(parseUnitToken('/kWh', { randPrefix: true })).toBe('R_per_kWh')
  })
  it('treats a bare kVA as a unit only when the caller says the text is a value tail', () => {
    expect(parseUnitToken('kVA')).toBeNull()
    expect(parseUnitToken('kVA', { bare: true })).toBe('R_per_kVA_month')
  })
  it('ignores descriptive text and block ranges', () => {
    expect(parseUnitToken('0-350kWh')).toBeNull()
    expect(parseUnitToken('80kVA up to 150kVA Commercial / Industrial')).toBeNull()
    expect(parseUnitToken('Small Power Users 50kVA')).toBeNull()
    expect(parseUnitToken('kWh')).toBeNull()
    expect(parseUnitToken(null)).toBeNull()
  })
})

describe('decideEnergyUnit (normaliser-only inference, always flagged)', () => {
  it('re-reads a c/kWh label with a value under 20 as R/kWh (Buffalo City 3.09)', () => {
    const d = decideEnergyUnit(3.09, 'c_per_kWh')
    expect(d).toMatchObject({ unit: 'R_per_kWh', inferred: true })
    expect(d.reason).toMatch(/^magnitude/)
  })
  it('re-reads an R/kWh label with a value of 50 or more as c/kWh', () => {
    expect(decideEnergyUnit(227.28, 'R_per_kWh')).toMatchObject({ unit: 'c_per_kWh', inferred: true })
  })
  it('keeps a plausible labelled unit as read', () => {
    expect(decideEnergyUnit(227.28, 'c_per_kWh')).toEqual({ unit: 'c_per_kWh', inferred: false, reason: null })
    expect(decideEnergyUnit(2.2728, 'R_per_kWh')).toEqual({ unit: 'R_per_kWh', inferred: false, reason: null })
  })
  it('infers an unlabelled value from its range, and gives up outside both ranges', () => {
    expect(decideEnergyUnit(2.3231, null)).toMatchObject({ unit: 'R_per_kWh', inferred: true })
    expect(decideEnergyUnit(167.21, null)).toMatchObject({ unit: 'c_per_kWh', inferred: true })
    expect(decideEnergyUnit(0, null)).toMatchObject({ unit: 'c_per_kWh', inferred: true, reason: 'unitless zero rate' })
    expect(decideEnergyUnit(30, null)).toMatchObject({ unit: null, inferred: false })
  })
})
