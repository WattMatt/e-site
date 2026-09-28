/**
 * Hourly energy balance and battery dispatch (engine spec §4).
 *
 *   direct = min(pv, load); surplus = pv − direct; deficit = load − direct
 *   η_c = η_d = √η_rt; SoC bounded to [max(s_min, reserve)·C, s_max·C]
 *   export = min(surplus − c, limit) (0 when export is not allowed); curtail = the rest
 *   import = deficit − d + grid charging
 *
 * The TOU calendar belongs to the tariff (Phase 2a). This module takes it already resolved to
 * one period per hour, so it never needs to know a tariff's structure.
 */
import { HOURS_PER_YEAR, assert8760, sum } from '../time'

export type TouPeriod = 'off-peak' | 'standard' | 'peak'

export type BatteryStrategy =
  | { kind: 'self-consumption' }
  | { kind: 'tou-arbitrage'; gridCharging: boolean }
  | { kind: 'peak-shaving'; targetKw: number; gridCharging: boolean }

export interface BatterySpec {
  usableKwh: number
  maxChargeKw: number
  maxDischargeKw: number
  /** Round-trip efficiency, fraction (default 0.90). */
  roundTripEfficiency: number
  socMin: number
  socMax: number
  /** SoC at hour 0, fraction of usable capacity. */
  initialSoc: number
  /** Backup reserve, fraction: discharge never takes SoC below max(socMin, reserve). */
  backupReserve: number
  strategy: BatteryStrategy
}

export const DEFAULT_BATTERY_LIMITS = { roundTripEfficiency: 0.9, socMin: 0.1, socMax: 0.95 } as const

export interface ExportSettings {
  allowed: boolean
  /** kW (= kWh per hour); null = no limit. (Not Infinity: canonical JSON refuses non-finite numbers.) */
  limitKw: number | null
  /**
   * `false` = exported energy earns NO credit on the bill ("Yes (no credit)", functional spec §3.2).
   * The energy balance ignores it (the kWh still leave the site); it is carried here so it enters
   * inputs_hash and the stored run inputs, and run financials price the export at zero. Absent =
   * credited per the tariff's net-billing rules.
   */
  credited?: boolean
}

export interface EnergyBalanceInput {
  pvAc: Float64Array
  /** Site load, kW. */
  load: Float64Array
  /** Case load adjustment, fraction (e.g. 0.05 = +5 %). */
  loadAdjustment: number
  battery: BatterySpec | null
  export: ExportSettings
  /** Required when the battery strategy is TOU arbitrage or uses grid charging. */
  touPeriods?: readonly TouPeriod[]
}

export interface EnergyBalance {
  load: Float64Array
  pv: Float64Array
  direct: Float64Array
  charge: Float64Array
  gridCharge: Float64Array
  discharge: Float64Array
  /** Portion of `discharge` that came from PV-charged energy. */
  dischargeFromPv: Float64Array
  /** SoC at the END of each hour, kWh. */
  soc: Float64Array
  export: Float64Array
  curtail: Float64Array
  import: Float64Array
  kpis: {
    loadKwh: number
    pvKwh: number
    importKwh: number
    exportKwh: number
    curtailKwh: number
    selfConsumption: number
    solarFraction: number
  }
}

function validateBattery(b: BatterySpec): void {
  const frac = (n: string, v: number) => {
    if (!(v >= 0 && v <= 1)) throw new Error(`battery ${n} must be a fraction in [0, 1], got ${v}`)
  }
  if (!(b.usableKwh > 0)) throw new Error('battery usableKwh must be > 0')
  if (!(b.maxChargeKw > 0) || !(b.maxDischargeKw > 0)) throw new Error('battery charge/discharge limits must be > 0')
  if (!(b.roundTripEfficiency > 0 && b.roundTripEfficiency <= 1)) throw new Error('battery roundTripEfficiency must be in (0, 1]')
  frac('socMin', b.socMin)
  frac('socMax', b.socMax)
  frac('initialSoc', b.initialSoc)
  frac('backupReserve', b.backupReserve)
  if (b.socMin >= b.socMax) throw new Error('battery socMin must be below socMax')
  if (b.backupReserve >= b.socMax) throw new Error('battery backupReserve must be below socMax')
  if (b.strategy.kind === 'peak-shaving' && !(b.strategy.targetKw >= 0)) throw new Error('peak-shaving targetKw must be ≥ 0')
}

/** For each hour: is there a peak hour later on the same day? (TOU arbitrage keeps energy for it.) */
function peakStillAhead(periods: readonly TouPeriod[]): boolean[] {
  const out = new Array<boolean>(HOURS_PER_YEAR).fill(false)
  for (let day = 0; day < 365; day++) {
    let ahead = false
    for (let hr = 23; hr >= 0; hr--) {
      const h = day * 24 + hr
      out[h] = ahead
      if (periods[h] === 'peak') ahead = true
    }
  }
  return out
}

