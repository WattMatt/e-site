# Solar Phase 2a-i — Tariff Library Schema, Canonical Types and Bill Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the `tariffs` reference-data schema (platform-admin writes, subscriber reads, publish state machine, immutable published rows) and the pure TypeScript tariff core in `@esite/shared`: canonical types, unit handling, validators, year-on-year diff and a bill engine that reproduces the hand-computed golden bills, including net-billing carry-forward.

**Architecture:** One migration (`00210_tariffs_schema.sql`, number claimed at apply time) creates a new exposed schema `tariffs` with per-verb RLS, FORCE RLS, no anon, two SECURITY DEFINER helpers in `public`, and invoker triggers that run the year state machine and freeze published data. A pure TS module `packages/shared/src/tariffs/` holds the model and the engine; nothing in it does I/O. Plan 2a-ii (`2026-09-28-solar-phase-2a-ii-tariffs-parsers-ingest.md`) builds the parsers and the ingestion script on top of these types.

**Tech Stack:** Postgres (Supabase) with `@verify` blocks and `scripts/db/dry-run-migration.sh` impersonation assertions; TypeScript; Vitest; pnpm/Turborepo.

**Specs:** `docs/solar/03-data-model-and-security.md` §4 (schema), `docs/solar/02-calculation-engine-spec.md` §5 (bill engine), `docs/solar/as-is/09-nersa-tariff-source.md` §5.1 (Net-Billing Rules), §7.2 (golden cases), "Spec changes required" 1–16; decisions D-03, D-03b, D-19 in `docs/solar/06-open-decisions.md`.

**Out of scope (2b):** admin review UI, the publish action that runs the TS validators before flipping state, the Tariff tab, TOU calendar seeding (needs a human reading Eskom booklet p47).

---

## Ground rules (read once)

