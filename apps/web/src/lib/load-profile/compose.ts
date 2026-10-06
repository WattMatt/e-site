/**
 * Rows in, view out — no I/O, so it is unit-tested directly. Each included source becomes an
 * 8 760-hour series (measured: the meter's own reference year; tenant schedule: the Solar S3
 * synthesis; ADMD: N × ADMD shaped by an archetype); the profile is their sum. MD comes from the
 * measured channels' native intervals only; costing goes through the shared engine.
 */
import {
  admdSeries, analyseProfile, costProfile, MIN_COINCIDENT_DAYS, fromStoredChannel, isCalendarIndependent, localLabel, mdByCalendarMonth, NEUTRAL_CALENDAR, measuredReferenceSeries, MeasuredSeriesError,
  NMD_RULE, profileComposition, sumSeries, tenantScheduleSeries, type ImportQuality, type LoadRole, type MeasuredInput, type TenantSynthInput,
} from '@esite/shared/load-profile'
import type { Reading } from '@esite/shared/meter-data'
import type { Tariff, TouCalendar } from '@esite/shared'
import type { AnalysisView, CostView, SourceKind, SourceView } from './view-types'

type ArchetypeCode = 'retail' | 'fast_food' | 'restaurant' | 'supermarket' | 'office_bank' | 'gym' | 'anchor_24h' | 'vacant'

export interface SourceRow {
  id: string
  kind: SourceKind
  label: string
  included: boolean
  file_name: string | null
  format: string | null
  source_column: string | null
  kva_column: string | null
  interval_min: number | null
  first_ts_end: string | null
  values: Array<number | null> | null
  quality: number[] | null
  kva_values: Array<number | null> | null
  conversion: string | null
  quality_report: ImportQuality | null
  params: Record<string, unknown> | null
  role: LoadRole
  solar_meter_id: string | null
}

/** A Solar library meter's readings, read through the caller's session (Solar RLS decides). */
export interface LibraryMeterData {
  label: string
  kind: string
  siteLabel: string | null
  intervalMin: number
  kw: Reading[]
  kva: Reading[] | null
}

export interface ComposeInput {
  referenceYear: number
  powerFactor: number
  nmdKva: number | null
  sources: SourceRow[]
  tenants: TenantSynthInput[]
  costing: { tariffId: string; tariff: Tariff; calendar: TouCalendar | null; calendarAssumedEskom: boolean; label: string } | { tariffId: string; error: string } | null
  includeHourly?: boolean
  /** Library meters referenced by `library_meter` sources, by solar meter id. */
  library?: ReadonlyMap<string, LibraryMeterData>
}

/** Seasonal / TOU tariffs need the supplier's TOU calendar (tariffs.tou_calendar); production held none on 2026-10-05. */
export const NO_CALENDAR = 'This supplier has no time-of-use calendar loaded yet, so a seasonal or time-of-use tariff cannot be costed. A tariff administrator adds it under Admin, Tariffs, Calendars.'

const round = (v: number, dp = 3) => Math.round(v * 10 ** dp) / 10 ** dp
const sum = (a: ArrayLike<number>) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s }
const max = (a: ArrayLike<number>) => { let m = 0; for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m }
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** Highest hourly kW per reference month (12 values). */
function monthlyPeaks(series: Float64Array): number[] {
  const out: number[] = []
  let h = 0
  for (const d of MONTH_DAYS) {
    let m = 0
    for (let i = 0; i < d * 24; i++, h++) if (series[h] > m) m = series[h]
    out.push(m)
  }
  return out
}

/**
 * The monthly MD handed to the bill. Measured interval MD where a month has it; a synthetic block's
 * own monthly peak is ADDED (non-coincident, the NMD rule's convention) so a mixed profile is not
 * billed as if the estimate drew nothing. A month with no measured MD is left to the engine, which
 * takes it from the hourly profile (measured + synthetic).
 */
function billedMonthlyMd(md: ReturnType<typeof analyseProfile>['md'], synthetic: Float64Array | null, pf: number): Array<number | null> | undefined {
  if (!md || md.months.length === 0) return undefined
  const measured = mdByCalendarMonth(md.months)
  if (!synthetic) return measured
  const synth = monthlyPeaks(synthetic)
  return measured.map((v, i) => (v == null ? null : v + synth[i] / pf))
}

function demandNote(md: ReturnType<typeof analyseProfile>['md'], hasSynthetic: boolean): string {
  const tail = 'Peak-window demand is taken from hourly averages (an approximation).'
  if (!md) return 'No measured interval data: demand is taken from hourly averages, which understate a billed maximum demand.'
  if (md.basis === 'sum_of_meter_peaks') return `The meters never ran together for ${MIN_COINCIDENT_DAYS} days, so monthly demand comes from the hourly profile; the NMD basis adds each meter's own peak. ${tail}`
  if (md.basis === 'largest_single_meter') return `The meters overlap only briefly: monthly demand comes from their coincident ${md.intervalMin}-minute data where they overlap and the hourly profile elsewhere; the NMD basis is the largest single meter's own peak. ${tail}`
  return `Maximum demand per month from ${md.intervalMin}-minute measured data${md.basis === 'coincident' ? ' (the meters\' coincident sum)' : ''}${hasSynthetic ? ', plus the estimated block\'s own monthly peak' : ''}. ${tail}`
}