export function energyBalance(i: EnergyBalanceInput): EnergyBalance {
  assert8760(i.pvAc, 'pvAc')
  assert8760(i.load, 'load')
  if (!(i.loadAdjustment > -1)) throw new Error('loadAdjustment must be > −1')
  if (i.export.limitKw !== null && !(i.export.limitKw >= 0)) throw new Error('export limit must be ≥ 0')
  const exportLimit = i.export.limitKw ?? Number.POSITIVE_INFINITY
  const b = i.battery
  if (b) validateBattery(b)
  const needsTou = b !== null && (b.strategy.kind === 'tou-arbitrage' || (b.strategy.kind === 'peak-shaving' && b.strategy.gridCharging))
  if (needsTou && i.touPeriods?.length !== HOURS_PER_YEAR) {
    throw new Error('touPeriods (8760) are required for TOU arbitrage or grid charging')
  }
  const ahead = b?.strategy.kind === 'tou-arbitrage' ? peakStillAhead(i.touPeriods!) : null

  const n = HOURS_PER_YEAR
  const s = {
    load: new Float64Array(n), pv: new Float64Array(n), direct: new Float64Array(n), charge: new Float64Array(n),
    gridCharge: new Float64Array(n), discharge: new Float64Array(n), dischargeFromPv: new Float64Array(n),
    soc: new Float64Array(n), export: new Float64Array(n), curtail: new Float64Array(n), import: new Float64Array(n),
  }

  const etaC = b ? Math.sqrt(b.roundTripEfficiency) : 1
  const etaD = etaC
  const floor = b ? Math.max(b.socMin, b.backupReserve) * b.usableKwh : 0
  const ceil = b ? b.socMax * b.usableKwh : 0
  // Stored energy is tracked in two pools so discharge can be attributed to PV or grid.
  let socPv = b ? Math.max(0, Math.min(ceil, b.initialSoc * b.usableKwh)) : 0
  let socGrid = 0

  for (let h = 0; h < n; h++) {
    const load = Math.max(0, i.load[h]!) * (1 + i.loadAdjustment)
    const pv = Math.max(0, i.pvAc[h]!)
    const direct = Math.min(pv, load)
    const surplus = pv - direct
    const deficit = load - direct
    let c = 0
    let cg = 0
    let d = 0
    let dPv = 0

    if (b) {
      const soc = socPv + socGrid
      c = Math.max(0, Math.min(surplus, b.maxChargeKw, (ceil - soc) / etaC))
      const available = Math.max(0, (soc - floor) * etaD)
      const period = i.touPeriods?.[h]
      if (deficit > 0) {
        if (b.strategy.kind === 'self-consumption') d = Math.min(deficit, b.maxDischargeKw, available)
        else if (b.strategy.kind === 'tou-arbitrage') {
          if (period === 'peak' || (period === 'standard' && !ahead![h])) d = Math.min(deficit, b.maxDischargeKw, available)
        } else {
          d = Math.min(Math.max(0, deficit - b.strategy.targetKw), b.maxDischargeKw, available)
        }
      }
      const gridAllowed =
        (b.strategy.kind === 'tou-arbitrage' || b.strategy.kind === 'peak-shaving') && b.strategy.gridCharging && period === 'off-peak'
      if (gridAllowed && d === 0) {
        const room = (ceil - soc) / etaC - c
        let limit = b.maxChargeKw - c
        if (b.strategy.kind === 'peak-shaving') limit = Math.min(limit, Math.max(0, b.strategy.targetKw - deficit))
        cg = Math.max(0, Math.min(limit, room))
      }
      if (d > 0) {
        const drawn = d / etaD
        const pvShare = socPv / soc
        dPv = d * pvShare
        socPv -= drawn * pvShare
        socGrid -= drawn * (1 - pvShare)
      }
      socPv += c * etaC
      socGrid += cg * etaC
    }

    const exported = i.export.allowed ? Math.min(surplus - c, exportLimit) : 0
    s.load[h] = load
    s.pv[h] = pv
    s.direct[h] = direct
    s.charge[h] = c
    s.gridCharge[h] = cg
    s.discharge[h] = d
    s.dischargeFromPv[h] = dPv
    s.soc[h] = socPv + socGrid
    s.export[h] = exported
    s.curtail[h] = surplus - c - exported
    s.import[h] = deficit - d + cg
  }

  const loadKwh = sum(s.load)
  const pvKwh = sum(s.pv)
  const usedPv = sum(s.direct) + sum(s.dischargeFromPv)
  return {
    ...s,
    kpis: {
      loadKwh,
      pvKwh,
      importKwh: sum(s.import),
      exportKwh: sum(s.export),
      curtailKwh: sum(s.curtail),
      selfConsumption: pvKwh > 0 ? usedPv / pvKwh : 0,
      solarFraction: loadKwh > 0 ? usedPv / loadKwh : 0,
    },
  }
}
