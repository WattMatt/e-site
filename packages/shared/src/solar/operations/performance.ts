/**
 * The monthly performance table (spec §10): expected (guarantee), actual, variance %, PR,
 * irradiation-corrected expected, downtime hours — one shared implementation for the page AND the
 * report (WM kept two copies, M13). Year to date is a real sum of months (WM printed the month
 * twice, M4).
 */
import type { OpsBaseline } from './baseline'
import { expectedForMonth, TMY_DAYS, type Guarantee } from './guarantee'
import { expectedKwhBetween } from './shape'
import { daysInMonth, monthEndMs, monthParts, monthStartMs, type MonthKey } from './time'

/**
 * One meter's month from solar_ops_monthly_kwh. `minutes` is the time its kept readings SPAN (sum
 * of each reading's interval) and is the coverage figure: a month re-imported at a second interval
 * holds readings of both, so n x intervalMin (the smallest) understates it (review round 2).
 */
export interface MonthActual { kwh: number; n: number; minutes: number; intervalMin: number }
export type MeterMonths = Record<string, Record<MonthKey, MonthActual>>
export interface MonthTotal { kwh: number; coverageMinutes: number }

export interface DowntimeRecord {
  id: string
  startsAt: string
  endsAt: string
  cause: string
  description: string | null
  excludedFromGuarantee: boolean
  source: 'manual' | 'detected'
}
export interface IrradiationRecord { month: MonthKey; plane: 'ghi' | 'poa'; kwhPerM2: number; sourceNote: string }

export interface PerformanceRow {
  month: MonthKey
  operatingYear: number
  expectedKwh: number
  excludedKwh: number
  guaranteeKwh: number
  actualKwh: number | null
  varianceKwh: number | null
  variancePct: number | null
  performanceRatio: number | null
  correctedExpectedKwh: number | null
  irradiationPlane: 'ghi' | 'poa' | null
  downtimeHours: number
  excludedHours: number
  coveragePct: number | null
}

export interface PerformanceInput {
  months: MonthKey[]
  baseline: OpsBaseline
  guarantee: Guarantee
  commissioningDate: string
  /** As-built DC kWp (PR denominator). */
  dcKwp: number
  actual: Record<MonthKey, MonthTotal>
  generationMeterCount: number
  downtime: DowntimeRecord[]
  irradiation: IrradiationRecord[]
}

const r3 = (x: number) => Math.round(x * 1000) / 1000
const r2 = (x: number) => Math.round(x * 100) / 100

export function totalsByMonth(m: MeterMonths): Record<MonthKey, MonthTotal> {
  const out: Record<MonthKey, MonthTotal> = {}
  for (const months of Object.values(m)) {
    for (const [k, v] of Object.entries(months)) {
      const t = (out[k] ??= { kwh: 0, coverageMinutes: 0 })
      t.kwh = r3(t.kwh + Number(v.kwh))
      t.coverageMinutes += Number(v.minutes)
    }
  }
  return out
}

const overlapMs = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))

export function downtimeHoursInMonth(rows: readonly DowntimeRecord[], month: MonthKey): { total: number; excluded: number } {
  const m0 = monthStartMs(month)
  const m1 = monthEndMs(month)
  let total = 0
  let excluded = 0
  for (const d of rows) {
    const h = overlapMs(Date.parse(d.startsAt), Date.parse(d.endsAt), m0, m1) / 3_600_000
    total += h
    if (d.excludedFromGuarantee) excluded += h
  }
  return { total: r2(total), excluded: r2(excluded) }
}

