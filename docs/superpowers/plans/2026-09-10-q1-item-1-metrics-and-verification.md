# Metric Instrumentation, the October Baseline and Migration-Verification Tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the tooling that proves a migration actually applied, then land the Q1 ordinal-1 migration it protects — the event stream, the weekly snapshot store, presence, sessions and the working-day calendar — and freeze one honest four-week baseline before the programme starts changing the numbers.

**Architecture:** A pure parser in `@esite/shared` reads a `-- @verify:begin/end` block out of a migration file and turns each line into a SQL predicate; a thin Node CLI posts those predicates to the Supabase Management API and exits non-zero on any that is not `true`, including the case where the migration's version is absent from `supabase_migrations.schema_migrations`. One migration then creates `public.product_events` (append-only stream), `public.platform_metrics_weekly` (materialised weekly fact table), `public.metric_cohorts`, the `public.metric_accounts` view and its `metric_account_excluded()` rule, `public.user_presence` / `public.user_sessions` / `public.touch_presence()`, `public.user_is_org_admin()` and Appendix A(h)'s `projects.public_holidays` / `projects.calendar_years` / `projects.working_days_between()`, plus a `pg_cron` job that writes a snapshot row for every metric every Monday whether or not it moved. A server-only `emitProductEvent` helper writes the stream through a `service_role`-only RPC, and `/metrics` under `(admin)` renders the snapshot behind `requireRolePage(OWNER_ADMIN)` **and** a RESTRICTIVE database policy.

**Tech Stack:** PostgreSQL **17.6** (Supabase project `cbskbnvvgcybmfikxgky` — measured with `version()`; `apps/edge-functions/supabase/config.toml:16` also declares `major_version = 17`). `CREATE VIEW … WITH (security_invoker = true)` used in Task 9 needs 15+, so the floor is comfortably met. Also: `pg_cron`, Supabase Management API `/v1/projects/{ref}/database/query`, TypeScript, Next.js 15 App Router (React 19 server components), Vitest, pnpm + Turborepo, bash + `jq` for the DB smoke scripts.

**Spec:** §16 Appendix A(f) (Q1 migration ledger, ordinal 1), A(g) (`/metrics` row), A(h) (the working-day calendar); §15 §(a) the headline metrics, §(b) instrumentation required from Q1 day one, §(b2) operating the scheduled estate; §12 §(b) RLS/grants/function security, §(c) the numbering-race protocol and the `-- @verify:` convention, §(h) testing strategy tests 5 and 8, §(i) observability (the `product_events` DDL); §13 Q1 item 1.

**Depends on:** Q1 item 0 (pre-window housekeeping — repository-secret confirmation, the `generate-report` workflow step, and migration 0, the `project_notification_recipients` hardening). Nothing in this plan reads item 0's objects, but item 0's migration must be merged and verified first so this migration is ordinal 1 and not ordinal 0. **Item 0 ships `00185_resend_email_delivery_evidence.sql` carrying its own `-- @verify:begin` block** — Task 3 Step 7 and Task 4's `PROGRAMME_FLOOR` both depend on that, and say so where they do.

---

## Improvements folded in

Thirteen changes came out of the product review and are built into the tasks below as real code, not as notes. Each is listed with the measurement that justified it, so a reader can check the reasoning rather than take it.

| # | Change | Task | Why, measured |
|---|---|---|---|
| 1 | **`_active` counts writes to the source tables, not only `trackServer`'s five office files** — four extra `EXISTS` arms over `site_diary_entries.created_by`, `snags.raised_by`, `qc_entries.created_by`, `rfis.raised_by`, `rfi_responses.responded_by`, `inspections.created_by`, `form_responses.latest_responded_by`, `reports.generated_by` | 12 | Measured over the equivalent trailing four weeks (2026-08-06 → 2026-09-03): **5 distinct writers, all inside `metric_accounts`, 3 of them contractors.** Under the events-only definition the frozen October baseline reads **0 / 23** and **0 / 12** — not because nobody worked, but because `user_sessions` has no writer until item 4 (wk 6.0) and the source mirrors are item 3 (wk 4.17–6.67). This is the only arm that is measurable **retrospectively**, which is the whole point of a baseline. |
| 2 | **`client_active` becomes an eleventh metric key**, with the client-viewer cohort frozen at 4 and a note saying no client wave runs before Q3 | 9, 12 | There was no client metric in the eight. §15 §(c) puts client viewers in Wave 3 (Q3) with nothing measured before, and the last client sign-in was 8 July 2026 — so Q3's portal would be judged against a number first computed the quarter it ships. Measured cohort: **4** accounts whose effective role on an active project is `client_viewer`, inside `metric_accounts`. |
| 3 | **One real presence call site now** — `public.touch_presence('web')` from the `(admin)` layout's existing `Promise.all`, costing no extra wall-clock time | 13 | The plan created `user_presence`, `user_sessions` and `touch_presence()` and deferred every caller to item 4. A writer-less column is the exact pathology this item exists to name (`notifications.read_at`, snag `photo_type`, `email_sequence_events.opened_at`). Without a writer, metric 1's baseline is events-only and every later week is sessions+events — the number rises when the heartbeat lands and it looks like the programme worked. |
| 4 | **The calendar `@verify` directives assert an invariant, not a row count**, and the seed runs to **2035** | 6, 7, 11 | `SELECT count(*) = 8 FROM projects.calendar_years` breaks every deploy the day §15 §(b2)'s October re-seed adds a year — a self-inflicted hard block on every subsequent migration, caused by the tool built to prevent silent failure. And `working_days_between` correctly RAISES on an unseeded year, so a 2031 horizon means every due-date computation throws in January 2032. Seeding 2024–2035 is one argument to the generator: **160 rows, 12 years** (measured). |
| 5 | **`working_days_between` has no `DEFAULT 'office'`** — every caller states its calendar | 11 | §15 fixes three calendars for three consumers; the chase ladder (item 4, a different author, weeks later) uses **site**. A silent office default makes a contractor working Saturdays look a day later than he is. The plan already forbids a silent calendar-day fallback for exactly this reason. |
| 6 | **`notifications_created` gets a denominator** — notifications per first-party write | 12 | 750 of the 964 production notifications are `diary_created` (measured). With a bare count, the "down ≥ 60%" exit criterion is met by the product going quiet. A metric where success and abandonment are the same number is the defect this plan opens by describing. |
| 7 | **Cohort counts filter on `as_of`** | 12 | The PK is `(cohort_key, user_id, as_of)`, so a second `as_of` is legal and the table's name invites one. The Task 9 assertions already filter on `as_of`; the function did not. A frozen cohort that can silently unfreeze is not frozen. |
| 8 | **`/metrics` warns when the snapshot is stale**, not only when it is absent | 14 | `cloud-sync-poll` was specified, merged, never scheduled, ran 11 times manually, and surfaced two months later as a user complaint about stale floor plans. The page's own doctrine — "no row must mean did not run" — is only enforced in the empty state, which stops being true after the first tick. |
| 9 | **A "Previous week" column and a delta** | 14 | The page already fetches 200 rows and throws all but two windows away one line before they would answer the only question a partner asks: is it moving? |
| 10 | **The sidebar entry and `<h1>` read "Adoption"**; the route stays `/metrics` | 14 | "Metrics" beside "Settings" promises project numbers this page will not carry until Q2 item 14. The route string is unchanged so `docs/rbac-matrix.md`, §15 and A(g) need no amendment. |
| 11 | **`contractor_active_all` resolves role through `user_effective_project_role`, not `user_organisations.role`** | 12 | §15 §(a) metric 2b: *"every account whose **effective role on any active project** is `contractor`"*. Role in this system is per project — that is why the plan is careful to stamp `effective_role` at write time. Measured: 12 either way today, so nothing moves; getting the definition wrong is not something a `method_version` bump fixes cheaply. |
| 12 | **`METRIC_TARGET_Q1.contractor_active_frozen` reads "6 of 12 (50%)"** | 9 | The plan establishes at length that the frozen cohort is 12, then left the registry saying 6 of 13 — two numbers for one metric, in the file that is supposed to be the single source of truth. |
| 13 | **The email-delivery measurement gap is published on `/metrics`**, as `detail` on `inbox_engagement`, rather than only in a markdown file | 12, 17 | Measured: `public.email_sequence_events` holds **246 sends to all 36 accounts, `opened_at` NULL on all 246, `clicked_at` NULL on all 246, `resend_message_id` populated on 235.** The webhook route itself is deferred (see below) — but the gap becomes visible in week one instead of being buried. |

