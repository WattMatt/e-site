import { describe, expect, it } from 'vitest'
import { irr, lcoe, npv, payback } from './metrics'

describe('metrics', () => {
  it('NPV and IRR of a one-period investment', () => {
    expect(npv(0.1, [-100, 110])).toBeCloseTo(0, 12)
    expect(irr([-100, 110])).toBeCloseTo(0.1, 9)
  })

  it('IRR is n/a (null) without a sign change, and found near the bracket ends', () => {
    expect(irr([100, 10, 10])).toBeNull()
    // x = 1/(1+r): x² + x − 100 = 0 → x = (√401 − 1)/2 → r = 2/(√401 − 1) − 1 ≈ −0.89487
    expect(irr([-100, 1, 1])).toBeCloseTo(2 / (Math.sqrt(401) - 1) - 1, 9)
    expect(irr([-100, 290])).toBeCloseTo(1.9, 9)
  })

  it('a negative final-year flow (e.g. a late replacement) does not produce a false low root', () => {
    // Two roots each: a spurious one near −86 % / −33 % that the −99 % end of the bracket finds first,
    // and the finance root. Reference values from an independent Python bisection on [0, 2].
    expect(irr([-100, ...Array(9).fill(30), -5])).toBeCloseTo(0.2616906646312124, 9)
    expect(irr([-100, ...Array(19).fill(20), -40])).toBeCloseTo(0.19037075484528054, 9)
  })

  it('picks the investment root (NPV falling through zero), even when a spurious root is nearer 10 %', () => {
    // Roots (independent Python bisection): 0.08805290119513931 (NPV rising — spurious, from the
    // large negative final flow) and 1.3333297014178105 (NPV falling — the investment's IRR).
    expect(irr([-15, ...Array(19).fill(20), -900])).toBeCloseTo(1.3333297014178105, 7)
  })

  it('is n/a (null) for non-finite or all-zero flows, never the bracket end', () => {
    expect(irr([-100, Number.NaN, 30, 30])).toBeNull()
    expect(irr([-100, Number.POSITIVE_INFINITY])).toBeNull()
    expect(irr([0, 0, 0])).toBeNull()
    expect(irr([])).toBeNull()
  })

  it('payback interpolates within the crossing year; discounted payback is later; never → null', () => {
    expect(payback([-100, 40, 40, 40])).toBeCloseTo(2.5, 12)
    expect(payback([-100, 45, 45, 45])).toBeCloseTo(2 + 10 / 45, 12)
    // discounted @10 %: 40.909 + 37.190 = 78.099 after 2 years; year 3 adds 33.809 → 2 + 21.901/33.809
    expect(payback([-100, 45, 45, 45], 0.1)).toBeCloseTo(2 + (100 - 45 / 1.1 - 45 / 1.21) / (45 / 1.331), 12)
    expect(payback([-100, 40, 40, 40], 0.1)).toBeNull()
    expect(payback([-100, 10, 10])).toBeNull()
    expect(payback([0, 10])).toBe(0)
  })

  it('discounted LCOE = (capex + PV costs) / PV energy', () => {
    expect(lcoe(0, 1000, [0, 0], [500, 500])).toBe(1)
    expect(lcoe(0.1, 1000, [110], [1100])).toBeCloseTo(1100 / 1000, 12)
    expect(lcoe(0.1, 1000, [], [])).toBeNull()
  })
})
