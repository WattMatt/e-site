/**
 * Bill engine — docs/solar/02-calculation-engine-spec.md §5. Pure, no I/O.
 * Costs one billing month of one point of delivery from TOU-split usage.
 *
 *  - The stored UNIT decides how a charge is costed. The engine never infers a
 *    unit from a magnitude and never re-derives a component from a label.
 *  - Every applicable charge is costed or listed in `notModelled` with a reason.
 *  - Lines keep full precision. The import total is rounded once; the export
 *    credit is a separate transaction (Net-Billing Rules §8), rounded once.
 *  - Net billing (Rules pp7-12): credited kWh capped per TOU period at import
 *    kWh; the credit offsets active-energy charges only; any excess carries to
 *    the next month and is forfeited at the distributor's financial-year end.
 */
import { roundCents } from './money'
import { sumTouKwh, zeroTouKwh } from './tou'
import { randPerKwh, unitClass } from './units'
import {
  TOU_PERIODS,
  type BillingSeason, type Charge, type ChargeComponent, type MonthUsage, type SsegRule,
  type Tariff, type TariffUnit, type TouKwh, type TouPeriod,
} from './types'

export const BILL_ENGINE_VERSION = '0.1.0'
/** kVArh up to this share of active kWh is free (engine spec §5.6). */
export const REACTIVE_FREE_RATIO = 0.3

export type BillLineKind = 'energy' | 'adder' | 'fixed' | 'network_capacity' | 'demand' | 'reactive' | 'export_credit'

export interface BillLine {
  kind: BillLineKind
  component: ChargeComponent
  /** Index into tariff.charges; null for the export-credit line. */
  chargeIndex: number | null
  label: string
  quantity: number
  quantityUnit: 'kWh' | 'kVArh' | 'kVA' | 'kW' | 'A' | 'day' | 'month'
  rate: number
  rateUnit: TariffUnit | 'R_per_kWh_credit'
  /** Full precision; round for display only. */
  amount: number
}

export interface NotModelled {
  chargeIndex: number
  component: ChargeComponent
  reason: string
}

export interface CreditResult {
  exportKwh: TouKwh
  /** Credited kWh per TOU period (net_billing_tou); null for flat crediting. */
  creditedKwh: TouKwh | null
  creditedTotalKwh: number
  earned: number
  carriedIn: number
  used: number
  carriedOut: number
  forfeited: number
  warnings: string[]
}

export interface MonthlyBill {
  year: number
  month: number
  season: BillingSeason
  lines: BillLine[]
  notModelled: NotModelled[]
  /** Active-energy charges only: the pool a net-billing credit may offset. */
  energyCharges: number
  totalExclVat: number
  vat: number
  totalInclVat: number
  credit: CreditResult
}

export interface CostOptions {
  /** The linked export tariff (Eskom Gen-offset). Without it, the tariff's own export_credit charges are used. */
  exportTariff?: Tariff | null
  sseg?: SsegRule | null
  /** Credit balance carried in from the previous month (R). */
  creditIn?: number
  systemKva?: number | null
}

interface Indexed {
  c: Charge
  i: number
}

interface Ctx {
  usage: MonthUsage
  lines: BillLine[]
  notModelled: NotModelled[]
  /** Rand of active energy per TOU period, for the value_per_tou_period cap. */
  energyValueByPeriod: TouKwh
}

const seasonMatches = (c: Charge, s: BillingSeason): boolean => c.season === 'all' || c.season === s

function chargeLabel(c: Charge): string {
  if (c.label) return c.label
  const season = c.season === 'all' ? '' : ` ${c.season}`
  const tou = c.tou === 'all' ? '' : ` ${c.tou}`
  return `${c.component}${season}${tou}`
}