Ten frictions from the same review are also fixed: the header counts `METRIC_KEYS.length` rather than hard-coding eight; every metric carries a unit string; the four-value status enum stays in the database and renders as two phrases on the page with the `note` carrying the reason; the empty state names the exact command to check `cron.job_run_details` (the `cron` schema is **not** PostgREST-exposed — `config.toml:9` lists eleven schemas and `cron` is not among them, so the page cannot read it through the caller's session); the 2a row carries an instrumentation note; the page header names `docs/metrics-baseline-2026-10.md` by path and every non-`measured` row carries a `note`; the CLI takes a `--dir` flag so the failing fixture is never copied into the live migrations folder; fixture exclusion becomes `public.metric_account_excluded(text)` so a future exclusion is one `CREATE OR REPLACE`; the recap's metric block is stated as `OWNER_ADMIN`-only for item 7's author; and `FOOTER_ITEMS` entries carry `adminOnly: true` instead of a growing `!==` chain.

## Deferred improvements

| Improvement | Recommendation | Reason |
|---|---|---|
| **A Resend webhook route writing `opened_at` / `clicked_at`** on `public.email_sequence_events` (and §05's send ledger), reusing the `standardwebhooks` verification the `auth-email-hook` edge function already runs | **q1-separate-item** | It is a new public ingress with its own signature-verification and `anon`-revoke surface, and this item's migration is already the longest in the quarter. But "unowned" is not a schedule: book it in Arno's lane beside item 14 (capture-path corrections, already first on the cut list) — it depends on nothing and can run at wk 0. Without it, "contractors did not come back" cannot be separated from "it went to spam" or "the address is dead", and those have different remedies. The free half — publishing the gap on `/metrics` — is folded in above. |
| The 60-second presence heartbeat and the `es_seen` middleware fallback | later-quarter (Q1 item 4) | This item now ships one real call site (improvement 3), which is what makes the baseline honest. The heartbeat is the dispatcher's consumer and belongs with it (§13 item 4). |
| `public.auth_events.session_id` | later-quarter (Q1 migration 9) | It is written by the backfill that also emits the `backfill_completed` event; splitting them would leave a column with no writer, which is the thing this plan refuses to do. |
| A scheduled-estate panel on `/metrics` (nine ledgers, last-run times) | later-quarter (Q1 item 13) | Eight of the nine ledgers do not exist yet. Improvement 8's staleness banner covers the one that does. |
| Revoking `anon` EXECUTE on `public.user_is_org_admin(uuid)` | q1-separate-item | Measured true in production today (`00177:273-274` revokes from `PUBLIC` and grants `authenticated`, never naming `anon`). Revoking it changes the evaluation of three live RESTRICTIVE policies for anonymous requests and needs its own verification. |
| Widening the fixture-exclusion rule to cover `esite-demo.co.za` | reject | Two accounts sit there (measured) and they inflate metric 2b's denominator permanently. It is still a reject: a second exclusion list is a second source of truth. Improvement-fold #8's `metric_account_excluded()` makes the *mechanism* one place; whether `esite-demo` belongs in it is a product decision for the owner, reported as a diagnostic in `docs/metrics-baseline-2026-10.md`. |
| Retiring the `assignee_source` diagnostic at `rfi.actions.ts:69` | later-quarter (Q1 item 2) | Once assignment is mandatory it can only ever report `explicit`. Removing it now deletes the one signal this item exists to make readable. |

---

## Working tree

All paths below are relative to `/Volumes/Extreme SSD/DEVELOPER/APPS/ESITE.V1/wt-v2-roadmap` — a git worktree on branch `docs/v2-platform-roadmap`, cut from `origin/main` at `70ac208`, clean and current. **Do not touch the main checkout at `../esite`** (stale branch, 30 dirty files). Work on a new branch cut from this worktree's HEAD.

Run every pnpm command from the repo root with `--filter`; never `cd` into `apps/*`.

```
pnpm --filter @esite/shared test
pnpm --filter @esite/shared type-check
pnpm --filter web test
pnpm --filter web type-check
pnpm --filter web lint
```

Push over HTTPS with the gh token — there is no SSH key:

```
git push "https://x-access-token:$(gh auth token)@github.com/WattMatt/e-site.git" <branch>
```

---

## Eight constraints that each caused a live incident. They apply here.

1. **`supabase db push` keys on the version PREFIX.** A number already in `schema_migrations` makes it print "Remote database is up to date", exit 0 and skip the file. That is how PR #163's migration never applied behind a green workflow. **A green `Deploy DB Migrations` is not evidence a migration ran.** Task 15 claims the number at merge against `max(version)` **and** `origin/main`, and Task 16 reads every object back out of production.
2. **`REVOKE ... FROM PUBLIC` does not remove `anon`'s EXECUTE.** Supabase's `ALTER DEFAULT PRIVILEGES` grants `anon` *directly* at creation — a separate grant. Verify with `has_function_privilege('anon', oid, 'EXECUTE')`, **never** by reading `proacl` (a NULL `proacl` looks empty but *is* the PUBLIC grant). Measured proof in this repo, right now: `00177_membership_write_authz_rls.sql:273-274` revokes from `PUBLIC` and grants to `authenticated` but never names `anon`, and production returns `has_function_privilege('anon','public.user_is_org_admin(uuid)','EXECUTE') = true` today. Same story for tables: `00025_grant_schema_permissions.sql:26` makes every new table in `projects` born anon-readable (measured: `has_table_privilege('anon','projects.reports','SELECT') = true`).
3. **A RESTRICTIVE policy alone grants nothing.** RLS is default-deny; a RESTRICTIVE policy only *intersects*. Every table here needs a PERMISSIVE SELECT policy **and** the RESTRICTIVE admin gate, the shape `00183_report_notes_summary_and_kind_read_gate.sql` settled on.
4. **Never use `current_user` for authorisation inside a `SECURITY DEFINER` function** — it resolves to the function *owner*, which is what made the first site-form transition trigger silently inert (`00179_site_forms.sql:341-346`). Use `auth.uid()`. Any role test that can yield NULL for a non-member is `COALESCE`d to FALSE, because `NULL IN (…)` is NULL.
5. **Page-level gating is not a gate.** Server actions and `app/api/*` routes are directly invocable and sit outside `(admin)/layout.tsx`. `/metrics` is gated in the app *and* in the database — **and the database gate is org-scoped where the table holds per-org rows.** A zero-argument admin check is true for an owner of *any* organisation, so `product_events` (which carries `organisation_id NOT NULL`) and `metric_cohorts` are gated with the existing one-argument `public.user_is_org_admin(uuid)`. Only `platform_metrics_weekly`, which holds platform-wide aggregates and no per-org row, uses the zero-argument overload §15 names.
6. **Verify from the empty state a real user starts in, never from a deep link into seeded data.** `/metrics` is walked before any snapshot row exists (Task 16) and again after (Task 17).
7. **`public.user_is_org_admin` ALREADY EXISTS** — `public.user_is_org_admin(p_org_id uuid)`, created by `00177_membership_write_authz_rls.sql:256`. **Three RESTRICTIVE write policies depend on it, all on `public.user_organisations`** (`org_membership_write_authz_insert` / `_update` / `_delete`) — measured against production 2026-09-10 with `pg_policies`. `projects.project_members`' three RESTRICTIVE policies call a **different** function, `user_can_manage_project_members(project_id)` (`00177:277-296`). The spec's `public.user_is_org_admin()` is a **zero-argument overload**, not a replacement; writing `CREATE OR REPLACE FUNCTION public.user_is_org_admin(p_org_id uuid)` would silently rewrite the existing function under those three policies. Task 7 creates the no-arg overload only. Proven safe in a rolled-back production transaction: inside the transaction `pg_proc` held **2** overloads and all 17 policies on those two tables survived; after `ROLLBACK`, **1** overload.
8. **`docs/rbac-matrix.md` changes in the same PR as any new route** (Task 14). `CONFORMANCE.md` changes in the same PR as any auth change (Task 14). **Appendix A(f) changes in the same PR as any new table, view or function** (Task 7 Step 8).

**Two deliberate divergences from §15, recorded here so a later reader diffing the spec against the shipped objects does not treat either as drift.**

- §15 §(a) line 11 specifies the weekly job "following the inline-key `net.http_post` pattern the repo already uses (`00148:136-142`)". This plan schedules `cron.schedule('platform-metrics-weekly', '0 4 * * 1', 'SELECT public.compute_platform_metrics_weekly(…)')` **directly**, because there is no edge function to call and the direct form removes the entire class of failure that broke `cloud-sync-poll` on its first tick — the edge runtime injects `SUPABASE_SERVICE_ROLE_KEY` as `sb_secret_…`, not a JWT, so a function-to-function call fails the JWT-role gate 4/4.
- §15 §(b) line 88 specifies the writer as `public.touch_presence(p_platform)`, one argument. This plan ships `public.touch_presence(p_platform text, p_user_agent text DEFAULT NULL)`, two, because `user_sessions.user_agent` is in §15's own column list and otherwise has no source. The `@verify` directive, the grant and every future caller key on the two-argument signature.

Both go in the Task 15 PR body under "Measured, not assumed".

**On §12 §(h) test 8.** Item 0's plan states at its Step 2 that test 8 "diffs the union of all `-- @verify:` blocks against A(f) in both directions". **That test does not exist in the repository yet and this plan does not build it** — Task 4 builds test 5 (every programme migration carries a well-formed block declaring the tables, views and functions it creates) and nothing more. Registering the new objects in A(f) (Task 7 Step 8) is therefore a discipline enforced by review, not by CI, until someone owns test 8. It is listed under "What this item deliberately leaves for later".

---

## File Structure

### Created

| Path | Responsibility |
|---|---|
| `packages/shared/src/lib/migrations/verify-header.ts` | Pure parser + predicate builder for the `-- @verify:begin/end` block. No I/O, no network. The one place the directive grammar is defined. |
| `packages/shared/src/lib/migrations/verify-header.test.ts` | Unit tests for the parser, the predicate builder and the evaluator — including the tests that prove a directive returning `false` fails the run and that a multi-argument function directive can go red. |
| `packages/shared/src/lib/migrations/__fixtures__/00999_fixture_absent_object.sql` | A migration fixture whose block names an object that does not exist. Used to prove the runner fails rather than passing vacuously. |
| `scripts/verify-migration-applied.ts` | The CLI. Reads migration files (from `--dir`, default the real migrations folder), requires a well-formed block, asserts the version is present in `supabase_migrations.schema_migrations`, evaluates every directive through the Management API, exits non-zero naming the file, the line and the directive. |
| `scripts/db/dry-run-migration.sh` | Wraps a migration file plus one or more assertion files in `BEGIN; … ROLLBACK;` and posts it as one Management-API query. The red/green loop for SQL, against real production data, leaving zero residue. |
| `apps/edge-functions/supabase/migrations/00186_q1_metrics_presence_calendar.sql` | **Number is a placeholder — re-claimed at merge (Task 15).** The Q1 ordinal-1 migration: event stream, weekly snapshot store, cohorts, the accounts view and its exclusion rule, presence, sessions, the no-arg admin helper, the A(h) calendar, the rollup function and the `pg_cron` job. |
| `scripts/db/assert-metrics-foundation-static.sql` | Assertions that read **only applied structure** — objects, RLS, policies, grants, calendar arithmetic, the cron job. Safe to run read-only against production after the apply. Ends in one `SELECT … UNION ALL` returning `(check text, ok boolean)`. |
| `scripts/db/assert-metrics-foundation-seeded.sql` | Assertions that need rows seeded first — the event writer's role stamp, the presence round-trip, the rollup's ten-key output. Seeds them at the top of the file and is only ever run **inside a transaction that rolls back**. Same output shape. |
| `scripts/db/smoke-test-metrics-foundation.sh` | House-style smoke test (`scripts/db/smoke-test-*.sh`): runs the static file read-only, runs the seeded file inside its own `BEGIN … ROLLBACK`, exercises the raising path and the cross-org read gate, and compares the SQL calendar against the TypeScript mirror using the fixture project's own settings. |
| `scripts/db/gen-public-holidays-seed.ts` | Prints the `projects.public_holidays` `VALUES` block for a year range from `listHolidaysNamed()`. The seed is *derived*, never hand-typed. |
| `scripts/db/capture-metrics-baseline.sh` | Runs the frozen October baseline once over 2026-09-03 → 2026-10-01 and prints the markdown table for `docs/metrics-baseline-2026-10.md`. |
| `packages/shared/src/lib/calendar/working-days.ts` | The TypeScript mirror of `projects.working_days_between`, taking an explicit `ProjectCalendar`. Deliberately **not** the JBCC module — see the statutory/operational split in Task 11. |
| `packages/shared/src/lib/calendar/working-days.test.ts` | Unit tests for the mirror, including a due date landing inside the December builders' shutdown. |
| `packages/shared/src/lib/calendar/public-holidays.contract.test.ts` | Parses the seeded rows back out of the migration file and asserts set equality with `listHolidaysNamed()` for every seeded year. Runs in CI with no database. |
| `packages/shared/src/lib/analytics/product-events.ts` | The product-event key registry and the metric-key registry with their labels, units and Q1 targets. One source of truth for all four. |
| `packages/shared/src/lib/analytics/product-events.contract.test.ts` | Set equality in both directions between the registry and the CHECK constraints parsed out of the migration. |
| `apps/web/src/lib/analytics/product-events.ts` | `emitProductEvent()` — server-only, service-role, never throws, never awaited on a user-visible path. |
| `apps/web/src/lib/analytics/product-events.test.ts` | Unit tests: swallows a failing RPC, forwards the stamped arguments, coerces `undefined` to `null`, refuses an unregistered key. |
| `apps/web/src/lib/analytics/product-events.contract.test.ts` | Every file under `apps/web/src/actions` that calls `trackServer(` must also call `emitProductEvent(`. This is the mechanism that stops call sites forgetting. |
| `apps/web/src/lib/presence.ts` | `touchPresence()` — the one real presence call site, invoked from the `(admin)` layout inside its existing `Promise.all`. |
| `apps/web/src/app/(admin)/metrics/page.tsx` | The `/metrics` server component. `requireRolePage(OWNER_ADMIN)`, reads through the caller's own session so the RESTRICTIVE policy is genuinely exercised. |
| `apps/web/src/app/(admin)/metrics/page.test.tsx` | Asserts the page calls `requireRolePage(OWNER_ADMIN)`, renders the empty state with no snapshot rows, renders a stale-snapshot warning, and never renders an unmeasurable metric as a number. |
| `apps/web/src/lib/migration-verify-block.contract.test.ts` | §12 §(h) test 5: every programme migration carries a well-formed `-- @verify:` block declaring every **table, view and function** it creates. |
| `docs/metrics-baseline-2026-10.md` | The frozen baseline, recorded with its bounds and its unmeasurable cells stated honestly. |

### Modified

| Path | Change |
|---|---|
| `packages/shared/src/lib/jbcc/sa-public-holidays.ts` | Add `listHolidaysNamed(year)`; `listHolidays` delegates to it. Output order and contents are byte-identical — a test pins that. |
| `packages/shared/src/lib/jbcc/sa-public-holidays.test.ts` | Append the named-variant suite and the refactor regression pin. |
| `packages/shared/src/index.ts` | Export the three new module directories from the barrel (`:44` is the current last jbcc export). |
| `.github/workflows/deploy-migrations.yml` | Add the post-push verification step after the `Run migrations` step (`:38`). **Needs a `workflow`-scoped token or Arno's hand** — see Task 4. |
| `apps/web/src/actions/rfi.actions.ts` | `:72`, `:155`, `:212` — emit the product event beside each `trackServer` call; `:69`'s `assigneeSource` diagnostic is re-emitted into `product_events`. |
| `apps/web/src/actions/snag.actions.ts` | `:99`, `:175` — emit beside each `trackServer` call. |
| `apps/web/src/actions/project.actions.ts` | `:147`, `:234` — emit beside each `trackServer` call. `:234` passes `projectId: null` because the row is already deleted by the chain at `:226-230`. |
| `apps/web/src/actions/supplier.actions.ts` | `:446` — emit beside the `trackServer` call, passing `projectId ?? null`. |
| `apps/web/src/actions/onboarding.actions.ts` | `:86`, `:132` — emit beside each `trackServer` call. |
| `apps/web/src/app/(admin)/layout.tsx` | Add `touchPresence()` to the existing `Promise.all` (`:44-51`), so presence has a writer from week one at no added latency. |
| `apps/web/src/components/layout/Sidebar.tsx` | `:11` icon import; `FOOTER_ITEMS` (`:92-96`) gains an `Adoption` entry and an `adminOnly` flag; the non-admin filter (`:127-129`) filters on the flag. |
| `docs/rbac-matrix.md` | The `/metrics` row in the `(admin)` page table, after `/settings/integrations` (`:72`). |
| `CONFORMANCE.md` | C11 evidence (`:61`) extended; `Last updated` (`:10`) bumped. |
| `docs/superpowers/specs/2026-09-09-v2-platform-roadmap/16-appendix-registries.md` | A(f)'s Q1 `public` row gains `emit_product_event()`, `compute_platform_metrics_weekly()` and `metric_account_excluded()`. |

### Deliberately NOT created

- **`public.sa_public_holidays`** — A(f) "Not created, by ruling" [R24]. `projects.public_holidays` is the one materialisation, and it is seeded from the computus this repo already has.
- **`project_settings.works_saturdays`** — deleted by A(h). `projects.project_settings.working_days int[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]` (`00101_project_settings.sql:20`, verified present in production on all 14 rows) already carries the working week; a second column for the same fact is a drift waiting to be filed.
- **`/team` or `/team/metrics`** — never created (A(g)). Verified: no `team` and no `metrics` directory exists under `apps/web/src/app` today (`(admin)/` holds `cable-schedule`, `dashboard`, `diary`, `inspections`, `marketplace`, `projects`, `rfis`, `settings`, `site`, `snags`).
- **Any new table to hold "last verified version"** — the verifier is stateless and re-evaluates every block on every run, which is also how it catches a *later* migration that quietly dropped an earlier object.
- **A change to `public.audit_log`** — it stays the compliance record. It has no session or read semantics and is not the analytics store.
- **A change to `apps/web/src/lib/analytics.ts`** — `trackServer` keeps fanning out to PostHog exactly as it does. Nothing new depends on it, and no headline metric may.

---

## Task 1 — The `-- @verify:` block parser

**Why this exists.** §12 §(h) test 5 and §15's risk table both require this check and neither section owns it. There is no such script in the repository today — `scripts/` holds `db`, `jbcc`, `paystack`, `sql` and five one-off scripts, none of them this (verified). Eleven Q1 migrations land on a shared checkout behind it.

**Files:**
- Create: `packages/shared/src/lib/migrations/verify-header.ts`
- Test: `packages/shared/src/lib/migrations/verify-header.test.ts`

The directive grammar, fixed here and nowhere else. §12 §(c) names `table`, `function`, `policy`, `constraint`, `index` and `grant_absent`; `view`, `column`, `trigger`, `cron` and `sql` are added because A(f)'s Q1 ledger contains column adds, this migration schedules a `pg_cron` job, and three of its assertions are value assertions rather than existence assertions. That is the whole set — no others.

- [ ] **Step 1: Write the failing parser test.**

  Create `packages/shared/src/lib/migrations/verify-header.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest'
  import { parseVerifyBlock } from './verify-header'

  const SQL = `
  -- =============================================================================
  -- Migration 00186 — example
  -- =============================================================================
  -- @verify:begin
  -- table: public.product_events
  -- view: public.metric_accounts
  -- function: public.touch_presence(text,text)
  -- column: projects.project_settings.working_days
  -- policy: product_events_admin_only ON public.product_events
  -- constraint: platform_metrics_weekly_window ON public.platform_metrics_weekly
  -- index: platform_metrics_weekly_week_uk ON public.platform_metrics_weekly
  -- trigger: product_events_no_update ON public.product_events
  -- cron: platform-metrics-weekly
  -- grant_absent: anon SELECT ON public.product_events
  -- grant_absent: anon EXECUTE ON public.touch_presence(text,text)
  -- sql: SELECT count(*) >= 8 FROM projects.calendar_years
  -- @verify:end

  CREATE TABLE public.product_events (id uuid);
  `

  describe('parseVerifyBlock', () => {
    it('parses every directive kind in order', () => {
      const d = parseVerifyBlock(SQL)
      expect(d!.map((x) => x.kind)).toEqual([
        'table', 'view', 'function', 'column', 'policy', 'constraint',
        'index', 'trigger', 'cron', 'grant_absent', 'grant_absent', 'sql',
      ])
      expect(d![0]).toMatchObject({ kind: 'table', schema: 'public', name: 'product_events' })
      expect(d![2]).toMatchObject({ kind: 'function', schema: 'public', name: 'touch_presence', args: 'text,text' })
      expect(d![4]).toMatchObject({ kind: 'policy', name: 'product_events_admin_only', schema: 'public', table: 'product_events' })
      expect(d![9]).toMatchObject({ kind: 'grant_absent', role: 'anon', privilege: 'SELECT' })
      expect(d![11]).toMatchObject({ kind: 'sql', predicate: 'SELECT count(*) >= 8 FROM projects.calendar_years' })
    })

    it('returns null when there is no block at all', () => {
      expect(parseVerifyBlock('-- just a migration\nCREATE TABLE t (id int);')).toBeNull()
    })

    it('throws on a block that is opened and never closed', () => {
      expect(() => parseVerifyBlock('-- @verify:begin\n-- table: public.t\n')).toThrow(/@verify:end/)
    })

    it('throws naming the line on an unknown directive', () => {
      expect(() =>
        parseVerifyBlock('-- @verify:begin\n-- tabel: public.t\n-- @verify:end'),
      ).toThrow(/tabel/)
    })

    it('throws on a block with no directives — an empty block is decorative', () => {
      expect(() => parseVerifyBlock('-- @verify:begin\n-- @verify:end')).toThrow(/at least one directive/)
    })
  })
  ```

- [ ] **Step 2: Run it and watch it fail.**

  ```
  pnpm --filter @esite/shared test verify-header
  ```

  Expected: `Failed to resolve import "./verify-header"` — five tests fail because the module does not exist. That is the failure you should see.

- [ ] **Step 3: Write the parser.**

  Create `packages/shared/src/lib/migrations/verify-header.ts`:

  ```ts
  // packages/shared/src/lib/migrations/verify-header.ts
  //
  // The `-- @verify:` block convention (§12 §(c)). One place defines the grammar.
  //
  // It exists because `supabase db push` keys on the version PREFIX: a number
  // already present in supabase_migrations.schema_migrations makes it print
  // "Remote database is up to date", exit 0 and SKIP the file. PR #163's
  // migration never applied behind a green workflow for exactly that reason.
  // A green deploy is not evidence a migration ran; reading the object back is.

  export type VerifyDirective =
    | { kind: 'table' | 'view'; schema: string; name: string; line: number; raw: string }
    | { kind: 'function'; schema: string; name: string; args: string; line: number; raw: string }
    | { kind: 'column'; schema: string; table: string; column: string; line: number; raw: string }
    | { kind: 'policy' | 'constraint' | 'index' | 'trigger'; name: string; schema: string; table: string; line: number; raw: string }
    | { kind: 'cron'; jobname: string; line: number; raw: string }
    | { kind: 'grant_absent'; role: string; privilege: string; target: string; line: number; raw: string }
    | { kind: 'sql'; predicate: string; line: number; raw: string }

  const BEGIN = /^--\s*@verify:begin\s*$/
  const END = /^--\s*@verify:end\s*$/

  function splitQualified(s: string, expected: number, line: number, raw: string): string[] {
    const parts = s.trim().split('.')
    if (parts.length !== expected || parts.some((p) => p.length === 0)) {
      throw new Error(`@verify line ${line}: expected ${expected} dot-separated parts in "${s}" — ${raw}`)
    }
    return parts
  }

  /**
   * Returns the directives in file order, or null when the file carries no block.
   * Throws — never returns a partial result — on a malformed block, because a
   * block nobody can parse is the same as no block at all and must not pass CI.
   */
  export function parseVerifyBlock(sql: string): VerifyDirective[] | null {
    const lines = sql.split(/\r?\n/)
    const start = lines.findIndex((l) => BEGIN.test(l.trim()))
    if (start === -1) return null
    const end = lines.findIndex((l, i) => i > start && END.test(l.trim()))
    if (end === -1) throw new Error('@verify:begin with no matching @verify:end')

    const out: VerifyDirective[] = []
    for (let i = start + 1; i < end; i++) {
      const raw = lines[i]
      const body = raw.trim()
      if (body === '--' || body === '') continue
      const m = body.match(/^--\s*([a-z_]+)\s*:\s*(.+?)\s*$/)
      if (!m) throw new Error(`@verify line ${i + 1}: not a directive — ${raw}`)
      const [, kind, rest] = m
      const line = i + 1

      switch (kind) {
        case 'table':
        case 'view': {
          const [schema, name] = splitQualified(rest, 2, line, raw)
          out.push({ kind, schema, name, line, raw })
          break
        }
        case 'function': {
          const fm = rest.match(/^([a-z0-9_]+)\.([a-z0-9_]+)\s*\((.*)\)$/i)
          if (!fm) throw new Error(`@verify line ${line}: expected schema.name(argtypes) — ${raw}`)
          out.push({ kind, schema: fm[1], name: fm[2], args: fm[3].trim(), line, raw })
          break
        }
        case 'column': {
          const [schema, table, column] = splitQualified(rest, 3, line, raw)
          out.push({ kind, schema, table, column, line, raw })
          break
        }
        case 'policy':
        case 'constraint':
        case 'index':
        case 'trigger': {
          const om = rest.match(/^(\S+)\s+ON\s+(\S+)$/i)
          if (!om) throw new Error(`@verify line ${line}: expected "<name> ON <schema>.<table>" — ${raw}`)
          const [schema, table] = splitQualified(om[2], 2, line, raw)
          out.push({ kind, name: om[1], schema, table, line, raw })
          break
        }
        case 'cron': {
          out.push({ kind, jobname: rest, line, raw })
          break
        }
        case 'grant_absent': {
          const gm = rest.match(/^(\S+)\s+(\S+)\s+ON\s+(.+)$/i)
          if (!gm) throw new Error(`@verify line ${line}: expected "<role> <PRIV> ON <object>" — ${raw}`)
          out.push({ kind, role: gm[1], privilege: gm[2].toUpperCase(), target: gm[3].trim(), line, raw })
          break
        }
        case 'sql': {
          out.push({ kind, predicate: rest, line, raw })
          break
        }
        default:
          throw new Error(`@verify line ${line}: unknown directive "${kind}" — ${raw}`)
      }
    }
    if (out.length === 0) throw new Error('@verify block contains at least one directive: found none')
    return out
  }
  ```

- [ ] **Step 4: Run it and watch it pass.**

  ```
  pnpm --filter @esite/shared test verify-header
  ```

  Expected: `Test Files 1 passed`, `Tests 5 passed`.

- [ ] **Step 5: Commit.**

  ```
  git add packages/shared/src/lib/migrations/verify-header.ts packages/shared/src/lib/migrations/verify-header.test.ts
  git commit -m "feat(migrations): parse the -- @verify: block into typed directives"
  ```

---

## Task 2 — Predicate builder and evaluator

The half that turns a directive into a boolean SQL predicate, and the half that decides pass/fail from the rows that come back. Both pure, so both testable without a network.

⚠ **The `function` case must use `to_regprocedure`, not `pg_get_function_identity_arguments`.** Postgres returns identity arguments **with parameter names and comma-space separators**. Measured against production 2026-09-10: `user_effective_project_role` → `"p_project_id uuid, p_user_id uuid"`; `user_is_org_admin` → `"p_org_id uuid"`. Comparing that string to the raw argument text in a directive (`uuid,uuid`) returns **false for every real multi-argument function** — the zero-argument case is the one that accidentally passes, so a test that only covers `args: ''` cannot catch it. `to_regprocedure` parses a signature by type name and was verified against production to return non-NULL for `public.user_effective_project_role(uuid,uuid)` and NULL cleanly for an absent function, an absent schema and the not-yet-created zero-arg `public.user_is_org_admin()`.

**Files:**
- Modify: `packages/shared/src/lib/migrations/verify-header.ts` (append)
- Test: `packages/shared/src/lib/migrations/verify-header.test.ts` (append)

- [ ] **Step 1: Write the failing predicate tests.**

  Append to `packages/shared/src/lib/migrations/verify-header.test.ts`:

  ```ts
  import { buildPredicate, runDirectives, type VerifyDirective } from './verify-header'

  // Omit<> does NOT distribute over a union — keyof (A|B|C) is the INTERSECTION
  // of their keys, so Omit<VerifyDirective,'line'|'raw'> collapses to { kind }
  // and every call site below trips excess-property checking. Distribute it.
  type Bare<T> = T extends unknown ? Omit<T, 'line' | 'raw'> : never
  const at = (d: Bare<VerifyDirective>): VerifyDirective =>
    ({ ...d, line: 1, raw: '-- x' }) as VerifyDirective

  describe('buildPredicate', () => {
    it('checks a table through to_regclass, not information_schema.tables', () => {
      const p = buildPredicate(at({ kind: 'table', schema: 'public', name: 'product_events' }))
      expect(p).toContain("to_regclass('public.product_events')")
      expect(p).toMatch(/^SELECT .* AS ok$/s)
    })

    it('distinguishes a view from a table', () => {
      const p = buildPredicate(at({ kind: 'view', schema: 'public', name: 'metric_accounts' }))
      expect(p).toContain("relkind IN ('v','m')")
    })

    // pg_get_function_identity_arguments returns NAMED args with comma-SPACE
    // ("p_project_id uuid, p_user_id uuid"), so string-comparing it to the
    // directive text is false for every multi-arg function. to_regprocedure
    // parses by type name and is the only form that works.
    it('checks a MULTI-argument function by parsed signature, never by identity-argument text', () => {
      const p = buildPredicate(at({
        kind: 'function', schema: 'public', name: 'emit_product_event',
        args: 'uuid,uuid,text,jsonb,uuid,uuid',
      }))
      expect(p).toContain('to_regprocedure')
      expect(p).toContain("'public.emit_product_event(uuid,uuid,text,jsonb,uuid,uuid)'")
      expect(p).not.toContain('pg_get_function_identity_arguments')
    })

    it('checks a zero-argument overload by its empty signature', () => {
      const p = buildPredicate(at({ kind: 'function', schema: 'public', name: 'user_is_org_admin', args: '' }))
      expect(p).toContain("to_regprocedure('public.user_is_org_admin()')")
    })

    it('grant_absent asserts the privilege is GONE, so a surviving grant fails', () => {
      const p = buildPredicate(at({ kind: 'grant_absent', role: 'anon', privilege: 'SELECT', target: 'public.product_events' }))
      expect(p).toContain('NOT has_table_privilege')
      expect(p).toContain("'anon'")
    })

    it('grant_absent on a function uses has_function_privilege, never proacl', () => {
      const p = buildPredicate(at({ kind: 'grant_absent', role: 'anon', privilege: 'EXECUTE', target: 'public.touch_presence(text,text)' }))
      expect(p).toContain('NOT has_function_privilege')
      expect(p).not.toContain('proacl')
    })

    it('wraps a raw sql directive so it always yields a single ok column', () => {
      const p = buildPredicate(at({ kind: 'sql', predicate: 'SELECT count(*) >= 8 FROM projects.calendar_years' }))
      expect(p).toContain('AS ok')
      expect(p).toContain('projects.calendar_years')
    })
  })

  describe('runDirectives', () => {
    const one = at({ kind: 'table', schema: 'public', name: 'product_events' })
    const twoArgFn = at({
      kind: 'function', schema: 'public', name: 'touch_presence', args: 'text,text',
    })

    it('passes when the predicate returns true', async () => {
      const r = await runDirectives([one], async () => [{ ok: true }])
      expect(r.failures).toEqual([])
      expect(r.passed).toBe(1)
    })

    // The whole point of the tool. A check that cannot fail is decorative.
    it('FAILS when the predicate returns false', async () => {
      const r = await runDirectives([one], async () => [{ ok: false }])
      expect(r.failures).toHaveLength(1)
      expect(r.failures[0].reason).toMatch(/returned false/)
      expect(r.failures[0].directive.raw).toBe('-- x')
    })

    // The regression this task exists for: a TWO-argument function directive
    // must be able to go red. Under the old identity-argument comparison this
    // predicate was false against a function that really existed.
    it('FAILS a two-argument function directive when the database says the signature is absent', async () => {
      const r = await runDirectives([twoArgFn], async (s) => [
        { ok: !s.includes("'public.touch_presence(text,text)'") },
      ])
      expect(r.failures).toHaveLength(1)
      expect(r.failures[0].directive.raw).toBe('-- x')
    })

    it('PASSES a two-argument function directive when the database says it is present', async () => {
      const r = await runDirectives([twoArgFn], async (s) => [
        { ok: s.includes("'public.touch_presence(text,text)'") },
      ])
      expect(r.failures).toEqual([])
      expect(r.passed).toBe(1)
    })

    it('FAILS when the predicate returns no rows at all', async () => {
      const r = await runDirectives([one], async () => [])
      expect(r.failures[0].reason).toMatch(/no rows/)
    })

    it('FAILS when the query itself errors, rather than treating the error as absence', async () => {
      const r = await runDirectives([one], async () => { throw new Error('permission denied') })
      expect(r.failures[0].reason).toMatch(/permission denied/)
    })

    it('reports every failure, not only the first', async () => {
      const r = await runDirectives([one, one, one], async () => [{ ok: false }])
      expect(r.failures).toHaveLength(3)
    })
  })
  ```

- [ ] **Step 2: Run it and watch it fail.**

  ```
  pnpm --filter @esite/shared test verify-header
  ```

  Expected: the five original tests pass; the eleven new ones fail with `buildPredicate is not a function` / `runDirectives is not a function`. **Note the second and third `runDirectives` tests in particular** — the first proves a false predicate is a failure and not a shrug; the second proves a *multi-argument* function directive can go red, which is the case the old implementation got wrong.

- [ ] **Step 3: Append the builder and the evaluator.**

  Append to `packages/shared/src/lib/migrations/verify-header.ts`:

  ```ts
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`

  /** Builds a statement returning exactly one row with one boolean column named `ok`. */
  export function buildPredicate(d: VerifyDirective): string {
    switch (d.kind) {
      case 'table':
        return `SELECT to_regclass(${q(`${d.schema}.${d.name}`)}) IS NOT NULL AS ok`
      case 'view':
        return `SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = ${q(d.schema)} AND c.relname = ${q(d.name)} AND c.relkind IN ('v','m')) AS ok`
      case 'function':
        // to_regprocedure parses a signature BY TYPE NAME and returns NULL for an
        // absent function, an absent schema and a wrong arity — verified against
        // production. NEVER compare pg_get_function_identity_arguments: it returns
        // NAMED arguments with comma-space ("p_project_id uuid, p_user_id uuid"),
        // so a string comparison is false for every real multi-argument function
        // and accidentally true only for the zero-argument case.
        return `SELECT to_regprocedure(${q(`${d.schema}.${d.name}(${d.args})`)}) IS NOT NULL AS ok`
      case 'column':
        return `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = ${q(d.schema)} AND table_name = ${q(d.table)} AND column_name = ${q(d.column)}) AS ok`
      case 'policy':
        return `SELECT EXISTS (SELECT 1 FROM pg_policies
                WHERE schemaname = ${q(d.schema)} AND tablename = ${q(d.table)} AND policyname = ${q(d.name)}) AS ok`
      case 'constraint':
        return `SELECT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = t.relnamespace
                WHERE n.nspname = ${q(d.schema)} AND t.relname = ${q(d.table)} AND c.conname = ${q(d.name)}) AS ok`
      case 'index':
        return `SELECT EXISTS (SELECT 1 FROM pg_indexes
                WHERE schemaname = ${q(d.schema)} AND tablename = ${q(d.table)} AND indexname = ${q(d.name)}) AS ok`
      case 'trigger':
        return `SELECT EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_class t ON t.oid = tg.tgrelid
                JOIN pg_namespace n ON n.oid = t.relnamespace
                WHERE n.nspname = ${q(d.schema)} AND t.relname = ${q(d.table)} AND tg.tgname = ${q(d.name)}
                  AND NOT tg.tgisinternal) AS ok`
      case 'cron':
        return `SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = ${q(d.jobname)} AND active) AS ok`
      case 'grant_absent': {
        // A function target carries parentheses; a table target does not.
        // has_*_privilege, never proacl: a NULL proacl looks empty but IS the PUBLIC grant.
        const isFn = d.target.includes('(')
        return isFn
          ? `SELECT NOT has_function_privilege(${q(d.role)}, ${q(d.target)}, ${q(d.privilege)}) AS ok`
          : `SELECT NOT has_table_privilege(${q(d.role)}, ${q(d.target)}, ${q(d.privilege)}) AS ok`
      }
      case 'sql':
        return `SELECT (${d.predicate.replace(/;\s*$/, '')}) AS ok`
    }
  }

  export type QueryFn = (sql: string) => Promise<Array<Record<string, unknown>>>

  export interface DirectiveFailure {
    directive: VerifyDirective
    reason: string
  }

  export interface RunResult {
    passed: number
    failures: DirectiveFailure[]
  }

  /**
   * Evaluates every directive and reports EVERY failure, not the first — a
   * partial answer sends someone back for a second deploy round-trip.
   */
  export async function runDirectives(directives: VerifyDirective[], query: QueryFn): Promise<RunResult> {
    const failures: DirectiveFailure[] = []
    let passed = 0
    for (const directive of directives) {
      const sql = buildPredicate(directive)
      try {
        const rows = await query(sql)
        if (!rows || rows.length === 0) {
          failures.push({ directive, reason: 'predicate returned no rows' })
          continue
        }
        const ok = rows[0][Object.keys(rows[0])[0]]
        if (ok === true) passed += 1
        else failures.push({ directive, reason: `predicate returned false (got ${JSON.stringify(ok)})` })
      } catch (e) {
        failures.push({ directive, reason: e instanceof Error ? e.message : String(e) })
      }
    }
    return { passed, failures }
  }
  ```

  **`sql` directives are interpolated verbatim into the statement.** They come from migration files in this repository — files a reviewer reads — and never from user input. Do not extend this to accept a predicate from anywhere else.

- [ ] **Step 4: Run the tests AND the type-check, and watch both pass.**

  ```
  pnpm --filter @esite/shared test verify-header
  pnpm --filter @esite/shared type-check
  ```

  Expected: **`Tests 19 passed`** — Task 1's 5, plus 7 `buildPredicate` and 7 `runDirectives` added here. Run the command and read the real number rather than trusting this one; if it disagrees, a test was dropped in a paste.

  `type-check` must be **clean**, and it is run *here*, in the task that creates the `Bare<T>` helper. `Omit<>` does not distribute over a union, so the naive `Omit<VerifyDirective, 'line' | 'raw'>` resolves to `{ kind }` alone and every one of the eleven call sites trips excess-property checking. `esbuild` does not type-check, so vitest would go green and the error would surface at Task 11's or Task 14's type-check gate instead — long after this task looks done.

- [ ] **Step 5: Commit.**

  ```
  git add packages/shared/src/lib/migrations/verify-header.ts packages/shared/src/lib/migrations/verify-header.test.ts
  git commit -m "feat(migrations): build and evaluate @verify predicates; a false predicate fails the run"
  ```

---

## Task 3 — `scripts/verify-migration-applied.ts`, the CLI

**Files:**
- Create: `scripts/verify-migration-applied.ts`
- Create: `packages/shared/src/lib/migrations/__fixtures__/00999_fixture_absent_object.sql`
- Modify: `packages/shared/src/index.ts`

The CLI does three things in order, and the **second** is the one that catches the PR #163 failure:

1. Collect every migration file that carries a `@verify` block (narrowed by `--since <version>` or `--file`, read from `--dir` when given).
2. Assert each such version is present in `supabase_migrations.schema_migrations`. A file on disk whose version is absent from the ledger means `db push` never ran it — the silent skip.
3. Evaluate every directive and exit non-zero on any failure, naming the file, the line and the directive text.

It is **stateless**: no "last verified version" table and no marker file. Verifying every block every time is idempotent and also catches a *later* migration that quietly dropped an earlier object.

⚠ **`--dir` exists so the proof in Step 6 never writes into the live migrations folder.** On a shared checkout an interrupted run would otherwise leave a stray `.sql` in the directory `supabase db push` reads, and a `00184_fixture_absent_object.sql` colliding with the real `00184` is precisely the numbering race this whole plan is built around.

- [ ] **Step 1: Create the failing fixture.**

  Create `packages/shared/src/lib/migrations/__fixtures__/00999_fixture_absent_object.sql`:

  ```sql
  -- Fixture for verify-migration-applied.ts. NEVER applied to any database.
  -- Its block deliberately names an object that does not and will not exist,
  -- so a run over this file MUST fail. If it ever passes, the tool is broken.
  -- @verify:begin
  -- table: public.this_table_does_not_exist_and_never_will
  -- @verify:end
  ```

  Note the `-- table:` line is **line 5** of this six-line file — the failure output in Step 6 quotes that number.

  This fixture lives under `packages/shared`, **not** under `apps/edge-functions/supabase/migrations/`, so the migration-hygiene scanner (Task 4) and `supabase db push` never see it.

- [ ] **Step 2: Write the failing CLI test.**

  Append to `packages/shared/src/lib/migrations/verify-header.test.ts`:

  ```ts
  import { readFileSync } from 'node:fs'
  import { join } from 'node:path'

  describe('the absent-object fixture', () => {
    it('parses, and its single directive fails against a database that answers honestly', async () => {
      const sql = readFileSync(join(__dirname, '__fixtures__/00999_fixture_absent_object.sql'), 'utf8')
      const directives = parseVerifyBlock(sql)
      expect(directives).not.toBeNull()
      expect(directives!).toHaveLength(1)
      expect(directives![0].line).toBe(5)

      // Stub the database the way a real one would answer for an absent table.
      const r = await runDirectives(directives!, async (s) => [
        { ok: !s.includes('this_table_does_not_exist_and_never_will') },
      ])
      expect(r.failures).toHaveLength(1)
      expect(r.failures[0].directive.raw).toContain('this_table_does_not_exist_and_never_will')
    })
  })
  ```

- [ ] **Step 3: Run it and watch it fail, then pass.**

  ```
  pnpm --filter @esite/shared test verify-header
  ```

  Expected first run: `ENOENT ... __fixtures__/00999_fixture_absent_object.sql` if Step 1 was skipped. With the fixture in place the suite grows by one — run it and read the real total rather than trusting a predicted one.

- [ ] **Step 4: Export the module from the shared barrel.**

  In `packages/shared/src/index.ts`, immediately after the `export * from './lib/jbcc/letter-values'` line (currently `:44`), add:

  ```ts
  // Migration verification — the -- @verify: block convention (§12 §(c)).
  export * from './lib/migrations/verify-header'
  ```

  Run `pnpm --filter @esite/shared type-check` — expected: clean.

- [ ] **Step 5: Write the CLI.**

  Create `scripts/verify-migration-applied.ts`:

  ```ts
  #!/usr/bin/env node --experimental-strip-types
  /**
   * Verify that migrations carrying a `-- @verify:` block ACTUALLY APPLIED.
   *
   *   node --experimental-strip-types scripts/verify-migration-applied.ts
   *   node --experimental-strip-types scripts/verify-migration-applied.ts --since 00184
   *   node --experimental-strip-types scripts/verify-migration-applied.ts --file 00186_q1_metrics_presence_calendar.sql
   *   node --experimental-strip-types scripts/verify-migration-applied.ts --dir /tmp/verify-proof
   *
   * --dir points the scan at a directory other than the real migrations folder.
   * It exists so the failing-fixture proof never writes a stray .sql into the
   * directory `supabase db push` reads: on a shared checkout an interrupted run
   * would leave a file whose number can collide with a real migration.
   *
   * Auth: SUPABASE_ACCESS_TOKEN (set as a repo secret and used by
   * deploy-migrations.yml), else the macOS keychain entry "Supabase CLI",
   * handling the go-keyring-base64 prefix — the same resolution
   * scripts/db/mgmt-api.sh uses, so local and CI behave identically.
   *
   * Exit 0 = every directive returned true. Exit 1 = anything else.
   */
  import { readFileSync, readdirSync } from 'node:fs'
  import { join, resolve, basename } from 'node:path'
  import { execFileSync } from 'node:child_process'
  import { parseVerifyBlock, runDirectives } from '../packages/shared/src/lib/migrations/verify-header.ts'

  const REPO_ROOT = resolve(import.meta.dirname, '..')
  const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? 'cbskbnvvgcybmfikxgky'

  function pat(): string {
    if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN
    const raw = execFileSync('security', ['find-generic-password', '-s', 'Supabase CLI', '-w'], {
      encoding: 'utf8',
    }).trim()
    return raw.startsWith('go-keyring-base64:')
      ? Buffer.from(raw.slice('go-keyring-base64:'.length), 'base64').toString('utf8').trim()
      : raw
  }

  async function query(sql: string): Promise<Array<Record<string, unknown>>> {
    const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pat()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`Management API ${res.status}: ${text.slice(0, 300)}`)
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) throw new Error(`Unexpected response: ${text.slice(0, 300)}`)
    return parsed
  }

  const argv = process.argv.slice(2)
  const argOf = (flag: string) => {
    const i = argv.indexOf(flag)
    return i === -1 ? null : argv[i + 1]
  }
  const since = argOf('--since')
  const onlyFile = argOf('--file')
  const MIGRATIONS = argOf('--dir')
    ? resolve(argOf('--dir')!)
    : join(REPO_ROOT, 'apps/edge-functions/supabase/migrations')

  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => (onlyFile ? basename(f) === basename(onlyFile) : true))
    .filter((f) => (since ? f.slice(0, 5) > since : true))
    .sort()

  let failed = 0
  let checked = 0

  const ledger = await query(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version',
  )
  const applied = new Set(ledger.map((r) => String(r.version)))

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8')
    let directives
    try {
      directives = parseVerifyBlock(sql)
    } catch (e) {
      console.error(`✗ ${file}: malformed @verify block — ${e instanceof Error ? e.message : e}`)
      failed += 1
      continue
    }
    if (directives === null) continue // pre-programme migration; no block, nothing claimed

    checked += 1
    const version = file.slice(0, 5)

    // THE check. `supabase db push` keys on the version PREFIX: a number already
    // in the ledger makes it print "Remote database is up to date", exit 0 and
    // skip the file. A green workflow proves nothing; this line does.
    if (!applied.has(version)) {
      console.error(`✗ ${file}: version ${version} is NOT in supabase_migrations.schema_migrations — db push skipped it`)
      failed += 1
      continue
    }

    const { passed, failures } = await runDirectives(directives, query)
    if (failures.length === 0) {
      console.log(`✓ ${file} — ${passed} directive(s) verified`)
    } else {
      for (const f of failures) {
        console.error(`✗ ${file}:${f.directive.line}  ${f.directive.raw.trim()}\n    ${f.reason}`)
      }
      failed += failures.length
    }
  }

  if (checked === 0) {
    console.error('✗ no migration carried a @verify block — refusing to report green on nothing')
    process.exit(1)
  }
  if (failed > 0) {
    console.error(`\n✗ ${failed} verification failure(s) across ${checked} migration(s)`)
    process.exit(1)
  }
  console.log(`\n✓ ${checked} migration(s) verified against ${PROJECT_REF}`)
  ```

  Two decisions worth stating. **`checked === 0` is an error, not a pass** — a run that verified nothing must not print green, which is the same failure mode as a green `db push` that applied nothing. And **a malformed block is a failure**, not a skip, which is what makes §12 §(h) test 5 enforceable at runtime as well as in CI.

- [ ] **Step 6: Prove the CLI fails on the absent-object fixture, for real, against production — in a temp directory.**

  ```
  mkdir -p /tmp/verify-proof
  cp packages/shared/src/lib/migrations/__fixtures__/00999_fixture_absent_object.sql /tmp/verify-proof/
  node --experimental-strip-types scripts/verify-migration-applied.ts --dir /tmp/verify-proof
  echo "exit=$?"
  ```

  Expected output — **this is the failure you must see with your own eyes before trusting the tool**:

  ```
  ✗ 00999_fixture_absent_object.sql: version 00999 is NOT in supabase_migrations.schema_migrations — db push skipped it

  ✗ 1 verification failure(s) across 1 migration(s)
  exit=1
  ```

  Then prove the *directive* half fails too, independently of the ledger half. Copy the fixture under a version that IS in the ledger (`00184` — verified: `max(version)` is `00184` and the ledger holds 178 rows) and re-run:

  ```
  cp packages/shared/src/lib/migrations/__fixtures__/00999_fixture_absent_object.sql \
     /tmp/verify-proof/00184_fixture_absent_object.sql
  rm /tmp/verify-proof/00999_fixture_absent_object.sql
  node --experimental-strip-types scripts/verify-migration-applied.ts --dir /tmp/verify-proof
  echo "exit=$?"
  ```

  Expected:

  ```
  ✗ 00184_fixture_absent_object.sql:5  -- table: public.this_table_does_not_exist_and_never_will
      predicate returned false (got false)

  ✗ 1 verification failure(s) across 1 migration(s)
  exit=1
  ```

  ```
  rm -rf /tmp/verify-proof
  git status --short apps/edge-functions/supabase/migrations/
  ```

  The `git status` must print **nothing**. Nothing was ever copied into that folder.

- [ ] **Step 7: Run it against the real migrations folder and read what it says.**

  ```
  node --experimental-strip-types scripts/verify-migration-applied.ts --since 00184
  echo "exit=$?"
  ```

  **Two acceptable outcomes, and which one you get depends on whether item 0 has merged.**

  - **Item 0 merged** (the stated dependency): its `00185_resend_email_delivery_evidence.sql` carries its own complete `-- @verify:begin` block, so expect
    ```
    ✓ 00185_resend_email_delivery_evidence.sql — N directive(s) verified

    ✓ 1 migration(s) verified against cbskbnvvgcybmfikxgky
    exit=0
    ```
    This is the **stronger** proof: the tool went green against a real block on a real applied migration. If any directive is red, item 0 did not fully apply — stop and reconcile that before adding a second migration on top of it.
  - **Item 0 not yet merged:** no file carries a block, and the tool must refuse rather than print green on nothing:
    ```
    ✗ no migration carried a @verify block — refusing to report green on nothing
    exit=1
    ```

- [ ] **Step 8: Commit.**

  ```
  git add scripts/verify-migration-applied.ts packages/shared/src/index.ts \
          packages/shared/src/lib/migrations/__fixtures__/00999_fixture_absent_object.sql \
          packages/shared/src/lib/migrations/verify-header.test.ts
  git commit -m "feat(migrations): verify-migration-applied CLI — a green db push is not evidence"
  ```

---

## Task 4 — CI wiring and the migration-hygiene contract test

**Files:**
- Create: `apps/web/src/lib/migration-verify-block.contract.test.ts`
- Modify: `.github/workflows/deploy-migrations.yml`

**`PROGRAMME_FLOOR` is `'00185'` deliberately — item 0's migration, not this one.** Item 0's `00185_resend_email_delivery_evidence.sql` is a programme migration and must be covered by the same hygiene rule; setting the floor at `00186` would exempt the first migration of the programme from the check the programme is built on. This means **item 0's block must be complete** for this test to pass — if it is not, fix item 0's block rather than raising the floor.

⚠ **`.github/workflows/**` cannot be modified by a repository token without the `workflow` scope.** That is why the cloud-sync edge functions were never added to the deploy list. §13's pre-window step 2 offers two acceptable outcomes: obtain a `workflow`-scoped token, or **nominate Arno to edit the file by hand**. Q1 needs neither for its own deliverables — the verifier runs locally against production, and Task 16 does exactly that — so if the push is rejected, **paste the diff to Arno and carry on**; do not block the migration on it, and do not attempt to work around the scope.

- [ ] **Step 1: Write the failing hygiene contract test.**

  Create `apps/web/src/lib/migration-verify-block.contract.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest'
  import { readFileSync, readdirSync } from 'node:fs'
  import { join, resolve } from 'node:path'
  import { parseVerifyBlock } from '@esite/shared'

  /**
   * §12 §(h) test 5 — migration hygiene.
   *
   * Every migration in this programme carries a well-formed `-- @verify:` block,
   * and every TABLE, VIEW and FUNCTION it creates appears in that block.
   *
   * ⚠ Scope, stated exactly rather than generously: this checks tables, views and
   * functions ONLY. Policies, constraints, indexes, triggers and cron jobs are
   * declared in the blocks by convention and reviewed by hand; nothing here
   * enforces them. Saying "every object it creates" when the code checks three
   * kinds is the decorative-check pattern in prose form.
   *
   * §12 §(h) test 8 — the A(f) registry diff — does NOT exist yet and is not
   * built here. Registering a new object in Appendix A(f) is a review discipline
   * until someone owns it.
   *
   * Migrations that predate the programme carry no block and are not in scope —
   * the floor below is what draws that line, and it sits at ITEM 0's migration
   * so item 0 is covered too.
   */
  const REPO_ROOT = resolve(__dirname, '../../../..')
  const MIGRATIONS = join(REPO_ROOT, 'apps/edge-functions/supabase/migrations')

  /** Everything at or after this version belongs to the v2 programme. Item 0's migration. */
  const PROGRAMME_FLOOR = '00185'

  function programmeMigrations(): string[] {
    return readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql') && f.slice(0, 5) >= PROGRAMME_FLOOR)
      .sort()
  }

  /** Objects the migration CREATEs, read out of the SQL itself. */
  function createdObjects(sql: string) {
    const strip = sql.replace(/^\s*--.*$/gm, '')
    const grab = (re: RegExp) => [...strip.matchAll(re)].map((m) => m[1].toLowerCase())
    return {
      tables: grab(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z0-9_]+\.[a-z0-9_]+)/gi),
      views: grab(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+([a-z0-9_]+\.[a-z0-9_]+)/gi),
      functions: grab(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-z0-9_]+\.[a-z0-9_]+)/gi),
    }
  }

  describe('programme migrations carry a complete @verify block', () => {
    const files = programmeMigrations()

    it('there is at least one programme migration to check', () => {
      expect(files.length).toBeGreaterThan(0)
    })

    for (const file of files) {
      it(`${file} declares every table, view and function it creates`, () => {
        const sql = readFileSync(join(MIGRATIONS, file), 'utf8')
        const directives = parseVerifyBlock(sql)
        expect(directives, `${file} carries no -- @verify: block`).not.toBeNull()

        const declared = (kind: string) =>
          new Set(
            directives!
              .filter((d) => d.kind === kind)
              .map((d) => `${(d as { schema: string }).schema}.${(d as { name: string }).name}`.toLowerCase()),
          )
        const declaredTables = declared('table')
        const declaredViews = declared('view')
        const declaredFns = declared('function')

        const made = createdObjects(sql)
        for (const t of new Set(made.tables)) {
          expect(declaredTables.has(t), `${file} creates ${t} but the @verify block does not declare it`).toBe(true)
        }
        for (const v of new Set(made.views)) {
          expect(declaredViews.has(v), `${file} creates view ${v} but the @verify block does not declare it`).toBe(true)
        }
        for (const f of new Set(made.functions)) {
          expect(declaredFns.has(f), `${file} creates function ${f} but the @verify block does not declare it`).toBe(true)
        }
      })
    }
  })
  ```

- [ ] **Step 2: Run it and watch what it says.**

  ```
  pnpm --filter web test migration-verify-block
  ```

  If item 0 has **not** merged, expected: `there is at least one programme migration to check` fails — `expected 0 to be greater than 0`. **That guard is load-bearing:** without it, a suite over an empty file list passes vacuously, which is precisely the fixture pathology this repo has been bitten by three times.

  If item 0 **has** merged, expected: two tests green — the guard, plus `00185_resend_email_delivery_evidence.sql declares every table, view and function it creates`. Either way the suite goes green with this plan's migration in Task 7.

- [ ] **Step 3: Add the post-push verification step to the deploy workflow.**

  In `.github/workflows/deploy-migrations.yml`, after the `Run migrations` step (currently ends at `:38`), append:

  ```yaml
      - uses: pnpm/action-setup@v4
        with:
          version: '10.33.0'

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      # A green `supabase db push` is NOT evidence a migration ran: db push keys
      # on the version PREFIX, so a number already in schema_migrations makes it
      # print "Remote database is up to date", exit 0 and skip the file. This
      # step reads every declared object back out of the database.
      - name: Verify migrations actually applied
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
          SUPABASE_PROJECT_REF: ${{ secrets.SUPABASE_PROJECT_REF }}
        run: node --experimental-strip-types scripts/verify-migration-applied.ts
  ```

  Also amend the header comment block at `:3-9` to name the new step, and delete nothing else. Node 22 is required for `--experimental-strip-types`; the root `package.json` already declares `"node": ">=22 <25"` and already uses the flag for `demo:seed`.

- [ ] **Step 4: Commit; expect the push to be rejected if the token lacks `workflow` scope.**

  ```
  git add apps/web/src/lib/migration-verify-block.contract.test.ts .github/workflows/deploy-migrations.yml
  git commit -m "ci(migrations): verify every @verify block after db push; fail the deploy on a skipped file"
  git push "https://x-access-token:$(gh auth token)@github.com/WattMatt/e-site.git" HEAD
  ```

  If the push fails with `refusing to allow an OAuth App to create or update workflow`, **do not retry and do not rewrite history to drop the file.** Post the workflow diff to Arno with the one-line reason, keep the commit on the branch, and continue — every later task verifies locally via Task 16's command.

---

## Task 5 — `dry-run-migration.sh`, the red/green loop for SQL

**Files:**
- Create: `scripts/db/dry-run-migration.sh`

Every SQL task below (7 through 12) is written test-first the same way: add an assertion, run the dry run, **watch it fail**, add the DDL, run it again, watch it pass. The dry run wraps the migration plus every assertion file in `BEGIN; … ROLLBACK;` and posts it as **one** Management-API query, so it executes against real production data and leaves nothing behind.

**It takes one or more assertion files** because the assertions are split in two: `assert-metrics-foundation-static.sql` reads only applied structure and is safe to run read-only after the apply, and `assert-metrics-foundation-seeded.sql` seeds rows at the top and must only ever run inside a transaction that rolls back. The dry run concatenates both; the smoke test (Task 16) runs each in the way it is safe to run.

Two facts make this work, both measured on 2026-09-10 against `cbskbnvvgcybmfikxgky`:
- **DDL inside a rolled-back transaction works through this endpoint.** A probe created `public._dryrun_probe`, saw `to_regclass(...) IS NOT NULL`, and after `ROLLBACK` `to_regclass(...) IS NULL`. Zero residue.
- **The endpoint returns the last result-producing statement's rows even with a trailing `ROLLBACK`** — the pattern `scripts/db/smoke-test-project-settings.sh:47-59` already relies on.

Two things the harness cannot do, stated so nobody discovers them the hard way: **`CREATE INDEX CONCURRENTLY` cannot run in a transaction** (this migration uses plain `CREATE INDEX` on brand-new empty tables, so it does not need it), and a `NOTIFY pgrst` inside the transaction is queued and discarded on rollback — harmless, and the real apply issues it for real.

- [ ] **Step 1: Write the harness.**

  Create `scripts/db/dry-run-migration.sh`:

  ```bash
  #!/usr/bin/env bash
  # Dry-run a migration against PRODUCTION inside a rolled-back transaction.
  #
  #   scripts/db/dry-run-migration.sh <migration.sql> <assertions.sql> [more-assertions.sql ...]
  #
  # The LAST statement across all assertion files must return rows shaped
  # (check text, ok boolean). Nothing is committed: the transaction is rolled
  # back whether the assertions pass or fail, so this is safe to run against
  # live data and leaves zero residue.
  #
  # This is the red/green loop for SQL. Run it BEFORE writing the DDL and watch
  # the assertion fail; a check you have never seen fail is decorative.
  set -euo pipefail

  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  . "$SCRIPT_DIR/mgmt-api.sh"

  MIG="${1:?usage: dry-run-migration.sh <migration.sql> <assertions.sql> [...]}"
  shift
  [[ $# -ge 1 ]] || { echo "ERROR: at least one assertions file is required" >&2; exit 1; }
  [[ -f "$MIG" ]] || { echo "ERROR: no such migration: $MIG" >&2; exit 1; }
  for a in "$@"; do
    [[ -f "$a" ]] || { echo "ERROR: no such assertions file: $a" >&2; exit 1; }
  done

  TMP="$(mktemp -t dryrun)"
  trap 'rm -f "$TMP"' EXIT
  {
    echo "BEGIN;"
    cat "$MIG"
    echo
    for a in "$@"; do cat "$a"; echo; done
    echo "ROLLBACK;"
  } > "$TMP"

  echo "── dry run: $(basename "$MIG") + $* (rolled back) ──"
  RESULT="$(mgmt_apply_sql_file "$TMP")"
  echo "$RESULT" | jq -r '.[] | if .ok then "  ✓ \(.check)" else "  ✗ \(.check)" end'

  FAILED="$(echo "$RESULT" | jq '[.[] | select(.ok != true)] | length')"
  TOTAL="$(echo "$RESULT" | jq 'length')"
  if [[ "$TOTAL" == "0" ]]; then
    echo "✗ the assertions produced NO rows — refusing to report green on nothing" >&2
    exit 1
  fi
  if [[ "$FAILED" != "0" ]]; then
    echo "✗ $FAILED of $TOTAL assertion(s) failed" >&2
    exit 1
  fi
  echo "✓ $TOTAL assertion(s) green — transaction rolled back, nothing persisted"
  ```

  ```
  chmod +x scripts/db/dry-run-migration.sh
  ```

- [ ] **Step 2: Prove the harness fails when it should.**

  ```
  printf 'SELECT %s AS check, %s AS ok;\n' "'deliberately false'" "false" > /tmp/false-assert.sql
  printf -- '-- empty migration\n' > /tmp/empty-mig.sql
  scripts/db/dry-run-migration.sh /tmp/empty-mig.sql /tmp/false-assert.sql
  echo "exit=$?"
  ```

  Expected:

  ```
  ── dry run: empty-mig.sql + /tmp/false-assert.sql (rolled back) ──
    ✗ deliberately false
  ✗ 1 of 1 assertion(s) failed
  exit=1
  ```

  Then the green case, and the two-file case:

  ```
  printf 'SELECT %s AS check, %s AS ok;\n' "'deliberately true'" "true" > /tmp/true-assert.sql
  printf 'SELECT 1;\n' > /tmp/seed.sql
  scripts/db/dry-run-migration.sh /tmp/empty-mig.sql /tmp/seed.sql /tmp/true-assert.sql
  echo "exit=$?"
  ```

  Expected: `✓ 1 assertion(s) green — transaction rolled back, nothing persisted`, `exit=0`.

  ```
  rm -f /tmp/false-assert.sql /tmp/true-assert.sql /tmp/empty-mig.sql /tmp/seed.sql
  ```

- [ ] **Step 3: Commit.**

  ```
  git add scripts/db/dry-run-migration.sh
  git commit -m "feat(db): dry-run a migration against prod in a rolled-back transaction"
  ```

---

## Task 6 — Named holidays, the derived seed to 2035, and the calendar contract test

**Files:**
- Modify: `packages/shared/src/lib/jbcc/sa-public-holidays.ts` (`listHolidays` at `:42-61`)
- Modify: `packages/shared/src/lib/jbcc/sa-public-holidays.test.ts` (append)
- Create: `scripts/db/gen-public-holidays-seed.ts`
- Create: `packages/shared/src/lib/calendar/public-holidays.contract.test.ts`

`projects.public_holidays(d date PRIMARY KEY, name text)` is **a materialisation of the existing computus, not a second source** (A(h)). The existing `listHolidays(year)` returns `Date[]` with no names — the labels sit in the private `FIXED_DATES` array at `:3-14`, which holds **ten** entries, and they are dropped at `:46`. Hand-typing names into SQL would create exactly the second source A(h) forbids, so the function gains a named variant and `listHolidays` delegates to it.

**The seed runs to 2035, not 2031.** `working_days_between` correctly RAISES on an unseeded year with no fallback to calendar days — which means that in January of the year after the last seeded one, every due-date computation in the product throws at the moment a user saves an RFI. A twelve-year horizon is one argument to the generator. Measured: `listHolidays` yields **13 entries for most years, 14 for 2027**; 2024–2031 is **105 rows**, 2024–2035 is **160 rows**.

- [ ] **Step 1: Write the failing test for the named variant, with the pin computed rather than remembered.**

  First read the real 2026 output, so the regression pin is a measurement and not a guess:

  ```
  node --experimental-strip-types -e "import('./packages/shared/src/lib/jbcc/sa-public-holidays.ts').then(m=>console.log(JSON.stringify(m.listHolidays(2026).map(d=>d.toISOString().slice(0,10)))))"
  ```

  Measured 2026-09-10, and this is the array the pin below uses:

  ```
  ["2026-01-01","2026-03-21","2026-04-27","2026-05-01","2026-06-16","2026-08-09","2026-09-24","2026-12-16","2026-12-25","2026-12-26","2026-04-03","2026-04-06","2026-08-10"]
  ```

  **Thirteen entries, not fourteen.** 21 March 2026 (Human Rights Day) falls on a **Saturday**, so the Sunday rule generates no observed Monday for it — a `2026-03-22` in the pin would be wrong. The one observance in 2026 is `2026-08-10`, because National Women's Day falls on a Sunday.

  Append to `packages/shared/src/lib/jbcc/sa-public-holidays.test.ts`:

  ```ts
  import { listHolidaysNamed } from './sa-public-holidays'

  const iso = (d: Date) => d.toISOString().slice(0, 10)

  describe('listHolidaysNamed', () => {
    it('carries a name for every date listHolidays returns, in the same order', () => {
      const named = listHolidaysNamed(2026)
      const plain = listHolidays(2026)
      expect(named.map((h) => iso(h.date))).toEqual(plain.map(iso))
      expect(named.every((h) => h.name.length > 0)).toBe(true)
    })

    it('names the computed Easter pair', () => {
      const byDate = new Map(listHolidaysNamed(2026).map((h) => [iso(h.date), h.name]))
      expect(byDate.get('2026-04-03')).toBe('Good Friday')
      expect(byDate.get('2026-04-06')).toBe('Family Day')
    })

    it('marks a Sunday-rule Monday as observed rather than duplicating the name', () => {
      // 9 August 2026 (National Women's Day) falls on a Sunday.
      const byDate = new Map(listHolidaysNamed(2026).map((h) => [iso(h.date), h.name]))
      expect(byDate.get('2026-08-09')).toBe("National Women's Day")
      expect(byDate.get('2026-08-10')).toBe("National Women's Day (observed)")
    })

    it('emits no duplicate dates in any year from 2024 to 2035', () => {
      for (let y = 2024; y <= 2035; y++) {
        const dates = listHolidaysNamed(y).map((h) => iso(h.date))
        expect(new Set(dates).size, `duplicate date in ${y}`).toBe(dates.length)
      }
    })
  })

  describe('the refactor does not move listHolidays', () => {
    // Measured against the pre-refactor implementation on 2026-09-10. Thirteen
    // entries: ten fixed dates, Good Friday, Family Day, and ONE observance
    // (2026-08-10). 21 March 2026 is a SATURDAY, so it generates none.
    it('still returns the same dates in the same order for 2026', () => {
      expect(listHolidays(2026).map(iso)).toEqual([
        '2026-01-01', '2026-03-21', '2026-04-27', '2026-05-01', '2026-06-16',
        '2026-08-09', '2026-09-24', '2026-12-16', '2026-12-25', '2026-12-26',
        '2026-04-03', '2026-04-06', '2026-08-10',
      ])
    })

    it('still yields exactly 105 dates across 2024-2031 and 160 across 2024-2035', () => {
      const count = (from: number, to: number) => {
        let n = 0
        for (let y = from; y <= to; y++) n += listHolidays(y).length
        return n
      }
      expect(count(2024, 2031)).toBe(105)
      expect(count(2024, 2035)).toBe(160)
    })
  })
  ```

  The last block is a regression pin on the refactor: `listHolidays` is consumed by `isPublicHoliday` (`:64-67`), which drives the JBCC time-bar engine through `working-days.ts`. If the order or contents move, a stored `deadline_date` moves with it. The exact totals — not a range — are what makes a drift detectable rather than absorbed.

- [ ] **Step 2: Run it and watch it fail.**

  ```
  pnpm --filter @esite/shared test sa-public-holidays
  ```

  Expected: the four `listHolidaysNamed` tests fail (`listHolidaysNamed is not a function`). **The two `listHolidays` pins must already pass** — they describe the function as it exists today. If either is red, the array above no longer matches the computus and must be corrected **from the measured output** before going further, not after.

- [ ] **Step 3: Add the named variant and delegate.**

  In `packages/shared/src/lib/jbcc/sa-public-holidays.ts`, replace the body of `listHolidays` (`:42-61`) with:

  ```ts
  export interface NamedHoliday {
    date: Date
    name: string
  }

  /**
   * All SA public holidays for a year, named, with Sunday-rule observances
   * appended. This is the single statutory source; projects.public_holidays is
   * a materialisation of it (Appendix A(h)), seeded by
   * scripts/db/gen-public-holidays-seed.ts and asserted equal by
   * public-holidays.contract.test.ts.
   */
  export function listHolidaysNamed(year: number): NamedHoliday[] {
    const out: NamedHoliday[] = []

    for (const [m, d, label] of FIXED_DATES) out.push({ date: utc(year, m, d), name: label })

    const easter = easterSunday(year)
    const goodFriday = new Date(easter); goodFriday.setUTCDate(easter.getUTCDate() - 2)
    const familyDay  = new Date(easter); familyDay.setUTCDate(easter.getUTCDate() + 1)
    out.push({ date: goodFriday, name: 'Good Friday' }, { date: familyDay, name: 'Family Day' })

    // Sunday rule: any holiday on Sunday is also observed on the following Monday.
    for (const h of [...out]) {
      if (h.date.getUTCDay() === 0) {
        const mon = new Date(h.date); mon.setUTCDate(h.date.getUTCDate() + 1)
        out.push({ date: mon, name: `${h.name} (observed)` })
      }
    }
    return out
  }

  /** All SA public holidays for a year, with Sunday-rule observances appended. */
  export function listHolidays(year: number): Date[] {
    return listHolidaysNamed(year).map((h) => h.date)
  }
  ```

- [ ] **Step 4: Run it and watch it pass.**

  ```
  pnpm --filter @esite/shared test sa-public-holidays
  ```

  Expected: all tests pass, including the pre-existing `isPublicHoliday` suite and both order/count pins.

- [ ] **Step 5: Write the seed generator and run it over 2024–2035.**

  Create `scripts/db/gen-public-holidays-seed.ts`:

  ```ts
  #!/usr/bin/env node --experimental-strip-types
  /**
   * Prints the projects.public_holidays VALUES block for a range of years,
   * derived from listHolidaysNamed(). The seed in the migration is GENERATED by
   * this script and never hand-typed — Appendix A(h) requires the table be a
   * materialisation of the computus, not a second source of truth.
   *
   *   node --experimental-strip-types scripts/db/gen-public-holidays-seed.ts 2024 2035
   *
   * The horizon matters: projects.working_days_between RAISES on an unseeded
   * year with no fallback to calendar days, so the last seeded year is the year
   * after which every due-date computation in the product throws.
   */
  import { listHolidaysNamed } from '../../packages/shared/src/lib/jbcc/sa-public-holidays.ts'

  const from = Number(process.argv[2] ?? 2024)
  const to = Number(process.argv[3] ?? 2035)

  const rows: string[] = []
  for (let y = from; y <= to; y++) {
    for (const h of listHolidaysNamed(y)) {
      rows.push(`  ('${h.date.toISOString().slice(0, 10)}', '${h.name.replace(/'/g, "''")}')`)
    }
  }
  rows.sort()

  console.log(`INSERT INTO projects.public_holidays (d, name) VALUES`)
  console.log(rows.join(',\n'))
  console.log(`ON CONFLICT (d) DO NOTHING;`)
  console.log()
  console.log(`INSERT INTO projects.calendar_years (year)`)
  console.log(`SELECT generate_series(${from}, ${to})`)
  console.log(`ON CONFLICT (year) DO NOTHING;`)
  ```

  ```
  node --experimental-strip-types scripts/db/gen-public-holidays-seed.ts 2024 2035 | head -4
  node --experimental-strip-types scripts/db/gen-public-holidays-seed.ts 2024 2035 | grep -c "^  ('"
  ```

  Expected: an `INSERT INTO projects.public_holidays` header followed by sorted `('YYYY-MM-DD', 'Name')` rows, and a count of exactly **160** — ten fixed dates plus two computed per year, plus that year's Sunday observances, across twelve years. Not "about 160". If it is not 160, the computus moved and Step 1's pins would already have caught it.

- [ ] **Step 6: Write the contract test that keeps the SQL honest.**

  Create `packages/shared/src/lib/calendar/public-holidays.contract.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest'
  import { readFileSync, readdirSync } from 'node:fs'
  import { join, resolve } from 'node:path'
  import { listHolidaysNamed } from '../jbcc/sa-public-holidays'

  /**
   * Appendix A(h): projects.public_holidays is a MATERIALISATION of
   * listHolidaysNamed(), not a second source. This parses the seeded rows back
   * out of the migration and asserts set equality, per seeded year.
   *
   * Fixture-quality check — what would this have to look like to be able to
   * fail? It reads the real SQL a human could have edited by hand, and compares
   * dates AND names, per year. Editing one row in the migration fails it naming
   * the date; adding a year to calendar_years without seeding its holidays
   * fails it naming the year.
   */
  const REPO_ROOT = resolve(__dirname, '../../../../..')
  const MIGRATIONS = join(REPO_ROOT, 'apps/edge-functions/supabase/migrations')

  function calendarMigration(): { file: string; sql: string } {
    const file = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .find((f) => readFileSync(join(MIGRATIONS, f), 'utf8').includes('INSERT INTO projects.public_holidays'))
    if (!file) throw new Error('No migration seeds projects.public_holidays')
    return { file, sql: readFileSync(join(MIGRATIONS, file), 'utf8') }
  }

  describe('projects.public_holidays is a materialisation of listHolidaysNamed', () => {
    const { file, sql } = calendarMigration()

    const seeded = [...sql.matchAll(/\(\s*'(\d{4}-\d{2}-\d{2})'\s*,\s*'((?:[^']|'')*)'\s*\)/g)].map((m) => ({
      d: m[1],
      name: m[2].replace(/''/g, "'"),
    }))

    const years = [...new Set(seeded.map((r) => Number(r.d.slice(0, 4))))].sort()

    it(`${file} seeds at least ten years — the horizon is what stops working_days_between raising in production`, () => {
      expect(years.length).toBeGreaterThanOrEqual(10)
    })

    it(`${file} seeds at least five years beyond today`, () => {
      expect(Math.max(...years)).toBeGreaterThanOrEqual(new Date().getUTCFullYear() + 5)
    })

    for (const y of years) {
      it(`${y} matches listHolidaysNamed(${y}) exactly, dates and names`, () => {
        const expected = listHolidaysNamed(y)
          .map((h) => `${h.date.toISOString().slice(0, 10)}|${h.name}`)
          .sort()
        const actual = seeded
          .filter((r) => r.d.startsWith(String(y)))
          .map((r) => `${r.d}|${r.name}`)
          .sort()
        expect(actual).toEqual(expected)
      })
    }

    it('every seeded year is registered in calendar_years', () => {
      const m = sql.match(/INSERT INTO projects\.calendar_years[\s\S]*?generate_series\((\d{4}),\s*(\d{4})\)/)
      expect(m, 'calendar_years is not seeded by generate_series in this migration').not.toBeNull()
      const [lo, hi] = [Number(m![1]), Number(m![2])]
      expect(Math.min(...years)).toBe(lo)
      expect(Math.max(...years)).toBe(hi)
    })
  })
  ```

- [ ] **Step 7: Run it and watch it fail.**

  ```
  pnpm --filter @esite/shared test public-holidays.contract
  ```

  Expected: `No migration seeds projects.public_holidays` — the migration does not exist yet. It goes green in Task 11.

- [ ] **Step 8: Commit.**

  ```
  git add packages/shared/src/lib/jbcc/sa-public-holidays.ts \
          packages/shared/src/lib/jbcc/sa-public-holidays.test.ts \
          packages/shared/src/lib/calendar/public-holidays.contract.test.ts \
          scripts/db/gen-public-holidays-seed.ts
  git commit -m "feat(calendar): listHolidaysNamed + a derived public_holidays seed to 2035 and its contract test"
  ```

---

## Task 7 — The migration file, its `@verify` block, `user_is_org_admin()` and the exclusion rule

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00186_q1_metrics_presence_calendar.sql`
- Create: `scripts/db/assert-metrics-foundation-static.sql`
- Create: `scripts/db/assert-metrics-foundation-seeded.sql`
- Modify: `docs/superpowers/specs/2026-09-09-v2-platform-roadmap/16-appendix-registries.md` (A(f) Q1 `public` row)

