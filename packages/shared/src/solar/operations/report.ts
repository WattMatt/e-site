/**
 * The monthly client report (spec §10). The SNAPSHOT is built once at Generate and stored
 * (solar.monthly_reports) — the PDF is rendered from it, and regenerating a month writes v(n+1),
 * never edits v(n) (WM M1/M2). Commentary is copied in at generation; editing a note later never
 * changes a stored figure. Content fixed against WM's defects: real YTD (M4), equipment from the
 * installation record (M4), every source listed (M5), realised consumption from the council/bulk
 * meter (M10), lost revenue at the pinned tariff's TOU rates or nothing at all (M11/G13).
 */
import { fixed, zar } from '../reports/fmt'
import type { ReportSection, ReportTable } from '../reports/report-model'
import type { AsBuilt } from './as-built'
import type { OpsBaseline } from './baseline'
import { GUARANTEE_BASIS_LABELS, type Guarantee, type GuaranteeBasis } from './guarantee'
import type { PerformanceRow, SourceRow, YearToDate } from './performance'
import { monthLabel, type MonthKey } from './time'

export const NOTE_SECTIONS = ['summary', 'performance', 'downtime', 'financial', 'actions'] as const
export type NoteSection = (typeof NOTE_SECTIONS)[number]
export const NOTE_SECTION_LABELS: Record<NoteSection, string> = {
  summary: 'Summary commentary', performance: 'Performance commentary', downtime: 'Downtime commentary',
  financial: 'Financial commentary', actions: 'Actions',
}
export const CAUSE_LABELS: Record<string, string> = {
  grid_outage: 'Grid outage', inverter_fault: 'Inverter fault', planned_maintenance: 'Planned maintenance',
  unplanned_maintenance: 'Unplanned maintenance', curtailment: 'Curtailment', communications: 'Communications',
  weather_damage: 'Weather damage', other: 'Other',
}
export const MONTHLY_SNAPSHOT_VERSION = 1 as const

export interface MonthlyDowntimeInput {
  startsAt: string; endsAt: string; cause: string; description: string | null
  excludedFromGuarantee: boolean; source: 'manual' | 'detected'; lostKwh: number; lostZar: number | null
}
export interface MonthlyDowntimeLine extends MonthlyDowntimeInput { hours: number; causeLabel: string }

export interface MonthlySnapshot {
  version: typeof MONTHLY_SNAPSHOT_VERSION
  period: MonthKey
  periodLabel: string
  generatedAt: string
  project: { name: string }
  installation: { commissioningDate: string; asBuilt: AsBuilt; baselineRunId: string; baselineInputsHash: string; designPr: number }
  guarantee: { basis: GuaranteeBasis; basisLabel: string; pct: number | null; degradationPctPerYear: number }
  performance: PerformanceRow
  sources: SourceRow[]
  downtime: MonthlyDowntimeLine[]
  lost: { kwh: number; zar: number | null }
  tariff: { name: string } | null
  ytd: YearToDate
  consumption: { gridKwh: number | null; meterLabels: string[]; solarSharePct: number | null }
  notes: Record<NoteSection, string>
}

export interface BuildMonthlyInput {
  period: MonthKey
  generatedAt: string
  projectName: string
  commissioningDate: string
  asBuilt: AsBuilt
  baseline: OpsBaseline
  guarantee: Guarantee
  performance: PerformanceRow
  sources: SourceRow[]
  downtime: MonthlyDowntimeInput[]
  lostZarTotal: number | null
  tariff: { name: string } | null
  ytd: YearToDate
  consumption: { gridKwh: number | null; meterLabels: string[] }
  notes: Partial<Record<NoteSection, string>>
}

const r2 = (x: number) => Math.round(x * 100) / 100

