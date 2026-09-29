import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ gate: vi.fn(), svc: vi.fn(), revalidate: vi.fn(), loadYear: vi.fn(), loadPrev: vi.fn() }))
vi.mock('@/lib/tariffs/admin-gate', () => ({ requirePlatformTariffAdmin: h.gate }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: h.svc }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))
vi.mock('@/lib/tariffs/load-year', () => ({ loadYearTariffs: h.loadYear, loadPreviousPublished: h.loadPrev }))

import {
  approveChargeAction, editChargeAction, rejectChargeAction, validateTariffYearAction, publishTariffYearAction, saveSsegRuleAction,
  setExportTariffAction,
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
  const SEEN = { amount: '247.76', unit: 'c_per_kWh' as const, reviewedAt: null }
  const STALE = 'That charge changed or was removed since you loaded the page. Reload to see the current version.'
  const GUARD = [['eq', 'id', 'c1'], ['eq', 'amount_excl_vat', '247.76'], ['eq', 'unit', 'c_per_kWh'], ['is', 'reviewed_at', null]]

  it('approve sets a review stamp through the admin session (the trigger binds who/when), only on the charge the reviewer saw', async () => {
    const { calls } = admin({ writes: { 'tariffs.charge:update': { data: [{ id: 'c1' }] } } })
    expect(await approveChargeAction({ chargeId: 'c1', expected: SEEN })).toEqual({ ok: true })
    const u = callsTo(calls, 'tariffs.charge', 'update')[0]
    expect(Object.keys(u.payload as object)).toEqual(['reviewed_at'])
    expect(u.filters).toEqual(GUARD)
  })

  it('approve: a charge edited or approved by someone else since the page loaded is refused as stale', async () => {
    admin({ writes: { 'tariffs.charge:update': { data: [] } } })
    expect(await approveChargeAction({ chargeId: 'c1', expected: SEEN })).toEqual({ error: STALE })
    const { calls } = admin({ writes: { 'tariffs.charge:update': { data: [] } } })
    await approveChargeAction({ chargeId: 'c1', expected: { ...SEEN, reviewedAt: '2026-09-28T10:00:00+00:00' } })
    expect(callsTo(calls, 'tariffs.charge', 'update')[0].filters).toContainEqual(['eq', 'reviewed_at', '2026-09-28T10:00:00+00:00'])
    expect(h.revalidate).not.toHaveBeenCalled()
  })

  it('edit validates amount and unit against the component, and confirming the unit clears the inference', async () => {
    const { calls } = admin({
      tables: { 'tariffs.charge': [{ id: 'c1', component: 'energy', season: 'all', unit: 'R_per_kWh', unit_inferred: true, inference_reason: 'magnitude' }] },
      writes: { 'tariffs.charge:update': { data: [{ id: 'c1' }] } },
    })
    expect(await editChargeAction({ chargeId: 'c1', expected: SEEN, amount: '5', unit: 'R_per_month', unitConfirmed: true }))
      .toEqual({ fieldErrors: { unit: 'Not a valid unit for Energy: R/month' } })
    expect(await editChargeAction({ chargeId: 'c1', expected: SEEN, amount: '247,76', unit: 'c_per_kWh', unitConfirmed: true })).toEqual({ ok: true })
    const u = callsTo(calls, 'tariffs.charge', 'update')[0]
    expect(u.payload).toEqual({
      amount_excl_vat: 247.76, unit: 'c_per_kWh', unit_inferred: false, inference_reason: null, extraction_method: 'manual',
    })
    expect(u.filters).toEqual(GUARD)
  })

  it('edit: 0 rows changed is a stale sentence, not success', async () => {
    admin({
      tables: { 'tariffs.charge': [{ id: 'c1', component: 'energy', season: 'all', unit: 'c_per_kWh', unit_inferred: false, inference_reason: null }] },
      writes: { 'tariffs.charge:update': { data: [] } },
    })
    expect(await editChargeAction({ chargeId: 'c1', expected: SEEN, amount: '250', unit: 'c_per_kWh', unitConfirmed: false })).toEqual({ error: STALE })
  })

  it('reject deletes the charge row only as the reviewer saw it', async () => {
    const { calls } = admin({ writes: { 'tariffs.charge:delete': { data: [{ id: 'c1' }] } } })
    expect(await rejectChargeAction({ chargeId: 'c1', expected: SEEN })).toEqual({ ok: true })
    expect(callsTo(calls, 'tariffs.charge', 'delete')[0].filters).toEqual(GUARD)
    admin({ writes: { 'tariffs.charge:delete': { data: [] } } })
    expect(await rejectChargeAction({ chargeId: 'c1', expected: SEEN })).toEqual({ error: STALE })
  })

  const YEAR_TARIFFS = [
    { id: 't1', tariff_year_id: 'y1', updated_at: 'U1', name: 'Homeflex 1' },
    { id: 'e1', tariff_year_id: 'y1', updated_at: 'U9', name: 'Gen-offset' },
    { id: 'x1', tariff_year_id: 'y2', updated_at: 'U3', name: 'Other year' },
  ]

  it('export tariff: links a tariff to an export tariff of the same year, conditioned on the updated_at the page loaded', async () => {
    const { calls } = admin({
      tables: { 'tariffs.tariff': YEAR_TARIFFS, 'tariffs.tariff_year': [{ id: 'y1', state: 'in_review' }] },
      writes: { 'tariffs.tariff:update': { data: [{ id: 't1', updated_at: 'U2' }] } },
    })
    expect(await setExportTariffAction({ tariffId: 't1', exportTariffId: 'e1', expectedUpdatedAt: 'U1' })).toEqual({ ok: true, updatedAt: 'U2' })
    const u = callsTo(calls, 'tariffs.tariff', 'update')[0]
    expect(u.payload).toEqual({ export_tariff_id: 'e1' })
    expect(u.filters).toEqual([['eq', 'id', 't1'], ['eq', 'updated_at', 'U1']])
  })

  it('export tariff: clearing the link writes null', async () => {
    const { calls } = admin({
      tables: { 'tariffs.tariff': YEAR_TARIFFS, 'tariffs.tariff_year': [{ id: 'y1', state: 'in_review' }] },
      writes: { 'tariffs.tariff:update': { data: [{ id: 't1', updated_at: 'U2' }] } },
    })
    expect(await setExportTariffAction({ tariffId: 't1', exportTariffId: null, expectedUpdatedAt: 'U1' })).toEqual({ ok: true, updatedAt: 'U2' })
    expect(callsTo(calls, 'tariffs.tariff', 'update')[0].payload).toEqual({ export_tariff_id: null })
  })

  it('export tariff: refuses another year, itself, a published year, and a stale page', async () => {
    const tables = { 'tariffs.tariff': YEAR_TARIFFS, 'tariffs.tariff_year': [{ id: 'y1', state: 'in_review' }] }
    let f = admin({ tables })
    expect(await setExportTariffAction({ tariffId: 't1', exportTariffId: 'x1', expectedUpdatedAt: 'U1' }))
      .toEqual({ error: 'Choose an export tariff from this same tariff year.' })
    expect(await setExportTariffAction({ tariffId: 't1', exportTariffId: 't1', expectedUpdatedAt: 'U1' }))
      .toEqual({ error: 'A tariff cannot be its own export tariff.' })
    expect(callsTo(f.calls, 'tariffs.tariff', 'update')).toHaveLength(0)
    f = admin({ tables: { ...tables, 'tariffs.tariff_year': [{ id: 'y1', state: 'published' }] } })
    expect(await setExportTariffAction({ tariffId: 't1', exportTariffId: 'e1', expectedUpdatedAt: 'U1' }))
      .toEqual({ error: 'This year is published: its export links are read-only.' })
    expect(callsTo(f.calls, 'tariffs.tariff', 'update')).toHaveLength(0)
    admin({ tables, writes: { 'tariffs.tariff:update': { data: [] } } })
    expect(await setExportTariffAction({ tariffId: 't1', exportTariffId: 'e1', expectedUpdatedAt: 'U1' }))
      .toEqual({ error: 'Someone else changed this tariff. Reload to see their version.' })
  })

  it('export tariff: a non-admin is refused before any read', async () => {
    h.gate.mockResolvedValue({ ok: false, error: 'Only platform tariff admins can do this.' })
    expect(await setExportTariffAction({ tariffId: 't1', exportTariffId: 'e1', expectedUpdatedAt: 'U1' }))
      .toEqual({ error: 'Only platform tariff admins can do this.' })
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

  it('SSEG rule: inserts when none was loaded; updates conditioned on the updated_at the form loaded', async () => {
    const f = admin({ tables: { 'tariffs.tariff_year': [{ id: 'y1', licensee_id: 'l1', state: 'in_review' }] },
      writes: { 'tariffs.sseg_rule:insert': { data: [{ id: 's1', updated_at: 'U1' }] } } })
    expect(await saveSsegRuleAction({ yearId: 'y1', expectedUpdatedAt: null, form: EMPTY_SSEG_FORM })).toEqual({ ok: true, updatedAt: 'U1' })
    expect(callsTo(f.calls, 'tariffs.sseg_rule', 'insert')[0].payload).toMatchObject({ tariff_year_id: 'y1', licensee_id: 'l1', crediting: 'net_billing_tou' })
    const g = admin({ tables: { 'tariffs.tariff_year': [{ id: 'y1', licensee_id: 'l1', state: 'in_review' }] },
      writes: { 'tariffs.sseg_rule:update': { data: [{ id: 's1', updated_at: 'U2' }] } } })
    expect(await saveSsegRuleAction({ yearId: 'y1', expectedUpdatedAt: 'U1', form: EMPTY_SSEG_FORM })).toEqual({ ok: true, updatedAt: 'U2' })
    expect(callsTo(g.calls, 'tariffs.sseg_rule', 'update')[0].filters).toEqual([['eq', 'tariff_year_id', 'y1'], ['eq', 'updated_at', 'U1']])
  })

  it('SSEG rule: a rule someone else saved (or created) since the form loaded is refused as stale', async () => {
    admin({ tables: { 'tariffs.tariff_year': [{ id: 'y1', licensee_id: 'l1', state: 'in_review' }] },
      writes: { 'tariffs.sseg_rule:update': { data: [] } } })
    expect(await saveSsegRuleAction({ yearId: 'y1', expectedUpdatedAt: 'U1', form: EMPTY_SSEG_FORM }))
      .toEqual({ error: 'Someone else changed this SSEG rule. Reload to see their version.' })
    admin({ tables: { 'tariffs.tariff_year': [{ id: 'y1', licensee_id: 'l1', state: 'in_review' }] },
      writes: { 'tariffs.sseg_rule:insert': { error: { code: '23505', message: 'duplicate key value violates unique constraint' } } } })
    expect(await saveSsegRuleAction({ yearId: 'y1', expectedUpdatedAt: null, form: EMPTY_SSEG_FORM }))
      .toEqual({ error: 'Someone else changed this SSEG rule. Reload to see their version.' })
    expect(h.revalidate).not.toHaveBeenCalled()
  })
})
