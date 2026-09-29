# E-Site Solar Phase 6 — Reports & Proposal, client view, Solar portfolio — Implementation Plan (index)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a selected case's stored run into deliverables — a branded feasibility report (money) and technical report (no money), and a client proposal that is drafted, previewed, issued as a frozen snapshot + PDF + SHA-256 behind a hashed, expiring share link, accepted or declined by the client (public token page, no login, or the client portal) with server-stamped evidence — plus the org-level Solar portfolio page.

**Architecture:** One migration (`00217_solar_proposals.sql`) adds `solar.proposals` (money, per-verb RLS on `solar_can_see_money`, a guard trigger that freezes everything once issued), append-only `solar.proposal_events`, `solar.proposal_templates` (org terms/disclaimer/validity), SERVICE-ONLY `SECURITY DEFINER` functions for every client-facing and state-changing path (token lookup hashes the raw token in SQL; nothing is granted to `anon`), a `solar_portfolio()` read function, the Solar report kinds in `user_can_read_report_kind()`, `notify_solar_email`, two notification types and six product events. All pure logic (number formatting, offer price, draft schema, finance options, frozen snapshot, key figures, report model, proposal status) lives in a new `@esite/shared/solar-reports` subpath and is unit-tested there; the web app loads stored rows, renders react-pdf documents through `winAnsiSafe`, and never re-simulates — a proposal's finance options are computed once at issue from the STORED hourly series (the 4b `runStoredFinancials` path) and frozen.

**Tech Stack:** Postgres (Supabase) + RLS, Next.js 15 App Router (server components, server actions, `runtime='nodejs'` route handlers), TypeScript, zod, `@react-pdf/renderer` (existing), `pdf-lib` (existing, for appending the layout sheet), `@anthropic-ai/sdk` (NEW dependency, server-only, for the optional narrative — D-17), vitest + RTL, `node:crypto` for token + SHA-256.

---

## Plan files (execute in order)

| File | Tasks | Produces |
|---|---|---|
| `2026-09-28-solar-phase-6-0-index.md` (this) | 0 | Worktree, preflight facts, decisions, conventions, file map |
| `2026-09-28-solar-phase-6-1-schema.md` | 1–4 | `00217_solar_proposals.sql`, behavioural assertions (red → green → mutations), product events + notification types registry |
| `2026-09-28-solar-phase-6-2-shared.md` | 5–10 | `@esite/shared/solar-reports`: fmt, offer, draft, finance options, snapshot + key figures, report model, proposal status, readiness + activity |
| `2026-09-28-solar-phase-6-3-pdf.md` | 11–14 | PDF text sanitiser + test extractor, neutral branding, feasibility/technical document, proposal document (glyph + figure tests) |
| `2026-09-28-solar-phase-6-4-server.md` | 15–24 | Report-kind access, report generation, `notify_solar_email` chain, proposal libs + actions, preview/issue/withdraw/revise/new link, narrative, public token routes + middleware, portal actions |
| `2026-09-28-solar-phase-6-5-ui.md` | 25–31 | Reports & Proposal tab, proposal editor + issue dialog + acceptance record, client view + signature pad, public token page, portal pages, Overview shortcut, settings templates card |
| `2026-09-28-solar-phase-6-6-portfolio-finish.md` | 32–36 | `/solar` portfolio page + sidebar, rbac-matrix, full verification, two reviewers, push, draft PR |

---

## Decisions this plan takes (flagged for the owner in the final report)