export function buildMonthlySnapshot(i: BuildMonthlyInput): MonthlySnapshot {
  const downtime = i.downtime.map((d) => ({
    ...d,
    hours: r2((Date.parse(d.endsAt) - Date.parse(d.startsAt)) / 3_600_000),
    causeLabel: CAUSE_LABELS[d.cause] ?? d.cause,
    lostKwh: r2(d.lostKwh),
    lostZar: i.tariff && d.lostZar !== null ? r2(d.lostZar) : null,
  }))
  const actual = i.performance.actualKwh
  const grid = i.consumption.gridKwh
  return {
    version: MONTHLY_SNAPSHOT_VERSION,
    period: i.period,
    periodLabel: monthLabel(i.period),
    generatedAt: i.generatedAt,
    project: { name: i.projectName },
    installation: {
      commissioningDate: i.commissioningDate, asBuilt: i.asBuilt,
      baselineRunId: i.baseline.caseRunId, baselineInputsHash: i.baseline.inputsHash, designPr: i.baseline.performanceRatio,
    },
    guarantee: { basis: i.guarantee.basis, basisLabel: GUARANTEE_BASIS_LABELS[i.guarantee.basis], pct: i.guarantee.pct, degradationPctPerYear: i.guarantee.degradationPctPerYear },
    performance: i.performance,
    sources: i.sources,
    downtime,
    lost: { kwh: r2(downtime.reduce((s, d) => s + d.lostKwh, 0)), zar: i.tariff && i.lostZarTotal !== null ? r2(i.lostZarTotal) : null },
    tariff: i.tariff,
    ytd: i.ytd,
    consumption: {
      gridKwh: grid,
      meterLabels: i.consumption.meterLabels,
      solarSharePct: grid !== null && actual !== null && actual + grid > 0 ? r2((actual / (actual + grid)) * 100) : null,
    },
    notes: Object.fromEntries(NOTE_SECTIONS.map((k) => [k, (i.notes[k] ?? '').trim()])) as Record<NoteSection, string>,
  }
}