⚠ **`00186` is a placeholder.** Production `max(version)` is `00184` and the ledger holds 178 rows, measured 2026-09-10; item 0 claims `00185`. A number verified at write time can be claimed by a peer session before merge, which is how two `00183`s and two `00184`s shipped in a single week. Task 15 re-claims it against `max(version)` **and** `origin/main` immediately before applying. Do not treat `00186` as reserved.

⚠⚠ **`public.user_is_org_admin(p_org_id uuid)` already exists** (`00177_membership_write_authz_rls.sql:256`) and **three** RESTRICTIVE write policies on `public.user_organisations` depend on it. What this migration creates is the **zero-argument overload**. Writing the one-argument signature here would silently replace 00177's function underneath those three policies.

- [ ] **Step 1: Write the first assertions, before any DDL.**

  Create `scripts/db/assert-metrics-foundation-static.sql`:

  ```sql
  -- STATIC assertions for the Q1 metrics/presence/calendar migration.
  --
  -- Reads only APPLIED STRUCTURE — objects, RLS, policies, grants, calendar
  -- arithmetic, the cron job. Nothing here depends on a row this file inserted,
  -- so it is safe to run read-only against production after the real apply
  -- (scripts/db/smoke-test-metrics-foundation.sh section 1).
  --
  -- Anything that needs a seeded row lives in assert-metrics-foundation-seeded.sql
  -- and only ever runs inside a transaction that rolls back.
  --
  -- MUST end in exactly one statement returning (check text, ok boolean).

  SELECT 'user_is_org_admin() zero-arg overload exists' AS check,
         to_regprocedure('public.user_is_org_admin()') IS NOT NULL AS ok
  UNION ALL
  SELECT '00177''s one-arg user_is_org_admin(uuid) survives untouched',
         to_regprocedure('public.user_is_org_admin(uuid)') IS NOT NULL
  UNION ALL
  -- MEASURED against production 2026-09-10, not assumed: exactly THREE policies
  -- reference user_is_org_admin, all on public.user_organisations (the insert,
  -- update and delete RESTRICTIVE gates from 00177). projects.project_members'
  -- three RESTRICTIVE policies call a DIFFERENT function and are pinned below.
  --
  -- COALESCE on BOTH sides: qual is NULL on an INSERT policy, and
  -- NULL || COALESCE(with_check,'') is NULL, which silently drops that policy
  -- from the count. The un-COALESCEd form returns 2 and reads as a regression.
  SELECT '00177''s three user_organisations write policies survive',
         (SELECT count(*) FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'user_organisations'
             AND COALESCE(qual,'') || COALESCE(with_check,'') LIKE '%user_is_org_admin%') = 3
  UNION ALL
  SELECT '00177''s three project_members write policies still use user_can_manage_project_members',
         (SELECT count(*) FROM pg_policies
           WHERE schemaname = 'projects' AND tablename = 'project_members'
             AND COALESCE(qual,'') || COALESCE(with_check,'') LIKE '%user_can_manage_project_members%') = 3
  UNION ALL
  SELECT 'anon has no EXECUTE on user_is_org_admin()',
         NOT has_function_privilege('anon', 'public.user_is_org_admin()', 'EXECUTE')
  UNION ALL
  SELECT 'anon has no EXECUTE on metric_account_excluded(text)',
         NOT has_function_privilege('anon', 'public.metric_account_excluded(text)', 'EXECUTE')
  ;
  ```

  Create `scripts/db/assert-metrics-foundation-seeded.sql` with just the header for now — it gains content in Tasks 8, 10 and 12:

  ```sql
  -- SEEDED assertions for the Q1 metrics/presence/calendar migration.
  --
  -- ⚠ THIS FILE WRITES ROWS. It must ONLY ever be run inside a transaction that
  -- rolls back — scripts/db/dry-run-migration.sh wraps it, and the smoke test
  -- runs it inside its own BEGIN … ROLLBACK. Never run it read-only against
  -- production.
  --
  -- Everything that reads only applied structure belongs in
  -- assert-metrics-foundation-static.sql instead, so that file can run
  -- read-only after the apply.
  --
  -- MUST end in exactly one statement returning (check text, ok boolean).

  SELECT 'seeded assertions file is reachable' AS check, true AS ok
  ;
  ```

- [ ] **Step 2: Run the dry run against an empty migration and watch the first assertion fail.**

  ```
  printf -- '-- placeholder\n' > apps/edge-functions/supabase/migrations/00186_q1_metrics_presence_calendar.sql
  scripts/db/dry-run-migration.sh \
    apps/edge-functions/supabase/migrations/00186_q1_metrics_presence_calendar.sql \
    scripts/db/assert-metrics-foundation-static.sql
  ```

  Expected — the first and the sixth red (neither object exists yet), the rest green because they describe existing production state:

  ```
    ✗ user_is_org_admin() zero-arg overload exists
    ✓ 00177's one-arg user_is_org_admin(uuid) survives untouched
    ✓ 00177's three user_organisations write policies survive
    ✓ 00177's three project_members write policies still use user_can_manage_project_members
    ✓ anon has no EXECUTE on user_is_org_admin()
    ✗ anon has no EXECUTE on metric_account_excluded(text)
  ✗ 2 of 6 assertion(s) failed
  ```

  ⚠ **`has_function_privilege` RAISES on a function that does not exist**, so if the run aborts with `function "public.metric_account_excluded(text)" does not exist` rather than printing a red line, that is the same signal — the object is absent. It becomes a printed red/green line once Step 3 lands.

  **If either policy-count assertion is red, stop.** Those two are measurements of production as it stands today (3 and 3, verified with `pg_policies` on 2026-09-10). A red one means the membership authz estate has moved and something else is wrong — do not adjust the number to make it green.

- [ ] **Step 3: Write the migration header, the `@verify` block and section 1.**

  Replace `apps/edge-functions/supabase/migrations/00186_q1_metrics_presence_calendar.sql` with:

  ```sql
  -- =============================================================================
  -- Migration 00186 — Q1 ordinal 1: metrics, presence and the working-day calendar
  -- =============================================================================
  -- Appendix A(f)'s Q1 ledger, migration 1. It lands first of the substantive set
  -- because everything downstream reads it:
  --
  --   • public.product_events          — the append-only first-party event stream
  --   • public.platform_metrics_weekly — the immutable weekly snapshot store
  --   • public.metric_cohorts          — the FROZEN September-2026 denominators
  --   • public.metric_accounts (view)  — fixture exclusion, stated once
  --   • public.metric_account_excluded — the exclusion RULE, in one function
  --   • public.user_presence / user_sessions / touch_presence()
  --   • public.user_is_org_admin()     — the zero-arg SQL counterpart of OWNER_ADMIN
  --   • projects.public_holidays / calendar_years / working_days_between()
  --   • the pg_cron job `platform-metrics-weekly`
  --
  -- The calendar is here, not in the spine's migration, because work_items.due_date
  -- is NOT NULL and its BEFORE INSERT trigger raises no_data_found on an unseeded
  -- year. Creating it first satisfies that ordering for free (§12 §(c) hard
  -- dependency 4) and removes the second place it was previously booked.
  --
  -- Additive and idempotent. No schema is created — `public` and `projects` are
  -- both already PostgREST-exposed (config.toml:9) — so a trailing NOTIFY suffices
  -- and NO Management-API config PATCH is required (the 00117 / 00183 precedent).
  --
  -- Destructive? NO. Nothing is dropped, so no backup_<version>_<object> snapshot
  -- is taken (§12 §(j) applies only to destructive migrations).
  --
  -- TWO DELIBERATE DIVERGENCES FROM §15, recorded so a later reader does not
  -- treat either as drift:
  --   (a) §15 §(a) specifies the weekly job "following the inline-key
  --       net.http_post pattern (00148:136-142)". This schedules the function
  --       DIRECTLY, because there is no edge function to call and the direct form
  --       removes the sb_secret_-is-not-a-JWT failure that broke cloud-sync-poll
  --       4/4 on its first tick.
  --   (b) §15 §(b) specifies public.touch_presence(p_platform), one argument.
  --       This ships two — p_user_agent has no other source, and user_agent is in
  --       §15's own user_sessions column list.
  --
  -- @verify:begin
  -- table: public.product_events
  -- table: public.platform_metrics_weekly
  -- table: public.metric_cohorts
  -- table: public.user_presence
  -- table: public.user_sessions
  -- table: projects.public_holidays
  -- table: projects.calendar_years
  -- view: public.metric_accounts
  -- function: public.user_is_org_admin()
  -- function: public.metric_account_excluded(text)
  -- function: public.emit_product_event(uuid,uuid,text,jsonb,uuid,uuid)
  -- function: public.touch_presence(text,text)
  -- function: public.compute_platform_metrics_weekly(date,date,boolean)
  -- function: projects.working_days_between(timestamp with time zone,timestamp with time zone,uuid,text)
  -- policy: product_events_read ON public.product_events
  -- policy: product_events_admin_only ON public.product_events
  -- policy: platform_metrics_weekly_read ON public.platform_metrics_weekly
  -- policy: platform_metrics_weekly_admin_only ON public.platform_metrics_weekly
  -- policy: metric_cohorts_read ON public.metric_cohorts
  -- policy: metric_cohorts_admin_only ON public.metric_cohorts
  -- policy: user_sessions_own ON public.user_sessions
  -- policy: user_presence_own ON public.user_presence
  -- policy: public_holidays_read ON projects.public_holidays
  -- policy: calendar_years_read ON projects.calendar_years
  -- constraint: platform_metrics_weekly_window ON public.platform_metrics_weekly
  -- constraint: platform_metrics_weekly_baseline_week ON public.platform_metrics_weekly
  -- constraint: platform_metrics_weekly_measured_has_value ON public.platform_metrics_weekly
  -- index: platform_metrics_weekly_week_uk ON public.platform_metrics_weekly
  -- index: platform_metrics_weekly_baseline_uk ON public.platform_metrics_weekly
  -- index: product_events_org_time_idx ON public.product_events
  -- index: product_events_actor_time_idx ON public.product_events
  -- index: product_events_event_time_idx ON public.product_events
  -- index: user_sessions_user_last_seen_idx ON public.user_sessions
  -- cron: platform-metrics-weekly
  -- grant_absent: anon SELECT ON public.product_events
  -- grant_absent: anon SELECT ON public.platform_metrics_weekly
  -- grant_absent: anon SELECT ON public.metric_cohorts
  -- grant_absent: anon SELECT ON public.user_presence
  -- grant_absent: anon SELECT ON public.user_sessions
  -- grant_absent: anon SELECT ON projects.public_holidays
  -- grant_absent: anon SELECT ON projects.calendar_years
  -- grant_absent: anon EXECUTE ON public.user_is_org_admin()
  -- grant_absent: anon EXECUTE ON public.metric_account_excluded(text)
  -- grant_absent: anon EXECUTE ON public.emit_product_event(uuid,uuid,text,jsonb,uuid,uuid)
  -- grant_absent: anon EXECUTE ON public.touch_presence(text,text)
  -- grant_absent: anon EXECUTE ON public.compute_platform_metrics_weekly(date,date,boolean)
  -- grant_absent: anon EXECUTE ON projects.working_days_between(timestamp with time zone,timestamp with time zone,uuid,text)
  -- sql: SELECT bool_and(EXISTS (SELECT 1 FROM projects.public_holidays ph WHERE extract(year from ph.d)::int = cy.year)) FROM projects.calendar_years cy
  -- sql: SELECT count(*) >= 3 FROM projects.calendar_years WHERE year BETWEEN extract(year from CURRENT_DATE)::int AND extract(year from CURRENT_DATE)::int + 2
  -- sql: SELECT count(*) BETWEEN 10 AND 35 FROM public.metric_cohorts WHERE cohort_key = 'weekly_active_denominator'
  -- @verify:end
  --
  -- ⚠ ON THE TWO CALENDAR `sql:` DIRECTIVES. They assert an INVARIANT, never a
  -- row count. `SELECT count(*) = 8 FROM projects.calendar_years` would be false
  -- the day §15 §(b2)'s scheduled re-seed adds a year, the CLI would exit 1, and
  -- `Deploy DB Migrations` would fail for EVERY subsequent migration — a hard
  -- block on the whole programme, self-inflicted by the tool built to prevent
  -- silent failure. The first directive instead catches a real defect (a year
  -- registered with no holidays seeded); the second catches the horizon running
  -- out, which is what makes working_days_between raise in production.

  -- ---------------------------------------------------------------------------
  -- 1a. public.user_is_org_admin() — the zero-argument overload
  -- ---------------------------------------------------------------------------
  -- OWNER_ADMIN is a TypeScript constant (packages/shared/src/types/index.ts:36)
  -- and has no meaning inside Postgres; this is its SQL counterpart.
  --
  -- ⚠ SCOPE. This returns true for an owner/admin of ANY organisation, so it is
  -- used as the RESTRICTIVE read gate ONLY on public.platform_metrics_weekly,
  -- which holds platform-wide aggregates and carries no per-org row. The two
  -- tables that DO carry per-org rows — product_events (organisation_id NOT NULL)
  -- and metric_cohorts — are gated with the existing ONE-ARGUMENT overload, so an
  -- admin of org A cannot read org B's event stream or cohort membership through
  -- PostgREST. Invisible today because WM-Consulting is effectively the only real
  -- org; a cross-tenant leak the moment metric 8 succeeds.
  --
  -- ⚠ This is an OVERLOAD, not a replacement. public.user_is_org_admin(p_org_id
  -- uuid) already exists (00177:256) and THREE RESTRICTIVE write policies on
  -- public.user_organisations depend on it. Never re-declare that signature here.
  --
  -- COALESCE to FALSE because a non-member yields NULL and NULL IN (...) is NULL.
  -- auth.uid(), never current_user — inside SECURITY DEFINER, current_user is the
  -- function OWNER, which is what made 00179's transition trigger silently inert.
  CREATE OR REPLACE FUNCTION public.user_is_org_admin()
  RETURNS boolean
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path TO 'public'
  SET row_security TO 'off'
  AS $$
    SELECT COALESCE(
      (SELECT true
         FROM public.user_organisations
        WHERE user_id = auth.uid()
          AND is_active
          AND role IN ('owner', 'admin')
        LIMIT 1),
      false);
  $$;

  -- Two revokes, not one. ALTER DEFAULT PRIVILEGES grants anon EXECUTE DIRECTLY
  -- at creation — a separate grant that FROM PUBLIC does not touch (00113:15-24
  -- is the precedent; 00177:273 is the counter-example this repo still carries).
  REVOKE ALL     ON FUNCTION public.user_is_org_admin()      FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION public.user_is_org_admin()      FROM anon;
  GRANT  EXECUTE ON FUNCTION public.user_is_org_admin()      TO authenticated, service_role;

  -- ---------------------------------------------------------------------------
  -- 1b. public.metric_account_excluded — the exclusion RULE, in ONE place
  -- ---------------------------------------------------------------------------
  -- Every denominator in this programme selects from public.metric_accounts,
  -- which calls this. Keeping the rule in a function rather than in the view's
  -- WHERE clause means a future exclusion is one CREATE OR REPLACE, auditable,
  -- with each entry and its reason as a comment beside it — instead of a second
  -- WHERE clause somewhere else, which is a second source of truth.
  --
  -- What is excluded, and why, exhaustively:
  --   • rbac-test@e-site.live — a PERMANENT production regression fixture
  --     (CLAUDE.md), not a user. Holds an active contractor role, so it lands in
  --     metric 2a's cohort if not excluded.
  --   • %probe% — the throwaway-admin pattern used for prod verification in
  --     PRs #142, #154, #158 and #162. Zero such accounts exist right now
  --     (measured: metric_accounts holds 35 of 36 profiles), which is exactly why
  --     the rule must survive the next one.
  --
  -- NOT excluded, deliberately: esite-demo.co.za holds 2 accounts (measured), one
  -- of them a contractor, and they inflate metric 2b's denominator permanently.
  -- Adding them is a PRODUCT decision for the owner, reported as a diagnostic in
  -- docs/metrics-baseline-2026-10.md rather than decided here.
  CREATE OR REPLACE FUNCTION public.metric_account_excluded(p_email text)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO 'public'
  AS $$
    SELECT p_email IS NULL
        OR p_email = 'rbac-test@e-site.live'
        OR p_email LIKE '%probe%';
  $$;

  REVOKE ALL     ON FUNCTION public.metric_account_excluded(text) FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION public.metric_account_excluded(text) FROM anon;
  GRANT  EXECUTE ON FUNCTION public.metric_account_excluded(text) TO authenticated, service_role;
  ```

- [ ] **Step 4: Run the dry run and watch all six assertions pass.**

  ```
  scripts/db/dry-run-migration.sh \
    apps/edge-functions/supabase/migrations/00186_q1_metrics_presence_calendar.sql \
    scripts/db/assert-metrics-foundation-static.sql
  ```

  Expected: `✓ 6 assertion(s) green — transaction rolled back, nothing persisted`.

- [ ] **Step 5: Prove the anon revoke is doing work.**

  Comment out the `REVOKE EXECUTE ON FUNCTION public.user_is_org_admin() FROM anon` line, re-run the dry run, and confirm the fifth assertion goes **red**:

  ```
    ✗ anon has no EXECUTE on user_is_org_admin()
  ```

  This is the mutation proof that the revoke is load-bearing rather than ceremonial — and it is the same defect production carries today on `user_is_org_admin(uuid)`. **Restore the line and re-run to green before committing.**

- [ ] **Step 6: Prove the policy-count assertion can fail.**

  Change the `= 3` on the `user_organisations` arm to `= 4` and re-run. Expected:

  ```
    ✗ 00177's three user_organisations write policies survive
  ```

  **Restore it to `= 3`.** This is the arm the old plan got wrong: it counted across both tables with an un-COALESCEd `qual || …` and expected `>= 4`, which returns **2** against production and would have sent the engineer chasing a regression that does not exist at the first red/green loop of the whole programme.

- [ ] **Step 7: Run the hygiene contract test, now that a programme migration exists.**

  ```
  pnpm --filter web test migration-verify-block
  ```

  Expected: green. `there is at least one programme migration to check` passes, and `00186…` declares the two functions it creates so far.

- [ ] **Step 8: Register the new objects in Appendix A(f), in this same commit.**

  Appendix A owns every registry. The Q1 `public` row lists `touch_presence()`, `user_is_org_admin()`, `product_events`, `platform_metrics_weekly`, `metric_cohorts` and `metric_accounts (view)` — but **not** the three functions this migration also creates. Item 0 edits the same row for the same reason.

  In `docs/superpowers/specs/2026-09-09-v2-platform-roadmap/16-appendix-registries.md`, find the A(f) table's Q1 `public` row (the one containing `inbox_state`, `notification_types`, … `metric_accounts (view)`) and append to it:

  ```
  , `metric_account_excluded()`, `emit_product_event()`, `compute_platform_metrics_weekly()`
  ```

  Locate it by content, not by line number — item 0's PR edits the same row and shifts it.

  ⚠ **§12 §(h) test 8, which would diff A(f) against the union of `@verify` blocks in both directions, does not exist.** Task 4's test enforces only that a block declares what its own file creates. This edit is therefore a review discipline, not a CI-enforced one. Say so in the PR body rather than implying a guard that is not there.

- [ ] **Step 9: Commit.**

  ```
  git add apps/edge-functions/supabase/migrations/00186_q1_metrics_presence_calendar.sql \
          scripts/db/assert-metrics-foundation-static.sql \
          scripts/db/assert-metrics-foundation-seeded.sql \
          docs/superpowers/specs/2026-09-09-v2-platform-roadmap/16-appendix-registries.md
  git commit -m "feat(db): Q1 migration 1 skeleton — user_is_org_admin() overload + metric_account_excluded()"
  ```

**Out of scope, recorded rather than fixed:** production returns `has_function_privilege('anon','public.user_is_org_admin(uuid)','EXECUTE') = true` — 00177 revoked from `PUBLIC` and granted to `authenticated` but never named `anon`. Revoking it now would change the evaluation of three live RESTRICTIVE policies for anonymous requests and belongs in its own change with its own verification. Note it in the PR body; do not fold it in here.

---

## Task 8 — `public.product_events`, its `service_role`-only writer, and the org-scoped read gate

**Files:**
- Modify: `apps/edge-functions/supabase/migrations/00186_q1_metrics_presence_calendar.sql` (append section 2)
- Modify: `scripts/db/assert-metrics-foundation-static.sql` (append assertions)
- Modify: `scripts/db/assert-metrics-foundation-seeded.sql` (append the seeded exercise and its assertion)

§12 §(i) owns the DDL. Four properties are load-bearing and are re-stated in the migration comment because a later reader will otherwise "simplify" one away:

- **`effective_role` is stamped at write time** through `user_effective_project_role(project_id, actor_id)` and never re-resolved. Role in this system is per project (`00107_user_effective_project_role.sql`, verified present in production with identity arguments `p_project_id uuid, p_user_id uuid`), and memberships change. Re-deriving a role afterwards gives the role the person holds *now*, which is the one thing the metric must not use.
- **`project_id` is nullable with `ON DELETE SET NULL`**, and the RPC's `p_project_id` parameter carries `DEFAULT NULL` — org-level events exist, and `project_deleted` fires after the row is gone. The default matters for a second reason: `JSON.stringify` drops an `undefined` value from the RPC body, and a parameter with no default would make PostgREST answer **404 "could not find the function"**, which `emitProductEvent` swallows and logs — silently losing every event from that call site.
- **Append-only.** No UPDATE and no DELETE policy, so no writer can rewrite history through PostgREST.
- **The read gate is per row, not per platform.** `product_events.organisation_id` is `NOT NULL`, so the RESTRICTIVE policy calls the **existing one-argument** `public.user_is_org_admin(organisation_id)`. A zero-argument check would let an owner or admin of any customer organisation read every other organisation's first-party event stream through PostgREST.

- [ ] **Step 1: Append the failing assertions.**

  To `scripts/db/assert-metrics-foundation-static.sql`, add these `UNION ALL` arms before the trailing `;`:

  ```sql
  UNION ALL
  SELECT 'product_events exists', to_regclass('public.product_events') IS NOT NULL
  UNION ALL
  SELECT 'product_events has RLS on',
         COALESCE((SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='product_events'), false)
  UNION ALL
  SELECT 'product_events is append-only (no UPDATE/DELETE policy)',
         NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='product_events'
                       AND cmd IN ('UPDATE','DELETE'))
  UNION ALL
  -- The gate must be ORG-SCOPED, not the zero-arg overload: product_events
  -- carries organisation_id NOT NULL and a zero-arg check is true for an
  -- owner/admin of ANY org, which is a cross-tenant read.
  SELECT 'product_events read gate is org-scoped, not platform-wide',
         COALESCE((SELECT qual LIKE '%user_is_org_admin(organisation_id)%'
                     FROM pg_policies WHERE schemaname='public' AND tablename='product_events'
                      AND policyname='product_events_admin_only'), false)
  UNION ALL
  SELECT 'anon cannot SELECT product_events', NOT has_table_privilege('anon','public.product_events','SELECT')
  UNION ALL
  SELECT 'authenticated cannot EXECUTE emit_product_event',
         NOT has_function_privilege('authenticated','public.emit_product_event(uuid,uuid,text,jsonb,uuid,uuid)','EXECUTE')
  ```

  To `scripts/db/assert-metrics-foundation-seeded.sql`, add the exercising statement **above** the final `SELECT … UNION ALL` chain, and the assertion arm inside it:

  ```sql
  -- Exercise the writer against a real project and a real member, inside the
  -- rolled-back transaction. Picks a project that HAS a member, so the role
  -- stamp is a real role and not a null. 13 of the 14 live projects have at
  -- least one project_manager membership (measured 2026-09-10).
  SELECT public.emit_product_event(
           pm.user_id, pm.project_id, 'rfi_created',
           jsonb_build_object('assignee_source','none'), NULL, NULL)
    FROM projects.project_members pm
   ORDER BY pm.project_id, pm.user_id
   LIMIT 1;
  ```

  ```sql
  UNION ALL
  SELECT 'emit_product_event stamps effective_role at write time',
         (SELECT count(*) = 1 FROM public.product_events pe
           WHERE pe.event = 'rfi_created'
             AND pe.effective_role IS NOT NULL
             AND pe.organisation_id IS NOT NULL)
  ```

