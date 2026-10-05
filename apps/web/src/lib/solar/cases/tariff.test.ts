// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { referenceYearHolidays } from '@esite/shared/solar-engine'
import { resolveStudyTariff, TARIFF_REASONS, ssegFromRow, isMissingTariffColumn } from './tariff'

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
    expect(r.tariffRef).toEqual({
      tariffId: 't1', tariffName: 'Business Flat', financialYear: '2025/26', licenseeName: 'City Power',
      // City Power's own calendar row, itself stored as assumed_eskom (municipal books state no hours).
      touHours: { source: 'assumed_eskom', calendarLicenseeName: 'City Power', validFrom: '2025-04-01', datedHolidays: 0 },
    })
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
})

describe('resolveStudyTariff — the TOU calendar is the Tariff tab’s (loadStudyCalendar)', () => {
  const ESKOM = { id: 'E', name: 'Eskom', kind: 'eskom' }
  const ESKOM_LA = { id: 'ELA', name: 'Eskom (Local Authority tariffs)', kind: 'eskom' }
  const eskomCal = { id: 'ecal', licensee_id: 'E', valid_from: '2025-04-01', valid_to: null, high_season_months: [6, 7, 8], source: 'published' }
  const eskomWin = { calendar_id: 'ecal', season: 'high', day_type: 'weekday', start_minute: 360, end_minute: 480, period: 'peak' }
  const muni = (over: Record<string, unknown[]> = {}) => fakeSupabase({ tables: {
    ...tables,
    'tariffs.licensee': [{ id: 'L', name: 'City Power', kind: 'metro' }, ESKOM_LA, ESKOM],
    'tariffs.tou_calendar': [eskomCal, { id: 'lacal', licensee_id: 'ELA', valid_from: '2025-07-01', valid_to: null, high_season_months: [7], source: 'published' }],
    'tariffs.tou_window': [eskomWin],
    'tariffs.holiday_rule': [],
    ...over,
  } as never }).client as never
  const TODAY = '2026-10-05'

  it('a supply authority without its own calendar is priced on Eskom’s hours, flagged assumed, and the run says so', async () => {
    const r = await resolveStudyTariff(muni(), P, { year: 2025, todayIso: TODAY })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.calendar.source).toBe('assumed_eskom')
    expect(r.calendar.windows).toEqual([{ season: 'high', dayType: 'weekday', startMinute: 360, endMinute: 480, period: 'peak' }])
    expect(r.tariffRef.touHours).toEqual({ source: 'assumed_eskom', calendarLicenseeName: 'Eskom', validFrom: '2025-04-01', datedHolidays: 0 })
  })

  it('the Eskom stand-in is deterministic: the licensee named first, whatever order the rows arrive in', async () => {
    const r = await resolveStudyTariff(muni(), P, { year: 2025, todayIso: TODAY })
    expect(r.ok && r.calendar.highSeasonMonths).toEqual([6, 7, 8]) // 'Eskom', not 'Eskom (Local Authority tariffs)'
  })

  it('the calendar is the one valid on the pricing date (the tab’s rule), not any calendar overlapping the reference year', async () => {
    const own = { id: 'cal', licensee_id: 'L', valid_from: '2025-04-01', valid_to: '2026-01-01', high_season_months: [1], source: 'published' }
    const r = await resolveStudyTariff(muni({ 'tariffs.tou_calendar': [own, eskomCal] }), P, { year: 2025, todayIso: TODAY })
    expect(r.ok && r.tariffRef.touHours).toMatchObject({ source: 'assumed_eskom', calendarLicenseeName: 'Eskom' })
    const current = await resolveStudyTariff(muni({ 'tariffs.tou_calendar': [own, eskomCal] }), P, { year: 2025, todayIso: '2025-10-05' })
    expect(current.ok && current.tariffRef.touHours).toEqual({ source: 'published', calendarLicenseeName: 'City Power', validFrom: '2025-04-01', datedHolidays: 0 })
  })

  it('neither its own nor Eskom’s calendar → the noCalendar sentence', async () => {
    await expect(resolveStudyTariff(muni({ 'tariffs.tou_calendar': [] }), P, { todayIso: TODAY })).resolves.toEqual({ ok: false, reason: TARIFF_REASONS.noCalendar })
  })

  describe('dated holiday treatment (tariffs.holiday_treatment)', () => {
    const megaflex = (over: Record<string, unknown[]> = {}) => muni({
      'tariffs.tariff': [{ id: 't1', tariff_year_id: 'y1', name: 'Megaflex Urban', family: 'Megaflex', category: 'commercial', metering: 'conventional', structure: 'tou', export_tariff_id: null }],
      'tariffs.tariff_year': [{ id: 'y1', licensee_id: 'E', financial_year: '2026/27', state: 'published' }],
      'tariffs.holiday_treatment': [
        { calendar_id: 'ecal', tariff_family: ' MEGAFLEX ', holiday_date: '2026-04-27', treated_as: 'saturday' },
        { calendar_id: 'ecal', tariff_family: 'Megaflex', holiday_date: '2026-04-03', treated_as: 'sunday' },
        { calendar_id: 'ecal', tariff_family: 'Homeflex', holiday_date: '2026-05-01', treated_as: 'sunday' },
        { calendar_id: 'lacal', tariff_family: 'Megaflex', holiday_date: '2026-06-16', treated_as: 'sunday' },
      ],
      ...over,
    })
    const holidaysOf = (build: ReturnType<typeof vi.fn>) => (build.mock.calls[0] as unknown as [unknown, { holidays: ReadonlySet<string> | ReadonlyMap<string, string> }])[1].holidays
    const builder = () => vi.fn(() => ({ monthlyBills: () => [], withExportRateScaled: () => { throw new Error('unused') } }))

    it('the tariff family’s dated rows of the reference year price those holidays; the count is on the run', async () => {
      const build = builder()
      const r = await resolveStudyTariff(megaflex(), P, { year: 2026, todayIso: TODAY, build })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      const h = holidaysOf(build) as ReadonlyMap<string, string>
      expect(h.get('2026-04-27')).toBe('saturday')
      expect(h.get('2026-04-03')).toBe('sunday')
      expect(h.has('2026-05-01')).toBe(false)   // Homeflex's row
      expect(h.has('2026-06-16')).toBe(false)   // another calendar's row
      expect(r.holidays).toBe(h)                // engineTouPeriods reads the same days the bill does
      expect(r.tariffRef.touHours).toEqual({ source: 'published', calendarLicenseeName: 'Eskom', validFrom: '2025-04-01', datedHolidays: 2 })
    })

    it('a reference year the rows do not cover keeps the statutory holidays exactly as before', async () => {
      const build = builder()
      const r = await resolveStudyTariff(megaflex(), P, { year: 2025, todayIso: TODAY, build })
      expect(r.ok && r.tariffRef.touHours?.datedHolidays).toBe(0)
      expect([...(holidaysOf(build) as ReadonlySet<string>)].sort()).toEqual([...referenceYearHolidays(2025)].sort())
    })

    it('a base without the table (00228 not applied) prices as before; any other read error refuses the run', async () => {
      const t = (code: string) => fakeSupabase({ tables: {
        ...tables,
        'tariffs.licensee': [ESKOM],
        'tariffs.tariff': [{ id: 't1', tariff_year_id: 'y1', name: 'Megaflex Urban', family: 'Megaflex', category: 'commercial', metering: 'conventional', structure: 'tou', export_tariff_id: null }],
        'tariffs.tariff_year': [{ id: 'y1', licensee_id: 'E', financial_year: '2026/27', state: 'published' }],
        'tariffs.tou_calendar': [eskomCal], 'tariffs.tou_window': [eskomWin], 'tariffs.holiday_rule': [],
      } as never, selectErrors: { 'tariffs.holiday_treatment': { code, message: 'x' } } }).client as never
      const missing = await resolveStudyTariff(t('PGRST205'), P, { year: 2026, todayIso: TODAY })
      expect(missing.ok && missing.tariffRef.touHours?.datedHolidays).toBe(0)
      await expect(resolveStudyTariff(t('42P01'), P, { year: 2026, todayIso: TODAY })).resolves.toMatchObject({ ok: true })
      await expect(resolveStudyTariff(t('57014'), P, { year: 2026, todayIso: TODAY })).resolves.toEqual({ ok: false, reason: TARIFF_REASONS.unreadable })
    })
  })
})
