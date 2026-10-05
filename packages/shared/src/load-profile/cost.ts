/**
 * TOU split and annual cost of a profile against one tariff — the same engine call the Solar
 * tariff tab makes (costHourly with the licensee's calendar and the reference year's statutory
 * holidays), with no export. Measured monthly MD (interval data) and the confirmed NMD are
 * supplied per month; peak-window demand stays derived from the hourly series (labelled).
 */
import type { MonthlyMd } from '../services/solar/load/max-demand'
import { referenceYearHolidays } from '../services/solar/finance/tariff-bill-calculator'
import { costHourly } from '../tariffs/bill-calculator'
import type { MonthlyBill, NotModelled } from '../tariffs/bill-engine'
import { aggregateHourly, sumTouKwh, type TouCalendar } from '../tariffs/tou'
import type { Tariff, TouKwh } from '../tariffs/types'

export interface CostedMonth { month: number; tou: TouKwh; kwh: number; mdKva: number | null; bill: MonthlyBill }
export interface ProfileCost {
  months: CostedMonth[]
  annual: { kwh: number; tou: TouKwh; totalExclVat: number; vat: number; totalInclVat: number }
  notModelled: Array<Pick<NotModelled, 'component' | 'reason'>>
}

/** Interval MD by calendar month (1..12); a month seen in several years keeps its highest. */
export function mdByCalendarMonth(months: readonly MonthlyMd[]): Array<number | null> {
  const out: Array<number | null> = Array(12).fill(null)
  for (const m of months) {
    const k = Number(m.month.slice(5, 7)) - 1
    out[k] = Math.max(out[k] ?? -Infinity, m.kva)
  }
  return out
}

export function costProfile(input: {
  tariff: Tariff
  calendar: TouCalendar
  series: ArrayLike<number>
  referenceYear: number
  powerFactor: number
  holidays?: ReadonlySet<string>
  mdKvaByMonth?: ReadonlyArray<number | null>
  nmdKva?: number | null
}): ProfileCost {
  const holidays = input.holidays ?? referenceYearHolidays(input.referenceYear)
  const exportKwh = new Float64Array(input.series.length)
  const usage = aggregateHourly({ importKwh: input.series, calendar: input.calendar, year: input.referenceYear, holidays })
  const bills = costHourly(input.tariff, { importKwh: input.series, exportKwh }, {
    calendar: input.calendar,
    year: input.referenceYear,
    holidays,
    powerFactor: input.powerFactor,
    demandForMonth: (month) => {
      const md = input.mdKvaByMonth?.[month - 1]
      return { ...(md != null ? { maxDemandKva: md } : {}), ...(input.nmdKva != null ? { nmdKva: input.nmdKva } : {}) }
    },
  })
  const months = bills.map((bill, k) => ({
    month: bill.month,
    tou: usage[k].importKwh,
    kwh: sumTouKwh(usage[k].importKwh),
    mdKva: input.mdKvaByMonth?.[k] ?? null,
    bill,
  }))
  const tou = months.reduce((a, m) => ({ peak: a.peak + m.tou.peak, standard: a.standard + m.tou.standard, off_peak: a.off_peak + m.tou.off_peak }), { peak: 0, standard: 0, off_peak: 0 })
  const seen = new Set<string>()
  const notModelled = bills.flatMap((b) => b.notModelled).filter((n) => {
    const k = `${n.component}|${n.reason}`
    return seen.has(k) ? false : (seen.add(k), true)
  }).map(({ component, reason }) => ({ component, reason }))
  return {
    months,
    annual: {
      kwh: months.reduce((s, m) => s + m.kwh, 0),
      tou,
      totalExclVat: bills.reduce((s, b) => s + b.totalExclVat, 0),
      vat: bills.reduce((s, b) => s + b.vat, 0),
      totalInclVat: bills.reduce((s, b) => s + b.totalInclVat, 0),
    },
    notModelled,
  }
}
