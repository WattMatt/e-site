# Solar Phase 2b — Platform Tariff Library UI + Project Tariff Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give E-Site's platform tariff admins a web UI to maintain the South African tariff library (licensees, sources, ingest, review beside the source, checks, YoY diff, publish, TOU calendars, SSEG rules, due-year alerts), and give Edit + financials users a project Tariff tab that pins the exact published tariff and sets export crediting, overrides, escalation and a bill check.

**Architecture:** One migration (`00213_solar_tariff_selection.sql`) adds the study tariff columns behind a money-level trigger guard, four money tables readable only at `solar_can_see_money`, and the library-operations tables/functions the admin UI needs — proven red→green against production in rolled-back transactions with seven mutations. Pure helpers in `packages/shared/src/solar/tariff/` (eligibility, escalation, export rule, override, bill check, calendar, source locator, readiness) are shared by server loaders, server actions and client components. The admin UI reuses 2a's ingestion core verbatim (workbooks inline in an API route; RfD PDFs queued for a staff worker because `pdftotext` is not on Vercel). Every page, action and route re-asks the database (`is_platform_tariff_admin()` / `solar_access_level()`).

**Tech Stack:** Postgres (Supabase) with `@verify` blocks and `scripts/db/dry-run-migration.sh`; Next.js 15 App Router (server components + server actions + one route handler); React 19; `pdfjs-dist` (browser page render); `exceljs` (server, via 2a parsers); Vitest + Testing Library; pnpm/Turborepo.

**Specs (exactly):** `docs/solar/01-functional-spec.md` §5 (Tariff tab) and §12 (platform tariff library) with §0.4 rules; `docs/solar/03-data-model-and-security.md` §3 (studies columns, `tariff_overrides` + `tariff_override_charges`, `bill_checks`; money tables gated by `solar_can_see_money`) and §3.1; decisions D-03, D-03b, D-07, D-10, D-29 (`docs/solar/06-open-decisions.md`).

**Base:** `origin/feat/solar-integration` (1c + merges of 4a, 2a, 3a). Branch `feat/solar-phase-2b`, NEW worktree `~/.config/superpowers/worktrees/esite/solar-phase-2b`. Other branches are never modified.

---

## The plan is split into five files — execute in order

| Part | File | Tasks |
|---|---|---|
| 1 | `2026-09-28-solar-phase-2b-tariff-ui-1-migration.md` | 1 worktree + baseline · 2 behavioural assertions (RED) · 3 migration 00213 (GREEN, earlier assertion files unchanged, every `@verify` block of the chain evaluated) · 4 seven mutations |
| 2 | `2026-09-28-solar-phase-2b-tariff-ui-2-shared.md` | 5 labels/money · 6 eligibility · 7 financial year + escalation (D-07) · 8 export rule · 9 override rows (D-10) · 10 bill check · 11 calendar + source locators · 12 tariff readiness + barrel + Tariff tab built · 13 ingest job runner |
| 3 | `2026-09-28-solar-phase-2b-tariff-ui-3-admin.md` | 14 admin gate/errors/year loader/checks · 15 library actions · 16 review actions (fingerprinted validate, publish, SSEG) · 17 calendar save · 18 ingest API route · 19 PDF ingest worker · 20 source viewer · 21 shell/overview/licensees/sources · 22 years/review/diff/SSEG pages · 23 calendars/reports/sidebar link |
| 4 | `2026-09-28-solar-phase-2b-tariff-ui-4-tariff-tab.md` | 24 row mappers/calendar loader/effective tariff/errors · 25 tab loader · 26 tab actions · 27 picker + charges table · 28 override/export/escalation/bill-check/report panels · 29 page, readiness dot, activity text |
| 5 | `2026-09-28-solar-phase-2b-tariff-ui-5-finish.md` | 30 rbac-matrix · 31 full verification · 32 two foreground reviewers · 33 push + draft PR |

---

## Decisions this plan takes (D2b-*) — each is also an open question below where the owner may overrule

