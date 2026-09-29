import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'
import { defaultCaseConfig, defaultFinanceConfig } from '@esite/shared/solar-cases'
import { solarOrgSettingDefaults } from '@esite/shared'

const h = vi.hoisted(() => ({ createClient: vi.fn(), svc: { current: null as unknown }, lvl: vi.fn(), audit: vi.fn(async () => {}), emit: vi.fn(async () => {}), reval: vi.fn(), exec: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: () => h.svc.current }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.lvl }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('next/cache', () => ({ revalidatePath: h.reval }))
vi.mock('@/lib/solar/cases/financials', () => ({ executeFinancialsRun: h.exec }))
import { saveSolarFinancialsAction, applySolarRateCardAction, runSolarFinancialsAction } from './solar-financials.actions'

const P = 'p1', C = 'c1', ORG = 'o1', U = 'u1'
const s = solarOrgSettingDefaults()
const fin = defaultFinanceConfig(s)
const STALE = 'Someone else changed this — reload to see their version.'
beforeEach(() => { vi.clearAllMocks(); h.lvl.mockResolvedValue('edit_financials') })
const setup = (tables: Record<string, unknown[]> = {}, writes = {}, svcTables: Record<string, unknown[]> = {}) => {
  const u = fakeSupabase({ userId: U, tables: tables as never, writes })
  h.createClient.mockResolvedValue(u.client); h.svc.current = fakeSupabase({ tables: svcTables as never }).client
  return u
}

describe('solar financials actions', () => {
  it('every action needs Edit + financials, checked FIRST', async () => {
    const u = setup()
    h.lvl.mockRejectedValue(new Error('REDIRECT'))
    await expect(saveSolarFinancialsAction({ projectId: P, caseId: C, config: fin, expectedUpdatedAt: null })).rejects.toThrow('REDIRECT')
    await expect(applySolarRateCardAction({ projectId: P, caseId: C, config: fin })).rejects.toThrow('REDIRECT')
    await expect(runSolarFinancialsAction({ projectId: P, caseId: C })).rejects.toThrow('REDIRECT')
    expect(h.lvl).toHaveBeenCalledWith(P, 'edit_financials', u.client)
    expect(h.lvl).toHaveBeenCalledTimes(3)
    expect(u.calls).toHaveLength(0)
    expect(h.exec).not.toHaveBeenCalled()
  })
  it('first save inserts, later saves are stale-guarded', async () => {
    const u = setup({}, { 'solar.case_financials:insert': { data: [{ updated_at: 'T1' }] } })
    expect(await saveSolarFinancialsAction({ projectId: P, caseId: C, config: fin, expectedUpdatedAt: null })).toEqual({ ok: true, updatedAt: 'T1' })
    expect(callsTo(u.calls, 'solar.case_financials', 'insert')[0]!.payload).toEqual({ case_id: C, config: fin, config_version: 1 })
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: U, verb: 'financials_saved', objectRef: { caseId: C } })
    const u2 = setup({}, { 'solar.case_financials:update': { data: [] } })
    expect(await saveSolarFinancialsAction({ projectId: P, caseId: C, config: fin, expectedUpdatedAt: 'T1' })).toEqual({ error: STALE })
    expect(callsTo(u2.calls, 'solar.case_financials', 'update')[0]!.filters).toEqual(expect.arrayContaining([['eq', 'case_id', C], ['eq', 'project_id', P], ['eq', 'updated_at', 'T1']]))
    setup({}, { 'solar.case_financials:insert': { error: { code: '23505', message: 'dup' } } })
    expect(await saveSolarFinancialsAction({ projectId: P, caseId: C, config: fin, expectedUpdatedAt: null })).toEqual({ error: STALE })
  })
  it('invalid config → field errors', async () => {
    setup()
    const r = await saveSolarFinancialsAction({ projectId: P, caseId: C, config: { ...fin, models: { ...fin.models, cash: { enabled: false } } }, expectedUpdatedAt: null })
    expect(r).toEqual({ fieldErrors: { models: 'Choose at least one finance model' } })
  })
  it('apply rate card: org settings read with the service client; missing rates named', async () => {
    const cfg = defaultCaseConfig(s, { dcKwp: 50, acKw: 40 })
    setup({ 'solar.cases': [{ id: C, project_id: P, organisation_id: ORG, config: cfg }] }, {}, { 'solar.org_settings': [{ organisation_id: ORG, settings: { values: {} } }] })
    expect(await applySolarRateCardAction({ projectId: P, caseId: C, config: fin })).toEqual({ error: 'Set these on Settings → Solar → Rate card first: PV system, up to 100 kWp (R/Wp).' })
    setup({ 'solar.cases': [{ id: C, project_id: P, organisation_id: ORG, config: cfg }] }, {}, { 'solar.org_settings': [{ organisation_id: ORG, settings: { values: { rc_pv_r_per_wp_small: 12 } } }] })
    const ok = await applySolarRateCardAction({ projectId: P, caseId: C, config: fin })
    expect('ok' in ok && ok.config.capex).toEqual([expect.objectContaining({ id: 'rc-pv', qty: 50_000, rateZar: 12 })])
    setup()
    expect(await applySolarRateCardAction({ projectId: P, caseId: C, config: fin })).toEqual({ error: 'Case not found.' })
  })
  it('run → audit + product event on success; the lib’s sentence on failure', async () => {
    setup()
    h.exec.mockResolvedValueOnce({ ok: true, id: 'f1' })
    expect(await runSolarFinancialsAction({ projectId: P, caseId: C })).toEqual({ ok: true, id: 'f1' })
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: U, verb: 'financials_run', objectRef: { caseId: C, financialsId: 'f1' } })
    expect(h.emit).toHaveBeenCalledWith({ actorId: U, projectId: P, event: 'solar_financials_run' })
    expect(h.reval).toHaveBeenCalledWith(`/projects/${P}/solar`, 'layout')
    h.exec.mockResolvedValueOnce({ ok: false, status: 422, error: 'Run the case on Yield & Scenarios first.' })
    expect(await runSolarFinancialsAction({ projectId: P, caseId: C })).toEqual({ error: 'Run the case on Yield & Scenarios first.' })
    expect(h.emit).toHaveBeenCalledTimes(1)
  })
  it('run passes the signed-in user as run_by and the service client for the stored result; signed-out → refused', async () => {
    setup()
    h.exec.mockResolvedValueOnce({ ok: true, id: 'f1' })
    await runSolarFinancialsAction({ projectId: P, caseId: C })
    expect(h.exec).toHaveBeenCalledWith(expect.objectContaining({ projectId: P, caseId: C, userId: U, svc: h.svc.current }))
    const u = fakeSupabase({ userId: null })
    h.createClient.mockResolvedValue(u.client)
    expect(await runSolarFinancialsAction({ projectId: P, caseId: C })).toEqual({ error: 'You are not signed in.' })
    expect(h.exec).toHaveBeenCalledTimes(1)
  })
})
