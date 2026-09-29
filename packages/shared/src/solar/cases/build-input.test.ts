import { describe, it, expect } from 'vitest'
import { solarOrgSettingDefaults } from '../org-settings'
import { defaultCaseConfig, type CaseConfig } from './config'
import { buildCaseInput, BUILD_REASONS, type BuildContext } from './build-input'
import { inputsHash } from '../../services/solar/hash'
import { caseLoadFromSiteSeries } from '../../services/solar/load/case-load'

const W = '22222222-2222-4222-8222-222222222222'
const module = { equipmentId: '11111111-1111-4111-8111-111111111111', make: 'Generic', model: 'M', pmaxW: 550, gammaPmaxPctPerC: -0.35 }
const base = (): CaseConfig => {
  const c = defaultCaseConfig(solarOrgSettingDefaults(), { dcKwp: 500, acKw: 400 })
  return { ...c, pv: { ...c.pv, module }, weather: { source: 'pvgis_tmy', datasetId: W } }
}
const ctx = (over: Partial<BuildContext> = {}): BuildContext => ({
  config: base(),
  study: { exportMode: 'net_billing', exportLimitKw: 100 },
  siteLoad: { series: new Array(8760).fill(250), basis: 'S1', referenceYear: 2025 },
  touPeriods: null,
  ...over,
})

