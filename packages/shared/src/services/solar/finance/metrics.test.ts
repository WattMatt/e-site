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
