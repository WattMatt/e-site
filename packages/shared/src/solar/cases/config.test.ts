import { describe, it, expect } from 'vitest'
import { solarOrgSettingDefaults } from '../org-settings'
import { defaultCaseConfig, parseCaseConfig, effectiveLosses, resetLossesToDefaults, CASE_CONFIG_VERSION } from './config'

const settings = solarOrgSettingDefaults()

describe('defaultCaseConfig', () => {
  it('copies the org loss and degradation defaults (a case stores its own snapshot)', () => {
    const c = defaultCaseConfig(settings, { dcKwp: 500, acKw: 400 })
    expect(c.version).toBe(CASE_CONFIG_VERSION)
    expect(c.pv).toMatchObject({ source: 'manual', dcKwp: 500, acKw: 400, tiltDeg: 15, azimuthDeg: 0, mounting: 'racked', module: null })
    expect(c.losses).toMatchObject({ mode: 'standard', soilingPct: 2, shadingPct: 3, mismatchPct: 1, dcWiringPct: 1.5, lidPct: 1.5, acWiringPct: 1, availabilityPct: 99, albedo: 0.2 })
    expect(c.degradation).toEqual({ firstYearPct: 2, annualPct: 0.5 })
    expect(c.battery).toMatchObject({ enabled: false, rtePct: 90, socMinPct: 10, socMaxPct: 95, strategy: 'self-consumption', gridCharging: false })
    expect(c.weather).toEqual({ source: 'pvgis_tmy', datasetId: null })
    expect(parseCaseConfig(c)).toEqual({ ok: true, config: c })
  })

  it('an org that changed soiling to 3 % gets 3 % in new cases', () => {
    const c = defaultCaseConfig({ ...settings, soiling_pct: 3 }, { dcKwp: 100, acKw: 80 })
    expect(c.losses.soilingPct).toBe(3)
  })
})

describe('parseCaseConfig', () => {
  const ok = defaultCaseConfig(settings, { dcKwp: 500, acKw: 400 })

  it('refuses grid charging outside TOU arbitrage (spec §7.2)', () => {
    const bad = { ...ok, battery: { ...ok.battery, enabled: true, usableKwh: 100, maxChargeKw: 50, maxDischargeKw: 50, gridCharging: true } }
    const r = parseCaseConfig(bad)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors['battery.gridCharging']).toBe('Grid charging is only allowed with TOU arbitrage')
  })

  it('refuses peak shaving without a target', () => {
    const bad = { ...ok, battery: { ...ok.battery, enabled: true, usableKwh: 100, maxChargeKw: 50, maxDischargeKw: 50, strategy: 'peak-shaving', peakTargetKw: null } }
    const r = parseCaseConfig(bad)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors['battery.peakTargetKw']).toBe('Enter the peak-shaving target')
  })

  it('refuses SoC min ≥ max and an initial SoC outside the band', () => {
    const bad = { ...ok, battery: { ...ok.battery, enabled: true, usableKwh: 100, maxChargeKw: 50, maxDischargeKw: 50, socMinPct: 90, socMaxPct: 80, initialSocPct: 50 } }
    const r = parseCaseConfig(bad)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors['battery.socMaxPct']).toBe('SoC max must be above SoC min')
  })

  it('refuses unknown keys and wrong types with a path', () => {
    const r = parseCaseConfig({ ...ok, pv: { ...ok.pv, dcKwp: 'lots' } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(Object.keys(r.errors)).toContain('pv.dcKwp')
    expect(parseCaseConfig({ ...ok, surprise: 1 }).ok).toBe(false)
    expect(parseCaseConfig(null).ok).toBe(false)
  })
})

describe('losses', () => {
  const c = defaultCaseConfig(settings, { dcKwp: 500, acKw: 400 })

  it('standard mode forces the detailed-only inputs back to defaults', () => {
    const edited = { ...c, losses: { ...c.losses, mode: 'standard' as const, nameplatePct: 3, iamB0: 0.1, transposition: 'hay-davies' as const, cellTemp: { kind: 'noct' as const, noctC: 45 } } }
    expect(effectiveLosses(edited)).toMatchObject({ nameplatePct: 0, iamB0: 0.05, transposition: 'perez', cellTemp: { kind: 'faiman', u0: 25, u1: 6.84 } })
  })

  it('detailed mode keeps every input', () => {
    const edited = { ...c, losses: { ...c.losses, mode: 'detailed' as const, nameplatePct: 3 } }
    expect(effectiveLosses(edited).nameplatePct).toBe(3)
  })

  it('Reset to defaults restores the org values and the mounting-dependent shading', () => {
    const flush = { ...c, pv: { ...c.pv, mounting: 'flush' as const }, losses: { ...c.losses, soilingPct: 9, mode: 'detailed' as const } }
    const reset = resetLossesToDefaults(flush, settings)
    expect(reset.losses).toMatchObject({ mode: 'detailed', soilingPct: 2, shadingPct: 1 })
  })
})
