# Solar Phase 4b — Part 2: The case model (`@esite/shared/solar-cases`)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `2026-09-28-solar-phase-4b-0-index.md` first.

**Goal:** Every piece of pure logic between a stored case row and the engine — and between the engine and a stored run — in one tested, I/O-free module, so the web layer only loads rows and persists results.

**Architecture:** New directory `packages/shared/src/solar/cases/`, exported as the subpath `@esite/shared/solar-cases` (NOT from the package root: it imports engine runtime, and the root barrel is imported by client bundles). It imports the engine by relative path (`../../services/solar/...`) and the tariff core (`../../tariffs/...`). Configs are zod schemas stored as JSONB; the engine's `CaseInput` is built from them; outputs are a versioned JSON document plus an 8760 CSV.

**Tech Stack:** TypeScript, zod 3, vitest. Test fixtures: 4a's `__fixtures__/pvgis.ts` (verbatim PVGIS TMY, sha-pinned) and `__fixtures__/stub-bill-calculator.ts`.

**Run shared tests with:** `cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b && pnpm --filter @esite/shared test -- <path>`

---

### Task 5: Subpath export + case config schema

**Files:**
- Modify: `packages/shared/package.json` (`exports`)
- Create: `packages/shared/src/solar/cases/config.ts`
- Create: `packages/shared/src/solar/cases/index.ts`
- Test: `packages/shared/src/solar/cases/config.test.ts`

- [ ] **Step 1: Add the subpath export** in `packages/shared/package.json`, after `"./solar-load": …`:

```json
    "./solar-cases": "./src/solar/cases/index.ts"
```
(keep the preceding line's trailing comma correct).

- [ ] **Step 2: Write the failing test** `packages/shared/src/solar/cases/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { solarOrgSettingDefaults } from '../org-settings'
import { defaultCaseConfig, parseCaseConfig, effectiveLosses, resetLossesToDefaults, CASE_CONFIG_VERSION } from './config'

const settings = solarOrgSettingDefaults()

describe('defaultCaseConfig', () => {
  it('copies the org loss and degradation defaults (a case stores its own snapshot)', () => {
    const c = defaultCaseConfig(settings, { dcKwp: 500, acKw: 400 })
    expect(c.version).toBe(CASE_CONFIG_VERSION)
    expect(c.pv).toMatchObject({ source: 'manual', dcKwp: 500, acKw: 400, tiltDeg: 15, azimuthDeg: 0, mounting: 'racked', module: null })
    expect(c.losses).toMatchObject({ mode: 'standard', soilingPct: 2, shadingPct: 3, mismatchPct: 1, dcWiringPct: 1.5, lidPct: 1.5, acWiringPct: 1, availabilityPct: 99, albedo: 0.2 })
    expect(c.degradation).toEqual({ firstYearPct: 2, annualPct: 0.5 })
    expect(c.battery).toMatchObject({ enabled: false, rtePct: 90, socMinPct: 10, socMaxPct: 95, strategy: 'self-consumption', gridCharging: false })
    expect(c.weather).toEqual({ source: 'pvgis_tmy', datasetId: null })
    expect(parseCaseConfig(c)).toEqual({ ok: true, config: c })
  })

  it('an org that changed soiling to 3 % gets 3 % in new cases', () => {
    const c = defaultCaseConfig({ ...settings, soiling_pct: 3 }, { dcKwp: 100, acKw: 80 })
    expect(c.losses.soilingPct).toBe(3)
  })
})

describe('parseCaseConfig', () => {
  const ok = defaultCaseConfig(settings, { dcKwp: 500, acKw: 400 })

  it('refuses grid charging outside TOU arbitrage (spec §7.2)', () => {
    const bad = { ...ok, battery: { ...ok.battery, enabled: true, usableKwh: 100, maxChargeKw: 50, maxDischargeKw: 50, gridCharging: true } }
    const r = parseCaseConfig(bad)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors['battery.gridCharging']).toBe('Grid charging is only allowed with TOU arbitrage')
  })

  it('refuses peak shaving without a target', () => {
    const bad = { ...ok, battery: { ...ok.battery, enabled: true, usableKwh: 100, maxChargeKw: 50, maxDischargeKw: 50, strategy: 'peak-shaving', peakTargetKw: null } }
    const r = parseCaseConfig(bad)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors['battery.peakTargetKw']).toBe('Enter the peak-shaving target')
  })

  it('refuses SoC min ≥ max and an initial SoC outside the band', () => {
    const bad = { ...ok, battery: { ...ok.battery, enabled: true, usableKwh: 100, maxChargeKw: 50, maxDischargeKw: 50, socMinPct: 90, socMaxPct: 80, initialSocPct: 50 } }
    const r = parseCaseConfig(bad)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors['battery.socMaxPct']).toBe('SoC max must be above SoC min')
  })

  it('refuses unknown keys and wrong types with a path', () => {
    const r = parseCaseConfig({ ...ok, pv: { ...ok.pv, dcKwp: 'lots' } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(Object.keys(r.errors)).toContain('pv.dcKwp')
    expect(parseCaseConfig({ ...ok, surprise: 1 }).ok).toBe(false)
    expect(parseCaseConfig(null).ok).toBe(false)
  })
})

describe('losses', () => {
  const c = defaultCaseConfig(settings, { dcKwp: 500, acKw: 400 })

  it('standard mode forces the detailed-only inputs back to defaults', () => {
    const edited = { ...c, losses: { ...c.losses, mode: 'standard' as const, nameplatePct: 3, iamB0: 0.1, transposition: 'hay-davies' as const, cellTemp: { kind: 'noct' as const, noctC: 45 } } }
    expect(effectiveLosses(edited)).toMatchObject({ nameplatePct: 0, iamB0: 0.05, transposition: 'perez', cellTemp: { kind: 'faiman', u0: 25, u1: 6.84 } })
  })

  it('detailed mode keeps every input', () => {
    const edited = { ...c, losses: { ...c.losses, mode: 'detailed' as const, nameplatePct: 3 } }
    expect(effectiveLosses(edited).nameplatePct).toBe(3)
  })

  it('Reset to defaults restores the org values and the mounting-dependent shading', () => {
    const flush = { ...c, pv: { ...c.pv, mounting: 'flush' as const }, losses: { ...c.losses, soilingPct: 9, mode: 'detailed' as const } }
    const reset = resetLossesToDefaults(flush, settings)
    expect(reset.losses).toMatchObject({ mode: 'detailed', soilingPct: 2, shadingPct: 1 })
  })
})
```

- [ ] **Step 3: Run it — expect FAIL** (`Cannot find module './config'`).

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b && pnpm --filter @esite/shared test -- src/solar/cases/config.test.ts 2>&1 | tail -5
```

- [ ] **Step 4: Implement** `packages/shared/src/solar/cases/config.ts`:

```ts
/**
 * Case configuration (functional spec §7.2) — stored as solar.cases.config (JSONB). Holds NO money
 * (money is solar.case_financials, gated on solar_can_see_money). A case stores its own snapshot of
 * the org defaults and of any catalogue equipment, so later changes to either never alter past results.
 */
import { z } from 'zod'
import type { SolarOrgSettingValues } from '../org-settings'
import { SOLAR_ENGINE_DEFAULTS } from '../../services/solar/defaults'
import { DEFAULT_FAIMAN } from '../../services/solar/pv/cell-temperature'

export const CASE_CONFIG_VERSION = 1 as const

const num = (min: number, max: number) => z.number().finite().min(min).max(max)
const uuid = z.string().uuid()

export const ModuleSnapshotSchema = z.object({
  equipmentId: uuid, make: z.string().min(1).max(120), model: z.string().min(1).max(120),
  pmaxW: num(1, 2000), gammaPmaxPctPerC: num(-1, 0),
}).strict()
export const InverterSnapshotSchema = z.object({
  equipmentId: uuid, make: z.string().min(1).max(120), model: z.string().min(1).max(120),
  acKw: num(0.1, 100_000), euroEfficiencyPct: num(50, 100),
}).strict()
export const BatterySnapshotSchema = z.object({
  equipmentId: uuid, make: z.string().min(1).max(120), model: z.string().min(1).max(120),
  usableKwh: num(0.1, 1e6), powerKw: num(0.1, 1e6), rtePct: num(50, 100),
}).strict()

export const CaseConfigSchema = z.object({
  version: z.literal(CASE_CONFIG_VERSION),
  pv: z.object({
    source: z.literal('manual'),
    dcKwp: num(0.1, 100_000),
    acKw: num(0.1, 100_000),
    tiltDeg: num(0, 90),
    azimuthDeg: z.number().finite().min(0).lt(360),
    mounting: z.enum(['racked', 'flush']),
    module: ModuleSnapshotSchema.nullable(),
    inverter: InverterSnapshotSchema.nullable(),
  }).strict(),
  losses: z.object({
    mode: z.enum(['standard', 'detailed']),
    soilingPct: num(0, 50), shadingPct: num(0, 50), mismatchPct: num(0, 20), dcWiringPct: num(0, 20),
    lidPct: num(0, 20), nameplatePct: num(-5, 10), acWiringPct: num(0, 20), availabilityPct: num(50, 100),
    albedo: num(0, 1), iamB0: num(0, 0.2),
    cellTemp: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('faiman'), u0: num(1, 100), u1: num(0, 50) }).strict(),
      z.object({ kind: z.literal('noct'), noctC: num(20, 80) }).strict(),
    ]),
    transposition: z.enum(['perez', 'hay-davies']),
  }).strict(),
  degradation: z.object({ firstYearPct: num(0, 20), annualPct: num(0, 5) }).strict(),
  weather: z.object({ source: z.literal('pvgis_tmy'), datasetId: uuid.nullable() }).strict(),
  battery: z.object({
    enabled: z.boolean(),
    unit: BatterySnapshotSchema.nullable(),
    usableKwh: num(0, 1e6), maxChargeKw: num(0, 1e6), maxDischargeKw: num(0, 1e6),
    rtePct: num(50, 100), socMinPct: num(0, 100), socMaxPct: num(0, 100), initialSocPct: num(0, 100),
    backupReservePct: num(0, 100),
    strategy: z.enum(['self-consumption', 'tou-arbitrage', 'peak-shaving']),
    peakTargetKw: num(0, 1e6).nullable(),
    gridCharging: z.boolean(),
  }).strict(),
  grid: z.object({
    overrideExport: z.boolean(),
    exportAllowed: z.boolean(),
    exportLimitKw: num(0, 1e6).nullable(),
    inverterAcCapKw: num(0.1, 1e6).nullable(),
  }).strict(),
  load: z.object({ adjustmentPct: num(-90, 200) }).strict(),
  loadShedding: z.object({
    enabled: z.boolean(),
    stage: z.number().int().min(1).max(8),
    hoursPerYear: num(0, 8760),
    backedLoadKw: num(0, 1e6),
  }).strict(),
}).strict().superRefine((c, ctx) => {
  const b = c.battery
  if (b.gridCharging && b.strategy !== 'tou-arbitrage') {
    ctx.addIssue({ code: 'custom', path: ['battery', 'gridCharging'], message: 'Grid charging is only allowed with TOU arbitrage' })
  }
  if (b.strategy === 'peak-shaving' && !(b.peakTargetKw !== null && b.peakTargetKw > 0)) {
    ctx.addIssue({ code: 'custom', path: ['battery', 'peakTargetKw'], message: 'Enter the peak-shaving target' })
  }
  if (b.socMaxPct <= b.socMinPct) {
    ctx.addIssue({ code: 'custom', path: ['battery', 'socMaxPct'], message: 'SoC max must be above SoC min' })
  } else if (b.initialSocPct < b.socMinPct || b.initialSocPct > b.socMaxPct) {
    ctx.addIssue({ code: 'custom', path: ['battery', 'initialSocPct'], message: 'Initial SoC must be between SoC min and max' })
  }
})

export type CaseConfig = z.infer<typeof CaseConfigSchema>
export type CaseLosses = CaseConfig['losses']

export type ParseCaseConfigResult = { ok: true; config: CaseConfig } | { ok: false; errors: Record<string, string> }

export function parseCaseConfig(raw: unknown): ParseCaseConfigResult {
  const r = CaseConfigSchema.safeParse(raw)
  if (r.success) return { ok: true, config: r.data }
  const errors: Record<string, string> = {}
  for (const issue of r.error.issues) {
    const key = issue.path.join('.') || '(root)'
    if (!errors[key]) errors[key] = issue.message
  }
  return { ok: false, errors }
}

