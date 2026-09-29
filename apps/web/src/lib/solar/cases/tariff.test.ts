// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { referenceYearHolidays } from '@esite/shared/solar-engine'
import { resolveStudyTariff, TARIFF_REASONS, calendarFromRows, ssegFromRow, isMissingTariffColumn } from './tariff'

const P = 'p1'
const tables = {
  'solar.studies': [{ project_id: P, tariff_id: 't1', nmd_kva: 500 }],
  'tariffs.tariff': [{ id: 't1', tariff_year_id: 'y1', name: 'Business Flat', category: 'commercial', metering: 'conventional', structure: 'flat', export_tariff_id: null }],
  'tariffs.charge': [{ tariff_id: 't1', component: 'energy', season: 'all', tou: 'all', day_type: 'all', unit: 'c_per_kWh', amount_excl_vat: 250, vat_basis: 'stated_excl', extraction_method: 'manual', source_locator: {} }],
  'tariffs.tariff_year': [{ id: 'y1', licensee_id: 'L', financial_year: '2025/26', state: 'published' }],
  'tariffs.licensee': [{ id: 'L', name: 'City Power' }],
  'tariffs.tou_calendar': [{ id: 'cal', licensee_id: 'L', valid_from: '2025-04-01', valid_to: null, high_season_months: [6, 7, 8], source: 'assumed_eskom' }],
  'tariffs.tou_window': [{ calendar_id: 'cal', season: 'low', day_type: 'weekday', start_minute: 420, end_minute: 600, period: 'peak' }],
  'tariffs.holiday_rule': [{ calendar_id: 'cal', treated_as: 'sunday' }],
  'tariffs.sseg_rule': [],
}

/** A client whose studies select fails the way a base without solar.studies.tariff_id fails. */
const failingStudies = (error: { code?: string; message: string }) =>
  ({ schema: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error }) }) }) }) }) })