1. **Base branch.** Phase 6 imports Phase 4b modules on nearly every file (`solar.cases`, `case_runs`, `case_run_financials`, `@esite/shared/solar-cases`, `lib/solar/cases/*`). It therefore cannot be built on `feat/solar-integration` alone. **Task 0 WAITS for `origin/feat/solar-phase-4b`**; it does not base on the integration branch and rebase later (there would be nothing to compile against).
2. **Report kinds follow the Solar level, not an E-Site role** (the Phase 5 `SOLAR_READ_REPORT_KINDS` pattern): `solar_technical` → View, `solar_feasibility` → Edit + financials, `solar_proposal` → Edit + financials (clients get the proposal PDF only through the token page or the portal, via a 7-day service-signed URL after their own gate). `solar_layout_sheet` → View is carried into `00217`'s redefinition of `user_can_read_report_kind()` so the FINAL definition gates all four whichever Solar branch merges first. `report_kind_is_sensitive()` also lists `solar_feasibility` and `solar_proposal` (belt and braces; the Solar branches of the CASE run first).
3. **Every client-facing and state-changing proposal function is SERVICE-ONLY.** `solar_proposal_by_token`, `solar_proposal_respond_by_token`, `solar_portal_proposals`, `solar_portal_proposal`, `solar_portal_respond`, `solar_issue_proposal`, `solar_withdraw_proposal`, `solar_rotate_proposal_link` are `SECURITY DEFINER`, `EXECUTE` granted to `service_role` only (revoked from `PUBLIC`, `anon`, `authenticated`). The Next layer runs its own gate (token shape + rate limit; `requirePortalAccess`; `requireSolarLevel(…, 'edit_financials')`) and stamps IP/UA from request headers — a caller can never forge the stamp through PostgREST because it cannot call the function at all. Security baseline item 1 ("no anon grants") holds with zero exceptions.
4. **Token = 32 random bytes, base64url (43 chars); stored as the SHA-256 hex of the token.** The CHECK `share_token_hash ~ '^[0-9a-f]{64}$'` makes storing a raw token impossible, and the lookup refuses any string that is not the 43-char token shape (so the stored hash itself cannot be replayed as a token). Default expiry 30 days (org template `validity_days`, 1–365). **New link** rotates the token (old link dies) — spec §5.6 "revocable". The raw link is shown ONCE after Issue / New link, with Copy; it cannot be reconstructed.
5. **`expired` is derived, not stored**: `solar.proposal_effective_status(status, expires_at)` (SQL) and `effectiveProposalStatus` (TS) agree; no job flips rows. No `expired` event row is written.
6. **Issued proposals are evidence**: the guard trigger refuses any user-path change once `status <> 'draft'`, refuses every change to the frozen columns on every path, and refuses deleting a non-draft proposal directly (FK cascades from a project delete still work, `pg_trigger_depth() > 1`). `deleteProjectReportAction` refuses `solar_proposal` report rows. `proposal_events` has no UPDATE (trigger) and no DELETE grant for anyone.
7. **Issuing v(n+1) withdraws any live earlier version** of the same family (event reason "Superseded by version n+1"). **Revise** is refused while any version of the family is accepted, and while a draft already exists (unique partial index).
8. **Finance options are computed at Preview and at Issue from the stored run** (hourly CSV + 4b `buildFinanceInput` + `runStoredFinancials`), with capex replaced by the offer price and only the models the proposal offers — this is financial arithmetic on stored energy, not a re-simulation. Offerable models = the models enabled on the case's Financials tab (their inputs live there). Without a pinned tariff (Phase 2b) or saved financials, Preview/Issue are disabled with that reason.
9. **Report options**: *Include layout sheet* appends the latest issued `solar_layout_sheet` PDF for the case's layout (pdf-lib), and is disabled with a reason for a manual-size case or when no sheet exists; *Include 8760 appendix* adds an appendix page naming the run and the hourly export (the CSV itself is downloaded from 4b's export route — the `reports` bucket only accepts PDF, so no ZIP); *Include bill check* is disabled "Bill check arrives with the Tariff tab (Phase 2b)".
10. **Neutral branding fallback**: org/project logo + accent when present; otherwise the org name as wordmark and a neutral slate accent `#334155` (never the E-Site/WM amber `#E69500`), with an on-screen warning. No Watson Mattheus string anywhere in Solar report code (a test greps for it).
11. **`notify_solar_email`** (new `projects.project_settings` column, default TRUE, wired through schema → mapper → service → restore → Integrations panel, pinned by the existing notification-toggle contract test) gates (a) the optional client email at Issue and (b) the proposer's acceptance/decline email. The bell always fires. Tests and probes never send; probes run with the toggle OFF.
12. **Portal:** a "Proposals" tab for client viewers lists every non-draft version on the project and opens the same `ProposalClientView` as the token page (identical figures). Portal viewing marks a proposal viewed. Token and portal access do **not** check the org's Solar subscription — an issued offer stays readable/acceptable until it expires or is withdrawn (the org's Solar module is still hidden-but-kept for its own staff).
13. **"Ask a question" (spec §9.4) is NOT built** — the brief lists Accept/Decline/Download/expired only. The page shows the proposer's name and email (frozen in the snapshot) as the contact line.
14. **AI narrative (D-17):** `@anthropic-ai/sdk`, model `claude-opus-5` (overridable by `SOLAR_NARRATIVE_MODEL`), server-side only, key from `ANTHROPIC_API_KEY`, server-side refusal fallback to `claude-opus-4-8` enabled (`server-side-fallback-2026-06-01`). Button disabled with the reason when the key is absent. Rate-limited 10 per org per 10 minutes. Only frozen numbers and the project/client names are sent; the result is inserted as editable text and saved to the draft.
15. **Portfolio (§15):** table + filters + KPIs only — **there is no map component in `apps/web`** (verified in Task 0 Step 4), so the map is not built and the page says so. "kWp operating" and "generation YTD vs guarantee" render "Available with Operations (Phase 7)". Unsubscribed org: owner/admin get the Subscribe button (it derives the org from any of the org's projects); others get "Solar is not active for <org> — ask an admin".
17. **Offer price base = the case's capex excl. VAT minus any capex lines in the 4b `margin` category** (4b's `CAPEX_CATEGORIES` includes `margin`); the proposal's margin % is then applied once. The snapshot holds the CLIENT price only (offer excl. VAT, VAT, incl. VAT) — never the capex or the margin, because the snapshot is what the client receives.
16. **Proposal templates** live in a new table `solar.proposal_templates` (terms, disclaimer, validity days), NOT in `solar.org_settings.settings`, because `saveSolarSettingsAction` overwrites that whole JSON document. Default margin comes from the 4b rate-card field `rc_margin_pct` (NULL ⇒ 0 %, which the editor flags).

