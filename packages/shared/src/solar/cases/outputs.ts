/**
 * CaseResult → the stored outputs document of a run (functional spec §7.3). Every KPI anywhere in the
 * module comes from this document; the browser only formats it.
 */
import type { CaseInput, CaseResult } from '../../services/solar/case'
import type { TouPeriod } from '../../services/solar/energy/energy-balance'
import { acFactor, combinedDcLoss } from '../../services/solar/pv/losses'
import { GEOMETRY_YEAR, HOURS_PER_YEAR, monthHourRanges } from '../../services/solar/time'
import { monthlyTouSplit, type TouSplit } from './tou-periods'

export const RUN_OUTPUTS_VERSION = 1 as const
export const DAY_TYPES = ['all', 'weekday', 'saturday', 'sunday'] as const
export type DayType = (typeof DAY_TYPES)[number]

/**
 * Where a run's TOU hours came from. `assumed_eskom`: the supply authority publishes no hours, so
 * Eskom's stand in (the Tariff tab's notice). `datedHolidays`: holidays of the reference year billed
 * per the tariff family's dated treatment (tariffs.holiday_treatment); the rest follow the calendar.
 */
export interface TouHoursRef { source: 'published' | 'assumed_eskom'; calendarLicenseeName: string; validFrom: string; datedHolidays: number }
/** `touHours` is absent on runs made before it was recorded. */
export interface TariffRef { tariffId: string; tariffName: string; financialYear: string; licenseeName: string; touHours?: TouHoursRef }

export interface RunKpis {
  dcKwp: number; acKw: number
  specificYieldKwhPerKwp: number; performanceRatio: number
  annualAcKwh: number; pvAcKwh: number; deliveredKwh: number; selfConsumedKwh: number
  exportKwh: number; curtailedKwh: number; loadKwh: number; importBeforeKwh: number; importAfterKwh: number
  solarFraction: number; selfConsumption: number
  peakDemandBeforeKw: number; peakDemandAfterKw: number; peakDemandBasis: 'hourly'
  batteryKwh: number | null; batteryKw: number | null
}
export interface MonthlyRow {
  month: number; pvKwh: number; loadKwh: number; importBeforeKwh: number; importKwh: number; exportKwh: number
  maxDemandBeforeKw: number; maxDemandAfterKw: number
  touImportBefore: TouSplit | null; touImportAfter: TouSplit | null
}
export interface TypicalDay { month: number; dayType: DayType; pv: number[]; load: number[]; import: number[]; export: number[]; batteryNet: number[] }
export interface DailyRow { day: number; pvKwh: number; loadKwh: number; importKwh: number; exportKwh: number }
export interface WaterfallStep { key: string; label: string; kwh: number; kind: 'start' | 'loss' | 'subtotal' | 'end' }
export interface RunCheck { id: 'dc_ac_ratio' | 'export_limit' | 'string_voltage' | 'transformer_loading' | 'gsa_sanity'; label: string; status: 'pass' | 'warn' | 'fail' | 'n/a'; detail: string }
export interface RunProvenance {
  engineVersion: string; inputsHash: string; weatherDatasetId: string; weatherSource: string
  weatherFetchedAt: string | null; gsaPvoutKwhPerKwp: number | null; tariffRef: TariffRef | null
  loadBasis: string; loadReferenceYear: number
}
export interface CaseRunOutputs {
  version: typeof RUN_OUTPUTS_VERSION
  kpis: RunKpis; monthly: MonthlyRow[]; typicalDays: TypicalDay[]; daily: DailyRow[]
  waterfall: WaterfallStep[]; checks: RunCheck[]; provenance: RunProvenance
}
export interface OutputsMeta {
  weatherFetchedAt: string | null; gsaPvoutKwhPerKwp: number | null; tariffRef: TariffRef | null
  touPeriods: readonly TouPeriod[] | null; nmdKva: number | null; loadBasis: string; loadReferenceYear: number
}

