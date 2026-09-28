import 'server-only'
/**
 * The study's pinned tariff as an engine BillCalculator — READ-ONLY. Pinning (solar.studies.tariff_id,
 * TOU calendars) is Phase 2b; until it is on the base the select fails with 42703 / PGRST204 and every
 * path returns a named reason, so Run financials is disabled with a sentence instead of guessing.
 *
 * The calculator is the integration adapter `tariffBillCalculator` (solar-engine), priced on the
 * day types of `year` — which MUST be the site load's reference year (caseLoadFromSiteSeries), or
 * every weekday shifts and the TOU split is mispriced without an error. Holidays are the statutory
 * SA public holidays of that same year (`referenceYearHolidays`).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_REFERENCE_YEAR, type SsegRule, type Tariff, type TouCalendar } from '@esite/shared'
import { tariffFromRows } from '@esite/shared/tariffs/ingest'
import {
  SOLAR_ENGINE_DEFAULTS, referenceYearHolidays, tariffBillCalculator,
  type BillCalculator, type TariffBillCalculatorOptions,
} from '@esite/shared/solar-engine'
import type { TariffRef } from '@esite/shared/solar-cases'

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
  | { ok: true; calc: BillCalculator; calendar: TouCalendar; holidays: ReadonlySet<string>; tariffRef: TariffRef; year: number }
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

export function ssegFromRow(r: Row): SsegRule {
  return {
    crediting: r.crediting as SsegRule['crediting'], carryForward: r.carry_forward as SsegRule['carryForward'],
    fyEndMonth: Number(r.fy_end_month), capRule: r.cap_rule as SsegRule['capRule'], offsets: 'energy_only',
    forfeitOnOwnershipChange: Boolean(r.forfeit_on_ownership_change), maxKva: Number(r.max_kva),
    requiresTou: Boolean(r.requires_tou), requiresBidirectionalMeter: Boolean(r.requires_bidirectional_meter),
    locator: (r.locator ?? {}) as Record<string, string>,
  }
}

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

async function loadTariff(svc: AnyClient, id: string): Promise<{ row: Row; tariff: Tariff } | null> {
  const t = svc.schema('tariffs')
  const { data: row } = await t.from('tariff').select('*').eq('id', id).maybeSingle()
  if (!row) return null
  const { data: charges } = await t.from('charge').select('*').eq('tariff_id', id)
  return { row: row as Row, tariff: tariffFromRows(row as Row, (charges ?? []) as Row[]) }
}

export async function resolveStudyTariff(svc: AnyClient, projectId: string, opts: { year?: number; build?: BuildBillCalculator } = {}): Promise<StudyTariff> {
  const year = opts.year ?? DEFAULT_REFERENCE_YEAR
  const { data: study, error } = await svc.schema('solar').from('studies').select('tariff_id, nmd_kva').eq('project_id', projectId).maybeSingle()
  if (error) {
    if (isMissingTariffColumn(error)) return { ok: false, reason: TARIFF_REASONS.notPinned }
    console.error('[solar-tariff] study read failed', { projectId, code: error.code })
    return { ok: false, reason: TARIFF_REASONS.unreadable }
  }
  const tariffId = (study as Row | null)?.tariff_id as string | null | undefined
  if (!tariffId) return { ok: false, reason: TARIFF_REASONS.notPinned }

  const t = svc.schema('tariffs')
  const main = await loadTariff(svc, tariffId)
  if (!main) return { ok: false, reason: TARIFF_REASONS.unreadable }
  const { data: y } = await t.from('tariff_year').select('id, licensee_id, financial_year, state').eq('id', main.row.tariff_year_id as string).maybeSingle()
  if (!y) return { ok: false, reason: TARIFF_REASONS.unreadable }
  if ((y as Row).state !== 'published') return { ok: false, reason: TARIFF_REASONS.notPublished }
  const licenseeId = (y as Row).licensee_id as string
  const { data: lic } = await t.from('licensee').select('name').eq('id', licenseeId).maybeSingle()

  const { data: cals } = await t.from('tou_calendar').select('id, valid_from, valid_to, high_season_months, source').eq('licensee_id', licenseeId)
  const cal = ((cals ?? []) as Row[])
    .filter((c) => String(c.valid_from) <= `${year}-12-31` && (c.valid_to === null || c.valid_to === undefined || String(c.valid_to) >= `${year}-01-01`))
    .sort((a, b) => String(b.valid_from).localeCompare(String(a.valid_from)))[0]
  if (!cal) return { ok: false, reason: TARIFF_REASONS.noCalendar }
  const [{ data: windows }, { data: rule }, { data: sseg }] = await Promise.all([
    t.from('tou_window').select('season, day_type, start_minute, end_minute, period').eq('calendar_id', cal.id as string),
    t.from('holiday_rule').select('treated_as').eq('calendar_id', cal.id as string).maybeSingle(),
    t.from('sseg_rule').select('*').eq('tariff_year_id', (y as Row).id as string).maybeSingle(),
  ])
  const calendar = calendarFromRows(cal, (windows ?? []) as Row[], (rule as Row | null) ?? null)
  const holidays = referenceYearHolidays(year)
  const exportTariff = main.row.export_tariff_id ? (await loadTariff(svc, main.row.export_tariff_id as string))?.tariff ?? null : null
  const nmd = (study as Row).nmd_kva
  const build: BuildBillCalculator = opts.build ?? tariffBillCalculator
  const calc = build(main.tariff, {
    calendar, referenceYear: year, holidays,
    sseg: sseg ? ssegFromRow(sseg as Row) : null, exportTariff,
    powerFactor: SOLAR_ENGINE_DEFAULTS.load.powerFactor,
    ...(nmd !== null && nmd !== undefined ? { demandForMonth: () => ({ nmdKva: Number(nmd) }) } : {}),
  })
  return {
    ok: true, calc, calendar, holidays, year,
    tariffRef: { tariffId, tariffName: main.tariff.name, financialYear: String((y as Row).financial_year), licenseeName: String((lic as Row | null)?.name ?? '') },
  }
}
