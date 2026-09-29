# Solar Phase 2b — Part 2 of 5: Pure shared modules (`packages/shared/src/solar/tariff/`, ingest job runner)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Read the index first. Every module here is **pure** (no I/O, no `node:*` outside `*.test.ts`) — the shared package has no `@types/node`.

All commands run from `~/.config/superpowers/worktrees/esite/solar-phase-2b`.

**Export-name rule.** `packages/shared/src/index.ts` re-exports both `./solar` and `./tariffs` from the root, so a name defined here must not already exist in `packages/shared/src/tariffs/*` or `packages/shared/src/solar/*`. The names below were checked against both on 2026-09-28; if `tsc` reports `Module … has already exported a member named X`, rename the NEW symbol (never the 2a/1c one).

---

### Task 5: Labels and money formatting

**Files:**
- Create: `packages/shared/src/solar/tariff/labels.ts`
- Test: `packages/shared/src/solar/tariff/labels.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { UNIT_LABELS, COMPONENT_LABELS, formatRandAmount, formatChargeAmount, TOU_LABELS, SEASON_LABELS } from './labels'
import { TARIFF_UNITS, CHARGE_COMPONENTS } from '../../tariffs/types'

describe('tariff labels', () => {
  it('labels every stored unit and component (no raw enum reaches the screen)', () => {
    for (const u of TARIFF_UNITS) expect(UNIT_LABELS[u]).toBeTruthy()
    for (const c of CHARGE_COMPONENTS) expect(COMPONENT_LABELS[c]).toBeTruthy()
    expect(TOU_LABELS.off_peak).toBe('Off-peak')
    expect(SEASON_LABELS.high).toBe('High demand (winter)')
  })
  it('formats rand with two decimals and comma thousands, never locale-dependent', () => {
    expect(formatRandAmount(3000)).toBe('R3,000.00')
    expect(formatRandAmount(1234567.891)).toBe('R1,234,567.89')
    expect(formatRandAmount(-12.5)).toBe('-R12.50')
    expect(formatRandAmount(0)).toBe('R0.00')
  })
  it('formats a charge amount with its unit', () => {
    expect(formatChargeAmount(250, 'c_per_kWh')).toBe('250.00 c/kWh')
    expect(formatChargeAmount(1.8423, 'R_per_kWh')).toBe('R1.8423/kWh')
    expect(formatChargeAmount(400, 'R_per_month')).toBe('R400.00/month')
    expect(formatChargeAmount(12.5, 'pct')).toBe('12.50 %')
  })
})
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/tariff/labels.test.ts`
Expected: FAIL — `Cannot find module './labels'`.

- [ ] **Step 3: Implement**

```ts
/**
 * Display vocabulary for the Tariff tab and the tariff library (spec §0.4
 * rule 3: every number shows its unit; units are stored, never inferred).
 * Deterministic formatting: no Intl, no locale.
 */
import type { ChargeComponent, TariffCategory, TariffSeason, TariffUnit, TouOrAll } from '../../tariffs/types'

export const UNIT_LABELS: Record<TariffUnit, string> = {
  c_per_kWh: 'c/kWh',
  R_per_kWh: 'R/kWh',
  R_per_month: 'R/month',
  R_per_day: 'R/day',
  R_per_kVA_month: 'R/kVA/month',
  R_per_kW_month: 'R/kW/month',
  R_per_A_month: 'R/A/month',
  c_per_kVArh: 'c/kVArh',
  R_per_POD_day: 'R/POD/day',
  pct: '%',
}

export const COMPONENT_LABELS: Record<ChargeComponent, string> = {
  energy: 'Energy',
  legacy: 'Legacy charge',
  basic: 'Basic charge',
  service: 'Service charge',
  admin: 'Administration charge',
  network_capacity: 'Network capacity',
  network_demand: 'Network demand',
  transmission_network: 'Transmission network',
  gcc: 'Generation capacity (GCC)',
  ancillary: 'Ancillary service',
  ers: 'Electrification & rural subsidy',
  affordability: 'Affordability subsidy',
  lv_subsidy: 'LV subsidy',
  reactive: 'Reactive energy',
  demand: 'Demand',
  capacity_amp: 'Capacity (per amp)',
  export_credit: 'Export credit',
  wheeling_uos: 'Wheeling use-of-system',
  loss_factor: 'Loss factor',
  other: 'Other',
}

export const CATEGORY_LABELS: Record<TariffCategory, string> = {
  domestic: 'Domestic',
  commercial: 'Commercial',
  industrial: 'Industrial',
  agricultural: 'Agricultural',
  bulk: 'Bulk',
  public_lighting: 'Public lighting',
  sseg: 'SSEG / export',
  wheeling: 'Wheeling',
  other: 'Other',
}

export const SEASON_LABELS: Record<TariffSeason, string> = {
  all: 'All year',
  high: 'High demand (winter)',
  low: 'Low demand (summer)',
}

export const TOU_LABELS: Record<TouOrAll, string> = {
  all: 'All hours',
  peak: 'Peak',
  standard: 'Standard',
  off_peak: 'Off-peak',
}

function groupThousands(s: string): string {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** "R3,000.00"; negative as "-R12.50". Half away from zero at the cent. */
export function formatRandAmount(x: number): string {
  const neg = x < 0
  const cents = Math.round(Math.abs(x) * 100)
  const whole = Math.floor(cents / 100)
  const frac = String(cents % 100).padStart(2, '0')
  return `${neg && cents !== 0 ? '-' : ''}R${groupThousands(String(whole))}.${frac}`
}

/** A stored rate with its unit. Rand-per-kWh keeps 4 dp (tariff books publish 4). */
export function formatChargeAmount(amount: number, unit: TariffUnit): string {
  if (unit === 'c_per_kWh' || unit === 'c_per_kVArh') return `${amount.toFixed(2)} ${UNIT_LABELS[unit]}`
  if (unit === 'pct') return `${amount.toFixed(2)} %`
  if (unit === 'R_per_kWh') return `R${amount.toFixed(4)}/kWh`
  return `${formatRandAmount(amount)}${UNIT_LABELS[unit].slice(1)}`
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/tariff/labels.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/solar/tariff/labels.ts packages/shared/src/solar/tariff/labels.test.ts
git commit -m "feat(solar-tariff): unit, component and money display labels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Tariff eligibility and grouping (the Tariff picker)

**Files:**
- Create: `packages/shared/src/solar/tariff/eligibility.ts`
- Test: `packages/shared/src/solar/tariff/eligibility.test.ts`

Voltage bands are the strings 2a's `voltageBandFromText` writes (`lt_500v`, `500v_22kv`, `500v_66kv`, `66kv_132kv`, `gt_132kv`). A band this module does not know (free text from a municipal book) is **not** used to exclude a tariff — excluding on a guess would hide the right tariff.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { voltageBandsFor, eligibilityReasons, groupTariffs, type TariffListItem } from './eligibility'

const t = (p: Partial<TariffListItem>): TariffListItem => ({
  id: p.name ?? 'x', code: null, name: 'Tariff', category: 'commercial', metering: 'conventional', structure: 'tou',
  voltageBand: null, phase: null, minKva: null, maxKva: null, minAmps: null, maxAmps: null, isLegacy: false,
  exportTariffId: null, ...p,
})

describe('voltageBandsFor', () => {
  it('maps a supply voltage to every Eskom band containing it', () => {
    expect(voltageBandsFor(400)).toEqual(['lt_500v'])
    expect(voltageBandsFor(11000)).toEqual(['500v_22kv', '500v_66kv'])
    expect(voltageBandsFor(33000)).toEqual(['500v_66kv'])
    expect(voltageBandsFor(132000)).toEqual(['66kv_132kv'])
    expect(voltageBandsFor(275000)).toEqual(['gt_132kv'])
    expect(voltageBandsFor(null)).toBeNull()
  })
})

describe('eligibilityReasons', () => {
  const supply = { nmdKva: 500, supplyVoltageV: 11000 }
  it('eligible when NMD and voltage fit', () => {
    expect(eligibilityReasons(t({ minKva: 100, maxKva: 1000, voltageBand: '500v_22kv' }), supply)).toEqual([])
  })
  it('names the NMD limit it breaks', () => {
    expect(eligibilityReasons(t({ maxKva: 100 }), supply)).toEqual(['NMD 500 kVA is above the 100 kVA maximum'])
    expect(eligibilityReasons(t({ minKva: 1000 }), supply)).toEqual(['NMD 500 kVA is below the 1000 kVA minimum'])
  })
  it('names a voltage mismatch, but never excludes on an unknown band string', () => {
    expect(eligibilityReasons(t({ voltageBand: 'lt_500v' }), supply)).toEqual(['Supply at 11 kV is outside this tariff\'s voltage band'])
    expect(eligibilityReasons(t({ voltageBand: 'LV three phase' }), supply)).toEqual([])
  })
  it('legacy and export tariffs are never offered as the supply tariff by default', () => {
    expect(eligibilityReasons(t({ isLegacy: true }), supply)).toEqual(['Legacy tariff (closed to new customers)'])
    expect(eligibilityReasons(t({ category: 'sseg' }), supply)).toEqual(['Export (SSEG) tariff: applied through the export rule'])
  })
  it('unknown NMD or voltage excludes nothing', () => {
    expect(eligibilityReasons(t({ maxKva: 1, voltageBand: 'gt_132kv' }), { nmdKva: null, supplyVoltageV: null })).toEqual([])
  })
})

describe('groupTariffs', () => {
  const items = [
    t({ id: 'a', name: 'Megaflex', category: 'industrial', minKva: 1000 }),
    t({ id: 'b', name: 'Miniflex', category: 'commercial', maxKva: 5000 }),
    t({ id: 'c', name: 'Businessrate', category: 'commercial', structure: 'flat', maxKva: 100 }),
    t({ id: 'd', name: 'Homeflex', category: 'domestic', metering: 'prepaid', phase: 'single' }),
  ]
  const supply = { nmdKva: 500, supplyVoltageV: 400 }
  it('shows only eligible tariffs by default, grouped in category order, with a hidden count', () => {
    const g = groupTariffs(items, { supply, showAll: false, query: '', metering: null, phase: null })
    expect(g.groups.map((x) => [x.category, x.tariffs.map((y) => y.id)])).toEqual([['domestic', ['d']], ['commercial', ['b']]])
    expect(g.hiddenCount).toBe(2)
  })
  it('Show all lists the ineligible ones with their reasons', () => {
    const g = groupTariffs(items, { supply, showAll: true, query: '', metering: null, phase: null })
    const mega = g.groups.flatMap((x) => x.tariffs).find((x) => x.id === 'a')!
    expect(mega.eligible).toBe(false)
    expect(mega.reasons).toEqual(['NMD 500 kVA is below the 1000 kVA minimum'])
    expect(g.hiddenCount).toBe(0)
  })
  it('filters by search text, metering and phase', () => {
    expect(groupTariffs(items, { supply, showAll: true, query: 'flex', metering: null, phase: null }).groups.flatMap((x) => x.tariffs).map((x) => x.id).sort()).toEqual(['a', 'b', 'd'])
    expect(groupTariffs(items, { supply, showAll: true, query: '', metering: 'prepaid', phase: null }).groups.flatMap((x) => x.tariffs).map((x) => x.id)).toEqual(['d'])
    expect(groupTariffs(items, { supply, showAll: true, query: '', metering: null, phase: 'three' }).groups.flatMap((x) => x.tariffs).map((x) => x.id).sort()).toEqual(['a', 'b', 'c'])
  })
})
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/tariff/eligibility.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * Tariff picker eligibility (spec §5 "Tariff" row): only tariffs whose
 * eligibility matches the study's NMD and supply voltage are shown; the rest
 * sit under "Show all" with the reason. Unknown facts exclude nothing.
 */
import { TARIFF_CATEGORIES, type TariffCategory, type TariffMetering, type TariffStructure } from '../../tariffs/types'
import { CATEGORY_LABELS } from './labels'

export interface TariffListItem {
  id: string
  code: string | null
  name: string
  category: TariffCategory
  metering: TariffMetering
  structure: TariffStructure
  voltageBand: string | null
  phase: 'single' | 'three' | null
  minKva: number | null
  maxKva: number | null
  minAmps: number | null
  maxAmps: number | null
  isLegacy: boolean
  exportTariffId: string | null
}

export interface SupplyFacts {
  nmdKva: number | null
  supplyVoltageV: number | null
}

const KNOWN_BANDS: ReadonlySet<string> = new Set(['lt_500v', '500v_22kv', '500v_66kv', '66kv_132kv', 'gt_132kv'])

export function voltageBandsFor(volts: number | null): string[] | null {
  if (volts === null || !Number.isFinite(volts) || volts <= 0) return null
  if (volts < 500) return ['lt_500v']
  const out: string[] = []
  if (volts <= 22000) out.push('500v_22kv')
  if (volts < 66000) out.push('500v_66kv')
  if (volts >= 66000 && volts <= 132000) out.push('66kv_132kv')
  if (volts > 132000) out.push('gt_132kv')
  return out
}

function formatVolts(v: number): string {
  return v >= 1000 ? `${v / 1000} kV` : `${v} V`
}

export function eligibilityReasons(t: TariffListItem, s: SupplyFacts): string[] {
  const reasons: string[] = []
  if (t.category === 'sseg') reasons.push('Export (SSEG) tariff: applied through the export rule')
  if (t.isLegacy) reasons.push('Legacy tariff (closed to new customers)')
  if (s.nmdKva !== null) {
    if (t.minKva !== null && s.nmdKva < t.minKva) reasons.push(`NMD ${s.nmdKva} kVA is below the ${t.minKva} kVA minimum`)
    if (t.maxKva !== null && s.nmdKva > t.maxKva) reasons.push(`NMD ${s.nmdKva} kVA is above the ${t.maxKva} kVA maximum`)
  }
  const bands = voltageBandsFor(s.supplyVoltageV)
  if (bands && t.voltageBand && KNOWN_BANDS.has(t.voltageBand) && !bands.includes(t.voltageBand)) {
    reasons.push(`Supply at ${formatVolts(s.supplyVoltageV as number)} is outside this tariff's voltage band`)
  }
  return reasons
}