---

## Conventions every task follows

- Worktree root: `/Users/spud/.config/superpowers/worktrees/esite/solar-phase-6` (below: `$W`). Every command `cd`s explicitly (agent shells reset cwd).
- Scratch directory for SQL bundles: `/private/tmp/claude-501/solar-6` (below: `$S`).
- Server actions: `'use server'`, `createClient()` → `requireSolarLevel(projectId, need, supabase)` FIRST, writes through the caller's session where RLS can decide, service client only after the gate and only for service-only functions/buckets, `expectedUpdatedAt` stale guard (`STALE_MESSAGE`), `humanSolarError` for DB errors, `recordSolarAudit` + `emitProductEvent` after success, `revalidatePath('/projects/<id>/solar', 'layout')`.
- API routes: `export const runtime = 'nodejs'`; `app/api/*` sits outside `(admin)/layout.tsx`, so each gates itself first.
- Anything a `page.tsx` hands a `'use client'` component must be JSON (no functions, `Date`, typed arrays).
- Destructive controls use `useArmedConfirm` (`app/(admin)/projects/[id]/solar/_components/useArmedConfirm.ts`), never `window.confirm`.
- Every string reaching a PDF goes through `pdfText()` (Task 11) = `winAnsiSafe(…, { collapseWhitespace: false })` after spelling out ✓/✗.
- Money never renders below Edit + financials. Emails are never sent in tests (`fetch` is mocked; `ANTHROPIC_API_KEY` unset unless a test sets it).
- Commit after every task with the trailer:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

---

## File map

### Created

| Path | Responsibility |
|---|---|
| `apps/edge-functions/supabase/migrations/00217_solar_proposals.sql` | Tables, guard/bind triggers, RLS, service-only functions, portfolio function, report-kind gate, toggle column, notification + event CHECKs, `@verify` |
| `scripts/db/assert-solar-proposals-roles.sql` | Behavioural assertions as real roles |
| `packages/shared/src/solar/reports/{index,fmt,offer,proposal-draft,finance-options,snapshot,report-model,proposal-status}.ts` (+ tests) | `@esite/shared/solar-reports` |
| `apps/web/src/test/pdf-text.ts` | WinAnsi-aware PDF content-stream text extractor for tests |
| `apps/web/src/lib/solar/reports/{pdf-text,branding,report-document,render-report,proposal-document,render-proposal,selected-case,generate,page-data}.ts(x)` (+ tests) | Rendering + report generation |
| `apps/web/src/lib/solar/proposals/{token,finance,prepare,narrative,notify,client,request-meta}.ts` (+ tests) | Proposal server libs |
| `apps/web/src/actions/solar-reports.actions.ts` (+ test) | Generate feasibility / technical |
| `apps/web/src/actions/solar-proposals.actions.ts` (+ test) | create / save / delete draft / revise / issue / withdraw / new link / narrative |
| `apps/web/src/actions/solar-proposal-templates.actions.ts` (+ test) | Org terms/disclaimer/validity |
| `apps/web/src/actions/solar-portal-proposals.actions.ts` (+ test) | Portal accept/decline/download |
| `apps/web/src/app/api/projects/[id]/solar/proposals/[proposalId]/preview/route.ts` (+ test) | Preview PDF |
| `apps/web/src/app/api/solar/proposal-response/route.ts` (+ test) | Public accept/decline (token in body) |
| `apps/web/src/app/api/solar/proposal-download/route.ts` (+ test) | Public signed PDF URL (token in body) |
| `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/reports/{page,ReportGenerator,ProposalsPanel,ProposalEditor,IssueDialog,AcceptanceRecord}.tsx` (+ tests) | Reports & Proposal tab |
| `apps/web/src/components/solar/proposal/{ProposalClientView,SignaturePad}.tsx` (+ test) | Client view (token + portal) |
| `apps/web/src/app/(proposal)/layout.tsx`, `apps/web/src/app/(proposal)/proposal/[token]/page.tsx` | Public token page |
| `apps/web/src/app/(portal)/portal/[projectId]/proposals/page.tsx`, `…/proposals/[proposalId]/page.tsx` | Portal listing + detail |
| `apps/web/src/app/(admin)/projects/[id]/solar/_components/GenerateFeasibilityButton.tsx` (+ test) | Overview shortcut |
| `apps/web/src/app/(admin)/settings/solar/ProposalTemplatesForm.tsx` (+ test) | Terms/disclaimer/validity |
| `apps/web/src/lib/solar/portfolio.ts` (+ test), `apps/web/src/app/(admin)/solar/{page,PortfolioTable}.tsx` (+ test) | Portfolio page |

