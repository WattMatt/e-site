import { describe, it, expect } from 'vitest'
import { mapColumnA, mapColumnB, mapColumnC, mapColumnGeneric, suggestUnitFromHeader, storedUnitFor, toStoredValue, withUnit } from './units'

describe('format A vocabulary (p/q/s/a × 14/23/12/34, _l1..3, u, i)', () => {
  it.each([
    ['p14', 'active_power', 'import', 'kW', null],
    ['p23', 'active_power', 'export', 'kW', null],
    ['q12', 'reactive_power', 'import', 'kvar', null],
    ['q34', 'reactive_power', 'export', 'kvar', null],
    ['s14', 'apparent_power', 'import', 'kVA', null],
    ['a14', 'active_energy', 'import', 'kWh', null],
    ['a23', 'active_energy', 'export', 'kWh', null],
    ['p14_l2', 'active_power', 'import', 'kW', 'l2'],
    ['u_l1', 'voltage', 'none', 'V', 'l1'],
    ['i_l3', 'current', 'none', 'A', 'l3'],
    ['Total Solar Active Power', 'active_power', 'import', 'kW', null],
    ['Solar Total Power', 'active_power', 'import', 'kW', null],
    ['Generator Total Power', 'active_power', 'import', 'kW', null],
    ['Volume', 'volume', 'none', 'm3', null],
  ])('%s', (h, q, d, u, ph) => {
    expect(mapColumnA(h, 1)).toMatchObject({ sourceColumn: h, quantity: q, direction: d, sourceUnit: u, phase: ph, unitFromTable: true })
  })
  it('an unknown A header is NOT given a unit', () => {
    expect(mapColumnA('total_daily_night_usage', 1)).toMatchObject({ quantity: 'unknown', sourceUnit: 'unknown', unitFromTable: false })
  })
})

describe('format B (PnP power)', () => {
  it('maps P/P1/P2/Q/S/scalar sum and the non-channel columns', () => {
    expect(mapColumnB('"P (per kW)"', 0)).toMatchObject({ quantity: 'active_power', direction: 'import', sourceUnit: 'kW' })
    expect(mapColumnB('P1 (per kW)', 0)).toMatchObject({ direction: 'import' })
    expect(mapColumnB('P2 (per kW)', 2)).toMatchObject({ direction: 'export' })
    expect(mapColumnB('Q1 (per kvar)', 1)).toMatchObject({ quantity: 'reactive_power', sourceUnit: 'kvar' })
    expect(mapColumnB('S (per kVA)', 3)).toMatchObject({ quantity: 'apparent_power', direction: 'none', sourceUnit: 'kVA' })
    expect(mapColumnB('scalar sum S (per kVA)', 4)).toMatchObject({ quantity: 'apparent_power', isScalarSum: true })
    expect([mapColumnB('"DATE"', 5), mapColumnB('TIME', 6), mapColumnB('STATUS', 7)]).toEqual(['date', 'time', 'status'])
  })
})

describe('format C (PnP energy)', () => {
  it('maps kWh/kvarh/kVAh and the trailing S (kVA) demand', () => {
    expect(mapColumnC('Time', 0)).toBe('timestamp')
    expect(mapColumnC('Status', 8)).toBe('status')
    expect(mapColumnC('P1 (kWh)', 1)).toMatchObject({ quantity: 'active_energy', direction: 'import', sourceUnit: 'kWh' })
    expect(mapColumnC('P2 (kWh)', 4)).toMatchObject({ direction: 'export' })
    expect(mapColumnC('Q1 (kvarh)', 2)).toMatchObject({ quantity: 'reactive_energy', direction: 'import' })
    expect(mapColumnC('Q3 (kvarh)', 6)).toMatchObject({ direction: 'export' })
    expect(mapColumnC('S (kVAh)', 3)).toMatchObject({ quantity: 'apparent_energy', sourceUnit: 'kVAh' })
    expect(mapColumnC('S (kVA)', 9)).toMatchObject({ quantity: 'apparent_power', sourceUnit: 'kVA' })
  })
})

describe('generic path', () => {
  it('never assigns a unit, only suggests one', () => {
    expect(mapColumnGeneric('Import (kW)', 1)).toMatchObject({ sourceUnit: 'unknown', quantity: 'unknown', unitFromTable: false })
    expect(suggestUnitFromHeader('Import (kW)')).toBe('kW')
    expect(suggestUnitFromHeader('Energy [kWh]')).toBe('kWh')
    expect(suggestUnitFromHeader('Q (kvarh)')).toBe('kvarh')
    expect(suggestUnitFromHeader('Value')).toBeNull()
  })
  it('withUnit sets unit + quantity and marks it user-chosen', () => {
    expect(withUnit(mapColumnGeneric('Import', 1), 'kWh')).toMatchObject({ sourceUnit: 'kWh', quantity: 'active_energy', unitFromTable: false })
  })
})

describe('stored values', () => {
  it('energy per interval → average power (kW = kWh × 60 / Δ)', () => {
    expect(toStoredValue(4.82, { quantity: 'active_energy', sourceUnit: 'kWh' }, 30)).toBeCloseTo(9.64, 10)
    expect(toStoredValue(9.25, { quantity: 'active_energy', sourceUnit: 'kWh' }, 60)).toBeCloseTo(9.25, 10)
    expect(toStoredValue(500, { quantity: 'active_energy', sourceUnit: 'Wh' }, 30)).toBeCloseTo(1, 10)
    expect(toStoredValue(2.44, { quantity: 'apparent_energy', sourceUnit: 'kVAh' }, 30)).toBeCloseTo(4.88, 10)
  })
  it('power is stored as is, W and MW are scaled', () => {
    expect(toStoredValue(192.46, { quantity: 'active_power', sourceUnit: 'kW' }, 30)).toBe(192.46)
    expect(toStoredValue(296324, { quantity: 'active_power', sourceUnit: 'W' }, 30)).toBeCloseTo(296.324, 10)
    expect(toStoredValue(1.2, { quantity: 'active_power', sourceUnit: 'MW' }, 30)).toBeCloseTo(1200, 10)
  })
  it('stored unit per quantity', () => {
    expect([storedUnitFor('active_energy'), storedUnitFor('reactive_energy'), storedUnitFor('apparent_energy'), storedUnitFor('voltage')]).toEqual(['kW', 'kvar', 'kVA', 'V'])
  })
})