- [ ] **Step 2: Run the dry run and watch it fail.**

  ```
  scripts/db/dry-run-migration.sh \
    apps/edge-functions/supabase/migrations/00186_q1_metrics_presence_calendar.sql \
    scripts/db/assert-metrics-foundation-seeded.sql \
    scripts/db/assert-metrics-foundation-static.sql
  ```

  Expected: the run aborts with a Management-API error — `function public.emit_product_event(...) does not exist`. That is the failure. (Once the function exists but a later assertion is wrong, you instead see the individual `✗` lines; either way the loop is red before the DDL lands.)

- [ ] **Step 3: Append section 2 to the migration.**

  ```sql
  -- ---------------------------------------------------------------------------
  -- 2. public.product_events — the append-only first-party event stream
  -- ---------------------------------------------------------------------------
  -- §12 §(i): two stores, and they are not the same thing. product_events is the
  -- STREAM (what happened, at full granularity); platform_metrics_weekly is the
  -- immutable weekly SNAPSHOT (what you quote). public.audit_log stays the
  -- compliance record and is not the analytics store.
  CREATE TABLE public.product_events (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      occurred_at     timestamptz NOT NULL DEFAULT now(),
      actor_id        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
      project_id      uuid REFERENCES projects.projects(id) ON DELETE SET NULL,  -- nullable: org-level events
      organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
      event           text NOT NULL CHECK (event IN (
                        'rfi_created', 'rfi_responded', 'rfi_closed',
                        'snag_resolved',
                        'project_created', 'project_deleted',
                        'marketplace_order_placed',
                        'onboarding_started',
                        'backfill_completed'
                      )),
      effective_role  text,   -- stamped at write time; NEVER re-resolved later
      session_id      uuid,
      properties      jsonb NOT NULL DEFAULT '{}'
  );

  CREATE INDEX product_events_org_time_idx ON public.product_events (organisation_id, occurred_at DESC);
  CREATE INDEX product_events_actor_time_idx ON public.product_events (actor_id, occurred_at DESC);
  CREATE INDEX product_events_event_time_idx ON public.product_events (event, occurred_at DESC);

  ALTER TABLE public.product_events ENABLE ROW LEVEL SECURITY;

  -- A RESTRICTIVE policy alone grants NOTHING — RLS is default-deny and a
  -- restrictive policy only intersects. Both halves are required (00183 shape).
  --
  -- ⚠ The RESTRICTIVE gate calls the ONE-ARGUMENT user_is_org_admin(uuid), which
  -- already exists (00177:256) and is already the gate on 00177's membership
  -- write policies — nothing new is introduced. The zero-arg overload is true for
  -- an owner/admin of ANY org, and this table carries organisation_id NOT NULL,
  -- so using it here would expose every organisation's event stream to every
  -- other organisation's admins through PostgREST. Invisible today because
  -- WM-Consulting is effectively the only real org; a cross-tenant leak the
  -- moment metric 8 succeeds.
  CREATE POLICY product_events_read ON public.product_events
      FOR SELECT USING (true);
  CREATE POLICY product_events_admin_only ON public.product_events
      AS RESTRICTIVE FOR SELECT USING (public.user_is_org_admin(organisation_id));

  -- No INSERT / UPDATE / DELETE policy at all. Writes arrive only through
  -- emit_product_event() below, and only a service_role holder can call it.

  REVOKE SELECT ON public.product_events FROM anon;

  -- ---------------------------------------------------------------------------
  -- public.emit_product_event — the ONLY writer
  -- ---------------------------------------------------------------------------
  -- The role stamp and the organisation are resolved SERVER-SIDE so a caller
  -- cannot invent either. Granted to service_role alone: the web app verifies the
  -- user with its own client first and then calls this with the service client,
  -- the same shape dispatchNotification already uses (lib/notifications.ts:26).
  --
  -- ⚠ p_project_id carries DEFAULT NULL. JSON.stringify drops an `undefined`
  -- value from the RPC body, and a parameter with NO default makes PostgREST
  -- answer 404 "could not find the function" — which emitProductEvent swallows
  -- and logs, silently losing every event from that call site. The default turns
  -- a dropped key into a null project instead of a lost event.
  CREATE OR REPLACE FUNCTION public.emit_product_event(
      p_actor_id        uuid,
      p_project_id      uuid  DEFAULT NULL,
      p_event           text  DEFAULT NULL,
      p_properties      jsonb DEFAULT '{}'::jsonb,
      p_session_id      uuid  DEFAULT NULL,
      p_organisation_id uuid  DEFAULT NULL
  ) RETURNS uuid
  LANGUAGE plpgsql
  VOLATILE SECURITY DEFINER
  SET search_path TO 'public', 'projects'
  SET row_security TO 'off'
  AS $$
  DECLARE
      v_org  uuid;
      v_role text;
      v_id   uuid;
  BEGIN
      IF p_event IS NULL THEN
          RAISE EXCEPTION 'emit_product_event: p_event is required';
      END IF;

      v_org := COALESCE(
          p_organisation_id,
          (SELECT p.organisation_id FROM projects.projects p WHERE p.id = p_project_id));
      IF v_org IS NULL THEN
          RAISE EXCEPTION 'emit_product_event: organisation_id could not be resolved (project_id=%)', p_project_id;
      END IF;

      -- Per project, at event time. NULL when there is no project to stamp against.
      IF p_project_id IS NOT NULL AND p_actor_id IS NOT NULL THEN
          v_role := public.user_effective_project_role(p_project_id, p_actor_id);
      END IF;

      INSERT INTO public.product_events
          (actor_id, project_id, organisation_id, event, effective_role, session_id, properties)
      VALUES
          (p_actor_id, p_project_id, v_org, p_event, v_role, p_session_id, COALESCE(p_properties, '{}'::jsonb))
      RETURNING id INTO v_id;

      RETURN v_id;
  END;
  $$;

  REVOKE ALL     ON FUNCTION public.emit_product_event(uuid,uuid,text,jsonb,uuid,uuid) FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION public.emit_product_event(uuid,uuid,text,jsonb,uuid,uuid) FROM anon;
  REVOKE EXECUTE ON FUNCTION public.emit_product_event(uuid,uuid,text,jsonb,uuid,uuid) FROM authenticated;
  GRANT  EXECUTE ON FUNCTION public.emit_product_event(uuid,uuid,text,jsonb,uuid,uuid) TO service_role;
  ```

- [ ] **Step 4: Run the dry run and watch every assertion pass.**

  ```
  scripts/db/dry-run-migration.sh \
    apps/edge-functions/supabase/migrations/00186_q1_metrics_presence_calendar.sql \
    scripts/db/assert-metrics-foundation-seeded.sql \
    scripts/db/assert-metrics-foundation-static.sql
  ```

  Expected: green. Read the printed total; do not trust a predicted count.

- [ ] **Step 5: Prove the role stamp is real, not a null passing a null check.**

  ```
  bash -c '. scripts/db/mgmt-api.sh; mgmt_query "
  BEGIN;
  $(cat apps/edge-functions/supabase/migrations/00186_q1_metrics_presence_calendar.sql)
  SELECT pe.event, pe.effective_role, pe.organisation_id IS NOT NULL AS has_org
    FROM (SELECT public.emit_product_event(pm.user_id, pm.project_id, '"'"'rfi_created'"'"', '"'"'{}'"'"'::jsonb, NULL, NULL) AS id
            FROM projects.project_members pm ORDER BY pm.project_id, pm.user_id LIMIT 1) s
    JOIN public.product_events pe ON pe.id = s.id;
  ROLLBACK;"'
  ```

  Expected: one row with `effective_role` set to a real role string (`project_manager`, `contractor`, …), **not** `null`. A null here would mean the stamp silently does nothing and every role-split metric is decorative.

- [ ] **Step 6: Prove the org-scoped gate is org-scoped.**

  Change the `product_events_admin_only` policy to the zero-argument `public.user_is_org_admin()` and re-run the dry run. Expected:

  ```
    ✗ product_events read gate is org-scoped, not platform-wide
  ```

  **Restore the one-argument form.** Task 16 runs the live cross-org proof — an owner of org A inserting a row for org B and reading zero.

- [ ] **Step 7: Commit.**

  ```
  git add apps/edge-functions/supabase/migrations/00186_q1_metrics_presence_calendar.sql \
          scripts/db/assert-metrics-foundation-static.sql scripts/db/assert-metrics-foundation-seeded.sql
  git commit -m "feat(db): public.product_events + a service_role-only writer that stamps role at event time"
  ```

---

## Task 9 — The accounts view, the frozen cohorts, the snapshot store, and the registries

**Files:**
- Modify: `apps/edge-functions/supabase/migrations/00186_q1_metrics_presence_calendar.sql` (append section 3)
- Modify: `scripts/db/assert-metrics-foundation-static.sql`
- Create: `packages/shared/src/lib/analytics/product-events.ts`
- Create: `packages/shared/src/lib/analytics/product-events.contract.test.ts`
- Modify: `packages/shared/src/index.ts`

Four decisions this section makes concrete.

**Fixture exclusion lives in one function, called by one view.** `public.metric_accounts` calls `public.metric_account_excluded(email)` from Task 7. Measured: **35** of 36 profiles survive it (the one exclusion is `rbac-test@e-site.live`; no `%probe%` accounts exist right now, which is why the rule must survive the next one).

**The denominators are frozen cohorts, not running counts.** Production holds 36 accounts; five have never signed in and one is the fixture — so a running denominator makes the number a function of invitation hygiene rather than of use. Each cohort is enumerated **once**, here, with `as_of = '2026-09-09'`, and never recomputed. Measured 2026-09-10: `weekly_active_denominator` = **23**, `contractor_frozen` = **12**, `client_viewer_frozen` = **4**.

**Cohort rows carry `organisation_id`, so their read gate can be org-scoped** the same way `product_events`' is. A cohort row names a person; a zero-argument admin check would expose the identity of every cohort member to an admin of any organisation. The org is resolved deterministically with `DISTINCT ON (user_id) … ORDER BY user_id, organisation_id` so a user who belongs to two organisations always lands in the same one.

**Cohorts are resolved through `user_effective_project_role`, not `user_organisations.role`.** §15 §(a) defines metric 2b as *"every account whose **effective role on any active project** is `contractor`"*, and 2a as the same set filtered on `product_events.effective_role`. Role in this system is per project — that is the whole reason the stamp exists. Measured: effective role yields **12** contractors inside `metric_accounts` (the same number the org-role query happens to give today, so nothing moves; the definition is what changes) and **4** client viewers.

⚠ **Measured discrepancy against §15, recorded rather than papered over.** §15's metric 2a names *"the 13 contractor accounts named on 9 Sep 2026"*. Thirteen accounts hold a contractor role, **and one of them is `rbac-test@e-site.live`** (verified: `role='contractor'`, `is_active=true`). Under the `metric_accounts` rule that §15 itself defines, the frozen contractor cohort is therefore **12**, not 13, and the Q1 target restated on that denominator is **6 of 12 (50%)** — which is what `METRIC_TARGET_Q1` below carries. Do not widen the exclusion rule to "fix" it: `esite-demo.co.za` also holds a contractor and is *not* covered by the rule as written, and changing the rule here would create the second source of truth §15 §(a) exists to prevent. It is reported as a diagnostic in `docs/metrics-baseline-2026-10.md`.

- [ ] **Step 1: Write the registry and its failing contract test.**

  Create `packages/shared/src/lib/analytics/product-events.ts`:

  ```ts
  // packages/shared/src/lib/analytics/product-events.ts
  //
  // The two registries the metrics stand on. Set equality with the SQL CHECK
  // constraints is asserted in both directions by product-events.contract.test.ts.

  /** Keys accepted by public.product_events.event. */
  export const PRODUCT_EVENTS = [
    'rfi_created',
    'rfi_responded',
    'rfi_closed',
    'snag_resolved',
    'project_created',
    'project_deleted',
    'marketplace_order_placed',
    'onboarding_started',
    'backfill_completed',
  ] as const
  export type ProductEvent = (typeof PRODUCT_EVENTS)[number]

  /** Keys accepted by public.platform_metrics_weekly.metric_key. */
  export const METRIC_KEYS = [
    'weekly_active',
    'contractor_active_frozen',
    'contractor_active_all',
    'client_active',
    'diary_same_day',
    'rfi_response_median_wd',
    'inbox_engagement',
    'report_schedules_per_project',
    'activation_first_session',
    'paying_organisations',
    'notifications_created',
  ] as const
  export type MetricKey = (typeof METRIC_KEYS)[number]

  /** §15 §(a). The single source of truth for every headline label, unit and target. */
  export const METRIC_LABELS: Record<MetricKey, string> = {
    weekly_active: 'Weekly active users / frozen Sept-2026 cohort',
    contractor_active_frozen: 'Contractor accounts active weekly — frozen cohort',
    contractor_active_all: 'Contractor accounts active weekly — all',
    client_active: 'Client viewers active weekly — frozen cohort',
    diary_same_day: 'Diary entries logged same day',
    rfi_response_median_wd: 'Median working days to respond on RFIs (office calendar)',
    inbox_engagement: 'Inbox engagement',
    report_schedules_per_project: 'Report schedules per active project',
    activation_first_session: 'Activation — item closed in first session',
    paying_organisations: 'Signed paying organisations',
    notifications_created: 'Notifications per first-party write',
  }

  /**
   * How to render `value`. A bare number on a dashboard is a number nobody can
   * read: `rfi_response_median_wd` showing "7" and `notifications_created`
   * showing "241" mean completely different things, and the reader cannot see
   * which. Rendered immediately after the value on /metrics.
   */
  export const METRIC_UNITS: Record<MetricKey, string> = {
    weekly_active: '%',
    contractor_active_frozen: '%',
    contractor_active_all: '%',
    client_active: '%',
    diary_same_day: '%',
    rfi_response_median_wd: ' working days',
    inbox_engagement: '%',
    report_schedules_per_project: ' per project',
    activation_first_session: '%',
    paying_organisations: ' organisations',
    notifications_created: ' per write',
  }

  /** Metric keys whose `value` is a 0..1 ratio and renders as a percentage. */
  export const RATIO_METRIC_KEYS: ReadonlySet<MetricKey> = new Set<MetricKey>([
    'weekly_active',
    'contractor_active_frozen',
    'contractor_active_all',
    'client_active',
    'diary_same_day',
    'inbox_engagement',
    'activation_first_session',
  ])

  /** Q1 targets, §15 §(a). */
  export const METRIC_TARGET_Q1: Record<MetricKey, string | null> = {
    weekly_active: '35% of the frozen cohort',
    // §15's table says "6 / 13 (46%)". The frozen cohort is 12, not 13, because
    // rbac-test@e-site.live holds an active contractor role and metric_accounts
    // excludes it by §15's own rule. Restated on the real denominator.
    contractor_active_frozen: '6 of 12 (50%)',
    contractor_active_all: '40%',
    client_active: 'instrumented, baseline published',
    diary_same_day: 'instrumented, baseline published',
    rfi_response_median_wd: '≤ 7 working days, censored pair published',
    inbox_engagement: '60% Immediate / 35% overall',
    report_schedules_per_project: '0, instrumented',
    activation_first_session: '35%',
    paying_organisations: '0, instrumented',
    notifications_created: 'down ≥ 60% on the Sept-2026 baseline',
  }
  ```

  Create `packages/shared/src/lib/analytics/product-events.contract.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest'
  import { readFileSync, readdirSync } from 'node:fs'
  import { join, resolve } from 'node:path'
  import {
    PRODUCT_EVENTS, METRIC_KEYS, METRIC_LABELS, METRIC_UNITS, METRIC_TARGET_Q1, RATIO_METRIC_KEYS,
  } from './product-events'

  /**
   * Set equality in BOTH directions between the TypeScript registry and the SQL
   * CHECK constraint, parsed out of the migration rather than restated here —
   * the shape proven by snag-photo-type.contract.test.ts.
   *
   * A key in code and not in the CHECK fails (the insert would be rejected at
   * runtime). A value in the CHECK and not in code fails (nothing can emit it,
   * so it is dead vocabulary that will be mistaken for a live one).
   */
  const REPO_ROOT = resolve(__dirname, '../../../../..')
  const MIGRATIONS = join(REPO_ROOT, 'apps/edge-functions/supabase/migrations')

  function migrationContaining(needle: string): string {
    const file = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .find((f) => readFileSync(join(MIGRATIONS, f), 'utf8').includes(needle))
    if (!file) throw new Error(`No migration contains ${needle}`)
    return readFileSync(join(MIGRATIONS, file), 'utf8')
  }

  function checkValues(sql: string, column: string): string[] {
    const m = sql.match(new RegExp(`${column}\\s+text\\s+NOT NULL[\\s\\S]{0,400}?CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)`, 'i'))
    if (!m) throw new Error(`Could not locate the ${column} CHECK constraint`)
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort()
  }

  describe('product-event registry', () => {
    it('equals public.product_events.event CHECK in both directions', () => {
      const sql = migrationContaining('CREATE TABLE public.product_events')
      expect(checkValues(sql, 'event')).toEqual([...PRODUCT_EVENTS].sort())
    })
  })

  describe('metric-key registry', () => {
    it('equals public.platform_metrics_weekly.metric_key CHECK in both directions', () => {
      const sql = migrationContaining('CREATE TABLE public.platform_metrics_weekly')
      expect(checkValues(sql, 'metric_key')).toEqual([...METRIC_KEYS].sort())
    })

    it('every key carries a label, a unit and a Q1 target — an unlabelled row is an unreadable dashboard', () => {
      for (const k of METRIC_KEYS) {
        expect(METRIC_LABELS[k], `no label for ${k}`).toBeTruthy()
        expect(METRIC_UNITS[k], `no unit for ${k}`).toBeTruthy()
        expect(k in METRIC_TARGET_Q1, `no Q1 target entry for ${k}`).toBe(true)
      }
    })

    it('every ratio key is a real metric key — a stale entry would render a ratio as a raw number', () => {
      for (const k of RATIO_METRIC_KEYS) {
        expect(METRIC_KEYS as readonly string[]).toContain(k)
      }
    })

    it('the contractor target is stated on the measured denominator of 12, not §15’s 13', () => {
      expect(METRIC_TARGET_Q1.contractor_active_frozen).toBe('6 of 12 (50%)')
    })
  })
  ```

- [ ] **Step 2: Run it and watch it fail.**

  ```
  pnpm --filter @esite/shared test product-events.contract
  ```

  Expected: the metric-key tests throw `No migration contains CREATE TABLE public.platform_metrics_weekly`; the product-event test **passes**, because Task 8 already created that table and its nine values. Partial green is the correct red state here.

- [ ] **Step 3: Prove the product-event half can fail.**

  Add `'never_emitted'` to `PRODUCT_EVENTS`, re-run, and confirm:

  ```
  AssertionError: expected [ …, 'never_emitted', … ] to deeply equal [ … ]
  ```

  Remove it before continuing. A set-equality test that has never been shown to fail is decorative.

- [ ] **Step 4: Append the failing SQL assertions.**

  Add to `scripts/db/assert-metrics-foundation-static.sql`:

  ```sql
  UNION ALL
  SELECT 'metric_accounts excludes the rbac-test fixture',
         NOT EXISTS (SELECT 1 FROM public.metric_accounts WHERE email = 'rbac-test@e-site.live')
  UNION ALL
  SELECT 'metric_accounts excludes %probe% accounts',
         NOT EXISTS (SELECT 1 FROM public.metric_accounts WHERE email LIKE '%probe%')
  UNION ALL
  -- Measured 2026-09-10: 35 of 36 profiles survive the exclusion rule.
  SELECT 'metric_accounts still holds the real estate (>= 30 of 36)',
         (SELECT count(*) FROM public.metric_accounts) >= 30
  UNION ALL
  SELECT 'weekly_active cohort is inside the 10..35 band',
         (SELECT count(*) FROM public.metric_cohorts
           WHERE cohort_key = 'weekly_active_denominator' AND as_of = DATE '2026-09-09') BETWEEN 10 AND 35
  UNION ALL
  SELECT 'contractor cohort is frozen at 12 (13 minus the fixture), by EFFECTIVE role',
         (SELECT count(*) FROM public.metric_cohorts
           WHERE cohort_key = 'contractor_frozen' AND as_of = DATE '2026-09-09') = 12
  UNION ALL
  SELECT 'client-viewer cohort is frozen at 4',
         (SELECT count(*) FROM public.metric_cohorts
           WHERE cohort_key = 'client_viewer_frozen' AND as_of = DATE '2026-09-09') = 4
  UNION ALL
  SELECT 'every cohort row carries an organisation, so its read gate can be org-scoped',
         NOT EXISTS (SELECT 1 FROM public.metric_cohorts WHERE organisation_id IS NULL)
  UNION ALL
  SELECT 'metric_cohorts read gate is org-scoped, not platform-wide',
         COALESCE((SELECT qual LIKE '%user_is_org_admin(organisation_id)%'
                     FROM pg_policies WHERE schemaname='public' AND tablename='metric_cohorts'
                      AND policyname='metric_cohorts_admin_only'), false)
  UNION ALL
  SELECT 'platform_metrics_weekly exists with RLS on',
         COALESCE((SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='platform_metrics_weekly'), false)
  UNION ALL
  -- COALESCE to false, so an ABSENT constraint fails. Without it the subquery
  -- returns NULL for a missing constraint and NULL is not true — but a NOT
  -- EXISTS phrasing would have passed vacuously, which is the pathology this
  -- whole file exists to avoid.
  SELECT 'the baseline/iso_week constraint exists and references iso_week',
         COALESCE((SELECT pg_get_constraintdef(c.oid) LIKE '%iso_week%'
                     FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
                    WHERE t.relname = 'platform_metrics_weekly'
                      AND c.conname = 'platform_metrics_weekly_baseline_week'), false)
  UNION ALL
  SELECT 'the measured-has-value constraint exists',
         COALESCE((SELECT true FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
                    WHERE t.relname = 'platform_metrics_weekly'
                      AND c.conname = 'platform_metrics_weekly_measured_has_value'), false)
  UNION ALL
  SELECT 'anon cannot SELECT platform_metrics_weekly',
         NOT has_table_privilege('anon','public.platform_metrics_weekly','SELECT')
  UNION ALL
  SELECT 'anon cannot SELECT metric_cohorts',
         NOT has_table_privilege('anon','public.metric_cohorts','SELECT')
  ```

- [ ] **Step 5: Run the dry run and watch the new assertions fail.**

  Expected: the run aborts on `relation "public.metric_accounts" does not exist`. Red.

- [ ] **Step 6: Append section 3 to the migration.**

  ```sql
  -- ---------------------------------------------------------------------------
  -- 3a. public.metric_accounts — fixture exclusion, stated once
  -- ---------------------------------------------------------------------------
  -- Every denominator selects from here, and the RULE lives in
  -- public.metric_account_excluded (section 1b) so a future exclusion is one
  -- CREATE OR REPLACE rather than a second WHERE clause somewhere else.
  -- security_invoker so the view cannot become a way round profiles' own RLS.
  CREATE VIEW public.metric_accounts
      WITH (security_invoker = true, security_barrier = true) AS
  SELECT p.id AS user_id, p.email, p.full_name
    FROM public.profiles p
   WHERE NOT public.metric_account_excluded(p.email);

  REVOKE SELECT ON public.metric_accounts FROM anon;

  -- ---------------------------------------------------------------------------
  -- 3b. public.metric_cohorts — the FROZEN September-2026 denominators
  -- ---------------------------------------------------------------------------
  -- Enumerated ONCE, here, and never recomputed. Growth is tracked by metric 2b
  -- and by the raw account count reported beside it, not by moving this floor.
  --
  -- organisation_id is NOT decoration: a cohort row names a PERSON, so a
  -- platform-wide read gate would expose the identity of every cohort member to
  -- an admin of any organisation. Resolved deterministically with DISTINCT ON so
  -- a user in two orgs always lands in the same one.
  CREATE TABLE public.metric_cohorts (
      cohort_key      text NOT NULL CHECK (cohort_key IN (
                        'weekly_active_denominator', 'contractor_frozen', 'client_viewer_frozen')),
      user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
      as_of           date NOT NULL,
      PRIMARY KEY (cohort_key, user_id, as_of)
  );

  ALTER TABLE public.metric_cohorts ENABLE ROW LEVEL SECURITY;
  CREATE POLICY metric_cohorts_read ON public.metric_cohorts FOR SELECT USING (true);
  CREATE POLICY metric_cohorts_admin_only ON public.metric_cohorts
      AS RESTRICTIVE FOR SELECT USING (public.user_is_org_admin(organisation_id));
  REVOKE SELECT ON public.metric_cohorts FROM anon;

  -- Cohort 1: accounts holding >= 1 membership on a project that had a row
  -- written in the trailing 90 days. Measured 2026-09-10: 23 accounts.
  INSERT INTO public.metric_cohorts (cohort_key, user_id, organisation_id, as_of)
  SELECT DISTINCT ON (ma.user_id)
         'weekly_active_denominator', ma.user_id, pr.organisation_id, DATE '2026-09-09'
    FROM public.metric_accounts ma
    JOIN projects.project_members pm ON pm.user_id = ma.user_id
    JOIN projects.projects pr ON pr.id = pm.project_id
   WHERE pr.updated_at > now() - interval '90 days'
      OR EXISTS (SELECT 1 FROM projects.rfis r WHERE r.project_id = pr.id AND r.created_at > now() - interval '90 days')
      OR EXISTS (SELECT 1 FROM projects.site_diary_entries d WHERE d.project_id = pr.id AND d.created_at > now() - interval '90 days')
      OR EXISTS (SELECT 1 FROM projects.qc_entries q WHERE q.project_id = pr.id AND q.created_at > now() - interval '90 days')
      OR EXISTS (SELECT 1 FROM field.snags s WHERE s.project_id = pr.id AND s.created_at > now() - interval '90 days')
      OR EXISTS (SELECT 1 FROM projects.reports rp WHERE rp.project_id = pr.id AND rp.created_at > now() - interval '90 days')
   ORDER BY ma.user_id, pr.organisation_id
  ON CONFLICT DO NOTHING;

  -- Cohorts 2 and 3: contractors and client viewers, frozen, resolved by
  -- EFFECTIVE PROJECT ROLE — §15 §(a) metric 2b defines the set as "every account
  -- whose effective role on any active project is contractor", and role in this
  -- system is per project (00107), which is the whole reason product_events
  -- stamps effective_role at write time. Measured 2026-09-10 inside
  -- metric_accounts: 12 contractors, 4 client viewers.
  --
  -- 13 accounts hold a contractor role; one of them is rbac-test@e-site.live,
  -- which metric_accounts excludes by rule. §15 says "13"; 12 is the measured
  -- number under §15's own exclusion rule, and the difference is recorded in
  -- docs/metrics-baseline-2026-10.md rather than hidden.
  INSERT INTO public.metric_cohorts (cohort_key, user_id, organisation_id, as_of)
  SELECT DISTINCT ON (cohort_key, ma.user_id)
         CASE eff.role WHEN 'contractor' THEN 'contractor_frozen' ELSE 'client_viewer_frozen' END AS cohort_key,
         ma.user_id, pr.organisation_id, DATE '2026-09-09'
    FROM public.metric_accounts ma
    JOIN projects.project_members pm ON pm.user_id = ma.user_id
    JOIN projects.projects pr ON pr.id = pm.project_id
   CROSS JOIN LATERAL (SELECT public.user_effective_project_role(pm.project_id, ma.user_id) AS role) eff
   WHERE pr.updated_at > now() - interval '90 days'
     AND eff.role IN ('contractor', 'client_viewer')
   ORDER BY cohort_key, ma.user_id, pr.organisation_id
  ON CONFLICT DO NOTHING;

  -- The migration FAILS rather than publishing a wrong denominator for twelve
  -- months. 35 is 36 accounts minus the fixture; 10 is below any plausible
  -- membership count for the live projects, given the notification roster
  -- resolves 12-13 WM people for a single WM project (00146:32-55).
  DO $$
  DECLARE n int;
  BEGIN
      SELECT count(*) INTO n FROM public.metric_cohorts
       WHERE cohort_key = 'weekly_active_denominator' AND as_of = DATE '2026-09-09';
      IF n NOT BETWEEN 10 AND 35 THEN
          RAISE EXCEPTION 'metric cohort out of band: % (expected 10..35)', n;
      END IF;
  END $$;

  -- ---------------------------------------------------------------------------
  -- 3c. public.platform_metrics_weekly — the immutable weekly snapshot store
  -- ---------------------------------------------------------------------------
  -- A materialised weekly FACT TABLE, not a view over the event log: a target
  -- must be readable without re-scanning the stream. Append-only and carrying
  -- method_version, so changing a definition writes NEW rows rather than
  -- rewriting history — the same discipline as read_at_estimated.
  CREATE TABLE public.platform_metrics_weekly (
      id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      metric_key     text NOT NULL CHECK (metric_key IN (
                       'weekly_active',
                       'contractor_active_frozen',
                       'contractor_active_all',
                       'client_active',
                       'diary_same_day',
                       'rfi_response_median_wd',
                       'inbox_engagement',
                       'report_schedules_per_project',
                       'activation_first_session',
                       'paying_organisations',
                       'notifications_created'
                     )),
      iso_year       int  NOT NULL,
      iso_week       int  CHECK (iso_week BETWEEN 1 AND 53),
      window_start   date NOT NULL,
      window_end     date NOT NULL,     -- exclusive
      numerator      numeric,
      denominator    numeric,
      value          numeric,           -- weekly rate or ratio
      status         text NOT NULL CHECK (status IN ('measured','censored','unmeasurable','not_yet_instrumented')),
      method_version int  NOT NULL DEFAULT 1,
      is_baseline    boolean NOT NULL DEFAULT false,
      note           text,
      detail         jsonb NOT NULL DEFAULT '{}',
      captured_at    timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT platform_metrics_weekly_window CHECK (window_end > window_start),
      CONSTRAINT platform_metrics_weekly_baseline_week
        CHECK ((is_baseline AND iso_week IS NULL) OR (NOT is_baseline AND iso_week IS NOT NULL)),
      -- ⚠ This CHECK is why every ratio arm of the rollup declares its OWN status
      -- rather than hard-coding 'measured': a week with a zero denominator yields
      -- a NULL value, and 'measured' + NULL aborts the whole INSERT, so the job
      -- writes ZERO rows and "no row" is read as "the job did not run".
      CONSTRAINT platform_metrics_weekly_measured_has_value
        CHECK (status <> 'measured' OR value IS NOT NULL)
  );

  CREATE UNIQUE INDEX platform_metrics_weekly_week_uk
      ON public.platform_metrics_weekly (metric_key, iso_year, iso_week, method_version)
      WHERE NOT is_baseline;
  CREATE UNIQUE INDEX platform_metrics_weekly_baseline_uk
      ON public.platform_metrics_weekly (metric_key, method_version)
      WHERE is_baseline;

  ALTER TABLE public.platform_metrics_weekly ENABLE ROW LEVEL SECURITY;
  CREATE POLICY platform_metrics_weekly_read ON public.platform_metrics_weekly
      FOR SELECT USING (true);
  -- The ZERO-ARG overload, deliberately: this table holds platform-wide
  -- aggregates and carries no per-org row, so there is nothing to scope to. The
  -- two tables that DO carry per-org rows use the one-arg form.
  CREATE POLICY platform_metrics_weekly_admin_only ON public.platform_metrics_weekly
      AS RESTRICTIVE FOR SELECT USING (public.user_is_org_admin());
  -- No UPDATE or DELETE policy: the snapshot is never rewritten.
  REVOKE SELECT ON public.platform_metrics_weekly FROM anon;
  ```

- [ ] **Step 7: Run the dry run and watch it go green.**

  ```
  scripts/db/dry-run-migration.sh \
    apps/edge-functions/supabase/migrations/00186_q1_metrics_presence_calendar.sql \
    scripts/db/assert-metrics-foundation-seeded.sql \
    scripts/db/assert-metrics-foundation-static.sql
  ```

  If `contractor cohort is frozen at 12` or `client-viewer cohort is frozen at 4` is red, **read the count before changing the number** — both are measurements, not constants, and a different value means the membership estate has moved since 2026-09-10:

  ```
  bash -c '. scripts/db/mgmt-api.sh; mgmt_query "
  WITH ma AS (SELECT p.id AS user_id FROM public.profiles p WHERE p.email <> '"'"'rbac-test@e-site.live'"'"' AND p.email NOT LIKE '"'"'%probe%'"'"'),
  act AS (SELECT id FROM projects.projects WHERE updated_at > now() - interval '"'"'90 days'"'"'),
  eff AS (SELECT DISTINCT pm.user_id, public.user_effective_project_role(pm.project_id, pm.user_id) AS role
          FROM projects.project_members pm JOIN act ON act.id = pm.project_id)
  SELECT e.role, count(DISTINCT e.user_id) FROM eff e JOIN ma ON ma.user_id = e.user_id GROUP BY 1 ORDER BY 1;"'
  ```

- [ ] **Step 8: Prove the cohort band guard can fail.**

  Temporarily change the `RAISE EXCEPTION` band to `BETWEEN 100 AND 200` and re-run the dry run. Expected: the whole run aborts with `metric cohort out of band: 23 (expected 100..200)`. Restore the band and re-run to green.

- [ ] **Step 9: Run the registry contract test, now green.**

  ```
  pnpm --filter @esite/shared test product-events.contract
  ```

  Expected: all five tests pass.

- [ ] **Step 10: Export from the barrel and commit.**

  Add to `packages/shared/src/index.ts`:

  ```ts
  // Product-event and metric-key registries (§15 §(a), §12 §(i)).
  export * from './lib/analytics/product-events'
  ```

  ```
  pnpm --filter @esite/shared type-check
  git add apps/edge-functions/supabase/migrations/00186_q1_metrics_presence_calendar.sql \
          scripts/db/assert-metrics-foundation-static.sql \
          packages/shared/src/lib/analytics/product-events.ts \
          packages/shared/src/lib/analytics/product-events.contract.test.ts \
          packages/shared/src/index.ts
  git commit -m "feat(db): metric_accounts view, org-scoped frozen cohorts, platform_metrics_weekly"
  ```

---

## Task 10 — Presence and sessions: two objects, one writer

**Files:**
- Modify: `apps/edge-functions/supabase/migrations/00186_q1_metrics_presence_calendar.sql` (append section 4)
- Modify: `scripts/db/assert-metrics-foundation-static.sql`
- Modify: `scripts/db/assert-metrics-foundation-seeded.sql`

**Why these are created here and nowhere else.** §05 (the notification engine, Q1 item 4) *consumes* presence and creates none of it; §12 §(i) cites it. A session is an interval and **cannot be inferred afterwards** from rows that record only writes, which is why it must exist from week one. The alternatives were each measured and rejected: `public.auth_events` is a best-effort **client** call after an explicit login (`(auth)/login/page.tsx:108`, `:166`), rate-limited per IP (`actions/auth-event.actions.ts:39`), and emits nothing at all for a returning cookie session — its columns are `id, user_id, event_type, ip_address, user_agent, metadata, occurred_at` and there is no session identifier among them. `public.profiles` has no `last_seen` column (`00001_initial_schema.sql:61-70`). GoTrue's `last_sign_in_at` is reachable only through a paginated admin call and measures logins, not use.

**One RPC writes both**, so a session can never exist without presence having been written and the two can never disagree. It is an RPC rather than a PostgREST upsert deliberately: `Prefer: resolution=merge-duplicates` must arrive as an HTTP **header**, and a supabase-js `.upsert()` has already silently no-opped on `project_settings` in this codebase. An RPC sidesteps the trap entirely.