const kwh = (v: number | null) => (v === null ? 'no data' : fixed(v, 0))
const pctText = (v: number | null) => (v === null ? 'n/a' : `${v > 0 ? '+' : ''}${fixed(v, 1)} %`)
const table = (columns: string[], rows: string[][], numericFrom = 1): ReportTable => ({ columns, rows, numeric: columns.map((_, k) => k >= numericFrom) })
const sast = (iso: string) => new Date(Date.parse(iso) + 2 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ')
const KIND_LABEL: Record<string, string> = { module: 'Module', inverter: 'Inverter', battery: 'Battery', other: 'Other' }

export function monthlyReportModel(s: MonthlySnapshot): { title: string; kicker: string; sections: ReportSection[]; summary: Record<string, number | string> } {
  const p = s.performance
  const sections: ReportSection[] = []
  const para = (t: string) => (t ? [t] : [])

  sections.push({
    title: 'Performance summary',
    paragraphs: [
      `${s.periodLabel}: ${kwh(p.actualKwh)} kWh generated against a guarantee of ${kwh(p.guaranteeKwh)} kWh (${pctText(p.variancePct)}).`,
      ...para(s.notes.summary),
    ],
    tables: [table(['Metric', 'Value'], [
      [`Expected (${s.guarantee.basisLabel})`, `${kwh(p.expectedKwh)} kWh`],
      ['Expected lost to downtime excluded from the guarantee', `${kwh(p.excludedKwh)} kWh`],
      ['Guarantee for the month', `${kwh(p.guaranteeKwh)} kWh`],
      ['Actual generation', p.actualKwh === null ? 'no data' : `${kwh(p.actualKwh)} kWh`],
      ['Variance', pctText(p.variancePct)],
      ['Performance ratio', p.performanceRatio === null ? 'needs plane-of-array irradiation' : fixed(p.performanceRatio, 3)],
      ['Irradiation-corrected expected', p.correctedExpectedKwh === null ? 'no irradiation recorded' : `${kwh(p.correctedExpectedKwh)} kWh (${p.irradiationPlane === 'poa' ? 'plane of array' : 'horizontal'})`],
      ['Downtime', `${fixed(p.downtimeHours, 1)} h (${fixed(p.excludedHours, 1)} h excluded)`],
      ['Data coverage', p.coveragePct === null ? 'no data' : `${fixed(p.coveragePct, 1)} %`],
    ])],
  })

  sections.push({
    title: 'Expected vs actual per source',
    paragraphs: s.sources.some((x) => x.allocatedEqually) ? ['The guarantee is allocated equally between the generation meters (no share has been set).'] : [],
    tables: [table(['Source', 'Share', 'Expected kWh', 'Actual kWh', 'Variance'], s.sources.map((x) => [
      x.label, `${fixed(x.sharePct, 1)} %`, kwh(x.expectedKwh), kwh(x.actualKwh),
      x.actualKwh === null || x.expectedKwh <= 0 ? 'n/a' : pctText(((x.actualKwh - x.expectedKwh) / x.expectedKwh) * 100),
    ]))],
  })

  sections.push({
    title: 'Year to date',
    paragraphs: s.ytd.monthsWithoutData > 0 ? [`${s.ytd.monthsWithoutData} month(s) in this period have no generation data and count as zero.`] : [],
    tables: [table(['Period', 'Guarantee kWh', 'Actual kWh', 'Variance'], [[
      `${monthLabel(s.ytd.fromMonth)} to ${monthLabel(s.ytd.toMonth)}`, kwh(s.ytd.guaranteeKwh), kwh(s.ytd.actualKwh), pctText(s.ytd.variancePct),
    ]])],
  })

  const money = s.tariff !== null
  sections.push({
    title: 'Downtime',
    paragraphs: [
      s.downtime.length === 0 ? 'No downtime was recorded this month.' : `${s.downtime.length} downtime event(s); ${fixed(s.lost.kwh, 1)} kWh of expected generation lost.`,
      money
        ? `Lost revenue is the energy cost of the lost kWh at ${s.tariff!.name} time-of-use rates, excl. VAT.`
        : 'Lost revenue is not shown: no tariff is pinned for this study.',
      ...para(s.notes.downtime),
    ],
    tables: s.downtime.length === 0 ? [] : [table(
      ['Start (SAST)', 'End (SAST)', 'Hours', 'Cause', 'Excluded', 'Lost kWh', ...(money ? ['Lost revenue'] : [])],
      [
        ...s.downtime.map((d) => [sast(d.startsAt), sast(d.endsAt), fixed(d.hours, 2), d.description ? `${d.causeLabel}: ${d.description}` : d.causeLabel,
          d.excludedFromGuarantee ? 'Yes' : 'No', fixed(d.lostKwh, 1), ...(money ? [d.lostZar === null ? 'n/a' : zar(d.lostZar)] : [])]),
        ['Total', '', fixed(s.downtime.reduce((t, d) => t + d.hours, 0), 2), '', '', fixed(s.lost.kwh, 1), ...(money ? [s.lost.zar === null ? 'n/a' : zar(s.lost.zar)] : [])],
      ],
      2,
    )],
  })

  sections.push({
    title: 'Realised consumption',
    paragraphs: s.consumption.gridKwh === null
      ? ['No council or bulk meter is linked to this installation, so grid-supplied energy is not reported.']
      : [
          `Grid-supplied energy (${s.consumption.meterLabels.join(', ')}): ${kwh(s.consumption.gridKwh)} kWh.`,
          `Solar share of site energy: ${s.consumption.solarSharePct === null ? 'n/a' : `${fixed(s.consumption.solarSharePct, 1)} %`} (assumes no export).`,
        ],
    tables: [],
  })

  const a = s.installation.asBuilt
  sections.push({
    title: 'Installed equipment',
    paragraphs: [`${fixed(a.dcKwp, 1)} kWp DC / ${fixed(a.acKw, 1)} kW AC${a.batteryKwh !== null ? `, battery ${fixed(a.batteryKwh, 1)} kWh` : ''}; commissioned ${s.installation.commissioningDate}.`],
    tables: [table(['Kind', 'Make', 'Model', 'Rating', 'Quantity'], a.equipment.map((e) => [
      KIND_LABEL[e.kind] ?? e.kind, e.make, e.model, `${fixed(e.rating, e.rating % 1 === 0 ? 0 : 2)} ${e.unit}`, String(e.quantity),
    ]), 4)],
  })

  const commentary = [s.notes.performance, s.notes.financial, s.notes.actions].filter((t) => t.length > 0)
  sections.push({
    title: 'Commentary and actions',
    paragraphs: commentary.length ? [
      ...(s.notes.performance ? [`Performance: ${s.notes.performance}`] : []),
      ...(s.notes.financial ? [`Financial: ${s.notes.financial}`] : []),
      ...(s.notes.actions ? [`Actions: ${s.notes.actions}`] : []),
    ] : ['No commentary was recorded for this month.'],
    tables: [],
  })

  sections.push({
    title: 'Basis of figures',
    paragraphs: [
      `Guarantee basis: ${s.guarantee.basisLabel}${s.guarantee.pct !== null ? ` (${fixed(s.guarantee.pct, 1)} %)` : ''}; degradation ${fixed(s.guarantee.degradationPctPerYear, 2)} % a year from operating year 2.`,
      `Modelled from the accepted case run ${s.installation.baselineRunId} (inputs ${s.installation.baselineInputsHash.slice(0, 12)}), frozen when the installation was recorded.`,
      'Months are South African Standard Time calendar months; an interval belongs to the month in which it starts. Missing readings are data gaps, never downtime.',
    ],
    tables: [],
  })

  return {
    title: `Solar monthly report — ${s.periodLabel}`,
    kicker: 'SOLAR MONTHLY REPORT',
    sections,
    summary: { period: s.period, actualKwh: p.actualKwh ?? 0, guaranteeKwh: p.guaranteeKwh, variancePct: p.variancePct ?? 0 },
  }
}
