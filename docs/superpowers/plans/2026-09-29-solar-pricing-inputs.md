# Solar pricing inputs (I-1, I-2, layouts.module_id FK) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Yield & Financials price a study exactly as the Tariff tab does — project override, export rule and its rates, the Tariff tab's escalation path, and the Load tab's load growth — through ONE pure resolver, and changing any of the four marks the case Stale. Close I-2 (manual export rule with no rates over REST) and add the deferred `solar.layouts.module_id` FK.

**Architecture:** `resolveStudyPricing()` (pure, `packages/shared/src/solar/tariff/pricing.ts`) turns the study's stored pricing choices + the published tariff + override rows + export rates + org defaults into one `ResolvedStudyPricing`; `studyPricingHash()` hashes it canonically. One web loader `loadStudyPricing(client, projectId)` reads the rows and calls the resolver; the Tariff tab bill check (`loadEffectiveTariff`) and the run/financials path (`resolveStudyTariff`) both go through it, pinned by a contract test. The case hash becomes `inputsHash({ energy: inputsHash(caseInput), pricing: pricingHash })`; the financials hash carries the pricing hash too. DB: `00220_solar_pricing_guards.sql` (deferred constraint triggers tying `export_rule.method = 'manual'` to a rate set, both directions; `layouts.module_id` FK + org/kind bind).

**Tech Stack:** TypeScript, vitest, Next.js 15 server code, Supabase/Postgres (plpgsql constraint triggers), `scripts/db/dry-run-migration.sh`.

## Decisions taken in this plan

1. **Export 'none'** returns an effective SSEG rule with `crediting: 'none'` (bill-engine: no credit), and `exportCredited: false`. Zero credit is therefore a property of the calculator, not of a caller remembering a flag. A tariff's OWN `export_credit` charges are NOT credited under 'none'.
2. **No stored export rule** → `defaultExportRule(hasLinkedExportTariff)` — the Tariff tab's default (linked if the tariff has one, else none).
3. **SSEG rule** = the library row, else `netBillingRule(regimeForLicenseeKind(kind))` — what the Tariff tab shows as "the rule in force". Before, the run passed `null` (no credit at all), disagreeing with the tab.
4. **Escalation** = `escalationPathFromRows(buildEscalationRows({pinned FY, licensee's published/superseded years, org settings, studies.escalation}))`. Financials' own `escalationStartPct/Year10Pct/AfterCpiPlusPct` are kept in the stored config for compatibility but no longer priced; the editor shows the Tariff tab's values read-only.
5. **Load growth** = `studies.load_growth_pct` (Load tab; NULL → 0). Financials' own `loadGrowthPct` is ignored the same way.
6. **Engine §6 load growth, v1 simplification:** with `G_n = (1+g)^(n-1)`, `Bill_before_n = B1·tf_n·G_n` and `Bill_after_n = (B1·tf_n − Saving_n)·G_n`, so `Saving_n` scales by `G_n` too (the energy balance rescaled, not re-simulated). Year 1 is unchanged by construction. Documented as an upper bound (a fully self-consumed PV system does not grow its saving with load).
7. **Hash salting:** the pricing hash includes the money rows' ids (`tariff_override_charges.id`, `study_export_rates.id`), which a View user cannot read, so the `case_runs.inputs_hash` a View user CAN read cannot be brute-forced back to a manual export rate or an override rate.
8. **Every existing run goes Stale once** (the case hash changes shape). Nothing is applied to production yet; stated in the PR.

## File map