const r3 = (x: number) => Math.round(x * 1000) / 1000
const sum = (a: ArrayLike<number>) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]!; return s }
const max = (a: ArrayLike<number>, from = 0, to = a.length) => { let m = 0; for (let i = from; i < to; i++) m = Math.max(m, a[i]!); return m }
const dayTypeOfIndex = (day: number): Exclude<DayType, 'all'> => {
  const dow = new Date(Date.UTC(GEOMETRY_YEAR, 0, 1 + day)).getUTCDay()
  return dow === 0 ? 'sunday' : dow === 6 ? 'saturday' : 'weekday'
}

function typicalDays(res: CaseResult): TypicalDay[] {
  const b = res.balance
  const net = Float64Array.from(b.discharge, (v, h) => v - b.charge[h]! - b.gridCharge[h]!)
  const ranges = monthHourRanges()
  const out: TypicalDay[] = []
  for (const { month, start, end } of ranges) {
    for (const dt of DAY_TYPES) {
      const acc = { pv: new Array(24).fill(0), load: new Array(24).fill(0), import: new Array(24).fill(0), export: new Array(24).fill(0), batteryNet: new Array(24).fill(0) }
      let days = 0
      for (let h0 = start; h0 < end; h0 += 24) {
        if (dt !== 'all' && dayTypeOfIndex(h0 / 24) !== dt) continue
        days++
        for (let k = 0; k < 24; k++) {
          acc.pv[k] += b.pv[h0 + k]!; acc.load[k] += b.load[h0 + k]!; acc.import[k] += b.import[h0 + k]!
          acc.export[k] += b.export[h0 + k]!; acc.batteryNet[k] += net[h0 + k]!
        }
      }
      const avg = (a: number[]) => a.map((v) => r3(days > 0 ? v / days : 0))
      out.push({ month, dayType: dt, pv: avg(acc.pv), load: avg(acc.load), import: avg(acc.import), export: avg(acc.export), batteryNet: avg(acc.batteryNet) })
    }
  }
  return out
}

export function lossWaterfall(res: CaseResult, input: CaseInput): WaterfallStep[] {
  const a = res.pv.annual
  const arr = input.pv.arrays
  // kWp-weighted DC chain (one array for manual systems; exact per array otherwise).
  const keep = arr.reduce((s, x) => s + x.kWpDc * (1 - combinedDcLoss(x.losses)), 0) / arr.reduce((s, x) => s + x.kWpDc, 0)
  const dcLoss = a.referenceKwh * (1 - keep)
  const irrTemp = a.referenceKwh * keep - a.dcKwh
  const acBeforeAcLosses = a.acKwh / acFactor(input.pv.acLosses)
  const inverter = a.dcKwh - a.clippedKwh - acBeforeAcLosses
  // Each step is rounded to 1 Wh for storage; the AC-loss step takes the rounding residue so the
  // stored waterfall closes EXACTLY on its own AC output (reference − Σ losses = AC output).
  const ref = r3(a.referenceKwh), dc = r3(dcLoss), temp = r3(irrTemp), inv = r3(inverter), clip = r3(a.clippedKwh), ac = r3(a.acKwh)
  const acLosses = r3(ref - dc - temp - inv - clip - ac)
  return [
    { key: 'reference', label: 'Nameplate × plane-of-array irradiation', kwh: ref, kind: 'start' },
    { key: 'dc_losses', label: 'Soiling, shading, mismatch, DC wiring, LID, nameplate', kwh: dc, kind: 'loss' },
    { key: 'irradiance_temperature', label: 'Angle of incidence and cell temperature', kwh: temp, kind: 'loss' },
    { key: 'dc_output', label: 'DC output', kwh: r3(a.dcKwh), kind: 'subtotal' },
    { key: 'inverter', label: 'Inverter efficiency', kwh: inv, kind: 'loss' },
    { key: 'clipping', label: 'Inverter clipping', kwh: clip, kind: 'loss' },
    { key: 'ac_losses', label: 'AC wiring and availability', kwh: acLosses, kind: 'loss' },
    { key: 'ac_output', label: 'AC output', kwh: ac, kind: 'end' },
  ]
}