function setting(s: SolarOrgSettingValues, key: string, fallback: number): number {
  const v = s[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** fraction → percent without binary noise (0.07 * 100 is 7.000000000000001 in IEEE doubles). */
const toPct = (fraction: number) => Math.round(fraction * 1e8) / 1e6

const shadingFor = (mounting: 'racked' | 'flush') =>
  toPct(mounting === 'racked' ? SOLAR_ENGINE_DEFAULTS.losses.shadingRacked : SOLAR_ENGINE_DEFAULTS.losses.dc.shading)

function defaultLosses(s: SolarOrgSettingValues, mounting: 'racked' | 'flush', mode: 'standard' | 'detailed'): CaseLosses {
  const d = SOLAR_ENGINE_DEFAULTS.losses
  return {
    mode,
    soilingPct: setting(s, 'soiling_pct', toPct(d.dc.soiling)),
    shadingPct: shadingFor(mounting),
    mismatchPct: setting(s, 'mismatch_pct', toPct(d.dc.mismatch)),
    dcWiringPct: setting(s, 'dc_wiring_pct', toPct(d.dc.dcWiring)),
    lidPct: setting(s, 'lid_pct', toPct(d.dc.lid)),
    nameplatePct: 0,
    acWiringPct: setting(s, 'ac_wiring_pct', toPct(d.ac.acWiring)),
    availabilityPct: setting(s, 'availability_pct', toPct(d.ac.availability)),
    albedo: setting(s, 'albedo', SOLAR_ENGINE_DEFAULTS.albedo),
    iamB0: SOLAR_ENGINE_DEFAULTS.moduleIamB0,
    cellTemp: { kind: 'faiman', u0: DEFAULT_FAIMAN.u0, u1: DEFAULT_FAIMAN.u1 },
    transposition: 'perez',
  }
}

export function defaultCaseConfig(s: SolarOrgSettingValues, size: { dcKwp: number; acKw: number }): CaseConfig {
  const b = SOLAR_ENGINE_DEFAULTS.battery
  return {
    version: CASE_CONFIG_VERSION,
    pv: { source: 'manual', dcKwp: size.dcKwp, acKw: size.acKw, tiltDeg: 15, azimuthDeg: 0, mounting: 'racked', module: null, inverter: null },
    losses: defaultLosses(s, 'racked', 'standard'),
    degradation: {
      firstYearPct: setting(s, 'degradation_first_year_pct', toPct(SOLAR_ENGINE_DEFAULTS.degradation.firstYear)),
      annualPct: setting(s, 'degradation_annual_pct', toPct(SOLAR_ENGINE_DEFAULTS.degradation.annual)),
    },
    weather: { source: 'pvgis_tmy', datasetId: null },
    battery: {
      enabled: false, unit: null, usableKwh: 0, maxChargeKw: 0, maxDischargeKw: 0,
      rtePct: toPct(b.roundTripEfficiency), socMinPct: toPct(b.socMin), socMaxPct: toPct(b.socMax), initialSocPct: 50,
      backupReservePct: 0, strategy: 'self-consumption', peakTargetKw: null, gridCharging: false,
    },
    grid: { overrideExport: false, exportAllowed: true, exportLimitKw: null, inverterAcCapKw: null },
    load: { adjustmentPct: 0 },
    loadShedding: { enabled: false, stage: 2, hoursPerYear: 0, backedLoadKw: 0 },
  }
}

/** Standard mode shows only the standard losses; the detailed-only inputs take their defaults. */
export function effectiveLosses(c: CaseConfig): CaseLosses {
  if (c.losses.mode === 'detailed') return c.losses
  return {
    ...c.losses,
    nameplatePct: 0,
    iamB0: SOLAR_ENGINE_DEFAULTS.moduleIamB0,
    cellTemp: { kind: 'faiman', u0: DEFAULT_FAIMAN.u0, u1: DEFAULT_FAIMAN.u1 },
    transposition: 'perez',
  }
}

/** "Reset to defaults" (spec §7.2): the org values now, keeping the chosen mode. */
export function resetLossesToDefaults(c: CaseConfig, s: SolarOrgSettingValues): CaseConfig {
  return { ...c, losses: defaultLosses(s, c.pv.mounting, c.losses.mode) }
}
```

- [ ] **Step 5: Create the barrel** `packages/shared/src/solar/cases/index.ts` (later tasks append lines):

```ts
// @esite/shared/solar-cases — pure case/run/financials logic around the engine. Server-side runtime
// use only: this barrel imports the engine. Client components may `import type` from it.
export * from './config'
```

- [ ] **Step 6: Run — expect PASS.** Then commit.

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b && pnpm --filter @esite/shared test -- src/solar/cases/config.test.ts 2>&1 | tail -3
git add packages/shared/package.json packages/shared/src/solar/cases
git commit -m "feat(solar): case config schema with org-default snapshot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Finance config, capex totals, rate card; rate-card org settings

**Files:**
- Create: `packages/shared/src/solar/cases/finance-config.ts`
- Test: `packages/shared/src/solar/cases/finance-config.test.ts`
- Modify: `packages/shared/src/solar/org-settings.ts:10,27-31,33` (section + fields)
- Modify: `packages/shared/src/solar/org-settings.test.ts` (new section assertion)

- [ ] **Step 1: Write the failing tests** `packages/shared/src/solar/cases/finance-config.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { solarOrgSettingDefaults } from '../org-settings'
import { applyRateCard, capexTotals, defaultFinanceConfig, parseFinanceConfig, VAT_RATE, type CapexLine } from './finance-config'

const settings = solarOrgSettingDefaults()
const line = (over: Partial<CapexLine>): CapexLine => ({
  id: 'l1', category: 'modules', description: 'x', qty: 1, unit: 'item', rateZar: 0, qualifies12b: true, source: 'manual', ...over,
})

describe('defaultFinanceConfig', () => {
  it('takes D-05/D-07/D-16 defaults from org settings; cash only; tax off at 27 %', () => {
    const f = defaultFinanceConfig(settings)
    expect(f.capex).toEqual([])
    expect(f.opex).toMatchObject({ omMode: 'per_kwp', omZarPerKwpYear: 150, insurancePctOfCapex: 0.5, inverterReplacementYear: 12, inverterReplacementPct: 60, batteryReplacementYear: 10, batteryReplacementPct: 50 })
    expect(f.models.cash.enabled).toBe(true)
    expect([f.models.debt.enabled, f.models.ppa.enabled, f.models.lease.enabled]).toEqual([false, false, false])
    expect(f.analysis).toMatchObject({ years: 25, discountRatePct: 11, cpiPct: 5, escalationStartPct: 9, escalationYear10Pct: 7, escalationAfterCpiPlusPct: 1, taxEnabled: false, companyTaxRatePct: 27, section12b: false })
    expect(parseFinanceConfig(f).ok).toBe(true)
  })

  it('refuses a config with no finance model', () => {
    const f = defaultFinanceConfig(settings)
    const r = parseFinanceConfig({ ...f, models: { ...f.models, cash: { enabled: false } } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.models).toBe('Choose at least one finance model')
  })

  it('refuses a PPA buy-out with a year but no price', () => {
    const f = defaultFinanceConfig(settings)
    const r = parseFinanceConfig({ ...f, models: { ...f.models, ppa: { ...f.models.ppa, enabled: true, startTariffZarPerKwh: 1.5, buyoutYear: 10, buyoutPriceZar: null } } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors['models.ppa.buyoutPriceZar']).toBe('Enter both the buy-out year and price, or neither')
  })
})

describe('capexTotals', () => {
  it('R/Wp on the correct scale: capex ÷ DC Wp; VAT separate', () => {
    const t = capexTotals([line({ qty: 500_000, unit: 'Wp', rateZar: 9 }), line({ id: 'b', category: 'battery', qty: 200, unit: 'kWh', rateZar: 5000, qualifies12b: false })], 500)
    expect(t.exclVatZar).toBe(5_500_000)
    expect(t.vatZar).toBeCloseTo(5_500_000 * VAT_RATE, 6)
    expect(t.inclVatZar).toBeCloseTo(5_500_000 * (1 + VAT_RATE), 6)
    expect(t.zarPerWp).toBeCloseTo(11, 9)
    expect(t.batteryZar).toBe(1_000_000)
    expect(t.qualifying12bZar).toBe(4_500_000)
  })
  it('no DC size → no R/Wp', () => {
    expect(capexTotals([], 0).zarPerWp).toBeNull()
  })
})

describe('applyRateCard', () => {
  const card = { ...settings, rc_pv_r_per_wp_small: 12, rc_pv_r_per_wp_medium: 10, rc_pv_r_per_wp_large: 8.5, rc_inverter_r_per_kw: 1500, rc_battery_r_per_kwh: 6000, rc_bos_pct: 8, rc_fees_pct: 5, rc_pm_pct: 3, rc_contingency_pct: 5, rc_margin_pct: 10 }

  it('names the missing rate instead of inventing a price (engine spec §7)', () => {
    const r = applyRateCard(defaultFinanceConfig(settings), settings, { dcKwp: 500, acKw: 400, batteryKwh: 0 })
    expect(r).toEqual({ ok: false, missing: ['PV system, 100 kWp to 1 MWp (R/Wp)'] })
  })

  it('picks the size band, prices percentages on the equipment subtotal, keeps manual lines', () => {
    const base = { ...defaultFinanceConfig(settings), capex: [line({ id: 'm1', category: 'civils', qty: 1, unit: 'lot', rateZar: 50_000 })] }
    const r = applyRateCard(base, card, { dcKwp: 500, acKw: 400, batteryKwh: 100 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const byId = Object.fromEntries(r.fin.capex.map((l) => [l.id, l]))
    expect(byId.m1.rateZar).toBe(50_000)
    expect(byId['rc-pv']).toMatchObject({ category: 'modules', qty: 500_000, unit: 'Wp', rateZar: 10, source: 'rate_card' })
    expect(byId['rc-inv']).toMatchObject({ qty: 400, unit: 'kW', rateZar: 1500 })
    expect(byId['rc-bat']).toMatchObject({ qty: 100, unit: 'kWh', rateZar: 6000, qualifies12b: false })
    const equipment = 5_000_000 + 600_000 + 600_000
    expect(byId['rc-bos'].rateZar).toBeCloseTo(equipment * 0.08, 2)
    const sub = equipment * 1.08
    expect(byId['rc-fees'].rateZar).toBeCloseTo(sub * 0.05, 2)
    expect(byId['rc-margin'].rateZar).toBeCloseTo(sub * 0.10, 2)
  })

  it('re-applying replaces the previous rate-card lines, never duplicates them', () => {
    const once = applyRateCard(defaultFinanceConfig(settings), card, { dcKwp: 50, acKw: 40, batteryKwh: 0 })
    if (!once.ok) throw new Error('expected ok')
    const twice = applyRateCard(once.fin, card, { dcKwp: 50, acKw: 40, batteryKwh: 0 })
    if (!twice.ok) throw new Error('expected ok')
    expect(twice.fin.capex.filter((l) => l.id === 'rc-pv')).toHaveLength(1)
    expect(twice.fin.capex.find((l) => l.id === 'rc-pv')!.rateZar).toBe(12)
  })
})
```

- [ ] **Step 2: Add the rate-card org settings.** In `packages/shared/src/solar/org-settings.ts`:

Change line 10 to:
```ts
export type SolarSettingSection = 'rate_card' | 'finance' | 'opex' | 'losses'
```
Replace `SOLAR_SETTING_SECTIONS` with:
```ts
export const SOLAR_SETTING_SECTIONS: ReadonlyArray<{ key: SolarSettingSection; title: string }> = [
  { key: 'rate_card', title: 'Rate card' },
  { key: 'finance', title: 'Finance defaults' },
  { key: 'opex', title: 'Opex defaults' },
  { key: 'losses', title: 'Loss defaults' },
]
```
Insert at the top of `SOLAR_SETTING_FIELDS` (every default NULL — engine spec §7: no invented prices):
```ts
  { key: 'rc_pv_r_per_wp_small', section: 'rate_card', label: 'PV system, up to 100 kWp', unit: 'R/Wp', kind: 'number', min: 0, max: 100, defaultValue: null },
  { key: 'rc_pv_r_per_wp_medium', section: 'rate_card', label: 'PV system, 100 kWp to 1 MWp', unit: 'R/Wp', kind: 'number', min: 0, max: 100, defaultValue: null },
  { key: 'rc_pv_r_per_wp_large', section: 'rate_card', label: 'PV system, above 1 MWp', unit: 'R/Wp', kind: 'number', min: 0, max: 100, defaultValue: null },
  { key: 'rc_inverter_r_per_kw', section: 'rate_card', label: 'Inverter', unit: 'R/kW', kind: 'number', min: 0, max: 100_000, defaultValue: null },
  { key: 'rc_battery_r_per_kwh', section: 'rate_card', label: 'Battery', unit: 'R/kWh', kind: 'number', min: 0, max: 100_000, defaultValue: null },
  { key: 'rc_bos_pct', section: 'rate_card', label: 'Balance of system (of equipment)', unit: '%', kind: 'number', min: 0, max: 100, defaultValue: null },
  { key: 'rc_fees_pct', section: 'rate_card', label: 'Design & professional fees', unit: '%', kind: 'number', min: 0, max: 50, defaultValue: null },
  { key: 'rc_pm_pct', section: 'rate_card', label: 'Project management', unit: '%', kind: 'number', min: 0, max: 50, defaultValue: null },
  { key: 'rc_contingency_pct', section: 'rate_card', label: 'Contingency', unit: '%', kind: 'number', min: 0, max: 50, defaultValue: null },
  { key: 'rc_margin_pct', section: 'rate_card', label: 'Margin', unit: '%', kind: 'number', min: 0, max: 100, defaultValue: null },
```

Append to `packages/shared/src/solar/org-settings.test.ts` (inside the file, new `describe`):
```ts
describe('rate card section (Phase 4b)', () => {
  it('exists, comes first, and invents no prices', () => {
    expect(SOLAR_SETTING_SECTIONS[0]).toEqual({ key: 'rate_card', title: 'Rate card' })
    const rc = SOLAR_SETTING_FIELDS.filter((f) => f.section === 'rate_card')
    expect(rc).toHaveLength(10)
    expect(rc.every((f) => f.defaultValue === null)).toBe(true)
  })
})
```
(add `SOLAR_SETTING_SECTIONS` to that file's import from `./org-settings` if it is not already imported).

- [ ] **Step 3: Run both tests — expect FAIL** (finance-config missing).

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b && pnpm --filter @esite/shared test -- src/solar/cases/finance-config.test.ts src/solar/org-settings.test.ts 2>&1 | tail -8
```

- [ ] **Step 4: Implement** `packages/shared/src/solar/cases/finance-config.ts`:

```ts
/**
 * Financials inputs per case (functional spec §8) — stored in solar.case_financials.config, a MONEY
 * table (solar_can_see_money). ZAR excl. VAT throughout; VAT is shown, never compounded (D-16).
 */
import { z } from 'zod'
import type { SolarOrgSettingValues } from '../org-settings'

export const VAT_RATE = 0.15

export const CAPEX_CATEGORIES = [
  'modules', 'inverters', 'mounting', 'dc_bos', 'ac_bos', 'battery', 'grid_connection', 'civils',
  'labour', 'design_fees', 'project_management', 'contingency', 'margin',
] as const
export type CapexCategory = (typeof CAPEX_CATEGORIES)[number]
export const CAPEX_CATEGORY_LABELS: Record<CapexCategory, string> = {
  modules: 'Modules', inverters: 'Inverters', mounting: 'Mounting', dc_bos: 'DC BOS', ac_bos: 'AC BOS',
  battery: 'Battery', grid_connection: 'Grid connection / protection', civils: 'Civils', labour: 'Labour',
  design_fees: 'Design & professional fees', project_management: 'Project management',
  contingency: 'Contingency', margin: 'Margin',
}
export const CAPEX_UNITS = ['Wp', 'kWp', 'kW', 'kWh', 'item', 'lot', 'm'] as const

const num = (min: number, max: number) => z.number().finite().min(min).max(max)
const int = (min: number, max: number) => z.number().int().min(min).max(max)

export const CapexLineSchema = z.object({
  id: z.string().min(1).max(40),
  category: z.enum(CAPEX_CATEGORIES),
  description: z.string().max(200),
  qty: num(0, 1e9),
  unit: z.enum(CAPEX_UNITS),
  rateZar: num(0, 1e10),
  qualifies12b: z.boolean(),
  source: z.enum(['manual', 'rate_card', 'layout_bom']),
}).strict()
export type CapexLine = z.infer<typeof CapexLineSchema>

export const CaseFinanceConfigSchema = z.object({
  version: z.literal(1),
  capex: z.array(CapexLineSchema).max(200),
  opex: z.object({
    omMode: z.enum(['per_kwp', 'pct_capex']),
    omZarPerKwpYear: num(0, 1e6),
    omPctOfCapex: num(0, 20),
    insurancePctOfCapex: num(0, 10),
    monitoringZarPerYear: num(0, 1e8),
    inverterReplacementYear: int(1, 40).nullable(),
    inverterReplacementPct: num(0, 200),
    batteryReplacementYear: int(1, 40).nullable(),
    batteryReplacementPct: num(0, 200),
  }).strict(),
  models: z.object({
    cash: z.object({ enabled: z.boolean() }).strict(),
    debt: z.object({ enabled: z.boolean(), loanPct: num(0, 100), ratePct: num(0, 50), termYears: int(1, 30), graceMonths: int(0, 60) }).strict(),
    ppa: z.object({
      enabled: z.boolean(), startTariffZarPerKwh: num(0, 100), escalationPct: num(-10, 50), termYears: int(1, 40),
      buyoutYear: int(1, 40).nullable(), buyoutPriceZar: num(0, 1e10).nullable(),
    }).strict(),
    lease: z.object({ enabled: z.boolean(), monthlyPaymentZar: num(0, 1e9), escalationPct: num(-10, 50), termYears: int(1, 40), residualZar: num(0, 1e10) }).strict(),
  }).strict(),
  analysis: z.object({
    years: int(1, 40), discountRatePct: num(0, 50), cpiPct: num(0, 30),
    escalationStartPct: num(0, 50), escalationYear10Pct: num(0, 50), escalationAfterCpiPlusPct: num(-5, 20),
    loadGrowthPct: num(-20, 20), taxEnabled: z.boolean(), companyTaxRatePct: num(0, 60), section12b: z.boolean(),
  }).strict(),
  loadShedding: z.object({ valueZarPerKwh: num(0, 1000).nullable() }).strict(),
}).strict().superRefine((f, ctx) => {
  const m = f.models
  if (!m.cash.enabled && !m.debt.enabled && !m.ppa.enabled && !m.lease.enabled) {
    ctx.addIssue({ code: 'custom', path: ['models'], message: 'Choose at least one finance model' })
  }
  if ((m.ppa.buyoutYear === null) !== (m.ppa.buyoutPriceZar === null)) {
    ctx.addIssue({ code: 'custom', path: ['models', 'ppa', 'buyoutPriceZar'], message: 'Enter both the buy-out year and price, or neither' })
  }
})
export type CaseFinanceConfig = z.infer<typeof CaseFinanceConfigSchema>

export function parseFinanceConfig(raw: unknown): { ok: true; fin: CaseFinanceConfig } | { ok: false; errors: Record<string, string> } {
  const r = CaseFinanceConfigSchema.safeParse(raw)
  if (r.success) return { ok: true, fin: r.data }
  const errors: Record<string, string> = {}
  for (const i of r.error.issues) {
    const k = i.path.join('.') || '(root)'
    if (!errors[k]) errors[k] = i.message
  }
  return { ok: false, errors }
}

function setting(s: SolarOrgSettingValues, key: string, fallback: number): number {
  const v = s[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

export function defaultFinanceConfig(s: SolarOrgSettingValues): CaseFinanceConfig {
  const cpi = setting(s, 'cpi_pct', 5)
  return {
    version: 1,
    capex: [],
    opex: {
      omMode: 'per_kwp',
      omZarPerKwpYear: setting(s, 'om_r_per_kwp_yr', 150),
      omPctOfCapex: 0,
      insurancePctOfCapex: setting(s, 'insurance_pct_of_capex', 0.5),
      monitoringZarPerYear: setting(s, 'monitoring_r_per_yr', 0),
      inverterReplacementYear: setting(s, 'inverter_replacement_year', 12),
      inverterReplacementPct: setting(s, 'inverter_replacement_pct', 60),
      batteryReplacementYear: setting(s, 'battery_replacement_year', 10),
      batteryReplacementPct: setting(s, 'battery_replacement_pct', 50),
    },
    models: {
      cash: { enabled: true },
      debt: { enabled: false, loanPct: 0, ratePct: 0, termYears: 10, graceMonths: 0 },
      ppa: { enabled: false, startTariffZarPerKwh: 0, escalationPct: cpi, termYears: 20, buyoutYear: null, buyoutPriceZar: null },
      lease: { enabled: false, monthlyPaymentZar: 0, escalationPct: cpi, termYears: 10, residualZar: 0 },
    },
    analysis: {
      years: setting(s, 'analysis_years', 25),
      discountRatePct: setting(s, 'discount_rate_pct', 11),
      cpiPct: cpi,
      escalationStartPct: setting(s, 'escalation_start_pct', 9),
      escalationYear10Pct: setting(s, 'escalation_year10_pct', 7),
      escalationAfterCpiPlusPct: setting(s, 'escalation_after_cpi_plus_pct', 1),
      loadGrowthPct: 0,
      taxEnabled: false,
      companyTaxRatePct: setting(s, 'tax_rate_pct', 27),
      section12b: s.section_12b_default === true,
    },
    loadShedding: { valueZarPerKwh: null },
  }
}

export interface CapexTotals {
  exclVatZar: number
  vatZar: number
  inclVatZar: number
  /** capex ÷ DC Wp — the correct scale (WM showed R/kWp as R/Wp). */
  zarPerWp: number | null
  inverterZar: number
  batteryZar: number
  qualifying12bZar: number
  byCategory: Partial<Record<CapexCategory, number>>
}

export const lineAmount = (l: CapexLine): number => l.qty * l.rateZar

export function capexTotals(lines: readonly CapexLine[], dcKwp: number): CapexTotals {
  let excl = 0, inv = 0, bat = 0, q12b = 0
  const byCategory: Partial<Record<CapexCategory, number>> = {}
  for (const l of lines) {
    const a = lineAmount(l)
    excl += a
    byCategory[l.category] = (byCategory[l.category] ?? 0) + a
    if (l.category === 'inverters') inv += a
    if (l.category === 'battery') bat += a
    if (l.qualifies12b) q12b += a
  }
  return {
    exclVatZar: excl, vatZar: excl * VAT_RATE, inclVatZar: excl * (1 + VAT_RATE),
    zarPerWp: dcKwp > 0 ? excl / (dcKwp * 1000) : null,
    inverterZar: inv, batteryZar: bat, qualifying12bZar: q12b, byCategory,
  }
}

const BANDS = [
  { key: 'rc_pv_r_per_wp_small', maxKwp: 100, label: 'PV system, up to 100 kWp (R/Wp)' },
  { key: 'rc_pv_r_per_wp_medium', maxKwp: 1000, label: 'PV system, 100 kWp to 1 MWp (R/Wp)' },
  { key: 'rc_pv_r_per_wp_large', maxKwp: Number.POSITIVE_INFINITY, label: 'PV system, above 1 MWp (R/Wp)' },
] as const

const cents = (x: number) => Math.round(x * 100) / 100
const rate = (s: SolarOrgSettingValues, k: string): number | null => {
  const v = s[k]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * "Apply org rate card" (spec §8): replaces the lines it made last time (source 'rate_card') and
 * keeps every other line. A missing required rate is NAMED, never substituted.
 */
export function applyRateCard(
  fin: CaseFinanceConfig,
  s: SolarOrgSettingValues,
  size: { dcKwp: number; acKw: number; batteryKwh: number },
): { ok: true; fin: CaseFinanceConfig } | { ok: false; missing: string[] } {
  const band = BANDS.find((b) => size.dcKwp <= b.maxKwp)!
  const missing: string[] = []
  const pv = rate(s, band.key)
  if (pv === null) missing.push(band.label)
  const bat = rate(s, 'rc_battery_r_per_kwh')
  if (size.batteryKwh > 0 && bat === null) missing.push('Battery (R/kWh)')
  if (missing.length > 0) return { ok: false, missing }

  const mk = (id: string, category: CapexCategory, description: string, qty: number, unit: CapexLine['unit'], rateZar: number, qualifies12b = true): CapexLine =>
    ({ id, category, description, qty, unit, rateZar: cents(rateZar), qualifies12b, source: 'rate_card' })
  const lines: CapexLine[] = [mk('rc-pv', 'modules', 'PV system (rate card)', size.dcKwp * 1000, 'Wp', pv!)]
  const inv = rate(s, 'rc_inverter_r_per_kw')
  if (inv !== null) lines.push(mk('rc-inv', 'inverters', 'Inverters (rate card)', size.acKw, 'kW', inv))
  if (size.batteryKwh > 0) lines.push(mk('rc-bat', 'battery', 'Battery (rate card)', size.batteryKwh, 'kWh', bat!, false))
  const equipment = lines.reduce((a, l) => a + l.qty * l.rateZar, 0)
  const bos = rate(s, 'rc_bos_pct')
  if (bos !== null) lines.push(mk('rc-bos', 'dc_bos', `Balance of system (${bos} % of equipment)`, 1, 'lot', equipment * bos / 100))
  const sub = equipment + (bos !== null ? cents(equipment * bos / 100) : 0)
  const pct: Array<[string, CapexCategory, string, string]> = [
    ['rc-fees', 'design_fees', 'rc_fees_pct', 'Design & professional fees'],
    ['rc-pm', 'project_management', 'rc_pm_pct', 'Project management'],
    ['rc-cont', 'contingency', 'rc_contingency_pct', 'Contingency'],
    ['rc-margin', 'margin', 'rc_margin_pct', 'Margin'],
  ]
  for (const [id, cat, key, label] of pct) {
    const p = rate(s, key)
    if (p !== null) lines.push(mk(id, cat, `${label} (${p} % of subtotal)`, 1, 'lot', sub * p / 100))
  }
  return { ok: true, fin: { ...fin, capex: [...fin.capex.filter((l) => l.source !== 'rate_card'), ...lines] } }
}
```

Note the test's `sub` for fees is `equipment * 1.08`; `sub` here is `equipment + cents(equipment*0.08)` — equal to 2 d.p., which `toBeCloseTo(…, 2)` accepts.

- [ ] **Step 5: Append to the barrel** `packages/shared/src/solar/cases/index.ts`:
```ts
export * from './finance-config'
```

- [ ] **Step 6: Run — expect PASS; run the whole shared suite (settings form tests may count fields).**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b && pnpm --filter @esite/shared test -- src/solar 2>&1 | tail -5
pnpm --filter web test -- 'src/app/(admin)/settings/solar' 2>&1 | tail -5
```
Expected: PASS. If `SolarSettingsForm.test.tsx` asserts the first section title is "Finance defaults", change that assertion to "Rate card" (the form renders sections generically from `SOLAR_SETTING_SECTIONS`).

- [ ] **Step 7: Commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b
git add packages/shared/src/solar 'apps/web/src/app/(admin)/settings/solar'
git commit -m "feat(solar): finance config, capex totals, org rate card (no invented prices)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Equipment specs + CSV import parser

**Files:**
- Create: `packages/shared/src/solar/cases/equipment.ts`
- Test: `packages/shared/src/solar/cases/equipment.test.ts`

- [ ] **Step 1: Failing test** `equipment.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseEquipmentCsv, EQUIPMENT_CSV_HEADER, moduleSnapshot, inverterSnapshot, batterySnapshot, parseEquipmentSpecs } from './equipment'

const H = EQUIPMENT_CSV_HEADER.join(',')
const row = (vals: Record<string, string>) => EQUIPMENT_CSV_HEADER.map((h) => vals[h] ?? '').join(',')

describe('parseEquipmentCsv', () => {
  it('reads one of each kind, keeping only the columns of that kind', () => {
    const text = [H,
      row({ kind: 'module', make: 'Acme', model: 'M-550', pmaxW: '550', gammaPmaxPctPerC: '-0.35', vocV: '49.6' }),
      row({ kind: 'inverter', make: 'Acme', model: 'I-100', acKw: '100', euroEfficiencyPct: '98.2' }),
      row({ kind: 'battery', make: 'Acme', model: 'B-200', usableKwh: '200', powerKw: '100', rtePct: '91' }),
    ].join('\n')
    const r = parseEquipmentCsv(text)
    expect(r.errors).toEqual([])
    expect(r.rows).toEqual([
      { kind: 'module', make: 'Acme', model: 'M-550', specs: { pmaxW: 550, gammaPmaxPctPerC: -0.35, vocV: 49.6 } },
      { kind: 'inverter', make: 'Acme', model: 'I-100', specs: { acKw: 100, euroEfficiencyPct: 98.2 } },
      { kind: 'battery', make: 'Acme', model: 'B-200', specs: { usableKwh: 200, powerKw: 100, rtePct: 91 } },
    ])
  })

  it('reports per line: unknown kind, a column of another kind, a missing required value, a non-number', () => {
    const text = [H,
      row({ kind: 'turbine', make: 'A', model: 'B' }),
      row({ kind: 'module', make: 'A', model: 'B', pmaxW: '550', gammaPmaxPctPerC: '-0.3', acKw: '5' }),
      row({ kind: 'inverter', make: 'A', model: 'C', acKw: '10' }),
      row({ kind: 'battery', make: 'A', model: 'D', usableKwh: 'ten', powerKw: '5', rtePct: '90' }),
    ].join('\n')
    const r = parseEquipmentCsv(text)
    expect(r.rows).toEqual([])
    expect(r.errors).toEqual([
      { line: 2, message: 'kind must be module, inverter or battery' },
      { line: 3, message: 'column acKw does not apply to a module' },
      { line: 4, message: 'euroEfficiencyPct is required for an inverter' },
      { line: 5, message: 'usableKwh must be a number' },
    ])
  })

  it('refuses a file whose header is not the template', () => {
    expect(parseEquipmentCsv('make,model\nA,B').errors).toEqual([{ line: 1, message: `The header must be exactly: ${H}` }])
  })

  it('handles quoted fields with commas', () => {
    const text = [H, row({ kind: 'module', make: '"Acme, Inc."', model: 'M', pmaxW: '400', gammaPmaxPctPerC: '-0.4' })].join('\n')
    expect(parseEquipmentCsv(text).rows[0]!.make).toBe('Acme, Inc.')
  })
})

describe('snapshots', () => {
  const id = '11111111-1111-4111-8111-111111111111'
  it('copies exactly the fields a case needs', () => {
    expect(moduleSnapshot({ id, make: 'A', model: 'M', specs: { pmaxW: 550, gammaPmaxPctPerC: -0.35, vocV: 49 } }))
      .toEqual({ equipmentId: id, make: 'A', model: 'M', pmaxW: 550, gammaPmaxPctPerC: -0.35 })
    expect(inverterSnapshot({ id, make: 'A', model: 'I', specs: { acKw: 100, euroEfficiencyPct: 98 } }))
      .toEqual({ equipmentId: id, make: 'A', model: 'I', acKw: 100, euroEfficiencyPct: 98 })
    expect(batterySnapshot({ id, make: 'A', model: 'B', specs: { usableKwh: 10, powerKw: 5, rtePct: 90 } }))
      .toEqual({ equipmentId: id, make: 'A', model: 'B', usableKwh: 10, powerKw: 5, rtePct: 90 })
  })
  it('parseEquipmentSpecs validates by kind', () => {
    expect(parseEquipmentSpecs('module', { pmaxW: -1, gammaPmaxPctPerC: -0.3 }).ok).toBe(false)
    expect(parseEquipmentSpecs('battery', { usableKwh: 1, powerKw: 1, rtePct: 90 }).ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run — FAIL.** `pnpm --filter @esite/shared test -- src/solar/cases/equipment.test.ts`

- [ ] **Step 3: Implement** `equipment.ts`:

```ts
/**
 * Equipment catalogue specs (functional spec §11) and the CSV import. PAN/OND import is deferred (D-19).
 * The DB CHECK (00215 equipment_specs_shape) guards the minimum; these schemas are the full contract.
 */
import { z } from 'zod'

export const EQUIPMENT_KINDS = ['module', 'inverter', 'battery'] as const
export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number]

const num = (min: number, max: number) => z.number().finite().min(min).max(max)

export const ModuleSpecsSchema = z.object({
  pmaxW: num(1, 2000), gammaPmaxPctPerC: num(-1, 0),
  vocV: num(0, 200).optional(), iscA: num(0, 50).optional(), vmpV: num(0, 200).optional(), impA: num(0, 50).optional(),
  betaVocPctPerC: num(-1, 0).optional(), gammaVmpPctPerC: num(-1, 0).optional(),
  lengthMm: num(100, 5000).optional(), widthMm: num(100, 5000).optional(), bifacial: z.boolean().optional(),
}).strict()
export const InverterSpecsSchema = z.object({
  acKw: num(0.1, 100_000), euroEfficiencyPct: num(50, 100),
  mppts: z.number().int().min(1).max(100).optional(), vDcMax: num(0, 2000).optional(),
  vMpptMin: num(0, 2000).optional(), vMpptMax: num(0, 2000).optional(), iMpptMaxA: num(0, 500).optional(),
}).strict()
export const BatterySpecsSchema = z.object({
  usableKwh: num(0.1, 1e6), powerKw: num(0.1, 1e6), rtePct: num(50, 100),
  warrantyCycles: z.number().int().min(0).max(100_000).optional(),
}).strict()

const SCHEMAS = { module: ModuleSpecsSchema, inverter: InverterSpecsSchema, battery: BatterySpecsSchema } as const
const REQUIRED: Record<EquipmentKind, readonly string[]> = {
  module: ['pmaxW', 'gammaPmaxPctPerC'], inverter: ['acKw', 'euroEfficiencyPct'], battery: ['usableKwh', 'powerKw', 'rtePct'],
}
const COLUMNS: Record<EquipmentKind, readonly string[]> = {
  module: ['pmaxW', 'vocV', 'iscA', 'vmpV', 'impA', 'gammaPmaxPctPerC', 'betaVocPctPerC', 'gammaVmpPctPerC', 'lengthMm', 'widthMm', 'bifacial'],
  inverter: ['acKw', 'euroEfficiencyPct', 'mppts', 'vDcMax', 'vMpptMin', 'vMpptMax', 'iMpptMaxA'],
  battery: ['usableKwh', 'powerKw', 'rtePct', 'warrantyCycles'],
}
export const EQUIPMENT_CSV_HEADER: readonly string[] = ['kind', 'make', 'model', ...COLUMNS.module, ...COLUMNS.inverter, ...COLUMNS.battery]

export type EquipmentSpecs = Record<string, number | boolean>

export function parseEquipmentSpecs(kind: EquipmentKind, specs: unknown): { ok: true; specs: EquipmentSpecs } | { ok: false; errors: Record<string, string> } {
  const r = SCHEMAS[kind].safeParse(specs)
  if (r.success) return { ok: true, specs: r.data as EquipmentSpecs }
  const errors: Record<string, string> = {}
  for (const i of r.error.issues) errors[i.path.join('.') || '(root)'] ??= i.message
  return { ok: false, errors }
}

/** RFC 4180-ish: commas, double-quoted fields, "" escapes. One physical line per record. */
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = '', q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') q = false
      else cur += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

export interface EquipmentCsvRow { kind: EquipmentKind; make: string; model: string; specs: EquipmentSpecs }
export interface EquipmentCsvResult { rows: EquipmentCsvRow[]; errors: Array<{ line: number; message: string }> }

export function parseEquipmentCsv(text: string): EquipmentCsvResult {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '')
  const header = splitCsvLine(lines[0] ?? '')
  if (header.join(',') !== EQUIPMENT_CSV_HEADER.join(',')) {
    return { rows: [], errors: [{ line: 1, message: `The header must be exactly: ${EQUIPMENT_CSV_HEADER.join(',')}` }] }
  }
  const rows: EquipmentCsvRow[] = []
  const errors: EquipmentCsvResult['errors'] = []
  lines.slice(1).forEach((raw, i) => {
    const line = i + 2
    const cells = splitCsvLine(raw)
    const get = (col: string) => cells[EQUIPMENT_CSV_HEADER.indexOf(col)] ?? ''
    const kind = get('kind') as EquipmentKind
    if (!EQUIPMENT_KINDS.includes(kind)) { errors.push({ line, message: 'kind must be module, inverter or battery' }); return }
    const make = get('make'), model = get('model')
    if (!make || !model) { errors.push({ line, message: 'make and model are required' }); return }
    const foreign = EQUIPMENT_CSV_HEADER.slice(3).find((c) => !COLUMNS[kind].includes(c) && get(c) !== '')
    if (foreign) { errors.push({ line, message: `column ${foreign} does not apply to a ${kind}` }); return }
    const missing = REQUIRED[kind].find((c) => get(c) === '')
    if (missing) { errors.push({ line, message: `${missing} is required for a${kind === 'inverter' ? 'n' : ''} ${kind}` }); return }
    const specs: EquipmentSpecs = {}
    for (const c of COLUMNS[kind]) {
      const v = get(c)
      if (v === '') continue
      if (c === 'bifacial') { specs[c] = /^(true|yes|1)$/i.test(v); continue }
      const n = Number(v.replace(',', '.'))
      if (!Number.isFinite(n)) { errors.push({ line, message: `${c} must be a number` }); return }
      specs[c] = n
    }
    const check = parseEquipmentSpecs(kind, specs)
    if (!check.ok) { const [k, m] = Object.entries(check.errors)[0]!; errors.push({ line, message: `${k}: ${m}` }); return }
    rows.push({ kind, make, model, specs: check.specs })
  })
  return { rows, errors }
}

type Row = { id: string; make: string; model: string; specs: Record<string, unknown> }
const n = (v: unknown) => Number(v)

export const moduleSnapshot = (r: Row) =>
  ({ equipmentId: r.id, make: r.make, model: r.model, pmaxW: n(r.specs.pmaxW), gammaPmaxPctPerC: n(r.specs.gammaPmaxPctPerC) })
export const inverterSnapshot = (r: Row) =>
  ({ equipmentId: r.id, make: r.make, model: r.model, acKw: n(r.specs.acKw), euroEfficiencyPct: n(r.specs.euroEfficiencyPct) })
export const batterySnapshot = (r: Row) =>
  ({ equipmentId: r.id, make: r.make, model: r.model, usableKwh: n(r.specs.usableKwh), powerKw: n(r.specs.powerKw), rtePct: n(r.specs.rtePct) })
```

Note on the test's line-4 message: `REQUIRED.inverter` is checked in order, so the first missing is `euroEfficiencyPct` (acKw is present) → "euroEfficiencyPct is required for an inverter". Matches.

- [ ] **Step 4: Barrel line** `export * from './equipment'`; run — PASS; commit.

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b && pnpm --filter @esite/shared test -- src/solar/cases/equipment.test.ts 2>&1 | tail -3
git add packages/shared/src/solar/cases && git commit -m "feat(solar): equipment spec schemas and CSV import parser

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: TOU periods from a tariff calendar

**Files:**
- Create: `packages/shared/src/solar/cases/tou-periods.ts`
- Test: `packages/shared/src/solar/cases/tou-periods.test.ts`

- [ ] **Step 1: Failing test:**

```ts
import { describe, it, expect } from 'vitest'
import type { TouCalendar } from '../../tariffs/tou'
import { engineTouPeriods, monthlyTouSplit } from './tou-periods'

const cal: TouCalendar = {
  highSeasonMonths: [6, 7, 8], holidayTreatedAs: 'sunday', source: 'published',
  windows: [
    { season: 'low', dayType: 'weekday', startMinute: 7 * 60, endMinute: 10 * 60, period: 'peak' },
    { season: 'low', dayType: 'weekday', startMinute: 10 * 60, endMinute: 18 * 60, period: 'standard' },
    { season: 'high', dayType: 'weekday', startMinute: 6 * 60, endMinute: 9 * 60, period: 'peak' },
  ],
}

describe('engineTouPeriods', () => {
  const p = engineTouPeriods(cal, undefined, 2025)
  it('is 8760 long and uses the engine spelling off-peak', () => {
    expect(p).toHaveLength(8760)
    expect(new Set(p)).toEqual(new Set(['off-peak', 'peak', 'standard']))
  })
  it('2 Jan 2025 (Thursday) 08:00 is low-season peak; 4 Jan (Saturday) 08:00 is off-peak', () => {
    expect(p[24 + 8]).toBe('peak')
    expect(p[3 * 24 + 8]).toBe('off-peak')
  })
  it('a holiday treated as Sunday is off-peak', () => {
    const h = engineTouPeriods(cal, new Set(['2025-01-02']), 2025)
    expect(h[24 + 8]).toBe('off-peak')
  })
  it('high season uses its own windows (1 July 2025 is a Tuesday)', () => {
    const jul1 = (31 + 28 + 31 + 30 + 31 + 30) * 24
    expect(p[jul1 + 7]).toBe('peak')
    expect(p[jul1 + 9]).toBe('off-peak')
  })
})

describe('monthlyTouSplit', () => {
  it('splits each month by period and conserves energy', () => {
    const p = engineTouPeriods(cal, undefined, 2025)
    const s = monthlyTouSplit(new Float64Array(8760).fill(1), p)
    expect(s).toHaveLength(12)
    expect(s[0]!.peak + s[0]!.standard + s[0]!.offPeak).toBe(31 * 24)
    expect(s[0]!.peak).toBe(23 * 3) // 23 weekdays in January 2025, 3 peak hours each
  })
})
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement:**

```ts
/**
 * Tariff TOU calendar → the engine's 8760 TouPeriod series (battery TOU arbitrage) and a monthly
 * TOU split (Yield monthly table). The tariff core spells 'off_peak'; the engine spells 'off-peak'.
 * Hour h is classified by its START minute (h × 60), matching the interval-ending convention where
 * hour h covers [h:00, h+1:00).
 */
import { dayTypeOf, seasonForMonth, touPeriodAt, type TouCalendar } from '../../tariffs/tou'
import type { TouPeriod } from '../../services/solar/energy/energy-balance'
import { DAYS_IN_MONTH, monthHourRanges } from '../../services/solar/time'

export function engineTouPeriods(cal: TouCalendar, holidays: ReadonlySet<string> | undefined, year: number): TouPeriod[] {
  const out: TouPeriod[] = []
  for (let m = 1; m <= 12; m++) {
    const season = seasonForMonth(m, cal)
    for (let d = 1; d <= DAYS_IN_MONTH[m - 1]!; d++) {
      const dayType = dayTypeOf(year, m, d, holidays, cal)
      for (let h = 0; h < 24; h++) {
        const p = touPeriodAt(cal, season, dayType, h * 60)
        out.push(p === 'off_peak' ? 'off-peak' : p)
      }
    }
  }
  return out
}

export interface TouSplit { peak: number; standard: number; offPeak: number }

export function monthlyTouSplit(series: ArrayLike<number>, periods: readonly TouPeriod[]): TouSplit[] {
  return monthHourRanges().map(({ start, end }) => {
    const s: TouSplit = { peak: 0, standard: 0, offPeak: 0 }
    for (let h = start; h < end; h++) {
      const v = series[h]!
      const p = periods[h]
      if (p === 'peak') s.peak += v
      else if (p === 'standard') s.standard += v
      else s.offPeak += v
    }
    return s
  })
}
```

- [ ] **Step 4: Barrel** `export * from './tou-periods'`; run — PASS; commit ("feat(solar): tariff calendar to engine TOU periods").

---

### Task 9: CaseInput builder (named reasons, never substitutes)

**Files:**
- Create: `packages/shared/src/solar/cases/build-input.ts`
- Test: `packages/shared/src/solar/cases/build-input.test.ts`

- [ ] **Step 1: Failing test:**

```ts
import { describe, it, expect } from 'vitest'
import { solarOrgSettingDefaults } from '../org-settings'
import { defaultCaseConfig, type CaseConfig } from './config'
import { buildCaseInput, BUILD_REASONS, type BuildContext } from './build-input'
import { inputsHash } from '../../services/solar/hash'

const W = '22222222-2222-4222-8222-222222222222'
const module = { equipmentId: '11111111-1111-4111-8111-111111111111', make: 'Generic', model: 'M', pmaxW: 550, gammaPmaxPctPerC: -0.35 }
const base = (): CaseConfig => {
  const c = defaultCaseConfig(solarOrgSettingDefaults(), { dcKwp: 500, acKw: 400 })
  return { ...c, pv: { ...c.pv, module }, weather: { source: 'pvgis_tmy', datasetId: W } }
}
const ctx = (over: Partial<BuildContext> = {}): BuildContext => ({
  config: base(),
  study: { exportMode: 'net_billing', exportLimitKw: 100 },
  siteLoad: { series: new Array(8760).fill(250), basis: 'S1', referenceYear: 2025 },
  touPeriods: null,
  ...over,
})

describe('buildCaseInput', () => {
  it('maps percentages to fractions and the manual system to one array + one inverter', () => {
    const r = buildCaseInput(ctx())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const i = r.input
    expect(i.weatherDatasetId).toBe(W)
    expect(i.pv.arrays).toHaveLength(1)
    expect(i.pv.arrays[0]).toMatchObject({ kWpDc: 500, tiltDeg: 15, azimuthDeg: 0, inverterId: 'inv-1',
      module: { iamB0: 0.05 }, cellTemp: { kind: 'faiman', u0: 25, u1: 6.84 } })
    expect(i.pv.arrays[0]!.module.gammaPmaxPerC).toBeCloseTo(-0.0035, 12)
    expect(i.pv.arrays[0]!.losses).toEqual({ soiling: 0.02, shading: 0.03, mismatch: 0.01, dcWiring: 0.015, lid: 0.015, nameplate: 0 })
    expect(i.pv.inverters).toEqual([{ id: 'inv-1', acRatedKw: 400, efficiencyCurve: [{ loadFraction: 0, efficiency: 0.975 }] }])
    expect(i.pv.acLosses).toEqual({ acWiring: 0.01, availability: 0.99 })
    expect(i.load).toHaveLength(8760)
    expect(i.loadAdjustment).toBe(0)
    expect(i.battery).toBeNull()
    expect(i.export).toEqual({ allowed: true, limitKw: 100 })
    expect('touPeriods' in i).toBe(false)
  })

  it('zero-export study → export not allowed; case override wins', () => {
    const z = buildCaseInput(ctx({ study: { exportMode: 'zero_export', exportLimitKw: null } }))
    expect(z.ok && z.input.export).toEqual({ allowed: false, limitKw: null })
    const c = base()
    const o = buildCaseInput(ctx({ config: { ...c, grid: { ...c.grid, overrideExport: true, exportAllowed: true, exportLimitKw: 50 } }, study: { exportMode: 'zero_export', exportLimitKw: null } }))
    expect(o.ok && o.input.export).toEqual({ allowed: true, limitKw: 50 })
  })

  it('inverter AC cap limits the rated AC', () => {
    const c = base()
    const r = buildCaseInput(ctx({ config: { ...c, grid: { ...c.grid, inverterAcCapKw: 350 } } }))
    expect(r.ok && r.input.pv.inverters[0]!.acRatedKw).toBe(350)
  })

  it('lists every blocking reason at once, never substituting a value', () => {
    const c = base()
    const r = buildCaseInput({
      config: { ...c, pv: { ...c.pv, module: null }, weather: { source: 'pvgis_tmy', datasetId: null },
        battery: { ...c.battery, enabled: true, strategy: 'tou-arbitrage', usableKwh: 0 } },
      study: { exportMode: null, exportLimitKw: null }, siteLoad: null, touPeriods: null,
    })
    expect(r).toEqual({ ok: false, reasons: [BUILD_REASONS.noWeather, BUILD_REASONS.noLoad, BUILD_REASONS.noModule, BUILD_REASONS.noExportMode, BUILD_REASONS.batteryEmpty, BUILD_REASONS.noTou] })
  })

  it('a site load with a NaN or the wrong length is refused', () => {
    const bad = new Array(8760).fill(1); bad[5] = Number.NaN
    expect(buildCaseInput(ctx({ siteLoad: { series: bad, basis: 'S1', referenceYear: 2025 } }))).toEqual({ ok: false, reasons: [BUILD_REASONS.badLoad] })
    expect(buildCaseInput(ctx({ siteLoad: { series: [1, 2], basis: 'S1', referenceYear: 2025 } }))).toEqual({ ok: false, reasons: [BUILD_REASONS.badLoad] })
  })

  it('battery: fractions, strategy, TOU series only when needed', () => {
    const c = base()
    const tou = new Array(8760).fill('off-peak')
    const r = buildCaseInput(ctx({
      touPeriods: tou,
      config: { ...c, battery: { ...c.battery, enabled: true, usableKwh: 200, maxChargeKw: 100, maxDischargeKw: 100, strategy: 'tou-arbitrage', gridCharging: true, backupReservePct: 20 } },
    }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.input.battery).toEqual({ usableKwh: 200, maxChargeKw: 100, maxDischargeKw: 100, roundTripEfficiency: 0.9, socMin: 0.1, socMax: 0.95, initialSoc: 0.5, backupReserve: 0.2, strategy: { kind: 'tou-arbitrage', gridCharging: true } })
    expect(r.input.touPeriods).toHaveLength(8760)
  })

  it('the hash is stable for equal inputs and moves when any input moves', () => {
    const a = buildCaseInput(ctx()), b = buildCaseInput(ctx())
    const c = base()
    const moved = buildCaseInput(ctx({ config: { ...c, losses: { ...c.losses, soilingPct: 2.5 } } }))
    if (!a.ok || !b.ok || !moved.ok) throw new Error('expected ok')
    expect(inputsHash(a.input)).toBe(inputsHash(b.input))
    expect(inputsHash(moved.input)).not.toBe(inputsHash(a.input))
  })
})
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement** `build-input.ts`:

```ts
/**
 * Stored case + study + site load + weather → the engine's CaseInput (engine spec §1). Every missing
 * input is a NAMED reason (engine spec §7: never substitute a number). The resulting object is what
 * gets hashed (inputs_hash) and stored as the run's inputs snapshot.
 */
import type { CaseInput } from '../../services/solar/case'
import type { BatterySpec, TouPeriod } from '../../services/solar/energy/energy-balance'
import { SOLAR_ENGINE_DEFAULTS } from '../../services/solar/defaults'
import { HOURS_PER_YEAR } from '../../services/solar/time'
import { effectiveLosses, type CaseConfig } from './config'

export type StudyExportMode = 'net_billing' | 'no_credit' | 'zero_export'

export interface BuildContext {
  config: CaseConfig
  study: { exportMode: StudyExportMode | null; exportLimitKw: number | null }
  siteLoad: { series: readonly number[]; basis: string; referenceYear: number } | null
  /** The case's weather dataset id is read from config.weather.datasetId. */
  touPeriods: readonly TouPeriod[] | null
}

export type BuildResult = { ok: true; input: CaseInput } | { ok: false; reasons: string[] }

export const BUILD_REASONS = {
  noWeather: 'Fetch the PVGIS weather for this site first (Weather section).',
  noLoad: 'Build the site load on the Load tab first.',
  badLoad: 'The stored site load is not a complete 8,760-hour year — rebuild it on the Load tab.',
  noModule: 'Choose a module type — it sets the temperature coefficient.',
  noExportMode: 'Set the export mode on Site & Supply, or override it for this case (Grid / export).',
  batteryEmpty: 'Enter the battery’s usable capacity and charge/discharge power, or switch the battery off.',
  noTou: 'This battery strategy needs the tariff’s TOU calendar — pin a tariff on the Tariff tab, or choose Self-consumption or Peak shaving.',
} as const

const f = (pct: number) => pct / 100

export function buildCaseInput(ctx: BuildContext): BuildResult {
  const { config: c, study, siteLoad, touPeriods } = ctx
  const reasons: string[] = []
  const weatherId = c.weather.datasetId
  if (!weatherId) reasons.push(BUILD_REASONS.noWeather)
  if (!siteLoad) reasons.push(BUILD_REASONS.noLoad)
  else if (siteLoad.series.length !== HOURS_PER_YEAR || siteLoad.series.some((v) => !Number.isFinite(v))) reasons.push(BUILD_REASONS.badLoad)
  if (!c.pv.module) reasons.push(BUILD_REASONS.noModule)
  if (!c.grid.overrideExport && study.exportMode === null) reasons.push(BUILD_REASONS.noExportMode)
  const b = c.battery
  const needsTou = b.enabled && (b.strategy === 'tou-arbitrage' || b.gridCharging)
  if (b.enabled && !(b.usableKwh > 0 && b.maxChargeKw > 0 && b.maxDischargeKw > 0)) reasons.push(BUILD_REASONS.batteryEmpty)
  if (needsTou && !touPeriods) reasons.push(BUILD_REASONS.noTou)
  if (reasons.length > 0) return { ok: false, reasons }

  const l = effectiveLosses(c)
  const acRated = c.grid.inverterAcCapKw !== null ? Math.min(c.pv.acKw, c.grid.inverterAcCapKw) : c.pv.acKw
  const euro = c.pv.inverter ? f(c.pv.inverter.euroEfficiencyPct) : SOLAR_ENGINE_DEFAULTS.inverterEuroEfficiency
  const exportSettings = c.grid.overrideExport
    ? { allowed: c.grid.exportAllowed, limitKw: c.grid.exportAllowed ? c.grid.exportLimitKw : null }
    : study.exportMode === 'zero_export'
      ? { allowed: false, limitKw: null }
      : { allowed: true, limitKw: study.exportLimitKw }

  const battery: BatterySpec | null = b.enabled
    ? {
        usableKwh: b.usableKwh, maxChargeKw: b.maxChargeKw, maxDischargeKw: b.maxDischargeKw,
        roundTripEfficiency: f(b.rtePct), socMin: f(b.socMinPct), socMax: f(b.socMaxPct),
        initialSoc: f(b.initialSocPct), backupReserve: f(b.backupReservePct),
        strategy: b.strategy === 'self-consumption' ? { kind: 'self-consumption' }
          : b.strategy === 'tou-arbitrage' ? { kind: 'tou-arbitrage', gridCharging: b.gridCharging }
            : { kind: 'peak-shaving', targetKw: b.peakTargetKw!, gridCharging: false },
      }
    : null

  const input: CaseInput = {
    weatherDatasetId: weatherId!,
    pv: {
      arrays: [{
        id: 'manual', kWpDc: c.pv.dcKwp, tiltDeg: c.pv.tiltDeg, azimuthDeg: c.pv.azimuthDeg,
        module: { gammaPmaxPerC: f(c.pv.module!.gammaPmaxPctPerC), iamB0: l.iamB0 },
        cellTemp: l.cellTemp.kind === 'faiman' ? { kind: 'faiman', u0: l.cellTemp.u0, u1: l.cellTemp.u1 } : { kind: 'noct', noctC: l.cellTemp.noctC },
        losses: { soiling: f(l.soilingPct), shading: f(l.shadingPct), mismatch: f(l.mismatchPct), dcWiring: f(l.dcWiringPct), lid: f(l.lidPct), nameplate: f(l.nameplatePct) },
        inverterId: 'inv-1',
      }],
      inverters: [{ id: 'inv-1', acRatedKw: acRated, efficiencyCurve: [{ loadFraction: 0, efficiency: euro }] }],
      acLosses: { acWiring: f(l.acWiringPct), availability: f(l.availabilityPct) },
      albedo: l.albedo,
      transposition: l.transposition,
    },
    load: Array.from(siteLoad!.series),
    loadAdjustment: f(c.load.adjustmentPct),
    battery,
    export: exportSettings,
    ...(needsTou ? { touPeriods: [...touPeriods!] } : {}),
  }
  return { ok: true, input }
}
```

- [ ] **Step 4: Barrel** `export * from './build-input'`; run — PASS; commit ("feat(solar): CaseInput builder with named blocking reasons").

---

### Task 10: Run outputs (KPIs, monthly, typical days, daily, loss waterfall, checks, provenance) + hourly CSV

**Files:**
- Create: `packages/shared/src/solar/cases/outputs.ts`
- Create: `packages/shared/src/solar/cases/hourly-csv.ts`
- Test: `packages/shared/src/solar/cases/outputs.test.ts`
- Test: `packages/shared/src/solar/cases/hourly-csv.test.ts`

- [ ] **Step 1: Failing tests.** Both use a REAL engine run on the Johannesburg fixture (verbatim PVGIS TMY, sha-pinned; no network).

`outputs.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { loadWeather } from '../../services/solar/__fixtures__/pvgis'
import { simulateCase, type CaseInput, type CaseResult } from '../../services/solar/case'
import { solarOrgSettingDefaults } from '../org-settings'
import { defaultCaseConfig } from './config'
import { buildCaseInput } from './build-input'
import { buildRunOutputs, type CaseRunOutputs } from './outputs'

let input: CaseInput, result: CaseResult, out: CaseRunOutputs

beforeAll(() => {
  const weather = loadWeather('jhb')
  const c = defaultCaseConfig(solarOrgSettingDefaults(), { dcKwp: 500, acKw: 400 })
  const load = Array.from({ length: 8760 }, (_, h) => 150 + 100 * Math.sin(((h % 24) - 6) / 24 * 2 * Math.PI))
  const r = buildCaseInput({
    config: { ...c, pv: { ...c.pv, module: { equipmentId: '11111111-1111-4111-8111-111111111111', make: 'G', model: 'M', pmaxW: 550, gammaPmaxPctPerC: -0.35 } }, weather: { source: 'pvgis_tmy', datasetId: '22222222-2222-4222-8222-222222222222' } },
    study: { exportMode: 'net_billing', exportLimitKw: 50 },
    siteLoad: { series: load, basis: 'S1', referenceYear: 2025 },
    touPeriods: null,
  })
  if (!r.ok) throw new Error(r.reasons.join('; '))
  input = r.input
  result = simulateCase(input, { id: input.weatherDatasetId, year: weather })
  out = buildRunOutputs(result, input, {
    weatherFetchedAt: '2026-09-28T10:00:00Z', gsaPvoutKwhPerKwp: 1700, tariffRef: null, touPeriods: null,
    nmdKva: 400, loadBasis: 'S1', loadReferenceYear: 2025,
  })
})

describe('buildRunOutputs', () => {
  it('KPIs come straight from the engine result', () => {
    expect(out.kpis.dcKwp).toBe(500)
    expect(out.kpis.acKw).toBe(400)
    expect(out.kpis.specificYieldKwhPerKwp).toBe(result.pv.annual.specificYield)
    expect(out.kpis.pvAcKwh).toBe(result.balance.kpis.pvKwh)
    expect(out.kpis.deliveredKwh).toBeCloseTo(result.balance.kpis.pvKwh - result.balance.kpis.curtailKwh, 6)
    expect(out.kpis.annualAcKwh).toBe(result.pv.annual.acKwh)
    expect(out.kpis.importAfterKwh).toBe(result.balance.kpis.importKwh)
    expect(out.kpis.peakDemandBasis).toBe('hourly')
    expect(out.kpis.peakDemandBeforeKw).toBeGreaterThan(out.kpis.peakDemandAfterKw - 1e-9)
  })

  it('monthly rows sum to the annual totals', () => {
    const sum = (k: 'pvKwh' | 'importKwh' | 'exportKwh' | 'loadKwh') => out.monthly.reduce((a, m) => a + m[k], 0)
    expect(out.monthly).toHaveLength(12)
    expect(sum('pvKwh')).toBeCloseTo(out.kpis.pvAcKwh, 3)
    expect(sum('importKwh')).toBeCloseTo(out.kpis.importAfterKwh, 3)
    expect(sum('loadKwh')).toBeCloseTo(out.kpis.loadKwh, 3)
    expect(out.monthly[0]!.touImportAfter).toBeNull()
  })

  it('the loss waterfall starts at the reference yield and closes on AC output', () => {
    const w = out.waterfall
    expect(w[0]).toMatchObject({ key: 'reference', kind: 'start' })
    expect(w[w.length - 1]).toMatchObject({ key: 'ac_output', kind: 'end' })
    const losses = w.filter((s) => s.kind === 'loss').reduce((a, s) => a + s.kwh, 0)
    expect(w[0]!.kwh - losses).toBeCloseTo(result.pv.annual.acKwh, 3)
    expect(w.find((s) => s.key === 'dc_output')!.kwh).toBeCloseTo(result.pv.annual.dcKwh, 3)
  })

  it('typical days: 12 months × 4 day types × 24 hours; daily: 365 rows', () => {
    expect(out.typicalDays).toHaveLength(48)
    expect(out.typicalDays.every((d) => d.pv.length === 24 && d.load.length === 24)).toBe(true)
    expect(out.daily).toHaveLength(365)
    expect(out.daily.reduce((a, d) => a + d.pvKwh, 0)).toBeCloseTo(out.kpis.pvAcKwh, 0)
  })

  it('checks: DC/AC 1.25 passes, the 50 kW export limit is hit, strings need a layout, NMD loading and GSA are evaluated', () => {
    const byId = Object.fromEntries(out.checks.map((c) => [c.id, c]))
    expect(byId.dc_ac_ratio.status).toBe('pass')
    expect(byId.export_limit.status).toBe('warn')
    expect(byId.string_voltage.status).toBe('n/a')
    expect(byId.transformer_loading.status).toBe('warn') // 400 kW AC > 75 % of 400 kVA
    expect(['pass', 'warn']).toContain(byId.gsa_sanity.status)
  })

  it('provenance names the engine version, hash, weather and load basis', () => {
    expect(out.provenance).toMatchObject({ engineVersion: result.engineVersion, inputsHash: result.inputsHash, weatherDatasetId: input.weatherDatasetId, weatherSource: result.weatherSource, loadBasis: 'S1', loadReferenceYear: 2025, tariffRef: null })
  })

  it('is plain JSON (round-trips without loss)', () => {
    expect(JSON.parse(JSON.stringify(out))).toEqual(out)
  })
})
```


`hourly-csv.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { decodeHourlyCsv, encodeHourlyCsv, HOURLY_CSV_HEADER, sliceHourlyDays, type HourlySeries } from './hourly-csv'

const series = (): HourlySeries => {
  const mk = (k: number) => Float64Array.from({ length: 8760 }, (_, h) => (h % 24) * k)
  return { load: mk(1), pvAc: mk(2), selfUse: mk(0.5), import: mk(0.25), export: mk(0.1), curtail: mk(0), soc: mk(0), importPvOnly: mk(0.3), exportPvOnly: mk(0.2) }
}

describe('hourly CSV', () => {
  it('writes the documented header and the SAST hour start', () => {
    const text = encodeHourlyCsv(series())
    const lines = text.trimEnd().split('\n')
    expect(lines[0]).toBe(HOURLY_CSV_HEADER.join(','))
    expect(lines).toHaveLength(8761)
    expect(lines[1]!.startsWith('0,2025-01-01T00:00+02:00,')).toBe(true)
    expect(lines[8760]!.startsWith('8759,2025-12-31T23:00+02:00,')).toBe(true)
  })
  it('round-trips at 4 decimals', () => {
    const s = series()
    const back = decodeHourlyCsv(encodeHourlyCsv(s))
    expect(back.pvAc[23]).toBeCloseTo(46, 4)
    expect(back.importPvOnly[5]).toBeCloseTo(1.5, 4)
  })
  it('refuses a truncated or re-headed file', () => {
    expect(() => decodeHourlyCsv('a,b\n1,2')).toThrow('hourly CSV header does not match')
    const cut = encodeHourlyCsv(series()).split('\n').slice(0, 100).join('\n')
    expect(() => decodeHourlyCsv(cut)).toThrow('hourly CSV must have 8760 rows')
  })
  it('slices whole days for the zoom chart', () => {
    const rows = sliceHourlyDays(series(), 10, 11)
    expect(rows).toHaveLength(48)
    expect(rows[0]).toMatchObject({ hour: 240, startSast: '2025-01-11T00:00+02:00' })
  })
})
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement** `hourly-csv.ts`:

```ts
/**
 * The stored 8760 hourly file of a run (solar-runs bucket, gzip). It is also the input of Run
 * financials: the pv-only import/export columns let the bill engine split the battery's saving
 * without re-simulating (functional spec §8: "pure computation on stored energy results").
 */
import type { CaseResult } from '../../services/solar/case'
import { GEOMETRY_YEAR, HOURS_PER_YEAR } from '../../services/solar/time'

export const HOURLY_CSV_HEADER = [
  'hour', 'start_sast', 'load_kw', 'pv_ac_kw', 'self_use_kw', 'import_kw', 'export_kw', 'curtail_kw',
  'battery_soc_kwh', 'import_pv_only_kw', 'export_pv_only_kw',
] as const

export interface HourlySeries {
  load: Float64Array; pvAc: Float64Array; selfUse: Float64Array; import: Float64Array; export: Float64Array
  curtail: Float64Array; soc: Float64Array; importPvOnly: Float64Array; exportPvOnly: Float64Array
}
const KEYS: Array<keyof HourlySeries> = ['load', 'pvAc', 'selfUse', 'import', 'export', 'curtail', 'soc', 'importPvOnly', 'exportPvOnly']

export function hourlyFromResult(r: CaseResult): HourlySeries {
  const b = r.balance
  const selfUse = Float64Array.from(b.direct, (v, h) => v + b.dischargeFromPv[h]!)
  return {
    load: b.load, pvAc: b.pv, selfUse, import: b.import, export: b.export, curtail: b.curtail, soc: b.soc,
    importPvOnly: r.balancePvOnly.import, exportPvOnly: r.balancePvOnly.export,
  }
}

export function sastStart(h: number): string {
  const d = new Date(Date.UTC(GEOMETRY_YEAR, 0, 1, 0) + h * 3_600_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:00+02:00`
}
const fmt = (v: number) => (Math.abs(v) < 5e-5 ? 0 : v).toFixed(4)

export function encodeHourlyCsv(s: HourlySeries): string {
  const out: string[] = [HOURLY_CSV_HEADER.join(',')]
  for (let h = 0; h < HOURS_PER_YEAR; h++) out.push([String(h), sastStart(h), ...KEYS.map((k) => fmt(s[k][h]!))].join(','))
  return out.join('\n') + '\n'
}

export function decodeHourlyCsv(text: string): HourlySeries {
  const lines = text.trimEnd().split('\n')
  if (lines[0] !== HOURLY_CSV_HEADER.join(',')) throw new Error('hourly CSV header does not match')
  if (lines.length !== HOURS_PER_YEAR + 1) throw new Error('hourly CSV must have 8760 rows')
  const s = Object.fromEntries(KEYS.map((k) => [k, new Float64Array(HOURS_PER_YEAR)])) as unknown as HourlySeries
  for (let h = 0; h < HOURS_PER_YEAR; h++) {
    const cells = lines[h + 1]!.split(',')
    KEYS.forEach((k, i) => {
      const v = Number(cells[i + 2])
      if (!Number.isFinite(v)) throw new Error(`hourly CSV row ${h} column ${k} is not a number`)
      s[k][h] = v
    })
  }
  return s
}

export interface HourlySliceRow { hour: number; startSast: string; loadKw: number; pvAcKw: number; importKw: number; exportKw: number; socKwh: number }

/** Whole days [fromDay, toDay] (0-based, inclusive) for the zoomed annual chart. */
export function sliceHourlyDays(s: HourlySeries, fromDay: number, toDay: number): HourlySliceRow[] {
  const rows: HourlySliceRow[] = []
  for (let h = fromDay * 24; h < (toDay + 1) * 24 && h < HOURS_PER_YEAR; h++) {
    rows.push({ hour: h, startSast: sastStart(h), loadKw: s.load[h]!, pvAcKw: s.pvAc[h]!, importKw: s.import[h]!, exportKw: s.export[h]!, socKwh: s.soc[h]! })
  }
  return rows
}
```

- [ ] **Step 4: Implement** `outputs.ts`:

```ts
/**
 * CaseResult → the stored outputs document of a run (functional spec §7.3). Every KPI anywhere in the
 * module comes from this document; the browser only formats it.
 */
import type { CaseInput, CaseResult } from '../../services/solar/case'
import type { TouPeriod } from '../../services/solar/energy/energy-balance'
import { acFactor, combinedDcLoss } from '../../services/solar/pv/losses'
import { GEOMETRY_YEAR, HOURS_PER_YEAR, monthHourRanges } from '../../services/solar/time'
import { monthlyTouSplit, type TouSplit } from './tou-periods'

export const RUN_OUTPUTS_VERSION = 1 as const
export const DAY_TYPES = ['all', 'weekday', 'saturday', 'sunday'] as const
export type DayType = (typeof DAY_TYPES)[number]

export interface TariffRef { tariffId: string; tariffName: string; financialYear: string; licenseeName: string }

export interface RunKpis {
  dcKwp: number; acKw: number
  specificYieldKwhPerKwp: number; performanceRatio: number
  annualAcKwh: number; pvAcKwh: number; deliveredKwh: number; selfConsumedKwh: number
  exportKwh: number; curtailedKwh: number; loadKwh: number; importBeforeKwh: number; importAfterKwh: number
  solarFraction: number; selfConsumption: number
  peakDemandBeforeKw: number; peakDemandAfterKw: number; peakDemandBasis: 'hourly'
  batteryKwh: number | null; batteryKw: number | null
}
export interface MonthlyRow {
  month: number; pvKwh: number; loadKwh: number; importBeforeKwh: number; importKwh: number; exportKwh: number
  maxDemandBeforeKw: number; maxDemandAfterKw: number
  touImportBefore: TouSplit | null; touImportAfter: TouSplit | null
}
export interface TypicalDay { month: number; dayType: DayType; pv: number[]; load: number[]; import: number[]; export: number[]; batteryNet: number[] }
export interface DailyRow { day: number; pvKwh: number; loadKwh: number; importKwh: number; exportKwh: number }
export interface WaterfallStep { key: string; label: string; kwh: number; kind: 'start' | 'loss' | 'subtotal' | 'end' }
export interface RunCheck { id: 'dc_ac_ratio' | 'export_limit' | 'string_voltage' | 'transformer_loading' | 'gsa_sanity'; label: string; status: 'pass' | 'warn' | 'fail' | 'n/a'; detail: string }
export interface RunProvenance {
  engineVersion: string; inputsHash: string; weatherDatasetId: string; weatherSource: string
  weatherFetchedAt: string | null; gsaPvoutKwhPerKwp: number | null; tariffRef: TariffRef | null
  loadBasis: string; loadReferenceYear: number
}
export interface CaseRunOutputs {
  version: typeof RUN_OUTPUTS_VERSION
  kpis: RunKpis; monthly: MonthlyRow[]; typicalDays: TypicalDay[]; daily: DailyRow[]
  waterfall: WaterfallStep[]; checks: RunCheck[]; provenance: RunProvenance
}
export interface OutputsMeta {
  weatherFetchedAt: string | null; gsaPvoutKwhPerKwp: number | null; tariffRef: TariffRef | null
  touPeriods: readonly TouPeriod[] | null; nmdKva: number | null; loadBasis: string; loadReferenceYear: number
}

const r3 = (x: number) => Math.round(x * 1000) / 1000
const sum = (a: ArrayLike<number>) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]!; return s }
const max = (a: ArrayLike<number>, from = 0, to = a.length) => { let m = 0; for (let i = from; i < to; i++) m = Math.max(m, a[i]!); return m }
const dayTypeOfIndex = (day: number): Exclude<DayType, 'all'> => {
  const dow = new Date(Date.UTC(GEOMETRY_YEAR, 0, 1 + day)).getUTCDay()
  return dow === 0 ? 'sunday' : dow === 6 ? 'saturday' : 'weekday'
}

function typicalDays(res: CaseResult): TypicalDay[] {
  const b = res.balance
  const net = Float64Array.from(b.discharge, (v, h) => v - b.charge[h]! - b.gridCharge[h]!)
  const ranges = monthHourRanges()
  const out: TypicalDay[] = []
  for (const { month, start, end } of ranges) {
    for (const dt of DAY_TYPES) {
      const acc = { pv: new Array(24).fill(0), load: new Array(24).fill(0), import: new Array(24).fill(0), export: new Array(24).fill(0), batteryNet: new Array(24).fill(0) }
      let days = 0
      for (let h0 = start; h0 < end; h0 += 24) {
        if (dt !== 'all' && dayTypeOfIndex(h0 / 24) !== dt) continue
        days++
        for (let k = 0; k < 24; k++) {
          acc.pv[k] += b.pv[h0 + k]!; acc.load[k] += b.load[h0 + k]!; acc.import[k] += b.import[h0 + k]!
          acc.export[k] += b.export[h0 + k]!; acc.batteryNet[k] += net[h0 + k]!
        }
      }
      const avg = (a: number[]) => a.map((v) => r3(days > 0 ? v / days : 0))
      out.push({ month, dayType: dt, pv: avg(acc.pv), load: avg(acc.load), import: avg(acc.import), export: avg(acc.export), batteryNet: avg(acc.batteryNet) })
    }
  }
  return out
}

export function lossWaterfall(res: CaseResult, input: CaseInput): WaterfallStep[] {
  const a = res.pv.annual
  const arr = input.pv.arrays
  // kWp-weighted DC chain (one array for manual systems; exact per array otherwise).
  const keep = arr.reduce((s, x) => s + x.kWpDc * (1 - combinedDcLoss(x.losses)), 0) / arr.reduce((s, x) => s + x.kWpDc, 0)
  const dcLoss = a.referenceKwh * (1 - keep)
  const irrTemp = a.referenceKwh * keep - a.dcKwh
  const acBeforeAcLosses = a.acKwh / acFactor(input.pv.acLosses)
  const inverter = a.dcKwh - a.clippedKwh - acBeforeAcLosses
  return [
    { key: 'reference', label: 'Nameplate × plane-of-array irradiation', kwh: r3(a.referenceKwh), kind: 'start' },
    { key: 'dc_losses', label: 'Soiling, shading, mismatch, DC wiring, LID, nameplate', kwh: r3(dcLoss), kind: 'loss' },
    { key: 'irradiance_temperature', label: 'Angle of incidence and cell temperature', kwh: r3(irrTemp), kind: 'loss' },
    { key: 'dc_output', label: 'DC output', kwh: r3(a.dcKwh), kind: 'subtotal' },
    { key: 'inverter', label: 'Inverter efficiency', kwh: r3(inverter), kind: 'loss' },
    { key: 'clipping', label: 'Inverter clipping', kwh: r3(a.clippedKwh), kind: 'loss' },
    { key: 'ac_losses', label: 'AC wiring and availability', kwh: r3(acBeforeAcLosses - a.acKwh), kind: 'loss' },
    { key: 'ac_output', label: 'AC output', kwh: r3(a.acKwh), kind: 'end' },
  ]
}

const pct = (x: number) => `${(x * 100).toFixed(0)} %`
const whole = (x: number) => Math.round(x).toString()

export function runChecks(res: CaseResult, input: CaseInput, k: RunKpis, meta: OutputsMeta): RunCheck[] {
  const ratio = k.dcKwp / k.acKw
  const curtailHours = Array.from(res.balance.curtail).filter((v) => v > 1e-9).length
  const exp = input.export
  const exportCheck: RunCheck = !exp.allowed
    ? { id: 'export_limit', label: 'Export limit', status: curtailHours > 0 ? 'warn' : 'pass', detail: `Export not allowed: surplus PV curtailed in ${curtailHours} h a year (${whole(k.curtailedKwh)} kWh).` }
    : exp.limitKw === null
      ? { id: 'export_limit', label: 'Export limit', status: 'n/a', detail: 'No export limit set.' }
      : { id: 'export_limit', label: 'Export limit', status: curtailHours > 0 ? 'warn' : 'pass', detail: `${curtailHours} h a year exceed the ${exp.limitKw} kW export limit (${whole(k.curtailedKwh)} kWh curtailed).` }
  const nmd = meta.nmdKva
  const loading: RunCheck = nmd === null
    ? { id: 'transformer_loading', label: 'Grid connection loading', status: 'n/a', detail: 'No NMD recorded on Site & Supply.' }
    : { id: 'transformer_loading', label: 'Grid connection loading', status: k.acKw > 0.75 * nmd ? 'warn' : 'pass', detail: `PV AC ${whole(k.acKw)} kW is ${pct(k.acKw / nmd)} of the ${whole(nmd)} kVA NMD (warning above 75 %, D-09; transformer rating not recorded).` }
  const gsa = meta.gsaPvoutKwhPerKwp
  const diff = gsa ? (k.specificYieldKwhPerKwp - gsa) / gsa : 0
  const gsaCheck: RunCheck = gsa === null
    ? { id: 'gsa_sanity', label: 'Global Solar Atlas sanity check', status: 'n/a', detail: 'Global Solar Atlas value unavailable for this site.' }
    : { id: 'gsa_sanity', label: 'Global Solar Atlas sanity check', status: Math.abs(diff) <= 0.05 ? 'pass' : 'warn', detail: `Engine ${whole(k.specificYieldKwhPerKwp)} vs GSA ${whole(gsa)} kWh/kWp — ${Math.abs(diff) <= 0.05 ? 'within' : 'outside'} 5 % (GSA assumes the optimum tilt facing north).` }
  return [
    { id: 'dc_ac_ratio', label: 'DC/AC ratio', status: ratio >= 1.0 && ratio <= 1.4 ? 'pass' : 'warn', detail: `DC/AC ratio ${ratio.toFixed(2)} (expected 1.00 to 1.40).` },
    exportCheck,
    { id: 'string_voltage', label: 'String voltage checks', status: 'n/a', detail: 'String checks need a layout — this case uses a manual system size.' },
    loading,
    gsaCheck,
  ]
}

export function buildRunOutputs(res: CaseResult, input: CaseInput, meta: OutputsMeta): CaseRunOutputs {
  const b = res.balance
  if (b.load.length !== HOURS_PER_YEAR) throw new Error('case result is not on the 8760 time base')
  const selfConsumed = sum(b.direct) + sum(b.dischargeFromPv)
  const kpis: RunKpis = {
    dcKwp: res.pv.kWpDc,
    acKw: input.pv.inverters.reduce((s, i) => s + i.acRatedKw, 0),
    specificYieldKwhPerKwp: res.pv.annual.specificYield,
    performanceRatio: res.pv.annual.performanceRatio,
    annualAcKwh: res.pv.annual.acKwh,
    pvAcKwh: b.kpis.pvKwh,
    deliveredKwh: b.kpis.pvKwh - b.kpis.curtailKwh,
    selfConsumedKwh: selfConsumed,
    exportKwh: b.kpis.exportKwh,
    curtailedKwh: b.kpis.curtailKwh,
    loadKwh: b.kpis.loadKwh,
    importBeforeKwh: b.kpis.loadKwh,
    importAfterKwh: b.kpis.importKwh,
    solarFraction: b.kpis.solarFraction,
    selfConsumption: b.kpis.selfConsumption,
    peakDemandBeforeKw: max(b.load),
    peakDemandAfterKw: max(b.import),
    peakDemandBasis: 'hourly',
    batteryKwh: input.battery ? input.battery.usableKwh : null,
    batteryKw: input.battery ? input.battery.maxDischargeKw : null,
  }
  const touBefore = meta.touPeriods ? monthlyTouSplit(b.load, meta.touPeriods) : null
  const touAfter = meta.touPeriods ? monthlyTouSplit(b.import, meta.touPeriods) : null
  const monthly: MonthlyRow[] = monthHourRanges().map(({ month, start, end }, i) => {
    const part = (a: Float64Array) => { let s = 0; for (let h = start; h < end; h++) s += a[h]!; return s }
    return {
      month, pvKwh: part(b.pv), loadKwh: part(b.load), importBeforeKwh: part(b.load), importKwh: part(b.import), exportKwh: part(b.export),
      maxDemandBeforeKw: max(b.load, start, end), maxDemandAfterKw: max(b.import, start, end),
      touImportBefore: touBefore ? touBefore[i]! : null, touImportAfter: touAfter ? touAfter[i]! : null,
    }
  })
  const daily: DailyRow[] = Array.from({ length: 365 }, (_, d) => {
    const s = (a: Float64Array) => { let t = 0; for (let h = d * 24; h < d * 24 + 24; h++) t += a[h]!; return r3(t) }
    return { day: d, pvKwh: s(b.pv), loadKwh: s(b.load), importKwh: s(b.import), exportKwh: s(b.export) }
  })
  return {
    version: RUN_OUTPUTS_VERSION,
    kpis,
    monthly,
    typicalDays: typicalDays(res),
    daily,
    waterfall: lossWaterfall(res, input),
    checks: runChecks(res, input, kpis, meta),
    provenance: {
      engineVersion: res.engineVersion, inputsHash: res.inputsHash, weatherDatasetId: res.weatherDatasetId,
      weatherSource: res.weatherSource, weatherFetchedAt: meta.weatherFetchedAt, gsaPvoutKwhPerKwp: meta.gsaPvoutKwhPerKwp,
      tariffRef: meta.tariffRef, loadBasis: meta.loadBasis, loadReferenceYear: meta.loadReferenceYear,
    },
  }
}

/** Monthly table as CSV (the "Download CSV" under the monthly table). Values from the stored outputs. */
export function monthlyCsv(o: CaseRunOutputs): string {
  const head = ['month', 'pv_kwh', 'load_kwh', 'import_before_kwh', 'import_after_kwh', 'export_kwh', 'max_demand_before_kw', 'max_demand_after_kw',
    'import_before_peak_kwh', 'import_before_standard_kwh', 'import_before_off_peak_kwh', 'import_after_peak_kwh', 'import_after_standard_kwh', 'import_after_off_peak_kwh']
  const f = (v: number | undefined | null) => (v === undefined || v === null ? '' : v.toFixed(3))
  const rows = o.monthly.map((m) => [m.month, f(m.pvKwh), f(m.loadKwh), f(m.importBeforeKwh), f(m.importKwh), f(m.exportKwh), f(m.maxDemandBeforeKw), f(m.maxDemandAfterKw),
    f(m.touImportBefore?.peak), f(m.touImportBefore?.standard), f(m.touImportBefore?.offPeak), f(m.touImportAfter?.peak), f(m.touImportAfter?.standard), f(m.touImportAfter?.offPeak)].join(','))
  return [head.join(','), ...rows].join('\n') + '\n'
}
```

- [ ] **Step 5: Barrel lines** `export * from './outputs'` and `export * from './hourly-csv'`. Run both tests — PASS. Commit ("feat(solar): stored run outputs, loss waterfall, checks and the 8760 CSV").

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b && pnpm --filter @esite/shared test -- src/solar/cases/outputs.test.ts src/solar/cases/hourly-csv.test.ts 2>&1 | tail -4
```

---

### Task 11: Finance input + stored-energy financials (equivalence-tested) + bill adapter

**Files:**
- Create: `packages/shared/src/solar/cases/finance-input.ts`
- Create: `packages/shared/src/solar/cases/stored-financials.ts`
- Create: `packages/shared/src/solar/cases/bill-adapter.ts`
- Test: `finance-input.test.ts`, `stored-financials.test.ts`, `bill-adapter.test.ts` (same directory)

- [ ] **Step 1: Failing tests.**

`finance-input.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { solarOrgSettingDefaults } from '../org-settings'
import { defaultCaseConfig } from './config'
import { defaultFinanceConfig, type CaseFinanceConfig } from './finance-config'
import { buildFinanceInput, FINANCE_REASONS } from './finance-input'

const s = solarOrgSettingDefaults()
const cfg = defaultCaseConfig(s, { dcKwp: 500, acKw: 400 })
const withCapex = (): CaseFinanceConfig => ({ ...defaultFinanceConfig(s), capex: [
  { id: 'a', category: 'modules', description: 'PV', qty: 500_000, unit: 'Wp', rateZar: 10, qualifies12b: true, source: 'manual' },
  { id: 'b', category: 'inverters', description: 'Inv', qty: 400, unit: 'kW', rateZar: 1500, qualifies12b: true, source: 'manual' },
] })

describe('buildFinanceInput', () => {
  it('converts percentages, sums capex, and defaults to cash only with tax off (D-16) and insurance 0.5 %/yr (D-05)', () => {
    const r = buildFinanceInput(withCapex(), cfg, { dcKwp: 500, acKw: 400 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const f = r.input
    expect(f.capex).toEqual({ totalZar: 5_600_000, inverterZar: 600_000, batteryZar: 0, section12bQualifyingZar: 5_600_000 })
    expect(f.opex).toEqual({ omZarPerKwpYear: 150, insuranceFractionOfCapex: 0.005, monitoringZarPerYear: 0 })
    expect(f.models).toEqual([{ kind: 'cash' }])
    expect(f.tax).toEqual({ enabled: false, companyRate: 0.27, allowance: 'none', systemAcKw: 400 })
    expect(f.analysis).toMatchObject({ years: 25, discountRate: 0.11, cpi: 0.05, loadGrowth: 0 })
    expect(f.analysis.escalation).toEqual({ published: [], startRate: 0.09, endRate: 0.07, linearToYear: 10, cpiMargin: 0.01 })
    expect(f.replacements).toEqual({ inverterYear: 12, inverterFractionOfCapex: 0.6, batteryYear: null, batteryFractionOfCapex: 0.5 })
    expect(f.degradation).toMatchObject({ firstYear: 0.02, annual: 0.005 })
    expect(f.loadShedding).toBeNull()
  })

  it('all four models in order, each with its own inputs (D-15)', () => {
    const fin = withCapex()
    const r = buildFinanceInput({ ...fin, models: {
      cash: { enabled: true },
      debt: { enabled: true, loanPct: 70, ratePct: 11.5, termYears: 7, graceMonths: 6 },
      ppa: { enabled: true, startTariffZarPerKwh: 1.45, escalationPct: 6, termYears: 20, buyoutYear: 10, buyoutPriceZar: 2_000_000 },
      lease: { enabled: true, monthlyPaymentZar: 60_000, escalationPct: 5, termYears: 10, residualZar: 100_000 },
    } }, cfg, { dcKwp: 500, acKw: 400 })
    expect(r.ok && r.input.models).toEqual([
      { kind: 'cash' },
      { kind: 'debt', loanFraction: 0.7, annualRate: 0.115, termYears: 7, graceMonths: 6 },
      { kind: 'ppa', startTariffZarPerKwh: 1.45, escalation: 0.06, termYears: 20, buyout: { year: 10, priceZar: 2_000_000 } },
      { kind: 'lease', monthlyPaymentZar: 60_000, escalation: 0.05, termYears: 10, residualZar: 100_000 },
    ])
  })

  it('O&M as % of capex is converted to R/kWp/yr on the capex total', () => {
    const fin = withCapex()
    const r = buildFinanceInput({ ...fin, opex: { ...fin.opex, omMode: 'pct_capex', omPctOfCapex: 1 } }, cfg, { dcKwp: 500, acKw: 400 })
    expect(r.ok && r.input.opex.omZarPerKwpYear).toBeCloseTo(5_600_000 * 0.01 / 500, 9)
  })

  it('names what is missing', () => {
    const fin = defaultFinanceConfig(s)
    const r = buildFinanceInput({ ...fin, models: { ...fin.models, debt: { ...fin.models.debt, enabled: true }, ppa: { ...fin.models.ppa, enabled: true }, lease: { ...fin.models.lease, enabled: true } } }, cfg, { dcKwp: 500, acKw: 400 })
    expect(r).toEqual({ ok: false, reasons: [FINANCE_REASONS.noCapex, FINANCE_REASONS.debt, FINANCE_REASONS.ppa, FINANCE_REASONS.lease] })
  })

  it('load-shedding value only when the case enables it AND a R/kWh value is set (D-14, separate line)', () => {
    const c2 = { ...cfg, loadShedding: { enabled: true, stage: 4, hoursPerYear: 600, backedLoadKw: 120 } }
    const fin = { ...withCapex(), loadShedding: { valueZarPerKwh: 8 } }
    const r = buildFinanceInput(fin, c2, { dcKwp: 500, acKw: 400 })
    expect(r.ok && r.input.loadShedding).toEqual({ hoursPerYear: 600, backedLoadKw: 120, valueZarPerKwh: 8 })
  })
})
```

`stored-financials.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { loadWeather } from '../../services/solar/__fixtures__/pvgis'
import { stubBillCalculator } from '../../services/solar/__fixtures__/stub-bill-calculator'
import { runFinancials, simulateCase } from '../../services/solar/case'
import { solarOrgSettingDefaults } from '../org-settings'
import { defaultCaseConfig } from './config'
import { buildCaseInput } from './build-input'
import { defaultFinanceConfig } from './finance-config'
import { buildFinanceInput } from './finance-input'
import { decodeHourlyCsv, encodeHourlyCsv, hourlyFromResult } from './hourly-csv'
import { runStoredFinancials } from './stored-financials'

function scenario(battery: boolean) {
  const s = solarOrgSettingDefaults()
  const c0 = defaultCaseConfig(s, { dcKwp: 300, acKw: 250 })
  const c = { ...c0,
    pv: { ...c0.pv, module: { equipmentId: '11111111-1111-4111-8111-111111111111', make: 'G', model: 'M', pmaxW: 550, gammaPmaxPctPerC: -0.35 } },
    weather: { source: 'pvgis_tmy' as const, datasetId: '22222222-2222-4222-8222-222222222222' },
    battery: battery ? { ...c0.battery, enabled: true, usableKwh: 200, maxChargeKw: 100, maxDischargeKw: 100 } : c0.battery,
  }
  const load = Array.from({ length: 8760 }, (_, h) => 120 + 80 * Math.sin(((h % 24) - 6) / 24 * 2 * Math.PI))
  const b = buildCaseInput({ config: c, study: { exportMode: 'net_billing', exportLimitKw: null }, siteLoad: { series: load, basis: 'S1', referenceYear: 2025 }, touPeriods: null })
  if (!b.ok) throw new Error(b.reasons.join('; '))
  const result = simulateCase(b.input, { id: b.input.weatherDatasetId, year: loadWeather('jhb') })
  const fin = buildFinanceInput({ ...defaultFinanceConfig(s), capex: [{ id: 'a', category: 'modules', description: 'PV', qty: 300_000, unit: 'Wp', rateZar: 11, qualifies12b: true, source: 'manual' }] }, c, { dcKwp: 300, acKw: 250 })
  if (!fin.ok) throw new Error(fin.reasons.join('; '))
  return { result, fin: fin.input }
}

describe('runStoredFinancials', () => {
  for (const battery of [false, true]) {
    it(`equals runFinancials exactly on the in-memory series (battery ${battery})`, () => {
      const { result, fin } = scenario(battery)
      const calc = stubBillCalculator
      const direct = runFinancials(result, fin, calc)
      const stored = runStoredFinancials({ hourly: hourlyFromResult(result), year1PvKwh: result.pv.annual.acKwh, year1DeliveredKwh: result.balance.kpis.pvKwh - result.balance.kpis.curtailKwh }, fin, calc)
      expect(stored).toEqual(direct)
    })
  }

  it('after a CSV round trip (4 d.p.) NPV and IRR agree to 1e-6 relative', () => {
    const { result, fin } = scenario(true)
    const calc = stubBillCalculator
    const direct = runFinancials(result, fin, calc)
    const hourly = decodeHourlyCsv(encodeHourlyCsv(hourlyFromResult(result)))
    const stored = runStoredFinancials({ hourly, year1PvKwh: result.pv.annual.acKwh, year1DeliveredKwh: result.balance.kpis.pvKwh - result.balance.kpis.curtailKwh }, fin, calc)
    const a = direct.finance.models[0]!.views[0]!, b = stored.finance.models[0]!.views[0]!
    expect(Math.abs(b.npvZar - a.npvZar) / Math.abs(a.npvZar)).toBeLessThan(1e-6)
    expect(b.irr! - a.irr!).toBeCloseTo(0, 6)
  })
})
```

`bill-adapter.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import type { HourlyGridFlows, TariffBillCalculator } from '../../tariffs/bill-calculator'
import { toEngineBillCalculator } from './bill-adapter'

describe('toEngineBillCalculator', () => {
  it('passes hourly kWh through and converts sub-hourly kW to kWh per interval', () => {
    const seen: HourlyGridFlows[] = []
    const inner: TariffBillCalculator = { monthlyBills: (f) => { seen.push(f); return Array.from({ length: 12 }, (_, i) => ({ month: i + 1, totalZar: 100, exportCreditUsedZar: 1 })) } }
    const calc = toEngineBillCalculator(inner)
    const imp = new Float64Array(8760).fill(2), exp = new Float64Array(8760)
    const bills = calc.monthlyBills({ importKwh: imp, exportKwh: exp, subHourlyImport: { intervalMin: 30, kw: new Float64Array(17520).fill(60) } })
    expect(bills).toHaveLength(12)
    expect(seen[0]!.importKwh).toBe(imp)
    expect(seen[0]!.subHourlyImport!.intervalMinutes).toBe(30)
    expect(seen[0]!.subHourlyImport!.kwh[0]).toBe(30)
    calc.monthlyBills({ importKwh: imp, exportKwh: exp })
    expect('subHourlyImport' in seen[1]!).toBe(false)
  })
})
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement** `finance-input.ts`:

```ts
/** CaseFinanceConfig + the case + the stored run's size → the engine's FinanceInput (engine spec §6). */
import type { FinanceInput, FinanceModel } from '../../services/solar/finance/cashflow'
import { SOLAR_ENGINE_DEFAULTS } from '../../services/solar/defaults'
import type { CaseConfig } from './config'
import { capexTotals, type CaseFinanceConfig } from './finance-config'

export const FINANCE_REASONS = {
  noCapex: 'Add capex lines (or apply the org rate card) first.',
  debt: 'Debt-financed: enter the loan share and the interest rate.',
  ppa: 'PPA: enter the starting tariff.',
  lease: 'Lease: enter the monthly payment.',
} as const

const f = (pct: number) => pct / 100

export function buildFinanceInput(
  fin: CaseFinanceConfig, c: CaseConfig, size: { dcKwp: number; acKw: number },
): { ok: true; input: FinanceInput } | { ok: false; reasons: string[] } {
  const t = capexTotals(fin.capex, size.dcKwp)
  const m = fin.models
  const reasons: string[] = []
  if (!(t.exclVatZar > 0)) reasons.push(FINANCE_REASONS.noCapex)
  if (m.debt.enabled && !(m.debt.loanPct > 0 && m.debt.ratePct > 0)) reasons.push(FINANCE_REASONS.debt)
  if (m.ppa.enabled && !(m.ppa.startTariffZarPerKwh > 0)) reasons.push(FINANCE_REASONS.ppa)
  if (m.lease.enabled && !(m.lease.monthlyPaymentZar > 0)) reasons.push(FINANCE_REASONS.lease)
  if (reasons.length > 0) return { ok: false, reasons }

  const models: FinanceModel[] = []
  if (m.cash.enabled) models.push({ kind: 'cash' })
  if (m.debt.enabled) models.push({ kind: 'debt', loanFraction: f(m.debt.loanPct), annualRate: f(m.debt.ratePct), termYears: m.debt.termYears, graceMonths: m.debt.graceMonths })
  if (m.ppa.enabled) models.push({ kind: 'ppa', startTariffZarPerKwh: m.ppa.startTariffZarPerKwh, escalation: f(m.ppa.escalationPct), termYears: m.ppa.termYears,
    buyout: m.ppa.buyoutYear !== null && m.ppa.buyoutPriceZar !== null ? { year: m.ppa.buyoutYear, priceZar: m.ppa.buyoutPriceZar } : null })
  if (m.lease.enabled) models.push({ kind: 'lease', monthlyPaymentZar: m.lease.monthlyPaymentZar, escalation: f(m.lease.escalationPct), termYears: m.lease.termYears, residualZar: m.lease.residualZar })

  const o = fin.opex, a = fin.analysis, d = SOLAR_ENGINE_DEFAULTS.degradation
  const input: FinanceInput = {
    kWpDc: size.dcKwp,
    capex: { totalZar: t.exclVatZar, inverterZar: t.inverterZar, batteryZar: t.batteryZar, section12bQualifyingZar: t.qualifying12bZar },
    opex: {
      omZarPerKwpYear: o.omMode === 'per_kwp' ? o.omZarPerKwpYear : (t.exclVatZar * f(o.omPctOfCapex)) / size.dcKwp,
      insuranceFractionOfCapex: f(o.insurancePctOfCapex),
      monitoringZarPerYear: o.monitoringZarPerYear,
    },
    replacements: {
      inverterYear: o.inverterReplacementYear, inverterFractionOfCapex: f(o.inverterReplacementPct),
      batteryYear: c.battery.enabled ? o.batteryReplacementYear : null, batteryFractionOfCapex: f(o.batteryReplacementPct),
    },
    tax: { enabled: a.taxEnabled, companyRate: f(a.companyTaxRatePct), allowance: a.section12b ? 'section12b' : 'none', systemAcKw: size.acKw },
    degradation: { firstYear: f(c.degradation.firstYearPct), annual: f(c.degradation.annualPct), batteryFadePerYear: d.batteryFadePerYear, batteryEndOfLife: d.batteryEndOfLife },
    analysis: {
      years: a.years, discountRate: f(a.discountRatePct), cpi: f(a.cpiPct), loadGrowth: f(a.loadGrowthPct),
      escalation: { published: [], startRate: f(a.escalationStartPct), endRate: f(a.escalationYear10Pct), linearToYear: 10, cpiMargin: f(a.escalationAfterCpiPlusPct) },
    },
    models,
    loadShedding: c.loadShedding.enabled && fin.loadShedding.valueZarPerKwh !== null
      ? { hoursPerYear: c.loadShedding.hoursPerYear, backedLoadKw: c.loadShedding.backedLoadKw, valueZarPerKwh: fin.loadShedding.valueZarPerKwh }
      : null,
  }
  return { ok: true, input }
}
```

Note `f(0.5)` = 0.005 and `f(11)` = 0.11 are exact in IEEE doubles for the asserted values; if `toEqual` flakes on any conversion, change that assertion to `toBeCloseTo(…, 12)` — do not change the conversion.

`stored-financials.ts`:
```ts
/**
 * Run financials from a STORED run (functional spec §8: pure computation on stored energy results).
 * Mirrors the engine's runFinancials line for line, but takes the stored hourly series instead of a
 * CaseResult; stored-financials.test.ts proves the two are identical on the same series.
 */
import type { FinancialsResult } from '../../services/solar/case'
import type { BillCalculator, GridFlows, Year1Bills } from '../../services/solar/finance/bill-calculator'
import { runFinance, type FinanceInput } from '../../services/solar/finance/cashflow'
import { tornado } from '../../services/solar/finance/sensitivity'
import { ENGINE_VERSION } from '../../services/solar/version'
import { HOURS_PER_YEAR } from '../../services/solar/time'
import type { HourlySeries } from './hourly-csv'

export interface StoredEnergy { hourly: HourlySeries; year1PvKwh: number; year1DeliveredKwh: number }

function annual(calc: BillCalculator, flows: GridFlows): { total: number; credit: number } {
  const bills = calc.monthlyBills(flows)
  if (bills.length !== 12) throw new Error(`BillCalculator must return 12 monthly bills, got ${bills.length}`)
  let total = 0, credit = 0
  for (const b of bills) {
    if (!Number.isFinite(b.totalZar) || !Number.isFinite(b.exportCreditUsedZar) || b.exportCreditUsedZar < 0) {
      throw new Error(`BillCalculator returned an invalid bill for month ${b.month}`)
    }
    total += b.totalZar
    credit += b.exportCreditUsedZar
  }
  return { total, credit }
}

export function runStoredFinancials(e: StoredEnergy, fin: FinanceInput, calc: BillCalculator): FinancialsResult {
  const h = e.hourly
  if (h.load.length !== HOURS_PER_YEAR) throw new Error('stored hourly series is not on the 8760 time base')
  const zero = new Float64Array(HOURS_PER_YEAR)
  const before = annual(calc, { importKwh: h.load, exportKwh: zero, subHourlyImport: undefined })
  const after = annual(calc, { importKwh: h.import, exportKwh: h.export, subHourlyImport: undefined })
  const afterPv = annual(calc, { importKwh: h.importPvOnly, exportKwh: h.exportPvOnly, subHourlyImport: undefined })
  const year1Bills: Year1Bills = { beforeZar: before.total, afterZar: after.total, afterPvOnlyZar: afterPv.total, exportCreditUsedZar: after.credit }
  const energy = { year1PvKwh: e.year1PvKwh, year1DeliveredKwh: e.year1DeliveredKwh, bills: year1Bills }
  const finance = runFinance(fin, energy)
  const firstView = finance.models[0]!.views[0]!.view
  return { engineVersion: ENGINE_VERSION, year1Bills, finance, tornado: tornado(fin, energy, 0, firstView) }
}
```
If the engine's `annual()` accumulates `credit` differently (read `packages/shared/src/services/solar/finance/bill-calculator.ts:46-60`), mirror it exactly — the equivalence test is the judge.

`bill-adapter.ts`:
```ts
/**
 * Tariff bill calculator (Phase 2a, `@esite/shared` tariffs) → the engine's BillCalculator seam (4a).
 * The only shape difference: the engine's sub-hourly series is average kW per interval, the tariff
 * core's is kWh per interval.
 * If Task 0 Step 4 found an integration-branch adapter with this contract, replace this file's body
 * with `export { <thatName> as toEngineBillCalculator } from '<its module>'` and keep this test.
 */
import type { BillCalculator, GridFlows, MonthlyBillSummary } from '../../services/solar/finance/bill-calculator'
import type { TariffBillCalculator } from '../../tariffs/bill-calculator'

export function toEngineBillCalculator(calc: TariffBillCalculator): BillCalculator {
  return {
    monthlyBills(flows: GridFlows): MonthlyBillSummary[] {
      const sub = flows.subHourlyImport
      return calc.monthlyBills({
        importKwh: flows.importKwh,
        exportKwh: flows.exportKwh,
        ...(sub ? { subHourlyImport: { intervalMinutes: sub.intervalMin, kwh: Float64Array.from(sub.kw, (v) => (v * sub.intervalMin) / 60) } } : {}),
      })
    },
  }
}
```

- [ ] **Step 4: Barrel lines** `export * from './finance-input'`, `export * from './stored-financials'`, `export * from './bill-adapter'`. Run the three tests — PASS. Commit ("feat(solar): finance input, stored-energy financials (equivalent to runFinancials), tariff bill adapter").

---

### Task 12: Case status (Not run / Running / Done / Failed / Stale)

**Files:**
- Create: `packages/shared/src/solar/cases/status.ts`
- Test: `packages/shared/src/solar/cases/status.test.ts`

- [ ] **Step 1: Failing test:**

```ts
import { describe, it, expect } from 'vitest'
import { caseStatus, RUN_TIMEOUT_MS } from './status'

const now = Date.parse('2026-09-28T10:00:00Z')
const at = (msAgo: number) => new Date(now - msAgo).toISOString()
const H = 'a'.repeat(64), H2 = 'b'.repeat(64)

describe('caseStatus', () => {
  it('not run', () => expect(caseStatus(null, null, H, now)).toEqual({ status: 'not_run', label: 'Not run' }))
  it('running, then timed out after 90 s', () => {
    expect(caseStatus({ status: 'running', inputsHash: H, startedAt: at(10_000) }, null, H, now).status).toBe('running')
    expect(caseStatus({ status: 'running', inputsHash: H, startedAt: at(RUN_TIMEOUT_MS + 1) }, null, H, now)).toEqual({ status: 'failed', label: 'Failed (timed out)' })
  })
  it('done when the last success matches the current inputs; stale when not; stale when inputs cannot be built', () => {
    const ok = { status: 'succeeded' as const, inputsHash: H, startedAt: at(1000) }
    expect(caseStatus(ok, { inputsHash: H }, H, now).status).toBe('done')
    expect(caseStatus(ok, { inputsHash: H }, H2, now)).toEqual({ status: 'stale', label: 'Stale' })
    expect(caseStatus(ok, { inputsHash: H }, null, now)).toEqual({ status: 'stale', label: 'Stale (inputs incomplete)' })
  })
  it('a failed latest run is Failed even with an older success', () => {
    expect(caseStatus({ status: 'failed', inputsHash: H, startedAt: at(1000) }, { inputsHash: H }, H, now).status).toBe('failed')
  })
  it('a cancelled latest run falls back to the last success', () => {
    expect(caseStatus({ status: 'cancelled', inputsHash: H2, startedAt: at(1000) }, { inputsHash: H }, H, now).status).toBe('done')
    expect(caseStatus({ status: 'cancelled', inputsHash: H2, startedAt: at(1000) }, null, H, now)).toEqual({ status: 'not_run', label: 'Cancelled' })
  })
})
```

- [ ] **Step 2: Run — FAIL.** **Step 3: Implement:**

```ts
/** Case card status (functional spec §7.1) and the Stale rule (engine spec §1.3). */
export type CaseStatus = 'not_run' | 'running' | 'done' | 'failed' | 'stale'
export const RUN_TIMEOUT_MS = 90_000

export interface LatestRunLite { status: 'running' | 'succeeded' | 'failed' | 'cancelled'; inputsHash: string; startedAt: string }

export function caseStatus(
  latest: LatestRunLite | null,
  lastSucceeded: { inputsHash: string } | null,
  currentHash: string | null,
  now: number,
): { status: CaseStatus; label: string } {
  if (!latest) return { status: 'not_run', label: 'Not run' }
  if (latest.status === 'running') {
    return now - Date.parse(latest.startedAt) > RUN_TIMEOUT_MS
      ? { status: 'failed', label: 'Failed (timed out)' }
      : { status: 'running', label: 'Running' }
  }
  if (latest.status === 'failed') return { status: 'failed', label: 'Failed' }
  if (!lastSucceeded) return { status: 'not_run', label: latest.status === 'cancelled' ? 'Cancelled' : 'Not run' }
  if (currentHash === null) return { status: 'stale', label: 'Stale (inputs incomplete)' }
  return currentHash === lastSucceeded.inputsHash ? { status: 'done', label: 'Done' } : { status: 'stale', label: 'Stale' }
}
```

- [ ] **Step 4: Barrel** `export * from './status'`; PASS; commit ("feat(solar): case status and the Stale rule").

---

### Task 13: Readiness rules for Yield, Financials and manual Layout; tabs built

**Files:**
- Modify: `packages/shared/src/solar/readiness.ts`
- Test: `packages/shared/src/solar/readiness.test.ts` (append; update any assertion that expects `yield`/`financials` unbuilt)

- [ ] **Step 1: Append failing tests** to `readiness.test.ts`:

```ts
import { yieldReadiness, financialsReadiness } from './readiness'

describe('Yield & Scenarios readiness (§2.3)', () => {
  it.each([
    [{ caseCount: 0, selectedCaseId: null, selectedStatus: null }, 'grey', 'No cases yet'],
    [{ caseCount: 2, selectedCaseId: null, selectedStatus: null }, 'amber', 'Cases exist but none is selected'],
    [{ caseCount: 2, selectedCaseId: 'c', selectedStatus: 'failed' }, 'red', 'The selected case’s last run failed'],
    [{ caseCount: 2, selectedCaseId: 'c', selectedStatus: 'stale' }, 'amber', 'The selected case is stale — re-run it'],
    [{ caseCount: 2, selectedCaseId: 'c', selectedStatus: 'done' }, 'green', 'The selected case’s run is current'],
  ] as const)('%j → %s', (input, status, reason) => {
    expect(yieldReadiness(input)).toEqual({ status, reason })
  })
})

describe('Financials readiness (§2.3)', () => {
  it('grey without financials; amber on untouched org defaults; green with capex and a model', () => {
    expect(financialsReadiness(null)).toEqual({ status: 'grey', reason: 'No financials yet' })
    expect(financialsReadiness({ capexZar: 0, hasModel: true, usingOrgDefaults: false }).status).toBe('amber')
    expect(financialsReadiness({ capexZar: 5e6, hasModel: true, usingOrgDefaults: true })).toEqual({ status: 'amber', reason: 'Using org defaults — review the capex' })
    expect(financialsReadiness({ capexZar: 5e6, hasModel: true, usingOrgDefaults: false })).toEqual({ status: 'green', reason: 'Capex and a finance model are set' })
  })
})

describe('computeSolarReadiness with Phase 4b inputs', () => {
  it('yield and financials are live; layout is green for a manual selected case', () => {
    const steps = computeSolarReadiness(null, 'edit_financials', {
      yield: { caseCount: 1, selectedCaseId: 'c', selectedStatus: 'done' },
      financials: { capexZar: 1, hasModel: true, usingOrgDefaults: false },
      layoutManual: true,
    })
    const by = Object.fromEntries(steps.map((s) => [s.slug, s]))
    expect(by.yield).toMatchObject({ live: true, status: 'green' })
    expect(by.financials).toMatchObject({ live: true, status: 'green' })
    expect(by.layout).toMatchObject({ status: 'green', reason: 'The selected case uses a manual system size' })
  })
  it('an Edit user never gets a financials step', () => {
    expect(computeSolarReadiness(null, 'edit').some((s) => s.slug === 'financials')).toBe(false)
  })
})
```
(Merge the `import` into the file's existing import line from `./readiness`; `computeSolarReadiness` is already imported there.)

- [ ] **Step 2: Run — FAIL.** `pnpm --filter @esite/shared test -- src/solar/readiness.test.ts`

- [ ] **Step 3: Implement** in `readiness.ts`:

In `SOLAR_TABS`, set `built: true` on the `yield` and `financials` rows.

Add (after `siteReadiness`):
```ts
export interface YieldReadinessInput {
  caseCount: number
  selectedCaseId: string | null
  selectedStatus: 'not_run' | 'running' | 'done' | 'failed' | 'stale' | null
}
export function yieldReadiness(y: YieldReadinessInput): { status: ReadinessStatus; reason: string } {
  if (y.caseCount === 0) return { status: 'grey', reason: 'No cases yet' }
  if (!y.selectedCaseId) return { status: 'amber', reason: 'Cases exist but none is selected' }
  switch (y.selectedStatus) {
    case 'failed': return { status: 'red', reason: 'The selected case’s last run failed' }
    case 'stale': return { status: 'amber', reason: 'The selected case is stale — re-run it' }
    case 'running': return { status: 'amber', reason: 'The selected case is running' }
    case 'done': return { status: 'green', reason: 'The selected case’s run is current' }
    default: return { status: 'amber', reason: 'The selected case has not been run' }
  }
}

export interface FinancialsReadinessInput { capexZar: number; hasModel: boolean; usingOrgDefaults: boolean }
export function financialsReadiness(f: FinancialsReadinessInput | null): { status: ReadinessStatus; reason: string } {
  if (!f) return { status: 'grey', reason: 'No financials yet' }
  if (!(f.capexZar > 0) || !f.hasModel) return { status: 'amber', reason: 'Add capex and choose a finance model' }
  if (f.usingOrgDefaults) return { status: 'amber', reason: 'Using org defaults — review the capex' }
  return { status: 'green', reason: 'Capex and a finance model are set' }
}

export interface SolarReadinessExtra {
  yield?: YieldReadinessInput
  financials?: FinancialsReadinessInput | null
  /** The selected case uses a manual system size (§2.3 Layout rule). */
  layoutManual?: boolean
}
```

Replace `computeSolarReadiness` with:
```ts
export function computeSolarReadiness(site: SiteReadinessInput | null, level: SolarAccessLevel, extra: SolarReadinessExtra = {}): ReadinessStep[] {
  return visibleSolarTabs(level)
    .filter((t): t is SolarTab & { slug: Exclude<SolarTabSlug, 'overview'> } => t.slug !== 'overview')
    .map((t) => {
      if (t.slug === 'site') return { slug: t.slug, label: t.label, live: true, ...siteReadiness(site) }
      if (t.slug === 'yield') return { slug: t.slug, label: t.label, live: true, ...yieldReadiness(extra.yield ?? { caseCount: 0, selectedCaseId: null, selectedStatus: null }) }
      if (t.slug === 'financials') return { slug: t.slug, label: t.label, live: true, ...financialsReadiness(extra.financials ?? null) }
      if (t.slug === 'layout' && extra.layoutManual) return { slug: t.slug, label: t.label, live: t.built, status: 'green' as const, reason: 'The selected case uses a manual system size' }
      return { slug: t.slug, label: t.label, live: false, status: 'grey' as const, reason: LATER_PHASE_REASON }
    })
}
```

- [ ] **Step 4: Fix old expectations.** Find assertions that assumed Yield/Financials were unbuilt:

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b
git grep -n -E "yield|financials|built" -- packages/shared/src/solar/readiness.test.ts 'apps/web/src/app/(admin)/projects/[id]/solar/_components/*.test.tsx' 'apps/web/src/app/(admin)/projects/[id]/solar/(gated)/layout.test.tsx'
```
For each hit that expects `yield` or `financials` to be `built: false`, `live: false` or "Coming in a later phase", change it to expect a live, enabled tab. Do not change any other expectation.

- [ ] **Step 5: Run shared + web suites — PASS; commit** ("feat(solar): Yield and Financials readiness rules live").

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b && pnpm --filter @esite/shared test 2>&1 | tail -3 && pnpm --filter web test 2>&1 | tail -3
```
Note: the web tab bar now links `/solar/yield` and `/solar/financials`, which 404 until Tasks 24 and 30. That is acceptable mid-branch; the branch is not merged before Task 37.