**`platform` carries a CHECK, fixed here before three authors invent three spellings.** `touch_presence`'s callers arrive in three different items written weeks apart — item 4's heartbeat, item 10's phone-usable shell, item 7's recap. Item 10's entire success criterion is that contractor foremen use the product on a 375px Android screen, a claim only evidenced by splitting sessions by platform; if the vocabulary drifts to `mobile` / `phone` / `web-mobile` across three authors, that split is unrecoverable for the quarter it needs to cover. The set is `web`, `mobile_web`, `mobile_app` and nothing else.

**The 30-minute gap is applied at read time**, over `last_seen_at`. The RPC's extend-or-open decision is a convenience for the dispatcher; metric 7 re-derives session boundaries from the timestamps and does not trust the split.

⚠ **Divergence from §15 §(b), recorded.** §15 names the writer `public.touch_presence(p_platform)` — one argument. This ships two: `p_user_agent` has no other source and `user_agent` is in §15's own `user_sessions` column list. The `@verify` directive, the grant and every future caller key on the two-argument signature.

- [ ] **Step 1: Append the failing assertions.**

  To `scripts/db/assert-metrics-foundation-static.sql`:

  ```sql
  UNION ALL
  SELECT 'user_presence exists', to_regclass('public.user_presence') IS NOT NULL
  UNION ALL
  SELECT 'user_sessions exists', to_regclass('public.user_sessions') IS NOT NULL
  UNION ALL
  SELECT 'the platform vocabulary is fixed by a CHECK on both tables',
         (SELECT count(*) FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
           WHERE t.relname IN ('user_presence','user_sessions')
             AND c.contype = 'c'
             AND pg_get_constraintdef(c.oid) LIKE '%mobile_app%') = 2
  UNION ALL
  SELECT 'anon cannot EXECUTE touch_presence',
         NOT has_function_privilege('anon','public.touch_presence(text,text)','EXECUTE')
  UNION ALL
  SELECT 'authenticated CAN execute touch_presence (the app shell calls it)',
         has_function_privilege('authenticated','public.touch_presence(text,text)','EXECUTE')
  UNION ALL
  SELECT 'a user reads only their own session rows',
         COALESCE((SELECT qual LIKE '%auth.uid()%' FROM pg_policies
                    WHERE schemaname='public' AND tablename='user_sessions'
                      AND policyname='user_sessions_own'), false)
  UNION ALL
  SELECT 'anon cannot SELECT user_sessions', NOT has_table_privilege('anon','public.user_sessions','SELECT')
  UNION ALL
  SELECT 'anon cannot SELECT user_presence', NOT has_table_privilege('anon','public.user_presence','SELECT')
  ```

  To `scripts/db/assert-metrics-foundation-seeded.sql`, add the exercise above the final chain, and the assertion inside it:

  ```sql
  -- Exercise the extend-vs-open branch directly against real profile ids, inside
  -- the rolled-back transaction. touch_presence() itself reads auth.uid(), which
  -- is NULL for the Management API, so it returns without writing — the RPC's
  -- own round-trip is proven in Step 5 and by the smoke test instead. What this
  -- covers is the interval arithmetic the branch depends on.
  INSERT INTO public.user_sessions (user_id, last_seen_at, platform)
  SELECT id, now() - interval '45 minutes', 'web' FROM public.profiles ORDER BY id LIMIT 1;
  INSERT INTO public.user_sessions (user_id, last_seen_at, platform)
  SELECT id, now() - interval '2 minutes', 'web' FROM public.profiles ORDER BY id LIMIT 1;
  ```

  ```sql
  UNION ALL
  SELECT 'the 30-minute window excludes a 45-minute-old session and includes a 2-minute-old one',
         (SELECT count(*) FROM public.user_sessions s
           WHERE s.user_id = (SELECT id FROM public.profiles ORDER BY id LIMIT 1)
             AND s.last_seen_at > now() - interval '30 minutes') = 1
  ```

  **That `= 1` is the load-bearing number.** If it returns 2 the interval comparison is wrong, and metric 7's denominator silently collapses every user to one lifetime session.

- [ ] **Step 2: Run the dry run and watch it fail.**

  Expected: the run aborts on `relation "public.user_sessions" does not exist`.

- [ ] **Step 3: Append section 4 to the migration.**

  ```sql
  -- ---------------------------------------------------------------------------
  -- 4. Presence and sessions — two objects, ONE writer
  -- ---------------------------------------------------------------------------
  -- user_presence is the current-state row the notification dispatcher branches
  -- on. user_sessions is the append-only history the metrics read. The SAME RPC
  -- writes both, so they cannot disagree.
  --
  -- The platform CHECK is fixed HERE, before three callers in three different Q1
  -- items invent three spellings. Item 10's success criterion is contractor use
  -- on a 375px Android screen, which can only be evidenced by splitting sessions
  -- by platform; a vocabulary that drifts is unrecoverable for that quarter.
  CREATE TABLE public.user_presence (
      user_id        uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
      last_active_at timestamptz NOT NULL DEFAULT now(),
      platform       text CHECK (platform IN ('web','mobile_web','mobile_app'))
  );

  CREATE TABLE public.user_sessions (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      started_at   timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      user_agent   text,
      platform     text CHECK (platform IN ('web','mobile_web','mobile_app'))
  );

  CREATE INDEX user_sessions_user_last_seen_idx ON public.user_sessions (user_id, last_seen_at DESC);

  ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

  -- Own-row read only. No write policy: writes arrive through touch_presence().
  CREATE POLICY user_presence_own ON public.user_presence
      FOR SELECT USING (user_id = auth.uid());
  CREATE POLICY user_sessions_own ON public.user_sessions
      FOR SELECT USING (user_id = auth.uid());

  REVOKE SELECT ON public.user_presence FROM anon;
  REVOKE SELECT ON public.user_sessions FROM anon;

  -- The single writer. SECURITY DEFINER so it can write through the own-row-read
  -- policies, and it touches ONLY auth.uid()'s rows — never a user_id argument,
  -- which would make it a forgery primitive. auth.uid(), never current_user.
  CREATE OR REPLACE FUNCTION public.touch_presence(
      p_platform   text DEFAULT 'web',
      p_user_agent text DEFAULT NULL
  ) RETURNS void
  LANGUAGE plpgsql
  VOLATILE SECURITY DEFINER
  SET search_path TO 'public'
  SET row_security TO 'off'
  AS $$
  DECLARE
      v_uid     uuid := auth.uid();
      v_session uuid;
      v_plat    text := COALESCE(p_platform, 'web');
  BEGIN
      IF v_uid IS NULL THEN RETURN; END IF;
      IF v_plat NOT IN ('web','mobile_web','mobile_app') THEN
          RAISE EXCEPTION 'touch_presence: unknown platform %', v_plat;
      END IF;

      INSERT INTO public.user_presence (user_id, last_active_at, platform)
      VALUES (v_uid, now(), v_plat)
      ON CONFLICT (user_id) DO UPDATE
        SET last_active_at = now(), platform = EXCLUDED.platform;

      -- Extend the most recent session, or open a new one. The 30-minute gap is
      -- ALSO applied at read time over last_seen_at (§15 §(b)); this write-time
      -- split is a convenience for the dispatcher, not the metric's authority.
      SELECT s.id INTO v_session
        FROM public.user_sessions s
       WHERE s.user_id = v_uid
         AND s.last_seen_at > now() - interval '30 minutes'
       ORDER BY s.last_seen_at DESC
       LIMIT 1;

      IF v_session IS NULL THEN
          INSERT INTO public.user_sessions (user_id, user_agent, platform)
          VALUES (v_uid, p_user_agent, v_plat);
      ELSE
          UPDATE public.user_sessions SET last_seen_at = now() WHERE id = v_session;
      END IF;
  END;
  $$;

  REVOKE ALL     ON FUNCTION public.touch_presence(text,text) FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION public.touch_presence(text,text) FROM anon;
  GRANT  EXECUTE ON FUNCTION public.touch_presence(text,text) TO authenticated, service_role;
  ```

- [ ] **Step 4: Run the dry run and watch it go green.**

- [ ] **Step 5: Prove the RPC actually writes when there IS a `auth.uid()`.**

  The Management API runs as `postgres` with no JWT, so `auth.uid()` is NULL and `touch_presence()` correctly returns without writing. Impersonate a real user inside a rolled-back transaction — the PR #157 pattern — so the write path is exercised for real:

  ```
  bash -c '. scripts/db/mgmt-api.sh; mgmt_query "
  BEGIN;
  $(cat apps/edge-functions/supabase/migrations/00186_q1_metrics_presence_calendar.sql)
  SELECT set_config('"'"'request.jwt.claims'"'"',
    json_build_object('"'"'sub'"'"', (SELECT id::text FROM public.profiles ORDER BY id LIMIT 1),
                      '"'"'role'"'"','"'"'authenticated'"'"')::text, true);
  SELECT public.touch_presence('"'"'web'"'"', '"'"'dry-run/1.0'"'"');
  SELECT (SELECT count(*) FROM public.user_presence) AS presence_rows,
         (SELECT count(*) FROM public.user_sessions) AS session_rows,
         (SELECT platform FROM public.user_presence LIMIT 1) AS platform;
  ROLLBACK;"'
  ```

  Expected: `presence_rows = 1`, `session_rows = 1`, `platform = web`. **If both are 0, `auth.uid()` did not resolve and the RPC is inert** — that is a stop-and-fix, because every presence metric would then be permanently empty with no error anywhere, which is exactly how `00179`'s transition trigger shipped silently dead.

- [ ] **Step 6: Prove the platform CHECK can fail.**

  ```
  bash -c '. scripts/db/mgmt-api.sh; mgmt_query "
  BEGIN;
  $(cat apps/edge-functions/supabase/migrations/00186_q1_metrics_presence_calendar.sql)
  INSERT INTO public.user_sessions (user_id, platform)
  SELECT id, '"'"'phone'"'"' FROM public.profiles ORDER BY id LIMIT 1;
  ROLLBACK;"' ; echo "exit=$?"
  ```

  Expected: an error naming `user_sessions_platform_check`, `exit=1`. That failure is the feature.

- [ ] **Step 7: Commit.**

  ```
  git add apps/edge-functions/supabase/migrations/00186_q1_metrics_presence_calendar.sql \
          scripts/db/assert-metrics-foundation-static.sql scripts/db/assert-metrics-foundation-seeded.sql
  git commit -m "feat(db): user_presence + user_sessions + touch_presence(), one writer, fixed platform vocabulary"
  ```

---

## Task 11 — The A(h) calendar: two tables, one seeded source, and a function that raises

**Files:**
- Modify: `apps/edge-functions/supabase/migrations/00186_q1_metrics_presence_calendar.sql` (append section 5)
- Modify: `scripts/db/assert-metrics-foundation-static.sql`
- Create: `packages/shared/src/lib/calendar/working-days.ts`
- Create: `packages/shared/src/lib/calendar/working-days.test.ts`
- Modify: `packages/shared/src/index.ts`

**The statutory / operational split is absolute.** The JBCC time-bar engine keeps a fixed statutory calendar — Mon–Fri minus SA public holidays — and **never reads `project_settings`**, because JBCC defines "working day" in the contract, not in a project preference, and `deadline_date` is stored. `packages/shared/src/lib/jbcc/working-days.ts` is **not touched by this task** and `computeDeadline` keeps calling `isPublicHoliday` exactly as it does. §03 §1.5's instruction that "JBCC is switched onto the extended helper in the same PR" is deleted by A(h) and must not be reinstated.

**Two calendars, resolved from one existing row. No new column.** `projects.project_settings.working_days int[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]` already exists (`00101_project_settings.sql:20`) and today drives no computation — that absence of computation is the real gap. Measured 2026-09-10: **all 14** `project_settings` rows carry the default working week and an empty `extra_holidays`.
- **`office`** = `working_days` as stored, minus `public_holidays` and `extra_holidays`.
- **`site`** = `office` plus Saturday where Saturday is absent from `working_days`.

**`p_calendar` has NO DEFAULT.** §15 fixes three different calendars for three different consumers: metric 4 uses **office**, the chase ladder uses **site**, JBCC uses statutory-only. The chase ladder is written by a different person in item 4, weeks later. A silent office default means the ladder that escalates a contractor's overdue item computes his deadline on a Monday–Friday office week while he is working Saturdays — a one-day drift in the direction that makes him look later than he is. Making every caller state its calendar costs nothing at build time and forecloses a class of bug that cannot be caught by reading either call site alone.

**`working_days_between` RAISES on an unseeded year. There is no fallback to calendar days**, because a silent one-day drift changes whether an item escalates. That is also why the seed runs to 2035 (Task 6).

**The assertions pin the calendar rather than sampling it.** Every SQL arm below resolves its project with `(SELECT project_id FROM projects.project_settings WHERE working_days = ARRAY[1,2,3,4,5] AND COALESCE(array_length(extra_holidays,1),0) = 0 ORDER BY project_id LIMIT 1)` — deterministic, and explicit about the configuration the expected numbers depend on. An unordered `LIMIT 1` over `projects.projects` would make these numbers flap the moment one project is configured to work Saturdays or adds a shutdown day.

- [ ] **Step 1: Write the failing TypeScript mirror test.**

  Create `packages/shared/src/lib/calendar/working-days.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest'
  import { listHolidaysNamed } from '../jbcc/sa-public-holidays'
  import { buildCalendar, workingDaysBetween, addWorkingDays, type ProjectCalendar } from './working-days'

  const seeded = (years: number[]) => {
    const holidays = new Set<string>()
    for (const y of years) for (const h of listHolidaysNamed(y)) holidays.add(h.date.toISOString().slice(0, 10))
    return { holidays, seededYears: new Set(years) }
  }

  const cal = (over: Partial<ProjectCalendar> = {}): ProjectCalendar =>
    buildCalendar({
      workingDays: [1, 2, 3, 4, 5],
      extraHolidays: [],
      calendar: 'office',
      ...seeded([2026, 2027]),
      ...over,
    })

  describe('workingDaysBetween — office', () => {
    it('counts a plain Mon→Fri week as 4', () => {
      // 2026-06-01 is a Monday; 2026-06-05 the Friday.
      expect(workingDaysBetween(new Date('2026-06-01T08:00:00Z'), new Date('2026-06-05T08:00:00Z'), cal())).toBe(4)
    })

    it('skips a public holiday', () => {
      // 16 June 2026 (Youth Day) is a Tuesday. Mon 15th → Wed 17th is 1 working day.
      expect(workingDaysBetween(new Date('2026-06-15T08:00:00Z'), new Date('2026-06-17T08:00:00Z'), cal())).toBe(1)
    })

    it('skips an extra_holidays date the project added', () => {
      const c = cal({ extraHolidays: ['2026-06-03'] })
      expect(workingDaysBetween(new Date('2026-06-01T08:00:00Z'), new Date('2026-06-05T08:00:00Z'), c)).toBe(3)
    })
  })

  describe('workingDaysBetween — site', () => {
    it('counts Saturday when the working week does not already include it', () => {
      // 2026-06-01 Mon → 2026-06-08 Mon: office = 5, site = 6 (adds Sat the 6th).
      expect(workingDaysBetween(new Date('2026-06-01T08:00:00Z'), new Date('2026-06-08T08:00:00Z'), cal())).toBe(5)
      expect(workingDaysBetween(new Date('2026-06-01T08:00:00Z'), new Date('2026-06-08T08:00:00Z'), cal({ calendar: 'site' }))).toBe(6)
    })

    it('does not double-count Saturday for a project that already works Saturdays', () => {
      const c = cal({ workingDays: [1, 2, 3, 4, 5, 6], calendar: 'site' })
      expect(workingDaysBetween(new Date('2026-06-01T08:00:00Z'), new Date('2026-06-08T08:00:00Z'), c)).toBe(6)
    })
  })

  describe('the Africa/Johannesburg cast', () => {
    // SAST is UTC+2 with no DST, so the UTC date runs BEHIND the local date. The
    // misclassification window is 00:00-02:00 SAST. A fixture built at 22:30
    // passes under the correct and the incorrect cast alike and is decorative.
    it('treats 00:30 SAST as the local day, not the previous UTC day', () => {
      // 2026-06-02T22:30Z is 2026-06-03 00:30 SAST — a Wednesday locally.
      const from = new Date('2026-06-01T08:00:00Z')      // Mon
      const to = new Date('2026-06-02T22:30:00Z')        // Wed 00:30 SAST
      expect(workingDaysBetween(from, to, cal())).toBe(2)
    })
  })

  describe('unseeded years raise rather than silently drifting', () => {
    it('throws when either bound falls in a year with no calendar row', () => {
      expect(() => workingDaysBetween(new Date('2029-01-05T08:00:00Z'), new Date('2029-01-12T08:00:00Z'), cal()))
        .toThrow(/not seeded/i)
    })
  })

  describe('addWorkingDays', () => {
    it('lands on the first office working day after Youth Day', () => {
      // Mon 15 June 2026 + 1 working day = Wed 17 June (Tue 16th is Youth Day).
      expect(addWorkingDays(new Date('2026-06-15T08:00:00Z'), 1, cal()).toISOString().slice(0, 10)).toBe('2026-06-17')
    })

    it('pushes a due date landing inside the builders shutdown to the new year', () => {
      const c = cal({ shutdown: { from: '2026-12-15', to: '2027-01-15' }, calendar: 'site' })
      const due = addWorkingDays(new Date('2026-12-10T08:00:00Z'), 10, c)
      expect(due.toISOString().slice(0, 10) > '2027-01-15').toBe(true)
    })
  })
  ```

- [ ] **Step 2: Run it and watch it fail.**

  ```
  pnpm --filter @esite/shared test calendar/working-days
  ```

  Expected: `Failed to resolve import "./working-days"` — nine tests fail.

- [ ] **Step 3: Write the TypeScript mirror.**

  Create `packages/shared/src/lib/calendar/working-days.ts`:

  ```ts
  // packages/shared/src/lib/calendar/working-days.ts
  //
  // The TypeScript mirror of projects.working_days_between (Appendix A(h)).
  //
  // ⚠ This is NOT the JBCC helper. lib/jbcc/working-days.ts keeps a FIXED
  // statutory calendar — Mon-Fri minus SA public holidays — and never reads
  // project_settings, because JBCC defines "working day" in the contract, not in
  // a project preference. Do not merge the two.
  //
  // `calendar` is a REQUIRED field, never defaulted, for the same reason the SQL
  // function has no DEFAULT on p_calendar: the chase ladder uses 'site' and
  // metric 4 uses 'office', they are written weeks apart, and a silent default
  // produces a one-day drift in the direction that makes a contractor look late.

  const SAST_OFFSET_MS = 2 * 60 * 60 * 1000   // UTC+2, no DST
  const MS_PER_DAY = 24 * 60 * 60 * 1000

  export interface CalendarInput {
    /** ISO day-of-week numbers, 1 = Monday … 7 = Sunday. projects.project_settings.working_days. */
    workingDays: number[]
    /** projects.project_settings.extra_holidays, as 'YYYY-MM-DD'. */
    extraHolidays: string[]
    calendar: 'office' | 'site'
    /** Seeded projects.public_holidays dates, as 'YYYY-MM-DD'. */
    holidays: Set<string>
    /** Years present in projects.calendar_years. */
    seededYears: Set<number>
    /** Per-project December shutdown window, inclusive, as 'YYYY-MM-DD'. */
    shutdown?: { from: string; to: string }
  }

  export interface ProjectCalendar extends CalendarInput {
    /** The resolved working-day set after the office/site rule is applied. */
    readonly effectiveDays: ReadonlySet<number>
  }

  export function buildCalendar(input: CalendarInput): ProjectCalendar {
    const days = new Set(input.workingDays)
    // site = office plus Saturday where Saturday is absent. SA sites work
    // Saturdays, which is also why the recap fires `0 5 * * 1-6`.
    if (input.calendar === 'site' && !days.has(6)) days.add(6)
    return { ...input, effectiveDays: days }
  }

  /** The local (SAST) calendar date of an instant, as 'YYYY-MM-DD'. */
  export function sastDate(d: Date): string {
    return new Date(d.getTime() + SAST_OFFSET_MS).toISOString().slice(0, 10)
  }

  /** ISO day-of-week, 1 = Monday … 7 = Sunday, in SAST. */
  function sastIsoDow(ymd: string): number {
    const day = new Date(`${ymd}T00:00:00Z`).getUTCDay()
    return day === 0 ? 7 : day
  }

  function assertSeeded(ymd: string, cal: ProjectCalendar): void {
    const year = Number(ymd.slice(0, 4))
    if (!cal.seededYears.has(year)) {
      throw new Error(`working-days: ${year} is not seeded in calendar_years — refusing to fall back to calendar days`)
    }
  }

  function isWorkingDay(ymd: string, cal: ProjectCalendar): boolean {
    if (!cal.effectiveDays.has(sastIsoDow(ymd))) return false
    if (cal.holidays.has(ymd)) return false
    if (cal.extraHolidays.includes(ymd)) return false
    if (cal.shutdown && ymd >= cal.shutdown.from && ymd <= cal.shutdown.to) return false
    return true
  }

  function nextDay(ymd: string): string {
    return new Date(new Date(`${ymd}T00:00:00Z`).getTime() + MS_PER_DAY).toISOString().slice(0, 10)
  }

  /**
   * Working days from `from` (exclusive) to `to` (inclusive), both evaluated in
   * Africa/Johannesburg. Raises on any year in the span with no calendar_years
   * row — a silent one-day drift changes whether an item escalates.
   */
  export function workingDaysBetween(from: Date, to: Date, cal: ProjectCalendar): number {
    let cursor = sastDate(from)
    const end = sastDate(to)
    assertSeeded(cursor, cal)
    assertSeeded(end, cal)
    if (end <= cursor) return 0

    let count = 0
    while (cursor < end) {
      cursor = nextDay(cursor)
      assertSeeded(cursor, cal)
      if (isWorkingDay(cursor, cal)) count += 1
    }
    return count
  }

  /** The instant `n` working days after `from`, at SAST midnight of the landing day. */
  export function addWorkingDays(from: Date, n: number, cal: ProjectCalendar): Date {
    let cursor = sastDate(from)
    assertSeeded(cursor, cal)
    let remaining = n
    while (remaining > 0) {
      cursor = nextDay(cursor)
      assertSeeded(cursor, cal)
      if (isWorkingDay(cursor, cal)) remaining -= 1
    }
    return new Date(`${cursor}T00:00:00Z`)
  }
  ```

- [ ] **Step 4: Run it and watch it pass.**

  ```
  pnpm --filter @esite/shared test calendar/working-days
  ```

  Expected: `Tests 9 passed`.

- [ ] **Step 5: Prove the SAST cast is doing work.**

  Change `SAST_OFFSET_MS` to `0`, re-run, and confirm `treats 00:30 SAST as the local day` fails with `expected 1 to be 2`. **Restore it.** This is the fixture-quality rule applied: the 22:30 fixture that would pass either way is deliberately not the one used.

- [ ] **Step 6: Append the failing SQL assertions, against a PINNED project.**

  Add to `scripts/db/assert-metrics-foundation-static.sql`:

  ```sql
  UNION ALL
  SELECT 'calendar_years and public_holidays agree — every registered year has holidays seeded',
         (SELECT bool_and(EXISTS (SELECT 1 FROM projects.public_holidays ph
                                   WHERE extract(year from ph.d)::int = cy.year))
            FROM projects.calendar_years cy)
  UNION ALL
  SELECT 'the calendar horizon reaches at least five years past today',
         (SELECT max(year) FROM projects.calendar_years) >= extract(year from CURRENT_DATE)::int + 5
  UNION ALL
  SELECT 'working_days_between is STABLE, never IMMUTABLE',
         (SELECT p.provolatile = 's' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'projects' AND p.proname = 'working_days_between')
  UNION ALL
  SELECT 'p_calendar has NO default — every caller states its calendar',
         (SELECT pronargdefaults = 0 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'projects' AND p.proname = 'working_days_between')
  UNION ALL
  -- Every arm below resolves the SAME pinned project: one whose working week is
  -- the default Mon-Fri with no extra holidays. Measured 2026-09-10: all 14
  -- project_settings rows qualify. An unordered LIMIT 1 over projects.projects
  -- would make these numbers flap the day one project works Saturdays.
  SELECT 'office: Mon 2026-06-01 -> Fri 2026-06-05 is 4 working days',
         projects.working_days_between(timestamptz '2026-06-01 08:00+02', timestamptz '2026-06-05 08:00+02',
           (SELECT project_id FROM projects.project_settings
             WHERE working_days = ARRAY[1,2,3,4,5] AND COALESCE(array_length(extra_holidays,1),0) = 0
             ORDER BY project_id LIMIT 1), 'office') = 4
  UNION ALL
  SELECT 'office skips Youth Day: Mon 15 -> Wed 17 June 2026 is 1',
         projects.working_days_between(timestamptz '2026-06-15 08:00+02', timestamptz '2026-06-17 08:00+02',
           (SELECT project_id FROM projects.project_settings
             WHERE working_days = ARRAY[1,2,3,4,5] AND COALESCE(array_length(extra_holidays,1),0) = 0
             ORDER BY project_id LIMIT 1), 'office') = 1
  UNION ALL
  SELECT 'site adds Saturday: Mon 1 -> Mon 8 June 2026 is 6, office is 5',
         projects.working_days_between(timestamptz '2026-06-01 08:00+02', timestamptz '2026-06-08 08:00+02',
           (SELECT project_id FROM projects.project_settings
             WHERE working_days = ARRAY[1,2,3,4,5] AND COALESCE(array_length(extra_holidays,1),0) = 0
             ORDER BY project_id LIMIT 1), 'site') = 6
     AND projects.working_days_between(timestamptz '2026-06-01 08:00+02', timestamptz '2026-06-08 08:00+02',
           (SELECT project_id FROM projects.project_settings
             WHERE working_days = ARRAY[1,2,3,4,5] AND COALESCE(array_length(extra_holidays,1),0) = 0
             ORDER BY project_id LIMIT 1), 'office') = 5
  UNION ALL
  SELECT 'anon cannot SELECT projects.public_holidays',
         NOT has_table_privilege('anon','projects.public_holidays','SELECT')
  UNION ALL
  SELECT 'anon cannot SELECT projects.calendar_years',
         NOT has_table_privilege('anon','projects.calendar_years','SELECT')
  UNION ALL
  SELECT 'anon cannot EXECUTE working_days_between',
         NOT has_function_privilege('anon','projects.working_days_between(timestamptz,timestamptz,uuid,text)','EXECUTE')
  ```

  ⚠ **The unseeded-year case is deliberately NOT an arm here.** A `RAISE` inside a `UNION ALL` arm aborts the whole statement rather than printing a red line. It is exercised as its own probe in Step 8 and lives permanently in the smoke test (Task 16), where a `BEGIN … EXCEPTION` block catches it.

- [ ] **Step 7: Append section 5 to the migration.**

  Generate the seed rather than typing it:

  ```
  node --experimental-strip-types scripts/db/gen-public-holidays-seed.ts 2024 2035 > /tmp/holidays.sql
  wc -l /tmp/holidays.sql
  ```

  Then append to the migration:

  ```sql
  -- ---------------------------------------------------------------------------
  -- 5. The working-day calendar (Appendix A(h)) — one statutory source
  -- ---------------------------------------------------------------------------
  -- Created HERE, in the first substantive migration, because the spine's
  -- BEFORE INSERT trigger computes a NOT NULL due_date and raises without it
  -- (§12 §(c) hard dependency 4). public.sa_public_holidays is NOT created —
  -- it would duplicate a set the JBCC module already computes. No
  -- works_saturdays column is added — working_days already carries that fact.
  CREATE TABLE projects.public_holidays (
      d    date PRIMARY KEY,
      name text NOT NULL
  );

  CREATE TABLE projects.calendar_years (
      year      int PRIMARY KEY,
      seeded_at timestamptz NOT NULL DEFAULT now()
  );

  ALTER TABLE projects.public_holidays ENABLE ROW LEVEL SECURITY;
  ALTER TABLE projects.calendar_years  ENABLE ROW LEVEL SECURITY;
  CREATE POLICY public_holidays_read ON projects.public_holidays FOR SELECT TO authenticated USING (true);
  CREATE POLICY calendar_years_read  ON projects.calendar_years  FOR SELECT TO authenticated USING (true);
  REVOKE SELECT ON projects.public_holidays FROM anon;
  REVOKE SELECT ON projects.calendar_years  FROM anon;

  -- ⚠ SEED GENERATED — do not hand-edit. Regenerate with
  --   node --experimental-strip-types scripts/db/gen-public-holidays-seed.ts 2024 2035
  -- packages/shared/src/lib/calendar/public-holidays.contract.test.ts asserts
  -- these rows equal listHolidaysNamed() for every seeded year, so a hand edit
  -- fails the build naming the date.
  --
  -- The horizon is 2035, not 2031: working_days_between RAISES on an unseeded
  -- year with no fallback, so the last seeded year is the year after which every
  -- due-date computation in the product throws when a user saves an RFI.
  <<< paste the entire contents of /tmp/holidays.sql here — 160 VALUES rows >>>

  -- ---------------------------------------------------------------------------
  -- projects.working_days_between — STABLE, never IMMUTABLE, no default calendar
  -- ---------------------------------------------------------------------------
  -- It reads a table; marking it IMMUTABLE would let the planner fold a result
  -- across a calendar refresh. Both bounds are evaluated AT TIME ZONE
  -- 'Africa/Johannesburg'. An unseeded year raises no_data_found; there is NO
  -- fallback to calendar days.
  --
  -- ⚠ p_calendar has NO DEFAULT, deliberately. §15 fixes three calendars for
  -- three consumers — metric 4 is 'office', the chase ladder is 'site', JBCC is
  -- statutory-only — and the chase ladder is written by a different author in a
  -- later item. A silent 'office' default would compute a Saturday-working
  -- contractor's deadline on a Mon-Fri week, drifting one day in the direction
  -- that makes him look late. The same reasoning that forbids a calendar-day
  -- fallback forbids a calendar default.
  CREATE OR REPLACE FUNCTION projects.working_days_between(
      p_from     timestamptz,
      p_to       timestamptz,
      p_project  uuid,
      p_calendar text
  ) RETURNS int
  LANGUAGE plpgsql
  STABLE SECURITY DEFINER
  SET search_path TO 'projects', 'public'
  SET row_security TO 'off'
  AS $$
  DECLARE
      v_from  date := (p_from AT TIME ZONE 'Africa/Johannesburg')::date;
      v_to    date := (p_to   AT TIME ZONE 'Africa/Johannesburg')::date;
      v_days  int[];
      v_extra date[];
      v_count int := 0;
      v_cur   date;
      y       int;
  BEGIN
      IF p_calendar IS NULL OR p_calendar NOT IN ('office', 'site') THEN
          RAISE EXCEPTION 'working_days_between: unknown calendar %', COALESCE(p_calendar, '<null>');
      END IF;

      FOR y IN SELECT generate_series(extract(year from v_from)::int, extract(year from v_to)::int) LOOP
          IF NOT EXISTS (SELECT 1 FROM projects.calendar_years cy WHERE cy.year = y) THEN
              RAISE EXCEPTION 'working_days_between: % is not seeded in projects.calendar_years', y
                USING ERRCODE = 'no_data_found';
          END IF;
      END LOOP;

      SELECT ps.working_days, ps.extra_holidays INTO v_days, v_extra
        FROM projects.project_settings ps WHERE ps.project_id = p_project;
      v_days  := COALESCE(v_days, ARRAY[1,2,3,4,5]);
      v_extra := COALESCE(v_extra, ARRAY[]::date[]);

      -- site = office plus Saturday where Saturday is absent from working_days.
      IF p_calendar = 'site' AND NOT (6 = ANY(v_days)) THEN
          v_days := v_days || 6;
      END IF;

      IF v_to <= v_from THEN RETURN 0; END IF;

      v_cur := v_from;
      WHILE v_cur < v_to LOOP
          v_cur := v_cur + 1;
          IF extract(isodow from v_cur)::int = ANY(v_days)
             AND NOT EXISTS (SELECT 1 FROM projects.public_holidays ph WHERE ph.d = v_cur)
             AND NOT (v_cur = ANY(v_extra))
          THEN
              v_count := v_count + 1;
          END IF;
      END LOOP;

      RETURN v_count;
  END;
  $$;

  REVOKE ALL     ON FUNCTION projects.working_days_between(timestamptz,timestamptz,uuid,text) FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION projects.working_days_between(timestamptz,timestamptz,uuid,text) FROM anon;
  GRANT  EXECUTE ON FUNCTION projects.working_days_between(timestamptz,timestamptz,uuid,text) TO authenticated, service_role;
  ```

  **The December shutdown push is deliberately not in the SQL function.** A(h) makes it a property of the due-date rule, not of the count, and the shutdown window is a per-project setting that a later migration adds. The TypeScript mirror carries it because the create forms compute due dates client-side; the SQL function is used by metric 4, which counts elapsed working days and must not skip a window it never entered.

- [ ] **Step 8: Run the unseeded-year probe on its own, then the full dry run.**

  ```
  bash -c '. scripts/db/mgmt-api.sh; mgmt_query "
  BEGIN;
  $(cat apps/edge-functions/supabase/migrations/00186_q1_metrics_presence_calendar.sql)
  SELECT projects.working_days_between(timestamptz '"'"'2040-01-05 08:00+02'"'"', timestamptz '"'"'2040-01-12 08:00+02'"'"',
    (SELECT project_id FROM projects.project_settings ORDER BY project_id LIMIT 1), '"'"'office'"'"');
  ROLLBACK;"' ; echo "exit=$?"
  ```

  Expected: a Management-API error containing `2040 is not seeded in projects.calendar_years`, `exit=1`. **That failure is the feature.** Then the full dry run:

  ```
  scripts/db/dry-run-migration.sh \
    apps/edge-functions/supabase/migrations/00186_q1_metrics_presence_calendar.sql \
    scripts/db/assert-metrics-foundation-seeded.sql \
    scripts/db/assert-metrics-foundation-static.sql
  ```

  Expected: all green. Read the printed total.

- [ ] **Step 9: Run the calendar contract test, now green — and prove it can fail.**

  ```
  pnpm --filter @esite/shared test public-holidays.contract
  ```

  Expected: fifteen tests — the horizon guard, the five-years-ahead guard, twelve per-year set-equality checks, one `calendar_years` range check — all passing. Then prove it can fail: change one seeded name in the migration (e.g. `Freedom Day` → `Freedom day`) and confirm the affected year's test fails naming the date. Restore it.

- [ ] **Step 10: Export from the barrel and commit.**

  ⚠ Both modules export a symbol named `addWorkingDays`. `./lib/jbcc/working-days` is already re-exported at `packages/shared/src/index.ts:42`, so a bare `export *` collides. Export the calendar module **explicitly**:

  ```ts
  // The A(h) working-day calendar. NOT the JBCC statutory helper — see the
  // module header for why the two must not be merged.
  export {
    buildCalendar,
    sastDate,
    workingDaysBetween,
    addWorkingDays as addProjectWorkingDays,
    type CalendarInput,
    type ProjectCalendar,
  } from './lib/calendar/working-days'
  ```

  ```
  pnpm --filter @esite/shared type-check
  pnpm --filter @esite/shared test
  git add apps/edge-functions/supabase/migrations/00186_q1_metrics_presence_calendar.sql \
          scripts/db/assert-metrics-foundation-static.sql \
          packages/shared/src/lib/calendar/working-days.ts \
          packages/shared/src/lib/calendar/working-days.test.ts \
          packages/shared/src/index.ts
  git commit -m "feat(db): A(h) calendar — holidays to 2035, calendar_years, working_days_between with no default calendar"
  ```

---

## Task 12 — The rollup function and the `pg_cron` job

**Files:**
- Modify: `apps/edge-functions/supabase/migrations/00186_q1_metrics_presence_calendar.sql` (append section 6)
- Modify: `scripts/db/assert-metrics-foundation-static.sql`
- Modify: `scripts/db/assert-metrics-foundation-seeded.sql`

**Rule 1 of §15 §(b2): every job writes a run row on every tick, including a tick on which it did nothing.** For this job the snapshot **is** the ledger, so the function writes a row for **all eleven** metric keys every run, even the ones it cannot measure. "No row" must mean "did not run", never "ran and had nothing to do", because those two are the whole diagnostic. `cloud-sync-poll` was specified, merged and never scheduled, and all eleven of its runs to that point were manual — discovered only when users reported stale floor plans two months later.