function costEnergy(ctx: Ctx, energy: Indexed[]): void {
  if (energy.length === 0) return
  const { usage } = ctx
  const total = sumTouKwh(usage.importKwh)
  const touCharges = energy.filter(({ c }) => c.tou !== 'all')
  const blocked = energy.filter(({ c }) => c.blockMinKwh !== null)
  const plain = energy.filter(({ c }) => c.tou === 'all' && c.blockMinKwh === null)

  if (touCharges.length > 0 && blocked.length > 0) {
    for (const { c, i } of energy) {
      ctx.notModelled.push({ chargeIndex: i, component: c.component, reason: 'TOU with inclining blocks (tou_ibt) is not modelled' })
    }
    return
  }

  for (const { c, i } of touCharges) {
    const p = c.tou as TouPeriod
    const qty = usage.importKwh[p]
    const amount = qty * randPerKwh(c)
    ctx.energyValueByPeriod[p] += amount
    ctx.lines.push({ kind: 'energy', component: c.component, chargeIndex: i, label: chargeLabel(c), quantity: qty, quantityUnit: 'kWh', rate: c.amountExclVat, rateUnit: c.unit, amount })
  }

  const sorted = [...blocked].sort((a, b) => (a.c.blockMinKwh as number) - (b.c.blockMinKwh as number))
  for (const { c, i } of sorted) {
    const scale = c.blockBasis === 'daily' ? usage.days : 1
    const lo = (c.blockMinKwh as number) * scale
    const hi = c.blockMaxKwh === null ? Number.POSITIVE_INFINITY : c.blockMaxKwh * scale
    const qty = Math.max(0, Math.min(total, hi) - lo)
    if (qty === 0) continue
    const rate = randPerKwh(c)
    for (const p of TOU_PERIODS) ctx.energyValueByPeriod[p] += total === 0 ? 0 : (qty * rate * usage.importKwh[p]) / total
    ctx.lines.push({
      kind: 'energy', component: c.component, chargeIndex: i,
      label: `${chargeLabel(c)} [${lo}-${hi === Number.POSITIVE_INFINITY ? '' : hi} kWh)`,
      quantity: qty, quantityUnit: 'kWh', rate: c.amountExclVat, rateUnit: c.unit, amount: qty * rate,
    })
  }

  for (const { c, i } of plain) {
    const rate = randPerKwh(c)
    for (const p of TOU_PERIODS) ctx.energyValueByPeriod[p] += usage.importKwh[p] * rate
    ctx.lines.push({ kind: 'energy', component: c.component, chargeIndex: i, label: chargeLabel(c), quantity: total, quantityUnit: 'kWh', rate: c.amountExclVat, rateUnit: c.unit, amount: total * rate })
  }
}

function demandQuantity(c: Charge, u: MonthUsage): { qty: number | null; basis: string } {
  const basis = c.demandBasis ?? (c.component === 'network_capacity' ? 'nmd' : 'actual_md')
  switch (basis) {
    case 'nmd':
      return { qty: u.nmdKva ?? null, basis: 'NMD' }
    case 'actual_md':
      // Spec §5.4: max(chargeable MD, NMD) where an NMD is known.
      return { qty: u.maxDemandKva == null ? null : Math.max(u.maxDemandKva, u.nmdKva ?? 0), basis: 'maximum demand' }
    case 'peak_window_md':
      return { qty: u.peakWindowMdKva ?? null, basis: 'peak/standard-window maximum demand' }
    default:
      return {
        qty: u.nmdKva != null && u.maxDemandKva != null ? Math.max(u.nmdKva, u.maxDemandKva) : null,
        basis: 'utilised capacity (NMD and maximum demand)',
      }
  }
}

function costOther(ctx: Ctx, c: Charge, i: number, totalKwh: number): void {
  const u = ctx.usage
  const base = { component: c.component, chargeIndex: i, label: chargeLabel(c), rate: c.amountExclVat, rateUnit: c.unit }
  const fixedKind: BillLineKind = c.component === 'network_capacity' ? 'network_capacity' : 'fixed'
  switch (unitClass(c.unit)) {
    case 'per_kwh': {
      // Per-kWh adders: legacy, ancillary, network demand in c/kWh (Homeflex), subsidies.
      const qty = c.tou === 'all' ? totalKwh : u.importKwh[c.tou]
      ctx.lines.push({ ...base, kind: 'adder', quantity: qty, quantityUnit: 'kWh', amount: qty * randPerKwh(c) })
      return
    }
    case 'per_month':
      ctx.lines.push({ ...base, kind: fixedKind, quantity: 1, quantityUnit: 'month', amount: c.amountExclVat })
      return
    case 'per_day':
      // Eskom R/POD/day and municipal R/day (Cape Town) alike.
      ctx.lines.push({ ...base, kind: fixedKind, quantity: u.days, quantityUnit: 'day', amount: c.amountExclVat * u.days })
      return
    case 'per_kva_month': {
      const { qty, basis } = demandQuantity(c, u)
      if (qty === null) {
        ctx.notModelled.push({ chargeIndex: i, component: c.component, reason: `no ${basis} in kVA was supplied` })
        return
      }
      ctx.lines.push({ ...base, kind: c.component === 'network_capacity' ? 'network_capacity' : 'demand', quantity: qty, quantityUnit: 'kVA', amount: qty * c.amountExclVat })
      return
    }
    case 'per_kw_month':
      if (u.maxDemandKw == null) {
        ctx.notModelled.push({ chargeIndex: i, component: c.component, reason: 'no maximum demand in kW was supplied' })
        return
      }
      ctx.lines.push({ ...base, kind: 'demand', quantity: u.maxDemandKw, quantityUnit: 'kW', amount: u.maxDemandKw * c.amountExclVat })
      return
    case 'per_amp_month':
      if (u.ampsRating == null) {
        ctx.notModelled.push({ chargeIndex: i, component: c.component, reason: 'no supply rating in amps was supplied' })
        return
      }
      ctx.lines.push({ ...base, kind: fixedKind, quantity: u.ampsRating, quantityUnit: 'A', amount: u.ampsRating * c.amountExclVat })
      return
    case 'per_kvarh': {
      if (u.kvarh == null) {
        ctx.notModelled.push({ chargeIndex: i, component: c.component, reason: 'no kVArh data: reactive energy is not modelled' })
        return
      }
      const qty = Math.max(0, u.kvarh - REACTIVE_FREE_RATIO * totalKwh)
      ctx.lines.push({ ...base, kind: 'reactive', quantity: qty, quantityUnit: 'kVArh', amount: (qty * c.amountExclVat) / 100 })
      return
    }
    case 'pct':
      ctx.notModelled.push({ chargeIndex: i, component: c.component, reason: 'percentage surcharges are not modelled' })
      return
  }
}