describe('resolveStudyTariff', () => {
  it('builds the calculator from the pinned published tariff, its calendar and the SA holidays of the LOAD’s reference year', async () => {
    const build = vi.fn(() => ({ monthlyBills: () => [], withExportRateScaled: () => { throw new Error('unused') } }))
    const r = await resolveStudyTariff(fakeSupabase({ tables }).client as never, P, { year: 2026, build })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.year).toBe(2026)
    expect(r.tariffRef).toEqual({ tariffId: 't1', tariffName: 'Business Flat', financialYear: '2025/26', licenseeName: 'City Power' })
    const [tariff, opts] = build.mock.calls[0] as unknown as [{ name: string; charges: unknown[] }, Record<string, unknown> & { holidays: ReadonlySet<string>; demandForMonth: (m: number) => unknown }]
    expect(tariff.name).toBe('Business Flat')
    expect(tariff.charges).toHaveLength(1)
    const calendar = { highSeasonMonths: [6, 7, 8], holidayTreatedAs: 'sunday', source: 'assumed_eskom',
      windows: [{ season: 'low', dayType: 'weekday', startMinute: 420, endMinute: 600, period: 'peak' }] }
    expect(opts.calendar).toEqual(calendar)
    expect(r.calendar).toEqual(calendar)
    expect([...opts.holidays].sort()).toEqual([...referenceYearHolidays(2026)].sort())
    expect(opts.holidays.has('2026-12-25')).toBe(true)
    // No library SSEG row: the Net-Billing Rules default the Tariff tab shows; no linked export tariff and
    // no stored rule → 'none', i.e. crediting none (I-1: was sseg null regardless of the rule).
    expect(opts).toMatchObject({ referenceYear: 2026, exportTariff: null, powerFactor: 0.95 })
    expect((opts.sseg as { crediting: string }).crediting).toBe('none')
    expect(r.pricing.exportMethod).toBe('none')
    expect(r.pricingHash).toMatch(/^[0-9a-f]{64}$/)
    expect(opts.demandForMonth(1)).toEqual({ nmdKva: 500 })
  })

  it('without an injected builder the result is a working engine BillCalculator (tariffBillCalculator)', async () => {
    const r = await resolveStudyTariff(fakeSupabase({ tables }).client as never, P, { year: 2025 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const flows = { importKwh: new Float64Array(8760).fill(1), exportKwh: new Float64Array(8760) }
    const bills = r.calc.monthlyBills(flows)
    expect(bills).toHaveLength(12)
    expect(bills.every((b) => Number.isFinite(b.totalZar) && b.totalZar > 0)).toBe(true)
    expect(r.calc.withExportRateScaled(1.2).monthlyBills(flows)).toHaveLength(12)
  })

  describe('a base without the tariff_id column (Phase 2b not merged) → not pinned, never a 500', () => {
    for (const [label, error] of [
      ['Postgres 42703', { code: '42703', message: 'column studies.tariff_id does not exist' }],
      ['PostgREST PGRST204', { code: 'PGRST204', message: "Could not find the 'tariff_id' column of 'studies' in the schema cache" }],
      ['PostgREST PGRST200', { code: 'PGRST200', message: 'Could not find a relationship' }],
      ['message only', { message: 'column studies.tariff_id does not exist' }],
    ] as const) {
      it(label, async () => {
        await expect(resolveStudyTariff(failingStudies(error) as never, P)).resolves.toEqual({ ok: false, reason: TARIFF_REASONS.notPinned })
      })
    }
    it('any other DB error keeps its own sentence', async () => {
      await expect(resolveStudyTariff(failingStudies({ code: '57014', message: 'canceling statement due to statement timeout' }) as never, P))
        .resolves.toEqual({ ok: false, reason: TARIFF_REASONS.unreadable })
      expect(isMissingTariffColumn({ code: '42501', message: 'permission denied for table studies' })).toBe(false)
      expect(isMissingTariffColumn({ message: 'column studies.nmd_kva does not exist' })).toBe(false)
    })
  })

  it('NULL pin, unpublished year, no calendar → the matching sentence', async () => {
    const t = (over: Record<string, unknown[]>) => fakeSupabase({ tables: { ...tables, ...over } as never }).client as never
    await expect(resolveStudyTariff(t({ 'solar.studies': [{ project_id: P, tariff_id: null }] }), P)).resolves.toEqual({ ok: false, reason: TARIFF_REASONS.notPinned })
    await expect(resolveStudyTariff(t({ 'solar.studies': [] }), P)).resolves.toEqual({ ok: false, reason: TARIFF_REASONS.notPinned })
    await expect(resolveStudyTariff(t({ 'tariffs.tariff_year': [{ id: 'y1', licensee_id: 'L', financial_year: '2025/26', state: 'in_review' }] }), P)).resolves.toEqual({ ok: false, reason: TARIFF_REASONS.notPublished })
    await expect(resolveStudyTariff(t({ 'tariffs.tou_calendar': [] }), P)).resolves.toEqual({ ok: false, reason: TARIFF_REASONS.noCalendar })
    await expect(resolveStudyTariff(t({ 'tariffs.tariff': [] }), P)).resolves.toEqual({ ok: false, reason: TARIFF_REASONS.unreadable })
  })
})

describe('row mappers', () => {
  it('ssegFromRow maps the Net-Billing rule', () => {
    expect(ssegFromRow({ crediting: 'net_billing_tou', carry_forward: 'within_financial_year', fy_end_month: 3, cap_rule: 'kwh_per_tou_period', offsets: 'energy_only', forfeit_on_ownership_change: true, max_kva: '1000', requires_tou: true, requires_bidirectional_meter: true, locator: { pages: '7-12' } }))
      .toEqual({ crediting: 'net_billing_tou', carryForward: 'within_financial_year', fyEndMonth: 3, capRule: 'kwh_per_tou_period', offsets: 'energy_only', forfeitOnOwnershipChange: true, maxKva: 1000, requiresTou: true, requiresBidirectionalMeter: true, locator: { pages: '7-12' } })
  })
  it('calendarFromRows without a holiday rule → holidayTreatedAs null', () => {
    expect(calendarFromRows({ high_season_months: [6], source: 'published' }, [], null).holidayTreatedAs).toBeNull()
  })
})
