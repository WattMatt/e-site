# E-Site Solar Phase 4b — Cases, Stored Runs, Yield & Scenarios, Financials, Equipment, Weather — Implementation Plan (index)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Phase 4a engine usable: users define cases (design options) per study, run them on the server into immutable stored runs (inputs snapshot + `inputs_hash` + `engine_version` + outputs + an 8760 hourly CSV), see every result and a Stale banner on the Yield & Scenarios tab, price them on the Financials tab (capex, opex, cash/debt/PPA/lease side by side, tax/12B, XLSX, tornado), fetch PVGIS TMY weather server-side into a per-org cache, and maintain an org equipment catalogue — with the readiness rules for Yield/Financials and the Overview KPIs now live.

**Architecture:** One migration (`00216_solar_cases.sql`) adds six `solar.*` tables (cases, case_runs, weather_datasets, equipment, case_financials, case_run_financials), `studies.selected_case_id`, two private service-only buckets and five `solar_*` product events, with per-verb RLS, FORCE RLS, bind triggers and a freeze trigger that makes a run immutable once it leaves `running`. All pure logic (case config schema, CaseInput builder, outputs/waterfall/checks, hourly CSV codec, finance-input builder, stored-financials runner, equipment CSV) lives in a new `@esite/shared/solar-cases` subpath beside the engine and is unit-tested there; the web app only loads rows, calls those functions on the server, and renders stored numbers. The browser never computes a displayed result (a contract test enforces it).

**Tech Stack:** Postgres (Supabase) + RLS, Next.js 15 App Router (server components, server actions, `runtime='nodejs'` route handlers), TypeScript, zod, vitest + RTL, exceljs (already a web dependency), hand-rolled SVG charts (E-Site has **no** charting library — the only existing chart, `components/mv/TccPlot.tsx`, is hand-rolled SVG; this plan follows that and adds no dependency), `node:zlib` for gzip.

---

## Plan files (execute in order)

| File | Tasks | Produces |
|---|---|---|
| `2026-09-28-solar-phase-4b-0-index.md` (this) | 0 | Worktree, preflight facts, conventions, file map |
| `2026-09-28-solar-phase-4b-1-schema.md` | 1–4 | `00216_solar_cases.sql`, behavioural assertions (red → green → mutations), product-event registry, `@verify` |
| `2026-09-28-solar-phase-4b-2-case-model.md` | 5–13 | `@esite/shared/solar-cases`: config, finance config, equipment, TOU periods, CaseInput builder, outputs, hourly CSV, finance input, stored financials, bill adapter, status, readiness, rate-card settings |
| `2026-09-28-solar-phase-4b-3-server.md` | 14–22 | Storage + weather + tariff + run-context libs, run / cancel / export routes, case / weather / financials / equipment actions, XLSX |
| `2026-09-28-solar-phase-4b-4-yield-ui.md` | 23–29 | SVG charts, Yield & Scenarios page (list, editor, results, compare, stale banner), no-browser-engine contract test |
| `2026-09-28-solar-phase-4b-5-financials-equipment-finish.md` | 30–37 | Financials page, equipment catalogue page, Overview KPIs + readiness, tab bar, rbac-matrix, full verification, two reviewers, push, draft PR |

---

## Decisions this plan takes (flagged for the owner in the final report)

