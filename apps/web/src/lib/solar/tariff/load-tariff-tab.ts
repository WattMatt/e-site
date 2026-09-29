import 'server-only'
/**
 * Everything the Tariff tab renders (spec §5), read through the caller's
 * session: the study, its licensee (studies.licensee_id, else the Site &
 * Supply name matched through tariffs.licensee_alias), the published years,
 * the selected year's tariffs, the pinned tariff and its charges, the
 * override, export rates, the TOU calendar, the escalation path, bill checks.
 * Plain queries only (no cross-schema PostgREST embeds).
 */
import {
  buildEscalationRows, escalationSettingsFrom, overrideChargeFromDb, parseExportRule, parseStoredEscalation,
  noteForYear, pickDefaultYear, readSolarOrgSettings, regimeForLicenseeKind, netBillingRule,
  type EscalationRow, type ExportRule, type LicenseeKind, type OverrideChargeRow, type SsegRule, type SupplyFacts,
  type TariffListItem, type TariffYearOption, type TouCalendar, type ExportRateRow,
} from '@esite/shared'
import { normaliseAlias } from '@esite/shared/tariffs/ingest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadStudyCalendar } from './calendar-loader'
import {
  billCheckFromRow, exportRateFromRow, isTouTariff, pinnedChargeFromRow, tariffListItemFromRow, yearOptionFromRow,
  type BillCheckRow, type PinnedCharge,
} from './rows'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

export interface PinnedTariff {
  id: string
  name: string
  code: string | null
  structure: string
  isTou: boolean
  yearId: string
  financialYear: string
  yearState: string
  charges: PinnedCharge[]
  exportTariff: { id: string; name: string; charges: PinnedCharge[] } | null
  /** The licensee's SSEG rule for the year, else the Net-Billing Rules default (flagged). */
  sseg: SsegRule
  ssegFromLibrary: boolean
  /** A newer published year exists for this licensee (the pinned one is superseded). */
  newerYear: string | null
}

export interface TariffTabData {
  projectId: string
  study: {
    id: string
    updatedAt: string
    licenseeName: string | null
    tariffId: string | null
    tariffOverrideId: string | null
    exportRule: ExportRule | null
  } | null
  supply: SupplyFacts
  licensee: { id: string; name: string; kind: LicenseeKind } | null
  licenseeOptions: Array<{ id: string; name: string }>
  years: TariffYearOption[]
  selectedYearId: string | null
  yearNote: string | null
  tariffs: TariffListItem[]
  pinned: PinnedTariff | null
  override: { id: string; rows: OverrideChargeRow[] } | null
  exportRates: Array<ExportRateRow & { id: string }>
  exportSourceNote: string | null
  calendar: TouCalendar | null
  calendarAssumedEskom: boolean
  calendarFromEskomFallback: boolean
  /** Public holidays this calendar year (projects.public_holidays, 00194). */
  holidays: Array<{ date: string; name: string }>
  escalation: EscalationRow[]
  analysisYears: number
  billChecks: BillCheckRow[]
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))

async function chargesWithTitles(supabase: AnyClient, tariffId: string): Promise<PinnedCharge[]> {
  const t = supabase.schema('tariffs')
  const { data } = await t.from('charge').select('*').eq('tariff_id', tariffId)
  const rows = (data ?? []) as Row[]
  const docIds = [...new Set(rows.map((r) => r.source_document_id).filter((x): x is string => typeof x === 'string'))]
  const titles = new Map<string, string>()
  if (docIds.length) {
    const { data: docs } = await t.from('source_document').select('id, title').in('id', docIds)
    for (const d of (docs ?? []) as Array<{ id: string; title: string }>) titles.set(d.id, d.title)
  }
  return rows.map((r) => pinnedChargeFromRow(r, titles))
    .sort((a, b) => [a.component, a.season, a.tou, a.blockMin ?? -1].join('|').localeCompare([b.component, b.season, b.tou, b.blockMin ?? -1].join('|')))
}

/** The note is read from the money rows (this loader runs only at Edit + financials); see 00218. */
function withMoneyNote(rule: ReturnType<typeof parseExportRule>, rateRows: Row[]): ReturnType<typeof parseExportRule> {
  if (!rule) return null
  return { ...rule, sourceNote: rule.method === 'manual' ? ((rateRows[0]?.source_note as string | undefined) ?? null) : null }
}

