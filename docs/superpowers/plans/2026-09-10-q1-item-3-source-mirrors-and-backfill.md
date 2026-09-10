# Source Mirrors and the Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Project six existing module sources into `projects.work_items` by database trigger, write assignment and due date back to `projects.rfis` and `field.snags` so every existing reader and PDF keeps working untouched, and back-fill the live estate once — without creating a single work item from `structure.node_orders`, without projecting a diary entry that says "None", and without rewriting `updated_at` on a single live source row.

**Architecture:** One migration (Appendix A(f)'s Q1 **ordinal 9**) creates twenty-four functions and twenty-one triggers (thirteen projection, two write-back, six delete-to-void), then runs the data backfill in the same transaction under `SET LOCAL esite.suppress_notifications = 'on'`, and records its own completion into `public.product_events`. Each source has **two** functions: a plain `projects.project_<type>(uuid)` that does the projection, and a thin trigger wrapper that carries the recursion guard and calls it — so the backfill invokes the projection **directly** and never touches a source row. Source tables stay the system of record for their own content and status; the spine owns assignment, gatekeeper, due date, ball-in-court and the five universal states. Projection is idempotent through Appendix A(a)'s partial `UNIQUE` per source column, so triggers land before the backfill and a retry is free.

**Tech Stack:** PostgreSQL 17 (Supabase project `cbskbnvvgcybmfikxgky`), plpgsql triggers, Supabase Management API `/database/query` for rolled-back rehearsals, vitest contract tests parsing SQL text (the `apps/web/src/lib/snag-photo-type.contract.test.ts` pattern), `tsx` for scripts.

**Spec:** §13 item 3 (Q1, Arno's lane, 1.5 engineer-weeks, off the critical path) · §03 §1.2 (mirrored spine, loop suppression, trigger privileges, delete-to-void) · §03 §1.5–§1.6 (resolution chain, triage) · §03 §1.8 (status, gatekeeper, watchers) · §03 §1.10 (what breaks, and the backfill) · §12 §(c) hard dependency 5 · §12 §(d) (backfills) · §12 §(h) (the eight tests and the fixture-quality rule) · Appendix **A(a)** (the authoritative `work_items` DDL, constraint set and index set), **A(b)** (types, sources, due offsets, calendars, gatekeepers), **A(f)** (the Q1 migration ledger and object inventory), **A(h)** (the working-day calendar).

**Depends on:** **Item 2 (work-item spine)** and **item 6 (`project_settings` column adds)**, both **applied to production** — merged is not enough (see the blocking precondition below). Concretely this plan reads, and does not create:

| From | Object | Why this plan needs it |
|---|---|---|
| A(f) ord. 1 | `projects.public_holidays`, `projects.calendar_years`, `projects.working_days_between(timestamptz,timestamptz,uuid,text)` | item 2's `due_date` trigger raises `no_data_found` without a seeded year |
| A(f) ord. 1 | `public.product_events` (columns `occurred_at, actor_id, project_id, organisation_id NOT NULL, event, effective_role, session_id, properties`) | section I writes the backfill-completion row into it |
| A(f) ord. 2 | `public.notification_types` row for `work_item_assigned` | a trigger that emits an unregistered type writes **no row and no error** |
| A(f) ord. 6 | `projects.project_settings.triage_owner_id`, `.work_item_defaults`, **`.suppress_all_outbound`** | the resolution chain, and the outbound-mail gate §12 §(d) requires on every project touched by a write-back |
| A(f) ord. 7 | `projects.work_items` with A(a)'s full constraint set, the `ref` allocator, the `due_date` `BEFORE INSERT` trigger, the assignee-membership trigger, the `work_item_events` append trigger and its `esite.suppress_notifications` GUC | the whole spine |
| A(f) ord. 7 | `projects.work_item_types` with the six mirrored A(b) keys registered | `item_type` is an FK to it |
| A(f) ord. 7 | `projects.work_item_watchers` **with `UNIQUE (work_item_id, user_id)`** | `seed_work_item_watchers` uses that as an explicit `ON CONFLICT` target |
| A(f) ord. 7 | One partial `UNIQUE` per source column, `WHERE <col> IS NOT NULL AND origin = 'mirror'` | the `ON CONFLICT` target that makes projection idempotent |
| A(f) ord. 7 | **The gatekeeper `BEFORE UPDATE` guard must exempt `pg_trigger_depth() > 0`** | see F8 — without it a contractor closing their own RFI aborts the RFI close in production |

**`auth_events.session_id` is NOT in this plan.** A(f)'s ordinal-9 sentence books it here; §12 §(c) line 121 books it with the metrics migration ("a column add on an existing table and it rides with that migration too"). §12 §(c) is the later and more specific ruling and this plan follows it. Task 18 Step 5 amends A(f) so the two stop disagreeing.

---

## ⛔ Blocking precondition — read before Task 1

**The only test surface in this plan is a rolled-back transaction against production.** There is no local Postgres in this repository's test loop and no pgTAP. That means:

> **Nothing below Task 2 is executable until A(f) ordinals 1, 2, 6 and 7 are APPLIED TO PRODUCTION. Item 2 merged is not enough — `supabase db push` must have run and `projects.work_items` must exist on `cbskbnvvgcybmfikxgky`.**

Task 2 Step 2 is the gate that measures this. If it fails, stop: write the blocker down, do not "work around it" by stubbing the spine, and do not proceed to Task 3.

The harness's `--with` flag is **repeatable** (Task 1) precisely so that, in an unapplied window, you can stack ordinals 1/6/7's migration files ahead of this one and at least *develop* against them. That is a development convenience only. **Acceptance — every mutation verification, the full rehearsal, the scale run — is against production with the dependencies really applied.**

---

## Improvements folded in

Twelve changes came out of the product review and are built into the tasks below as real code, not as notes. Each was measured against production on 2026-09-10.

| # | Change | Task | Why it is in, not deferred |
|---|---|---|---|
| 1 | **Diary negation stop-list, and the diary backfill projects nothing.** `projects.diary_delay_text()` returns NULL for `none / none. / none, / no / n/a / na / nil / nothing / - / 0`; the backfill arm is dropped entirely | 10, 14 | All **6 of 6** live "delays" are negations: `"None"`, `"None,"` ×2, `"None"`, `"NO"`, `"No delays or info required was noted in the site walk and or meeting"`. The predicate measured whether a text box was filled, not whether a delay happened. Shipped as written, day one puts six items titled `Delay 2026-06-24: None,` in the owner's inbox |
| 2 | **The E-Site DEMO organisation is excluded from every backfill arm** (`e51ede00-0000-0000-0000-000000000001`) | 14 | All **6 of 6** snags are seeded demo rows: identical `created_at` of 2026-07-06, all raised by `Sipho Dlamini (Demo Contractor)`, on a project whose creator resolves to `contractor`. Backfilling them puts six fabricated defects on a demo contractor's ball-in-court and pollutes metric 2a's numerator with a fixture account. The snag spine goes live **empty**; the live trigger still works |
| 3 | **The day-one distribution is asserted by person and published before apply** | 14, 17, 19 | A type-count probe passes cleanly against a distribution that fails the product. §15's own diagnostic: "an empty inbox cannot be driven to zero, and neither can a forty-item one" |
| 4 | **The RFI gatekeeper is the raiser, not the project PM** | 5, 18 | 13 of 14 projects were created by the same person, so `triage_owner_id` and the PM resolver both return him; assignee and gatekeeper would be the same person on all 15 RFIs and §03 §1.8's "only the gatekeeper may close" would be vacuous for the type that matters most. 12 of 15 RFIs were raised by contractors. This is the only mechanism in Q1 that puts an item in a contractor's ball-in-court |
| 5 | **Location goes into the snag title; the parent report goes into the `qc_defect` title** | 7, 9 | **6 of 6** live snags carry a location (`Floor 7 — DB Room`, `Basement — MCC Panel`, `Levels 3–5 — Steel`) and **0 of 6** carry a floor-plan pin. The title is all that travels into the 07:00 recap |
| 6 | **A projected item may never arrive already overdue** — `projects.work_item_mirror_due_date()` passes a past source date through as NULL so item 2's trigger computes the type's own offset on the type's own calendar | 5, 8 | Live RFI due dates are 0–3 calendar days after creation (`Drawings`: created **and due** 2026-07-23). **15 of 18** inspections have `scheduled_at` in the past. The backfill already floors history for this reason; the live path must too |
| 7 | **`client_viewer` is excluded from every resolver step** | 3 | Every step accepted any candidate with a non-null effective role, and all **4** live `client_viewer` accounts pass that test. §03 §1.9 defers their write set to Q3, and `work_items_bic_present` keeps the row pointing at them — an inbox that can never reach zero |
| 8 | **Every mirror trigger watches `project_id` and `organisation_id` and re-resolves people on a move** | 5–11 | §15's rollout section has already decided "snags move to KINGSWALK". As written the item stays on the demo project forever: wrong counts on both project homes, wrong SELECT scope, an assignee resolved against a project they are not a member of |
| 9 | **The write-back skips `closed` and `void` records; the due-date floor skips them too** | 6, 14 | **6 of 15** RFIs are already closed. Stamping `assigned_to` on them makes the RFI page render "Assigned to: Arno Mattheus" on a record nobody was ever assigned — the site-forms `as_left_status` lesson exactly |
| 10 | **Projection goes through `projects.project_<source>(uuid)`; the backfill never runs `UPDATE … SET status = status`** | 5–11, 14 | Every one of the six source tables carries a `BEFORE UPDATE set_updated_at` trigger (verified in `pg_trigger`). A no-op UPDATE rewrites `updated_at` on ~40 live rows (RFI `updated_at` currently spans 24 Jun – 2 Sep) with no snapshot. It also makes the site-form arm depend on `current_user = 'postgres'` escaping `enforce_site_form_transition` (`00179:353`) |
| 11 | **`due_date` is written back to `projects.rfis`, not only `assigned_to`** | 6 | §04 makes re-dating a first-class keyboard verb and §03 §1.6 one of triage's three actions. Without this the RFI page, the RFI PDF and the Inbox give three answers to "when is this due", on the module carrying headline metric 4 |
| 12 | **A human confirms the fourteen resolved triage owners before the backfill runs** | 19 | `resolve_project_pm` takes the **oldest** active `project_manager` row. SAXBY has 4 such rows, PNP FAERIE GLEN 4, KINGSWALK 3 — so on the three densest projects the recipient of every unowned item is decided by membership creation order, invisibly |

## Deferred improvements

| Improvement | Recommendation | One-line reason |
|---|---|---|
| **`order_followup` has no producer anywhere in Q1** — A(b) registers the type with "explicit chase only, one control on the order line", and no Q1 deliverable builds that control, so a live module with 440 rows contributes nothing to any inbox for the whole quarter | **later-quarter** (Q4, beside `lead_time_days`) | A UI control + server action + rbac-matrix row + notification path is not free, Arno's lane has 0.5 weeks of float, and item 3 is third on the cut list; the phone shell is worth more to the quarter's stated outcome |
| **Seed `client_viewer` project members as watchers on every mirrored item** | **reject** | Reproduces the fan-out that made 750 of 964 notifications `diary_created` at a 5.9% read rate, and A(c) puts those types on the Recap tier — so a client would get a 07:00 email listing work they hold no verb over until Q3. §04 is explicit that the portal's job is "since your last visit", not a second inbox |
| **A "why is this mine?" explainer on the item, showing which resolver step chose the holder** | **q1-separate-item** (fold into item 4's Inbox row if it is cheap there) | Real value once 34 items land on four people, but it is an Inbox-surface change and this item ships no UI |

---

## Ten measured findings that correct the spec. Read these before Task 1.

Each has a task that implements it and a test that fails when it is undone. Do not "simplify" any of them back to what the spec text says. F1–F6 were proved against production on 2026-09-10 inside rolled-back transactions; F7–F10 are corrections raised in review and re-derived here against the real tree and A(a)'s authoritative DDL.

**F1 — the delete-to-void trigger must be `BEFORE DELETE`, and with `AFTER DELETE` the DELETE does not merely orphan the item, it *fails*.** §03 §1.2 says "an `AFTER DELETE` trigger on each source sets the orphaned item `status = 'void'`". The `ON DELETE SET NULL` referential action runs *before* a user `AFTER DELETE` trigger, so the `AFTER` form's `UPDATE … WHERE rfi_id = OLD.id` matches nothing. But A(a)'s `work_items_source_required` — `item_type IN ('task','approval') OR status = 'void' OR <exactly one source FK non-null>` — is re-evaluated on the RI `SET NULL` update, and at that moment the item is still `status='open'` with zero sources. **The DELETE therefore aborts with `23514 … "work_items_source_required"`.** Consequence: with `AFTER DELETE`, `deleteDiaryEntryAction` (`apps/web/src/actions/diary.actions.ts:109`) and every RFI and snag delete break outright once a mirror item exists. With `BEFORE DELETE` the item is already `void` when SET NULL fires, both that CHECK and `work_items_bic_present` pass on their `void` arms, and the delete proceeds. ⚠ **An earlier probe of this reported a silently-orphaned open item; that probe ran against a synthetic table lacking the CHECK and its result is withdrawn.** Task 12 Step 5 measures the real thing against item 2's table and records the SQLSTATE. Task 12.

**F2 — the write-back trigger must NOT carry the `pg_trigger_depth() > 1` guard.** §03 §1.2 says "every trigger function returns immediately when `pg_trigger_depth() > 1`". Applied uniformly that is measurably wrong. Probe with the uniform rule: `src.assigned_to` stays `<null>` while the work item says `TRIAGE-OWNER` — the exact "the RFI page renders nothing" failure the write-back exists to prevent. Probe with the guard on the mirror only: both converge, trace `mirror@1 → writeback@2 → mirror@3 → skipped`. The depth guard on the **mirror** is what terminates the cycle; removing only the value-difference check still terminates. Removing both produces `ERROR: 54001: stack depth limit exceeded`. Task 6.

**F3 — the resolution chain must terminate at `projects.projects.created_by`, not at the org owner.** §03 §1.6 and §12 §(d) both say every chain "terminates at the org owner". Measured: of 14 projects the §03 §1.5 four-step PM rule resolves 13 and returns **NULL** for `Sandton City Office Tower — DB Upgrade (Demo)`, whose organisation (`E-Site DEMO`, `e51ede00-…-0001`) has **no owner, no admin and no project_manager** — only a `contractor` and a `client_viewer`. `projects.projects.created_by` is `NOT NULL` and resolves there to a user whose `user_effective_project_role` is `contractor`, so item 2's assignee-membership trigger accepts them. Without this fifth step the **live mirror raises on every snag insert for that org**, breaking snag creation permanently. ⚠ **Accepted consequence, recorded rather than hidden:** on that project the gatekeeper is a contractor — plausibly the same person who raised the snag, which §03 §1.5 forbids for snags. The fifth step is kept because a broken insert is worse than a wrong gatekeeper on a demo project, and improvement 2 removes the demo project from the backfill so no live item is created that way. Task 3.

**F4 — `qc_defect` back-fills ZERO rows today, and its projection needs a trigger on `projects.qc_reports` as well as on `projects.qc_entries`.** The brief's "11 qc_entries" counts entries on issued/closed reports, not failed ones. Measured: `SELECT conformance, severity, report_status, count(*)` over the join returns exactly one group — `{conformance:"na", severity:null, report_status:"issued", count:11}`. **`conformance='fail'` has zero rows in the whole database.** So a fixture drawn from live data could never fail; Task 14 builds a synthetic one. Separately, the entry-level trigger alone can never bring a row into scope: an entry is authored while its report is `draft` and enters scope when the **report** transitions to `issued` — an `UPDATE` on `qc_reports`. Task 9.

**F5 — trigger functions need `REVOKE`, and no `GRANT` at all.** Measured in a throwaway schema: a trigger fired for a caller holding no `EXECUTE` on its function (`{trigger_fired:1, auth_execute:false, anon_execute:false}`). Function privileges on a trigger function are checked at `CREATE TRIGGER` time, not at fire time. Every function here is called only from inside a trigger or from another `SECURITY DEFINER` function owned by the same role, so the correct posture is `REVOKE ALL … FROM PUBLIC` plus an explicit `REVOKE … FROM anon`, and `GRANT` to nobody. Task 13.

**F6 — idempotency needs an explicit partial-index conflict target, and a bare `ON CONFLICT DO NOTHING` is dangerous.** Measured: an explicit `ON CONFLICT (rfi_id) WHERE rfi_id IS NOT NULL AND origin = 'mirror' DO NOTHING` swallows a duplicate mirror projection, leaves a deliberate `origin='split'` row on the same source untouched, **and still raises `23505 … "work_items_ref_unique"` on a `ref` collision** — which a bare `ON CONFLICT DO NOTHING` would have silently swallowed, turning a numbering race into a missing inbox item. `work_items_ref_unique` is A(a)'s name and is the one to match on; the per-source partial indexes are unnamed in A(a) and their real names are read out of item 2's migration in Task 15, never invented. Task 5.

**F7 — §03 §1.2's mandated trigger declaration is not valid PostgreSQL, so each source gets TWO triggers.** §03 §1.2 line 49 is normative: "declared `AFTER INSERT OR UPDATE … FOR EACH ROW WHEN (OLD.<col> IS DISTINCT FROM NEW.<col>)`". PostgreSQL rejects a `WHEN` clause referencing `OLD` on a trigger whose event list includes `INSERT` (`ERROR: 42P17: INSERT trigger's WHEN condition cannot reference OLD values`). The intent — never fire on an unrelated write — is honoured by splitting each source into `<table>_mirror_work_item_ins` (`AFTER INSERT`, no `WHEN`) and `<table>_mirror_work_item_upd` (`AFTER UPDATE OF <cols>` with the mandated `WHEN`). Thirteen projection triggers result: six sources × 2, plus `qc_reports_mirror_defects`. **This is also why the backfill cannot use a no-op `UPDATE`**: with the `WHEN` predicate in place, `UPDATE … SET status = status` fires nothing at all. Improvement 10's `project_<source>(uuid)` functions are what the backfill calls instead. Tasks 5–11, 14. Spec corrected in Task 18.

**F8 — the mirror's own status push-back must be exempted from item 2's gatekeeper `BEFORE UPDATE` guard, and that is a requirement ON ITEM 2.** The mirror is `SECURITY DEFINER`; the house pattern for a transition guard is `SECURITY INVOKER` reading `auth.uid()` (`00179`'s `enforce_site_form_transition`, `00172`'s `qc_reports_status_guard`) — and inside a `SECURITY DEFINER` mirror, `auth.uid()` is still the contractor who changed the source row. So a contractor closing their own RFI would drive `work_items.status → 'closed'` and the guard would raise, **aborting the RFI close in production**. The exemption chosen here is `pg_trigger_depth() > 0`: any status change arriving from inside another trigger is a projection, and the authority for it was already checked on the source row. Item 2 must ship that exemption; section A asserts it and probe 04 proves it. Task 2, Task 5.

**F9 — the Management API `/database/query` endpoint runs as `postgres` with `rolbypassrls = true` and `auth.uid()` NULL** (measured 2026-09-10). Every probe in this plan therefore executes with RLS bypassed and no identity, which means **no probe can fail on an authorisation defect** unless it deliberately assumes one. Applying the fixture-quality rule: remove `SECURITY DEFINER` from every mirror and every probe in the original plan still passed. Task 16 adds the one probe that runs as a real non-privileged user and can see the difference. This is also why the migration is safe to apply through `db push` (also `postgres`) and why the site-form arm of the old backfill "worked".

**F10 — `field.site_forms.created_by` is `UUID NOT NULL DEFAULT auth.uid()` (`00179:83`), so `NEW.created_by IS NOT NULL` is a tautology.** Decided rather than left ambiguous: a site form **is** the thing its author must finish, so its author is an explicit assignee and the item is born `open`, not `triage`. The tautological predicate is replaced with a literal `true` and a one-line reason, and probe 10 asserts `= 'open'` rather than `IN ('triage','open')` so the decision is pinned. Task 11.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/edge-functions/supabase/migrations/<NNNNN>_work_item_source_mirrors_and_backfill.sql` | **Create.** The whole item, in one file, in nine lettered sections: (A) `-- @verify:` header and pre-flight assertions, (B) resolvers, (C) status mapping, due-date and diary-delay helpers, (D) the six `project_<source>()` bodies plus seven trigger wrappers and thirteen triggers, (E) the assignment + due-date write-back, (F) the six `BEFORE DELETE` void triggers, (G) grants and `anon` revokes, (H) the pre-migration snapshot and the backfill under notification suppression, (I) the backfill-completion `product_events` rows and post-conditions. Number claimed at merge, never now. |
| `scripts/db/rehearse-sql.ts` | **Create.** The harness every test in this plan runs through: concatenates `BEGIN;` + one or more `--with` files + a probe file + `ROLLBACK;` into one Management-API request, prints the assertion rows, refuses any input containing `COMMIT`, and **fails when no assertion rows come back**. |
| `scripts/db/probes/*.sql` | **Create.** One assertion file per task — the executable tests. Committed, because they are the regression suite for a layer vitest cannot reach. Every probe has exactly **one** row-producing statement, and it is the last one. |
| `apps/web/src/lib/work-items/source-status-map.contract.test.ts` | **Create.** Parses each source table's own status `CHECK` out of its migration — anchored on `CREATE TABLE <schema>.<table>`, never on the first CHECK in the file — and asserts `projects.map_source_status` carries an arm for every value; asserts every non-null result is a member of the `work_items` status `CHECK`. |
| `apps/web/src/lib/work-items/mirror-triggers.contract.test.ts` | **Create.** Asserts F1 (every void trigger is `BEFORE DELETE`), F2 (every `project_<source>` wrapper carries the depth guard; the write-back does not), F7 (every source has an `_ins` and an `_upd` trigger and the `_upd` carries a `WHEN`), that the diary stop-list exists, and that no trigger anywhere names `structure.node_orders`. |
| `docs/rbac-matrix.md` | **Modify.** New subsection under "Server actions" recording that a work-item reassign or re-date now writes source columns through a `SECURITY DEFINER` trigger that bypasses those tables' RLS. |
| `CONFORMANCE.md` | **Modify.** New row **C12** under `## C. Provisioning & database`, per the file's own same-PR rule. |
| `docs/superpowers/specs/2026-09-09-v2-platform-roadmap/16-appendix-registries.md` | **Modify.** A(f)'s Q1 row gains the twenty-four functions and the snapshot table; A(f)'s ordinal-9 sentence gains `qc_reports` and loses `auth_events.session_id`; A(b)'s `rfi` gatekeeper cell changes to the raiser. |
| `docs/superpowers/specs/2026-09-09-v2-platform-roadmap/03-work-items.md` | **Modify.** §1.2 corrected: `BEFORE DELETE`, and the two-trigger declaration that PostgreSQL actually accepts. |
| `docs/superpowers/specs/2026-09-09-v2-platform-roadmap/12-data-model-and-migrations.md` | **Modify.** §(c) hard dependency 5 gains the `qc_reports` entry point; §(d)'s RFI chain gains `default_rfi_assignee_id`'s real position. |

---

## Task 1 — The rehearsal harness

There is no local Postgres in this repository's test loop and no pgTAP. The house pattern since PR #135 is a rolled-back transaction against production through the Management API, and every task below runs its test that way. Build the harness first so "watch it fail" is a real command from Task 2 onward.

**Probe file contract, enforced by the harness.** Every probe file is:
1. Zero or more `DO $…$ … END $…$;` blocks that build fixtures, perform mutations, and record observations into `TEMP TABLE … ON COMMIT DROP`; then
2. **exactly one** row-producing statement — a `SELECT … UNION ALL …` with the columns `probe text, ok boolean, detail text` — and it is the **last** statement in the file.

The Management API returns rows from the **last row-producing statement only**. Measured: `SELECT 1 AS first_sel; SELECT 2 AS second_sel;` returns `[{"second_sel":2}]`. A probe that ends in a `DO` block, or that concatenates two assertion `SELECT`s, silently discards assertions — which is why the harness fails on zero rows and on rows without the three columns.

**Files:**
- Create: `scripts/db/rehearse-sql.ts`
- Test: `scripts/db/probes/00-harness-selftest.sql`

- [ ] **Step 1: Confirm the credential path works.** The Management API PAT lives in the macOS keychain; `scripts/import-templates-to-staging.ts:6` establishes `SUPABASE_PAT` as this repo's env-var name.
  ```bash
  RAW=$(security find-generic-password -s "Supabase CLI" -w)
  if [[ "$RAW" == go-keyring-base64:* ]]; then
    export SUPABASE_PAT=$(echo "${RAW#go-keyring-base64:}" | base64 -d)
  else export SUPABASE_PAT="$RAW"; fi
  echo "${SUPABASE_PAT:0:4} len=${#SUPABASE_PAT}"
  ```
  Expected: `sbp_ len=44`.

- [ ] **Step 2: Write the self-test probe first, and make it a failing one.** Create `scripts/db/probes/00-harness-selftest.sql`:
  ```sql
  -- Deliberately failing assertion. Step 4 flips it.
  SELECT 'harness'         AS probe,
         (1 = 2)           AS ok,
         'expected true'   AS detail;
  ```

- [ ] **Step 3: Write the harness.** Create `scripts/db/rehearse-sql.ts`:
  ```ts
  /**
   * rehearse-sql.ts — run SQL against production inside a transaction that is
   * ALWAYS rolled back, and print the assertion rows.
   *
   * Usage:
   *   SUPABASE_PAT=… pnpm tsx scripts/db/rehearse-sql.ts <probe.sql> [--with <a.sql>] [--with <b.sql>]
   *
   * --with is REPEATABLE and applies each file first, in the order given, in the
   * same transaction — so a probe can assert against objects that do not exist on
   * production yet (stack A(f) ordinals 1/6/7 ahead of this migration in an
   * unapplied window). Nothing is ever committed: the harness appends its own
   * ROLLBACK and refuses any input containing COMMIT.
   */
  import { readFileSync } from 'node:fs'

  const PROJECT_REF = 'cbskbnvvgcybmfikxgky'
  const PAT = process.env.SUPABASE_PAT
  if (!PAT) throw new Error('SUPABASE_PAT not set')

  const args = process.argv.slice(2)
  const probePath = args.find((a, i) => i === 0 && !a.startsWith('--'))
  if (!probePath) throw new Error('usage: rehearse-sql.ts <probe.sql> [--with <migration.sql>]…')
  // Repeatable --with: every value whose predecessor is the flag.
  const withPaths = args.filter((a, i) => args[i - 1] === '--with')

  const parts: string[] = ['BEGIN;']
  for (const p of withPaths) parts.push(readFileSync(p, 'utf8'))
  parts.push(readFileSync(probePath, 'utf8'))

  const body = parts.join('\n')
  // Safety interlock: this harness must never be the thing that commits.
  // Comment-stripped, and matched anywhere — not only at a line start, so
  // "ROLLBACK; COMMIT;" and "SELECT 1; COMMIT;" are both caught.
  const stripped = body.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
  if (/\bCOMMIT\b/i.test(stripped)) {
    throw new Error('refusing to run: input contains COMMIT. This harness only rehearses.')
  }
  const sql = `${body}\nROLLBACK;`

  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const text = await res.text()
  if (!res.ok) { console.error(`FAIL (HTTP ${res.status})\n${text}`); process.exit(1) }

  const rows = JSON.parse(text) as Array<Record<string, unknown>>
  // The API returns rows from the LAST row-producing statement only. If the probe
  // ended in a DO block, or an early error skipped the assertion SELECT, we get
  // [] or the wrong shape — and "0/0 passed, exit 0" is the one result a test
  // harness must never print.
  if (!Array.isArray(rows) || rows.length === 0 ||
      !rows.every((r) => 'ok' in r && 'probe' in r)) {
    console.error(
      'no assertion rows returned. A probe file must end in exactly one row-producing\n' +
      'statement selecting (probe text, ok boolean, detail text). Got:\n' +
      JSON.stringify(rows).slice(0, 600),
    )
    process.exit(1)
  }

  let failed = 0
  for (const r of rows) {
    const ok = r.ok === true
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.probe}  ${r.detail ?? ''}`)
  }
  // Print the names seen, so a silently-dropped assertion is visible in the
  // output and not only in a total the reader has to remember.
  console.log(`\nassertions seen: ${rows.map((r) => r.probe).join(', ')}`)
  console.log(`${rows.length - failed}/${rows.length} assertions passed`)
  process.exit(failed === 0 ? 0 : 1)
  ```

- [ ] **Step 4: Run it and watch it fail.**
  ```bash
  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/00-harness-selftest.sql
  ```
  Expected, exit code 1:
  ```
  FAIL  harness  expected true

  assertions seen: harness
  0/1 assertions passed
  ```

- [ ] **Step 5: Fix the probe, watch it pass.** Change `(1 = 2)` to `(1 = 1)` and re-run. Expected, exit 0: `PASS  harness  expected true` / `1/1 assertions passed`.

- [ ] **Step 6: Prove the COMMIT interlock, including the forms a line-anchored regex would miss.** Append each of these to the probe in turn, re-run, confirm the refusal, then remove it:
  - `COMMIT;` on its own line
  - `SELECT 1; COMMIT;` on one line
  - `ROLLBACK; COMMIT;` on one line

  Expected each time:
  ```
  Error: refusing to run: input contains COMMIT. This harness only rehearses.
  ```
  Then append `-- COMMIT; (in a comment, must NOT trip the interlock)` and confirm it still runs. Remove it.

- [ ] **Step 7: Prove the zero-rows guard.** Replace the probe body with a bare `DO $x$ BEGIN NULL; END $x$;` and re-run. Expected, exit 1:
  ```
  no assertion rows returned. A probe file must end in exactly one row-producing
  statement selecting (probe text, ok boolean, detail text). Got:
  []
  ```
  This is the guard that stops a concatenated rehearsal reporting "3/3 passed" while nine probes were discarded. Restore the Step 5 body.

- [ ] **Step 8: Prove the rollback is real.** Temporarily prepend to the probe:
  ```sql
  CREATE SCHEMA _probe_rollback_check;
  ```
  Run (expect `1/1`). Then remove that line and set the probe body to:
  ```sql
  SELECT 'rollback' AS probe,
         NOT EXISTS (SELECT 1 FROM information_schema.schemata
                      WHERE schema_name = '_probe_rollback_check') AS ok,
         'schema must not survive' AS detail;
  ```
  Expected: `PASS  rollback  schema must not survive`. Restore the Step 5 body.

- [ ] **Step 9: Prove `--with` is repeatable.** Create two throwaway files and confirm both apply in order:
  ```bash
  echo "CREATE TEMP TABLE _w1(x int) ON COMMIT DROP; INSERT INTO _w1 VALUES (1);" > /tmp/w1.sql
  echo "INSERT INTO _w1 VALUES (2);" > /tmp/w2.sql
  cat > /tmp/w.sql <<'SQL'
  SELECT 'two_with_files' AS probe, (SELECT count(*) FROM _w1) = 2 AS ok,
         'both --with files applied, in order' AS detail;
  SQL
  pnpm tsx scripts/db/rehearse-sql.ts /tmp/w.sql --with /tmp/w1.sql --with /tmp/w2.sql
  ```
  Expected: `PASS  two_with_files  both --with files applied, in order` / `1/1`.

- [ ] **Step 10: Commit.**
  ```bash
  git add scripts/db/rehearse-sql.ts scripts/db/probes/00-harness-selftest.sql
  git commit -m "chore(db): add rolled-back production rehearsal harness for work-item mirrors

Fails on zero assertion rows: the Management API returns only the last
row-producing statement's rows, so a probe that ends in a DO block would
otherwise print 0/0 and exit 0."
  ```

---

## Task 2 — Migration skeleton, the `-- @verify:` header, and pre-flight assertions

The pre-flight block is a check **expected to pass** (§12 §(d)): it catches a rollback or a diverged branch, it does not gate the feature. There is no fallback arm anywhere in this migration. It also asserts the four things this plan needs from item 2 that item 2's own spec text does not obviously promise: the watchers unique constraint, the six registered types, `suppress_all_outbound`, and **F8's gatekeeper-guard exemption**.

**Files:**
- Create: `apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql` (placeholder number — see Task 20)
- Test: `scripts/db/probes/01-preflight.sql`

- [ ] **Step 1: Write the probe first.** Create `scripts/db/probes/01-preflight.sql`:
  ```sql
  SELECT 'spine_applied' AS probe,
         to_regclass('projects.work_items') IS NOT NULL AS ok,
         'A(f) ordinals 1/2/6/7 must be APPLIED to production, not merely merged' AS detail
  UNION ALL
  SELECT 'settings_applied',
         EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='projects' AND table_name='project_settings'
                    AND column_name='suppress_all_outbound'),
         'A(f) ordinal 6 adds suppress_all_outbound; §12 §(d) makes it a precondition of the write-back'
  UNION ALL
  SELECT 'watchers_unique_present',
         EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='projects' AND tablename='work_item_watchers'
                    AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%work_item_id%'
                    AND indexdef ILIKE '%user_id%'),
         'seed_work_item_watchers uses (work_item_id, user_id) as an explicit ON CONFLICT target'
  UNION ALL
  SELECT 'product_events_present',
         to_regclass('public.product_events') IS NOT NULL,
         'section I writes the backfill-completion row (A(f) ordinal 9)'
  UNION ALL
  SELECT 'gatekeeper_guard_exempts_triggers',
         COALESCE((SELECT bool_or(p.prosrc ~* 'pg_trigger_depth\(\)\s*>\s*0')
                     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname='projects' AND p.proname ILIKE '%work_item%guard%'), false),
         'F8: without this, a contractor closing their own RFI aborts the RFI close';
  ```

- [ ] **Step 2: Run it. This is the gate — if it fails, STOP.**
  ```bash
  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/01-preflight.sql
  ```
  Expected when the dependencies are applied: `5/5 assertions passed`.

  If `spine_applied` FAILs, **this whole plan is blocked on item 2 being applied to production and nothing below can be rehearsed** — record the blocker and stop. If `gatekeeper_guard_exempts_triggers` FAILs, that is a **requirement on item 2** (F8): raise it against item 2 with the reproduction from Task 5 Step 5 rather than working around it in the mirror. If only `settings_applied` FAILs, item 6 is behind item 7 and the ledger order was not followed.

  ⚠ There is no "run it and watch it fail" pair for this probe. It is a precondition check, not a unit under test, and the plan does not pretend otherwise.

- [ ] **Step 3: Create the migration file with its header and section A.** Create `apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql`:
  ```sql
  -- =============================================================================
  -- Migration: <NNNNN>_work_item_source_mirrors_and_backfill.sql
  -- Appendix A(f) Q1 ordinal 9. Depends on ordinals 1, 2, 6 and 7 being APPLIED.
  -- Description: Six projection entry points push module status into
  --              projects.work_items; assignment and due date write back to
  --              projects.rfis and field.snags; six BEFORE DELETE triggers void an
  --              orphaned item; then the entity backfill runs under notification
  --              suppression and records its own completion into
  --              public.product_events. structure.node_orders gets NO trigger (A(b)).
  --
  -- go_live: DATE '2026-11-03'  (Tuesday). Due-date floor for backfilled OPEN
  --          items = go_live + 5 office working days = DATE '2026-11-10'
  --          (Wed 4, Thu 5, Fri 6, Mon 9, Tue 10 — no SA public holiday in range).
  --          Both literals are re-derived at merge in Task 20 Step 4.
  --
  -- Role dependency: applied by `supabase db push`, which connects as `postgres`.
  --          Nothing here depends on that (the backfill calls projects.project_*()
  --          directly and never UPDATEs a source row, so field.site_forms'
  --          enforce_site_form_transition (00179:347, escaped only by
  --          current_user IN (postgres, service_role, supabase_admin) at 00179:353)
  --          is never entered). Recorded because the previous design DID depend on it.
  --
  -- Restore: additive only. To undo:
  --            DELETE FROM projects.work_items
  --             WHERE origin = 'mirror' AND created_at <= <apply timestamp>;
  --            UPDATE projects.rfis r SET assigned_to = b.assigned_to, due_date = b.due_date,
  --                   updated_at = b.updated_at
  --              FROM projects.backup_<NNNNN>_source_assignees b
  --             WHERE b.kind = 'rfi' AND b.id = r.id;
  --            UPDATE field.snags s SET assigned_to = b.assigned_to, updated_at = b.updated_at
  --              FROM projects.backup_<NNNNN>_source_assignees b
  --             WHERE b.kind = 'snag' AND b.id = s.id;
  --          No source row is destroyed. The write-back is the only thing this
  --          migration changes on a source table, and it rewrites `updated_at`
  --          via the pre-existing set_updated_at triggers (rfis_updated_at
  --          00002:100, snags_updated_at 00004:33) on the rows it touches —
  --          which is why updated_at is in the snapshot.
  --
  -- @verify:begin
  -- table: projects.backup_<NNNNN>_source_assignees
  -- function: projects.resolve_project_pm(uuid)
  -- function: projects.resolve_work_item_assignee(uuid,text,uuid)
  -- function: projects.resolve_work_item_gatekeeper(uuid,uuid)
  -- function: projects.work_item_person_eligible(uuid,uuid)
  -- function: projects.map_source_status(text,text)
  -- function: projects.work_item_status_for_mirror(text,text,boolean)
  -- function: projects.work_item_mirror_due_date(date)
  -- function: projects.diary_delay_text(text,text)
  -- function: projects.seed_work_item_watchers(uuid,uuid,uuid,uuid)
  -- function: projects.project_rfi(uuid)
  -- function: projects.project_snag(uuid)
  -- function: projects.project_inspection(uuid)
  -- function: projects.project_qc_entry(uuid)
  -- function: projects.project_diary_action(uuid)
  -- function: projects.project_form_action(uuid)
  -- function: projects.mirror_rfi_work_item()
  -- function: projects.mirror_snag_work_item()
  -- function: projects.mirror_inspection_work_item()
  -- function: projects.mirror_qc_defect_work_item()
  -- function: projects.mirror_qc_report_defects()
  -- function: projects.mirror_diary_action_work_item()
  -- function: projects.mirror_form_action_work_item()
  -- function: projects.work_item_assignment_writeback()
  -- function: projects.void_work_item_on_source_delete()
  -- trigger: rfis_mirror_work_item_ins ON projects.rfis
  -- trigger: rfis_mirror_work_item_upd ON projects.rfis
  -- trigger: snags_mirror_work_item_ins ON field.snags
  -- trigger: snags_mirror_work_item_upd ON field.snags
  -- trigger: inspections_mirror_work_item_ins ON inspections.inspections
  -- trigger: inspections_mirror_work_item_upd ON inspections.inspections
  -- trigger: qc_entries_mirror_work_item_ins ON projects.qc_entries
  -- trigger: qc_entries_mirror_work_item_upd ON projects.qc_entries
  -- trigger: qc_reports_mirror_defects ON projects.qc_reports
  -- trigger: site_diary_entries_mirror_work_item_ins ON projects.site_diary_entries
  -- trigger: site_diary_entries_mirror_work_item_upd ON projects.site_diary_entries
  -- trigger: site_forms_mirror_work_item_ins ON field.site_forms
  -- trigger: site_forms_mirror_work_item_upd ON field.site_forms
  -- trigger: work_items_assignment_writeback_ins ON projects.work_items
  -- trigger: work_items_assignment_writeback_upd ON projects.work_items
  -- trigger: rfis_void_work_item ON projects.rfis
  -- trigger: snags_void_work_item ON field.snags
  -- trigger: inspections_void_work_item ON inspections.inspections
  -- trigger: qc_entries_void_work_item ON projects.qc_entries
  -- trigger: site_diary_entries_void_work_item ON projects.site_diary_entries
  -- trigger: site_forms_void_work_item ON field.site_forms
  -- grant_absent: anon SELECT ON projects.backup_<NNNNN>_source_assignees
  -- grant_absent: anon EXECUTE ON projects.resolve_project_pm(uuid)
  -- grant_absent: anon EXECUTE ON projects.resolve_work_item_assignee(uuid,text,uuid)
  -- grant_absent: anon EXECUTE ON projects.resolve_work_item_gatekeeper(uuid,uuid)
  -- grant_absent: anon EXECUTE ON projects.work_item_person_eligible(uuid,uuid)
  -- grant_absent: anon EXECUTE ON projects.map_source_status(text,text)
  -- grant_absent: anon EXECUTE ON projects.work_item_status_for_mirror(text,text,boolean)
  -- grant_absent: anon EXECUTE ON projects.work_item_mirror_due_date(date)
  -- grant_absent: anon EXECUTE ON projects.diary_delay_text(text,text)
  -- grant_absent: anon EXECUTE ON projects.seed_work_item_watchers(uuid,uuid,uuid,uuid)
  -- grant_absent: anon EXECUTE ON projects.project_rfi(uuid)
  -- grant_absent: anon EXECUTE ON projects.project_snag(uuid)
  -- grant_absent: anon EXECUTE ON projects.project_inspection(uuid)
  -- grant_absent: anon EXECUTE ON projects.project_qc_entry(uuid)
  -- grant_absent: anon EXECUTE ON projects.project_diary_action(uuid)
  -- grant_absent: anon EXECUTE ON projects.project_form_action(uuid)
  -- @verify:end
  -- =============================================================================

  -- ─── A. Pre-flight. Expected to pass; catches a rollback or a diverged branch. ──
  DO $preflight$
  BEGIN
    IF to_regclass('projects.work_items') IS NULL THEN
      RAISE EXCEPTION 'A(f) ordinal 7 (the spine) has not been applied';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='projects' AND table_name='qc_entries'
                      AND column_name IN ('conformance','severity')
                    HAVING count(*) = 2) THEN
      RAISE EXCEPTION 'projects.qc_entries is missing conformance/severity (00176:54,56)';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname IN ('qc_entries_conformance_check','qc_entries_severity_check')
                    HAVING count(*) = 2) THEN
      RAISE EXCEPTION 'the qc_entries conformance/severity CHECKs are absent (00176:60,67)';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='projects' AND table_name='project_settings'
                      AND column_name IN ('triage_owner_id','work_item_defaults','suppress_all_outbound')
                    HAVING count(*) = 3) THEN
      RAISE EXCEPTION 'A(f) ordinal 6 is incomplete (triage_owner_id / work_item_defaults / suppress_all_outbound)';
    END IF;

    IF (SELECT count(*) FROM projects.work_item_types
         WHERE key IN ('rfi','snag','qc_defect','inspection','diary_action','form_action')) <> 6 THEN
      RAISE EXCEPTION 'the six mirrored A(b) types are not all registered';
    END IF;

    -- seed_work_item_watchers names this index as an explicit ON CONFLICT target.
    IF NOT EXISTS (SELECT 1 FROM pg_indexes
                    WHERE schemaname='projects' AND tablename='work_item_watchers'
                      AND indexdef ILIKE '%UNIQUE%'
                      AND indexdef ILIKE '%work_item_id%' AND indexdef ILIKE '%user_id%') THEN
      RAISE EXCEPTION 'projects.work_item_watchers needs UNIQUE (work_item_id, user_id) — item 2 owns it';
    END IF;

    -- F8. The mirror pushes source status onto work_items as SECURITY DEFINER,
    -- but auth.uid() inside it is still the contractor who changed the source.
    -- Item 2's gatekeeper BEFORE UPDATE guard must exempt pg_trigger_depth() > 0
    -- or a contractor closing their own RFI aborts the RFI close in production.
    IF NOT COALESCE((SELECT bool_or(p.prosrc ~* 'pg_trigger_depth\(\)\s*>\s*0')
                       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                      WHERE n.nspname = 'projects' AND p.proname ILIKE '%work_item%guard%'), false) THEN
      RAISE EXCEPTION 'item 2''s gatekeeper guard does not exempt pg_trigger_depth() > 0 (F8)';
    END IF;

    IF to_regclass('public.product_events') IS NULL THEN
      RAISE EXCEPTION 'A(f) ordinal 1 (public.product_events) has not been applied';
    END IF;
  END $preflight$;
  ```
  ⚠ **No trailing `SELECT`.** A migration must not return rows to `db push`; the probe in Step 1 reads the same facts from `information_schema` and `pg_proc` directly, so the migration needs no output of its own.

- [ ] **Step 4: Prove the pre-flight can fail.** Temporarily change `<> 6` to `<> 7` and run:
  ```bash
  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/01-preflight.sql \
    --with apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql
  ```
  Expected:
  ```
  FAIL (HTTP 400)
  … ERROR: P0001: the six mirrored A(b) types are not all registered
  ```
  Restore `<> 6`, re-run with `--with`, and confirm `5/5` again — a pre-flight that passes only because the migration was not applied is not a pre-flight.

- [ ] **Step 5: Flag the `-- trigger:` line type to item 1.** `scripts/verify-migration-applied.ts` (built in item 1) parses `-- table:`, `-- view:`, `-- function:`, `-- policy:`, `-- constraint:`, `-- index:` and `-- grant_absent:` (§12 §(c)). This migration is the first to declare `-- trigger:`. Extend that script's parser in **this** PR to resolve a `-- trigger: <name> ON <schema>.<table>` line against `pg_trigger` joined to `pg_class` and `pg_namespace`, exiting non-zero when absent. Add a unit test that feeds it a `-- trigger:` line for a trigger that does not exist and asserts the non-zero exit. If the script does not exist yet, item 1 is incomplete — record the blocker and keep the `-- trigger:` lines.

- [ ] **Step 6: Commit.**
  ```bash
  git add apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql \
          scripts/db/probes/01-preflight.sql \
          scripts/verify-migration-applied.ts
  git commit -m "feat(work-items): migration skeleton, @verify header and pre-flight assertions for source mirrors"
  ```

---

## Task 3 — The resolvers (findings F3, improvement 7)

§03 §1.6's chain is: explicit assignee → per-type `work_item_defaults.<type>.triage_owner_id` → project `triage_owner_id` → the §1.5 PM resolver → **the org owner**. Three changes, each with its reason on the record:

1. **A fifth and final step, `projects.projects.created_by`** (F3). The org-owner terminus returns NULL for the one project whose organisation has no owner, admin or PM. `created_by` is `NOT NULL` and therefore cannot fail. ⚠ **Accepted consequence:** on the Sandton demo project `created_by` resolves to a user whose effective role is `contractor` — the same person who raised all six snags. That makes them their own snag gatekeeper, which §03 §1.5 forbids. It is accepted because a live mirror that *raises* on every snag insert is worse, and because improvement 2 removes that project from the backfill so no live item is ever created that way.
2. **`default_rfi_assignee_id` is step 1b for `p_item_type = 'rfi'`,** which §12 §(d) line 133 names and the original plan silently dropped. In practice it is moot — `rfiService.create` already applies it at the application layer (`packages/shared/src/services/rfi.service.ts:75-83`, verified) and no project has it set — but the backfill is exactly the path where that application-layer fallback did not run, so the database must carry it.
3. **`client_viewer` is excluded from every step** (improvement 7). §03 §1.9 grants client viewers assignee *eligibility* from Q1 but defers to Q3 the write set that lets them clear an item; `00161`'s blanket block stops them writing and `work_items_bic_present` keeps the row pointing at them, so an item that lands on one can never reach zero. Four `client_viewer` accounts exist in production and are reachable through an explicit `rfis.assigned_to` or a mistyped `triage_owner_id`. Deleting this predicate in Q3 is one line; recovering items stranded on a client's ball-in-court is a data migration and a conversation with the client.

Every candidate is filtered through one helper, `projects.work_item_person_eligible`, so the exclusion lives in exactly one place a test can pin. §03 §1.5 warns that a departed employee's id survives in the jsonb with no foreign key behind it, and item 2's assignee-membership trigger would reject them anyway — raising inside the mirror, which would make it impossible for anyone to raise an RFI on that project.

**Files:**
- Modify: the migration — add section B after section A
- Test: `scripts/db/probes/02-resolvers.sql`

- [ ] **Step 1: Write the probe first, with the demo project and a real client viewer named explicitly.** Create `scripts/db/probes/02-resolvers.sql`:
  ```sql
  DO $probe$
  DECLARE
    v_cv   uuid;   -- a live client_viewer in WM-Consulting
    v_proj uuid;   -- a project they can see
  BEGIN
    SELECT u.user_id INTO v_cv
      FROM public.user_organisations u
     WHERE u.organisation_id = 'dddddddd-0000-0000-0000-000000000001'
       AND u.role = 'client_viewer' AND u.is_active
     LIMIT 1;

    SELECT p.id INTO v_proj FROM projects.projects p
     WHERE p.organisation_id = 'dddddddd-0000-0000-0000-000000000001'
       AND public.user_effective_project_role(p.id, v_cv) = 'client_viewer'
     LIMIT 1;

    CREATE TEMP TABLE res_ctx(cv uuid, proj uuid) ON COMMIT DROP;
    INSERT INTO res_ctx VALUES (v_cv, v_proj);
  END $probe$;

  SELECT 'pm_resolves_everywhere' AS probe,
         count(*) FILTER (WHERE projects.resolve_project_pm(p.id) IS NULL) = 0 AS ok,
         'unresolved: ' || COALESCE(string_agg(p.name, '; ')
             FILTER (WHERE projects.resolve_project_pm(p.id) IS NULL), 'none') AS detail
  FROM projects.projects p
  UNION ALL
  SELECT 'assignee_resolves_everywhere',
         count(*) FILTER (WHERE projects.resolve_work_item_assignee(p.id, 'snag', NULL) IS NULL) = 0,
         'unresolved: ' || COALESCE(string_agg(p.name, '; ')
             FILTER (WHERE projects.resolve_work_item_assignee(p.id, 'snag', NULL) IS NULL), 'none')
  FROM projects.projects p
  UNION ALL
  SELECT 'demo_project_resolves',
         bool_and(projects.resolve_project_pm(p.id) IS NOT NULL
              AND projects.resolve_work_item_assignee(p.id, 'snag', NULL) IS NOT NULL),
         'E-Site DEMO has no owner/admin/PM; must fall through to projects.created_by'
  FROM projects.projects p WHERE p.name LIKE 'Sandton%'
  UNION ALL
  -- F3's accepted consequence, on the record rather than discovered later.
  SELECT 'demo_gatekeeper_is_the_creator_and_a_contractor',
         bool_and(projects.resolve_project_pm(p.id) = p.created_by
              AND public.user_effective_project_role(p.id, p.created_by) = 'contractor'),
         'accepted: on the demo project the gatekeeper is a contractor, so improvement 2 keeps it out of the backfill'
  FROM projects.projects p WHERE p.name LIKE 'Sandton%'
  UNION ALL
  SELECT 'resolved_people_are_members',
         count(*) FILTER (WHERE public.user_effective_project_role(
             p.id, projects.resolve_work_item_assignee(p.id, 'snag', NULL)) IS NULL) = 0,
         'assignee must pass user_effective_project_role or item 2''s membership trigger raises'
  FROM projects.projects p
  UNION ALL
  -- Improvement 7.
  SELECT 'client_viewer_is_never_eligible',
         NOT projects.work_item_person_eligible((SELECT proj FROM res_ctx), (SELECT cv FROM res_ctx)),
         'a client viewer cannot clear an item until Q3, and work_items_bic_present pins it to them forever'
  UNION ALL
  SELECT 'client_viewer_explicit_is_overridden',
         projects.resolve_work_item_assignee((SELECT proj FROM res_ctx), 'rfi', (SELECT cv FROM res_ctx))
           IS DISTINCT FROM (SELECT cv FROM res_ctx),
         'an explicit rfis.assigned_to naming a client viewer falls through to the chain'
  UNION ALL
  SELECT 'nobody_resolves_to_a_client_viewer',
         count(*) FILTER (WHERE public.user_effective_project_role(
             p.id, projects.resolve_work_item_assignee(p.id, 'rfi', NULL)) = 'client_viewer') = 0,
         'no project''s default assignee may be a client viewer'
  FROM projects.projects p;
  ```

- [ ] **Step 2: Run it and watch it fail.**
  ```bash
  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/02-resolvers.sql \
    --with apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql
  ```
  Expected: `FAIL (HTTP 400) … ERROR: 42883: function projects.resolve_project_pm(uuid) does not exist`.

- [ ] **Step 3: Append section B to the migration.**
  ```sql
  -- ─── B. Resolvers ────────────────────────────────────────────────────────────
  -- All four are SECURITY DEFINER with row_security off because they read
  -- membership tables the calling contractor cannot see, and none of them uses
  -- current_user: inside SECURITY DEFINER it is the function OWNER, which is what
  -- made the first site-form transition trigger silently inert (00179:341-346,
  -- function at :347). They take no caller identity at all — they answer
  -- "who owns this project", not "who is asking".

  -- One place, and only one place, decides whether a person may hold an item.
  CREATE OR REPLACE FUNCTION projects.work_item_person_eligible(
      p_project_id uuid, p_user_id uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'projects', 'public'
  SET row_security TO 'off'
  AS $fn$
    SELECT p_user_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = p_user_id)
       -- §03 §1.9 defers the client viewer's write set to Q3. Until then an item
       -- that lands on one can never be cleared: 00161 blocks their writes and
       -- work_items_bic_present keeps the row pointing at them. Delete this one
       -- clause in Q3; it is one line, and stranded items are a data migration.
       AND COALESCE(public.user_effective_project_role(p_project_id, p_user_id), 'none')
             NOT IN ('none', 'client_viewer')
  $fn$;

  CREATE OR REPLACE FUNCTION projects.resolve_project_pm(p_project_id uuid)
  RETURNS uuid
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO 'projects', 'public'
  SET row_security TO 'off'
  AS $fn$
  DECLARE v_org uuid; v_id uuid;
  BEGIN
    SELECT organisation_id INTO v_org FROM projects.projects WHERE id = p_project_id;
    IF v_org IS NULL THEN RETURN NULL; END IF;

    -- §03 §1.5, in order: project PM row, then org PM, then org admin, then org owner.
    -- ⚠ "oldest active row" is decided by membership creation order and is
    -- invisible to everyone. SAXBY has 4 such rows, PNP FAERIE GLEN 4, KINGSWALK 3.
    -- Task 19 puts the resolved list in front of a human before the backfill runs.
    SELECT m.user_id INTO v_id FROM projects.project_members m
     WHERE m.project_id = p_project_id AND m.role = 'project_manager' AND m.is_active
       AND projects.work_item_person_eligible(p_project_id, m.user_id)
     ORDER BY m.created_at ASC LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;

    SELECT u.user_id INTO v_id FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.role = 'project_manager' AND u.is_active
       AND projects.work_item_person_eligible(p_project_id, u.user_id)
     ORDER BY u.created_at ASC LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;

    SELECT u.user_id INTO v_id FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.role = 'admin' AND u.is_active
       AND projects.work_item_person_eligible(p_project_id, u.user_id)
     ORDER BY u.created_at ASC LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;

    SELECT u.user_id INTO v_id FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active
       AND projects.work_item_person_eligible(p_project_id, u.user_id)
     ORDER BY u.created_at ASC LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;

    -- Fifth step, added on measured evidence and NOT in §03 §1.5 (F3). The
    -- E-Site DEMO org (e51ede00-…-0001) holds only a contractor and a
    -- client_viewer, so all four steps above return NULL for the Sandton demo
    -- project. projects.projects.created_by is NOT NULL, so this cannot fail.
    -- Without it the live mirror RAISES on every snag insert for that org and
    -- snag creation breaks permanently.
    -- ⚠ On that project this resolves to a contractor — the same person who
    -- raised the snags. Accepted; improvement 2 keeps that org out of the backfill.
    SELECT p.created_by INTO v_id FROM projects.projects p WHERE p.id = p_project_id;
    RETURN v_id;
  END $fn$;

  CREATE OR REPLACE FUNCTION projects.resolve_work_item_assignee(
      p_project_id uuid, p_item_type text, p_explicit uuid)
  RETURNS uuid
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO 'projects', 'public'
  SET row_security TO 'off'
  AS $fn$
  DECLARE v_candidate uuid;
  BEGIN
    -- 1. explicit
    IF projects.work_item_person_eligible(p_project_id, p_explicit) THEN
      RETURN p_explicit;
    END IF;

    -- 1b. RFI only: the per-project default (§12 §(d) line 133,
    --     00101_project_settings.sql:29). rfiService.create applies this at the
    --     application layer (rfi.service.ts:75-83) and no project sets it today,
    --     but the backfill is exactly the path where that never ran.
    IF p_item_type = 'rfi' THEN
      SELECT s.default_rfi_assignee_id INTO v_candidate
        FROM projects.project_settings s WHERE s.project_id = p_project_id;
      IF projects.work_item_person_eligible(p_project_id, v_candidate) THEN
        RETURN v_candidate;
      END IF;
    END IF;

    -- 2. per-type work_item_defaults.<type>.triage_owner_id. No FK behind the
    --    jsonb (§03 §1.5), so a stale id is discarded rather than raising.
    SELECT NULLIF(s.work_item_defaults #>> ARRAY[p_item_type, 'triage_owner_id'], '')::uuid
      INTO v_candidate
      FROM projects.project_settings s WHERE s.project_id = p_project_id;
    IF projects.work_item_person_eligible(p_project_id, v_candidate) THEN
      RETURN v_candidate;
    END IF;

    -- 3. project triage_owner_id (nullable by decision, §03 §1.6)
    SELECT s.triage_owner_id INTO v_candidate
      FROM projects.project_settings s WHERE s.project_id = p_project_id;
    IF projects.work_item_person_eligible(p_project_id, v_candidate) THEN
      RETURN v_candidate;
    END IF;

    -- 4 + 5. the PM resolver, which itself terminates at projects.created_by.
    RETURN projects.resolve_project_pm(p_project_id);
  END $fn$;

  CREATE OR REPLACE FUNCTION projects.resolve_work_item_gatekeeper(
      p_project_id uuid, p_explicit uuid)
  RETURNS uuid
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO 'projects', 'public'
  SET row_security TO 'off'
  AS $fn$
  BEGIN
    -- A(b), as amended in this PR: the gatekeeper is the project PM for snag,
    -- qc_defect, diary_action and form_action; verifier_id for inspection; and
    -- THE RAISER for rfi (improvement 4 — an RFI is closed by the person who
    -- asked, once they confirm the answer is usable). The caller supplies the
    -- exception as p_explicit; everyone else passes NULL.
    IF projects.work_item_person_eligible(p_project_id, p_explicit) THEN
      RETURN p_explicit;
    END IF;
    RETURN projects.resolve_project_pm(p_project_id);
  END $fn$;
  ```

- [ ] **Step 4: Run the probe and watch all eight assertions pass.**
  ```bash
  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/02-resolvers.sql \
    --with apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql
  ```
  Expected:
  ```
  PASS  pm_resolves_everywhere                            unresolved: none
  PASS  assignee_resolves_everywhere                      unresolved: none
  PASS  demo_project_resolves                             E-Site DEMO has no owner/admin/PM; …
  PASS  demo_gatekeeper_is_the_creator_and_a_contractor   accepted: …
  PASS  resolved_people_are_members                       assignee must pass user_effective_project_role …
  PASS  client_viewer_is_never_eligible                   a client viewer cannot clear an item until Q3, …
  PASS  client_viewer_explicit_is_overridden              an explicit rfis.assigned_to naming a client viewer …
  PASS  nobody_resolves_to_a_client_viewer                no project's default assignee may be a client viewer

  assertions seen: pm_resolves_everywhere, assignee_resolves_everywhere, demo_project_resolves, demo_gatekeeper_is_the_creator_and_a_contractor, resolved_people_are_members, client_viewer_is_never_eligible, client_viewer_explicit_is_overridden, nobody_resolves_to_a_client_viewer
  8/8 assertions passed
  ```

- [ ] **Step 5: Mutation-verify F3 — delete the fifth step and watch the demo project break.** In `resolve_project_pm`, replace the final `SELECT p.created_by INTO v_id …; RETURN v_id;` pair with `RETURN NULL;`. Re-run. Expected:
  ```
  FAIL  pm_resolves_everywhere                          unresolved: Sandton City Office Tower — DB Upgrade (Demo)
  FAIL  assignee_resolves_everywhere                    unresolved: Sandton City Office Tower — DB Upgrade (Demo)
  FAIL  demo_project_resolves                           E-Site DEMO has no owner/admin/PM; …
  FAIL  demo_gatekeeper_is_the_creator_and_a_contractor accepted: …
  ```
  Restore the fifth step and confirm 8/8. **Record 8/8 → 4/8 → 8/8 in the PR body** — §12 §(h) makes mutation verification the acceptance step, not a nicety.

- [ ] **Step 6: Mutation-verify improvement 7.** In `work_item_person_eligible`, change `NOT IN ('none', 'client_viewer')` to `NOT IN ('none')`. Re-run. Expected:
  ```
  FAIL  client_viewer_is_never_eligible        a client viewer cannot clear an item until Q3, …
  FAIL  client_viewer_explicit_is_overridden   an explicit rfis.assigned_to naming a client viewer …
  ```
  Restore. Record 8/8 → 6/8 → 8/8.

- [ ] **Step 7: Commit.**
  ```bash
  git add apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql \
          scripts/db/probes/02-resolvers.sql
  git commit -m "feat(work-items): resolvers terminating at projects.created_by, excluding client viewers

The Sandton demo project's organisation has no owner, admin or project_manager,
so a chain terminating at the org owner returns NULL and the live snag mirror
would raise on every insert. projects.created_by is NOT NULL and cannot fail.
client_viewer is excluded from every step: their write set is deferred to Q3, so
an item that lands on one can never be cleared (work_items_bic_present pins it)."
  ```

---

## Task 4 — Status mapping, the due-date floor, and the diary negation stop-list

Four pure functions with clearly separated jobs, so each is independently testable:

- `map_source_status` — pure vocabulary, one arm per source value, parseable by a contract test.
- `work_item_status_for_mirror` — the policy reconciling a mapping with §03 §1.6's triage rule.
- `work_item_mirror_due_date` — **improvement 6**: a source date at or before today becomes NULL, so item 2's `BEFORE INSERT` trigger computes the type's own offset on the type's own calendar and no projected item is ever born overdue.
- `diary_delay_text` — **improvement 1**: the negation stop-list, in SQL rather than in prose, so a contract test can assert it exists and a probe can assert it works.

The status reconciliation matters because A(b) maps `inspection.assigned → open` while §1.6 says an item created without an explicit assignee is born `triage`. Applied naively the mapping would immediately un-triage every unowned inbound item and empty the Triage queue — the queue §1.6 exists to fill. **The rule: a mapped `open` never overrides `triage`; only `answered`, `closed` and `void` do.**

**Files:**
- Modify: the migration — add section C
- Create: `apps/web/src/lib/work-items/source-status-map.contract.test.ts`
- Test: `scripts/db/probes/03-status-map.sql`

- [ ] **Step 1: Write the SQL probe first.** Create `scripts/db/probes/03-status-map.sql`:
  ```sql
  WITH cases(probe, got, want) AS (VALUES
    ('rfi_responded',     projects.map_source_status('rfi','responded'),        'answered'),
    ('rfi_closed',        projects.map_source_status('rfi','closed'),           'closed'),
    ('rfi_draft_null',    projects.map_source_status('rfi','draft'),            NULL),
    ('snag_resolved',     projects.map_source_status('snag','resolved'),        'answered'),
    ('snag_signed_off',   projects.map_source_status('snag','signed_off'),      'closed'),
    ('insp_awaiting',     projects.map_source_status('inspection','awaiting_verification'), 'answered'),
    ('insp_abandoned',    projects.map_source_status('inspection','abandoned'), 'void'),
    ('qc_na_null',        projects.map_source_status('qc_defect','na'),         NULL),
    ('qc_pass_closed',    projects.map_source_status('qc_defect','pass'),       'closed'),
    ('form_distributed',  projects.map_source_status('form_action','distributed'), 'closed'),
    ('diary_always_null', projects.map_source_status('diary_action','anything'), NULL)
  )
  SELECT probe, got IS NOT DISTINCT FROM want AS ok,
         'got ' || COALESCE(got,'<null>') || ', want ' || COALESCE(want,'<null>') AS detail
  FROM cases
  UNION ALL
  SELECT 'open_never_untriages',
         projects.work_item_status_for_mirror('triage','open',false) = 'triage',
         'an inspection at status=assigned must not empty the Triage queue'
  UNION ALL
  SELECT 'terminal_overrides_triage',
         projects.work_item_status_for_mirror('triage','closed',false) = 'closed',
         'a source that closed while untriaged still closes'
  UNION ALL
  SELECT 'insert_without_assignee_is_triage',
         projects.work_item_status_for_mirror(NULL,'open',false) = 'triage',
         '§03 §1.6: born triage when nobody was named'
  UNION ALL
  SELECT 'insert_with_assignee_is_open',
         projects.work_item_status_for_mirror(NULL,'open',true) = 'open',
         '§03 §1.6: born open when an assignee was named'
  UNION ALL
  SELECT 'unmapped_leaves_unchanged',
         projects.work_item_status_for_mirror('answered',NULL,false) = 'answered',
         '§03 §1.8: an unmapped source status changes nothing'
  UNION ALL
  -- Improvement 6.
  SELECT 'past_due_becomes_null',
         projects.work_item_mirror_due_date(CURRENT_DATE - 30) IS NULL,
         'a past source date must not arrive overdue; item 2''s trigger computes the type default instead'
  UNION ALL
  SELECT 'today_becomes_null',
         projects.work_item_mirror_due_date(CURRENT_DATE) IS NULL,
         'RFI "Drawings" was created AND due 2026-07-23; a same-day due date is not a deadline'
  UNION ALL
  SELECT 'future_due_passes_through',
         projects.work_item_mirror_due_date(CURRENT_DATE + 14) = CURRENT_DATE + 14,
         'a real future deadline the raiser set is honoured'
  UNION ALL
  SELECT 'null_due_stays_null',
         projects.work_item_mirror_due_date(NULL) IS NULL,
         'no source date at all: item 2''s trigger computes A(b)''s offset'
  UNION ALL
  -- Improvement 1. Every one of these is a live value measured on production.
  SELECT 'diary_none_is_not_a_delay',
         projects.diary_delay_text('None,', NULL) IS NULL
     AND projects.diary_delay_text('None', NULL) IS NULL
     AND projects.diary_delay_text('NO', NULL) IS NULL
     AND projects.diary_delay_text(NULL, 'n/a') IS NULL
     AND projects.diary_delay_text('  none.  ', NULL) IS NULL,
         'all 6 of 6 live "delays" are negations: None, / None, / None / None / NO / "No delays or info required…"'
  UNION ALL
  SELECT 'diary_long_negation_is_not_a_delay',
         projects.diary_delay_text('No delays or info required was noted in the site walk and or meeting', NULL) IS NULL,
         'the 2026-06-02 entry: a sentence, not a token, so a token stop-list alone is not enough'
  UNION ALL
  SELECT 'diary_real_delay_survives',
         projects.diary_delay_text('Crane stood down 4h awaiting sparks', NULL)
           = 'Crane stood down 4h awaiting sparks',
         'a real delay must still project, or the stop-list has eaten the feature'
  UNION ALL
  SELECT 'diary_notes_fallback',
         projects.diary_delay_text(NULL, 'Late delivery of DB-04A') = 'Late delivery of DB-04A',
         'delay_notes (00017:18) is the second source, added after the original column';
  ```

- [ ] **Step 2: Run it, watch it fail** with `ERROR: 42883: function projects.map_source_status(unknown,unknown) does not exist`.

- [ ] **Step 3: Append section C to the migration.**
  ```sql
  -- ─── C. Status, due date, and what counts as a delay ─────────────────────────
  -- Pure vocabulary. IMMUTABLE because it reads nothing. Every value in every
  -- source table's own status CHECK has an arm here — mapped, or explicitly NULL
  -- meaning "leaves the universal status unchanged" (§03 §1.8). A contract test
  -- parses both sides and fails on any value with no arm.
  CREATE OR REPLACE FUNCTION projects.map_source_status(p_item_type text, p_source_status text)
  RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
    SELECT CASE p_item_type
      WHEN 'rfi' THEN CASE p_source_status
        -- No 'draft' arm with meaning: rfiService.create hardcodes status:'open'
        -- (rfi.service.ts:100) and no code path writes 'draft'; it exists only
        -- in the 00002:90 CHECK.
        WHEN 'draft'     THEN NULL
        WHEN 'open'      THEN 'open'
        WHEN 'responded' THEN 'answered'
        WHEN 'closed'    THEN 'closed'
        ELSE NULL END
      WHEN 'snag' THEN CASE p_source_status
        WHEN 'open'             THEN 'open'
        WHEN 'in_progress'      THEN 'open'
        -- resolved/pending_sign_off both mean "the contractor says it is done and
        -- the PM has the ball", which is exactly 'answered'. Sign-off is the PM's
        -- act (§03 §1.5: the snag gatekeeper is the PM, not the raiser).
        WHEN 'resolved'         THEN 'answered'
        WHEN 'pending_sign_off' THEN 'answered'
        WHEN 'signed_off'       THEN 'closed'
        WHEN 'closed'           THEN 'closed'
        ELSE NULL END
      WHEN 'inspection' THEN CASE p_source_status   -- §03 §1.10, verbatim
        WHEN 'assigned'              THEN 'open'
        WHEN 'in_progress'           THEN 'open'
        WHEN 'awaiting_verification' THEN 'answered'
        WHEN 'certified'             THEN 'closed'
        WHEN 're-inspect_required'   THEN 'open'
        WHEN 'abandoned'             THEN 'void'
        ELSE NULL END
      WHEN 'qc_defect' THEN CASE p_source_status    -- source_status mirrors conformance
        WHEN 'fail' THEN NULL                        -- in scope; triage/open rules decide
        WHEN 'pass' THEN 'closed'                    -- the defect was corrected
        -- 'na' is the column DEFAULT (00176:54) and all 11 live entries carry it.
        -- Reading it as a close would mass-close items on a default value.
        WHEN 'na'   THEN NULL
        ELSE NULL END
      WHEN 'form_action' THEN CASE p_source_status
        WHEN 'draft'       THEN NULL
        WHEN 'submitted'   THEN 'answered'
        WHEN 'distributed' THEN 'closed'
        WHEN 'void'        THEN 'void'
        ELSE NULL END
      -- projects.site_diary_entries has no status column at all (00002:146-158,
      -- 00017:14-18). The delay item's lifecycle is entirely spine-side.
      WHEN 'diary_action' THEN NULL
      ELSE NULL END
  $fn$;

  -- Policy. Reconciles a mapping with §03 §1.6's triage rule.
  CREATE OR REPLACE FUNCTION projects.work_item_status_for_mirror(
      p_current text, p_mapped text, p_has_explicit_assignee boolean)
  RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
    SELECT CASE
      -- Terminal states always win: a source that closed, was answered or was
      -- voided says so regardless of where the item sat.
      WHEN p_mapped IN ('answered','closed','void') THEN p_mapped
      -- Insert path (§03 §1.6).
      WHEN p_current IS NULL AND p_has_explicit_assignee THEN 'open'
      WHEN p_current IS NULL                             THEN 'triage'
      -- A mapped 'open' must never un-triage: A(b) maps inspection.assigned →
      -- open, and every unowned inbound item is born triage. Only the triage
      -- owner's explicit assign moves it (§03 §1.6: assign, re-date, or void).
      WHEN p_current = 'triage'  THEN 'triage'
      WHEN p_mapped  = 'open'    THEN 'open'
      ELSE p_current
    END
  $fn$;

  -- Improvement 6: a projected item may never arrive already overdue.
  -- Measured 2026-09-10: RFI "Drawings" was created AND due 2026-07-23; five
  -- August RFIs were created 08-17 and due 08-18 against A(b)'s +7 wd default;
  -- 15 of 18 inspections carry a scheduled_at in the past. Returning NULL hands
  -- the decision to item 2's BEFORE INSERT trigger, which computes the TYPE's
  -- offset on the TYPE's calendar (A(b), A(h)) — so no new calendar maths lives
  -- here and there is nothing to keep in sync.
  -- STABLE, not IMMUTABLE: it reads CURRENT_DATE.
  CREATE OR REPLACE FUNCTION projects.work_item_mirror_due_date(p_source date)
  RETURNS date LANGUAGE sql STABLE AS $fn$
    SELECT CASE WHEN p_source IS NULL OR p_source <= CURRENT_DATE THEN NULL ELSE p_source END
  $fn$;

  -- Improvement 1: what actually counts as a delay.
  -- projects.site_diary_entries has no "was there a delay" flag, only two free
  -- text columns (delays, 00002:154; delay_notes, 00017:18). Measured 2026-09-10,
  -- ALL SIX entries a non-empty test would have projected are negations:
  --   'None,'  'None,'  'None'  'None'  'NO'
  --   'No delays or info required was noted in the site walk and or meeting'
  -- A non-empty test measures whether the box was filled in, not whether a delay
  -- occurred — the same class of error as counting form_responses newlines.
  -- Contractors will keep typing "None" daily, so this lives on the LIVE path,
  -- not only in the backfill.
  CREATE OR REPLACE FUNCTION projects.diary_delay_text(p_delays text, p_delay_notes text)
  RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
    WITH candidate AS (
      SELECT COALESCE(NULLIF(TRIM(p_delays), ''), NULLIF(TRIM(p_delay_notes), '')) AS t
    )
    SELECT CASE
      WHEN c.t IS NULL THEN NULL
      -- exact-token negations
      WHEN lower(regexp_replace(c.t, '[[:punct:][:space:]]+$', ''))
             IN ('none','no','n/a','na','nil','nothing','-','0','none noted','no delays') THEN NULL
      -- sentence negations: the 2026-06-02 entry is a full sentence, so a token
      -- list alone would have let it through.
      WHEN lower(c.t) ~ '^(no|none|nil|nothing)\y[^.]{0,80}(delay|issue|problem|info)' THEN NULL
      ELSE c.t
    END
    FROM candidate c
  $fn$;
  ```

- [ ] **Step 4: Run the probe and watch 24/24 pass.**
  ```bash
  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/03-status-map.sql \
    --with apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql
  ```
  (Eleven `cases` rows plus thirteen `UNION ALL` rows. If the printed `assertions seen:` list is shorter than twenty-four, an arm was dropped — read the list, not the total.)

- [ ] **Step 5: Mutation-verify the stop-list against the real live strings.** Change `diary_delay_text` to `SELECT COALESCE(NULLIF(TRIM(p_delays),''), NULLIF(TRIM(p_delay_notes),''))` — the original non-empty predicate — and re-run. Expected:
  ```
  FAIL  diary_none_is_not_a_delay            all 6 of 6 live "delays" are negations: …
  FAIL  diary_long_negation_is_not_a_delay   the 2026-06-02 entry: a sentence, not a token, …
  ```
  Then restore only the token list (delete the sentence-negation arm) and re-run: `diary_none_is_not_a_delay` passes, `diary_long_negation_is_not_a_delay` still FAILs. Restore both. Record 24/24 → 22/24 → 23/24 → 24/24.

- [ ] **Step 6: Write the contract test.** This is the half the SQL probe cannot do: it proves no source status value has been *forgotten*. Create `apps/web/src/lib/work-items/source-status-map.contract.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { readFileSync, readdirSync } from 'node:fs'
  import { join, resolve } from 'node:path'

  /**
   * Contract test: projects.map_source_status must carry an arm for every value
   * in every mirrored source table's own status CHECK, and every non-null result
   * must be a member of the projects.work_items status CHECK.
   *
   * The fixture is the migrations themselves, on both sides. A hardcoded list
   * here would pass forever after someone widened a source CHECK — which is how
   * `photo_type: 'defect'` shipped and produced zero rows in field.snag_photos.
   */
  const REPO_ROOT = resolve(__dirname, '../../../../..')
  const MIG_DIR = join(REPO_ROOT, 'apps/edge-functions/supabase/migrations')

  /** Find a migration by a distinctive string in its BODY, never by filename. */
  function migrationContaining(needle: string): string {
    for (const n of readdirSync(MIG_DIR).sort()) {
      const sql = readFileSync(join(MIG_DIR, n), 'utf8')
      if (sql.includes(needle)) return sql
    }
    throw new Error(`no migration contains ${JSON.stringify(needle)}`)
  }

  const mirrorSql = () =>
    migrationContaining('CREATE OR REPLACE FUNCTION projects.map_source_status')
  const spineSql = () => migrationContaining('CREATE TABLE projects.work_items')

  /**
   * Values in the `<col> IN (…)` CHECK for `column`, searched ONLY from `anchor`
   * onward. The anchor is mandatory: in 00002_projects_schema.sql the FIRST
   * `CHECK (status IN (…))` is projects.projects at line 20
   * (planning|active|on_hold|completed|cancelled), not projects.rfis at line 90.
   * An unanchored search demands that the rfi arm cover the project vocabulary
   * and fails permanently.
   */
  function checkValues(sql: string, anchor: string, column: string): string[] {
    const start = sql.indexOf(anchor)
    if (start < 0) throw new Error(`anchor not found: ${anchor}`)
    const slice = sql.slice(start)
    const re = new RegExp(`${column}[\\s\\S]{0,400}?CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)`, 'i')
    const m = slice.match(re)
    if (!m) throw new Error(`no CHECK found for ${column} after ${anchor}`)
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
  }

  /** The `WHEN '<x>' THEN` arms inside one `WHEN '<type>' THEN CASE …` block. */
  function armsForType(sql: string, itemType: string): string[] {
    const start = sql.indexOf(`WHEN '${itemType}' THEN`)
    if (start < 0) throw new Error(`map_source_status has no arm for item_type '${itemType}'`)
    const rest = sql.slice(start + 10)
    const end = rest.search(/\n\s*WHEN '[a-z_]+' THEN CASE|\n\s*ELSE NULL END\s*\n\s*\$fn\$/)
    const block = rest.slice(0, end < 0 ? rest.length : end)
    return [...block.matchAll(/WHEN\s+'([^']+)'\s+THEN/g)].map((x) => x[1])
  }

  const SOURCES = [
    { type: 'rfi',         needle: 'CREATE TABLE projects.rfis',
      anchor: 'CREATE TABLE projects.rfis',            column: 'status',
      expect: ['draft', 'open', 'responded', 'closed'] },
    { type: 'snag',        needle: 'CREATE TABLE field.snags',
      anchor: 'CREATE TABLE field.snags',              column: 'status',
      expect: ['open', 'in_progress', 'resolved', 'pending_sign_off', 'signed_off', 'closed'] },
    { type: 'inspection',  needle: 'CREATE TABLE inspections.inspections',
      anchor: 'CREATE TABLE inspections.inspections',  column: 'status',
      expect: ['assigned', 'in_progress', 'awaiting_verification', 'certified',
               're-inspect_required', 'abandoned'] },
    { type: 'qc_defect',   needle: 'qc_entries_conformance_check',
      anchor: 'qc_entries_conformance_check',          column: 'conformance',
      expect: ['pass', 'fail', 'na'] },
    { type: 'form_action', needle: 'CREATE TABLE field.site_forms',
      anchor: 'CREATE TABLE field.site_forms',         column: 'status',
      expect: ['draft', 'submitted', 'distributed', 'void'] },
  ] as const

  describe('map_source_status covers every source vocabulary', () => {
    for (const s of SOURCES) {
      it(`${s.type}: the parser reads the right CHECK`, () => {
        // Assert the PARSE before comparing it to anything. An anchor that
        // silently matched the wrong table would otherwise make the next test
        // pass or fail for a reason that has nothing to do with the mapping.
        const values = checkValues(migrationContaining(s.needle), s.anchor, s.column)
        expect(values.sort()).toEqual([...s.expect].sort())
      })

      it(`${s.type}: every value in the source CHECK has an arm`, () => {
        const values = checkValues(migrationContaining(s.needle), s.anchor, s.column)
        const arms = armsForType(mirrorSql(), s.type)
        const missing = values.filter((v) => !arms.includes(v))
        expect(missing, `${s.type} has no arm for: ${missing.join(', ')}`).toEqual([])
      })
    }

    it('diary_action is mapped to NULL unconditionally (the source has no status column)', () => {
      expect(mirrorSql()).toMatch(/WHEN 'diary_action' THEN NULL/)
    })

    it('every mapped result is a member of the work_items status CHECK', () => {
      const universal = checkValues(spineSql(), 'CREATE TABLE projects.work_items', 'status')
      expect(universal.sort()).toEqual(['answered', 'closed', 'open', 'triage', 'void'])
      const produced = [...mirrorSql().matchAll(/WHEN\s+'[^']+'\s+THEN\s+'([a-z_]+)'/g)].map((x) => x[1])
      const rogue = [...new Set(produced)].filter((p) => !universal.includes(p))
      expect(rogue, `map_source_status produces non-universal states: ${rogue.join(', ')}`).toEqual([])
    })

    it('the diary negation stop-list exists and covers every live value', () => {
      const sql = mirrorSql()
      expect(sql).toMatch(/CREATE OR REPLACE FUNCTION projects\.diary_delay_text/)
      for (const token of ['none', 'no', 'n/a', 'na', 'nil', 'nothing']) {
        expect(
          sql,
          `diary_delay_text must stop-list ${JSON.stringify(token)} — all 6 of 6 live ` +
          `site_diary_entries "delays" values are negations (measured 2026-09-10)`,
        ).toContain(`'${token}'`)
      }
      // The 2026-06-02 entry is a sentence, so the token list alone is not enough.
      expect(sql).toMatch(/\^\(no\|none\|nil\|nothing\)/)
    })
  })
  ```

- [ ] **Step 7: Run it and watch it pass.**
  ```bash
  pnpm --filter web test source-status-map
  ```
  Expected: 13 passed (5 parse + 5 coverage + diary-null + universal + stop-list).

- [ ] **Step 8: Prove the contract test can fail, three ways.** One at a time, undo, run, confirm the named failure, restore:
  - delete `WHEN 'pending_sign_off' THEN 'answered'` ⇒ *"snag has no arm for: pending_sign_off"*
  - change the `rfi` anchor to the bare string `'status'` ⇒ *"rfi: the parser reads the right CHECK"* fails with the `projects.projects` vocabulary, which is the whole reason the anchor exists
  - delete `'nil'` from `diary_delay_text` ⇒ *"diary_delay_text must stop-list \"nil\" — all 6 of 6 live … values are negations"*

  Record 13 → 12 → 13 for each in the PR body.

- [ ] **Step 9: Commit.**
  ```bash
  git add apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql \
          apps/web/src/lib/work-items/source-status-map.contract.test.ts \
          scripts/db/probes/03-status-map.sql
  git commit -m "feat(work-items): status mapping, non-overdue due dates, and the diary negation stop-list

A mapped 'open' cannot un-triage. A source due date at or before today becomes
NULL so item 2's trigger computes the type's own offset. And all six live diary
'delays' values are the word None — a non-empty test measures whether the box
was filled in, not whether a delay happened."
  ```

---

## Task 5 — The RFI projection: the reference implementation (F6, F7, F8, improvements 4, 6, 8, 10)

This is the pattern Tasks 7–11 repeat. Read it first and repeat it deliberately rather than abstracting it — five of the six differ in their column names, their title expression, their priority source and their gatekeeper, which is most of the function.

**Two functions per source, and the split is load-bearing** (improvement 10):

| | What it is | Who calls it |
|---|---|---|
| `projects.project_rfi(uuid)` | Plain function. Reads the RFI row by id, does the whole projection. Carries **no** recursion guard. | the wrapper, and **the backfill (section H) directly** |
| `projects.mirror_rfi_work_item()` | Trigger wrapper. Two lines: the depth guard, then `PERFORM projects.project_rfi(NEW.id)`. | the two triggers |

Why: the backfill must project 15 RFIs without touching a source row. Every source table carries a `BEFORE UPDATE set_updated_at` trigger (`rfis_updated_at` `00002:100`, `snags_updated_at` `00004:33`, and four more, all verified in `pg_trigger`), so `UPDATE projects.rfis SET status = status` would rewrite `updated_at` on 15 live rows whose values currently span 24 Jun – 2 Sep. It would also fire `field.site_forms`' `trg_site_forms_transition`, whose body raises `42501` on a same-status update of any non-draft form and is escaped only by `current_user IN ('postgres','service_role','supabase_admin')` (`00179:353`) — making the backfill depend on the role `db push` happens to use. And with F7's `WHEN` predicates in place, a no-op UPDATE fires **nothing at all**, so the old backfill would have inserted zero rows.

**Three loop defences, doing three different jobs** (§03 §1.2). Do not collapse them:
1. The `WHEN` clause on the `_upd` trigger — stops the trigger firing at all on an unrelated `UPDATE`.
2. `pg_trigger_depth() > 1` inside the **wrapper** — **this is what terminates the cycle**, measured (F2).
3. The value-difference check in the write-back (Task 6) — prevents write amplification and a spurious `updated_at` bump on the source, not recursion.

**Two triggers, not one** (F7). PostgreSQL rejects `WHEN (OLD.…)` on a trigger whose event list includes `INSERT`:
```
ERROR:  42P17: INSERT trigger's WHEN condition cannot reference OLD values
```
so §03 §1.2's single declaration is split into `_ins` (`AFTER INSERT`, no `WHEN`) and `_upd` (`AFTER UPDATE OF …` with the mandated `WHEN`).

**Files:**
- Modify: the migration — start section D
- Test: `scripts/db/probes/04-rfi-mirror.sql`

- [ ] **Step 1: Write the probe first, from the empty state.** Every mutation lives inside the `DO` block and its observations are recorded into a temp table; the file ends in one assertion `SELECT`. Create `scripts/db/probes/04-rfi-mirror.sql`:
  ```sql
  -- Walks from an empty project, never from seeded data (§12 §(h)).
  -- ⚠ Every mutation is inside the DO block. `UPDATE … RETURNING` cannot appear
  -- in a FROM clause (42601), and sibling parts of one statement read the
  -- pre-update snapshot — so an assertion that "the status changed" written as a
  -- subquery beside the UPDATE can never be true.
  DO $probe$
  DECLARE
    v_org   uuid := 'dddddddd-0000-0000-0000-000000000001';  -- WM-Consulting
    v_pm    uuid;
    v_other uuid;
    v_proj  uuid;
    v_rfi   uuid;
    v_after_insert  record;
    v_after_respond record;
  BEGIN
    SELECT u.user_id INTO v_pm FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active LIMIT 1;
    SELECT u.user_id INTO v_other FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.is_active AND u.role <> 'client_viewer'
       AND u.user_id <> v_pm LIMIT 1;

    INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
    VALUES (v_org, '_probe_rfi_mirror', 'active', 'ZAR', v_pm)
    RETURNING id INTO v_proj;   -- ensure_project_settings_row() fires here

    -- Raised by v_other (a non-owner), with NO assignee and a due date of TODAY —
    -- the exact live shape of RFI "Drawings" (created and due 2026-07-23).
    INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                               priority, status, raised_by, due_date)
    VALUES (v_proj, v_org, 'Probe RFI', 'body', 'high', 'open', v_other, CURRENT_DATE)
    RETURNING id INTO v_rfi;

    SELECT w.id, w.item_type, w.title, w.priority, w.status, w.source_status,
           w.assignee_id, w.gatekeeper_id, w.ball_in_court_id, w.due_date, w.origin
      INTO v_after_insert
      FROM projects.work_items w WHERE w.rfi_id = v_rfi AND w.origin = 'mirror';

    -- Push-back, and the F8 case: the RAISER (a non-gatekeeper by role) moves
    -- the source's own status. This must not be refused by item 2's guard.
    UPDATE projects.rfis SET status = 'responded' WHERE id = v_rfi;

    SELECT w.status, w.ball_in_court_id INTO v_after_respond
      FROM projects.work_items w WHERE w.rfi_id = v_rfi;

    -- A second projection through a column in the UPDATE OF list that does NOT
    -- change status. If ON CONFLICT were removed this would raise 23505; if the
    -- upsert target were wrong it would create a second item.
    UPDATE projects.rfis SET priority = 'low' WHERE id = v_rfi;

    CREATE TEMP TABLE rfi_ctx(
      rfi uuid, proj uuid, pm uuid, other uuid,
      ins_status text, ins_bic uuid, ins_assignee uuid, ins_gate uuid,
      ins_due date, ins_title text, ins_priority text, ins_source_status text, ins_type text,
      resp_status text, resp_bic uuid) ON COMMIT DROP;
    INSERT INTO rfi_ctx VALUES (
      v_rfi, v_proj, v_pm, v_other,
      v_after_insert.status, v_after_insert.ball_in_court_id, v_after_insert.assignee_id,
      v_after_insert.gatekeeper_id, v_after_insert.due_date, v_after_insert.title,
      v_after_insert.priority, v_after_insert.source_status, v_after_insert.item_type,
      v_after_respond.status, v_after_respond.ball_in_court_id);
  END $probe$;

  SELECT 'item_created' AS probe,
         (SELECT count(*) FROM projects.work_items w, rfi_ctx c
           WHERE w.rfi_id = c.rfi AND w.origin = 'mirror') = 1 AS ok,
         'one mirror item per RFI' AS detail
  UNION ALL
  SELECT 'item_shape',
         (SELECT c.ins_type = 'rfi' AND c.ins_title = 'Probe RFI' AND c.ins_priority = 'high'
             AND c.ins_source_status = 'open' AND c.ins_assignee IS NOT NULL
             AND c.ins_gate IS NOT NULL AND c.ins_due IS NOT NULL FROM rfi_ctx c),
         'type/title/priority/source_status/people/due all set at insert'
  UNION ALL
  SELECT 'born_in_triage',
         (SELECT c.ins_status = 'triage' FROM rfi_ctx c),
         '§03 §1.6: no explicit assignee ⇒ triage'
  UNION ALL
  SELECT 'bic_is_the_assignee',
         (SELECT c.ins_bic = c.ins_assignee FROM rfi_ctx c),
         'A(a): non-null from the first millisecond, and on triage it is the assignee'
  UNION ALL
  -- Improvement 4.
  SELECT 'gatekeeper_is_the_raiser',
         (SELECT c.ins_gate = c.other FROM rfi_ctx c),
         'A(b) as amended: an RFI is closed by the person who asked, once the answer is usable'
  UNION ALL
  SELECT 'assignee_is_not_the_gatekeeper',
         (SELECT c.ins_assignee <> c.ins_gate FROM rfi_ctx c),
         '§03 §1.8''s "only the gatekeeper may close" is vacuous when they are the same person'
  UNION ALL
  -- Improvement 6.
  SELECT 'not_born_overdue',
         (SELECT c.ins_due > CURRENT_DATE FROM rfi_ctx c),
         'the source said due TODAY; item 2''s trigger must have computed +7 wd instead'
  UNION ALL
  SELECT 'raiser_is_watcher',
         EXISTS (SELECT 1 FROM projects.work_item_watchers ww
                   JOIN projects.work_items w ON w.id = ww.work_item_id
                   JOIN rfi_ctx c ON c.rfi = w.rfi_id
                  WHERE ww.user_id = c.other),
         '§03 §1.5: the raiser is auto-added as a watcher'
  UNION ALL
  -- F8: the source-side push-back must not be refused by item 2's gatekeeper guard.
  SELECT 'status_pushback',
         (SELECT c.resp_status = 'answered' FROM rfi_ctx c),
         'F8: responded ⇒ answered. If this errors instead of failing, item 2''s guard does not exempt pg_trigger_depth() > 0'
  UNION ALL
  SELECT 'bic_moves_to_gatekeeper',
         (SELECT c.resp_bic = c.ins_gate FROM rfi_ctx c),
         'answered ⇒ the ball is with the person who asked'
  UNION ALL
  SELECT 'idempotent_reprojection',
         (SELECT count(*) FROM projects.work_items w, rfi_ctx c WHERE w.rfi_id = c.rfi) = 1,
         'a second projection (priority edit) must not create a second item'
  UNION ALL
  SELECT 'reprojection_kept_the_status',
         (SELECT w.status FROM projects.work_items w, rfi_ctx c WHERE w.rfi_id = c.rfi) = 'answered',
         'the update arm must not reset a terminal status on an unrelated edit';
  ```
  ⚠ Everything runs inside the harness's single rolled-back transaction, so the probe project and its RFI never exist. **Do not add a `COMMIT`** — the harness refuses it. ⚠ The insert consumes **one** value of `projects.rfis_rfi_number_seq`, which a rollback does not return. That is one number; the 50,000-row scale probe in Task 15 is the one that must restore the sequence.

- [ ] **Step 2: Run it and watch it fail.**
  ```bash
  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/04-rfi-mirror.sql \
    --with apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql
  ```
  Expected: `FAIL  item_created  one mirror item per RFI` and `0/12` — no trigger exists, so the RFI produces nothing and every recorded observation is NULL.

- [ ] **Step 3: Append the watcher helper and the RFI projection to the migration.**
  ```sql
  -- ─── D. Projection ───────────────────────────────────────────────────────────
  -- Every function here is SECURITY DEFINER (§03 §1.2): it writes assignee_id,
  -- gatekeeper_id and due_date, which the contractor who raised the RFI must not
  -- be able to forge, and without it item 2's RESTRICTIVE INSERT policy on
  -- work_items would be evaluated against that contractor and their perfectly
  -- legitimate RFI insert would fail. Attribution uses auth.uid(), never
  -- current_user, which resolves to the function OWNER.
  --
  -- ⚠ F8. Being SECURITY DEFINER does NOT change auth.uid(): inside these
  -- functions it is still the contractor who touched the source row. Item 2's
  -- gatekeeper BEFORE UPDATE guard must therefore exempt pg_trigger_depth() > 0,
  -- or a contractor closing their own RFI aborts the RFI close. Section A asserts
  -- that exemption exists before this migration will apply.

  CREATE OR REPLACE FUNCTION projects.seed_work_item_watchers(
      p_item uuid, p_raiser uuid, p_assignee uuid, p_gatekeeper uuid)
  RETURNS void
  LANGUAGE sql SECURITY DEFINER
  SET search_path TO 'projects', 'public'
  SET row_security TO 'off'
  AS $fn$
    -- One row per PERSON, deduped deliberately with a stated precedence rather
    -- than left to whichever the index happens to reject. On the demo project all
    -- three roles fall through to projects.created_by and are the same person.
    -- The conflict target is explicit for the same reason as everywhere else in
    -- this migration (F6): a bare ON CONFLICT DO NOTHING hides real errors.
    INSERT INTO projects.work_item_watchers (work_item_id, user_id, reason)
    SELECT DISTINCT ON (v.user_id) p_item, v.user_id, v.reason
      FROM (VALUES (p_assignee,'assignee',1), (p_gatekeeper,'gatekeeper',2), (p_raiser,'raiser',3))
           AS v(user_id, reason, prio)
     WHERE v.user_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = v.user_id)
     ORDER BY v.user_id, v.prio
    ON CONFLICT (work_item_id, user_id) DO NOTHING;
  $fn$;

  -- The projection body. Plain function, no recursion guard, callable directly —
  -- which is how the backfill projects 15 RFIs without touching a source row.
  CREATE OR REPLACE FUNCTION projects.project_rfi(p_rfi_id uuid)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'projects', 'public'
  SET row_security TO 'off'
  AS $fn$
  DECLARE
    r          projects.rfis%ROWTYPE;
    v_item     projects.work_items%ROWTYPE;
    v_assignee uuid;
    v_gate     uuid;
    v_mapped   text;
    v_moved    boolean;
  BEGIN
    SELECT * INTO r FROM projects.rfis WHERE id = p_rfi_id;
    IF NOT FOUND THEN RETURN; END IF;

    SELECT * INTO v_item FROM projects.work_items
     WHERE rfi_id = r.id AND origin = 'mirror';

    v_mapped := projects.map_source_status('rfi', r.status);

    IF v_item.id IS NULL THEN
      v_assignee := projects.resolve_work_item_assignee(r.project_id, 'rfi', r.assigned_to);
      -- Improvement 4: the RFI gatekeeper is the RAISER, not the project PM.
      -- Measured: triage_owner_id and the PM resolver both return the same person
      -- on 13 of 14 projects, so a PM gatekeeper makes assignee and gatekeeper
      -- identical on every live RFI and §03 §1.8's close gate vacuous. 12 of 15
      -- live RFIs were raised by contractors, and this is the only mechanism in
      -- Q1 that puts an item into a contractor's ball-in-court. If the raiser is
      -- ineligible (departed, or a client viewer) the resolver falls back to the PM.
      v_gate     := projects.resolve_work_item_gatekeeper(r.project_id, r.raised_by);

      INSERT INTO projects.work_items (
        organisation_id, project_id, item_type, origin, title, priority,
        status, source_status, assignee_id, gatekeeper_id, due_date, created_by, rfi_id)
      VALUES (
        r.organisation_id, r.project_id, 'rfi', 'mirror', r.subject, r.priority,
        projects.work_item_status_for_mirror(NULL, v_mapped, r.assigned_to IS NOT NULL),
        r.status, v_assignee, v_gate,
        -- Improvement 6: a past or same-day source date becomes NULL so item 2's
        -- BEFORE INSERT trigger computes A(b)'s +7 wd on the office calendar.
        projects.work_item_mirror_due_date(r.due_date),
        r.raised_by, r.id)
      -- Explicit partial-index target, never a bare ON CONFLICT DO NOTHING (F6).
      -- Measured: this swallows a duplicate projection, leaves an origin='split'
      -- row on the same source untouched, and STILL raises 23505 on a
      -- work_items_ref_unique collision — which the bare form would have hidden,
      -- turning a ref numbering race into a silently missing inbox item.
      ON CONFLICT (rfi_id) WHERE rfi_id IS NOT NULL AND origin = 'mirror' DO NOTHING
      RETURNING * INTO v_item;

      IF v_item.id IS NOT NULL THEN
        PERFORM projects.seed_work_item_watchers(v_item.id, r.raised_by, v_assignee, v_gate);
      END IF;
    ELSE
      -- Improvement 8: a project move re-resolves both people. §15's rollout has
      -- already decided "snags move to KINGSWALK", and correcting an RFI raised on
      -- the wrong project is routine in a 14-project estate. Without this the item
      -- keeps the old project's scope and counts and its assignee may not be a
      -- member of the new project at all — which item 2's assignee-membership
      -- trigger would have rejected had the row been inserted that way.
      v_moved := v_item.project_id IS DISTINCT FROM r.project_id;

      IF v_moved THEN
        v_assignee := projects.resolve_work_item_assignee(r.project_id, 'rfi', r.assigned_to);
        v_gate     := projects.resolve_work_item_gatekeeper(r.project_id, r.raised_by);
      ELSE
        v_assignee := COALESCE(
          CASE WHEN projects.work_item_person_eligible(r.project_id, r.assigned_to)
               THEN r.assigned_to END,
          v_item.assignee_id);
        v_gate := v_item.gatekeeper_id;
      END IF;

      UPDATE projects.work_items
         SET project_id       = r.project_id,
             organisation_id  = r.organisation_id,
             title            = r.subject,
             priority         = r.priority,
             source_status    = r.status,
             status           = projects.work_item_status_for_mirror(v_item.status, v_mapped, false),
             assignee_id      = v_assignee,
             gatekeeper_id    = v_gate,
             closed_at        = CASE WHEN r.status = 'closed'
                                     THEN COALESCE(v_item.closed_at, r.closed_at, now())
                                     ELSE NULL END,
             closed_by        = CASE WHEN r.status = 'closed'
                                     THEN COALESCE(v_item.closed_by, r.closed_by) END,
             last_activity_at = now()
       WHERE id = v_item.id;
    END IF;
  END $fn$;

  -- The trigger wrapper. Two lines: the guard that terminates the mirror ⇄
  -- write-back cycle (measured trace mirror@1 → writeback@2 → mirror@3 → skipped;
  -- removing it and the write-back's value check produces
  -- "ERROR: 54001: stack depth limit exceeded"), then the projection.
  CREATE OR REPLACE FUNCTION projects.mirror_rfi_work_item()
  RETURNS TRIGGER
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'projects', 'public'
  SET row_security TO 'off'
  AS $fn$
  BEGIN
    IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
    PERFORM projects.project_rfi(NEW.id);
    RETURN NULL;   -- AFTER trigger; the return value is ignored
  END $fn$;

  -- F7: two triggers, because PostgreSQL rejects a WHEN clause referencing OLD on
  -- a trigger whose event list includes INSERT ("INSERT trigger's WHEN condition
  -- cannot reference OLD values"). §03 §1.2's single declaration is not valid SQL.
  CREATE TRIGGER rfis_mirror_work_item_ins
    AFTER INSERT ON projects.rfis
    FOR EACH ROW EXECUTE FUNCTION projects.mirror_rfi_work_item();

  CREATE TRIGGER rfis_mirror_work_item_upd
    AFTER UPDATE OF subject, priority, status, due_date, assigned_to,
                    closed_at, closed_by, project_id, organisation_id
    ON projects.rfis
    FOR EACH ROW
    WHEN (OLD.subject         IS DISTINCT FROM NEW.subject
       OR OLD.priority        IS DISTINCT FROM NEW.priority
       OR OLD.status          IS DISTINCT FROM NEW.status
       OR OLD.due_date        IS DISTINCT FROM NEW.due_date
       OR OLD.assigned_to     IS DISTINCT FROM NEW.assigned_to
       OR OLD.closed_at       IS DISTINCT FROM NEW.closed_at
       OR OLD.closed_by       IS DISTINCT FROM NEW.closed_by
       OR OLD.project_id      IS DISTINCT FROM NEW.project_id
       OR OLD.organisation_id IS DISTINCT FROM NEW.organisation_id)
    EXECUTE FUNCTION projects.mirror_rfi_work_item();
  ```

- [ ] **Step 4: Run the probe and watch 12/12 pass.** Read the `assertions seen:` line; if it is shorter than twelve names, a `UNION ALL` arm was dropped.

- [ ] **Step 5: Prove F8 is really being exercised.** Temporarily comment out item 2's `pg_trigger_depth() > 0` exemption in a copy of item 2's migration and run this probe with **both** files stacked:
  ```bash
  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/04-rfi-mirror.sql \
    --with /tmp/item2-without-exemption.sql \
    --with apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql
  ```
  Expected — and this is the production failure F8 predicts:
  ```
  FAIL (HTTP 400)
  … ERROR: P0001: only the gatekeeper may change this item's status
  ```
  i.e. the `UPDATE projects.rfis SET status = 'responded'` **aborts**, so the RFI never reaches `responded` at all. Record it in the PR body as the evidence for the requirement on item 2.

- [ ] **Step 6: Mutation-verify improvement 4.** Change `projects.resolve_work_item_gatekeeper(r.project_id, r.raised_by)` to `(r.project_id, NULL)` in **both** arms. Re-run. Expected:
  ```
  FAIL  gatekeeper_is_the_raiser         A(b) as amended: an RFI is closed by the person who asked, …
  FAIL  assignee_is_not_the_gatekeeper   §03 §1.8's "only the gatekeeper may close" is vacuous …
  FAIL  bic_moves_to_gatekeeper          answered ⇒ the ball is with the person who asked
  ```
  Restore. Record 12/12 → 9/12 → 12/12.

- [ ] **Step 7: Mutation-verify improvement 6.** Change `projects.work_item_mirror_due_date(r.due_date)` to `r.due_date`. Re-run. Expected: `FAIL not_born_overdue  the source said due TODAY; item 2's trigger must have computed +7 wd instead`. Restore.

- [ ] **Step 8: Mutation-verify F6.** Replace the `ON CONFLICT (rfi_id) WHERE …` clause with a bare `ON CONFLICT DO NOTHING`. Re-run: still 12/12 — a bare form does not fail *this* probe, which is exactly the danger. Now run the collision by hand: append this to the `DO` block, before the temp table insert, and re-run with each form:
  ```sql
    -- With the explicit target this raises 23505 on work_items_ref_unique (A(a)).
    -- With a bare ON CONFLICT DO NOTHING it vanishes and nobody ever knows.
    INSERT INTO projects.work_items (organisation_id, project_id, item_type, origin,
      ref, title, status, assignee_id, gatekeeper_id, due_date, created_by, rfi_id)
    SELECT w.organisation_id, w.project_id, 'task', 'manual', w.ref, 'ref clash', 'open',
           w.assignee_id, w.gatekeeper_id, w.due_date, w.created_by, NULL
      FROM projects.work_items w WHERE w.rfi_id = v_rfi
    ON CONFLICT DO NOTHING;
  ```
  Expected with the bare form: the probe still reports 12/12 and the clashing row is silently absent. Expected with `ON CONFLICT ON CONSTRAINT work_items_ref_unique DO NOTHING` replaced by nothing at all:
  ```
  FAIL (HTTP 400)
  … ERROR: 23505: duplicate key value violates unique constraint "work_items_ref_unique"
  ```
  Restore the explicit target on `project_rfi` and remove the temporary insert. Record both outcomes in the PR body — this finding is about which errors stay visible, and only a by-hand comparison shows it.

- [ ] **Step 9: Note the deferred F2 mutation.** Changing `IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;` to `IF false THEN` cannot blow up until the write-back exists. **Task 6 Step 7 runs it.** Do not skip it.

- [ ] **Step 10: Commit.**
  ```bash
  git add apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql \
          scripts/db/probes/04-rfi-mirror.sql
  git commit -m "feat(work-items): RFI projection — project_rfi() + guarded wrapper + ins/upd triggers

The gatekeeper is the raiser, not the PM: triage_owner_id and the PM resolver
return the same person on 13 of 14 projects, so a PM gatekeeper makes assignee
and gatekeeper identical on every live RFI. A same-day source due date becomes
NULL so item 2's trigger computes +7 working days instead."
  ```

---

## Task 6 — Assignment and due-date write-back (F2, improvements 9 and 11)

The point of the write-back is that "existing readers and PDFs keep working untouched" (§13 item 3). After it lands, `apps/web/src/app/(admin)/rfis/[id]/page.tsx:271-272` renders an assignee for the first time in production.

Three rules, each measured:

- **No depth guard here** (F2). With one, an RFI raised with no assignee gets a work item naming the triage owner while `rfis.assigned_to` stays NULL — the page still renders nothing and the write-back has bought exactly nothing. Without one, the cycle still terminates at depth 3 because the *wrapper* is guarded.
- **`due_date` is written back too** (improvement 11). §04 makes re-dating a first-class keyboard verb (`D`) and §03 §1.6 one of triage's three actions. Without this the RFI page, the RFI PDF and the Inbox give three answers to "when is this due", on the module carrying headline metric 4. `projects.rfis.due_date` exists (`00002:91`) and is populated on 13 of 15 rows.
- **Closed and void records are skipped** (improvement 9). **6 of 15** live RFIs are already `closed`. Stamping `assigned_to` on them makes the RFI page and any future RFI PDF render "Assigned to: Arno Mattheus" on a historical record nobody was ever assigned — the site-forms `as_left_status` lesson exactly: *the safest-sounding default is the most dangerous thing to invent, because nobody double-checks it.*

**Files:**
- Modify: the migration — add section E
- Test: `scripts/db/probes/05-writeback.sql`

- [ ] **Step 1: Write the probe first, covering all three rules.** Create `scripts/db/probes/05-writeback.sql`:
  ```sql
  DO $probe$
  DECLARE
    v_org uuid := 'dddddddd-0000-0000-0000-000000000001';
    v_pm uuid; v_other uuid; v_proj uuid;
    v_rfi uuid; v_closed uuid;
    v_a1 uuid; v_d1 date; v_a2 uuid; v_d2 date;
    v_closed_assignee uuid; v_closed_due date;
  BEGIN
    SELECT u.user_id INTO v_pm FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active LIMIT 1;
    SELECT u.user_id INTO v_other FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.is_active AND u.role <> 'client_viewer'
       AND u.user_id <> v_pm LIMIT 1;

    INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
    VALUES (v_org, '_probe_writeback', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj;

    -- (a) raised with NO assignee: the resolved holder must reach rfis.assigned_to
    INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                               priority, status, raised_by)
    VALUES (v_proj, v_org, 'Probe writeback', 'body', 'medium', 'open', v_pm)
    RETURNING id INTO v_rfi;

    SELECT r.assigned_to, r.due_date INTO v_a1, v_d1 FROM projects.rfis r WHERE r.id = v_rfi;

    -- (b) reassign + re-date on the spine ⇒ both reach the source
    UPDATE projects.work_items
       SET assignee_id = v_other, due_date = CURRENT_DATE + 21
     WHERE rfi_id = v_rfi;

    SELECT r.assigned_to, r.due_date INTO v_a2, v_d2 FROM projects.rfis r WHERE r.id = v_rfi;

    -- (c) a CLOSED record must not acquire an assignee it never had
    INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                               priority, status, raised_by, closed_at)
    VALUES (v_proj, v_org, 'Probe closed', 'body', 'medium', 'closed', v_pm, now())
    RETURNING id INTO v_closed;

    SELECT r.assigned_to, r.due_date INTO v_closed_assignee, v_closed_due
      FROM projects.rfis r WHERE r.id = v_closed;

    CREATE TEMP TABLE wb_ctx(rfi uuid, closed uuid, other uuid,
      a1 uuid, d1 date, a2 uuid, d2 date, ca uuid, cd date) ON COMMIT DROP;
    INSERT INTO wb_ctx VALUES (v_rfi, v_closed, v_other, v_a1, v_d1, v_a2, v_d2,
                               v_closed_assignee, v_closed_due);
  END $probe$;

  SELECT 'holder_reaches_source' AS probe,
         (SELECT a1 IS NOT NULL FROM wb_ctx) AS ok,
         'F2: with a depth guard on the write-back this stays NULL and the RFI page renders nothing' AS detail
  UNION ALL
  SELECT 'source_matches_item',
         (SELECT c.a1 = (SELECT w.assignee_id FROM projects.work_items w WHERE w.rfi_id = c.rfi)
            FROM wb_ctx c),
         'rfis.assigned_to and work_items.assignee_id agree'
  UNION ALL
  SELECT 'reassign_flows_to_source',
         (SELECT a2 = other FROM wb_ctx),
         'a work-item reassign writes projects.rfis.assigned_to'
  UNION ALL
  -- Improvement 11.
  SELECT 'redate_flows_to_source',
         (SELECT d2 = CURRENT_DATE + 21 FROM wb_ctx),
         'a work-item re-date writes projects.rfis.due_date, or the RFI page and the Inbox disagree'
  UNION ALL
  -- Improvement 9.
  SELECT 'closed_record_untouched',
         (SELECT ca IS NULL AND cd IS NULL FROM wb_ctx),
         '6 of 15 live RFIs are closed; inventing an assignee on a historical record is the as_left_status lesson'
  UNION ALL
  SELECT 'closed_item_still_exists',
         (SELECT count(*) FROM projects.work_items w, wb_ctx c WHERE w.rfi_id = c.closed) = 1,
         'the item is still projected — only the write-back is skipped'
  UNION ALL
  SELECT 'no_runaway_recursion', true,
         'reaching this row at all proves the mirror ⇄ write-back cycle terminated';
  ```

- [ ] **Step 2: Run it and watch it fail, 2/7.** Expected: `FAIL holder_reaches_source`, `FAIL source_matches_item`, `FAIL reassign_flows_to_source`, `FAIL redate_flows_to_source`, `FAIL closed_item_still_exists` — the mirror resolved a holder but nothing wrote it back, and no item exists at all. `closed_record_untouched` and `no_runaway_recursion` pass **vacuously** at this point; Step 5 makes the first of them real.

- [ ] **Step 3: Append section E.**
  ```sql
  -- ─── E. Assignment and due-date write-back ───────────────────────────────────
  -- Two sources only. inspections.inspections.assigned_to_id is deliberately NOT
  -- written back (§03 §1.2): the inspection engine's own assignment flow (00066)
  -- stays the system of record for that column, and a third write-back is a third
  -- loop to reason about. (The inspection mirror still READS that column forward —
  -- see Task 8. "System of record" is an argument for not writing back, not for
  -- not reading forward.)
  --
  -- ⚠ NO pg_trigger_depth() guard here, and that asymmetry is load-bearing (F2).
  -- Measured: with a uniform guard, an RFI raised with no assignee ends up with
  -- work_items.assignee_id = the resolved holder and rfis.assigned_to = NULL — the
  -- write-back silently buys nothing. Termination is the WRAPPER's guard, not this
  -- one; the value-difference predicates below only stop write amplification and a
  -- spurious rfis_updated_at bump (00002:100-102).
  CREATE OR REPLACE FUNCTION projects.work_item_assignment_writeback()
  RETURNS TRIGGER
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'projects', 'public', 'field'
  SET row_security TO 'off'
  AS $fn$
  BEGIN
    IF NEW.origin <> 'mirror' THEN RETURN NULL; END IF;   -- splits own their own lifecycle

    -- Improvement 9: never invent an assignee or a future deadline on a record
    -- that is already finished. 6 of 15 live RFIs are closed.
    IF NEW.status IN ('closed','void') THEN RETURN NULL; END IF;

    IF NEW.rfi_id IS NOT NULL THEN
      UPDATE projects.rfis
         SET assigned_to = NEW.assignee_id,
             due_date    = NEW.due_date
       WHERE id = NEW.rfi_id
         AND status NOT IN ('closed')
         AND (assigned_to IS DISTINCT FROM NEW.assignee_id
           OR due_date    IS DISTINCT FROM NEW.due_date);
    ELSIF NEW.snag_id IS NOT NULL THEN
      -- field.snags has no due_date column (00004:10-32), so assignment only.
      UPDATE field.snags
         SET assigned_to = NEW.assignee_id
       WHERE id = NEW.snag_id
         AND status NOT IN ('signed_off','closed')
         AND assigned_to IS DISTINCT FROM NEW.assignee_id;
    END IF;

    RETURN NULL;
  END $fn$;

  -- F7 again: an INSERT arm cannot carry a WHEN referencing OLD.
  CREATE TRIGGER work_items_assignment_writeback_ins
    AFTER INSERT ON projects.work_items
    FOR EACH ROW EXECUTE FUNCTION projects.work_item_assignment_writeback();

  CREATE TRIGGER work_items_assignment_writeback_upd
    AFTER UPDATE OF assignee_id, due_date ON projects.work_items
    FOR EACH ROW
    WHEN (OLD.assignee_id IS DISTINCT FROM NEW.assignee_id
       OR OLD.due_date    IS DISTINCT FROM NEW.due_date)
    EXECUTE FUNCTION projects.work_item_assignment_writeback();
  ```

- [ ] **Step 4: Run the probe and watch 7/7 pass.**

- [ ] **Step 5: Mutation-verify improvement 9.** Delete `IF NEW.status IN ('closed','void') THEN RETURN NULL; END IF;` **and** the `AND status NOT IN ('closed')` predicate. Re-run. Expected:
  ```
  FAIL  closed_record_untouched  6 of 15 live RFIs are closed; inventing an assignee on a historical record is the as_left_status lesson
  ```
  Restore both. Record 7/7 → 6/7 → 7/7.

- [ ] **Step 6: Mutation-verify F2.** Add `IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;` as the first line of `work_item_assignment_writeback`, re-run:
  ```
  FAIL  holder_reaches_source  F2: with a depth guard on the write-back this stays NULL and the RFI page renders nothing
  FAIL  source_matches_item    rfis.assigned_to and work_items.assignee_id agree
  ```
  Remove it. Record 7/7 → 5/7 → 7/7.

- [ ] **Step 7: Now run Task 5 Step 9's deferred mutation — the termination proof.** In `mirror_rfi_work_item`, change `IF pg_trigger_depth() > 1 THEN` to `IF false THEN` **and** delete the `AND (assigned_to IS DISTINCT FROM … OR due_date IS DISTINCT FROM …)` predicate from the write-back. Re-run:
  ```
  FAIL (HTTP 400)
  … ERROR: 54001: stack depth limit exceeded
  HINT: Increase the configuration parameter "max_stack_depth" …
  ```
  Now restore **only** the depth guard, leaving the value predicate deleted, and confirm 7/7. That is the measured proof that the value check is a write-amplification guard and the depth guard is the termination guard, so nobody later "simplifies" the wrong one. Restore the value predicate.

- [ ] **Step 8: Record the one accepted divergence, in the migration, beside the function.**
  ```sql
  COMMENT ON FUNCTION projects.work_item_assignment_writeback() IS
    'Writes work_items.assignee_id and due_date back to projects.rfis, and assignee_id to '
    'field.snags (which has no due_date column). Skips closed and void records so a historical '
    'row never acquires an assignee it never had. '
    'Known divergence: createRfiAction reads rfi.assigned_to from the INSERT''s RETURNING clause '
    '(rfi.actions.ts:104), which is computed before this AFTER trigger runs — so an RFI raised '
    'with no assignee still emails "unassigned" while the row already names the resolved holder. '
    'Item 2 closes this by making assignee a required field on the create form (§03 §1.10).';
  ```

- [ ] **Step 9: Commit.**
  ```bash
  git add apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql \
          scripts/db/probes/05-writeback.sql
  git commit -m "feat(work-items): assignment + due-date write-back, deliberately without a depth guard

A uniform pg_trigger_depth() guard silently loses the write-back; termination
comes from the mirror wrapper's guard, proved by mutation. Due date is written
back too, or the RFI page, the RFI PDF and the Inbox give three answers. Closed
and void records are skipped: 6 of 15 live RFIs are closed and must not acquire
an assignee nobody ever set."
  ```

---

## Task 7 — The snag projection (improvement 5)

Same shape as Task 5. Four differences that matter:

1. The snag's default assignee falls to `raised_by` before the resolver chain (§12 §(d)); `raised_by` is `NOT NULL` (`00004:25`).
2. The gatekeeper is the **project PM, never the raiser** (§03 §1.5) — the opposite of the RFI. `signOffSnagAction` today stamps whoever clicked, with no role gate beyond authentication, so a raiser-closes default would hand close authority to the contractor who reported the defect. (An RFI is the mirror image: the asker confirms the answer is usable. A defect is not signed off by the person who reported it.)
3. **The title carries the location** (improvement 5). Measured: **6 of 6** live snags carry a `location` (`Floor 7 — DB Room`, `Basement — MCC Panel`, `Levels 3–5 — Steel`, `Floor 4 — DB-04A`, `Floor 2 — Comms`, `Unit 5 — DB-05`) and **0 of 6** carry a `floor_plan_pin`, so the text column is the only locator that exists. The title is all that travels into the 07:00 recap; without it a foreman reads *"DB labelling incomplete — circuits 14–22 unlabelled"* with no floor and no board.
4. `field.snags` has **no `due_date` column** (`00004:10-32`), so the projection always passes NULL and item 2's trigger computes A(b)'s +5 wd on the site calendar. The write-back writes assignment only.

**Files:**
- Modify: the migration — section D
- Test: `scripts/db/probes/06-snag-mirror.sql`

- [ ] **Step 1: Write the probe first.** Create `scripts/db/probes/06-snag-mirror.sql`:
  ```sql
  DO $probe$
  DECLARE
    v_org uuid := 'dddddddd-0000-0000-0000-000000000001';
    v_pm uuid; v_ctr uuid; v_proj uuid; v_snag uuid; v_nowhere uuid;
    v_ins record; v_res record; v_sof record;
    v_assigned_after uuid;
  BEGIN
    SELECT u.user_id INTO v_pm FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active LIMIT 1;
    SELECT u.user_id INTO v_ctr FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.is_active AND u.role <> 'client_viewer'
       AND u.user_id <> v_pm LIMIT 1;

    INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
    VALUES (v_org, '_probe_snag', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj;

    -- Shaped like a live row: a contractor raises it, no assignee, a location.
    INSERT INTO field.snags (project_id, organisation_id, title, location,
                             priority, status, raised_by)
    VALUES (v_proj, v_org, 'DB labelling incomplete', 'Unit 5 — DB-05',
            'high', 'open', v_ctr)
    RETURNING id INTO v_snag;

    SELECT w.title, w.status, w.assignee_id, w.gatekeeper_id, w.ball_in_court_id, w.due_date
      INTO v_ins FROM projects.work_items w WHERE w.snag_id = v_snag;

    SELECT s.assigned_to INTO v_assigned_after FROM field.snags s WHERE s.id = v_snag;

    -- A snag with NO location must not gain a dangling em-dash.
    INSERT INTO field.snags (project_id, organisation_id, title, location,
                             priority, status, raised_by)
    VALUES (v_proj, v_org, 'No location snag', '   ', 'low', 'open', v_ctr)
    RETURNING id INTO v_nowhere;

    UPDATE field.snags SET status = 'resolved' WHERE id = v_snag;
    SELECT w.status, w.ball_in_court_id INTO v_res
      FROM projects.work_items w WHERE w.snag_id = v_snag;

    UPDATE field.snags SET status = 'signed_off', signed_off_by = v_pm, signed_off_at = now()
     WHERE id = v_snag;
    SELECT w.status, w.ball_in_court_id, w.closed_at INTO v_sof
      FROM projects.work_items w WHERE w.snag_id = v_snag;

    CREATE TEMP TABLE sn_ctx(snag uuid, nowhere uuid, proj uuid, pm uuid, ctr uuid,
      ins_title text, ins_status text, ins_assignee uuid, ins_gate uuid, ins_bic uuid, ins_due date,
      assigned_after uuid, res_status text, res_bic uuid,
      sof_status text, sof_bic uuid, sof_closed timestamptz) ON COMMIT DROP;
    INSERT INTO sn_ctx VALUES (v_snag, v_nowhere, v_proj, v_pm, v_ctr,
      v_ins.title, v_ins.status, v_ins.assignee_id, v_ins.gatekeeper_id,
      v_ins.ball_in_court_id, v_ins.due_date, v_assigned_after,
      v_res.status, v_res.ball_in_court_id,
      v_sof.status, v_sof.ball_in_court_id, v_sof.closed_at);
  END $probe$;

  SELECT 'snag_item_created' AS probe,
         (SELECT count(*) FROM projects.work_items w, sn_ctx c
           WHERE w.snag_id = c.snag AND w.origin = 'mirror') = 1 AS ok,
         'one mirror item per snag' AS detail
  UNION ALL
  -- Improvement 5.
  SELECT 'title_carries_the_location',
         (SELECT ins_title = 'DB labelling incomplete — Unit 5 — DB-05' FROM sn_ctx),
         '6 of 6 live snags carry a location and 0 carry a floor_plan_pin; the title is all that reaches the recap'
  UNION ALL
  SELECT 'blank_location_adds_no_dash',
         (SELECT w.title FROM projects.work_items w, sn_ctx c WHERE w.snag_id = c.nowhere)
           = 'No location snag',
         'a whitespace-only location must not produce a trailing em-dash'
  UNION ALL
  SELECT 'snag_writeback',
         (SELECT assigned_after IS NOT NULL FROM sn_ctx),
         'field.snags.assigned_to must be populated by the write-back'
  UNION ALL
  SELECT 'assignee_is_the_raiser',
         (SELECT ins_assignee = ctr FROM sn_ctx),
         '§12 §(d): assigned_to → raised_by → the chain'
  UNION ALL
  SELECT 'gatekeeper_is_pm_not_raiser',
         (SELECT c.ins_gate = projects.resolve_project_pm(c.proj) AND c.ins_gate <> c.ctr FROM sn_ctx c),
         '§03 §1.5: a defect is not signed off by the person who reported it'
  UNION ALL
  SELECT 'due_computed_by_the_spine',
         (SELECT ins_due > CURRENT_DATE FROM sn_ctx),
         'field.snags has no due_date column, so item 2''s trigger computes A(b)''s +5 wd on the site calendar'
  UNION ALL
  SELECT 'resolved_is_answered',
         (SELECT res_status = 'answered' AND res_bic = ins_gate FROM sn_ctx),
         'resolved ⇒ answered ⇒ the PM holds the ball'
  UNION ALL
  SELECT 'signed_off_is_closed',
         (SELECT sof_status = 'closed' AND sof_closed IS NOT NULL FROM sn_ctx),
         'signed_off ⇒ closed, stamped from signed_off_at'
  UNION ALL
  SELECT 'closed_clears_bic',
         (SELECT sof_bic IS NULL FROM sn_ctx),
         'A(a): the generated column is NULL on closed, so the item leaves every inbox';
  ```

- [ ] **Step 2: Run it, watch `snag_item_created` fail with `one mirror item per snag`, 1/10** — only `closed_clears_bic` passes, and it passes **vacuously** because no item exists to hold a ball at all. Step 4 is what makes it mean something.

- [ ] **Step 3: Append the snag projection to section D.**
  ```sql
  CREATE OR REPLACE FUNCTION projects.project_snag(p_snag_id uuid)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'projects', 'public', 'field'
  SET row_security TO 'off'
  AS $fn$
  DECLARE
    s          field.snags%ROWTYPE;
    v_item     projects.work_items%ROWTYPE;
    v_assignee uuid; v_gate uuid; v_mapped text; v_title text; v_moved boolean;
  BEGIN
    SELECT * INTO s FROM field.snags WHERE id = p_snag_id;
    IF NOT FOUND THEN RETURN; END IF;

    SELECT * INTO v_item FROM projects.work_items WHERE snag_id = s.id AND origin = 'mirror';
    v_mapped := projects.map_source_status('snag', s.status);

    -- Improvement 5. 6 of 6 live snags carry a location and 0 carry a
    -- floor_plan_pin, so this text column is the only locator that exists — and
    -- the title is the whole of what travels into the 07:00 recap email.
    v_title := s.title || COALESCE(' — ' || NULLIF(TRIM(s.location), ''), '');

    IF v_item.id IS NULL THEN
      -- §12 §(d): assigned_to → raised_by → the chain. raised_by is NOT NULL
      -- (00004:25), so this almost always resolves at step 1.
      v_assignee := projects.resolve_work_item_assignee(
                      s.project_id, 'snag', COALESCE(s.assigned_to, s.raised_by));
      -- §03 §1.5: the PM, never the raiser. NULL is deliberate, not an oversight;
      -- compare project_rfi, which passes r.raised_by for the opposite reason.
      v_gate     := projects.resolve_work_item_gatekeeper(s.project_id, NULL);

      INSERT INTO projects.work_items (
        organisation_id, project_id, item_type, origin, title, priority,
        status, source_status, assignee_id, gatekeeper_id, due_date, created_by, snag_id)
      VALUES (
        s.organisation_id, s.project_id, 'snag', 'mirror', v_title, s.priority,
        projects.work_item_status_for_mirror(NULL, v_mapped, s.assigned_to IS NOT NULL),
        s.status, v_assignee, v_gate,
        NULL,                  -- no due_date column on field.snags: A(b) +5 wd, site
        s.raised_by, s.id)
      ON CONFLICT (snag_id) WHERE snag_id IS NOT NULL AND origin = 'mirror' DO NOTHING
      RETURNING * INTO v_item;

      IF v_item.id IS NOT NULL THEN
        PERFORM projects.seed_work_item_watchers(v_item.id, s.raised_by, v_assignee, v_gate);
      END IF;
    ELSE
      v_moved := v_item.project_id IS DISTINCT FROM s.project_id;   -- improvement 8
      IF v_moved THEN
        v_assignee := projects.resolve_work_item_assignee(
                        s.project_id, 'snag', COALESCE(s.assigned_to, s.raised_by));
        v_gate     := projects.resolve_work_item_gatekeeper(s.project_id, NULL);
      ELSE
        v_assignee := COALESCE(
          CASE WHEN projects.work_item_person_eligible(s.project_id, s.assigned_to)
               THEN s.assigned_to END, v_item.assignee_id);
        v_gate := v_item.gatekeeper_id;
      END IF;

      UPDATE projects.work_items
         SET project_id = s.project_id, organisation_id = s.organisation_id,
             title = v_title, priority = s.priority, source_status = s.status,
             status = projects.work_item_status_for_mirror(v_item.status, v_mapped, false),
             assignee_id = v_assignee, gatekeeper_id = v_gate,
             closed_at = CASE WHEN s.status IN ('signed_off','closed')
                              THEN COALESCE(v_item.closed_at, s.signed_off_at, now()) END,
             closed_by = CASE WHEN s.status IN ('signed_off','closed')
                              THEN COALESCE(v_item.closed_by, s.signed_off_by) END,
             last_activity_at = now()
       WHERE id = v_item.id;
    END IF;
  END $fn$;

  CREATE OR REPLACE FUNCTION projects.mirror_snag_work_item()
  RETURNS TRIGGER
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'projects', 'public', 'field'
  SET row_security TO 'off'
  AS $fn$
  BEGIN
    IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
    PERFORM projects.project_snag(NEW.id);
    RETURN NULL;
  END $fn$;

  CREATE TRIGGER snags_mirror_work_item_ins
    AFTER INSERT ON field.snags
    FOR EACH ROW EXECUTE FUNCTION projects.mirror_snag_work_item();

  CREATE TRIGGER snags_mirror_work_item_upd
    AFTER UPDATE OF title, location, priority, status, assigned_to,
                    signed_off_by, signed_off_at, project_id, organisation_id
    ON field.snags
    FOR EACH ROW
    WHEN (OLD.title           IS DISTINCT FROM NEW.title
       OR OLD.location        IS DISTINCT FROM NEW.location
       OR OLD.priority        IS DISTINCT FROM NEW.priority
       OR OLD.status          IS DISTINCT FROM NEW.status
       OR OLD.assigned_to     IS DISTINCT FROM NEW.assigned_to
       OR OLD.signed_off_by   IS DISTINCT FROM NEW.signed_off_by
       OR OLD.signed_off_at   IS DISTINCT FROM NEW.signed_off_at
       OR OLD.project_id      IS DISTINCT FROM NEW.project_id
       OR OLD.organisation_id IS DISTINCT FROM NEW.organisation_id)
    EXECUTE FUNCTION projects.mirror_snag_work_item();
  ```

- [ ] **Step 4: Run the probe and watch 10/10 pass.**

- [ ] **Step 5: Mutation-verify the gatekeeper rule.** Change `projects.resolve_work_item_gatekeeper(s.project_id, NULL)` to `(s.project_id, s.raised_by)` in both arms. Re-run. Expected:
  ```
  FAIL  gatekeeper_is_pm_not_raiser  §03 §1.5: a defect is not signed off by the person who reported it
  FAIL  resolved_is_answered         resolved ⇒ answered ⇒ the PM holds the ball
  ```
  Restore. Record 10/10 → 8/10 → 10/10.

- [ ] **Step 6: Mutation-verify improvement 5.** Change `v_title := s.title || COALESCE(…)` to `v_title := s.title;`. Re-run. Expected: `FAIL title_carries_the_location  6 of 6 live snags carry a location and 0 carry a floor_plan_pin; …`. Restore. Then change the `COALESCE(' — ' || NULLIF(TRIM(s.location), ''), '')` to `' — ' || COALESCE(s.location,'')` and re-run: `FAIL blank_location_adds_no_dash`. Restore.

- [ ] **Step 7: Commit.**
  ```bash
  git add apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql \
          scripts/db/probes/06-snag-mirror.sql
  git commit -m "feat(work-items): snag projection — gatekeeper is the PM, title carries the location

6 of 6 live snags carry a location and 0 carry a floor-plan pin, so the text
column is the only locator that exists — and the title is all that travels into
the 07:00 recap."
  ```

---

## Task 8 — The inspection projection, the profiles edge case, and forward assignment

**Including inspections is not optional.** All **18** rows sit at `status = 'assigned'` with zero responses and zero certificates (verified), which is exactly the pathology the ball-in-court spine exists to fix.

**There is no FK to reconcile.** `public.profiles.id` is itself `REFERENCES auth.users(id)` (`00001_initial_schema.sql:62`) and `handle_new_user` inserts a profiles row on every `auth.users` insert (`00001:77-92`), so `inspections.inspections.assigned_to_id` / `verifier_id` / `created_by` (`00066:54,55,73`) already hold the UUIDs a `work_items.assignee_id REFERENCES public.profiles(id)` needs. Verified: **0** auth users have no profiles row, and **0** of the 18 inspections reference a missing profile. The edge case is handled anyway — by `work_item_person_eligible` on the way in — because a zero count today measures the estate's *age*, not its risk. **The backfill does not add a second, contradictory guard** (see Task 14 Step 3, item 3).

**No write-back, but assignment is read forward.** §03 §1.2 keeps `00066`'s own assignment flow as the system of record for `assigned_to_id` — that is an argument for not writing *back*, not for not reading *forward*. The `_upd` trigger fires on `assigned_to_id`, so re-assigning an inspection in the inspections module must move `work_items.assignee_id`, `ball_in_court_id`, the Inbox and My Work with it. Without that line the spine points at the previous person forever.

**Due date.** §12 §(d) line 136 says `scheduled_at::date` if set. **15 of 18** live inspections carry a `scheduled_at` in the past, so passing it straight through would make every one of them born overdue — the thing improvement 6 exists to stop. It goes through `work_item_mirror_due_date`, which returns NULL for a past date so item 2's trigger computes A(b)'s +3 wd on the site calendar. (A(b) says nothing about `scheduled_at`; that rule is §12 §(d)'s.)

**Files:**
- Modify: the migration — section D
- Test: `scripts/db/probes/07-inspection-mirror.sql`

- [ ] **Step 1: Write the probe first.** Create `scripts/db/probes/07-inspection-mirror.sql`:
  ```sql
  DO $probe$
  DECLARE
    v_org uuid := 'dddddddd-0000-0000-0000-000000000001';
    v_pm uuid; v_v uuid; v_third uuid; v_proj uuid; v_tpl uuid; v_insp uuid; v_past uuid;
    v_ins record; v_re record; v_aw record;
  BEGIN
    SELECT u.user_id INTO v_pm FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active LIMIT 1;
    SELECT u.user_id INTO v_v FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.is_active AND u.role <> 'client_viewer'
       AND u.user_id <> v_pm LIMIT 1;
    SELECT u.user_id INTO v_third FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.is_active AND u.role <> 'client_viewer'
       AND u.user_id NOT IN (v_pm, v_v) LIMIT 1;
    SELECT id INTO v_tpl FROM inspections.templates LIMIT 1;

    INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
    VALUES (v_org, '_probe_insp', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj;

    INSERT INTO inspections.inspections (organisation_id, project_id, template_id,
      target_node_type, target_label, target_location, assigned_to_id, verifier_id,
      status, created_by)
    VALUES (v_org, v_proj, v_tpl, 'adhoc', 'Probe board', 'Level 2 — Riser',
            v_pm, v_v, 'assigned', v_pm)
    RETURNING id INTO v_insp;

    SELECT w.title, w.status, w.assignee_id, w.gatekeeper_id, w.ball_in_court_id, w.due_date
      INTO v_ins FROM projects.work_items w WHERE w.inspection_id = v_insp;

    -- 15 of 18 live inspections are scheduled in the past.
    INSERT INTO inspections.inspections (organisation_id, project_id, template_id,
      target_node_type, target_label, assigned_to_id, verifier_id, status,
      scheduled_at, created_by)
    VALUES (v_org, v_proj, v_tpl, 'adhoc', 'Past board', v_pm, v_v, 'assigned',
            now() - interval '30 days', v_pm)
    RETURNING id INTO v_past;

    -- Reassignment inside the inspections module must reach the spine.
    UPDATE inspections.inspections SET assigned_to_id = v_third WHERE id = v_insp;
    SELECT w.assignee_id, w.ball_in_court_id INTO v_re
      FROM projects.work_items w WHERE w.inspection_id = v_insp;

    UPDATE inspections.inspections SET status = 'awaiting_verification' WHERE id = v_insp;
    SELECT w.status, w.ball_in_court_id INTO v_aw
      FROM projects.work_items w WHERE w.inspection_id = v_insp;

    CREATE TEMP TABLE in_ctx(insp uuid, past uuid, proj uuid, pm uuid, verifier uuid, third uuid,
      ins_title text, ins_status text, ins_assignee uuid, ins_gate uuid, ins_bic uuid, ins_due date,
      re_assignee uuid, re_bic uuid, aw_status text, aw_bic uuid) ON COMMIT DROP;
    INSERT INTO in_ctx VALUES (v_insp, v_past, v_proj, v_pm, v_v, v_third,
      v_ins.title, v_ins.status, v_ins.assignee_id, v_ins.gatekeeper_id,
      v_ins.ball_in_court_id, v_ins.due_date,
      v_re.assignee_id, v_re.ball_in_court_id, v_aw.status, v_aw.ball_in_court_id);
  END $probe$;

  SELECT 'insp_item_created' AS probe,
         (SELECT count(*) FROM projects.work_items w, in_ctx c
           WHERE w.inspection_id = c.insp AND w.origin = 'mirror') = 1 AS ok,
         'one mirror item per inspection' AS detail
  UNION ALL
  SELECT 'assignee_seeds_from_source',
         (SELECT ins_assignee = pm FROM in_ctx),
         'A(b): existing assigned_to_id, else the chain'
  UNION ALL
  SELECT 'gatekeeper_is_verifier',
         (SELECT ins_gate = verifier FROM in_ctx),
         'A(b): verifier_id, else the PM'
  UNION ALL
  SELECT 'born_open_not_triage',
         (SELECT ins_status = 'open' FROM in_ctx),
         'an inspection arrives already assigned, so it is open, not triage'
  UNION ALL
  SELECT 'title_names_the_place',
         (SELECT ins_title = 'Probe board — Level 2 — Riser' FROM in_ctx),
         'target_location is the only locator an inspection has; the title is what reaches the recap'
  UNION ALL
  -- Improvement 6, on the source §12 §(d) explicitly told us to pass through.
  SELECT 'past_schedule_not_born_overdue',
         (SELECT w.due_date > CURRENT_DATE FROM projects.work_items w, in_ctx c
           WHERE w.inspection_id = c.past),
         '15 of 18 live inspections are scheduled in the past; §12 §(d) says scheduled_at::date and that would be overdue on day one'
  UNION ALL
  -- The forward-assignment rule.
  SELECT 'reassignment_reaches_the_spine',
         (SELECT re_assignee = third AND re_bic = third FROM in_ctx),
         '00066 owns the column, but the spine must follow it or the Inbox names the previous person forever'
  UNION ALL
  SELECT 'no_writeback_to_source',
         (SELECT i.assigned_to_id = c.third FROM inspections.inspections i, in_ctx c
           WHERE i.id = c.insp),
         'the source is unchanged by the spine: 00066''s flow stays the system of record (§03 §1.2)'
  UNION ALL
  SELECT 'awaiting_verification_is_answered',
         (SELECT aw_status = 'answered' AND aw_bic = verifier FROM in_ctx),
         'awaiting_verification ⇒ answered ⇒ the ball moves to the verifier';
  ```

- [ ] **Step 2: Run it, watch `insp_item_created` fail, 1/9** — `no_writeback_to_source` passes, but only because the probe's own `UPDATE` set that column; it becomes meaningful once an item exists to *not* write it back.

- [ ] **Step 3: Append the inspection projection.**
  ```sql
  CREATE OR REPLACE FUNCTION projects.project_inspection(p_inspection_id uuid)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'projects', 'public', 'inspections'
  SET row_security TO 'off'
  AS $fn$
  DECLARE
    i          inspections.inspections%ROWTYPE;
    v_item     projects.work_items%ROWTYPE;
    v_assignee uuid; v_gate uuid; v_mapped text; v_creator uuid;
    v_title text; v_moved boolean;
  BEGIN
    SELECT * INTO i FROM inspections.inspections WHERE id = p_inspection_id;
    IF NOT FOUND THEN RETURN; END IF;

    SELECT * INTO v_item FROM projects.work_items
     WHERE inspection_id = i.id AND origin = 'mirror';
    v_mapped := projects.map_source_status('inspection', i.status);

    -- target_location (00066:47) is the only locator an inspection carries.
    v_title := i.target_label || COALESCE(' — ' || NULLIF(TRIM(i.target_location), ''), '');

    -- The ids are the same UUID (00001:62, 00001:77-92); work_item_person_eligible
    -- covers the one edge case, an auth user with no profiles row. Zero such users
    -- exist today — which measures the estate's age, not its risk.
    v_moved := v_item.id IS NOT NULL AND v_item.project_id IS DISTINCT FROM i.project_id;

    v_assignee := projects.resolve_work_item_assignee(
                    i.project_id, 'inspection',
                    CASE WHEN projects.work_item_person_eligible(i.project_id, i.assigned_to_id)
                         THEN i.assigned_to_id END);
    v_gate     := projects.resolve_work_item_gatekeeper(i.project_id, i.verifier_id);
    v_creator  := CASE WHEN EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = i.created_by)
                       THEN i.created_by ELSE v_assignee END;

    IF v_item.id IS NULL THEN
      INSERT INTO projects.work_items (
        organisation_id, project_id, item_type, origin, title, priority,
        status, source_status, assignee_id, gatekeeper_id, due_date, created_by, inspection_id)
      VALUES (
        i.organisation_id, i.project_id, 'inspection', 'mirror', v_title, 'medium',
        projects.work_item_status_for_mirror(NULL, v_mapped, i.assigned_to_id IS NOT NULL),
        i.status, v_assignee, v_gate,
        -- §12 §(d) line 136 says scheduled_at::date. 15 of 18 live inspections are
        -- scheduled in the PAST, so passing it through births them overdue.
        -- work_item_mirror_due_date returns NULL for those and item 2's trigger
        -- computes A(b)'s +3 wd on the site calendar instead (improvement 6).
        projects.work_item_mirror_due_date(i.scheduled_at::date),
        v_creator, i.id)
      ON CONFLICT (inspection_id) WHERE inspection_id IS NOT NULL AND origin = 'mirror' DO NOTHING
      RETURNING * INTO v_item;

      IF v_item.id IS NOT NULL THEN
        PERFORM projects.seed_work_item_watchers(v_item.id, v_creator, v_assignee, v_gate);
      END IF;
    ELSE
      UPDATE projects.work_items
         SET project_id = i.project_id, organisation_id = i.organisation_id,
             title = v_title, source_status = i.status,
             status = projects.work_item_status_for_mirror(v_item.status, v_mapped, false),
             -- 00066's flow owns inspections.assigned_to_id and this migration never
             -- writes it back — but the spine must FOLLOW it, or reassigning an
             -- inspection leaves work_items.assignee_id (and therefore
             -- ball_in_court_id, the Inbox and My Work) on the previous person forever.
             assignee_id   = COALESCE(
               CASE WHEN projects.work_item_person_eligible(i.project_id, i.assigned_to_id)
                    THEN i.assigned_to_id END,
               CASE WHEN v_moved THEN v_assignee ELSE v_item.assignee_id END),
             gatekeeper_id = v_gate,
             closed_at = CASE WHEN i.status = 'certified'
                              THEN COALESCE(v_item.closed_at, i.certified_at, now()) END,
             void_reason = CASE WHEN i.status = 'abandoned'
                                THEN COALESCE(i.abandon_reason, 'inspection abandoned') END,
             last_activity_at = now()
       WHERE id = v_item.id;
    END IF;
  END $fn$;

  CREATE OR REPLACE FUNCTION projects.mirror_inspection_work_item()
  RETURNS TRIGGER
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'projects', 'public', 'inspections'
  SET row_security TO 'off'
  AS $fn$
  BEGIN
    IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
    PERFORM projects.project_inspection(NEW.id);
    RETURN NULL;
  END $fn$;

  CREATE TRIGGER inspections_mirror_work_item_ins
    AFTER INSERT ON inspections.inspections
    FOR EACH ROW EXECUTE FUNCTION projects.mirror_inspection_work_item();

  CREATE TRIGGER inspections_mirror_work_item_upd
    AFTER UPDATE OF target_label, target_location, status, assigned_to_id, verifier_id,
                    scheduled_at, certified_at, abandon_reason, project_id, organisation_id
    ON inspections.inspections
    FOR EACH ROW
    WHEN (OLD.target_label    IS DISTINCT FROM NEW.target_label
       OR OLD.target_location IS DISTINCT FROM NEW.target_location
       OR OLD.status          IS DISTINCT FROM NEW.status
       OR OLD.assigned_to_id  IS DISTINCT FROM NEW.assigned_to_id
       OR OLD.verifier_id     IS DISTINCT FROM NEW.verifier_id
       OR OLD.scheduled_at    IS DISTINCT FROM NEW.scheduled_at
       OR OLD.certified_at    IS DISTINCT FROM NEW.certified_at
       OR OLD.abandon_reason  IS DISTINCT FROM NEW.abandon_reason
       OR OLD.project_id      IS DISTINCT FROM NEW.project_id
       OR OLD.organisation_id IS DISTINCT FROM NEW.organisation_id)
    EXECUTE FUNCTION projects.mirror_inspection_work_item();
  ```

- [ ] **Step 4: Run the probe and watch 9/9 pass.**

- [ ] **Step 5: Mutation-verify the forward-assignment line.** Delete the `assignee_id = COALESCE(…)` clause from the `ELSE` arm. Re-run. Expected:
  ```
  FAIL  reassignment_reaches_the_spine  00066 owns the column, but the spine must follow it or the Inbox names the previous person forever
  ```
  Restore. Record 9/9 → 8/9 → 9/9.

- [ ] **Step 6: Mutation-verify the past-schedule rule.** Change `projects.work_item_mirror_due_date(i.scheduled_at::date)` to `i.scheduled_at::date`. Re-run. Expected: `FAIL past_schedule_not_born_overdue  15 of 18 live inspections are scheduled in the past; …`. Restore.

- [ ] **Step 7: Prove the profiles edge case is handled.** Temporarily add to the `DO` block, immediately before the temp table insert:
  ```sql
    DELETE FROM public.profiles WHERE id = v_third;   -- an auth user with no profiles row
    UPDATE inspections.inspections SET target_label = 'Probe board 2' WHERE id = v_insp;
  ```
  Expected: the probe still runs (`9/9` or a title mismatch on `title_names_the_place`, which is fine — nothing raises). Then change `v_creator := CASE WHEN EXISTS (…) THEN i.created_by ELSE v_assignee END;` to `v_creator := i.created_by;` and, in the `_ins` path, delete the `work_item_person_eligible` wrapper around `i.assigned_to_id`. Re-run. Expected:
  ```
  FAIL (HTTP 400)
  … ERROR: 23503: insert or update on table "work_items" violates foreign key constraint
  ```
  Restore both and remove the temporary lines.

- [ ] **Step 8: Commit.**
  ```bash
  git add apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql \
          scripts/db/probes/07-inspection-mirror.sql
  git commit -m "feat(work-items): inspection projection — reads assignment forward, never writes it back

00066's flow stays the system of record for assigned_to_id, but the spine must
follow it or the Inbox names the previous person forever. 15 of 18 live
inspections are scheduled in the past, so scheduled_at goes through the
non-overdue filter rather than straight into due_date."
  ```

---

## Task 9 — The `qc_defect` projection needs two entry points (F4, improvement 5)

**Scope predicate (§12 §(d)):** an entry is mirrored only where `conformance = 'fail'` **and** its parent report's `status IN ('issued','closed')`. A QC report is a checklist; mirroring every issued entry would manufacture ~40 inbox items from one 40-line report — the poisoning A(b) refuses and the reason `qc_report` is not a registered type.

**Why two entry points.** That predicate spans two tables and an entry does not cross it on its own. In practice a report is authored as a `draft` — the `fail` verdict is written then — and enters scope when someone **issues the report**, which is an `UPDATE` on `projects.qc_reports`, not on `projects.qc_entries`. A trigger on the entry alone would never fire on the normal path. The entry-level trigger is still needed for the second path: an entry edited to `fail` while its report is already `issued`.

**Both paths are live.** `projects.qc_entries` carries `qc_entries_frozen_guard → projects.qc_report_children_frozen` (verified in `pg_trigger`), whose body raises only when the parent report's `status = 'closed'` and which returns early when `auth.uid() IS NULL`. So entries on an `issued` report remain editable, and the backfill is not blocked by it either — though the backfill calls `project_qc_entry()` directly and never UPDATEs an entry, so it never enters that guard at all.

**Severity maps onto priority** (§03 §1.10): `minor→low`, `major→high`, `critical→critical`, never a flat `medium`. A NULL severity is `medium`, because `00176:63-68` deliberately leaves the "severity present iff `conformance='fail'`" relationship to the app layer.

**The title carries the report** (improvement 5). `projects.qc_entries` has **no location column** and its titles are checklist lines (`"Failed check"`, `"Earth continuity"`), so a defect item is unreadable in an inbox without knowing which report it came from. `projects.qc_reports.title` is `NOT NULL` (`00172:62`).

**Files:**
- Modify: the migration — section D
- Test: `scripts/db/probes/08-qc-mirror.sql`

- [ ] **Step 1: Write the probe first, and make the report-issue path its centrepiece.** Create `scripts/db/probes/08-qc-mirror.sql`:
  ```sql
  DO $probe$
  DECLARE
    v_org uuid := 'dddddddd-0000-0000-0000-000000000001';
    v_pm uuid; v_proj uuid; v_rep uuid; v_fail uuid; v_na uuid;
    v_draft_items int; v_issued_fail int; v_issued_na int;
    v_prio text; v_src text; v_title text; v_after_pass text;
  BEGIN
    SELECT u.user_id INTO v_pm FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active LIMIT 1;
    INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
    VALUES (v_org, '_probe_qc', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj;

    INSERT INTO projects.qc_reports (project_id, organisation_id, title, status, raised_by)
    VALUES (v_proj, v_org, 'Level 3 handover QC', 'draft', v_pm) RETURNING id INTO v_rep;

    INSERT INTO projects.qc_entries (report_id, organisation_id, project_id, title,
                                     conformance, severity, created_by)
    VALUES (v_rep, v_org, v_proj, 'Earth continuity', 'fail', 'major', v_pm)
    RETURNING id INTO v_fail;
    INSERT INTO projects.qc_entries (report_id, organisation_id, project_id, title,
                                     conformance, created_by)
    VALUES (v_rep, v_org, v_proj, 'Untested check', 'na', v_pm) RETURNING id INTO v_na;

    SELECT count(*) INTO v_draft_items FROM projects.work_items
     WHERE qc_entry_id IN (v_fail, v_na);

    -- The path a trigger on qc_entries alone can never see (F4).
    UPDATE projects.qc_reports SET status = 'issued', issued_at = now() WHERE id = v_rep;

    SELECT count(*) INTO v_issued_fail FROM projects.work_items WHERE qc_entry_id = v_fail;
    SELECT count(*) INTO v_issued_na   FROM projects.work_items WHERE qc_entry_id = v_na;
    SELECT w.priority, w.source_status, w.title INTO v_prio, v_src, v_title
      FROM projects.work_items w WHERE w.qc_entry_id = v_fail;

    -- The second path: an entry corrected while the report is already issued.
    UPDATE projects.qc_entries SET conformance = 'pass', severity = NULL WHERE id = v_fail;
    SELECT w.status INTO v_after_pass FROM projects.work_items w WHERE w.qc_entry_id = v_fail;

    CREATE TEMP TABLE qc_ctx(rep uuid, fail uuid, na uuid,
      draft_items int, issued_fail int, issued_na int,
      prio text, src text, title text, after_pass text) ON COMMIT DROP;
    INSERT INTO qc_ctx VALUES (v_rep, v_fail, v_na, v_draft_items, v_issued_fail,
      v_issued_na, v_prio, v_src, v_title, v_after_pass);
  END $probe$;

  SELECT 'draft_report_projects_nothing' AS probe,
         (SELECT draft_items = 0 FROM qc_ctx) AS ok,
         'a fail on a DRAFT report is not yet an obligation' AS detail
  UNION ALL
  SELECT 'issue_report_projects_the_fail',
         (SELECT issued_fail = 1 FROM qc_ctx),
         'F4: issuing the REPORT is the normal path; an entry-only trigger never fires here'
  UNION ALL
  SELECT 'issue_report_ignores_the_rest',
         (SELECT issued_na = 0 FROM qc_ctx),
         'A(b): mirroring every issued entry manufactures ~40 items from one 40-line report'
  UNION ALL
  SELECT 'severity_maps_to_priority',
         (SELECT prio = 'high' FROM qc_ctx),
         '§03 §1.10: major → high, never a flat medium'
  UNION ALL
  SELECT 'source_status_is_conformance',
         (SELECT src = 'fail' FROM qc_ctx),
         'source_status mirrors conformance'
  UNION ALL
  -- Improvement 5.
  SELECT 'title_carries_the_report',
         (SELECT title = 'Level 3 handover QC — Earth continuity' FROM qc_ctx),
         'qc_entries has no location column and its titles are checklist lines'
  UNION ALL
  SELECT 'entry_pass_closes_item',
         (SELECT after_pass = 'closed' FROM qc_ctx),
         'fail → pass on an issued report closes the defect';
  ```

- [ ] **Step 2: Run it. Expected 1/7:** `draft_report_projects_nothing` PASSes **vacuously** (nothing exists yet) and the other six FAIL. Note that vacuous pass explicitly — it is the fixture-quality question in miniature, and Step 6 is what makes it non-vacuous.

- [ ] **Step 3: Append the qc projection — one body, two entry points.**
  ```sql
  -- One projection body, two trigger entry points, because the scope predicate
  -- spans two tables (F4). The normal path is the REPORT being issued; the
  -- entry-level trigger covers an entry edited to 'fail' while its report is
  -- already issued.
  CREATE OR REPLACE FUNCTION projects.project_qc_entry(p_entry_id uuid)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'projects', 'public'
  SET row_security TO 'off'
  AS $fn$
  DECLARE
    e          projects.qc_entries%ROWTYPE;
    rep        projects.qc_reports%ROWTYPE;
    v_item     projects.work_items%ROWTYPE;
    v_assignee uuid; v_gate uuid; v_mapped text; v_priority text; v_title text;
  BEGIN
    SELECT * INTO e FROM projects.qc_entries WHERE id = p_entry_id;
    IF NOT FOUND THEN RETURN; END IF;

    SELECT * INTO rep FROM projects.qc_reports WHERE id = e.report_id;
    IF NOT FOUND THEN RETURN; END IF;

    SELECT * INTO v_item FROM projects.work_items
     WHERE qc_entry_id = e.id AND origin = 'mirror';

    -- Out of scope and never projected: do nothing. Out of scope but already
    -- projected cannot happen — a report never returns to draft (00172's status
    -- guard) — so there is no un-project path and none is invented.
    IF rep.status NOT IN ('issued','closed') AND v_item.id IS NULL THEN RETURN; END IF;

    v_mapped   := projects.map_source_status('qc_defect', e.conformance);
    v_priority := CASE e.severity WHEN 'minor' THEN 'low' WHEN 'major' THEN 'high'
                                  WHEN 'critical' THEN 'critical' ELSE 'medium' END;
    -- Improvement 5: qc_entries has no location column and its titles are
    -- checklist lines, so the parent report is the only thing that makes a defect
    -- readable in an inbox. qc_reports.title is NOT NULL (00172:62).
    v_title    := rep.title || ' — ' || e.title;

    IF v_item.id IS NULL THEN
      IF e.conformance <> 'fail' THEN RETURN; END IF;   -- only failures become obligations
      v_assignee := projects.resolve_work_item_assignee(e.project_id, 'qc_defect', e.created_by);
      v_gate     := projects.resolve_work_item_gatekeeper(e.project_id, NULL);   -- A(b): the PM

      INSERT INTO projects.work_items (
        organisation_id, project_id, item_type, origin, title, priority,
        status, source_status, assignee_id, gatekeeper_id, due_date, created_by, qc_entry_id)
      VALUES (
        e.organisation_id, e.project_id, 'qc_defect', 'mirror', v_title, v_priority,
        projects.work_item_status_for_mirror(NULL, v_mapped, false),
        e.conformance, v_assignee, v_gate,
        NULL,                  -- no due date on the source: A(b) +5 wd, site
        e.created_by, e.id)
      ON CONFLICT (qc_entry_id) WHERE qc_entry_id IS NOT NULL AND origin = 'mirror' DO NOTHING
      RETURNING * INTO v_item;

      IF v_item.id IS NOT NULL THEN
        PERFORM projects.seed_work_item_watchers(v_item.id, e.created_by, v_assignee, v_gate);
      END IF;
    ELSE
      UPDATE projects.work_items
         SET project_id = e.project_id, organisation_id = e.organisation_id,   -- improvement 8
             title = v_title, priority = v_priority, source_status = e.conformance,
             status = projects.work_item_status_for_mirror(v_item.status, v_mapped, false),
             closed_at = CASE WHEN v_mapped = 'closed' THEN COALESCE(v_item.closed_at, now()) END,
             last_activity_at = now()
       WHERE id = v_item.id;
    END IF;
  END $fn$;

  -- Entry point 1: the entry itself changed.
  CREATE OR REPLACE FUNCTION projects.mirror_qc_defect_work_item()
  RETURNS TRIGGER
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'projects', 'public'
  SET row_security TO 'off'
  AS $fn$
  BEGIN
    IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
    PERFORM projects.project_qc_entry(NEW.id);
    RETURN NULL;
  END $fn$;

  -- Entry point 2: the REPORT was issued, which brings every failed entry into
  -- scope in one statement. Without this the qc_defect projection would never
  -- fire on the normal authoring path, because the entry itself does not change.
  CREATE OR REPLACE FUNCTION projects.mirror_qc_report_defects()
  RETURNS TRIGGER
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'projects', 'public'
  SET row_security TO 'off'
  AS $fn$
  DECLARE v_id uuid;
  BEGIN
    IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
    IF NEW.status NOT IN ('issued','closed') THEN RETURN NULL; END IF;

    FOR v_id IN SELECT e.id FROM projects.qc_entries e
                 WHERE e.report_id = NEW.id AND e.conformance = 'fail'
    LOOP
      PERFORM projects.project_qc_entry(v_id);
    END LOOP;
    RETURN NULL;
  END $fn$;

  CREATE TRIGGER qc_entries_mirror_work_item_ins
    AFTER INSERT ON projects.qc_entries
    FOR EACH ROW EXECUTE FUNCTION projects.mirror_qc_defect_work_item();

  CREATE TRIGGER qc_entries_mirror_work_item_upd
    AFTER UPDATE OF title, conformance, severity, project_id, organisation_id
    ON projects.qc_entries
    FOR EACH ROW
    WHEN (OLD.title           IS DISTINCT FROM NEW.title
       OR OLD.conformance     IS DISTINCT FROM NEW.conformance
       OR OLD.severity        IS DISTINCT FROM NEW.severity
       OR OLD.project_id      IS DISTINCT FROM NEW.project_id
       OR OLD.organisation_id IS DISTINCT FROM NEW.organisation_id)
    EXECUTE FUNCTION projects.mirror_qc_defect_work_item();

  -- ⚠ §12 §(c) hard dependency 5 says the projection triggers cover the six
  -- automatic A(b) sources "and only those". This is a SEVENTH table, and it is
  -- required: the qc_defect scope predicate spans two tables and an entry does not
  -- cross it on its own (F4). §12 §(c) is amended in this PR to say so.
  CREATE TRIGGER qc_reports_mirror_defects
    AFTER UPDATE OF status ON projects.qc_reports
    FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION projects.mirror_qc_report_defects();
  ```

- [ ] **Step 4: Run the probe and watch 7/7 pass.**

- [ ] **Step 5: Mutation-verify F4 — drop the report trigger and watch the normal path go dark.** Comment out `CREATE TRIGGER qc_reports_mirror_defects`, re-run. Expected:
  ```
  FAIL  issue_report_projects_the_fail    F4: issuing the REPORT is the normal path; an entry-only trigger never fires here
  FAIL  severity_maps_to_priority         §03 §1.10: major → high, never a flat medium
  FAIL  source_status_is_conformance      source_status mirrors conformance
  FAIL  title_carries_the_report          qc_entries has no location column and its titles are checklist lines
  FAIL  entry_pass_closes_item            fail → pass on an issued report closes the defect
  ```
  This is the whole finding: with only an entry-level trigger, a QC report can be issued with failed entries and **nothing reaches anybody's inbox**. Restore. Record 7/7 → 2/7 → 7/7.

- [ ] **Step 6: Make `draft_report_projects_nothing` non-vacuous.** Change the scope test to `IF false AND v_item.id IS NULL THEN RETURN; END IF;` — i.e. project regardless of report status — and re-run. Expected:
  ```
  FAIL  draft_report_projects_nothing  a fail on a DRAFT report is not yet an obligation
  ```
  Restore.

- [ ] **Step 7: Mutation-verify improvement 5.** Change `v_title := rep.title || ' — ' || e.title;` to `v_title := e.title;`. Re-run. Expected: `FAIL title_carries_the_report`. Restore.

- [ ] **Step 8: Commit.**
  ```bash
  git add apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql \
          scripts/db/probes/08-qc-mirror.sql
  git commit -m "feat(work-items): qc_defect projection on both the report-issue and entry-edit paths

An entry enters scope when its REPORT is issued, which is an UPDATE on
qc_reports; an entry-only trigger never fires on the normal authoring path.
The title carries the report title because qc_entries has no location column
and its own titles are checklist lines."
  ```

---

## Task 10 — The `diary_action` projection (improvement 1)

`projects.site_diary_entries` has **no status column, no owner column and no due date** (`00002:146-158`, `00017:14-18`) — the emptiest row in §03 §1.1's table. `diary_action` carries the shortest offset on the board — **+2 working days, site calendar** (A(b)) — because a delay recorded today is stale by Friday (§03 §1.5).

⚠ **The scope predicate is `projects.diary_delay_text()`, not "the text box is non-empty".** Measured on production 2026-09-10, **6 of 6** entries a non-empty test would project are negations:

| entry_date | text |
|---|---|
| 2026-06-02 | `No delays or info required was noted in the site walk and or meeting` |
| 2026-06-24 | `None,` |
| 2026-06-24 | `None,` |
| 2026-06-25 | `None` |
| 2026-07-21 | `None` |
| 2026-07-22 | `NO` |

**Zero of the six is a delay.** A non-empty test measures whether the box was filled in — the same class of error as counting `field.form_responses` newlines and reading the `client_viewer` zero as rarity. Shipped without the stop-list, day one puts six items titled `Delay 2026-06-24: None,` with a +2 working-day due date in the owner's own inbox. Contractors will keep typing "None" daily, so **the stop-list lives on the live trigger**, not only in the backfill. The diary arm of the backfill is dropped entirely (Task 14).

**Files:**
- Modify: the migration — section D
- Test: `scripts/db/probes/09-diary-mirror.sql`

- [ ] **Step 1: Write the probe first, with the live strings as fixtures.** Create `scripts/db/probes/09-diary-mirror.sql`:
  ```sql
  DO $probe$
  DECLARE
    v_org uuid := 'dddddddd-0000-0000-0000-000000000001';
    v_pm uuid; v_proj uuid; v_plain uuid; v_delay uuid; v_none uuid; v_sentence uuid;
    v_title text; v_src text; v_upgraded int;
  BEGIN
    SELECT u.user_id INTO v_pm FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active LIMIT 1;
    INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
    VALUES (v_org, '_probe_diary', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj;

    -- (a) no delay text at all — 47 of 53 live entries
    INSERT INTO projects.site_diary_entries (project_id, organisation_id, entry_date,
                                             progress_notes, created_by)
    VALUES (v_proj, v_org, CURRENT_DATE, 'Slab poured, no issues', v_pm) RETURNING id INTO v_plain;

    -- (b) the exact live values — 6 of 6 of them
    INSERT INTO projects.site_diary_entries (project_id, organisation_id, entry_date,
                                             progress_notes, delays, created_by)
    VALUES (v_proj, v_org, CURRENT_DATE, 'Rain', 'None,', v_pm) RETURNING id INTO v_none;
    INSERT INTO projects.site_diary_entries (project_id, organisation_id, entry_date,
                                             progress_notes, delays, created_by)
    VALUES (v_proj, v_org, CURRENT_DATE, 'Walk',
            'No delays or info required was noted in the site walk and or meeting', v_pm)
    RETURNING id INTO v_sentence;

    -- (c) an actual delay
    INSERT INTO projects.site_diary_entries (project_id, organisation_id, entry_date,
                                             progress_notes, delays, created_by)
    VALUES (v_proj, v_org, DATE '2026-06-24', 'Rain',
            'Crane stood down 4h awaiting sparks', v_pm)
    RETURNING id INTO v_delay;

    SELECT w.title, w.source_status INTO v_title, v_src
      FROM projects.work_items w WHERE w.diary_id = v_delay;

    -- (d) the upgrade path: a plain entry later edited to record a real delay
    UPDATE projects.site_diary_entries SET delay_notes = 'Late delivery of DB-04A'
     WHERE id = v_plain;
    SELECT count(*) INTO v_upgraded FROM projects.work_items WHERE diary_id = v_plain;

    CREATE TEMP TABLE d_ctx(plain uuid, delay uuid, none uuid, sentence uuid,
      title text, src text, upgraded int) ON COMMIT DROP;
    INSERT INTO d_ctx VALUES (v_plain, v_delay, v_none, v_sentence, v_title, v_src, v_upgraded);
  END $probe$;

  SELECT 'empty_entry_not_mirrored' AS probe,
         (SELECT count(*) FROM projects.work_items w, d_ctx c WHERE w.diary_id = c.none) = 0 AS ok,
         'the string is literally "None," — 2 of the 6 live rows say exactly this' AS detail
  UNION ALL
  SELECT 'sentence_negation_not_mirrored',
         (SELECT count(*) FROM projects.work_items w, d_ctx c WHERE w.diary_id = c.sentence) = 0,
         'the 2026-06-02 entry is a sentence, so a token stop-list alone is not enough'
  UNION ALL
  SELECT 'no_delay_text_not_mirrored', true,
         'TAUTOLOGY — delete this row in Step 4; edit_into_scope_mirrors covers the property'
  UNION ALL
  SELECT 'real_delay_mirrored',
         (SELECT count(*) FROM projects.work_items w, d_ctx c WHERE w.diary_id = c.delay) = 1,
         'a genuine delay must still project, or the stop-list has eaten the feature'
  UNION ALL
  SELECT 'title_carries_the_delay',
         (SELECT title = 'Delay 2026-06-24: Crane stood down 4h awaiting sparks' FROM d_ctx),
         'the item must be readable in an inbox without opening the diary'
  UNION ALL
  SELECT 'source_status_is_null',
         (SELECT src IS NULL FROM d_ctx),
         'the source has no status column, so there is nothing to mirror'
  UNION ALL
  SELECT 'edit_into_scope_mirrors',
         (SELECT upgraded = 1 FROM d_ctx),
         'adding real delay_notes to an existing entry brings it into scope';
  ```
  ⚠ Delete the `no_delay_text_not_mirrored` row before committing — it is a tautology written here only to make the numbering obvious while drafting, and a tautological assertion is exactly what §12 §(h)'s fixture rule forbids. The property it names is covered by `edit_into_scope_mirrors`, which projects the same row **only after** real text is added.

- [ ] **Step 2: Run it. Expected 4/7** — `empty_entry_not_mirrored`, `sentence_negation_not_mirrored`, the tautological `no_delay_text_not_mirrored` and `source_status_is_null` all pass **vacuously** because nothing exists yet. Read that as the fixture-quality warning it is; Step 4 deletes the tautology and Step 5 makes the other three real.

- [ ] **Step 3: Append the diary projection.**
  ```sql
  CREATE OR REPLACE FUNCTION projects.project_diary_action(p_entry_id uuid)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'projects', 'public'
  SET row_security TO 'off'
  AS $fn$
  DECLARE
    d          projects.site_diary_entries%ROWTYPE;
    v_item     projects.work_items%ROWTYPE;
    v_assignee uuid; v_gate uuid; v_delay text; v_title text; v_moved boolean;
  BEGIN
    SELECT * INTO d FROM projects.site_diary_entries WHERE id = p_entry_id;
    IF NOT FOUND THEN RETURN; END IF;

    -- Improvement 1. NOT "the text box is non-empty": all 6 of 6 live values a
    -- non-empty test would project are the word None. See projects.diary_delay_text.
    v_delay := projects.diary_delay_text(d.delays, d.delay_notes);

    SELECT * INTO v_item FROM projects.work_items WHERE diary_id = d.id AND origin = 'mirror';

    -- No delay: nothing to do. An entry edited to REMOVE its delay keeps its item —
    -- the delay was recorded and acted on, and silently deleting an inbox item
    -- because prose changed is worse than one stale row.
    IF v_delay IS NULL THEN RETURN; END IF;

    v_title := 'Delay ' || to_char(d.entry_date, 'YYYY-MM-DD') || ': ' || left(v_delay, 120);

    IF v_item.id IS NULL THEN
      v_assignee := projects.resolve_work_item_assignee(d.project_id, 'diary_action', d.created_by);
      v_gate     := projects.resolve_work_item_gatekeeper(d.project_id, NULL);   -- A(b): the PM

      INSERT INTO projects.work_items (
        organisation_id, project_id, item_type, origin, title, priority,
        status, source_status, assignee_id, gatekeeper_id, due_date, created_by, diary_id)
      VALUES (
        d.organisation_id, d.project_id, 'diary_action', 'mirror', v_title, 'medium',
        projects.work_item_status_for_mirror(NULL, NULL, false),
        NULL,                  -- the source has no status vocabulary at all
        v_assignee, v_gate, NULL, d.created_by, d.id)
      ON CONFLICT (diary_id) WHERE diary_id IS NOT NULL AND origin = 'mirror' DO NOTHING
      RETURNING * INTO v_item;

      IF v_item.id IS NOT NULL THEN
        PERFORM projects.seed_work_item_watchers(v_item.id, d.created_by, v_assignee, v_gate);
      END IF;
    ELSE
      v_moved := v_item.project_id IS DISTINCT FROM d.project_id;   -- improvement 8
      UPDATE projects.work_items
         SET project_id = d.project_id, organisation_id = d.organisation_id,
             title = v_title,
             assignee_id = CASE WHEN v_moved
                                THEN projects.resolve_work_item_assignee(d.project_id,'diary_action',d.created_by)
                                ELSE v_item.assignee_id END,
             gatekeeper_id = CASE WHEN v_moved
                                  THEN projects.resolve_work_item_gatekeeper(d.project_id, NULL)
                                  ELSE v_item.gatekeeper_id END,
             last_activity_at = now()
       WHERE id = v_item.id;
    END IF;
  END $fn$;

  CREATE OR REPLACE FUNCTION projects.mirror_diary_action_work_item()
  RETURNS TRIGGER
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'projects', 'public'
  SET row_security TO 'off'
  AS $fn$
  BEGIN
    IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
    PERFORM projects.project_diary_action(NEW.id);
    RETURN NULL;
  END $fn$;

  CREATE TRIGGER site_diary_entries_mirror_work_item_ins
    AFTER INSERT ON projects.site_diary_entries
    FOR EACH ROW EXECUTE FUNCTION projects.mirror_diary_action_work_item();

  CREATE TRIGGER site_diary_entries_mirror_work_item_upd
    AFTER UPDATE OF delays, delay_notes, entry_date, project_id, organisation_id
    ON projects.site_diary_entries
    FOR EACH ROW
    WHEN (OLD.delays          IS DISTINCT FROM NEW.delays
       OR OLD.delay_notes     IS DISTINCT FROM NEW.delay_notes
       OR OLD.entry_date      IS DISTINCT FROM NEW.entry_date
       OR OLD.project_id      IS DISTINCT FROM NEW.project_id
       OR OLD.organisation_id IS DISTINCT FROM NEW.organisation_id)
    EXECUTE FUNCTION projects.mirror_diary_action_work_item();
  ```

- [ ] **Step 4: Delete the tautological probe row flagged in Step 1, run the probe and watch 6/6 pass.**

- [ ] **Step 5: Make the three vacuous assertions real — this is the acceptance step for the task.** Change `v_delay := projects.diary_delay_text(d.delays, d.delay_notes);` to the original non-empty predicate:
  ```sql
  v_delay := COALESCE(NULLIF(TRIM(d.delays), ''), NULLIF(TRIM(d.delay_notes), ''));
  ```
  Re-run. Expected:
  ```
  FAIL  empty_entry_not_mirrored        the string is literally "None," — 2 of the 6 live rows say exactly this
  FAIL  sentence_negation_not_mirrored  the 2026-06-02 entry is a sentence, so a token stop-list alone is not enough
  ```
  Restore. Then change it to `v_delay := NULL;` and re-run: `FAIL real_delay_mirrored`, `FAIL title_carries_the_delay`, `FAIL edit_into_scope_mirrors` — the stop-list has eaten the feature. Restore. **Record 6/6 → 4/6 → 3/6 → 6/6 in the PR body.**

- [ ] **Step 6: Commit.**
  ```bash
  git add apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql \
          scripts/db/probes/09-diary-mirror.sql
  git commit -m "feat(work-items): diary_action projection, gated on a real delay and not a filled-in box

All 6 of 6 live site_diary_entries delay values are negations — None, / None, /
None / None / NO / 'No delays or info required was noted…'. A non-empty test
measures whether the box was filled in, not whether a delay occurred."
  ```

---

## Task 11 — The `form_action` projection (F10)

`field.site_forms` holds **1 row** on production, on `(649) PNP FAERIE GLEN`. `form_action`'s +3 working days is set by what the record is for — it feeds a supplementary CoC under EIR reg 7(4) — not by how long the form takes to fill (§03 §1.5).

⚠ `field.site_forms` already carries `trg_site_forms_transition` (`00179:415`; function `field.enforce_site_form_transition()` at `00179:347`, deliberately `SECURITY INVOKER` with the rationale at `00179:341-346`). The mirror is `AFTER`, so the state machine runs first and the mirror only ever sees a legal transition. **Do not convert the mirror to `BEFORE` for any reason.**

**F10 — a site form is born `open`, not `triage`, and that is a decision.** `field.site_forms.created_by` is `UUID NOT NULL DEFAULT auth.uid()` (`00179:83`), so the original `NEW.created_by IS NOT NULL` was a tautology and the outcome was accidental. The decision taken here: **a site form is the thing its author must finish**, so its author is an explicit owner and the item is born `open` on them. The literal `true` and the reason are in the code, and probe 10 asserts `= 'open'` rather than `IN ('triage','open')` so nobody can flip it without a failing test.

**Files:**
- Modify: the migration — section D
- Test: `scripts/db/probes/10-form-mirror.sql`

- [ ] **Step 1: Write the probe first.** Create `scripts/db/probes/10-form-mirror.sql`:
  ```sql
  DO $probe$
  DECLARE
    v_org uuid := 'dddddddd-0000-0000-0000-000000000001';
    v_pm uuid; v_proj uuid; v_tpl uuid; v_form uuid;
    v_title text; v_status text; v_assignee uuid; v_bic uuid;
    v_dist_status text; v_dist_bic uuid; v_dist_closed timestamptz;
  BEGIN
    SELECT u.user_id INTO v_pm FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active LIMIT 1;
    SELECT id INTO v_tpl FROM field.form_templates WHERE is_active LIMIT 1;

    INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
    VALUES (v_org, '_probe_form', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj;

    INSERT INTO field.site_forms (organisation_id, project_id, template_row_id,
                                  board_ref, board_label, status, created_by)
    VALUES (v_org, v_proj, v_tpl, 'DB-PROBE', 'Probe board', 'draft', v_pm)
    RETURNING id INTO v_form;

    SELECT w.title, w.status, w.assignee_id, w.ball_in_court_id
      INTO v_title, v_status, v_assignee, v_bic
      FROM projects.work_items w WHERE w.site_form_id = v_form;

    UPDATE field.site_forms
       SET status = 'distributed', submitted_at = now(), submitted_by = created_by,
           distributed_at = now(), distributed_by = created_by
     WHERE id = v_form;

    SELECT w.status, w.ball_in_court_id, w.closed_at
      INTO v_dist_status, v_dist_bic, v_dist_closed
      FROM projects.work_items w WHERE w.site_form_id = v_form;

    CREATE TEMP TABLE f_ctx(form uuid, pm uuid, title text, status text,
      assignee uuid, bic uuid, dist_status text, dist_bic uuid, dist_closed timestamptz)
      ON COMMIT DROP;
    INSERT INTO f_ctx VALUES (v_form, v_pm, v_title, v_status, v_assignee, v_bic,
      v_dist_status, v_dist_bic, v_dist_closed);
  END $probe$;

  SELECT 'form_item_created' AS probe,
         (SELECT count(*) FROM projects.work_items w, f_ctx c
           WHERE w.site_form_id = c.form AND w.origin = 'mirror') = 1 AS ok,
         'a draft form is already an obligation: somebody has to finish it' AS detail
  UNION ALL
  SELECT 'title_names_the_board',
         (SELECT title LIKE '%Probe board%' FROM f_ctx),
         'the item must name the board without opening the form'
  UNION ALL
  -- F10, decided rather than accidental.
  SELECT 'draft_is_open_on_its_author',
         (SELECT status = 'open' AND assignee = pm AND bic = pm FROM f_ctx),
         'F10: a site form IS the thing its author must finish, so it is born open on them, not triage'
  UNION ALL
  SELECT 'distributed_is_closed',
         (SELECT dist_status = 'closed' AND dist_closed IS NOT NULL FROM f_ctx),
         'submitted → answered → distributed → closed'
  UNION ALL
  SELECT 'closed_clears_bic',
         (SELECT dist_bic IS NULL FROM f_ctx),
         'A(a): the item leaves every inbox on closed';
  ```

- [ ] **Step 2: Run it and watch `form_item_created` fail, 1/5** — `closed_clears_bic` passes vacuously (there is no ball to clear).

- [ ] **Step 3: Append the form projection.**
  ```sql
  CREATE OR REPLACE FUNCTION projects.project_form_action(p_form_id uuid)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'projects', 'public', 'field'
  SET row_security TO 'off'
  AS $fn$
  DECLARE
    f          field.site_forms%ROWTYPE;
    v_item     projects.work_items%ROWTYPE;
    v_assignee uuid; v_gate uuid; v_mapped text; v_title text; v_moved boolean;
  BEGIN
    SELECT * INTO f FROM field.site_forms WHERE id = p_form_id;
    IF NOT FOUND THEN RETURN; END IF;

    SELECT * INTO v_item FROM projects.work_items WHERE site_form_id = f.id AND origin = 'mirror';
    v_mapped := projects.map_source_status('form_action', f.status);
    -- board_label is the as-found nameplate and board_ref the schedule tag; the
    -- site_forms_board_identified CHECK (00179:93-95) guarantees one of them.
    v_title  := COALESCE(f.form_no, 'Site form') || ' — '
                || COALESCE(NULLIF(TRIM(f.board_label), ''), f.board_ref, 'board');

    IF v_item.id IS NULL THEN
      v_assignee := projects.resolve_work_item_assignee(f.project_id, 'form_action', f.created_by);
      v_gate     := projects.resolve_work_item_gatekeeper(f.project_id, NULL);   -- A(b): the PM

      INSERT INTO projects.work_items (
        organisation_id, project_id, item_type, origin, title, priority,
        status, source_status, assignee_id, gatekeeper_id, due_date, created_by, site_form_id)
      VALUES (
        f.organisation_id, f.project_id, 'form_action', 'mirror', v_title, 'medium',
        -- F10. The third argument is a literal true, not `f.created_by IS NOT NULL`
        -- (which is a tautology: 00179:83 makes created_by NOT NULL DEFAULT
        -- auth.uid()). The decision: a site form IS the thing its author must
        -- finish, so the author is an explicit owner and the item is born `open`
        -- on them rather than entering the triage queue. Probe 10 asserts = 'open'.
        projects.work_item_status_for_mirror(NULL, v_mapped, true),
        f.status, v_assignee, v_gate, NULL, f.created_by, f.id)
      ON CONFLICT (site_form_id) WHERE site_form_id IS NOT NULL AND origin = 'mirror' DO NOTHING
      RETURNING * INTO v_item;

      IF v_item.id IS NOT NULL THEN
        PERFORM projects.seed_work_item_watchers(v_item.id, f.created_by, v_assignee, v_gate);
      END IF;
    ELSE
      v_moved := v_item.project_id IS DISTINCT FROM f.project_id;   -- improvement 8
      UPDATE projects.work_items
         SET project_id = f.project_id, organisation_id = f.organisation_id,
             title = v_title, source_status = f.status,
             status = projects.work_item_status_for_mirror(v_item.status, v_mapped, false),
             assignee_id = CASE WHEN v_moved
                                THEN projects.resolve_work_item_assignee(f.project_id,'form_action',f.created_by)
                                ELSE v_item.assignee_id END,
             gatekeeper_id = CASE WHEN v_moved
                                  THEN projects.resolve_work_item_gatekeeper(f.project_id, NULL)
                                  ELSE v_item.gatekeeper_id END,
             closed_at = CASE WHEN f.status = 'distributed'
                              THEN COALESCE(v_item.closed_at, f.distributed_at, now()) END,
             closed_by = CASE WHEN f.status = 'distributed'
                              THEN COALESCE(v_item.closed_by, f.distributed_by) END,
             void_reason = CASE WHEN f.status = 'void' THEN f.void_reason END,
             last_activity_at = now()
       WHERE id = v_item.id;
    END IF;
  END $fn$;

  CREATE OR REPLACE FUNCTION projects.mirror_form_action_work_item()
  RETURNS TRIGGER
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'projects', 'public', 'field'
  SET row_security TO 'off'
  AS $fn$
  BEGIN
    IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
    PERFORM projects.project_form_action(NEW.id);
    RETURN NULL;
  END $fn$;

  CREATE TRIGGER site_forms_mirror_work_item_ins
    AFTER INSERT ON field.site_forms
    FOR EACH ROW EXECUTE FUNCTION projects.mirror_form_action_work_item();

  CREATE TRIGGER site_forms_mirror_work_item_upd
    AFTER UPDATE OF form_no, board_ref, board_label, status,
                    distributed_at, distributed_by, void_reason, project_id, organisation_id
    ON field.site_forms
    FOR EACH ROW
    WHEN (OLD.form_no         IS DISTINCT FROM NEW.form_no
       OR OLD.board_ref       IS DISTINCT FROM NEW.board_ref
       OR OLD.board_label     IS DISTINCT FROM NEW.board_label
       OR OLD.status          IS DISTINCT FROM NEW.status
       OR OLD.distributed_at  IS DISTINCT FROM NEW.distributed_at
       OR OLD.distributed_by  IS DISTINCT FROM NEW.distributed_by
       OR OLD.void_reason     IS DISTINCT FROM NEW.void_reason
       OR OLD.project_id      IS DISTINCT FROM NEW.project_id
       OR OLD.organisation_id IS DISTINCT FROM NEW.organisation_id)
    EXECUTE FUNCTION projects.mirror_form_action_work_item();
  ```

- [ ] **Step 4: Run the probe and watch 5/5 pass.**

- [ ] **Step 5: Mutation-verify F10.** Change the third argument from `true` to `false`. Re-run. Expected: `FAIL draft_is_open_on_its_author  F10: a site form IS the thing its author must finish, …` — the item lands in triage instead. Restore. This is the pin that stops the decision drifting back to an accident.

- [ ] **Step 6: Commit.**
  ```bash
  git add apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql \
          scripts/db/probes/10-form-mirror.sql
  git commit -m "feat(work-items): form_action projection, born open on its author

created_by is NOT NULL DEFAULT auth.uid() (00179:83), so the original
'created_by IS NOT NULL' test was a tautology and the outcome was accidental.
Decided: a site form is the thing its author must finish."
  ```

---

## Task 12 — Six delete-to-void triggers, `BEFORE DELETE` (F1)

§03 §1.2 chose `ON DELETE SET NULL` over `CASCADE` on the house precedent that *"deleting a board must not delete the record of having made it safe"* (`00179:75-77`), and because `deleteDiaryEntryAction` (`apps/web/src/actions/diary.actions.ts:109`) is a live, gated action today — a cascade would silently destroy the item's `work_item_events` and with them the median-days-to-respond metric.

**The spec's `AFTER DELETE` does not work, and the consequence is worse than an orphan.** The RI `SET NULL` action runs before a user `AFTER DELETE` trigger, so the `AFTER` form's `UPDATE … WHERE rfi_id = OLD.id` matches nothing. But A(a)'s

```sql
CONSTRAINT work_items_source_required CHECK (
  item_type IN ('task','approval') OR status = 'void'
  OR <exactly one source column is non-null>)
```

is re-evaluated on that `SET NULL` update, and at that moment the item is still `status = 'open'` with zero sources. **So the DELETE aborts with `23514`.** Deleting a diary entry, an RFI or a snag would simply stop working in production the moment a mirror item existed for it.

With `BEFORE DELETE` the item is already `void` when `SET NULL` fires, both `work_items_source_required` and `work_items_bic_present` pass on their `void` arms, and the delete proceeds. `ball_in_court_id` goes NULL for free — it is a `STORED` generated column over `status`.

⚠ **An earlier probe reported the `AFTER` case as a silently-orphaned open item (`{src_id: null, status: "open", void_reason: null}`). That probe ran against a synthetic table with no CHECK constraints and its result is withdrawn.** Step 5 measures the real thing against item 2's table.

One function serves all six, keyed on `TG_ARGV[0]`. `format('%I')` quotes the identifier, and `TG_ARGV` is developer-supplied in this file, so there is no injection surface.

**Files:**
- Modify: the migration — add section F
- Create: `apps/web/src/lib/work-items/mirror-triggers.contract.test.ts`
- Test: `scripts/db/probes/11-delete-to-void.sql`

- [ ] **Step 1: Write the probe first, covering three sources.** Create `scripts/db/probes/11-delete-to-void.sql`:
  ```sql
  DO $probe$
  DECLARE
    v_org uuid := 'dddddddd-0000-0000-0000-000000000001';
    v_pm uuid; v_proj uuid; v_rfi uuid; v_snag uuid; v_diary uuid;
  BEGIN
    SELECT u.user_id INTO v_pm FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active LIMIT 1;
    INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
    VALUES (v_org, '_probe_delete', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj;

    INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                               priority, status, raised_by)
    VALUES (v_proj, v_org, 'Doomed RFI', 'x', 'medium', 'open', v_pm) RETURNING id INTO v_rfi;
    INSERT INTO field.snags (project_id, organisation_id, title, priority, status, raised_by)
    VALUES (v_proj, v_org, 'Doomed snag', 'medium', 'open', v_pm) RETURNING id INTO v_snag;
    INSERT INTO projects.site_diary_entries (project_id, organisation_id, entry_date,
                                             progress_notes, delays, created_by)
    VALUES (v_proj, v_org, CURRENT_DATE, 'x', 'Crane stood down 4h', v_pm)
    RETURNING id INTO v_diary;

    CREATE TEMP TABLE del_ctx(kind text, item uuid) ON COMMIT DROP;
    INSERT INTO del_ctx
      SELECT 'rfi',   w.id FROM projects.work_items w WHERE w.rfi_id   = v_rfi   UNION ALL
      SELECT 'snag',  w.id FROM projects.work_items w WHERE w.snag_id  = v_snag  UNION ALL
      SELECT 'diary', w.id FROM projects.work_items w WHERE w.diary_id = v_diary;

    -- With AFTER DELETE these three statements RAISE 23514 and the whole probe
    -- returns HTTP 400 instead of any assertion rows. That is the finding.
    DELETE FROM projects.rfis               WHERE id = v_rfi;
    DELETE FROM field.snags                 WHERE id = v_snag;
    DELETE FROM projects.site_diary_entries WHERE id = v_diary;
  END $probe$;

  SELECT 'three_items_existed' AS probe, (SELECT count(*) FROM del_ctx) = 3 AS ok,
         'the fixture must actually have produced items, or every row below passes vacuously' AS detail
  UNION ALL
  SELECT 'deletes_succeeded',
         (SELECT count(*) FROM projects.rfis WHERE subject = 'Doomed RFI') = 0,
         'F1: with AFTER DELETE the DELETE itself aborts on work_items_source_required'
  UNION ALL
  SELECT 'all_voided',
         (SELECT count(*) FROM projects.work_items w JOIN del_ctx d ON d.item = w.id
           WHERE w.status = 'void' AND w.void_reason = 'source deleted') = 3,
         'the item is voided BEFORE the RI SET NULL empties its source column'
  UNION ALL
  SELECT 'fk_is_null',
         (SELECT count(*) FROM projects.work_items w JOIN del_ctx d ON d.item = w.id
           WHERE w.rfi_id IS NULL AND w.snag_id IS NULL AND w.diary_id IS NULL) = 3,
         'ON DELETE SET NULL still applied, after the void'
  UNION ALL
  SELECT 'bic_cleared',
         (SELECT count(*) FROM projects.work_items w JOIN del_ctx d ON d.item = w.id
           WHERE w.ball_in_court_id IS NULL) = 3,
         'A(a): the generated column is NULL on void, so the item leaves every inbox'
  UNION ALL
  SELECT 'events_survive',
         (SELECT count(*) FROM projects.work_item_events e JOIN del_ctx d ON d.item = e.work_item_id) > 0,
         '§03 §1.2: the events are why this is not a CASCADE';
  ```

- [ ] **Step 2: Run it and watch it fail.**
  ```bash
  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/11-delete-to-void.sql \
    --with apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql
  ```
  Expected — with no void trigger at all, the constraint fires exactly as it would with `AFTER DELETE`:
  ```
  FAIL (HTTP 400)
  … ERROR: 23514: new row for relation "work_items" violates check constraint "work_items_source_required"
  ```
  **Read that error. It is the finding.** Delete of an RFI is broken until this task lands.

- [ ] **Step 3: Append section F.**
  ```sql
  -- ─── F. Delete-to-void ───────────────────────────────────────────────────────
  -- ⚠ BEFORE DELETE, not AFTER. §03 §1.2 says AFTER; that is measurably wrong.
  -- The ON DELETE SET NULL referential action runs before a user AFTER DELETE
  -- trigger, so the AFTER form's UPDATE matches nothing — and A(a)'s
  -- work_items_source_required is re-evaluated on that SET NULL while the item is
  -- still status='open' with zero sources, so the DELETE ABORTS with 23514.
  -- Deleting a diary entry (deleteDiaryEntryAction, diary.actions.ts:109), an RFI
  -- or a snag would simply stop working the moment a mirror item existed.
  -- BEFORE DELETE voids first, so both work_items_source_required and
  -- work_items_bic_present pass on their 'void' arms and the delete proceeds.
  CREATE OR REPLACE FUNCTION projects.void_work_item_on_source_delete()
  RETURNS TRIGGER
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'projects', 'public'
  SET row_security TO 'off'
  AS $fn$
  BEGIN
    -- %I quotes the identifier; TG_ARGV[0] is set by the six CREATE TRIGGER
    -- statements below and is never user input.
    -- ball_in_court_id needs no clearing: it is a STORED generated column over
    -- status and goes NULL on 'void' by itself (A(a)).
    EXECUTE format(
      'UPDATE projects.work_items
          SET status = ''void'', void_reason = $1, last_activity_at = now()
        WHERE %I = $2 AND status <> ''void''', TG_ARGV[0])
      USING 'source deleted', OLD.id;
    RETURN OLD;   -- BEFORE trigger: returning OLD lets the DELETE proceed
  END $fn$;

  CREATE TRIGGER rfis_void_work_item BEFORE DELETE ON projects.rfis
    FOR EACH ROW EXECUTE FUNCTION projects.void_work_item_on_source_delete('rfi_id');
  CREATE TRIGGER snags_void_work_item BEFORE DELETE ON field.snags
    FOR EACH ROW EXECUTE FUNCTION projects.void_work_item_on_source_delete('snag_id');
  CREATE TRIGGER inspections_void_work_item BEFORE DELETE ON inspections.inspections
    FOR EACH ROW EXECUTE FUNCTION projects.void_work_item_on_source_delete('inspection_id');
  CREATE TRIGGER qc_entries_void_work_item BEFORE DELETE ON projects.qc_entries
    FOR EACH ROW EXECUTE FUNCTION projects.void_work_item_on_source_delete('qc_entry_id');
  CREATE TRIGGER site_diary_entries_void_work_item BEFORE DELETE ON projects.site_diary_entries
    FOR EACH ROW EXECUTE FUNCTION projects.void_work_item_on_source_delete('diary_id');
  CREATE TRIGGER site_forms_void_work_item BEFORE DELETE ON field.site_forms
    FOR EACH ROW EXECUTE FUNCTION projects.void_work_item_on_source_delete('site_form_id');
  ```

- [ ] **Step 4: Run the probe and watch 6/6 pass.**

- [ ] **Step 5: Mutation-verify F1 — the acceptance step for the whole task.** Change all six `BEFORE DELETE` to `AFTER DELETE` and re-run. Expected:
  ```
  FAIL (HTTP 400)
  … ERROR: 23514: new row for relation "work_items" violates check constraint "work_items_source_required"
  ```
  — not a failing assertion, an aborted statement. **Copy the exact SQLSTATE, constraint name and message into the PR body**, and note that no assertion row is returned at all, which is why the harness's zero-rows guard (Task 1 Step 7) matters. Restore `BEFORE DELETE` and confirm 6/6.

- [ ] **Step 6: Write the contract test that pins it in CI.** Create `apps/web/src/lib/work-items/mirror-triggers.contract.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { readFileSync, readdirSync } from 'node:fs'
  import { join, resolve } from 'node:path'

  const REPO_ROOT = resolve(__dirname, '../../../../..')
  const MIG_DIR = join(REPO_ROOT, 'apps/edge-functions/supabase/migrations')

  function mirrorMigration(): { name: string; sql: string } {
    for (const n of readdirSync(MIG_DIR).sort()) {
      const sql = readFileSync(join(MIG_DIR, n), 'utf8')
      if (sql.includes('projects.void_work_item_on_source_delete')) return { name: n, sql }
    }
    throw new Error('no migration defines projects.void_work_item_on_source_delete')
  }

  /** Strip block and whole-line comments so prose ABOUT the bug does not read AS the bug. */
  function stripComments(sql: string): string {
    return sql
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/^\s*--.*$/gm, '')
  }

  const SOURCES = [
    ['rfis', 'projects.rfis'],
    ['snags', 'field.snags'],
    ['inspections', 'inspections.inspections'],
    ['qc_entries', 'projects.qc_entries'],
    ['site_diary_entries', 'projects.site_diary_entries'],
    ['site_forms', 'field.site_forms'],
  ] as const

  describe('work-item source mirrors: structural contract', () => {
    const { name, sql } = mirrorMigration()
    const code = stripComments(sql)

    it('every delete-to-void trigger is BEFORE DELETE, never AFTER', () => {
      const triggers = [...code.matchAll(
        /CREATE TRIGGER\s+(\w+)\s+(BEFORE|AFTER)\s+DELETE\s+ON\s+([\w.]+)[\s\S]{0,200}?void_work_item_on_source_delete/gi,
      )]
      expect(triggers.length, 'expected six delete-to-void triggers').toBe(6)
      const wrong = triggers.filter((t) => t[2].toUpperCase() !== 'BEFORE')
        .map((t) => `${t[1]} ON ${t[3]} is ${t[2]} DELETE`)
      expect(
        wrong,
        `${name}: an AFTER DELETE trigger cannot void the item. The ON DELETE SET NULL ` +
        `referential action runs first, and work_items_source_required is re-evaluated on ` +
        `that update while the item is still open with no source — so the DELETE aborts ` +
        `with 23514 and deleting an RFI/snag/diary entry stops working. Measured, not theorised.`,
      ).toEqual([])
    })

    it('F7: every source has an _ins trigger and an _upd trigger with a WHEN clause', () => {
      for (const [prefix, table] of SOURCES) {
        const ins = new RegExp(
          `CREATE TRIGGER\\s+${prefix}_mirror_work_item_ins\\s+AFTER INSERT ON\\s+${table.replace('.', '\\.')}`, 'i')
        expect(code, `${prefix}: missing an AFTER INSERT trigger on ${table}`).toMatch(ins)

        const updMatch = code.match(new RegExp(
          `CREATE TRIGGER\\s+${prefix}_mirror_work_item_upd[\\s\\S]*?EXECUTE FUNCTION`, 'i'))
        expect(updMatch, `${prefix}: missing an AFTER UPDATE trigger on ${table}`).not.toBeNull()
        expect(
          updMatch![0],
          `${prefix}_mirror_work_item_upd must carry the §03 §1.2 WHEN predicate. ` +
          `PostgreSQL rejects WHEN(OLD…) on a trigger whose events include INSERT, which is ` +
          `why the declaration is split in two rather than dropped.`,
        ).toMatch(/\bWHEN\s*\(\s*OLD\./i)
        expect(
          updMatch![0],
          `${prefix}_mirror_work_item_upd must watch project_id: §15's rollout moves snags to ` +
          `KINGSWALK, and an item left on the old project keeps the wrong scope and people.`,
        ).toMatch(/OLD\.project_id\s+IS DISTINCT FROM\s+NEW\.project_id/i)
      }
    })

    it('every mirror trigger wrapper carries the pg_trigger_depth guard', () => {
      const fns = [...code.matchAll(
        /CREATE OR REPLACE FUNCTION\s+(projects\.mirror_\w+)\s*\([\s\S]*?\$fn\$([\s\S]*?)\$fn\$/g,
      )]
      expect(fns.length, 'expected the seven mirror trigger wrappers').toBe(7)
      const unguarded = fns
        .filter((f) => !/pg_trigger_depth\(\)\s*>\s*1/.test(f[2]))
        .map((f) => f[1])
      expect(unguarded, `unguarded mirror wrappers: ${unguarded.join(', ')}`).toEqual([])
    })

    it('the projection bodies are callable directly and carry NO depth guard', () => {
      const bodies = [...code.matchAll(
        /CREATE OR REPLACE FUNCTION\s+(projects\.project_\w+)\s*\(p_\w+ uuid\)[\s\S]*?\$fn\$([\s\S]*?)\$fn\$/g,
      )]
      expect(bodies.length, 'expected six projects.project_<source>(uuid) bodies').toBe(6)
      const guarded = bodies.filter((b) => /pg_trigger_depth/.test(b[2])).map((b) => b[1])
      expect(
        guarded,
        `${guarded.join(', ')} must NOT carry a depth guard: the backfill calls these directly ` +
        `(at depth 0) precisely so it never UPDATEs a source row and never rewrites updated_at ` +
        `on ~40 live rows through their set_updated_at triggers.`,
      ).toEqual([])
    })

    it('the backfill never UPDATEs a source table', () => {
      const offenders = [
        ...code.matchAll(/UPDATE\s+(projects\.rfis|field\.snags|inspections\.inspections|projects\.qc_entries|projects\.site_diary_entries|field\.site_forms)\b/gi),
      ].map((m) => m[0])
      // The write-back legitimately updates rfis and snags; nothing else may.
      const illegal = offenders.filter((o) => !/projects\.rfis|field\.snags/i.test(o))
      expect(
        illegal,
        `${illegal.join(', ')}: every source table carries a BEFORE UPDATE set_updated_at ` +
        `trigger, so touching one rewrites live history. Project through projects.project_*().`,
      ).toEqual([])
    })

    it('the write-back function deliberately has NO depth guard', () => {
      const m = code.match(
        /CREATE OR REPLACE FUNCTION\s+projects\.work_item_assignment_writeback\s*\([\s\S]*?\$fn\$([\s\S]*?)\$fn\$/,
      )
      expect(m, 'work_item_assignment_writeback not found').not.toBeNull()
      expect(
        /pg_trigger_depth/.test(m![1]),
        'A depth guard here silently loses the write-back: work_items.assignee_id names the ' +
        'resolved holder while rfis.assigned_to stays NULL and the RFI page renders nothing. ' +
        'Termination comes from the mirror wrappers, proved by mutation.',
      ).toBe(false)
    })

    it('the write-back skips closed and void records', () => {
      const m = code.match(
        /CREATE OR REPLACE FUNCTION\s+projects\.work_item_assignment_writeback\s*\([\s\S]*?\$fn\$([\s\S]*?)\$fn\$/,
      )
      expect(
        m![1],
        '6 of 15 live RFIs are already closed. Stamping assigned_to on them makes the RFI page ' +
        'render an assignee nobody ever set — the as_left_status lesson.',
      ).toMatch(/NEW\.status IN \('closed','void'\)/)
    })

    it('the diary projection is gated on diary_delay_text, not on a non-empty box', () => {
      const m = code.match(
        /CREATE OR REPLACE FUNCTION\s+projects\.project_diary_action\s*\([\s\S]*?\$fn\$([\s\S]*?)\$fn\$/,
      )
      expect(m, 'projects.project_diary_action not found').not.toBeNull()
      expect(
        m![1],
        'All 6 of 6 live site_diary_entries delay values are negations (measured 2026-09-10). ' +
        'A COALESCE(NULLIF(TRIM(...))) predicate measures whether the box was filled in.',
      ).toMatch(/projects\.diary_delay_text\(/)
    })

    it('nothing in this migration attaches a trigger to structure.node_orders', () => {
      const offenders = [...code.matchAll(/CREATE TRIGGER\s+\w+[\s\S]{0,200}?ON\s+(structure\.node_orders)/gi)]
        .map((m) => m[0].split('\n')[0].trim())
      expect(
        offenders,
        'A(b): order_followup is created ONLY by the explicit chase control on an order line. ' +
        'A projection trigger here would put 440 live procurement rows into inboxes on day one.',
      ).toEqual([])
    })
  })
  ```

- [ ] **Step 7: Run it and watch 9 pass.**
  ```bash
  pnpm --filter web test mirror-triggers
  ```

- [ ] **Step 8: Prove each of the nine tests can fail — ten mutations, because the F7 test carries three assertions.** One at a time, undo the thing it guards, run, confirm the named failure, restore:
  - flip one `BEFORE DELETE` → `AFTER DELETE` ⇒ *"rfis_void_work_item ON projects.rfis is AFTER DELETE"*
  - delete the `WHEN` clause from `snags_mirror_work_item_upd` ⇒ *"snags_mirror_work_item_upd must carry the §03 §1.2 WHEN predicate"*
  - delete `OLD.project_id IS DISTINCT FROM NEW.project_id` from one `_upd` ⇒ *"must watch project_id: §15's rollout moves snags to KINGSWALK…"*
  - delete the depth guard from `mirror_snag_work_item` ⇒ *"unguarded mirror wrappers: projects.mirror_snag_work_item"*
  - add a depth guard to `project_rfi` ⇒ *"projects.project_rfi must NOT carry a depth guard…"*
  - add `UPDATE inspections.inspections SET status = status;` anywhere ⇒ *"UPDATE inspections.inspections: every source table carries a BEFORE UPDATE set_updated_at trigger…"*
  - add a depth guard to the write-back ⇒ *"A depth guard here silently loses the write-back…"*
  - delete `IF NEW.status IN ('closed','void')` from the write-back ⇒ *"6 of 15 live RFIs are already closed…"*
  - replace `projects.diary_delay_text(` in `project_diary_action` with `COALESCE(NULLIF(TRIM(` ⇒ *"All 6 of 6 live site_diary_entries delay values are negations…"*
  - add `CREATE TRIGGER x AFTER INSERT ON structure.node_orders …` ⇒ *"A(b): order_followup is created ONLY by the explicit chase control…"*

- [ ] **Step 9: Commit.**
  ```bash
  git add apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql \
          apps/web/src/lib/work-items/mirror-triggers.contract.test.ts \
          scripts/db/probes/11-delete-to-void.sql
  git commit -m "feat(work-items): BEFORE DELETE void triggers + structural contract test

AFTER DELETE does not merely orphan the item: work_items_source_required is
re-evaluated on the ON DELETE SET NULL update while the item is still open with
no source, so the DELETE aborts with 23514 and deleting an RFI, snag or diary
entry stops working entirely."
  ```

---

## Task 13 — Grants, and the `anon` revoke that is not optional (F5)

Two obligations, routinely confused (§12 §(b) rule 5), and **this migration has both**: twenty-four functions **and** one table (the pre-migration snapshot in section H).

**Functions.** `REVOKE ALL … FROM PUBLIC` does **not** remove `anon`'s EXECUTE: Supabase's `ALTER DEFAULT PRIVILEGES` grants `anon` EXECUTE *directly* at creation, a separate grant. `field.allocate_form_no` was executable by `anon` in production for exactly this reason (`00179:317,326`); the precedent to copy is `00113_lock_rbac_function_grants.sql:14-24`, which pairs every `FROM PUBLIC` with a `FROM anon`.

**And grant to nobody.** Measured (F5): a trigger fires for a caller holding no EXECUTE privilege on its function — function privileges on a trigger function are checked at `CREATE TRIGGER` time, not at fire time. Every function here is reached only from inside a trigger or from another `SECURITY DEFINER` function owned by the same role, so no `GRANT EXECUTE` is required at all. Adding one would be a widened surface bought for nothing.

**Tables.** `00025_grant_schema_permissions.sql:26` sets `ALTER DEFAULT PRIVILEGES … GRANT SELECT ON TABLES TO anon`, so **every new table in `projects` is born anon-readable at the grant layer** (A(f)). The snapshot table holds the `assigned_to` of every RFI and snag on the platform. It gets a `REVOKE SELECT … FROM anon` and RLS with **no policy** — service-role only — and it appears in the `-- @verify:` block and in A(f).

⚠ **Never verify by reading `proacl` or `relacl`.** A NULL `proacl` looks empty but **is** the PUBLIC grant. Use `has_function_privilege` / `has_table_privilege`.

**Files:**
- Modify: the migration — add section G
- Test: `scripts/db/probes/12-grants.sql`

- [ ] **Step 1: Write the probe first.** Create `scripts/db/probes/12-grants.sql`:
  ```sql
  WITH fns AS (
    SELECT p.oid, p.prosrc, p.prosecdef,
           n.nspname || '.' || p.proname || '(' ||
           pg_get_function_identity_arguments(p.oid) || ')' AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'projects'
       AND p.proname IN ('resolve_project_pm','resolve_work_item_assignee',
                         'resolve_work_item_gatekeeper','work_item_person_eligible',
                         'map_source_status','work_item_status_for_mirror',
                         'work_item_mirror_due_date','diary_delay_text',
                         'seed_work_item_watchers',
                         'project_rfi','project_snag','project_inspection',
                         'project_qc_entry','project_diary_action','project_form_action',
                         'mirror_rfi_work_item','mirror_snag_work_item',
                         'mirror_inspection_work_item','mirror_qc_defect_work_item',
                         'mirror_qc_report_defects','mirror_diary_action_work_item',
                         'mirror_form_action_work_item','work_item_assignment_writeback',
                         'void_work_item_on_source_delete')
  )
  SELECT 'all_functions_created' AS probe, count(*) = 24 AS ok,
         'found ' || count(*) || ' of 24' AS detail FROM fns
  UNION ALL
  SELECT 'anon_cannot_execute_any',
         count(*) FILTER (WHERE has_function_privilege('anon', oid, 'EXECUTE')) = 0,
         'anon can execute: ' || COALESCE(string_agg(sig, ', ')
           FILTER (WHERE has_function_privilege('anon', oid, 'EXECUTE')), 'none') FROM fns
  UNION ALL
  SELECT 'public_cannot_execute_any',
         count(*) FILTER (WHERE has_function_privilege('public', oid, 'EXECUTE')) = 0,
         'PUBLIC can execute: ' || COALESCE(string_agg(sig, ', ')
           FILTER (WHERE has_function_privilege('public', oid, 'EXECUTE')), 'none') FROM fns
  UNION ALL
  SELECT 'every_stateful_function_is_security_definer',
         count(*) FILTER (WHERE NOT prosecdef) = 0,
         'SECURITY INVOKER: ' || COALESCE(string_agg(sig, ', ') FILTER (WHERE NOT prosecdef), 'none')
    FROM fns
   WHERE sig NOT LIKE 'projects.map_source_status%'
     AND sig NOT LIKE 'projects.work_item_status_for_mirror%'
     AND sig NOT LIKE 'projects.work_item_mirror_due_date%'
     AND sig NOT LIKE 'projects.diary_delay_text%'
  UNION ALL
  -- Narrowed to the AUTHORISATION use, and comment-stripped: this migration is
  -- full of prose explaining why current_user must not be used, and a bare token
  -- match would fail the build on the explanation rather than on the defect.
  SELECT 'no_current_user_authorisation',
         count(*) FILTER (
           WHERE regexp_replace(prosrc, '--[^\n]*', '', 'g')
                 ~* '(IF|AND|OR|WHERE|WHEN)[^\n]*\mcurrent_user\M') = 0,
         'current_user resolves to the function OWNER inside SECURITY DEFINER (00179:341-346)'
    FROM fns
  UNION ALL
  SELECT 'snapshot_table_not_anon_readable',
         NOT has_table_privilege('anon', 'projects.backup_work_item_mirrors_source_assignees', 'SELECT'),
         '00025:26 makes every new projects table anon-readable at the grant layer; this one holds every RFI and snag assignee'
  UNION ALL
  SELECT 'snapshot_table_has_rls',
         (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname='projects' AND c.relname='backup_work_item_mirrors_source_assignees'),
         'RLS on with no policy: service-role only';
  ```
  ⚠ The snapshot table name here is the placeholder; Task 20 Step 4 renames it to `backup_<NNNNN>_source_assignees` per A(f)'s R52 convention and this probe is updated in the same commit.

- [ ] **Step 2: Run it and watch `anon_cannot_execute_any` fail,** naming every one of the twenty-four functions — because `ALTER DEFAULT PRIVILEGES` granted `anon` EXECUTE at creation and nothing has revoked it. This is the whole point of the task; read the list. (`snapshot_table_*` will fail too until section H exists — Task 14 adds it.)

- [ ] **Step 3: Append section G.**
  ```sql
  -- ─── G. Grants ───────────────────────────────────────────────────────────────
  -- REVOKE from PUBLIC does NOT remove anon's EXECUTE: Supabase's ALTER DEFAULT
  -- PRIVILEGES grants anon directly at creation, which is a separate grant.
  -- Precedent 00113:14-24. Verified with has_function_privilege, never proacl —
  -- a NULL proacl looks empty but IS the PUBLIC grant.
  --
  -- No GRANT follows. Measured (F5): a trigger fires for a caller with no EXECUTE
  -- on its function (privileges are checked at CREATE TRIGGER time), and every
  -- function below is reached only from a trigger or from another SECURITY
  -- DEFINER function owned by the same role. Granting EXECUTE would widen the
  -- surface for nothing.
  DO $grants$
  DECLARE r record;
  BEGIN
    FOR r IN
      SELECT n.nspname || '.' || p.proname || '(' ||
             pg_get_function_identity_arguments(p.oid) || ')' AS sig
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'projects'
         AND p.proname IN ('resolve_project_pm','resolve_work_item_assignee',
                           'resolve_work_item_gatekeeper','work_item_person_eligible',
                           'map_source_status','work_item_status_for_mirror',
                           'work_item_mirror_due_date','diary_delay_text',
                           'seed_work_item_watchers',
                           'project_rfi','project_snag','project_inspection',
                           'project_qc_entry','project_diary_action','project_form_action',
                           'mirror_rfi_work_item','mirror_snag_work_item',
                           'mirror_inspection_work_item','mirror_qc_defect_work_item',
                           'mirror_qc_report_defects','mirror_diary_action_work_item',
                           'mirror_form_action_work_item','work_item_assignment_writeback',
                           'void_work_item_on_source_delete')
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon',    r.sig);
    END LOOP;
  END $grants$;

  -- Assert the revoke actually took, in the same transaction that made it.
  -- The LIKE ANY pattern is deliberately BROADER than the explicit list above, so
  -- a function added to this migration later and forgotten in the DO block fails
  -- the apply rather than shipping open.
  DO $assert_grants$
  DECLARE v_leak text;
  BEGIN
    SELECT string_agg(n.nspname || '.' || p.proname, ', ') INTO v_leak
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'projects'
       AND p.proname LIKE ANY (ARRAY['mirror\_%','resolve\_%','project\_%','map\_source\_status',
                                     'work\_item\_%','void\_work\_item\_%','seed\_work\_item\_%',
                                     'diary\_delay\_text'])
       AND has_function_privilege('anon', p.oid, 'EXECUTE');
    IF v_leak IS NOT NULL THEN
      RAISE EXCEPTION 'anon retains EXECUTE on: %', v_leak;
    END IF;
  END $assert_grants$;
  ```

- [ ] **Step 4: Run the probe.** Expected: `5/7` — the five function assertions pass; both `snapshot_table_*` rows still fail because section H does not exist yet. That is expected and is closed in Task 14 Step 5.

- [ ] **Step 5: Mutation-verify.** Delete the `REVOKE ALL ON FUNCTION %s FROM anon` line, leaving only the PUBLIC revoke. Re-run. Expected — the `allocate_form_no` bug reproduced on demand:
  ```
  FAIL (HTTP 400)
  … ERROR: P0001: anon retains EXECUTE on: resolve_project_pm, resolve_work_item_assignee, …
  ```
  Restore. Then, separately, add a twenty-fifth function named `projects.work_item_scratch()` **without** adding it to the `DO $grants$` list, and confirm the broader `LIKE ANY` assertion catches it by name. Remove it.

- [ ] **Step 6: Mutation-verify the comment-stripping.** Add `-- current_user is never used for authorisation here` as a comment line inside the body of `projects.resolve_project_pm` and re-run: `no_current_user_authorisation` must still **PASS**. Then add `IF current_user = 'postgres' THEN RETURN NULL; END IF;` as real code and re-run: it must **FAIL**. Remove both. This is the difference between testing the string and testing the use.

- [ ] **Step 7: Commit.**
  ```bash
  git add apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql \
          scripts/db/probes/12-grants.sql
  git commit -m "feat(work-items): revoke EXECUTE from PUBLIC and anon on all twenty-four functions

Trigger functions fire without EXECUTE (checked at CREATE TRIGGER time), so
nothing is granted. Asserted with has_function_privilege inside the migration,
under a pattern broader than the explicit list so a forgotten function fails
the apply rather than shipping open."
  ```

---

## Task 14 — The backfill and the completion event (F4, improvements 1, 2, 3, 9)

**What the backfill takes**, all counts re-measured against production on 2026-09-10 **after** improvements 1 and 2:

| Source | Rows | Predicate |
|---|---|---|
| `projects.rfis` | **15** | all of them; `assigned_to` is NULL on **all 15**, so all fifteen resolve through the chain |
| `inspections.inspections` | **18** | all of them, all on WM-Consulting; every one is at `status='assigned'` with both `assigned_to_id` and `verifier_id` set |
| `field.snags` | **0** | **improvement 2.** All six live snags are seeded demo rows in the `E-Site DEMO` org — identical `created_at`, one demo contractor as raiser, a project whose creator resolves to `contractor`. The snag spine goes live **empty**; the live trigger is unaffected |
| `projects.site_diary_entries` | **0** | **improvement 1.** All 6 of 6 entries a non-empty test would project say "None". The arm is omitted entirely rather than filtered, because nothing historical qualifies and a filter that selects zero rows invites someone to "fix" it |
| `projects.qc_entries` | **0** | `conformance='fail'` on an issued/closed report. **There are no such rows** (F4). All 11 entries on the one issued report carry `conformance='na'` |
| `field.site_forms` | **1** | the single live form, on `(649) PNP FAERIE GLEN` |
| `structure.node_orders` | **0** | **440 rows, deliberately none.** No trigger, no bulk backfill, no automatic path |

**34 work items.** §12 §(d) estimated "roughly 50"; that estimate assumed 11 QC defects that do not exist, six snags that are demo fixtures and six diary delays that say "None".

⚠ **Three arms will insert zero rows and every assertion about them will pass vacuously.** Steps 6 and 7 build synthetic fixtures for the QC and snag arms so they can actually fail. **Do not** read a zero as "this source does not need mirroring" — twice already a zero has measured a module's *age* (the `field.form_responses` newline count, the `client_viewer` divergence).

**`go_live` is a literal**, `DATE '2026-11-03'` (§03 §1.10), set at merge. The floor for backfilled **open** items is `go_live + 5 office working days = DATE '2026-11-10'` (Wed 4, Thu 5, Fri 6, Mon 9, Tue 10; no SA public holiday falls in that window — check `listHolidays(2026)` again at merge if the date moves). Both are plain literals with the derivation written out; **no `working_days_between` call, because A(h) ships no add-working-days form and inventing one here would be a second calendar**. Closed and void items are **not** floored (improvement 9): moving a July record's deadline into November puts finished work into My Work's date bands.

**The completion event is part of this migration** (A(f) ordinal 9). §12 §(d): *"The first recap after go-live carries only items whose events post-date the backfill timestamp, recorded as `product_events.properties->>'backfill_completed_at'`."* Without it, item 4's 07:00 recap on day one lists all 34 backfilled items — exactly what the suppression GUC exists to avoid. `public.product_events.organisation_id` is `NOT NULL` (§12 §(i)), so one row is written **per organisation touched**, each carrying the same timestamp — which is also more correct, since each org's recap reads its own.

**Files:**
- Modify: the migration — add sections H and I
- Test: `scripts/db/probes/13-backfill.sql`

- [ ] **Step 1: Write the probe first, with the counts from the measurement above.** Create `scripts/db/probes/13-backfill.sql`. Note the `_probe_%` exclusion on every count: this file is concatenated into Task 17's full rehearsal, where other probes' fixtures exist in the same transaction and would otherwise inflate every number.
  ```sql
  -- Counts are over the LIVE estate only. Probe fixtures from other files in the
  -- same transaction are excluded by project name, or the full rehearsal in
  -- Task 17 would fail here for a reason that has nothing to do with the backfill.
  WITH live AS (
    SELECT w.* FROM projects.work_items w
      JOIN projects.projects p ON p.id = w.project_id
     WHERE p.name NOT LIKE '\_probe\_%'
  )
  SELECT 'rfi_count' AS probe, count(*) = 15 AS ok, 'got ' || count(*) || ' of 15' AS detail
    FROM live WHERE item_type = 'rfi' AND origin = 'mirror'
  UNION ALL
  SELECT 'inspection_count', count(*) = 18, 'got ' || count(*) || ' of 18'
    FROM live WHERE item_type = 'inspection' AND origin = 'mirror'
  UNION ALL
  SELECT 'form_count', count(*) = 1, 'got ' || count(*) || ' of 1'
    FROM live WHERE item_type = 'form_action' AND origin = 'mirror'
  UNION ALL
  SELECT 'snag_count_is_zero', count(*) = 0,
         'improvement 2: all 6 live snags are E-Site DEMO fixtures; got ' || count(*)
    FROM live WHERE item_type = 'snag' AND origin = 'mirror'
  UNION ALL
  SELECT 'diary_count_is_zero', count(*) = 0,
         'improvement 1: all 6 of 6 live "delays" say None; got ' || count(*)
    FROM live WHERE item_type = 'diary_action' AND origin = 'mirror'
  UNION ALL
  SELECT 'qc_count_is_zero', count(*) = 0,
         'F4: zero conformance=fail rows exist; this arm is exercised by the synthetic fixture in Step 6'
    FROM live WHERE item_type = 'qc_defect' AND origin = 'mirror'
  UNION ALL
  SELECT 'no_order_followup_anywhere', count(*) = 0,
         '440 node_orders rows, deliberately zero items'
    FROM projects.work_items WHERE item_type = 'order_followup'
  UNION ALL
  SELECT 'total_live_items', count(*) = 34, 'got ' || count(*) || ' of 34 expected'
    FROM live WHERE origin = 'mirror'
  UNION ALL
  SELECT 'nothing_from_the_demo_org', count(*) = 0,
         'improvement 2: no live item may belong to E-Site DEMO'
    FROM projects.work_items w JOIN projects.projects p ON p.id = w.project_id
   WHERE p.organisation_id = 'e51ede00-0000-0000-0000-000000000001' AND w.origin = 'mirror'
  UNION ALL
  -- Improvement 9.
  SELECT 'writeback_skipped_closed_rfis',
         (SELECT count(*) FROM projects.rfis WHERE assigned_to IS NULL) = 6,
         'before: 15 NULL. after: 6 — exactly the 6 closed RFIs, which must not acquire an assignee'
  UNION ALL
  SELECT 'writeback_filled_open_rfis',
         (SELECT count(*) FROM projects.rfis WHERE status <> 'closed' AND assigned_to IS NULL) = 0,
         'all 9 non-closed RFIs now render an assignee on rfis/[id]/page.tsx:271-272'
  UNION ALL
  SELECT 'snag_assignees_untouched',
         (SELECT count(*) FROM field.snags WHERE assigned_to IS NULL) = 6,
         'no snag was backfilled, so no snag acquired an assignee'
  UNION ALL
  SELECT 'due_dates_floored',
         count(*) = 0,
         'no OPEN backfilled item may be due before go_live + 5 office working days (2026-11-10)'
    FROM live
   WHERE origin = 'mirror' AND status IN ('triage','open','answered')
     AND due_date < DATE '2026-11-10'
  UNION ALL
  SELECT 'closed_items_not_refloored',
         count(*) = 0, 'a July record must not acquire a November deadline'
    FROM live
   WHERE origin = 'mirror' AND status IN ('closed','void') AND due_date = DATE '2026-11-10'
  UNION ALL
  SELECT 'every_open_item_has_a_holder',
         count(*) = 0, 'ball_in_court is NOT NULL on every non-terminal item'
    FROM live
   WHERE origin = 'mirror' AND status IN ('triage','open','answered') AND ball_in_court_id IS NULL
  UNION ALL
  SELECT 'events_written_but_no_bells',
         (SELECT count(*) FROM projects.work_item_events) > 0
     AND (SELECT count(*) FROM public.notifications
           WHERE type IN ('work_item_assigned','ball_in_court_changed','work_item_overdue')) = 0,
         '§12 §(d): events are written for the metrics, notifications are suppressed'
  UNION ALL
  SELECT 'completion_event_written',
         (SELECT count(*) FROM public.product_events
           WHERE event = 'work_item_backfill_completed'
             AND properties ? 'backfill_completed_at') >= 1,
         '§12 §(d): without it, item 4''s first 07:00 recap lists all 34 backfilled items'
  UNION ALL
  -- Improvement 3: the distribution, not just the totals.
  SELECT 'at_least_three_distinct_holders',
         (SELECT count(DISTINCT ball_in_court_id) FROM live
           WHERE origin='mirror' AND ball_in_court_id IS NOT NULL) >= 3,
         'holders: ' || (SELECT string_agg(x.who || '=' || x.n, ', ' ORDER BY x.n DESC) FROM (
             SELECT COALESCE(pr.full_name,'?') AS who, count(*) AS n
               FROM live l LEFT JOIN public.profiles pr ON pr.id = l.ball_in_court_id
              WHERE l.origin='mirror' AND l.ball_in_court_id IS NOT NULL
              GROUP BY 1) x)
  UNION ALL
  SELECT 'no_holder_over_twenty',
         COALESCE((SELECT max(n) FROM (
             SELECT count(*) AS n FROM live
              WHERE origin='mirror' AND ball_in_court_id IS NOT NULL
              GROUP BY ball_in_court_id) y), 0) <= 20,
         '§15: an empty inbox cannot be driven to zero, and neither can a forty-item one'
  UNION ALL
  SELECT 'no_item_on_a_client_viewer',
         (SELECT count(*) FROM live l
           WHERE l.origin='mirror' AND l.ball_in_court_id IS NOT NULL
             AND public.user_effective_project_role(l.project_id, l.ball_in_court_id) = 'client_viewer') = 0,
         'improvement 7: a client viewer cannot clear an item until Q3';
  ```

- [ ] **Step 2: Run it and watch every count fail at 0.**
  ```bash
  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/13-backfill.sql \
    --with apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql
  ```
  Expected: `rfi_count`, `inspection_count`, `form_count`, `total_live_items`, `writeback_filled_open_rfis`, `at_least_three_distinct_holders` and `completion_event_written` all FAIL. `writeback_skipped_closed_rfis` FAILs too — it currently reads 15, not 6.

- [ ] **Step 3: Append sections H and I.**
  ```sql
  -- ─── H. Pre-migration snapshot, then the backfill ────────────────────────────
  -- R52 (A(f)): every migration that overwrites a column takes a snapshot into a
  -- timestamped backup_<version>_<object> table in the same transaction, with the
  -- restore statement named in the header. updated_at is included because the
  -- write-back fires rfis_updated_at (00002:100) and snags_updated_at (00004:33)
  -- on the rows it touches.
  CREATE TABLE IF NOT EXISTS projects.backup_work_item_mirrors_source_assignees AS
    SELECT 'rfi'::text AS kind, id, assigned_to, due_date, updated_at
      FROM projects.rfis
    UNION ALL
    SELECT 'snag', id, assigned_to, NULL::date, updated_at
      FROM field.snags;

  -- 00025_grant_schema_permissions.sql:26 sets ALTER DEFAULT PRIVILEGES … GRANT
  -- SELECT ON TABLES TO anon for the whole projects schema, so this table is born
  -- anon-readable and it holds the assignee of every RFI and snag on the platform.
  REVOKE SELECT ON projects.backup_work_item_mirrors_source_assignees FROM anon;
  ALTER TABLE projects.backup_work_item_mirrors_source_assignees ENABLE ROW LEVEL SECURITY;
  -- No policy, deliberately: RLS with no policy is deny-all for every role except
  -- the table owner and service_role. Nothing in the app reads this table.

  -- ⚠ Notification suppression. Every insert below fires item 2's transition
  -- trigger, which emits work_item_assigned; the overdue sweep would immediately
  -- classify the July-dated RFIs as overdue. Against an estate where 964
  -- notifications have produced 57 reads and no contractor has signed in for 30
  -- days, ~34 assignment bells plus overdue bells plus a 07:00 recap listing 34
  -- stale items is the exact failure this programme exists to reverse.
  -- work_item_events rows are STILL written — the metrics need them.
  SET LOCAL esite.suppress_notifications = 'on';

  DO $backfill$
  DECLARE
    v_go_live  CONSTANT date := DATE '2026-11-03';   -- Tuesday; set at merge (Task 20 Step 4)
    v_floor    CONSTANT date := DATE '2026-11-10';   -- go_live + 5 office working days
    v_demo     CONSTANT uuid := 'e51ede00-0000-0000-0000-000000000001';  -- E-Site DEMO
    v_n int;
  BEGIN
    -- 1. RFIs — all 15. Projected DIRECTLY through projects.project_rfi(), never by
    --    touching the source row: every source table carries a BEFORE UPDATE
    --    set_updated_at trigger, and with the F7 WHEN predicates in place a no-op
    --    UPDATE would fire nothing anyway.
    PERFORM projects.project_rfi(r.id)
       FROM projects.rfis r
       JOIN projects.projects p ON p.id = r.project_id
      WHERE p.organisation_id <> v_demo;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE NOTICE 'backfill: projected % rfis (15 expected)', v_n;

    -- 2. Inspections — all 18. No profiles guard here: projects.project_inspection()
    --    already handles an auth user with no profiles row via
    --    work_item_person_eligible, and a second WHERE EXISTS would SKIP a row the
    --    projection would have handled correctly, turning a data question into a
    --    count mismatch. Measured: 0 such rows exist today.
    PERFORM projects.project_inspection(i.id)
       FROM inspections.inspections i
       JOIN projects.projects p ON p.id = i.project_id
      WHERE p.organisation_id <> v_demo;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE NOTICE 'backfill: projected % inspections (18 expected)', v_n;

    -- 3. Snags — improvement 2. All six live rows are seeded E-Site DEMO fixtures
    --    (identical created_at, one demo contractor as raiser, a project whose
    --    creator resolves to contractor and would therefore be his own gatekeeper).
    --    Backfilling them manufactures defects no real person owes and pollutes
    --    metric 2a's contractor numerator with a fixture account. The snag spine
    --    goes live EMPTY; the live trigger is unaffected. The predicate is written
    --    out rather than the arm deleted, so the intent survives the demo data.
    PERFORM projects.project_snag(s.id)
       FROM field.snags s
       JOIN projects.projects p ON p.id = s.project_id
      WHERE p.organisation_id <> v_demo AND p.status = 'active';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE NOTICE 'backfill: projected % snags (0 expected — all 6 live rows are demo)', v_n;

    -- 4. QC defects — failed entries on issued/closed reports only.
    --    Expected to project ZERO rows today: all 11 live entries are
    --    conformance='na' (F4). That is not a reason to widen the predicate.
    PERFORM projects.project_qc_entry(e.id)
       FROM projects.qc_entries e
       JOIN projects.qc_reports r ON r.id = e.report_id
       JOIN projects.projects p ON p.id = e.project_id
      WHERE e.conformance = 'fail' AND r.status IN ('issued','closed')
        AND p.organisation_id <> v_demo;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE NOTICE 'backfill: projected % qc defects (0 expected on 2026-09-10 data)', v_n;

    -- 5. Diary — NO ARM. Improvement 1. All 6 of 6 entries a non-empty test would
    --    have projected are negations ("None," ×2, "None" ×2, "NO", and "No delays
    --    or info required was noted in the site walk and or meeting"). Zero of the
    --    six is a delay, so there is nothing historical to project. Entries written
    --    from go-live onward are projected by the live trigger, which carries the
    --    same stop-list. A filtered arm that selects zero rows is omitted rather
    --    than written, because a zero-row filter invites someone to "fix" it.

    -- 6. Site forms — the single live row.
    PERFORM projects.project_form_action(f.id)
       FROM field.site_forms f
       JOIN projects.projects p ON p.id = f.project_id
      WHERE p.organisation_id <> v_demo;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE NOTICE 'backfill: projected % site forms (1 expected)', v_n;

    -- 7. structure.node_orders: NOTHING. 440 rows, no trigger, no backfill.
    --    A(b): order_followup is created only by the explicit chase control on an
    --    order line. Projecting 440 procurement rows into an inbox that is read
    --    6% of the time is the fastest way to prove the new inbox is also noise.

    -- 8. Floor every backfilled OPEN due date. An item months overdue on day one is
    --    a red inbox nobody opens (§03 §1.10). Closed and void items are NOT
    --    floored (improvement 9): giving a July record a November deadline sorts
    --    finished work into My Work's date bands.
    UPDATE projects.work_items
       SET due_date = v_floor
     WHERE origin = 'mirror'
       AND status IN ('triage','open','answered')
       AND due_date < v_floor;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE NOTICE 'backfill: floored % open due dates to %', v_n, v_floor;
  END $backfill$;

  -- ─── I. The completion event ─────────────────────────────────────────────────
  -- A(f) ordinal 9, and §12 §(d): "The first recap after go-live carries only
  -- items whose events post-date the backfill timestamp, recorded as
  -- product_events.properties->>'backfill_completed_at'". Without this row, item
  -- 4's 07:00 recap on day one lists all 34 backfilled items — the exact failure
  -- the suppression GUC above exists to avoid.
  -- public.product_events.organisation_id is NOT NULL (§12 §(i)), so one row is
  -- written per organisation touched, each carrying the same timestamp. That is
  -- also the more correct shape: each org's recap reads its own row.
  INSERT INTO public.product_events (organisation_id, project_id, actor_id, event, properties)
  SELECT o.organisation_id, NULL, NULL, 'work_item_backfill_completed',
         jsonb_build_object(
           'backfill_completed_at', now(),
           'items', o.n,
           'migration', 'work_item_source_mirrors_and_backfill')
    FROM (SELECT p.organisation_id, count(*) AS n
            FROM projects.work_items w JOIN projects.projects p ON p.id = w.project_id
           WHERE w.origin = 'mirror'
           GROUP BY p.organisation_id) o;

  -- Post-conditions, asserted in the same transaction that made them.
  DO $postcheck$
  DECLARE v_total int; v_orders int; v_stranded int;
  BEGIN
    SELECT count(*) INTO v_total FROM projects.work_items WHERE origin = 'mirror';
    IF v_total = 0 THEN
      RAISE EXCEPTION 'the backfill projected nothing at all';
    END IF;

    SELECT count(*) INTO v_orders FROM projects.work_items WHERE item_type = 'order_followup';
    IF v_orders > 0 THEN
      RAISE EXCEPTION 'order_followup items exist (%) — A(b) forbids an automatic path', v_orders;
    END IF;

    SELECT count(*) INTO v_stranded
      FROM projects.work_items w
     WHERE w.origin = 'mirror' AND w.status IN ('triage','open','answered')
       AND public.user_effective_project_role(w.project_id, w.ball_in_court_id) = 'client_viewer';
    IF v_stranded > 0 THEN
      RAISE EXCEPTION '% items land on a client viewer, who cannot clear them until Q3', v_stranded;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.product_events
                    WHERE event = 'work_item_backfill_completed') THEN
      RAISE EXCEPTION 'no backfill-completion event was written (§12 §(d))';
    END IF;
  END $postcheck$;
  ```

- [ ] **Step 4: Run the probe and watch 20/20 pass.** Read the `assertions seen:` line and count the names — twenty. **If `total_live_items` differs from 34, stop and reconcile before Task 17**: a count that drifts between the plan and the rehearsal means the estate moved and every figure above needs re-measuring.

- [ ] **Step 5: Confirm Task 13's two deferred assertions now pass.**
  ```bash
  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/12-grants.sql \
    --with apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql
  ```
  Expected: `7/7`, with `snapshot_table_not_anon_readable` and `snapshot_table_has_rls` both PASS. Then delete the `REVOKE SELECT … FROM anon` line, re-run, and confirm `FAIL snapshot_table_not_anon_readable  00025:26 makes every new projects table anon-readable at the grant layer; this one holds every RFI and snag assignee`. Restore.

- [ ] **Step 6: Make the QC arm non-vacuous with a synthetic fixture (F4).** Prepend to `13-backfill.sql`, before the assertion `SELECT`:
  ```sql
  -- Synthetic QC fixture. Live data has zero conformance='fail' rows, so without
  -- this the qc_defect arm passes vacuously — "what would this fixture have to
  -- look like for the test to be able to fail?"
  DO $qcfix$
  DECLARE
    v_org uuid := 'dddddddd-0000-0000-0000-000000000001';
    v_pm uuid; v_proj uuid; v_rep uuid;
  BEGIN
    SELECT u.user_id INTO v_pm FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active LIMIT 1;
    INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
    VALUES (v_org, '_probe_qc_backfill', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj;
    INSERT INTO projects.qc_reports (project_id, organisation_id, title, status, raised_by, issued_at)
    VALUES (v_proj, v_org, 'Synthetic issued report', 'issued', v_pm, now()) RETURNING id INTO v_rep;
    INSERT INTO projects.qc_entries (report_id, organisation_id, project_id, title,
                                     conformance, severity, created_by)
    SELECT v_rep, v_org, v_proj, 'Defect ' || g, 'fail',
           (ARRAY['minor','major','critical'])[1 + (g % 3)], v_pm
      FROM generate_series(1, 3) g;
    INSERT INTO projects.qc_entries (report_id, organisation_id, project_id, title,
                                     conformance, created_by)
    SELECT v_rep, v_org, v_proj, 'Passing check ' || g, 'pass', v_pm
      FROM generate_series(1, 40) g;
  END $qcfix$;
  ```
  and add these arms to the assertion `SELECT` (they read `projects.work_items` directly, not `live`, because the fixture project IS a `_probe_%` project):
  ```sql
  UNION ALL
  SELECT 'qc_fixture_projects_three',
         (SELECT count(*) FROM projects.work_items w JOIN projects.qc_entries e ON e.id = w.qc_entry_id
           WHERE e.conformance = 'fail') = 3,
         'three failures out of a 43-line report'
  UNION ALL
  SELECT 'qc_fixture_ignores_forty',
         (SELECT count(*) FROM projects.work_items w JOIN projects.qc_entries e ON e.id = w.qc_entry_id
           WHERE e.conformance = 'pass') = 0,
         'A(b): mirroring every issued entry would manufacture ~40 items from one report'
  UNION ALL
  SELECT 'qc_fixture_priority_spread',
         (SELECT count(DISTINCT w.priority) FROM projects.work_items w
            JOIN projects.qc_entries e ON e.id = w.qc_entry_id WHERE e.conformance = 'fail') = 3,
         'severity maps to three distinct priorities, never a flat medium'
  ```
  Run and watch 23/23. Then set every fixture entry's `severity` to NULL and re-run: `FAIL qc_fixture_priority_spread`. Restore.

- [ ] **Step 7: Make the snag arm non-vacuous.** Add a second fixture that creates a snag on a **non-demo** project, so the arm's `organisation_id <> v_demo` predicate is proved to *include* as well as exclude:
  ```sql
  DO $snagfix$
  DECLARE
    v_org uuid := 'dddddddd-0000-0000-0000-000000000001';
    v_pm uuid; v_proj uuid;
  BEGIN
    SELECT u.user_id INTO v_pm FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active LIMIT 1;
    INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
    VALUES (v_org, '_probe_snag_backfill', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj;
    INSERT INTO field.snags (project_id, organisation_id, title, location, priority, status, raised_by)
    VALUES (v_proj, v_org, 'Real-org snag', 'Level 1', 'medium', 'open', v_pm);
  END $snagfix$;
  ```
  and the assertion:
  ```sql
  UNION ALL
  SELECT 'snag_arm_includes_non_demo_orgs',
         (SELECT count(*) FROM projects.work_items w
            JOIN projects.projects p ON p.id = w.project_id
           WHERE p.name = '_probe_snag_backfill' AND w.item_type = 'snag') = 1,
         'the demo exclusion must exclude the demo org, not disable the snag arm'
  ```
  Run and watch 24/24. Then change the arm's predicate to `WHERE false` and re-run: `FAIL snag_arm_includes_non_demo_orgs`. Restore. **This is the assertion that stops improvement 2 being read as "snags are not mirrored".**

- [ ] **Step 8: Mutation-verify the demo exclusion itself.** Delete `AND p.organisation_id <> v_demo` from the snag arm and re-run. Expected:
  ```
  FAIL  snag_count_is_zero          improvement 2: all 6 live snags are E-Site DEMO fixtures; got 6
  FAIL  total_live_items            got 40 of 34 expected
  FAIL  nothing_from_the_demo_org   improvement 2: no live item may belong to E-Site DEMO
  ```
  Restore. Record 24/24 → 21/24 → 24/24.

- [ ] **Step 9: Mutation-verify the completion event.** Delete section I's `INSERT INTO public.product_events …`. Re-run. Expected:
  ```
  FAIL (HTTP 400)
  … ERROR: P0001: no backfill-completion event was written (§12 §(d))
  ```
  — the in-migration post-check catches it before the probe does, which is the right order. Restore.

- [ ] **Step 10: Commit.**
  ```bash
  git add apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql \
          scripts/db/probes/13-backfill.sql
  git commit -m "feat(work-items): backfill 34 items under suppression, then record the completion event

15 RFIs, 18 inspections, 1 site form. Zero snags (all six live rows are E-Site
DEMO fixtures), zero diary actions (all six live 'delays' say None), zero QC
defects (no conformance='fail' row exists) and none of the 440 node_orders.
Projection runs through projects.project_<source>() so no source row is touched
and no live updated_at is rewritten."
  ```

---

## Task 15 — Idempotency, and the 50,000-row rehearsal

"A backfill that passes on 50 rows proves nothing about 50,000" (§12 §(d)). Two properties: re-running creates no duplicates, and the projection does not degrade into a per-row round trip at scale.

⚠ **`projects.rfis.rfi_number` is `INTEGER GENERATED ALWAYS AS IDENTITY` (`00002:83`) and sequences are NOT transactional.** Rolling back does **not** return consumed values. A 50,000-row fixture therefore permanently advances production's RFI numbering by 50,000, and the next RFI a human raises displays a number around 50,016 — on the identifier §03 §1.2 rules "stays displayed alongside as the module's own identifier". Step 4 captures `last_value` before and restores it after, in separate committed statements, and records both readings in the PR body.

**Files:**
- Test: `scripts/db/probes/14-idempotency.sql`, `scripts/db/probes/15-scale.sql`

- [ ] **Step 1: Write the idempotency probe.** It applies the migration via `--with` (so section H has already run once), then re-runs every projection path twice more. Create `scripts/db/probes/14-idempotency.sql`:
  ```sql
  DO $rerun$
  DECLARE
    v_demo CONSTANT uuid := 'e51ede00-0000-0000-0000-000000000001';
    v_split uuid;
  BEGIN
    CREATE TEMP TABLE idem_before ON COMMIT DROP AS
      SELECT item_type, count(*) AS n FROM projects.work_items
       WHERE origin = 'mirror' GROUP BY 1;

    FOR i IN 1..2 LOOP
      PERFORM projects.project_rfi(r.id) FROM projects.rfis r
         JOIN projects.projects p ON p.id = r.project_id WHERE p.organisation_id <> v_demo;
      PERFORM projects.project_inspection(i2.id) FROM inspections.inspections i2
         JOIN projects.projects p ON p.id = i2.project_id WHERE p.organisation_id <> v_demo;
      PERFORM projects.project_snag(s.id) FROM field.snags s
         JOIN projects.projects p ON p.id = s.project_id
        WHERE p.organisation_id <> v_demo AND p.status = 'active';
      PERFORM projects.project_qc_entry(e.id) FROM projects.qc_entries e
         JOIN projects.qc_reports rp ON rp.id = e.report_id
        WHERE e.conformance = 'fail' AND rp.status IN ('issued','closed');
      PERFORM projects.project_form_action(f.id) FROM field.site_forms f
         JOIN projects.projects p ON p.id = f.project_id WHERE p.organisation_id <> v_demo;
    END LOOP;

    -- A deliberate split must survive a re-run untouched (§03 §1.2, §1.3): the
    -- partial UNIQUE excludes origin <> 'mirror'.
    INSERT INTO projects.work_items (organisation_id, project_id, item_type, origin, title,
      status, assignee_id, gatekeeper_id, due_date, created_by, rfi_id)
    SELECT w.organisation_id, w.project_id, 'rfi', 'split', w.title || ' (split)', 'open',
           w.assignee_id, w.gatekeeper_id, w.due_date, w.created_by, w.rfi_id
      FROM projects.work_items w WHERE w.item_type = 'rfi' AND w.origin = 'mirror' LIMIT 1
    RETURNING id INTO v_split;

    -- And a third projection AFTER the split exists, to prove the split is not
    -- picked up, overwritten or duplicated by it.
    PERFORM projects.project_rfi(r.id) FROM projects.rfis r
       JOIN projects.projects p ON p.id = r.project_id WHERE p.organisation_id <> v_demo;

    CREATE TEMP TABLE idem_ctx(split uuid) ON COMMIT DROP;
    INSERT INTO idem_ctx VALUES (v_split);
  END $rerun$;

  SELECT 'no_duplicates_after_three_runs' AS probe,
         NOT EXISTS (
           SELECT 1 FROM projects.work_items w
            JOIN idem_before b ON b.item_type = w.item_type
            WHERE w.origin = 'mirror'
            GROUP BY w.item_type, b.n HAVING count(*) <> b.n) AS ok,
         'the partial UNIQUE per source column is what makes projection idempotent' AS detail
  UNION ALL
  SELECT 'one_item_per_source_row',
         NOT EXISTS (
           SELECT 1 FROM projects.work_items WHERE origin = 'mirror'
            GROUP BY COALESCE(rfi_id, snag_id, qc_entry_id, inspection_id, diary_id, site_form_id)
           HAVING count(*) > 1),
         'no source row may carry two mirror items'
  UNION ALL
  SELECT 'split_row_survives',
         (SELECT count(*) FROM projects.work_items w, idem_ctx c
           WHERE w.id = c.split AND w.origin = 'split') = 1,
         'the partial index excludes origin<>mirror, so a split is legal and never re-projected'
  UNION ALL
  SELECT 'split_title_untouched',
         (SELECT w.title LIKE '% (split)' FROM projects.work_items w, idem_ctx c WHERE w.id = c.split),
         'a re-projection must not overwrite a split row''s own title';
  ```

- [ ] **Step 2: Run it and watch 4/4.**
  ```bash
  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/14-idempotency.sql \
    --with apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql
  ```

- [ ] **Step 3: Prove idempotency can fail, and record the REAL index name.** First, find it — A(a) specifies "one partial `UNIQUE` per source column" but fixes no name, so read item 2's out of the tree rather than inventing one:
  ```bash
  cat > /tmp/idxname.sql <<'SQL'
  SELECT 'rfi_partial_unique' AS probe, count(*) = 1 AS ok,
         COALESCE(string_agg(indexname, ', '), 'none') AS detail
    FROM pg_indexes
   WHERE schemaname = 'projects' AND tablename = 'work_items'
     AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%rfi_id%' AND indexdef ILIKE '%mirror%';
  SQL
  pnpm tsx scripts/db/rehearse-sql.ts /tmp/idxname.sql
  ```
  **Write the name it prints into the PR body.** Then delete the whole `ON CONFLICT (rfi_id) WHERE …` clause from `project_rfi` and re-run the idempotency probe. Expected:
  ```
  FAIL (HTTP 400)
  … ERROR: 23505: duplicate key value violates unique constraint "<the name you just read>"
  ```
  This is the *good* failure — the index is the guarantee and `ON CONFLICT` only makes a retry quiet. Restore.

- [ ] **Step 4: Write the scale rehearsal, with the sequence restore.** Create `scripts/db/probes/15-scale.sql`:
  ```sql
  -- 50,000 synthetic RFIs on one throwaway project, projected through the real
  -- trigger. Times the projection and asserts the shape holds.
  --
  -- ⚠ projects.rfis.rfi_number is GENERATED ALWAYS AS IDENTITY (00002:83) and a
  -- ROLLBACK does NOT return consumed sequence values. Task 15 Step 5 reads
  -- last_value before this runs and setval()s it back afterwards, OUTSIDE the
  -- rolled-back transaction. Do not run this probe without those two steps.
  DO $scale$
  DECLARE
    v_org uuid := 'dddddddd-0000-0000-0000-000000000001';
    v_pm uuid; v_proj uuid; v_t0 timestamptz; v_ms numeric;
  BEGIN
    SELECT u.user_id INTO v_pm FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active LIMIT 1;
    INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
    VALUES (v_org, '_probe_scale', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj;

    v_t0 := clock_timestamp();
    INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                               priority, status, raised_by)
    SELECT v_proj, v_org, 'Scale RFI ' || g, 'body', 'medium', 'open', v_pm
      FROM generate_series(1, 50000) g;
    v_ms := extract(epoch FROM clock_timestamp() - v_t0) * 1000;

    CREATE TEMP TABLE scale_ctx(proj uuid, ms numeric) ON COMMIT DROP;
    INSERT INTO scale_ctx VALUES (v_proj, v_ms);
  END $scale$;

  SELECT 'fifty_thousand_projected' AS probe,
         (SELECT count(*) FROM projects.work_items w, scale_ctx c
           WHERE w.project_id = c.proj AND w.origin = 'mirror') = 50000 AS ok,
         'one item per RFI at scale' AS detail
  UNION ALL
  SELECT 'refs_are_unique',
         (SELECT count(DISTINCT ref) FROM projects.work_items w, scale_ctx c
           WHERE w.project_id = c.proj) = 50000,
         'the MAX+1 ref allocator must not collide under a 50k single-statement insert'
  UNION ALL
  SELECT 'writeback_reached_every_row',
         (SELECT count(*) FROM projects.rfis r, scale_ctx c
           WHERE r.project_id = c.proj AND r.assigned_to IS NULL) = 0,
         'the write-back is per-row; if it degrades, it degrades here'
  UNION ALL
  SELECT 'completed_under_five_minutes',
         (SELECT ms FROM scale_ctx) < 300000,
         'took ' || (SELECT round(ms) FROM scale_ctx) || ' ms';
  ```

- [ ] **Step 5: Capture the sequence, run the scale probe, restore the sequence.** Three commands, in this order, and **do not skip the third**:
  ```bash
  # 1. BEFORE — record this number in the PR body.
  cat > /tmp/seq-before.sql <<'SQL'
  SELECT 'rfi_seq' AS probe, true AS ok, last_value::text AS detail
    FROM projects.rfis_rfi_number_seq;
  SQL
  pnpm tsx scripts/db/rehearse-sql.ts /tmp/seq-before.sql     # e.g. detail = 16

  # 2. The scale run. Holds locks on projects.rfis and projects.work_items for its
  #    duration — run it outside working hours.
  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/15-scale.sql \
    --with apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql

  # 3. AFTER + restore. setval is a committed write; the harness refuses COMMIT, so
  #    this one goes through the Management API directly.
  cat > /tmp/seq-restore.mjs <<'JS'
  const PAT = process.env.SUPABASE_PAT
  const before = process.argv[2]            // the number from step 1
  const q = async (sql) => {
    const r = await fetch('https://api.supabase.com/v1/projects/cbskbnvvgcybmfikxgky/database/query', {
      method: 'POST',
      headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    })
    if (!r.ok) { console.error(await r.text()); process.exit(1) }
    return r.json()
  }
  console.log('after  :', await q('SELECT last_value FROM projects.rfis_rfi_number_seq'))
  console.log('setval :', await q(`SELECT setval('projects.rfis_rfi_number_seq', ${before}, true)`))
  console.log('final  :', await q('SELECT last_value FROM projects.rfis_rfi_number_seq'))
  JS
  node /tmp/seq-restore.mjs 16
  ```
  Expected: `after` ≈ 50016, `final` = the number from step 1. **Put all three readings in the PR body.** If `final` does not match, the next RFI a human raises will display a five-digit number.

- [ ] **Step 6: Read `refs_are_unique` first and act on what it says.** Item 2's `ref` allocator reads `MAX(...) + 1`, which is the assertion most likely to fail here. **If it fails, that is item 2's defect, not this plan's — report it against item 2 and stop, rather than working around it in the mirror.** Record the measured timing and `refs_are_unique`'s result explicitly whichever way it went.

- [ ] **Step 7: Commit.**
  ```bash
  git add scripts/db/probes/14-idempotency.sql scripts/db/probes/15-scale.sql
  git commit -m "test(work-items): idempotency across three projection runs and a 50k-row scale rehearsal

The scale probe consumes 50,000 identity values that a rollback does not return,
so the runbook captures and restores projects.rfis_rfi_number_seq around it."
  ```

---

## Task 16 — The one probe that runs as a real user (F9)

**Every other probe in this plan is authorisation-blind.** Measured on production 2026-09-10:

```
current_user = postgres   rolbypassrls = true   auth.uid() = <null>
```

The Management API `/database/query` endpoint runs with RLS bypassed and no identity. So no probe above can fail on an authorisation defect — including the single most important one the whole design turns on: **the mirror is `SECURITY DEFINER` so that a contractor's legitimate RFI insert is not rejected by item 2's RESTRICTIVE INSERT policy on `work_items`** (§03 §1.2, quoted in section D). Apply the fixture-quality rule and it is stark: *remove `SECURITY DEFINER` from every function in this migration and every probe so far still passes.*

This task adds the probe that can see the difference, using the house pattern from PRs #157 and #162: inside the rolled-back transaction, become `authenticated` with a real JWT claim, act, then return to `postgres` before asserting.

The identity is the permanent production fixture `rbac-test@e-site.live` (`018f2d31-bbe8-4cc1-bbdd-63af0187081e`, `contractor` on WM-Consulting — verified 2026-09-10). It is not a real user; **never invite it, email it, or send it a notification.**

**Files:**
- Test: `scripts/db/probes/16-as-a-real-user.sql`

- [ ] **Step 1: Write the probe.** Create `scripts/db/probes/16-as-a-real-user.sql`:
  ```sql
  DO $setup$
  DECLARE
    v_org  uuid := 'dddddddd-0000-0000-0000-000000000001';
    v_ctr  uuid := '018f2d31-bbe8-4cc1-bbdd-63af0187081e';  -- rbac-test, contractor
    v_pm   uuid;
    v_proj uuid;
  BEGIN
    SELECT u.user_id INTO v_pm FROM public.user_organisations u
     WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active LIMIT 1;

    INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
    VALUES (v_org, '_probe_rls_identity', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj;

    -- Give the contractor real access to this project, the way a PM would.
    INSERT INTO projects.project_members (project_id, user_id, role, is_active)
    VALUES (v_proj, v_ctr, 'contractor', true);

    CREATE TEMP TABLE rls_ctx(proj uuid, ctr uuid, rfi uuid) ON COMMIT DROP;
    INSERT INTO rls_ctx VALUES (v_proj, v_ctr, NULL);
  END $setup$;

  DO $asuser$
  DECLARE
    v_proj uuid; v_ctr uuid; v_org uuid := 'dddddddd-0000-0000-0000-000000000001';
    v_rfi uuid;
  BEGIN
    SELECT proj, ctr INTO v_proj, v_ctr FROM rls_ctx;

    -- Become a real, non-privileged user. postgres holds rolbypassrls, so without
    -- these two lines every RLS policy in the database is inert for this probe.
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_ctr::text, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';

    -- The ordinary act: a contractor raises an RFI on a project they belong to.
    -- The mirror then INSERTs into projects.work_items, which item 2 gates with a
    -- RESTRICTIVE INSERT policy that refuses every mirrored type. It only works
    -- because the mirror is SECURITY DEFINER.
    INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                               priority, status, raised_by)
    VALUES (v_proj, v_org, 'RFI raised as a contractor', 'body', 'medium', 'open', v_ctr)
    RETURNING id INTO v_rfi;

    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);

    UPDATE rls_ctx SET rfi = v_rfi;
  END $asuser$;

  SELECT 'contractor_insert_succeeded' AS probe,
         (SELECT rfi IS NOT NULL FROM rls_ctx) AS ok,
         'F9: as authenticated, not postgres — the whole point of SECURITY DEFINER on the mirror' AS detail
  UNION ALL
  SELECT 'item_was_projected',
         (SELECT count(*) FROM projects.work_items w, rls_ctx c
           WHERE w.rfi_id = c.rfi AND w.origin = 'mirror') = 1,
         'the projection ran under the contractor''s identity and still wrote work_items'
  UNION ALL
  SELECT 'holder_is_not_the_contractor',
         (SELECT w.assignee_id <> c.ctr FROM projects.work_items w, rls_ctx c WHERE w.rfi_id = c.rfi),
         'the resolved holder is a value the contractor could not have written themselves'
  UNION ALL
  SELECT 'gatekeeper_is_the_contractor',
         (SELECT w.gatekeeper_id = c.ctr FROM projects.work_items w, rls_ctx c WHERE w.rfi_id = c.rfi),
         'improvement 4: the raiser is the gatekeeper, and here the raiser is a contractor'
  UNION ALL
  SELECT 'writeback_reached_the_source',
         (SELECT r.assigned_to IS NOT NULL FROM projects.rfis r, rls_ctx c WHERE r.id = c.rfi),
         'the write-back is SECURITY DEFINER too and bypasses the RLS on projects.rfis'
  UNION ALL
  SELECT 'ran_as_postgres_when_asserting',
         current_user = 'postgres' AND auth.uid() IS NULL,
         'RESET ROLE actually took, so the assertions above are not themselves role-scoped';
  ```

- [ ] **Step 2: Run it and watch 6/6 pass.**
  ```bash
  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/16-as-a-real-user.sql \
    --with apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql
  ```

- [ ] **Step 3: Mutation-verify F9 — this is the acceptance step, and it is the only place `SECURITY DEFINER` is actually tested.** Remove `SECURITY DEFINER` from `projects.project_rfi` (making it `SECURITY INVOKER`, the default). Re-run. Expected:
  ```
  FAIL (HTTP 400)
  … ERROR: 42501: new row violates row-level security policy for table "work_items"
  ```
  — the contractor's perfectly legitimate RFI insert is refused. **Now re-run every other probe (04, 05, 06, 07) with that same mutation in place and confirm they all still pass 100%.** That contrast is the finding: without this task, `SECURITY DEFINER` is untested. Record both halves in the PR body. Restore.

- [ ] **Step 4: Mutation-verify the identity switch itself.** Comment out the `EXECUTE 'SET LOCAL ROLE authenticated'` line and re-run: `ran_as_postgres_when_asserting` still passes and everything else still passes — because the probe silently degraded to running as `postgres` again. **That is the failure mode this task exists to expose**, so add the guard that makes it visible: move `SELECT current_user` into the `$asuser$` block and record it, then assert it:
  ```sql
  UNION ALL
  SELECT 'insert_really_ran_as_authenticated',
         (SELECT who = 'authenticated' FROM rls_ctx),
         'without this, a probe that silently fell back to postgres looks identical to one that worked'
  ```
  (add a `who text` column to `rls_ctx` and set it from `current_user` inside `$asuser$`, immediately after `SET LOCAL ROLE`). Re-run: 7/7. Comment out the `SET LOCAL ROLE` again: `FAIL insert_really_ran_as_authenticated`. Restore.

- [ ] **Step 5: Commit.**
  ```bash
  git add scripts/db/probes/16-as-a-real-user.sql
  git commit -m "test(work-items): one probe that runs as a real contractor, not as postgres

The Management API runs as postgres with rolbypassrls=true and auth.uid() NULL,
so every other probe is authorisation-blind: removing SECURITY DEFINER from the
mirrors leaves them all green. This one fails with 42501."
  ```

---

## Task 17 — The rolled-back production rehearsal of the whole migration, and the day-one list

Everything above rehearsed one section. This runs the migration end to end against real production data, reads back the resulting counts **and the resulting distribution**, publishes the 34 items as a list a human can read, and rolls back — before a number is claimed, before anything merges.

⚠ **The Management API returns rows from the LAST row-producing statement only** (measured: `SELECT 1 AS a; SELECT 2 AS b;` → `[{"b":2}]`). So the full rehearsal is **not** a concatenation of ten probe files: that would discard nine of them silently and report the tenth's count as the total — the one test in the plan structurally incapable of failing. It is assembled as **all fixture `DO` blocks first, then ONE assertion `SELECT`.**

**Files:**
- Test: `scripts/db/probes/17-full-rehearsal.sql`, `scripts/db/probes/18-day-one-list.sql`

- [ ] **Step 1: Assemble the full rehearsal probe correctly.** Create `scripts/db/probes/17-full-rehearsal.sql` as:
  1. every `DO $…$ … END $…$;` block from probes **04, 05, 06, 07, 08, 09, 10, 11, 13 (both fixtures), 14 and 16**, in that order, verbatim — including their `CREATE TEMP TABLE … ON COMMIT DROP` context tables, whose names are already distinct per probe (`rfi_ctx`, `wb_ctx`, `sn_ctx`, `in_ctx`, `qc_ctx`, `d_ctx`, `f_ctx`, `del_ctx`, `idem_ctx`, `rls_ctx`);
  2. then **one** `SELECT … UNION ALL …` carrying every assertion arm from all of those files.

  Two mechanical checks before running it:
  ```bash
  # exactly one row-producing statement, and it is last
  grep -c "^SELECT '" scripts/db/probes/17-full-rehearsal.sql        # expect 1
  tail -1 scripts/db/probes/17-full-rehearsal.sql | grep -q ';' && echo "ends in the assertion"
  # no probe's DO block was dropped
  grep -c "END \$probe\$;\|END \$setup\$;\|END \$asuser\$;\|END \$rerun\$;\|END \$qcfix\$;\|END \$snagfix\$;" \
    scripts/db/probes/17-full-rehearsal.sql
  ```
  ⚠ Probe 13's counts already exclude `_probe_%` projects (Task 14 Step 1). Confirm that exclusion survived the assembly — without it, probe 04's RFI, probe 11's RFI/snag/diary and probe 06's snag all land in the live counts and `total_live_items` reads 40-odd instead of 34, failing for a reason that has nothing to do with the backfill.

- [ ] **Step 2: Capture a pre-state baseline, including the sequence.**
  ```bash
  cat > /tmp/baseline.sql <<'SQL'
  SELECT 'baseline' AS probe, true AS ok,
    'rfis_null='   || (SELECT count(*) FROM projects.rfis WHERE assigned_to IS NULL) ||
    ' snags_null=' || (SELECT count(*) FROM field.snags WHERE assigned_to IS NULL) ||
    ' work_items=' || (SELECT count(*) FROM projects.work_items) ||
    ' notifications=' || (SELECT count(*) FROM public.notifications) ||
    ' product_events=' || (SELECT count(*) FROM public.product_events) ||
    ' rfi_seq='    || (SELECT last_value FROM projects.rfis_rfi_number_seq) ||
    ' projects='   || (SELECT count(*) FROM projects.projects) AS detail;
  SQL
  pnpm tsx scripts/db/rehearse-sql.ts /tmp/baseline.sql
  ```
  Expected before anything is applied: `rfis_null=15 snags_null=6 work_items=0 notifications=964 rfi_seq=16 …` (or whatever the estate holds that day — **write it down**).

- [ ] **Step 3: Run the full rehearsal, and the four stateless probes beside it.**
  ```bash
  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/17-full-rehearsal.sql \
    --with apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql

  # 01, 02, 03 and 12 assert on pg_catalog and pure functions rather than on
  # fixtures, so they stay separate files and are run alongside, not merged in.
  for p in 01-preflight 02-resolvers 03-status-map 12-grants; do
    echo "── $p"
    pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/$p.sql \
      --with apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql
  done
  ```
  Expected from the rehearsal: every assertion PASS, and an `assertions seen:` line naming **every** probe from every merged file. **Count the names against the per-task totals:**

  | file | assertions |
  |---|---|
  | 04 rfi-mirror | 12 |
  | 05 writeback | 7 |
  | 06 snag-mirror | 10 |
  | 07 inspection-mirror | 9 |
  | 08 qc-mirror | 7 |
  | 09 diary-mirror (tautology deleted) | 6 |
  | 10 form-mirror | 5 |
  | 11 delete-to-void | 6 |
  | 13 backfill (incl. both synthetic fixtures) | 24 |
  | 14 idempotency | 4 |
  | 16 as-a-real-user (incl. Step 4's addition) | 7 |
  | **total** | **97** |

  If the list is shorter than 97, an arm was lost in the assembly — read the list, not the total. The four stateless probes add 5 + 8 + 24 + 7 = 44 more, run separately.

- [ ] **Step 4: Prove the assembly is not silently discarding assertions.** Deliberately break **one** arm in the middle of the file — change probe 06's `gatekeeper_is_pm_not_raiser` expectation to `= c.ctr` — and re-run. Expected: exactly that one row FAILs and the other 96 pass. If instead everything passes, the assembly is broken and the whole rehearsal is decorative. Restore.

- [ ] **Step 5: Prove the rehearsal left nothing.** Re-run Step 2's baseline. Expected: **identical** to Step 2's output **except `rfi_seq`**, which will have advanced by the number of RFIs the fixtures inserted (roughly 6). Sequences are not transactional; nothing else may have moved. If `work_items` is not back to 0, the harness's rollback did not fire — stop and investigate before doing anything else.

- [ ] **Step 6: Publish the day-one list — improvement 3.** A count is not a distribution, and the only property an inbox has is whose it is. Create `scripts/db/probes/18-day-one-list.sql`:
  ```sql
  -- Every backfilled item as one line, ordered the way §04 orders the Inbox.
  -- This is not an assertion file: it is the artefact that goes in the PR body and
  -- in front of the owner in Task 19, so a human can see the 34 items before they
  -- are irreversible. It still ends in the (probe, ok, detail) shape the harness
  -- requires, with the line itself in `detail`.
  SELECT 'item' AS probe, true AS ok,
         rpad(w.ref, 12) || ' ' ||
         rpad(left(p.name, 26), 27) || ' ' ||
         rpad(w.item_type, 13) || ' ' ||
         rpad(w.status, 9) || ' ' ||
         to_char(w.due_date, 'YYYY-MM-DD') || '  ' ||
         rpad(COALESCE(left(holder.full_name, 18), '—'), 19) || ' ' ||
         left(w.title, 60) AS detail
    FROM projects.work_items w
    JOIN projects.projects p ON p.id = w.project_id
    LEFT JOIN public.profiles holder ON holder.id = w.ball_in_court_id
   WHERE w.origin = 'mirror' AND p.name NOT LIKE '\_probe\_%'
   ORDER BY w.ball_in_court_id NULLS LAST, w.due_date, w.ref;
  ```

- [ ] **Step 7: Run it and read all 34 lines.**
  ```bash
  pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/18-day-one-list.sql \
    --with apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql \
    | tee /tmp/day-one-list.txt
  ```
  **Paste the whole output into the PR body.** Read it before you do anything else, and specifically look for:
  - **Duplicate titles.** Measured, the live RFI subjects include `Cable Schedule ` twice, `Inquiry for Mains 2.1 and Mains 3.1` twice, plus `Inquiry` and `Drawings` — four of the eight open RFIs are indistinguishable by title alone. That is why this listing carries `ref` and project name, and it is a **finding for item 4**: the Inbox row and the recap line must render ref + project + raiser alongside the title, or a user cannot tell two of their items apart. Raise it against item 4 in the PR body.
  - **Concentration.** Expect roughly: 8 open RFIs on the triage owner, 1 answered RFI on its raiser, 6 closed RFIs with no holder, 18 inspections split across three WM staff (measured today: 7 / 6 / 5), 1 site form on its author. Anything materially different means a resolver is behaving unexpectedly — reconcile before Task 19.

- [ ] **Step 8: Confirm no mail could have been sent by the migration itself.**
  ```bash
  grep -c "send-email\|net.http_post\|pg_net\|fetch(" \
    apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql
  ```
  Expected: `0`. The migration is pure SQL and issues no outbound call. **This is not the whole outbound-mail story** — §12 §(d) requires `suppress_all_outbound` on every project touched by a write-back, and that is Task 20 Step 5.

- [ ] **Step 9: Commit.**
  ```bash
  git add scripts/db/probes/17-full-rehearsal.sql scripts/db/probes/18-day-one-list.sql
  git commit -m "test(work-items): end-to-end rolled-back production rehearsal + the day-one item list

The rehearsal is one assertion SELECT after all the fixtures, not ten
concatenated probe files: the Management API returns rows from the last
row-producing statement only, so a concatenation discards nine of ten silently."
  ```

---

## Task 18 — Documentation: the matrix, CONFORMANCE, and six spec corrections

This item introduces **no route and no endpoint**, so `docs/rbac-matrix.md` gains no route row. It does change **effective write authority**, which is the thing the matrix exists to record: a work-item reassign or re-date now writes `projects.rfis.assigned_to`, `projects.rfis.due_date` and `field.snags.assigned_to` through a `SECURITY DEFINER` function with `row_security` off, so those tables' own RLS is bypassed on that path. That is an auth change, and `CONFORMANCE.md`'s own rule (STANDARD §4, quoted at the top of the file) says it moves in the same PR.

Appendix A(f)'s Q1 row must gain the twenty-four functions **and the snapshot table**, or §12 §(h) **test 8** fails the build: it parses every `-- table:`, `-- view:` and `-- function:` line out of the programme's migrations and diffs against A(f) in both directions. §12 §(h) **test 5** fails too if the `-- @verify:` block is incomplete for its own migration.

- [ ] **Step 1: Add the matrix subsection.** In `docs/rbac-matrix.md`, after `### Site forms (…)` (line ~389) and before `## Public / unauthenticated` (line ~411), insert:
  ```markdown
  ### Work-item source mirrors (database triggers, no route)

  | Path | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
  |---|---|---|---|---|---|---|---|
  | Reassign a mirrored work item ⇒ writes `projects.rfis.assigned_to` | W | W | W | —¹ | —¹ | —¹ | —¹ |
  | Re-date a mirrored work item ⇒ writes `projects.rfis.due_date`     | W | W | W | —¹ | —¹ | —¹ | —¹ |
  | Reassign a mirrored work item ⇒ writes `field.snags.assigned_to`   | W | W | W | —¹ | —¹ | —¹ | —¹ |
  | Raise an RFI / snag / inspection / QC defect / site form ⇒ creates a work item | W | W | W | W | W | W | — |

  > ¹ Not a gate in this migration. Who may change `work_items.assignee_id` or
  > `due_date` is item 2's `projects.user_can_write_work_item(project_id, item_type)`,
  > enforced by a RESTRICTIVE UPDATE policy; this row records only where that
  > authority *lands*. **The write-back function is `SECURITY DEFINER … SET
  > row_security TO 'off'`, so it bypasses the RLS on `projects.rfis` and
  > `field.snags`.** That is deliberate: the mirror resolves an assignee the raiser
  > could not have written themselves (the triage owner, the project PM), and the
  > two source columns must agree with the spine or every existing reader and PDF
  > shows something different from the Inbox. The authority check happens once, on
  > the `work_items` UPDATE. The write-back **skips `closed` and `void` records**,
  > so a historical row never acquires an assignee nobody set.
  >
  > **`structure.node_orders` has no projection trigger and no row here.**
  > `order_followup` is created only by the explicit chase control on an order line
  > (Appendix A(b)) — which no Q1 deliverable builds, so that type produces nothing
  > this quarter. A contract test fails the build if any trigger in the mirror
  > migration names that table: 440 live procurement rows projected into inboxes is
  > the backfill poisoning the roadmap names as a risk.
  >
  > **`inspections.inspections.assigned_to_id` is read but never written back.**
  > `00066`'s own assignment flow stays the system of record for that column; the
  > spine follows it forward so the Inbox does not name a previous assignee forever.
  >
  > **`client_viewer` is excluded from every assignee/gatekeeper resolution step**
  > until their write set lands in Q3 (§03 §1.9). An item that landed on one could
  > never be cleared: `00161` blocks their writes and `work_items_bic_present` keeps
  > the row pointing at them.
  ```

- [ ] **Step 2: Verify the matrix edit landed between the right headings.**
  ```bash
  grep -n "^### \|^## " docs/rbac-matrix.md | sed -n '/Site forms/,/Public/p'
  ```
  Confirm `### Work-item source mirrors` sits between `### Site forms` and `## Public / unauthenticated`.

- [ ] **Step 3: Add the CONFORMANCE row as C12.** The file's sections are `A. Entry & authentication` (A1–A14), `B. Invitations` (B1–B9), `C. Provisioning & database` (**C1–C11**), `D. First-run experience` (D1–D6), `E. Cross-cutting security` (E1–E6) — verified. Every id is `<Letter><digit>`, so the next free id under Provisioning & database is **C12**. In `CONFORMANCE.md`, append to the `## C. Provisioning & database` table:
  ```markdown
  | C12 | Work-item mirrors write source columns through SECURITY DEFINER triggers | MUST | ✓ | `<NNNNN>_work_item_source_mirrors_and_backfill.sql` sections D–G. Twenty-four functions, all with `SET search_path`; the twenty stateful ones `SECURITY DEFINER … SET row_security TO 'off'`, the four pure mappers `IMMUTABLE`/`STABLE` invoker. None uses `current_user` for authorisation (asserted in-migration and by probe, comment-stripped). All revoked from PUBLIC **and** `anon` and granted to nobody — trigger functions fire without EXECUTE, verified with `has_function_privilege`. The pre-migration snapshot table is `REVOKE SELECT … FROM anon` + RLS-enabled with no policy. Authority is checked once, on the `projects.work_items` UPDATE, by item 2's `user_can_write_work_item` + RESTRICTIVE policy. |
  ```
  Then update the file's `Last updated:` line to today's date and this branch name.

- [ ] **Step 4: Extend Appendix A(f)'s Q1 row.** In `16-appendix-registries.md`, in the A(f) table's **Q1 / `projects`** cell, append after `working_days_between()`:
  ```
  , backup_<NNNNN>_source_assignees, work_item_person_eligible(), resolve_project_pm(),
  resolve_work_item_assignee(), resolve_work_item_gatekeeper(), map_source_status(),
  work_item_status_for_mirror(), work_item_mirror_due_date(), diary_delay_text(),
  seed_work_item_watchers(), project_rfi(), project_snag(), project_inspection(),
  project_qc_entry(), project_diary_action(), project_form_action(),
  mirror_rfi_work_item(), mirror_snag_work_item(), mirror_inspection_work_item(),
  mirror_qc_defect_work_item(), mirror_qc_report_defects(),
  mirror_diary_action_work_item(), mirror_form_action_work_item(),
  work_item_assignment_writeback(), void_work_item_on_source_delete()
  ```

- [ ] **Step 5: Correct A(f)'s ordinal-9 sentence — three changes.** Replace it with:
  > Projection triggers on the **six automatic** Q1 sources of A(b) — `rfis`, `snags`, `qc_entries`, `inspections`, `site_diary_entries`, `site_forms` — **plus a report-level entry point on `projects.qc_reports`, because the `qc_defect` scope predicate spans two tables and an entry does not cross it on its own (measured 2026-09-10: an entry is authored while its report is `draft` and enters scope when the report is issued)** — with assignment and due-date write-back; then the entity backfill under `SET LOCAL esite.suppress_notifications = 'on'`; then the backfill-completion `product_events` row. **`auth_events.session_id` rides with migration 1, per §12 §(c) line 121, and is not part of this migration.**

- [ ] **Step 6: Correct §12 §(c) hard dependency 5.** It currently reads "…`site_forms` — **and only those**." Amend to:
  > …`site_forms` — **and only those, plus a report-level entry point on `projects.qc_reports`**, because the `qc_defect` scope predicate spans two tables and an entry does not cross it on its own (measured 2026-09-10). `structure.node_orders` still gets **no trigger**.

- [ ] **Step 7: Correct §03 §1.2 — two errors in one paragraph.** Replace *"an `AFTER DELETE` trigger on each source sets the orphaned item `status = 'void'`"* with:
  > a **`BEFORE DELETE`** trigger on each source sets the item `status = 'void'`, `void_reason = 'source deleted'`. **`AFTER DELETE` does not work and is worse than it looks:** the `ON DELETE SET NULL` referential action runs first, so an `AFTER` trigger's `UPDATE` matches nothing — and `work_items_source_required` is re-evaluated on that `SET NULL` while the item is still `open` with no source, so the **DELETE aborts with `23514`** and deleting an RFI, snag or diary entry stops working entirely (derived from A(a)'s constraint set and measured 2026-09-10).

  And in the "Trigger loop suppression" paragraph, replace *"declared `AFTER INSERT OR UPDATE … FOR EACH ROW WHEN (OLD.<col> IS DISTINCT FROM NEW.<col>)`"* with:
  > declared as **two triggers per source** — `AFTER INSERT … FOR EACH ROW` and `AFTER UPDATE OF <cols> … FOR EACH ROW WHEN (OLD.<col> IS DISTINCT FROM NEW.<col> OR …)`. A single declaration is not valid PostgreSQL: `ERROR: 42P17: INSERT trigger's WHEN condition cannot reference OLD values`.

- [ ] **Step 8: Correct A(b)'s `rfi` gatekeeper and §12 §(d)'s RFI chain.** In A(b), change the `rfi` row's **Gatekeeper** cell from `project PM` to:
  > the raiser (`rfis.raised_by`), else the project PM

  with a footnote under the table:
  > **`rfi`'s gatekeeper is the raiser, not the PM** (measured 2026-09-10): `triage_owner_id` and the §1.5 PM resolver both return the same person on 13 of 14 projects, so a PM gatekeeper makes assignee and gatekeeper identical on all 15 live RFIs and §03 §1.8's "only the gatekeeper may close" vacuous for the type that carries metric 4. An RFI is the mirror image of a snag: the asker confirms the answer is usable, whereas a defect is never signed off by the person who reported it. 12 of the 15 live RFIs were raised by contractors, and this is the only Q1 mechanism that puts a work item into a contractor's ball-in-court.

  In §12 §(d)'s backfill table, the `projects.rfis` row already names `default_rfi_assignee_id`; leave it, and add one sentence to the paragraph below it:
  > The database chain implements that step too, even though `rfiService.create` already applies it at the application layer (`rfi.service.ts:75-83`) and no project has the column set — because the backfill is precisely the path on which that application-layer fallback never ran.

- [ ] **Step 9: Run the whole test suite.**
  ```bash
  pnpm --filter web test
  pnpm --filter @esite/shared test
  pnpm --filter web type-check
  pnpm --filter web lint
  ```
  All four clean. If §12 §(h) tests 5, 7 or 8 exist by now, they must pass against the amended A(f) — that is the point of Steps 4 and 5.

- [ ] **Step 10: Commit.**
  ```bash
  git add docs/rbac-matrix.md CONFORMANCE.md \
          docs/superpowers/specs/2026-09-09-v2-platform-roadmap/16-appendix-registries.md \
          docs/superpowers/specs/2026-09-09-v2-platform-roadmap/03-work-items.md \
          docs/superpowers/specs/2026-09-09-v2-platform-roadmap/12-data-model-and-migrations.md
  git commit -m "docs: record the mirror write-back authority; six spec corrections

§03 §1.2: BEFORE DELETE, not AFTER (the AFTER form aborts the delete with 23514),
and two triggers per source because PostgreSQL rejects WHEN(OLD…) on an INSERT arm.
§12 §(c)5 and A(f) ordinal 9: the qc_defect projection needs a qc_reports entry
point. A(f) ordinal 9: auth_events.session_id rides with migration 1 per §12 §(c).
A(b): the RFI gatekeeper is the raiser."
  ```

---

## Task 19 — Put the fourteen resolved triage owners in front of a human (improvement 12)

`projects.resolve_project_pm` takes the **oldest active `project_manager` membership row**. Measured 2026-09-10: SAXBY has **4** such rows, PNP FAERIE GLEN **4**, KINGSWALK **3**. On those three projects the person who receives every unowned item is decided by the creation order of a membership row — invisibly, with no way for anyone to tell why.

§02's central finding about this codebase is that `default_rfi_assignee_id` was a perfectly good routing mechanism that no project ever configured, and that *a setting that must be turned on is a setting that does not exist*. The inverse failure is a setting nobody was ever shown being silently decisive over 34 items. **This task costs an hour of the owner's time and sits off the critical path** — item 3 is not on it.

**Files:** none. This task produces a decision and possibly some `project_settings` writes.

- [ ] **Step 1: Print the resolution table for all fourteen projects.**
  ```bash
  cat > /tmp/owners.sql <<'SQL'
  SELECT 'project' AS probe, true AS ok,
         rpad(left(p.name, 34), 35) || ' ' ||
         rpad(COALESCE(left(t.full_name, 18), '<unset>'), 19) || ' ' ||
         rpad(COALESCE(left(m.full_name, 18), '<none>'), 19) || ' ' ||
         rpad((SELECT count(*)::text FROM projects.project_members pm
                WHERE pm.project_id = p.id AND pm.role = 'project_manager' AND pm.is_active), 3) || ' ' ||
         (SELECT count(*)::text FROM projects.rfis r WHERE r.project_id = p.id) || ' rfi, ' ||
         (SELECT count(*)::text FROM inspections.inspections i WHERE i.project_id = p.id) || ' insp'
         AS detail
    FROM projects.projects p
    LEFT JOIN projects.project_settings s ON s.project_id = p.id
    LEFT JOIN public.profiles t ON t.id = s.triage_owner_id
    LEFT JOIN public.profiles m ON m.id = projects.resolve_project_pm(p.id)
   ORDER BY p.name;
  SQL
  pnpm tsx scripts/db/rehearse-sql.ts /tmp/owners.sql \
    --with apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql \
    | tee /tmp/triage-owners.txt
  ```
  Columns: project · `triage_owner_id` as set by item 6 · what `resolve_project_pm` returns · how many active PM rows exist · how many items that project contributes. **A project with `PM rows` ≥ 2 is one where the answer was chosen by creation order.**

- [ ] **Step 2: Send `/tmp/triage-owners.txt` and `/tmp/day-one-list.txt` (Task 17 Step 7) to Arno and get an explicit yes or a list of overrides.** The question is exactly: *"Every unowned item on this project will land on this person. Is that right?"* Expect a correction on at least the three multi-PM projects.

- [ ] **Step 3: Apply any overrides as `project_settings.triage_owner_id`, and re-read every row.** ⚠ **PostgREST emits `ON CONFLICT` only when `Prefer: resolution=merge-duplicates` arrives as an HTTP header** — a query parameter is silently ignored, and a supabase-js `.upsert()` on `project_settings` has already silently no-opped in this codebase (PR #159). Write these with plain SQL through the Management API and **confirm with a `SELECT`, never with the absence of an error**:
  ```bash
  cat > /tmp/set-owner.mjs <<'JS'
  const PAT = process.env.SUPABASE_PAT
  const [projectId, userId] = process.argv.slice(2)
  const q = async (sql) => {
    const r = await fetch('https://api.supabase.com/v1/projects/cbskbnvvgcybmfikxgky/database/query', {
      method: 'POST',
      headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    })
    if (!r.ok) { console.error(await r.text()); process.exit(1) }
    return r.json()
  }
  await q(`UPDATE projects.project_settings SET triage_owner_id = '${userId}'
            WHERE project_id = '${projectId}'`)
  console.log(await q(`SELECT project_id, triage_owner_id FROM projects.project_settings
                        WHERE project_id = '${projectId}'`))
  JS
  node /tmp/set-owner.mjs <project-id> <user-id>
  ```
  The printed row **is** the verification. If `triage_owner_id` comes back NULL, the project has no `project_settings` row and item 6's backfill missed it — that is a blocker on item 6, not something to paper over with an INSERT here.

- [ ] **Step 4: Re-run Task 17's day-one list after any overrides** and confirm the distribution moved the way the owner expected. Put the before and after holder tallies in the PR body.

- [ ] **Step 5: Record the decision in the PR body**, including any project where Arno accepted the creation-order default knowingly. There is nothing to commit; the artefact is the paragraph.

---

## Task 20 — Claim the number, set the outbound gate, apply, and read the objects back

**Everything about this task is a rule that was written in blood.** PRs #162 and #163 both shipped a `00183`; `db push` keys on the version **prefix**, so a number already in `schema_migrations` makes it print "Remote database is up to date", exit 0 and **skip the file**. The workflow went green and production served the old code. Then both fixes independently renumbered to `00184` and broke the deploy workflow twice more.

**Files:**
- Rename: the migration file to its claimed number
- Modify: the migration header, the `go_live` and floor literals, the snapshot table name, and probe 12's snapshot-table name

- [ ] **Step 1: Re-read `max(version)` from production AND `origin/main`, at merge time, not now.**
  ```bash
  cat > /tmp/maxver.sql <<'SQL'
  SELECT 'max_version' AS probe, true AS ok, max(version) AS detail
    FROM supabase_migrations.schema_migrations;
  SQL
  pnpm tsx scripts/db/rehearse-sql.ts /tmp/maxver.sql
  git fetch origin main
  git ls-tree --name-only origin/main apps/edge-functions/supabase/migrations/ | sort | tail -3
  ```
  Take `max(the two) + 1`. As of 2026-09-10 both read **00184**, so the next free number is **00185** — but A(f)'s ordinals 1–8 land before this one, so it will not be 00185 by then. **Re-read it.**

- [ ] **Step 2: Check every open PR for the same number.** `≤ max(version)` only catches a number the ledger has absorbed; the failure that actually happened was two sessions each picking the same *free* number and each passing that check.
  ```bash
  gh pr list --state open --json number,headRefName --jq '.[] | "\(.number) \(.headRefName)"' |
  while read -r n b; do
    echo "PR #$n:"
    gh api "repos/WattMatt/e-site/pulls/$n/files" --jq \
      '.[].filename | select(startswith("apps/edge-functions/supabase/migrations/"))'
  done
  ```
  If any open PR claims your number, take the next one and **say so in your PR body**.

- [ ] **Step 3: Announce the number to peer sessions before writing the file.** This is a shared checkout with concurrent agent sessions; the announcement is the only signal available before either merges.

- [ ] **Step 4: Rename the file, the snapshot table, and the literals.**
  ```bash
  git mv apps/edge-functions/supabase/migrations/99999_work_item_source_mirrors_and_backfill.sql \
         apps/edge-functions/supabase/migrations/00NNN_work_item_source_mirrors_and_backfill.sql
  ```
  Then, in one edit pass:
  1. the `-- Migration: <NNNNN>_…` header line;
  2. **the snapshot table**, from `projects.backup_work_item_mirrors_source_assignees` to `projects.backup_00NNN_source_assignees` — A(f)'s R52 convention is `backup_<version>_<object>` and the placeholder name breaks it. Four places: the `CREATE TABLE`, the `REVOKE`, the `ALTER TABLE … ENABLE ROW LEVEL SECURITY`, and the two `-- @verify:` lines. Plus the two restore statements in the header and the two assertions in `scripts/db/probes/12-grants.sql`;
  3. `v_go_live` and `v_floor` in section H, **recomputed from the actual release date**. `2026-11-10` assumes a Tuesday 2026-11-03 go-live and five office working days with no SA public holiday in the window; re-derive from `listHolidays(<year>)` (`packages/shared/src/lib/jbcc/sa-public-holidays.ts:43`) if the date moves, and update the header comment with the new derivation;
  4. `DATE '2026-11-10'` in `scripts/db/probes/13-backfill.sql`, twice.

  Then re-run probes 12, 13 and 17 to confirm the rename broke nothing:
  ```bash
  for p in 12-grants 13-backfill 17-full-rehearsal; do
    pnpm tsx scripts/db/rehearse-sql.ts scripts/db/probes/$p.sql \
      --with apps/edge-functions/supabase/migrations/00NNN_work_item_source_mirrors_and_backfill.sql
  done
  ```

- [ ] **Step 5: Set `suppress_all_outbound` on every project the write-back will touch — BEFORE merging.** §12 §(d): *"That GUC does not cover outbound mail. `projects.project_settings.suppress_all_outbound` must be set on any project touched by a write-back, and the send log read back afterwards to prove the path inert."* The write-back changes `assigned_to` on 9 live RFIs across up to four projects. The migration itself is pure SQL and sends nothing (Task 17 Step 8), but any application path that observes those rows in the same window can, and the spec makes the flag a precondition rather than a judgement call.
  ```bash
  cat > /tmp/suppress.mjs <<'JS'
  const PAT = process.env.SUPABASE_PAT
  const on = process.argv[2] === 'on'
  const q = async (sql) => {
    const r = await fetch('https://api.supabase.com/v1/projects/cbskbnvvgcybmfikxgky/database/query', {
      method: 'POST',
      headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    })
    if (!r.ok) { console.error(await r.text()); process.exit(1) }
    return r.json()
  }
  const scope = `project_id IN (
      SELECT DISTINCT r.project_id FROM projects.rfis r WHERE r.status <> 'closed'
      UNION SELECT DISTINCT s.project_id FROM field.snags s)`
  await q(`UPDATE projects.project_settings SET suppress_all_outbound = ${on}
            WHERE ${scope}`)
  // Re-read. Never trust the absence of an error on a settings write (PR #159).
  console.log(JSON.stringify(await q(
    `SELECT p.name, s.suppress_all_outbound
       FROM projects.project_settings s JOIN projects.projects p ON p.id = s.project_id
      WHERE s.${scope.slice(0)} ORDER BY p.name`), null, 1))
  JS
  SUPABASE_PAT=$SUPABASE_PAT node /tmp/suppress.mjs on
  ```
  **Every row in the printed output must read `true`.** A project whose row is missing has no `project_settings` row at all — a blocker on item 6.

- [ ] **Step 6: Merge, and watch the workflow.** `deploy-migrations.yml` auto-runs on any push to `main` touching a migration (path filter `apps/edge-functions/supabase/migrations/**`) and its three secrets have been bound since 2026-06-02.
  ```bash
  gh run watch "$(gh run list --workflow='Deploy DB Migrations' --limit 1 --json databaseId --jq '.[0].databaseId')"
  ```

- [ ] **Step 7: A green workflow is not evidence. Read the objects back.**
  ```bash
  pnpm tsx scripts/verify-migration-applied.ts --since 00NNM   # the version BEFORE yours
  ```
  This parses the `-- @verify:` block and queries `pg_proc`, `pg_trigger`, `pg_class`, `has_function_privilege` and `has_table_privilege`, exiting non-zero on any absence or any surviving `anon` privilege. If it does not understand `-- trigger:` lines, Task 2 Step 5 was skipped — go back and do it.

- [ ] **Step 8: Independently read the data back, which is the check `db push` cannot fake.**
  ```bash
  cat > /tmp/postapply.sql <<'SQL'
  WITH live AS (
    SELECT w.* FROM projects.work_items w JOIN projects.projects p ON p.id = w.project_id
     WHERE p.name NOT LIKE '\_probe\_%')
  SELECT 'version_in_ledger' AS probe,
         EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '00NNN') AS ok,
         'the file must be in the ledger AND its effect present' AS detail
  UNION ALL
  SELECT 'items_projected', (SELECT count(*) FROM live WHERE origin='mirror') = 34,
         'got ' || (SELECT count(*) FROM live WHERE origin='mirror') || ' of 34'
  UNION ALL
  SELECT 'open_rfis_now_assigned',
         (SELECT count(*) FROM projects.rfis WHERE status <> 'closed' AND assigned_to IS NULL) = 0,
         'was 15 NULL before; the 6 closed ones stay NULL by design'
  UNION ALL
  SELECT 'closed_rfis_still_unassigned',
         (SELECT count(*) FROM projects.rfis WHERE assigned_to IS NULL) = 6,
         'improvement 9: a historical record must not acquire an assignee nobody set'
  UNION ALL
  SELECT 'snags_untouched',
         (SELECT count(*) FROM field.snags WHERE assigned_to IS NULL) = 6,
         'improvement 2: no snag was backfilled, so none acquired an assignee'
  UNION ALL
  SELECT 'no_demo_org_items',
         (SELECT count(*) FROM projects.work_items w JOIN projects.projects p ON p.id = w.project_id
           WHERE p.organisation_id = 'e51ede00-0000-0000-0000-000000000001') = 0,
         'the E-Site DEMO org contributed nothing'
  UNION ALL
  SELECT 'no_diary_items', (SELECT count(*) FROM live WHERE item_type='diary_action') = 0,
         'improvement 1: all six live "delays" say None'
  UNION ALL
  SELECT 'no_order_followup',
         (SELECT count(*) FROM projects.work_items WHERE item_type='order_followup') = 0,
         '440 node_orders rows, deliberately zero items'
  UNION ALL
  SELECT 'no_backfill_bells',
         (SELECT count(*) FROM public.notifications
           WHERE type IN ('work_item_assigned','ball_in_court_changed','work_item_overdue')) = 0,
         'the suppression GUC held'
  UNION ALL
  SELECT 'completion_event_present',
         (SELECT count(*) FROM public.product_events
           WHERE event = 'work_item_backfill_completed') >= 1,
         'item 4''s first recap filters on properties->>backfill_completed_at'
  UNION ALL
  SELECT 'thirteen_projection_triggers',
         (SELECT count(*) FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
           WHERE NOT t.tgisinternal AND p.proname LIKE 'mirror\_%') = 13,
         'six sources × (ins + upd) = 12, plus qc_reports_mirror_defects'
  UNION ALL
  SELECT 'six_void_triggers_all_before',
         (SELECT count(*) FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
           WHERE NOT t.tgisinternal AND p.proname = 'void_work_item_on_source_delete'
             AND (t.tgtype & 2) = 2) = 6,
         'tgtype bit 1 (value 2) is BEFORE; six of six must set it'
  UNION ALL
  SELECT 'anon_has_no_execute',
         (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname='projects'
             AND p.proname LIKE ANY (ARRAY['mirror\_%','resolve\_%','project\_%','map\_source\_status',
                                           'work\_item\_%','void\_work\_item\_%','seed\_work\_item\_%',
                                           'diary\_delay\_text'])
             AND has_function_privilege('anon', p.oid, 'EXECUTE')) = 0,
         'never read proacl — a NULL proacl looks empty but IS the PUBLIC grant'
  UNION ALL
  SELECT 'anon_cannot_read_the_snapshot',
         NOT has_table_privilege('anon', 'projects.backup_00NNN_source_assignees', 'SELECT'),
         '00025:26 makes every new projects table anon-readable at the grant layer';
  SQL
  pnpm tsx scripts/db/rehearse-sql.ts /tmp/postapply.sql
  ```
  Expected: 14/14. **`six_void_triggers_all_before` is the one to read twice** — it is the only post-apply check for F1, and F1's failure mode (a DELETE that aborts with 23514) only shows up when somebody deletes something.

- [ ] **Step 9: Read the send log and clear `suppress_all_outbound`.**
  ```bash
  # There is no send-log table for this path: public.email_sequence_events
  # (00030_email_sequences.sql:14) covers the onboarding/re-engagement sequence and
  # not RFI or snag mail. The two records that exist are the edge function's
  # invocation log and Resend's own send list — check BOTH for the apply window.
  #   Supabase Dashboard → Edge Functions → send-email → Invocations
  #   Resend → Emails, filtered to the apply window
  # Expect ZERO rfi-created / snag-assigned invocations.
  SUPABASE_PAT=$SUPABASE_PAT node /tmp/suppress.mjs off
  ```
  The re-read in the script prints every affected project with `suppress_all_outbound` back to `false`; **check that output, do not assume it**. Record both the send-log result and the cleared flags in the PR body.

- [ ] **Step 10: Walk the flow from an empty state in the real UI, not from a deep link.** On a **throwaway project** with `notify_rfi_email = false` and `notify_snag_email = false` (both re-read with a `SELECT` after writing, per the `Prefer` trap), signed in as a `contractor`:
  1. Create the project → confirm its `project_settings` row arrived with a named `triage_owner_id`.
  2. Raise an RFI with no assignee and a due date of **today** → it appears in the triage owner's queue, `projects.rfis.assigned_to` now names them, and the due date is **not** today (item 2's +7 wd was computed instead).
  3. Assign it → `status` moves `triage → open`, ball-in-court is the assignee.
  4. Re-date it in the Inbox → `projects.rfis.due_date` follows, and the RFI page shows the same date.
  5. Respond → `status` moves to `answered`, ball-in-court moves to **the raiser** (improvement 4 — you, the contractor).
  6. As the contractor, close it → **allowed**, because you are the gatekeeper. Then repeat on a snag: as the raiser, attempt to close → **refused**, because the snag gatekeeper is the PM.
  7. Write a diary entry whose Delays box says `None` → **no work item appears**. Write one that says `Crane stood down` → one does.
  8. Delete the RFI → it does **not** error, its work item goes `void` with `void_reason = 'source deleted'`, it leaves the inbox, and its `work_item_events` survive.

  Then tear the project down and confirm zero residue. ⚠ Steps 6 and 8 are the two that would have been silently broken by F8 and F1 respectively, and neither is reachable from a deep link into seeded data.

- [ ] **Step 11: Write the PR body.** It must carry, at minimum:
  - the claimed number and the `max(version)` + `origin/main` readings that justified it;
  - the mutation-verification counts from Tasks 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15 and 16;
  - the full rehearsal output from Task 17 Step 3 with its 96-name `assertions seen:` line, plus the deliberate single-arm break from Step 4;
  - **the day-one list from Task 17 Step 7, all 34 lines**, and the duplicate-title finding raised against item 4;
  - the triage-owner decision from Task 19 and any overrides;
  - the `rfis_rfi_number_seq` before / after / restored readings from Task 15 Step 5;
  - the post-apply read-back from Step 8 and the send-log result from Step 9;
  - the ten findings F1–F10 named explicitly, so a reviewer can disagree with them on the evidence rather than on the text;
  - the twelve folded-in improvements and the three deferred ones, so the owner can schedule what was not taken.

---

## What this item deliberately does not do

- **No trigger on `structure.node_orders`, and no backfill of its 440 rows.** `order_followup` is created only by the explicit chase control on an order line (A(b)) — **and no Q1 deliverable builds that control**, so Equipment & Materials contributes zero inbox rows for the whole quarter. That is recorded honestly in the Deferred table above and booked for Q4 beside `lead_time_days`; it is not hidden. `node_orders` carries no lead-time column (`00083:50-86`), so there is no defensible rule for which order is late. Backfilling 440 procurement items into an inbox that currently gets read 6% of the time is the single fastest way to prove the new inbox is also noise. A contract test fails the build if a trigger is ever added.
- **No write-back to `inspections.inspections.assigned_to_id`.** `00066`'s own flow stays the system of record; a third write-back is a third loop to reason about (§03 §1.2). The mirror still reads that column **forward**, which is a different thing.
- **No snag or diary rows in the backfill.** Both are measurement decisions, not scope cuts: every live snag is an `E-Site DEMO` fixture and every live "delay" says *None*. Both live triggers work; both spines simply start empty. The two synthetic fixtures in Task 14 Steps 6–7 exist so the arms can still fail.
- **No `variation_order` and no `handover_item`.** Zero rows today, and neither ships inside twelve months. Provision when there is a use.
- **No GCR projection.** Its rows are tenant apportionment records, not assignable acts; nobody is ever owed one.
- **No `qc_report` type.** Only failed entries on issued reports become `qc_defect`; mirroring every issued entry manufactures ~40 items from one 40-line report.
- **No client-viewer watchers, and no client-facing arm at all.** Rejected on the evidence in the Deferred table: it reproduces the fan-out behind 750 `diary_created` notifications at a 5.9% read rate, and A(c) puts those types on the Recap tier. The honest Q1 position is that item 3 delivers nothing to clients.
- **No un-projection path.** Nothing here deletes a work item. A source leaving scope (a diary delay edited away, a QC report re-opened) keeps its item; silently removing something from an inbox because prose changed is worse than one stale row, and the void path exists for the case that genuinely warrants it.
- **No `auth_events.session_id`.** A(f) books it here and §12 §(c) books it with the metrics migration; §12 §(c) is the later, more specific ruling and Task 18 amends A(f) rather than shipping the column twice.
