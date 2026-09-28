import { describe, expect, it } from 'vitest'
import { cellTempMax, checkStringSizing, recommendedModulesInSeries, type StringSizingInput } from './string-sizing'

// Hand-computed case: Voc 49.5 V, Vmp 41.7 V, Isc 13.9 A, β_Voc −0.27 %/°C, γ_Vmp −0.35 %/°C;
// MPPT 1000 V max, 200–850 V window, 26 A; site −5 °C … 35 °C, racked (T_cell,max = 70 °C).
const base: StringSizingInput = {
  module: { vocStc: 49.5, vmpStc: 41.7, iscStc: 13.9, betaVocPerC: -0.0027, gammaVmpPerC: -0.0035 },
  mppt: { vDcMax: 1000, vMpptMin: 200, vMpptMax: 850, iMpptMax: 26 },
  modulesInSeries: 18,
  stringsInParallel: 1,
  tMinC: -5,
  tAmbMaxC: 35,
  mounting: 'racked',
}

describe('string sizing (spec §3.3)', () => {
  it('computes the four quantities by hand', () => {
    const r = checkStringSizing(base)
    expect(r.vocCold).toBeCloseTo(49.5 * 1.081 * 18, 9) // 963.171
    expect(r.vmpHot).toBeCloseTo(41.7 * 0.8425 * 18, 9) // 632.3715
    expect(r.vmpCold).toBeCloseTo(41.7 * 1.105 * 18, 9) // 829.413
    expect(r.current).toBeCloseTo(17.375, 12)
    expect(r.ok).toBe(true)
  })

  it('19 in series breaks V_dc,max when cold (hard fail)', () => {
    const r = checkStringSizing({ ...base, modulesInSeries: 19 })
    expect(r.checks.find((c) => c.id === 'voc-cold')!.status).toBe('fail')
    expect(r.ok).toBe(false)
  })

  it('Vmp above the MPPT window when cold is a warning, not a failure', () => {
    const r = checkStringSizing({ ...base, mppt: { ...base.mppt, vMpptMax: 800 } })
    expect(r.checks.find((c) => c.id === 'vmp-cold')!.status).toBe('warn')
    expect(r.ok).toBe(true)
  })

  it('two parallel strings exceed a 26 A MPPT (2 × 13.9 × 1.25 = 34.75 A)', () => {
    expect(checkStringSizing({ ...base, stringsInParallel: 2 }).ok).toBe(false)
  })

  it('flush mounting adds 45 °C, racked 35 °C', () => {
    expect(cellTempMax(35, 'racked')).toBe(70)
    expect(cellTempMax(35, 'flush')).toBe(80)
  })

  it('recommends the largest n that passes every hard check', () => {
    const { modulesInSeries: _n, ...rest } = base
    expect(recommendedModulesInSeries(rest)).toBe(18)
    expect(recommendedModulesInSeries({ ...rest, mppt: { ...rest.mppt, vMpptMin: 5000 } })).toBeNull()
  })
})