⚠⚠ **The single most dangerous line in this file is a hard-coded `'measured'` on a ratio arm.** `platform_metrics_weekly_measured_has_value` is `CHECK (status <> 'measured' OR value IS NOT NULL)`. A ratio arm computing `ROUND(x::numeric / NULLIF(y,0), 4)` yields **NULL** when `y = 0`, and `'measured'` + NULL violates that CHECK. Because all eleven arms are one `INSERT … SELECT … UNION ALL`, the violation aborts the **entire statement** and the job writes **zero rows** — which the operator then reads as "the job did not run" and goes hunting in `cron.job_run_details` for a scheduler fault that does not exist. This is not hypothetical: `projects.site_diary_entries` holds **53 rows all-time and only 10 of the last 27 weeks contain any entry at all** (measured 2026-09-10; the week of 2026-07-06 contains **zero**), so roughly 63% of Monday ticks would abort. **Every ratio arm declares its own status with a `CASE` on its denominator.**

**`_active` counts writes to the source tables, not only the five office files that call `trackServer`.** Without this, `_active` can only see a user through `user_sessions` (no writer until item 4, wk 6.0) or `product_events` (ten call sites in rfi / snag / project / supplier / onboarding — all office actions; the mirrors for diary, QC, forms and inspections are item 3, wk 4.17–6.67). A contractor foreman who logs a diary entry, raises a snag and answers a form every day would count as **inactive** for the first two-thirds of the quarter, metric 2a would read 0/12 by construction and then jump, and the partner reading it in week 4 would conclude the thesis has failed. Measured over the equivalent trailing four weeks (2026-08-06 → 2026-09-03): **5 distinct writers, all inside `metric_accounts`, 3 of them contractors** — a baseline of 5/23 and 3/12 rather than 0/23 and 0/12. It is also the only arm measurable **retrospectively**, which is what a frozen baseline requires.

**Only some of the eleven are measurable in Q1 item 1, and the function says so rather than inventing numbers.** `status` carries `measured`, `censored`, `unmeasurable` or `not_yet_instrumented`; a `method_version` bump — never an UPDATE — is how a definition changes when items 2, 4 and 8 land their sources.

⚠ **Divergence from §15 §(a), recorded.** §15 specifies the job "following the inline-key `net.http_post` pattern the repo already uses (`00148:136-142`)". This schedules the function **directly**. There is no edge function to call, and the direct form removes the entire class of failure that broke `cloud-sync-poll` on its first tick — the edge runtime injects `SUPABASE_SERVICE_ROLE_KEY` as `sb_secret_…`, not a JWT, so a function-to-function call failed the JWT-role gate 4/4.

- [ ] **Step 1: Append the failing assertions, including the ZERO-denominator window.**

  To `scripts/db/assert-metrics-foundation-seeded.sql`, add both exercising calls above the final chain:

  ```sql
  -- Two real windows, both computed inside the rolled-back transaction.
  --
  -- (1) 2026-08-31 is a Monday (ISO week 36 of 2026) and the window is complete.
  --     It contains 2 diary rows (measured), so every ratio arm has a denominator.
  SELECT public.compute_platform_metrics_weekly(DATE '2026-08-31', DATE '2026-09-07', false);
  --
  -- (2) 2026-07-06 is a Monday (ISO week 28 of 2026) containing ZERO diary rows
  --     (measured: only 10 of the last 27 weeks contain any). This is the window
  --     that proves a zero denominator does not abort the whole INSERT. Without
  --     it the loop never exercises the path that breaks ~63% of Monday ticks.
  SELECT public.compute_platform_metrics_weekly(DATE '2026-07-06', DATE '2026-07-13', false);
  ```

  and these arms inside the final chain:

  ```sql
  UNION ALL
  SELECT 'the rollup writes a row for ALL eleven metric keys, measurable or not',
         (SELECT count(DISTINCT metric_key) FROM public.platform_metrics_weekly) = 11
  UNION ALL
  SELECT 'a ZERO-denominator week still writes all eleven rows and does not abort',
         (SELECT count(*) FROM public.platform_metrics_weekly
           WHERE iso_week = 28 AND iso_year = 2026 AND NOT is_baseline) = 11
  UNION ALL
  SELECT 'a zero-denominator ratio is unmeasurable with a NULL value, never measured-and-null',
         (SELECT status = 'unmeasurable' AND value IS NULL
            FROM public.platform_metrics_weekly
           WHERE metric_key = 'diary_same_day' AND iso_week = 28 AND iso_year = 2026)
  UNION ALL
  SELECT 'the same metric IS measured in a week that has diary rows',
         (SELECT status = 'measured' AND value IS NOT NULL
            FROM public.platform_metrics_weekly
           WHERE metric_key = 'diary_same_day' AND iso_week = 36 AND iso_year = 2026)
  UNION ALL
  SELECT 'weekly_active is measured against the FROZEN cohort at its as_of date',
         (SELECT denominator = (SELECT count(*) FROM public.metric_cohorts
                                 WHERE cohort_key = 'weekly_active_denominator' AND as_of = DATE '2026-09-09')
            FROM public.platform_metrics_weekly
           WHERE metric_key = 'weekly_active' AND iso_week = 36)
  UNION ALL
  SELECT '_active sees a source-table writer, not only a trackServer call site',
         (SELECT numerator > 0 FROM public.platform_metrics_weekly
           WHERE metric_key = 'weekly_active' AND iso_week = 36)
  UNION ALL
  SELECT 'client_active is instrumented against the frozen client cohort of 4',
         (SELECT denominator = 4 FROM public.platform_metrics_weekly
           WHERE metric_key = 'client_active' AND iso_week = 36)
  UNION ALL
  SELECT 'inbox_engagement is honestly unmeasurable and carries the email-delivery gap',
         (SELECT status = 'unmeasurable' AND value IS NULL AND detail ? 'emails_sent_all_time'
            FROM public.platform_metrics_weekly WHERE metric_key = 'inbox_engagement' AND iso_week = 36)
  UNION ALL
  SELECT 'report_schedules_per_project is not_yet_instrumented (table lands Q3)',
         (SELECT status = 'not_yet_instrumented'
            FROM public.platform_metrics_weekly WHERE metric_key = 'report_schedules_per_project' AND iso_week = 36)
  UNION ALL
  SELECT 'rfi_response_median_wd is censored and carries the answered share',
         (SELECT status = 'censored' AND detail ? 'answered_ever'
            FROM public.platform_metrics_weekly WHERE metric_key = 'rfi_response_median_wd' AND iso_week = 36)
  UNION ALL
  SELECT 'notifications_created is a RATIO with a first-party-write denominator',
         (SELECT denominator IS NOT NULL AND detail ? 'per_week'
            FROM public.platform_metrics_weekly WHERE metric_key = 'notifications_created' AND iso_week = 36)
  UNION ALL
  SELECT 'paying_organisations is measured and reads zero by design',
         (SELECT status = 'measured' AND value = 0
            FROM public.platform_metrics_weekly WHERE metric_key = 'paying_organisations' AND iso_week = 36)
  ```

  To `scripts/db/assert-metrics-foundation-static.sql`:

  ```sql
  UNION ALL
  SELECT 'the cron job is scheduled AND active',
         EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'platform-metrics-weekly' AND active)
  UNION ALL
  SELECT 'anon cannot EXECUTE the rollup',
         NOT has_function_privilege('anon','public.compute_platform_metrics_weekly(date,date,boolean)','EXECUTE')
  UNION ALL
  SELECT 'authenticated cannot EXECUTE the rollup either',
         NOT has_function_privilege('authenticated','public.compute_platform_metrics_weekly(date,date,boolean)','EXECUTE')
  ```

- [ ] **Step 2: Run the dry run and watch it fail.**

  Expected: the run aborts on `function public.compute_platform_metrics_weekly(date, date, boolean) does not exist`.

- [ ] **Step 3: Append section 6 to the migration.**

  ```sql
  -- ---------------------------------------------------------------------------
  -- 6. The weekly rollup and its schedule
  -- ---------------------------------------------------------------------------
  -- §15 §(b2) rule 1: a row per metric on EVERY tick, including a tick that
  -- measured nothing. The snapshot IS this job's run ledger, so "no row" must
  -- mean "did not run". cloud-sync-poll was merged and never scheduled, and the
  -- only reason anyone found out was users reporting stale floor plans.
  --
  -- p_is_baseline writes the single frozen row per metric (§13 item 1's "four
  -- weeks to 30 September"). value is always a WEEKLY RATE or a ratio, never a
  -- cumulative all-time figure, because a weekly rate is the only thing a weekly
  -- target can be measured against.
  CREATE OR REPLACE FUNCTION public.compute_platform_metrics_weekly(
      p_window_start date,
      p_window_end   date,               -- exclusive
      p_is_baseline  boolean DEFAULT false
  ) RETURNS int
  LANGUAGE plpgsql
  VOLATILE SECURITY DEFINER
  SET search_path TO 'public', 'projects', 'billing', 'field', 'inspections'
  SET row_security TO 'off'
  AS $$
  DECLARE
      v_weeks      numeric := GREATEST(1, (p_window_end - p_window_start) / 7.0);
      v_year       int     := extract(isoyear from p_window_start)::int;
      v_week       int     := CASE WHEN p_is_baseline THEN NULL ELSE extract(week from p_window_start)::int END;
      v_as_of      date    := DATE '2026-09-09';   -- the ONE frozen cohort date
      v_cohort     int;
      v_contract   int;
      v_client     int;
      v_all_contr  int;
      v_writes     int;
      v_diary      int;
      v_written    int := 0;
  BEGIN
      IF p_is_baseline AND p_window_end > CURRENT_DATE THEN
          RAISE EXCEPTION 'refusing to freeze a baseline over an incomplete window (ends %, today is %)',
                          p_window_end, CURRENT_DATE;
      END IF;

      -- ⚠ as_of is filtered, not omitted. The PK is (cohort_key, user_id, as_of),
      -- so a second as_of is LEGAL and the table's name invites one. Without this
      -- filter, the day anyone re-freezes, both denominators roughly double and
      -- every ratio on /metrics halves, silently, with no error anywhere. A
      -- frozen cohort that can silently unfreeze is not frozen.
      SELECT count(*) INTO v_cohort   FROM public.metric_cohorts WHERE cohort_key = 'weekly_active_denominator' AND as_of = v_as_of;
      SELECT count(*) INTO v_contract FROM public.metric_cohorts WHERE cohort_key = 'contractor_frozen'          AND as_of = v_as_of;
      SELECT count(*) INTO v_client   FROM public.metric_cohorts WHERE cohort_key = 'client_viewer_frozen'       AND as_of = v_as_of;

      -- ---------------------------------------------------------------------
      -- FIRST-PARTY WRITES in the window, from the author columns that already
      -- exist and already carry history. This is what makes metric 1 measure
      -- BEHAVIOUR rather than the office lane's instrumentation schedule:
      -- product_events covers ten trackServer call sites in five office files,
      -- user_sessions has no writer until item 4, and the source mirrors for
      -- diary/QC/forms/inspections are item 3. A foreman who writes a diary
      -- entry every day would otherwise read as inactive for two-thirds of Q1.
      --
      -- It is also the only arm measurable RETROSPECTIVELY, which is exactly
      -- what a frozen baseline over a window in the past requires.
      -- ---------------------------------------------------------------------
      DROP TABLE IF EXISTS _writes;
      CREATE TEMP TABLE _writes ON COMMIT DROP AS
      SELECT d.created_by AS user_id FROM projects.site_diary_entries d
       WHERE d.created_at >= p_window_start AND d.created_at < p_window_end
      UNION ALL
      SELECT s.raised_by FROM field.snags s
       WHERE s.created_at >= p_window_start AND s.created_at < p_window_end
      UNION ALL
      SELECT q.created_by FROM projects.qc_entries q
       WHERE q.created_at >= p_window_start AND q.created_at < p_window_end
      UNION ALL
      SELECT r.raised_by FROM projects.rfis r
       WHERE r.created_at >= p_window_start AND r.created_at < p_window_end
      UNION ALL
      SELECT rr.responded_by FROM projects.rfi_responses rr
       WHERE rr.created_at >= p_window_start AND rr.created_at < p_window_end
      UNION ALL
      SELECT i.created_by FROM inspections.inspections i
       WHERE i.created_at >= p_window_start AND i.created_at < p_window_end
      UNION ALL
      SELECT f.latest_responded_by FROM field.form_responses f
       WHERE f.latest_responded_at >= p_window_start AND f.latest_responded_at < p_window_end
      UNION ALL
      SELECT rp.generated_by FROM projects.reports rp
       WHERE rp.created_at >= p_window_start AND rp.created_at < p_window_end;

      SELECT count(*) INTO v_writes FROM _writes WHERE user_id IS NOT NULL;

      -- Active = a session row touched in the window, OR a first-party event in
      -- it, OR a write to any source table in it.
      DROP TABLE IF EXISTS _active;
      CREATE TEMP TABLE _active ON COMMIT DROP AS
      SELECT DISTINCT ma.user_id
        FROM public.metric_accounts ma
       WHERE EXISTS (SELECT 1 FROM public.user_sessions s
                      WHERE s.user_id = ma.user_id
                        AND s.last_seen_at >= p_window_start AND s.last_seen_at < p_window_end)
          OR EXISTS (SELECT 1 FROM public.product_events pe
                      WHERE pe.actor_id = ma.user_id
                        AND pe.occurred_at >= p_window_start AND pe.occurred_at < p_window_end)
          OR EXISTS (SELECT 1 FROM _writes w WHERE w.user_id = ma.user_id);

      -- Metric 2b's denominator, by EFFECTIVE PROJECT ROLE (§15 §(a): "every
      -- account whose effective role on any ACTIVE project is contractor"), never
      -- user_organisations.role. Those are different facts: a contractor invited
      -- onto one project with no org row is invisible to the org-role query, and
      -- an org contractor promoted to PM on every live project still counts.
      SELECT count(DISTINCT pm.user_id) INTO v_all_contr
        FROM projects.project_members pm
        JOIN projects.projects pr ON pr.id = pm.project_id
        JOIN public.metric_accounts ma ON ma.user_id = pm.user_id
       WHERE pr.updated_at > now() - interval '90 days'
         AND public.user_effective_project_role(pm.project_id, pm.user_id) = 'contractor';

      SELECT count(*) INTO v_diary FROM projects.site_diary_entries d
       WHERE d.created_at >= p_window_start AND d.created_at < p_window_end;

      INSERT INTO public.platform_metrics_weekly
        (metric_key, iso_year, iso_week, window_start, window_end, numerator, denominator, value, status, is_baseline, note, detail)

      -- 1 — weekly active, against the FROZEN cohort.
      -- ⚠ status is a CASE, never the literal 'measured'. A zero denominator
      -- gives a NULL value, and 'measured' + NULL violates
      -- platform_metrics_weekly_measured_has_value, which aborts this ENTIRE
      -- INSERT and writes zero rows — read downstream as "the job did not run".
      SELECT 'weekly_active', v_year, v_week, p_window_start, p_window_end,
             (SELECT count(*) FROM _active), v_cohort,
             CASE WHEN v_cohort > 0 THEN ROUND((SELECT count(*) FROM _active)::numeric / v_cohort, 4) END,
             CASE WHEN v_cohort > 0 THEN 'measured' ELSE 'unmeasurable' END, p_is_baseline,
             'Denominator is the frozen September-2026 cohort (as_of 2026-09-09), never a running count. Active = a session, a first-party event, OR a write to any source table.',
             jsonb_build_object('accounts_total', (SELECT count(*) FROM public.metric_accounts),
                                'first_party_writes', v_writes)

      -- 2a — contractor, frozen cohort
      UNION ALL SELECT 'contractor_active_frozen', v_year, v_week, p_window_start, p_window_end,
             (SELECT count(*) FROM _active a JOIN public.metric_cohorts c
                ON c.user_id = a.user_id AND c.cohort_key = 'contractor_frozen' AND c.as_of = v_as_of),
             v_contract,
             CASE WHEN v_contract > 0 THEN
               ROUND((SELECT count(*) FROM _active a JOIN public.metric_cohorts c
                        ON c.user_id = a.user_id AND c.cohort_key = 'contractor_frozen' AND c.as_of = v_as_of)::numeric
                     / v_contract, 4) END,
             CASE WHEN v_contract > 0 THEN 'measured' ELSE 'unmeasurable' END, p_is_baseline,
             'Frozen at 12: 13 accounts hold a contractor role, one is the rbac-test fixture that metric_accounts excludes. Q1 target restated as 6 of 12 (50%).',
             '{}'::jsonb

      -- 2b — contractor, all, by EFFECTIVE PROJECT ROLE on an active project
      UNION ALL SELECT 'contractor_active_all', v_year, v_week, p_window_start, p_window_end,
             (SELECT count(DISTINCT a.user_id) FROM _active a
               WHERE EXISTS (SELECT 1 FROM projects.project_members pm
                               JOIN projects.projects pr ON pr.id = pm.project_id
                              WHERE pm.user_id = a.user_id
                                AND pr.updated_at > now() - interval '90 days'
                                AND public.user_effective_project_role(pm.project_id, pm.user_id) = 'contractor')),
             v_all_contr,
             CASE WHEN v_all_contr > 0 THEN
               ROUND((SELECT count(DISTINCT a.user_id) FROM _active a
                       WHERE EXISTS (SELECT 1 FROM projects.project_members pm
                                       JOIN projects.projects pr ON pr.id = pm.project_id
                                      WHERE pm.user_id = a.user_id
                                        AND pr.updated_at > now() - interval '90 days'
                                        AND public.user_effective_project_role(pm.project_id, pm.user_id) = 'contractor'))::numeric
                     / v_all_contr, 4) END,
             CASE WHEN v_all_contr > 0 THEN 'measured' ELSE 'unmeasurable' END, p_is_baseline,
             'Effective role on an active project, per §15 §(a) — never user_organisations.role, which is a different fact.',
             '{}'::jsonb

      -- 2c — client viewers, frozen cohort. There is no client metric in §15's
      -- eight, and §15 §(c) puts client viewers in Wave 3 (Q3). Instrumenting it
      -- now means Q3's portal is judged against a baseline that exists, instead
      -- of one first computed the quarter it ships.
      UNION ALL SELECT 'client_active', v_year, v_week, p_window_start, p_window_end,
             (SELECT count(*) FROM _active a JOIN public.metric_cohorts c
                ON c.user_id = a.user_id AND c.cohort_key = 'client_viewer_frozen' AND c.as_of = v_as_of),
             v_client,
             CASE WHEN v_client > 0 THEN
               ROUND((SELECT count(*) FROM _active a JOIN public.metric_cohorts c
                        ON c.user_id = a.user_id AND c.cohort_key = 'client_viewer_frozen' AND c.as_of = v_as_of)::numeric
                     / v_client, 4) END,
             CASE WHEN v_client > 0 THEN 'measured' ELSE 'unmeasurable' END, p_is_baseline,
             'No client wave runs before Q3 (§15 §(c)), so a low figure here is a fact about the programme sequence, not about clients. Frozen cohort of 4.',
             '{}'::jsonb

      -- 3 — diary same day. SAST is UTC+2 with no DST, so the UTC date runs
      -- BEHIND the local date; the misclassification window is 00:00-02:00 SAST.
      -- ⚠ THE arm that proved the CHECK violation: 53 diary rows exist all-time
      -- and only 10 of the last 27 weeks contain any, so ~63% of Monday ticks
      -- have a zero denominator here.
      UNION ALL SELECT 'diary_same_day', v_year, v_week, p_window_start, p_window_end,
             (SELECT count(*) FROM projects.site_diary_entries d
               WHERE d.created_at >= p_window_start AND d.created_at < p_window_end
                 AND d.entry_date = (d.created_at AT TIME ZONE 'Africa/Johannesburg')::date),
             v_diary,
             CASE WHEN v_diary > 0 THEN
               (SELECT ROUND(count(*) FILTER (WHERE d.entry_date = (d.created_at AT TIME ZONE 'Africa/Johannesburg')::date)::numeric
                             / count(*), 4)
                  FROM projects.site_diary_entries d
                 WHERE d.created_at >= p_window_start AND d.created_at < p_window_end) END,
             CASE WHEN v_diary > 0 THEN 'measured' ELSE 'unmeasurable' END, p_is_baseline,
             CASE WHEN v_diary > 0 THEN NULL ELSE 'No diary entries in this window, so there is no same-day share to compute. A zero here would be an invented number.' END,
             '{}'::jsonb

      -- 4 — RFI response median. CENSORED until work_item_events exists: the
      -- pre-release median over items RAISED is not retrospectively recoverable.
      UNION ALL SELECT 'rfi_response_median_wd', v_year, v_week, p_window_start, p_window_end,
             NULL, NULL, NULL, 'censored', p_is_baseline,
             'No work_item_events before Q1 item 2. Published as the answered-ever share plus the unanswered count.',
             jsonb_build_object(
               'rfis_total',    (SELECT count(*) FROM projects.rfis),
               'answered_ever', (SELECT count(DISTINCT rr.rfi_id) FROM projects.rfi_responses rr),
               'response_rows', (SELECT count(*) FROM projects.rfi_responses))

      -- 5 — inbox engagement. UNMEASURABLE: read_at has existed since
      -- 00001_initial_schema.sql:151 and NOTHING has ever written it — the only
      -- writers set is_read alone (components/ui/NotificationCentre.tsx:52-55,
      -- :62). public.inbox_state does not exist until Q1 item 8.
      --
      -- detail also carries the EMAIL-DELIVERY gap, because the entire Q1 outcome
      -- is delivered over email and nobody has ever measured whether one was
      -- opened. Measured: 246 sends to all 36 accounts, opened_at NULL on all
      -- 246, clicked_at NULL on all 246, resend_message_id populated on 235 —
      -- 00030_email_sequences.sql:24-25 marks both columns "populated by Resend
      -- webhook (Phase 2)" and Phase 2 never shipped. Publishing it here makes
      -- the gap visible in week one instead of buried in a markdown file.
      UNION ALL SELECT 'inbox_engagement', v_year, v_week, p_window_start, p_window_end,
             NULL, NULL, NULL, 'unmeasurable', p_is_baseline,
             'read_at has never been written; inbox_state does not exist yet; and no Resend webhook has ever written an email open. Re-based at method_version 2 when items 4 and 8 land.',
             jsonb_build_object(
               'is_read_true_all_time',  (SELECT count(*) FROM public.notifications WHERE is_read),
               'created_all_time',       (SELECT count(*) FROM public.notifications),
               'emails_sent_all_time',   (SELECT count(*) FROM public.email_sequence_events),
               'emails_with_open_evidence', (SELECT count(opened_at) FROM public.email_sequence_events),
               'emails_accepted_by_resend', (SELECT count(resend_message_id) FROM public.email_sequence_events))

      -- 5b — notification VOLUME, as a RATIO. The Q1 exit criterion is "down
      -- >= 60% on the Sept-2026 baseline"; 750 of the 964 production
      -- notifications are diary_created, so a bare count falls whenever diary
      -- volume falls — a contractor leaves, a project completes — and the target
      -- is met while the notification engine has changed nothing. A metric where
      -- success and abandonment are the same number is not a metric.
      UNION ALL SELECT 'notifications_created', v_year, v_week, p_window_start, p_window_end,
             (SELECT count(*) FROM public.notifications n
               WHERE n.created_at >= p_window_start AND n.created_at < p_window_end),
             v_writes,
             CASE WHEN v_writes > 0 THEN
               ROUND((SELECT count(*) FROM public.notifications n
                       WHERE n.created_at >= p_window_start AND n.created_at < p_window_end)::numeric
                     / v_writes, 4) END,
             CASE WHEN v_writes > 0 THEN 'measured' ELSE 'unmeasurable' END, p_is_baseline,
             'Notifications per first-party write, so a quiet quarter cannot be mistaken for a fixed engine. The raw weekly rate is in detail.per_week.',
             jsonb_build_object('per_week',
               ROUND((SELECT count(*) FROM public.notifications n
                       WHERE n.created_at >= p_window_start AND n.created_at < p_window_end)::numeric / v_weeks, 2))

      -- 6 — report schedules. projects.report_schedules does not exist until Q3,
      -- so a non-zero target here would be unattainable by construction.
      UNION ALL SELECT 'report_schedules_per_project', v_year, v_week, p_window_start, p_window_end,
             0, (SELECT count(*) FROM projects.projects WHERE updated_at > now() - interval '90 days'),
             0, 'not_yet_instrumented', p_is_baseline,
             'projects.report_schedules lands in Q3. Zero by construction, instrumented now so the arrival is visible.',
             '{}'::jsonb

      -- 7 — activation. Needs user_sessions x work_item_events; the latter
      -- arrives with the spine.
      UNION ALL SELECT 'activation_first_session', v_year, v_week, p_window_start, p_window_end,
             NULL, NULL, NULL, 'not_yet_instrumented', p_is_baseline,
             'projects.work_item_events lands with Q1 item 2. Session boundary is user_sessions, never auth_events.',
             '{}'::jsonb

      -- 8 — the commercial metric. Instrumented now, zero by design until Q3.
      -- ⚠ The live CHECK on billing.subscriptions.tier is
      -- ('free','starter','professional','enterprise') — MEASURED, not assumed.
      -- §11.7's practice_solo / practice / practice_unlimited bands do not exist
      -- until the Q4 pricing cutover widens that CHECK (A(f), Q4). Writing them
      -- here would silently match nothing forever, so the predicate is
      -- "paid band" = anything but free, which survives the cutover unchanged.
      -- WM-Consulting's own row is excluded per §11.7.
      UNION ALL SELECT 'paying_organisations', v_year, v_week, p_window_start, p_window_end,
             (SELECT count(*) FROM billing.subscriptions s
               WHERE s.tier <> 'free'
                 AND s.paystack_subscription_code IS NOT NULL
                 AND s.organisation_id <> 'dddddddd-0000-0000-0000-000000000001'::uuid),
             NULL,
             (SELECT count(*) FROM billing.subscriptions s
               WHERE s.tier <> 'free'
                 AND s.paystack_subscription_code IS NOT NULL
                 AND s.organisation_id <> 'dddddddd-0000-0000-0000-000000000001'::uuid),
             'measured', p_is_baseline,
             'Zero by design until Q3. Publishing a commercial metric that reads zero for two quarters is the point.',
             '{}'::jsonb
      ;

      GET DIAGNOSTICS v_written = ROW_COUNT;
      RETURN v_written;
  END;
  $$;

  REVOKE ALL     ON FUNCTION public.compute_platform_metrics_weekly(date,date,boolean) FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION public.compute_platform_metrics_weekly(date,date,boolean) FROM anon;
  REVOKE EXECUTE ON FUNCTION public.compute_platform_metrics_weekly(date,date,boolean) FROM authenticated;
  GRANT  EXECUTE ON FUNCTION public.compute_platform_metrics_weekly(date,date,boolean) TO service_role;

  -- ---------------------------------------------------------------------------
  -- The schedule. NOT left as a commented-out block: that is exactly how
  -- cloud-sync-poll came to be specified, merged and never scheduled (00148:130-147).
  -- 04:00 UTC Monday = 06:00 SAST, no DST. date_trunc('week') is Monday-based.
  --
  -- ⚠ Divergence from §15 §(a), deliberate: §15 says to follow the inline-key
  -- net.http_post pattern (00148:136-142). There is no edge function to call
  -- here, and calling the function directly removes the whole class of failure
  -- that broke cloud-sync-poll 4/4 on its first tick — the edge runtime injects
  -- SUPABASE_SERVICE_ROLE_KEY as sb_secret_…, not a JWT, so a function-to-
  -- function call fails the JWT-role gate.
  -- ---------------------------------------------------------------------------
  DO $$
  BEGIN
      PERFORM cron.unschedule('platform-metrics-weekly');
  EXCEPTION WHEN OTHERS THEN
      NULL;   -- not previously scheduled
  END $$;

  SELECT cron.schedule(
      'platform-metrics-weekly',
      '0 4 * * 1',
      $cron$
      SELECT public.compute_platform_metrics_weekly(
               (date_trunc('week', now() AT TIME ZONE 'UTC') - interval '7 days')::date,
                date_trunc('week', now() AT TIME ZONE 'UTC')::date,
               false)
      $cron$
  );

  NOTIFY pgrst, 'reload schema';
  ```

  ⚠ **The band vocabulary was measured, not remembered.** `billing.subscriptions` carries `tier`, `status`, `paystack_subscription_code` and `organisation_id`, and its live CHECK is `tier = ANY (ARRAY['free','starter','professional','enterprise'])` — read back from `pg_constraint` on 2026-09-10. §11.7's `practice_solo` / `practice` / `practice_unlimited` bands **do not exist yet**. A metric written against them would match nothing for four quarters and read as a genuine zero. Production holds 2 subscription rows and neither carries a `paystack_subscription_code`, so the honest answer is 0 either way; the predicate above says *why* it is 0.

- [ ] **Step 4: Run the dry run and watch every assertion pass.**

  ```
  scripts/db/dry-run-migration.sh \
    apps/edge-functions/supabase/migrations/00186_q1_metrics_presence_calendar.sql \
    scripts/db/assert-metrics-foundation-seeded.sql \
    scripts/db/assert-metrics-foundation-static.sql
  ```

  Expected: all green. Read the printed total and record it in the PR body.

- [ ] **Step 5: Prove the zero-denominator CHECK violation is real — by reintroducing it.**

  This is the most important mutation in the plan. Change the `diary_same_day` arm's status from the `CASE` back to the literal `'measured'` and re-run the dry run. Expected: the **entire run aborts**:

  ```
  Supabase API error: … new row for relation "platform_metrics_weekly" violates
  check constraint "platform_metrics_weekly_measured_has_value"
  ```

  and **`the rollup writes a row for ALL eleven metric keys` never even prints**, because the INSERT that would have written them never completed. That is exactly what would have happened on ~63% of real Mondays: zero rows, no error anywhere the operator looks, and a snapshot table that says "the job did not run". **Restore the `CASE` and re-run to green.**

- [ ] **Step 6: Prove the baseline guard refuses an incomplete window — today.**

  ```
  bash -c '. scripts/db/mgmt-api.sh; mgmt_query "
  BEGIN;
  $(cat apps/edge-functions/supabase/migrations/00186_q1_metrics_presence_calendar.sql)
  SELECT public.compute_platform_metrics_weekly(DATE '"'"'2026-09-03'"'"', DATE '"'"'2026-10-01'"'"', true);
  ROLLBACK;"' ; echo "exit=$?"
  ```

  Expected while today is before 1 October 2026: an error reading `refusing to freeze a baseline over an incomplete window (ends 2026-10-01, today is …)`, `exit=1`. **A baseline computed over a window that has not finished is a lie, and this is the line that stops one being published.** Task 17 runs the same call on or after 1 October and expects it to succeed.

- [ ] **Step 7: Prove the "row on every tick" rule can fail.**

  Delete the `report_schedules_per_project` arm from the function, re-run the dry run, and confirm `the rollup writes a row for ALL eleven metric keys` goes red with `10`. **Restore the arm.** Without this proof the assertion is a count nobody has seen move.

- [ ] **Step 8: Prove the source-table union is doing work.**

  Delete the `_writes` `EXISTS` clause from `_active` (leaving only sessions and events), re-run the dry run, and confirm `_active sees a source-table writer, not only a trackServer call site` goes red — `numerator` falls to 0 for a real historical week in which five people demonstrably wrote to the product. **Restore it.** That zero is the baseline the plan would otherwise have published.

- [ ] **Step 9: Commit.**

  ```
  git add apps/edge-functions/supabase/migrations/00186_q1_metrics_presence_calendar.sql \
          scripts/db/assert-metrics-foundation-static.sql scripts/db/assert-metrics-foundation-seeded.sql
  git commit -m "feat(db): weekly rollup — eleven keys per tick, per-arm status, source-table activity, pg_cron"
  ```

---

## Task 13 — The event writer, the presence call site, and the mechanism that stops call sites forgetting

**Files:**
- Create: `apps/web/src/lib/analytics/product-events.ts`
- Create: `apps/web/src/lib/analytics/product-events.test.ts`
- Create: `apps/web/src/lib/analytics/product-events.contract.test.ts`
- Create: `apps/web/src/lib/presence.ts`
- Modify: `apps/web/src/app/(admin)/layout.tsx` (the `Promise.all` at `:44-51`)
- Modify: `apps/web/src/actions/rfi.actions.ts` (`:72`, `:155`, `:212`)
- Modify: `apps/web/src/actions/snag.actions.ts` (`:99`, `:175`)
- Modify: `apps/web/src/actions/project.actions.ts` (`:147`, `:234`)
- Modify: `apps/web/src/actions/supplier.actions.ts` (`:446`)
- Modify: `apps/web/src/actions/onboarding.actions.ts` (`:86`, `:132`)

**How server actions emit without every call site remembering to.** Not a framework, not a wrapper, not a proxy — a **contract test**. Every file under `apps/web/src/actions` that calls `trackServer(` must also call `emitProductEvent(`, and the test fails naming the file. `trackServer` already marks exactly the moments the codebase considers worth recording; the rule makes the new store inherit that judgement instead of asking ten authors to remember a second call. **Ten call sites across five files today** — `rfi`, `snag`, `project`, `supplier`, `onboarding` (measured with `grep -rn "trackServer(" apps/web/src/actions/`).

**Why not just keep `trackServer`.** `getPostHogNode()` returns null the moment `NEXT_PUBLIC_POSTHOG_KEY` is unset (`apps/web/src/lib/analytics.ts:63-66`) and `trackServer` then returns without doing anything (`:86`) — **a missing environment variable and a quiet quarter produce byte-identical output**, so no absence of data there can ever be interpreted. The sharpest illustration is `rfi.actions.ts:69`, which computes an `assigneeSource` diagnostic specifically to reveal how many RFIs land unassigned: we cannot say what it recorded, because we cannot say whether it recorded. §15 requires that one diagnostic be re-emitted into `product_events`, and Step 6 does it.

**Presence gets one real call site here, not in item 4.** The `(admin)` layout is already an authenticated server component that awaits a four-entry `Promise.all` (`:44-51`); adding a fifth entry costs no additional wall-clock time and gives `user_presence` / `user_sessions` a writer from week one. Without it the frozen October baseline is events-only and every later week is sessions+events — the number rises when item 4's heartbeat lands and it looks like the programme worked. The 60-second heartbeat and the `es_seen` middleware fallback stay in item 4. **Known gap, stated:** `client_viewer` is redirected to `/portal` at `:26` before this line runs, so client sessions are not recorded until the portal gets its own call — which is why `client_active` carries the note it does.

**What is deliberately NOT logged, and why:**

| Not logged | Reason |
|---|---|
| Page views, route changes, reads of any kind | `product_events` is a record of *first-party writes*. Metric 1 asks who worked, not who looked. Sentry and PostHog keep exploration. |
| Anything from the client | The RPC is `service_role`-only. A browser-emitted event is a forgeable event, and forged attribution is what made `00179`'s history record a forgery as fact. |
| Anything from `apps/mobile` | The app was never published and holds zero push tokens in production. `SNAG_LOGGED` and `DIARY_ENTRY_CREATED` fire only from `apps/mobile/app/snags/create.tsx:76` and `apps/mobile/app/diary/[projectId].tsx:76` — a catalogue of events nothing on the live surface emits. |
| Notification opens, reads, clears | Those live on `public.notifications` as server-stamped columns (§05). Metric 5 reads them there; a second copy would be a second answer. |
| Free text, names, email addresses, photo URLs in `properties` | POPIA. `properties` carries ids, enum values and counts. |
| A `read_at`-style column nothing writes | The whole reason metric 5 has no baseline. Every column added here has a writer in this same change. |

⚠ **`snag_resolved` is emitted per state TRANSITION, not per snag.** `snag.actions.ts:175` fires for `resolved` **or** `signed_off`, and `:99` fires again on sign-off, so a snag moving resolved → signed_off writes two or three rows for one defect. This mirrors `trackServer`'s existing behaviour exactly, which is the rule the contract test enforces, and no headline metric reads `snag_resolved` — so nothing is wrong today. But `product_events` is described as one row per first-party action, and a later author counting distinct snags resolved off this stream will over-count. **Any such count must be `count(DISTINCT properties->>'snag_id')`.** `new_status` is in the properties so the transitions can be told apart.

