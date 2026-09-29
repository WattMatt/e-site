import { describe, expect, it } from 'vitest'
import { SOLAR_ENGINE_DEFAULTS as D } from './defaults'

describe('engine spec §7 defaults register', () => {
  it('losses', () => {
    expect(D.losses.dc).toEqual({ soiling: 0.02, shading: 0.01, mismatch: 0.01, dcWiring: 0.015, lid: 0.015, nameplate: 0 })
    expect(D.losses.shadingRacked).toBe(0.03)
    expect(D.losses.ac).toEqual({ acWiring: 0.01, availability: 0.99 })
    expect(D.albedo).toBe(0.2)
    expect(D.inverterEuroEfficiency).toBe(0.975)
  })

  it('degradation and battery', () => {
    expect(D.degradation).toEqual({ firstYear: 0.02, annual: 0.005, batteryFadePerYear: 0.02, batteryEndOfLife: 0.7 })
    expect(D.battery).toEqual({ roundTripEfficiency: 0.9, socMin: 0.1, socMax: 0.95 })
  })

  it('finance (D-05, D-07, D-16)', () => {
    expect(D.finance.omZarPerKwpYear).toBe(150)
    expect(D.finance.insuranceFractionOfCapex).toBe(0.005)
    expect(D.finance.discountRate).toBe(0.11)
    expect(D.finance.cpi).toBe(0.05)
    expect(D.finance.escalation).toMatchObject({ startRate: 0.09, endRate: 0.07, linearToYear: 10, cpiMargin: 0.01 })
    expect(D.finance.years).toBe(25)
    expect(D.finance.replacements).toEqual({ inverterYear: 12, inverterFractionOfCapex: 0.6, batteryYear: 10, batteryFractionOfCapex: 0.5 })
    // Owner decision Q6 (2026-09-28): SA company tax rate 27 % seeded; the tax toggle stays OFF by default (D-16).
    expect(D.finance.tax).toEqual({ enabled: false, allowance: 'none', companyRate: 0.27 })
  })

  it('load', () => {
    expect(D.load).toEqual({ diversity: 1, commonAreaAllowanceMalls: 0.15, powerFactor: 0.95 })
  })
})
