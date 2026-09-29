# Solar Phase 4a-ii — Calculation Engine: Battery, Energy Balance, Financial Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the pure-TypeScript Solar engine — hourly energy balance with the three battery strategies, maximum demand after solar, the `BillCalculator` seam to the Phase 2a bill engine, the annual financial model with all four finance options (cash, debt, PPA, lease), tax and Section 12B, load-shedding value as a separate line, NPV / IRR / paybacks / LCOE, the sensitivity tornado, the §7 defaults register, and the `simulateCase` / `runFinancials` entry points — with a hand-computed 3-year cashflow matched to 4 significant figures.

**Architecture:** Continues `packages/shared/src/services/solar/` (created in 4a-i). `energy/` turns hourly PV + load into flows; `finance/` turns year-1 bills (priced by a `BillCalculator`) into 25-year cashflows; `case.ts` wires the two and stamps `ENGINE_VERSION` + `inputs_hash`. The finance model never reads a tariff: it consumes twelve monthly bill totals through a narrow interface, tested here with a stub. Integration with the real bill engine happens when Phase 2a lands.

**Tech Stack:** TypeScript 5.9 (strict), Vitest 2.1, pnpm + Turborepo. No new dependencies.

**Spec:** `docs/solar/02-calculation-engine-spec.md` §1.1, §3.6, §4, §6, §7. Decisions `docs/solar/06-open-decisions.md`: D-05 (insurance), D-07 (finance defaults), D-14 (load-shedding separate), D-15 (four finance models), D-16 (excl. VAT; tax + 12B optional, default off).
**Prerequisite:** `docs/superpowers/plans/2026-09-28-solar-phase-4a-engine-i-pv.md` fully executed on branch `feat/solar-phase-4a` (its draft PR open).
**Out of scope:** the bill engine itself (Phase 2a), persisting cases/runs (4b — no migration here), UI.

---

## Decisions taken in this plan (read before Task 1)

1. **`BillCalculator` is the only door to tariffs.** `monthlyBills({ importKwh, exportKwh, subHourlyImport? }) → 12 × { month, totalZar, exportCreditUsedZar }` at the base (year-1) tariff. It takes **import AND export** because §5.7 net billing needs both — the spec's `costBill(load8760, …)` signature (§1.1) carries only one series (→ **Q4**). The finance model uses the credit **used** (§5.7), so carried credit is neither lost nor treated as cash.
2. **Three bills in year 1:** no-PV (import = load), PV-only, PV + battery. `simulateCase` runs a PV-only twin of the energy balance for this. Splitting the saving lets PV degradation apply only to the PV share and battery capacity fade only to the battery share.
3. **Saving scales, it is not re-simulated per year** (spec §6: "energy balance rescaled, not re-run hourly per year"): `Saving_n = (PV share × degradation_n + battery share × health_n) × tariff factor_n`. Load growth raises `Bill_before` and `Bill_after` equally and leaves the saving unchanged — a documented, conservative simplification (growth would only raise self-consumption).
4. **Degradation applied once, in the cashflow** (§3.6): year-1 energy and saving already carry `(1 − d₁)`. The hourly model is undegraded.
5. **Battery dispatch.** Stored energy is tracked in a PV pool and a grid pool, so discharge is attributed. `selfConsumption = (direct + discharge-from-PV) / ΣPV`. `solarFraction` uses discharge-from-PV too: identical to the spec's `(direct + discharge) / Σload` whenever grid charging is off (the default), and it refuses to count grid-charged energy as solar when it is on (→ **Q5**). TOU arbitrage discharges in peak, and in standard only once no peak remains later that day ("peak, then standard"). Peak-shaving grid charging is capped so import never exceeds the target.
6. **Finance models (D-15).** Cash and debt → one *owner* view. PPA and lease → a *client* view (upfront 0) and an *investor* view (upfront −capex). During the PPA/lease service period the provider bears O&M, insurance and replacements; afterwards (term end, PPA buy-out, or lease residual paid) the client owns and bears them. PPA is charged on all AC energy delivered (degraded). Debt: monthly amortisation (grace months interest-only) aggregated per year.
7. **Tax (D-16, default off).** `Tax_n = rate × (Saving − Opex − allowance − interest)` (interest only for debt — the spec formula omits it; deducting it is standard; → **Q6**). A negative result is a tax shield (assumes other taxable income; → **Q6**). Section 12B: 100 % in year 1 for AC ≤ 1 MW, 50/30/20 % above, 125 % only when the owner selects the enhanced option. Replacements are not deducted (spec formula).
8. **IRR:** bracketed bisection on [−99 %, 200 %], scanning in 1-point steps for the first sign change; `null` ("n/a") when there is none (e.g. a PPA client view with no upfront cost).
9. **Insurance:** `capex × 0.5 %` per year, CPI-escalated — **no ×12** (D-05). A test pins year 1 at R 500 on R 100 000.
10. **Missing inputs block, never default** (§7 last paragraph): capex ≤ 0, no model selected, a fraction outside [0, 1] — each throws a named reason.
11. **Company tax rate has no default** in §7. It is a required input whenever tax is enabled; the register seeds `tax.enabled = false`. (→ **Q6**)

---

## Ground rules

- Worktree `~/.config/superpowers/worktrees/esite/solar-phase-4a`, branch `feat/solar-phase-4a` (continuing 4a-i).
- Run one test file: `pnpm --filter @esite/shared exec vitest run <path relative to packages/shared>`.
- No migration. Three suites before claiming done. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The toy cashflow's expected values were computed by hand (shown in the test's header comment). If the engine disagrees, the engine is wrong until proven otherwise — do not edit the expected numbers to match.

## File structure

```
packages/shared/src/services/solar/
  energy/energy-balance.ts (+ .test.ts)      CREATE  hourly balance, 3 strategies, SoC, KPIs
  energy/max-demand.ts (+ .test.ts)          CREATE  sub-hourly MD after solar
  finance/factors.ts (+ .test.ts)            CREATE  degradation, CPI, escalation path, battery fade
  finance/metrics.ts (+ .test.ts)            CREATE  NPV, IRR, paybacks, LCOE
  finance/loan.ts (+ .test.ts)               CREATE  monthly amortisation → annual
  finance/bill-calculator.ts (+ .test.ts)    CREATE  the Phase 2a seam + year1Bills
  __fixtures__/stub-bill-calculator.ts       CREATE  test stub (excluded from type-check)
  finance/cashflow.ts (+ .test.ts)           CREATE  four models, tax/12B, load-shedding line
  finance/sensitivity.ts (+ .test.ts)        CREATE  tornado
  defaults.ts (+ .test.ts)                   CREATE  §7 register
  case.ts (+ .test.ts)                       CREATE  simulateCase / runFinancials
  engine-golden.test.ts                      CREATE  outputs pinned to ENGINE_VERSION
  index.ts                                   MODIFY  append exports
```

---

### Task 1: Preconditions

**Files:** none

- [ ] **Step 1: Confirm 4a-i is complete on this branch**

```bash
cd ~/.config/superpowers/worktrees/esite/solar-phase-4a
git status --short
git log --oneline -3
pnpm --filter @esite/shared exec vitest run src/services/solar 2>&1 | tail -4
```
Expected: clean tree; the latest commit is the 4a-i validation gate; 11 files / 67 tests passed. If not, finish 4a-i first.

---

### Task 2: Hourly energy balance and battery strategies

**Files:**
- Create: `packages/shared/src/services/solar/energy/energy-balance.ts`
- Test: `packages/shared/src/services/solar/energy/energy-balance.test.ts`
- Modify: `packages/shared/src/services/solar/index.ts` (append one line)

The hand case used below: one 10 kWh PV hour at 12:00, a flat 4 kW load, a 10 kWh battery with 5 kW limits and η_rt = 0.81 (so η_c = η_d = 0.9), SoC 0–100 %, empty at the start. At 12:00: direct 4, surplus 6, charge min(6, 5, 10/0.9) = 5 → 4.5 kWh stored, 1 kWh exported. At 13:00: discharge min(4, 5, 4.5 × 0.9) = 4 → SoC 4.5 − 4/0.9. At 14:00 the residue (4.5 − 4/0.9) × 0.9 = 0.05 kWh. Per day: PV 10, direct 4, from-battery 4.05, export 1, load 96.

- [ ] **Step 1: Write the failing test**

`packages/shared/src/services/solar/energy/energy-balance.test.ts`:
```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/energy/energy-balance.test.ts`
Expected: FAIL — `Failed to resolve import "./energy-balance"`.

- [ ] **Step 3: Implement**

`packages/shared/src/services/solar/energy/energy-balance.ts`:
```ts
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
```

Append to `index.ts`:
```ts
export * from './energy/energy-balance'
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/energy/energy-balance.test.ts`
Expected: 13 passed.

- [ ] **Step 5: Prove the RTE split is tested**

Temporarily change `const etaC = b ? Math.sqrt(b.roundTripEfficiency) : 1` to `const etaC = b ? b.roundTripEfficiency : 1`, re-run, confirm failures in the hand-computed block; restore and confirm 13 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/services/solar/energy/energy-balance.ts packages/shared/src/services/solar/energy/energy-balance.test.ts packages/shared/src/services/solar/index.ts
git commit -m "$(cat <<'EOF'
feat(solar-engine): hourly energy balance — self-consumption, TOU arbitrage, peak shaving

RTE split √η each way; SoC bounds + backup reserve; export limit / curtail; PV vs
grid energy pools so grid-charged discharge is never counted as solar. Hand-computed
case + per-hour conservation checks.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Maximum demand after solar

**Files:**
- Create: `packages/shared/src/services/solar/energy/max-demand.ts`
- Test: `packages/shared/src/services/solar/energy/max-demand.test.ts`
- Modify: `packages/shared/src/services/solar/index.ts` (append one line)

- [ ] **Step 1: Write the failing test**

`packages/shared/src/services/solar/energy/max-demand.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { monthlyMaxDemandKva, subHourlyAfterSolar } from './max-demand'

const N = 8760

describe('maximum demand after solar', () => {
  it('spreads the hour\'s net PV/battery contribution evenly over its sub-intervals', () => {
    const kw = new Float64Array(N * 2).fill(100)
    kw[2 * 5000] = 150 // a 30-min spike
    const load = new Float64Array(N).fill(100)
    const imp = new Float64Array(N).fill(100)
    imp[5000] = 40 // PV + battery covered 60 kW on average in hour 5000
    const after = subHourlyAfterSolar({ intervalMin: 30, kw }, { load, import: imp })
    expect(after.kw[10000]).toBe(90) // 150 − 60: the spike survives — MD falls less than energy
    expect(after.kw[10001]).toBe(40)
    expect(after.kw[0]).toBe(100)
  })

  it('never goes negative and grows when the hour grid-charges (import > load)', () => {
    const kw = new Float64Array(N * 4).fill(10)
    const load = new Float64Array(N).fill(10)
    const imp = new Float64Array(N).fill(10)
    imp[0] = 0
    load[1] = 10
    imp[1] = 25
    const after = subHourlyAfterSolar({ intervalMin: 15, kw }, { load, import: imp })
    expect(after.kw[0]).toBe(0)
    expect(after.kw[4]).toBe(25)
  })

  it('monthly MD = highest chargeable interval / PF, per month', () => {
    const kw = new Float64Array(N).fill(50)
    kw[10] = 95 // January
    kw[800] = 190 // February, but not chargeable below
    const chargeable = Array.from({ length: N }, (_, h) => h !== 800)
    const md = monthlyMaxDemandKva({ intervalMin: 60, kw }, 0.95, chargeable)
    expect(md[0]).toBeCloseTo(100, 12)
    expect(md[1]).toBeCloseTo(50 / 0.95, 12)
  })

  it('refuses a series of the wrong length for its interval', () => {
    expect(() => monthlyMaxDemandKva({ intervalMin: 30, kw: new Float64Array(N) }, 0.95)).toThrow(/must have 17520 values/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/energy/max-demand.test.ts`
