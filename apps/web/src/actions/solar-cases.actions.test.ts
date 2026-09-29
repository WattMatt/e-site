import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, callsTo, type FakeOptions } from '@/test/fake-supabase'
import { defaultCaseConfig } from '@esite/shared/solar-cases'
import { solarOrgSettingDefaults } from '@esite/shared'

const h = vi.hoisted(() => ({
  createClient: vi.fn(), svc: { current: null as unknown }, requireSolarLevel: vi.fn(), audit: vi.fn(async () => {}),
  emit: vi.fn(async () => {}), revalidate: vi.fn(), weather: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: () => h.svc.current }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))
vi.mock('@/lib/solar/cases/weather', () => ({ getOrFetchWeather: h.weather }))
import {
  createSolarCaseAction, duplicateSolarCaseAction, renameSolarCaseAction, deleteSolarCaseAction,
  setSelectedSolarCaseAction, saveSolarCaseAction, fetchSolarWeatherAction,
} from './solar-cases.actions'

const P = 'p1', S = 's1', ORG = 'o1', U = 'u1', C = 'c1'
const STALE = 'Someone else changed this — reload to see their version.'
const cfg = defaultCaseConfig(solarOrgSettingDefaults(), { dcKwp: 500, acKw: 400 })
const study = { id: S, project_id: P, organisation_id: ORG, latitude: -26.2, longitude: 28.05, updated_at: 'T0' }
const MOD = '11111111-1111-4111-8111-111111111111'

function setup(user: Partial<FakeOptions> = {}, svc: Partial<FakeOptions> = {}) {
  const u = fakeSupabase({ userId: U, ...user, tables: { 'solar.studies': [study], ...(user.tables ?? {}) } })
  const s = fakeSupabase({ ...svc, tables: { 'solar.org_settings': [{ organisation_id: ORG, settings: { values: { soiling_pct: 3 } } }], ...(svc.tables ?? {}) } })
  h.createClient.mockResolvedValue(u.client); h.svc.current = s.client
  return { u, s }
}
beforeEach(() => { vi.clearAllMocks(); h.requireSolarLevel.mockResolvedValue('edit') })

describe('every case action re-checks Solar Edit FIRST', () => {
  it('a refused level (redirect) stops the action before any read or write', async () => {
    const { u } = setup()
    h.requireSolarLevel.mockRejectedValue(new Error('NEXT_REDIRECT'))
    for (const run of [
      () => createSolarCaseAction({ projectId: P, name: 'A', start: { kind: 'manual', dcKwp: 1, acKw: 1 } }),
      () => duplicateSolarCaseAction({ projectId: P, caseId: C }),
      () => renameSolarCaseAction({ projectId: P, caseId: C, name: 'N', expectedUpdatedAt: 'T0' }),
      () => deleteSolarCaseAction({ projectId: P, caseId: C }),
      () => setSelectedSolarCaseAction({ projectId: P, caseId: C, expectedUpdatedAt: 'T0' }),
      () => saveSolarCaseAction({ projectId: P, caseId: C, config: cfg, expectedUpdatedAt: 'T0' }),
      () => fetchSolarWeatherAction({ projectId: P }),
    ]) await expect(run()).rejects.toThrow('NEXT_REDIRECT')
    expect(h.requireSolarLevel).toHaveBeenCalledTimes(7)
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit', u.client)
    expect(u.calls).toHaveLength(0)
    expect(h.weather).not.toHaveBeenCalled()
  })
})