### Modified

| Path | Change |
|---|---|
| `packages/shared/package.json` | `"./solar-reports"` export |
| `packages/shared/src/lib/analytics/product-events.ts` | 6 events |
| `packages/shared/src/solar/readiness.ts` (+ test) | `reports` tab built; Reports readiness rule |
| `packages/shared/src/solar/activity.ts` (+ test) | proposal/report verbs, target `reports` |
| `packages/shared/src/schemas/project-settings.schema.ts`, `services/_project-settings-mappers.ts`, `services/project-settings.service.ts` | `notifySolarEmail` |
| `apps/web/package.json` | `@anthropic-ai/sdk` |
| `apps/web/src/lib/reports/report-kind-access.ts` (+ contract test) | `SOLAR_READ_REPORT_KINDS` (+ the three Solar kinds) |
| `apps/web/src/actions/project-reports.actions.ts` (+ test) | Solar-level read/delete gates; `solar_proposal` never deletable |
| `apps/web/src/components/reports/SavedReportsPanel.tsx` | Solar summary labels |
| `apps/web/src/lib/solar/notify.ts` | two notification types |
| `apps/web/src/lib/solar/activity-types.ts`, `…/_components/ActivityList.tsx` | `reports` target |
| `apps/web/src/middleware.ts` (+ test) | `/proposal/` public; two public API paths |
| `apps/web/src/components/portal/PortalProjectNav.tsx` (+ test) | "Proposals" tab |
| `apps/web/src/app/(admin)/projects/[id]/settings/integrations/{IntegrationsPanel,page}.tsx` | Solar email toggle |
| `apps/web/src/app/(admin)/projects/[id]/solar/_components/OverviewKpis.tsx` (+ test) | Shortcut live |
| `apps/web/src/app/(admin)/settings/solar/page.tsx` | Templates card |
| `apps/web/src/components/layout/Sidebar.tsx` | "Solar portfolio" global link |
| `docs/rbac-matrix.md` | Every new route/action/API row |

---

## Task 0: Worktree and preflight

**Files:** none (read-only checks).

- [ ] **Step 1: Confirm the base exists on origin — and WAIT if it does not.**

```bash
git -C /Users/spud/.config/superpowers/worktrees/esite/solar-phase-1a fetch origin
git -C /Users/spud/.config/superpowers/worktrees/esite/solar-phase-1a rev-parse --verify origin/feat/solar-phase-4b
```
Expected: a commit sha. **If it errors: STOP and report "origin/feat/solar-phase-4b is not pushed yet — Phase 6 waits for it".** Do NOT base on `origin/feat/solar-integration`: every Phase 6 task imports 4b code (`solar.case_runs`, `@esite/shared/solar-cases`, `lib/solar/cases/*`), so an integration-based branch would not compile and a later rebase would rewrite every task.

- [ ] **Step 2: Create the worktree.**

```bash
git -C /Users/spud/.config/superpowers/worktrees/esite/solar-phase-1a worktree add \
  /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6 -b feat/solar-phase-6 origin/feat/solar-phase-4b
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6 && pnpm install --frozen-lockfile
mkdir -p /private/tmp/claude-501/solar-6
```
Expected: `Preparing worktree (new branch 'feat/solar-phase-6')`; install completes.

