/**
 * Bill check (spec §5): enter one real monthly bill; 2a's bill engine
 * (costMonth) costs that month's usage on the pinned (or overridden) tariff;
 * modelled vs actual and the % difference, amber beyond ±5 %.
 */
import { costMonth, type BillLine, type NotModelled } from '../../tariffs/bill-engine'
import { seasonForMonth } from '../../tariffs/tou'
import type { BillingSeason, Tariff, TouKwh } from '../../tariffs/types'

export const BILL_CHECK_WARN_PCT = 5

export interface BillCheckForm {
  month: string
  peak: string
  standard: string
  offPeak: string
  totalKwh: string
  maxDemandKva: string
  actualTotal: string
  note: string
}

export const EMPTY_BILL_CHECK_FORM: BillCheckForm = {
  month: '', peak: '', standard: '', offPeak: '', totalKwh: '', maxDemandKva: '', actualTotal: '', note: '',
}

export interface BillCheckInput {
  year: number
  month: number
  importKwh: TouKwh
  maxDemandKva: number | null
  actualTotalExclVat: number
  note: string | null
}

export type BillCheckField = 'month' | 'kwh' | 'maxDemandKva' | 'actualTotal' | 'note'

/** Whitespace (\s includes the no-break space) is a thousands separator; a decimal comma is accepted. */
const parse = (raw: string): number | null => {
  const s = String(raw ?? '').replace(/\s/g, '').replace(',', '.')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : Number.NaN
}

export function validateBillCheckForm(
  f: BillCheckForm, isTou: boolean,
): { input: BillCheckInput } | { errors: Partial<Record<BillCheckField, string>> } {
  const errors: Partial<Record<BillCheckField, string>> = {}
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(f.month.trim())
  if (!m) errors.month = 'Choose the billing month'
  let importKwh: TouKwh = { peak: 0, standard: 0, off_peak: 0 }
  if (isTou) {
    const [p, s, o] = [parse(f.peak), parse(f.standard), parse(f.offPeak)].map((v) => (v === null ? 0 : v))
    if ([p, s, o].some((v) => Number.isNaN(v) || v < 0) || p + s + o <= 0) errors.kwh = 'Enter the kWh the bill shows'
    else importKwh = { peak: p, standard: s, off_peak: o }
  } else {
    const t = parse(f.totalKwh)
    if (t === null || Number.isNaN(t) || t <= 0) errors.kwh = 'Enter the kWh the bill shows'
    else importKwh = { peak: 0, standard: t, off_peak: 0 }
  }
  const md = parse(f.maxDemandKva)
  if (md !== null && (Number.isNaN(md) || md < 0)) errors.maxDemandKva = 'Enter a demand of 0 or more'
  const total = parse(f.actualTotal)
  if (total === null || Number.isNaN(total) || total <= 0) errors.actualTotal = 'Enter the bill total (excl. VAT) above zero'
  const note = f.note.trim()
  if (note.length > 500) errors.note = 'Keep the note under 500 characters'
  if (Object.keys(errors).length > 0) return { errors }
  return {
    input: {
      year: Number(m![1]), month: Number(m![2]), importKwh,
      maxDemandKva: md, actualTotalExclVat: total as number, note: note || null,
    },
  }
}

export class BillCheckError extends Error {}

export interface BillCheckResult {
  season: BillingSeason
  modelledTotalExclVat: number
  differencePct: number
  warn: boolean
  lines: BillLine[]
  notModelled: NotModelled[]
}

export function runBillCheck(
  tariff: Tariff, input: BillCheckInput, ctx: { highSeasonMonths: number[] | null; nmdKva: number | null },
): BillCheckResult {
  const seasonal = tariff.charges.some((c) => c.season !== 'all')
  if (seasonal && !ctx.highSeasonMonths) {
    throw new BillCheckError('This tariff has seasonal rates but the library has no season calendar for this supply authority. Report it as a tariff error.')
  }
  const season: BillingSeason = ctx.highSeasonMonths ? seasonForMonth(input.month, { highSeasonMonths: ctx.highSeasonMonths }) : 'low'
  // A real bill: the calendar's day count (29 Feb included), not the reference year's.
  const days = new Date(Date.UTC(input.year, input.month, 0)).getUTCDate()
  const bill = costMonth(tariff, {
    year: input.year, month: input.month, days, season, importKwh: input.importKwh,
    maxDemandKva: input.maxDemandKva, peakWindowMdKva: input.maxDemandKva, nmdKva: ctx.nmdKva,
  })
  const modelled = bill.totalExclVat
  const differencePct = Math.round(((modelled - input.actualTotalExclVat) / input.actualTotalExclVat) * 100 * 1000) / 1000
  return {
    season, modelledTotalExclVat: modelled, differencePct, warn: Math.abs(differencePct) > BILL_CHECK_WARN_PCT,
    lines: bill.lines, notModelled: bill.notModelled,
  }
}