describe('createSolarCaseAction', () => {
  it('re-checks Edit and snapshots the ORG defaults (read with the service client — org_settings is admin-only)', async () => {
    const { u } = setup({ writes: { 'solar.cases:insert': { data: [{ id: C, updated_at: 'T1' }] } } })
    const r = await createSolarCaseAction({ projectId: P, name: ' Base ', start: { kind: 'manual', dcKwp: 500, acKw: 400 } })
    expect(r).toEqual({ ok: true, caseId: C })
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit', u.client)
    const ins = callsTo(u.calls, 'solar.cases', 'insert')[0]!.payload as { study_id: string; name: string; pv_source: string; config: typeof cfg }
    expect(ins).toMatchObject({ study_id: S, name: 'Base', pv_source: 'manual' })
    expect(ins.config.losses.soilingPct).toBe(3)
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: U, verb: 'case_created', objectRef: { caseId: C } })
    expect(h.emit).toHaveBeenCalledWith({ actorId: U, projectId: P, event: 'solar_case_created' })
    expect(h.revalidate).toHaveBeenCalledWith(`/projects/${P}/solar`, 'layout')
  })
  it('From layout is refused until the Layout tab ships', async () => {
    setup()
    await expect(createSolarCaseAction({ projectId: P, name: 'L', start: { kind: 'layout', layoutId: 'x' } })).resolves.toEqual({ error: 'From layout arrives with the Layout tab — use Manual for now.' })
  })
  it('blank name, bad size, duplicate name, no study → sentences', async () => {
    setup()
    expect(await createSolarCaseAction({ projectId: P, name: '  ', start: { kind: 'manual', dcKwp: 1, acKw: 1 } })).toEqual({ fieldErrors: { name: 'Enter a name' } })
    expect(await createSolarCaseAction({ projectId: P, name: 'A', start: { kind: 'manual', dcKwp: 0, acKw: 1 } })).toEqual({ fieldErrors: { dcKwp: 'DC size must be greater than 0 kWp' } })
    expect(await createSolarCaseAction({ projectId: P, name: 'A', start: { kind: 'manual', dcKwp: 1, acKw: -1 } })).toEqual({ fieldErrors: { acKw: 'AC size must be greater than 0 kW' } })
    setup({ writes: { 'solar.cases:insert': { error: { code: '23505', message: 'dup' } } } })
    expect(await createSolarCaseAction({ projectId: P, name: 'A', start: { kind: 'manual', dcKwp: 1, acKw: 1 } })).toEqual({ fieldErrors: { name: 'A case with this name already exists' } })
    setup({ tables: { 'solar.studies': [] } })
    expect(await createSolarCaseAction({ projectId: P, name: 'A', start: { kind: 'manual', dcKwp: 1, acKw: 1 } })).toEqual({ error: 'Save Site & Supply first.' })
  })
})

describe('duplicateSolarCaseAction', () => {
  it('copies the config under the first free "(copy)" name; copies financials only if the caller can read them', async () => {
    const { u } = setup({
      tables: { 'solar.cases': [{ id: C, study_id: S, project_id: P, name: 'Base', config: cfg }, { id: 'c2', study_id: S, project_id: P, name: 'Base (copy)', config: cfg }], 'solar.case_financials': [] },
      writes: { 'solar.cases:insert': { data: [{ id: 'c3', updated_at: 'T1' }] } },
    })
    const r = await duplicateSolarCaseAction({ projectId: P, caseId: C })
    expect(r).toEqual({ ok: true, caseId: 'c3' })
    expect((callsTo(u.calls, 'solar.cases', 'insert')[0]!.payload as { name: string }).name).toBe('Base (copy 2)')
    expect(callsTo(u.calls, 'solar.case_financials', 'insert')).toHaveLength(0)
  })
  it('copies financials when the caller can read them', async () => {
    const { u } = setup({
      tables: { 'solar.cases': [{ id: C, study_id: S, project_id: P, name: 'Base', config: cfg }], 'solar.case_financials': [{ case_id: C, config: { version: 1 } }] },
      writes: { 'solar.cases:insert': { data: [{ id: 'c3', updated_at: 'T1' }] } },
    })
    await duplicateSolarCaseAction({ projectId: P, caseId: C })
    expect(callsTo(u.calls, 'solar.case_financials', 'insert')[0]!.payload).toEqual({ case_id: 'c3', config: { version: 1 } })
  })
  it('a copy whose equipment has left the catalogue (cases_bind 23514) → pick-again sentence, not the generic one', async () => {
    setup({
      tables: { 'solar.cases': [{ id: C, study_id: S, project_id: P, name: 'Base', config: cfg }], 'solar.case_financials': [] },
      writes: { 'solar.cases:insert': { error: { code: '23514', message: 'solar.cases: the module is not in this organisation\'s catalogue' } } },
    })
    expect(await duplicateSolarCaseAction({ projectId: P, caseId: C })).toEqual({ error: 'Pick the module again — it is not in your catalogue.' })
  })
  it('an unknown case → sentence', async () => {
    setup()
    expect(await duplicateSolarCaseAction({ projectId: P, caseId: 'nope' })).toEqual({ error: 'Case not found.' })
  })
})