- [ ] **Step 3: Record the 4b facts this plan relies on.** Each command must print a match; if one does not, STOP and report which (4b may have renamed something — the task that uses it must be adjusted before starting).

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
git grep -n "CREATE TABLE IF NOT EXISTS solar.case_runs" -- apps/edge-functions/supabase/migrations/00216_solar_cases.sql
git grep -n "CREATE TABLE IF NOT EXISTS solar.case_run_financials" -- apps/edge-functions/supabase/migrations/00216_solar_cases.sql
git grep -n "selected_case_id" -- apps/edge-functions/supabase/migrations/00216_solar_cases.sql | head -1
git grep -n "export interface CaseRunOutputs" -- packages/shared/src/solar/cases/outputs.ts
git grep -n "export function runStoredFinancials" -- packages/shared/src/solar/cases/stored-financials.ts
git grep -n "export function buildFinanceInput" -- packages/shared/src/solar/cases/finance-input.ts
git grep -n "export function capexTotals" -- packages/shared/src/solar/cases/finance-config.ts
git grep -n "export function caseStatus" -- packages/shared/src/solar/cases/status.ts
git grep -n "export async function loadStudyInputs\|export async function contextForCase" -- apps/web/src/lib/solar/cases/run-context.ts
git grep -n "export async function runsByCase\|export async function latestMoney\|export async function loadSolarReadinessExtra" -- apps/web/src/lib/solar/cases/page-data.ts
git grep -n "export async function resolveStudyTariff" -- apps/web/src/lib/solar/cases/tariff.ts
git grep -n "export async function getGzipText\|export const RUNS_BUCKET" -- apps/web/src/lib/solar/cases/storage.ts
git grep -n "rc_margin_pct" -- packages/shared/src/solar/org-settings.ts
git grep -n "solar_equipment_saved" -- packages/shared/src/lib/analytics/product-events.ts
git grep -n "export function OverviewKpis" -- 'apps/web/src/app/(admin)/projects/[id]/solar/_components/OverviewKpis.tsx'
git grep -n "export function mwh\|export function rand\|export function pct" -- apps/web/src/components/solar/format.ts
```

- [ ] **Step 4: Record the facts Phase 6 decides on.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
# (a) Is Phase 5 already merged into the base? If this prints a line, Task 15 Step 1 changes (see there).
git grep -n "SOLAR_READ_REPORT_KINDS" -- apps/web/src/lib/reports/report-kind-access.ts || echo "phase-5 report kinds NOT on base"
# (b) No map component exists (decision 15). Expect no output.
git grep -l -i -E "mapbox|leaflet|maplibre|google\.maps|react-map" -- apps/web/src apps/web/package.json || echo "no map component"
# (c) The last migration on the base that re-declares each CHECK (Task 1 copies its list).
git grep -l "product_events_event_check" -- apps/edge-functions/supabase/migrations | sort | tail -1
git grep -l "notifications_type_check" -- apps/edge-functions/supabase/migrations | sort | tail -1
# (d) No Anthropic SDK yet.
grep -n "@anthropic-ai/sdk" apps/web/package.json || echo "no anthropic sdk"
```
Expected today: (a) "NOT on base", (b) "no map component", (c) `00216_solar_cases.sql` and `00209_solar_org_settings.sql`, (d) "no anthropic sdk". Record all four in the task log. If (c) names a later migration, Task 1 copies ITS list instead of the one printed in Task 1.

- [ ] **Step 5: Check the migration number in all three places (it is claimed at APPLY time; this is only the branch check).**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
git fetch origin
for r in $(git branch -r | grep -v HEAD); do git ls-tree -r --name-only $r -- apps/edge-functions/supabase/migrations | grep -E '/002(1[1-9]|[2-9][0-9])_' | sed "s|^|$r: |"; done | sort -u
gh pr list --state open --json number,files --jq '.[] | select(any(.files[]; .path | test("migrations/002[1-9]"))) | {number, files: [.files[].path | select(test("migrations/"))]}'
```
Expected: `00212` (phase-5), `00216` (phase-4b), possibly `00213`/`00214`. If ANY branch or PR holds `00217`, STOP and ask which number to use. Note whether `00214` exists (Task 2/3 concatenate it into the dry run).

- [ ] **Step 6: Baseline the three suites.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter @esite/shared test 2>&1 | tail -3
pnpm --filter web test 2>&1 | tail -3
pnpm --filter @esite/db test:ci 2>&1 | tail -3
```
Expected: all green; record the three counts.

No commit for Task 0.