- Work in the worktree created in Task 1. Every path below is relative to its root.
- **Migration number:** the file is `00210_tariffs_schema.sql`. Numbers are claimed **at apply time**: before the owner applies it, re-check the ledger `max(version)`, `origin/main`, and the migration filenames in open PRs. If `00210` is taken, rename the file and every reference to it (assertion file header, this plan's commands).
- **This migration depends on `00208`** (`solar.org_subscription_active`). While `00208` is not in the production ledger, dry runs concatenate `00208` + `00210` (Task 11 shows how).
- **Do not apply to production.** Dry runs only, inside rolled-back transactions.
- Run all three suites before claiming done: `pnpm --filter web test`, `pnpm --filter @esite/shared test`, `pnpm --filter @esite/db test:ci`.
- Never `REVOKE … FROM PUBLIC` alone on a new function: also `REVOKE … FROM anon` (Supabase grants anon directly).
- **Rounding rule (engine):** lines keep full precision; the import total is rounded once; the export credit is a separate transaction (Net-Billing Rules §8) and is rounded once. Per-line rounding breaks golden case 4 (it gives R2,901.64, not R2,901.63).
- Commits end with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## File structure

| File | Responsibility |
|---|---|
| `packages/shared/src/tariffs/types.ts` | Canonical enums, `Charge`, `Tariff`, `SsegRule`, `LossFactor`, `MonthUsage`, builders |
| `packages/shared/src/tariffs/money.ts` | `roundCents` (float-safe half-away-from-zero) |
| `packages/shared/src/tariffs/financial-year.ts` | FY parsing, predecessor, effective dates, FY-end month |
| `packages/shared/src/tariffs/units.ts` | Unit classes, `randPerKwh`, `parseUnitToken`, `decideEnergyUnit` |
| `packages/shared/src/tariffs/tou.ts` | Seasons, TOU window lookup, day types, 8760 → monthly aggregation |
| `packages/shared/src/tariffs/net-billing-rules.ts` | The Net-Billing Rules as an `SsegRule` per regime |
| `packages/shared/src/tariffs/bill-engine.ts` | `costMonth`, `costPeriod` |
| `packages/shared/src/tariffs/validators.ts` | Issue type, per-tariff and per-year checks |
| `packages/shared/src/tariffs/yoy.ts` | `diffTariffYears` |
| `packages/shared/src/tariffs/index.ts` | Barrel |
| `packages/shared/src/tariffs/*.test.ts` | Unit tests (one per module; the bill engine has two) |
| `packages/shared/src/index.ts` | Re-export `./tariffs` |
| `apps/edge-functions/supabase/migrations/00210_tariffs_schema.sql` | The migration |
| `scripts/db/assert-tariffs-schema-roles.sql` | Behavioural impersonation assertions |
| `apps/edge-functions/supabase/config.toml` | Expose `tariffs` locally |
| `packages/db/src/__tests__/security/anon-execute-secdef.test.ts` | Classify `tariffs` as exposed |

---

### Task 1: Worktree, branch and baseline

**Files:** none (plan files copied in)

- [ ] **Step 1: Create the worktree from the Phase 1A branch**

```bash
cd "/Volumes/Extreme SSD/DEVELOPER/APPS/ESITE.V1/esite"
git fetch origin -q
git worktree add -b feat/solar-phase-2a ~/.config/superpowers/worktrees/esite/solar-phase-2a origin/feat/solar-phase-1a
cd ~/.config/superpowers/worktrees/esite/solar-phase-2a
pnpm install --frozen-lockfile
```
Expected: worktree created on `feat/solar-phase-2a`, install completes.

- [ ] **Step 2: Copy both 2a plans into the worktree and commit them**

```bash
cp ~/.config/superpowers/worktrees/esite/solar-phase-1a/docs/superpowers/plans/2026-09-28-solar-phase-2a-*.md docs/superpowers/plans/
git add docs/superpowers/plans/2026-09-28-solar-phase-2a-*.md
git commit -m "docs(solar): Phase 2a implementation plans (tariff library core)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Baseline the three suites and record the counts**

```bash
pnpm --filter @esite/shared test 2>&1 | tail -4
pnpm --filter web test 2>&1 | tail -4
pnpm --filter @esite/db test:ci 2>&1 | tail -4
```
Expected: all green. Write the three "Tests N passed" counts into your task notes; the PR body quotes them.

---

### Task 2: Canonical types, money and financial years

**Files:**
- Create: `packages/shared/src/tariffs/types.ts`
- Create: `packages/shared/src/tariffs/money.ts`
- Create: `packages/shared/src/tariffs/financial-year.ts`
- Test: `packages/shared/src/tariffs/money.test.ts`, `packages/shared/src/tariffs/financial-year.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/tariffs/money.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { roundCents } from './money'

describe('roundCents', () => {
  it('rounds half away from zero even where binary floats sit just below the half', () => {
    // 150 kWh x 185.41 c = 278.115 exactly on paper; 278.115 * 100 is 27811.499999... in binary.
    expect(roundCents(150 * 1.8541)).toBe(278.12)
    expect(roundCents(1.005)).toBe(1.01)
    expect(roundCents(-278.115)).toBe(-278.12)
  })
  it('leaves exact cents alone and never returns -0', () => {
    expect(roundCents(2849.26)).toBe(2849.26)
    expect(Object.is(roundCents(-0.001), 0)).toBe(true)
  })
  it('refuses a non-finite amount', () => {
    expect(() => roundCents(Number.NaN)).toThrow(RangeError)
  })
})
```

`packages/shared/src/tariffs/financial-year.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { effectiveDates, fyEndMonth, parseFinancialYear, previousFinancialYear } from './financial-year'

describe('financial years', () => {
  it('parses a well-formed year and refuses a malformed one', () => {
    expect(parseFinancialYear('2026/27')).toEqual({ startYear: 2026 })
    expect(parseFinancialYear('2099/00')).toEqual({ startYear: 2099 })
    expect(() => parseFinancialYear('2026/28')).toThrow(RangeError)
    expect(() => parseFinancialYear('2026-27')).toThrow(RangeError)
  })
  it('finds the predecessor year', () => {
    expect(previousFinancialYear('2026/27')).toBe('2025/26')
    expect(previousFinancialYear('2000/01')).toBe('1999/00')
  })
  it('gives Eskom (1 April) and municipal (1 July) effective dates and FY-end months', () => {
    expect(effectiveDates('eskom', '2025/26')).toEqual({ from: '2025-04-01', to: '2026-03-31' })
    expect(effectiveDates('municipal', '2025/26')).toEqual({ from: '2025-07-01', to: '2026-06-30' })
    expect(fyEndMonth('eskom')).toBe(3)
    expect(fyEndMonth('municipal')).toBe(6)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/money.test.ts src/tariffs/financial-year.test.ts`
Expected: FAIL — `Failed to resolve import "./money"` and `"./financial-year"`.

- [ ] **Step 3: Write the types**

`packages/shared/src/tariffs/types.ts`:
```ts
/**
 * Canonical tariff model — docs/solar/03-data-model-and-security.md §4.
 * Mirrors the tariffs.* tables (camelCase here, snake_case in Postgres).
 * Amounts are VAT-exclusive; every charge carries an explicit unit, and a
 * unit that was inferred rather than read says so (unitInferred + reason).
 */

export const TARIFF_UNITS = [
  'c_per_kWh', 'R_per_kWh', 'R_per_month', 'R_per_day', 'R_per_kVA_month',
  'R_per_kW_month', 'R_per_A_month', 'c_per_kVArh', 'R_per_POD_day', 'pct',
] as const
export type TariffUnit = (typeof TARIFF_UNITS)[number]

export const CHARGE_COMPONENTS = [
  'energy', 'legacy', 'basic', 'service', 'admin', 'network_capacity', 'network_demand',
  'transmission_network', 'gcc', 'ancillary', 'ers', 'affordability', 'lv_subsidy',
  'reactive', 'demand', 'capacity_amp', 'export_credit', 'wheeling_uos', 'loss_factor', 'other',
] as const
export type ChargeComponent = (typeof CHARGE_COMPONENTS)[number]

export const TARIFF_SEASONS = ['all', 'high', 'low'] as const
export type TariffSeason = (typeof TARIFF_SEASONS)[number]
/** A billing month is always in one season. */
export type BillingSeason = Exclude<TariffSeason, 'all'>

export const TOU_PERIODS = ['peak', 'standard', 'off_peak'] as const
export type TouPeriod = (typeof TOU_PERIODS)[number]
export type TouOrAll = TouPeriod | 'all'

export const CHARGE_DAY_TYPES = ['all', 'weekday', 'saturday', 'sunday'] as const
export type ChargeDayType = (typeof CHARGE_DAY_TYPES)[number]

export const TARIFF_STRUCTURES = ['flat', 'ibt', 'seasonal', 'seasonal_ibt', 'tou', 'tou_ibt'] as const
export type TariffStructure = (typeof TARIFF_STRUCTURES)[number]

export const TARIFF_CATEGORIES = [
  'domestic', 'commercial', 'industrial', 'agricultural', 'bulk', 'public_lighting', 'sseg', 'wheeling', 'other',
] as const
export type TariffCategory = (typeof TARIFF_CATEGORIES)[number]

export const TARIFF_METERING = ['prepaid', 'conventional', 'both', 'unmetered'] as const
export type TariffMetering = (typeof TARIFF_METERING)[number]

export const VAT_BASES = ['stated_excl', 'assumed_excl', 'stated_incl'] as const
export type VatBasis = (typeof VAT_BASES)[number]

export const DEMAND_BASES = ['nmd', 'actual_md', 'peak_window_md', 'utilised_capacity'] as const
export type DemandBasis = (typeof DEMAND_BASES)[number]

export const BLOCK_BASES = ['monthly', 'daily'] as const
export type BlockBasis = (typeof BLOCK_BASES)[number]

export const EXTRACTION_METHODS = ['parser', 'ai', 'manual'] as const
export type ExtractionMethod = (typeof EXTRACTION_METHODS)[number]

export const LICENSEE_KINDS = ['eskom', 'municipal', 'metro', 'private', 'development_agency', 'industrial_private'] as const
export type LicenseeKind = (typeof LICENSEE_KINDS)[number]

export const YEAR_STATES = ['ingesting', 'in_review', 'published', 'superseded'] as const
export type YearState = (typeof YEAR_STATES)[number]

export const CREDITING = ['net_billing_tou', 'net_billing_flat', 'none'] as const
export type Crediting = (typeof CREDITING)[number]

export const CARRY_FORWARD = ['none', 'within_financial_year'] as const
export type CarryForward = (typeof CARRY_FORWARD)[number]

export const CAP_RULES = ['kwh_per_tou_period', 'value_per_tou_period', 'energy_charges'] as const
export type CapRule = (typeof CAP_RULES)[number]

export const LOSS_FACTOR_KINDS = ['dx_urban', 'dx_rural', 'tx'] as const
export type LossFactorKind = (typeof LOSS_FACTOR_KINDS)[number]

export const SOURCE_DOCUMENT_KINDS = ['tariff_book', 'nersa_decision', 'eskom_schedule', 'rules', 'by_law'] as const
export type SourceDocumentKind = (typeof SOURCE_DOCUMENT_KINDS)[number]

export const SOURCE_DOCUMENT_STATUSES = ['draft', 'final', 'nersa_approved'] as const
export type SourceDocumentStatus = (typeof SOURCE_DOCUMENT_STATUSES)[number]

/** Where a fact came from: enough to put it beside its sheet cell or PDF line. */
export interface SourceLocator {
  file_sha256?: string
  sheet?: string
  row?: number
  col?: string
  cell?: string
  page?: number
  line?: number
  label?: string
  raw_text?: string
  raw_unit?: string | null
  /** Eskom prints excl and incl VAT side by side; the incl value proves x(1+VAT). */
  raw_incl?: number
}

export interface Charge {
  component: ChargeComponent
  season: TariffSeason
  tou: TouOrAll
  dayType: ChargeDayType
  /** Half-open [min, max) in kWh; max null = unbounded. Null min = not a block. */
  blockMinKwh: number | null
  blockMaxKwh: number | null
  blockBasis: BlockBasis | null
  unit: TariffUnit
  demandBasis: DemandBasis | null
  amountExclVat: number
  vatRate: number
  vatBasis: VatBasis
  unitInferred: boolean
  inferenceReason: string | null
  sourceLocator: SourceLocator
  extractionMethod: ExtractionMethod
  /** The source label, kept for review and labels on the bill; stored inside source_locator. */
  label?: string
  reviewedAt?: string | null
}

export interface Tariff {
  code: string | null
  name: string
  family: string | null
  category: TariffCategory
  metering: TariffMetering
  structure: TariffStructure
  voltageBand: string | null
  phase: 'single' | 'three' | null
  transmissionZone: number | null
  localAuthority: boolean
  minAmps: number | null
  maxAmps: number | null
  minKva: number | null
  maxKva: number | null
  isLegacy: boolean
  notes: string | null
  charges: Charge[]
  /** Bill code of the export (Gen-offset) tariff in the same year; resolved to export_tariff_id on insert. */
  exportTariffCode: string | null
  sourceLocator: SourceLocator
}

export interface SsegRule {
  crediting: Crediting
  carryForward: CarryForward
  fyEndMonth: number
  capRule: CapRule
  offsets: 'energy_only'
  forfeitOnOwnershipChange: boolean
  maxKva: number
  requiresTou: boolean
  requiresBidirectionalMeter: boolean
  locator: Record<string, string>
}

export interface LossFactor {
  kind: LossFactorKind
  voltageBand: string | null
  transmissionZone: number | null
  factor: number
  sourceLocator: SourceLocator
}

export interface TouKwh {
  peak: number
  standard: number
  off_peak: number
}

/** One billing month of one point of delivery, already split by TOU period. */
export interface MonthUsage {
  year: number
  /** 1..12 */
  month: number
  days: number
  season: BillingSeason
  importKwh: TouKwh
  exportKwh?: TouKwh
  maxDemandKva?: number | null
  maxDemandKw?: number | null
  peakWindowMdKva?: number | null
  nmdKva?: number | null
  ampsRating?: number | null
  kvarh?: number | null
}

export function makeCharge(p: Partial<Charge> & Pick<Charge, 'component' | 'unit' | 'amountExclVat'>): Charge {
  return {
    season: 'all',
    tou: 'all',
    dayType: 'all',
    blockMinKwh: null,
    blockMaxKwh: null,
    blockBasis: null,
    demandBasis: null,
    vatRate: 0.15,
    vatBasis: 'assumed_excl',
    unitInferred: false,
    inferenceReason: null,
    sourceLocator: {},
    extractionMethod: 'manual',
    ...p,
  }
}

export function makeTariff(p: Partial<Tariff> & Pick<Tariff, 'name' | 'structure' | 'charges'>): Tariff {
  return {
    code: null,
    family: null,
    category: 'other',
    metering: 'both',
    voltageBand: null,
    phase: null,
    transmissionZone: null,
    localAuthority: false,
    minAmps: null,
    maxAmps: null,
    minKva: null,
    maxKva: null,
    isLegacy: false,
    notes: null,
    exportTariffCode: null,
    sourceLocator: {},
    ...p,
  }
}
```

- [ ] **Step 4: Write money and financial years**

`packages/shared/src/tariffs/money.ts`:
```ts
/**
 * Rand to cents, half away from zero. toPrecision(12) first removes the
 * binary tail (278.115 * 100 = 27811.499999999996) before rounding.
 */
export function roundCents(x: number): number {
  if (!Number.isFinite(x)) throw new RangeError(`roundCents: ${x} is not a finite amount`)
  const scaled = Number((x * 100).toPrecision(12))
  const r = (Math.sign(scaled) * Math.round(Math.abs(scaled))) / 100
  return r === 0 ? 0 : r
}
```

`packages/shared/src/tariffs/financial-year.ts`:
```ts
/** Distributor financial years: Eskom 1 Apr – 31 Mar, municipal 1 Jul – 30 Jun. */
export type TariffRegime = 'eskom' | 'municipal'

const FY = /^(\d{4})\/(\d{2})$/

export function parseFinancialYear(fy: string): { startYear: number } {
  const m = FY.exec(fy)
  if (!m || (Number(m[1]) + 1) % 100 !== Number(m[2])) {
    throw new RangeError(`not a financial year: "${fy}" (expected e.g. 2026/27)`)
  }
  return { startYear: Number(m[1]) }
}

export function previousFinancialYear(fy: string): string {
  const s = parseFinancialYear(fy).startYear - 1
  return `${s}/${String((s + 1) % 100).padStart(2, '0')}`
}

export function effectiveDates(regime: TariffRegime, fy: string): { from: string; to: string } {
  const { startYear } = parseFinancialYear(fy)
  return regime === 'eskom'
    ? { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` }
    : { from: `${startYear}-07-01`, to: `${startYear + 1}-06-30` }
}

/** The month whose close resets a net-billing credit balance (Net-Billing Rules §7.1(d)). */
export function fyEndMonth(regime: TariffRegime): number {
  return regime === 'eskom' ? 3 : 6
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/money.test.ts src/tariffs/financial-year.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/tariffs/types.ts packages/shared/src/tariffs/money.ts packages/shared/src/tariffs/financial-year.ts packages/shared/src/tariffs/money.test.ts packages/shared/src/tariffs/financial-year.test.ts
git commit -m "feat(tariffs): canonical tariff types, cent rounding, financial years

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Units

**Files:**
- Create: `packages/shared/src/tariffs/units.ts`
- Test: `packages/shared/src/tariffs/units.test.ts`

The engine never infers a unit (engine spec §1.4). The only inference allowed is in the normaliser, through `decideEnergyUnit`, and it always marks the result `inferred` with a reason (as-is/09 §7.1 Stage C.3).

- [ ] **Step 1: Write the failing test**

`packages/shared/src/tariffs/units.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { decideEnergyUnit, parseUnitToken, randPerKvarh, randPerKwh, unitClass } from './units'

describe('unitClass', () => {
  it('classes every unit', () => {
    expect(unitClass('c_per_kWh')).toBe('per_kwh')
    expect(unitClass('R_per_kWh')).toBe('per_kwh')
    expect(unitClass('R_per_POD_day')).toBe('per_day')
    expect(unitClass('R_per_day')).toBe('per_day')
    expect(unitClass('R_per_kVA_month')).toBe('per_kva_month')
    expect(unitClass('c_per_kVArh')).toBe('per_kvarh')
    expect(unitClass('pct')).toBe('pct')
  })
})

describe('randPerKwh', () => {
  it('converts cents and rand, and refuses anything else', () => {
    expect(randPerKwh({ unit: 'c_per_kWh', amountExclVat: 227.28 })).toBeCloseTo(2.2728, 10)
    expect(randPerKwh({ unit: 'R_per_kWh', amountExclVat: 2.2728 })).toBe(2.2728)
    expect(() => randPerKwh({ unit: 'R_per_month', amountExclVat: 1 })).toThrow(TypeError)
    expect(randPerKvarh({ unit: 'c_per_kVArh', amountExclVat: 37.64 })).toBeCloseTo(0.3764, 10)
  })
})

describe('parseUnitToken', () => {
  it.each([
    ['c/kWh', 'c_per_kWh'],
    ['Approved c/kWh', 'c_per_kWh'],
    ['(c/kWh)supplied;  and', 'c_per_kWh'],
    ['R/kWh', 'R_per_kWh'],
    ['R / kWh', 'R_per_kWh'],
    ['(c/kVArh)', 'c_per_kVArh'],
    ['(R.cents/kvarh)', 'c_per_kVArh'],
    ['[R/POD/day]', 'R_per_POD_day'],
    ['/day', 'R_per_day'],
    ['R/kVA/m', 'R_per_kVA_month'],
    ['//kVA', 'R_per_kVA_month'],
    ['A/kVA NMD/Month', 'R_per_kVA_month'],
    ['(R/Month)', 'R_per_month'],
    ['PER MONTH', 'R_per_month'],
    ['/month', 'R_per_month'],
    ['R/A/m', 'R_per_A_month'],
    ['%', 'pct'],
  ] as const)('%s -> %s', (text, unit) => {
    expect(parseUnitToken(text)).toBe(unit)
  })
  it('needs a rand prefix before a bare /kWh', () => {
    expect(parseUnitToken('/kWh')).toBeNull()
    expect(parseUnitToken('/kWh', { randPrefix: true })).toBe('R_per_kWh')
  })
  it('treats a bare kVA as a unit only when the caller says the text is a value tail', () => {
    expect(parseUnitToken('kVA')).toBeNull()
    expect(parseUnitToken('kVA', { bare: true })).toBe('R_per_kVA_month')
  })
  it('ignores descriptive text and block ranges', () => {
    expect(parseUnitToken('0-350kWh')).toBeNull()
    expect(parseUnitToken('80kVA up to 150kVA Commercial / Industrial')).toBeNull()
    expect(parseUnitToken('Small Power Users 50kVA')).toBeNull()
    expect(parseUnitToken('kWh')).toBeNull()
    expect(parseUnitToken(null)).toBeNull()
  })
})

describe('decideEnergyUnit (normaliser-only inference, always flagged)', () => {
  it('re-reads a c/kWh label with a value under 20 as R/kWh (Buffalo City 3.09)', () => {
    const d = decideEnergyUnit(3.09, 'c_per_kWh')
    expect(d).toMatchObject({ unit: 'R_per_kWh', inferred: true })
    expect(d.reason).toMatch(/^magnitude/)
  })
  it('re-reads an R/kWh label with a value of 50 or more as c/kWh', () => {
    expect(decideEnergyUnit(227.28, 'R_per_kWh')).toMatchObject({ unit: 'c_per_kWh', inferred: true })
  })
  it('keeps a plausible labelled unit as read', () => {
    expect(decideEnergyUnit(227.28, 'c_per_kWh')).toEqual({ unit: 'c_per_kWh', inferred: false, reason: null })
    expect(decideEnergyUnit(2.2728, 'R_per_kWh')).toEqual({ unit: 'R_per_kWh', inferred: false, reason: null })
  })
  it('infers an unlabelled value from its range, and gives up outside both ranges', () => {
    expect(decideEnergyUnit(2.3231, null)).toMatchObject({ unit: 'R_per_kWh', inferred: true })
    expect(decideEnergyUnit(167.21, null)).toMatchObject({ unit: 'c_per_kWh', inferred: true })
    expect(decideEnergyUnit(0, null)).toMatchObject({ unit: 'c_per_kWh', inferred: true, reason: 'unitless zero rate' })
    expect(decideEnergyUnit(30, null)).toMatchObject({ unit: null, inferred: false })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/units.test.ts`
Expected: FAIL — `Failed to resolve import "./units"`.

- [ ] **Step 3: Implement**

`packages/shared/src/tariffs/units.ts`:
```ts
import type { Charge, TariffUnit } from './types'

export type UnitClass =
  | 'per_kwh' | 'per_month' | 'per_day' | 'per_kva_month' | 'per_kw_month' | 'per_amp_month' | 'per_kvarh' | 'pct'

const CLASS: Record<TariffUnit, UnitClass> = {
  c_per_kWh: 'per_kwh',
  R_per_kWh: 'per_kwh',
  R_per_month: 'per_month',
  R_per_day: 'per_day',
  R_per_POD_day: 'per_day',
  R_per_kVA_month: 'per_kva_month',
  R_per_kW_month: 'per_kw_month',
  R_per_A_month: 'per_amp_month',
  c_per_kVArh: 'per_kvarh',
  pct: 'pct',
}

export function unitClass(u: TariffUnit): UnitClass {
  return CLASS[u]
}

/** Plausible energy prices (as-is/09 §7.1 Stage C.3). */
export const ENERGY_CENTS_RANGE = { min: 50, max: 1500 } as const
export const ENERGY_RAND_RANGE = { min: 0.5, max: 15 } as const

/** R per kWh for a per-kWh charge. Throws for any other unit: the engine never guesses. */
export function randPerKwh(c: Pick<Charge, 'unit' | 'amountExclVat'>): number {
  if (c.unit === 'c_per_kWh') return c.amountExclVat / 100
  if (c.unit === 'R_per_kWh') return c.amountExclVat
  throw new TypeError(`randPerKwh: ${c.unit} is not a per-kWh unit`)
}

export function randPerKvarh(c: Pick<Charge, 'unit' | 'amountExclVat'>): number {
  if (c.unit === 'c_per_kVArh') return c.amountExclVat / 100
  throw new TypeError(`randPerKvarh: ${c.unit} is not a per-kVArh unit`)
}

/**
 * Reads a unit written in a source cell, label or header. Returns null when
 * the text names no unit — never a default. `randPrefix`: the value was written
 * "R1,6464/kWh", so a bare "/kWh" is rand. `bare`: the text is the tail of a
 * value ("R157.91kVA"), so a bare "kVA" or "kW" is a unit.
 */
export function parseUnitToken(
  text: string | null | undefined,
  opts: { randPrefix?: boolean; bare?: boolean } = {},
): TariffUnit | null {
  if (!text) return null
  const t = text.toLowerCase().replace(/\s+/g, '').replace(/\/{2,}/g, '/')
  if (/(c|cents?)\/kvarh|r\.cents\/kvarh/.test(t)) return 'c_per_kVArh'
  if (/c\/kwh|cents?\/kwh|c\/unit/.test(t)) return 'c_per_kWh'
  if (/r\/kwh|rand\/kwh/.test(t)) return 'R_per_kWh'
  if (/\/kwh/.test(t)) return opts.randPrefix ? 'R_per_kWh' : null
  if (/\/pod\/day/.test(t)) return 'R_per_POD_day'
  if (/\/day|perday|^day$/.test(t)) return 'R_per_day'
  if (/\/kva|kva\/|r\/?kva/.test(t) || (opts.bare && /^a?\/?kva/.test(t))) return 'R_per_kVA_month'
  if (/\/kw(?!h)|r\/?kw(?!h)/.test(t) || (opts.bare && /^kw$/.test(t))) return 'R_per_kW_month'
  if (/\/amp|\/a\/m|r\/a$|peramp/.test(t) || (opts.bare && /^amps?$/.test(t))) return 'R_per_A_month'
  if (/\/month|permonth|r\/m$|\/m$|^month$|^pm$/.test(t)) return 'R_per_month'
  if (/%$/.test(t)) return 'pct'
  return null
}

export interface UnitDecision {
  unit: TariffUnit | null
  inferred: boolean
  reason: string | null
}

/**
 * The ONLY place a magnitude may change a unit, and only for energy rates.
 * Every change is flagged so a reviewer sees it (unit_inferred + reason).
 */
export function decideEnergyUnit(value: number, labelled: 'c_per_kWh' | 'R_per_kWh' | null): UnitDecision {
  if (labelled === 'c_per_kWh') {
    if (value > 0 && value < 20) {
      return { unit: 'R_per_kWh', inferred: true, reason: `magnitude: labelled c/kWh but ${value} < 20, read as R/kWh` }
    }
    return { unit: 'c_per_kWh', inferred: false, reason: null }
  }
  if (labelled === 'R_per_kWh') {
    if (value >= 50) {
      return { unit: 'c_per_kWh', inferred: true, reason: `magnitude: labelled R/kWh but ${value} >= 50, read as c/kWh` }
    }
    return { unit: 'R_per_kWh', inferred: false, reason: null }
  }
  if (value === 0) return { unit: 'c_per_kWh', inferred: true, reason: 'unitless zero rate' }
  if (value >= ENERGY_RAND_RANGE.min && value <= ENERGY_RAND_RANGE.max) {
    return { unit: 'R_per_kWh', inferred: true, reason: `magnitude: unitless ${value} in 0.5-15, read as R/kWh` }
  }
  if (value >= ENERGY_CENTS_RANGE.min && value <= ENERGY_CENTS_RANGE.max) {
    return { unit: 'c_per_kWh', inferred: true, reason: `magnitude: unitless ${value} in 50-1500, read as c/kWh` }
  }
  return { unit: null, inferred: false, reason: `unitless ${value} is outside both plausible energy ranges` }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/units.test.ts`
Expected: PASS (all `it.each` rows plus 8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/tariffs/units.ts packages/shared/src/tariffs/units.test.ts
git commit -m "feat(tariffs): unit classes, unit-token reader and flagged energy-unit decisions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: TOU calendar and hourly aggregation

**Files:**
- Create: `packages/shared/src/tariffs/tou.ts`
- Test: `packages/shared/src/tariffs/tou.test.ts`

The 8760-hour reference year (engine §1.2) drops 29 Feb. Hour 0 = 1 Jan 00:00–01:00 SAST. A holiday is treated as the calendar's `holidayTreatedAs` day type. Hours outside every window are off-peak.

- [ ] **Step 1: Write the failing test**

`packages/shared/src/tariffs/tou.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { aggregateHourly, dayTypeOf, seasonForMonth, touPeriodAt, type TouCalendar, type TouWindow } from './tou'
import type { BillingSeason, TouPeriod } from './types'

const w = (season: BillingSeason, startMinute: number, endMinute: number, period: TouPeriod): TouWindow => ({
  season, dayType: 'weekday', startMinute, endMinute, period,
})
// Synthetic calendar (not Eskom's): weekday peak 06-08 and 17-20, standard 08-17 and 20-22; weekends off-peak.
const CAL: TouCalendar = {
  highSeasonMonths: [6, 7, 8],
  holidayTreatedAs: 'sunday',
  source: 'assumed_eskom',
  windows: (['high', 'low'] as const).flatMap((s) => [
    w(s, 360, 480, 'peak'), w(s, 480, 1020, 'standard'), w(s, 1020, 1200, 'peak'), w(s, 1200, 1320, 'standard'),
  ]),
}

describe('seasons, day types and windows', () => {
  it('maps months to seasons', () => {
    expect(seasonForMonth(7, CAL)).toBe('high')
    expect(seasonForMonth(1, CAL)).toBe('low')
  })
  it('knows weekdays, weekends and holidays', () => {
    expect(dayTypeOf(2025, 1, 1, undefined, CAL)).toBe('weekday')   // Wednesday
    expect(dayTypeOf(2025, 1, 4, undefined, CAL)).toBe('saturday')
    expect(dayTypeOf(2025, 1, 5, undefined, CAL)).toBe('sunday')
    expect(dayTypeOf(2025, 1, 1, new Set(['2025-01-01']), CAL)).toBe('sunday')
  })
  it('finds the period for a minute, defaulting to off-peak', () => {
    expect(touPeriodAt(CAL, 'low', 'weekday', 7 * 60)).toBe('peak')
    expect(touPeriodAt(CAL, 'low', 'weekday', 12 * 60)).toBe('standard')
    expect(touPeriodAt(CAL, 'low', 'weekday', 23 * 60)).toBe('off_peak')
    expect(touPeriodAt(CAL, 'low', 'saturday', 7 * 60)).toBe('off_peak')
  })
})

describe('aggregateHourly', () => {
  const ones = new Float64Array(8760).fill(1)
  it('splits January 2025 (23 weekdays) into TOU kWh', () => {
    const jan = aggregateHourly({ importKwh: ones, calendar: CAL, year: 2025 })[0]
    expect(jan).toMatchObject({ month: 1, days: 31, season: 'low' })
    expect(jan.importKwh).toEqual({ peak: 23 * 5, standard: 23 * 11, off_peak: 744 - 23 * 16 })
  })
  it('moves a holiday to its treated-as day type', () => {
    const jan = aggregateHourly({ importKwh: ones, calendar: CAL, year: 2025, holidays: new Set(['2025-01-01']) })[0]
    expect(jan.importKwh).toEqual({ peak: 22 * 5, standard: 22 * 11, off_peak: 744 - 22 * 16 })
  })
  it('drops 29 February in a leap year and keeps 8760 hours', () => {
    const months = aggregateHourly({ importKwh: ones, calendar: CAL, year: 2024 })
    expect(months[1].days).toBe(28)
    const total = months.reduce((a, m) => a + m.importKwh.peak + m.importKwh.standard + m.importKwh.off_peak, 0)
    expect(total).toBe(8760)
  })
  it('aggregates export alongside import and refuses a wrong-length series', () => {
    const months = aggregateHourly({ importKwh: ones, exportKwh: ones, calendar: CAL, year: 2025 })
    expect(months[0].exportKwh).toEqual(months[0].importKwh)
    expect(() => aggregateHourly({ importKwh: new Float64Array(10), calendar: CAL, year: 2025 })).toThrow(RangeError)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/tou.test.ts`
Expected: FAIL — `Failed to resolve import "./tou"`.

- [ ] **Step 3: Implement**

`packages/shared/src/tariffs/tou.ts`:
```ts
import type { BillingSeason, MonthUsage, TouKwh, TouPeriod } from './types'

export type WindowDayType = 'weekday' | 'saturday' | 'sunday'

export interface TouWindow {
  season: BillingSeason
  dayType: WindowDayType
  /** [startMinute, endMinute) minutes after local midnight. */
  startMinute: number
  endMinute: number
  period: TouPeriod
}

export interface TouCalendar {
  highSeasonMonths: number[]
  windows: TouWindow[]
  holidayTreatedAs: 'saturday' | 'sunday' | null
  /** Municipal books state seasons, never hours: their calendars are assumed_eskom. */
  source: 'published' | 'assumed_eskom'
}

/** Days per month of the 8760-hour reference year (29 Feb dropped). */
export const REFERENCE_MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const

export function zeroTouKwh(): TouKwh {
  return { peak: 0, standard: 0, off_peak: 0 }
}

export function sumTouKwh(t: TouKwh): number {
  return t.peak + t.standard + t.off_peak
}

export function seasonForMonth(month: number, cal: Pick<TouCalendar, 'highSeasonMonths'>): BillingSeason {
  return cal.highSeasonMonths.includes(month) ? 'high' : 'low'
}

export function dayTypeOf(
  year: number, month: number, day: number,
  holidays: ReadonlySet<string> | undefined,
  cal: Pick<TouCalendar, 'holidayTreatedAs'>,
): WindowDayType {
  const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  if (cal.holidayTreatedAs && holidays?.has(key)) return cal.holidayTreatedAs
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return dow === 0 ? 'sunday' : dow === 6 ? 'saturday' : 'weekday'
}

export function touPeriodAt(cal: Pick<TouCalendar, 'windows'>, season: BillingSeason, dayType: WindowDayType, minute: number): TouPeriod {
  const hit = cal.windows.find(
    (x) => x.season === season && x.dayType === dayType && minute >= x.startMinute && minute < x.endMinute,
  )
  return hit ? hit.period : 'off_peak'
}

/**
 * 8760 hourly kWh (interval-ending averages, hour 0 = 1 Jan 00:00-01:00 SAST)
 * into twelve TOU-split months. Maximum demand needs sub-hourly data and is
 * left unset here (engine spec §2.6).
 */
export function aggregateHourly(input: {
  importKwh: ArrayLike<number>
  exportKwh?: ArrayLike<number>
  calendar: TouCalendar
  year: number
  holidays?: ReadonlySet<string>
}): MonthUsage[] {
  if (input.importKwh.length !== 8760) throw new RangeError(`importKwh has ${input.importKwh.length} hours, expected 8760`)
  if (input.exportKwh && input.exportKwh.length !== 8760) {
    throw new RangeError(`exportKwh has ${input.exportKwh.length} hours, expected 8760`)
  }
  const months: MonthUsage[] = REFERENCE_MONTH_DAYS.map((days, k) => ({
    year: input.year,
    month: k + 1,
    days,
    season: seasonForMonth(k + 1, input.calendar),
    importKwh: zeroTouKwh(),
    ...(input.exportKwh ? { exportKwh: zeroTouKwh() } : {}),
  }))
  let h = 0
  for (let m = 1; m <= 12; m++) {
    const usage = months[m - 1]
    for (let d = 1; d <= REFERENCE_MONTH_DAYS[m - 1]; d++) {
      const dayType = dayTypeOf(input.year, m, d, input.holidays, input.calendar)
      for (let hr = 0; hr < 24; hr++, h++) {
        const p = touPeriodAt(input.calendar, usage.season, dayType, hr * 60)
        usage.importKwh[p] += input.importKwh[h]
        if (input.exportKwh && usage.exportKwh) usage.exportKwh[p] += input.exportKwh[h]
      }
    }
  }
  return months
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/tou.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/tariffs/tou.ts packages/shared/src/tariffs/tou.test.ts
git commit -m "feat(tariffs): TOU calendar lookup and 8760-hour monthly aggregation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Bill engine — import side, golden cases 1–8

**Files:**
- Create: `packages/shared/src/tariffs/bill-engine.ts`
- Test: `packages/shared/src/tariffs/bill-engine.test.ts`

Golden values are as-is/09 §7.2, from the source cells (all excl VAT). Here the tariffs are built by hand from those cells; plan 2a-ii re-runs the same cases through the parsers.

- [ ] **Step 1: Write the failing test**

`packages/shared/src/tariffs/bill-engine.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { costMonth } from './bill-engine'
import { makeCharge, makeTariff, type Charge, type ChargeComponent, type MonthUsage, type TariffSeason, type TariffUnit, type TouOrAll } from './types'

function usage(p: Partial<MonthUsage> & { kwh?: number } = {}): MonthUsage {
  const { kwh, ...rest } = p
  return { year: 2025, month: 1, days: 30, season: 'low', importKwh: { peak: 0, standard: kwh ?? 0, off_peak: 0 }, ...rest }
}
const block = (min: number, max: number | null, amount: number, unit: TariffUnit = 'c_per_kWh', season: TariffSeason = 'all'): Charge =>
  makeCharge({ component: 'energy', unit, amountExclVat: amount, blockMinKwh: min, blockMaxKwh: max, blockBasis: 'monthly', season })
const tou = (season: TariffSeason, t: TouOrAll, cents: number): Charge =>
  makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: cents, season, tou: t })
const monthly = (component: ChargeComponent, rand: number): Charge => makeCharge({ component, unit: 'R_per_month', amountExclVat: rand })

describe('golden tariff cases (as-is/09 §7.2), import side', () => {
  it('1. City Power Residential Single Phase 60A: 5-block IBT, 800 kWh -> R2,849.26', () => {
    const t = makeTariff({ name: 'Residential Single Phase 60A', structure: 'ibt', charges: [
      block(0, 500, 227.28), block(500, 1000, 260.83), block(1000, 2000, 280.08), block(2000, 3000, 295.5), block(3000, null, 310),
      monthly('service', 235.79), monthly('network_capacity', 694.58),
    ] })
    const bill = costMonth(t, usage({ kwh: 800 }))
    expect(bill.energyCharges).toBe(1918.89)
    expect(bill.totalExclVat).toBe(2849.26)
  })

  it('2. City Power Residential TOU (<=80A), high season P100/S200/O300 -> R2,890.51', () => {
    const t = makeTariff({ name: 'Residential Time of Use (<=80A)', structure: 'tou', charges: [
      tou('low', 'peak', 275.58), tou('low', 'standard', 218), tou('low', 'off_peak', 171.5),
      tou('high', 'peak', 634.02), tou('high', 'standard', 259.72), tou('high', 'off_peak', 183.27),
      monthly('service', 235.79), monthly('network_capacity', 951.45),
    ] })
    const bill = costMonth(t, usage({ month: 7, season: 'high', importKwh: { peak: 100, standard: 200, off_peak: 300 } }))
    expect(bill.totalExclVat).toBe(2890.51)
  })

  it('3. City Power Industrial LV (TOU), summer, MD 100 kVA, 0 kVArh -> R59,556.92', () => {
    const t = makeTariff({ name: 'Industrial LV (TOU)', structure: 'tou', charges: [
      tou('low', 'peak', 267.76), tou('low', 'standard', 201.59), tou('low', 'off_peak', 154.96),
      tou('high', 'peak', 637.16), tou('high', 'standard', 243.27), tou('high', 'off_peak', 166.67),
      makeCharge({ component: 'demand', unit: 'R_per_kVA_month', amountExclVat: 358.84, demandBasis: 'actual_md' }),
      makeCharge({ component: 'reactive', unit: 'c_per_kVArh', amountExclVat: 37.64 }),
      monthly('service', 1895.11), monthly('network_capacity', 1694.31),
    ] })
    const bill = costMonth(t, usage({ importKwh: { peak: 2000, standard: 5000, off_peak: 3000 }, maxDemandKva: 100, kvarh: 0 }))
    expect(bill.energyCharges).toBe(20083.5)
    expect(bill.lines.find((l) => l.kind === 'demand')?.amount).toBe(35884)
    expect(bill.lines.find((l) => l.kind === 'reactive')?.amount).toBe(0)
    expect(bill.totalExclVat).toBe(59556.92)
  })

  it('4. Ekurhuleni Domestic IBT Tariff A, unitless R/kWh, 800 kWh -> R2,901.63 (total rounded once)', () => {
    const t = makeTariff({ name: 'Domestic IBT Tariff A', structure: 'ibt', charges: [
      block(0, 50, 2.3231, 'R_per_kWh'), block(50, 600, 2.3231, 'R_per_kWh'),
      block(600, 700, 3.9486, 'R_per_kWh'), block(700, null, 11.1291, 'R_per_kWh'),
    ] })
    expect(costMonth(t, usage({ kwh: 800 })).totalExclVat).toBe(2901.63)
  })

  it('5. Lephalale Domestic Prepaid & Conventional, 400 kWh -> R1,061.25', () => {
    const t = makeTariff({ name: 'Domestic Prepaid & Conventional', structure: 'ibt', charges: [
      block(0, 50, 1.6464, 'R_per_kWh'), block(50, 350, 2.0889, 'R_per_kWh'),
      block(350, 600, 3.0002, 'R_per_kWh'), block(600, null, 3.6052, 'R_per_kWh'),
      monthly('basic', 202.25),
    ] })
    expect(costMonth(t, usage({ kwh: 400 })).totalExclVat).toBe(1061.25)
  })

  it('6. Buffalo City Scale 1A, energy stored as the inferred R/kWh, 500 kWh -> R2,209.00', () => {
    const t = makeTariff({ name: 'Scale 1A', structure: 'flat', charges: [
      makeCharge({ component: 'energy', unit: 'R_per_kWh', amountExclVat: 3.09, unitInferred: true, inferenceReason: 'magnitude: labelled c/kWh but 3.09 < 20, read as R/kWh' }),
      monthly('basic', 664),
    ] })
    expect(costMonth(t, usage({ kwh: 500 })).totalExclVat).toBe(2209)
  })

  it('7. Cape Town Large User LV TOU, high season, basic R/day x 30, MD 200 kVA -> R130,224.30', () => {
    const t = makeTariff({ name: 'Large User Low Voltage Time of Use', structure: 'tou', charges: [
      makeCharge({ component: 'basic', unit: 'R_per_day', amountExclVat: 168.81 }),
      tou('low', 'peak', 203.8), tou('low', 'standard', 142.41), tou('low', 'off_peak', 92.8),
      makeCharge({ component: 'demand', unit: 'R_per_kVA_month', amountExclVat: 277.71, season: 'low', demandBasis: 'actual_md' }),
      makeCharge({ component: 'network_capacity', unit: 'R_per_kVA_month', amountExclVat: 0, season: 'low', demandBasis: 'nmd' }),
      tou('high', 'peak', 610.75), tou('high', 'standard', 189.75), tou('high', 'off_peak', 106.18),
      makeCharge({ component: 'demand', unit: 'R_per_kVA_month', amountExclVat: 277.71, season: 'high', demandBasis: 'actual_md' }),
      makeCharge({ component: 'network_capacity', unit: 'R_per_kVA_month', amountExclVat: 0, season: 'high', demandBasis: 'nmd' }),
    ] })
    const bill = costMonth(t, usage({
      month: 7, season: 'high', days: 30,
      importKwh: { peak: 5000, standard: 15000, off_peak: 10000 }, maxDemandKva: 200, nmdKva: 200,
    }))
    expect(bill.lines.filter((l) => l.kind === 'demand')).toHaveLength(1)
    expect(bill.energyCharges).toBe(69618)
    expect(bill.totalExclVat).toBe(130224.3)
  })

  it('8. Maluti-a-Phofung domestic single phase, summer, 400 kWh -> R1,275.84', () => {
    const t = makeTariff({ name: 'DOMESTIC NON RURAL', structure: 'seasonal_ibt', charges: [
      block(0, 50, 1.68, 'R_per_kWh', 'low'), block(50, 350, 2.18, 'R_per_kWh', 'low'),
      block(350, 600, 3.08, 'R_per_kWh', 'low'), block(600, null, 3.49, 'R_per_kWh', 'low'),
      block(0, 50, 1.79, 'R_per_kWh', 'high'), block(50, 350, 2.35, 'R_per_kWh', 'high'),
      monthly('basic', 383.84),
    ] })
    expect(costMonth(t, usage({ kwh: 400, season: 'low' })).totalExclVat).toBe(1275.84)
  })
})

describe('engine rules', () => {
  it('scales daily-basis blocks by the days in the month', () => {
    const t = makeTariff({ name: 'daily blocks', structure: 'ibt', charges: [
      makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 100, blockMinKwh: 0, blockMaxKwh: 10, blockBasis: 'daily' }),
      makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 200, blockMinKwh: 10, blockMaxKwh: null, blockBasis: 'daily' }),
    ] })
    // 30 days x 10 kWh = 300 kWh at R1, then 100 kWh at R2
    expect(costMonth(t, usage({ kwh: 400, days: 30 })).totalExclVat).toBe(500)
  })

  it('charges amp-based capacity on the rating and adds VAT at the stored rate', () => {
    const t = makeTariff({ name: 'amps', structure: 'flat', charges: [
      makeCharge({ component: 'energy', unit: 'R_per_kWh', amountExclVat: 2 }),
      makeCharge({ component: 'capacity_amp', unit: 'R_per_A_month', amountExclVat: 10 }),
    ] })
    const bill = costMonth(t, usage({ kwh: 100, ampsRating: 60 }))
    expect(bill.totalExclVat).toBe(800)
    expect(bill.vat).toBe(120)
    expect(bill.totalInclVat).toBe(920)
  })

  it('lists, never silently drops, a charge it cannot cost', () => {
    const t = makeTariff({ name: 'gaps', structure: 'flat', charges: [
      makeCharge({ component: 'energy', unit: 'R_per_kWh', amountExclVat: 2 }),
      makeCharge({ component: 'reactive', unit: 'c_per_kVArh', amountExclVat: 30 }),
      makeCharge({ component: 'demand', unit: 'R_per_kVA_month', amountExclVat: 300 }),
      makeCharge({ component: 'other', unit: 'pct', amountExclVat: 2 }),
      makeCharge({ component: 'wheeling_uos', unit: 'c_per_kWh', amountExclVat: 20 }),
    ] })
    const bill = costMonth(t, usage({ kwh: 100 }))
    expect(bill.notModelled.map((n) => n.chargeIndex)).toEqual([1, 2, 3, 4])
    expect(bill.notModelled[0].reason).toMatch(/kVArh/)
    expect(bill.totalExclVat).toBe(200)
  })

  it('does not cost TOU with inclining blocks, and says so', () => {
    const t = makeTariff({ name: 'tou_ibt', structure: 'tou_ibt', charges: [
      makeCharge({ component: 'energy', unit: 'R_per_kWh', amountExclVat: 2, tou: 'peak' }),
      makeCharge({ component: 'energy', unit: 'R_per_kWh', amountExclVat: 1, blockMinKwh: 0, blockMaxKwh: null, blockBasis: 'monthly' }),
    ] })
    const bill = costMonth(t, usage({ kwh: 100 }))
    expect(bill.energyCharges).toBe(0)
    expect(bill.notModelled).toHaveLength(2)
  })

  it('charges reactive energy only above 30% of active energy', () => {
    const t = makeTariff({ name: 'reactive', structure: 'flat', charges: [
      makeCharge({ component: 'reactive', unit: 'c_per_kVArh', amountExclVat: 40 }),
    ] })
    // 1000 kWh, 500 kVArh: 500 - 300 = 200 chargeable x R0.40
    expect(costMonth(t, usage({ kwh: 1000, kvarh: 500 })).totalExclVat).toBe(80)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/bill-engine.test.ts`
Expected: FAIL — `Failed to resolve import "./bill-engine"`.

- [ ] **Step 3: Implement the engine (import side and credit settlement together; Task 6 tests the credit)**

`packages/shared/src/tariffs/bill-engine.ts`:
```ts
/**
 * Bill engine — docs/solar/02-calculation-engine-spec.md §5. Pure, no I/O.
 * Costs one billing month of one point of delivery from TOU-split usage.
 *
 *  - The stored UNIT decides how a charge is costed. The engine never infers a
 *    unit from a magnitude and never re-derives a component from a label.
 *  - Every applicable charge is costed or listed in `notModelled` with a reason.
 *  - Lines keep full precision. The import total is rounded once; the export
 *    credit is a separate transaction (Net-Billing Rules §8), rounded once.
 *  - Net billing (Rules pp7-12): credited kWh capped per TOU period at import
 *    kWh; the credit offsets active-energy charges only; any excess carries to
 *    the next month and is forfeited at the distributor's financial-year end.
 */
import { roundCents } from './money'
import { sumTouKwh, zeroTouKwh } from './tou'
import { randPerKwh, unitClass } from './units'
import {
  TOU_PERIODS,
  type BillingSeason, type Charge, type ChargeComponent, type MonthUsage, type SsegRule,
  type Tariff, type TariffUnit, type TouKwh, type TouPeriod,
} from './types'

export const BILL_ENGINE_VERSION = '0.1.0'
/** kVArh up to this share of active kWh is free (engine spec §5.6). */
export const REACTIVE_FREE_RATIO = 0.3

export type BillLineKind = 'energy' | 'adder' | 'fixed' | 'network_capacity' | 'demand' | 'reactive' | 'export_credit'

export interface BillLine {
  kind: BillLineKind
  component: ChargeComponent
  /** Index into tariff.charges; null for the export-credit line. */
  chargeIndex: number | null
  label: string
  quantity: number
  quantityUnit: 'kWh' | 'kVArh' | 'kVA' | 'kW' | 'A' | 'day' | 'month'
  rate: number
  rateUnit: TariffUnit | 'R_per_kWh_credit'
  /** Full precision; round for display only. */
  amount: number
}

export interface NotModelled {
  chargeIndex: number
  component: ChargeComponent
  reason: string
}

export interface CreditResult {
  exportKwh: TouKwh
  /** Credited kWh per TOU period (net_billing_tou); null for flat crediting. */
  creditedKwh: TouKwh | null
  creditedTotalKwh: number
  earned: number
  carriedIn: number
  used: number
  carriedOut: number
  forfeited: number
  warnings: string[]
}

export interface MonthlyBill {
  year: number
  month: number
  season: BillingSeason
  lines: BillLine[]
  notModelled: NotModelled[]
  /** Active-energy charges only: the pool a net-billing credit may offset. */
  energyCharges: number
  totalExclVat: number
  vat: number
  totalInclVat: number
  credit: CreditResult
}

export interface CostOptions {
  /** The linked export tariff (Eskom Gen-offset). Without it, the tariff's own export_credit charges are used. */
  exportTariff?: Tariff | null
  sseg?: SsegRule | null
  /** Credit balance carried in from the previous month (R). */
  creditIn?: number
  systemKva?: number | null
}

interface Indexed {
  c: Charge
  i: number
}

interface Ctx {
  usage: MonthUsage
  lines: BillLine[]
  notModelled: NotModelled[]
  /** Rand of active energy per TOU period, for the value_per_tou_period cap. */
  energyValueByPeriod: TouKwh
}

const seasonMatches = (c: Charge, s: BillingSeason): boolean => c.season === 'all' || c.season === s

function chargeLabel(c: Charge): string {
  if (c.label) return c.label
  const season = c.season === 'all' ? '' : ` ${c.season}`
  const tou = c.tou === 'all' ? '' : ` ${c.tou}`
  return `${c.component}${season}${tou}`
}

function costEnergy(ctx: Ctx, energy: Indexed[]): void {
  if (energy.length === 0) return
  const { usage } = ctx
  const total = sumTouKwh(usage.importKwh)
  const touCharges = energy.filter(({ c }) => c.tou !== 'all')
  const blocked = energy.filter(({ c }) => c.blockMinKwh !== null)
  const plain = energy.filter(({ c }) => c.tou === 'all' && c.blockMinKwh === null)

  if (touCharges.length > 0 && blocked.length > 0) {
    for (const { c, i } of energy) {
      ctx.notModelled.push({ chargeIndex: i, component: c.component, reason: 'TOU with inclining blocks (tou_ibt) is not modelled' })
    }
    return
  }

  for (const { c, i } of touCharges) {
    const p = c.tou as TouPeriod
    const qty = usage.importKwh[p]
    const amount = qty * randPerKwh(c)
    ctx.energyValueByPeriod[p] += amount
    ctx.lines.push({ kind: 'energy', component: c.component, chargeIndex: i, label: chargeLabel(c), quantity: qty, quantityUnit: 'kWh', rate: c.amountExclVat, rateUnit: c.unit, amount })
  }

  const sorted = [...blocked].sort((a, b) => (a.c.blockMinKwh as number) - (b.c.blockMinKwh as number))
  for (const { c, i } of sorted) {
    const scale = c.blockBasis === 'daily' ? usage.days : 1
    const lo = (c.blockMinKwh as number) * scale
    const hi = c.blockMaxKwh === null ? Number.POSITIVE_INFINITY : c.blockMaxKwh * scale
    const qty = Math.max(0, Math.min(total, hi) - lo)
    if (qty === 0) continue
    const rate = randPerKwh(c)
    for (const p of TOU_PERIODS) ctx.energyValueByPeriod[p] += total === 0 ? 0 : (qty * rate * usage.importKwh[p]) / total
    ctx.lines.push({
      kind: 'energy', component: c.component, chargeIndex: i,
      label: `${chargeLabel(c)} [${lo}-${hi === Number.POSITIVE_INFINITY ? '' : hi} kWh)`,
      quantity: qty, quantityUnit: 'kWh', rate: c.amountExclVat, rateUnit: c.unit, amount: qty * rate,
    })
  }

  for (const { c, i } of plain) {
    const rate = randPerKwh(c)
    for (const p of TOU_PERIODS) ctx.energyValueByPeriod[p] += usage.importKwh[p] * rate
    ctx.lines.push({ kind: 'energy', component: c.component, chargeIndex: i, label: chargeLabel(c), quantity: total, quantityUnit: 'kWh', rate: c.amountExclVat, rateUnit: c.unit, amount: total * rate })
  }
}

function demandQuantity(c: Charge, u: MonthUsage): { qty: number | null; basis: string } {
  const basis = c.demandBasis ?? (c.component === 'network_capacity' ? 'nmd' : 'actual_md')
  switch (basis) {
    case 'nmd':
      return { qty: u.nmdKva ?? null, basis: 'NMD' }
    case 'actual_md':
      return { qty: u.maxDemandKva ?? null, basis: 'maximum demand' }
    case 'peak_window_md':
      return { qty: u.peakWindowMdKva ?? null, basis: 'peak/standard-window maximum demand' }
    default:
      return {
        qty: u.nmdKva != null && u.maxDemandKva != null ? Math.max(u.nmdKva, u.maxDemandKva) : null,
        basis: 'utilised capacity (NMD and maximum demand)',
      }
  }
}

function costOther(ctx: Ctx, c: Charge, i: number, totalKwh: number): void {
  const u = ctx.usage
  const base = { component: c.component, chargeIndex: i, label: chargeLabel(c), rate: c.amountExclVat, rateUnit: c.unit }
  const fixedKind: BillLineKind = c.component === 'network_capacity' ? 'network_capacity' : 'fixed'
  switch (unitClass(c.unit)) {
    case 'per_kwh': {
      // Per-kWh adders: legacy, ancillary, network demand in c/kWh (Homeflex), subsidies.
      const qty = c.tou === 'all' ? totalKwh : u.importKwh[c.tou]
      ctx.lines.push({ ...base, kind: 'adder', quantity: qty, quantityUnit: 'kWh', amount: qty * randPerKwh(c) })
      return
    }
    case 'per_month':
      ctx.lines.push({ ...base, kind: fixedKind, quantity: 1, quantityUnit: 'month', amount: c.amountExclVat })
      return
    case 'per_day':
      // Eskom R/POD/day and municipal R/day (Cape Town) alike.
      ctx.lines.push({ ...base, kind: fixedKind, quantity: u.days, quantityUnit: 'day', amount: c.amountExclVat * u.days })
      return
    case 'per_kva_month': {
      const { qty, basis } = demandQuantity(c, u)
      if (qty === null) {
        ctx.notModelled.push({ chargeIndex: i, component: c.component, reason: `no ${basis} in kVA was supplied` })
        return
      }
      ctx.lines.push({ ...base, kind: c.component === 'network_capacity' ? 'network_capacity' : 'demand', quantity: qty, quantityUnit: 'kVA', amount: qty * c.amountExclVat })
      return
    }
    case 'per_kw_month':
      if (u.maxDemandKw == null) {
        ctx.notModelled.push({ chargeIndex: i, component: c.component, reason: 'no maximum demand in kW was supplied' })
        return
      }
      ctx.lines.push({ ...base, kind: 'demand', quantity: u.maxDemandKw, quantityUnit: 'kW', amount: u.maxDemandKw * c.amountExclVat })
      return
    case 'per_amp_month':
      if (u.ampsRating == null) {
        ctx.notModelled.push({ chargeIndex: i, component: c.component, reason: 'no supply rating in amps was supplied' })
        return
      }
      ctx.lines.push({ ...base, kind: fixedKind, quantity: u.ampsRating, quantityUnit: 'A', amount: u.ampsRating * c.amountExclVat })
      return
    case 'per_kvarh': {
      if (u.kvarh == null) {
        ctx.notModelled.push({ chargeIndex: i, component: c.component, reason: 'no kVArh data: reactive energy is not modelled' })
        return
      }
      const qty = Math.max(0, u.kvarh - REACTIVE_FREE_RATIO * totalKwh)
      ctx.lines.push({ ...base, kind: 'reactive', quantity: qty, quantityUnit: 'kVArh', amount: (qty * c.amountExclVat) / 100 })
      return
    }
    case 'pct':
      ctx.notModelled.push({ chargeIndex: i, component: c.component, reason: 'percentage surcharges are not modelled' })
      return
  }
}

function exportRateRand(charges: readonly Charge[], season: BillingSeason, period: TouPeriod | 'all'): number | null {
  const pool = charges.filter(
    (c) => (c.component === 'export_credit' || c.component === 'energy')
      && c.blockMinKwh === null
      && seasonMatches(c, season)
      && unitClass(c.unit) === 'per_kwh',
  )
  const exact = pool.find((c) => c.tou === period)
  const fallback = period === 'all' ? undefined : pool.find((c) => c.tou === 'all')
  const pick = exact ?? fallback
  return pick ? randPerKwh(pick) : null
}

function settleCredit(
  usage: MonthUsage, opts: CostOptions, exportCharges: readonly Charge[], importValue: TouKwh, energyCharges: number,
): CreditResult {
  const exp = usage.exportKwh ?? zeroTouKwh()
  const sseg = opts.sseg ?? null
  const res: CreditResult = {
    exportKwh: { ...exp }, creditedKwh: null, creditedTotalKwh: 0,
    earned: 0, carriedIn: roundCents(opts.creditIn ?? 0), used: 0, carriedOut: 0, forfeited: 0, warnings: [],
  }
  const exported = sumTouKwh(exp)

  if (!sseg || sseg.crediting === 'none') {
    if (exported > 0) res.warnings.push('No net-billing rule applies: exported energy earns no credit.')
  } else if (opts.systemKva != null && opts.systemKva > sseg.maxKva) {
    if (exported > 0) {
      res.warnings.push(`A ${opts.systemKva} kVA system exceeds the ${sseg.maxKva} kVA net-billing limit: exports are not credited.`)
    }
  } else if (sseg.crediting === 'net_billing_tou') {
    const credited = zeroTouKwh()
    let earned = 0
    for (const p of TOU_PERIODS) {
      const e = exp[p]
      if (e <= 0) continue
      const rate = exportRateRand(exportCharges, usage.season, p)
      if (rate === null) {
        res.warnings.push(`No export rate for ${p} in the ${usage.season} season: ${e} kWh not credited.`)
        continue
      }
      const kwh = sseg.capRule === 'kwh_per_tou_period' ? Math.min(e, usage.importKwh[p]) : e
      let value = kwh * rate
      if (sseg.capRule === 'value_per_tou_period') value = Math.min(value, importValue[p])
      credited[p] = kwh
      earned += value
    }
    res.creditedKwh = credited
    res.creditedTotalKwh = sumTouKwh(credited)
    res.earned = roundCents(earned)
  } else {
    const rate = exportRateRand(exportCharges, usage.season, 'all')
    if (exported > 0 && rate === null) {
      res.warnings.push(`No flat export rate in the ${usage.season} season: ${exported} kWh not credited.`)
    } else if (exported > 0 && rate !== null) {
      const kwh = sseg.capRule === 'energy_charges' ? exported : Math.min(exported, sumTouKwh(usage.importKwh))
      res.creditedTotalKwh = kwh
      res.earned = roundCents(kwh * rate)
    }
  }

  const available = roundCents(res.earned + res.carriedIn)
  res.used = Math.min(available, energyCharges)
  let carry = roundCents(available - res.used)
  // Never cash. No carry-forward, or the FY-end month, forfeits the balance.
  const resets = !sseg || sseg.carryForward === 'none' || usage.month === sseg.fyEndMonth
  if (resets) {
    res.forfeited = carry
    carry = 0
  }
  res.carriedOut = carry
  return res
}

export function costMonth(tariff: Tariff, usage: MonthUsage, opts: CostOptions = {}): MonthlyBill {
  const ctx: Ctx = { usage, lines: [], notModelled: [], energyValueByPeriod: zeroTouKwh() }
  const total = sumTouKwh(usage.importKwh)
  const applicable: Indexed[] = tariff.charges.map((c, i) => ({ c, i })).filter(({ c }) => seasonMatches(c, usage.season))

  costEnergy(ctx, applicable.filter(({ c }) => c.component === 'energy'))
  for (const { c, i } of applicable) {
    if (c.component === 'energy' || c.component === 'export_credit') continue
    if (c.component === 'loss_factor' || c.component === 'wheeling_uos') {
      ctx.notModelled.push({ chargeIndex: i, component: c.component, reason: 'wheeling components are not part of a self-consumption bill' })
      continue
    }
    costOther(ctx, c, i, total)
  }

  const energyCharges = roundCents(ctx.lines.filter((l) => l.kind === 'energy').reduce((a, l) => a + l.amount, 0))
  const importTotal = roundCents(ctx.lines.reduce((a, l) => a + l.amount, 0))
  const exportCharges = opts.exportTariff
    ? opts.exportTariff.charges
    : tariff.charges.filter((c) => c.component === 'export_credit')
  const credit = settleCredit(usage, opts, exportCharges, ctx.energyValueByPeriod, energyCharges)
  if (credit.used > 0) {
    ctx.lines.push({
      kind: 'export_credit', component: 'export_credit', chargeIndex: null, label: 'Net-billing export credit',
      quantity: credit.creditedTotalKwh, quantityUnit: 'kWh',
      rate: credit.creditedTotalKwh === 0 ? 0 : credit.used / credit.creditedTotalKwh, rateUnit: 'R_per_kWh_credit',
      amount: -credit.used,
    })
  }

  const totalExclVat = roundCents(importTotal - credit.used)
  const vatRate = tariff.charges[0]?.vatRate ?? 0.15
  const vat = roundCents(totalExclVat * vatRate)
  return {
    year: usage.year, month: usage.month, season: usage.season,
    lines: ctx.lines, notModelled: ctx.notModelled,
    energyCharges, totalExclVat, vat, totalInclVat: roundCents(totalExclVat + vat), credit,
  }
}

/** Consecutive months with the credit balance carried between them (FY-end reset by month number). */
export function costPeriod(tariff: Tariff, months: readonly MonthUsage[], opts: CostOptions = {}): MonthlyBill[] {
  const bills: MonthlyBill[] = []
  let carry = opts.creditIn ?? 0
  for (const m of months) {
    const bill = costMonth(tariff, m, { ...opts, creditIn: carry })
    bills.push(bill)
    carry = bill.credit.carriedOut
  }
  return bills
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/bill-engine.test.ts`
Expected: PASS, 13 tests. If case 4 reports 2901.64, lines are being rounded individually — they must not be.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/tariffs/bill-engine.ts packages/shared/src/tariffs/bill-engine.test.ts
git commit -m "feat(tariffs): bill engine import side with golden cases 1-8

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Net billing — golden case 10, carry-forward, FY reset, unit confusion

**Files:**
- Create: `packages/shared/src/tariffs/net-billing-rules.ts`
- Test: `packages/shared/src/tariffs/bill-engine.net-billing.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/shared/src/tariffs/bill-engine.net-billing.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { costMonth, costPeriod } from './bill-engine'
import { netBillingRule } from './net-billing-rules'
import { validateTariffYear } from './validators'
import { makeCharge, makeTariff, type Charge, type MonthUsage, type SsegRule, type TariffSeason, type TouOrAll } from './types'

const c = (season: TariffSeason, tou: TouOrAll, cents: number, component: Charge['component'] = 'energy'): Charge =>
  makeCharge({ component, unit: 'c_per_kWh', amountExclVat: cents, season, tou })
const perDay = (component: Charge['component'], rand: number, demandBasis: Charge['demandBasis'] = null): Charge =>
  makeCharge({ component, unit: 'R_per_POD_day', amountExclVat: rand, demandBasis })

// Eskom 2025/26, xlsm `Homeflex NLA` row 11 (HF101N) and row 18; `Gen-offset` row 49 (GOHF101N).
const homeflex1 = makeTariff({ name: 'Homeflex 1 (HF101N)', code: 'HF101N', structure: 'tou', exportTariffCode: 'GOHF101N', charges: [
  c('high', 'peak', 706.97), c('high', 'standard', 216.31), c('high', 'off_peak', 159.26),
  c('low', 'peak', 329.28), c('low', 'standard', 204.9), c('low', 'off_peak', 159.26),
  perDay('service', 3.27),
  c('all', 'all', 0.41, 'ancillary'), c('all', 'all', 22.78, 'legacy'), c('all', 'all', 26.37, 'network_demand'),
  perDay('network_capacity', 12.13, 'nmd'), perDay('gcc', 0.72),
] })
const genOffsetHomeflex = makeTariff({ name: 'Gen-Offset Homeflex (GOHF101N)', code: 'GOHF101N', structure: 'tou', category: 'sseg', charges: [
  c('high', 'peak', 650.52, 'export_credit'), c('high', 'standard', 185.41, 'export_credit'), c('high', 'off_peak', 131.21, 'export_credit'),
  c('low', 'peak', 292.75, 'export_credit'), c('low', 'standard', 174.58, 'export_credit'), c('low', 'off_peak', 131.21, 'export_credit'),
] })
const eskomRule = netBillingRule('eskom')
const july = (importKwh: MonthUsage['importKwh'], exportKwh: MonthUsage['exportKwh']): MonthUsage =>
  ({ year: 2025, month: 7, days: 30, season: 'high', importKwh, exportKwh })

describe('golden case 10: Eskom Homeflex 1 + Gen-Offset Homeflex', () => {
  it('high season, import P100/S300/O200, export S150 -> R2,177.26', () => {
    const bill = costMonth(homeflex1, july({ peak: 100, standard: 300, off_peak: 200 }, { peak: 0, standard: 150, off_peak: 0 }),
      { exportTariff: genOffsetHomeflex, sseg: eskomRule })
    expect(bill.energyCharges).toBe(1674.42)
    const adders = bill.lines.filter((l) => l.kind === 'adder').reduce((a, l) => a + l.amount, 0)
    expect(adders).toBeCloseTo(297.36, 6)
    expect(bill.credit.earned).toBe(278.12)
    expect(bill.credit.used).toBe(278.12)
    expect(bill.totalExclVat).toBe(2177.26)
  })

  it('variant: export S400 is capped at the 300 kWh imported in standard -> credit R556.23', () => {
    const bill = costMonth(homeflex1, july({ peak: 100, standard: 300, off_peak: 200 }, { peak: 0, standard: 400, off_peak: 0 }),
      { exportTariff: genOffsetHomeflex, sseg: eskomRule })
    expect(bill.credit.creditedKwh).toEqual({ peak: 0, standard: 300, off_peak: 0 })
    expect(bill.credit.earned).toBe(556.23)
    expect(bill.totalExclVat).toBe(1899.15)
  })

  it('offsets active energy only: adders, fixed and capacity charges are never reduced', () => {
    const bill = costMonth(homeflex1, july({ peak: 100, standard: 300, off_peak: 200 }, { peak: 5000, standard: 5000, off_peak: 5000 }),
      { exportTariff: genOffsetHomeflex, sseg: { ...eskomRule, capRule: 'energy_charges' } })
    expect(bill.credit.used).toBe(1674.42)
    expect(bill.totalExclVat).toBe(780.96) // 297.36 + 98.10 + 363.90 + 21.60
    expect(bill.credit.carriedOut).toBeGreaterThan(0)
  })

  it('refuses net billing above the 1,000 kVA limit, with a warning', () => {
    const bill = costMonth(homeflex1, july({ peak: 100, standard: 300, off_peak: 200 }, { peak: 0, standard: 150, off_peak: 0 }),
      { exportTariff: genOffsetHomeflex, sseg: eskomRule, systemKva: 1200 })
    expect(bill.credit.earned).toBe(0)
    expect(bill.credit.warnings[0]).toMatch(/1000 kVA/)
  })
})

describe('carry-forward and the financial-year reset', () => {
  const flat = makeTariff({ name: 'flat with SSEG', structure: 'flat', charges: [
    makeCharge({ component: 'energy', unit: 'R_per_kWh', amountExclVat: 2 }),
    makeCharge({ component: 'basic', unit: 'R_per_month', amountExclVat: 100 }),
    makeCharge({ component: 'export_credit', unit: 'R_per_kWh', amountExclVat: 1 }),
  ] })
  const month = (m: number, imp: number, exp: number): MonthUsage =>
    ({ year: 2026, month: m, days: 30, season: 'low', importKwh: { peak: 0, standard: imp, off_peak: 0 }, exportKwh: { peak: 0, standard: exp, off_peak: 0 } })
  const municipalFlat: SsegRule = { ...netBillingRule('municipal', { touExport: false }), capRule: 'energy_charges' }

  it('carries excess credit forward, forfeits it at June (municipal FY end), starts July at zero', () => {
    const [may, jun, jul] = costPeriod(flat, [month(5, 100, 500), month(6, 100, 0), month(7, 100, 0)], { sseg: municipalFlat })
    expect(may.credit).toMatchObject({ earned: 500, used: 200, carriedOut: 300, forfeited: 0 })
    expect(may.totalExclVat).toBe(100)
    expect(jun.credit).toMatchObject({ carriedIn: 300, used: 200, carriedOut: 0, forfeited: 100 })
    expect(jun.totalExclVat).toBe(100)
    expect(jul.credit).toMatchObject({ carriedIn: 0, used: 0 })
    expect(jul.totalExclVat).toBe(300)
  })

  it('uses the Eskom year end (March) for Eskom', () => {
    const eskomFlat: SsegRule = { ...netBillingRule('eskom', { touExport: false }), capRule: 'energy_charges' }
    const [feb, mar, apr] = costPeriod(flat, [month(2, 100, 500), month(3, 100, 0), month(4, 100, 0)], { sseg: eskomFlat })
    expect(feb.credit.carriedOut).toBe(300)
    expect(mar.credit.forfeited).toBe(100)
    expect(apr.credit.carriedIn).toBe(0)
  })

  it('never pays credit as cash: the bill never falls below the non-energy charges', () => {
    const [m] = costPeriod(flat, [month(1, 100, 100000)], { sseg: municipalFlat })
    expect(m.totalExclVat).toBe(100)
  })

  it('caps flat crediting at imported kWh unless the rule says otherwise', () => {
    const capped = costMonth(flat, month(1, 100, 500), { sseg: netBillingRule('municipal', { touExport: false }) })
    expect(capped.credit.creditedTotalKwh).toBe(100)
    expect(capped.credit.earned).toBe(100)
  })

  it('forfeits every month when the rule carries nothing forward', () => {
    const [a, b] = costPeriod(flat, [month(1, 100, 500), month(2, 100, 0)], { sseg: { ...municipalFlat, carryForward: 'none' } })
    expect(a.credit.forfeited).toBe(300)
    expect(b.credit.carriedIn).toBe(0)
  })
})

describe('c/kWh vs R/kWh: the engine follows the stored unit and never guesses', () => {
  const blocks = (unit: 'c_per_kWh' | 'R_per_kWh', k: number) => makeTariff({ name: 'City Power 60A', structure: 'ibt', charges: [
    makeCharge({ component: 'energy', unit, amountExclVat: 227.28 * k, blockMinKwh: 0, blockMaxKwh: 500, blockBasis: 'monthly' }),
    makeCharge({ component: 'energy', unit, amountExclVat: 260.83 * k, blockMinKwh: 500, blockMaxKwh: null, blockBasis: 'monthly' }),
  ] })
  const u: MonthUsage = { year: 2025, month: 1, days: 30, season: 'low', importKwh: { peak: 0, standard: 800, off_peak: 0 } }

  it('costs 227.28 c/kWh and 2.2728 R/kWh identically', () => {
    expect(costMonth(blocks('c_per_kWh', 1), u).totalExclVat).toBe(1918.89)
    expect(costMonth(blocks('R_per_kWh', 0.01), u).totalExclVat).toBe(1918.89)
  })

  it('costs an unconverted 3.09 "c/kWh" at 100x low — and the validator blocks it', () => {
    const wrong = makeTariff({ name: 'Scale 1A (unconverted)', structure: 'flat', charges: [
      makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 3.09 }),
    ] })
    const bill = costMonth(wrong, { ...u, importKwh: { peak: 0, standard: 500, off_peak: 0 } })
    expect(bill.totalExclVat).toBe(15.45)
    expect(validateTariffYear([wrong]).map((i) => i.code)).toContain('energy_out_of_range')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/bill-engine.net-billing.test.ts`
Expected: FAIL — `Failed to resolve import "./net-billing-rules"` (and `./validators`, built in Task 7; that import keeps this file red until Task 7 — run it again at the end of Task 7).

- [ ] **Step 3: Implement the rules constructor**

`packages/shared/src/tariffs/net-billing-rules.ts`:
```ts
import { fyEndMonth, type TariffRegime } from './financial-year'
import type { SsegRule } from './types'

/**
 * NERSA Net-Billing Rules for licensed distributors (approved 17 Dec 2024),
 * pp7-12: monthly settlement, energy-only offset, no cash, carry forward within
 * the distributor's financial year, credited kWh capped per TOU period at
 * import, 1,000 kVA ceiling, bidirectional TOU meter. §5.4 allows a flat
 * (non-TOU) export tariff where a distributor cannot do TOU.
 */
export function netBillingRule(regime: TariffRegime, opts: { touExport?: boolean } = {}): SsegRule {
  const tou = opts.touExport ?? true
  return {
    crediting: tou ? 'net_billing_tou' : 'net_billing_flat',
    carryForward: 'within_financial_year',
    fyEndMonth: fyEndMonth(regime),
    capRule: 'kwh_per_tou_period',
    offsets: 'energy_only',
    forfeitOnOwnershipChange: true,
    maxKva: 1000,
    requiresTou: tou,
    requiresBidirectionalMeter: true,
    locator: { document: 'NERSA Net-Billing Rules for licensed distributors', approved: '2024-12-17', pages: '7-12' },
  }
}
```

- [ ] **Step 4: Commit (the test goes green in Task 7)**

```bash
git add packages/shared/src/tariffs/net-billing-rules.ts packages/shared/src/tariffs/bill-engine.net-billing.test.ts
git commit -m "test(tariffs): net-billing golden case 10, carry-forward, FY reset, unit confusion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Validators

**Files:**
- Create: `packages/shared/src/tariffs/validators.ts`
- Test: `packages/shared/src/tariffs/validators.test.ts`

Severity: `block` stops a publish (enforced by 2b's publish action; the DB also enforces empty-tariff and unreviewed-inference itself), `review` needs a reviewer's acknowledgement, `warn` is informational. YoY is `review`, not `block` — see open question Q3.

- [ ] **Step 1: Write the failing test**

`packages/shared/src/tariffs/validators.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { hasBlockingIssues, normaliseTariffName, validateTariff, validateTariffYear } from './validators'
import { makeCharge, makeTariff, type Charge } from './types'

const e = (p: Partial<Charge> = {}): Charge => makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 200, ...p })
const codes = (t: Parameters<typeof validateTariff>[0]) => validateTariff(t).map((i) => i.code)

describe('validateTariff', () => {
  it('blocks an empty tariff and a non-numeric amount', () => {
    expect(codes(makeTariff({ name: 'x', structure: 'flat', charges: [] }))).toContain('empty_tariff')
    expect(codes(makeTariff({ name: 'x', structure: 'flat', charges: [e({ amountExclVat: Number.NaN })] }))).toContain('non_numeric')
  })

  it('blocks a TOU tariff missing a period (the old seed dropped Standard)', () => {
    const t = makeTariff({ name: 'tou', structure: 'tou', charges: [
      e({ season: 'low', tou: 'peak' }), e({ season: 'low', tou: 'off_peak' }),
      e({ season: 'high', tou: 'peak' }), e({ season: 'high', tou: 'standard' }), e({ season: 'high', tou: 'off_peak' }),
    ] })
    const issue = validateTariff(t).find((i) => i.code === 'tou_incomplete')
    expect(issue?.message).toMatch(/low standard/)
  })

  it('accepts three all-season TOU values', () => {
    const t = makeTariff({ name: 'tou', structure: 'tou', charges: [e({ tou: 'peak' }), e({ tou: 'standard' }), e({ tou: 'off_peak' })] })
    expect(codes(t)).not.toContain('tou_incomplete')
  })

  it('blocks non-contiguous inclining blocks and a bounded top block', () => {
    const gap = makeTariff({ name: 'ibt', structure: 'ibt', charges: [
      e({ blockMinKwh: 0, blockMaxKwh: 50, blockBasis: 'monthly' }), e({ blockMinKwh: 2000, blockMaxKwh: null, blockBasis: 'monthly' }),
    ] })
    expect(codes(gap)).toContain('ibt_gap')
    const bounded = makeTariff({ name: 'ibt', structure: 'ibt', charges: [e({ blockMinKwh: 0, blockMaxKwh: 50, blockBasis: 'monthly' })] })
    expect(codes(bounded)).toContain('ibt_gap')
    const ok = makeTariff({ name: 'ibt', structure: 'ibt', charges: [
      e({ blockMinKwh: 0, blockMaxKwh: 500, blockBasis: 'monthly' }), e({ blockMinKwh: 500, blockMaxKwh: null, blockBasis: 'monthly' }),
    ] })
    expect(codes(ok)).not.toContain('ibt_gap')
  })

  it('blocks an energy rate outside 50-1500 c/kWh but allows a free first block', () => {
    expect(codes(makeTariff({ name: 'x', structure: 'flat', charges: [e({ amountExclVat: 3.09 })] }))).toContain('energy_out_of_range')
    expect(codes(makeTariff({ name: 'x', structure: 'flat', charges: [e({ unit: 'R_per_kWh', amountExclVat: 3.09 })] }))).not.toContain('energy_out_of_range')
    expect(codes(makeTariff({ name: 'x', structure: 'flat', charges: [e({ amountExclVat: 0 })] }))).not.toContain('energy_out_of_range')
  })

  it('blocks a fixed charge in a non-fixed unit', () => {
    const t = makeTariff({ name: 'x', structure: 'flat', charges: [makeCharge({ component: 'basic', unit: 'c_per_kWh', amountExclVat: 100 })] })
    expect(codes(t)).toContain('fixed_unit')
  })

  it('warns when a basic charge equals an energy rate (NMB Small Business Prepaid 334.12)', () => {
    const t = makeTariff({ name: 'NMB', structure: 'flat', charges: [
      makeCharge({ component: 'basic', unit: 'R_per_month', amountExclVat: 334.12 }), e({ amountExclVat: 334.12 }),
    ] })
    const dup = validateTariff(t).find((i) => i.code === 'duplicate_value')
    expect(dup?.severity).toBe('warn')
  })

  it('asks for review of an inferred unit until it is reviewed', () => {
    const inferred = e({ unit: 'R_per_kWh', amountExclVat: 3.09, unitInferred: true, inferenceReason: 'magnitude' })
    expect(codes(makeTariff({ name: 'x', structure: 'flat', charges: [inferred] }))).toContain('inferred_unit')
    expect(codes(makeTariff({ name: 'x', structure: 'flat', charges: [{ ...inferred, reviewedAt: '2026-09-28' }] }))).not.toContain('inferred_unit')
  })

  it('checks Eskom excl/incl pairs at x1.15 within 2 cents', () => {
    const good = e({ amountExclVat: 706.97, sourceLocator: { raw_incl: 813.02 } })
    const bad = e({ amountExclVat: 706.97, sourceLocator: { raw_incl: 800 } })
    expect(codes(makeTariff({ name: 'x', structure: 'flat', charges: [good] }))).not.toContain('vat_pair')
    expect(codes(makeTariff({ name: 'x', structure: 'flat', charges: [bad] }))).toContain('vat_pair')
  })
})

describe('validateTariffYear', () => {
  it('blocks two tariffs whose names normalise to the same thing', () => {
    const a = makeTariff({ name: 'Domestic  Prepaid', structure: 'flat', charges: [e()] })
    const b = makeTariff({ name: 'DOMESTIC PREPAID [row 12]', structure: 'flat', charges: [e()] })
    const issues = validateTariffYear([a, b])
    expect(issues.map((i) => i.code)).toContain('duplicate_name')
    expect(hasBlockingIssues(issues)).toBe(true)
    expect(normaliseTariffName('Domestic - Prepaid [row 7]')).toBe('DOMESTIC PREPAID')
  })
  it('passes a clean year', () => {
    expect(hasBlockingIssues(validateTariffYear([makeTariff({ name: 'ok', structure: 'flat', charges: [e()] })]))).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/validators.test.ts`
Expected: FAIL — `Failed to resolve import "./validators"`.

- [ ] **Step 3: Implement**

`packages/shared/src/tariffs/validators.ts`:
```ts
/**
 * Automatic checks (as-is/09 §7.1 Stage D). They run on ingest (recorded in
 * ingest_run.stats) and again on publish (2b). The database itself enforces
 * the two that must never be bypassed: every tariff has a charge, and every
 * inferred unit is reviewed before publish.
 */
import { roundCents } from './money'
import { ENERGY_CENTS_RANGE, randPerKwh, unitClass } from './units'
import { TOU_PERIODS, type SourceLocator, type Tariff, type TariffSeason, type TariffUnit } from './types'

export type TariffIssueSeverity = 'block' | 'review' | 'warn'

export type TariffIssueCode =
  | 'empty_tariff' | 'non_numeric' | 'tou_incomplete' | 'ibt_gap' | 'energy_out_of_range'
  | 'fixed_unit' | 'duplicate_name' | 'duplicate_value' | 'inferred_unit' | 'vat_pair'
  | 'yoy_out_of_band' | 'yoy_unit_changed' | 'legacy_tariff_skipped' | 'unit_unknown'
  | 'orphan_charge' | 'block_unit_typo' | 'sseg_semantics_unknown' | 'eskom_shared_energy_row'
  | 'eskom_duplicate_column' | 'rfd_row_increase_mismatch' | 'increase_missing' | 'sheet_skipped'

export interface TariffIssue {
  code: TariffIssueCode
  severity: TariffIssueSeverity
  message: string
  tariff?: string
  chargeIndex?: number
  locator?: SourceLocator
}

const FIXED_UNITS: ReadonlySet<TariffUnit> = new Set<TariffUnit>(['R_per_month', 'R_per_day', 'R_per_POD_day'])

export function normaliseTariffName(name: string): string {
  return name
    .replace(/\s*\[row \d+\]$/i, '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

export function validateTariff(t: Tariff): TariffIssue[] {
  const out: TariffIssue[] = []
  const flag = (code: TariffIssueCode, severity: TariffIssueSeverity, message: string, chargeIndex?: number): void => {
    out.push({
      code, severity, message, tariff: t.name, chargeIndex,
      locator: chargeIndex === undefined ? t.sourceLocator : t.charges[chargeIndex]?.sourceLocator,
    })
  }

  if (t.charges.length === 0) flag('empty_tariff', 'block', 'tariff has no charges')

  const energyAmounts = new Set(t.charges.filter((c) => c.component === 'energy').map((c) => c.amountExclVat))
  t.charges.forEach((c, i) => {
    if (!Number.isFinite(c.amountExclVat)) {
      flag('non_numeric', 'block', `amount is not a number: ${String(c.amountExclVat)}`, i)
      return
    }
    if ((c.component === 'energy' || c.component === 'export_credit') && unitClass(c.unit) === 'per_kwh' && c.amountExclVat !== 0) {
      const cents = roundCents(randPerKwh(c) * 100)
      if (cents < ENERGY_CENTS_RANGE.min || cents > ENERGY_CENTS_RANGE.max) {
        flag('energy_out_of_range', 'block', `${cents} c/kWh is outside ${ENERGY_CENTS_RANGE.min}-${ENERGY_CENTS_RANGE.max} c/kWh`, i)
      }
    }
    if ((c.component === 'basic' || c.component === 'service' || c.component === 'admin') && !FIXED_UNITS.has(c.unit)) {
      flag('fixed_unit', 'block', `${c.component} charge in ${c.unit}; fixed charges are R/month, R/day or R/POD/day`, i)
    }
    if ((c.component === 'basic' || c.component === 'service') && c.amountExclVat !== 0 && energyAmounts.has(c.amountExclVat)) {
      flag('duplicate_value', 'warn', `${c.component} ${c.amountExclVat} equals an energy rate in the same tariff: likely a copy error in the source`, i)
    }
    if (c.unitInferred && !c.reviewedAt) {
      flag('inferred_unit', 'review', `unit inferred (${c.inferenceReason ?? 'no reason recorded'}): needs review`, i)
    }
    if (c.sourceLocator.raw_incl !== undefined) {
      const expected = roundCents(c.amountExclVat * (1 + c.vatRate))
      if (Math.abs(expected - c.sourceLocator.raw_incl) > 0.02) {
        flag('vat_pair', 'block', `incl ${c.sourceLocator.raw_incl} does not equal excl ${c.amountExclVat} x ${1 + c.vatRate} = ${expected}`, i)
      }
    }
  })

  const touEnergy = t.charges.filter((c) => c.component === 'energy' && c.tou !== 'all')
  if (touEnergy.length > 0 || t.structure === 'tou' || t.structure === 'tou_ibt') {
    const have = new Set(touEnergy.map((c) => `${c.season}|${c.tou}`))
    const seasons: TariffSeason[] = touEnergy.length > 0 && touEnergy.every((c) => c.season === 'all') ? ['all'] : ['high', 'low']
    const missing = seasons.flatMap((s) => TOU_PERIODS.filter((p) => !have.has(`${s}|${p}`)).map((p) => `${s} ${p}`))
    if (missing.length > 0) flag('tou_incomplete', 'block', `TOU energy rates missing: ${missing.join(', ')}`)
  }

  const blocked = t.charges.filter((c) => c.component === 'energy' && c.blockMinKwh !== null)
  for (const s of new Set(blocked.map((c) => c.season))) {
    const bs = blocked.filter((c) => c.season === s).sort((a, b) => (a.blockMinKwh as number) - (b.blockMinKwh as number))
    const problems: string[] = []
    if (bs[0].blockMinKwh !== 0) problems.push(`first block starts at ${bs[0].blockMinKwh}`)
    for (let k = 1; k < bs.length; k++) {
      if (bs[k].blockMinKwh !== bs[k - 1].blockMaxKwh) problems.push(`${bs[k - 1].blockMaxKwh ?? 'unbounded'} then ${bs[k].blockMinKwh}`)
    }
    const top = bs[bs.length - 1]
    if (top.blockMaxKwh !== null) problems.push(`top block ends at ${top.blockMaxKwh}`)
    if (problems.length > 0) flag('ibt_gap', 'block', `inclining blocks (${s}) are not contiguous: ${problems.join('; ')}`)
  }
  return out
}

export function validateTariffYear(tariffs: readonly Tariff[]): TariffIssue[] {
  const out = tariffs.flatMap(validateTariff)
  const seen = new Map<string, string>()
  for (const t of tariffs) {
    const key = normaliseTariffName(t.name)
    const first = seen.get(key)
    if (first !== undefined) {
      out.push({ code: 'duplicate_name', severity: 'block', message: `"${t.name}" duplicates "${first}"`, tariff: t.name, locator: t.sourceLocator })
    } else {
      seen.set(key, t.name)
    }
  }
  return out
}

export function hasBlockingIssues(issues: readonly TariffIssue[]): boolean {
  return issues.some((i) => i.severity === 'block')
}
```

- [ ] **Step 4: Run both tests to verify they pass**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/validators.test.ts src/tariffs/bill-engine.net-billing.test.ts`
Expected: PASS — validators 11 tests, net billing 11 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/tariffs/validators.ts packages/shared/src/tariffs/validators.test.ts
git commit -m "feat(tariffs): tariff validators (TOU completeness, IBT contiguity, ranges, VAT pairs)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Year-on-year diff

**Files:**
- Create: `packages/shared/src/tariffs/yoy.ts`
- Test: `packages/shared/src/tariffs/yoy.test.ts`

Charges match on (normalised tariff name, component, season, TOU, block start). Per-kWh values compare in rand, so a c/kWh ↔ R/kWh relabel is not a 100× "increase". Unchanged values are counted, not flagged (explicitly frozen fixed charges are common: City Power 2026/27 kept its 60A service and capacity charges at 0%).

- [ ] **Step 1: Write the failing test**

`packages/shared/src/tariffs/yoy.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { diffTariffYears } from './yoy'
import { makeCharge, makeTariff, type TariffUnit } from './types'

const t60a = (block1: number, unit: TariffUnit = 'c_per_kWh', service = 235.79) => makeTariff({
  name: 'Residential Single Phase 60A', structure: 'ibt', charges: [
    makeCharge({ component: 'energy', unit, amountExclVat: block1, blockMinKwh: 0, blockMaxKwh: 500, blockBasis: 'monthly' }),
    makeCharge({ component: 'service', unit: 'R_per_month', amountExclVat: service }),
  ],
})

describe('diffTariffYears', () => {
  it('passes an increase inside +-3pp of the approved increase', () => {
    const d = diffTariffYears([t60a(227.28)], [t60a(247.76)], 9.01)
    expect(d.changed).toHaveLength(1)
    expect(d.changed[0].changePct).toBeCloseTo(9.011, 3)
    expect(d.unchanged).toBe(1)
    expect(d.issues).toEqual([])
  })
  it('flags an increase outside the band for review', () => {
    const d = diffTariffYears([t60a(227.28)], [t60a(288.27)], 9.01)
    expect(d.issues).toHaveLength(1)
    expect(d.issues[0]).toMatchObject({ code: 'yoy_out_of_band', severity: 'review' })
  })
  it('compares per-kWh values in rand across a c/kWh <-> R/kWh relabel', () => {
    const d = diffTariffYears([t60a(2.2728, 'R_per_kWh')], [t60a(247.76, 'c_per_kWh')], 9.01)
    expect(d.changed[0].changePct).toBeCloseTo(9.011, 3)
    expect(d.issues).toEqual([])
  })
  it('lists added and removed charges', () => {
    const next = makeTariff({ name: 'Brand New', structure: 'flat', charges: [makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 300 })] })
    const d = diffTariffYears([t60a(227.28)], [next], null)
    expect(d.added).toEqual(['BRAND NEW|energy|all|all|-'])
    expect(d.removed).toHaveLength(2)
  })
  it('flags a non-energy unit change instead of computing a percentage', () => {
    const prev = makeTariff({ name: 'x', structure: 'flat', charges: [makeCharge({ component: 'basic', unit: 'R_per_month', amountExclVat: 100 })] })
    const next = makeTariff({ name: 'x', structure: 'flat', charges: [makeCharge({ component: 'basic', unit: 'R_per_day', amountExclVat: 3.5 })] })
    const d = diffTariffYears([prev], [next], 9.01)
    expect(d.changed[0].changePct).toBeNull()
    expect(d.issues[0].code).toBe('yoy_unit_changed')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/yoy.test.ts`
Expected: FAIL — `Failed to resolve import "./yoy"`.

- [ ] **Step 3: Implement**

`packages/shared/src/tariffs/yoy.ts`:
```ts
import { randPerKwh, unitClass } from './units'
import { normaliseTariffName, type TariffIssue } from './validators'
import type { Charge, ChargeComponent, Tariff, TariffUnit } from './types'

export interface YoyChange {
  key: string
  tariff: string
  component: ChargeComponent
  prev: number
  next: number
  unit: TariffUnit
  /** Percent, 3 dp; null when the previous value was zero or the unit changed. */
  changePct: number | null
}

export interface YoyDiff {
  added: string[]
  removed: string[]
  changed: YoyChange[]
  unchanged: number
  issues: TariffIssue[]
}

export function chargeKey(t: Tariff, c: Charge): string {
  return [normaliseTariffName(t.name), c.component, c.season, c.tou, c.blockMinKwh ?? '-'].join('|')
}

function comparable(c: Charge): { value: number; unit: TariffUnit } {
  return unitClass(c.unit) === 'per_kwh' ? { value: randPerKwh(c), unit: 'R_per_kWh' } : { value: c.amountExclVat, unit: c.unit }
}

export function diffTariffYears(
  prev: readonly Tariff[], next: readonly Tariff[], approvedIncreasePct: number | null, tolerancePp = 3,
): YoyDiff {
  const index = (ts: readonly Tariff[]): Map<string, { t: Tariff; c: Charge }> => {
    const m = new Map<string, { t: Tariff; c: Charge }>()
    for (const t of ts) for (const c of t.charges) m.set(chargeKey(t, c), { t, c })
    return m
  }
  const a = index(prev)
  const b = index(next)
  const res: YoyDiff = { added: [], removed: [], changed: [], unchanged: 0, issues: [] }

  for (const [key, { t, c }] of b) {
    const old = a.get(key)
    if (!old) {
      res.added.push(key)
      continue
    }
    const p = comparable(old.c)
    const n = comparable(c)
    if (p.unit !== n.unit) {
      res.changed.push({ key, tariff: t.name, component: c.component, prev: p.value, next: n.value, unit: n.unit, changePct: null })
      res.issues.push({ code: 'yoy_unit_changed', severity: 'review', message: `${key}: unit changed ${p.unit} -> ${n.unit}`, tariff: t.name, locator: c.sourceLocator })
      continue
    }
    if (p.value === n.value) {
      res.unchanged++
      continue
    }
    const changePct = p.value === 0 ? null : Math.round((n.value / p.value - 1) * 100 * 1000) / 1000
    res.changed.push({ key, tariff: t.name, component: c.component, prev: p.value, next: n.value, unit: n.unit, changePct })
    if (approvedIncreasePct !== null && changePct !== null && Math.abs(changePct - approvedIncreasePct) > tolerancePp) {
      res.issues.push({
        code: 'yoy_out_of_band', severity: 'review',
        message: `${t.name} ${c.component}: ${changePct}% against an approved ${approvedIncreasePct}% (+-${tolerancePp}pp)`,
        tariff: t.name, locator: c.sourceLocator,
      })
    }
  }
  for (const key of a.keys()) if (!b.has(key)) res.removed.push(key)
  return res
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/yoy.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/tariffs/yoy.ts packages/shared/src/tariffs/yoy.test.ts
git commit -m "feat(tariffs): year-on-year charge diff with the +-3pp review band

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Barrel and shared export

**Files:**
- Create: `packages/shared/src/tariffs/index.ts`
- Modify: `packages/shared/src/index.ts` (append after the `./solar` export)

- [ ] **Step 1: Write the barrel**

`packages/shared/src/tariffs/index.ts`:
```ts
// Tariff library core (Solar Phase 2a). Pure: no I/O, no node:*, no exceljs.
// Parsers and ingestion live under ./parsers and ./ingest and are imported by
// path, not through this barrel.
export * from './types'
export * from './money'
export * from './financial-year'
export * from './units'
export * from './tou'
export * from './net-billing-rules'
export * from './bill-engine'
export * from './validators'
export * from './yoy'
```

- [ ] **Step 2: Export it from the package root**

Append to `packages/shared/src/index.ts`, directly below `export * from './solar'`:
```ts

// Tariff library core — canonical tariff model, validators, YoY diff and the
// bill engine (docs/solar/02 §5, 03 §4). Pure; safe from the barrel.
export * from './tariffs'
```

- [ ] **Step 3: Type-check and run the shared suite**

```bash
pnpm --filter @esite/shared type-check
pnpm --filter @esite/shared test 2>&1 | tail -4
```
Expected: `tsc --noEmit` exits 0 (a "has already exported a member named" error means a name collides with an existing export — rename the tariff-side symbol, never the existing one); tests pass, count = baseline + the new tariff tests.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/tariffs/index.ts packages/shared/src/index.ts
git commit -m "feat(tariffs): export the tariff core from @esite/shared

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Behavioural assertions, written first (RED)

**Files:**
- Create: `scripts/db/assert-tariffs-schema-roles.sql`

- [ ] **Step 1: Write the assertion file**

`scripts/db/assert-tariffs-schema-roles.sql`:
```sql
-- BEHAVIOURAL assertions for 00210_tariffs_schema, run as real roles.
--   While 00208 is not in the production ledger, dry-run the pair:
--     cat apps/edge-functions/supabase/migrations/00208_solar_foundation.sql \
--         apps/edge-functions/supabase/migrations/00210_tariffs_schema.sql > "$S/combo.sql"
--     scripts/db/dry-run-migration.sh "$S/combo.sql" scripts/db/assert-tariffs-schema-roles.sql      (GREEN)
--   RED first: 00208 alone (no tariffs schema: the file aborts).
-- Fixtures are minted inside the transaction and rolled back. The platform
-- tariff admin is a throwaway user made an active admin of WM-Consulting
-- inside the transaction; no real WM member is impersonated.
--
-- REFUSAL PATTERN (as assert-solar-foundation-roles.sql): a "…_REFUSED" check
-- catches ONLY the SQLSTATE the design promises; a wrongly-allowed statement
-- raises P0001 itself so its subtransaction rolls back and later checks stay
-- honest; any other error records false.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  c_wm     CONSTANT UUID := 'dddddddd-0000-0000-0000-000000000001';
  v_org    UUID := gen_random_uuid();   -- subscribed customer org
  v_org2   UUID := gen_random_uuid();   -- unsubscribed org
  v_admin  UUID := gen_random_uuid();   -- active WM-Consulting admin = platform tariff admin
  v_wmcon  UUID := gen_random_uuid();   -- active WM-Consulting contractor (reads via the WM bypass, never writes)
  v_wmdead UUID := gen_random_uuid();   -- WM-Consulting admin, DEACTIVATED
  v_sub    UUID := gen_random_uuid();   -- contractor in the subscribed org
  v_unsub  UUID := gen_random_uuid();   -- admin of the unsubscribed org
  v_lic    UUID;
  v_y21 UUID; v_y22 UUID; v_y23 UUID; v_y24 UUID; v_y25 UUID; v_y26 UUID; v_y27 UUID;
  v_t21 UUID; v_t22 UUID; v_t24 UUID; v_t25 UUID; v_t26 UUID; v_t27 UUID;
  v_c25b   UUID;
  v_c27    UUID;
  v_n      INT;
  v_n2     INT;
  v_state  TEXT;
  u        UUID;
BEGIN
  -- ── Fixtures (as postgres) ────────────────────────────────────────────────
  INSERT INTO public.organisations (id, name) VALUES (v_org, 'tariffs-probe-org'), (v_org2, 'tariffs-probe-org-2');
  FOREACH u IN ARRAY ARRAY[v_admin, v_wmcon, v_wmdead, v_sub, v_unsub] LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'tariffs-probe-' || u || '@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  END LOOP;
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
    (v_admin, c_wm, 'admin', TRUE), (v_wmcon, c_wm, 'contractor', TRUE), (v_wmdead, c_wm, 'admin', FALSE),
    (v_sub, v_org, 'contractor', TRUE), (v_unsub, v_org2, 'admin', TRUE);
  INSERT INTO billing.org_addon_subscriptions (organisation_id, feature_key, status, amount_kobo, current_period_end)
  VALUES (v_org, 'solar', 'active', 199900, now() + interval '1 year');
  INSERT INTO tariffs.ingest_run (parser, status) VALUES ('province_xlsx', 'succeeded');

  -- ── 1. The platform tariff admin writes, reviews and publishes ────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('admin_is_platform_tariff_admin', public.is_platform_tariff_admin());
  INSERT INTO tariffs.licensee (kind, name, province) VALUES ('municipal', 'TARIFFS PROBE MUNICIPALITY', 'GP') RETURNING id INTO v_lic;
  INSERT INTO tariffs.licensee_alias (alias, licensee_id) VALUES ('TARIFFS PROBE MUNI', v_lic);

  INSERT INTO tariffs.tariff_year (licensee_id, financial_year, effective_from, effective_to, approved_increase_pct)
  VALUES (v_lic, '2025/26', '2025-07-01', '2026-06-30', 12.72) RETURNING id INTO v_y25;
  INSERT INTO tariffs.tariff (tariff_year_id, name, category, metering, structure)
  VALUES (v_y25, 'Probe Domestic', 'domestic', 'conventional', 'flat') RETURNING id INTO v_t25;
  INSERT INTO tariffs.charge (tariff_id, component, unit, amount_excl_vat, vat_basis, extraction_method)
  VALUES (v_t25, 'energy', 'c_per_kWh', 250, 'assumed_excl', 'parser');
  INSERT INTO tariffs.charge (tariff_id, component, unit, amount_excl_vat, vat_basis, extraction_method, unit_inferred, inference_reason)
  VALUES (v_t25, 'basic', 'R_per_month', 100, 'assumed_excl', 'parser', true, 'fixed charge without a unit: assumed R/month')
  RETURNING id INTO v_c25b;
  UPDATE tariffs.tariff_year SET state = 'in_review' WHERE id = v_y25;

  BEGIN
    UPDATE tariffs.tariff_year SET state = 'published' WHERE id = v_y25;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('publish_with_unreviewed_inference_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('publish_with_unreviewed_inference_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('publish_with_unreviewed_inference_REFUSED', false);
  END;

  -- the review stamp is the caller and now, whatever was sent
  UPDATE tariffs.charge SET reviewed_at = '2000-01-01', reviewed_by = v_sub WHERE id = v_c25b;
  SELECT count(*) INTO v_n FROM tariffs.charge WHERE id = v_c25b AND reviewed_by = v_admin AND reviewed_at > '2001-01-01';
  INSERT INTO _r VALUES ('review_stamp_bound_to_caller', v_n = 1);

  -- publish; the stamp is the caller, not the forged published_by
  UPDATE tariffs.tariff_year SET state = 'published', published_by = v_sub WHERE id = v_y25;
  SELECT count(*) INTO v_n FROM tariffs.tariff_year
   WHERE id = v_y25 AND state = 'published' AND published_by = v_admin AND published_at IS NOT NULL;
  INSERT INTO _r VALUES ('admin_publishes_with_bound_stamp', v_n = 1);

  -- published data is immutable, even for the admin
  BEGIN
    UPDATE tariffs.charge SET amount_excl_vat = 1 WHERE tariff_id = v_t25;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('published_charge_update_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('published_charge_update_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('published_charge_update_REFUSED', false);
  END;
  BEGIN
    DELETE FROM tariffs.charge WHERE tariff_id = v_t25;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('published_charge_delete_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('published_charge_delete_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('published_charge_delete_REFUSED', false);
  END;
  BEGIN
    INSERT INTO tariffs.charge (tariff_id, component, unit, amount_excl_vat, vat_basis, extraction_method)
    VALUES (v_t25, 'service', 'R_per_month', 5, 'assumed_excl', 'manual');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('published_charge_insert_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('published_charge_insert_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('published_charge_insert_REFUSED', false);
  END;
  BEGIN
    UPDATE tariffs.tariff SET name = 'Renamed' WHERE id = v_t25;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('published_tariff_update_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('published_tariff_update_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('published_tariff_update_REFUSED', false);
  END;
  BEGIN
    UPDATE tariffs.tariff_year SET approved_increase_pct = 1 WHERE id = v_y25;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('published_year_update_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('published_year_update_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('published_year_update_REFUSED', false);
  END;
  BEGIN
    DELETE FROM tariffs.tariff_year WHERE id = v_y25;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('published_year_delete_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('published_year_delete_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('published_year_delete_REFUSED', false);
  END;
  BEGIN
    UPDATE tariffs.tariff_year SET state = 'in_review' WHERE id = v_y25;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('published_to_in_review_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('published_to_in_review_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('published_to_in_review_REFUSED', false);
  END;
  BEGIN
    INSERT INTO tariffs.tariff_year (licensee_id, financial_year, effective_from, effective_to, state)
    VALUES (v_lic, '2019/20', '2019-07-01', '2020-06-30', 'published');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('insert_as_published_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('insert_as_published_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('insert_as_published_REFUSED', false);
  END;

  -- an empty year cannot publish
  INSERT INTO tariffs.tariff_year (licensee_id, financial_year, effective_from, effective_to, state)
  VALUES (v_lic, '2023/24', '2023-07-01', '2024-06-30', 'in_review') RETURNING id INTO v_y23;
  BEGIN
    UPDATE tariffs.tariff_year SET state = 'published' WHERE id = v_y23;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('publish_empty_year_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('publish_empty_year_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('publish_empty_year_REFUSED', false);
  END;

  -- a tariff with no charge blocks a publish
  INSERT INTO tariffs.tariff_year (licensee_id, financial_year, effective_from, effective_to, state)
  VALUES (v_lic, '2020/21', '2020-07-01', '2021-06-30', 'in_review') RETURNING id INTO v_y21;
  INSERT INTO tariffs.tariff (tariff_year_id, name, structure) VALUES (v_y21, 'Chargeless', 'flat') RETURNING id INTO v_t21;
  BEGIN
    UPDATE tariffs.tariff_year SET state = 'published' WHERE id = v_y21;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('publish_tariff_without_charge_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('publish_tariff_without_charge_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('publish_tariff_without_charge_REFUSED', false);
  END;

  -- ingesting cannot jump straight to published
  INSERT INTO tariffs.tariff_year (licensee_id, financial_year, effective_from, effective_to)
  VALUES (v_lic, '2022/23', '2022-07-01', '2023-06-30') RETURNING id INTO v_y22;
  INSERT INTO tariffs.tariff (tariff_year_id, name, structure) VALUES (v_y22, 'Probe 22', 'flat') RETURNING id INTO v_t22;
  INSERT INTO tariffs.charge (tariff_id, component, unit, amount_excl_vat, vat_basis, extraction_method)
  VALUES (v_t22, 'energy', 'c_per_kWh', 200, 'assumed_excl', 'parser');
  BEGIN
    UPDATE tariffs.tariff_year SET state = 'published' WHERE id = v_y22;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('ingesting_to_published_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('ingesting_to_published_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('ingesting_to_published_REFUSED', false);
  END;

  -- publishing 2026/27 supersedes 2025/26
  INSERT INTO tariffs.tariff_year (licensee_id, financial_year, effective_from, effective_to, state, approved_increase_pct)
  VALUES (v_lic, '2026/27', '2026-07-01', '2027-06-30', 'in_review', 9.01) RETURNING id INTO v_y26;
  INSERT INTO tariffs.tariff (tariff_year_id, name, structure) VALUES (v_y26, 'Probe Domestic', 'flat') RETURNING id INTO v_t26;
  INSERT INTO tariffs.charge (tariff_id, component, unit, amount_excl_vat, vat_basis, extraction_method)
  VALUES (v_t26, 'energy', 'c_per_kWh', 272.53, 'assumed_excl', 'parser');
  UPDATE tariffs.tariff_year SET state = 'published' WHERE id = v_y26;
  SELECT state INTO v_state FROM tariffs.tariff_year WHERE id = v_y25;
  INSERT INTO _r VALUES ('publish_supersedes_prior_year', v_state = 'superseded');
  SELECT count(*) INTO v_n FROM tariffs.tariff_year WHERE licensee_id = v_lic AND state = 'published';
  INSERT INTO _r VALUES ('one_published_year_per_licensee', v_n = 1);
  BEGIN
    UPDATE tariffs.tariff_year SET state = 'published' WHERE id = v_y25;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('superseded_to_published_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('superseded_to_published_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('superseded_to_published_REFUSED', false);
  END;

  -- a back-filled OLDER year arrives as history and leaves the newer one current
  INSERT INTO tariffs.tariff_year (licensee_id, financial_year, effective_from, effective_to, state)
  VALUES (v_lic, '2024/25', '2024-07-01', '2025-06-30', 'in_review') RETURNING id INTO v_y24;
  INSERT INTO tariffs.tariff (tariff_year_id, name, structure) VALUES (v_y24, 'Probe Domestic', 'flat') RETURNING id INTO v_t24;
  INSERT INTO tariffs.charge (tariff_id, component, unit, amount_excl_vat, vat_basis, extraction_method)
  VALUES (v_t24, 'energy', 'c_per_kWh', 221.8, 'assumed_excl', 'parser');
  UPDATE tariffs.tariff_year SET state = 'published' WHERE id = v_y24;
  SELECT state INTO v_state FROM tariffs.tariff_year WHERE id = v_y24;
  INSERT INTO _r VALUES ('backfilled_older_year_lands_superseded', v_state = 'superseded');
  SELECT state INTO v_state FROM tariffs.tariff_year WHERE id = v_y26;
  INSERT INTO _r VALUES ('newer_year_stays_published', v_state = 'published');

  -- a draft year for the visibility checks; a changed fact loses its review stamp
  INSERT INTO tariffs.tariff_year (licensee_id, financial_year, effective_from, effective_to, state)
  VALUES (v_lic, '2027/28', '2027-07-01', '2028-06-30', 'in_review') RETURNING id INTO v_y27;
  INSERT INTO tariffs.tariff (tariff_year_id, name, structure) VALUES (v_y27, 'Probe Draft', 'flat') RETURNING id INTO v_t27;
  INSERT INTO tariffs.charge (tariff_id, component, unit, amount_excl_vat, vat_basis, extraction_method)
  VALUES (v_t27, 'energy', 'c_per_kWh', 290, 'assumed_excl', 'parser') RETURNING id INTO v_c27;
  UPDATE tariffs.charge SET reviewed_at = now() WHERE id = v_c27;
  UPDATE tariffs.charge SET amount_excl_vat = 300 WHERE id = v_c27;
  SELECT count(*) INTO v_n FROM tariffs.charge WHERE id = v_c27 AND reviewed_at IS NULL AND reviewed_by IS NULL;
  INSERT INTO _r VALUES ('review_stamp_cleared_when_fact_changes', v_n = 1);

  -- shape constraints
  BEGIN
    INSERT INTO tariffs.charge (tariff_id, component, unit, amount_excl_vat, vat_basis, extraction_method)
    VALUES (v_t27, 'energy', 'c/kWh', 1, 'assumed_excl', 'parser');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('unknown_unit_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('unknown_unit_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('unknown_unit_REFUSED', false);
  END;
  BEGIN
    INSERT INTO tariffs.charge (tariff_id, component, unit, amount_excl_vat, vat_basis, extraction_method, unit_inferred)
    VALUES (v_t27, 'energy', 'R_per_kWh', 3.09, 'assumed_excl', 'parser', true);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('inferred_without_reason_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('inferred_without_reason_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('inferred_without_reason_REFUSED', false);
  END;
  BEGIN
    INSERT INTO tariffs.charge (tariff_id, component, unit, amount_excl_vat, vat_basis, extraction_method, block_min_kwh, block_max_kwh, block_basis)
    VALUES (v_t27, 'energy', 'c_per_kWh', 200, 'assumed_excl', 'parser', 500, 100, 'monthly');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('inverted_block_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('inverted_block_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('inverted_block_REFUSED', false);
  END;
  BEGIN
    INSERT INTO tariffs.licensee_alias (alias, licensee_id) VALUES ('CITY OF CAPE ', v_lic);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('unnormalised_alias_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('unnormalised_alias_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('unnormalised_alias_REFUSED', false);
  END;
  BEGIN
    INSERT INTO tariffs.tariff_year (licensee_id, financial_year, effective_from, effective_to)
    VALUES (v_lic, '2026/28', '2026-07-01', '2028-06-30');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('bad_financial_year_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('bad_financial_year_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('bad_financial_year_REFUSED', false);
  END;
  SELECT count(*) INTO v_n FROM tariffs.ingest_run;
  INSERT INTO _r VALUES ('admin_reads_ingest_runs', v_n >= 1);
  RESET ROLE;

  -- ── 2. A subscriber reads published data only, and writes nothing ─────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sub::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('sub_is_not_admin', NOT public.is_platform_tariff_admin());
  INSERT INTO _r VALUES ('sub_has_a_solar_org', public.caller_has_any_solar_org());
  SELECT count(*) INTO v_n FROM tariffs.licensee WHERE id = v_lic;
  INSERT INTO _r VALUES ('sub_reads_licensees', v_n = 1);
  -- visible: 2024/25 (superseded), 2025/26 (superseded), 2026/27 (published); hidden: 20/21, 22/23, 23/24, 27/28
  SELECT count(*) INTO v_n FROM tariffs.tariff_year WHERE licensee_id = v_lic;
  INSERT INTO _r VALUES ('sub_sees_only_published_and_superseded_years', v_n = 3);
  SELECT count(*) INTO v_n FROM tariffs.tariff WHERE id = v_t27;
  INSERT INTO _r VALUES ('sub_cannot_see_draft_tariff', v_n = 0);
  SELECT count(*) INTO v_n FROM tariffs.charge WHERE tariff_id = v_t27;
  INSERT INTO _r VALUES ('sub_cannot_see_draft_charges', v_n = 0);
  SELECT count(*) INTO v_n FROM tariffs.charge WHERE tariff_id = v_t26;
  INSERT INTO _r VALUES ('sub_reads_published_charges', v_n = 1);
  SELECT count(*) INTO v_n FROM tariffs.ingest_run;
  INSERT INTO _r VALUES ('sub_cannot_read_ingest_runs', v_n = 0);
  UPDATE tariffs.charge SET amount_excl_vat = 1 WHERE tariff_id = v_t27;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('sub_update_affects_nothing', v_n = 0);
  BEGIN
    INSERT INTO tariffs.licensee (kind, name) VALUES ('private', 'SUB FORGED LICENSEE');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('sub_licensee_insert_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('sub_licensee_insert_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('sub_licensee_insert_REFUSED', false);
  END;
  BEGIN
    INSERT INTO tariffs.charge (tariff_id, component, unit, amount_excl_vat, vat_basis, extraction_method)
    VALUES (v_t27, 'energy', 'c_per_kWh', 1, 'assumed_excl', 'manual');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('sub_charge_insert_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('sub_charge_insert_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('sub_charge_insert_REFUSED', false);
  END;
  RESET ROLE;

  -- ── 3. A WM-Consulting contractor reads (WM bypass) but is not an admin ───
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_wmcon::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('wm_contractor_not_admin', NOT public.is_platform_tariff_admin());
  SELECT count(*) INTO v_n FROM tariffs.tariff_year WHERE licensee_id = v_lic;
  INSERT INTO _r VALUES ('wm_contractor_reads_published', v_n = 3);
  BEGIN
    INSERT INTO tariffs.licensee (kind, name) VALUES ('private', 'WM CONTRACTOR FORGED');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('wm_contractor_insert_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('wm_contractor_insert_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('wm_contractor_insert_REFUSED', false);
  END;
  RESET ROLE;

  -- ── 4. A deactivated WM admin is nobody ───────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_wmdead::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('deactivated_wm_admin_not_admin', NOT public.is_platform_tariff_admin());
  SELECT count(*) INTO v_n FROM tariffs.licensee WHERE id = v_lic;
  INSERT INTO _r VALUES ('deactivated_wm_admin_reads_nothing', v_n = 0);
  RESET ROLE;

  -- ── 5. An unsubscribed org reads nothing (D-03b) ──────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_unsub::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('unsubscribed_has_no_solar_org', NOT public.caller_has_any_solar_org());
  SELECT count(*) INTO v_n FROM tariffs.licensee WHERE id = v_lic;
  SELECT count(*) INTO v_n2 FROM tariffs.tariff_year WHERE licensee_id = v_lic;
  INSERT INTO _r VALUES ('unsubscribed_reads_nothing', v_n = 0 AND v_n2 = 0);
  RESET ROLE;

  -- ── 6. The service role (ingestion) sees drafts but cannot edit history ───
  PERFORM set_config('request.jwt.claims', '{}', true);
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO v_n FROM tariffs.tariff_year WHERE id = v_y27;
  INSERT INTO _r VALUES ('service_role_reads_drafts', v_n = 1);
  BEGIN
    UPDATE tariffs.charge SET amount_excl_vat = 2 WHERE tariff_id = v_t26;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('service_role_cannot_edit_published', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('service_role_cannot_edit_published', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('service_role_cannot_edit_published', false);
  END;
  RESET ROLE;

  -- ── 7. anon: no schema, no helper ─────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM tariffs.licensee LIMIT 1;
    INSERT INTO _r VALUES ('anon_read_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_read_REFUSED', true);
  END;
  BEGIN
    PERFORM public.is_platform_tariff_admin();
    INSERT INTO _r VALUES ('anon_execute_admin_helper_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_execute_admin_helper_REFUSED', true);
  END;
  RESET ROLE;

  -- ── 8. The source bucket is private ───────────────────────────────────────
  SELECT count(*) INTO v_n FROM storage.buckets WHERE id = 'tariff-sources' AND NOT public;
  INSERT INTO _r VALUES ('tariff_sources_bucket_private', v_n = 1);
END $$;

SELECT k AS "check", v AS ok FROM _r ORDER BY k;
```

- [ ] **Step 2: Watch it fail against a database without the tariffs schema**

```bash
S="$(mktemp -d)"
cp apps/edge-functions/supabase/migrations/00208_solar_foundation.sql "$S/only-00208.sql"
scripts/db/dry-run-migration.sh "$S/only-00208.sql" scripts/db/assert-tariffs-schema-roles.sql
```
Expected: RED — `✗ assert-tariffs-schema-roles.sql aborted` with `schema "tariffs" does not exist` (or `relation "tariffs.ingest_run" does not exist`). If `00208` is already in the production ledger, `00208` alone errors on `CREATE POLICY … already exists`; then use an empty file instead: `: > "$S/noop.sql"` and dry-run `"$S/noop.sql"` — same RED.

- [ ] **Step 3: Commit**

```bash
git add scripts/db/assert-tariffs-schema-roles.sql
git commit -m "test(tariffs): behavioural RLS and state-machine assertions (red)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The migration (GREEN)

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00210_tariffs_schema.sql`

- [ ] **Step 1: Write the migration**

`apps/edge-functions/supabase/migrations/00210_tariffs_schema.sql`:
```sql
-- ---------------------------------------------------------------------------
-- Migration 00210: Tariff library schema (Solar Phase 2a)
-- ---------------------------------------------------------------------------
-- Spec: docs/solar/03-data-model-and-security.md §4; source reality in
-- docs/solar/as-is/09-nersa-tariff-source.md; decisions D-03 (E-Site runs the
-- library, a platform admin approves each year) and D-03b (read = orgs with an
-- active Solar subscription) in docs/solar/06-open-decisions.md.
--
-- WHAT. Platform reference data in a new exposed schema `tariffs`: licensee
-- (+ licensee_alias), source_document, tariff_year, tariff, charge,
-- tou_calendar, tou_window, holiday_rule, loss_factor, sseg_rule, ingest_run;
-- the private Storage bucket `tariff-sources`; two public helpers.
--
-- WHO.
--   READ: a platform tariff admin (active owner/admin of WM-Consulting), or a
--     caller active in ANY org with a live Solar subscription. Subscribers see
--     only published or superseded years and the tariffs, charges, loss
--     factors and SSEG rules under them (the child policies go through the
--     tariff_year policy). Drafts and ingest_run are admin-only.
--   WRITE: platform tariff admins (per-verb PERMISSIVE policies) and the
--     service role (ingestion). Nobody else; no anon anywhere.
--
-- STATE MACHINE (tariffs.tariff_year_guard). INSERT lands in ingesting or
-- in_review. Legal moves: ingesting->in_review, in_review->ingesting,
-- in_review->published, published->superseded. Publishing needs >= 1 tariff,
-- a charge on every tariff and a review stamp on every inferred unit; it
-- stamps published_at/by (bound to the caller) and supersedes the licensee's
-- other published year. A back-filled OLDER year arrives as superseded.
-- IMMUTABILITY. A published/superseded year and every tariff, charge, loss
-- factor and SSEG rule under it cannot be inserted into, changed or deleted by
-- anyone, the service role included (triggers are not bypassed by BYPASSRLS).
-- Corrections are a new version through review.
--
-- DEPENDS ON 00208 (solar.org_subscription_active).
-- NEW SCHEMA CHECKLIST (00126): grants below (no anon), config.toml, AND the
-- production PostgREST db_schema PATCH at apply time (else PGRST002).
-- The "[mutation-probe Mn]" comments mark lines the red/green mutation runs
-- delete; they are inert.
-- ---------------------------------------------------------------------------

-- @verify:begin
-- table: tariffs.licensee
-- table: tariffs.licensee_alias
-- table: tariffs.source_document
-- table: tariffs.tariff_year
-- table: tariffs.tariff
-- table: tariffs.charge
-- table: tariffs.tou_calendar
-- table: tariffs.tou_window
-- table: tariffs.holiday_rule
-- table: tariffs.loss_factor
-- table: tariffs.sseg_rule
-- table: tariffs.ingest_run
-- function: public.is_platform_tariff_admin()
-- function: public.caller_has_any_solar_org()
-- function: tariffs.tariff_year_guard()
-- function: tariffs.year_child_guard()
-- function: tariffs.charge_review_bind()
-- function: tariffs.source_document_guard()
-- trigger: tariff_year_guard ON tariffs.tariff_year
-- trigger: tariff_guard ON tariffs.tariff
-- trigger: charge_guard ON tariffs.charge
-- trigger: charge_review_bind ON tariffs.charge
-- trigger: loss_factor_guard ON tariffs.loss_factor
-- trigger: sseg_rule_guard ON tariffs.sseg_rule
-- trigger: source_document_guard ON tariffs.source_document
-- index: tariff_year_one_published ON tariffs.tariff_year
-- constraint: charge_unit_known ON tariffs.charge
-- constraint: charge_inference_explained ON tariffs.charge
-- constraint: licensee_alias_normalised ON tariffs.licensee_alias
-- constraint: tariff_year_financial_year_format ON tariffs.tariff_year
-- policy: licensee_select ON tariffs.licensee PERMISSIVE
-- policy: licensee_alias_select ON tariffs.licensee_alias PERMISSIVE
-- policy: source_document_select ON tariffs.source_document PERMISSIVE
-- policy: tariff_year_select ON tariffs.tariff_year PERMISSIVE
-- policy: tariff_select ON tariffs.tariff PERMISSIVE
-- policy: charge_select ON tariffs.charge PERMISSIVE
-- policy: tou_calendar_select ON tariffs.tou_calendar PERMISSIVE
-- policy: tou_window_select ON tariffs.tou_window PERMISSIVE
-- policy: holiday_rule_select ON tariffs.holiday_rule PERMISSIVE
-- policy: loss_factor_select ON tariffs.loss_factor PERMISSIVE
-- policy: sseg_rule_select ON tariffs.sseg_rule PERMISSIVE
-- policy: ingest_run_select ON tariffs.ingest_run PERMISSIVE
-- policy: charge_insert ON tariffs.charge PERMISSIVE
-- policy: charge_update ON tariffs.charge PERMISSIVE
-- policy: charge_delete ON tariffs.charge PERMISSIVE
-- policy: tariff_year_update ON tariffs.tariff_year PERMISSIVE
-- grant_absent: anon SELECT ON tariffs.licensee
-- grant_absent: anon SELECT ON tariffs.tariff_year
-- grant_absent: anon SELECT ON tariffs.charge
-- grant_absent: authenticated INSERT ON tariffs.ingest_run
-- grant_absent: anon EXECUTE ON public.is_platform_tariff_admin()
-- grant_absent: anon EXECUTE ON public.caller_has_any_solar_org()
-- anon_execute_absent: ALL prosecdef functions in tariffs
-- sql: (SELECT NOT has_schema_privilege('anon', 'tariffs', 'USAGE'))
-- sql: (SELECT bool_and(c.relrowsecurity AND c.relforcerowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'tariffs' AND c.relkind = 'r')
-- sql: (SELECT count(*) = 0 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'tariffs' AND (p.polcmd = '*' OR NOT p.polpermissive))
-- sql: (SELECT count(*) = 1 FROM storage.buckets WHERE id = 'tariff-sources' AND NOT public)
-- behaviour: scripts/db/assert-tariffs-schema-roles.sql — every row ok
-- @verify:end
--
-- The schema-wide sql: directives above are re-checked on EVERY later deploy:
--   * FORCE bool_and covers every table in schema tariffs, including any
--     future partition.
--   * no FOR ALL and no RESTRICTIVE policy anywhere in schema tariffs (a
--     RESTRICTIVE FOR ALL write gate narrows reads: the 00205 bug).
-- A later migration must conform, or amend this block in the same PR and prove
-- the old directive under the new state (the 00204/00206 rule).

-- NO BEGIN/COMMIT in this file: scripts/db/dry-run-migration.sh wraps it in
-- BEGIN … ROLLBACK, and a COMMIT here would make that dry run permanent.

-- ── 0. Schema and grants (no anon) ──────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS tariffs;
GRANT USAGE ON SCHEMA tariffs TO authenticated, service_role;
REVOKE ALL ON SCHEMA tariffs FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA tariffs GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA tariffs GRANT ALL ON SEQUENCES TO service_role;

-- ── 1. Helpers ──────────────────────────────────────────────────────────────
-- D-03: E-Site staff = an active owner/admin of WM-Consulting.
CREATE OR REPLACE FUNCTION public.is_platform_tariff_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.user_organisations uo
         WHERE uo.user_id = auth.uid()
           AND uo.organisation_id = 'dddddddd-0000-0000-0000-000000000001'::uuid
           AND uo.is_active                                    -- [mutation-probe M4]
           AND uo.role IN ('owner', 'admin'));
$$;

-- D-03b: the caller is active in at least one org with a live Solar
-- subscription (WM-Consulting counts, through the 00208 bypass).
CREATE OR REPLACE FUNCTION public.caller_has_any_solar_org()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.user_organisations uo
         WHERE uo.user_id = auth.uid() AND uo.is_active
           AND solar.org_subscription_active(uo.organisation_id));
$$;

-- Spelled out per function: the repo-wide anon-EXECUTE guard reads this TEXT.
REVOKE ALL ON FUNCTION public.is_platform_tariff_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_platform_tariff_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_platform_tariff_admin() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.caller_has_any_solar_org() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.caller_has_any_solar_org() FROM anon;
GRANT EXECUTE ON FUNCTION public.caller_has_any_solar_org() TO authenticated, service_role;

-- ── 2. Tables ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tariffs.licensee (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind                TEXT NOT NULL CHECK (kind IN ('eskom', 'municipal', 'metro', 'private', 'development_agency', 'industrial_private')),
    name                TEXT NOT NULL UNIQUE CHECK (btrim(name) <> ''),
    mdb_code            TEXT UNIQUE,
    -- From the curated registry, NEVER from the source file (Sasol is filed under KZN).
    province            TEXT CHECK (province IN ('EC', 'FS', 'GP', 'KZN', 'LP', 'MP', 'NW', 'NC', 'WC', 'national')),
    nersa_licence_no    TEXT,
    parent_licensee_id  UUID REFERENCES tariffs.licensee(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Misspelt / variant sheet names ("MODALE CITY", "CITY OF CAPE "), stored normalised.
CREATE TABLE IF NOT EXISTS tariffs.licensee_alias (
    alias        TEXT PRIMARY KEY
                   CONSTRAINT licensee_alias_normalised
                   CHECK (alias <> '' AND alias = upper(regexp_replace(btrim(alias), '\s+', ' ', 'g'))),
    licensee_id  UUID NOT NULL REFERENCES tariffs.licensee(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS licensee_alias_licensee_idx ON tariffs.licensee_alias (licensee_id);

CREATE TABLE IF NOT EXISTS tariffs.source_document (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- NULL for a book covering many licensees (a NERSA province compendium).
    licensee_id     UUID REFERENCES tariffs.licensee(id),
    kind            TEXT NOT NULL CHECK (kind IN ('tariff_book', 'nersa_decision', 'eskom_schedule', 'rules', 'by_law')),
    title           TEXT NOT NULL,
    financial_year  TEXT CHECK (financial_year ~ '^[0-9]{4}/[0-9]{2}$'),
    status          TEXT NOT NULL CHECK (status IN ('draft', 'final', 'nersa_approved')),
    published_on    DATE,
    storage_path    TEXT UNIQUE,
    sha256          TEXT NOT NULL UNIQUE CONSTRAINT source_document_sha256_hex CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    page_count      INT CHECK (page_count > 0),
    url             TEXT,
    retrieved_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tariffs.tariff_year (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    licensee_id            UUID NOT NULL REFERENCES tariffs.licensee(id),
    financial_year         TEXT NOT NULL CONSTRAINT tariff_year_financial_year_format CHECK (
                               CASE WHEN financial_year ~ '^[0-9]{4}/[0-9]{2}$'
                                    THEN right(financial_year, 2)::int = (left(financial_year, 4)::int + 1) % 100
                                    ELSE false END),
    effective_from         DATE NOT NULL,
    effective_to           DATE NOT NULL,
    approved_increase_pct  NUMERIC(6,3),
    source_document_id     UUID REFERENCES tariffs.source_document(id),
    state                  TEXT NOT NULL DEFAULT 'ingesting'
                             CHECK (state IN ('ingesting', 'in_review', 'published', 'superseded')),
    published_at           TIMESTAMPTZ,
    published_by           UUID REFERENCES auth.users(id),
    superseded_at          TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tariff_year_licensee_fy UNIQUE (licensee_id, financial_year),
    CONSTRAINT tariff_year_effective_order CHECK (effective_to > effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS tariff_year_one_published ON tariffs.tariff_year (licensee_id) WHERE state = 'published';  -- [mutation-probe M3]

CREATE TABLE IF NOT EXISTS tariffs.tariff (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tariff_year_id         UUID NOT NULL REFERENCES tariffs.tariff_year(id) ON DELETE CASCADE,
    code                   TEXT,
    name                   TEXT NOT NULL CHECK (btrim(name) <> ''),
    family                 TEXT,
    category               TEXT NOT NULL DEFAULT 'other' CHECK (category IN
                             ('domestic', 'commercial', 'industrial', 'agricultural', 'bulk', 'public_lighting', 'sseg', 'wheeling', 'other')),
    metering               TEXT NOT NULL DEFAULT 'both' CHECK (metering IN ('prepaid', 'conventional', 'both', 'unmetered')),
    structure              TEXT NOT NULL CHECK (structure IN ('flat', 'ibt', 'seasonal', 'seasonal_ibt', 'tou', 'tou_ibt')),
    voltage_band           TEXT,
    phase                  TEXT CHECK (phase IN ('single', 'three')),
    transmission_zone      SMALLINT CHECK (transmission_zone BETWEEN 0 AND 3),
    local_authority        BOOLEAN NOT NULL DEFAULT false,
    min_amps               NUMERIC(10,2),
    max_amps               NUMERIC(10,2),
    min_kva                NUMERIC(12,2),
    max_kva                NUMERIC(12,2),
    eligibility            JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Eskom's export credit is a separate tariff (Homeflex -> Gen-Offset Homeflex).
    export_tariff_id       UUID REFERENCES tariffs.tariff(id) ON DELETE SET NULL,
    predecessor_tariff_id  UUID REFERENCES tariffs.tariff(id) ON DELETE SET NULL,
    is_legacy              BOOLEAN NOT NULL DEFAULT false,
    notes                  TEXT,
    source_locator         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tariff_year_name UNIQUE (tariff_year_id, name)
);

CREATE TABLE IF NOT EXISTS tariffs.charge (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tariff_id           UUID NOT NULL REFERENCES tariffs.tariff(id) ON DELETE CASCADE,
    component           TEXT NOT NULL CHECK (component IN
                          ('energy', 'legacy', 'basic', 'service', 'admin', 'network_capacity', 'network_demand',
                           'transmission_network', 'gcc', 'ancillary', 'ers', 'affordability', 'lv_subsidy',
                           'reactive', 'demand', 'capacity_amp', 'export_credit', 'wheeling_uos', 'loss_factor', 'other')),
    season              TEXT NOT NULL DEFAULT 'all' CHECK (season IN ('all', 'high', 'low')),
    tou                 TEXT NOT NULL DEFAULT 'all' CHECK (tou IN ('all', 'peak', 'standard', 'off_peak')),
    day_type            TEXT NOT NULL DEFAULT 'all' CHECK (day_type IN ('all', 'weekday', 'saturday', 'sunday')),
    block_min_kwh       NUMERIC(14,3),
    block_max_kwh       NUMERIC(14,3),
    block_basis         TEXT CHECK (block_basis IN ('monthly', 'daily')),
    unit                TEXT NOT NULL CONSTRAINT charge_unit_known CHECK (unit IN
                          ('c_per_kWh', 'R_per_kWh', 'R_per_month', 'R_per_day', 'R_per_kVA_month',
                           'R_per_kW_month', 'R_per_A_month', 'c_per_kVArh', 'R_per_POD_day', 'pct')),
    demand_basis        TEXT CHECK (demand_basis IN ('nmd', 'actual_md', 'peak_window_md', 'utilised_capacity')),
    amount_excl_vat     NUMERIC(14,6) NOT NULL,
    vat_rate            NUMERIC(5,4) NOT NULL DEFAULT 0.15 CHECK (vat_rate >= 0 AND vat_rate < 1),
    vat_basis           TEXT NOT NULL CHECK (vat_basis IN ('stated_excl', 'assumed_excl', 'stated_incl')),
    -- Source units are wrong or absent often (Buffalo City, Gamagara, Ekurhuleni):
    -- an inferred unit is never silent.
    unit_inferred       BOOLEAN NOT NULL DEFAULT false,
    inference_reason    TEXT,
    source_document_id  UUID REFERENCES tariffs.source_document(id),
    source_locator      JSONB NOT NULL DEFAULT '{}'::jsonb,
    extraction_method   TEXT NOT NULL CHECK (extraction_method IN ('parser', 'ai', 'manual')),
    reviewed_by         UUID REFERENCES auth.users(id),
    reviewed_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT charge_inference_explained CHECK (unit_inferred = (inference_reason IS NOT NULL)),
    CONSTRAINT charge_block_order CHECK (block_max_kwh IS NULL OR (block_min_kwh IS NOT NULL AND block_max_kwh > block_min_kwh)),
    CONSTRAINT charge_block_basis_with_block CHECK ((block_min_kwh IS NULL) = (block_basis IS NULL))
);
CREATE INDEX IF NOT EXISTS charge_tariff_idx ON tariffs.charge (tariff_id);

CREATE TABLE IF NOT EXISTS tariffs.tou_calendar (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    licensee_id         UUID NOT NULL REFERENCES tariffs.licensee(id),
    valid_from          DATE NOT NULL,
    valid_to            DATE,
    high_season_months  INT[] NOT NULL CHECK (high_season_months <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12]),
    -- Municipal books state seasons, never hours: their calendars are assumed_eskom.
    source              TEXT NOT NULL CHECK (source IN ('published', 'assumed_eskom')),
    source_document_id  UUID REFERENCES tariffs.source_document(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tou_calendar_valid_order CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE TABLE IF NOT EXISTS tariffs.tou_window (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calendar_id   UUID NOT NULL REFERENCES tariffs.tou_calendar(id) ON DELETE CASCADE,
    season        TEXT NOT NULL CHECK (season IN ('high', 'low')),
    day_type      TEXT NOT NULL CHECK (day_type IN ('weekday', 'saturday', 'sunday')),
    start_minute  INT NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
    end_minute    INT NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
    period        TEXT NOT NULL CHECK (period IN ('peak', 'standard', 'off_peak')),
    CONSTRAINT tou_window_order CHECK (end_minute > start_minute)
);

-- Holiday DATES come from projects.public_holidays (00194); this says how one is treated.
CREATE TABLE IF NOT EXISTS tariffs.holiday_rule (
    calendar_id  UUID PRIMARY KEY REFERENCES tariffs.tou_calendar(id) ON DELETE CASCADE,
    treated_as   TEXT NOT NULL CHECK (treated_as IN ('saturday', 'sunday'))
);

-- Eskom publishes these as a table per tariff year, not as a charge.
CREATE TABLE IF NOT EXISTS tariffs.loss_factor (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    licensee_id        UUID NOT NULL REFERENCES tariffs.licensee(id),
    tariff_year_id     UUID NOT NULL REFERENCES tariffs.tariff_year(id) ON DELETE CASCADE,
    kind               TEXT NOT NULL CHECK (kind IN ('dx_urban', 'dx_rural', 'tx')),
    voltage_band       TEXT,
    transmission_zone  SMALLINT CHECK (transmission_zone BETWEEN 0 AND 3),
    factor             NUMERIC(8,5) NOT NULL CHECK (factor >= 1 AND factor < 2),
    source_locator     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT loss_factor_zone_for_tx CHECK ((kind = 'tx') = (transmission_zone IS NOT NULL))
);

-- NERSA Net-Billing Rules (17 Dec 2024) pp7-12, per licensee year.
CREATE TABLE IF NOT EXISTS tariffs.sseg_rule (
    id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    licensee_id                   UUID NOT NULL REFERENCES tariffs.licensee(id),
    tariff_year_id                UUID NOT NULL UNIQUE REFERENCES tariffs.tariff_year(id) ON DELETE CASCADE,
    crediting                     TEXT NOT NULL CHECK (crediting IN ('net_billing_tou', 'net_billing_flat', 'none')),
    settlement_period             TEXT NOT NULL DEFAULT 'monthly' CHECK (settlement_period = 'monthly'),
    carry_forward                 TEXT NOT NULL CHECK (carry_forward IN ('none', 'within_financial_year')),
    fy_end_month                  SMALLINT NOT NULL CHECK (fy_end_month BETWEEN 1 AND 12),
    cap_rule                      TEXT NOT NULL CHECK (cap_rule IN ('kwh_per_tou_period', 'value_per_tou_period', 'energy_charges')),
    offsets                       TEXT NOT NULL DEFAULT 'energy_only' CHECK (offsets = 'energy_only'),
    forfeit_on_ownership_change   BOOLEAN NOT NULL DEFAULT true,
    max_kva                       NUMERIC(10,2) NOT NULL DEFAULT 1000 CHECK (max_kva > 0),
    requires_tou                  BOOLEAN NOT NULL DEFAULT true,
    requires_bidirectional_meter  BOOLEAN NOT NULL DEFAULT true,
    source_document_id            UUID REFERENCES tariffs.source_document(id),
    locator                       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tariffs.ingest_run (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_document_id  UUID REFERENCES tariffs.source_document(id),
    parser              TEXT NOT NULL CHECK (parser IN ('province_xlsx', 'eskom_xlsm', 'rfd_pdf')),
    status              TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
    stats               JSONB NOT NULL DEFAULT '{}'::jsonb,
    diff                JSONB NOT NULL DEFAULT '{}'::jsonb,
    error               TEXT,
    started_by          UUID REFERENCES auth.users(id),
    at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at         TIMESTAMPTZ
);

-- ── 3. Triggers ─────────────────────────────────────────────────────────────
-- All INVOKER (none is SECURITY DEFINER): they read only rows the caller may
-- already read, and a parent a caller cannot see is left to RLS to refuse.
CREATE OR REPLACE FUNCTION tariffs.tariff_year_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
    v_n INT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.state IN ('published', 'superseded') THEN
            RAISE EXCEPTION 'tariffs.tariff_year %: a % year cannot be deleted', OLD.id, OLD.state
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.state NOT IN ('ingesting', 'in_review') THEN
            RAISE EXCEPTION 'tariffs.tariff_year: a new year starts in ingesting or in_review, not %', NEW.state
                USING ERRCODE = 'check_violation';
        END IF;
        NEW.published_at := NULL;
        NEW.published_by := NULL;
        NEW.superseded_at := NULL;
        RETURN NEW;
    END IF;

    -- UPDATE of a published or superseded year: only published -> superseded,
    -- with every other fact unchanged.
    IF OLD.state IN ('published', 'superseded') THEN
        IF NOT (OLD.state = 'published' AND NEW.state = 'superseded'
                AND NEW.licensee_id = OLD.licensee_id
                AND NEW.financial_year = OLD.financial_year
                AND NEW.effective_from = OLD.effective_from
                AND NEW.effective_to = OLD.effective_to
                AND NEW.approved_increase_pct IS NOT DISTINCT FROM OLD.approved_increase_pct
                AND NEW.source_document_id IS NOT DISTINCT FROM OLD.source_document_id
                AND NEW.published_at IS NOT DISTINCT FROM OLD.published_at
                AND NEW.published_by IS NOT DISTINCT FROM OLD.published_by) THEN
            RAISE EXCEPTION 'tariffs.tariff_year %: a % year is immutable; correct it through a new version', OLD.id, OLD.state
                USING ERRCODE = 'check_violation';
        END IF;
        NEW.superseded_at := now();
        RETURN NEW;
    END IF;

    IF NEW.state = OLD.state THEN
        NEW.published_at := NULL;
        NEW.published_by := NULL;
        RETURN NEW;
    END IF;

    IF NOT ((OLD.state = 'ingesting' AND NEW.state = 'in_review')
            OR (OLD.state = 'in_review' AND NEW.state = 'ingesting')
            OR (OLD.state = 'in_review' AND NEW.state = 'published')) THEN
        RAISE EXCEPTION 'tariffs.tariff_year %: % -> % is not a legal transition', OLD.id, OLD.state, NEW.state
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.state = 'published' THEN
        SELECT count(*) INTO v_n FROM tariffs.tariff t WHERE t.tariff_year_id = NEW.id;
        IF v_n = 0 THEN
            RAISE EXCEPTION 'tariffs.tariff_year %: nothing to publish (no tariffs)', NEW.id USING ERRCODE = 'check_violation';
        END IF;
        SELECT count(*) INTO v_n FROM tariffs.tariff t
         WHERE t.tariff_year_id = NEW.id AND NOT EXISTS (SELECT 1 FROM tariffs.charge c WHERE c.tariff_id = t.id);
        IF v_n > 0 THEN
            RAISE EXCEPTION 'tariffs.tariff_year %: % tariff(s) have no charges', NEW.id, v_n USING ERRCODE = 'check_violation';
        END IF;
        SELECT count(*) INTO v_n FROM tariffs.charge c JOIN tariffs.tariff t ON t.id = c.tariff_id
         WHERE t.tariff_year_id = NEW.id AND c.unit_inferred AND c.reviewed_at IS NULL;
        IF v_n > 0 THEN
            RAISE EXCEPTION 'tariffs.tariff_year %: % inferred unit(s) not reviewed', NEW.id, v_n USING ERRCODE = 'check_violation';
        END IF;
        NEW.published_at := now();
        NEW.published_by := auth.uid();
        IF EXISTS (SELECT 1 FROM tariffs.tariff_year y
                    WHERE y.licensee_id = NEW.licensee_id AND y.id <> NEW.id
                      AND y.state = 'published' AND y.financial_year > NEW.financial_year) THEN
            -- A back-filled older year is history on arrival.
            NEW.state := 'superseded';
            NEW.superseded_at := now();
        ELSE
            NULL;
            -- [mutation-probe M3:begin]
            UPDATE tariffs.tariff_year SET state = 'superseded'
             WHERE licensee_id = NEW.licensee_id AND id <> NEW.id AND state = 'published';
            -- [mutation-probe M3:end]
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION tariffs.year_child_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
    v_years  UUID[] := ARRAY[]::UUID[];
    v_year   UUID;
    v_state  TEXT;
    v_lic    UUID;
BEGIN
    IF TG_TABLE_NAME = 'charge' THEN
        IF TG_OP IN ('UPDATE', 'DELETE') THEN
            v_years := v_years || (SELECT t.tariff_year_id FROM tariffs.tariff t WHERE t.id = OLD.tariff_id);
        END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
            v_years := v_years || (SELECT t.tariff_year_id FROM tariffs.tariff t WHERE t.id = NEW.tariff_id);
        END IF;
    ELSE
        IF TG_OP IN ('UPDATE', 'DELETE') THEN v_years := v_years || OLD.tariff_year_id; END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN v_years := v_years || NEW.tariff_year_id; END IF;
    END IF;

    FOREACH v_year IN ARRAY v_years LOOP
        CONTINUE WHEN v_year IS NULL;   -- parent invisible to this caller: RLS decides
        SELECT y.state, y.licensee_id INTO v_state, v_lic FROM tariffs.tariff_year y WHERE y.id = v_year;
        IF v_state IN ('published', 'superseded') THEN
            RAISE EXCEPTION 'tariffs.%: tariff year % is %; published tariff data is immutable (correct it through a new version)',
                TG_TABLE_NAME, v_year, v_state USING ERRCODE = 'check_violation';
        END IF;
    END LOOP;

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    -- Loss factors and SSEG rules belong to their year's licensee, whatever was sent.
    IF TG_TABLE_NAME IN ('loss_factor', 'sseg_rule') AND v_lic IS NOT NULL THEN
        NEW.licensee_id := v_lic;
    END IF;
    RETURN NEW;
END $$;

-- A review stamp is the caller and now; a reviewed fact that changes loses it.
CREATE OR REPLACE FUNCTION tariffs.charge_review_bind()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       AND (NEW.unit, NEW.amount_excl_vat, NEW.unit_inferred) IS DISTINCT FROM (OLD.unit, OLD.amount_excl_vat, OLD.unit_inferred) THEN
        NEW.reviewed_at := NULL;
        NEW.reviewed_by := NULL;
    ELSIF TG_OP = 'UPDATE' AND OLD.reviewed_at IS NOT NULL THEN
        NEW.reviewed_at := OLD.reviewed_at;
        NEW.reviewed_by := OLD.reviewed_by;
    ELSIF NEW.reviewed_at IS NOT NULL THEN
        NEW.reviewed_at := now();
        NEW.reviewed_by := auth.uid();
    ELSE
        NEW.reviewed_by := NULL;
    END IF;
    RETURN NEW;
END $$;

-- The file a row points at never changes under it.
CREATE OR REPLACE FUNCTION tariffs.source_document_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    IF NEW.sha256 <> OLD.sha256
       OR (OLD.storage_path IS NOT NULL AND NEW.storage_path IS DISTINCT FROM OLD.storage_path) THEN
        RAISE EXCEPTION 'tariffs.source_document %: sha256 and storage_path are fixed once set', OLD.id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER tariff_year_guard BEFORE INSERT OR UPDATE OR DELETE ON tariffs.tariff_year
    FOR EACH ROW EXECUTE FUNCTION tariffs.tariff_year_guard();
CREATE TRIGGER tariff_guard BEFORE INSERT OR UPDATE OR DELETE ON tariffs.tariff
    FOR EACH ROW EXECUTE FUNCTION tariffs.year_child_guard();
CREATE TRIGGER charge_guard BEFORE INSERT OR UPDATE OR DELETE ON tariffs.charge FOR EACH ROW EXECUTE FUNCTION tariffs.year_child_guard();  -- [mutation-probe M1]
CREATE TRIGGER charge_review_bind BEFORE INSERT OR UPDATE ON tariffs.charge
    FOR EACH ROW EXECUTE FUNCTION tariffs.charge_review_bind();
CREATE TRIGGER loss_factor_guard BEFORE INSERT OR UPDATE OR DELETE ON tariffs.loss_factor
    FOR EACH ROW EXECUTE FUNCTION tariffs.year_child_guard();
CREATE TRIGGER sseg_rule_guard BEFORE INSERT OR UPDATE OR DELETE ON tariffs.sseg_rule
    FOR EACH ROW EXECUTE FUNCTION tariffs.year_child_guard();
CREATE TRIGGER source_document_guard BEFORE UPDATE ON tariffs.source_document
    FOR EACH ROW EXECUTE FUNCTION tariffs.source_document_guard();
CREATE TRIGGER licensee_updated_at BEFORE UPDATE ON tariffs.licensee
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tariff_year_updated_at BEFORE UPDATE ON tariffs.tariff_year
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tariff_updated_at BEFORE UPDATE ON tariffs.tariff
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 4. RLS: ENABLE + FORCE everywhere, per-verb PERMISSIVE policies ─────────
ALTER TABLE tariffs.licensee        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs.licensee        FORCE ROW LEVEL SECURITY;
ALTER TABLE tariffs.licensee_alias  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs.licensee_alias  FORCE ROW LEVEL SECURITY;
ALTER TABLE tariffs.source_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs.source_document FORCE ROW LEVEL SECURITY;
ALTER TABLE tariffs.tariff_year     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs.tariff_year     FORCE ROW LEVEL SECURITY;
ALTER TABLE tariffs.tariff          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs.tariff          FORCE ROW LEVEL SECURITY;
ALTER TABLE tariffs.charge          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs.charge          FORCE ROW LEVEL SECURITY;
ALTER TABLE tariffs.tou_calendar    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs.tou_calendar    FORCE ROW LEVEL SECURITY;
ALTER TABLE tariffs.tou_window      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs.tou_window      FORCE ROW LEVEL SECURITY;
ALTER TABLE tariffs.holiday_rule    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs.holiday_rule    FORCE ROW LEVEL SECURITY;
ALTER TABLE tariffs.loss_factor     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs.loss_factor     FORCE ROW LEVEL SECURITY;
ALTER TABLE tariffs.sseg_rule       ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs.sseg_rule       FORCE ROW LEVEL SECURITY;
ALTER TABLE tariffs.ingest_run      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs.ingest_run      FORCE ROW LEVEL SECURITY;

-- Reference tables: any reader (admin, or active in a subscribed org).
CREATE POLICY licensee_select ON tariffs.licensee FOR SELECT TO authenticated
    USING ((SELECT public.is_platform_tariff_admin()) OR (SELECT public.caller_has_any_solar_org()));
CREATE POLICY licensee_alias_select ON tariffs.licensee_alias FOR SELECT TO authenticated
    USING ((SELECT public.is_platform_tariff_admin()) OR (SELECT public.caller_has_any_solar_org()));
CREATE POLICY source_document_select ON tariffs.source_document FOR SELECT TO authenticated
    USING ((SELECT public.is_platform_tariff_admin()) OR (SELECT public.caller_has_any_solar_org()));
CREATE POLICY tou_calendar_select ON tariffs.tou_calendar FOR SELECT TO authenticated
    USING ((SELECT public.is_platform_tariff_admin()) OR (SELECT public.caller_has_any_solar_org()));
CREATE POLICY tou_window_select ON tariffs.tou_window FOR SELECT TO authenticated
    USING ((SELECT public.is_platform_tariff_admin()) OR (SELECT public.caller_has_any_solar_org()));
CREATE POLICY holiday_rule_select ON tariffs.holiday_rule FOR SELECT TO authenticated
    USING ((SELECT public.is_platform_tariff_admin()) OR (SELECT public.caller_has_any_solar_org()));

-- Years: drafts are admin-only.
CREATE POLICY tariff_year_select ON tariffs.tariff_year FOR SELECT TO authenticated
    USING ((SELECT public.is_platform_tariff_admin())
           OR ((SELECT public.caller_has_any_solar_org()) AND state IN ('published', 'superseded')));  -- [mutation-probe M2]

-- Everything under a year inherits the year's visibility (the subquery is itself under RLS).
CREATE POLICY tariff_select ON tariffs.tariff FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM tariffs.tariff_year y WHERE y.id = tariff.tariff_year_id));
CREATE POLICY charge_select ON tariffs.charge FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM tariffs.tariff t WHERE t.id = charge.tariff_id));
CREATE POLICY loss_factor_select ON tariffs.loss_factor FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM tariffs.tariff_year y WHERE y.id = loss_factor.tariff_year_id));
CREATE POLICY sseg_rule_select ON tariffs.sseg_rule FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM tariffs.tariff_year y WHERE y.id = sseg_rule.tariff_year_id));

CREATE POLICY ingest_run_select ON tariffs.ingest_run FOR SELECT TO authenticated
    USING ((SELECT public.is_platform_tariff_admin()));

-- Writes: platform tariff admins only, one policy per verb.
CREATE POLICY licensee_insert ON tariffs.licensee FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY licensee_update ON tariffs.licensee FOR UPDATE TO authenticated USING ((SELECT public.is_platform_tariff_admin())) WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY licensee_delete ON tariffs.licensee FOR DELETE TO authenticated USING ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY licensee_alias_insert ON tariffs.licensee_alias FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY licensee_alias_update ON tariffs.licensee_alias FOR UPDATE TO authenticated USING ((SELECT public.is_platform_tariff_admin())) WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY licensee_alias_delete ON tariffs.licensee_alias FOR DELETE TO authenticated USING ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY source_document_insert ON tariffs.source_document FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY source_document_update ON tariffs.source_document FOR UPDATE TO authenticated USING ((SELECT public.is_platform_tariff_admin())) WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY source_document_delete ON tariffs.source_document FOR DELETE TO authenticated USING ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY tariff_year_insert ON tariffs.tariff_year FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY tariff_year_update ON tariffs.tariff_year FOR UPDATE TO authenticated USING ((SELECT public.is_platform_tariff_admin())) WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY tariff_year_delete ON tariffs.tariff_year FOR DELETE TO authenticated USING ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY tariff_insert ON tariffs.tariff FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY tariff_update ON tariffs.tariff FOR UPDATE TO authenticated USING ((SELECT public.is_platform_tariff_admin())) WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY tariff_delete ON tariffs.tariff FOR DELETE TO authenticated USING ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY charge_insert ON tariffs.charge FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY charge_update ON tariffs.charge FOR UPDATE TO authenticated USING ((SELECT public.is_platform_tariff_admin())) WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY charge_delete ON tariffs.charge FOR DELETE TO authenticated USING ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY tou_calendar_insert ON tariffs.tou_calendar FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY tou_calendar_update ON tariffs.tou_calendar FOR UPDATE TO authenticated USING ((SELECT public.is_platform_tariff_admin())) WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY tou_calendar_delete ON tariffs.tou_calendar FOR DELETE TO authenticated USING ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY tou_window_insert ON tariffs.tou_window FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY tou_window_update ON tariffs.tou_window FOR UPDATE TO authenticated USING ((SELECT public.is_platform_tariff_admin())) WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY tou_window_delete ON tariffs.tou_window FOR DELETE TO authenticated USING ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY holiday_rule_insert ON tariffs.holiday_rule FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY holiday_rule_update ON tariffs.holiday_rule FOR UPDATE TO authenticated USING ((SELECT public.is_platform_tariff_admin())) WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY holiday_rule_delete ON tariffs.holiday_rule FOR DELETE TO authenticated USING ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY loss_factor_insert ON tariffs.loss_factor FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY loss_factor_update ON tariffs.loss_factor FOR UPDATE TO authenticated USING ((SELECT public.is_platform_tariff_admin())) WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY loss_factor_delete ON tariffs.loss_factor FOR DELETE TO authenticated USING ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY sseg_rule_insert ON tariffs.sseg_rule FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY sseg_rule_update ON tariffs.sseg_rule FOR UPDATE TO authenticated USING ((SELECT public.is_platform_tariff_admin())) WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY sseg_rule_delete ON tariffs.sseg_rule FOR DELETE TO authenticated USING ((SELECT public.is_platform_tariff_admin()));
-- ingest_run: no authenticated write policy; the ingestion script uses the service role.

GRANT SELECT, INSERT, UPDATE, DELETE ON
    tariffs.licensee, tariffs.licensee_alias, tariffs.source_document, tariffs.tariff_year, tariffs.tariff,
    tariffs.charge, tariffs.tou_calendar, tariffs.tou_window, tariffs.holiday_rule, tariffs.loss_factor, tariffs.sseg_rule
    TO authenticated;
GRANT SELECT ON tariffs.ingest_run TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA tariffs TO service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA tariffs FROM anon;

-- ── 5. Private source bucket (service role only; no storage.objects policy) ─
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('tariff-sources', 'tariff-sources', false, 52428800,
        ARRAY['application/pdf',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/vnd.ms-excel.sheet.macroEnabled.12'])
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Dry-run to GREEN**

```bash
S="$(mktemp -d)"
cat apps/edge-functions/supabase/migrations/00208_solar_foundation.sql \
    apps/edge-functions/supabase/migrations/00210_tariffs_schema.sql > "$S/combo.sql"
scripts/db/dry-run-migration.sh "$S/combo.sql" scripts/db/assert-tariffs-schema-roles.sql
```
Expected: every check `✓`, `0 failed`, 50 checks. (If `00208` is already in the ledger, dry-run `apps/edge-functions/supabase/migrations/00210_tariffs_schema.sql` alone.) Also re-run `scripts/db/assert-solar-foundation-roles.sql` against the same combo to prove 00210 changes nothing for 00208:
```bash
scripts/db/dry-run-migration.sh "$S/combo.sql" scripts/db/assert-solar-foundation-roles.sql
```
Expected: all `✓`.

- [ ] **Step 3: Verify the `@verify` block parses and holds inside the dry run**

```bash
pnpm --filter web exec vitest run src/lib/migration-verify-block.contract.test.ts
```
Expected: PASS. This contract test runs `parseVerifyBlock` over every migration ≥ `00185`, so it now parses 00210's 58 directives; a failure names the `@verify line N` to fix (unknown directive word, prose-only line, or an em dash inside a `sql:` payload). (Holding against a real database is proven by `scripts/verify-migration-applied.ts` after the owner applies; the dry run's behaviour file already exercised every object.)

- [ ] **Step 4: Commit**

```bash
git add apps/edge-functions/supabase/migrations/00210_tariffs_schema.sql
git commit -m "feat(tariffs): 00210 tariff library schema — subscriber reads, admin writes, immutable published years

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Prove the assertions can fail (mutation runs)

**Files:** none committed (mutants live in a temp dir)

A check never seen failing is decorative. Each mutant removes one mechanism; the named checks must go red, and only those.

- [ ] **Step 1: Build the four mutants**

```bash
S="$(mktemp -d)"
M=apps/edge-functions/supabase/migrations/00210_tariffs_schema.sql
BASE=apps/edge-functions/supabase/migrations/00208_solar_foundation.sql
# M1: no immutability trigger on charge
perl -ne 'print unless /\[mutation-probe M1\]/' "$M" > "$S/m1.sql"
# M2: tariff_year readable by everyone
perl -0pe 's/USING \(\(SELECT public\.is_platform_tariff_admin\(\)\)\n\s+OR \(\(SELECT public\.caller_has_any_solar_org\(\)\) AND state IN \(.published., .superseded.\)\)\);  -- \[mutation-probe M2\]/USING (true);/' "$M" > "$S/m2.sql"
# M3: no supersede step and no one-published index
perl -0pe 's/-- \[mutation-probe M3:begin\].*?-- \[mutation-probe M3:end\]//s; s/^CREATE UNIQUE INDEX IF NOT EXISTS tariff_year_one_published.*\n//m' "$M" > "$S/m3.sql"
# M4: deactivated WM admins still count as platform admins
perl -ne 'print unless /\[mutation-probe M4\]/' "$M" > "$S/m4.sql"
for m in m1 m2 m3 m4; do diff -q "$M" "$S/$m.sql" >/dev/null && echo "$m UNCHANGED - fix the perl" ; done
```
Expected: no "UNCHANGED" line (every mutant differs from the real file).

- [ ] **Step 2: Run each mutant and compare with the expected red set**

```bash
for m in m1 m2 m3 m4; do
  cat "$BASE" "$S/$m.sql" > "$S/$m-combo.sql"
  echo "=== $m"; scripts/db/dry-run-migration.sh "$S/$m-combo.sql" scripts/db/assert-tariffs-schema-roles.sql | grep '✗'
done
```
Expected red checks (nothing else red):
- **m1:** `published_charge_update_REFUSED`, `published_charge_delete_REFUSED`, `published_charge_insert_REFUSED`, `service_role_cannot_edit_published`
- **m2:** `sub_sees_only_published_and_superseded_years`, `sub_cannot_see_draft_tariff`, `sub_cannot_see_draft_charges`, `wm_contractor_reads_published`, `unsubscribed_reads_nothing`
- **m3:** `publish_supersedes_prior_year`, `one_published_year_per_licensee`
- **m4:** `deactivated_wm_admin_not_admin`, `deactivated_wm_admin_reads_nothing`

(`unsubscribed_reads_nothing` goes red in m2 because the tariff_year count is no longer 0; `wm_contractor_reads_published` because it sees 7 years.) If a different set goes red, the assertion or the mechanism is wrong: stop and fix before continuing. Record the four outputs for the PR body.

- [ ] **Step 3: Re-run the real file once more**

Run: `scripts/db/dry-run-migration.sh "$S/../combo.sql" scripts/db/assert-tariffs-schema-roles.sql` (rebuild `combo.sql` as in Task 11 Step 2 if the temp dir is gone).
Expected: all green.

---

### Task 13: Repo wiring and the three suites

**Files:**
- Modify: `apps/edge-functions/supabase/config.toml:9`
- Modify: `packages/db/src/__tests__/security/anon-execute-secdef.test.ts:60-66`

- [ ] **Step 1: Watch the schema-classification guard fail**

Run: `pnpm --filter @esite/db test:ci 2>&1 | grep -A3 "classified as exposed"`
Expected: FAIL — `new schema: add it to EXPOSED_SCHEMAS or UNEXPOSED_SCHEMAS`, listing `tariffs`.

- [ ] **Step 2: Classify `tariffs` as exposed**

In `packages/db/src/__tests__/security/anon-execute-secdef.test.ts`, replace:
```ts
  // 'solar' is created by 00208 and added to db_schema by the PATCH that
  // accompanies its apply (the 00126 new-schema checklist), so it is exposed.
  'solar',
] as const
```
with:
```ts
  // 'solar' is created by 00208 and added to db_schema by the PATCH that
  // accompanies its apply (the 00126 new-schema checklist), so it is exposed.
  'solar',
  // 'tariffs' (00210): same checklist, same PATCH, so exposed.
  'tariffs',
] as const
```

- [ ] **Step 3: Expose `tariffs` locally**

In `apps/edge-functions/supabase/config.toml` line 9, append `"tariffs"` to the list:
```toml
schemas = ["public", "projects", "field", "tenants", "suppliers", "billing", "marketplace", "gcr", "structure", "cable_schedule", "inspections", "solar", "tariffs"]
```

- [ ] **Step 4: Run all three suites and the type-checks**

```bash
pnpm --filter @esite/db test:ci 2>&1 | tail -4
pnpm --filter @esite/shared test 2>&1 | tail -4
pnpm --filter web test 2>&1 | tail -4
pnpm --filter @esite/shared type-check && pnpm --filter @esite/db type-check && pnpm --filter web type-check
```
Expected: all green. Pay attention to:
- `apps/web/src/lib/migration-verify-block.contract.test.ts` — parses every `@verify` block; an unknown directive word or an em dash inside a `sql:` payload outside a string fails it.
- `packages/db` migration-text guards. A guard failure means the migration shape is wrong — fix the migration, never weaken the guard. If a guard is genuinely inapplicable, stop and report its name and message.

- [ ] **Step 5: Commit**

```bash
git add apps/edge-functions/supabase/config.toml packages/db/src/__tests__/security/anon-execute-secdef.test.ts
git commit -m "chore(tariffs): classify and expose the tariffs schema

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Push and open the draft PR

**Files:** none

- [ ] **Step 1: Push the branch and open a DRAFT PR on top of Phase 1A**

```bash
git push -u git@github.com:WattMatt/e-site.git feat/solar-phase-2a
cat > /tmp/solar-2a-pr.md <<'EOF'
## Solar Phase 2a — tariff library core

Plans: `docs/superpowers/plans/2026-09-28-solar-phase-2a-i-tariffs-schema-engine.md` (this part) and `…-2a-ii-tariffs-parsers-ingest.md` (parsers + ingestion, pushed to this same branch).

### 2a-i — schema, canonical types, bill engine
- `00210_tariffs_schema.sql` (number claimed at apply time; depends on `00208`): new exposed schema `tariffs`; subscriber reads of published/superseded years only (D-03b), platform-admin and service-role writes (D-03), publish state machine with supersede, immutable published data, inferred units must be reviewed before publish, private `tariff-sources` bucket.
- `@esite/shared` `tariffs/`: canonical types, units, TOU aggregation, validators, YoY diff, bill engine with net-billing carry-forward and FY-end reset. Golden cases 1–8 and 10 reproduce as-is/09 §7.2 to the cent.

### Evidence
- Dry run (00208 + 00210): <paste: N/N green>
- Mutations: <paste the four red sets from Task 12>
- Suites before → after: shared <a → b>, web <c → d>, db <e → f>; type-check clean.

### Apply checklist (owner)
1. Re-check ledger `max(version)`, `origin/main` and open-PR migration filenames; renumber `00210` if taken. `00208` must be applied first.
2. PATCH production PostgREST `db_schema` to add `tariffs` before merging (else `PGRST002`).
3. Merge → deploy workflow applies → `scripts/verify-migration-applied.ts` checks the `@verify` block.
4. Re-run `scripts/db/assert-tariffs-schema-roles.sql` against production with an empty migration file → all ok.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
gh pr create --repo WattMatt/e-site --draft --base feat/solar-phase-1a --head feat/solar-phase-2a \
  --title "feat(solar): Phase 2a — tariff library core (schema, parsers, bill engine)" \
  --body-file /tmp/solar-2a-pr.md
```
Fill the three `<paste …>` placeholders in `/tmp/solar-2a-pr.md` from your recorded outputs BEFORE running `gh pr create` (they are not optional).
Expected: a draft PR URL.

- [ ] **Step 2: Report** the PR URL, suite counts, dry-run result and mutation sets. Do not merge; do not apply. Continue with plan 2a-ii on the same branch.