const pct = (x: number) => `${(x * 100).toFixed(0)} %`
const whole = (x: number) => Math.round(x).toString()

export function runChecks(res: CaseResult, input: CaseInput, k: RunKpis, meta: OutputsMeta): RunCheck[] {
  const ratio = k.dcKwp / k.acKw
  const curtailHours = Array.from(res.balance.curtail).filter((v) => v > 1e-9).length
  const exp = input.export
  const exportCheck: RunCheck = !exp.allowed
    ? { id: 'export_limit', label: 'Export limit', status: curtailHours > 0 ? 'warn' : 'pass', detail: `Export not allowed: surplus PV curtailed in ${curtailHours} h a year (${whole(k.curtailedKwh)} kWh).` }
    : exp.limitKw === null
      ? { id: 'export_limit', label: 'Export limit', status: 'n/a', detail: 'No export limit set.' }
      : { id: 'export_limit', label: 'Export limit', status: curtailHours > 0 ? 'warn' : 'pass', detail: `${curtailHours} h a year exceed the ${exp.limitKw} kW export limit (${whole(k.curtailedKwh)} kWh curtailed).` }
  const nmd = meta.nmdKva
  const loading: RunCheck = nmd === null
    ? { id: 'transformer_loading', label: 'Grid connection loading', status: 'n/a', detail: 'No NMD recorded on Site & Supply.' }
    : { id: 'transformer_loading', label: 'Grid connection loading', status: k.acKw > 0.75 * nmd ? 'warn' : 'pass', detail: `PV AC ${whole(k.acKw)} kW is ${pct(k.acKw / nmd)} of the ${whole(nmd)} kVA NMD (warning above 75 %, D-09; transformer rating not recorded).` }
  const gsa = meta.gsaPvoutKwhPerKwp
  const diff = gsa ? (k.specificYieldKwhPerKwp - gsa) / gsa : 0
  const gsaCheck: RunCheck = gsa === null
    ? { id: 'gsa_sanity', label: 'Global Solar Atlas sanity check', status: 'n/a', detail: 'Global Solar Atlas value unavailable for this site.' }
    : { id: 'gsa_sanity', label: 'Global Solar Atlas sanity check', status: Math.abs(diff) <= 0.05 ? 'pass' : 'warn', detail: `Engine ${whole(k.specificYieldKwhPerKwp)} vs GSA ${whole(gsa)} kWh/kWp — ${Math.abs(diff) <= 0.05 ? 'within' : 'outside'} 5 % (GSA assumes the optimum tilt facing north).` }
  return [
    { id: 'dc_ac_ratio', label: 'DC/AC ratio', status: ratio >= 1.0 && ratio <= 1.4 ? 'pass' : 'warn', detail: `DC/AC ratio ${ratio.toFixed(2)} (expected 1.00 to 1.40).` },
    exportCheck,
    { id: 'string_voltage', label: 'String voltage checks', status: 'n/a', detail: 'String checks need a layout — this case uses a manual system size.' },
    loading,
    gsaCheck,
  ]
}