1. **Tariff for Financials is read, never written, by 4b.** The Tariff tab (pinning `solar.studies.tariff_id`, TOU calendar seeding) is Phase 2b and is not on the base. 4b's `resolveStudyTariff` selects `tariff_id` from `solar.studies`; a missing column (PostgREST `42703`/`PGRST204`), a NULL, a missing TOU calendar or an unpublished year all return a named reason (`"No tariff is pinned for this study — pin one on the Tariff tab."`), and **Run financials** is disabled with that reason. 4b adds **no** tariff column, so it cannot collide with 2b's migration.
2. **Weather cache is per organisation** (`03 §3`: "Cache shared per org"), key `(organisation_id, source, lat_round, lng_round)` at 0.01°. The raw PVGIS response is stored verbatim (CSV, gzipped) — the same format as 4a's fixtures, so tests reuse them and never call PVGIS.
3. **Both new buckets are service-only.** `solar-runs` and `solar-weather` get **no** `storage.objects` policy for `authenticated`; every read/write goes through a gated server route/action with the service client, and downloads are short-lived signed URLs (≤ 1 h). Smallest possible surface; `@verify` pins "zero policies".
4. **Money lives in separate tables** (`case_financials`, `case_run_financials`) gated on `solar_can_see_money` (`03 §3.1`), so `cases.config` holds no rand values. The load-shedding **R/kWh value** is money → finance config; hours/year and backed kW are technical → case config (D-14 reported separately, never in IRR — the engine already enforces it).
5. **`layout_id` has no FK yet.** `solar.layouts` is created by `00212` on `feat/solar-phase-5`, which is not on the base. `cases.layout_id UUID NULL` + CHECK pairing it with `pv_source`; the create action refuses `pv_source='layout'` ("From layout arrives with the Layout tab"), and the UI renders **From layout** disabled. The Phase 5 integration merge adds `FOREIGN KEY (layout_id) REFERENCES solar.layouts(id)`.
6. **Measured-weather upload is deferred** (spec §7.2 lists it; the user brief lists only PVGIS + GSA). The option renders disabled "Coming later". PAN/OND import deferred per the brief (D-19).
7. **Opex escalation = CPI** (the engine escalates opex by CPI; a separate opex escalation input would be an engine change). The field renders read-only "= CPI".
8. **Generic platform catalogue rows are seeded** (one module, one inverter, one battery, make `Generic`, marked "typical values, not a datasheet") so a Manual case can run on day one. Org rows override; platform rows are service-role-written only.
9. **Runs execute synchronously inside the POST** (maxDuration 60 s). A run left `running` for more than 90 s is treated as timed out (UI shows Failed) and is closed as `failed` by the next run on that case; **Cancel** flips the row to `cancelled`, and the running request's final conditional update then finds 0 rows, deletes its CSV and returns 409.

---

## Conventions every task follows

- Repo root inside the worktree: `/Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b` (below: `$W`). All commands run from `$W` unless stated. `cd` is shown explicitly in commands because agent shells reset cwd.
- Server actions: `'use server'`, `createClient()` → `requireSolarLevel(projectId, need, supabase)` FIRST, writes through the caller's session (RLS decides), `expectedUpdatedAt` stale guard (`STALE_MESSAGE`), `humanSolarError` for every DB error, `recordSolarAudit` + `emitProductEvent` after success, `revalidatePath('/projects/<id>/solar', 'layout')`.
- API routes: `export const runtime = 'nodejs'`, `requireSolarLevelAPI` FIRST (they sit outside `(admin)/layout.tsx`), UUID-validate params, JSON errors with human sentences.
- Anything a `page.tsx` hands a `'use client'` component must be JSON (no functions, no `Float64Array`, no `Date`).
- Destructive controls use `useArmedConfirm` (never `window.confirm`).
- Rand values never render below `edit_financials`; Tariff/Financials hidden, not disabled.
- Tests: web `vi.hoisted` + `vi.mock` + `fakeSupabase` (`apps/web/src/test/fake-supabase.ts`); shared pure unit tests; SQL behavioural assertions via `scripts/db/dry-run-migration.sh`.
- Commit after every task with the trailer:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

## File map

### Created

