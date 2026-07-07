import { describe, expect, it } from 'vitest'
import {
  activeLengthM,
  adiabaticK,
  breakerCoordinationCheck,
  deratedRating,
  phaseFactor,
  requiredParallelSet,
  shortCircuitCheck,
  supplyParallelCapacity,
  voltDropPctForSupply,
  voltDropPctSingle,
  withstand1sKa,
  type CableForCalc,
  type SupplyForCalc,
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

describe('phaseFactor', () => {
  it('230 V is single-phase — loop drop is 2× the per-conductor drop', () => {
    expect(phaseFactor(230)).toBe(2)
  })

  it('400 V and above are three-phase — line-to-line drop is √3×', () => {
    expect(phaseFactor(400)).toBeCloseTo(Math.sqrt(3), 10)
    expect(phaseFactor(525)).toBeCloseTo(Math.sqrt(3), 10)
    expect(phaseFactor(11000)).toBeCloseTo(Math.sqrt(3), 10)
  })
})

describe('voltDropPctSingle', () => {
  // 25 mm² XLPE Cu: z = 0.9313 Ω/km; the reference table's own mV/A/m
  // columns are 1.613 (3φ = √3·z) and 1.863 (1φ = 2·z). The formula must
  // reproduce the drop those columns give.
  it('matches the SANS 3φ mV/A/m column: 25 mm² XLPE Cu, 100 m, 100 A, 400 V', () => {
    // 1.613 mV/A/m × 100 A × 100 m = 16.13 V = 4.03 % of 400 V
    expect(voltDropPctSingle(0.9313, 100, 100, 400)).toBeCloseTo(4.033, 2)
  })

  it('matches the SANS 1φ mV/A/m column: 25 mm² XLPE Cu, 100 m, 100 A, 230 V', () => {
    // 1.863 mV/A/m × 100 A × 100 m = 18.63 V = 8.10 % of 230 V
    expect(voltDropPctSingle(0.9313, 100, 100, 230)).toBeCloseTo(8.098, 2)
  })

  it('returns 0 for unusable inputs', () => {
    expect(voltDropPctSingle(Number.NaN, 100, 100, 400)).toBe(0)
    expect(voltDropPctSingle(1, 100, 100, 0)).toBe(0)
  })
})

describe('voltDropPctForSupply', () => {
  const supply: SupplyForCalc = {
    id: 's1',
    from_source_id: 'src',
    from_node_id: null,
    to_node_id: 'n1',
    voltage_v: 400,
    design_load_a: 200,
  }

  it('divides the effective impedance by N for same-size parallel cables', () => {
    const one = voltDropPctForSupply(supply, [cable({})])
    const two = voltDropPctForSupply(supply, [cable({}), cable({ id: 'c2', cable_no: 2 })])
    expect(two).toBeCloseTo(one / 2, 10)
  })

  it('keeps the phase factor in the parallel combination', () => {
    const vd = voltDropPctForSupply(supply, [cable({ ohm_per_km: 0.9313, measured_length_m: 100 })])
    // single 25 mm² XLPE Cu at 200 A, 100 m, 400 V → 2 × the 100 A case
    expect(vd).toBeCloseTo(8.066, 2)
  })
})

describe('adiabatic withstand (IEC 60364-4-43 k values)', () => {
  it('PVC copper: k=115 up to 300 mm², 103 above', () => {
    expect(adiabaticK('CU', 'PVC', 300)).toBe(115)
    expect(adiabaticK('CU', 'PVC', 400)).toBe(103)
  })

  it('PVC aluminium: k=76 up to 300 mm², 68 above', () => {
    expect(adiabaticK('AL', 'PVC', 240)).toBe(76)
    expect(adiabaticK('AL', 'PVC', 400)).toBe(68)
  })

  it('XLPE: Cu 143, Al 92 (reference-table value, conservative vs IEC 94)', () => {
    expect(adiabaticK('CU', 'XLPE', 120)).toBe(143)
    expect(adiabaticK('AL', 'XLPE', 120)).toBe(92)
  })

  it('PILC has no adiabatic estimate — MV tables carry tabulated ratings', () => {
    expect(adiabaticK('CU', 'PILC', 120)).toBeNull()
    expect(withstand1sKa('CU', 'PILC', 120)).toBeNull()
  })

  it('1 s withstand = k·S/1000 kA: 25 mm² XLPE Cu = 3.575 kA', () => {
    expect(withstand1sKa('CU', 'XLPE', 25)).toBeCloseTo(3.575, 3)
    // matches the published 1 s rating column (k·S): 300 mm² PVC Cu = 34.5 kA
    expect(withstand1sKa('CU', 'PVC', 300)).toBeCloseTo(34.5, 3)
  })
})

describe('shortCircuitCheck', () => {
  it('fails when the fault level exceeds the cable withstand', () => {
    expect(shortCircuitCheck(3.575, 10).tone).toBe('danger')
  })

  it('warns inside the 10 % margin band', () => {
    expect(shortCircuitCheck(10.5, 10).tone).toBe('warning')
  })

  it('passes with margin, unknown without data', () => {
    expect(shortCircuitCheck(34.5, 10).tone).toBe('ok')
    expect(shortCircuitCheck(null, 10).tone).toBe('unknown')
  })
})

describe('breakerCoordinationCheck', () => {
  it('danger when the breaker exceeds the cable capacity (In > Iz)', () => {
    const r = breakerCoordinationCheck(100, 250, 200)
    expect(r.ok).toBe(false)
    expect(r.tone).toBe('danger')
  })

  it('warning when the design load exceeds the breaker (Ib > In)', () => {
    const r = breakerCoordinationCheck(300, 250, 400)
    expect(r.ok).toBe(false)
    expect(r.tone).toBe('warning')
  })

  it('ok when Ib ≤ In ≤ Iz; unknown without a breaker rating', () => {
    expect(breakerCoordinationCheck(180, 250, 400).tone).toBe('ok')
    expect(breakerCoordinationCheck(180, null, 400).tone).toBe('unknown')
  })
})

describe('deratedRating', () => {
  it('returns null when any derate factor is explicitly null (missing SANS table)', () => {
    expect(deratedRating(340, { depth: null, thermal: 1, grouping: 1, temperature: 1 })).toBeNull()
    expect(deratedRating(340, { depth: 1, thermal: 1, grouping: 1, temperature: null })).toBeNull()
  })

  it('still multiplies through when all four factors are real numbers', () => {
    expect(deratedRating(400, { depth: 0.9, thermal: 1, grouping: 0.8, temperature: 1 })).toBeCloseTo(288, 5)
  })
})