export function buildRunOutputs(res: CaseResult, input: CaseInput, meta: OutputsMeta): CaseRunOutputs {
  const b = res.balance
  if (b.load.length !== HOURS_PER_YEAR) throw new Error('case result is not on the 8760 time base')
  const selfConsumed = sum(b.direct) + sum(b.dischargeFromPv)
  const kpis: RunKpis = {
    dcKwp: res.pv.kWpDc,
    acKw: input.pv.inverters.reduce((s, i) => s + i.acRatedKw, 0),
    specificYieldKwhPerKwp: res.pv.annual.specificYield,
    performanceRatio: res.pv.annual.performanceRatio,
    annualAcKwh: res.pv.annual.acKwh,
    pvAcKwh: b.kpis.pvKwh,
    deliveredKwh: b.kpis.pvKwh - b.kpis.curtailKwh,
    selfConsumedKwh: selfConsumed,
    exportKwh: b.kpis.exportKwh,
    curtailedKwh: b.kpis.curtailKwh,
    loadKwh: b.kpis.loadKwh,
    importBeforeKwh: b.kpis.loadKwh,
    importAfterKwh: b.kpis.importKwh,
    solarFraction: b.kpis.solarFraction,
    selfConsumption: b.kpis.selfConsumption,
    peakDemandBeforeKw: max(b.load),
    peakDemandAfterKw: max(b.import),
    peakDemandBasis: 'hourly',
    batteryKwh: input.battery ? input.battery.usableKwh : null,
    batteryKw: input.battery ? input.battery.maxDischargeKw : null,
  }
  const touBefore = meta.touPeriods ? monthlyTouSplit(b.load, meta.touPeriods) : null
  const touAfter = meta.touPeriods ? monthlyTouSplit(b.import, meta.touPeriods) : null
  const monthly: MonthlyRow[] = monthHourRanges().map(({ month, start, end }, i) => {
    const part = (a: Float64Array) => { let s = 0; for (let h = start; h < end; h++) s += a[h]!; return s }
    return {
      month, pvKwh: part(b.pv), loadKwh: part(b.load), importBeforeKwh: part(b.load), importKwh: part(b.import), exportKwh: part(b.export),
      maxDemandBeforeKw: max(b.load, start, end), maxDemandAfterKw: max(b.import, start, end),
      touImportBefore: touBefore ? touBefore[i]! : null, touImportAfter: touAfter ? touAfter[i]! : null,
    }
  })
  const daily: DailyRow[] = Array.from({ length: 365 }, (_, d) => {
    const s = (a: Float64Array) => { let t = 0; for (let h = d * 24; h < d * 24 + 24; h++) t += a[h]!; return r3(t) }
    return { day: d, pvKwh: s(b.pv), loadKwh: s(b.load), importKwh: s(b.import), exportKwh: s(b.export) }
  })
  return {
    version: RUN_OUTPUTS_VERSION,
    kpis,
    monthly,
    typicalDays: typicalDays(res),
    daily,
    waterfall: lossWaterfall(res, input),
    checks: runChecks(res, input, kpis, meta),
    provenance: {
      engineVersion: res.engineVersion, inputsHash: res.inputsHash, weatherDatasetId: res.weatherDatasetId,
      weatherSource: res.weatherSource, weatherFetchedAt: meta.weatherFetchedAt, gsaPvoutKwhPerKwp: meta.gsaPvoutKwhPerKwp,
      tariffRef: meta.tariffRef, loadBasis: meta.loadBasis, loadReferenceYear: meta.loadReferenceYear,
    },
  }
}

/** Monthly table as CSV (the "Download CSV" under the monthly table). Values from the stored outputs. */
export function monthlyCsv(o: CaseRunOutputs): string {
  const head = ['month', 'pv_kwh', 'load_kwh', 'import_before_kwh', 'import_after_kwh', 'export_kwh', 'max_demand_before_kw', 'max_demand_after_kw',
    'import_before_peak_kwh', 'import_before_standard_kwh', 'import_before_off_peak_kwh', 'import_after_peak_kwh', 'import_after_standard_kwh', 'import_after_off_peak_kwh']
  const f = (v: number | undefined | null) => (v === undefined || v === null ? '' : v.toFixed(3))
  const rows = o.monthly.map((m) => [m.month, f(m.pvKwh), f(m.loadKwh), f(m.importBeforeKwh), f(m.importKwh), f(m.exportKwh), f(m.maxDemandBeforeKw), f(m.maxDemandAfterKw),
    f(m.touImportBefore?.peak), f(m.touImportBefore?.standard), f(m.touImportBefore?.offPeak), f(m.touImportAfter?.peak), f(m.touImportAfter?.standard), f(m.touImportAfter?.offPeak)].join(','))
  return [head.join(','), ...rows].join('\n') + '\n'
}