- [ ] **Step 1: Write the failing unit test.**

  Create `apps/web/src/lib/analytics/product-events.test.ts`:

  ```tsx
  import { describe, it, expect, vi, beforeEach } from 'vitest'

  // ⚠ `server-only` THROWS on import outside the react-server condition, which is
  // exactly the condition vitest runs in. This repo already knows it —
  // actions/cloud-storage.actions.test.ts:51-52 mocks two services partly to keep
  // their `server-only` imports out of the module graph, and every one of the five
  // modules that imports it is mocked away rather than imported by a test.
  // vi.mock is hoisted, so this must sit ABOVE the import of the module under test.
  vi.mock('server-only', () => ({}))

  const rpc = vi.fn()
  vi.mock('@/lib/supabase/server', () => ({
    createServiceClient: () => ({ rpc }),
  }))

  import { emitProductEvent } from './product-events'

  beforeEach(() => {
    rpc.mockReset()
    rpc.mockResolvedValue({ data: 'evt-1', error: null })
  })

  describe('emitProductEvent', () => {
    it('forwards the six stamped arguments to the RPC', async () => {
      await emitProductEvent({
        actorId: 'user-1',
        projectId: 'proj-1',
        event: 'rfi_created',
        properties: { assignee_source: 'project_default' },
      })
      expect(rpc).toHaveBeenCalledWith('emit_product_event', {
        p_actor_id: 'user-1',
        p_project_id: 'proj-1',
        p_event: 'rfi_created',
        p_properties: { assignee_source: 'project_default' },
        p_session_id: null,
        p_organisation_id: null,
      })
    })

    it('accepts a null project with an explicit organisation — the project_deleted case', async () => {
      await emitProductEvent({
        actorId: 'user-1',
        projectId: null,
        organisationId: 'org-1',
        event: 'project_deleted',
        properties: { project_id: 'gone' },
      })
      expect(rpc.mock.calls[0][1]).toMatchObject({ p_project_id: null, p_organisation_id: 'org-1' })
    })

    // JSON.stringify DROPS an undefined value, so an undefined projectId would
    // send a body with no p_project_id key at all. PostgREST answers 404
    // "could not find the function" for a missing argument with no default —
    // which this helper swallows and logs, silently losing every event from
    // that call site. Coerce at the boundary AND default in SQL.
    it('coerces an undefined project or organisation to null, never a dropped key', async () => {
      await emitProductEvent({
        actorId: 'u',
        projectId: undefined as unknown as string | null,
        event: 'marketplace_order_placed',
      })
      const body = rpc.mock.calls[0][1] as Record<string, unknown>
      expect('p_project_id' in body).toBe(true)
      expect(body.p_project_id).toBeNull()
      expect(body.p_organisation_id).toBeNull()
    })

    // The bell path swallows failures by design and this must too: a metric
    // must never be able to fail a user's write.
    it('never throws when the RPC errors, but logs it', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {})
      rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
      await expect(
        emitProductEvent({ actorId: 'u', projectId: 'p', event: 'rfi_created' }),
      ).resolves.toBeUndefined()
      expect(err).toHaveBeenCalled()
      err.mockRestore()
    })

    it('never throws when the client itself throws', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {})
      rpc.mockRejectedValue(new Error('network'))
      await expect(
        emitProductEvent({ actorId: 'u', projectId: 'p', event: 'rfi_created' }),
      ).resolves.toBeUndefined()
      err.mockRestore()
    })

    it('refuses an unregistered event key at the type level and at runtime', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {})
      // @ts-expect-error — not a member of PRODUCT_EVENTS
      await emitProductEvent({ actorId: 'u', projectId: 'p', event: 'made_up' })
      expect(rpc).not.toHaveBeenCalled()
      expect(err).toHaveBeenCalledWith(expect.stringContaining('unregistered'), expect.anything())
      err.mockRestore()
    })
  })
  ```

- [ ] **Step 2: Run it and watch it fail.**

  ```
  pnpm --filter web test lib/analytics/product-events
  ```

  Expected: `Failed to resolve import "./product-events"` — six tests fail on the missing module, **not** on `server-only`, because the mock above is already in place.

- [ ] **Step 3: Write the writer.**

  Create `apps/web/src/lib/analytics/product-events.ts`:

  ```ts
  import 'server-only'
  import { PRODUCT_EVENTS, type ProductEvent } from '@esite/shared'
  import { createServiceClient } from '@/lib/supabase/server'

  /**
   * Write one row to public.product_events.
   *
   * Goes through the service client because public.emit_product_event is granted
   * to service_role alone — the role stamp and the organisation are resolved
   * server-side so a caller cannot invent either. Same shape as
   * dispatchNotification (lib/notifications.ts:26): verify the user with your own
   * client FIRST, then call this.
   *
   * Never throws and is never awaited on a path the user is waiting on. A metric
   * that can fail a write is worse than no metric.
   *
   * ⚠ Any test importing this module must `vi.mock('server-only', () => ({}))`
   * ABOVE the import — the real package throws outside the react-server
   * condition, which is the condition vitest runs in.
   */
  export interface ProductEventArgs {
    actorId: string | null
    projectId: string | null
    event: ProductEvent
    properties?: Record<string, unknown>
    sessionId?: string | null
    /** Required only when projectId is null (org-level events, project_deleted). */
    organisationId?: string | null
  }

  export async function emitProductEvent(args: ProductEventArgs): Promise<void> {
    try {
      if (!(PRODUCT_EVENTS as readonly string[]).includes(args.event)) {
        console.error('[product-events] unregistered event key, refusing to write', { event: args.event })
        return
      }
      const supabase = createServiceClient()
      const { error } = await supabase.rpc('emit_product_event', {
        p_actor_id: args.actorId ?? null,
        // ?? null on every optional: JSON.stringify DROPS an undefined value, and
        // PostgREST answers 404 for a missing argument, which this function then
        // swallows — losing the event with no signal anywhere.
        p_project_id: args.projectId ?? null,
        p_event: args.event,
        p_properties: args.properties ?? {},
        p_session_id: args.sessionId ?? null,
        p_organisation_id: args.organisationId ?? null,
      })
      if (error) console.error('[product-events] rpc failed', { event: args.event, err: error.message })
    } catch (e) {
      console.error('[product-events] threw', { event: args.event, err: String(e) })
    }
  }
  ```

- [ ] **Step 4: Run it and watch it pass.**

  ```
  pnpm --filter web test lib/analytics/product-events
  ```

  Expected: `Tests 6 passed`.

- [ ] **Step 5: Give presence its one real call site.**

  Create `apps/web/src/lib/presence.ts`:

  ```ts
  import 'server-only'
  import { createClient } from '@/lib/supabase/server'

  /**
   * Record that the signed-in user is using the product, right now.
   *
   * public.touch_presence() upserts public.user_presence AND extends-or-opens a
   * public.user_sessions row in one RPC, keyed on auth.uid(), so this is called
   * through the CALLER's own client — never the service client, which has no
   * auth.uid() and would write nothing.
   *
   * Why this exists in Q1 item 1 rather than item 4: without ANY writer, the
   * frozen October baseline for metric 1 is events-only and every later week is
   * sessions+events, so the number rises when item 4's 60-second heartbeat lands
   * and it looks like the programme worked. Shipping a table with no writer is
   * the pathology this whole item exists to name — notifications.read_at, the
   * snag photo_type literal, email_sequence_events.opened_at.
   *
   * Never throws: presence must not be able to fail a page render.
   */
  export async function touchPresence(platform: 'web' | 'mobile_web' | 'mobile_app' = 'web'): Promise<void> {
    try {
      const supabase = await createClient()
      const { error } = await supabase.rpc('touch_presence', {
        p_platform: platform,
        p_user_agent: null,
      })
      if (error) console.error('[presence] touch_presence failed', { err: error.message })
    } catch (e) {
      console.error('[presence] threw', { err: String(e) })
    }
  }
  ```

  In `apps/web/src/app/(admin)/layout.tsx`, add the import beside the others:

  ```ts
  import { touchPresence } from '@/lib/presence'
  ```

  and add it as a fifth entry to the existing `Promise.all` (`:44-51`), so it costs no additional wall-clock time:

  ```ts
    const [inspectionsUnlocked, jbccUnlocked, mvUnlocked, orgsResult] = await Promise.all([
      primaryOrgId ? hasFeature(primaryOrgId, 'inspections', supabase) : Promise.resolve(false),
      primaryOrgId ? hasFeature(primaryOrgId, 'jbcc', supabase) : Promise.resolve(false),
      // MV is a per-USER subscription (lib/mv-access), not an org feature unlock.
      hasMvAccess(user.id, supabase),
      listMyOrganisations(),
      // Presence: one upsert + one indexed lookup, run alongside the four reads
      // this layout already awaits, so it adds no wall-clock time. Never throws.
      touchPresence('web'),
    ])
  ```

  ⚠ **The destructuring stays four-wide** — `touchPresence` returns `void` and its slot is deliberately not bound. `Promise.all` with five entries and a four-element destructure is valid TypeScript and reads as intent; if lint objects, bind it as `, ,` rather than moving the call out of the batch.

  **Client viewers do not reach this line** — `:26` redirects `ctx?.role === 'client_viewer'` to `/portal` before the `Promise.all`. That is why `client_active` carries a note saying a low figure is a fact about the programme sequence. Giving the portal its own call is Q1 item 4's job.

- [ ] **Step 6: Wire the ten event call sites.**

  In `apps/web/src/actions/rfi.actions.ts`, add to the imports beside `import { trackServer, ANALYTICS_EVENTS } from '@/lib/analytics'`:

  ```ts
  import { emitProductEvent } from '@/lib/analytics/product-events'
  ```

  After the `trackServer(... RFI_CREATED ...)` block, which opens at `:72` and closes at `:79`, add — this is the `assigneeSource` re-emission §15 asks for by name:

  ```ts
  await emitProductEvent({
    actorId: user.id,
    projectId: i.projectId,
    event: 'rfi_created',
    properties: {
      rfi_id: rfi.id,
      has_assignee: !!rfi.assigned_to,
      assignee_source: assigneeSource,
      priority: i.priority,
    },
  })
  ```

  After the `trackServer(... RFI_RESPONDED ...)` block that opens at `:155`:

  ```ts
  await emitProductEvent({
    actorId: user.id,
    projectId: rfi.project_id,
    event: 'rfi_responded',
    properties: { rfi_id: rfi.id, response_id: response.id },
  })
  ```

  After the `trackServer(... RFI_CLOSED ...)` block that opens at `:212`:

  ```ts
  await emitProductEvent({
    actorId: user.id,
    projectId: rfi.project_id,
    event: 'rfi_closed',
    properties: { rfi_id: rfi.id },
  })
  ```

  In `apps/web/src/actions/snag.actions.ts`, add the same import, then after the `trackServer(... SNAG_RESOLVED ...)` block at `:99`:

  ```ts
  await emitProductEvent({
    actorId: user.id,
    projectId,
    event: 'snag_resolved',
    properties: { snag_id: snagId, new_status: 'signed_off' },
  })
  ```

  and inside the `if (validStatus === 'resolved' || validStatus === 'signed_off')` block, after the `trackServer` call at `:175`:

  ```ts
    await emitProductEvent({
      actorId: user.id,
      projectId: validProjectId,
      event: 'snag_resolved',
      properties: { snag_id: validSnagId, new_status: validStatus },
    })
  ```

  ⚠ Both of these fire for the same defect when a snag moves resolved → signed_off. See the note above the steps: any count off this event must be `count(DISTINCT properties->>'snag_id')`.

  In `apps/web/src/actions/project.actions.ts`, add the same import, then after the `trackServer(... PROJECT_CREATED ...)` block at `:147`:

  ```ts
  await emitProductEvent({
    actorId: user.id,
    projectId: project.id,
    event: 'project_created',
    properties: { source: 'standalone' },
  })
  ```

  and after the `trackServer(... PROJECT_DELETED ...)` block at `:234`. ⚠ **`projectId` must be `null` here** — the row was deleted by the chain at `:226-230`, and `product_events.project_id` carries a foreign key, so passing the id would raise:

  ```ts
  await emitProductEvent({
    actorId: user.id,
    projectId: null,
    organisationId: project.organisation_id,
    event: 'project_deleted',
    properties: { project_id: projectId },
  })
  ```

  In `apps/web/src/actions/supplier.actions.ts`, add the same import, then after the `trackServer(... ORDER_PLACED ...)` block at `:446`. ⚠ **`projectId` here is `string | undefined`**, not `string | null` — it is destructured from an optional zod field at `:400` and the insert writes `project_id: projectId ?? null` at `:417`. Passing it raw fails `pnpm --filter web type-check`:

  ```ts
  await emitProductEvent({
    actorId: user.id,
    projectId: projectId ?? null,
    organisationId: mem.organisation_id,
    event: 'marketplace_order_placed',
    properties: { order_id: order.id, supplier_id: supplierId, item_count: items.length, total_amount_zar: totalAmount },
  })
  ```

  In `apps/web/src/actions/onboarding.actions.ts`, add the same import, then after the `trackServer(... ONBOARDING_STARTED ...)` block at `:86`:

  ```ts
  await emitProductEvent({
    actorId: user.id,
    projectId: null,
    organisationId: org.id,
    event: 'onboarding_started',
    properties: { org_type: orgType },
  })
  ```

  and after the `trackServer(... PROJECT_CREATED ...)` block at `:132`:

  ```ts
  await emitProductEvent({
    actorId: user.id,
    projectId: project.id,
    event: 'project_created',
    properties: { source: 'onboarding' },
  })
  ```

- [ ] **Step 7: Write the contract test that keeps the next author honest.**

  Create `apps/web/src/lib/analytics/product-events.contract.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest'
  import { readFileSync, readdirSync, statSync } from 'node:fs'
  import { join, resolve } from 'node:path'

  /**
   * Every server action that records a moment in PostHog must also record it in
   * public.product_events.
   *
   * This is the mechanism that stops call sites forgetting. trackServer already
   * marks the moments this codebase considers worth recording; without this
   * rule, a new action would get a PostHog line and no first-party row, and the
   * metric would quietly under-count with no error anywhere — the same shape as
   * a rejected notification type writing no row AND no error.
   *
   * Comments are stripped first: prose about the rule must not read as the rule.
   * (The snag contract test fired on a doc comment for exactly this reason.)
   */
  const REPO_ROOT = resolve(__dirname, '../../../../..')
  const ACTIONS = join(REPO_ROOT, 'apps/web/src/actions')

  function stripComments(src: string): string {
    // Blank block comments line-for-line so reported line numbers stay true.
    return src
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/^\s*\/\/.*$/gm, '')
  }

  function actionFiles(): string[] {
    return readdirSync(ACTIONS)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => join(ACTIONS, f))
      .filter((f) => statSync(f).isFile())
  }

  describe('trackServer and emitProductEvent travel together', () => {
    const offenders: string[] = []
    for (const file of actionFiles()) {
      const src = stripComments(readFileSync(file, 'utf8'))
      const tracks = [...src.matchAll(/\btrackServer\s*\(/g)].length
      const emits = [...src.matchAll(/\bemitProductEvent\s*\(/g)].length
      if (tracks > 0 && emits < tracks) {
        offenders.push(`${file.replace(REPO_ROOT + '/', '')} — ${tracks} trackServer call(s), ${emits} emitProductEvent call(s)`)
      }
    }

    it('every trackServer call site has a matching emitProductEvent call', () => {
      expect(offenders, `\n${offenders.join('\n')}\n`).toEqual([])
    })

    it('there is at least one trackServer call site to check — the suite is not vacuous', () => {
      const total = actionFiles().reduce(
        (n, f) => n + [...stripComments(readFileSync(f, 'utf8')).matchAll(/\btrackServer\s*\(/g)].length,
        0,
      )
      // Measured 2026-09-10: 10 call sites across FIVE files (rfi, snag,
      // project, supplier, onboarding).
      expect(total).toBeGreaterThanOrEqual(10)
    })
  })
  ```

- [ ] **Step 8: Run it, then prove it can fail.**

  ```
  pnpm --filter web test lib/analytics/product-events.contract
  ```

  Expected: green. Now delete the `emitProductEvent` call you added after `rfi.actions.ts:212` and re-run:

  ```
  AssertionError:
  apps/web/src/actions/rfi.actions.ts — 3 trackServer call(s), 2 emitProductEvent call(s)
  ```

  **Restore it.** A rule nobody has watched fire is a rule nobody is enforcing.

- [ ] **Step 9: Type-check, lint, and commit.**

  ```
  pnpm --filter web type-check
  pnpm --filter web lint
  pnpm --filter web test
  git add apps/web/src/lib/analytics apps/web/src/lib/presence.ts \
          apps/web/src/app/\(admin\)/layout.tsx apps/web/src/actions
  git commit -m "feat(metrics): emitProductEvent + one real presence call site + the contract test"
  ```

  ⚠ The `assigneeSource` diagnostic at `rfi.actions.ts:69` stays where it is for now. §12 §(i) retires it only once assignment is mandatory (Q1 item 2, §03 §1.10), because at that point it could report nothing but `explicit`. Removing it here would delete the one signal this item exists to make readable.

---

## Task 14 — `/metrics` (titled "Adoption"), the Sidebar entry, and the two documents that move with it

**Files:**
- Create: `apps/web/src/app/(admin)/metrics/page.tsx`
- Create: `apps/web/src/app/(admin)/metrics/page.test.tsx`
- Modify: `apps/web/src/components/layout/Sidebar.tsx` (`:11` icon import, `FOOTER_ITEMS` `:92-96`, the non-admin filter `:127-129`)
- Modify: `docs/rbac-matrix.md` (the `(admin)` page-routes table, after `/settings/integrations` at `:72`)
- Modify: `CONFORMANCE.md` (C11 evidence at `:61`, and the `Last updated` line at `:10`)

**It is `/metrics`, not `/team/metrics`.** `/team` is never created — §04 deleted the segment and no `team` or `metrics` directory exists under `apps/web/src/app` today.

**The label is "Adoption"; the route stays `/metrics`.** "Metrics" sitting beside "Settings" in the footer promises project numbers — how many RFIs are open, what is late — and this page carries none of that until Q2 item 14 (project home). The partner and the PM are the two people who will click it, and a name that says what is inside costs nothing. The route string is unchanged so `docs/rbac-matrix.md`, §15 and A(g) need no amendment.

**Two gates, because one is not a gate.** `requireRolePage(OWNER_ADMIN)` (`apps/web/src/lib/auth/require-role.ts:171`) stops the page rendering, and the RESTRICTIVE SELECT policy from Task 9 stops a server action or a direct PostgREST call reading the same rows. The page reads through `createClient()` — the caller's own cookie session — **not** `createServiceClient()`, so the database gate is exercised on every render rather than bypassed by the surface that is supposed to demonstrate it.

⚠ **Three harness facts, measured, that the tests below are written around.** (a) `@testing-library/jest-dom` is **not installed** in this workspace and `apps/web/vitest.config.ts` declares no `setupFiles`, so `toBeInTheDocument()` does not exist — the house pattern is plain matchers, stated in as many words at `app/(admin)/projects/[id]/generator-cost-recovery/TenantsPanel.test.tsx:129`. (b) There is **no `render(await Page())` precedent anywhere in `apps/web/src`** (a `grep -rn "render(await" apps/web/src` returns nothing), so the async-server-component render path is unproven in this harness. If React 19 + `@testing-library/react` 16 refuses to render the resolved element, **assert on the returned element tree instead** — do not add a `setupFiles` entry or a new dependency in this PR to make a page test work. (c) Testing Library matches on an element's **direct text children**, not its full subtree, so `<strong>{METRIC_KEYS.length} headline metrics</strong>` matches `/11 headline metrics/` (two text children, concatenated) while a `<td>` holding `13.0%` beside a `<span>▲</span>` still matches `'13.0%'` (the span is a separate element and is excluded). Both behaviours are relied on below.

- [ ] **Step 1: Write the failing page test.**

  Create `apps/web/src/app/(admin)/metrics/page.test.tsx`:

  ```tsx
  import { describe, it, expect, vi, beforeEach } from 'vitest'
  import { render, screen } from '@testing-library/react'
  import { OWNER_ADMIN } from '@esite/shared'

  const requireRolePage = vi.fn()
  vi.mock('@/lib/auth/require-role', () => ({ requireRolePage: (...a: unknown[]) => requireRolePage(...a) }))

  const rows: unknown[] = []
  vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({
      from: () => ({
        select: () => ({ order: () => ({ limit: async () => ({ data: rows, error: null }) }) }),
      }),
    }),
  }))

  import MetricsPage from './page'

  // Plain matchers throughout — this workspace has no @testing-library/jest-dom
  // and vitest.config.ts declares no setupFiles, so toBeInTheDocument() does not
  // exist. Same convention as TenantsPanel.test.tsx:129.
  beforeEach(() => {
    rows.length = 0
    requireRolePage.mockReset()
    requireRolePage.mockResolvedValue({ userId: 'u1', organisationId: 'o1', role: 'owner' })
  })

  const recentWindow = () => {
    const d = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    return d.toISOString().slice(0, 10)
  }

  describe('/metrics', () => {
    it('gates on OWNER_ADMIN before reading anything', async () => {
      render(await MetricsPage())
      expect(requireRolePage).toHaveBeenCalledWith(OWNER_ADMIN)
    })

    // Verification walks from the empty state a real user starts in — an
    // uploader that rendered correctly on a page nobody could reach passed
    // verification once already.
    it('renders a usable empty state before the first snapshot lands', async () => {
      render(await MetricsPage())
      expect(screen.queryByText(/no snapshot yet/i)).not.toBeNull()
      expect(screen.queryByText(/Mondays 04:00 UTC/i)).not.toBeNull()
      // The empty state must tell the reader how to check the scheduler. `cron`
      // is not a PostgREST-exposed schema (config.toml:9), so the page cannot
      // read cron.job_run_details itself — it names the command instead.
      expect(screen.queryByText(/cron\.job_run_details/i)).not.toBeNull()
    })

    it('renders every metric with its Q1 target once a snapshot exists', async () => {
      rows.push({
        metric_key: 'weekly_active', iso_year: 2026, iso_week: 40,
        window_start: recentWindow(), window_end: recentWindow(),
        numerator: 3, denominator: 23, value: 0.1304,
        status: 'measured', is_baseline: false, note: null, detail: {},
      })
      render(await MetricsPage())
      expect(screen.queryByText(/Weekly active users/i)).not.toBeNull()
      expect(screen.queryByText('35% of the frozen cohort')).not.toBeNull()
      expect(screen.queryByText('13.0%')).not.toBeNull()
    })

    it('shows an unmeasurable metric as "no honest number yet", never as zero', async () => {
      rows.push({
        metric_key: 'inbox_engagement', iso_year: 2026, iso_week: 40,
        window_start: recentWindow(), window_end: recentWindow(),
        numerator: null, denominator: null, value: null,
        status: 'unmeasurable', is_baseline: false,
        note: 'read_at has never been written', detail: {},
      })
      render(await MetricsPage())
      expect(screen.queryByText(/no honest number yet/i)).not.toBeNull()
      expect(screen.queryByText('read_at has never been written')).not.toBeNull()
      expect(screen.queryByText('0.0%')).toBeNull()
    })

    // The state this team has actually lived through: cloud-sync-poll was
    // specified, merged, never scheduled, ran 11 times manually, and surfaced two
    // months later as a user complaint about stale floor plans. A dashboard that
    // renders three-week-old numbers with no signal is how that happens again.
    it('warns when the newest snapshot is more than a week old', async () => {
      const stale = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      rows.push({
        metric_key: 'weekly_active', iso_year: 2026, iso_week: 37,
        window_start: stale, window_end: stale,
        numerator: 3, denominator: 23, value: 0.1304,
        status: 'measured', is_baseline: false, note: null, detail: {},
      })
      render(await MetricsPage())
      expect(screen.queryByText(/snapshot is 20 days old/i)).not.toBeNull()
    })

    it('shows the previous week beside the latest one, so the reader can see direction', async () => {
      const thisWeek = recentWindow()
      const lastWeek = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      rows.push(
        { metric_key: 'weekly_active', iso_year: 2026, iso_week: 40, window_start: thisWeek, window_end: thisWeek,
          numerator: 3, denominator: 23, value: 0.1304, status: 'measured', is_baseline: false, note: null, detail: {} },
        { metric_key: 'weekly_active', iso_year: 2026, iso_week: 39, window_start: lastWeek, window_end: lastWeek,
          numerator: 2, denominator: 23, value: 0.0870, status: 'measured', is_baseline: false, note: null, detail: {} },
      )
      render(await MetricsPage())
      expect(screen.queryByText('13.0%')).not.toBeNull()
      expect(screen.queryByText('8.7%')).not.toBeNull()
    })

    it('names the number of headline metrics from the registry, not from a hardcoded word', async () => {
      render(await MetricsPage())
      expect(screen.queryByText(/11 headline metrics/i)).not.toBeNull()
    })
  })
  ```

- [ ] **Step 2: Run it and watch it fail.**

  ```
  pnpm --filter web test 'app/\(admin\)/metrics'
  ```

  Expected: `Failed to resolve import "./page"` — seven tests fail on the missing module. If instead they fail on `render` refusing an async component, stop and read the harness note above before writing the page: switch the assertions to the returned element tree rather than adding a setup file.

- [ ] **Step 3: Write the page.**

  Create `apps/web/src/app/(admin)/metrics/page.tsx`:

  ```tsx
  import {
    OWNER_ADMIN, METRIC_KEYS, METRIC_LABELS, METRIC_UNITS, METRIC_TARGET_Q1,
    RATIO_METRIC_KEYS, type MetricKey,
  } from '@esite/shared'
  import { requireRolePage } from '@/lib/auth/require-role'
  import { createClient } from '@/lib/supabase/server'
  import { Card, CardHeader, CardBody } from '@/components/ui/Card'
  import { Badge } from '@/components/ui/Badge'

  export const dynamic = 'force-dynamic'

  interface SnapshotRow {
    metric_key: MetricKey
    iso_year: number
    iso_week: number | null
    window_start: string
    window_end: string
    numerator: number | null
    denominator: number | null
    value: number | null
    status: 'measured' | 'censored' | 'unmeasurable' | 'not_yet_instrumented'
    is_baseline: boolean
    note: string | null
    detail: Record<string, unknown>
  }

  function present(row: SnapshotRow | undefined): string {
    if (!row || row.value === null) return '—'
    const n = Number(row.value)
    if (RATIO_METRIC_KEYS.has(row.metric_key)) return `${(n * 100).toFixed(1)}%`
    return `${n}${METRIC_UNITS[row.metric_key]}`
  }

  /**
   * Four status words go in the DATABASE, where the distinction is load-bearing.
   * On the page a reader experiences three of them as one thing — "you cannot
   * tell me yet" — so they render as two phrases and the `note` underneath
   * carries the actual reason. The note is doing the real work.
   */
  function statusPhrase(s: SnapshotRow['status']): { label: string; variant: 'success' | 'warning' } {
    return s === 'measured'
      ? { label: 'measured', variant: 'success' }
      : { label: 'no honest number yet', variant: 'warning' }
  }

  function daysBetween(a: string, b: Date): number {
    return Math.floor((b.getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000)
  }

  export default async function MetricsPage() {
    // Gate one: the page does not render for anyone else.
    await requireRolePage(OWNER_ADMIN)

    // Gate two: read through the CALLER's session, so the RESTRICTIVE policy
    // calling public.user_is_org_admin() is exercised on every render. Never the
    // service client here — that would bypass the backstop this page exists to
    // demonstrate.
    const supabase = await createClient()
    const { data } = await (supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => { order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: SnapshotRow[] | null }> } }
      }
    })
      .from('platform_metrics_weekly')
      .select('*')
      .order('window_start', { ascending: false })
      .limit(200)

    const rows: SnapshotRow[] = data ?? []
    const baseline = new Map(rows.filter((r) => r.is_baseline).map((r) => [r.metric_key, r]))
    const weekly = rows.filter((r) => !r.is_baseline)
    const windows = [...new Set(weekly.map((r) => r.window_start))].sort().reverse()
    const latestWindow = windows[0] ?? null
    const priorWindow = windows[1] ?? null
    const latest = new Map(weekly.filter((r) => r.window_start === latestWindow).map((r) => [r.metric_key, r]))
    const prior = new Map(weekly.filter((r) => r.window_start === priorWindow).map((r) => [r.metric_key, r]))

    const staleDays = latestWindow ? daysBetween(latestWindow, new Date()) : null
    const isStale = staleDays !== null && staleDays > 8

    return (
      <div style={{ padding: 24, display: 'grid', gap: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>Adoption</h1>
          <p style={{ color: 'var(--c-text-dim)', marginTop: 4 }}>
            Computed in Postgres from first-party tables. Snapshots are append-only and are never rewritten;
            changing a definition writes new rows under a new method version. Method, bounds and every
            unmeasurable cell are recorded in <code>docs/metrics-baseline-2026-10.md</code>.
          </p>
        </div>

        {isStale ? (
          <Card>
            <CardBody>
              <strong>Last snapshot is {staleDays} days old.</strong>
              <p style={{ color: 'var(--c-text-dim)', marginTop: 6 }}>
                The <code>platform-metrics-weekly</code> job may not be running. Check it with{' '}
                <code>SELECT * FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = &apos;platform-metrics-weekly&apos;) ORDER BY start_time DESC LIMIT 5;</code>
              </p>
            </CardBody>
          </Card>
        ) : null}

        {weekly.length === 0 && baseline.size === 0 ? (
          <Card>
            <CardBody>
              <strong>No snapshot yet.</strong>
              <p style={{ color: 'var(--c-text-dim)', marginTop: 6 }}>
                The <code>platform-metrics-weekly</code> job runs Mondays 04:00 UTC (06:00 SAST) and writes a
                row for every metric on every tick — including a tick that measured nothing. If this stays
                empty past a Monday, the job did not run. Confirm with{' '}
                <code>SELECT * FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = &apos;platform-metrics-weekly&apos;) ORDER BY start_time DESC LIMIT 5;</code>{' '}
                — the <code>cron</code> schema is not exposed through PostgREST, so this page cannot read it for you.
              </p>
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <strong>{METRIC_KEYS.length} headline metrics</strong>{' '}
            <span style={{ color: 'var(--c-text-dim)' }}>
              {latestWindow ? `· week of ${latestWindow}` : '· awaiting the first weekly snapshot'}
            </span>
          </CardHeader>
          <CardBody>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--c-text-dim)' }}>
                    <th style={{ padding: '6px 8px' }}>Metric</th>
                    <th style={{ padding: '6px 8px' }}>Sept-2026 baseline</th>
                    <th style={{ padding: '6px 8px' }}>Previous week</th>
                    <th style={{ padding: '6px 8px' }}>Latest week</th>
                    <th style={{ padding: '6px 8px' }}>Q1 target</th>
                    <th style={{ padding: '6px 8px' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {METRIC_KEYS.map((k) => {
                    const now = latest.get(k)
                    const was = prior.get(k)
                    const base = baseline.get(k)
                    const status = now?.status ?? base?.status
                    const phrase = status ? statusPhrase(status) : null
                    const delta =
                      now?.value != null && was?.value != null
                        ? Number(now.value) - Number(was.value)
                        : null
                    return (
                      <tr key={k} style={{ borderTop: '1px solid var(--c-border)' }}>
                        <td style={{ padding: '8px' }}>
                          {METRIC_LABELS[k]}
                          {(now?.note ?? base?.note) ? (
                            <div style={{ color: 'var(--c-text-dim)', fontSize: 12, marginTop: 2 }}>
                              {now?.note ?? base?.note}
                            </div>
                          ) : null}
                        </td>
                        <td style={{ padding: '8px' }}>{present(base)}</td>
                        <td style={{ padding: '8px', color: 'var(--c-text-dim)' }}>{present(was)}</td>
                        <td style={{ padding: '8px' }}>
                          {present(now)}
                          {delta !== null && delta !== 0 ? (
                            <span style={{ marginLeft: 6, color: 'var(--c-text-dim)', fontSize: 12 }}>
                              {delta > 0 ? '▲' : '▼'}
                            </span>
                          ) : null}
                        </td>
                        <td style={{ padding: '8px', color: 'var(--c-text-dim)' }}>{METRIC_TARGET_Q1[k] ?? '—'}</td>
                        <td style={{ padding: '8px' }}>
                          {phrase ? <Badge variant={phrase.variant}>{phrase.label}</Badge> : <Badge variant="ghost">no row</Badge>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      </div>
    )
  }
  ```

  ⚠ Confirm `Badge` accepts the variants used (`success | warning | ghost`) before running — the documented set is `default | ghost | info | warning | success | danger`. If the import path or prop name differs, fix it against the real component rather than adding a wrapper.

- [ ] **Step 4: Run it and watch it pass.**

  ```
  pnpm --filter web test 'app/\(admin\)/metrics'
  ```

  Expected: `Tests 7 passed`.

- [ ] **Step 5: Prove the staleness banner can fail.**

  Change the threshold from `> 8` to `> 800`, re-run, and confirm `warns when the newest snapshot is more than a week old` goes red. **Restore it.** The empty state was already tested; this is the state that starts existing the moment the first tick lands, and it is the one `cloud-sync-poll` was in for two months.

- [ ] **Step 6: Add the Sidebar entry with a flag, not a growing filter chain.**

  In `apps/web/src/components/layout/Sidebar.tsx`, add `BarChart3` to the `lucide-react` import at `:11`, then replace `FOOTER_ITEMS` (`:92-96`):

  ```ts
  const FOOTER_ITEMS = [
    { href: '/site',                label: 'Site capture', Icon: HardHat,   adminOnly: false },
    { href: '/cable-schedule/sans', label: 'SANS ref',     Icon: BookMarked, adminOnly: false },
    { href: '/metrics',             label: 'Adoption',     Icon: BarChart3, adminOnly: true },
    { href: '/settings',            label: 'Settings',     Icon: Settings,  adminOnly: true },
  ] as const
  ```

  and replace the non-admin filter (`:127-129`) so it reads the flag rather than accumulating `!==` clauses — the third admin-only footer item is where a chain gets it wrong:

  ```ts
    const footerItems = isAdmin ? FOOTER_ITEMS : FOOTER_ITEMS.filter(item => !item.adminOnly)
  ```

  This only hides a link that would otherwise bounce; the two real gates are on the page and in the database.

- [ ] **Step 7: Update `docs/rbac-matrix.md` in the same commit.**

  In the `## Page routes (apps/web/src/app/(admin)/*)` table, after the `/settings/integrations` row (`:72`), add:

  ```
  | `/metrics` | W | W | — | — | — | — | — |
  ```

  and add a note under the table:

  ```
  > `/metrics` (labelled "Adoption" in the sidebar) renders
  > `public.platform_metrics_weekly` and is gated twice:
  > `requireRolePage(OWNER_ADMIN)` on the page, and a RESTRICTIVE SELECT policy on
  > the three metrics tables. `platform_metrics_weekly` uses the zero-argument
  > `public.user_is_org_admin()` because it holds platform-wide aggregates with no
  > per-org row; `product_events` and `metric_cohorts` use the one-argument
  > `public.user_is_org_admin(organisation_id)`, because they do. The page reads
  > through the caller's own session — never the service client — so the database
  > gate is exercised on every render. There is no `/team/metrics`; `/team` is
  > never created.
  ```

- [ ] **Step 8: Update `CONFORMANCE.md` in the same commit.**

  Extend the C11 evidence cell (`:61`) with:

  ```
  ; migration 00186 adds public.product_events, platform_metrics_weekly and metric_cohorts with a PERMISSIVE SELECT plus a RESTRICTIVE admin gate — org-scoped via user_is_org_admin(organisation_id) on the two tables carrying per-org rows, platform-wide via user_is_org_admin() only on platform_metrics_weekly — no UPDATE/DELETE policy on either store, and REVOKE SELECT … FROM anon on all three plus user_presence, user_sessions, projects.public_holidays and projects.calendar_years; the six new functions each carry REVOKE … FROM PUBLIC and an explicit REVOKE … FROM anon, verified with has_function_privilege
  ```

  and change the `Last updated:` line (`:10`) to:

  ```
  Last updated: 2026-10-xx (Q1 item 1 — metrics, presence and the working-day calendar).
  ```

- [ ] **Step 9: Full suite, then commit.**

  ```
  pnpm --filter web type-check
  pnpm --filter web lint
  pnpm --filter web test
  pnpm --filter @esite/shared test
  git add apps/web/src/app/\(admin\)/metrics apps/web/src/components/layout/Sidebar.tsx \
          docs/rbac-matrix.md CONFORMANCE.md
  git commit -m "feat(metrics): /metrics under (admin), labelled Adoption, gated by OWNER_ADMIN and RLS"
  ```