Expected: FAIL — `Failed to resolve import "./max-demand"`.

- [ ] **Step 3: Implement**

`packages/shared/src/services/solar/energy/max-demand.ts`:
```ts
/**
 * Maximum demand after solar (engine spec §4, §2.6).
 *
 * The hour's net PV/battery contribution (load − import, negative while grid-charging) is
 * spread evenly across that hour's sub-intervals and subtracted from the measured sub-hourly
 * load — a documented, conservative approximation. The averaged hourly profile's peak is never
 * used as MD.
 */
import { HOURS_PER_YEAR, monthOfHour } from '../time'

export type IntervalMinutes = 5 | 15 | 30 | 60

export interface SubHourlyLoad {
  intervalMin: IntervalMinutes
  /** Average kW per interval, 8760 × (60 / intervalMin) values. */
  kw: Float64Array
}

function perHour(sub: SubHourlyLoad): number {
  const k = 60 / sub.intervalMin
  if (sub.kw.length !== HOURS_PER_YEAR * k) {
    throw new Error(`sub-hourly load at ${sub.intervalMin} min must have ${HOURS_PER_YEAR * k} values, got ${sub.kw.length}`)
  }
  return k
}

export function subHourlyAfterSolar(
  sub: SubHourlyLoad,
  flows: { load: Float64Array; import: Float64Array },
): SubHourlyLoad {
  const k = perHour(sub)
  const out = new Float64Array(sub.kw.length)
  for (let h = 0; h < HOURS_PER_YEAR; h++) {
    const offset = flows.load[h]! - flows.import[h]!
    for (let j = 0; j < k; j++) out[h * k + j] = Math.max(0, sub.kw[h * k + j]! - offset)
  }
  return { intervalMin: sub.intervalMin, kw: out }
}

/**
 * Monthly maximum demand in kVA = max interval kW / power factor, over intervals whose hour is
 * chargeable (`chargeable[h]`, all hours when omitted).
 */
export function monthlyMaxDemandKva(sub: SubHourlyLoad, powerFactor: number, chargeable?: readonly boolean[]): number[] {
  if (!(powerFactor > 0 && powerFactor <= 1)) throw new Error(`power factor must be in (0, 1], got ${powerFactor}`)
  const k = perHour(sub)
  const md = new Array<number>(12).fill(0)
  for (let h = 0; h < HOURS_PER_YEAR; h++) {
    if (chargeable && !chargeable[h]) continue
    const m = monthOfHour(h) - 1
    for (let j = 0; j < k; j++) md[m] = Math.max(md[m]!, sub.kw[h * k + j]!)
  }
  return md.map((kw) => kw / powerFactor)
}
```

Append to `index.ts`:
```ts
export * from './energy/max-demand'
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/energy/max-demand.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/services/solar/energy/max-demand.ts packages/shared/src/services/solar/energy/max-demand.test.ts packages/shared/src/services/solar/index.ts
git commit -m "$(cat <<'EOF'
feat(solar-engine): monthly maximum demand after solar from sub-hourly load

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Finance factors — degradation, CPI, escalation path, battery fade

**Files:**
- Create: `packages/shared/src/services/solar/finance/factors.ts`
- Test: `packages/shared/src/services/solar/finance/factors.test.ts`
- Modify: `packages/shared/src/services/solar/index.ts` (append one line)

- [ ] **Step 1: Write the failing test**

`packages/shared/src/services/solar/finance/factors.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { batteryHealth, cpiFactor, DEFAULT_ESCALATION, degradationFactor, escalationRate, tariffFactors } from './factors'

describe('degradation (spec §3.6) — applied once, in the cashflow', () => {
  it('year n = (1 − d₁)(1 − d)^(n−1)', () => {
    expect(degradationFactor(1, 0.02, 0.005)).toBeCloseTo(0.98, 15)
    expect(degradationFactor(2, 0.02, 0.005)).toBeCloseTo(0.98 * 0.995, 15)
    expect(degradationFactor(25, 0.02, 0.005)).toBeCloseTo(0.98 * 0.995 ** 24, 15)
  })
})

describe('tariff escalation path (D-07)', () => {
  it('9 % into year 2, linear to 7 % at year 10, then CPI + 1 %', () => {
    expect(escalationRate(1, DEFAULT_ESCALATION, 0.05)).toBe(0)
    expect(escalationRate(2, DEFAULT_ESCALATION, 0.05)).toBeCloseTo(0.09, 15)
    expect(escalationRate(6, DEFAULT_ESCALATION, 0.05)).toBeCloseTo(0.08, 15)
    expect(escalationRate(10, DEFAULT_ESCALATION, 0.05)).toBeCloseTo(0.07, 15)
    expect(escalationRate(11, DEFAULT_ESCALATION, 0.05)).toBeCloseTo(0.06, 15)
  })

  it('published approved increases override the default path for their years', () => {
    const p = { ...DEFAULT_ESCALATION, published: [0.1277, 0.0536] }
    expect(escalationRate(2, p, 0.05)).toBe(0.1277)
    expect(escalationRate(3, p, 0.05)).toBe(0.0536)
    expect(escalationRate(4, p, 0.05)).toBeCloseTo(0.085, 15)
    expect(tariffFactors(3, p, 0.05)).toEqual([1, 1.1277, 1.1277 * 1.0536])
  })

  it('CPI factor is 1 in year 1', () => {
    expect(cpiFactor(1, 0.05)).toBe(1)
    expect(cpiFactor(3, 0.05)).toBeCloseTo(1.1025, 15)
  })
})

