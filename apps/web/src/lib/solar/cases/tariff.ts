import 'server-only'
/**
 * The study's pricing as an engine BillCalculator — READ-ONLY. Built from `loadStudyPricing` (the one
 * pricing loader the Tariff tab bill check also uses, I-1): override applied, the export rule's tariff and
 * the effective SSEG rule ('none' = crediting none). Pinning (solar.studies.tariff_id,
 * TOU calendars) is Phase 2b; until it is on the base the select fails with 42703 / PGRST204 and every
 * path returns a named reason, so Run financials is disabled with a sentence instead of guessing.
 *
 * The calculator is the integration adapter `tariffBillCalculator` (solar-engine), priced on the
 * day types of `year` — which MUST be the site load's reference year (caseLoadFromSiteSeries), or
 * every weekday shifts and the TOU split is mispriced without an error. Holidays are the statutory
 * SA public holidays of that same year (`referenceYearHolidays`), with the tariff family's dated
 * treatment for that year where the library holds one (tariffs.holiday_treatment, exact dates only).
 *
 * The TOU calendar is the Tariff tab's (`loadStudyCalendar`): the pinned licensee's calendar valid on
 * the pricing date, else Eskom's hours flagged assumed_eskom. Where they came from rides on
 * `tariffRef.touHours`, which the run stores and shows.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  DEFAULT_REFERENCE_YEAR, resolveHolidayDays, studyPricingHash, yearOneExportTariff, yearOneTariff,
  type HolidayDays, type ResolvedStudyPricing, type Tariff, type TouCalendar, type WindowDayType,
} from '@esite/shared'
import {
  SOLAR_ENGINE_DEFAULTS, referenceYearHolidays, tariffBillCalculator,
  type BillCalculator, type TariffBillCalculatorOptions,
} from '@esite/shared/solar-engine'
import type { TariffRef } from '@esite/shared/solar-cases'
import { loadStudyPricing, ssegFromRow } from '../pricing/load-study-pricing'
import { keyedPricingHash } from '../pricing/pricing-hash'
import { loadStudyCalendar } from '../tariff/calendar-loader'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

export const TARIFF_REASONS = {
  notPinned: 'No tariff is pinned for this study — pin one on the Tariff tab.',
  notPublished: 'The pinned tariff’s year is not published.',
  noCalendar: 'There is no TOU calendar for this supply authority, and none for Eskom to stand in.',
  unreadable: 'The pinned tariff could not be read — try again.',
} as const

export type StudyTariff =
  | {
      ok: true; calc: BillCalculator; calendar: TouCalendar; holidays: HolidayDays; tariffRef: TariffRef; year: number
      /** The resolved study pricing the calculator was built from, and its KEYED canonical hash (I-1, pricing-hash.ts). */
      pricing: ResolvedStudyPricing; pricingHash: string
    }
  | { ok: false; reason: string }

/**
 * Owner decision (Phase 4b): until Phase 2b adds solar.studies.tariff_id, a "column does not exist"
 * answer means "nothing is pinned" — Postgres 42703, PostgREST PGRST204 (column not in the schema
 * cache) / PGRST200, or a message naming the missing tariff_id column. Anything else is a real error.
 */
export function isMissingTariffColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST200') return true
  return /column .*tariff_id.* does not exist/i.test(error.message ?? '')
}

export { ssegFromRow }

/** PostgREST / Postgres "no such table": a base where the holiday_treatment migration has not applied. */
const isMissingTable = (e: { code?: string }) => e.code === 'PGRST205' || e.code === '42P01'

/**
 * The tariff family's dated holiday treatment on this calendar, within `year`. Families match
 * case- and space-insensitively (the explorer's rule). A tariff without a family has none.
 */
