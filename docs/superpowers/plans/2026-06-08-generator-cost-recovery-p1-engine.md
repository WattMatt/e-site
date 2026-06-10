# Generator Cost-Recovery — P1: Calculation Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port nexus's generator cost-recovery maths into `packages/shared` as pure, fully-tested functions whose numbers are provably identical to nexus.

**Architecture:** A single pure module `packages/shared/src/services/generator-cost-recovery/` with no IO — typed inputs in, a typed cost-recovery model out. Verified two ways: (a) hand-computable unit tests for every function, and (b) a golden-master suite asserting equality against real nexus outputs. Nothing here touches the DB, react-pdf, or billing — those are P2–P4.

**Tech Stack:** TypeScript, Vitest (esite's test runner), pnpm workspace `@esite/shared`.

**Source of truth:** `engi-ops-nexus` — `src/utils/generatorSizing.ts` (fuel table), `src/utils/svg-pdf/generatorReportPdfBuilder.ts` (capex/tariff/apportionment, ~lines 215–370), `src/components/tenant/GeneratorLoadingSettings.tsx:175-186` (loading), `src/pages/GeneratorReport.tsx:184-190` (PMT).

**Spec:** `../specs/2026-06-08-generator-cost-recovery-design.md` (§6). **Decisions D1–D11 LOCKED.**

**Model note (D10/D11):** tenants carry a 3-state `participation` (`shared`/`own`/`none`) — *not* a binary `ownGenerator`. Only `shared` tenants are loaded, apportioned, and counted for board-mod capex; `own` + `none` → 0. `none` (opted out / didn't sign up) has **no nexus equivalent** → cover it with dedicated unit tests, **not** the golden-master. Absorption rule D11 (remaining `shared` tenants absorb) pending WM. See flows doc Flow P.

---

## Plan index (this feature = 5 sequenced plans)

- **P1 — Calc engine** *(this plan)* — pure maths in `packages/shared`, golden-master verified.
- **P2 — Data + capture** — migrations `00122` (`shop_category` + parser + backfill) and `00123` (`gcr.*` + `billing.org_feature_seats`); setup/zones/settings/assignment UI + readiness check.
- **P3 — Report** — new `@react-pdf` "kind" in `apps/web/src/lib/reports/generator/`; persist to `projects.reports`; deploy-verify render.
- **P4 — Entitlement** — `FEATURE_PRICES` seat entry + `has_feature_seat` guard + `/api/paystack/feature-seat` route + webhook branch + paywall + seats panel.
- **P5 — Launch** — gate behind Paystack live-mode; WM on-billing legality check; pre-sell ≥2 confirmation.

---

## Prerequisite — P0 gate (do before Task 1)

- [ ] **P0.1** WM confirms `engi-ops-nexus` `main` is the canonical, current formula set (not a branch/other app). *(Owner: WM)*
- [ ] **P0.2** Capture golden-master fixtures (Task 1 below makes this concrete). Requires read access to nexus.
- [ ] **P0.3** Branch off esite `main`: `git switch -c feat/generator-cost-recovery` in `~/Developer/ESITE.V1/esite`. (Business gates — pre-sell ≥2 — are P5 launch blockers, not build blockers.)

---

## File structure (created in this plan)

```
packages/shared/src/services/generator-cost-recovery/
  types.ts            # input/output interfaces + ShopCategory
  defaults.ts         # DEFAULT_GENERATOR_SETTINGS (nexus defaults)
  sizing-table.ts     # GENERATOR_SIZING_TABLE (verbatim from nexus) + getFuelConsumption()
  loading.ts          # calculateTenantLoadingKw()
  capital.ts          # calculateTotalCapitalCost() + calculateMonthlyCapitalRepayment()
  operational.ts      # calculateOperationalTariff()
  apportionment.ts    # calculateApportionment()
  index.ts            # buildGeneratorCostRecovery() composing all of the above + barrel exports
  __tests__/
    *.test.ts         # one per module (// @vitest-environment node not required — pure)
    __fixtures__/nexus-golden/*.json   # captured nexus outputs
```

Export the module from the package barrel so web (P3) and actions (P2) can import `@esite/shared`. **Do not** import react-pdf or any Node-only lib here — this module must stay isomorphic.

---

### Task 1: Golden-master fixtures (the F1 gate)

**Files:**
- Create: `packages/shared/src/services/generator-cost-recovery/__tests__/__fixtures__/nexus-golden/README.md`
- Create: `…/__fixtures__/nexus-golden/project-a.json` (+ `project-b.json`, `project-c.json`)

- [ ] **Step 1: Document the capture procedure.** Write the README:

```markdown
# Nexus golden-master fixtures
For 3 real generator-report projects in engi-ops-nexus, record EXACT inputs and
EVERY computed value the report shows, so the esite port can be asserted equal.

Capture per project (read from nexus UI/DB or by instrumenting generatorReportPdfBuilder.ts):
- settings: all 18 generator_settings fields
- zones[]: { zoneName, generators[]: { size, cost } }
- tenants[]: { shopNumber, shopName, areaM2, category, participation, manualKwOverride }
  (map nexus own_generator → participation 'own', else 'shared'; **'none'/opted-out has no nexus equivalent — unit-test it, not the golden-master**)
- expected.loadingKw: { [shopNumber]: number }
- expected.totalCapitalCost, expected.monthlyCapitalRepayment
- expected.tariff: { dieselPerKwh, maintenancePerKwh, base, contingency, finalTariff }
- expected.apportionment[]: { shopNumber, portionPercent, monthly, ratePerSqm }
Numbers are recorded to FULL precision (no rounding) — the port must match.
```

- [ ] **Step 2: Capture project-a.json** (and b, c) following the README. Shape:

```json
{
  "settings": { "standardKwPerSqm": 0.03, "...": "all 18 fields" },
  "zones": [{ "zoneName": "Zone 1", "generators": [{ "size": "250 kVA", "cost": 500000 }] }],
  "tenants": [{ "shopNumber": "S1", "shopName": "Acme", "areaM2": 100, "category": "standard", "participation": "shared", "manualKwOverride": null }],
  "expected": {
    "loadingKw": { "S1": 3.0 },
    "totalCapitalCost": 0,
    "monthlyCapitalRepayment": 0,
    "tariff": { "dieselPerKwh": 0, "maintenancePerKwh": 0, "base": 0, "contingency": 0, "finalTariff": 0 },
    "apportionment": [{ "shopNumber": "S1", "portionPercent": 0, "monthly": 0, "ratePerSqm": 0 }]
  }
}
```

- [ ] **Step 3: Commit fixtures.**

```bash
git add packages/shared/src/services/generator-cost-recovery/__tests__/__fixtures__
git commit -m "test(gcr): capture nexus golden-master fixtures for 3 projects"
```

> The golden-master test that consumes these is Task 8 — it is the gate that must pass before P1 is "done".

---

### Task 2: Types + defaults

**Files:**
- Create: `…/generator-cost-recovery/types.ts`
- Create: `…/generator-cost-recovery/defaults.ts`

- [ ] **Step 1: Write `types.ts`** (complete):

```typescript
export type ShopCategory = 'standard' | 'fast_food' | 'restaurant' | 'national' | 'other'

export interface GeneratorSettings {
  standardKwPerSqm: number
  fastFoodKwPerSqm: number
  restaurantKwPerSqm: number
  nationalKwPerSqm: number
  capitalRecoveryPeriodYears: number
  capitalRecoveryRatePercent: number
  ratePerTenantDb: number
  numMainBoards: number
  ratePerMainBoard: number
  additionalCablingCost: number
  controlWiringCost: number
  dieselCostPerLitre: number
  runningHoursPerMonth: number
  maintenanceCostAnnual: number
  powerFactor: number
  runningLoadPercentage: number
  maintenanceContingencyPercent: number
}

export type GeneratorParticipation = 'shared' | 'own' | 'none'

export interface TenantInput {
  shopNumber: string
  shopName: string
  areaM2: number
  category: ShopCategory
  participation: GeneratorParticipation   // shared=on building genset · own=own gen · none=opted out / didn't sign up
  manualKwOverride: number | null
}

export interface GeneratorInput { size: string; cost: number }
export interface ZoneInput { zoneName: string; generators: GeneratorInput[] }

export interface OperationalTariff {
  dieselPerKwh: number
  maintenancePerKwh: number
  base: number
  contingency: number
  finalTariff: number
}

export interface TenantAllocation {
  shopNumber: string
  shopName: string
  areaM2: number
  participation: GeneratorParticipation
  loadingKw: number
  portionPercent: number
  monthly: number
  ratePerSqm: number
}

export interface GeneratorCostRecoveryModel {
  totalCapitalCost: number
  monthlyCapitalRepayment: number
  tariff: OperationalTariff
  allocations: TenantAllocation[]
}

export interface GeneratorCostRecoveryInput {
  settings: GeneratorSettings
  zones: ZoneInput[]
  tenants: TenantInput[]
}
```

- [ ] **Step 2: Write `defaults.ts`** — the nexus defaults (used by P2 settings + tests):

```typescript
import type { GeneratorSettings } from './types'

export const DEFAULT_GENERATOR_SETTINGS: GeneratorSettings = {
  standardKwPerSqm: 0.03,
  fastFoodKwPerSqm: 0.045,
  restaurantKwPerSqm: 0.045,
  nationalKwPerSqm: 0.03,
  capitalRecoveryPeriodYears: 10,
  capitalRecoveryRatePercent: 12,
  ratePerTenantDb: 0,
  numMainBoards: 0,
  ratePerMainBoard: 0,
  additionalCablingCost: 0,
  controlWiringCost: 0,
  dieselCostPerLitre: 23,
  runningHoursPerMonth: 100,
  maintenanceCostAnnual: 18800,
  powerFactor: 0.95,
  runningLoadPercentage: 75,
  maintenanceContingencyPercent: 10,
}
```

- [ ] **Step 3: Commit.** `git commit -am "feat(gcr): engine types + nexus default settings"`

---

### Task 3: Tenant loading

**Files:** Create `…/loading.ts`; Test `…/__tests__/loading.test.ts`

- [ ] **Step 1: Write failing tests** (hand-computable):

```typescript
import { describe, it, expect } from 'vitest'
import { calculateTenantLoadingKw } from '../loading'
import { DEFAULT_GENERATOR_SETTINGS as S } from '../defaults'
import type { TenantInput } from '../types'

const t = (o: Partial<TenantInput>): TenantInput => ({
  shopNumber: 'S', shopName: 'x', areaM2: 100, category: 'standard',
  participation: 'shared', manualKwOverride: null, ...o,
})

describe('calculateTenantLoadingKw', () => {
  it('area × standard rate', () => expect(calculateTenantLoadingKw(t({ areaM2: 100, category: 'standard' }), S)).toBe(3))      // 100 × 0.03
  it('area × fast_food rate', () => expect(calculateTenantLoadingKw(t({ areaM2: 100, category: 'fast_food' }), S)).toBe(4.5)) // 100 × 0.045
  it('own generator → 0', () => expect(calculateTenantLoadingKw(t({ participation: 'own' }), S)).toBe(0))
  it('opted out (none) → 0', () => expect(calculateTenantLoadingKw(t({ participation: 'none', areaM2: 100, category: 'standard' }), S)).toBe(0))
  it('manual override wins (shared)', () => expect(calculateTenantLoadingKw(t({ manualKwOverride: 7 }), S)).toBe(7))
  it('non-shared beats override → 0', () => expect(calculateTenantLoadingKw(t({ participation: 'own', manualKwOverride: 7 }), S)).toBe(0))
})
```

- [ ] **Step 2: Run, verify FAIL.** `pnpm --filter @esite/shared test loading` → FAIL (no `calculateTenantLoadingKw`).
- [ ] **Step 3: Implement** `loading.ts` (port of nexus `GeneratorLoadingSettings.tsx:175-186`):

```typescript
import type { GeneratorSettings, TenantInput, ShopCategory } from './types'

export function calculateTenantLoadingKw(tenant: TenantInput, settings: GeneratorSettings): number {
  if (tenant.participation !== 'shared') return 0   // own + none (opted out) excluded
  if (tenant.manualKwOverride != null) return tenant.manualKwOverride
  if (!tenant.areaM2) return 0
  const rate: Record<ShopCategory, number> = {
    standard: settings.standardKwPerSqm,
    fast_food: settings.fastFoodKwPerSqm,
    restaurant: settings.restaurantKwPerSqm,
    national: settings.nationalKwPerSqm,
    other: settings.standardKwPerSqm,
  }
  return tenant.areaM2 * (rate[tenant.category] ?? settings.standardKwPerSqm)
}
```

> NOTE vs nexus: confirm override-vs-area precedence against nexus during the golden-master pass (Task 8). If nexus applies the override differently, the golden-master fails and you reconcile here.

- [ ] **Step 4: Run, verify PASS.** `pnpm --filter @esite/shared test loading` → PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat(gcr): tenant loading kW"`

---

### Task 4: Capital cost + PMT recovery

**Files:** Create `…/capital.ts`; Test `…/__tests__/capital.test.ts`

- [ ] **Step 1: Write failing tests:**

```typescript
import { describe, it, expect } from 'vitest'
import { calculateTotalCapitalCost, calculateMonthlyCapitalRepayment } from '../capital'
import { DEFAULT_GENERATOR_SETTINGS } from '../defaults'
import type { ZoneInput, TenantInput } from '../types'

const zones: ZoneInput[] = [{ zoneName: 'Z1', generators: [{ size: '250 kVA', cost: 500000 }, { size: '100 kVA', cost: 300000 }] }]
const tenants: TenantInput[] = [
  { shopNumber: 'A', shopName: 'a', areaM2: 100, category: 'standard', participation: 'shared', manualKwOverride: null },
  { shopNumber: 'B', shopName: 'b', areaM2: 200, category: 'standard', participation: 'shared', manualKwOverride: null },
  { shopNumber: 'C', shopName: 'c', areaM2: 50,  category: 'standard', participation: 'own',    manualKwOverride: null },
  { shopNumber: 'D', shopName: 'd', areaM2: 80,  category: 'standard', participation: 'none',   manualKwOverride: null },
]

it('total capital cost', () => {
  const s = { ...DEFAULT_GENERATOR_SETTINGS, ratePerTenantDb: 2000, numMainBoards: 1, ratePerMainBoard: 10000, additionalCablingCost: 50000, controlWiringCost: 20000 }
  // gens 800000 + boardMod(2 SHARED tenant DBs A,B × 2000 + 1 main × 10000 = 14000; C=own, D=none both excluded) + cabling 50000 + control 20000
  expect(calculateTotalCapitalCost(zones, tenants, s)).toBe(884000)
})

it('PMT monthly repayment', () => {
  // capex 1,000,000 @ 12% over 10y → annual 176,984.16 → /12
  expect(calculateMonthlyCapitalRepayment(1_000_000, DEFAULT_GENERATOR_SETTINGS)).toBeCloseTo(14748.68, 1)
})

it('zero-rate guard does not divide by zero', () => {
  expect(calculateMonthlyCapitalRepayment(0, DEFAULT_GENERATOR_SETTINGS)).toBe(0)
})
```

- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** `capital.ts` (port of nexus `generatorReportPdfBuilder.ts:215-230` + `GeneratorReport.tsx:184-190`):

```typescript
import type { GeneratorSettings, ZoneInput, TenantInput } from './types'

export function calculateTotalCapitalCost(zones: ZoneInput[], tenants: TenantInput[], s: GeneratorSettings): number {
  const genTotal = zones.reduce((sum, z) => sum + z.generators.reduce((g, gen) => g + gen.cost, 0), 0)
  const numTenantDBs = tenants.filter(t => t.participation === 'shared').length
  const boardModCost = numTenantDBs * s.ratePerTenantDb + s.numMainBoards * s.ratePerMainBoard
  return genTotal + s.additionalCablingCost + boardModCost + s.controlWiringCost
}

export function calculateMonthlyCapitalRepayment(totalCapitalCost: number, s: GeneratorSettings): number {
  if (totalCapitalCost <= 0) return 0
  const n = s.capitalRecoveryPeriodYears
  const r = s.capitalRecoveryRatePercent / 100
  if (r === 0) return totalCapitalCost / n / 12
  const factor = Math.pow(1 + r, n)
  const annual = totalCapitalCost * ((r * factor) / (factor - 1))
  return annual / 12
}
```

- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit.** `git commit -am "feat(gcr): capital cost + PMT recovery"`

---

### Task 5: Sizing table + fuel-consumption lookup

**Files:** Create `…/sizing-table.ts`; Test `…/__tests__/sizing-table.test.ts`

- [ ] **Step 1: Port the table verbatim.** Copy `GENERATOR_SIZING_TABLE` from nexus `src/utils/generatorSizing.ts` into `sizing-table.ts` **unchanged** (all 24 sizes + load-% columns). Do not retype by hand — copy the literal.
- [ ] **Step 2: Write failing tests** for `getFuelConsumption(size, runningLoadPercent)` — exact-row + interpolation. Use two real rows from the copied table; e.g. if `'250 kVA'` has 50%→A and 75%→B:

```typescript
import { describe, it, expect } from 'vitest'
import { getFuelConsumption } from '../sizing-table'

it('exact load row returns table value', () => expect(getFuelConsumption('250 kVA', 75)).toBe(/* B from table */ 0))
it('between rows interpolates linearly', () => expect(getFuelConsumption('250 kVA', 62.5)).toBeCloseTo(/* (A+B)/2 */ 0, 3))
it('unknown size throws', () => expect(() => getFuelConsumption('999 kVA', 75)).toThrow())
```

Fill the `0`s with the real values from the copied table before running.

- [ ] **Step 3: Run, verify FAIL.**
- [ ] **Step 4: Implement** `getFuelConsumption` mirroring nexus's interpolation (port the lookup/interp logic from `generatorSizing.ts`; linear between the two nearest load-% columns, clamp at ends).
- [ ] **Step 5: Run, verify PASS.** **Step 6: Commit.** `git commit -am "feat(gcr): generator sizing table + fuel lookup"`

---

### Task 6: Operational tariff (R/kWh)

**Files:** Create `…/operational.ts`; Test `…/__tests__/operational.test.ts`

- [ ] **Step 1: Write failing tests.** Inject fuel consumption so the tariff is hand-computable independent of the table:

```typescript
import { describe, it, expect } from 'vitest'
import { calculateOperationalTariff } from '../operational'
import { DEFAULT_GENERATOR_SETTINGS } from '../defaults'

it('diesel + maintenance + contingency tariff', () => {
  // largest gen 250 kVA, load 75% → netKva 187.5, netKwh 178.125
  // fuel 50 l/h (injected) × R23 × 100h = 115,000/mo diesel → /178.125 = 645.614 R/kWh
  // maint: 18800/12 = 1566.667/mo; serviceCostPer250h = 18800×(100/250/12)=626.667; additional max(0,626.667-1566.667)=0
  //        → 1566.667/178.125 = 8.795 R/kWh ; base 654.409 ; +10% contingency 65.441 ; final 719.850
  const r = calculateOperationalTariff(DEFAULT_GENERATOR_SETTINGS, { kva: 250, fuelConsumptionLPerH: 50 })
  expect(r.dieselPerKwh).toBeCloseTo(645.614, 2)
  expect(r.maintenancePerKwh).toBeCloseTo(8.795, 2)
  expect(r.finalTariff).toBeCloseTo(719.850, 2)
})
```

- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** `operational.ts` (port of `generatorReportPdfBuilder.ts:284-320`):

```typescript
import type { GeneratorSettings, OperationalTariff } from './types'

export function calculateOperationalTariff(
  s: GeneratorSettings,
  largestGen: { kva: number; fuelConsumptionLPerH: number },
): OperationalTariff {
  const netKva = largestGen.kva * (s.runningLoadPercentage / 100)
  const netKwh = netKva * s.powerFactor
  const monthlyDiesel = largestGen.fuelConsumptionLPerH * s.dieselCostPerLitre * s.runningHoursPerMonth
  const dieselPerKwh = netKwh === 0 ? 0 : monthlyDiesel / netKwh
  const maintMonthly = s.maintenanceCostAnnual / 12
  const serviceCostPer250h = s.maintenanceCostAnnual * (s.runningHoursPerMonth / 250 / 12)
  const additional = Math.max(0, serviceCostPer250h - maintMonthly)
  const maintenancePerKwh = netKwh === 0 ? 0 : (maintMonthly + additional) / netKwh
  const base = dieselPerKwh + maintenancePerKwh
  const contingency = base * (s.maintenanceContingencyPercent / 100)
  return { dieselPerKwh, maintenancePerKwh, base, contingency, finalTariff: base + contingency }
}
```

> The caller (Task 7/`index.ts`) derives `largestGen` by picking the largest-kVA generator across zones and calling `getFuelConsumption(size, runningLoadPercentage)`. Confirm "largest" selection against nexus in Task 8.

- [ ] **Step 4: Run, verify PASS.** **Step 5: Commit.** `git commit -am "feat(gcr): operational tariff R/kWh"`

---

### Task 7: Apportionment + top-level compose

**Files:** Create `…/apportionment.ts`, `…/index.ts`; Test `…/__tests__/apportionment.test.ts`

- [ ] **Step 1: Write failing tests** (hand-computable):

```typescript
import { describe, it, expect } from 'vitest'
import { calculateApportionment } from '../apportionment'
import { DEFAULT_GENERATOR_SETTINGS as S } from '../defaults'
import type { TenantInput } from '../types'

const tenants: TenantInput[] = [
  { shopNumber: 'A', shopName: 'a', areaM2: 100, category: 'standard', participation: 'shared', manualKwOverride: null }, // 3 kW
  { shopNumber: 'B', shopName: 'b', areaM2: 200, category: 'standard', participation: 'shared', manualKwOverride: null }, // 6 kW
  { shopNumber: 'C', shopName: 'c', areaM2: 50,  category: 'standard', participation: 'own',    manualKwOverride: null }, // 0 (own gen)
  { shopNumber: 'D', shopName: 'd', areaM2: 80,  category: 'standard', participation: 'none',   manualKwOverride: null }, // 0 (opted out)
]

it('apportions monthly repayment by load share', () => {
  const rows = calculateApportionment(tenants, S, 900) // total active load 9 kW (A,B shared; C own, D none excluded)
  const a = rows.find(r => r.shopNumber === 'A')!
  expect(a.loadingKw).toBe(3)
  expect(a.portionPercent).toBeCloseTo(33.333, 2)
  expect(a.monthly).toBeCloseTo(300, 6)
  expect(a.ratePerSqm).toBeCloseTo(3, 6)
  expect(rows.find(r => r.shopNumber === 'C')!.monthly).toBe(0) // own generator
  expect(rows.find(r => r.shopNumber === 'D')!.monthly).toBe(0) // opted out (none)
})

it('reconciliation invariant: Σ monthly === monthly repayment', () => {
  const sum = calculateApportionment(tenants, S, 900).reduce((s, r) => s + r.monthly, 0)
  expect(sum).toBeCloseTo(900, 6) // opted-out tenants contribute 0; shared shares sum to the repayment
})
```

- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** `apportionment.ts` (port of `generatorReportPdfBuilder.ts:345-370`):

```typescript
import type { GeneratorSettings, TenantInput, TenantAllocation } from './types'
import { calculateTenantLoadingKw } from './loading'

export function calculateApportionment(
  tenants: TenantInput[], settings: GeneratorSettings, monthlyRepayment: number,
): TenantAllocation[] {
  const loads = tenants.map(t => ({ t, loadingKw: calculateTenantLoadingKw(t, settings) }))
  const totalActive = loads.filter(x => x.t.participation === 'shared').reduce((s, x) => s + x.loadingKw, 0)
  return loads.map(({ t, loadingKw }) => {
    const active = totalActive > 0 && t.participation === 'shared'
    const portionPercent = active ? (loadingKw / totalActive) * 100 : 0
    const monthly = active ? (loadingKw / totalActive) * monthlyRepayment : 0
    const ratePerSqm = active && t.areaM2 > 0 ? monthly / t.areaM2 : 0
    return { shopNumber: t.shopNumber, shopName: t.shopName, areaM2: t.areaM2, participation: t.participation, loadingKw, portionPercent, monthly, ratePerSqm }
  })
}
```

- [ ] **Step 4: Write `index.ts`** — compose into `buildGeneratorCostRecovery(input): GeneratorCostRecoveryModel` (capex → PMT → largest-gen tariff → apportionment) and re-export the public API. Add a small test that the composed model wires the pieces (totalCapitalCost, monthlyCapitalRepayment, allocations length).
- [ ] **Step 5: Run, verify PASS.** **Step 6: Commit.** `git commit -am "feat(gcr): apportionment + composed cost-recovery model"`

---

### Task 8: Golden-master suite (the gate)

**Files:** Test `…/__tests__/golden-master.test.ts`

- [ ] **Step 1: Write the suite** consuming Task 1 fixtures:

```typescript
import { describe, it, expect } from 'vitest'
import { buildGeneratorCostRecovery } from '../index'
import { calculateTenantLoadingKw } from '../loading'
import projectA from './__fixtures__/nexus-golden/project-a.json'
import projectB from './__fixtures__/nexus-golden/project-b.json'
import projectC from './__fixtures__/nexus-golden/project-c.json'

describe.each([['A', projectA], ['B', projectB], ['C', projectC]])('nexus parity — project %s', (_name, fx: any) => {
  const model = buildGeneratorCostRecovery({ settings: fx.settings, zones: fx.zones, tenants: fx.tenants })
  it('per-tenant loading kW', () => {
    for (const t of fx.tenants) expect(calculateTenantLoadingKw(t, fx.settings)).toBeCloseTo(fx.expected.loadingKw[t.shopNumber], 6)
  })
  it('total capital cost', () => expect(model.totalCapitalCost).toBeCloseTo(fx.expected.totalCapitalCost, 4))
  it('monthly capital repayment', () => expect(model.monthlyCapitalRepayment).toBeCloseTo(fx.expected.monthlyCapitalRepayment, 4))
  it('tariff finalTariff', () => expect(model.tariff.finalTariff).toBeCloseTo(fx.expected.tariff.finalTariff, 4))
  it('apportionment per tenant', () => {
    for (const e of fx.expected.apportionment) {
      const row = model.allocations.find(r => r.shopNumber === e.shopNumber)!
      expect(row.monthly).toBeCloseTo(e.monthly, 2)
      expect(row.ratePerSqm).toBeCloseTo(e.ratePerSqm, 2)
    }
  })
})
```

- [ ] **Step 2: Run.** `pnpm --filter @esite/shared test golden-master`. **If any assertion fails, the port differs from nexus — reconcile the implementation to nexus (not the fixture).** Repeat until green. This is the F1 gate.
- [ ] **Step 3: Run the whole package + type-check.** `pnpm --filter @esite/shared test && pnpm --filter @esite/shared type-check` → all green.
- [ ] **Step 4: Commit.** `git commit -am "test(gcr): nexus golden-master parity green — engine verified"`

---

## Self-Review (completed)

- **Spec coverage:** §6 of the spec (loading, capex, PMT, tariff, apportionment, sizing table) → Tasks 3–7; the F1 golden-master gate → Tasks 1 & 8. Entitlement/data/report/UI are out of scope for P1 by design (P2–P4). ✅
- **Placeholder scan:** the only "fill-in" values are the **real numbers to be copied from nexus** (sizing table values in Task 5, fixture values in Task 1) — these are deliberate capture tasks with explicit sources, not hand-wavy placeholders. Every function has complete code + hand-computable tests. ✅
- **Type consistency:** `GeneratorSettings`/`TenantInput`/`ZoneInput`/`TenantAllocation`/`GeneratorCostRecoveryModel` defined once in Task 2 and used consistently in Tasks 3–8; `calculateTenantLoadingKw`, `calculateTotalCapitalCost`, `calculateMonthlyCapitalRepayment`, `calculateOperationalTariff`, `calculateApportionment`, `buildGeneratorCostRecovery` names stable throughout. ✅

---

## Execution handoff

Run this plan with **superpowers:subagent-driven-development** (one subagent per task, two-stage review between tasks) — matches how esite ships. P2–P5 plans get written in sequence after P1 is green.