- Create `packages/shared/src/tariffs/__fixtures__/golden-bills.ts` — the 2a golden cases 1–8 and 10 as data (tariff, usage, opts, expected total). `bill-engine.test.ts` / `bill-engine.net-billing.test.ts` import their tariffs from it (no expected value changes).
- Create `packages/shared/src/solar/tariff/pricing.ts` + `pricing.test.ts` — resolver + hash.
- Modify `packages/shared/src/solar/tariff/index.ts` — export pricing.
- Modify `packages/shared/src/services/solar/finance/cashflow.ts` (+test) — load growth on both bills.
- Modify `packages/shared/src/solar/cases/finance-input.ts` (+test) — takes `{ escalationPath, loadGrowthPct }`.
- Create `apps/web/src/lib/solar/pricing/load-study-pricing.ts` (+test) and `pricing-single-source.contract.test.ts`.
- Modify `apps/web/src/lib/solar/tariff/effective-tariff.ts`, `apps/web/src/lib/solar/cases/tariff.ts`, `run-context.ts`, `run-case.ts`, `financials.ts`, `financials-page-data.ts` (+tests).
- Modify UI: `solar/(gated)/tariff/page.tsx`, `load/_components/SiteProfilePanel.tsx`, `financials/FinancialsEditor.tsx`.
- Create `apps/edge-functions/supabase/migrations/00220_solar_pricing_guards.sql`, `scripts/db/assert-solar-pricing-guards.sql`.
- Docs: `docs/solar/06-open-decisions.md`, `docs/solar/02-calculation-engine-spec.md` §6 note, PR #216 body.

---

### Task 1: Golden bill fixture + `resolveStudyPricing` + `studyPricingHash`

**Files:** Create `packages/shared/src/tariffs/__fixtures__/golden-bills.ts`, `packages/shared/src/solar/tariff/pricing.ts`, `packages/shared/src/solar/tariff/pricing.test.ts`; modify `bill-engine.test.ts`, `bill-engine.net-billing.test.ts`, `solar/tariff/index.ts`.

- [ ] **Step 1: Move the golden tariffs into a fixture** — `GOLDEN_BILLS: Array<{ id: string; tariff: Tariff; usage: MonthUsage; opts?: CostOptions; totalExclVat: number }>` holding cases 1–8 (import) and 10 + variant (Homeflex 1 + Gen-Offset, Eskom net-billing rule). The two golden test files take their tariffs from it; run `pnpm --filter @esite/shared test tariffs/bill-engine` → still green, same expected numbers.

- [ ] **Step 2: Write the failing resolver tests** (`pricing.test.ts`):
  - (a) every `GOLDEN_BILLS` case through `resolveStudyPricing` with no override/stored rule reproduces `totalExclVat` exactly via `costMonth(p.tariff, usage, { exportTariff: p.exportTariff, sseg: p.ssegRule })` — for case 10 the resolver is given the Gen-Offset tariff as the linked export tariff and the Eskom library rule.
  - (b) override: base flat 250 c/kWh + R500/month; override row energy → 300 c/kWh with reason. `runBillCheck(p.tariff, {year:2025, month:3, importKwh:{standard:X}}, …)` total === `tariffBillCalculator(p.tariff, {calendar, referenceYear: 2025, …}).monthlyBills(flatFlows)[2].totalZar` where the flat hourly import sums to X in March; and both ≠ the published bill.
  - (c) manual R0.85/kWh: export credit for 100 kWh exported against ≥100 kWh imported (flat net billing) = R85.00; 'none': credit 0 even when the tariff has its own `export_credit` rows; linked: credited from the linked tariff.
  - escalation rows = `buildEscalationRows` with the same inputs; a stored override for year 3 changes `escalationPath.published[1]`.
  - `loadGrowthPct` from the study (NULL → 0).
  - `studyPricingHash` differs when each of: an override rate, the export method, a manual rate, an escalation override, load growth changes; identical for identical inputs; changes when a money row id changes (salting).
  Run → FAIL (module not found).

- [ ] **Step 3: Implement `pricing.ts`:**