export function performanceRow(i: PerformanceInput, month: MonthKey): PerformanceRow | null {
  const exp = expectedForMonth({ month, guarantee: i.guarantee, baseline: i.baseline, commissioningDate: i.commissioningDate })
  if (!exp) return null
  const fullFor = (k: MonthKey) => expectedForMonth({ month: k, guarantee: i.guarantee, baseline: i.baseline, commissioningDate: i.commissioningDate })?.fullKwh ?? 0
  const m0 = monthStartMs(month)
  const m1 = monthEndMs(month)
  let excludedKwh = 0
  for (const d of i.downtime) {
    if (!d.excludedFromGuarantee) continue
    const s = Math.max(Date.parse(d.startsAt), m0)
    const e = Math.min(Date.parse(d.endsAt), m1)
    if (e > s) excludedKwh += expectedKwhBetween(i.baseline, fullFor, s, e)
  }
  const guaranteeKwh = Math.max(0, exp.kwh - excludedKwh)
  const a = i.actual[month]
  const actualKwh = a ? a.kwh : null
  const varianceKwh = actualKwh === null ? null : actualKwh - guaranteeKwh
  const variancePct = varianceKwh === null || guaranteeKwh <= 0 ? null : (varianceKwh / guaranteeKwh) * 100
  const irr = i.irradiation.find((r) => r.month === month) ?? null
  const { year, month: m } = monthParts(month)
  let performanceRatio: number | null = null
  let correctedExpectedKwh: number | null = null
  if (irr?.plane === 'poa') {
    // The month's irradiation is prorated by the same active fraction as the expectation, so a plant
    // commissioned mid-month is not measured against sun that fell before it ran (review B6).
    performanceRatio = actualKwh !== null && i.dcKwp > 0 && exp.activeFraction > 0
      ? actualKwh / (i.dcKwp * irr.kwhPerM2 * exp.activeFraction) : null
    correctedExpectedKwh = i.baseline.performanceRatio * i.dcKwp * irr.kwhPerM2 * exp.activeFraction
  } else if (irr?.plane === 'ghi' && i.baseline.ghiKwhM2) {
    const modelled = (i.baseline.ghiKwhM2[m - 1]! * daysInMonth(year, m)) / TMY_DAYS[m - 1]!
    correctedExpectedKwh = modelled > 0 ? guaranteeKwh * (irr.kwhPerM2 / modelled) : null
  }
  const hours = downtimeHoursInMonth(i.downtime, month)
  const possible = daysInMonth(year, m) * 1440 * exp.activeFraction * Math.max(1, i.generationMeterCount)
  return {
    month, operatingYear: exp.operatingYear,
    expectedKwh: r3(exp.kwh), excludedKwh: r3(excludedKwh), guaranteeKwh: r3(guaranteeKwh),
    actualKwh: actualKwh === null ? null : r3(actualKwh),
    varianceKwh: varianceKwh === null ? null : r3(varianceKwh),
    variancePct: variancePct === null ? null : r2(variancePct),
    performanceRatio: performanceRatio === null ? null : Math.round(performanceRatio * 10_000) / 10_000,
    correctedExpectedKwh: correctedExpectedKwh === null ? null : r3(correctedExpectedKwh),
    irradiationPlane: irr?.plane ?? null,
    downtimeHours: hours.total, excludedHours: hours.excluded,
    coveragePct: a ? r2(Math.min(100, (a.coverageMinutes / possible) * 100)) : null,
  }
}

export function performanceRows(i: PerformanceInput): PerformanceRow[] {
  return i.months.map((k) => performanceRow(i, k)).filter((r): r is PerformanceRow => r !== null)
}

export interface YearToDate {
  year: number
  fromMonth: MonthKey
  toMonth: MonthKey
  guaranteeKwh: number
  actualKwh: number
  varianceKwh: number
  variancePct: number | null
  monthsWithoutData: number
}

export function yearToDate(rows: readonly PerformanceRow[], month: MonthKey): YearToDate {
  const { year } = monthParts(month)
  const inYear = rows.filter((r) => r.month.startsWith(`${year}-`) && r.month <= month)
  const guaranteeKwh = inYear.reduce((s, r) => s + r.guaranteeKwh, 0)
  const actualKwh = inYear.reduce((s, r) => s + (r.actualKwh ?? 0), 0)
  const varianceKwh = actualKwh - guaranteeKwh
  return {
    year, fromMonth: inYear[0]?.month ?? month, toMonth: month,
    guaranteeKwh: r3(guaranteeKwh), actualKwh: r3(actualKwh), varianceKwh: r3(varianceKwh),
    variancePct: guaranteeKwh > 0 ? r2((varianceKwh / guaranteeKwh) * 100) : null,
    monthsWithoutData: inYear.filter((r) => r.actualKwh === null).length,
  }
}

export interface SourceRow {
  meterId: string
  label: string
  sharePct: number
  expectedKwh: number
  actualKwh: number | null
  allocatedEqually: boolean
}

export function sourceRows(
  meters: ReadonlyArray<{ meterId: string; label: string; sharePct: number | null }>,
  meterMonths: MeterMonths,
  month: MonthKey,
  guaranteeKwh: number,
): SourceRow[] {
  // Meters without a share split what the set shares leave (floor 0) equally; with none set, that is
  // an equal split of 100 % (review B4: they used to get 0 once any meter had a share).
  const set = meters.reduce((s, m) => s + (m.sharePct ?? 0), 0)
  const unset = meters.filter((m) => m.sharePct === null).length
  const each = unset > 0 ? Math.max(0, 100 - set) / unset : 0
  return meters.map((m) => {
    const share = m.sharePct ?? each
    const a = meterMonths[m.meterId]?.[month]
    return {
      meterId: m.meterId, label: m.label, sharePct: r2(share),
      expectedKwh: r3((guaranteeKwh * share) / 100),
      actualKwh: a ? r3(Number(a.kwh)) : null,
      allocatedEqually: m.sharePct === null,
    }
  })
}

/** A sentence when the generation meters' expected shares (after the remainder split) do not add to 100 %. */
export function shareTotalNote(meters: ReadonlyArray<{ sharePct: number | null }>): string | null {
  if (meters.length === 0) return null
  const set = meters.reduce((s, m) => s + (m.sharePct ?? 0), 0)
  const unset = meters.some((m) => m.sharePct === null)
  const total = unset ? Math.max(100, set) : set
  return Math.abs(total - 100) < 0.005 ? null : `The expected shares of the generation meters add to ${r2(total)} %, not 100 %.`
}
