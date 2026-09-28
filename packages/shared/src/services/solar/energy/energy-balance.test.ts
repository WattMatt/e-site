import { describe, expect, it } from 'vitest'
import { energyBalance, type BatterySpec, type EnergyBalanceInput, type TouPeriod } from './energy-balance'

const N = 8760
const daily = (f: (hourOfDay: number) => number) => Float64Array.from({ length: N }, (_, h) => f(h % 24))
// One 10 kWh PV hour at noon, a flat 4 kW load.
const PV = daily((hr) => (hr === 12 ? 10 : 0))
const LOAD = daily(() => 4)
// Off-peak 21:00–07:00, peak 18:00–20:00, standard otherwise.
const TOU: TouPeriod[] = Array.from({ length: N }, (_, h) => {
  const hr = h % 24
  return hr >= 18 && hr < 20 ? 'peak' : hr >= 7 && hr < 21 ? 'standard' : 'off-peak'
})

const battery = (over: Partial<BatterySpec> = {}): BatterySpec => ({
  usableKwh: 10,
  maxChargeKw: 5,
  maxDischargeKw: 5,
  roundTripEfficiency: 0.81, // η_c = η_d = 0.9
  socMin: 0,
  socMax: 1,
  initialSoc: 0,
  backupReserve: 0,
  strategy: { kind: 'self-consumption' },
  ...over,
})

const input = (over: Partial<EnergyBalanceInput> = {}): EnergyBalanceInput => ({
  pvAc: PV,
  load: LOAD,
  loadAdjustment: 0,
  battery: battery(),
  export: { allowed: true, limitKw: null },
  touPeriods: TOU,
  ...over,
})

function conserves(i: EnergyBalanceInput) {
  const b = energyBalance(i)
  const eta = i.battery ? Math.sqrt(i.battery.roundTripEfficiency) : 1
  let stored = i.battery ? i.battery.initialSoc * i.battery.usableKwh : 0
  for (let h = 0; h < N; h++) {
    expect(b.load[h]!).toBeCloseTo(b.direct[h]! + b.discharge[h]! + b.import[h]! - b.gridCharge[h]!, 9)
    expect(b.pv[h]!).toBeCloseTo(b.direct[h]! + b.charge[h]! + b.export[h]! + b.curtail[h]!, 9)
    stored += (b.charge[h]! + b.gridCharge[h]!) * eta - b.discharge[h]! / eta
    expect(b.soc[h]!).toBeCloseTo(stored, 9)
    for (const k of ['charge', 'gridCharge', 'discharge', 'export', 'curtail', 'import'] as const) expect(b[k][h]!).toBeGreaterThanOrEqual(-1e-12)
  }
  return b
}

describe('energy balance without a battery', () => {
  it('direct = min(pv, load); surplus exported; the rest imported', () => {
    const b = energyBalance(input({ battery: null }))
    expect(b.direct[12]).toBe(4)
    expect(b.export[12]).toBe(6)
    expect(b.import[13]).toBe(4)
    expect(b.kpis.selfConsumption).toBeCloseTo(0.4, 12)
    expect(b.kpis.solarFraction).toBeCloseTo(4 / 96, 12)
  })

  it('export limit curtails the excess; export not allowed curtails all of it', () => {
    expect(energyBalance(input({ battery: null, export: { allowed: true, limitKw: 2.5 } })).curtail[12]).toBe(3.5)
    const none = energyBalance(input({ battery: null, export: { allowed: false, limitKw: null } }))
    expect(none.export[12]).toBe(0)
    expect(none.curtail[12]).toBe(6)
  })

  it('load adjustment scales the load', () => {
    expect(energyBalance(input({ battery: null, loadAdjustment: 0.25 })).load[0]).toBe(5)
  })
})