- **D2b-1 — One migration claim.** `00213` carries both the Tariff-tab schema and the library-operations objects (`tariffs.error_report`, `tariffs.ingest_job`, `tariffs.due_year_alert`, the validation fingerprint, the job claim, the due-year monitor). Claiming a second number would double the collision exposure (four collisions in six days). It conforms to every schema-wide `@verify` directive of 00207 and 00209 (Part 1 Task 3 Step 4 proves it).
- **D2b-2 — The manual export RATE is money, so it lives in a money table.** `solar.studies` is readable at View (00207 pins one SELECT policy on it), so `studies.export_rule` stores only `{version, method, sourceNote}`; the rand/cent rate goes to `solar.study_export_rates` (SELECT on `solar_can_see_money`). `tariff_id`, `tariff_override_id`, `escalation` (percentages) and `licensee_id` hold no rand value and stay on `studies` as spec §3 lists.
- **D2b-3 — "Report a tariff error" is a platform queue (`tariffs.error_report`), not a work item.** Neither `task` nor a new `solar_action`: (a) work items are project-scoped and visible through `user_has_project_access`, so the platform tariff admins — who are not members of customer projects — could never see an item "assigned to platform tariff admins"; (b) a new work-item type must re-declare `work_items_source_required` and `projects.work_items_ensure_ref()`, which Phase 5b's `00212` also re-declares for `solar_task` — whichever applies last silently drops the other's arm. The queue is read by the reporter and the admins, resolved by the admins, and shown on `/admin/tariffs`.
- **D2b-4 — The Tariff tab's write level is enforced by the database.** A trigger (`studies_tariff_guard`) refuses a signed-in caller without `solar_can_see_money` who changes any tariff column (42501), so an Edit user cannot pin a tariff over REST while still saving Site & Supply. A policy cannot express "this column" and a second SELECT/RESTRICTIVE policy would break 00207's pinned directives.
- **D2b-5 — Licensee resolution.** `studies.licensee_id` is added. The tab resolves the licensee from the pinned tariff, else Site & Supply's free-text `licensee_name` through `tariffs.licensee_alias` (2a's normalisation), else an exact name match; when nothing matches it shows the spec's "Choose the supply authority on Site & Supply" plus a "link to a library licensee" select. Pinning a tariff rebinds `licensee_id` to the tariff's licensee (a forged one is overwritten).
- **D2b-6 — Ingest runs where its tools exist.** Workbooks (province XLSX, Eskom XLSM) run inline in `POST /api/admin/tariffs/ingest` (`maxDuration = 300`, dry run then apply, 2a's `buildIngestPlan` + `runIngest` + `createSupabaseTariffStore` unchanged). RfD PDFs need poppler's `pdftotext -layout` (2a's parser is written against that layout; not on Vercel), so they are queued as `tariffs.ingest_job` and executed by `scripts/tariffs/ingest-worker.ts` on the staff machine with the same core. Uploads go browser → signed upload URL → Storage (Vercel's ~4.5 MB body cap), then the server re-hashes before registering.
- **D2b-7 — AI-assisted extraction is out** (per the brief). A PDF-only book is ingested by the deterministic RfD parser or not at all.
- **D2b-8 — Audit rows, no new `product_events` verbs.** Widening `product_events_event_check` means re-declaring it in full, which sibling Solar migrations also do → last-applied wins and drops the others' verbs. Same default Phase 5's layout plan took. Audit rows carry ids only (View users read the activity feed).
- **D2b-9 — Due-year monitor scope.** It watches licensees that have ever had a published/superseded year (a never-ingested licensee is backlog, not an alert — otherwise ~170 alerts on day one). Eskom: 1 April; municipal and metro: 1 July. It resolves an alert when a covering year is published. The function and a "check now" button ship; the pg_cron schedule is an owner step (documented in the migration header and the PR body).
- **D2b-10 — Validate records a verdict only on the content it checked.** `tariffs.year_content_fingerprint()` is read before loading; `tariffs.record_year_validation()` locks the year row and refuses (40001) if the fingerprint moved; a racing content write waits for the lock and then clears the record through 00209's invalidation trigger.
- **D2b-11 — Platform pages 404 for non-admins** (E-Site has no platform-level admin pages to copy; `/metrics` is org-role gated). The sidebar shows "Tariff library" only to allow-listed users.

## Ground rules (every task)

- **G1** Work only in `~/.config/superpowers/worktrees/esite/solar-phase-2b` on `feat/solar-phase-2b`. Never check out or modify another branch or the canonical `esite/` checkout.
- **G2** Before claiming anything done: `pnpm --filter @esite/shared test`, `pnpm --filter web test`, `pnpm --filter @esite/db test:ci`, both `type-check`s, both `lint`s, `pnpm --filter web build`. `packages/db` replays the migration TEXT (anon EXECUTE model) — the web/shared suites cannot see its failures.
- **G3** Migration number: `00213` is claimed at apply time, not now. Before pushing, re-check the ledger, `origin/main` and every open PR's migration filenames (Part 5 Task 33 Step 1). This branch never applies a migration.
- **G4** No `BEGIN`/`COMMIT` in the migration (the dry run wraps it; a `COMMIT` would make the production dry run permanent). Every `sql:` payload free of em dashes outside string literals.
- **G5** Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The PR body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **G6** A `page.tsx` hands a `'use client'` component JSON only (the 2026-09-22 rule). Client components build their own closures over server actions.
- **G7** Every server action and route re-checks its gate before reading money or touching the service client; the service client never reaches a client component.
- **G8** Spec §0.4 on every control: two-step inline confirm for destructive actions (`useArmedConfirm`, never `window.confirm`); `expectedUpdatedAt` on saves; a unit on every number; buttons disabled + spinner while pending (`Button isLoading`); human sentences only; an empty state with its one action on every list.
- **G9** A fixture must be able to fail: each SQL assertion is seen red (no 00213) and each key assertion is seen red under a named mutation (Part 1 Task 4).

## File structure

| File | Responsibility |
|---|---|
| `apps/edge-functions/supabase/migrations/00213_solar_tariff_selection.sql` | Studies tariff columns + guard; money tables + RLS + bind; override functions; error_report, ingest_job, due_year_alert; fingerprint, record_year_validation, claim_ingest_job, record_due_year_alerts |
| `scripts/db/assert-solar-tariff-selection-roles.sql` | 61 behavioural checks as real roles (View/Edit/Edit+financials/client/supplier/foreign/tariff admin/service/anon/lapsed) |
| `packages/shared/src/solar/tariff/{labels,eligibility,financial-years,escalation,export-rule,override,bill-check,calendar,source-locator,readiness,index}.ts` | Pure Tariff-tab and library helpers (+ tests) |
| `packages/shared/src/solar/index.ts` | `+ export * from './tariff'` |
| `packages/shared/src/solar/readiness.ts` (+ test) | Tariff tab `built: true` |
| `packages/shared/src/solar/activity.ts` (+ test) | Sentences for the new audit verbs |
| `packages/shared/src/tariffs/ingest/{job-runner,supabase-jobs}.ts` (+ tests), `ingest/index.ts` | Queued ingest execution; service-role job queue access |
| `scripts/tariffs/ingest-worker.ts` | Staff-machine worker (pdftotext) |
| `apps/web/src/lib/tariffs/{admin-gate,errors,load-year,year-checks,source-files,sha256,sseg-form,calendar-form}.ts` (+ tests) | Library server helpers and form validation |
| `apps/web/src/actions/{tariff-library,tariff-review,tariff-calendar}.actions.ts` (+ tests) | Library server actions |
| `apps/web/src/app/api/admin/tariffs/ingest/route.ts` (+ test) | Workbook ingest (dry run / apply) |
| `apps/web/src/components/tariffs/{SourceViewer,PdfPageCrop,TouCalendarDiagram}.tsx` (+ tests) | Shared by the admin review queue and the Tariff tab |
| `apps/web/src/app/(admin)/admin/tariffs/**` | Library pages and their client components |
| `apps/web/src/lib/solar/tariff/{rows,calendar-loader,effective-tariff,errors,load-tariff-tab}.ts` (+ tests) | Tariff tab server helpers |
| `apps/web/src/actions/solar-tariff.actions.ts` (+ test) | Tariff tab server actions |
| `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/tariff/**` | Tariff page and panels |
| `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/{layout.tsx,overview/page.tsx}` | Tariff readiness dot |
| `apps/web/src/app/(admin)/layout.tsx`, `apps/web/src/components/layout/Sidebar.tsx` (+ test) | "Tariff library" link for platform tariff admins |
| `docs/rbac-matrix.md` | Tariff tab + platform library rows |

## After merge (owner steps — the agent does none of these)

1. Apply `00213` through the deploy workflow after re-checking the three numbering places; `scripts/verify-migration-applied.ts` re-checks every block ≥ 00185.
2. Schedule the two pg_cron jobs (SQL in the migration header / PR body).
3. Add the first row to `public.platform_tariff_admins` (service role; seeded empty by 00209).
4. Staff Mac: `brew install poppler`; run the ingest worker while PDF ingests are queued.
5. The signed-in walk (PR body lists it) — not verifiable by the agent.

## Open questions (with the recommended default this plan implements)

1. **Report a tariff error → where?** Default: `tariffs.error_report` platform queue (D2b-3). Alternatives: project `task` (admins cannot see it) or a new `solar_action` type (collides with 00212's spine re-declarations; revisit after 00212 lands if a project-side record is also wanted).
2. **Due-year monitor scope.** Default: only licensees with a published/superseded year (D2b-9). Alternative: every registry licensee (≈170 alerts until the library is full).
3. **Where the PDF worker runs.** Default: the staff Mac (`ingest-worker.ts --interval 60`). Alternative: port the RfD parser to pdfjs text so the server can run it — changes 2a's parser input and golden tests; not now.
4. **Unmatched supply authority.** Default: the Tariff tab offers "link to a library licensee" (writes `studies.licensee_id`). Alternative: turn Site & Supply's free-text field into a library picker (a Phase 1c change).
5. **Product events for tariff actions.** Default: none now (D2b-8); add all Solar verbs in one consolidating migration later.
6. **Bill check input.** Default: enter one bill (kWh by TOU or total, kVA, total R). Bill upload = document extraction = out of scope with AI extraction.
7. **"Project-specific rates" on the report.** Default: deferred to the Reports phase; the flag is `studies.tariff_override_id IS NOT NULL`.
8. **Municipal TOU hours.** Default: admins create a municipal calendar with "Copy Eskom hours" (source `assumed_eskom`); when a licensee has none, the Tariff tab falls back to Eskom's calendar and shows the assumed-hours banner. No calendar is seeded (Eskom's current windows must be entered from the Eskom book by an admin).
9. **Bulk approve in the review queue.** Default: per-charge Approve only (every inferred unit is looked at individually, which is the point of the review); add bulk later if volume demands.
10. **Parent licensee editing.** Default: not exposed in the UI (2a's registry script owns `parent_licensee_id`).
11. **Picker filters.** Default: metering + phase selects; voltage band and kVA/amp ranges act through automatic eligibility (hidden under "Show all" with the reason) rather than as separate filter controls.

## Self-review (done while writing)

- **Spec coverage — §12:** licensee registry (Task 21) · source documents upload to `tariff-sources` with sha256/FY/status (15, 21) · Ingest (18, 19, 21; AI out) · review queue beside a PDF page crop / cell snippet with Approve/Edit/Reject (16, 20, 22) · automatic checks list (14, 22) · YoY diff with outliers (22) · Publish year, blocked by SQL unless validated (16, 22) · TOU calendars & holidays (17, 23) · SSEG rules (16, 22) · due-year monitor function + documented cron (Part 1, 15, 21). **§5:** licensee (29) · financial year with superseded label and amber note (7, 27) · tariff picker with eligibility + Show all (6, 27) · charges table with View source (27, 20) · TOU diagram + holidays + assumed_eskom banner (11, 23, 29) · export/SSEG panel incl. manual municipal rate with mandatory note (8, 28) · create/revert override + per-row reason + required unit select (9, 26, 28) · escalation path with D-07 defaults (7, 28) · bill check ±5 % (10, 26, 28) · report a tariff error (26, 28) · Edit + financials only (26, 29). **03 §3:** studies columns, override tables, bill checks, money SELECT on `solar_can_see_money` (Part 1).
- **Placeholders:** none; every code step carries full code. Two steps say "read the base file first" where the plan edits a 1c file whose exact current text the executor must match (admin layout destructuring; `Sidebar.test.tsx` existence) — both give the exact code to insert.
- **Type consistency checked:** `validateRateEdit`/`validateOverrideEdit` (Part 2) used by `editChargeAction` / `editSolarOverrideChargeAction`; `summariseIngestReport` / `IngestReportSummary` (Part 2) used by the route, worker and `IngestPanel`; `TouCalendarRow` (with `holidayTreatedAs`) used by `calendarFromRows` in Parts 2, 3, 4; `PinnedCharge` / `BillCheckRow` (Part 4 `rows.ts`) used by the panels; `TariffTabData.holidays` used by the page; action result shapes (`{ ok } | { error } | { fieldErrors }`) match every component's handling.
