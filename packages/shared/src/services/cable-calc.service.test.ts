import { describe, expect, it } from 'vitest'
import {
  activeLengthM,
  requiredParallelSet,
  supplyParallelCapacity,
  type CableForCalc,
} from './cable-calc.service'

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

describe('requiredParallelSet', () => {
  it('returns N=1 when one cable already carries the load', () => {
    const r = requiredParallelSet(300, () => 340)
    expect(r).toEqual({ count: 1, perCableRatingA: 340, combinedRatingA: 340, insufficient: false })
  })

  it('rounds up to the smallest N that carries the load (constant rating)', () => {
    // load 1100, each cable 250A -> 5 x 250 = 1250 >= 1100
    const r = requiredParallelSet(1100, () => 250)
    expect(r?.count).toBe(5)
    expect(r?.combinedRatingA).toBe(1250)
    expect(r?.insufficient).toBe(false)
  })

  it('needs a higher N when grouping derates each cable as N rises', () => {
    // rating(n) = 300 - (n-1)*30  ->  n=1:300 n=2:2*270=540 n=3:3*240=720
    // n=4:4*210=840 n=5:5*180=900 n=6:6*150=900 ... load 880 first met at n=5
    const ratingForN = (n: number) => 300 - (n - 1) * 30
    const r = requiredParallelSet(880, ratingForN)
    expect(r?.count).toBe(5)
    expect(r?.insufficient).toBe(false)
  })

  it('flags insufficient when even maxN cannot carry the load', () => {
    const r = requiredParallelSet(10_000, () => 10, 16)
    expect(r?.count).toBe(16)
    expect(r?.insufficient).toBe(true)
    expect(r?.combinedRatingA).toBe(160)
  })

  it('returns null when no base rating resolves (rating at N=1 is null)', () => {
    expect(requiredParallelSet(1000, () => null)).toBeNull()
  })

  it('insufficient result reports the rating at maxN, even when grouping derates', () => {
    // rating(n) = 100 - (n-1)*5  ->  at n=8: 100-35 = 65; 8*65 = 520 < 5000
    const r = requiredParallelSet(5000, (n) => 100 - (n - 1) * 5, 8)
    expect(r?.count).toBe(8)
    expect(r?.insufficient).toBe(true)
    expect(r?.perCableRatingA).toBe(65)
    expect(r?.combinedRatingA).toBe(520)
  })
})

describe('supplyParallelCapacity', () => {
  it('sums the stored derated ratings, treating null as 0', () => {
    expect(supplyParallelCapacity([
      { derated_current_rating_a: 340 },
      { derated_current_rating_a: 340 },
      { derated_current_rating_a: null },
    ])).toBe(680)
  })

  it('is 0 for a supply with no cables', () => {
    expect(supplyParallelCapacity([])).toBe(0)
  })
})