---

## Task 15 — Claim the migration number at merge, and apply

**Files:**
- Rename: `apps/edge-functions/supabase/migrations/00186_q1_metrics_presence_calendar.sql` → the number claimed here

**This is the step that broke twice in one week.** PRs #162 and #163 both shipped a `00183`; both fixes then independently renumbered to `00184`, and `Deploy DB Migrations` broke twice. `supabase db push` keys on the version **prefix**: a number already in `schema_migrations` makes it print "Remote database is up to date", exit 0 and skip the file — which is how PR #163's migration never applied behind a green workflow, with production still serving v1.0 while the PR, the workflow and the merge all looked clean.

- [ ] **Step 1: Re-read `max(version)` from the ledger AND `origin/main`. Both, because either can have moved.**

  ```
  git fetch origin main
  git ls-tree --name-only origin/main apps/edge-functions/supabase/migrations/ | tail -3
  bash -c '. scripts/db/mgmt-api.sh; mgmt_query "SELECT max(version) AS head, count(*) AS n FROM supabase_migrations.schema_migrations;"'
  ```

  Measured 2026-09-10: `origin/main` ends at `00184_site_forms_template_v1_1.sql`, ledger head `00184`, 178 rows — and item 0 claims `00185`. **Do not reuse those numbers — re-read them now.**

- [ ] **Step 2: Enumerate open PRs' migration filenames.**

  `≤ max(version)` only catches a number the ledger has already absorbed. The failure that actually happened was two concurrent sessions each picking the same *free* number and each passing that check independently.

  ```
  gh pr list --state open --json number,title --jq '.[] | "\(.number) \(.title)"'
  for pr in $(gh pr list --state open --json number --jq '.[].number'); do
    echo "PR #$pr:"; gh pr diff "$pr" --name-only | grep 'supabase/migrations/' || echo "  (no migration)"
  done
  ```

  If any open PR claims your number, pick the next free one and say so in your PR body.

- [ ] **Step 3: Announce the number to peer sessions, then rename.**

  ```
  git mv apps/edge-functions/supabase/migrations/00186_q1_metrics_presence_calendar.sql \
         apps/edge-functions/supabase/migrations/00187_q1_metrics_presence_calendar.sql   # example
  ```

  Update the `-- Migration 00186 —` line in the file header to match, and the two comment references to `00186` in `CONFORMANCE.md` and this plan's PR body. Nothing else references the number: the `@verify` block, the contract tests and both assertion files locate the migration by content, never by filename — deliberately, because a renumber must not be able to break them. Re-run the suites to confirm:

  ```
  pnpm --filter @esite/shared test
  pnpm --filter web test
  ```

  ⚠ `PROGRAMME_FLOOR` in `apps/web/src/lib/migration-verify-block.contract.test.ts` is deliberately `'00185'` — **item 0's** migration, so item 0 is covered by the same hygiene rule. It is a floor, not an equality: leave it alone whatever number you claim above it. If you renumbered *below* `00185` (only possible if `origin/main` moved backwards, which it cannot), stop and re-read.

- [ ] **Step 4: One final dry run at the claimed number.**

  ```
  scripts/db/dry-run-migration.sh \
    apps/edge-functions/supabase/migrations/00187_q1_metrics_presence_calendar.sql \
    scripts/db/assert-metrics-foundation-seeded.sql \
    scripts/db/assert-metrics-foundation-static.sql
  ```

  Expected: `✓ N assertion(s) green — transaction rolled back, nothing persisted`. Record `N`.

- [ ] **Step 5: Open the PR, merge it, and let the workflow apply.**

  ```
  git push "https://x-access-token:$(gh auth token)@github.com/WattMatt/e-site.git" HEAD
  gh pr create --title "Q1 item 1 — metrics, presence, the A(h) calendar and migration-verification tooling" --body "$(cat <<'BODY'
  ## What

  Q1 ordinal-1 migration (Appendix A(f)) plus the `-- @verify:` convention and
  `scripts/verify-migration-applied.ts` that the remaining ten Q1 migrations land behind.

  ## Mutation verification (numbers, not adjectives)

  | Thing disabled | Failures before | Failures after restore |
  |---|---|---|
  | `runDirectives` treating a false predicate as a pass | … | … |
  | a two-argument `function:` directive (the identity-arguments trap) | … | … |
  | `REVOKE EXECUTE … FROM anon` on `user_is_org_admin()` | … | … |
  | the `user_organisations` policy count changed from 3 to 4 | … | … |
  | `product_events_admin_only` switched to the zero-arg admin check | … | … |
  | `diary_same_day` status hard-coded back to `'measured'` | … | … |
  | one metric arm removed from the rollup | … | … |
  | the `_writes` clause removed from `_active` | … | … |
  | `emitProductEvent` deleted from `rfi.actions.ts:212` | … | … |
  | `SAST_OFFSET_MS` set to 0 | … | … |
  | one seeded holiday name edited by hand | … | … |
  | the staleness threshold widened to 800 days | … | … |

  ## Measured, not assumed

  - PostgreSQL **17.6** (not 15). `security_invoker` views need 15+, so the floor is met.
  - Frozen weekly-active cohort: **23** accounts (band 10..35 asserted by the migration).
  - Frozen contractor cohort: **12**, not §15's 13 — `rbac-test@e-site.live` holds an active `contractor` role and `metric_accounts` excludes it by rule. `METRIC_TARGET_Q1` restates the target as **6 of 12 (50%)**.
  - Frozen client-viewer cohort: **4**. There was no client metric in §15's eight; `client_active` adds one so Q3's portal is not judged against a baseline first computed the quarter it ships.
  - Over the equivalent trailing four weeks (2026-08-06 → 2026-09-03), **5 distinct people wrote to the product** — diary, QC, RFIs, RFI responses, reports — all inside `metric_accounts`, 3 of them contractors. An events-only `_active` would have published a baseline of **0 / 23** and **0 / 12**.
  - `projects.site_diary_entries` holds **53 rows all-time; only 10 of the last 27 weeks contain any**. A hard-coded `'measured'` on that ratio arm would have violated `platform_metrics_weekly_measured_has_value` and written **zero rows** on ~63% of Monday ticks.
  - `billing.subscriptions.tier` CHECK is `('free','starter','professional','enterprise')`; §11.7's practice bands arrive in Q4, so metric 8 reads "any paid band".
  - **246 automated emails** across all 36 accounts, `opened_at` and `clicked_at` NULL on every row, `resend_message_id` on 235. That zero is a measurement gap, not behaviour — it is published in `inbox_engagement.detail`.
  - Production carries a pre-existing `anon` EXECUTE grant on `public.user_is_org_admin(uuid)` from `00177:273-274`. **Not fixed here** — it changes three live RESTRICTIVE policies and needs its own change.

  ## Two deliberate divergences from §15

  1. §15 §(a) specifies the weekly job "following the inline-key `net.http_post` pattern (00148:136-142)". This schedules `compute_platform_metrics_weekly` **directly** — there is no edge function to call, and the direct form removes the `sb_secret_`-is-not-a-JWT failure that broke `cloud-sync-poll` 4/4 on its first tick.
  2. §15 §(b) specifies `public.touch_presence(p_platform)`, one argument. This ships **two** — `p_user_agent` has no other source and `user_agent` is in §15's own `user_sessions` column list.

  ## Registry and scope

  Appendix A(f)'s Q1 `public` row gains `metric_account_excluded()`, `emit_product_event()` and `compute_platform_metrics_weekly()`. **§12 §(h) test 8 — the A(f) registry diff — does not exist**; the hygiene test added here (test 5) enforces only that a block declares the tables, views and functions its own file creates. The A(f) edit is a review discipline until test 8 has an owner.

  ## Not done

  - `.github/workflows/deploy-migrations.yml` needs a `workflow`-scoped token or a hand edit by Arno.
  - A Resend webhook writing `opened_at` / `clicked_at`. Recommended as a separate Q1 item in Arno's lane; the measurement gap is published on `/metrics` in the meantime.
  BODY
  )"
  ```

  Merging to `main` triggers `Deploy DB Migrations` on the path filter (`deploy-migrations.yml:15-16`). **Its green tick is not evidence.** Task 16 is.

---

## Task 16 — Verify against production

**Files:**
- Create: `scripts/db/smoke-test-metrics-foundation.sh`

- [ ] **Step 1: Run the verifier against production.**

  ```
  node --experimental-strip-types scripts/verify-migration-applied.ts
  ```

  Expected (with item 0's migration also on main):

  ```
  ✓ 00185_resend_email_delivery_evidence.sql — N directive(s) verified
  ✓ 00187_q1_metrics_presence_calendar.sql — 50 directive(s) verified

  ✓ 2 migration(s) verified against cbskbnvvgcybmfikxgky
  ```

  **50 is the count of directive lines between `-- @verify:begin` and `-- @verify:end`** in this migration: 7 tables, 1 view, 6 functions, 10 policies, 3 constraints, 6 indexes, 1 cron job, 13 `grant_absent`, 3 `sql`. Count them in the file if the number disagrees — a lower one means a directive line was lost in an edit and something is no longer being checked.

  If it reports `version 00187 is NOT in supabase_migrations.schema_migrations`, `db push` skipped the file. **Do not re-run the workflow and hope.** Reconcile the ledger against the filenames on `main` after independently verifying each migration's effect — a broken `db push` blocks every future migration for everyone.

- [ ] **Step 2: Write the smoke test.**

  Create `scripts/db/smoke-test-metrics-foundation.sh`, in the house style of the other `scripts/db/smoke-test-*.sh`:

  ```bash
  #!/usr/bin/env bash
  # Smoke-test the Q1 metrics/presence/calendar foundation AFTER it is applied.
  #
  # Section 1 runs assert-metrics-foundation-static.sql read-only: it reads only
  # applied structure, so every assertion in it is true against a production that
  # has not yet had its first Monday tick.
  #
  # Section 2 runs assert-metrics-foundation-seeded.sql inside its own
  # BEGIN … ROLLBACK, because those assertions read rows the file itself seeds —
  # after the real apply, product_events and platform_metrics_weekly are EMPTY
  # until the first tick, so running them read-only would go red for the wrong
  # reason. Zero residue either way.
  #
  # Exit 0 on full green.
  set -euo pipefail
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  . "$SCRIPT_DIR/mgmt-api.sh"

  pass() { echo "  ✓ $1"; }
  fail() { echo "  ✗ $1" >&2; FAILED=1; }
  section() { echo ""; echo "── $1 ──"; }
  FAILED=0

  section "1. Applied structure — objects, RLS, policies, grants, calendar (read-only)"
  RES=$(mgmt_apply_sql_file "$SCRIPT_DIR/assert-metrics-foundation-static.sql")
  echo "$RES" | jq -r '.[] | if .ok then "  ✓ \(.check)" else "  ✗ \(.check)" end'
  [[ "$(echo "$RES" | jq '[.[] | select(.ok != true)] | length')" == "0" ]] || FAILED=1

  section "2. Behaviour — the writer, presence and the rollup (seeded, rolled back)"
  SEEDED=$(mgmt_query "BEGIN;
  $(cat "$SCRIPT_DIR/assert-metrics-foundation-seeded.sql")
  ROLLBACK;")
  echo "$SEEDED" | jq -r '.[] | if .ok then "  ✓ \(.check)" else "  ✗ \(.check)" end'
  [[ "$(echo "$SEEDED" | jq '[.[] | select(.ok != true)] | length')" == "0" ]] || FAILED=1
  # Prove the rollback: nothing the seeded file wrote may survive it.
  RESIDUE=$(mgmt_query "SELECT (SELECT count(*) FROM public.product_events)
                             + (SELECT count(*) FROM public.user_sessions) AS n;" | jq -r '.[0].n')
  [[ "$RESIDUE" == "0" ]] && pass "seeded section left zero residue" \
                          || fail "seeded section left $RESIDUE row(s) behind — the ROLLBACK did not take"

  section "3. An unseeded year RAISES rather than falling back to calendar days"
  RAISED=$(mgmt_query "
  DO \$\$
  BEGIN
    PERFORM projects.working_days_between(timestamptz '2040-01-05 08:00+02', timestamptz '2040-01-12 08:00+02',
      (SELECT project_id FROM projects.project_settings ORDER BY project_id LIMIT 1), 'office');
    RAISE EXCEPTION 'DID NOT RAISE';
  EXCEPTION WHEN no_data_found THEN
    NULL;
  END \$\$;
  SELECT true AS raised;" | jq -r '.[0].raised')
  [[ "$RAISED" == "true" ]] && pass "2040 raises no_data_found" || fail "unseeded year did NOT raise"

  section "4. The SQL calendar agrees with the TypeScript mirror, on the SAME settings"
  # Both sides read the SAME project's actual working_days and extra_holidays.
  # Sampling an unordered `LIMIT 1` project and hard-coding [1,2,3,4,5] in the TS
  # side compares two different configurations and passes only by luck.
  CFG=$(mgmt_query "SELECT project_id::text AS pid,
                           working_days AS wd,
                           COALESCE(array_to_json(extra_holidays)::text,'[]') AS eh
                      FROM projects.project_settings ORDER BY project_id LIMIT 1;")
  PROJ=$(echo "$CFG" | jq -r '.[0].pid')
  WD=$(echo "$CFG" | jq -c '.[0].wd')
  EH=$(echo "$CFG" | jq -r '.[0].eh')
  SQL_N=$(mgmt_query "SELECT projects.working_days_between(timestamptz '2026-01-01 08:00+02', timestamptz '2026-12-31 08:00+02', '$PROJ', 'office') AS n;" | jq -r '.[0].n')
  TS_N=$(node --experimental-strip-types -e "
  const wd = $WD; const eh = $EH;
  Promise.all([
    import('$SCRIPT_DIR/../../packages/shared/src/lib/calendar/working-days.ts'),
    import('$SCRIPT_DIR/../../packages/shared/src/lib/jbcc/sa-public-holidays.ts'),
  ]).then(([m, h]) => {
    const holidays = new Set(); const years = new Set()
    for (let y = 2024; y <= 2035; y++) { years.add(y); for (const x of h.listHolidaysNamed(y)) holidays.add(x.date.toISOString().slice(0,10)) }
    const cal = m.buildCalendar({ workingDays: wd, extraHolidays: eh, calendar: 'office', holidays, seededYears: years })
    console.log(m.workingDaysBetween(new Date('2026-01-01T06:00:00Z'), new Date('2026-12-31T06:00:00Z'), cal))
  })")
  [[ "$SQL_N" == "$TS_N" ]] && pass "SQL and TS agree on project $PROJ: $SQL_N office working days in 2026" \
                            || fail "SQL says $SQL_N, TypeScript says $TS_N — one of them is wrong"

  section "5. The RESTRICTIVE read gate holds for a real contractor"
  # No password anywhere: impersonate through request.jwt.claims inside a
  # rolled-back transaction — the PR #157 pattern.
  CONTRACTOR=$(mgmt_query "
  BEGIN;
  INSERT INTO public.platform_metrics_weekly (metric_key, iso_year, iso_week, window_start, window_end, value, status)
  VALUES ('weekly_active', 2026, 1, DATE '2026-01-05', DATE '2026-01-12', 0.5, 'measured');
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', (SELECT id::text FROM public.profiles WHERE email='rbac-test@e-site.live'),
                      'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*)::int AS n FROM public.platform_metrics_weekly;
  ROLLBACK;" | jq -r '.[0].n')
  OWNER=$(mgmt_query "
  BEGIN;
  INSERT INTO public.platform_metrics_weekly (metric_key, iso_year, iso_week, window_start, window_end, value, status)
  VALUES ('weekly_active', 2026, 1, DATE '2026-01-05', DATE '2026-01-12', 0.5, 'measured');
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', (SELECT user_id::text FROM public.user_organisations WHERE role='owner' AND is_active LIMIT 1),
                      'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*)::int AS n FROM public.platform_metrics_weekly;
  ROLLBACK;" | jq -r '.[0].n')
  [[ "$CONTRACTOR" == "0" && "$OWNER" == "1" ]] \
    && pass "contractor sees 0, org owner sees 1 — the gate is the gate, not a broken deploy" \
    || fail "expected contractor=0 owner=1, got contractor=$CONTRACTOR owner=$OWNER"

  section "6. product_events is ORG-SCOPED, not merely admin-gated"
  # An owner of org A must NOT read a row belonging to org B. The zero-arg admin
  # check would pass this row to them; the one-arg check does not. Both counts
  # come from the same transaction, so a zero cannot be an empty table.
  XORG=$(mgmt_query "
  BEGIN;
  SELECT set_config('x.owner', (SELECT user_id::text FROM public.user_organisations WHERE role='owner' AND is_active ORDER BY user_id LIMIT 1), true);
  SELECT set_config('x.own_org', (SELECT organisation_id::text FROM public.user_organisations WHERE user_id = current_setting('x.owner')::uuid AND is_active LIMIT 1), true);
  SELECT set_config('x.other_org', (SELECT id::text FROM public.organisations WHERE id <> current_setting('x.own_org')::uuid ORDER BY id LIMIT 1), true);
  INSERT INTO public.product_events (actor_id, project_id, organisation_id, event)
  VALUES (NULL, NULL, current_setting('x.own_org')::uuid, 'backfill_completed'),
         (NULL, NULL, current_setting('x.other_org')::uuid, 'backfill_completed');
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('x.owner'), 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*)::int AS n FROM public.product_events;
  ROLLBACK;" | jq -r '.[0].n')
  [[ "$XORG" == "1" ]] \
    && pass "org owner sees their OWN org's event and not the other org's (1 of 2)" \
    || fail "expected 1 of 2 rows visible, got $XORG — the read gate is not org-scoped"

  section "7. The cron job is scheduled and active"
  ACTIVE=$(mgmt_query "SELECT active FROM cron.job WHERE jobname='platform-metrics-weekly';" | jq -r '.[0].active // "missing"')
  [[ "$ACTIVE" == "true" ]] && pass "platform-metrics-weekly is scheduled and active" \
                            || fail "cron job is '$ACTIVE' — cloud-sync-poll all over again"

  echo ""
  if [[ "$FAILED" == "0" ]]; then echo "✓ ALL SMOKE TESTS PASSED"; exit 0; else echo "✗ SMOKE TESTS FAILED"; exit 1; fi
  ```

  ```
  chmod +x scripts/db/smoke-test-metrics-foundation.sh
  ```

  **Section 5's contrast is the control.** A contractor seeing 0 proves nothing on its own — an empty table also returns 0. The owner seeing 1 in the same transaction is what proves the zero was the *gate* and not a broken deploy. The pattern was exercised against production on 2026-09-10 on a throwaway probe table and returned exactly `contractor 0 / owner 1`, with `to_regclass` confirming zero residue after the rollback. **Section 6 applies the same logic one level deeper**: both rows exist in the same transaction, so `1` can only mean the org filter fired.

  ⚠ If section 6 reports `2`, the read gate is platform-wide and every organisation can read every other organisation's event stream. That is a stop-and-fix, not a note.

- [ ] **Step 3: Run it.**

  ```
  scripts/db/smoke-test-metrics-foundation.sh
  ```

  Expected: `✓ ALL SMOKE TESTS PASSED`.

- [ ] **Step 4: Walk `/metrics` from the empty state, not from a deep link.**

  In a browser signed in as an org `owner` on `www.e-site.live`:
  1. Land on `/dashboard`. **Adoption appears in the sidebar footer.** Click it — do not type the URL. An uploader that rendered correctly on a page nobody could reach passed verification once already.
  2. The page shows **"No snapshot yet"**, names the Monday 04:00 UTC job, and gives the `cron.job_run_details` query to run. This is the state a real first viewer sees, and it is the state the empty-state test pins.
  3. Sign in as `rbac-test@e-site.live` (a permanent production regression fixture, not a user — `CLAUDE.md`). **Adoption does not appear in the sidebar**, and navigating to `/metrics` directly bounces to `/dashboard`.

- [ ] **Step 5: Confirm the event writer and the presence writer both wrote real rows, end to end.**

  Raise one RFI through the UI on a real project, then:

  ```
  bash -c '. scripts/db/mgmt-api.sh; mgmt_query "
  SELECT event, effective_role, project_id IS NOT NULL AS has_project,
         properties->>'"'"'assignee_source'"'"' AS assignee_source, occurred_at
    FROM public.product_events ORDER BY occurred_at DESC LIMIT 5;"'
  bash -c '. scripts/db/mgmt-api.sh; mgmt_query "
  SELECT (SELECT count(*) FROM public.user_presence) AS presence_rows,
         (SELECT count(*) FROM public.user_sessions) AS session_rows,
         (SELECT max(last_active_at) FROM public.user_presence) AS last_active;"'
  ```

  Expected: one `rfi_created` row with a **non-null `effective_role`** and an `assignee_source` of `explicit`, `project_default` or `none`; and **`presence_rows >= 1`, `session_rows >= 1`** with `last_active` inside the last few minutes, written by the `(admin)` layout on the page loads you just made.

  A null `effective_role` means the stamp is inert and every role-split metric is decorative. `presence_rows = 0` means the layout call never fired and the baseline will be events-only. Both are stop-and-fix, not notes.

- [ ] **Step 6: Commit the smoke test.**

  ```
  git add scripts/db/smoke-test-metrics-foundation.sh
  git commit -m "test(db): smoke-test the metrics foundation against production, incl. cross-org isolation"
  ```

---

## Task 17 — Freeze the October baseline

**Files:**
- Create: `scripts/db/capture-metrics-baseline.sh`
- Create: `docs/metrics-baseline-2026-10.md`

⚠ **Run this on or after 1 October 2026.** The window is 2026-09-03 → 2026-10-01 (exclusive) — the four weeks to 30 September, twenty-eight days exactly, so `value` divided by four is a **weekly rate**. §13 item 1: not a cumulative all-time figure, because a weekly rate is the only thing a weekly target can be measured against. The function refuses an incomplete window (Task 12, Step 6), so running it early fails loudly rather than publishing a partial number.

- [ ] **Step 1: Write the capture script.**

  Create `scripts/db/capture-metrics-baseline.sh`:

  ```bash
  #!/usr/bin/env bash
  # Freeze the ONE baseline row per metric over the four weeks to 30 Sept 2026.
  # Idempotent by construction: platform_metrics_weekly_baseline_uk is a partial
  # unique index on (metric_key, method_version) WHERE is_baseline, so a second
  # run raises rather than quietly writing a second "frozen" answer.
  set -euo pipefail
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  . "$SCRIPT_DIR/mgmt-api.sh"

  echo "── freezing the baseline over 2026-09-03 → 2026-10-01 ──"
  mgmt_query "SELECT public.compute_platform_metrics_weekly(DATE '2026-09-03', DATE '2026-10-01', true) AS rows_written;" \
    | jq -r '"  rows written: \(.[0].rows_written)"'

  echo ""
  echo "| Metric | Numerator | Denominator | Value (weekly rate / ratio) | Status | Note |"
  echo "|---|---|---|---|---|---|"
  mgmt_query "
  SELECT metric_key, COALESCE(numerator::text,'—') AS n, COALESCE(denominator::text,'—') AS d,
         COALESCE(value::text,'—') AS v, status, COALESCE(note,'') AS note
    FROM public.platform_metrics_weekly WHERE is_baseline ORDER BY metric_key;" \
    | jq -r '.[] | "| `\(.metric_key)` | \(.n) | \(.d) | \(.v) | \(.status) | \(.note) |"'

  echo ""
  echo "── detail payloads (the bounds, recorded rather than rounded into numbers) ──"
  mgmt_query "SELECT metric_key, detail::text AS detail FROM public.platform_metrics_weekly
               WHERE is_baseline AND detail <> '{}'::jsonb ORDER BY metric_key;" \
    | jq -r '.[] | "  \(.metric_key): \(.detail)"'
  ```

  ```
  chmod +x scripts/db/capture-metrics-baseline.sh
  ```

- [ ] **Step 2: Prove the guard, then run it for real.**

  Before 1 October, running it must fail:

  ```
  scripts/db/capture-metrics-baseline.sh; echo "exit=$?"
  ```

  Expected: `refusing to freeze a baseline over an incomplete window (ends 2026-10-01, today is …)`, `exit=1`.

  On or after 1 October 2026, the same command writes **11 rows** and prints the markdown table.

- [ ] **Step 3: Record the baseline honestly.**

  Create `docs/metrics-baseline-2026-10.md` with the table the script printed, under this header — and **do not round a bound into a number**:

  ```markdown
  # Frozen baseline — the four weeks to 30 September 2026

  Window: **2026-09-03 → 2026-10-01** (exclusive), 28 days. `value` is a **weekly
  rate or a ratio**, never a window total. One row per metric, `is_baseline = true`,
  `method_version = 1`, enforced unique by `platform_metrics_weekly_baseline_uk`.
  Captured by `scripts/db/capture-metrics-baseline.sh`. Never rewritten: a changed
  definition writes new rows under a new `method_version`.

  Cohorts are frozen at `as_of = 2026-09-09` and are never recomputed. The rollup
  filters on that `as_of` explicitly, so a second freeze cannot silently double a
  denominator.

  **Active means: a `user_sessions` row touched in the window, OR a first-party
  `product_events` row, OR a write to any source table** — `site_diary_entries`,
  `snags`, `qc_entries`, `rfis`, `rfi_responses`, `inspections`, `form_responses`,
  `reports`. The third clause is what makes this baseline measurable at all: the
  presence writer landed with this item and the source mirrors land with Q1 item 3,
  so an events-only definition would have published **0 / 23** and **0 / 12** for a
  window in which five people demonstrably used the product.

  ## Metrics with no honest baseline — the bound is recorded rather than a number invented

  | Metric | Why | What is published instead |
  |---|---|---|
  | 4 — median working days to respond on RFIs | `projects.work_item_events` does not exist before Q1 item 2, and **10 of 15 live RFIs have no `rfi_responses` row** (measured: 15 RFIs, 5 response rows, 5 distinct RFIs answered). The median over items *raised* is censored and **not retrospectively recoverable**. | `status = 'censored'`, with `detail.rfis_total`, `detail.answered_ever` and `detail.response_rows`. The measurable statement is **answered-ever = 5/15 = 33%**. |
  | 5 — inbox engagement | `public.notifications.read_at` has existed since `00001_initial_schema.sql:151` and **nothing has ever written it** — the only writers set `is_read` alone (`components/ui/NotificationCentre.tsx:52-55`, `:62`). `public.inbox_state` does not exist until Q1 item 8. The rate under §15's definition is **unmeasurable before the release**. | `status = 'unmeasurable'`, `value = NULL`, with `detail.is_read_true_all_time` (57) and `detail.created_all_time` (964) recorded as **the pathology, not the baseline**. 5.9% is not a number to beat. |
  | 7 — activation | Needs `public.user_sessions` × `projects.work_item_events`; the second lands with Q1 item 2. | `status = 'not_yet_instrumented'`, `value = NULL`. |

  ## Two that read zero on purpose

  - **6 — report schedules per project.** `projects.report_schedules` does not exist until Q3, so a non-zero target is unattainable by construction. `status = 'not_yet_instrumented'`, value 0, with the count of active projects (10) as the denominator.
  - **8 — signed paying organisations.** E-Site has never charged anyone. `billing.org_feature_unlocks`, `billing.org_feature_seats` and `billing.user_mv_subscriptions` are all empty in production, and neither live subscription row carries a `paystack_subscription_code`. `status = 'measured'`, value 0. **Publishing a commercial metric that reads zero for two quarters is the point** — it stops the programme being justified retrospectively by a number invented at the end of it.

  ## Three measured discrepancies against §15's table

  1. **Metric 2a's cohort is 12, not 13.** Thirteen accounts hold a contractor role; one of them is `rbac-test@e-site.live`, which `public.metric_accounts` excludes by the rule §15 §(a) itself sets. The frozen cohort is the twelve real accounts. The target restated on that denominator: **6 of 12 (50%)** at Q1, not 6 of 13. `METRIC_TARGET_Q1` in `packages/shared/src/lib/analytics/product-events.ts` carries the corrected string, so the page and this document cannot disagree.
  2. **One contractor account sits on `esite-demo.co.za`** (two accounts on that domain in total) and is *not* covered by the `rbac-test` / `%probe%` exclusion rule as written. It is reported here as a diagnostic rather than by widening the rule, because a second exclusion list is a second source of truth. The rule itself lives in `public.metric_account_excluded(text)`, so **if the owner decides to exclude it, that is one `CREATE OR REPLACE` in one place** with the reason as a comment beside it.
  3. **There is now an eleventh metric, `client_active`.** §15's eight carried no client measure at all, and §15 §(c) puts client viewers in Wave 3 (Q3) — so Q3's portal rebuild would have been judged against a baseline first computed in the quarter it shipped. The client-viewer cohort is frozen at **4**. A low figure here through Q1 and Q2 is a fact about the programme's sequence, not about clients: no client wave runs before Q3, and `client_viewer` is redirected to `/portal` before the `(admin)` layout's presence call, so client sessions are not recorded until the portal gets its own call in Q1 item 4.

  ## Everything the emails cannot tell us

  **246 automated emails have been sent across all 36 accounts** — four onboarding plus three re-engagement each — and `opened_at` and `clicked_at` are **NULL on every single row** of `public.email_sequence_events`. That zero is a **measurement gap, not a behaviour measurement**: `00030_email_sequences.sql:24-25` comments both columns "populated by Resend webhook (Phase 2)", Phase 2 never shipped, there is no Resend webhook route anywhere under `apps/web/src/app/api/`, and nothing in the monorepo writes either column. `resend_message_id` is populated on **235** of the 246, so Resend accepted them. The `reengagement-check` cron (job 6, `20 1 * * *`) has run **144 times with 144 successes**, most recently 2026-09-10, so the mail was sent.

  **E-Site has never measured whether one of its emails was opened, and the entire Q1 outcome is delivered over email** — the 07:00 recap is item 7, and both the contractor and client waves start with one. Without open data, "they did not come back" cannot be separated from "it went to spam" or "the address is dead", and those three have completely different remedies. The gap is published on `/metrics` in `inbox_engagement.detail` (`emails_sent_all_time`, `emails_with_open_evidence`, `emails_accepted_by_resend`) so it is visible from week one rather than only here.

  **Recommended owner: Arno's lane, at wk 0, beside item 14.** One route verifying the Resend webhook signature — reusing the `standardwebhooks` verification the `auth-email-hook` edge function already runs — and writing `opened_at` / `clicked_at`. It depends on nothing. It is the same class of defect as `notifications.read_at`: a column provisioned for a later phase that nothing ever writes.
  ```

- [ ] **Step 4: Confirm `/metrics` now shows the baseline column populated.**

  Reload `/metrics` as an org owner. The **Sept-2026 baseline** column carries a value for `weekly_active`, `contractor_active_frozen`, `contractor_active_all`, `client_active`, `diary_same_day`, `notifications_created` and `paying_organisations`, and `—` with a `no honest number yet` badge and a `note` for the other four. **An unmeasurable metric must not render as 0.0%** — that is what the fourth page test pins.

- [ ] **Step 5: Confirm the weekly job actually fired on its own.**

  On the first Monday after the merge, after 06:00 SAST:

  ```
  bash -c '. scripts/db/mgmt-api.sh; mgmt_query "
  SELECT iso_year, iso_week, window_start, count(*) AS metrics, max(captured_at) AS captured
    FROM public.platform_metrics_weekly WHERE NOT is_baseline
   GROUP BY 1,2,3 ORDER BY window_start DESC LIMIT 3;"'
  ```

  Expected: a row for the previous ISO week with `metrics = 11`.

  **If it is absent, check TWO things in this order.** First — and this is the failure this plan was rewritten to prevent — a `CHECK` violation aborts the whole `INSERT` and writes zero rows, which is indistinguishable from a job that never ran:

  ```
  bash -c '. scripts/db/mgmt-api.sh; mgmt_query "
  SELECT status, return_message, start_time
    FROM cron.job_run_details
   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = '"'"'platform-metrics-weekly'"'"')
   ORDER BY start_time DESC LIMIT 5;"'
  ```

  A `return_message` naming `platform_metrics_weekly_measured_has_value` means a ratio arm hard-coded `'measured'` over a zero denominator — fix the arm, do not touch the scheduler. Only if the run rows are absent entirely is it the `cloud-sync-poll` failure: specified, merged, never scheduled, discovered two months late by a user complaint.

  If `metrics < 11`, an arm was dropped: the snapshot is the run ledger and every metric must write a row on every tick.

- [ ] **Step 6: Commit.**

  ```
  git add scripts/db/capture-metrics-baseline.sh docs/metrics-baseline-2026-10.md
  git commit -m "feat(metrics): freeze the four-week September-2026 baseline, with its unmeasurable cells stated"
  ```

---

## Definition of done

- [ ] `pnpm --filter @esite/shared test`, `pnpm --filter @esite/shared type-check`, `pnpm --filter web test`, `pnpm --filter web type-check`, `pnpm --filter web lint` all green.
- [ ] `node --experimental-strip-types scripts/verify-migration-applied.ts` returns green against production and reports **50** directives for this migration, and has been **seen to fail** on both halves: a version absent from the ledger, and a directive returning false — including a *two-argument* function directive.
- [ ] `scripts/db/smoke-test-metrics-foundation.sh` returns `✓ ALL SMOKE TESTS PASSED`, including the contractor-0 / owner-1 contrast **and** the cross-org 1-of-2 proof.
- [ ] Every mutation in the PR-body table has a before/after failure count filled in. Adjectives do not count. **The `diary_same_day` row in particular must record that reintroducing the literal `'measured'` aborts the entire INSERT and writes zero rows.**
- [ ] `cron.job` shows `platform-metrics-weekly` **active**, and a real weekly row with `metrics = 11` has landed on its own.
- [ ] `/metrics` was reached **from the sidebar on an empty database**, not by typing the URL against seeded rows; and `public.user_presence` holds a row written by that visit.
- [ ] `docs/rbac-matrix.md`, `CONFORMANCE.md` and Appendix A(f) all moved in the same PR as the route, the grants and the new objects.
- [ ] `docs/metrics-baseline-2026-10.md` records three unmeasurable metrics as unmeasurable, two zeroes as zero by design, three discrepancies against §15, and the email-delivery gap. No bound has been rounded into a number.

## What this item deliberately leaves for later

| Left undone | Owner |
|---|---|
| The 60-second presence heartbeat, the `es_seen` middleware fallback, and a presence call from `/portal` (so client sessions are recorded) | Q1 item 4 — this item creates the objects and gives them one real writer in the `(admin)` shell; item 4 is their consumer (§13 item 4). |
| `public.auth_events.session_id` | Q1 migration 9, which is also where the backfill-completion `product_events` row is written, because that is what it records. |
| Metrics 4, 5 and 7 becoming measurable | Q1 items 2, 4 and 8. Each writes new snapshot rows at `method_version = 2`; none rewrites history. |
| Retiring the `assignee_source` diagnostic at `rfi.actions.ts:69` | Q1 item 2 — once assignment is mandatory it can only ever report `explicit`. |
| Product events on snag / QC / diary / form / inspection creation | Q1 item 3, with the source mirrors. This item covers the ten sites that already call `trackServer` — and, crucially, counts the *rows* those five surfaces write via `_active`'s source-table union, so the metric is honest in the meantime. |
| The scheduled-estate panel on `/metrics` (nine ledgers, last-run times) | Q1 item 13 — eight of the nine ledgers do not exist yet. The staleness banner covers the one that does. |
| Revoking `anon` EXECUTE on `public.user_is_org_admin(uuid)` | Its own change. It alters the evaluation of three live RESTRICTIVE policies. |
| **§12 §(h) test 8 — diffing the union of all `@verify` blocks against Appendix A(f) in both directions** | **Unowned.** Item 0's plan cites it and item 0 does not build it; this plan does not either. Task 4 builds test 5 only, which enforces that a block declares what its own file creates. Until someone owns test 8, registering a new object in A(f) is a review discipline. |
| A Resend webhook writing `opened_at` / `clicked_at` | **Recommended: a separate Q1 item in Arno's lane at wk 0**, beside item 14 — it depends on nothing, and it is the only way to tell "they did not come back" apart from "it went to spam". The measurement gap is published on `/metrics` in the meantime. |
| Deciding whether `esite-demo.co.za` belongs in the exclusion rule | Arno. The mechanism is one `CREATE OR REPLACE` of `public.metric_account_excluded(text)`; the decision is a product one, reported as a diagnostic in the baseline document. |
