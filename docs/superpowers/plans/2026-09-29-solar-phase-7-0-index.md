# E-Site Solar Phase 7 — Operations tab (post-installation) — Implementation Plan (index)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After installation, record the as-built system and its commissioning date (seeded from the ACCEPTED proposal's case), derive the expected generation per month automatically from a chosen guarantee basis, import actual generation through the existing meter pipeline (idempotent, month from the data), track monthly performance, log and auto-detect downtime from the sun's position, generate an immutable monthly client report (`projects.reports` kind `solar_monthly` + frozen metric snapshot + PDF, lost revenue at the pinned tariff's TOU rates via the bill engine), keep engineer commentary separate from the numbers, and track the handover documents against E-Site Documents.

**Architecture:** One migration (`00217_solar_operations.sql`) adds ten `solar.*` tables (installations, installation_meters, guarantees, ops_irradiation, downtime, downtime_history, monthly_report_notes, monthly_reports, handover_templates, handover_items), two SECURITY INVOKER read functions that aggregate generation in SQL and return ONE JSON document (no PostgREST row cap; one reading per meter per interval, so a re-import can never double), the `solar_monthly` report kind in `user_can_read_report_kind()`, and five product events. All arithmetic (month bucketing, guarantee derivation, expected-energy shaping, SPA daylight test, downtime candidates, performance rows, year-to-date, lost energy, the snapshot and the report model, handover completion, readiness) is pure TypeScript in a new `@esite/shared/solar-operations` subpath with unit tests. The web app gates, loads rows through the caller's session (RLS decides), calls the shared functions on the server, values lost energy through 4b's `resolveStudyTariff` with an energy-only bill build, renders the PDF with react-pdf through Phase 6's `pdfText` and `solarBranding`, and never computes a displayed figure in the browser.

**Tech Stack:** Postgres (Supabase) + RLS, Next.js 15 App Router (server components, server actions, route handlers `runtime='nodejs'`), TypeScript, zod, `@react-pdf/renderer` (existing), vitest + RTL, the Phase 4a engine's SPA (`@esite/shared/solar-engine` `solarPosition`), the Phase 2a tariff bill engine (`createBillCalculator`), the Phase 3a meter pipeline (`/api/projects/[id]/solar/meter-files{,/parse,/commit}`), `node:crypto` for SHA-256.

---

## Plan files (execute in order)

| File | Tasks | Produces |
|---|---|---|
| `2026-09-29-solar-phase-7-0-index.md` (this) | 0 | Worktree, preflight facts, decisions, conventions, file map |
| `2026-09-29-solar-phase-7-1-schema.md` | 1–4 | `00217_solar_operations.sql`, behavioural assertions (red → green → eight mutations), product-events registry |
| `2026-09-29-solar-phase-7-2-shared.md` | 5–15 | `@esite/shared/solar-operations`: time, as-built, baseline, guarantee, shape, downtime detection, performance + YTD, lost energy, handover, snapshot + report model, readiness + activity |
| `2026-09-29-solar-phase-7-3-server.md` | 16–25 | Report-kind access, error sentences + RPC wrappers + installation seed, view model loader, installation / meter / guarantee / irradiation / downtime actions, handover actions, lost revenue, monthly report PDF, generation + notes |
| `2026-09-29-solar-phase-7-4-ui.md` | 26–31 | Engine-free client subpath, page + readiness dots, installation + meters + generation import, guarantee + irradiation + performance table, downtime log + candidates, monthly report panel, handover checklist + settings template card |
| `2026-09-29-solar-phase-7-5-finish.md` | 32–35 | rbac-matrix, full verification, two reviewers, push, draft PR |

---

## Decisions this plan takes (flagged for the owner in the final report)