function validQuality(q: unknown): ImportQuality | null {
  if (!q || typeof q !== 'object') return null
  const o = q as Record<string, unknown>
  const nums = ['slots', 'usable', 'coveragePct', 'gapRuns', 'longestGapMin', 'spikes', 'negatives', 'conflictingDuplicates', 'exactDuplicates']
  return nums.every((k) => typeof o[k] === 'number' && Number.isFinite(o[k])) && typeof o.first === 'string' && typeof o.last === 'string' ? (q as ImportQuality) : null
}

function blankSource(r: SourceRow): SourceView {
  return {
    id: r.id, kind: r.kind, label: r.label, included: r.included, status: 'ok', error: null,
    fileName: r.file_name, format: r.format, column: r.source_column, kvaColumn: r.kva_column, intervalMin: r.interval_min,
    conversion: r.conversion, quality: validQuality(r.quality_report), filled: null, window: null,
    params: r.params, detail: null, annualKwh: null, peakKw: null, role: r.role, counted: false,
  }
}

function storedReadings(r: SourceRow, values: Array<number | null>) {
  return fromStoredChannel({ firstTsEnd: Date.parse(r.first_ts_end as string), intervalMin: r.interval_min as number, values, quality: r.quality as number[] })
}

export function composeView(input: ComposeInput): { sources: SourceView[]; analysis: AnalysisView | null; cost: CostView | null; compositionNote: string | null } {
  const { referenceYear, powerFactor } = input
  type Built = { series: Float64Array; measured: MeasuredInput | null }
  const built: Array<Built | null> = []
  const measuredBuild = (v: SourceView, kw: Reading[], kva: Reading[] | null, intervalMin: number): Built => {
    const m = measuredReferenceSeries(kw, intervalMin, referenceYear)
    v.filled = { gapShort: m.gapShortFilled, gapDayType: m.gapDayTypeFilled, ownShape: m.ownShapeFilledHours }
    v.window = m.window
    v.annualKwh = sum(m.series)
    v.peakKw = max(m.series)
    return { series: m.series, measured: { kw, kva, intervalMin } }
  }
  const sources = input.sources.map((r, i) => {
    const v = blankSource(r)
    built[i] = null
    try {
      let b: Built
      if (r.kind === 'meter') {
        const kw = storedReadings(r, r.values ?? [])
        // A kVA value is only meaningful where the kW slot was usable; storedReadings marks the rest MISSING.
        const kva = r.kva_values ? storedReadings(r, r.kva_values.map((x, k) => (kw[k].value === null ? null : x))) : null
        b = measuredBuild(v, kw, kva, r.interval_min as number)
      } else if (r.kind === 'library_meter') {
        const lib = r.solar_meter_id ? input.library?.get(r.solar_meter_id) : undefined
        if (!lib) throw new Error('This Solar library meter could not be read (it was removed, or your organisation has no Solar library access).')
        if (lib.kw.length === 0) throw new Error('This Solar library meter has no readings.')
        v.detail = `${lib.siteLabel ?? 'Solar library'} · ${lib.kind} · ${lib.intervalMin} min`
        v.intervalMin = lib.intervalMin
        b = measuredBuild(v, lib.kw, lib.kva, lib.intervalMin)
      } else if (r.kind === 'tenant_schedule') {
        const t = tenantScheduleSeries(input.tenants, referenceYear, { commonAreaPct: num(r.params?.commonAreaPct, 0) })
        v.detail = `${t.lines.length} tenant${t.lines.length === 1 ? '' : 's'} synthesised${t.skipped.length ? `, ${t.skipped.length} without an area skipped` : ''}; common area +${num(r.params?.commonAreaPct, 0)} %`
        v.annualKwh = sum(t.series)
        v.peakKw = max(t.series)
        if (t.lines.length === 0) throw new Error('No tenant in the schedule has a shop area')
        b = { series: t.series, measured: null }
      } else {
        const p = { units: num(r.params?.units, 0), admdKva: num(r.params?.admdKva, 0), archetype: (r.params?.archetype as ArchetypeCode) ?? 'retail' }
        const s = admdSeries({ ...p, powerFactor }, referenceYear)
        v.detail = `${p.units} × ${p.admdKva} kVA ADMD, ${p.archetype.replace('_', ' ')} shape`
        v.annualKwh = sum(s)
        v.peakKw = max(s)
        b = { series: s, measured: null }
      }
      if (r.included) built[i] = b
    } catch (e) {
      v.status = 'error'
      v.error = e instanceof MeasuredSeriesError || e instanceof RangeError || e instanceof Error ? e.message : 'This source could not be built'
    }
    return v
  })

  // Roles decide what is added up: Σ bulk (else Σ tenant) + Σ addition; check / solar / generator are shown only.
  const okIdx = built.flatMap((b, i) => (b ? [i] : []))
  const comp = profileComposition(okIdx.map((i) => input.sources[i].role))
  const summed = comp.sum.map((k) => okIdx[k])
  for (const i of summed) sources[i].counted = true
  const measuredSeries = summed.flatMap((i) => (built[i]!.measured ? [built[i]!.series] : []))
  const measured = summed.flatMap((i) => (built[i]!.measured ? [built[i]!.measured!] : []))
  const syntheticSeries = summed.flatMap((i) => (built[i]!.measured ? [] : [built[i]!.series]))
  const compositionNote = okIdx.length ? comp.note : null

  const parts = [...measuredSeries, ...syntheticSeries]
  if (parts.length === 0) return { sources, analysis: null, cost: null, compositionNote }
  const profile = sumSeries(parts)
  const synthetic = syntheticSeries.length ? sumSeries(syntheticSeries) : null
  const a = analyseProfile({ series: profile, referenceYear, powerFactor, measured, syntheticPeakKw: synthetic ? max(synthetic) : 0 })
  const analysis: AnalysisView = {
    kpis: a.kpis,
    monthlyKwh: a.monthlyKwh,
    dayTypeProfiles: a.dayTypeProfiles,
    seasonal: a.seasonal,
    avgDayByMonth: a.avgDayByMonth,
    annual: a.annual,
    ldc: a.ldc,
    heatmap: { dates: a.heatmap.dates, cells: a.heatmap.cells.map((row) => row.map((x) => round(x, 2))) },
    md: a.md ? {
      months: a.md.months.map((m) => ({ month: m.month, kva: m.kva, kw: m.source === 'measured_kva' ? null : m.kva * (m.powerFactor ?? 1), at: m.tsEnd === null ? null : localLabel(m.tsEnd), source: m.source })),
      peak: a.md.peak,
      intervalMin: a.md.intervalMin,
      basis: a.md.basis,
    } : null,
    nmd: { ...a.nmd, rule: NMD_RULE.text },
    composition: { measuredKwh: measuredSeries.length ? sum(sumSeries(measuredSeries)) : 0, syntheticKwh: synthetic ? sum(synthetic) : 0 },
    ...(input.includeHourly ? { hourly: Array.from(profile, (x) => round(x, 4)) } : {}),
  }

  let cost: CostView | null = null
  if (input.costing && 'error' in input.costing) cost = { ok: false, tariffId: input.costing.tariffId, error: input.costing.error }
  else if (input.costing) {
    const c = input.costing
    const neutral = !c.calendar && isCalendarIndependent(c.tariff)
    const calendar = c.calendar ?? (neutral ? NEUTRAL_CALENDAR : null)
    if (!calendar) cost = { ok: false, tariffId: c.tariffId, error: NO_CALENDAR }
    else {
      // Unconfirmed NMD: cost on the highest demand itself, NOT the suggestion — the engine bills
      // actual-MD charges at max(MD, NMD), so the suggestion's headroom would inflate every month.
      const nmdKva = input.nmdKva ?? Math.ceil(a.nmd.basisKva * 100) / 100
      try {
        const r = costProfile({ tariff: c.tariff, calendar, series: profile, referenceYear, powerFactor, mdKvaByMonth: billedMonthlyMd(a.md, synthetic, powerFactor), nmdKva })
        cost = {
          ok: true,
          tariffId: c.tariffId,
          label: c.label,
          calendarAssumedEskom: !neutral && c.calendarAssumedEskom,
          touSplit: !neutral,
          calendarNote: neutral ? 'This tariff has no seasonal or time-of-use rates, so no calendar is needed; the energy is not split by period.' : null,
          nmdKva,
          nmdIsSuggestion: input.nmdKva == null,
          months: r.months.map((m) => ({
            month: m.month, tou: m.tou, kwh: m.kwh, mdKva: m.mdKva,
            totalExclVat: m.bill.totalExclVat, vat: m.bill.vat, totalInclVat: m.bill.totalInclVat,
            lines: m.bill.lines.map((l) => ({ label: l.label, quantity: l.quantity, quantityUnit: l.quantityUnit, rate: l.rate, rateUnit: String(l.rateUnit), amount: l.amount })),
          })),
          annual: r.annual,
          notModelled: r.notModelled,
          demandNote: demandNote(a.md, Boolean(synthetic)) + (input.nmdKva == null ? ` With no notified maximum demand confirmed, every month's demand is billed at no less than ${nmdKva} kVA (the highest demand), as a supply notified at its peak would be.` : ''),
        }
      } catch (e) {
        cost = { ok: false, tariffId: c.tariffId, error: e instanceof Error ? e.message : 'The tariff could not be costed' }
      }
    }
  }
  return { sources, analysis, cost, compositionNote }
}
