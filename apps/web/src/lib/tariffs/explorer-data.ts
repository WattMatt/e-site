import 'server-only'
/**
 * Tariff explorer reads (E7). Everything goes through the CALLER's session:
 * 00228 lets every active org member read the published library, and keeps
 * drafts admin-only, so RLS — not this file — decides what a caller sees.
 * A failed read logs the table and code (never the message) and returns a
 * state the page turns into a sentence.
 */
import { tariffFromRows } from '@esite/shared/tariffs/ingest'
import {
  calendarFromRows, normaliseTariffName, pickCalendar, previousFinancialYear,
  type ExplorerCharge, type HolidayTreatmentRow, type LicenseeSearchItem, type MapLicensee, type Tariff, type TouCalendar,
} from '@esite/shared'
import type { AnyClient } from './admin-gate'

type Row = Record<string, unknown>
export class ExplorerReadError extends Error {}

function fail(table: string, error: { code?: string } | null): never {
  console.error('[tariff-explorer] read failed', { table, code: error?.code ?? 'unknown' })
  throw new ExplorerReadError(table)
}

const VISIBLE = ['published', 'superseded'] as const

export interface YearRow { id: string; licenseeId: string; financialYear: string; state: string; effectiveFrom: string; effectiveTo: string; approvedIncreasePct: number | null; publishedAt: string | null }
const yearFromRow = (r: Row): YearRow => ({
  id: String(r.id), licenseeId: String(r.licensee_id), financialYear: String(r.financial_year), state: String(r.state),
  effectiveFrom: String(r.effective_from), effectiveTo: String(r.effective_to),
  approvedIncreasePct: r.approved_increase_pct === null || r.approved_increase_pct === undefined ? null : Number(r.approved_increase_pct),
  publishedAt: (r.published_at ?? null) as string | null,
})

export interface LicenseeIndexItem extends LicenseeSearchItem { mdbCode: string | null; hasAnyYear: boolean }

/** Every licensee with its aliases and the latest published year the caller can see. */
export async function loadLicenseeIndex(supabase: AnyClient): Promise<LicenseeIndexItem[]> {
  const t = supabase.schema('tariffs')
  const [lic, ali, yrs] = await Promise.all([
    t.from('licensee').select('id, name, kind, province, mdb_code').order('name'),
    t.from('licensee_alias').select('alias, licensee_id'),
    t.from('tariff_year').select('licensee_id, financial_year, state'),
  ])
  if (lic.error) fail('licensee', lic.error)
  if (ali.error) fail('licensee_alias', ali.error)
  if (yrs.error) fail('tariff_year', yrs.error)
  const aliases = new Map<string, string[]>()
  for (const a of (ali.data ?? []) as Row[]) {
    const k = String(a.licensee_id)
    aliases.set(k, [...(aliases.get(k) ?? []), String(a.alias)])
  }
  const live = new Map<string, string>()
  const any = new Set<string>()
  for (const y of (yrs.data ?? []) as Row[]) {
    const k = String(y.licensee_id)
    any.add(k)
    if (y.state === 'published' && (live.get(k) ?? '') < String(y.financial_year)) live.set(k, String(y.financial_year))
  }
  return ((lic.data ?? []) as Row[]).map((l) => ({
    id: String(l.id), name: String(l.name), kind: String(l.kind), province: (l.province ?? null) as string | null,
    aliases: aliases.get(String(l.id)) ?? [], liveFy: live.get(String(l.id)) ?? null,
    mdbCode: (l.mdb_code ?? null) as string | null, hasAnyYear: any.has(String(l.id)),
  }))
}

export function mapLicensees(index: readonly LicenseeIndexItem[]): MapLicensee[] {
  return index.map((l) => ({ id: l.id, name: l.name, kind: String(l.kind), mdbCode: l.mdbCode, liveFy: l.liveFy, hasAnyYear: l.hasAnyYear }))
}

export interface LicenseeRow { id: string; name: string; kind: string; province: string | null; nersaLicenceNo: string | null; mdbCode: string | null }

export async function loadLicenseeWithYears(supabase: AnyClient, licenseeId: string): Promise<{ licensee: LicenseeRow; years: YearRow[] } | null> {
  const t = supabase.schema('tariffs')
  const [lic, yrs] = await Promise.all([
    t.from('licensee').select('id, name, kind, province, nersa_licence_no, mdb_code').eq('id', licenseeId).maybeSingle(),
    t.from('tariff_year').select('id, licensee_id, financial_year, state, effective_from, effective_to, approved_increase_pct, published_at')
      .eq('licensee_id', licenseeId).in('state', VISIBLE as unknown as string[]).order('financial_year', { ascending: false }),
  ])
  if (lic.error) fail('licensee', lic.error)
  if (yrs.error) fail('tariff_year', yrs.error)
  const l = lic.data as Row | null
  if (!l) return null
  return {
    licensee: { id: String(l.id), name: String(l.name), kind: String(l.kind), province: (l.province ?? null) as string | null,
      nersaLicenceNo: (l.nersa_licence_no ?? null) as string | null, mdbCode: (l.mdb_code ?? null) as string | null },
    years: ((yrs.data ?? []) as Row[]).map(yearFromRow),
  }
}

