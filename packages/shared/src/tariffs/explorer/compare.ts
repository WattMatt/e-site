/**
 * One consumption profile priced across 2-4 tariffs with the shared bill
 * engine (costPeriod). Pure: safe to run in the browser. Totals are VAT
 * exclusive unless named otherwise; nothing the engine could not price is
 * dropped silently — it is listed per tariff.
 */
import { costPeriod } from '../bill-engine'
import type { ChargeComponent, Tariff } from '../types'
import { buildProfileMonths, type ConsumptionProfile } from './profile'

export const MAX_COMPARE = 4

export interface CompareInput {
  key: string
  label: string
  tariff: Tariff
  highSeasonMonths: readonly number[]
}

export interface CompareResult {
  key: string
  label: string
  annualExclVat: number
  annualInclVat: number
  monthlyExclVat: number[]
  /** Annual cost over annual kWh, in c/kWh; null when the profile has no energy. */
  effectiveCPerKwh: number | null
  notModelled: Array<{ chargeIndex: number; component: ChargeComponent; reason: string }>
}

export function compareTariffs(profile: ConsumptionProfile, inputs: readonly CompareInput[], year: number): CompareResult[] {
  if (inputs.length > MAX_COMPARE) throw new RangeError(`Compare at most ${MAX_COMPARE} tariffs at a time.`)
  const results = inputs.map((inp): CompareResult => {
    const months = buildProfileMonths(profile, { highSeasonMonths: inp.highSeasonMonths, year })
    const bills = costPeriod(inp.tariff, months)
    const annualExclVat = bills.reduce((s, b) => s + b.totalExclVat, 0)
    const annualInclVat = bills.reduce((s, b) => s + b.totalInclVat, 0)
    const kwh = months.reduce((s, m) => s + m.importKwh.peak + m.importKwh.standard + m.importKwh.off_peak, 0)
    const seen = new Set<number>()
    const notModelled: CompareResult['notModelled'] = []
    for (const b of bills) {
      for (const n of b.notModelled) {
        if (seen.has(n.chargeIndex)) continue
        seen.add(n.chargeIndex)
        notModelled.push(n)
      }
    }
    return {
      key: inp.key, label: inp.label, annualExclVat, annualInclVat,
      monthlyExclVat: bills.map((b) => b.totalExclVat),
      effectiveCPerKwh: kwh > 0 ? (annualExclVat / kwh) * 100 : null,
      notModelled,
    }
  })
  return results.sort((a, b) => a.annualExclVat - b.annualExclVat)
}