export interface TariffPickerOptions {
  supply: SupplyFacts
  showAll: boolean
  query: string
  metering: TariffMetering | null
  phase: 'single' | 'three' | null
}

export type PickerTariff = TariffListItem & { eligible: boolean; reasons: string[] }

export interface TariffPickerGroups {
  groups: Array<{ category: TariffCategory; label: string; tariffs: PickerTariff[] }>
  /** Matching the filters but hidden because ineligible (0 when showAll). */
  hiddenCount: number
}

export function groupTariffs(items: readonly TariffListItem[], o: TariffPickerOptions): TariffPickerGroups {
  const q = o.query.trim().toLowerCase()
  let hiddenCount = 0
  const kept: PickerTariff[] = []
  for (const t of items) {
    if (q && !t.name.toLowerCase().includes(q) && !(t.code ?? '').toLowerCase().includes(q)) continue
    if (o.metering && t.metering !== o.metering && t.metering !== 'both') continue
    if (o.phase && t.phase !== null && t.phase !== o.phase) continue
    const reasons = eligibilityReasons(t, o.supply)
    const eligible = reasons.length === 0
    if (!eligible && !o.showAll) {
      hiddenCount++
      continue
    }
    kept.push({ ...t, eligible, reasons })
  }
  const groups = TARIFF_CATEGORIES
    .map((category) => ({
      category,
      label: CATEGORY_LABELS[category],
      tariffs: kept.filter((t) => t.category === category).sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((g) => g.tariffs.length > 0)
  return { groups, hiddenCount }
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/tariff/eligibility.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/solar/tariff/eligibility.ts packages/shared/src/solar/tariff/eligibility.test.ts
git commit -m "feat(solar-tariff): tariff picker eligibility on NMD and voltage band

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Financial-year choice and the escalation path (D-07)

**Files:**
- Create: `packages/shared/src/solar/tariff/financial-years.ts`
- Create: `packages/shared/src/solar/tariff/escalation.ts`
- Test: `packages/shared/src/solar/tariff/financial-years.test.ts`
- Test: `packages/shared/src/solar/tariff/escalation.test.ts`

The escalation defaults reuse Phase 4a's `escalationRate` (engine spec §7) so the table the user sees and the cashflow the engine runs are the same function. Rows are **year n → %** for n = 2 … analysis years (year 1 is the pinned tariff itself). Precedence per row: user override → approved increase of the next published financial year(s) (consecutive only; a gap ends the published run) → org default path.

- [ ] **Step 1: Write the failing tests**

`financial-years.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { financialYearOn, pickDefaultYear, yearOptionLabel, regimeForLicenseeKind, type TariffYearOption } from './financial-years'

const y = (fy: string, from: string, to: string, state: 'published' | 'superseded' = 'published'): TariffYearOption =>
  ({ id: fy, financialYear: fy, state, effectiveFrom: from, effectiveTo: to, approvedIncreasePct: null })

describe('financial years', () => {
  it('computes the year covering a date per regime', () => {
    expect(financialYearOn('2026-03-31', 'eskom')).toBe('2025/26')
    expect(financialYearOn('2026-04-01', 'eskom')).toBe('2026/27')
    expect(financialYearOn('2026-06-30', 'municipal')).toBe('2025/26')
    expect(financialYearOn('2026-07-01', 'municipal')).toBe('2026/27')
  })
  it('regime from licensee kind: Eskom vs everyone else', () => {
    expect(regimeForLicenseeKind('eskom')).toBe('eskom')
    expect(regimeForLicenseeKind('metro')).toBe('municipal')
  })
  it('labels superseded years', () => {
    expect(yearOptionLabel(y('2024/25', '2024-07-01', '2025-06-30', 'superseded'))).toBe('2024/25 (superseded)')
  })
  it('defaults to the year covering today', () => {
    const ys = [y('2025/26', '2025-07-01', '2026-06-30'), y('2024/25', '2024-07-01', '2025-06-30', 'superseded')]
    expect(pickDefaultYear(ys, '2026-01-10', 'municipal')).toEqual({ yearId: '2025/26', note: null })
  })
  it('falls back to the latest year with the amber note when today is not covered', () => {
    const ys = [y('2025/26', '2025-07-01', '2026-06-30')]
    expect(pickDefaultYear(ys, '2026-08-01', 'municipal')).toEqual({
      yearId: '2025/26', note: '2026/27 not yet published in the library — using 2025/26 with escalation',
    })
    expect(pickDefaultYear([], '2026-08-01', 'municipal')).toEqual({ yearId: null, note: null })
  })
})
```

`escalation.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  buildEscalationRows, escalationSettingsFrom, parseStoredEscalation, validateEscalationOverrides, escalationPathFromRows,
} from './escalation'
import { escalationRate } from '../../services/solar/finance/factors'

const settings = escalationSettingsFrom({ cpi_pct: 5, escalation_start_pct: 9, escalation_year10_pct: 7, escalation_after_cpi_plus_pct: 1, analysis_years: 12 })

describe('escalation path (D-07)', () => {
  it('defaults: 9 % in year 2, linear to 7 % in year 10, then CPI + 1 %', () => {
    const rows = buildEscalationRows({ pinnedFinancialYear: null, published: [], settings, stored: null })
    expect(rows.map((r) => r.year)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(rows[0]).toEqual({ year: 2, pct: 9, source: 'default', financialYear: null })
    expect(rows.find((r) => r.year === 10)!.pct).toBe(7)
    expect(rows.find((r) => r.year === 6)!.pct).toBe(8)
    expect(rows.find((r) => r.year === 11)!.pct).toBe(6)
  })
  it('uses the approved increase of consecutive published years after the pinned year', () => {
    const rows = buildEscalationRows({
      pinnedFinancialYear: '2025/26',
      published: [{ financialYear: '2026/27', approvedIncreasePct: 12.74 }, { financialYear: '2028/29', approvedIncreasePct: 5 }],
      settings, stored: null,
    })
    expect(rows[0]).toEqual({ year: 2, pct: 12.74, source: 'published', financialYear: '2026/27' })
    // 2027/28 is missing: the published run ends; year 3 is the default path, 2028/29 is NOT used out of order.
    expect(rows[1]).toEqual({ year: 3, pct: 8.75, source: 'default', financialYear: null })
  })
  it('a user override wins', () => {
    const rows = buildEscalationRows({ pinnedFinancialYear: null, published: [], settings, stored: { version: 1, overrides: { '3': 15 } } })
    expect(rows[1]).toEqual({ year: 3, pct: 15, source: 'override', financialYear: null })
  })
  it('the engine path reproduces the table exactly', () => {
    const rows = buildEscalationRows({ pinnedFinancialYear: null, published: [], settings, stored: { version: 1, overrides: { '4': 20 } } })
    const path = escalationPathFromRows(rows, settings)
    for (const r of rows) expect(Math.round(escalationRate(r.year, path, 0.05) * 100 * 1000) / 1000).toBe(r.pct)
  })
  it('parses stored JSON defensively', () => {
    expect(parseStoredEscalation(null)).toBeNull()
    expect(parseStoredEscalation({ version: 1, overrides: { '2': 10, x: 3, '3': 'a' } })).toEqual({ version: 1, overrides: { '2': 10 } })
  })
  it('validates the override form', () => {
    expect(validateEscalationOverrides({ '2': '10,5', '3': '', '4': 'abc', '40': '1' }, 12)).toEqual({
      overrides: { '2': 10.5 },
      errors: { '4': 'Enter a percentage', '40': 'Year 40 is outside the 12-year analysis' },
    })
    expect(validateEscalationOverrides({ '2': '150' }, 12).errors).toEqual({ '2': 'Must be between -50 and 100 %' })
  })
})
```

- [ ] **Step 2: Run them — expect FAIL**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/tariff/financial-years.test.ts src/solar/tariff/escalation.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `financial-years.ts`**

```ts
/**
 * Financial-year choice on the Tariff tab (spec §5 "Financial year"): default
 * to the published year covering today; when none covers it, the latest year
 * with the amber note. Eskom years start 1 April, municipal 1 July.
 */
import type { TariffRegime } from '../../tariffs/financial-year'
import type { LicenseeKind } from '../../tariffs/types'

export interface TariffYearOption {
  id: string
  financialYear: string
  state: 'published' | 'superseded'
  effectiveFrom: string
  effectiveTo: string
  approvedIncreasePct: number | null
}

export function regimeForLicenseeKind(kind: LicenseeKind): TariffRegime {
  return kind === 'eskom' ? 'eskom' : 'municipal'
}

export function financialYearOn(dateIso: string, regime: TariffRegime): string {
  const [y, m] = dateIso.slice(0, 10).split('-').map(Number)
  const start = m >= (regime === 'eskom' ? 4 : 7) ? y : y - 1
  return `${start}/${String((start + 1) % 100).padStart(2, '0')}`
}

export function yearOptionLabel(y: Pick<TariffYearOption, 'financialYear' | 'state'>): string {
  return y.state === 'superseded' ? `${y.financialYear} (superseded)` : y.financialYear
}

export function pickDefaultYear(
  years: readonly TariffYearOption[], todayIso: string, regime: TariffRegime,
): { yearId: string | null; note: string | null } {
  if (years.length === 0) return { yearId: null, note: null }
  const today = todayIso.slice(0, 10)
  const covering = years.find((y) => y.effectiveFrom <= today && today <= y.effectiveTo)
  if (covering) return { yearId: covering.id, note: null }
  const latest = [...years].sort((a, b) => b.financialYear.localeCompare(a.financialYear))[0]
  const want = financialYearOn(today, regime)
  if (latest.financialYear < want) {
    return { yearId: latest.id, note: `${want} not yet published in the library — using ${latest.financialYear} with escalation` }
  }
  return { yearId: latest.id, note: null }
}
```

- [ ] **Step 4: Implement `escalation.ts`**

```ts
/**
 * Tariff escalation path (spec §5 "Escalation path"; D-07). Year n -> %
 * for n = 2..analysis years. Defaults come from Phase 4a's escalationRate so
 * the table and the cashflow are the same function.
 */
import { escalationRate, type EscalationPath } from '../../services/solar/finance/factors'
import { parseFinancialYear } from '../../tariffs/financial-year'

export interface EscalationSettings {
  cpiPct: number
  startPct: number
  year10Pct: number
  afterCpiPlusPct: number
  analysisYears: number
}

export interface StoredEscalation {
  version: 1
  overrides: Record<string, number>
}

export type EscalationSource = 'published' | 'default' | 'override'

export interface EscalationRow {
  year: number
  pct: number
  source: EscalationSource
  /** The financial year whose approved increase this is (published rows). */
  financialYear: string | null
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000

/** From readSolarOrgSettings() values (1c); a missing value falls back to the D-07 default. */
export function escalationSettingsFrom(values: Record<string, number | boolean | null | undefined>): EscalationSettings {
  const n = (k: string, d: number): number => (typeof values[k] === 'number' ? (values[k] as number) : d)
  return {
    cpiPct: n('cpi_pct', 5),
    startPct: n('escalation_start_pct', 9),
    year10Pct: n('escalation_year10_pct', 7),
    afterCpiPlusPct: n('escalation_after_cpi_plus_pct', 1),
    analysisYears: n('analysis_years', 25),
  }
}

export function parseStoredEscalation(v: unknown): StoredEscalation | null {
  if (!v || typeof v !== 'object') return null
  const o = (v as { overrides?: unknown }).overrides
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null
  const overrides: Record<string, number> = {}
  for (const [k, x] of Object.entries(o as Record<string, unknown>)) {
    if (/^\d+$/.test(k) && typeof x === 'number' && Number.isFinite(x)) overrides[k] = x
  }
  return { version: 1, overrides }
}

function nextFinancialYear(fy: string): string {
  const s = parseFinancialYear(fy).startYear + 1
  return `${s}/${String((s + 1) % 100).padStart(2, '0')}`
}

function defaultPath(s: EscalationSettings): EscalationPath {
  return { published: [], startRate: s.startPct / 100, endRate: s.year10Pct / 100, linearToYear: 10, cpiMargin: s.afterCpiPlusPct / 100 }
}

export function buildEscalationRows(input: {
  pinnedFinancialYear: string | null
  published: ReadonlyArray<{ financialYear: string; approvedIncreasePct: number | null }>
  settings: EscalationSettings
  stored: StoredEscalation | null
}): EscalationRow[] {
  const approved: Array<{ fy: string; pct: number }> = []
  if (input.pinnedFinancialYear) {
    const byFy = new Map(input.published.map((p) => [p.financialYear, p.approvedIncreasePct]))
    let fy = input.pinnedFinancialYear
    for (;;) {
      fy = nextFinancialYear(fy)
      const pct = byFy.get(fy)
      if (pct === undefined || pct === null) break
      approved.push({ fy, pct })
    }
  }
  const s = input.settings
  const path = defaultPath(s)
  const rows: EscalationRow[] = []
  for (let n = 2; n <= s.analysisYears; n++) {
    const o = input.stored?.overrides[String(n)]
    const pub = approved[n - 2]
    if (o !== undefined) rows.push({ year: n, pct: round3(o), source: 'override', financialYear: pub?.fy ?? null })
    else if (pub) rows.push({ year: n, pct: round3(pub.pct), source: 'published', financialYear: pub.fy })
    else rows.push({ year: n, pct: round3(escalationRate(n, path, s.cpiPct / 100) * 100), source: 'default', financialYear: null })
  }
  return rows
}

/** The engine's EscalationPath carrying the table verbatim (every year explicit). */
export function escalationPathFromRows(rows: readonly EscalationRow[], s: EscalationSettings): EscalationPath {
  return { ...defaultPath(s), published: [...rows].sort((a, b) => a.year - b.year).map((r) => r.pct / 100) }
}

export function validateEscalationOverrides(
  form: Record<string, string>, analysisYears: number,
): { overrides: Record<string, number>; errors: Record<string, string> } {
  const overrides: Record<string, number> = {}
  const errors: Record<string, string> = {}
  for (const [k, raw] of Object.entries(form)) {
    const s = String(raw ?? '').trim().replace(',', '.')
    const n = Number(k)
    if (!/^\d+$/.test(k) || n < 2 || n > analysisYears) {
      errors[k] = `Year ${k} is outside the ${analysisYears}-year analysis`
      continue
    }
    if (s === '') continue
    if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) {
      errors[k] = 'Enter a percentage'
      continue
    }
    const v = Number(s)
    if (v < -50 || v > 100) {
      errors[k] = 'Must be between -50 and 100 %'
      continue
    }
    overrides[k] = v
  }
  return { overrides, errors }
}
```

⚠ Check `escalationRate(6, path, 0.05)`: linear 0.09 + (0.07 − 0.09) × (6 − 2) / 8 = 0.08 → 8 %. Year 3: 0.09 − 0.0025 = 0.0875 → 8.75 %. Year 11 (> 10): CPI 5 % + 1 % = 6 %. These are the test's numbers.

- [ ] **Step 5: Run them — expect PASS**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/tariff/financial-years.test.ts src/solar/tariff/escalation.test.ts`
Expected: PASS (5 + 6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/solar/tariff/financial-years.ts packages/shared/src/solar/tariff/financial-years.test.ts \
        packages/shared/src/solar/tariff/escalation.ts packages/shared/src/solar/tariff/escalation.test.ts
git commit -m "feat(solar-tariff): financial-year default and D-07 escalation path table

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Export rule and manual export rates

**Files:**
- Create: `packages/shared/src/solar/tariff/export-rule.ts`
- Test: `packages/shared/src/solar/tariff/export-rule.test.ts`

`studies.export_rule` holds only the METHOD and the provenance note (it is readable at View). The rand rate lives in the money table `solar.study_export_rates` (plan D2b-2).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { parseExportRule, defaultExportRule, exportMethodsFor, validateExportRuleForm, manualExportTariff, type ExportRuleForm } from './export-rule'

const manual = (over: Partial<ExportRuleForm> = {}): ExportRuleForm => ({
  method: 'manual', sourceNote: 'City of Tshwane SSEG schedule 2026/27 p4',
  rates: [{ season: 'all', tou: 'all', unit: 'c_per_kWh', amount: '95,5' }], ...over,
})

describe('export rule', () => {
  it('parses stored JSON and rejects junk', () => {
    expect(parseExportRule({ version: 1, method: 'none' })).toEqual({ version: 1, method: 'none', sourceNote: null })
    expect(parseExportRule({ method: 'cash' })).toBeNull()
    expect(parseExportRule(null)).toBeNull()
  })
  it('offers the linked Gen-offset method only when the tariff has one; defaults to it, else R0', () => {
    expect(exportMethodsFor(true)).toEqual(['linked_tariff', 'none', 'manual'])
    expect(exportMethodsFor(false)).toEqual(['none', 'manual'])
    expect(defaultExportRule(true).method).toBe('linked_tariff')
    expect(defaultExportRule(false).method).toBe('none')
  })
  it('manual: a source note is mandatory, rates parse with a decimal comma', () => {
    expect(validateExportRuleForm(manual(), false)).toEqual({
      rule: { version: 1, method: 'manual', sourceNote: 'City of Tshwane SSEG schedule 2026/27 p4' },
      rates: [{ season: 'all', tou: 'all', unit: 'c_per_kWh', amountExclVat: 95.5 }],
    })
    expect(validateExportRuleForm(manual({ sourceNote: '  ' }), false)).toEqual({ errors: { sourceNote: 'Say where this rate comes from (document and page)' } })
    expect(validateExportRuleForm(manual({ rates: [] }), false)).toEqual({ errors: { rates: 'Enter at least one export rate' } })
  })
  it('manual: refuses duplicate periods, negative and implausible rates', () => {
    const r = { season: 'all' as const, tou: 'all' as const, unit: 'c_per_kWh' as const }
    expect(validateExportRuleForm(manual({ rates: [{ ...r, amount: '90' }, { ...r, amount: '91' }] }), false))
      .toEqual({ errors: { 'rates.1': 'This season and period already has a rate' } })
    expect(validateExportRuleForm(manual({ rates: [{ ...r, amount: '-1' }] }), false)).toEqual({ errors: { 'rates.0': 'Enter a rate of 0 or more' } })
    expect(validateExportRuleForm(manual({ rates: [{ ...r, unit: 'R_per_kWh', amount: '95' }] }), false))
      .toEqual({ errors: { 'rates.0': 'R95/kWh is not a plausible export rate (0 to 15 R/kWh)' } })
  })
  it('linked is refused when the tariff has no export tariff', () => {
    expect(validateExportRuleForm({ method: 'linked_tariff', sourceNote: '', rates: [] }, false))
      .toEqual({ errors: { method: 'This tariff has no linked export tariff' } })
  })
  it('none and linked store no rates', () => {
    expect(validateExportRuleForm({ method: 'none', sourceNote: '', rates: [] }, true))
      .toEqual({ rule: { version: 1, method: 'none', sourceNote: null }, rates: [] })
  })
  it('builds an export tariff the bill engine can use', () => {
    const t = manualExportTariff([{ season: 'all', tou: 'peak', unit: 'c_per_kWh', amountExclVat: 120 }], 'note')
    expect(t.structure).toBe('tou')
    expect(t.charges[0]).toMatchObject({ component: 'export_credit', tou: 'peak', unit: 'c_per_kWh', amountExclVat: 120, extractionMethod: 'manual' })
  })
})
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/tariff/export-rule.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * Export / SSEG rule on the Tariff tab (spec §5). Eskom: the tariff's linked
 * Gen-offset export tariff. Municipal: the NERSA books publish no export
 * rates, so "No export credit (R0)" (default) or a manually entered rate with
 * a mandatory source note. The rate is money: it is stored in
 * solar.study_export_rates, not in studies.export_rule.
 */
import { makeCharge, makeTariff, type Tariff } from '../../tariffs/types'
import { randPerKwh } from '../../tariffs/units'

export const EXPORT_METHODS = ['linked_tariff', 'none', 'manual'] as const
export type ExportMethod = (typeof EXPORT_METHODS)[number]

export const EXPORT_METHOD_LABELS: Record<ExportMethod, string> = {
  linked_tariff: 'Linked export tariff (published)',
  none: 'No export credit (R0)',
  manual: 'Enter export rate manually',
}

export interface ExportRule {
  version: 1
  method: ExportMethod
  sourceNote: string | null
}

export type ExportSeason = 'all' | 'high' | 'low'
export type ExportTou = 'all' | 'peak' | 'standard' | 'off_peak'

export interface ExportRateRow {
  season: ExportSeason
  tou: ExportTou
  unit: 'c_per_kWh' | 'R_per_kWh'
  amountExclVat: number
}

export interface ExportRuleForm {
  method: ExportMethod
  sourceNote: string
  rates: Array<{ season: ExportSeason; tou: ExportTou; unit: 'c_per_kWh' | 'R_per_kWh'; amount: string }>
}

export function parseExportRule(v: unknown): ExportRule | null {
  if (!v || typeof v !== 'object') return null
  const o = v as { method?: unknown; sourceNote?: unknown }
  if (typeof o.method !== 'string' || !(EXPORT_METHODS as readonly string[]).includes(o.method)) return null
  return { version: 1, method: o.method as ExportMethod, sourceNote: typeof o.sourceNote === 'string' && o.sourceNote.trim() ? o.sourceNote : null }
}

export function exportMethodsFor(hasLinkedExportTariff: boolean): ExportMethod[] {
  return hasLinkedExportTariff ? ['linked_tariff', 'none', 'manual'] : ['none', 'manual']
}

export function defaultExportRule(hasLinkedExportTariff: boolean): ExportRule {
  return { version: 1, method: hasLinkedExportTariff ? 'linked_tariff' : 'none', sourceNote: null }
}

const MAX_EXPORT_RAND_PER_KWH = 15

export function validateExportRuleForm(
  form: ExportRuleForm, hasLinkedExportTariff: boolean,
): { rule: ExportRule; rates: ExportRateRow[] } | { errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  if (!(EXPORT_METHODS as readonly string[]).includes(form.method)) return { errors: { method: 'Choose how exported energy is credited' } }
  if (form.method === 'linked_tariff' && !hasLinkedExportTariff) return { errors: { method: 'This tariff has no linked export tariff' } }
  if (form.method !== 'manual') return { rule: { version: 1, method: form.method, sourceNote: null }, rates: [] }

  const note = form.sourceNote.trim()
  if (!note) errors.sourceNote = 'Say where this rate comes from (document and page)'
  else if (note.length > 500) errors.sourceNote = 'Keep the source note under 500 characters'
  if (form.rates.length === 0) errors.rates = 'Enter at least one export rate'
  const seen = new Set<string>()
  const rates: ExportRateRow[] = []
  form.rates.forEach((r, i) => {
    const key = `${r.season}|${r.tou}`
    if (seen.has(key)) {
      errors[`rates.${i}`] = 'This season and period already has a rate'
      return
    }
    seen.add(key)
    const s = String(r.amount ?? '').trim().replace(',', '.')
    const n = Number(s)
    if (s === '' || !Number.isFinite(n) || n < 0) {
      errors[`rates.${i}`] = 'Enter a rate of 0 or more'
      return
    }
    const rand = randPerKwh({ unit: r.unit, amountExclVat: n })
    if (rand > MAX_EXPORT_RAND_PER_KWH) {
      errors[`rates.${i}`] = `${r.unit === 'R_per_kWh' ? `R${n}/kWh` : `${n} c/kWh`} is not a plausible export rate (0 to ${MAX_EXPORT_RAND_PER_KWH} R/kWh)`
      return
    }
    rates.push({ season: r.season, tou: r.tou, unit: r.unit, amountExclVat: n })
  })
  if (Object.keys(errors).length > 0) return { errors }
  return { rule: { version: 1, method: 'manual', sourceNote: note }, rates }
}

/** The user-supplied rates as an export tariff for the bill engine (CostOptions.exportTariff). */
export function manualExportTariff(rates: readonly ExportRateRow[], sourceNote: string): Tariff {
  const tou = rates.some((r) => r.tou !== 'all')
  return makeTariff({
    name: 'Project export rate (user-supplied)',
    category: 'sseg',
    structure: tou ? 'tou' : 'flat',
    charges: rates.map((r) => makeCharge({
      component: 'export_credit', unit: r.unit, amountExclVat: r.amountExclVat, season: r.season, tou: r.tou,
      vatBasis: 'stated_excl', extractionMethod: 'manual', sourceLocator: { label: sourceNote },
    })),
  })
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/tariff/export-rule.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/solar/tariff/export-rule.ts packages/shared/src/solar/tariff/export-rule.test.ts
git commit -m "feat(solar-tariff): export rule methods and manual export rates with provenance

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Project override rows (D-10)

**Files:**
- Create: `packages/shared/src/solar/tariff/override.ts`
- Test: `packages/shared/src/solar/tariff/override.test.ts`

Plausibility = "the same ranges as ingestion" (spec §5 "Override row edit"): the unit must be compatible with the component (2a's `unitCompatible`) and the single charge must pass 2a's `validateTariff` checks `energy_out_of_range`, `fixed_unit`, `non_numeric`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { overrideChargeFromDb, overrideToTariff, validateOverrideEdit, validateRateEdit } from './override'
import { makeCharge, makeTariff } from '../../tariffs/types'

const dbRow = {
  id: 'oc1', base_charge_id: 'c1', component: 'energy', season: 'all', tou: 'all', day_type: 'all',
  block_min_kwh: null, block_max_kwh: null, block_basis: null, unit: 'c_per_kWh', demand_basis: null,
  amount_excl_vat: '250.000000', vat_rate: '0.1500', vat_basis: 'stated_excl', source_locator: { page: 3 },
  reason: null, edited_at: null, edited_by: null, updated_at: 'T1',
}

describe('override rows', () => {
  it('reads numbers from PostgREST strings', () => {
    expect(overrideChargeFromDb(dbRow)).toMatchObject({ id: 'oc1', amountExclVat: 250, vatRate: 0.15, unit: 'c_per_kWh', updatedAt: 'T1' })
  })
  it('the engine sees the override charges with the base tariff metadata', () => {
    const base = makeTariff({ name: 'Commercial', structure: 'flat', charges: [makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 250 })] })
    const t = overrideToTariff(base, [{ ...overrideChargeFromDb(dbRow), amountExclVat: 199 }])
    expect(t.name).toBe('Commercial')
    expect(t.charges).toHaveLength(1)
    expect(t.charges[0]).toMatchObject({ component: 'energy', amountExclVat: 199, extractionMethod: 'manual' })
  })
  it('an edit needs an amount, a compatible unit and a reason', () => {
    const row = { component: 'energy' as const, season: 'all' as const }
    expect(validateOverrideEdit(row, { amount: '199,5', unit: 'c_per_kWh', reason: 'Lease cl. 14' }))
      .toEqual({ amountExclVat: 199.5, unit: 'c_per_kWh', reason: 'Lease cl. 14' })
    expect(validateOverrideEdit(row, { amount: '', unit: '', reason: '' })).toEqual({
      errors: { amount: 'Enter an amount', unit: 'Choose a unit', reason: 'Say why this rate differs from the published one' },
    })
    expect(validateOverrideEdit(row, { amount: '5', unit: 'R_per_month', reason: 'x' }))
      .toEqual({ errors: { unit: 'Not a valid unit for Energy: R/month' } })
  })
  it('refuses a rate outside the ingestion ranges', () => {
    expect(validateOverrideEdit({ component: 'energy', season: 'all' }, { amount: '2500', unit: 'c_per_kWh', reason: 'x' }))
      .toEqual({ errors: { amount: '2500 c/kWh is outside 50-1500 c/kWh' } })
  })
  it('the rate check alone (library review Edit) needs no reason', () => {
    expect(validateRateEdit({ component: 'basic', season: 'all' }, { amount: '400', unit: 'R_per_month' }))
      .toEqual({ amountExclVat: 400, unit: 'R_per_month' })
    expect(validateRateEdit({ component: 'basic', season: 'all' }, { amount: '400', unit: 'c_per_kWh' }))
      .toEqual({ errors: { unit: 'Not a valid unit for Basic charge: c/kWh' } })
  })
})
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/tariff/override.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * Project tariff override rows (spec §5 "Create project override", D-10
 * landlord resale). A copy of the pinned tariff's charges; an edited row
 * carries a reason (enforced again in SQL by 00214).
 */
import { unitCompatible } from '../../tariffs/parsers/normalise'
import {
  TARIFF_UNITS, makeCharge, makeTariff,
  type BlockBasis, type ChargeComponent, type ChargeDayType, type DemandBasis, type SourceLocator, type Tariff,
  type TariffSeason, type TariffUnit, type TouOrAll, type VatBasis,
} from '../../tariffs/types'
import { validateTariff } from '../../tariffs/validators'
import { COMPONENT_LABELS, UNIT_LABELS } from './labels'

export interface OverrideChargeRow {
  id: string
  baseChargeId: string | null
  component: ChargeComponent
  season: TariffSeason
  tou: TouOrAll
  dayType: ChargeDayType
  blockMinKwh: number | null
  blockMaxKwh: number | null
  blockBasis: BlockBasis | null
  unit: TariffUnit
  demandBasis: DemandBasis | null
  amountExclVat: number
  vatRate: number
  vatBasis: VatBasis
  sourceLocator: SourceLocator & { source_document_id?: string }
  reason: string | null
  editedAt: string | null
  editedBy: string | null
  updatedAt: string
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))

export function overrideChargeFromDb(r: Record<string, unknown>): OverrideChargeRow {
  return {
    id: String(r.id),
    baseChargeId: (r.base_charge_id ?? null) as string | null,
    component: r.component as ChargeComponent,
    season: r.season as TariffSeason,
    tou: r.tou as TouOrAll,
    dayType: r.day_type as ChargeDayType,
    blockMinKwh: num(r.block_min_kwh),
    blockMaxKwh: num(r.block_max_kwh),
    blockBasis: (r.block_basis ?? null) as BlockBasis | null,
    unit: r.unit as TariffUnit,
    demandBasis: (r.demand_basis ?? null) as DemandBasis | null,
    amountExclVat: Number(r.amount_excl_vat),
    vatRate: Number(r.vat_rate ?? 0.15),
    vatBasis: r.vat_basis as VatBasis,
    sourceLocator: (r.source_locator ?? {}) as OverrideChargeRow['sourceLocator'],
    reason: (r.reason ?? null) as string | null,
    editedAt: (r.edited_at ?? null) as string | null,
    editedBy: (r.edited_by ?? null) as string | null,
    updatedAt: String(r.updated_at ?? ''),
  }
}

export function overrideToTariff(base: Tariff, rows: readonly OverrideChargeRow[]): Tariff {
  return {
    ...base,
    charges: rows.map((r) => makeCharge({
      component: r.component, season: r.season, tou: r.tou, dayType: r.dayType,
      blockMinKwh: r.blockMinKwh, blockMaxKwh: r.blockMaxKwh, blockBasis: r.blockBasis,
      unit: r.unit, demandBasis: r.demandBasis, amountExclVat: r.amountExclVat, vatRate: r.vatRate, vatBasis: r.vatBasis,
      extractionMethod: 'manual', sourceLocator: r.sourceLocator,
    })),
  }
}

export interface OverrideEditForm {
  amount: string
  unit: TariffUnit | ''
  reason: string
}

const PLAUSIBILITY_CODES = new Set(['energy_out_of_range', 'fixed_unit', 'non_numeric'])

/**
 * Amount + unit of one charge, with the ingestion plausibility rules. Shared
 * by the project override editor and the library review queue's Edit.
 */
export function validateRateEdit(
  row: { component: ChargeComponent; season: TariffSeason },
  form: { amount: string; unit: TariffUnit | '' },
): { amountExclVat: number; unit: TariffUnit } | { errors: Partial<Record<'amount' | 'unit', string>> } {
  const errors: Partial<Record<'amount' | 'unit', string>> = {}
  const s = String(form.amount ?? '').trim().replace(',', '.')
  const amount = Number(s)
  if (s === '') errors.amount = 'Enter an amount'
  else if (!Number.isFinite(amount)) errors.amount = 'Enter a number'
  const unit = form.unit
  if (!unit || !(TARIFF_UNITS as readonly string[]).includes(unit)) errors.unit = 'Choose a unit'
  else if (!unitCompatible(row.component, unit)) {
    errors.unit = `Not a valid unit for ${COMPONENT_LABELS[row.component]}: ${UNIT_LABELS[unit]}`
  }
  if (Object.keys(errors).length > 0) return { errors }
  const probe = makeTariff({
    name: 'rate', structure: 'flat',
    charges: [makeCharge({ component: row.component, season: row.season, unit: unit as TariffUnit, amountExclVat: amount })],
  })
  const issue = validateTariff(probe).find((i) => i.severity === 'block' && PLAUSIBILITY_CODES.has(i.code))
  if (issue) return { errors: { amount: issue.message.replace(/^.*?(\d)/, '$1') } }
  return { amountExclVat: amount, unit: unit as TariffUnit }
}

export function validateOverrideEdit(
  row: { component: ChargeComponent; season: TariffSeason },
  form: OverrideEditForm,
): { amountExclVat: number; unit: TariffUnit; reason: string } | { errors: Partial<Record<'amount' | 'unit' | 'reason', string>> } {
  const rate = validateRateEdit(row, form)
  const reason = form.reason.trim()
  const reasonError = !reason ? 'Say why this rate differs from the published one'
    : reason.length > 500 ? 'Keep the reason under 500 characters' : null
  if ('errors' in rate || reasonError) {
    return { errors: { ...('errors' in rate ? rate.errors : {}), ...(reasonError ? { reason: reasonError } : {}) } }
  }
  return { ...rate, reason }
}
```

⚠ The `validateTariff` message for `energy_out_of_range` is `"2500 c/kWh is outside 50-1500 c/kWh"` (2a validators.ts). The `.replace(/^.*?(\d)/, '$1')` is a no-op for it and strips any prefix text for the other two codes. If 2a's message wording differs on the base, update the test expectation to the base's message — do not reword 2a.


- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/tariff/override.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/solar/tariff/override.ts packages/shared/src/solar/tariff/override.test.ts
git commit -m "feat(solar-tariff): override rows, engine view and edit validation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Bill check (one real bill against the engine)

**Files:**
- Create: `packages/shared/src/solar/tariff/bill-check.ts`
- Test: `packages/shared/src/solar/tariff/bill-check.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { validateBillCheckForm, runBillCheck, BillCheckError, BILL_CHECK_WARN_PCT, EMPTY_BILL_CHECK_FORM } from './bill-check'
import { makeCharge, makeTariff } from '../../tariffs/types'

const flat = makeTariff({ name: 'Flat', structure: 'flat', charges: [
  makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 250 }),
  makeCharge({ component: 'basic', unit: 'R_per_month', amountExclVat: 400 }),
] })

describe('bill check form', () => {
  it('flat tariff: one kWh total, counted as standard', () => {
    const r = validateBillCheckForm({ ...EMPTY_BILL_CHECK_FORM, month: '2026-03', totalKwh: '1 000', actualTotal: '3000' }, false)
    expect(r).toEqual({ input: { year: 2026, month: 3, importKwh: { peak: 0, standard: 1000, off_peak: 0 }, maxDemandKva: null, actualTotalExclVat: 3000, note: null } })
  })
  it('TOU tariff: three periods, at least one above zero', () => {
    expect(validateBillCheckForm({ ...EMPTY_BILL_CHECK_FORM, month: '2026-07', peak: '0', standard: '', offPeak: '0', actualTotal: '10' }, true))
      .toEqual({ errors: { kwh: 'Enter the kWh the bill shows' } })
  })
  it('names every missing or malformed field', () => {
    expect(validateBillCheckForm({ ...EMPTY_BILL_CHECK_FORM, month: '2026-13', totalKwh: 'x', actualTotal: '0', maxDemandKva: '-1' }, false)).toEqual({
      errors: {
        month: 'Choose the billing month', kwh: 'Enter the kWh the bill shows',
        maxDemandKva: 'Enter a demand of 0 or more', actualTotal: 'Enter the bill total (excl. VAT) above zero',
      },
    })
  })
})

describe('runBillCheck', () => {
  const input = { year: 2026, month: 3, importKwh: { peak: 0, standard: 1000, off_peak: 0 }, maxDemandKva: null, actualTotalExclVat: 3000, note: null }
  it('models the month and reports the % difference', () => {
    const r = runBillCheck(flat, input, { highSeasonMonths: null, nmdKva: null })
    expect(r.modelledTotalExclVat).toBe(2900)
    expect(r.differencePct).toBe(-3.333)
    expect(r.warn).toBe(false)
  })
  it(`warns beyond ±${BILL_CHECK_WARN_PCT} %`, () => {
    const r = runBillCheck(flat, { ...input, actualTotalExclVat: 2700 }, { highSeasonMonths: null, nmdKva: null })
    expect(r.differencePct).toBe(7.407)
    expect(r.warn).toBe(true)
  })
  it('a seasonal tariff without a calendar is refused with a sentence, never guessed', () => {
    const seasonal = makeTariff({ name: 'S', structure: 'seasonal', charges: [
      makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 300, season: 'high' }),
      makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 200, season: 'low' }),
    ] })
    expect(() => runBillCheck(seasonal, input, { highSeasonMonths: null, nmdKva: null })).toThrow(BillCheckError)
    expect(runBillCheck(seasonal, { ...input, month: 7 }, { highSeasonMonths: [6, 7, 8], nmdKva: null }).season).toBe('high')
  })
})
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/tariff/bill-check.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * Bill check (spec §5): enter one real monthly bill; the bill engine costs
 * that month's usage on the pinned (or overridden) tariff; modelled vs actual
 * and the % difference, amber beyond ±5 %.
 */
import { costMonth, type BillLine, type NotModelled } from '../../tariffs/bill-engine'
import { seasonForMonth } from '../../tariffs/tou'
import type { BillingSeason, Tariff, TouKwh } from '../../tariffs/types'

export const BILL_CHECK_WARN_PCT = 5

export interface BillCheckForm {
  month: string
  peak: string
  standard: string
  offPeak: string
  totalKwh: string
  maxDemandKva: string
  actualTotal: string
  note: string
}

export const EMPTY_BILL_CHECK_FORM: BillCheckForm = {
  month: '', peak: '', standard: '', offPeak: '', totalKwh: '', maxDemandKva: '', actualTotal: '', note: '',
}

export interface BillCheckInput {
  year: number
  month: number
  importKwh: TouKwh
  maxDemandKva: number | null
  actualTotalExclVat: number
  note: string | null
}

export type BillCheckField = 'month' | 'kwh' | 'maxDemandKva' | 'actualTotal' | 'note'

const parse = (raw: string): number | null => {
  const s = String(raw ?? '').replace(/[\s ]/g, '').replace(',', '.')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : Number.NaN
}

export function validateBillCheckForm(
  f: BillCheckForm, isTou: boolean,
): { input: BillCheckInput } | { errors: Partial<Record<BillCheckField, string>> } {
  const errors: Partial<Record<BillCheckField, string>> = {}
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(f.month.trim())
  if (!m) errors.month = 'Choose the billing month'
  let importKwh: TouKwh = { peak: 0, standard: 0, off_peak: 0 }
  if (isTou) {
    const [p, s, o] = [parse(f.peak), parse(f.standard), parse(f.offPeak)].map((v) => (v === null ? 0 : v))
    if ([p, s, o].some((v) => Number.isNaN(v) || v < 0) || p + s + o <= 0) errors.kwh = 'Enter the kWh the bill shows'
    else importKwh = { peak: p, standard: s, off_peak: o }
  } else {
    const t = parse(f.totalKwh)
    if (t === null || Number.isNaN(t) || t <= 0) errors.kwh = 'Enter the kWh the bill shows'
    else importKwh = { peak: 0, standard: t, off_peak: 0 }
  }
  const md = parse(f.maxDemandKva)
  if (md !== null && (Number.isNaN(md) || md < 0)) errors.maxDemandKva = 'Enter a demand of 0 or more'
  const total = parse(f.actualTotal)
  if (total === null || Number.isNaN(total) || total <= 0) errors.actualTotal = 'Enter the bill total (excl. VAT) above zero'
  const note = f.note.trim()
  if (note.length > 500) errors.note = 'Keep the note under 500 characters'
  if (Object.keys(errors).length > 0) return { errors }
  return {
    input: {
      year: Number(m![1]), month: Number(m![2]), importKwh,
      maxDemandKva: md, actualTotalExclVat: total as number, note: note || null,
    },
  }
}

export class BillCheckError extends Error {}

export interface BillCheckResult {
  season: BillingSeason
  modelledTotalExclVat: number
  differencePct: number
  warn: boolean
  lines: BillLine[]
  notModelled: NotModelled[]
}

export function runBillCheck(
  tariff: Tariff, input: BillCheckInput, ctx: { highSeasonMonths: number[] | null; nmdKva: number | null },
): BillCheckResult {
  const seasonal = tariff.charges.some((c) => c.season !== 'all')
  if (seasonal && !ctx.highSeasonMonths) {
    throw new BillCheckError('This tariff has seasonal rates but the library has no season calendar for this supply authority. Report it as a tariff error.')
  }
  const season: BillingSeason = ctx.highSeasonMonths ? seasonForMonth(input.month, { highSeasonMonths: ctx.highSeasonMonths }) : 'low'
  const days = new Date(Date.UTC(input.year, input.month, 0)).getUTCDate()
  const bill = costMonth(tariff, {
    year: input.year, month: input.month, days, season, importKwh: input.importKwh,
    maxDemandKva: input.maxDemandKva, peakWindowMdKva: input.maxDemandKva, nmdKva: ctx.nmdKva,
  })
  const modelled = bill.totalExclVat
  const differencePct = Math.round(((modelled - input.actualTotalExclVat) / input.actualTotalExclVat) * 100 * 1000) / 1000
  return {
    season, modelledTotalExclVat: modelled, differencePct, warn: Math.abs(differencePct) > BILL_CHECK_WARN_PCT,
    lines: bill.lines, notModelled: bill.notModelled,
  }
}
```

⚠ The 2900 expectation assumes 2a's engine costs a flat `c_per_kWh` energy charge on total kWh and a `R_per_month` basic charge once per month (engine spec §5). If the base engine prorates monthly charges by `days`, the test is wrong, not the engine: read `costOther` in `packages/shared/src/tariffs/bill-engine.ts`, and set the expectation to what the engine documents, keeping the −3.333/7.407 pair consistent.

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/tariff/bill-check.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/solar/tariff/bill-check.ts packages/shared/src/solar/tariff/bill-check.test.ts
git commit -m "feat(solar-tariff): bill check form and engine comparison (±5 % warning)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: TOU calendar helpers and source locators

**Files:**
- Create: `packages/shared/src/solar/tariff/calendar.ts`
- Create: `packages/shared/src/solar/tariff/source-locator.ts`
- Test: `packages/shared/src/solar/tariff/calendar.test.ts`
- Test: `packages/shared/src/solar/tariff/source-locator.test.ts`

- [ ] **Step 1: Write the failing tests**

`calendar.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { calendarFromRows, pickCalendar, resolveStudyCalendar, validateTouWindows, windowGrid, minutesLabel, parseTimeLabel, type TouCalendarRow } from './calendar'

const row = (p: Partial<TouCalendarRow>): TouCalendarRow => ({
  id: 'c', licenseeId: 'l', validFrom: '2025-04-01', validTo: null, highSeasonMonths: [6, 7, 8], source: 'published', holidayTreatedAs: 'sunday', ...p,
})

describe('calendar helpers', () => {
  it('builds the engine calendar from rows', () => {
    const cal = calendarFromRows(row({}), [{ season: 'high', dayType: 'weekday', startMinute: 360, endMinute: 480, period: 'peak' }])
    expect(cal).toEqual({ highSeasonMonths: [6, 7, 8], holidayTreatedAs: 'sunday', source: 'published',
      windows: [{ season: 'high', dayType: 'weekday', startMinute: 360, endMinute: 480, period: 'peak' }] })
  })
  it('picks the calendar valid on a date (latest start wins)', () => {
    const rows = [row({ id: 'old', validFrom: '2024-04-01', validTo: '2025-04-01' }), row({ id: 'new', validFrom: '2025-04-01' })]
    expect(pickCalendar(rows, '2025-03-31')?.id).toBe('old')
    expect(pickCalendar(rows, '2026-01-01')?.id).toBe('new')
    expect(pickCalendar(rows, '2020-01-01')).toBeNull()
  })
  it('falls back to Eskom hours flagged assumed_eskom when the licensee has no calendar', () => {
    const eskom = calendarFromRows(row({}), [])
    expect(resolveStudyCalendar(null, eskom)).toEqual({ calendar: { ...eskom, source: 'assumed_eskom' }, assumedEskom: true, fromEskomFallback: true })
    const own = calendarFromRows(row({ source: 'assumed_eskom' }), [])
    expect(resolveStudyCalendar(own, eskom)).toEqual({ calendar: own, assumedEskom: true, fromEskomFallback: false })
    expect(resolveStudyCalendar(null, null)).toEqual({ calendar: null, assumedEskom: false, fromEskomFallback: false })
  })
  it('flags overlapping windows, per season and day type', () => {
    const issues = validateTouWindows([
      { season: 'high', dayType: 'weekday', startMinute: 360, endMinute: 540, period: 'peak' },
      { season: 'high', dayType: 'weekday', startMinute: 480, endMinute: 600, period: 'standard' },
      { season: 'low', dayType: 'weekday', startMinute: 480, endMinute: 600, period: 'standard' },
    ])
    expect(issues).toEqual([{ season: 'high', dayType: 'weekday', message: 'High season weekday: 06:00-09:00 overlaps 08:00-10:00' }])
  })
  it('grids half-hour slots for the diagram (uncovered = off-peak)', () => {
    const cal = calendarFromRows(row({}), [{ season: 'high', dayType: 'weekday', startMinute: 360, endMinute: 480, period: 'peak' }])
    const g = windowGrid(cal).find((x) => x.season === 'high' && x.dayType === 'weekday')!
    expect(g.slots).toHaveLength(48)
    expect(g.slots[11]).toBe('off_peak')
    expect(g.slots[12]).toBe('peak')
    expect(g.slots[15]).toBe('peak')
    expect(g.slots[16]).toBe('off_peak')
  })
  it('time labels round-trip', () => {
    expect(minutesLabel(390)).toBe('06:30')
    expect(minutesLabel(1440)).toBe('24:00')
    expect(parseTimeLabel('06:30')).toBe(390)
    expect(parseTimeLabel('24:00')).toBe(1440)
    expect(parseTimeLabel('25:00')).toBeNull()
  })
})
```

`source-locator.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { describeLocator, findTextBox } from './source-locator'

describe('source locators', () => {
  it('a PDF locator points at a page', () => {
    expect(describeLocator({ page: 12, raw_text: 'Energy charge 247.76 c/kWh', label: 'Energy' }))
      .toEqual({ kind: 'pdf_page', page: 12, rawText: 'Energy charge 247.76 c/kWh', label: 'Energy' })
  })
  it('a workbook locator is a cell snippet', () => {
    expect(describeLocator({ sheet: 'CITY POWER', cell: 'D14', label: 'Basic', raw_text: '157.91', raw_unit: 'R/month' }))
      .toEqual({ kind: 'cell', sheet: 'CITY POWER', cell: 'D14', label: 'Basic', rawText: '157.91', rawUnit: 'R/month' })
    expect(describeLocator({ sheet: 'S', row: 14, col: 'D' })).toMatchObject({ kind: 'cell', cell: 'D14' })
  })
  it('nothing to show', () => {
    expect(describeLocator({})).toEqual({ kind: 'none' })
  })
  it('finds the text item holding the cited value on a PDF page', () => {
    const items = [
      { str: 'Basic charge', transform: [1, 0, 0, 10, 50, 700], width: 60, height: 10 },
      { str: 'Energy charge  247.76 c/kWh', transform: [1, 0, 0, 10, 50, 680], width: 140, height: 10 },
    ]
    expect(findTextBox(items, 'Energy charge 247.76 c/kWh')).toEqual({ x: 50, y: 680, width: 140, height: 10 })
    expect(findTextBox(items, '247.76')).toEqual({ x: 50, y: 680, width: 140, height: 10 })
    expect(findTextBox(items, 'nowhere')).toBeNull()
  })
})
```

- [ ] **Step 2: Run them — expect FAIL**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/tariff/calendar.test.ts src/solar/tariff/source-locator.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `calendar.ts`**

```ts
/**
 * TOU calendar rows <-> the engine's TouCalendar (2a tou.ts), the fallback
 * rule (a licensee without its own calendar uses Eskom's hours, flagged
 * assumed_eskom: municipal books state seasons, never hours), window
 * validation for the admin editor, and the half-hour grid the diagram draws.
 */
import { touPeriodAt, type TouCalendar, type TouWindow, type WindowDayType } from '../../tariffs/tou'
import type { BillingSeason, TouPeriod } from '../../tariffs/types'

export interface TouCalendarRow {
  id: string
  licenseeId: string
  validFrom: string
  validTo: string | null
  highSeasonMonths: number[]
  source: 'published' | 'assumed_eskom'
  holidayTreatedAs: 'saturday' | 'sunday' | null
}

export function calendarFromRows(cal: TouCalendarRow, windows: readonly TouWindow[]): TouCalendar {
  return {
    highSeasonMonths: [...cal.highSeasonMonths],
    holidayTreatedAs: cal.holidayTreatedAs,
    source: cal.source,
    windows: windows.map((w) => ({ season: w.season, dayType: w.dayType, startMinute: w.startMinute, endMinute: w.endMinute, period: w.period })),
  }
}

export function pickCalendar<T extends Pick<TouCalendarRow, 'validFrom' | 'validTo'>>(rows: readonly T[], onIso: string): T | null {
  const on = onIso.slice(0, 10)
  const valid = rows.filter((r) => r.validFrom <= on && (r.validTo === null || on < r.validTo))
  return valid.sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0] ?? null
}

export function resolveStudyCalendar(
  own: TouCalendar | null, eskom: TouCalendar | null,
): { calendar: TouCalendar | null; assumedEskom: boolean; fromEskomFallback: boolean } {
  if (own) return { calendar: own, assumedEskom: own.source === 'assumed_eskom', fromEskomFallback: false }
  if (eskom) return { calendar: { ...eskom, source: 'assumed_eskom' }, assumedEskom: true, fromEskomFallback: true }
  return { calendar: null, assumedEskom: false, fromEskomFallback: false }
}

export function minutesLabel(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export function parseTimeLabel(s: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (min > 59 || h > 24 || (h === 24 && min !== 0)) return null
  return h * 60 + min
}

const SEASON_WORD: Record<BillingSeason, string> = { high: 'High season', low: 'Low season' }
const DAY_TYPES: readonly WindowDayType[] = ['weekday', 'saturday', 'sunday']
const SEASONS: readonly BillingSeason[] = ['high', 'low']

export interface WindowIssue {
  season: BillingSeason
  dayType: WindowDayType
  message: string
}

/** Overlaps are errors (a minute in two periods). Gaps are legal: uncovered minutes bill as off-peak. */
export function validateTouWindows(windows: readonly TouWindow[]): WindowIssue[] {
  const issues: WindowIssue[] = []
  for (const season of SEASONS) {
    for (const dayType of DAY_TYPES) {
      const ws = windows.filter((w) => w.season === season && w.dayType === dayType).sort((a, b) => a.startMinute - b.startMinute)
      for (let i = 1; i < ws.length; i++) {
        if (ws[i].startMinute < ws[i - 1].endMinute) {
          issues.push({
            season, dayType,
            message: `${SEASON_WORD[season]} ${dayType}: ${minutesLabel(ws[i - 1].startMinute)}-${minutesLabel(ws[i - 1].endMinute)} overlaps ${minutesLabel(ws[i].startMinute)}-${minutesLabel(ws[i].endMinute)}`,
          })
        }
      }
    }
  }
  return issues
}

export interface GridRow {
  season: BillingSeason
  dayType: WindowDayType
  /** 48 half-hour slots from 00:00. */
  slots: TouPeriod[]
}

export function windowGrid(cal: Pick<TouCalendar, 'windows'>): GridRow[] {
  return SEASONS.flatMap((season) => DAY_TYPES.map((dayType) => ({
    season, dayType,
    slots: Array.from({ length: 48 }, (_, k) => touPeriodAt(cal, season, dayType, k * 30)),
  })))
}
```

- [ ] **Step 4: Implement `source-locator.ts`**

```ts
/**
 * "View source" (spec §5 charges table, §12 review queue): a stored locator
 * -> what to show. A PDF locator opens its page (rendered in the browser with
 * pdfjs); a workbook locator is shown as a small cell snippet (the workbook
 * is not re-read). findTextBox highlights the cited text on the page.
 */
import type { SourceLocator } from '../../tariffs/types'

export type LocatorView =
  | { kind: 'pdf_page'; page: number; rawText: string | null; label: string | null }
  | { kind: 'cell'; sheet: string | null; cell: string | null; label: string | null; rawText: string | null; rawUnit: string | null }
  | { kind: 'none' }

export function describeLocator(loc: SourceLocator | null | undefined): LocatorView {
  const l = loc ?? {}
  if (typeof l.page === 'number' && l.page > 0) {
    return { kind: 'pdf_page', page: l.page, rawText: l.raw_text ?? null, label: l.label ?? null }
  }
  const cell = l.cell ?? (l.col && typeof l.row === 'number' ? `${l.col}${l.row}` : null)
  if (l.sheet || cell) {
    return { kind: 'cell', sheet: l.sheet ?? null, cell, label: l.label ?? null, rawText: l.raw_text ?? null, rawUnit: l.raw_unit ?? null }
  }
  return { kind: 'none' }
}

export interface PdfTextItem {
  str: string
  /** pdfjs text-item transform: [a, b, c, d, e (x), f (y)]. */
  transform: number[]
  width: number
  height: number
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase()

/** The first text item containing the cited text (or the whole of it), in PDF user space. */
export function findTextBox(items: readonly PdfTextItem[], needle: string): { x: number; y: number; width: number; height: number } | null {
  const n = norm(needle)
  if (!n) return null
  const hit = items.find((i) => norm(i.str).includes(n)) ?? items.find((i) => norm(i.str).length >= 4 && n.includes(norm(i.str)))
  if (!hit) return null
  return { x: hit.transform[4], y: hit.transform[5], width: hit.width, height: hit.height || Math.abs(hit.transform[3]) }
}
```

- [ ] **Step 5: Run them — expect PASS**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/tariff/calendar.test.ts src/solar/tariff/source-locator.test.ts`
Expected: PASS (6 + 4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/solar/tariff/calendar.ts packages/shared/src/solar/tariff/calendar.test.ts \
        packages/shared/src/solar/tariff/source-locator.ts packages/shared/src/solar/tariff/source-locator.test.ts
git commit -m "feat(solar-tariff): TOU calendar helpers (assumed_eskom fallback) and source locators

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Tariff readiness, the barrel, and the Tariff tab flag

**Files:**
- Create: `packages/shared/src/solar/tariff/readiness.ts`
- Create: `packages/shared/src/solar/tariff/index.ts`
- Modify: `packages/shared/src/solar/index.ts` (add one export line)
- Modify: `packages/shared/src/solar/readiness.ts` (`tariff` → `built: true`)
- Modify: `packages/shared/src/solar/readiness.test.ts` (the "built" list)
- Test: `packages/shared/src/solar/tariff/readiness.test.ts`

The tariff step is merged into the steps by a separate function (`withTariffReadiness`) instead of a new parameter on `computeSolarReadiness`: Phase 5 (layout) adds a third positional parameter to that function on its own branch, and two branches adding different third parameters would conflict on merge. A post-processor cannot.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { tariffReadiness, toTariffReadinessInput, withTariffReadiness } from './readiness'
import { computeSolarReadiness } from '../readiness'

describe('tariff readiness (spec §2.3 Tariff row)', () => {
  it('grey until a tariff is pinned; amber without an export rule; green with both', () => {
    expect(tariffReadiness(null)).toEqual({ status: 'grey', reason: 'Not started' })
    expect(tariffReadiness({ tariffId: null, exportRule: null })).toEqual({ status: 'grey', reason: 'Not started' })
    expect(tariffReadiness({ tariffId: 't', exportRule: null })).toEqual({ status: 'amber', reason: 'Missing: export credit rule' })
    expect(tariffReadiness({ tariffId: 't', exportRule: { version: 1, method: 'none' } }))
      .toEqual({ status: 'green', reason: 'Tariff and export credit rule are set' })
  })
  it('reads a studies row', () => {
    expect(toTariffReadinessInput({ tariff_id: 't', export_rule: { method: 'none' } })).toEqual({ tariffId: 't', exportRule: { method: 'none' } })
    expect(toTariffReadinessInput(null)).toBeNull()
  })
  it('replaces the tariff step only, and makes it live', () => {
    const steps = withTariffReadiness(computeSolarReadiness(null, 'edit_financials'), { tariffId: 't', exportRule: null })
    const t = steps.find((s) => s.slug === 'tariff')!
    expect(t).toEqual({ slug: 'tariff', label: 'Tariff', live: true, status: 'amber', reason: 'Missing: export credit rule' })
    expect(steps.find((s) => s.slug === 'financials')!.live).toBe(false)
  })
  it('a level without the Tariff tab has no tariff step to replace', () => {
    expect(withTariffReadiness(computeSolarReadiness(null, 'edit'), null).some((s) => s.slug === 'tariff')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/tariff/readiness.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `tariff/readiness.ts`**

```ts
/** The Tariff row of the readiness rules (spec §2.3): "Missing rule blocks Tariff readiness" (spec §5). */
import type { ReadinessStatus, ReadinessStep } from '../readiness'
import { parseExportRule } from './export-rule'

export interface TariffReadinessInput {
  tariffId: string | null
  exportRule: unknown
}

export function tariffReadiness(i: TariffReadinessInput | null): { status: ReadinessStatus; reason: string } {
  if (!i || !i.tariffId) return { status: 'grey', reason: 'Not started' }
  if (!parseExportRule(i.exportRule)) return { status: 'amber', reason: 'Missing: export credit rule' }
  return { status: 'green', reason: 'Tariff and export credit rule are set' }
}

export function toTariffReadinessInput(row: Record<string, unknown> | null | undefined): TariffReadinessInput | null {
  if (!row) return null
  return { tariffId: typeof row.tariff_id === 'string' ? row.tariff_id : null, exportRule: row.export_rule ?? null }
}

export function withTariffReadiness(steps: ReadinessStep[], input: TariffReadinessInput | null): ReadinessStep[] {
  return steps.map((s) => (s.slug === 'tariff' ? { ...s, live: true, ...tariffReadiness(input) } : s))
}
```

- [ ] **Step 4: Create the barrel and export it**

`packages/shared/src/solar/tariff/index.ts`:
```ts
// Solar Tariff tab + tariff library UI helpers (Phase 2b). Pure; safe from the barrel.
export * from './labels'
export * from './eligibility'
export * from './financial-years'
export * from './escalation'
export * from './export-rule'
export * from './override'
export * from './bill-check'
export * from './calendar'
export * from './source-locator'
export * from './readiness'
```

In `packages/shared/src/solar/index.ts` append:
```ts
export * from './tariff'
```

⚠ `override.ts` imports `../../tariffs/parsers/normalise`, which imports only pure parser modules (`labels`, `blocks`, `amount` types) — NOT `xlsx-load`/exceljs. Verify before committing:
```bash
grep -n "^import" packages/shared/src/tariffs/parsers/normalise.ts packages/shared/src/tariffs/parsers/labels.ts packages/shared/src/tariffs/parsers/blocks.ts
```
Expected: no `exceljs`, no `./xlsx-load`, no `node:`. If any appears, copy 2a's `unitCompatible` body into `override.ts` instead (with a comment naming the source) — a client bundle must never pull exceljs through the root barrel.

- [ ] **Step 5: Flip the Tariff tab to built and update the tab test**

In `packages/shared/src/solar/readiness.ts`, the `SOLAR_TABS` row for `tariff`:
```ts
  { slug: 'tariff',     label: 'Tariff',             built: true,  financial: true,  hidden: false },
```
In `packages/shared/src/solar/readiness.test.ts`, the test `'only Overview and Site & Supply are built in Phase 1'` becomes:
```ts
  it('built tabs: Overview, Site & Supply and (Phase 2b) Tariff', () => {
    expect(SOLAR_TABS.filter((t) => t.built).map((t) => t.slug)).toEqual(['overview', 'site', 'tariff'])
  })
```
If the base already lists more built tabs (a sibling phase merged first), keep them and insert `'tariff'` in `SOLAR_TABS` order.

- [ ] **Step 6: Run the shared suite + type-check**

```bash
pnpm --filter @esite/shared exec vitest run src/solar
pnpm --filter @esite/shared type-check
```
Expected: all `src/solar` tests PASS; `tsc` exit 0 (no duplicate-export error from the root barrel).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/solar/tariff/readiness.ts packages/shared/src/solar/tariff/readiness.test.ts \
        packages/shared/src/solar/tariff/index.ts packages/shared/src/solar/index.ts \
        packages/shared/src/solar/readiness.ts packages/shared/src/solar/readiness.test.ts
git commit -m "feat(solar-tariff): Tariff readiness row and the tariff barrel; Tariff tab built

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Ingest job runner (PDF ingests run as a job)

**Files:**
- Create: `packages/shared/src/tariffs/ingest/job-runner.ts`
- Modify: `packages/shared/src/tariffs/ingest/index.ts` (add one export line)
- Test: `packages/shared/src/tariffs/ingest/job-runner.test.ts`

The web server cannot run `rfd_pdf`: its text comes from poppler's `pdftotext -layout` (2a's parser is written against that layout), which is not on Vercel. A PDF ingest is therefore queued as `tariffs.ingest_job` and executed by `scripts/tariffs/ingest-worker.ts` on the staff machine (Part 3, Task 19). This runner is the pure core the worker calls; the same `runIngest` as the CLI does the work.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runIngestJob, summariseIngestReport, type IngestJob } from './job-runner'
import { createMemoryTariffStore } from './memory-store'

const FIX = join(__dirname, '../__fixtures__/city-power-rfd-2026-27.excerpt.txt')
const SHA = 'b'.repeat(64)
const job = (over: Partial<IngestJob> = {}): IngestJob => ({
  id: 'job-1', sourceDocumentId: 'doc-1', parser: 'rfd_pdf', financialYear: '2026/27',
  licenseeName: 'City Power', createLicensees: false, requestedBy: 'u-1', ...over,
})

describe('runIngestJob', () => {
  it('downloads, extracts PDF text, ingests and lands the year in review', async () => {
    const store = createMemoryTariffStore({ licensees: [{ name: 'City Power', kind: 'metro', aliases: ['CITY POWER'] }] })
    const out = await runIngestJob(job(), {
      loadSource: async () => ({ storagePath: `2026-27/${SHA}.pdf`, fileName: 'city-power.pdf', sha256: SHA, url: null, retrievedAt: null }),
      download: async () => new Uint8Array([37, 80, 68, 70]),
      pdfToText: async () => readFileSync(FIX, 'utf8'),
      store,
    })
    expect(out.status).toBe('succeeded')
    expect(out.error).toBeNull()
    expect(out.report?.status).toBe('applied')
    expect(out.report?.years[0].action).toBe('create')
    expect([...store.state.years.values()][0]).toMatchObject({ financialYear: '2026/27', state: 'in_review' })
  })
  it('a missing source document fails the job with a sentence', async () => {
    const out = await runIngestJob(job(), {
      loadSource: async () => null, download: async () => new Uint8Array(), pdfToText: async () => '', store: createMemoryTariffStore(),
    })
    expect(out).toEqual({ status: 'failed', report: null, runId: null, error: 'The source document no longer exists.' })
  })
  it('a text-extraction failure fails the job and writes nothing', async () => {
    const store = createMemoryTariffStore({ licensees: [{ name: 'City Power', kind: 'metro', aliases: ['CITY POWER'] }] })
    const out = await runIngestJob(job(), {
      loadSource: async () => ({ storagePath: 'p', fileName: 'f.pdf', sha256: SHA, url: null, retrievedAt: null }),
      download: async () => new Uint8Array([1]),
      pdfToText: async () => { throw new Error('pdftotext: not found') },
      store,
    })
    expect(out.status).toBe('failed')
    expect(out.error).toBe('Could not read text from the PDF: pdftotext: not found')
    expect(store.state.writes).toEqual([])
  })
  it('summarises a report for storage and display (issues capped at 25)', () => {
    const issues = Array.from({ length: 30 }, (_, k) => ({ code: 'inferred_unit' as const, severity: 'review' as const, message: `m${k}`, tariff: 'T' }))
    const s = summariseIngestReport({
      status: 'applied', sha256: SHA, sourceDocumentId: 'd', runId: 'r', storagePath: 'p',
      years: [{ licensee: 'City Power', financialYear: '2026/27', action: 'create', licenseeId: 'l', yearId: 'y',
        tariffs: 3, charges: 9, blocking: 0, review: 30, unresolved: 1, yoy: null, issues }],
    })
    expect(s.runId).toBe('r')
    expect(s.years[0]).toMatchObject({ licensee: 'City Power', action: 'create', tariffs: 3, review: 30 })
    expect(s.years[0].issues).toHaveLength(25)
    expect(s.years[0].issues[0]).toEqual({ code: 'inferred_unit', severity: 'review', message: 'm0', tariff: 'T' })
  })
})
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/ingest/job-runner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * One queued tariffs.ingest_job, executed (D-03: staff run ingestion; it never
 * publishes). Pure: the caller supplies storage, PDF text extraction and the
 * TariffStore. Same buildIngestPlan + runIngest as scripts/tariffs/ingest.ts.
 */
import { buildIngestPlan } from './build-plan'
import { runIngest, type IngestReport, type ParserName, type TariffStore } from './ingest-core'

export interface IngestJob {
  id: string
  sourceDocumentId: string
  parser: ParserName
  financialYear: string
  licenseeName: string | null
  createLicensees: boolean
  requestedBy: string | null
}

export interface IngestJobSource {
  storagePath: string
  fileName: string
  sha256: string
  url: string | null
  retrievedAt: string | null
}

export interface IngestJobDeps {
  loadSource(sourceDocumentId: string): Promise<IngestJobSource | null>
  download(storagePath: string): Promise<Uint8Array>
  pdfToText(bytes: Uint8Array): Promise<string>
  store: TariffStore
  /** sha256 of the stored Net-Billing Rules PDF (eskom_xlsm only; owner default 9). */
  netBillingRulesSha256?: string | null
}

export interface IngestJobOutcome {
  status: 'succeeded' | 'failed'
  report: IngestReport | null
  runId: string | null
  error: string | null
}

/** What the admin UI shows and ingest_job.report stores: per-year counts and the first 25 issues. */
export interface IngestReportSummary {
  status: IngestReport['status']
  runId: string | null
  years: Array<{
    licensee: string
    action: IngestReport['years'][number]['action']
    tariffs: number
    charges: number
    blocking: number
    review: number
    unresolved: number
    yoy: IngestReport['years'][number]['yoy']
    issues: Array<{ code: string; severity: string; message: string; tariff: string | null }>
  }>
}

export function summariseIngestReport(r: IngestReport): IngestReportSummary {
  return {
    status: r.status,
    runId: r.runId,
    years: r.years.map((y) => ({
      licensee: y.licensee, action: y.action, tariffs: y.tariffs, charges: y.charges, blocking: y.blocking,
      review: y.review, unresolved: y.unresolved, yoy: y.yoy,
      issues: y.issues.slice(0, 25).map((i) => ({ code: i.code, severity: i.severity, message: i.message, tariff: i.tariff ?? null })),
    })),
  }
}

export async function runIngestJob(job: IngestJob, deps: IngestJobDeps): Promise<IngestJobOutcome> {
  const src = await deps.loadSource(job.sourceDocumentId)
  if (!src) return { status: 'failed', report: null, runId: null, error: 'The source document no longer exists.' }
  let bytes: Uint8Array
  try {
    bytes = await deps.download(src.storagePath)
  } catch (e) {
    return { status: 'failed', report: null, runId: null, error: `Could not download the source: ${e instanceof Error ? e.message : String(e)}` }
  }
  let pdfText: string | undefined
  if (job.parser === 'rfd_pdf') {
    try {
      pdfText = await deps.pdfToText(bytes)
    } catch (e) {
      return { status: 'failed', report: null, runId: null, error: `Could not read text from the PDF: ${e instanceof Error ? e.message : String(e)}` }
    }
  }
  try {
    const plan = await buildIngestPlan({
      parser: job.parser, fileName: src.fileName, bytes, sha256: src.sha256, financialYear: job.financialYear,
      pdfText, licenseeName: job.licenseeName ?? undefined, url: src.url, retrievedAt: src.retrievedAt,
      netBillingRulesSha256: deps.netBillingRulesSha256 ?? null,
    })
    const report = await runIngest(plan, deps.store, { apply: true, createMissingLicensees: job.createLicensees, startedBy: job.requestedBy })
    return { status: 'succeeded', report, runId: report.runId, error: null }
  } catch (e) {
    return { status: 'failed', report: null, runId: null, error: e instanceof Error ? e.message : String(e) }
  }
}
```

Add to `packages/shared/src/tariffs/ingest/index.ts`:
```ts
export * from './job-runner'
```

⚠ If the fixture excerpt does not parse into ≥ 1 tariff for "City Power" (2a's `rfd-text.test.ts` shows what it yields), the first test's `action` may be `create` with 0 tariffs — still `applied`. Do not weaken the assertion to pass; if the fixture yields `skip_unknown_licensee`, fix the seeded alias to match the name the RfD parser reports (read `rfd-text.test.ts`).

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/ingest/job-runner.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/tariffs/ingest/job-runner.ts packages/shared/src/tariffs/ingest/job-runner.test.ts packages/shared/src/tariffs/ingest/index.ts
git commit -m "feat(tariffs): ingest job runner for queued PDF ingests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
