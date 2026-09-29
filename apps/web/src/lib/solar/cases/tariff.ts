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
 * SA public holidays of that same year (`referenceYearHolidays`).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_REFERENCE_YEAR, studyPricingHash, yearOneTariff, type ResolvedStudyPricing, type Tariff, type TouCalendar } from '@esite/shared'
import {
  SOLAR_ENGINE_DEFAULTS, referenceYearHolidays, tariffBillCalculator,
  type BillCalculator, type TariffBillCalculatorOptions,
} from '@esite/shared/solar-engine'
import type { TariffRef } from '@esite/shared/solar-cases'
import { loadStudyPricing, ssegFromRow } from '../pricing/load-study-pricing'
import { keyedPricingHash } from '../pricing/pricing-hash'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

export const TARIFF_REASONS = {
  notPinned: 'No tariff is pinned for this study — pin one on the Tariff tab.',
  notPublished: 'The pinned tariff’s year is not published.',
  noCalendar: 'There is no TOU calendar for this supply authority yet.',
  unreadable: 'The pinned tariff could not be read — try again.',
} as const

export type StudyTariff =
  | {
      ok: true; calc: BillCalculator; calendar: TouCalendar; holidays: ReadonlySet<string>; tariffRef: TariffRef; year: number
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

type WindowT = TouCalendar['windows'][number]
export function calendarFromRows(cal: Row, windows: Row[], rule: Row | null): TouCalendar {
  return {
    highSeasonMonths: (cal.high_season_months as number[]) ?? [],
    windows: windows.map((w) => ({
      season: w.season as WindowT['season'], dayType: w.day_type as WindowT['dayType'],
      startMinute: Number(w.start_minute), endMinute: Number(w.end_minute), period: w.period as WindowT['period'],
    })),
    holidayTreatedAs: rule ? (rule.treated_as as 'saturday' | 'sunday') : null,
    source: cal.source as TouCalendar['source'],
  }
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
  const t = svc.schema('tariffs')
  const { data: cals } = await t.from('tou_calendar').select('id, valid_from, valid_to, high_season_months, source').eq('licensee_id', loaded.tariffYear.licenseeId)
  const cal = ((cals ?? []) as Row[])
    .filter((c) => String(c.valid_from) <= `${year}-12-31` && (c.valid_to === null || c.valid_to === undefined || String(c.valid_to) >= `${year}-01-01`))
    .sort((a, b) => String(b.valid_from).localeCompare(String(a.valid_from)))[0]
  if (!cal) return { ok: false, reason: TARIFF_REASONS.noCalendar }
  const [{ data: windows }, { data: rule }] = await Promise.all([
    t.from('tou_window').select('season, day_type, start_minute, end_minute, period').eq('calendar_id', cal.id as string),
    t.from('holiday_rule').select('treated_as').eq('calendar_id', cal.id as string).maybeSingle(),
  ])
  const calendar = calendarFromRows(cal, (windows ?? []) as Row[], (rule as Row | null) ?? null)
  const holidays = referenceYearHolidays(year)
  const { pricing } = loaded
  const nmd = loaded.study.nmdKva
  const build: BuildBillCalculator = opts.build ?? tariffBillCalculator
  // Year 1 is priced in the financial year it falls in: a pin from an earlier year is brought
  // forward by the resolver's catch-up (TARIFF-12). Without one this IS pricing.tariff.
  const calc = build(yearOneTariff(pricing), {
    calendar, referenceYear: year, holidays,
    sseg: pricing.ssegRule, exportTariff: pricing.exportTariff,
    powerFactor: SOLAR_ENGINE_DEFAULTS.load.powerFactor,
    ...(nmd !== null ? { demandForMonth: () => ({ nmdKva: nmd }) } : {}),
  })
  return {
    ok: true, calc, calendar, holidays, year, pricing, pricingHash: keyedPricingHash(studyPricingHash(pricing)),
    tariffRef: { tariffId: loaded.study.tariffId, tariffName: pricing.tariff.name, financialYear: loaded.tariffYear.financialYear, licenseeName: loaded.licenseeName },
  }
}