function exportRateRand(charges: readonly Charge[], season: BillingSeason, period: TouPeriod | 'all'): number | null {
  const pool = charges.filter(
    (c) => (c.component === 'export_credit' || c.component === 'energy')
      && c.blockMinKwh === null
      && seasonMatches(c, season)
      && unitClass(c.unit) === 'per_kwh',
  )
  // The most specific row wins, never row order: exact TOU before 'all', then the named season
  // before 'all' (a manual export schedule may carry an all-year rate AND a high-season one).
  const bySeason = (xs: Charge[]) => xs.find((c) => c.season !== 'all') ?? xs[0]
  const exact = bySeason(pool.filter((c) => c.tou === period))
  const fallback = period === 'all' ? undefined : bySeason(pool.filter((c) => c.tou === 'all'))
  const pick = exact ?? fallback
  return pick ? randPerKwh(pick) : null
}

function settleCredit(
  usage: MonthUsage, opts: CostOptions, exportCharges: readonly Charge[], importValue: TouKwh, energyCharges: number,
): CreditResult {
  const exp = usage.exportKwh ?? zeroTouKwh()
  const sseg = opts.sseg ?? null
  const res: CreditResult = {
    exportKwh: { ...exp }, creditedKwh: null, creditedTotalKwh: 0,
    earned: 0, carriedIn: roundCents(opts.creditIn ?? 0), used: 0, carriedOut: 0, forfeited: 0, warnings: [],
  }
  const exported = sumTouKwh(exp)

  if (!sseg || sseg.crediting === 'none') {
    if (exported > 0) res.warnings.push('No net-billing rule applies: exported energy earns no credit.')
  } else if (opts.systemKva != null && opts.systemKva > sseg.maxKva) {
    if (exported > 0) {
      res.warnings.push(`A ${opts.systemKva} kVA system exceeds the ${sseg.maxKva} kVA net-billing limit: exports are not credited.`)
    }
  } else if (sseg.crediting === 'net_billing_tou') {
    const credited = zeroTouKwh()
    let earned = 0
    for (const p of TOU_PERIODS) {
      const e = exp[p]
      if (e <= 0) continue
      const rate = exportRateRand(exportCharges, usage.season, p)
      if (rate === null) {
        res.warnings.push(`No export rate for ${p} in the ${usage.season} season: ${e} kWh not credited.`)
        continue
      }
      const kwh = sseg.capRule === 'kwh_per_tou_period' ? Math.min(e, usage.importKwh[p]) : e
      let value = kwh * rate
      if (sseg.capRule === 'value_per_tou_period') value = Math.min(value, importValue[p])
      credited[p] = kwh
      earned += value
    }
    res.creditedKwh = credited
    res.creditedTotalKwh = sumTouKwh(credited)
    res.earned = roundCents(earned)
  } else {
    const rate = exportRateRand(exportCharges, usage.season, 'all')
    if (exported > 0 && rate === null) {
      res.warnings.push(`No flat export rate in the ${usage.season} season: ${exported} kWh not credited.`)
    } else if (exported > 0 && rate !== null) {
      const kwh = sseg.capRule === 'kwh_per_tou_period' ? Math.min(exported, sumTouKwh(usage.importKwh)) : exported
      let value = kwh * rate
      if (sseg.capRule === 'value_per_tou_period') value = Math.min(value, sumTouKwh(importValue))
      res.creditedTotalKwh = kwh
      res.earned = roundCents(value)
    }
  }

  const available = roundCents(res.earned + res.carriedIn)
  res.used = Math.min(available, energyCharges)
  let carry = roundCents(available - res.used)
  // Never cash. No carry-forward, or the FY-end month, forfeits the balance.
  const resets = !sseg || sseg.carryForward === 'none' || usage.month === sseg.fyEndMonth
  if (resets) {
    res.forfeited = carry
    carry = 0
  }
  res.carriedOut = carry
  return res
}