1. **Base branch.** Phase 7 imports Phase 6 (`solar.proposals`, `pdfText`, `solarBranding`, `SOLAR_READ_REPORT_KINDS`, the 00216 CHECK lists) and Phase 4b (`solar.case_runs`, `decodeHourlyCsv`, `resolveStudyTariff`, `getGzipText`). **Task 0 WAITS for `origin/feat/solar-phase-6`**; it never bases on an earlier branch.
2. **The modelled baseline is frozen INTO the installation row at creation** (`installations.baseline`): the accepted run's 12 monthly P50 kWh, a 12 × 24 mean diurnal PV profile (kW per SAST hour of day), the TMY's monthly GHI (kWh/m²), the design PR, DC kWp and AC kW, and the run id + inputs hash. A later case edit, re-run or deletion therefore cannot change the guarantee of an operating plant. The baseline is immutable (trigger); changing it means a new installation record. `as_built` (equipment, sizes) stays editable.
3. **An installation can only be created from an ACCEPTED proposal of the study** (spec §10 "from accepted proposal case"). The bind trigger re-checks `status = 'accepted'` and the study. With no accepted proposal the card says why and links to Reports & Proposal.
4. **Guarantee basis** is ONE current row per installation: `p50` (baseline monthly), `pct_of_modelled` (pct × P50) or `manual` (12 contractual monthly kWh). Expected kWh is derived per month at read time — never typed per month. P50 and %-of-modelled are degraded by `degradation_pct_per_year` (default = the case's annual degradation) from operating year 2; manual is not degraded (it is the contract's own schedule). The commissioning month is prorated by days; a leap February is scaled 29/28 (the TMY February has 28 days).
5. **Meter roles are exclusive and kind-checked**: a generation meter must be `solar.meters.kind = 'solar'`, a consumption meter `council` or `bulk`, one role per meter per installation (PK). The council double-count (WM G5) is therefore impossible by construction. Per-source expected = expected × the meter's `expected_share_pct`; when no share is set every generation meter gets an equal share and the table says "allocated equally".
6. **Re-import is idempotent at two levels.** The pipeline already upserts readings on `(channel_id, ts_end)`; a re-import of a NEW file with overlapping dates creates a second channel on the same meter, so the aggregation keeps exactly ONE reading per `(meter, ts_end)` — the one from the most recently created channel (`DISTINCT ON … ORDER BY created_at DESC, id DESC`). **Month = the SAST calendar month of the interval START** (`ts_end − interval_min`), computed in SQL — never the UI's selected year (WM G4).
7. **Generation is aggregated in SQL** (`public.solar_ops_monthly_kwh`, `public.solar_ops_series`), SECURITY INVOKER (RLS on readings decides), returning one `jsonb` document, so no 1,000-row PostgREST cap can truncate a month (WM M3/G12). A test proves a 2,976-interval month comes back whole.
8. **Downtime candidates**: an interval is daylight when the SPA sun elevation at its MIDPOINT is above 5° (site lat/lng/elevation from `solar.studies`); zero output = ≤ 0.5 % of as-built AC kW; a candidate is ≥ 2 consecutive zero daylight intervals. **Missing data is a gap, never downtime** (WM G14). Candidates overlapping recorded downtime are suppressed. Confirming inserts a row with `source = 'detected'`.
9. **Lost kWh** over a downtime window = Σ (expected − actual, clipped at 0) per interval, where expected is the month's FULL (unprorated) guarantee kWh shaped by the baseline diurnal profile — never a flat per-slot figure (WM G14).
10. **Lost revenue** = the bill engine's marginal energy cost: `monthlyBills(lost energy as import) − monthlyBills(zero)` for the report month, with maximum/peak-window demand forced to 0, using 4b's `resolveStudyTariff` for the report's calendar year (so weekdays, seasons and public holidays are that year's). Rand excl. VAT. **Generate monthly report is disabled with the tariff reason when no tariff is pinned** (Phase 2b not on the base ⇒ `notPinned`).
11. **Irradiation ("if weather uploaded")**: 4b deferred measured-weather upload, and the meter pipeline has no irradiance quantity, so Phase 7 adds a monthly irradiation entry (`ops_irradiation`: plane `poa` or `ghi`, kWh/m², mandatory source note). POA ⇒ PR = actual / (DC kWp × H) and corrected expected = design PR × DC kWp × H. GHI ⇒ corrected expected = guarantee × H / TMY GHI (February scaled for leap years); PR "needs plane-of-array irradiation".
12. **Year to date = calendar year** (January → the report month, from the commissioning month), real sums of every month's actual and guarantee (WM M4).
13. **Monthly report storage**: a `projects.reports` row (kind `solar_monthly`, `source_table 'solar.installations'`, version per PERIOD, summary = headline figures) + a `solar.monthly_reports` row holding the full metric snapshot JSON, its SHA-256 and the PDF's SHA-256. `monthly_reports` is money (SELECT `solar_can_see_money`), written only by the service role after the action's gate, and immutable (no UPDATE/DELETE grant + a guard trigger). Regenerating a month creates v(n+1) and marks v(n)'s `projects.reports` row `superseded`; v(n)'s PDF and snapshot are never touched. **`solar_monthly` reports cannot be deleted** (evidence of what the client received), mirroring Phase 6's proposal rule.
14. **Commentary** (`monthly_report_notes`: summary, performance, downtime, financial, actions) is gated like the report (read AND write `solar_can_see_money`) because the financial section discusses Rand. Numbers always come from the snapshot built at generation; notes are merged in at render time and copied into the snapshot, so saving a note never freezes a figure (WM M1).
15. **Handover**: per-installation items seeded from the org template (`solar.handover_templates`, owner/admin, `/settings/solar`) or the built-in "Solar PV Handover" default; each item links ONE `tenants.documents` id of the same project (the Documents module), or is marked N/A; completion % = (linked + N/A) / all. No folder names anywhere. No links to Schedule tasks (Phase 5b is not on the base).
16. **Downtime has an append-only history** (`downtime_history`: the old row, actor, time) written by trigger on every direct UPDATE/DELETE — downtime feeds a contractual claim (as-is E.9).
17. **Not built:** Solcast forecast (D-08b), notifications/emails (none in the spec for Phase 7), a manual installation without a proposal, per-day "slot overrides" (WM's) — a downtime row IS the override.
18. **Report kinds**: `solar_monthly` → Edit + financials. `00217` redefines `report_kind_is_sensitive()` and `user_can_read_report_kind()` IN FULL with every Solar kind (`solar_layout_sheet`, `solar_technical`, `solar_feasibility`, `solar_proposal`, `solar_monthly`) so the final definition is right whichever Solar branch merges last.
19. **Product events**: 00216's list + `solar_installation_saved`, `solar_guarantee_saved`, `solar_downtime_saved`, `solar_monthly_report_generated`, `solar_handover_updated`.

---

## Open questions (the plan implements the default; the owner may change it)

1. **Installation without an accepted proposal** (a system sold outside the proposal flow). Default: not possible — the card says why. Alternative: allow "from the selected case" with a warning.
2. **Re-baselining** after a re-design. Default: the baseline is immutable; a new baseline means deleting the installation (Edit + financials) and recording it again. Alternative: a "Re-baseline from the accepted proposal" action that keeps downtime and reports.
3. **Degradation default**: the case's annual %, applied from operating year 2; manual schedules are not degraded. Alternative: apply the case's first-year % in year 1 too.
4. **Zero-output threshold and minimum run** for candidates: 0.5 % of AC kW and 2 intervals. Alternative: org settings for both.
5. **Lost revenue basis**: lost kWh valued as avoided IMPORT at the pinned tariff's TOU energy rates (demand forced to 0). Alternative: value at the export credit when the site was exporting at that hour (needs consumption data per interval).
6. **Generate without a pinned tariff**: disabled (as briefed). Alternative: allow a report with the Rand column omitted and a sentence saying why.
7. **Year to date** = calendar year. Alternative: operating year (from the commissioning month) or the licensee's financial year.
8. **Commentary visibility**: Edit + financials only (the financial section discusses Rand). Alternative: split — technical sections at Edit, financial at Edit + financials.
9. **Irradiation input**: a monthly figure typed in with a source note. Alternative: import an irradiance CSV through the meter pipeline (needs a new `quantity` value in 00210's CHECK — a separate migration).
10. **Monthly report deletion**: never (evidence of what the client received). Alternative: owner/admin may delete a superseded version.
11. **Distribution**: no email in Phase 7. Alternative: reuse `notify_solar_email` to send the PDF link to the client on Generate.
12. **Handover links to Schedule tasks** (Phase 5b): not built — 5b is not on the base. Alternative: add an optional `schedule_task_id` once 5b merges.
13. **Product-events CHECK after merges**: `00217` re-declares `00216`'s list plus five; if Phase 5/5b add events and merge after this branch, the integration merge must union the CHECK (same caveat Phase 6 carries).

---

## Conventions every task follows

- Worktree root: `/Users/spud/.config/superpowers/worktrees/esite/solar-phase-7` (below: `$W`). Every command `cd`s explicitly (agent shells reset cwd).
- Scratch directory for SQL bundles: `/private/tmp/claude-501/solar-7` (below: `$S`).
- Server actions: `'use server'`, `createClient()` → `requireSolarLevel(projectId, need, supabase)` FIRST, writes through the caller's session where RLS can decide, service client only after the gate and only for service-only tables/buckets, `expectedUpdatedAt` stale guard (`STALE_MESSAGE`), `humanSolarError` for DB errors, `recordSolarAudit` + `emitProductEvent` after success, `revalidatePath('/projects/<id>/solar', 'layout')`.
- Anything a `page.tsx` hands a `'use client'` component must be JSON (no functions, `Date`, typed arrays, `Map`).
- Destructive controls use `useArmedConfirm` (`app/(admin)/projects/[id]/solar/_components/useArmedConfirm.ts`), never `window.confirm`.
- Every string reaching a PDF goes through Phase 6's `pdfText()`.
- Money (Rand, notes, the report panel) never renders below Edit + financials.
- No email, no notification row, no external HTTP call anywhere in Phase 7.
- Commit after every task with the trailer:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

## File map

### Created

| Path | Responsibility |
|---|---|
| `apps/edge-functions/supabase/migrations/00217_solar_operations.sql` | Tables, bind/guard/history triggers, RLS, two read functions, report-kind gate, product-event CHECK, `@verify` |
| `scripts/db/assert-solar-operations-roles.sql` | Behavioural assertions as real roles |
| `packages/shared/src/solar/operations/{index,time,as-built,baseline,guarantee,shape,downtime-detect,performance,lost-energy,handover,report}.ts` (+ tests), `__fixtures__/baseline.ts` | `@esite/shared/solar-operations` |
| `packages/shared/src/solar/operations/client.ts` | `@esite/shared/solar-operations/client` — the engine-free part for `'use client'` files |
| `apps/web/src/lib/solar/operations/errors.ts` (+ test) | 00217 trigger sentences shown; everything else via `humanSolarError` |
| `apps/web/src/lib/solar/operations/series.ts` (+ test) | RPC wrappers, JSON → typed |
| `apps/web/src/lib/solar/operations/data.ts` (+ test) | Operations page view model loader |
| `apps/web/src/lib/solar/operations/baseline-loader.ts` (+ test) | Accepted proposal → baseline + as-built |
| `apps/web/src/lib/solar/operations/lost-revenue.ts` (+ test) | Bill-engine valuation of lost energy |
| `apps/web/src/lib/solar/operations/monthly-document.tsx`, `render-monthly.ts` (+ render test) | Monthly report PDF |
| `apps/web/src/lib/solar/operations/monthly-report.ts` (+ test) | Generate a monthly report version |
| `apps/web/src/actions/solar-operations.actions.ts` (+ `.installation`, `.inputs`, `.downtime` tests, `.test-helpers.ts`) | Installation, meters, guarantee, irradiation, downtime |
| `apps/web/src/actions/project-reports.solar-monthly.test.ts` | `solar_monthly` read/delete gates |
| `apps/web/src/components/solar/ops-format.ts` (+ test) | Locale-free kWh / % / SAST formatting |
| `apps/web/src/lib/solar/cases/page-data.operations.test.ts` | Operations readiness in the tab dots |
| `apps/web/src/actions/solar-handover.actions.ts` (+ test) | Items, document links, N/A, template |
| `apps/web/src/actions/solar-monthly-report.actions.ts` (+ test) | Generate, save notes |
| `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/operations/{page,OperationsTab,InstallationCard,MetersCard,GenerationImport,GuaranteeCard,IrradiationCard,PerformanceTable,DowntimeLog,MonthlyReportPanel,HandoverChecklist}.tsx` (+ tests) | Operations tab |
| `apps/web/src/app/(admin)/settings/solar/HandoverTemplateForm.tsx` (+ test) | Org handover template |

### Modified

| Path | Change |
|---|---|
| `packages/shared/package.json` | `"./solar-operations"` and `"./solar-operations/client"` exports |
| `apps/web/src/lib/solar/no-browser-engine.contract.test.ts` | Forbids `@esite/shared/solar-operations` runtime imports in client files |
| `apps/web/src/lib/solar/reports/branding.test.ts` | WM-string guard also scans `lib/solar/operations` |
| `packages/shared/src/lib/analytics/product-events.ts` | 5 events |
| `packages/shared/src/solar/readiness.ts` (+ test) | `operations` tab built + visible; Operations readiness rule |
| `packages/shared/src/solar/activity.ts` (+ test) | Operations verbs, target `operations` |
| `apps/web/src/lib/reports/report-kind-access.ts` (+ contract test) | `solar_monthly: 'edit_financials'`; writer scanner |
| `apps/web/src/actions/project-reports.actions.ts` (+ test) | `solar_monthly` never deletable |
| `apps/web/src/components/reports/SavedReportsPanel.tsx` | Monthly summary labels |
| `apps/web/src/lib/solar/cases/page-data.ts` (`loadSolarReadinessExtra`) | Operations readiness input |
| `apps/web/src/app/(admin)/projects/[id]/solar/_components/ActivityList.tsx` (+ test) | `operations` target links to the tab (`activity-types.ts` imports the union, so it needs no change) |
| `apps/web/src/app/(admin)/settings/solar/page.tsx` | Handover template card |
| `docs/rbac-matrix.md` | Every new route/action row |

---

## Task 0: Worktree and preflight

**Files:** none (read-only checks).

- [ ] **Step 1: Confirm the base exists on origin — and WAIT if it does not.**

```bash
git -C /Users/spud/.config/superpowers/worktrees/esite/solar-phase-1a fetch origin
git -C /Users/spud/.config/superpowers/worktrees/esite/solar-phase-1a rev-parse --verify origin/feat/solar-phase-6
```
Expected: a commit sha. **If it errors: STOP and report "origin/feat/solar-phase-6 is not pushed yet — Phase 7 waits for it".** Do not base on `feat/solar-phase-4b` or `feat/solar-integration`: every Phase 7 task imports Phase 6 or 4b code.

- [ ] **Step 2: Create the worktree.**

```bash
git -C /Users/spud/.config/superpowers/worktrees/esite/solar-phase-1a worktree add \
  /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7 -b feat/solar-phase-7 origin/feat/solar-phase-6
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7 && pnpm install --frozen-lockfile
mkdir -p /private/tmp/claude-501/solar-7
```
Expected: `Preparing worktree (new branch 'feat/solar-phase-7')`; install completes.

- [ ] **Step 3: Record the Phase 4b / Phase 6 / Phase 3a facts this plan relies on.** Each command must print at least one match. If one does not, STOP and report which — the task that uses the name must be adjusted before it starts.

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
M=apps/edge-functions/supabase/migrations
git grep -n "CREATE TABLE IF NOT EXISTS solar.case_runs" -- $M/00215_solar_cases.sql
git grep -n "CREATE TABLE IF NOT EXISTS solar.weather_datasets" -- $M/00215_solar_cases.sql
git grep -n "CREATE TABLE IF NOT EXISTS solar.proposals" -- $M/00216_solar_proposals.sql
git grep -n "CREATE OR REPLACE FUNCTION public.user_can_read_report_kind" -- $M/00216_solar_proposals.sql
git grep -n "CREATE TABLE IF NOT EXISTS solar.meter_readings" -- $M/00210_solar_meter_data.sql
git grep -n "CREATE TABLE IF NOT EXISTS solar.study_meters" -- $M/00210_solar_meter_data.sql
git grep -n "export function decodeHourlyCsv" -- packages/shared/src/solar/cases/hourly-csv.ts
git grep -n "export interface CaseRunOutputs\|export interface MonthlyRow" -- packages/shared/src/solar/cases/outputs.ts
git grep -n "CaseConfigSchema = \|degradation:" -- packages/shared/src/solar/cases/config.ts
git grep -n "export async function resolveStudyTariff\|export const TARIFF_REASONS" -- apps/web/src/lib/solar/cases/tariff.ts
git grep -n "export async function getGzipText\|export const RUNS_BUCKET\|export const WEATHER_BUCKET" -- apps/web/src/lib/solar/cases/storage.ts
git grep -n "export async function loadSolarReadinessExtra" -- apps/web/src/lib/solar/cases/page-data.ts
git grep -n "export interface SolarReadinessExtra\|export function computeSolarReadiness" -- packages/shared/src/solar/readiness.ts
git grep -n "export function pdfText" -- apps/web/src/lib/solar/reports/pdf-text.ts
git grep -n "export function solarBranding" -- apps/web/src/lib/solar/reports/branding.ts
git grep -n "export async function loadSolarBrandingData" -- apps/web/src/lib/solar/reports/branding-loader.ts
git grep -n "export function extractPdfText" -- apps/web/src/test/pdf-text.ts
git grep -n "export function withStorage" -- apps/web/src/test/fake-storage.ts
git grep -n "SOLAR_READ_REPORT_KINDS" -- apps/web/src/lib/reports/report-kind-access.ts
git grep -n "export function fixed\|export const pct" -- packages/shared/src/solar/reports/fmt.ts
git grep -n "export function solarPosition" -- packages/shared/src/services/solar/solar-position/spa.ts
git grep -n "export function parsePvgisTmyCsv" -- packages/shared/src/services/solar/weather/pvgis-tmy.ts
git grep -n "export function monthHourRanges" -- packages/shared/src/services/solar/time.ts
git grep -n "export function createBillCalculator" -- packages/shared/src/tariffs/bill-calculator.ts
git grep -n "export const CommitBodySchema" -- apps/web/src/lib/solar/meter-import/commit.ts
git grep -n "export async function sha256Hex" -- packages/shared/src/meter-data
git grep -n "export function useArmedConfirm" -- 'apps/web/src/app/(admin)/projects/[id]/solar/_components/useArmedConfirm.ts'
```
Record in the task log: the exact name of the weather bucket constant (`WEATHER_BUCKET` or another), the file that holds `CaseConfigSchema` (if it is not `config.ts`, use the one `git grep -l "export const CaseConfigSchema" -- packages/shared/src/solar/cases` names), and the `computeSolarReadiness` signature (Task 13 adds an `operations` field to `SolarReadinessExtra`).

- [ ] **Step 4: Record the facts Phase 7 decides on.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
M=apps/edge-functions/supabase/migrations
# (a) The last migration on the base that re-declares product_events_event_check (Task 1 copies its list).
git grep -l "product_events_event_check" -- $M | sort | tail -1
# (b) The last migration that (re)defines user_can_read_report_kind (Task 1 redefines it in full).
git grep -l "FUNCTION public.user_can_read_report_kind" -- $M | sort | tail -1
# (c) Is 00213 (tariff selection, Phase 2b) on the base? If not, every tariff resolves "not pinned".
ls $M/00213_*.sql 2>/dev/null || echo "00213 NOT on base: monthly report Generate will show the not-pinned reason"
# (d) The documents table the Documents module reads.
git grep -n "schema('tenants')" -- 'apps/web/src/app/(admin)/projects/[id]/documents/page.tsx'
```
Expected today: (a) `00216_solar_proposals.sql`, (b) `00216_solar_proposals.sql`, (c) the "NOT on base" line (unless 2b merged), (d) a `.from('documents')` on `tenants`. If (a) or (b) names a later migration, Task 1 copies ITS list/branches instead and keeps every value.

- [ ] **Step 5: Check the migration number in all three places (it is claimed at APPLY time; this is only the branch check).**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
git fetch origin
for r in $(git branch -r | grep -v HEAD); do git ls-tree -r --name-only $r -- apps/edge-functions/supabase/migrations | grep -E '/002(1[1-9]|[2-9][0-9])_' | sed "s|^|$r: |"; done | sort -u
gh pr list --state open --json number,files --jq '.[] | select(any(.files[]; .path | test("migrations/002[1-9]"))) | {number, files: [.files[].path | select(test("migrations/"))]}'
grep -h -o -E '002[0-9]{2}_[a-z_]+\.sql' /Users/spud/.config/superpowers/worktrees/esite/solar-phase-1a/docs/superpowers/plans/*.md | sort -u
```
Expected: `00211`–`00216` claimed by Solar branches/plans; nothing holds `00217`. If ANY branch, PR or plan holds `00217`, STOP and ask which number to use.

- [ ] **Step 6: Baseline the three suites.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
pnpm --filter @esite/shared test 2>&1 | tail -3
pnpm --filter web test 2>&1 | tail -3
pnpm --filter @esite/db test:ci 2>&1 | tail -3
```
Expected: all green; record the three counts.

No commit for Task 0.