describe('buildCaseInput', () => {
  it('maps percentages to fractions and the manual system to one array + one inverter', () => {
    const r = buildCaseInput(ctx())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const i = r.input
    expect(i.weatherDatasetId).toBe(W)
    expect(i.pv.arrays).toHaveLength(1)
    expect(i.pv.arrays[0]).toMatchObject({ kWpDc: 500, tiltDeg: 15, azimuthDeg: 0, inverterId: 'inv-1',
      module: { iamB0: 0.05 }, cellTemp: { kind: 'faiman', u0: 25, u1: 6.84 } })
    expect(i.pv.arrays[0]!.module.gammaPmaxPerC).toBeCloseTo(-0.0035, 12)
    expect(i.pv.arrays[0]!.losses).toEqual({ soiling: 0.02, shading: 0.03, mismatch: 0.01, dcWiring: 0.015, lid: 0.015, nameplate: 0 })
    expect(i.pv.inverters).toEqual([{ id: 'inv-1', acRatedKw: 400, efficiencyCurve: [{ loadFraction: 0, efficiency: 0.975 }] }])
    expect(i.pv.acLosses).toEqual({ acWiring: 0.01, availability: 0.99 })
    expect(i.load).toHaveLength(8760)
    expect(i.loadAdjustment).toBe(0)
    expect(i.battery).toBeNull()
    expect(i.export).toEqual({ allowed: true, limitKw: 100 })
    expect('touPeriods' in i).toBe(false)
  })

  it('zero-export study → export not allowed; case override wins', () => {
    const z = buildCaseInput(ctx({ study: { exportMode: 'zero_export', exportLimitKw: null } }))
    expect(z.ok && z.input.export).toEqual({ allowed: false, limitKw: null })
    const c = base()
    const o = buildCaseInput(ctx({ config: { ...c, grid: { ...c.grid, overrideExport: true, exportAllowed: true, exportLimitKw: 50 } }, study: { exportMode: 'zero_export', exportLimitKw: null } }))
    expect(o.ok && o.input.export).toEqual({ allowed: true, limitKw: 50 })
  })

  it('inverter AC cap limits the rated AC', () => {
    const c = base()
    const r = buildCaseInput(ctx({ config: { ...c, grid: { ...c.grid, inverterAcCapKw: 350 } } }))
    expect(r.ok && r.input.pv.inverters[0]!.acRatedKw).toBe(350)
  })

  it('lists every blocking reason at once, never substituting a value', () => {
    const c = base()
    const r = buildCaseInput({
      config: { ...c, pv: { ...c.pv, module: null }, weather: { source: 'pvgis_tmy', datasetId: null },
        battery: { ...c.battery, enabled: true, strategy: 'tou-arbitrage', usableKwh: 0 } },
      study: { exportMode: null, exportLimitKw: null }, siteLoad: null, touPeriods: null,
    })
    expect(r).toEqual({ ok: false, reasons: [BUILD_REASONS.noWeather, BUILD_REASONS.noLoad, BUILD_REASONS.noModule, BUILD_REASONS.noExportMode, BUILD_REASONS.batteryEmpty, BUILD_REASONS.noTou] })
  })

  it('a site load with a NaN or the wrong length is refused', () => {
    const bad = new Array(8760).fill(1); bad[5] = Number.NaN
    expect(buildCaseInput(ctx({ siteLoad: { series: bad, basis: 'S1', referenceYear: 2025 } }))).toEqual({ ok: false, reasons: [BUILD_REASONS.badLoad] })
    expect(buildCaseInput(ctx({ siteLoad: { series: [1, 2], basis: 'S1', referenceYear: 2025 } }))).toEqual({ ok: false, reasons: [BUILD_REASONS.badLoad] })
  })

  it('takes caseLoadFromSiteSeries output directly (Float64Array load + its reference year)', () => {
    const s = caseLoadFromSiteSeries({ series: new Float64Array(8760).fill(250), referenceYear: 2025 })
    const r = buildCaseInput(ctx({ siteLoad: { series: s.load, basis: 'S1', referenceYear: s.referenceYear } }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Array.isArray(r.input.load)).toBe(true)
    expect(inputsHash(r.input)).toBe(inputsHash((buildCaseInput(ctx()) as { ok: true; input: unknown }).input))
  })

  it('a negative hour (a series net of generation) is refused', () => {
    const neg = new Array(8760).fill(1); neg[9] = -3
    expect(buildCaseInput(ctx({ siteLoad: { series: neg, basis: 'S1', referenceYear: 2025 } }))).toEqual({ ok: false, reasons: [BUILD_REASONS.badLoad] })
  })

  it('battery: fractions, strategy, TOU series only when needed', () => {
    const c = base()
    const tou = new Array(8760).fill('off-peak')
    const r = buildCaseInput(ctx({
      touPeriods: tou,
      config: { ...c, battery: { ...c.battery, enabled: true, usableKwh: 200, maxChargeKw: 100, maxDischargeKw: 100, strategy: 'tou-arbitrage', gridCharging: true, backupReservePct: 20 } },
    }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.input.battery).toEqual({ usableKwh: 200, maxChargeKw: 100, maxDischargeKw: 100, roundTripEfficiency: 0.9, socMin: 0.1, socMax: 0.95, initialSoc: 0.5, backupReserve: 0.2, strategy: { kind: 'tou-arbitrage', gridCharging: true } })
    expect(r.input.touPeriods).toHaveLength(8760)
  })

  it('"Yes (no credit)" is carried into the input, so it enters inputs_hash; net billing is unchanged', () => {
    const net = buildCaseInput(ctx({ study: { exportMode: 'net_billing', exportLimitKw: 100 } }))
    const none = buildCaseInput(ctx({ study: { exportMode: 'no_credit', exportLimitKw: 100 } }))
    if (!net.ok || !none.ok) throw new Error('expected ok')
    expect(net.input.export).toEqual({ allowed: true, limitKw: 100 })
    expect(none.input.export).toEqual({ allowed: true, limitKw: 100, credited: false })
    expect(inputsHash(none.input)).not.toBe(inputsHash(net.input))
    // The case override has its own "no credit" choice; it only applies while export is allowed.
    const c = base()
    const ov = (exportAllowed: boolean, exportCredited: boolean) =>
      buildCaseInput(ctx({ config: { ...c, grid: { ...c.grid, overrideExport: true, exportAllowed, exportLimitKw: 50, exportCredited } }, study: { exportMode: 'net_billing', exportLimitKw: null } }))
    const o1 = ov(true, false), o2 = ov(true, true), o3 = ov(false, false)
    expect(o1.ok && o1.input.export).toEqual({ allowed: true, limitKw: 50, credited: false })
    expect(o2.ok && o2.input.export).toEqual({ allowed: true, limitKw: 50 })
    expect(o3.ok && o3.input.export).toEqual({ allowed: false, limitKw: null })
  })

  it('the hash is stable for equal inputs and moves when any input moves', () => {
    const a = buildCaseInput(ctx()), b = buildCaseInput(ctx())
    const c = base()
    const moved = buildCaseInput(ctx({ config: { ...c, losses: { ...c.losses, soilingPct: 2.5 } } }))
    if (!a.ok || !b.ok || !moved.ok) throw new Error('expected ok')
    expect(inputsHash(a.input)).toBe(inputsHash(b.input))
    expect(inputsHash(moved.input)).not.toBe(inputsHash(a.input))
  })
})