| Path | Responsibility |
|---|---|
| `apps/edge-functions/supabase/migrations/00216_solar_cases.sql` | Schema, RLS, triggers, buckets, events, seed catalogue, `@verify` |
| `scripts/db/assert-solar-cases-roles.sql` | Behavioural RLS/trigger assertions as real roles |
| `packages/shared/src/solar/cases/index.ts` | Barrel for `@esite/shared/solar-cases` |
| `packages/shared/src/solar/cases/config.ts` (+ `.test.ts`) | `CaseConfig` zod schema, defaults from org settings, loss reset |
| `packages/shared/src/solar/cases/finance-config.ts` (+ test) | `CaseFinanceConfig`, capex categories/lines/totals, rate card |
| `packages/shared/src/solar/cases/equipment.ts` (+ test) | Equipment spec schemas, CSV import parser |
| `packages/shared/src/solar/cases/tou-periods.ts` (+ test) | Tariff calendar → engine 8760 `TouPeriod[]`; monthly TOU split |
| `packages/shared/src/solar/cases/build-input.ts` (+ test) | `CaseConfig` + study + site load + weather → engine `CaseInput` or named reasons |
| `packages/shared/src/solar/cases/outputs.ts` (+ test) | `CaseResult` → stored `CaseRunOutputs` (KPIs, monthly, typical days, daily, waterfall, checks, provenance) |
| `packages/shared/src/solar/cases/hourly-csv.ts` (+ test) | 8760 CSV encode/decode, monthly CSV |
| `packages/shared/src/solar/cases/finance-input.ts` (+ test) | `CaseFinanceConfig` + run KPIs → engine `FinanceInput` or reasons |
| `packages/shared/src/solar/cases/stored-financials.ts` (+ test) | Financials from the STORED hourly series (equivalence-tested against `runFinancials`) |
| `packages/shared/src/solar/cases/bill-adapter.ts` (+ test) | Tariff `TariffBillCalculator` → engine `BillCalculator` |
| `packages/shared/src/solar/cases/status.ts` (+ test) | Case card status (Not run / Running / Done / Failed / Stale) |
| `apps/web/src/lib/solar/cases/storage.ts` | gzip put/get + signed URLs on the two service-only buckets |
| `apps/web/src/lib/solar/cases/weather.ts` (+ test) | PVGIS TMY + GSA fetch, per-org cache, rate limit |
| `apps/web/src/lib/solar/cases/tariff.ts` (+ test) | `resolveStudyTariff` (read-only; named reasons) |
| `apps/web/src/lib/solar/cases/run-context.ts` (+ test) | Load study/case/site load/weather/equipment → `BuildContext` |
| `apps/web/src/lib/solar/cases/run-case.ts` (+ test) | Execute one run end to end |
| `apps/web/src/lib/solar/cases/financials.ts` (+ test) | Execute Run financials from stored energy |
| `apps/web/src/lib/solar/cases/xlsx.ts` (+ test) | Financials workbook (exceljs) |
| `apps/web/src/lib/solar/cases/page-data.ts` (+ test) | Yield/Financials/Overview loaders (JSON-only props) |
| `apps/web/src/lib/solar/cases/financials-page-data.ts` (+ test) | Financials view model from the stored result |
| `apps/web/src/app/(admin)/projects/[id]/solar/_components/runCase.ts` | Browser fetch helpers for run/cancel |
| `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/yield/editor-fields.tsx` | Labelled inputs shared by the case and financials editors |
| `apps/web/src/components/solar/format.ts` (+ test) | Display formatting (units always shown) |
| `apps/web/src/app/api/projects/[id]/solar/cases/[caseId]/run/route.ts` (+ test) | `POST` run |
| `apps/web/src/app/api/projects/[id]/solar/cases/[caseId]/cancel/route.ts` (+ test) | `POST` cancel |
| `apps/web/src/app/api/projects/[id]/solar/cases/[caseId]/runs/[runId]/export/route.ts` (+ test) | `GET` hourly CSV / monthly CSV / JSON slice |
| `apps/web/src/app/api/projects/[id]/solar/cases/[caseId]/financials/xlsx/route.ts` (+ test) | `GET` XLSX |
| `apps/web/src/actions/solar-cases.actions.ts` (+ test) | create / duplicate / rename / delete / select / save / fetch weather |
| `apps/web/src/actions/solar-financials.actions.ts` (+ test) | save / apply rate card / run financials |
| `apps/web/src/actions/solar-equipment.actions.ts` (+ test) | add / edit / retire / CSV import |
| `apps/web/src/components/solar/charts/geometry.ts` (+ test) | Scales, ticks, path builders |
| `apps/web/src/components/solar/charts/*.tsx` | `LineChart`, `BarChart`, `WaterfallChart`, `TornadoChart`, `CashflowChart` |
| `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/yield/*` | Yield page, `CaseList`, `NewCaseDialog`, `CaseEditor`, `RunResults`, `AnnualChart`, `CompareView` |
| `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/financials/*` | Financials page, `FinancialsEditor`, `FinancialResults` |
| `apps/web/src/app/(admin)/projects/[id]/solar/_components/StaleBanner.tsx` (+ test) | Stale banner + Re-run |
| `apps/web/src/app/(admin)/settings/solar/equipment/*` | Equipment catalogue page |
| `apps/web/src/lib/solar/no-browser-engine.contract.test.ts` | No `'use client'` file imports engine/compute runtime |

### Modified

| Path | Change |
|---|---|
| `packages/shared/package.json` | `"./solar-cases"` export |
| `packages/shared/src/lib/analytics/product-events.ts` | 5 new `solar_*` events |
| `packages/shared/src/solar/org-settings.ts` (+ test) | `rate_card` section (all defaults NULL) |
| `packages/shared/src/solar/readiness.ts` (+ test) | Yield/Financials/Layout-manual rules live; tabs built |
| `apps/web/src/test/fake-supabase.ts` | `lt` filter |
| `apps/web/src/app/(admin)/projects/[id]/solar/_components/OverviewKpis.tsx` (+ test) | Live KPIs + selected-case select |
| `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/overview/page.tsx` | Loads KPIs + readiness inputs |
| `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/layout.tsx` (+ test) | Tab dots use the Phase 4b readiness inputs |
| `apps/web/src/app/(admin)/settings/solar/page.tsx` | Rate card now live; equipment link |
| `docs/rbac-matrix.md` | Every new route/action row |