export interface TariffListRow { id: string; name: string; code: string | null; family: string | null; category: string; structure: string; metering: string; isLegacy: boolean }

export async function loadYearTariffList(supabase: AnyClient, yearId: string): Promise<TariffListRow[]> {
  const { data, error } = await supabase.schema('tariffs').from('tariff')
    .select('id, name, code, family, category, structure, metering, is_legacy').eq('tariff_year_id', yearId).order('name')
  if (error) fail('tariff', error)
  return ((data ?? []) as Row[]).map((r) => ({
    id: String(r.id), name: String(r.name), code: (r.code ?? null) as string | null, family: (r.family ?? null) as string | null,
    category: String(r.category), structure: String(r.structure), metering: String(r.metering), isLegacy: Boolean(r.is_legacy),
  }))
}

export interface CalendarPick {
  calendar: TouCalendar
  calendarId: string
  /** The licensee has no calendar of its own; Eskom's hours are shown. */
  fromEskomFallback: boolean
  holidays: HolidayTreatmentRow[]
}

async function calendarFor(supabase: AnyClient, licenseeId: string, onIso: string): Promise<{ id: string; calendar: TouCalendar } | null> {
  const t = supabase.schema('tariffs')
  const { data, error } = await t.from('tou_calendar').select('id, valid_from, valid_to, high_season_months, source').eq('licensee_id', licenseeId)
  if (error) fail('tou_calendar', error)
  const rows = ((data ?? []) as Row[]).map((r) => ({ id: String(r.id), validFrom: String(r.valid_from), validTo: (r.valid_to ?? null) as string | null, row: r }))
  const pick = pickCalendar(rows, onIso)
  if (!pick) return null
  const [ws, hr] = await Promise.all([
    t.from('tou_window').select('season, day_type, start_minute, end_minute, period').eq('calendar_id', pick.id),
    t.from('holiday_rule').select('treated_as').eq('calendar_id', pick.id).maybeSingle(),
  ])
  if (ws.error) fail('tou_window', ws.error)
  if (hr.error) fail('holiday_rule', hr.error)
  const holiday = ((hr.data as { treated_as?: 'saturday' | 'sunday' } | null)?.treated_as) ?? null
  const windows = ((ws.data ?? []) as Row[]).map((w) => ({
    season: w.season as 'high' | 'low', dayType: w.day_type as 'weekday' | 'saturday' | 'sunday',
    startMinute: Number(w.start_minute), endMinute: Number(w.end_minute), period: w.period as 'peak' | 'standard' | 'off_peak',
  }))
  return {
    id: pick.id,
    calendar: calendarFromRows({
      id: pick.id, licenseeId, validFrom: pick.validFrom, validTo: pick.validTo,
      highSeasonMonths: (pick.row.high_season_months as number[]) ?? [], source: pick.row.source as 'published' | 'assumed_eskom', holidayTreatedAs: holiday,
    }, windows),
  }
}

/** The licensee's own calendar valid on the date, else Eskom's (labelled as assumed). */
export async function loadCalendarPick(supabase: AnyClient, licenseeId: string, onIso: string): Promise<CalendarPick | null> {
  let own = await calendarFor(supabase, licenseeId, onIso)
  let fromEskomFallback = false
  if (!own) {
    const { data, error } = await supabase.schema('tariffs').from('licensee').select('id').eq('name', 'Eskom').eq('kind', 'eskom').limit(1)
    if (error) fail('licensee', error)
    const eskomId = ((data ?? []) as Row[])[0]?.id as string | undefined
    if (eskomId && eskomId !== licenseeId) {
      own = await calendarFor(supabase, eskomId, onIso)
      fromEskomFallback = own !== null
    }
  }
  if (!own) return null
  const { data, error } = await supabase.schema('tariffs').from('holiday_treatment')
    .select('tariff_family, holiday_date, holiday_name, treated_as').eq('calendar_id', own.id)
  if (error) fail('holiday_treatment', error)
  const holidays = ((data ?? []) as Row[]).map((h) => ({
    tariffFamily: String(h.tariff_family), holidayDate: String(h.holiday_date), holidayName: String(h.holiday_name),
    treatedAs: h.treated_as as HolidayTreatmentRow['treatedAs'],
  }))
  return {
    calendar: fromEskomFallback ? { ...own.calendar, source: 'assumed_eskom' } : own.calendar,
    calendarId: own.id, fromEskomFallback, holidays,
  }
}

