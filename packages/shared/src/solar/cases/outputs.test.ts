import { describe, it, expect, beforeAll } from 'vitest'
import { loadWeather } from '../../services/solar/__fixtures__/pvgis'
import { simulateCase, type CaseInput, type CaseResult } from '../../services/solar/case'
import { solarOrgSettingDefaults } from '../org-settings'
import { defaultCaseConfig } from './config'
import { buildCaseInput } from './build-input'
import { buildRunOutputs, type CaseRunOutputs } from './outputs'

let input: CaseInput, result: CaseResult, out: CaseRunOutputs

beforeAll(() => {
  const weather = loadWeather('jhb')
  const c = defaultCaseConfig(solarOrgSettingDefaults(), { dcKwp: 500, acKw: 400 })
  const load = Array.from({ length: 8760 }, (_, h) => 150 + 100 * Math.sin(((h % 24) - 6) / 24 * 2 * Math.PI))
  const r = buildCaseInput({
    config: { ...c, pv: { ...c.pv, module: { equipmentId: '11111111-1111-4111-8111-111111111111', make: 'G', model: 'M', pmaxW: 550, gammaPmaxPctPerC: -0.35 } }, weather: { source: 'pvgis_tmy', datasetId: '22222222-2222-4222-8222-222222222222' } },
    study: { exportMode: 'net_billing', exportLimitKw: 50 },
    siteLoad: { series: load, basis: 'S1', referenceYear: 2025 },
    touPeriods: null,
  })
  if (!r.ok) throw new Error(r.reasons.join('; '))
  input = r.input
  result = simulateCase(input, { id: input.weatherDatasetId, year: weather })
  out = buildRunOutputs(result, input, {
    weatherFetchedAt: '2026-09-28T10:00:00Z', gsaPvoutKwhPerKwp: 1700, tariffRef: null, touPeriods: null,
    nmdKva: 400, loadBasis: 'S1', loadReferenceYear: 2025,
  })
})

describe('buildRunOutputs', () => {
  it('KPIs come straight from the engine result', () => {
    expect(out.kpis.dcKwp).toBe(500)
    expect(out.kpis.acKw).toBe(400)
    expect(out.kpis.specificYieldKwhPerKwp).toBe(result.pv.annual.specificYield)
    expect(out.kpis.pvAcKwh).toBe(result.balance.kpis.pvKwh)
    expect(out.kpis.deliveredKwh).toBeCloseTo(result.balance.kpis.pvKwh - result.balance.kpis.curtailKwh, 6)
    expect(out.kpis.annualAcKwh).toBe(result.pv.annual.acKwh)
    expect(out.kpis.importAfterKwh).toBe(result.balance.kpis.importKwh)
    expect(out.kpis.peakDemandBasis).toBe('hourly')
    expect(out.kpis.peakDemandBeforeKw).toBeGreaterThan(out.kpis.peakDemandAfterKw - 1e-9)
  })

  it('monthly rows sum to the annual totals', () => {
    const sum = (k: 'pvKwh' | 'importKwh' | 'exportKwh' | 'loadKwh') => out.monthly.reduce((a, m) => a + m[k], 0)
    expect(out.monthly).toHaveLength(12)
    expect(sum('pvKwh')).toBeCloseTo(out.kpis.pvAcKwh, 3)
    expect(sum('importKwh')).toBeCloseTo(out.kpis.importAfterKwh, 3)
    expect(sum('loadKwh')).toBeCloseTo(out.kpis.loadKwh, 3)
    expect(out.monthly[0]!.touImportAfter).toBeNull()
  })

  it('the loss waterfall starts at the reference yield and closes on AC output', () => {
    const w = out.waterfall
    expect(w[0]).toMatchObject({ key: 'reference', kind: 'start' })
    expect(w[w.length - 1]).toMatchObject({ key: 'ac_output', kind: 'end' })
    const losses = w.filter((s) => s.kind === 'loss').reduce((a, s) => a + s.kwh, 0)
    expect(w[0]!.kwh - losses).toBeCloseTo(result.pv.annual.acKwh, 3)
    expect(w.find((s) => s.key === 'dc_output')!.kwh).toBeCloseTo(result.pv.annual.dcKwh, 3)
  })

  it('typical days: 12 months × 4 day types × 24 hours; daily: 365 rows', () => {
    expect(out.typicalDays).toHaveLength(48)
    expect(out.typicalDays.every((d) => d.pv.length === 24 && d.load.length === 24)).toBe(true)
    expect(out.daily).toHaveLength(365)
    expect(out.daily.reduce((a, d) => a + d.pvKwh, 0)).toBeCloseTo(out.kpis.pvAcKwh, 0)
  })

  it('checks: DC/AC 1.25 passes, the 50 kW export limit is hit, strings need a layout, NMD loading and GSA are evaluated', () => {
    const byId = Object.fromEntries(out.checks.map((c) => [c.id, c]))
    expect(byId.dc_ac_ratio.status).toBe('pass')
    expect(byId.export_limit.status).toBe('warn')
    expect(byId.string_voltage.status).toBe('n/a')
    expect(byId.transformer_loading.status).toBe('warn') // 400 kW AC > 75 % of 400 kVA
    expect(['pass', 'warn']).toContain(byId.gsa_sanity.status)
  })

  it('provenance names the engine version, hash, weather and load basis', () => {
    expect(out.provenance).toMatchObject({ engineVersion: result.engineVersion, inputsHash: result.inputsHash, weatherDatasetId: input.weatherDatasetId, weatherSource: result.weatherSource, loadBasis: 'S1', loadReferenceYear: 2025, tariffRef: null })
  })

  it('is plain JSON (round-trips without loss)', () => {
    expect(JSON.parse(JSON.stringify(out))).toEqual(out)
  })
})
