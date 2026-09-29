/**
 * Sensitivity tornado (functional spec §8): ±20 % (default) of capex, tariff escalation, yield,
 * discount rate and export rate, one at a time, on the NPV of one model's view.
 */
import { escalationRate } from './factors'
import { runFinance, type FinanceEnergy, type FinanceInput, type FinanceModel, type ViewResult } from './cashflow'
import type { Year1Bills } from './bill-calculator'

export type TornadoVariable = 'capex' | 'tariffEscalation' | 'yield' | 'discountRate' | 'exportRate'

export const TORNADO_VARIABLES: readonly TornadoVariable[] = ['capex', 'tariffEscalation', 'yield', 'discountRate', 'exportRate']

export interface TornadoBar {
  variable: TornadoVariable
  /** NPV with the variable at (1 − swing). */
  lowNpvZar: number
  /** NPV with the variable at (1 + swing). */
  highNpvZar: number
  spreadZar: number
}

export interface Tornado {
  model: FinanceModel['kind']
  view: ViewResult['view']
  baseNpvZar: number
  swing: number
  bars: TornadoBar[]
  /**
   * Variables left out because they could not be computed honestly: `exportRate` needs the bills
   * RE-PRICED at the scaled export rate (`TornadoOptions.exportRateBills`); without it the bar is
   * omitted rather than approximated by scaling the credit used.
   */
  omitted: TornadoVariable[]
}

export interface TornadoOptions {
  /** Year-1 bills with every export credit rate × k, priced through the tariff's net-billing rules (`year1BillsRepricer`). */
  exportRateBills?: (k: number) => Year1Bills
}

function flex(
  v: TornadoVariable,
  k: number,
  f: FinanceInput,
  e: FinanceEnergy,
  exportRateBills?: (k: number) => Year1Bills,
): [FinanceInput, FinanceEnergy] {
  switch (v) {
    case 'capex':
      return [
        {
          ...f,
          capex: {
            totalZar: f.capex.totalZar * k,
            inverterZar: f.capex.inverterZar * k,
            batteryZar: f.capex.batteryZar * k,
            section12bQualifyingZar: f.capex.section12bQualifyingZar * k,
          },
        },
        e,
      ]
    case 'tariffEscalation': {
      const published = Array.from({ length: f.analysis.years - 1 }, (_, i) => escalationRate(i + 2, f.analysis.escalation, f.analysis.cpi) * k)
      return [{ ...f, analysis: { ...f.analysis, escalation: { ...f.analysis.escalation, published } } }, e]
    }
    case 'yield': {
      const pvSaving = e.bills.beforeZar - e.bills.afterPvOnlyZar
      const battSaving = e.bills.afterPvOnlyZar - e.bills.afterZar
      const afterPvOnlyZar = e.bills.beforeZar - pvSaving * k
      return [
        f,
        {
          year1PvKwh: e.year1PvKwh * k,
          year1DeliveredKwh: e.year1DeliveredKwh === undefined ? undefined : e.year1DeliveredKwh * k,
          bills: { ...e.bills, afterPvOnlyZar, afterZar: afterPvOnlyZar - battSaving },
        },
      ]
    }
    case 'discountRate':
      return [{ ...f, analysis: { ...f.analysis, discountRate: f.analysis.discountRate * k } }, e]
    case 'exportRate':
      // Re-priced, never credit × k: the energy-only cap and the FY-end forfeit must still bind.
      if (!exportRateBills) throw new Error('exportRate needs re-priced bills')
      return [f, { ...e, bills: exportRateBills(k) }]
  }
}

function npvOf(f: FinanceInput, e: FinanceEnergy, modelIndex: number, viewName: ViewResult['view']): number {
  const r = runFinance({ ...f, models: [f.models[modelIndex]!] }, e)
  const v = r.models[0]!.views.find((x) => x.view === viewName)
  if (!v) throw new Error(`model has no ${viewName} view`)
  return v.npvZar
}

export function tornado(
  f: FinanceInput,
  e: FinanceEnergy,
  modelIndex = 0,
  viewName: ViewResult['view'] = 'owner',
  swing = 0.2,
  opts: TornadoOptions = {},
): Tornado {
  if (!(swing > 0 && swing < 1)) throw new Error('swing must be in (0, 1)')
  const baseNpvZar = npvOf(f, e, modelIndex, viewName)
  const omitted: TornadoVariable[] = opts.exportRateBills ? [] : ['exportRate']
  const bars = TORNADO_VARIABLES.filter((v) => !omitted.includes(v)).map((variable) => {
    const lowNpvZar = npvOf(...flex(variable, 1 - swing, f, e, opts.exportRateBills), modelIndex, viewName)
    const highNpvZar = npvOf(...flex(variable, 1 + swing, f, e, opts.exportRateBills), modelIndex, viewName)
    return { variable, lowNpvZar, highNpvZar, spreadZar: Math.abs(highNpvZar - lowNpvZar) }
  }).sort((a, b) => b.spreadZar - a.spreadZar)
  return { model: f.models[modelIndex]!.kind, view: viewName, baseNpvZar, swing, bars, omitted }
}