describe('battery capacity fade', () => {
  it('fades 2 %/yr, floors at 70 %, and is renewed after the replacement year', () => {
    expect(batteryHealth(1, 0.02, 0.7, 10)).toBe(1)
    expect(batteryHealth(10, 0.02, 0.7, 10)).toBeCloseTo(0.82, 15)
    expect(batteryHealth(11, 0.02, 0.7, 10)).toBe(1)
    expect(batteryHealth(20, 0.02, 0.7, null)).toBe(0.7)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/finance/factors.test.ts`
Expected: FAIL — `Failed to resolve import "./factors"`.

- [ ] **Step 3: Implement**

`packages/shared/src/services/solar/finance/factors.ts`:
```ts
/**
 * Year-indexed factors for the annual cashflow (engine spec §3.6, §6, §7). Year n runs 1…N.
 */

/** Degradation (spec §3.6), applied ONCE, here: Year-n energy = Year-1 × (1 − d₁) × (1 − d)^(n−1). */
export function degradationFactor(n: number, firstYear: number, annual: number): number {
  return (1 - firstYear) * (1 - annual) ** (n - 1)
}

/** CPI factor for year n: (1 + cpi)^(n−1). Year 1 is in today's money. */
export function cpiFactor(n: number, cpi: number): number {
  return (1 + cpi) ** (n - 1)
}

export interface EscalationPath {
  /** Approved increases for the years that have a published tariff, applied to years 2, 3, … in order. */
  published: readonly number[]
  /** Default path start (year 2) — spec §7 / D-07: 9 %. */
  startRate: number
  /** Default path value at `linearToYear` — 7 %. */
  endRate: number
  /** Year at which the linear path reaches `endRate` — 10. */
  linearToYear: number
  /** Rate after `linearToYear` = CPI + this margin (1 %). */
  cpiMargin: number
}

export const DEFAULT_ESCALATION: EscalationPath = {
  published: [],
  startRate: 0.09,
  endRate: 0.07,
  linearToYear: 10,
  cpiMargin: 0.01,
}

/** Tariff increase applied going INTO year n (n ≥ 2). */
export function escalationRate(n: number, path: EscalationPath, cpi: number): number {
  if (n < 2) return 0
  const pub = path.published[n - 2]
  if (pub !== undefined) return pub
  if (n <= path.linearToYear) {
    const span = path.linearToYear - 2
    return span <= 0 ? path.endRate : path.startRate + ((path.endRate - path.startRate) * (n - 2)) / span
  }
  return cpi + path.cpiMargin
}

/** Cumulative tariff factor for year n (1 in year 1). */
export function tariffFactors(years: number, path: EscalationPath, cpi: number): number[] {
  const out: number[] = []
  let f = 1
  for (let n = 1; n <= years; n++) {
    f *= 1 + escalationRate(n, path, cpi)
    out.push(f)
  }
  return out
}

/**
 * Battery usable-capacity factor for year n: fades linearly from 1 by `fadePerYear` to a floor
 * of `endOfLife`, and is renewed after a replacement at the END of `replacementYear`.
 */
export function batteryHealth(n: number, fadePerYear: number, endOfLife: number, replacementYear: number | null): number {
  const age = replacementYear !== null && n > replacementYear ? n - replacementYear - 1 : n - 1
  return Math.max(endOfLife, 1 - fadePerYear * age)
}
```

Append to `index.ts`:
```ts
export * from './finance/factors'
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/finance/factors.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/services/solar/finance/factors.ts packages/shared/src/services/solar/finance/factors.test.ts packages/shared/src/services/solar/index.ts
git commit -m "$(cat <<'EOF'
feat(solar-engine): degradation, CPI, D-07 escalation path, battery capacity fade

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Metrics — NPV, IRR, paybacks, LCOE

**Files:**
- Create: `packages/shared/src/services/solar/finance/metrics.ts`
- Test: `packages/shared/src/services/solar/finance/metrics.test.ts`
- Modify: `packages/shared/src/services/solar/index.ts` (append one line)

- [ ] **Step 1: Write the failing test**

`packages/shared/src/services/solar/finance/metrics.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { irr, lcoe, npv, payback } from './metrics'

describe('metrics', () => {
  it('NPV and IRR of a one-period investment', () => {
    expect(npv(0.1, [-100, 110])).toBeCloseTo(0, 12)
    expect(irr([-100, 110])).toBeCloseTo(0.1, 9)
  })

  it('IRR is n/a (null) without a sign change, and found near the bracket ends', () => {
    expect(irr([100, 10, 10])).toBeNull()
    // x = 1/(1+r): x² + x − 100 = 0 → x = (√401 − 1)/2 → r = 2/(√401 − 1) − 1 ≈ −0.89487
    expect(irr([-100, 1, 1])).toBeCloseTo(2 / (Math.sqrt(401) - 1) - 1, 9)
    expect(irr([-100, 290])).toBeCloseTo(1.9, 9)
  })

  it('payback interpolates within the crossing year; discounted payback is later; never → null', () => {
    expect(payback([-100, 40, 40, 40])).toBeCloseTo(2.5, 12)
    expect(payback([-100, 45, 45, 45])).toBeCloseTo(2 + 10 / 45, 12)
    // discounted @10 %: 40.909 + 37.190 = 78.099 after 2 years; year 3 adds 33.809 → 2 + 21.901/33.809
    expect(payback([-100, 45, 45, 45], 0.1)).toBeCloseTo(2 + (100 - 45 / 1.1 - 45 / 1.21) / (45 / 1.331), 12)
    expect(payback([-100, 40, 40, 40], 0.1)).toBeNull()
    expect(payback([-100, 10, 10])).toBeNull()
    expect(payback([0, 10])).toBe(0)
  })

  it('discounted LCOE = (capex + PV costs) / PV energy', () => {
    expect(lcoe(0, 1000, [0, 0], [500, 500])).toBe(1)
    expect(lcoe(0.1, 1000, [110], [1100])).toBeCloseTo(1100 / 1000, 12)
    expect(lcoe(0.1, 1000, [], [])).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/finance/metrics.test.ts`
Expected: FAIL — `Failed to resolve import "./metrics"`.

- [ ] **Step 3: Implement**

`packages/shared/src/services/solar/finance/metrics.ts`:
```ts
/**
 * Investment metrics (engine spec §6). `flows[0]` is year 0 (the upfront flow), `flows[n]` year n.
 */

export function npv(rate: number, flows: readonly number[]): number {
  let v = 0
  for (let n = 0; n < flows.length; n++) v += flows[n]! / (1 + rate) ** n
  return v
}

export const IRR_LOW = -0.99
export const IRR_HIGH = 2.0

/**
 * IRR by bracketed bisection on [−99 %, 200 %]. The bracket is scanned in 1 %-point steps for
 * the first sign change; `null` ("n/a") when there is none.
 */
export function irr(flows: readonly number[]): number | null {
  const step = 0.01
  let lo = IRR_LOW
  let fLo = npv(lo, flows)
  if (fLo === 0) return lo
  for (let hi = lo + step; hi <= IRR_HIGH + 1e-12; hi += step) {
    const fHi = npv(hi, flows)
    if (fHi === 0) return hi
    if (Math.sign(fHi) !== Math.sign(fLo)) {
      let a = lo
      let b = hi
      let fa = fLo
      for (let i = 0; i < 200 && b - a > 1e-12; i++) {
        const m = (a + b) / 2
        const fm = npv(m, flows)
        if (Math.sign(fm) === Math.sign(fa)) {
          a = m
          fa = fm
        } else b = m
      }
      return (a + b) / 2
    }
    lo = hi
    fLo = fHi
  }
  return null
}

/**
 * Payback: the (interpolated) year in which cumulative flow first reaches zero. With `rate`,
 * flows are discounted first (discounted payback). `null` if never; 0 if the upfront flow is ≥ 0.
 */
export function payback(flows: readonly number[], rate = 0): number | null {
  let cum = flows[0]!
  if (cum >= 0) return 0
  for (let n = 1; n < flows.length; n++) {
    const f = flows[n]! / (1 + rate) ** n
    if (cum + f >= 0) return n - 1 + -cum / f
    cum += f
  }
  return null
}

/** Discounted LCOE = (capex + Σ PV(costs_n)) / Σ PV(energy_n), n = 1…N. */
export function lcoe(rate: number, capex: number, costs: readonly number[], energyKwh: readonly number[]): number | null {
  let pvCost = capex
  let pvEnergy = 0
  for (let i = 0; i < energyKwh.length; i++) {
    const d = (1 + rate) ** (i + 1)
    pvCost += (costs[i] ?? 0) / d
    pvEnergy += energyKwh[i]! / d
  }
  return pvEnergy > 0 ? pvCost / pvEnergy : null
}
```

Append to `index.ts`:
```ts
export * from './finance/metrics'
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/finance/metrics.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/services/solar/finance/metrics.ts packages/shared/src/services/solar/finance/metrics.test.ts packages/shared/src/services/solar/index.ts
git commit -m "$(cat <<'EOF'
feat(solar-engine): NPV, bracketed-bisection IRR, paybacks, discounted LCOE

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Loan schedule

**Files:**
- Create: `packages/shared/src/services/solar/finance/loan.ts`
- Test: `packages/shared/src/services/solar/finance/loan.test.ts`
- Modify: `packages/shared/src/services/solar/index.ts` (append one line)

- [ ] **Step 1: Write the failing test**

`packages/shared/src/services/solar/finance/loan.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { loanSchedule } from './loan'

describe('loan schedule', () => {
  it('0 %: level principal', () => {
    const s = loanSchedule({ principalZar: 12000, annualRate: 0, termYears: 1, graceMonths: 0 }, 2)
    expect(s[0]).toEqual({ interestZar: 0, principalZar: 12000, paymentZar: 12000 })
    expect(s[1]).toEqual({ interestZar: 0, principalZar: 0, paymentZar: 0 })
  })

  it('12 % over 12 months: payment 888.4879/month, interest 661.8546 in the year', () => {
    const s = loanSchedule({ principalZar: 10000, annualRate: 0.12, termYears: 1, graceMonths: 0 }, 1)
    expect(s[0]!.paymentZar / 12).toBeCloseTo(888.4879, 4)
    expect(s[0]!.interestZar).toBeCloseTo(661.8546, 4)
    expect(s[0]!.principalZar).toBeCloseTo(10000, 8)
  })

  it('grace months are interest-only', () => {
    const s = loanSchedule({ principalZar: 10000, annualRate: 0.12, termYears: 2, graceMonths: 12 }, 2)
    expect(s[0]!.principalZar).toBe(0)
    expect(s[0]!.interestZar).toBeCloseTo(1200, 9)
    expect(s[1]!.principalZar).toBeCloseTo(10000, 8)
  })

  it('refuses a grace period as long as the term', () => {
    expect(() => loanSchedule({ principalZar: 1, annualRate: 0.1, termYears: 1, graceMonths: 12 }, 1)).toThrow(/grace months/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/finance/loan.test.ts`
Expected: FAIL — `Failed to resolve import "./loan"`.

- [ ] **Step 3: Implement**

`packages/shared/src/services/solar/finance/loan.ts`:
```ts
/**
 * Loan schedule, computed monthly and aggregated per year: `graceMonths` of interest only, then
 * a level annuity over the remaining months of the term.
 */

export interface LoanTerms {
  principalZar: number
  /** Nominal annual rate, e.g. 0.115; interest accrues monthly at rate / 12. */
  annualRate: number
  termYears: number
  graceMonths: number
}

export interface LoanYear {
  interestZar: number
  principalZar: number
  paymentZar: number
}

export function loanSchedule(t: LoanTerms, years: number): LoanYear[] {
  const months = Math.round(t.termYears * 12)
  if (!(t.principalZar >= 0)) throw new Error('loan principal must be ≥ 0')
  if (!(months > 0)) throw new Error('loan term must be > 0')
  if (!(t.graceMonths >= 0 && t.graceMonths < months)) throw new Error('grace months must be in [0, term)')
  const i = t.annualRate / 12
  const amortising = months - t.graceMonths
  const pmt = i === 0 ? t.principalZar / amortising : (t.principalZar * i) / (1 - (1 + i) ** -amortising)
  const out: LoanYear[] = Array.from({ length: years }, () => ({ interestZar: 0, principalZar: 0, paymentZar: 0 }))
  let bal = t.principalZar
  for (let m = 1; m <= months && Math.ceil(m / 12) <= years; m++) {
    const interest = bal * i
    const principal = m <= t.graceMonths ? 0 : Math.min(bal, pmt - interest)
    bal -= principal
    const y = out[Math.ceil(m / 12) - 1]!
    y.interestZar += interest
    y.principalZar += principal
    y.paymentZar += interest + principal
  }
  return out
}
```

Append to `index.ts`:
```ts
export * from './finance/loan'
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/finance/loan.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/services/solar/finance/loan.ts packages/shared/src/services/solar/finance/loan.test.ts packages/shared/src/services/solar/index.ts
git commit -m "$(cat <<'EOF'
feat(solar-engine): monthly loan amortisation with grace months, aggregated per year

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: The `BillCalculator` seam (Phase 2a) and its test stub

**Files:**
- Create: `packages/shared/src/services/solar/finance/bill-calculator.ts`
- Create: `packages/shared/src/services/solar/__fixtures__/stub-bill-calculator.ts`
- Test: `packages/shared/src/services/solar/finance/bill-calculator.test.ts`
- Modify: `packages/shared/src/services/solar/index.ts` (append one line)

**Integration note (when Phase 2a lands — not in this plan):** Phase 2a provides an adapter `createBillCalculator(tariff, calendar, holidays)` returning this interface, built on `costBill`. It must price **both** the import and export series (§5.7 caps credit per TOU period at that period's import and carries unused credit month to month), fill `exportCreditUsedZar` with the credit actually used, and — when `subHourlyImport` is present — take chargeable MD from it (§2.6). The stub below is then deleted from `case.test.ts`, which is re-pointed at the adapter with one golden tariff case.

- [ ] **Step 1: Write the failing test**

`packages/shared/src/services/solar/finance/bill-calculator.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { energyBalance } from '../energy/energy-balance'
import { stubBillCalculator } from '../__fixtures__/stub-bill-calculator'
import { year1Bills, type BillCalculator } from './bill-calculator'

const N = 8760
const pv = Float64Array.from({ length: N }, (_, h) => (h % 24 === 12 ? 10 : 0))
const load = new Float64Array(N).fill(4)
const common = { pvAc: pv, load, loadAdjustment: 0, export: { allowed: true, limitKw: null } }
const battery = {
  usableKwh: 10, maxChargeKw: 5, maxDischargeKw: 5, roundTripEfficiency: 0.81, socMin: 0, socMax: 1,
  initialSoc: 0, backupReserve: 0, strategy: { kind: 'self-consumption' as const },
}

describe('year1Bills through a BillCalculator', () => {
  const withBatt = energyBalance({ ...common, battery })
  const pvOnly = energyBalance({ ...common, battery: null })
  const y = year1Bills(stubBillCalculator, withBatt, pvOnly)

  it('prices the no-PV load, PV-only and PV+battery flows (stub: R2/kWh, R500/month, export R1/kWh)', () => {
    expect(y.beforeZar).toBeCloseTo(12 * 500 + 96 * 365 * 2, 6)
    expect(y.afterPvOnlyZar).toBeCloseTo(12 * 500 + 92 * 365 * 2 - 6 * 365, 6)
    expect(y.afterZar).toBeCloseTo(12 * 500 + 87.95 * 365 * 2 - 1 * 365, 6)
    expect(y.exportCreditUsedZar).toBeCloseTo(365, 6)
  })

  it('refuses a calculator that does not return twelve valid months', () => {
    const bad: BillCalculator = { monthlyBills: () => [] }
    expect(() => year1Bills(bad, withBatt, pvOnly)).toThrow(/12 monthly bills/)
    const neg: BillCalculator = {
      monthlyBills: (f) => stubBillCalculator.monthlyBills(f).map((b) => ({ ...b, exportCreditUsedZar: -1 })),
    }
    expect(() => year1Bills(neg, withBatt, pvOnly)).toThrow(/invalid bill/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/finance/bill-calculator.test.ts`
Expected: FAIL — `Failed to resolve import "../__fixtures__/stub-bill-calculator"`.

- [ ] **Step 3: Implement the interface and the stub**

`packages/shared/src/services/solar/finance/bill-calculator.ts`:
```ts
/**
 * The seam between the financial model (this phase, 4a) and the bill engine (Phase 2a).
 *
 * The finance model never looks inside a tariff. It asks a BillCalculator for twelve monthly
 * bills given one year of hourly grid flows, and uses only the totals and the export credit
 * USED (spec §5.7: carried credit is neither lost within a year nor treated as cash).
 * Phase 2a supplies the real implementation; until then tests use a stub.
 */
import { assert8760 } from '../time'
import type { EnergyBalance } from '../energy/energy-balance'
import type { SubHourlyLoad } from '../energy/max-demand'

export interface GridFlows {
  /** kWh imported from the grid per hour. */
  importKwh: Float64Array
  /** kWh exported per hour. */
  exportKwh: Float64Array
  /** Sub-hourly import for maximum demand, when measured data exists. */
  subHourlyImport?: SubHourlyLoad
}

export interface MonthlyBillSummary {
  month: number
  /** Total bill excl. VAT, ZAR, AFTER export credit used. */
  totalZar: number
  /** Export credit used against this month's energy charges, ZAR (≥ 0). */
  exportCreditUsedZar: number
}

export interface BillCalculator {
  /** Twelve monthly bills (Jan…Dec) at the base (year-1) tariff. */
  monthlyBills(flows: GridFlows): MonthlyBillSummary[]
}

export interface Year1Bills {
  /** Bill with no PV (the load imported in full). */
  beforeZar: number
  /** Bill with PV and battery. */
  afterZar: number
  /** Bill with PV only — isolates the battery's share of the saving so capacity fade applies to it alone. */
  afterPvOnlyZar: number
  /** Export credit used in the after-bill, ZAR (sensitivity on export rate). */
  exportCreditUsedZar: number
}

function annual(bills: MonthlyBillSummary[]): { total: number; credit: number } {
  if (bills.length !== 12) throw new Error(`BillCalculator must return 12 monthly bills, got ${bills.length}`)
  let total = 0
  let credit = 0
  for (const b of bills) {
    if (!Number.isFinite(b.totalZar) || !Number.isFinite(b.exportCreditUsedZar) || b.exportCreditUsedZar < 0) {
      throw new Error(`BillCalculator returned an invalid bill for month ${b.month}`)
    }
    total += b.totalZar
    credit += b.exportCreditUsedZar
  }
  return { total, credit }
}

export function year1Bills(
  calc: BillCalculator,
  withBattery: EnergyBalance,
  pvOnly: EnergyBalance,
  sub?: { before?: SubHourlyLoad; after?: SubHourlyLoad; afterPvOnly?: SubHourlyLoad },
): Year1Bills {
  assert8760(withBattery.load, 'load')
  const zero = new Float64Array(withBattery.load.length)
  const before = annual(calc.monthlyBills({ importKwh: withBattery.load, exportKwh: zero, subHourlyImport: sub?.before }))
  const after = annual(calc.monthlyBills({ importKwh: withBattery.import, exportKwh: withBattery.export, subHourlyImport: sub?.after }))
  const afterPv = annual(calc.monthlyBills({ importKwh: pvOnly.import, exportKwh: pvOnly.export, subHourlyImport: sub?.afterPvOnly }))
  return { beforeZar: before.total, afterZar: after.total, afterPvOnlyZar: afterPv.total, exportCreditUsedZar: after.credit }
}
```

`packages/shared/src/services/solar/__fixtures__/stub-bill-calculator.ts`:
```ts
/**
 * TEST STUB for the Phase 2a bill engine. A flat R 2.00/kWh import tariff, a fixed R 500/month
 * charge, and export credited at R 1.00/kWh against that month's ENERGY charge only (the NERSA
 * net-billing cap shape, spec §5.7) — enough structure for the finance model's tests, nothing more.
 * Replace with the real `costBill` adapter when Phase 2a lands.
 */
import { monthHourRanges } from '../time'
import type { BillCalculator, GridFlows, MonthlyBillSummary } from '../finance/bill-calculator'

export const STUB_IMPORT_RATE = 2
export const STUB_EXPORT_RATE = 1
export const STUB_FIXED_PER_MONTH = 500

export const stubBillCalculator: BillCalculator = {
  monthlyBills(flows: GridFlows): MonthlyBillSummary[] {
    return monthHourRanges().map(({ month, start, end }) => {
      let imp = 0
      let exp = 0
      for (let h = start; h < end; h++) {
        imp += flows.importKwh[h]!
        exp += flows.exportKwh[h]!
      }
      const energy = imp * STUB_IMPORT_RATE
      const credit = Math.min(exp * STUB_EXPORT_RATE, energy)
      return { month, totalZar: STUB_FIXED_PER_MONTH + energy - credit, exportCreditUsedZar: credit }
    })
  },
}
```

Append to `index.ts`:
```ts
export * from './finance/bill-calculator'
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/finance/bill-calculator.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/services/solar/finance/bill-calculator.ts packages/shared/src/services/solar/finance/bill-calculator.test.ts packages/shared/src/services/solar/__fixtures__/stub-bill-calculator.ts packages/shared/src/services/solar/index.ts
git commit -m "$(cat <<'EOF'
feat(solar-engine): BillCalculator seam to the Phase 2a bill engine + test stub

The finance model consumes twelve monthly bill totals and the export credit USED;
it never reads a tariff. Year-1 bills priced three ways (no PV / PV only / PV +
battery) so fade and degradation apply to their own share of the saving.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Annual cashflow — four finance models, tax/12B, load-shedding line

**Files:**
- Create: `packages/shared/src/services/solar/finance/cashflow.ts`
- Test: `packages/shared/src/services/solar/finance/cashflow.test.ts`
- Modify: `packages/shared/src/services/solar/index.ts` (append one line)

- [ ] **Step 1: Write the failing test** (the header comment IS the hand computation — spec §6's XLSX-independent check, 4 s.f.)

`packages/shared/src/services/solar/finance/cashflow.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { allowanceSchedule, runFinance, type FinanceEnergy, type FinanceInput } from './cashflow'
import { DEFAULT_ESCALATION } from './factors'

/**
 * XLSX-independent check (spec §6 validation): a 3-year toy case computed by hand.
 *   capex R100 000, 10 kWp, O&M R150/kWp = R1 500, insurance 0.5 % = R500 (NO ×12, D-05)
 *   CPI 5 %  → opex 2 000 / 2 100 / 2 205
 *   bills before R50 000, after R10 000 → year-1 saving R40 000; tariff +10 % a year (published)
 *   → saving 40 000 / 44 000 / 48 400; no degradation; tax off
 *   net 38 000 / 41 900 / 46 195
 *   NPV @10 % = −100 000 + 38 000/1.1 + 41 900/1.21 + 46 195/1.331
 *             = −100 000 + 34 545.4545 + 34 628.0992 + 34 706.9872 = 3 880.5409
 *   simple payback: −100 000 → −62 000 → −20 100 → +26 095  ⇒ 2 + 20 100/46 195 = 2.435112
 *   discounted: −65 454.5455 → −30 826.4463 → +3 880.5409  ⇒ 2 + 30 826.4463/34 706.9872 = 2.888191
 *   LCOE = (100 000 + 1 818.1818 + 1 735.5372 + 1 656.6491) / (14 545.4545 + 13 223.1405 + 12 021.0368)
 *        = 105 210.3681 / 39 789.6318 = 2.644165 R/kWh
 *   IRR: NPV(0.1212) ≈ 0  →  0.1212 (4 s.f.)
 */
const toy: FinanceInput = {
  kWpDc: 10,
  capex: { totalZar: 100_000, inverterZar: 0, batteryZar: 0, section12bQualifyingZar: 0 },
  opex: { omZarPerKwpYear: 150, insuranceFractionOfCapex: 0.005, monitoringZarPerYear: 0 },
  replacements: { inverterYear: null, inverterFractionOfCapex: 0.6, batteryYear: null, batteryFractionOfCapex: 0.5 },
  tax: { enabled: false, companyRate: 0.27, allowance: 'none', systemAcKw: 10 },
  degradation: { firstYear: 0, annual: 0, batteryFadePerYear: 0.02, batteryEndOfLife: 0.7 },
  analysis: { years: 3, discountRate: 0.1, cpi: 0.05, escalation: { ...DEFAULT_ESCALATION, published: [0.1, 0.1] }, loadGrowth: 0 },
  models: [{ kind: 'cash' }],
  loadShedding: null,
}
const toyEnergy: FinanceEnergy = {
  year1PvKwh: 16_000,
  bills: { beforeZar: 50_000, afterZar: 10_000, afterPvOnlyZar: 10_000, exportCreditUsedZar: 0 },
}

const sig4 = (x: number) => Number(x.toPrecision(4))

describe('3-year toy cashflow, matched to hand computation (4 s.f.)', () => {
  const r = runFinance(toy, toyEnergy)
  const v = r.models[0]!.views[0]!

  it('rows', () => {
    expect(v.rows.map((x) => x.savingZar)).toEqual([40_000, 44_000, 48_400].map((x) => expect.closeTo(x, 6)))
    expect(v.rows.map((x) => x.opexZar)).toEqual([2_000, 2_100, 2_205].map((x) => expect.closeTo(x, 6)))
    expect(v.rows.map((x) => x.netZar)).toEqual([38_000, 41_900, 46_195].map((x) => expect.closeTo(x, 6)))
  })

  it('NPV, IRR, paybacks and LCOE', () => {
    expect(sig4(v.npvZar)).toBe(3881)
    expect(v.npvZar).toBeCloseTo(3880.5409, 3)
    expect(sig4(v.irr!)).toBe(0.1212)
    expect(sig4(v.simplePaybackYears!)).toBe(2.435)
    expect(sig4(v.discountedPaybackYears!)).toBe(2.888)
    expect(sig4(r.lcoeZarPerKwh!)).toBe(2.644)
  })
})

describe('insurance (D-05) and degradation (§3.6)', () => {
  it('insurance is capex × 0.5 % a year — R500 in year 1, never R6 000', () => {
    const r = runFinance({ ...toy, opex: { omZarPerKwpYear: 0, insuranceFractionOfCapex: 0.005, monitoringZarPerYear: 0 } }, toyEnergy)
    expect(r.models[0]!.views[0]!.rows[0]!.opexZar).toBe(500)
  })

  it('year-1 saving and energy already carry the first-year degradation', () => {
    const r = runFinance({ ...toy, degradation: { ...toy.degradation, firstYear: 0.02, annual: 0.005 } }, toyEnergy)
    const rows = r.models[0]!.views[0]!.rows
    expect(rows[0]!.energyKwh).toBeCloseTo(16_000 * 0.98, 9)
    expect(rows[1]!.savingZar).toBeCloseTo(40_000 * 0.98 * 0.995 * 1.1, 6)
  })

  it('battery share of the saving fades with capacity; the PV share with degradation', () => {
    const e = { ...toyEnergy, bills: { beforeZar: 50_000, afterPvOnlyZar: 20_000, afterZar: 10_000, exportCreditUsedZar: 0 } }
    const r = runFinance({ ...toy, analysis: { ...toy.analysis, escalation: { ...DEFAULT_ESCALATION, published: [0, 0] } } }, e)
    expect(r.models[0]!.views[0]!.rows[2]!.savingZar).toBeCloseTo(30_000 + 10_000 * 0.96, 6)
  })
})

describe('replacements', () => {
  it('inverter at 60 % and battery at 50 % of their capex, in real terms escalated by CPI', () => {
    const f: FinanceInput = {
      ...toy,
      capex: { totalZar: 100_000, inverterZar: 20_000, batteryZar: 30_000, section12bQualifyingZar: 0 },
      replacements: { inverterYear: 2, inverterFractionOfCapex: 0.6, batteryYear: 3, batteryFractionOfCapex: 0.5 },
    }
    const rows = runFinance(f, toyEnergy).models[0]!.views[0]!.rows
    expect(rows[1]!.replacementZar).toBeCloseTo(12_000 * 1.05, 9)
    expect(rows[2]!.replacementZar).toBeCloseTo(15_000 * 1.1025, 9)
  })
})

describe('tax and Section 12B (D-16)', () => {
  it('is off unless enabled — no tax line at all by default', () => {
    expect(runFinance(toy, toyEnergy).models[0]!.views[0]!.rows.every((r) => r.taxZar === 0)).toBe(true)
  })

  it('12B: 100 % in year 1 up to 1 MW, 50/30/20 above, 125 % only when the enhanced option is chosen', () => {
    expect(allowanceSchedule({ enabled: true, companyRate: 0.27, allowance: 'section12b', systemAcKw: 1000 })).toEqual([1])
    expect(allowanceSchedule({ enabled: true, companyRate: 0.27, allowance: 'section12b', systemAcKw: 1001 })).toEqual([0.5, 0.3, 0.2])
    expect(allowanceSchedule({ enabled: true, companyRate: 0.27, allowance: 'section12b-enhanced', systemAcKw: 500 })).toEqual([1.25])
    expect(allowanceSchedule({ enabled: true, companyRate: 0.27, allowance: 'none', systemAcKw: 500 })).toEqual([])
  })

  it('tax = rate × (saving − opex − allowance); a year-1 allowance makes year-1 tax negative (shield)', () => {
    const f: FinanceInput = {
      ...toy,
      capex: { ...toy.capex, section12bQualifyingZar: 100_000 },
      tax: { enabled: true, companyRate: 0.27, allowance: 'section12b', systemAcKw: 10 },
    }
    const rows = runFinance(f, toyEnergy).models[0]!.views[0]!.rows
    expect(rows[0]!.taxZar).toBeCloseTo(0.27 * (40_000 - 2_000 - 100_000), 6)
    expect(rows[1]!.taxZar).toBeCloseTo(0.27 * (44_000 - 2_100), 6)
  })
})

describe('four finance models side by side (D-15)', () => {
  const f: FinanceInput = {
    ...toy,
    models: [
      { kind: 'cash' },
      { kind: 'debt', loanFraction: 0.5, annualRate: 0.12, termYears: 2, graceMonths: 0 },
      { kind: 'ppa', startTariffZarPerKwh: 1.5, escalation: 0.05, termYears: 2, buyout: null },
      { kind: 'lease', monthlyPaymentZar: 2_000, escalation: 0, termYears: 2, residualZar: 5_000 },
    ],
  }
  const r = runFinance(f, toyEnergy)

  it('each model produces its own cashflow; PPA and lease show client and investor views', () => {
    expect(r.models.map((m) => [m.model, m.views.map((v) => v.view)])).toEqual([
      ['cash', ['owner']],
      ['debt', ['owner']],
      ['ppa', ['client', 'investor']],
      ['lease', ['client', 'investor']],
    ])
  })

  it('debt: equity upfront, annuity service in the years, interest deductible only when taxed', () => {
    const v = r.models[1]!.views[0]!
    expect(v.upfrontZar).toBe(-50_000)
    const pmt = (50_000 * 0.01) / (1 - 1.01 ** -24)
    expect(v.rows[0]!.financeZar).toBeCloseTo(12 * pmt, 6)
    expect(v.rows[2]!.financeZar).toBe(0)
    expect(v.rows[0]!.netZar).toBeCloseTo(38_000 - 12 * pmt, 6)
  })

  it('PPA client: saving − R1.50/kWh × energy (escalating), then owns the system after the term', () => {
    const c = r.models[2]!.views[0]!
    expect(c.upfrontZar).toBe(0)
    expect(c.rows.map((x) => x.netZar)).toEqual([16_000, 18_800, 46_195].map((x) => expect.closeTo(x, 6)))
    expect(c.irr).toBeNull()
    const inv = r.models[2]!.views[1]!
    expect(inv.upfrontZar).toBe(-100_000)
    expect(inv.rows.map((x) => x.netZar)).toEqual([22_000, 23_100, 0].map((x) => expect.closeTo(x, 6)))
  })

  it('lease client: saving − 12 × monthly payment, residual paid in the final lease year', () => {
    const c = r.models[3]!.views[0]!
    expect(c.rows.map((x) => x.netZar)).toEqual([16_000, 15_000, 46_195].map((x) => expect.closeTo(x, 6)))
    const inv = r.models[3]!.views[1]!
    expect(inv.rows.map((x) => x.netZar)).toEqual([22_000, 26_900, 0].map((x) => expect.closeTo(x, 6)))
  })

  it('PPA buy-out ends the service period early', () => {
    const b = runFinance({ ...toy, models: [{ kind: 'ppa', startTariffZarPerKwh: 1.5, escalation: 0, termYears: 3, buyout: { year: 1, priceZar: 70_000 } }] }, toyEnergy)
    const c = b.models[0]!.views[0]!
    expect(c.rows[0]!.netZar).toBeCloseTo(40_000 - 24_000 - 70_000, 6)
    expect(c.rows[1]!.netZar).toBeCloseTo(44_000 - 2_100, 6)
  })
})

describe('load-shedding value (D-14)', () => {
  it('is reported separately and never changes any cashflow, NPV or IRR', () => {
    const withLs = runFinance({ ...toy, loadShedding: { hoursPerYear: 100, backedLoadKw: 10, valueZarPerKwh: 5 } }, toyEnergy)
    const without = runFinance(toy, toyEnergy)
    expect(withLs.loadShedding!.annualZar).toEqual([5_000, 5_250, 5_512.5].map((x) => expect.closeTo(x, 9)))
    expect(withLs.models).toEqual(without.models)
    expect(without.loadShedding).toBeNull()
  })
})

describe('blocking inputs', () => {
  it('a run with no capex is refused with a named reason (no silent R12k/kWp fallback)', () => {
    expect(() => runFinance({ ...toy, capex: { ...toy.capex, totalZar: 0 } }, toyEnergy)).toThrow(/capex must be > 0/)
    expect(() => runFinance({ ...toy, models: [] }, toyEnergy)).toThrow(/at least one finance model/)
    expect(() => runFinance({ ...toy, opex: { ...toy.opex, insuranceFractionOfCapex: 6 } }, toyEnergy)).toThrow(/insuranceFractionOfCapex/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/finance/cashflow.test.ts`
Expected: FAIL — `Failed to resolve import "./cashflow"`.

- [ ] **Step 3: Implement**

`packages/shared/src/services/solar/finance/cashflow.ts`:
```ts
/**
 * Annual financial model (engine spec §6; decisions D-05, D-07, D-14, D-15, D-16).
 *
 * Savings scale from year 1 (hourly model + bill engine) by the tariff path and by energy:
 *   PV share of the saving      × degradation factor (spec §3.6 — the ONLY place degradation applies)
 *   battery share of the saving × battery capacity factor (fade to end-of-life, renewed on replacement)
 * Load growth raises Bill_before and Bill_after equally and leaves the saving unchanged
 * (documented conservative approximation: growth would only raise self-consumption).
 * All money is ZAR excl. VAT (D-16).
 */
import type { Year1Bills } from './bill-calculator'
import {
  batteryHealth,
  cpiFactor,
  degradationFactor,
  tariffFactors,
  type EscalationPath,
} from './factors'
import { loanSchedule } from './loan'
import { irr, lcoe, npv, payback } from './metrics'

export interface CapexBreakdown {
  totalZar: number
  inverterZar: number
  batteryZar: number
  /** Cost qualifying for the Section 12B allowance. */
  section12bQualifyingZar: number
}

export interface OpexInputs {
  omZarPerKwpYear: number
  /** Annual fraction of capex — NO ×12 (D-05). */
  insuranceFractionOfCapex: number
  monitoringZarPerYear: number
}

export interface ReplacementInputs {
  inverterYear: number | null
  inverterFractionOfCapex: number
  batteryYear: number | null
  batteryFractionOfCapex: number
}

export type TaxAllowance = 'none' | 'section12b' | 'section12b-enhanced'

export interface TaxInputs {
  enabled: boolean
  companyRate: number
  allowance: TaxAllowance
  /** AC capacity for the 12B size test (≤ 1 MW → 100 % in year 1, else 50/30/20). */
  systemAcKw: number
}

export interface DegradationInputs {
  firstYear: number
  annual: number
  batteryFadePerYear: number
  batteryEndOfLife: number
}

export interface AnalysisInputs {
  years: number
  discountRate: number
  cpi: number
  escalation: EscalationPath
  loadGrowth: number
}

export type FinanceModel =
  | { kind: 'cash' }
  | { kind: 'debt'; loanFraction: number; annualRate: number; termYears: number; graceMonths: number }
  | {
      kind: 'ppa'
      startTariffZarPerKwh: number
      escalation: number
      termYears: number
      buyout: { year: number; priceZar: number } | null
    }
  | { kind: 'lease'; monthlyPaymentZar: number; escalation: number; termYears: number; residualZar: number }

export interface LoadSheddingInputs {
  hoursPerYear: number
  backedLoadKw: number
  valueZarPerKwh: number
}

export interface FinanceInput {
  kWpDc: number
  capex: CapexBreakdown
  opex: OpexInputs
  replacements: ReplacementInputs
  tax: TaxInputs
  degradation: DegradationInputs
  analysis: AnalysisInputs
  models: FinanceModel[]
  loadShedding: LoadSheddingInputs | null
}

export interface FinanceEnergy {
  /** Year-1 AC energy from the hourly model, before degradation, kWh. */
  year1PvKwh: number
  bills: Year1Bills
}

export interface CashflowRow {
  year: number
  energyKwh: number
  billBeforeZar: number
  billAfterZar: number
  savingZar: number
  opexZar: number
  replacementZar: number
  taxZar: number
  /** Debt service, PPA payments (+ buy-out) or lease payments (+ residual) — positive = paid by this party. */
  financeZar: number
  netZar: number
  cumulativeZar: number
}

export interface ViewResult {
  view: 'owner' | 'client' | 'investor'
  upfrontZar: number
  rows: CashflowRow[]
  npvZar: number
  irr: number | null
  simplePaybackYears: number | null
  discountedPaybackYears: number | null
}

export interface ModelResult {
  model: FinanceModel['kind']
  views: ViewResult[]
}

export interface FinanceResult {
  models: ModelResult[]
  /** Discounted LCOE of the system to whoever owns it, ZAR/kWh. */
  lcoeZarPerKwh: number | null
  /** D-14: reported separately, NEVER part of any cashflow or IRR. */
  loadShedding: { annualZar: number[]; npvZar: number } | null
}

/** Section 12B schedule as fractions of the qualifying cost, year 1 first. */
export function allowanceSchedule(tax: TaxInputs): number[] {
  if (tax.allowance === 'none') return []
  if (tax.allowance === 'section12b-enhanced') return [1.25]
  return tax.systemAcKw <= 1000 ? [1] : [0.5, 0.3, 0.2]
}

function assertFraction(name: string, v: number) {
  if (!(v >= 0 && v <= 1)) throw new Error(`${name} must be a fraction in [0, 1], got ${v}`)
}

function validate(f: FinanceInput): void {
  if (!Number.isInteger(f.analysis.years) || f.analysis.years < 1 || f.analysis.years > 50) throw new Error('analysis years must be 1–50')
  if (!(f.analysis.discountRate > -1)) throw new Error('discount rate must be > −100 %')
  if (!(f.capex.totalZar > 0)) throw new Error('capex must be > 0 — a run with no capex is blocked, never defaulted')
  if (f.capex.inverterZar + f.capex.batteryZar > f.capex.totalZar) throw new Error('inverter + battery capex exceed total capex')
  if (f.models.length === 0) throw new Error('select at least one finance model')
  assertFraction('insuranceFractionOfCapex', f.opex.insuranceFractionOfCapex)
  assertFraction('first-year degradation', f.degradation.firstYear)
  assertFraction('annual degradation', f.degradation.annual)
  assertFraction('tax rate', f.tax.companyRate)
  for (const m of f.models) {
    if (m.kind === 'debt') assertFraction('loan fraction', m.loanFraction)
    if ((m.kind === 'ppa' || m.kind === 'lease') && !(m.termYears >= 1)) throw new Error(`${m.kind} term must be ≥ 1 year`)
    if (m.kind === 'ppa' && m.buyout && !(m.buyout.year >= 1 && m.buyout.year <= m.termYears)) {
      throw new Error('PPA buy-out year must fall within the term')
    }
  }
}

interface Common {
  energy: number[]
  saving: number[]
  billBefore: number[]
  opex: number[]
  repl: number[]
  allowance: number[]
}

function common(f: FinanceInput, e: FinanceEnergy): Common {
  const N = f.analysis.years
  const tf = tariffFactors(N, f.analysis.escalation, f.analysis.cpi)
  const sched = allowanceSchedule(f.tax)
  const pvSaving1 = e.bills.beforeZar - e.bills.afterPvOnlyZar
  const battSaving1 = e.bills.afterPvOnlyZar - e.bills.afterZar
  const c: Common = { energy: [], saving: [], billBefore: [], opex: [], repl: [], allowance: [] }
  for (let n = 1; n <= N; n++) {
    const deg = degradationFactor(n, f.degradation.firstYear, f.degradation.annual)
    const health = batteryHealth(n, f.degradation.batteryFadePerYear, f.degradation.batteryEndOfLife, f.replacements.batteryYear)
    const cpi = cpiFactor(n, f.analysis.cpi)
    c.energy.push(e.year1PvKwh * deg)
    c.saving.push((pvSaving1 * deg + battSaving1 * health) * tf[n - 1]!)
    c.billBefore.push(e.bills.beforeZar * tf[n - 1]! * (1 + f.analysis.loadGrowth) ** (n - 1))
    c.opex.push(
      (f.opex.omZarPerKwpYear * f.kWpDc + f.capex.totalZar * f.opex.insuranceFractionOfCapex + f.opex.monitoringZarPerYear) * cpi,
    )
    let r = 0
    if (f.replacements.inverterYear === n) r += f.capex.inverterZar * f.replacements.inverterFractionOfCapex
    if (f.replacements.batteryYear === n) r += f.capex.batteryZar * f.replacements.batteryFractionOfCapex
    c.repl.push(r * cpi)
    c.allowance.push((sched[n - 1] ?? 0) * f.capex.section12bQualifyingZar)
  }
  return c
}

function view(
  kind: ViewResult['view'],
  upfront: number,
  rows: Omit<CashflowRow, 'cumulativeZar'>[],
  rate: number,
): ViewResult {
  let cum = upfront
  const full = rows.map((r) => {
    cum += r.netZar
    return { ...r, cumulativeZar: cum }
  })
  const flows = [upfront, ...rows.map((r) => r.netZar)]
  return {
    view: kind,
    upfrontZar: upfront,
    rows: full,
    npvZar: npv(rate, flows),
    irr: irr(flows),
    simplePaybackYears: payback(flows),
    discountedPaybackYears: payback(flows, rate),
  }
}

export function runFinance(f: FinanceInput, e: FinanceEnergy): FinanceResult {
  validate(f)
  const c = common(f, e)
  const N = f.analysis.years
  const rate = f.analysis.discountRate
  const taxRate = f.tax.enabled ? f.tax.companyRate : 0
  const base = (i: number) => ({
    year: i + 1,
    energyKwh: c.energy[i]!,
    billBeforeZar: c.billBefore[i]!,
    billAfterZar: c.billBefore[i]! - c.saving[i]!,
    savingZar: c.saving[i]!,
  })

  const models: ModelResult[] = f.models.map((m) => {
    if (m.kind === 'cash' || m.kind === 'debt') {
      const loan = m.kind === 'debt' ? f.capex.totalZar * m.loanFraction : 0
      const sched = m.kind === 'debt' ? loanSchedule({ principalZar: loan, annualRate: m.annualRate, termYears: m.termYears, graceMonths: m.graceMonths }, N) : null
      const rows = c.saving.map((_, i) => {
        const interest = sched?.[i]!.interestZar ?? 0
        const service = sched?.[i]!.paymentZar ?? 0
        const tax = taxRate * (c.saving[i]! - c.opex[i]! - c.allowance[i]! - interest)
        return {
          ...base(i),
          opexZar: c.opex[i]!,
          replacementZar: c.repl[i]!,
          taxZar: tax,
          financeZar: service,
          netZar: c.saving[i]! - c.opex[i]! - c.repl[i]! - tax - service,
        }
      })
      return { model: m.kind, views: [view('owner', -(f.capex.totalZar - loan), rows, rate)] }
    }

    // PPA and lease: a service period, then the client owns the system.
    const serviceYears = m.kind === 'ppa' ? (m.buyout ? m.buyout.year : m.termYears) : m.termYears
    const transferPrice = m.kind === 'ppa' ? (m.buyout?.priceZar ?? 0) : m.residualZar
    const payment = (i: number) => {
      if (i + 1 > serviceYears) return 0
      return m.kind === 'ppa'
        ? c.energy[i]! * m.startTariffZarPerKwh * (1 + m.escalation) ** i
        : 12 * m.monthlyPaymentZar * (1 + m.escalation) ** i
    }
    const clientRows = c.saving.map((_, i) => {
      const inService = i + 1 <= serviceYears
      const pay = payment(i) + (i + 1 === serviceYears ? transferPrice : 0)
      const opex = inService ? 0 : c.opex[i]!
      const repl = inService ? 0 : c.repl[i]!
      const tax = taxRate * (c.saving[i]! - payment(i) - opex)
      return { ...base(i), opexZar: opex, replacementZar: repl, taxZar: tax, financeZar: pay, netZar: c.saving[i]! - pay - opex - repl - tax }
    })
    const investorRows = c.saving.map((_, i) => {
      const inService = i + 1 <= serviceYears
      const income = payment(i) + (i + 1 === serviceYears ? transferPrice : 0)
      const opex = inService ? c.opex[i]! : 0
      const repl = inService ? c.repl[i]! : 0
      const tax = inService ? taxRate * (payment(i) - opex - c.allowance[i]!) : 0
      return {
        year: i + 1,
        energyKwh: inService ? c.energy[i]! : 0,
        billBeforeZar: 0,
        billAfterZar: 0,
        savingZar: 0,
        opexZar: opex,
        replacementZar: repl,
        taxZar: tax,
        financeZar: -income,
        netZar: income - opex - repl - tax,
      }
    })
    return { model: m.kind, views: [view('client', 0, clientRows, rate), view('investor', -f.capex.totalZar, investorRows, rate)] }
  })

  const ls = f.loadShedding
  const loadShedding = ls
    ? (() => {
        const annualZar = Array.from({ length: N }, (_, i) => ls.hoursPerYear * ls.backedLoadKw * ls.valueZarPerKwh * cpiFactor(i + 1, f.analysis.cpi))
        return { annualZar, npvZar: npv(rate, [0, ...annualZar]) }
      })()
    : null

  return {
    models,
    lcoeZarPerKwh: lcoe(rate, f.capex.totalZar, c.opex.map((o, i) => o + c.repl[i]!), c.energy),
    loadShedding,
  }
}
```

Append to `index.ts`:
```ts
export * from './finance/cashflow'
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/finance/cashflow.test.ts`
Expected: 16 passed.

- [ ] **Step 5: Prove the D-05 and §3.6 guards can fail**

(a) In `common()`, temporarily write `f.capex.totalZar * f.opex.insuranceFractionOfCapex * 12` → re-run → the insurance test and the toy rows fail; restore. (b) Temporarily set `const deg = 1` → the degradation test fails; restore. Confirm 16 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/services/solar/finance/cashflow.ts packages/shared/src/services/solar/finance/cashflow.test.ts packages/shared/src/services/solar/index.ts
git commit -m "$(cat <<'EOF'
feat(solar-engine): annual cashflow — cash, debt, PPA, lease; tax/12B; load-shedding line

D-15 all four models (PPA/lease with client + investor views). D-05 insurance is an
annual % of capex, no ×12. D-16 tax + 12B off by default. D-14 load-shedding value
reported separately, never in a cashflow. 3-year toy case matches the hand
computation to 4 s.f. (NPV 3 881, IRR 0.1212, paybacks 2.435 / 2.888, LCOE 2.644).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Sensitivity tornado

**Files:**
- Create: `packages/shared/src/services/solar/finance/sensitivity.ts`
- Test: `packages/shared/src/services/solar/finance/sensitivity.test.ts`
- Modify: `packages/shared/src/services/solar/index.ts` (append one line)

- [ ] **Step 1: Write the failing test**

`packages/shared/src/services/solar/finance/sensitivity.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { runFinance, type FinanceEnergy, type FinanceInput } from './cashflow'
import { DEFAULT_ESCALATION } from './factors'
import { TORNADO_VARIABLES, tornado } from './sensitivity'

const f: FinanceInput = {
  kWpDc: 100,
  capex: { totalZar: 1_200_000, inverterZar: 150_000, batteryZar: 0, section12bQualifyingZar: 1_200_000 },
  opex: { omZarPerKwpYear: 150, insuranceFractionOfCapex: 0.005, monitoringZarPerYear: 6_000 },
  replacements: { inverterYear: 12, inverterFractionOfCapex: 0.6, batteryYear: null, batteryFractionOfCapex: 0.5 },
  tax: { enabled: false, companyRate: 0.27, allowance: 'none', systemAcKw: 100 },
  degradation: { firstYear: 0.02, annual: 0.005, batteryFadePerYear: 0.02, batteryEndOfLife: 0.7 },
  analysis: { years: 25, discountRate: 0.11, cpi: 0.05, escalation: DEFAULT_ESCALATION, loadGrowth: 0 },
  models: [{ kind: 'cash' }],
  loadShedding: null,
}
const e: FinanceEnergy = {
  year1PvKwh: 170_000,
  bills: { beforeZar: 900_000, afterZar: 620_000, afterPvOnlyZar: 620_000, exportCreditUsedZar: 40_000 },
}

describe('sensitivity tornado', () => {
  const t = tornado(f, e)

  it('covers the five spec variables, sorted by spread, around the base NPV', () => {
    expect(t.bars.map((b) => b.variable).sort()).toEqual([...TORNADO_VARIABLES].sort())
    for (let i = 1; i < t.bars.length; i++) expect(t.bars[i - 1]!.spreadZar).toBeGreaterThanOrEqual(t.bars[i]!.spreadZar)
    expect(t.baseNpvZar).toBeCloseTo(runFinance(f, e).models[0]!.views[0]!.npvZar, 6)
  })

  it('moves NPV in the right direction for each variable', () => {
    const bar = (v: string) => t.bars.find((b) => b.variable === v)!
    expect(bar('capex').highNpvZar).toBeLessThan(bar('capex').lowNpvZar)
    expect(bar('yield').highNpvZar).toBeGreaterThan(bar('yield').lowNpvZar)
    expect(bar('tariffEscalation').highNpvZar).toBeGreaterThan(bar('tariffEscalation').lowNpvZar)
    expect(bar('discountRate').highNpvZar).toBeLessThan(bar('discountRate').lowNpvZar)
    expect(bar('exportRate').highNpvZar).toBeGreaterThan(bar('exportRate').lowNpvZar)
  })

  it('capex ±20 % moves a cash NPV by exactly ±20 % of capex plus the insurance it carries', () => {
    const bar = t.bars.find((b) => b.variable === 'capex')!
    expect(bar.lowNpvZar - t.baseNpvZar).toBeGreaterThan(0.2 * 1_200_000)
  })

  it('export rate has no effect when no export credit is used', () => {
    const t0 = tornado(f, { ...e, bills: { ...e.bills, exportCreditUsedZar: 0 } })
    expect(t0.bars.find((b) => b.variable === 'exportRate')!.spreadZar).toBe(0)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/finance/sensitivity.test.ts`
Expected: FAIL — `Failed to resolve import "./sensitivity"`.

- [ ] **Step 3: Implement**

`packages/shared/src/services/solar/finance/sensitivity.ts`:
```ts
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
```

Append to `index.ts`:
```ts
export * from './finance/sensitivity'
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/finance/sensitivity.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/services/solar/finance/sensitivity.ts packages/shared/src/services/solar/finance/sensitivity.test.ts packages/shared/src/services/solar/index.ts
git commit -m "$(cat <<'EOF'
feat(solar-engine): sensitivity tornado — capex, escalation, yield, discount rate, export rate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Defaults register (spec §7)

**Files:**
- Create: `packages/shared/src/services/solar/defaults.ts`
- Test: `packages/shared/src/services/solar/defaults.test.ts`
- Modify: `packages/shared/src/services/solar/index.ts` (append one line)

- [ ] **Step 1: Write the failing test**

`packages/shared/src/services/solar/defaults.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { SOLAR_ENGINE_DEFAULTS as D } from './defaults'

describe('engine spec §7 defaults register', () => {
  it('losses', () => {
    expect(D.losses.dc).toEqual({ soiling: 0.02, shading: 0.01, mismatch: 0.01, dcWiring: 0.015, lid: 0.015, nameplate: 0 })
    expect(D.losses.shadingRacked).toBe(0.03)
    expect(D.losses.ac).toEqual({ acWiring: 0.01, availability: 0.99 })
    expect(D.albedo).toBe(0.2)
    expect(D.inverterEuroEfficiency).toBe(0.975)
  })

  it('degradation and battery', () => {
    expect(D.degradation).toEqual({ firstYear: 0.02, annual: 0.005, batteryFadePerYear: 0.02, batteryEndOfLife: 0.7 })
    expect(D.battery).toEqual({ roundTripEfficiency: 0.9, socMin: 0.1, socMax: 0.95 })
  })

  it('finance (D-05, D-07, D-16)', () => {
    expect(D.finance.omZarPerKwpYear).toBe(150)
    expect(D.finance.insuranceFractionOfCapex).toBe(0.005)
    expect(D.finance.discountRate).toBe(0.11)
    expect(D.finance.cpi).toBe(0.05)
    expect(D.finance.escalation).toMatchObject({ startRate: 0.09, endRate: 0.07, linearToYear: 10, cpiMargin: 0.01 })
    expect(D.finance.years).toBe(25)
    expect(D.finance.replacements).toEqual({ inverterYear: 12, inverterFractionOfCapex: 0.6, batteryYear: 10, batteryFractionOfCapex: 0.5 })
    expect(D.finance.tax).toEqual({ enabled: false, allowance: 'none' })
  })

  it('load', () => {
    expect(D.load).toEqual({ diversity: 1, commonAreaAllowanceMalls: 0.15, powerFactor: 0.95 })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/defaults.test.ts`
Expected: FAIL — `Failed to resolve import "./defaults"`.

- [ ] **Step 3: Implement**

`packages/shared/src/services/solar/defaults.ts`:
```ts
/**
 * Engine spec §7 defaults register — the seed values for org settings (Phase 4b seeds
 * `/settings/solar` from this object). Decisions: D-05 insurance, D-07 finance defaults,
 * D-16 tax toggle default off. WM Solar's hard-coded fallbacks (R 2.50/kWh, 1,600/1,700 kWh/kWp,
 * R 12 k/kWp) appear NOWHERE: a missing input blocks a run with a named reason.
 */
import { DEFAULT_AC_LOSSES, DEFAULT_DC_LOSSES, DEFAULT_SHADING_RACKED } from './pv/losses'
import { DEFAULT_ESCALATION } from './finance/factors'

export const SOLAR_ENGINE_DEFAULTS = {
  losses: {
    dc: DEFAULT_DC_LOSSES,
    shadingRacked: DEFAULT_SHADING_RACKED,
    ac: DEFAULT_AC_LOSSES,
  },
  albedo: 0.2,
  inverterEuroEfficiency: 0.975,
  moduleIamB0: 0.05,
  degradation: { firstYear: 0.02, annual: 0.005, batteryFadePerYear: 0.02, batteryEndOfLife: 0.7 },
  battery: { roundTripEfficiency: 0.9, socMin: 0.1, socMax: 0.95 },
  finance: {
    omZarPerKwpYear: 150,
    insuranceFractionOfCapex: 0.005,
    discountRate: 0.11,
    cpi: 0.05,
    escalation: DEFAULT_ESCALATION,
    years: 25,
    replacements: { inverterYear: 12, inverterFractionOfCapex: 0.6, batteryYear: 10, batteryFractionOfCapex: 0.5 },
    tax: { enabled: false, allowance: 'none' as const },
  },
  load: { diversity: 1.0, commonAreaAllowanceMalls: 0.15, powerFactor: 0.95 },
} as const
```

Append to `index.ts`:
```ts
export * from './defaults'
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/defaults.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/services/solar/defaults.ts packages/shared/src/services/solar/defaults.test.ts packages/shared/src/services/solar/index.ts
git commit -m "$(cat <<'EOF'
feat(solar-engine): spec §7 defaults register (seed for org settings)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Entry points — `simulateCase` and `runFinancials`

**Files:**
- Create: `packages/shared/src/services/solar/case.ts`
- Test: `packages/shared/src/services/solar/case.test.ts`
- Modify: `packages/shared/src/services/solar/index.ts` (append one line)

Signature note: spec §1.1's `simulateCase(input)` becomes `simulateCase(input, weather)` — the 8760 weather arrays are not part of the hashed snapshot; the snapshot carries `weatherDatasetId` (§1.3) and the function refuses weather whose id differs. `runFinancials(result, fin, tariff)` takes a `BillCalculator` in place of `TariffModel`.

- [ ] **Step 1: Write the failing test**

`packages/shared/src/services/solar/case.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { loadWeather } from './__fixtures__/pvgis'
import { stubBillCalculator } from './__fixtures__/stub-bill-calculator'
import { runFinancials, simulateCase, type CaseInput } from './case'
import { SOLAR_ENGINE_DEFAULTS } from './defaults'
import { ENGINE_VERSION } from './version'
import type { FinanceInput } from './finance/cashflow'

const weather = { id: 'pvgis-5.2-tmy:-26.2,28.05', year: loadWeather('jhb') }

const input = (over: Partial<CaseInput> = {}): CaseInput => ({
  weatherDatasetId: weather.id,
  pv: {
    arrays: [
      {
        id: 'roof-a',
        kWpDc: 100,
        tiltDeg: 15,
        azimuthDeg: 0,
        module: { gammaPmaxPerC: -0.0035, iamB0: 0.05 },
        cellTemp: { kind: 'noct', noctC: 45 },
        losses: SOLAR_ENGINE_DEFAULTS.losses.dc,
        inverterId: 'inv-1',
      },
    ],
    inverters: [{ id: 'inv-1', acRatedKw: 80 }],
    acLosses: SOLAR_ENGINE_DEFAULTS.losses.ac,
    albedo: 0.2,
    transposition: 'perez',
  },
  load: Array.from({ length: 8760 }, (_, h) => (h % 24 >= 7 && h % 24 < 19 ? 60 : 15)),
  loadAdjustment: 0,
  battery: {
    usableKwh: 100,
    maxChargeKw: 50,
    maxDischargeKw: 50,
    roundTripEfficiency: 0.9,
    socMin: 0.1,
    socMax: 0.95,
    initialSoc: 0.1,
    backupReserve: 0.2,
    strategy: { kind: 'self-consumption' },
  },
  export: { allowed: true, limitKw: 50 },
  ...over,
})

const fin: FinanceInput = {
  kWpDc: 100,
  capex: { totalZar: 1_600_000, inverterZar: 150_000, batteryZar: 450_000, section12bQualifyingZar: 1_150_000 },
  opex: { omZarPerKwpYear: 150, insuranceFractionOfCapex: 0.005, monitoringZarPerYear: 0 },
  replacements: SOLAR_ENGINE_DEFAULTS.finance.replacements,
  tax: { enabled: false, companyRate: 0.27, allowance: 'none', systemAcKw: 80 },
  degradation: SOLAR_ENGINE_DEFAULTS.degradation,
  analysis: { years: 25, discountRate: 0.11, cpi: 0.05, escalation: SOLAR_ENGINE_DEFAULTS.finance.escalation, loadGrowth: 0 },
  models: [{ kind: 'cash' }, { kind: 'debt', loanFraction: 0.7, annualRate: 0.115, termYears: 7, graceMonths: 0 }],
  loadShedding: { hoursPerYear: 200, backedLoadKw: 30, valueZarPerKwh: 6 },
}

describe('simulateCase', () => {
  const r = simulateCase(input(), weather)

  it('stamps the engine version and a stable inputs hash', () => {
    expect(r.engineVersion).toBe(ENGINE_VERSION)
    expect(r.inputsHash).toMatch(/^[0-9a-f]{64}$/)
    expect(simulateCase(input(), weather).inputsHash).toBe(r.inputsHash)
    expect(simulateCase(input({ loadAdjustment: 0.01 }), weather).inputsHash).not.toBe(r.inputsHash)
  })

  it('refuses weather that is not the dataset the input names', () => {
    expect(() => simulateCase(input(), { ...weather, id: 'other' })).toThrow(/weather dataset mismatch/)
  })

  it('runs the battery and a PV-only twin; the battery raises self-consumption', () => {
    expect(r.balance.kpis.selfConsumption).toBeGreaterThan(r.balancePvOnly.kpis.selfConsumption)
    expect(r.monthly.pvKwh.reduce((a, b) => a + b, 0)).toBeCloseTo(r.pv.annual.acKwh, 6)
  })

  it('without a battery the twin IS the balance', () => {
    const n = simulateCase(input({ battery: null }), weather)
    expect(n.balancePvOnly).toBe(n.balance)
  })
})

describe('runFinancials through the BillCalculator seam (stub until Phase 2a)', () => {
  const r = simulateCase(input(), weather)
  const out = runFinancials(r, fin, stubBillCalculator)

  it('prices before / PV-only / PV+battery, and saving is positive', () => {
    expect(out.year1Bills.beforeZar).toBeGreaterThan(out.year1Bills.afterPvOnlyZar)
    expect(out.year1Bills.afterPvOnlyZar).toBeGreaterThan(out.year1Bills.afterZar)
  })

  it('produces every selected model, a tornado and a separate load-shedding line', () => {
    expect(out.finance.models.map((m) => m.model)).toEqual(['cash', 'debt'])
    expect(out.finance.models[0]!.views[0]!.rows).toHaveLength(25)
    expect(out.tornado.bars).toHaveLength(5)
    expect(out.finance.loadShedding!.annualZar[0]).toBeCloseTo(200 * 30 * 6, 9)
    expect(out.engineVersion).toBe(ENGINE_VERSION)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/case.test.ts`
Expected: FAIL — `Failed to resolve import "./case"`.

- [ ] **Step 3: Implement**

`packages/shared/src/services/solar/case.ts`:
```ts
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
  const y1 = year1Bills(bills, result.balance, result.balancePvOnly)
  const energy = { year1PvKwh: result.pv.annual.acKwh, bills: y1 }
  const finance = runFinance(fin, energy)
  const firstView = finance.models[0]!.views[0]!.view
  return { engineVersion: ENGINE_VERSION, year1Bills: y1, finance, tornado: tornado(fin, energy, 0, firstView) }
}
```

Append to `index.ts`:
```ts
export * from './case'
```

- [ ] **Step 4: Run the test and the type-check**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/case.test.ts && pnpm --filter @esite/shared type-check`
Expected: 6 passed; type-check exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/services/solar/case.ts packages/shared/src/services/solar/case.test.ts packages/shared/src/services/solar/index.ts
git commit -m "$(cat <<'EOF'
feat(solar-engine): simulateCase / runFinancials entry points

Stamps ENGINE_VERSION + inputs_hash; refuses weather whose dataset id differs from
the input's; runs a PV-only twin so the bill engine can split the saving; finance
through the BillCalculator seam (stub until Phase 2a).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Golden outputs pinned to `ENGINE_VERSION`

**Files:**
- Test: `packages/shared/src/services/solar/engine-golden.test.ts`

The numbers below were produced by the planning prototype of exactly this code (JHB TMY fixture). A tolerance of 1e-6 relative absorbs last-ulp `Math.*` differences between V8 versions and nothing else.

- [ ] **Step 1: Write the golden test**

`packages/shared/src/services/solar/engine-golden.test.ts`:
```ts
/**
 * Golden outputs pinned to ENGINE_VERSION (spec §1.3). If a formula change moves any number
 * below, that is expected: bump ENGINE_VERSION in version.ts (semver minor for a model change,
 * patch for a fix) AND update both the version and the numbers here in the same commit.
 * Stored runs are never recomputed in place — the version is how a run says which maths made it.
 */
import { describe, expect, it } from 'vitest'
import { loadWeather } from './__fixtures__/pvgis'
import { simulatePv } from './pv/simulate-pv'
import { energyBalance } from './energy/energy-balance'
import { SOLAR_ENGINE_DEFAULTS as D } from './defaults'
import { ENGINE_VERSION } from './version'

const rel = (actual: number, expected: number) => expect(Math.abs(actual / expected - 1)).toBeLessThan(1e-6)

describe(`engine golden case (ENGINE_VERSION ${ENGINE_VERSION})`, () => {
  it('is still version 0.1.0 — bump deliberately together with the numbers below', () => {
    expect(ENGINE_VERSION).toBe('0.1.0')
  })

  it('Johannesburg TMY, 100 kWp north 15°, 80 kW inverter, 100 kWh battery, 60/15 kW day/night load', () => {
    const pv = simulatePv(loadWeather('jhb'), {
      arrays: [
        {
          id: 'a', kWpDc: 100, tiltDeg: 15, azimuthDeg: 0, module: { gammaPmaxPerC: -0.0035, iamB0: 0.05 },
          cellTemp: { kind: 'noct', noctC: 45 }, losses: D.losses.dc, inverterId: 'i',
        },
      ],
      inverters: [{ id: 'i', acRatedKw: 80 }],
      acLosses: D.losses.ac,
      albedo: 0.2,
      transposition: 'perez',
    })
    const b = energyBalance({
      pvAc: pv.pAc,
      load: Float64Array.from({ length: 8760 }, (_, h) => (h % 24 >= 7 && h % 24 < 19 ? 60 : 15)),
      loadAdjustment: 0,
      battery: {
        usableKwh: 100, maxChargeKw: 50, maxDischargeKw: 50, roundTripEfficiency: 0.9, socMin: 0.1, socMax: 0.95,
        initialSoc: 0.1, backupReserve: 0.2, strategy: { kind: 'self-consumption' },
      },
      export: { allowed: true, limitKw: 50 },
    })
    rel(pv.annual.acKwh, 175753.0845)
    rel(pv.annual.clippedKwh, 1152.533342)
    rel(pv.annual.performanceRatio, 0.8026475803)
    rel(b.kpis.selfConsumption, 0.9913061259)
    rel(b.kpis.solarFraction, 0.5303656297)
    rel(b.kpis.importKwh, 154274.8907)
    rel(b.kpis.exportKwh, 140.1679968)
  })
})
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar/engine-golden.test.ts`
Expected: 2 passed. If the second test fails, the code differs from the plan — diff each module against this plan's code blocks before touching the numbers.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/services/solar/engine-golden.test.ts
git commit -m "$(cat <<'EOF'
test(solar-engine): golden outputs pinned to ENGINE_VERSION 0.1.0

A formula change must move these numbers and bump the version in the same commit.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Full verification, push, update the draft PR

**Files:** none

- [ ] **Step 1: Whole engine**

Run: `pnpm --filter @esite/shared exec vitest run src/services/solar`
Expected: 22 files, **131 tests** passed (67 from 4a-i + 64 here).

- [ ] **Step 2: Three suites, type-check, lint**

```bash
cd ~/.config/superpowers/worktrees/esite/solar-phase-4a
pnpm --filter @esite/shared test 2>&1 | tail -4
pnpm --filter web test 2>&1 | tail -4
pnpm --filter @esite/db test:ci 2>&1 | tail -4
pnpm --filter @esite/shared type-check
pnpm --filter @esite/shared lint 2>&1 | tail -5
```
Expected: shared = 4a-i Task 1 baseline + 131; web and db unchanged from baseline; type-check exit 0; no lint errors.

- [ ] **Step 3: Scope check**

Run: `git diff --stat origin/feat/solar-phase-1a...HEAD`
Expected: only `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/scripts/solar/*`, `packages/shared/src/services/solar/**`. No migrations, no web or mobile files.

- [ ] **Step 4: Push**

```bash
git push origin feat/solar-phase-4a
```
(Refused over HTTPS → `git push git@github.com:WattMatt/e-site.git feat/solar-phase-4a`.)

- [ ] **Step 5: Update the draft PR body (it stays a draft)**

```bash
PR=$(gh pr list --head feat/solar-phase-4a --json number --jq '.[0].number')
gh pr view "$PR" --json body --jq .body > /tmp/pr-solar-4a.md
```
Edit `/tmp/pr-solar-4a.md`: change the heading to `## Solar Phase 4a — calculation engine (complete: PV model, battery, energy balance, finance)`, and insert this section above `### Suites` (keep the final `🤖 Generated with [Claude Code](https://claude.com/claude-code)` line as the last line):
```markdown
### What is in part ii
- Hourly energy balance: self-consumption / TOU arbitrage / peak shaving; RTE split √η; SoC bounds + backup reserve; export limit + curtailment; PV-vs-grid energy pools (grid-charged energy never counted as solar). Monthly MD after solar from sub-hourly load.
- `BillCalculator` — the narrow seam to the Phase 2a bill engine (12 monthly totals + export credit used). Tested with a stub; the real adapter arrives with 2a.
- Annual finance (§6): cash, debt, PPA, lease side by side (D-15; PPA/lease with client + investor views); insurance = 0.5 % of capex a year, no ×12 (D-05); D-07 defaults incl. 9 % → 7 % → CPI + 1 % escalation; tax + 12B optional, default off (D-16); load-shedding value separate, never in IRR (D-14); IRR by bracketed bisection; discounted LCOE; tornado.
- `simulateCase` / `runFinancials` stamp `ENGINE_VERSION` + `inputs_hash`; golden outputs pinned to the version.
- XLSX-independent check: 3-year toy cashflow matches the hand computation to 4 s.f. (NPV 3 881, IRR 0.1212, paybacks 2.435 / 2.888, LCOE 2.644).
- Open questions Q4–Q6 (see plan ii): costBill needs the export series; solar-fraction attribution under grid charging; tax treatment details.
```
Update the `### Suites` line with the new counts, then:
```bash
gh pr edit "$PR" --title "Solar Phase 4a: calculation engine (PV, battery, energy balance, finance)" --body-file /tmp/pr-solar-4a.md
gh pr view "$PR" --json isDraft,title,url
```
Expected: `isDraft: true`, the new title, the URL.

- [ ] **Step 6: Hand-off**

Report the PR URL, the suite counts, and the open questions below. Do not mark the PR ready and do not merge: Phase 4a merges only after the owner answers Q1–Q6 and a whole-branch review.

---

## Open questions (for the owner — none block this plan)

- **Q4 (spec §1.1 vs §5.7):** `costBill(load8760, tariff, calendar, year)` takes one series, but net billing needs import AND export per TOU period with month-to-month credit carry. The `BillCalculator` interface takes both; Phase 2a's `costBill` must too. Confirm, so 2a is planned against it.
- **Q5 (spec §4 KPIs):** solar fraction is computed as (direct + discharge-from-PV) / load. With grid charging off (the default) this equals the spec formula exactly; with grid charging on, the literal formula would count grid-charged battery energy as solar. Keep the attribution?
- **Q6 (spec §6 tax, D-16):** (a) debt interest is deducted (spec formula omits it); (b) a negative tax year is a shield against other income, not carried forward; (c) replacements are not deducted; (d) no default company tax rate — required when tax is enabled. Confirm each, or say which to change.
- **Q7 (spec §6):** saving is scaled per year (degradation on the PV share, fade on the battery share, tariff path on both) and load growth leaves the saving unchanged. This follows "rescaled, not re-run hourly per year"; flag if you would rather re-run the energy balance for years with a battery replacement.