describe('self-consumption battery (hand-computed)', () => {
  const b = conserves(input())

  it('charges min(surplus, Pc, room/η_c): 5 kW at noon → 4.5 kWh stored, 1 kWh exported', () => {
    expect(b.charge[12]).toBe(5)
    expect(b.soc[12]).toBeCloseTo(4.5, 12)
    expect(b.export[12]).toBeCloseTo(1, 12)
  })

  it('discharges min(deficit, Pd, (SoC − floor)·η_d): 4 kW at 13:00, the 0.05 kWh residue at 14:00', () => {
    expect(b.discharge[13]).toBe(4)
    expect(b.soc[13]).toBeCloseTo(4.5 - 4 / 0.9, 12)
    expect(b.discharge[14]).toBeCloseTo((4.5 - 4 / 0.9) * 0.9, 12)
    expect(b.import[14]).toBeCloseTo(4 - 0.05, 12)
  })

  it('KPIs: self-consumption (4 + 4.05)/10, solar fraction 8.05/96', () => {
    expect(b.kpis.selfConsumption).toBeCloseTo(0.805, 9)
    expect(b.kpis.solarFraction).toBeCloseTo(8.05 / 96, 9)
    expect(b.kpis.pvKwh).toBeCloseTo(3650, 9)
  })
})

describe('SoC bounds and backup reserve', () => {
  it('never exceeds s_max·C and, once above the reserve, never discharges below it', () => {
    const b = conserves(input({ battery: battery({ socMax: 0.95, backupReserve: 0.5 }) }))
    expect(Math.max(...b.soc)).toBeLessThanOrEqual(9.5 + 1e-9)
    expect(Math.min(...b.soc.slice(72))).toBeGreaterThanOrEqual(5 - 1e-9)
  })
})

describe('TOU arbitrage', () => {
  it('holds PV energy through standard time while a peak is still ahead, spends it in the peak', () => {
    const b = conserves(input({ battery: battery({ strategy: { kind: 'tou-arbitrage', gridCharging: false } }) }))
    expect(b.discharge[13]).toBe(0)
    expect(b.discharge[18]).toBe(4)
    expect(b.discharge[19]).toBeCloseTo(0.05, 12)
  })

  it('with grid charging, fills from the grid off-peak — and that energy is not counted as solar', () => {
    const b = conserves(input({ battery: battery({ strategy: { kind: 'tou-arbitrage', gridCharging: true } }) }))
    expect(b.gridCharge[0]).toBe(5)
    expect(b.import[0]).toBe(9)
    expect(b.soc[2]).toBeCloseTo(10, 12)
    expect(b.discharge[18]).toBe(4)
    expect(b.dischargeFromPv[18]).toBe(0)
  })

  it('refuses to run without the tariff TOU calendar', () => {
    expect(() => energyBalance(input({ touPeriods: undefined, battery: battery({ strategy: { kind: 'tou-arbitrage', gridCharging: false } }) }))).toThrow(
      /touPeriods \(8760\) are required/,
    )
  })
})

describe('peak shaving', () => {
  it('discharges only the load above the target', () => {
    const b = conserves(input({ battery: battery({ strategy: { kind: 'peak-shaving', targetKw: 3, gridCharging: false } }) }))
    expect(b.discharge[13]).toBe(1)
    expect(b.import[13]).toBe(3)
    expect(b.discharge[16]).toBe(1)
    expect(b.discharge[17]).toBeCloseTo((4.5 - 4 / 0.9) * 0.9, 9)
  })

  it('grid charging never lifts import above the target', () => {
    const b = conserves(input({ battery: battery({ strategy: { kind: 'peak-shaving', targetKw: 6, gridCharging: true } }) }))
    expect(Math.max(...b.import)).toBeLessThanOrEqual(6 + 1e-9)
    expect(b.gridCharge[0]).toBe(2)
  })
})

describe('validation', () => {
  it('names the bad input', () => {
    expect(() => energyBalance(input({ load: new Float64Array(10) }))).toThrow(/load must have 8760/)
    expect(() => energyBalance(input({ battery: battery({ socMin: 0.9, socMax: 0.5 }) }))).toThrow(/socMin must be below socMax/)
    expect(() => energyBalance(input({ battery: battery({ roundTripEfficiency: 90 }) }))).toThrow(/roundTripEfficiency/)
  })
})
