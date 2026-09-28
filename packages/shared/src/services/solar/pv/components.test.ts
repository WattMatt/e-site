import { describe, expect, it } from 'vitest'
import { cellTemperature, DEFAULT_FAIMAN } from './cell-temperature'
import { acFactor, combinedDcLoss, DEFAULT_AC_LOSSES, DEFAULT_DC_LOSSES } from './losses'
import { efficiencyAt, inverterOutput, validateCurve } from './inverter'

describe('cell temperature', () => {
  it('NOCT: 20 °C + 800 W/m² × (45 − 20)/800 = 45 °C at NOCT conditions', () => {
    expect(cellTemperature({ kind: 'noct', noctC: 45 }, 20, 800, 1)).toBe(45)
    expect(cellTemperature({ kind: 'noct', noctC: 45 }, 25, 0, 1)).toBe(25)
  })

  it('Faiman: T_amb + POA / (U0 + U1·wind); wind cools the module', () => {
    expect(cellTemperature(DEFAULT_FAIMAN, 20, 1000, 0)).toBeCloseTo(60, 10)
    expect(cellTemperature(DEFAULT_FAIMAN, 20, 1000, 5)).toBeCloseTo(20 + 1000 / (25 + 34.2), 10)
  })
})

describe('loss chain', () => {
  it('is multiplicative, not additive', () => {
    const l = { soiling: 0.02, shading: 0.03, mismatch: 0, dcWiring: 0, lid: 0, nameplate: 0 }
    expect(combinedDcLoss(l)).toBeCloseTo(1 - 0.98 * 0.97, 12) // 4.94 %, not 5 %
  })

  it('spec §7 defaults combine to 1 − 0.98·0.99·0.99·0.985·0.985', () => {
    expect(combinedDcLoss(DEFAULT_DC_LOSSES)).toBeCloseTo(1 - 0.98 * 0.99 * 0.99 * 0.985 * 0.985, 12)
    expect(acFactor(DEFAULT_AC_LOSSES)).toBeCloseTo(0.99 * 0.99, 12)
  })

  it('refuses a loss outside [0, 1) — a percentage typed as 2 instead of 0.02 is caught', () => {
    expect(() => combinedDcLoss({ ...DEFAULT_DC_LOSSES, soiling: 2 })).toThrow(/soiling must be a fraction/)
    expect(() => acFactor({ acWiring: 0.01, availability: 99 })).toThrow(/availability/)
  })
})

describe('inverter', () => {
  const curve = [
    { loadFraction: 0.1, efficiency: 0.94 },
    { loadFraction: 0.5, efficiency: 0.98 },
    { loadFraction: 1, efficiency: 0.97 },
  ]

  it('interpolates the efficiency curve and holds it flat past the ends', () => {
    expect(efficiencyAt(curve, 0.05)).toBe(0.94)
    expect(efficiencyAt(curve, 0.3)).toBeCloseTo(0.96, 12)
    expect(efficiencyAt(curve, 0.75)).toBeCloseTo(0.975, 12)
    expect(efficiencyAt(curve, 1.3)).toBe(0.97)
  })

  it('clips at the AC rating and reports the clipped power', () => {
    const o = inverterOutput(120, { id: 'i', acRatedKw: 100 })
    expect(o.pAcKw).toBe(100)
    expect(o.clippedKw).toBeCloseTo(120 * 0.975 - 100, 10)
    expect(inverterOutput(50, { id: 'i', acRatedKw: 100 })).toEqual({ pAcKw: 50 * 0.975, clippedKw: 0 })
    expect(inverterOutput(0, { id: 'i', acRatedKw: 100 })).toEqual({ pAcKw: 0, clippedKw: 0 })
  })

  it('refuses a curve with efficiencies above 1 or unordered load points', () => {
    expect(() => validateCurve([{ loadFraction: 0, efficiency: 97.5 }])).toThrow(/efficiency must be in \(0, 1\]/)
    expect(() => validateCurve([{ loadFraction: 0.5, efficiency: 0.9 }, { loadFraction: 0.2, efficiency: 0.9 }])).toThrow(/must increase/)
  })
})
