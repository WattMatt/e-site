/**
 * The stored 8760 hourly file of a run (solar-runs bucket, gzip). It is also the input of Run
 * financials: the pv-only import/export columns let the bill engine split the battery's saving
 * without re-simulating (functional spec §8: "pure computation on stored energy results").
 */
import type { CaseResult } from '../../services/solar/case'
import { GEOMETRY_YEAR, HOURS_PER_YEAR } from '../../services/solar/time'

export const HOURLY_CSV_HEADER = [
  'hour', 'start_sast', 'load_kw', 'pv_ac_kw', 'self_use_kw', 'import_kw', 'export_kw', 'curtail_kw',
  'battery_soc_kwh', 'import_pv_only_kw', 'export_pv_only_kw',
] as const

export interface HourlySeries {
  load: Float64Array; pvAc: Float64Array; selfUse: Float64Array; import: Float64Array; export: Float64Array
  curtail: Float64Array; soc: Float64Array; importPvOnly: Float64Array; exportPvOnly: Float64Array
}
const KEYS: Array<keyof HourlySeries> = ['load', 'pvAc', 'selfUse', 'import', 'export', 'curtail', 'soc', 'importPvOnly', 'exportPvOnly']

export function hourlyFromResult(r: CaseResult): HourlySeries {
  const b = r.balance
  const selfUse = Float64Array.from(b.direct, (v, h) => v + b.dischargeFromPv[h]!)
  return {
    load: b.load, pvAc: b.pv, selfUse, import: b.import, export: b.export, curtail: b.curtail, soc: b.soc,
    importPvOnly: r.balancePvOnly.import, exportPvOnly: r.balancePvOnly.export,
  }
}

export function sastStart(h: number): string {
  const d = new Date(Date.UTC(GEOMETRY_YEAR, 0, 1, 0) + h * 3_600_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:00+02:00`
}
const fmt = (v: number) => (Math.abs(v) < 5e-5 ? 0 : v).toFixed(4)

export function encodeHourlyCsv(s: HourlySeries): string {
  const out: string[] = [HOURLY_CSV_HEADER.join(',')]
  for (let h = 0; h < HOURS_PER_YEAR; h++) out.push([String(h), sastStart(h), ...KEYS.map((k) => fmt(s[k][h]!))].join(','))
  return out.join('\n') + '\n'
}

export function decodeHourlyCsv(text: string): HourlySeries {
  const lines = text.trimEnd().split('\n')
  if (lines[0] !== HOURLY_CSV_HEADER.join(',')) throw new Error('hourly CSV header does not match')
  if (lines.length !== HOURS_PER_YEAR + 1) throw new Error('hourly CSV must have 8760 rows')
  const s = Object.fromEntries(KEYS.map((k) => [k, new Float64Array(HOURS_PER_YEAR)])) as unknown as HourlySeries
  for (let h = 0; h < HOURS_PER_YEAR; h++) {
    const cells = lines[h + 1]!.split(',')
    KEYS.forEach((k, i) => {
      const v = Number(cells[i + 2])
      if (!Number.isFinite(v)) throw new Error(`hourly CSV row ${h} column ${k} is not a number`)
      s[k][h] = v
    })
  }
  return s
}

export interface HourlySliceRow { hour: number; startSast: string; loadKw: number; pvAcKw: number; importKw: number; exportKw: number; socKwh: number }

/** Whole days [fromDay, toDay] (0-based, inclusive) for the zoomed annual chart. */
export function sliceHourlyDays(s: HourlySeries, fromDay: number, toDay: number): HourlySliceRow[] {
  const rows: HourlySliceRow[] = []
  for (let h = fromDay * 24; h < (toDay + 1) * 24 && h < HOURS_PER_YEAR; h++) {
    rows.push({ hour: h, startSast: sastStart(h), loadKw: s.load[h]!, pvAcKw: s.pvAc[h]!, importKw: s.import[h]!, exportKw: s.export[h]!, socKwh: s.soc[h]! })
  }
  return rows
}