describe('rename / delete / select', () => {
  it('rename is stale-guarded', async () => {
    const { u } = setup({ writes: { 'solar.cases:update': { data: [] } } })
    expect(await renameSolarCaseAction({ projectId: P, caseId: C, name: 'New', expectedUpdatedAt: 'T0' })).toEqual({ error: STALE })
    expect(callsTo(u.calls, 'solar.cases', 'update')[0]!.filters).toEqual(expect.arrayContaining([['eq', 'id', C], ['eq', 'project_id', P], ['eq', 'updated_at', 'T0']]))
  })
  it('rename succeeds and is audited', async () => {
    setup({ writes: { 'solar.cases:update': { data: [{ updated_at: 'T5' }] } } })
    expect(await renameSolarCaseAction({ projectId: P, caseId: C, name: ' New ', expectedUpdatedAt: 'T0' })).toEqual({ ok: true, updatedAt: 'T5' })
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: U, verb: 'case_renamed', objectRef: { caseId: C } })
  })
  it('deleting the selected case is a sentence (FK 23503)', async () => {
    setup({ writes: { 'solar.cases:delete': { error: { code: '23503', message: 'fk' } } } })
    expect(await deleteSolarCaseAction({ projectId: P, caseId: C })).toEqual({ error: 'This is the selected case — choose another selected case first.' })
  })
  it('delete succeeds and is audited', async () => {
    setup({ writes: { 'solar.cases:delete': { data: [{ id: C }] } } })
    expect(await deleteSolarCaseAction({ projectId: P, caseId: C })).toEqual({ ok: true })
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: U, verb: 'case_deleted', objectRef: { caseId: C } })
  })
  it('select: only a case with a completed run (23514) and stale-guarded on the study', async () => {
    setup({ writes: { 'solar.studies:update': { error: { code: '23514', message: 'x' } } } })
    expect(await setSelectedSolarCaseAction({ projectId: P, caseId: C, expectedUpdatedAt: 'T0' })).toEqual({ error: 'Only a case with a completed run can be selected.' })
    setup({ writes: { 'solar.studies:update': { data: [] } } })
    expect(await setSelectedSolarCaseAction({ projectId: P, caseId: C, expectedUpdatedAt: 'T0' })).toEqual({ error: STALE })
    const { u } = setup({ writes: { 'solar.studies:update': { data: [{ updated_at: 'T9' }] } } })
    expect(await setSelectedSolarCaseAction({ projectId: P, caseId: C, expectedUpdatedAt: 'T0' })).toEqual({ ok: true, updatedAt: 'T9' })
    expect(callsTo(u.calls, 'solar.studies', 'update')[0]!.filters).toEqual(expect.arrayContaining([['eq', 'project_id', P], ['eq', 'updated_at', 'T0']]))
  })
})

describe('saveSolarCaseAction', () => {
  it('validates, re-derives equipment snapshots from the catalogue (client values are not trusted), stale-guards', async () => {
    const forged = { ...cfg, pv: { ...cfg.pv, module: { equipmentId: MOD, make: 'X', model: 'Y', pmaxW: 999, gammaPmaxPctPerC: 0 } } }
    const { u } = setup(
      { writes: { 'solar.cases:update': { data: [{ updated_at: 'T2' }] } } },
      { tables: { 'solar.equipment': [{ id: MOD, organisation_id: null, kind: 'module', make: 'Generic', model: 'M', specs: { pmaxW: 550, gammaPmaxPctPerC: -0.35 } }] } },
    )
    const r = await saveSolarCaseAction({ projectId: P, caseId: C, config: forged, expectedUpdatedAt: 'T1' })
    expect(r).toEqual({ ok: true, updatedAt: 'T2' })
    const upd = callsTo(u.calls, 'solar.cases', 'update')[0]!
    const saved = (upd.payload as { config: typeof cfg }).config
    expect(saved.pv.module).toEqual({ equipmentId: MOD, make: 'Generic', model: 'M', pmaxW: 550, gammaPmaxPctPerC: -0.35 })
    expect(upd.filters).toEqual(expect.arrayContaining([['eq', 'id', C], ['eq', 'project_id', P], ['eq', 'updated_at', 'T1']]))
  })
  it('another org’s equipment row is not usable', async () => {
    setup({}, { tables: { 'solar.equipment': [{ id: MOD, organisation_id: 'other-org', kind: 'module', make: 'G', model: 'M', specs: { pmaxW: 550, gammaPmaxPctPerC: -0.35 } }] } })
    const r = await saveSolarCaseAction({ projectId: P, caseId: C, config: { ...cfg, pv: { ...cfg.pv, module: { equipmentId: MOD, make: 'G', model: 'M', pmaxW: 550, gammaPmaxPctPerC: -0.35 } } }, expectedUpdatedAt: 'T1' })
    expect(r).toEqual({ fieldErrors: { 'pv.module': 'Pick the module again — it is not in your catalogue' } })
  })
  it('unknown equipment id → field error; invalid config → field errors; nothing written', async () => {
    const { u } = setup()
    const r1 = await saveSolarCaseAction({ projectId: P, caseId: C, config: { ...cfg, pv: { ...cfg.pv, module: { equipmentId: MOD, make: 'X', model: 'Y', pmaxW: 1, gammaPmaxPctPerC: 0 } } }, expectedUpdatedAt: 'T1' })
    expect(r1).toEqual({ fieldErrors: { 'pv.module': 'Pick the module again — it is not in your catalogue' } })
    const r2 = await saveSolarCaseAction({ projectId: P, caseId: C, config: { ...cfg, pv: { ...cfg.pv, dcKwp: -1 } }, expectedUpdatedAt: 'T1' })
    expect('fieldErrors' in r2 && Object.keys(r2.fieldErrors)).toContain('pv.dcKwp')
    expect(callsTo(u.calls, 'solar.cases', 'update')).toHaveLength(0)
  })
  it('a weather dataset outside the org → field error', async () => {
    setup()
    const r = await saveSolarCaseAction({ projectId: P, caseId: C, config: { ...cfg, weather: { source: 'pvgis_tmy', datasetId: '22222222-2222-4222-8222-222222222222' } }, expectedUpdatedAt: 'T1' })
    expect(r).toEqual({ fieldErrors: { 'weather.datasetId': 'Fetch the weather again — that dataset is not available' } })
  })
  it('stale save → sentence', async () => {
    setup({ writes: { 'solar.cases:update': { data: [] } } })
    expect(await saveSolarCaseAction({ projectId: P, caseId: C, config: cfg, expectedUpdatedAt: 'T1' })).toEqual({ error: STALE })
  })
})