export function costMonth(tariff: Tariff, usage: MonthUsage, opts: CostOptions = {}): MonthlyBill {
  const ctx: Ctx = { usage, lines: [], notModelled: [], energyValueByPeriod: zeroTouKwh() }
  const total = sumTouKwh(usage.importKwh)
  const inSeason: Indexed[] = tariff.charges.map((c, i) => ({ c, i })).filter(({ c }) => seasonMatches(c, usage.season))
  // Day-type-specific charges need daily usage split by day type; never bill them on every day (spec §5.9).
  for (const { c, i } of inSeason) {
    if (c.dayType !== 'all') ctx.notModelled.push({ chargeIndex: i, component: c.component, reason: `${c.dayType}-only charges are not modelled` })
  }
  const applicable = inSeason.filter(({ c }) => c.dayType === 'all')

  costEnergy(ctx, applicable.filter(({ c }) => c.component === 'energy'))
  for (const { c, i } of applicable) {
    if (c.component === 'energy' || c.component === 'export_credit') continue
    if (c.component === 'loss_factor' || c.component === 'wheeling_uos') {
      ctx.notModelled.push({ chargeIndex: i, component: c.component, reason: 'wheeling components are not part of a self-consumption bill' })
      continue
    }
    costOther(ctx, c, i, total)
  }

  const energyCharges = roundCents(ctx.lines.filter((l) => l.kind === 'energy').reduce((a, l) => a + l.amount, 0))
  const importTotal = roundCents(ctx.lines.reduce((a, l) => a + l.amount, 0))
  const exportCharges = opts.exportTariff
    ? opts.exportTariff.charges
    : tariff.charges.filter((c) => c.component === 'export_credit')
  const credit = settleCredit(usage, opts, exportCharges, ctx.energyValueByPeriod, energyCharges)
  if (credit.used > 0) {
    ctx.lines.push({
      kind: 'export_credit', component: 'export_credit', chargeIndex: null, label: 'Net-billing export credit',
      quantity: credit.creditedTotalKwh, quantityUnit: 'kWh',
      rate: credit.creditedTotalKwh === 0 ? 0 : credit.used / credit.creditedTotalKwh, rateUnit: 'R_per_kWh_credit',
      amount: -credit.used,
    })
  }

  const totalExclVat = roundCents(importTotal - credit.used)
  const vatRate = tariff.charges[0]?.vatRate ?? 0.15
  const vat = roundCents(totalExclVat * vatRate)
  return {
    year: usage.year, month: usage.month, season: usage.season,
    lines: ctx.lines, notModelled: ctx.notModelled,
    energyCharges, totalExclVat, vat, totalInclVat: roundCents(totalExclVat + vat), credit,
  }
}

/** The start year of the financial year a month belongs to, for a year ending in `fyEndMonth`. */
export function financialYearOf(year: number, month: number, fyEndMonth: number): number {
  return month > fyEndMonth ? year : year - 1
}

/**
 * Consecutive months with the credit balance carried between them. The balance
 * is forfeited at the FY-end month and also whenever the list moves into a new
 * financial year without passing through that month (a gap or a jump).
 */
export function costPeriod(tariff: Tariff, months: readonly MonthUsage[], opts: CostOptions = {}): MonthlyBill[] {
  const bills: MonthlyBill[] = []
  let carry = opts.creditIn ?? 0
  const fyEnd = opts.sseg?.fyEndMonth ?? null
  let prevFy: number | null = null
  for (const m of months) {
    const fy = fyEnd === null ? null : financialYearOf(m.year, m.month, fyEnd)
    let lostAtYearEnd = 0
    if (prevFy !== null && fy !== prevFy) {
      lostAtYearEnd = carry
      carry = 0
    }
    prevFy = fy
    const bill = costMonth(tariff, m, { ...opts, creditIn: carry })
    // A balance lost at a year end the list skipped is counted as forfeited, never dropped silently.
    if (lostAtYearEnd > 0) bill.credit.forfeited = roundCents(bill.credit.forfeited + lostAtYearEnd)
    bills.push(bill)
    carry = bill.credit.carriedOut
  }
  return bills
}