```ts
export interface StudyPricingInput {
  study: { tariffOverrideId: string | null; exportRule: unknown; escalation: unknown; loadGrowthPct: number | string | null }
  published: { tariffId: string; tariff: Tariff; financialYear: string; licenseeKind: LicenseeKind; exportTariff: Tariff | null; sseg: SsegRule | null;
    years: ReadonlyArray<{ financialYear: string; approvedIncreasePct: number | null }> }
  override: { id: string; rows: readonly OverrideChargeRow[] } | null
  exportRates: ReadonlyArray<ExportRateRow & { id: string; sourceNote: string | null }>
  orgSettings: Record<string, number | boolean | null | undefined>
}
export interface ResolvedStudyPricing {
  tariff: Tariff; exportTariff: Tariff | null; exportMethod: ExportMethod; exportCredited: boolean
  ssegRule: SsegRule; ssegFromLibrary: boolean
  escalationRows: EscalationRow[]; escalationPath: EscalationPath; escalationSettings: EscalationSettings
  loadGrowthPct: number
  provenance: { tariffId: string; financialYear: string; overrideId: string | null; overrideChargeIds: string[];
    exportMethod: ExportMethod; exportRateIds: string[]; exportSourceNote: string | null; loadGrowthFrom: 'study' }
}
export function resolveStudyPricing(i: StudyPricingInput): ResolvedStudyPricing
export function studyPricingHash(p: ResolvedStudyPricing): string // inputsHash(p)
```
  Override applies only when `study.tariffOverrideId === override.id`. Manual with no rates is treated as 'none' (defence in depth; 00220 makes it unreachable). Run → PASS. Commit `feat(solar-pricing): one resolver for study pricing (override, export rule, escalation, load growth)`.

### Task 2: Finance input + engine load growth on both bills

**Files:** `packages/shared/src/services/solar/finance/cashflow.ts` (+`cashflow.test.ts`), `packages/shared/src/solar/cases/finance-input.ts` (+test).

- [ ] **Step 1: Failing tests** — (e) `runFinance` with `loadGrowth: 0.03` vs 0: row 1 identical (billBefore, billAfter, saving, net); rows 2+ `billBefore`, `billAfter` AND `saving` all × `1.03^(n-1)`. (d) `buildFinanceInput(fin, cfg, size, pricing)` uses `pricing.escalationPath` and `pricing.loadGrowthPct/100`, ignoring `fin.analysis.escalation*`/`loadGrowthPct`; changing an escalation override row changes NPV.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — in `common()`: `const g = (1 + loadGrowth) ** (n - 1)`; `saving = (pvSaving1*deg + battSaving1*health) * tf * g`; `billBefore = beforeZar * tf * g` (billAfter stays `billBefore − saving`, so both scale). `buildFinanceInput(fin, c, size, pricing: { escalationPath; loadGrowthPct })`.
- [ ] **Step 4: Run shared suite → PASS** (existing loadGrowth-0 goldens unchanged). Commit `feat(solar-finance): escalation and load growth from the study; growth scales both bills`.

### Task 3: One web loader for both the bill check and the run path

**Files:** Create `apps/web/src/lib/solar/pricing/load-study-pricing.ts` (+test), `apps/web/src/lib/solar/pricing/pricing-single-source.contract.test.ts`; modify `apps/web/src/lib/solar/tariff/effective-tariff.ts`, `apps/web/src/lib/solar/cases/tariff.ts` (+ their tests).

- [ ] **Step 1: Failing tests** — `loadStudyPricing(fake, P)` returns the override tariff, manual export tariff, escalation override, load growth; `loadEffectiveTariff` and `resolveStudyTariff` both return the override's rate (build mock sees the override tariff, the manual export tariff and the net-billing fallback sseg); contract test: `effective-tariff.ts` and `cases/tariff.ts` import `loadStudyPricing` and neither calls `tariffFromRows`/`overrideToTariff`/`manualExportTariff` directly.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the loader (reads study `id, tariff_id, tariff_override_id, export_rule, escalation, load_growth_pct, nmd_kva, licensee_id, organisation_id`; the tariff + charges; its year; licensee `name, kind`; linked export tariff; sseg row; licensee's published/superseded years with `approved_increase_pct`; override rows; export rates; org settings) → `resolveStudyPricing`. Keep `isMissingTariffColumn` handling in `resolveStudyTariff`. `StudyTariff` ok-branch gains `pricing` and `pricingHash`.
- [ ] **Step 4: Run web tests → PASS.** Commit `feat(solar-pricing): the bill check and the run path load pricing through one resolver`.

