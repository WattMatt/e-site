import { describe, expect, it } from 'vitest'
import { activeLengthM, type CableForCalc } from './cable-calc.service'

function cable(over: Partial<CableForCalc>): CableForCalc {
  return {
    id: 'c1',
    supply_id: 's1',
    cable_no: 1,
    size_mm2: 25,
    ohm_per_km: 1,
    measured_length_m: 100,
    confirmed_length_m: null,
    length_status: 'MEASURED',
    derate_depth: null,
    derate_thermal: null,
    derate_grouping: null,
    derate_temp: null,
    ...over,
  } as CableForCalc
}

describe('activeLengthM', () => {
  it('design mode always uses measured length', () => {
    expect(activeLengthM(cable({ measured_length_m: 100, confirmed_length_m: 140, length_status: 'CONFIRMED' }), 'design')).toBe(100)
  })

  it('as-built uses confirmed only when length_status is CONFIRMED', () => {
    expect(activeLengthM(cable({ measured_length_m: 100, confirmed_length_m: 140, length_status: 'CONFIRMED' }), 'as-built')).toBe(140)
    expect(activeLengthM(cable({ measured_length_m: 100, confirmed_length_m: 140, length_status: 'MEASURED' }), 'as-built')).toBe(100)
  })

  it('worst takes the max of measured and confirmed', () => {
    expect(activeLengthM(cable({ measured_length_m: 100, confirmed_length_m: 140 }), 'worst')).toBe(140)
    expect(activeLengthM(cable({ measured_length_m: 160, confirmed_length_m: 140 }), 'worst')).toBe(160)
  })

  it('all three modes agree when there is no confirmed length', () => {
    const c = cable({ measured_length_m: 100, confirmed_length_m: null, length_status: 'MEASURED' })
    expect(activeLengthM(c, 'design')).toBe(100)
    expect(activeLengthM(c, 'as-built')).toBe(100)
    expect(activeLengthM(c, 'worst')).toBe(100)
  })
})
