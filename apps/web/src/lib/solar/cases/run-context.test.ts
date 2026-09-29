// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { defaultCaseConfig, BUILD_REASONS } from '@esite/shared/solar-cases'
import { solarOrgSettingDefaults } from '@esite/shared'

const h = vi.hoisted(() => ({ tariff: vi.fn() }))
vi.mock('./tariff', () => ({ resolveStudyTariff: h.tariff }))
import { loadRunContext, loadStudyInputs, contextForCase } from './run-context'

const P = 'p1', S = 's1', C = 'c1', ORG = 'o1', W = '22222222-2222-4222-8222-222222222222'
const cfg = (() => {
  const c = defaultCaseConfig(solarOrgSettingDefaults(), { dcKwp: 500, acKw: 400 })
  return { ...c, pv: { ...c.pv, module: { equipmentId: '11111111-1111-4111-8111-111111111111', make: 'G', model: 'M', pmaxW: 550, gammaPmaxPctPerC: -0.35 } }, weather: { source: 'pvgis_tmy' as const, datasetId: W } }
})()
const tables = {
  'solar.studies': [{ id: S, project_id: P, organisation_id: ORG, latitude: -26.2, longitude: 28.05, export_mode: 'net_billing', export_limit_kw: null, nmd_kva: 500, load_basis: 'S1', reference_year: 2024, selected_case_id: null, updated_at: 'T0' }],
  'solar.cases': [{ id: C, study_id: S, project_id: P, name: 'Base', pv_source: 'manual', config: cfg, updated_at: 'T1' }],
  'solar.site_load': [{ study_id: S, basis: 'S1', reference_year: 2024, series: new Array(8760).fill(100) }],
  'solar.weather_datasets': [{ id: W, organisation_id: ORG, source: 'pvgis_tmy', storage_path: 'o1/w.csv.gz', fetched_at: '2026-09-28T00:00:00Z', gsa_pvout_kwh_per_kwp: 1700 }],
}
const NOT_PINNED = { ok: false, reason: 'No tariff is pinned for this study — pin one on the Tariff tab.' }
const client = (over: Record<string, unknown[]> = {}) => fakeSupabase({ tables: { ...tables, ...over } as never }).client as never

beforeEach(() => { vi.clearAllMocks(); h.tariff.mockResolvedValue(NOT_PINNED) })

describe('loadRunContext', () => {
  it('assembles a buildable context and its current hash', async () => {
    const r = await loadRunContext(client(), P, C)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.ctx.build.ok).toBe(true)
    expect(r.ctx.currentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(r.ctx.weather?.id).toBe(W)
    expect(r.ctx.touPeriods).toBeNull()
    expect(r.ctx.referenceYear).toBe(2024)
    expect(r.ctx.siteLoad?.series).toBeInstanceOf(Float64Array)
    expect(r.ctx.build.ok && r.ctx.build.input.load).toHaveLength(8760)
  })

  it('the tariff is resolved on the LOAD’s reference year (one year for load, tariff and TOU periods)', async () => {
    await loadRunContext(client(), P, C)
    expect(h.tariff).toHaveBeenCalledWith(expect.anything(), P, { year: 2024 })
  })

  it('a pinned tariff yields 8760 TOU periods typed on the load’s year', async () => {
    const calendar = { highSeasonMonths: [6, 7, 8], holidayTreatedAs: 'sunday', source: 'published',
      windows: [{ season: 'low', dayType: 'weekday', startMinute: 420, endMinute: 600, period: 'peak' }, { season: 'high', dayType: 'weekday', startMinute: 420, endMinute: 600, period: 'peak' }] }
    h.tariff.mockResolvedValue({ ok: true, calendar, holidays: new Set<string>(), year: 2024, calc: {}, tariffRef: { tariffId: 't', tariffName: 'T', financialYear: '2024/25', licenseeName: 'L' } })
    const r = await loadRunContext(client(), P, C)
    expect(r.ok && r.ctx.touPeriods).toHaveLength(8760)
    // 6 Jan 2024 is a Saturday → hour 7 is NOT peak; on 2025 day types 6 Jan is a Monday → peak.
    if (r.ok) expect(r.ctx.touPeriods![5 * 24 + 7]).not.toBe('peak')
  })

  it('no study / unknown case / corrupt config → 404/404/422 sentences', async () => {
    await expect(loadRunContext(client({ 'solar.studies': [] }), P, C)).resolves.toEqual({ ok: false, status: 404, error: 'Save Site & Supply first.' })
    await expect(loadRunContext(client(), P, 'nope')).resolves.toEqual({ ok: false, status: 404, error: 'Case not found.' })
    const bad = { 'solar.cases': [{ ...tables['solar.cases'][0], config: { version: 99 } }] }
    await expect(loadRunContext(client(bad), P, C)).resolves.toEqual({ ok: false, status: 422, error: 'This case’s saved configuration is invalid — open it, check each section and save it again.' })
  })

  it('no site load → the build names it', async () => {
    const r = await loadRunContext(client({ 'solar.site_load': [] }), P, C)
    expect(r.ok && r.ctx.build).toEqual({ ok: false, reasons: [BUILD_REASONS.noLoad] })
  })

  it('a stored series caseLoadFromSiteSeries refuses (LoadModelError) is a named build reason, never a 500', async () => {
    const series = new Array(8760).fill(100)
    series[3] = -5
    const r = await loadRunContext(client({ 'solar.site_load': [{ ...tables['solar.site_load'][0], series }] }), P, C)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.ctx.build.ok).toBe(false)
    const reasons = r.ctx.build.ok ? [] : r.ctx.build.reasons
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toMatch(/^The stored site load cannot be simulated: The site series has negative load \(hour index 3\).* Rebuild it on the Load tab\.$/)
    expect(r.ctx.currentHash).toBeNull()
    const short = await loadRunContext(client({ 'solar.site_load': [{ ...tables['solar.site_load'][0], series: [1, 2, 3] }] }), P, C)
    expect(short.ok && !short.ctx.build.ok && short.ctx.build.reasons[0]).toMatch(/8760 hourly values/)
  })

  it('a weather id that no longer resolves in the org is treated as "no weather" (never trusted)', async () => {
    const r = await loadRunContext(client({ 'solar.weather_datasets': [] }), P, C)
    expect(r.ok && r.ctx.build).toEqual({ ok: false, reasons: [BUILD_REASONS.noWeather] })
    expect(r.ok && r.ctx.currentHash).toBeNull()
  })

  it('study inputs are loaded once and reused per case', async () => {
    const svc = client()
    const shared = await loadStudyInputs(svc, P)
    expect(shared).not.toBeNull()
    const ctx = await contextForCase(svc, shared!, tables['solar.cases'][0] as never)
    expect(ctx.ok && ctx.ctx.build.ok).toBe(true)
    expect(h.tariff).toHaveBeenCalledTimes(1)
  })
})
