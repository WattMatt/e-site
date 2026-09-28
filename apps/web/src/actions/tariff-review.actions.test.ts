import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ gate: vi.fn(), svc: vi.fn(), revalidate: vi.fn(), loadYear: vi.fn(), loadPrev: vi.fn() }))
vi.mock('@/lib/tariffs/admin-gate', () => ({ requirePlatformTariffAdmin: h.gate }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: h.svc }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))
vi.mock('@/lib/tariffs/load-year', () => ({ loadYearTariffs: h.loadYear, loadPreviousPublished: h.loadPrev }))

import {
  approveChargeAction, editChargeAction, rejectChargeAction, validateTariffYearAction, publishTariffYearAction, saveSsegRuleAction,
} from './tariff-review.actions'
import { EMPTY_SSEG_FORM } from '@/lib/tariffs/sseg-form'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'
import { makeCharge, makeTariff } from '@esite/shared'

function admin(extra: Parameters<typeof fakeSupabase>[0] = {}) {
  const fake = fakeSupabase({ userId: 'a1', ...extra })
  h.gate.mockResolvedValue({ ok: true, supabase: fake.client, userId: 'a1' })
  return fake
}

beforeEach(() => vi.clearAllMocks())

describe('tariff review actions', () => {
  it('approve sets a review stamp through the admin session (the trigger binds who/when)', async () => {
    const { calls } = admin({ writes: { 'tariffs.charge:update': { data: [{ id: 'c1' }] } } })
    expect(await approveChargeAction({ chargeId: 'c1' })).toEqual({ ok: true })
    expect(Object.keys(callsTo(calls, 'tariffs.charge', 'update')[0].payload as object)).toEqual(['reviewed_at'])
  })

  it('edit validates amount and unit against the component, and confirming the unit clears the inference', async () => {
    const { calls } = admin({
      tables: { 'tariffs.charge': [{ id: 'c1', component: 'energy', season: 'all', unit: 'R_per_kWh', unit_inferred: true, inference_reason: 'magnitude' }] },
      writes: { 'tariffs.charge:update': { data: [{ id: 'c1' }] } },
    })
    expect(await editChargeAction({ chargeId: 'c1', amount: '5', unit: 'R_per_month', unitConfirmed: true }))
      .toEqual({ fieldErrors: { unit: 'Not a valid unit for Energy: R/month' } })
    expect(await editChargeAction({ chargeId: 'c1', amount: '247,76', unit: 'c_per_kWh', unitConfirmed: true })).toEqual({ ok: true })
    expect(callsTo(calls, 'tariffs.charge', 'update')[0].payload).toEqual({
      amount_excl_vat: 247.76, unit: 'c_per_kWh', unit_inferred: false, inference_reason: null, extraction_method: 'manual',
    })
  })

  it('reject deletes the charge row', async () => {
    const { calls } = admin({ writes: { 'tariffs.charge:delete': { data: [{ id: 'c1' }] } } })
    expect(await rejectChargeAction({ chargeId: 'c1' })).toEqual({ ok: true })
    expect(callsTo(calls, 'tariffs.charge', 'delete')).toHaveLength(1)
  })

  it('validate: fingerprint first, then checks, then records the verdict with that fingerprint', async () => {
    admin()
    const order: string[] = []
    const rpc = vi.fn(async (name: string) => {
      order.push(name)
      return name === 'year_content_fingerprint' ? { data: 'fp-1', error: null } : { data: null, error: null }
    })
    const svc = fakeSupabase({ tables: { 'tariffs.tariff_year': [{ id: 'y1', licensee_id: 'l1', financial_year: '2026/27', approved_increase_pct: 10, state: 'in_review' }] } }).client
    h.svc.mockReturnValue({ ...svc, schema: (s: string) => ({ ...svc.schema(s), rpc }) })
    h.loadYear.mockImplementation(async () => { order.push('load'); return [{ id: 't1', row: {}, chargeRows: [], tariff: makeTariff({ name: 'Empty', structure: 'flat', charges: [] }) }] })
    h.loadPrev.mockResolvedValue(null)
    expect(await validateTariffYearAction({ yearId: 'y1' })).toEqual({ ok: true, blocking: 1, review: 0, warn: 0 })
    expect(order).toEqual(['year_content_fingerprint', 'load', 'record_year_validation'])
    expect(rpc).toHaveBeenLastCalledWith('record_year_validation', { p_year_id: 'y1', p_blocking: 1, p_fingerprint: 'fp-1' })
  })

  it('validate: a content change mid-check is reported as a sentence', async () => {
    admin()
    const rpc = vi.fn(async (name: string) => name === 'year_content_fingerprint'
      ? { data: 'fp-1', error: null }
      : { data: null, error: { code: '40001', message: 'tariffs.record_year_validation: the year changed while it was being checked' } })
    const svc = fakeSupabase({ tables: { 'tariffs.tariff_year': [{ id: 'y1', licensee_id: 'l1', financial_year: '2026/27', approved_increase_pct: null, state: 'in_review' }] } }).client
    h.svc.mockReturnValue({ ...svc, schema: (s: string) => ({ ...svc.schema(s), rpc }) })
    h.loadYear.mockResolvedValue([{ id: 't1', row: {}, chargeRows: [], tariff: makeTariff({ name: 'Ok', structure: 'flat', charges: [makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 250 })] }) }])
    h.loadPrev.mockResolvedValue(null)
    expect(await validateTariffYearAction({ yearId: 'y1' })).toEqual({ error: 'The year changed while it was being checked. Run the checks again.' })
  })

  it('publish: the database decides; its refusal becomes a sentence', async () => {
    admin({ writes: { 'tariffs.tariff_year:update': { error: { code: '23514', message: 'tariffs.tariff_year y1: 2 inferred unit(s) not reviewed' } } } })
    expect(await publishTariffYearAction({ yearId: 'y1' })).toEqual({ error: 'Some charges with an inferred unit are not reviewed yet. Approve them first.' })
    const { calls } = admin({ writes: { 'tariffs.tariff_year:update': { data: [{ id: 'y1' }] } } })
    expect(await publishTariffYearAction({ yearId: 'y1' })).toEqual({ ok: true })
    expect(callsTo(calls, 'tariffs.tariff_year', 'update')[0]).toMatchObject({ payload: { state: 'published' }, filters: [['eq', 'id', 'y1'], ['eq', 'state', 'in_review']] })
  })

  it('SSEG rule: inserts when none exists, updates otherwise', async () => {
    const f = admin({ tables: { 'tariffs.tariff_year': [{ id: 'y1', licensee_id: 'l1', state: 'in_review' }] } })
    expect(await saveSsegRuleAction({ yearId: 'y1', form: EMPTY_SSEG_FORM })).toEqual({ ok: true })
    expect(callsTo(f.calls, 'tariffs.sseg_rule', 'insert')[0].payload).toMatchObject({ tariff_year_id: 'y1', licensee_id: 'l1', crediting: 'net_billing_tou' })
    const g = admin({ tables: { 'tariffs.tariff_year': [{ id: 'y1', licensee_id: 'l1', state: 'in_review' }], 'tariffs.sseg_rule': [{ id: 's1', tariff_year_id: 'y1' }] } })
    expect(await saveSsegRuleAction({ yearId: 'y1', form: EMPTY_SSEG_FORM })).toEqual({ ok: true })
    expect(callsTo(g.calls, 'tariffs.sseg_rule', 'update')).toHaveLength(1)
  })
})