---

## Task 0: Worktree and preflight

**Files:** none (read-only checks).

- [ ] **Step 1: Confirm the base exists on origin.** The integration branch is being created by another session. Do NOT base on a local branch.

```bash
git -C /Users/spud/.config/superpowers/worktrees/esite/solar-integration fetch origin
git -C /Users/spud/.config/superpowers/worktrees/esite/solar-integration rev-parse --verify origin/feat/solar-integration
```
Expected: a commit sha. If it errors, STOP and report "origin/feat/solar-integration does not exist yet" — do not proceed.

- [ ] **Step 2: Create the worktree.**

```bash
git -C /Users/spud/.config/superpowers/worktrees/esite/solar-integration worktree add \
  /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b -b feat/solar-phase-4b origin/feat/solar-integration
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b && pnpm install --frozen-lockfile
```
Expected: `Preparing worktree (new branch 'feat/solar-phase-4b')`, install completes.

- [ ] **Step 3: Record the base facts this plan relies on.** Each command must print a match; if one does not, STOP and report which.

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b
git grep -n "export function simulateCase" -- packages/shared/src/services/solar/case.ts
git grep -n "export const ENGINE_VERSION" -- packages/shared/src/services/solar/version.ts
git grep -n "export function parsePvgisTmyCsv" -- packages/shared/src/services/solar/weather/pvgis-tmy.ts
git grep -n "export function createBillCalculator" -- packages/shared/src/tariffs/bill-calculator.ts
git grep -n "export function tariffFromRows" -- packages/shared/src/tariffs/ingest/supabase-store.ts
git grep -n "CREATE TABLE IF NOT EXISTS solar.site_load" -- apps/edge-functions/supabase/migrations/00211_solar_meter_data.sql
git grep -n "CREATE OR REPLACE FUNCTION solar.library_orgs" -- apps/edge-functions/supabase/migrations/00211_solar_meter_data.sql
git grep -n "export async function requireSolarLevelAPI" -- apps/web/src/lib/solar/api-gate.ts
ls packages/shared/src/services/solar/__fixtures__/pvgis/tmy_jhb.csv.gz packages/shared/src/services/solar/__fixtures__/stub-bill-calculator.ts
```

- [ ] **Step 4: Detect an integration-branch adapter (so this plan does not duplicate it).**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b
git grep -n -E "BillCalculator\b.*=>|toEngineBillCalculator|engineBillCalculator|siteLoadToCaseInput|caseInputFromSiteLoad" -- packages apps ':!**/*.test.ts' ':!packages/shared/src/services/solar/**' ':!packages/shared/src/tariffs/bill-calculator.ts'
```
Record the result in the task log. Task 11 (bill adapter) and Task 17 (run context) each carry an explicit "if Step 4 found an adapter" instruction.

- [ ] **Step 5: Check the migration number is still free, in all three places.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b
git fetch origin
for r in $(git branch -r | grep -v HEAD); do git ls-tree -r --name-only $r -- apps/edge-functions/supabase/migrations | grep -E '/002(1[1-9]|[2-9][0-9])_' | sed "s|^|$r: |"; done | sort -u
gh pr list --state open --json number,files --jq '.[] | select(any(.files[]; .path | test("migrations/002[1-9]"))) | {number, files: [.files[].path | select(test("migrations/"))]}'
```
Expected today (2026-09-28): only `origin/feat/solar-phase-5: …/00212_solar_layouts.sql`. If any branch/PR holds `00216`, STOP and ask which number to use. If `00214` exists on origin, note it: Task 3 concatenates it into the dry run. The ledger (production) check happens at APPLY time, which is not part of this plan (the PR is a draft onto `feat/solar-integration`).

- [ ] **Step 6: Baseline the three suites** (so later failures are attributable).

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b
pnpm --filter @esite/shared test 2>&1 | tail -3
pnpm --filter web test 2>&1 | tail -3
pnpm --filter @esite/db test:ci 2>&1 | tail -3
```
Expected: all green; record the three test counts.

No commit for Task 0.