### Task 4: Pricing enters the case hash and the financials hash

**Files:** `run-context.ts`, `run-case.ts`, `financials.ts`, `financials-page-data.ts` (+tests).

- [ ] **Step 1: Failing tests** — run-context: `currentHash` changes when (separately) the override rate, the export rule, `studies.escalation`, `studies.load_growth_pct` change; `energyHash === inputsHash(build.input)`. financials: the inserted `fin_inputs.finance.analysis.escalation.published` comes from the Tariff tab rows and `loadGrowth` from the study; export 'none' passes a calculator that credits nothing; `fin_inputs_hash` includes the pricing hash.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — `currentHash = inputsHash({ energy: energyHash, pricing: tariff.ok ? tariff.pricingHash : null })`; `run-case` compares `result.inputsHash` with `ctx.energyHash`; `finInputsHash(input, tariffRef, runId, pricingHash)`; `buildFinanceInput(..., tariff.pricing)`.
- [ ] **Step 4: PASS; commit** `feat(solar-cases): a pricing change marks the case and its financials Stale`.

### Task 5: UI — remove the I-1 notices, Financials shows escalation/growth read-only

- [ ] Failing page/editor test (`FinancialsEditor` renders "Load growth 3 %/yr — from the Load tab" and no editable escalation/load growth inputs), implement, remove `NOT_IN_FINANCIALS` and the SiteProfilePanel note, PASS, commit `feat(solar-financials): escalation and load growth shown from the Tariff and Load tabs`.

### Task 6: `00220_solar_pricing_guards.sql`

- [ ] **Step 1:** `scripts/db/assert-solar-pricing-guards.sql` — as a money user: direct `UPDATE studies SET export_rule='{"version":1,"method":"manual"}'` with no rates → 23514 (forced with `SET CONSTRAINTS … IMMEDIATE`); `save_export_rule` manual with rates → ok; then direct `DELETE FROM study_export_rates` → 23514; `save_export_rule` manual→none → ok (rates gone); direct rate INSERT while rule 'none' → 23514; study delete cascade ok. Layouts: `module_id` of a non-existent id → 23503; another org's module → 23514; an inverter row → 23514; own-org / platform module → ok; deleting a used equipment row → 23503. Run on `00208..00216+00219` → RED.
- [ ] **Step 2:** migration (no BEGIN/COMMIT; `@verify` block): `solar.export_rule_rates_check()` SECURITY DEFINER `search_path=''`, constraint triggers `studies_export_rule_rates` (AFTER INSERT OR UPDATE OF export_rule ON solar.studies) and `export_rates_rule_match` (AFTER INSERT OR UPDATE OR DELETE ON solar.study_export_rates), both `DEFERRABLE INITIALLY DEFERRED`; `UPDATE solar.layouts SET module_id = NULL WHERE module_id NOT IN equipment`; `layouts_module_fk … ON DELETE RESTRICT`; `solar.layouts_module_bind()` trigger; revoke anon EXECUTE.
- [ ] **Step 3:** full chain `00208..00216 + 00219 + 00220` with every solar assertion file + the new one → GREEN; mutations (drop each trigger) → the matching checks red. Commit `feat(solar-db): 00220 pricing guards — manual export needs rates; layouts.module_id FK`.

### Task 7: Verification, reviews, docs, push

- [ ] Three suites (`@esite/shared`, `@esite/db`, `web`), type-checks, lint, `next build`, then `rm -rf apps/web/.next`.
- [ ] Two foreground reviewers (pricing correctness; security); fix Critical/Important; re-review.
- [ ] `docs/solar/06-open-decisions.md` (I-1, I-2, module FK → Fixed), engine spec §6 note, PR #216 body (Fixed + 00220 in the apply order); push.
