import 'server-only'
/**
 * Lost revenue for the monthly report (spec §10: "lost revenue at the pinned tariff's TOU rates via
 * the bill engine"; WM used one flat rate, G13). The lost kWh are placed on the bill engine's 8760
 * hours (lost-energy.ts) and costed as IMPORT on the pinned tariff for the report's calendar year,
 * so each kWh carries the TOU rate of the hour it was lost in. Maximum and peak-window demand are
 * forced to 0 so the lost energy cannot create a demand charge; fixed charges cancel because the
 * figure is bill(lost) − bill(nothing). Rand excl. VAT.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { tariffBillCalculator } from '@esite/shared/solar-engine'
import { monthParts, type MonthKey } from '@esite/shared/solar-operations'
import { resolveStudyTariff, type BuildBillCalculator } from '@/lib/solar/cases/tariff'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

/** resolveStudyTariff's default build (tariffBillCalculator) with every demand the energy could set forced to 0. */
export const energyOnlyBuild: BuildBillCalculator = (tariff, opts) =>
  tariffBillCalculator(tariff, {
    ...opts,
    demandForMonth: (m: number) => ({ ...(opts.demandForMonth?.(m) ?? {}), maxDemandKva: 0, maxDemandKw: 0, peakWindowMdKva: 0 }),
  })

const r2 = (x: number) => Math.round(x * 100) / 100

export async function valueLostEnergy(svc: AnyClient, projectId: string, month: MonthKey, events: readonly Float64Array[]):
  Promise<{ ok: true; tariffName: string; perEventZar: number[]; totalZar: number } | { ok: false; reason: string }> {
  const { year, month: m } = monthParts(month)
  const t = await resolveStudyTariff(svc, projectId, { year, build: energyOnlyBuild })
  if (!t.ok) return { ok: false, reason: t.reason }
  const zeros = new Float64Array(8760)
  const bill = (imp: Float64Array) => t.calc.monthlyBills({ importKwh: imp, exportKwh: zeros })[m - 1]!.totalZar
  const base = bill(zeros)
  const perEventZar = events.map((e) => r2(bill(e) - base))
  let totalZar = 0
  if (events.length > 0) {
    const all = new Float64Array(8760)
    for (const e of events) for (let k = 0; k < 8760; k++) all[k] = all[k]! + e[k]!
    totalZar = r2(bill(all) - base)
  }
  const ref = t.tariffRef
  return { ok: true, tariffName: `${ref.tariffName} (${ref.licenseeName}, ${ref.financialYear})`, perEventZar, totalZar }
}