export async function loadTariffTab(supabase: AnyClient, projectId: string, opts: { fy: string | null; todayIso: string }): Promise<TariffTabData> {
  const solar = supabase.schema('solar')
  const tariffs = supabase.schema('tariffs')
  const { data: s } = await solar.from('studies')
    .select('id, organisation_id, updated_at, licensee_name, licensee_id, nmd_kva, supply_voltage_v, tariff_id, tariff_override_id, export_rule, escalation')
    .eq('project_id', projectId).maybeSingle()
  const st = s as Row | null
  const empty: TariffTabData = {
    projectId, study: null, supply: { nmdKva: null, supplyVoltageV: null }, licensee: null, licenseeOptions: [], years: [],
    selectedYearId: null, yearNote: null, tariffs: [], pinned: null, override: null, exportRates: [], exportSourceNote: null,
    calendar: null, calendarAssumedEskom: false, calendarFromEskomFallback: false, holidays: [], escalation: [], analysisYears: 25, billChecks: [],
  }
  if (!st) return empty

  // Licensee: pinned, else the Site & Supply name through the alias table, else the exact name.
  let licenseeId = (st.licensee_id ?? null) as string | null
  const name = typeof st.licensee_name === 'string' ? st.licensee_name.trim() : ''
  if (!licenseeId && name) {
    const { data: a } = await tariffs.from('licensee_alias').select('licensee_id').eq('alias', normaliseAlias(name)).limit(1)
    licenseeId = (((a ?? []) as Row[])[0]?.licensee_id as string | undefined) ?? null
    if (!licenseeId) {
      const { data: l } = await tariffs.from('licensee').select('id').eq('name', name).limit(1)
      licenseeId = (((l ?? []) as Row[])[0]?.id as string | undefined) ?? null
    }
  }
  let licensee: TariffTabData['licensee'] = null
  let licenseeOptions: TariffTabData['licenseeOptions'] = []
  if (licenseeId) {
    const { data: l } = await tariffs.from('licensee').select('id, name, kind').eq('id', licenseeId).maybeSingle()
    licensee = l ? { id: String((l as Row).id), name: String((l as Row).name), kind: (l as Row).kind as LicenseeKind } : null
  }
  if (!licensee) {
    const { data: ls } = await tariffs.from('licensee').select('id, name').order('name')
    licenseeOptions = ((ls ?? []) as Array<{ id: string; name: string }>).map((x) => ({ id: String(x.id), name: String(x.name) }))
  }

  // Years (published + superseded only: drafts are admin-only by RLS anyway).
  const { data: ys } = licensee
    ? await tariffs.from('tariff_year').select('id, financial_year, state, effective_from, effective_to, approved_increase_pct')
        .eq('licensee_id', licensee.id).in('state', ['published', 'superseded']).order('financial_year', { ascending: false })
    : { data: [] as Row[] }
  const years = ((ys ?? []) as Row[]).map(yearOptionFromRow).sort((a, b) => b.financialYear.localeCompare(a.financialYear))
  const regime = regimeForLicenseeKind(licensee?.kind ?? 'municipal')

  // Pinned tariff.
  let pinned: PinnedTariff | null = null
  const tariffId = (st.tariff_id ?? null) as string | null
  if (tariffId) {
    const { data: tr } = await tariffs.from('tariff').select('*').eq('id', tariffId).maybeSingle()
    const trow = tr as Row | null
    if (trow) {
      const { data: yr } = await tariffs.from('tariff_year').select('id, financial_year, state, licensee_id').eq('id', String(trow.tariff_year_id)).maybeSingle()
      const yrow = (yr ?? {}) as Row
      const charges = await chargesWithTitles(supabase, tariffId)
      let exportTariff: PinnedTariff['exportTariff'] = null
      if (trow.export_tariff_id) {
        const { data: et } = await tariffs.from('tariff').select('id, name').eq('id', String(trow.export_tariff_id)).maybeSingle()
        if (et) exportTariff = { id: String((et as Row).id), name: String((et as Row).name), charges: await chargesWithTitles(supabase, String((et as Row).id)) }
      }
      const { data: rule } = await tariffs.from('sseg_rule').select('*').eq('tariff_year_id', String(trow.tariff_year_id)).maybeSingle()
      const r = rule as Row | null
      const sseg: SsegRule = r
        ? {
            crediting: r.crediting as SsegRule['crediting'], carryForward: r.carry_forward as SsegRule['carryForward'],
            fyEndMonth: Number(r.fy_end_month), capRule: r.cap_rule as SsegRule['capRule'], offsets: 'energy_only',
            forfeitOnOwnershipChange: Boolean(r.forfeit_on_ownership_change), maxKva: Number(r.max_kva),
            requiresTou: Boolean(r.requires_tou), requiresBidirectionalMeter: Boolean(r.requires_bidirectional_meter),
            locator: (r.locator ?? {}) as Record<string, string>,
          }
        : netBillingRule(regime)
      const newer = years.find((y) => y.state === 'published' && y.financialYear > String(yrow.financial_year ?? ''))
      pinned = {
        id: tariffId, name: String(trow.name), code: (trow.code ?? null) as string | null, structure: String(trow.structure),
        isTou: isTouTariff(String(trow.structure), charges), yearId: String(trow.tariff_year_id),
        financialYear: String(yrow.financial_year ?? ''), yearState: String(yrow.state ?? ''), charges, exportTariff,
        sseg, ssegFromLibrary: Boolean(r), newerYear: newer?.financialYear ?? null,
      }
    }
  }

  // Selected year: ?fy=, else the pinned tariff's year, else the year covering today.
  const fromFy = opts.fy ? years.find((y) => y.financialYear === opts.fy) : undefined
  const pinnedYearId = pinned?.yearId
  const fromPin = pinnedYearId ? years.find((y) => y.id === pinnedYearId) : undefined
  const def = pickDefaultYear(years, opts.todayIso, regime)
  const selectedYearId = fromFy?.id ?? fromPin?.id ?? def.yearId
  const { data: ts } = selectedYearId
    ? await tariffs.from('tariff').select('id, code, name, category, metering, structure, voltage_band, phase, min_kva, max_kva, min_amps, max_amps, is_legacy, export_tariff_id')
        .eq('tariff_year_id', selectedYearId).order('name')
    : { data: [] as Row[] }

  // Override, export rates, bill checks (money tables: this page is Edit + financials).
  const overrideId = (st.tariff_override_id ?? null) as string | null
  const [ov, rates, checks, settingsRow] = await Promise.all([
    overrideId ? solar.from('tariff_override_charges').select('*').eq('override_id', overrideId).order('component') : Promise.resolve({ data: [] as Row[] }),
    solar.from('study_export_rates').select('*').eq('study_id', String(st.id)),
    solar.from('bill_checks').select('id, billing_month, actual_total_excl_vat, modelled_total_excl_vat, difference_pct, created_at')
      .eq('study_id', String(st.id)).order('billing_month', { ascending: false }).limit(12),
    solar.from('org_settings').select('settings').eq('organisation_id', String(st.organisation_id)).maybeSingle(),
  ])
  const rateRows = (rates.data ?? []) as Row[]

  const cal = await loadStudyCalendar(supabase, licensee?.id ?? null, opts.todayIso)
  const year = opts.todayIso.slice(0, 4)
  const { data: hol } = await supabase.schema('projects').from('public_holidays').select('d, name').gte('d', `${year}-01-01`).order('d')
  const holidays = ((hol ?? []) as Array<{ d: string; name: string }>)
    .filter((h) => h.d <= `${year}-12-31`).map((h) => ({ date: h.d, name: h.name }))
  const settings = escalationSettingsFrom(readSolarOrgSettings((settingsRow.data as { settings?: unknown } | null)?.settings ?? null))
  const escalation = buildEscalationRows({
    pinnedFinancialYear: pinned?.financialYear || null,
    published: years.map((y) => ({ financialYear: y.financialYear, approvedIncreasePct: y.approvedIncreasePct })),
    settings, stored: parseStoredEscalation(st.escalation),
  })

  return {
    projectId,
    study: {
      id: String(st.id), updatedAt: String(st.updated_at), licenseeName: name || null, tariffId,
      tariffOverrideId: overrideId, exportRule: withMoneyNote(parseExportRule(st.export_rule), rateRows),
    },
    supply: { nmdKva: num(st.nmd_kva), supplyVoltageV: num(st.supply_voltage_v) },
    licensee, licenseeOptions, years, selectedYearId,
    yearNote: noteForYear(years, selectedYearId, opts.todayIso, regime),
    tariffs: ((ts ?? []) as Row[]).map(tariffListItemFromRow),
    pinned,
    override: overrideId ? { id: overrideId, rows: ((ov.data ?? []) as Row[]).map(overrideChargeFromDb) } : null,
    exportRates: rateRows.map(exportRateFromRow),
    exportSourceNote: (rateRows[0]?.source_note as string | undefined) ?? null,
    calendar: cal.calendar, calendarAssumedEskom: cal.assumedEskom, calendarFromEskomFallback: cal.fromEskomFallback,
    holidays, escalation, analysisYears: settings.analysisYears,
    billChecks: ((checks.data ?? []) as Row[]).map(billCheckFromRow),
  }
}
