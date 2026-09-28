import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  createClient: vi.fn(), svc: vi.fn(), requireSolarLevel: vi.fn(), audit: vi.fn(async () => {}), revalidate: vi.fn(), effective: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: h.svc }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))
vi.mock('@/lib/solar/tariff/effective-tariff', () => ({ loadEffectiveTariff: h.effective }))

import {
  selectSolarTariffAction, saveSolarExportRuleAction, createSolarTariffOverrideAction, revertSolarTariffOverrideAction,
  editSolarOverrideChargeAction, recordSolarBillCheckAction, reportTariffErrorAction, saveSolarEscalationAction,
  deleteSolarBillCheckAction, getSolarTariffSourceUrlAction,
} from './solar-tariff.actions'
import { fakeSupabase, callsTo, type FakeOptions } from '@/test/fake-supabase'
import { EMPTY_BILL_CHECK_FORM, makeCharge, makeTariff } from '@esite/shared'

const P = 'p1'
const T = '22222222-2222-2222-2222-222222222222'
const STALE = 'Someone else changed this — reload to see their version.'

function setup(o: FakeOptions = {}, rpc?: ReturnType<typeof vi.fn>) {
  const fake = fakeSupabase({ userId: 'u1', ...o })
  const client = rpc ? { ...fake.client, schema: (s: string) => ({ ...fake.client.schema(s), rpc }) } : fake.client
  h.createClient.mockResolvedValue(client)
  return fake
}

beforeEach(() => { vi.clearAllMocks(); h.requireSolarLevel.mockResolvedValue('edit_financials') })

