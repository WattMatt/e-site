/**
 * Sensitivity tornado (functional spec §8): ±20 % (default) of capex, tariff escalation, yield,
 * discount rate and export rate, one at a time, on the NPV of one model's view.
 */
import { escalationRate } from './factors'
import { runFinance, type FinanceEnergy, type FinanceInput, type FinanceModel, type ViewResult } from './cashflow'

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
}

function flex(v: TornadoVariable, k: number, f: FinanceInput, e: FinanceEnergy): [FinanceInput, FinanceEnergy] {
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
      return [f, { year1PvKwh: e.year1PvKwh * k, bills: { ...e.bills, afterPvOnlyZar, afterZar: afterPvOnlyZar - battSaving } }]
    }
    case 'discountRate':
      return [{ ...f, analysis: { ...f.analysis, discountRate: f.analysis.discountRate * k } }, e]
    case 'exportRate': {
      const extra = e.bills.exportCreditUsedZar * (k - 1)
      return [
        f,
        {
          ...e,
          bills: {
            ...e.bills,
            afterZar: e.bills.afterZar - extra,
            afterPvOnlyZar: e.bills.afterPvOnlyZar - extra,
            exportCreditUsedZar: e.bills.exportCreditUsedZar * k,
          },
        },
      ]
    }
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
): Tornado {
  if (!(swing > 0 && swing < 1)) throw new Error('swing must be in (0, 1)')
  const baseNpvZar = npvOf(f, e, modelIndex, viewName)
  const bars = TORNADO_VARIABLES.map((variable) => {
    const lowNpvZar = npvOf(...flex(variable, 1 - swing, f, e), modelIndex, viewName)
    const highNpvZar = npvOf(...flex(variable, 1 + swing, f, e), modelIndex, viewName)
    return { variable, lowNpvZar, highNpvZar, spreadZar: Math.abs(highNpvZar - lowNpvZar) }
  }).sort((a, b) => b.spreadZar - a.spreadZar)
  return { model: f.models[modelIndex]!.kind, view: viewName, baseNpvZar, swing, bars }
}
