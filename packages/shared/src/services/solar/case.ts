/**
 * Engine entry points (spec §1.1).
 *
 *   simulateCase(input, weather)          → CaseResult   (hourly PV + energy balance + KPIs)
 *   runFinancials(result, fin, bills)     → FinancialsResult
 *
 * The weather year is passed beside the input, not inside it: the stored snapshot carries the
 * dataset id (spec §1.3), and the id must match the weather actually supplied.
 * `costBill` (spec §1.1) is Phase 2a; this phase consumes it through `BillCalculator`.
 */
import { inputsHash } from './hash'
import { ENGINE_VERSION } from './version'
import { HOURS_PER_YEAR, assert8760, monthlySums } from './time'
import { simulatePv, type PvResult, type PvSystem } from './pv/simulate-pv'
import { energyBalance, type BatterySpec, type EnergyBalance, type ExportSettings, type TouPeriod } from './energy/energy-balance'
import { subHourlyAfterSolar, type SubHourlyLoad } from './energy/max-demand'
import type { WeatherYear } from './weather/reference-year'
import { year1Bills, type BillCalculator, type Year1Bills } from './finance/bill-calculator'
import { runFinance, type FinanceInput, type FinanceResult } from './finance/cashflow'
import { tornado, type Tornado } from './finance/sensitivity'

export interface CaseInput {
  weatherDatasetId: string
  pv: PvSystem
  /** Site load, kW per SAST hour, 8760 values. */
  load: readonly number[] | Float64Array
  loadAdjustment: number
  battery: BatterySpec | null
  export: ExportSettings
  touPeriods?: readonly TouPeriod[]
  /**
   * Measured sub-hourly site load (spec §2.6), when the meter data has it. Maximum demand is
   * taken from this, never from the averaged hourly profile. Same basis as `load` (before the
   * case load adjustment, which is applied to both).
   */
  subHourlyLoad?: SubHourlyLoad
}

/** Sub-hourly grid import before solar, with PV + battery, and with PV only — the MD inputs of the bills. */
export interface SubHourlyImports {
  before: SubHourlyLoad
  after: SubHourlyLoad
  afterPvOnly: SubHourlyLoad
}

export interface MonthlyEnergy {
  pvKwh: number[]
  loadKwh: number[]
  importKwh: number[]
  exportKwh: number[]
}

export interface CaseResult {
  engineVersion: string
  inputsHash: string
  weatherDatasetId: string
  weatherSource: string
  pv: PvResult
  balance: EnergyBalance
  /** Same case without the battery — the bill engine prices both to split the saving. */
  balancePvOnly: EnergyBalance
  monthly: MonthlyEnergy
  /** Present only when the input carried measured sub-hourly load. */
  subHourly?: SubHourlyImports
}

export function simulateCase(input: CaseInput, weather: { id: string; year: WeatherYear }): CaseResult {
  if (input.weatherDatasetId !== weather.id) {
    throw new Error(`weather dataset mismatch: input names ${input.weatherDatasetId}, supplied ${weather.id}`)
  }
  assert8760(input.load, 'load')
  const hash = inputsHash(input)
  const load = Float64Array.from(input.load)
  const pv = simulatePv(weather.year, input.pv)
  const common = { pvAc: pv.pAc, load, loadAdjustment: input.loadAdjustment, export: input.export, touPeriods: input.touPeriods }
  const balance = energyBalance({ ...common, battery: input.battery })
  const balancePvOnly = input.battery ? energyBalance({ ...common, battery: null }) : balance
  let subHourly: SubHourlyImports | undefined
  if (input.subHourlyLoad) {
    // The hourly balance runs on the ADJUSTED load, so the measured sub-hourly load is put on the
    // same basis before the hour's PV/battery contribution is subtracted from it.
    const k = 1 + input.loadAdjustment
    const before: SubHourlyLoad = {
      intervalMin: input.subHourlyLoad.intervalMin,
      kw: Float64Array.from(input.subHourlyLoad.kw, (v) => Math.max(0, v) * k),
    }
    subHourly = {
      before,
      after: subHourlyAfterSolar(before, balance),
      afterPvOnly: subHourlyAfterSolar(before, balancePvOnly),
    }
  }
  return {
    engineVersion: ENGINE_VERSION,
    inputsHash: hash,
    weatherDatasetId: weather.id,
    weatherSource: weather.year.source,
    pv,
    balance,
    balancePvOnly,
    monthly: {
      pvKwh: monthlySums(balance.pv),
      loadKwh: monthlySums(balance.load),
      importKwh: monthlySums(balance.import),
      exportKwh: monthlySums(balance.export),
    },
    subHourly,
  }
}

export interface FinancialsResult {
  engineVersion: string
  year1Bills: Year1Bills
  finance: FinanceResult
  /** Tornado on the first selected model's first view. */
  tornado: Tornado
}

export function runFinancials(result: CaseResult, fin: FinanceInput, bills: BillCalculator): FinancialsResult {
  if (result.balance.load.length !== HOURS_PER_YEAR) throw new Error('case result is not on the 8760 time base')
  const y1 = year1Bills(bills, result.balance, result.balancePvOnly, result.subHourly)
  const energy = {
    year1PvKwh: result.pv.annual.acKwh,
    // Delivered = generated − curtailed (export limit / export not allowed): the PPA billing base.
    year1DeliveredKwh: result.balance.kpis.pvKwh - result.balance.kpis.curtailKwh,
    bills: y1,
  }
  const finance = runFinance(fin, energy)
  const firstView = finance.models[0]!.views[0]!.view
  return { engineVersion: ENGINE_VERSION, year1Bills: y1, finance, tornado: tornado(fin, energy, 0, firstView) }
}