describe('solar tariff actions', () => {
  it('every action demands Edit + financials (the gate redirects lower levels)', async () => {
    setup()
    h.requireSolarLevel.mockRejectedValue(new Error('REDIRECT:/projects/p1/solar/locked'))
    await expect(selectSolarTariffAction({ projectId: P, tariffId: T, expectedUpdatedAt: 'T1' })).rejects.toThrow('REDIRECT')
    await expect(reportTariffErrorAction({ projectId: P, tariffId: T, note: 'x' })).rejects.toThrow('REDIRECT')
    await expect(getSolarTariffSourceUrlAction({ projectId: P, sourceDocumentId: 'd1' })).rejects.toThrow('REDIRECT')
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit_financials', expect.anything())
    expect(h.svc).not.toHaveBeenCalled()
  })

  it('select: conditioned on updated_at; 0 rows is stale; audit carries the id only', async () => {
    const f = setup({ writes: { 'solar.studies:update': { data: [{ updated_at: 'T2' }] } } })
    expect(await selectSolarTariffAction({ projectId: P, tariffId: T, expectedUpdatedAt: 'T1' })).toEqual({ ok: true, updatedAt: 'T2' })
    expect(callsTo(f.calls, 'solar.studies', 'update')[0]).toMatchObject({ payload: { tariff_id: T }, filters: [['eq', 'project_id', P], ['eq', 'updated_at', 'T1']] })
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'tariff_selected', objectRef: { tariffId: T } })
    setup({ writes: { 'solar.studies:update': { data: [] } } })
    expect(await selectSolarTariffAction({ projectId: P, tariffId: T, expectedUpdatedAt: 'T1' })).toEqual({ error: STALE })
  })

  it('select: a draft or overridden pin is refused with the database sentence mapped', async () => {
    setup({ writes: { 'solar.studies:update': { error: { code: '23514', message: 'solar.studies: the project override belongs to another study or tariff; revert it first' } } } })
    expect(await selectSolarTariffAction({ projectId: P, tariffId: T, expectedUpdatedAt: 'T1' }))
      .toEqual({ error: 'Revert the project override before choosing another tariff.' })
  })

  it('export rule manual: note mandatory; rates replaced; the rule saved last and conditioned', async () => {
    const tables = { 'solar.studies': [{ id: 's1', project_id: P, tariff_id: T, updated_at: 'T1' }], 'tariffs.tariff': [{ id: T, export_tariff_id: null }] }
    setup({ tables })
    expect(await saveSolarExportRuleAction({ projectId: P, expectedUpdatedAt: 'T1',
      form: { method: 'manual', sourceNote: '', rates: [{ season: 'all', tou: 'all', unit: 'c_per_kWh', amount: '95' }] } }))
      .toEqual({ fieldErrors: { sourceNote: 'Say where this rate comes from (document and page)' } })
    const f = setup({ tables, writes: { 'solar.studies:update': { data: [{ updated_at: 'T2' }] } } })
    expect(await saveSolarExportRuleAction({ projectId: P, expectedUpdatedAt: 'T1',
      form: { method: 'manual', sourceNote: 'Tshwane SSEG 2026/27 p4', rates: [{ season: 'all', tou: 'all', unit: 'c_per_kWh', amount: '95' }] } }))
      .toEqual({ ok: true, updatedAt: 'T2' })
    const writes = f.calls.filter((c) => c.op !== 'select').map((c) => `${c.table}:${c.op}`)
    expect(writes).toEqual(['solar.study_export_rates:delete', 'solar.study_export_rates:insert', 'solar.studies:update'])
    expect(callsTo(f.calls, 'solar.study_export_rates', 'insert')[0].payload).toEqual([
      { study_id: 's1', season: 'all', tou: 'all', unit: 'c_per_kWh', amount_excl_vat: 95, source_note: 'Tshwane SSEG 2026/27 p4' },
    ])
  })

  it('export rule: a stale study is refused before anything is written', async () => {
    const f = setup({ tables: { 'solar.studies': [{ id: 's1', project_id: P, tariff_id: T, updated_at: 'T9' }], 'tariffs.tariff': [{ id: T, export_tariff_id: null }] } })
    expect(await saveSolarExportRuleAction({ projectId: P, expectedUpdatedAt: 'T1', form: { method: 'none', sourceNote: '', rates: [] } })).toEqual({ error: STALE })
    expect(f.calls.filter((c) => c.op !== 'select')).toHaveLength(0)
  })

  it('override create / revert go through the SQL functions with the expected timestamp', async () => {
    const rpc = vi.fn(async () => ({ data: 'o1', error: null }))
    setup({}, rpc)
    expect(await createSolarTariffOverrideAction({ projectId: P, expectedUpdatedAt: 'T1' })).toEqual({ ok: true })
    expect(rpc).toHaveBeenCalledWith('create_tariff_override', { p_project_id: P, p_expected_updated_at: 'T1' })
    const stale = vi.fn(async () => ({ data: null, error: { code: '40001', message: 'solar.revert_tariff_override: stale' } }))
    setup({}, stale)
    expect(await revertSolarTariffOverrideAction({ projectId: P, expectedUpdatedAt: 'T1' })).toEqual({ error: STALE })
  })

  it('override row edit needs a reason and is conditioned on the row updated_at', async () => {
    const tables = { 'solar.tariff_override_charges': [{ id: 'oc1', project_id: P, component: 'energy', season: 'all' }] }
    setup({ tables })
    expect(await editSolarOverrideChargeAction({ projectId: P, chargeId: 'oc1', expectedUpdatedAt: 'R1', form: { amount: '199', unit: 'c_per_kWh', reason: '' } }))
      .toEqual({ fieldErrors: { reason: 'Say why this rate differs from the published one' } })
    const f = setup({ tables, writes: { 'solar.tariff_override_charges:update': { data: [{ id: 'oc1' }] } } })
    expect(await editSolarOverrideChargeAction({ projectId: P, chargeId: 'oc1', expectedUpdatedAt: 'R1', form: { amount: '199', unit: 'c_per_kWh', reason: 'Lease cl. 14' } }))
      .toEqual({ ok: true })
    expect(callsTo(f.calls, 'solar.tariff_override_charges', 'update')[0]).toMatchObject({
      payload: { amount_excl_vat: 199, unit: 'c_per_kWh', reason: 'Lease cl. 14' },
      filters: [['eq', 'id', 'oc1'], ['eq', 'project_id', P], ['eq', 'updated_at', 'R1']],
    })
  })

  it('bill check: models the month with the effective tariff and stores the record', async () => {
    const f = setup({ writes: { 'solar.bill_checks:insert': { data: [{ id: 'b1' }] } } })
    h.effective.mockResolvedValue({ studyId: 's1', tariffId: T, overrideId: null, nmdKva: null, highSeasonMonths: null,
      tariff: makeTariff({ name: 'Flat', structure: 'flat', charges: [
        makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 250 }), makeCharge({ component: 'basic', unit: 'R_per_month', amountExclVat: 400 }),
      ] }) })
    const r = await recordSolarBillCheckAction({ projectId: P, form: { ...EMPTY_BILL_CHECK_FORM, month: '2026-03', totalKwh: '1000', actualTotal: '2700' } })
    expect(r).toMatchObject({ ok: true, result: { modelled: 2900, actual: 2700, differencePct: 7.407, warn: true } })
    expect(callsTo(f.calls, 'solar.bill_checks', 'insert')[0].payload).toMatchObject({
      study_id: 's1', billing_month: '2026-03-01', tariff_id: T, tariff_override_id: null, import_kwh_standard: 1000,
      actual_total_excl_vat: 2700, modelled_total_excl_vat: 2900, difference_pct: 7.407,
    })
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'bill_check_recorded', objectRef: { billingMonth: '2026-03' } })
  })

  it('bill check delete: scoped to the project; audited without amounts', async () => {
    const f = setup()
    expect(await deleteSolarBillCheckAction({ projectId: P, id: 'b1' })).toEqual({ ok: true })
    expect(callsTo(f.calls, 'solar.bill_checks', 'delete')[0].filters).toEqual([['eq', 'id', 'b1'], ['eq', 'project_id', P]])
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'bill_check_deleted', objectRef: { billCheckId: 'b1' } })
  })

  it('report a tariff error: note required; inserted through the caller session', async () => {
    const f = setup({ writes: { 'tariffs.error_report:insert': { data: [{ id: 'r1' }] } } })
    expect(await reportTariffErrorAction({ projectId: P, tariffId: T, note: '  ' })).toEqual({ error: 'Describe what looks wrong.' })
    expect(await reportTariffErrorAction({ projectId: P, tariffId: T, note: 'Basic charge is last year\'s' })).toEqual({ ok: true })
    expect(callsTo(f.calls, 'tariffs.error_report', 'insert')[0].payload).toEqual({ tariff_id: T, project_id: P, note: 'Basic charge is last year\'s' })
  })

  it('escalation: overrides validated against the org analysis period; empty form clears to defaults', async () => {
    const tables = { 'solar.studies': [{ id: 's1', project_id: P, organisation_id: 'org1', updated_at: 'T1' }], 'solar.org_settings': [] }
    setup({ tables })
    expect(await saveSolarEscalationAction({ projectId: P, expectedUpdatedAt: 'T1', form: { '2': 'abc' } })).toEqual({ fieldErrors: { '2': 'Enter a percentage' } })
    const f = setup({ tables, writes: { 'solar.studies:update': { data: [{ updated_at: 'T2' }] } } })
    expect(await saveSolarEscalationAction({ projectId: P, expectedUpdatedAt: 'T1', form: { '2': '' } })).toEqual({ ok: true, updatedAt: 'T2' })
    expect(callsTo(f.calls, 'solar.studies', 'update')[0].payload).toEqual({ escalation: null })
  })
})