export interface TariffDetail {
  id: string
  row: Row
  tariff: Tariff
  charges: ExplorerCharge[]
  year: YearRow
  licensee: LicenseeRow
  previous: { financialYear: string; tariff: Tariff } | null
  calendar: CalendarPick | null
}

async function chargesOf(supabase: AnyClient, tariffId: string): Promise<Row[]> {
  const { data, error } = await supabase.schema('tariffs').from('charge').select('*').eq('tariff_id', tariffId)
  if (error) fail('charge', error)
  return (data ?? []) as Row[]
}

export async function loadTariffDetail(supabase: AnyClient, licenseeId: string, tariffId: string): Promise<TariffDetail | null> {
  const t = supabase.schema('tariffs')
  const { data: tr, error } = await t.from('tariff').select('*').eq('id', tariffId).maybeSingle()
  if (error) fail('tariff', error)
  const row = tr as Row | null
  if (!row) return null
  const { data: yr, error: ye } = await t.from('tariff_year')
    .select('id, licensee_id, financial_year, state, effective_from, effective_to, approved_increase_pct, published_at').eq('id', String(row.tariff_year_id)).maybeSingle()
  if (ye) fail('tariff_year', ye)
  if (!yr || String((yr as Row).licensee_id) !== licenseeId) return null
  const year = yearFromRow(yr as Row)
  const lw = await loadLicenseeWithYears(supabase, licenseeId)
  if (!lw) return null

  const chargeRows = await chargesOf(supabase, tariffId)
  const docIds = [...new Set(chargeRows.map((c) => c.source_document_id).filter(Boolean) as string[])]
  const titles = new Map<string, string>()
  if (docIds.length) {
    const { data: docs, error: de } = await t.from('source_document').select('id, title').in('id', docIds)
    if (de) fail('source_document', de)
    for (const d of (docs ?? []) as Row[]) titles.set(String(d.id), String(d.title))
  }
  const tariff = tariffFromRows(row, chargeRows)
  const charges: ExplorerCharge[] = chargeRows.map((c, i) => ({
    id: String(c.id), charge: tariff.charges[i],
    sourceDocumentId: (c.source_document_id ?? null) as string | null,
    sourceTitle: c.source_document_id ? titles.get(String(c.source_document_id)) ?? null : null,
  }))

  // Last year's tariff of the same (normalised) name, if the caller can see that year.
  let previous: TariffDetail['previous'] = null
  const prevFy = previousFinancialYear(year.financialYear)
  const prevYear = lw.years.find((y) => y.financialYear === prevFy)
  if (prevYear) {
    const { data: cands, error: ce } = await t.from('tariff').select('*').eq('tariff_year_id', prevYear.id)
    if (ce) fail('tariff', ce)
    const match = ((cands ?? []) as Row[]).find((c) => normaliseTariffName(String(c.name)) === normaliseTariffName(tariff.name))
    if (match) previous = { financialYear: prevFy, tariff: tariffFromRows(match, await chargesOf(supabase, String(match.id))) }
  }

  const isTou = tariff.structure === 'tou' || tariff.structure === 'tou_ibt' || tariff.charges.some((c) => c.tou !== 'all')
  const calendar = isTou ? await loadCalendarPick(supabase, licenseeId, year.effectiveFrom) : null
  return { id: tariffId, row, tariff, charges, year, licensee: lw.licensee, previous, calendar }
}

/** Up to four published tariffs for the comparison, each with its season months. */
export async function loadCompareTariffs(supabase: AnyClient, ids: readonly string[]) {
  const out: Array<{ id: string; label: string; licenseeId: string; financialYear: string; tariff: Tariff; highSeasonMonths: number[]; seasonsAssumed: boolean }> = []
  for (const id of ids.slice(0, 4)) {
    const { data: tr, error } = await supabase.schema('tariffs').from('tariff').select('*').eq('id', id).maybeSingle()
    if (error) fail('tariff', error)
    if (!tr) continue
    const { data: yr, error: ye } = await supabase.schema('tariffs').from('tariff_year')
      .select('licensee_id, financial_year, effective_from, licensee:licensee_id(name)').eq('id', String((tr as Row).tariff_year_id)).maybeSingle()
    if (ye) fail('tariff_year', ye)
    if (!yr) continue
    const y = yr as unknown as { licensee_id: string; financial_year: string; effective_from: string; licensee: { name: string } | null }
    const cal = await loadCalendarPick(supabase, y.licensee_id, y.effective_from)
    const tariff = tariffFromRows(tr as Row, await chargesOf(supabase, id))
    out.push({
      id, label: `${y.licensee?.name ?? 'Unknown'} · ${tariff.name} (${y.financial_year})`, licenseeId: y.licensee_id, financialYear: y.financial_year,
      tariff, highSeasonMonths: cal?.calendar.highSeasonMonths ?? [6, 7, 8], seasonsAssumed: !cal,
    })
  }
  return out
}