describe('fetchSolarWeatherAction', () => {
  it('needs Edit and coordinates; passes the study org to the per-org cache', async () => {
    setup()
    h.weather.mockResolvedValue({ ok: true, cached: false, dataset: { id: 'w1', fetched_at: 'T', radiation_db: 'PVGIS-SARAH2', lat_round: -26.2, lng_round: 28.05, gsa_pvout_kwh_per_kwp: 1700 } })
    const r = await fetchSolarWeatherAction({ projectId: P })
    expect(r).toEqual({ ok: true, dataset: { id: 'w1', fetchedAt: 'T', radiationDb: 'PVGIS-SARAH2', latRound: -26.2, lngRound: 28.05, gsaPvoutKwhPerKwp: 1700, cached: false } })
    expect(h.weather).toHaveBeenCalledWith(expect.objectContaining({ orgId: ORG, lat: -26.2, lng: 28.05, userId: U }))
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: U, verb: 'weather_fetched', objectRef: { datasetId: 'w1' } })
    expect(h.emit).toHaveBeenCalledWith({ actorId: U, projectId: P, event: 'solar_weather_fetched' })
  })
  it('a cached dataset is returned without an audit row or product event', async () => {
    setup()
    h.weather.mockResolvedValue({ ok: true, cached: true, dataset: { id: 'w1', fetched_at: 'T', radiation_db: null, lat_round: -26.2, lng_round: 28.05, gsa_pvout_kwh_per_kwp: null } })
    expect(await fetchSolarWeatherAction({ projectId: P })).toMatchObject({ ok: true, dataset: { cached: true, gsaPvoutKwhPerKwp: null } })
    expect(h.emit).not.toHaveBeenCalled()
    expect(h.audit).not.toHaveBeenCalled()
  })
  it('the weather lib’s sentence passes through (rate limit / PVGIS down)', async () => {
    setup()
    h.weather.mockResolvedValue({ ok: false, status: 429, error: 'Weather fetches are limited to 5 per 10 minutes for your organisation — try again shortly.' })
    expect(await fetchSolarWeatherAction({ projectId: P })).toEqual({ error: 'Weather fetches are limited to 5 per 10 minutes for your organisation — try again shortly.' })
  })
  it('no coordinates → sentence, no fetch', async () => {
    setup({ tables: { 'solar.studies': [{ ...study, latitude: null }] } })
    expect(await fetchSolarWeatherAction({ projectId: P })).toEqual({ error: 'Set the site coordinates on Site & Supply first.' })
    expect(h.weather).not.toHaveBeenCalled()
  })
})