async function datedHolidays(
  svc: AnyClient, calendarId: string, family: string | null, year: number,
): Promise<{ date: string; treatedAs: WindowDayType }[] | 'unreadable'> {
  const fam = family?.trim().toUpperCase()
  if (!fam) return []
  const { data, error } = await svc.schema('tariffs').from('holiday_treatment').select('tariff_family, holiday_date, treated_as')
    .eq('calendar_id', calendarId).gte('holiday_date', `${year}-01-01`).lte('holiday_date', `${year}-12-31`)
  if (error) {
    if (isMissingTable(error)) return []
    console.error('[solar-tariff] holiday treatment read failed', { calendarId, code: error.code })
    return 'unreadable'
  }
  return ((data ?? []) as Row[])
    .filter((r) => String(r.tariff_family).trim().toUpperCase() === fam)
    .map((r) => ({ date: String(r.holiday_date).slice(0, 10), treatedAs: r.treated_as as WindowDayType }))
}

export type BuildBillCalculator = (t: Tariff, o: TariffBillCalculatorOptions) => BillCalculator

export async function resolveStudyTariff(
  svc: AnyClient, projectId: string, opts: { year?: number; build?: BuildBillCalculator; todayIso?: string } = {},
): Promise<StudyTariff> {
  const year = opts.year ?? DEFAULT_REFERENCE_YEAR
  // The ONE pricing loader (I-1): override, export rule + rates, SSEG rule, escalation, load growth.
  const loaded = await loadStudyPricing(svc, projectId, { todayIso: opts.todayIso })
  if (!loaded.ok) {
    if (loaded.code === 'studyReadFailed') {
      if (isMissingTariffColumn(loaded.error)) return { ok: false, reason: TARIFF_REASONS.notPinned }
      console.error('[solar-tariff] study read failed', { projectId, code: loaded.error.code })
      return { ok: false, reason: TARIFF_REASONS.unreadable }
    }
    return { ok: false, reason: loaded.code === 'noStudy' || loaded.code === 'notPinned' ? TARIFF_REASONS.notPinned : TARIFF_REASONS.unreadable }
  }
  if (loaded.tariffYear.state !== 'published') return { ok: false, reason: TARIFF_REASONS.notPublished }
  // The calendar valid on the pricing date — the date year 1 is priced in, the tab's rule.
  const onIso = opts.todayIso ?? new Date().toISOString().slice(0, 10)
  const cal = await loadStudyCalendar(svc, loaded.tariffYear.licenseeId, onIso)
  if (!cal.calendar || !cal.origin) return { ok: false, reason: TARIFF_REASONS.noCalendar }
  const calendar = cal.calendar
  const { pricing } = loaded
  const dated = await datedHolidays(svc, cal.origin.id, pricing.tariff.family, year)
  if (dated === 'unreadable') return { ok: false, reason: TARIFF_REASONS.unreadable }
  const { days: holidays, dated: datedCount } = resolveHolidayDays(year, referenceYearHolidays(year), calendar.holidayTreatedAs, dated)
  const nmd = loaded.study.nmdKva
  const build: BuildBillCalculator = opts.build ?? tariffBillCalculator
  // Year 1 is priced in the financial year it falls in: a pin from an earlier year is brought
  // forward by the resolver's catch-up (TARIFF-12), a linked export tariff with it. Without one
  // these ARE pricing.tariff / pricing.exportTariff.
  const calc = build(yearOneTariff(pricing), {
    calendar, referenceYear: year, holidays,
    sseg: pricing.ssegRule, exportTariff: yearOneExportTariff(pricing),
    powerFactor: SOLAR_ENGINE_DEFAULTS.load.powerFactor,
    ...(nmd !== null ? { demandForMonth: () => ({ nmdKva: nmd }) } : {}),
  })
  return {
    ok: true, calc, calendar, holidays, year, pricing, pricingHash: keyedPricingHash(studyPricingHash(pricing)),
    tariffRef: {
      tariffId: loaded.study.tariffId, tariffName: pricing.tariff.name, financialYear: loaded.tariffYear.financialYear, licenseeName: loaded.licenseeName,
      touHours: {
        source: calendar.source, calendarLicenseeName: cal.origin.licenseeName ?? loaded.licenseeName,
        validFrom: cal.origin.validFrom, datedHolidays: datedCount,
      },
    },
  }
}
