/**
 * One model for both exports (xlsx keeps numbers, PDF formats them), so the two files cannot
 * disagree. Built only from the composed view: nothing is recomputed here.
 */
import type { LoadProfileView } from './view-types'

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
type Cell = string | number | null
export interface Table { title: string; header: string[]; rows: Cell[][] }

export interface ExportModel {
  title: string
  subtitle: string
  kpis: Array<[string, Cell, string]>
  notes: string[]
  monthly: Table
  cost: Table | null
  costLines: Table | null
  averageDays: Table
  ldc: Table
  sources: Table
  hourly: Table | null
}

const r = (v: number, dp = 2) => Math.round(v * 10 ** dp) / 10 ** dp
const BASIS: Record<string, string> = {
  measured_md: 'measured maximum demand',
  measured_md_plus_synthetic: 'measured maximum demand plus the synthetic peak (non-coincident)',
  design_peak: 'hourly design peak / power factor (no interval data)',
}

export function buildExportModel(v: LoadProfileView, generatedAt: Date): ExportModel {
  const a = v.analysis
  if (!a) throw new Error('No load profile to export: add a meter file or a synthetic block first.')
  const year = v.settings.referenceYear
  const kpis: ExportModel['kpis'] = [
    ['Annual energy', r(a.kpis.annualKwh, 0), 'kWh'],
    ['Peak (hourly average)', r(a.kpis.peakKw, 1), `kW at ${a.kpis.peakAt}`],
    ['Load factor', r(a.kpis.loadFactor * 100, 1), '%'],
    ['Day share (06:00-18:00)', r(a.kpis.dayPct, 1), '%'],
    ['Measured energy', r(a.composition.measuredKwh, 0), 'kWh'],
    ['Synthetic energy', r(a.composition.syntheticKwh, 0), 'kWh'],
  ]
  if (a.md) {
    if (a.md.basis === 'sum_of_meter_peaks') kpis.push(["Sum of each meter's own peak", r(a.md.peak.kva, 1), 'kVA (the meters never ran together; an upper bound, not a measured coincident demand)'])
    else kpis.push([a.md.basis === 'largest_single_meter' ? 'Maximum demand (largest single meter)' : 'Maximum demand (interval)', r(a.md.peak.kva, 1), `kVA at ${a.md.peak.at} (${a.md.intervalMin}-min data)`])
  }
  kpis.push(['Suggested NMD', a.nmd.kva, `kVA (basis ${r(a.nmd.basisKva, 1)} kVA, ${BASIS[a.nmd.basis]})`])
  if (v.cost?.ok) {
    kpis.push(['Annual cost excl VAT', r(v.cost.annual.totalExclVat), `R (${v.cost.label})`])
    kpis.push(['Annual cost incl VAT', r(v.cost.annual.totalInclVat), 'R'])
  }

  const notes = [
    `Reference year ${year}: every source is aligned to ${year}'s weekdays and public holidays (29 February dropped), power factor ${v.settings.powerFactor}.`,
    `NMD rule: ${a.nmd.rule}.`,
    ...(v.compositionNote ? [v.compositionNote] : []),
    a.md ? `Maximum demand comes from the measured interval data (${a.md.basis.replace(/_/g, ' ')}); the hourly profile peak is never used as maximum demand.` : 'No measured interval data: there is no measured maximum demand.',
  ]
  if (v.cost?.ok) {
    notes.push(v.cost.demandNote)
    notes.push(`NMD used for costing: ${v.cost.nmdKva} kVA${v.cost.nmdIsSuggestion ? ' (not confirmed: the highest demand itself is used)' : ' (confirmed)'}.`)
    if (v.cost.calendarNote) notes.push(v.cost.calendarNote)
    if (v.cost.calendarAssumedEskom) notes.push('This licensee publishes no time-of-use hours; Eskom\'s hours are assumed.')
    for (const n of v.cost.notModelled) notes.push(`Not modelled: ${n.component} (${n.reason}).`)
  } else if (v.cost && !v.cost.ok) notes.push(`Tariff: ${v.cost.error}`)

  const mdByMonth = new Map<number, { kva: number; at: string | null }>()
  for (const m of a.md?.months ?? []) {
    const k = Number(m.month.slice(5, 7))
    const cur = mdByMonth.get(k)
    if (!cur || m.kva > cur.kva) mdByMonth.set(k, { kva: m.kva, at: m.at })
  }
  const monthly: Table = {
    title: 'Monthly energy and demand',
    header: ['Month', 'Energy kWh', 'Max demand kVA', 'At', ...(v.cost?.ok ? [...(v.cost.touSplit ? ['Peak kWh', 'Standard kWh', 'Off-peak kWh'] : []), 'Cost excl VAT R', 'Cost incl VAT R'] : [])],
    rows: MONTHS.map((name, i) => {
      const md = mdByMonth.get(i + 1)
      const c = v.cost?.ok ? v.cost.months[i] : null
      return [name, r(a.monthlyKwh[i], 0), md ? r(md.kva, 1) : null, md?.at ?? null,
        ...(c ? [...(v.cost?.ok && v.cost.touSplit ? [r(c.tou.peak, 0), r(c.tou.standard, 0), r(c.tou.off_peak, 0)] : []), r(c.totalExclVat), r(c.totalInclVat)] : [])]
    }),
  }
  if (v.cost?.ok) {
    const c = v.cost
    monthly.rows.push(['Year', r(a.kpis.annualKwh, 0), a.md ? r(a.md.peak.kva, 1) : null, a.md?.peak.at ?? null,
      ...(c.touSplit ? [r(c.annual.tou.peak, 0), r(c.annual.tou.standard, 0), r(c.annual.tou.off_peak, 0)] : []), r(c.annual.totalExclVat), r(c.annual.totalInclVat)])
  } else monthly.rows.push(['Year', r(a.kpis.annualKwh, 0), a.md ? r(a.md.peak.kva, 1) : null, a.md?.peak.at ?? null])

  const okCost = v.cost?.ok && v.cost.touSplit ? v.cost : null
  const cost: Table | null = okCost ? {
    title: `Annual cost: ${okCost.label}`,
    header: ['Period', 'kWh', 'Share %'],
    rows: (['peak', 'standard', 'off_peak'] as const).map((p) => [p.replace('_', '-'), r(okCost.annual.tou[p], 0), r(okCost.annual.kwh ? (okCost.annual.tou[p] / okCost.annual.kwh) * 100 : 0, 1)]),
  } : null
  const costLines: Table | null = v.cost?.ok ? {
    title: 'Bill lines by month (excl VAT)',
    header: ['Month', 'Charge', 'Quantity', 'Unit', 'Rate', 'Rate unit', 'Amount R'],
    rows: v.cost.months.flatMap((m) => m.lines.map((l) => [MONTHS[m.month - 1], l.label, r(l.quantity, 2), l.quantityUnit, r(l.rate, 4), l.rateUnit, r(l.amount)])),
  } : null

  const averageDays: Table = {
    title: 'Average day (kW)',
    header: ['Hour', 'Weekday', 'Saturday', 'Sunday', 'Weekday Jun-Aug', 'Weekday other months'],
    rows: Array.from({ length: 24 }, (_, h) => [`${String(h).padStart(2, '0')}:00`, r(a.dayTypeProfiles.weekday[h]), r(a.dayTypeProfiles.saturday[h]), r(a.dayTypeProfiles.sunday[h]), r(a.seasonal.high[h]), r(a.seasonal.low[h])]),
  }
  const ldc: Table = { title: 'Load duration curve', header: ['% of hours exceeded', 'kW'], rows: a.ldc.map((p) => [p.pct, r(p.kw)]) }
  const sources: Table = {
    title: 'Sources and data quality',
    header: ['Source', 'Kind', 'Role', 'Added to profile', 'Included', 'File', 'Format', 'Column', 'Interval min', 'Conversion', 'Coverage %', 'Gaps', 'Longest gap min', 'Spikes', 'Negatives', 'Duplicates', 'Hours filled', 'Annual kWh', 'Status'],
    rows: v.sources.map((s) => [
      s.label, s.kind, s.role, s.counted ? 'yes' : 'no', s.included ? 'yes' : 'no', s.fileName, s.format, s.column ?? s.detail, s.intervalMin, s.conversion,
      s.quality ? r(s.quality.coveragePct, 1) : null, s.quality?.gapRuns ?? null, s.quality?.longestGapMin ?? null, s.quality?.spikes ?? null,
      s.quality?.negatives ?? null, s.quality ? s.quality.exactDuplicates + s.quality.conflictingDuplicates : null,
      s.filled ? s.filled.gapShort + s.filled.gapDayType + s.filled.ownShape : null, s.annualKwh == null ? null : r(s.annualKwh, 0),
      s.status === 'ok' ? 'ok' : s.error,
    ]),
  }
  const hourly: Table | null = a.hourly ? {
    title: `Hourly profile ${year} (kW, hour starting)`,
    header: ['Date', 'Hour', 'kW'],
    rows: a.hourly.map((kw, i) => [a.heatmap.dates[Math.floor(i / 24)], `${String(i % 24).padStart(2, '0')}:00`, kw]),
  } : null

  return {
    title: 'Load profile',
    subtitle: `${v.projectName} · reference year ${year} · generated ${generatedAt.toISOString().slice(0, 10)}`,
    kpis, notes, monthly, cost, costLines, averageDays, ldc, sources, hourly,
  }
}
