# Work-Item Spine, Type Registry, Due Dates and Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `projects.work_items` — the platform's single owned-work object — with a NOT NULL single assignee, a generated ball-in-court, a NOT NULL working-day due date, a per-project-per-type reference, a type registry, a triage-owner fallback, the five verbs that let a person actually finish an item, and the RLS/trigger machinery that makes all of it impossible to forge.

**Architecture:** Two migrations. The first adds item 2's columns to the existing `projects.project_settings` row (`work_item_defaults jsonb`, nullable `triage_owner_id`, the builders'-shutdown window) and rewrites `projects.ensure_project_settings_row()` so a new project arrives with a named triage owner. The second creates `projects.work_item_types` (the registry, seeded with A(b)'s eight Q1 types), `projects.work_items` (Appendix A(a)'s DDL), `projects.work_item_events` (append-only, written only by a `SECURITY DEFINER` trigger), `projects.work_item_watchers` (auto-populated by that same trigger), plus six `BEFORE`/`AFTER` triggers, eight helper functions, the RLS policy set and the `anon` revokes. A thin TypeScript mirror in `@esite/shared` carries the type union, the ref prefixes, the per-type state labels and the ball-in-court `CASE`, guarded by a three-way contract test.

**Tech Stack:** PostgreSQL 15 (Supabase, project ref `cbskbnvvgcybmfikxgky`), plpgsql/SQL functions, RLS with RESTRICTIVE policies, Next.js 15 server actions, TypeScript + vitest, bash smoke tests driven through the Supabase Management API (`scripts/db/mgmt-api.sh`).

**Spec:** `16-appendix-registries.md` §A(a) (authoritative DDL, index set, write path), §A(b) (the eight Q1 types), §A(f) (Q1 migration ledger ordinals 6 and 7, and the new-object inventory), §A(h) (the working-day calendar and the two calendars); `03-work-items.md` §1.2–§1.9; `04-inbox-and-my-work.md` §(b), §(d), §(g); `12-data-model-and-migrations.md` §(a), §(b), §(c), §(f), §(g), §(h); `15-metrics-risks-open-questions.md` metrics 2a, 4, 5, 7; `13-roadmap-q1-q2.md` Q1 deliverable 2.

**Depends on:** **Q1 item 1** (the metrics + presence + calendar migration, A(f) ordinal 1). It creates `projects.public_holidays`, `projects.calendar_years`, `projects.working_days_between()` and `scripts/verify-migration-applied.ts`. `work_items.due_date` is `NOT NULL` and its `BEFORE INSERT` trigger computes working days, so **this plan cannot be applied to production until item 1 is applied and the calendar is seeded three years out**. Task 1 gates on all of that and tells you what to do if it has not landed.

---

## Improvements folded in

Taken from the product review, each as real code in the task named, not as a note. Every one is free or small, and every one is either irreversible-if-deferred or spec conformance.

| # | Improvement | Where it lands | Why it could not wait |
|---|---|---|---|
| 1 | **Short human `ref` prefixes** — `RFI`, `SNAG`, `QC`, `INSP`, `DIARY`, `FORM`, `ORD`, `TASK`, as a `CASE` inside `work_items_ensure_ref()` | Task 7 §6, mirrored in `packages/shared/src/work-items/types.ts` (Task 2) | `ref` is immutable by design and travels into emails, PDFs and client deep links (§15 §(e) one-way door). `QC_DEFECT-7` is permanent from the first row. A `CASE` inside the allocator adds no column, so A(b)'s set-equality test is untouched. |
| 2 | **`from_ball_in_court_id` / `to_ball_in_court_id` on `work_item_events`** | Task 5 §3 (DDL), Task 10 §11 (writer) | §15 metric 5's denominator is "work items that entered the caller's ball-in-court that week, counted off `projects.work_item_events`". Without these columns that number can only be reconstructed from today's `gatekeeper_id`, which is the exact error §15 §(b) forbids. The event stream is the only record — it cannot be backfilled. |
| 3 | **`actor_role` stamped at event time** | Task 5 §3 (DDL), Task 10 §11 (writer) | §15 §(b) specifies it in terms: work_item_events carries "actor, timestamp and the effective role stamped **at event time**, not re-resolved later". Metric 2a's diagnostic is the only first-party evidence the spine reached the 13 contractor accounts — and email engagement is unmeasurable, because `email_sequences.opened_at`/`clicked_at` have never been written (the Resend webhook of `00030:24-25` was never built). Un-backfillable. |
| 4 | **`work_item_watchers` is actually populated** — creator/assignee/gatekeeper on create, incoming holder on reassign | Task 10 §11 | Nothing else in Q1 writes the table, so the SELECT policy's watcher arm is dead code, item 4's notification engine (3.0wk, immediately after this on the critical path) would find an empty subscription list, and §03 §1.8's "auto-populated on create, assign and @mention" would be false. |
| 5 | **`client_viewer` loses the blanket project-wide read on `work_items`** — they keep every item they hold or watch | Task 9 §8 and §9 | `user_has_project_access()` is TRUE for any `project_members` row regardless of role (`00106` clause (a)). That is precisely the predicate PR #162 found and closed on saved reports. The new policy would re-open it onto mirrored `order_followup` and `qc_defect` titles the same landlord is deliberately gated out of on the Equipment & Materials report. §04 §(d) already says the client's Inbox is filtered to items where they are ball-in-court. |
| 6 | **Five verbs, not two** — `advanceWorkItemStatusAction`, `setWorkItemDueDateAction`, `voidWorkItemAction` ship beside create and reassign | Task 13 | `task` is sourceless, so a task created in Q1 has no module behind it: with only create + reassign, **no code path can ever close one**, while metric 7 (activation, Q1 target 35%) is defined as a new user moving any work item to `closed` in their first session. The transition guard also *requires* a `void_reason` that nothing can supply. §13 item 2 names exactly these three triage verbs. |
| 7 | **A task created with a named assignee is born `open`, not `triage`** | Task 13 (`status: 'open'` server-side literal), Task 5 assertion 1 | §03 §1.6 rules it in terms. The DDL default stays `'triage'` (that is the sourceless/unnamed case item 3 uses); the action supplies `'open'` because it always has an assignee. Otherwise every PM-created task lands in the Triage filter and dilutes the Q1 triage metric on day one. |
| 8 | **The current ball-in-court holder may reassign** | Task 13 (`reassignWorkItemAction`) | §03 §1.4 and the DB guard both permit it (`v_may_manage := user_can_write_work_item(...) OR v_actor = OLD.ball_in_court_id`); only the action was stricter. The person this blocked is a Siyaya foreman handed a snag that belongs to his electrician — metric 2a's 0/13, for a reason the design had already solved. |
| 9 | **`STATE_LABELS`** — a per-type display word for each universal status, in the shared module | Task 2 | Five universal states are right for the schema and wrong for the reader: a foreman marking a snag fixed wants "Done", not "Answered". Items 5, 6 and 7 and the PDF renderers all need this map; written under time pressure inside a component it cannot be shared. |
| 10 | **A write-role holder may correct either person column in any live state** | Task 11 §12 | A(b) makes `task`'s gatekeeper the **creator**, so a contractor who raises a task for a WM engineer would otherwise be the only person who could ever close it, and the PM could not correct that until the work was already done. §1.4's restriction is about which column *moves the ball*; correcting a gatekeeper while the item is open moves nothing. |
| 11 | **Every `RAISE EXCEPTION` string is written for the person who will read it** | Tasks 6, 8, 11 | All five actions end `return { error: error.message }`, so each of these strings is user-facing copy today. `work_items: assignee 8f3c… has no effective role on project 44b1…` is what a PM sees for picking the wrong person from a list. Free, and sticky once shipped. |
| 12 | **`title` is immutable while `origin = 'mirror'`** | Task 11 §12, recorded in Task 16's hand-off | The PERMISSIVE UPDATE policy lets an assignee edit `title` on a mirrored row; item 3's mirror trigger fires again on the next source change. One of the two silently loses. Deciding it in the guard now costs a clause; discovering it as a bug report costs an investigation across two concurrent lanes. |
| 13 | **`00192` refuses to apply unless the calendar is seeded three years out**, and `add_working_days`'s `no_data_found` carries a HINT naming the re-seed | Task 5 §0, Task 6 §5 | `add_working_days` runs inside a `BEFORE INSERT` trigger that every mirrored source writes through from item 3 onward. A missed October re-seed (§15 §(b2), a manual annual task) therefore does not merely break escalation — it makes **raising an RFI, logging a snag or submitting a form fail outright**. This programme's own history is `cloud-sync-poll`: specified, merged, never scheduled, found two months later by users. A migration that refuses to apply is the right place to find it. |
| 14 | **`createWorkItemTaskAction` accepts a `dueDate`** | Task 13 | "Send me the updated single-line by Friday" is the monday.com row §04 §(g) says `task` exists to replace, and its migration is supposed to preserve due dates. Without the field every manual task silently becomes due next Thursday. `work_items_set_due_date()` already respects a supplied date and still applies the shutdown push. |

## Deferred improvements

| Improvement | Recommendation | Why not now |
|---|---|---|
| `CREATE INDEX ON projects.work_item_events (actor_id, verb, created_at)` for My Work's *Waiting on others* tab and the Q3 chase sweep | **later-quarter** | Real — A(a)'s index set has nothing on `actor_id` and `work_item_events_item_idx` is `(work_item_id, created_at)`. But an index is fully reversible and adds nothing at production's current volume (15 RFIs, 18 inspections, 6 snags, 0 work items). Q1 has 0.5 weeks of path float; add it the day item 6 measures a slow query. |

---

## Scope boundaries — read before you start

Four things a reasonable engineer would build here belong to other items. Building them is scope creep and will collide with another lane's migration.

| Not in this plan | Whose it is | What this plan does instead |
|---|---|---|
| The six projection triggers on `rfis`, `snags`, `qc_entries`, `inspections`, `site_diary_entries`, `site_forms`, the two assignment write-backs, the six delete-to-void triggers and the entity backfill | **Item 3** (A(f) ordinal 9) | Declares the seven source FK columns and both source CHECKs so item 3 has somewhere to write, and ships `projects.resolve_work_item_assignee()` — the resolution chain item 3's triggers call. |
| Any write to `public.notifications`, any bell, any read of `esite.suppress_notifications` | **Item 4** (A(f) ordinals 2–5) | `projects.append_work_item_event()` writes `work_item_events` and `work_item_watchers` and nothing else. Item 4 adds the emit branch and the GUC guard to that same function with `CREATE OR REPLACE`. **Do not add an empty branch now.** |
| `project_settings.enabled_modules`, its `<@` CHECK, its GIN index, its seeding, and `projects.project_module_enabled()` | **Item 8** | Nothing. A(f) ordinal 7 lists a `project_module_enabled` arm on the RESTRICTIVE INSERT policy; item 8 adds that arm to the policy this plan creates, in item 8's own migration. A call to a function that does not exist would make every insert fail. |
| `/inbox`, `/my-work`, `projects.inbox_for_user()`, `projects.my_project_roles()`, `public.inbox_state` | **Items 5, 6** (A(f) ordinal 8) | Ships the index set A(a) specifies so those queries have something to sit on, and the five verbs those pages will call. |

**A(f) ordinal 6 is one migration file shared by items 2, 7, 8 and 12.** This plan writes that file with item 2's four columns. If items 7, 8 or 12 are being built concurrently and the file is still unmerged, they append their columns to the same file. If it has already merged, they claim their own number under the protocol in Task 1.

---

## Three places where the spec contradicts itself. These are the rulings this plan implements.

Each of these will look like a mistake when you read the spec. It is not; read the ruling.

**1. `work_items.instruction_recipient_id` is in A(a)'s DDL and must be omitted in Q1.** A(a) shows the Q2 source column "in place so the table is read once rather than assembled from four sections", and it references `projects.instruction_recipients`, a table Q2 creates. Including it now makes the migration fail on an unresolvable foreign key. A(f)'s Q2 row and §12 §(c) both say the column lands in Q2 "with both CHECKs re-declared wholesale". **Q1 omits the column and both CHECKs omit its term.** Everything else in A(a) is reproduced character-for-character, plus the three event columns improvements 2 and 3 add to a *different* table.

**2. `work_item_events` gets a SELECT policy and no write policy — not an INSERT policy.** A(a) says the table is "INSERT-only to `authenticated` with no UPDATE or DELETE policy, written by a `SECURITY DEFINER` append trigger". §12 §(a) says it is "Written **only** by a `SECURITY DEFINER` append trigger, with a SELECT policy and no write policy — the shape at `00179_site_forms.sql:504-506`". §12 governs because it cites the precedent by line, and the two are reconcilable: `authenticated` **holds the table INSERT grant** from `00025_grant_schema_permissions.sql:19` (that is the "INSERT-only to authenticated" A(a) means), while **no INSERT policy exists**, so RLS denies every client insert and the definer trigger — which bypasses RLS by ownership — is the only writer. This plan additionally **revokes** that grant in section 10, so a client insert fails with a permission error rather than a policy error. An INSERT policy here would let a client forge the audit trail, which is defect 6 of the nine found in PR #160.

**3. There is no calendar-day fallback on an unseeded year.** §03 §1.5 says the trigger has "a calendar-day fallback (`now()::date + days_to_respond`) for rows created by a path that passed no date at all" **and** that "an unseeded calendar year raises rather than silently drifting by a day". A(h) [R24] settles it: `working_days_between` "raises `no_data_found` on an unseeded year — **there is no fallback to calendar days**, because a silent one-day drift changes whether an item escalates." **The ruling: the trigger always computes working days; a path that passes no date gets a computed date rather than an insert failure (that is what §03's sentence is for); an unseeded year raises `no_data_found` with a message naming the year and a HINT naming the re-seed.** Task 6 tests both halves, and Task 5 §0 makes the migration itself refuse to apply against a calendar that is not seeded three years out, so the failure is found at deploy time rather than by a foreman who cannot log a snag.

---

## The section order of `00192_work_item_spine.sql`. Read this before Task 4.

The tasks below append sections to one file in this order, and **the order is a dependency order, not a narrative one.** Two constraints force it, and both were found by running the migration rather than by reading it:

- **`CREATE POLICY` resolves function references at creation time.** `work_item_events_select` calls `projects.user_can_read_work_item()`, so the helper must be created before the policy. The helper's own `LANGUAGE sql` body references `work_items` and `work_item_watchers`, so those tables must exist before the helper.
- **An assertion that acts as a real authenticated user cannot run before the policies exist.** With RLS enabled and no policy, an `UPDATE … WHERE id = …` as `authenticated` affects zero rows and *does not raise* — so a guard assertion written against it records a false result in both directions. The RLS section therefore precedes both the append trigger and the transition guard, and their assertion files act as real users.

| § | Contents | Task |
|---|---|---|
| 0 | Preconditions: `calendar_years` exists and is seeded for this year + 2 | 5 |
| 1 | `work_item_types`, the eight-type seed, its RLS and SELECT policy | 4 |
| 2 | `work_items`, A(a)'s index set, the seven partial UNIQUEs | 5 |
| 3 | `work_item_events` | 5 |
| 4 | `work_item_watchers`, `ENABLE ROW LEVEL SECURITY` on all three | 5 |
| 5 | `add_working_days()`, `push_past_builders_shutdown()`, `work_items_set_due_date()` + trigger | 6 |
| 6 | `work_items_ensure_ref()` + trigger | 7 |
| 7 | `resolve_work_item_assignee()`, `work_items_assert_membership()` + trigger | 8 |
| 8 | `user_can_read_work_item()`, `user_can_write_work_item()` + their revokes and grants | 9 |
| 9 | **Every policy**: `work_items` ×5, `work_item_events_select`, `work_item_watchers` ×3 | 9 |
| 10 | Table grants, the `anon` revokes, `ALTER DEFAULT PRIVILEGES` | 9 |
| 11 | `append_work_item_event()` + trigger (events **and** watcher seeding) | 10 |
| 12 | `work_items_transition_guard()` + trigger | 11 |
| 13 | `validate_work_item_defaults()` + trigger, and the `work_item_defaults` seeding | 12 |

---

## File Structure

### Created

| Path | Responsibility |
|---|---|
| `apps/edge-functions/supabase/migrations/00191_work_item_project_settings.sql` | A(f) ordinal 6, item 2's slice. Adds `work_item_defaults`, nullable `triage_owner_id` and the two builders'-shutdown columns to `projects.project_settings`; creates `projects.org_owner()`, `projects.resolve_project_pm()`, `projects.resolve_triage_owner()`; rewrites `projects.ensure_project_settings_row()`; backfills all 14 live settings rows. |
| `apps/edge-functions/supabase/migrations/00192_work_item_spine.sql` | A(f) ordinal 7. The thirteen sections above. |
| `packages/shared/src/work-items/types.ts` | The TypeScript half of the registry: `WORK_ITEM_TYPE_KEYS`, `WORK_ITEM_STATUSES`, `WORK_ITEM_PRIORITIES`, `WORK_ITEM_ORIGINS`, `REF_PREFIXES`, `STATE_LABELS`, the per-type default table, and `ballInCourt()` — the mirror of A(a)'s generated column for optimistic UI. |
| `packages/shared/src/work-items/index.ts` | Barrel for the above. Pure; imports nothing heavy (the `packages/shared/src/index.ts:33-38` rule). |
| `packages/shared/src/work-items/ball-in-court.test.ts` | Asserts `ballInCourt()` over all five statuses, that it returns null exactly for `closed` and `void`, and that `REF_PREFIXES` and `STATE_LABELS` cover every registered key. |
| `packages/shared/src/work-items/work-item-types.contract.test.ts` | §12 §(h) test 1. Three-way set equality: Appendix A(b)'s markdown table ⟷ the `INSERT INTO projects.work_item_types` seed parsed out of the migration ⟷ `WORK_ITEM_TYPE_KEYS`. Also asserts each seeded `write_roles` array equals the `@esite/shared` role constant it claims, and that the SQL ref-prefix `CASE` equals `REF_PREFIXES`. |
| `apps/web/src/actions/work-items.actions.ts` | The app-layer half of the write gate: the five verbs — `createWorkItemTaskAction`, `reassignWorkItemAction`, `advanceWorkItemStatusAction`, `setWorkItemDueDateAction`, `voidWorkItemAction`. Every one calls `requireEffectiveRole` before touching the database, because a server action is directly invocable and page-level gating is not a gate. |
| `apps/web/src/actions/work-items.actions.test.ts` | Asserts the role gate on all five, that the ball-in-court holder is admitted where the DB admits them, and that `createWorkItemTaskAction` never forwards a client-supplied `created_by`, a source FK, a `ref`, a `status` or a `due_date` it did not validate. |
| `scripts/db/try-work-item-spine.sh` | The red/green loop. Applies both migration files plus an assertion file inside **one transaction against production** and `ROLLBACK`s. Zero residue, real schema, real roles. |
| `scripts/db/assertions/work-item-*.sql` | One assertion file per task (`settings`, `registry`, `ddl`, `due-date`, `ref`, `membership`, `rls`, `events`, `transition`, `defaults`). Each `RAISE EXCEPTION`s on failure so the transaction aborts and the script exits non-zero. |
| `scripts/db/smoke-test-work-item-spine.sh` | The post-apply read-back. Runs against production **after** the migrations are applied, proving the objects exist, `anon` holds no privilege, the constraints reject what they must, and a client viewer sees only what they hold. This is the evidence the "a green deploy is not evidence a migration ran" rule demands. |

### Modified

| Path | Change |
|---|---|
| `packages/shared/src/index.ts` | Add `export * from './work-items'` at the end (the file is 44 lines today). |
| `docs/rbac-matrix.md` | New `### Work items (work-items.actions.ts)` subsection under "Server actions", five rows, plus a note recording the three DB layers and the one deliberate action/DB divergence. Same PR as the actions. |
| `CONFORMANCE.md` | New row **E7** under `## E. Cross-cutting security`. Same PR as the auth change. |
| `docs/superpowers/specs/2026-09-09-v2-platform-roadmap/16-appendix-registries.md` | A(f)'s Q1 `projects` row gains the eight functions this plan creates. §12 §(h) test 8 diffs A(f) against the `-- @verify:` blocks in both directions, so an unregistered function fails the build. |

---

## Task 1 — Pre-flight: prove the dependency, claim the numbers, build the loop

**Files:**
- Create: `scripts/db/try-work-item-spine.sh`
- Create: `scripts/db/assertions/.gitkeep`

- [ ] **Step 1: Confirm you are in the right worktree on a clean branch.**

```bash
cd "/Volumes/Extreme SSD/DEVELOPER/APPS/ESITE.V1/wt-v2-roadmap"
git status --short && git rev-parse --abbrev-ref HEAD
```

Expect no output from `git status --short` and a branch name. **Do not work in `../esite`** — it is a stale checkout with 30 dirty files. Create the feature branch:

```bash
git checkout -b feat/q1-work-item-spine
```

- [ ] **Step 2: Prove item 1 has landed — the database objects *and* the verification script.** This is the gate; everything else is wasted work if it fails.

```bash
cd "/Volumes/Extreme SSD/DEVELOPER/APPS/ESITE.V1/wt-v2-roadmap"
. scripts/db/mgmt-api.sh
mgmt_query "
SELECT
  to_regclass('projects.public_holidays')  IS NOT NULL AS has_holidays,
  to_regclass('projects.calendar_years')   IS NOT NULL AS has_years,
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='projects' AND p.proname='working_days_between') AS has_wdb;"
test -f scripts/verify-migration-applied.ts && echo "has_verify_script: true" || echo "has_verify_script: FALSE"
```

Expected once item 1 is live:

```json
[{"has_holidays":true,"has_years":true,"has_wdb":true}]
```
```
has_verify_script: true
```

If any of the three database objects is `false`, **stop and report the blocker.** The one legitimate way to continue is to develop against item 1's migration file if it exists on `origin/main` but is not yet applied — Step 6 wires that in behind `WITH_ITEM1=1`.

If the database objects are present but `scripts/verify-migration-applied.ts` is **absent** (item 1's Task 3 creates it; as of 2026-09-10 it does not exist in this worktree), that is not a blocker: Task 15 Step 6 says what to run instead, and you record the gap in the PR body rather than writing a second copy of item 1's script.

- [ ] **Step 3: Read which calendar years are seeded, and stop if this year + 2 are not all there.** `00192` section 0 refuses to apply otherwise, deliberately — see improvement 13.

```bash
. scripts/db/mgmt-api.sh
mgmt_query "
WITH y AS (SELECT EXTRACT(YEAR FROM (now() AT TIME ZONE 'Africa/Johannesburg'))::int AS this_year)
SELECT (SELECT this_year FROM y) AS this_year,
       (SELECT array_agg(year ORDER BY year) FROM projects.calendar_years) AS seeded,
       (SELECT count(*)::int FROM generate_series((SELECT this_year FROM y), (SELECT this_year FROM y) + 2) g
         WHERE NOT EXISTS (SELECT 1 FROM projects.calendar_years cy WHERE cy.year = g)) AS missing;"
```

Expected `"missing": 0`. If it is not zero, **stop and report it to item 1's owner** — the annual seed is A(h)'s recurring operational task and belongs to item 1, not to this item. Do not seed production as a side effect of this plan. Record the `seeded` array in your PR notes; the assertion files that walk into future years seed the years they need *inside the rolled-back transaction*, and Task 6's file states which.

- [ ] **Step 4: Claim two consecutive migration numbers, against all three sources.** `supabase db push` keys on the version **prefix**: a number already in `schema_migrations` makes it print "Remote database is up to date", exit 0 and **skip the file silently**. Two `00183`s and two `00184`s shipped in one week this way.

```bash
. scripts/db/mgmt-api.sh
mgmt_query "SELECT max(version) AS max_version FROM supabase_migrations.schema_migrations;"
git fetch origin main --quiet
git ls-tree --name-only origin/main apps/edge-functions/supabase/migrations/ | tail -3
gh pr list --state open --json number,files --jq '.[] | {n:.number, m:[.files[].path|select(test("migrations/"))]}'
```

Take the highest of the three, add one, add two.

As of 2026-09-10 all three sources read `00184`. **Every other Q1 plan in `docs/superpowers/plans/` currently writes `00185` as its placeholder** — items 0, 1 and 3 all do, which is the collision this protocol exists to prevent, arriving before a single file is written. The tie-break is A(f)'s ledger order, not who writes first: ordinal 0 (item 0), ordinal 1 (item 1), ordinals 2–5 (item 4's notification group), then **ordinals 6 and 7, which are this plan's**. That puts item 2 at `00191_` and `00192_`, and those are the placeholders used throughout below.

**These are placeholders, not claims.** The number is attached to a file only at the moment of merge, under the protocol in Task 15 Step 1 and Task 16 Step 4. If the ledger or `origin/main` has moved, or a peer merged out of ledger order, rename both files everywhere they appear in this plan before you start. Announce the two numbers to peer sessions now, and re-check immediately before merge.

- [ ] **Step 5: Write the red/green loop.** This is what makes every SQL step below a real TDD cycle: it applies both migrations plus an assertion file inside one transaction against the real production schema, then rolls back.

Create `scripts/db/try-work-item-spine.sh`:

```bash
#!/usr/bin/env bash
# Apply BOTH work-item migrations plus one assertion file inside a SINGLE
# transaction against production, then ROLLBACK. Zero residue.
#
# This is the red/green loop for every SQL task in the work-item spine plan.
# It runs against the real schema, the real RLS and the real role grants —
# which is the only place the failures this plan guards against are visible.
#
# Usage:   scripts/db/try-work-item-spine.sh scripts/db/assertions/work-item-ddl.sql
# Env:     WITH_ITEM1=1  also applies item 1's calendar migration first, for
#          development before that migration is live.
# Exit:    0 when every assertion passed; non-zero on the first RAISE.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/mgmt-api.sh"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIG_DIR="$ROOT/apps/edge-functions/supabase/migrations"

ASSERT="${1:?usage: try-work-item-spine.sh <assertions.sql>}"
[[ -f "$ASSERT" ]] || { echo "ERROR: no such assertion file: $ASSERT" >&2; exit 1; }

PRELUDE=""
if [[ "${WITH_ITEM1:-0}" == "1" ]]; then
  ITEM1=$(ls "$MIG_DIR"/*_q1_metrics_presence_calendar.sql 2>/dev/null | head -1 || true)
  [[ -n "$ITEM1" ]] || { echo "ERROR: WITH_ITEM1=1 but no item-1 migration found" >&2; exit 1; }
  PRELUDE=$(cat "$ITEM1")
fi

SQL=$(printf 'BEGIN;\n%s\n%s\n%s\n%s\nROLLBACK;\n' \
  "$PRELUDE" \
  "$(cat "$MIG_DIR/00191_work_item_project_settings.sql")" \
  "$(cat "$MIG_DIR/00192_work_item_spine.sql")" \
  "$(cat "$ASSERT")")

mgmt_query "$SQL" > /dev/null && echo "✓ $(basename "$ASSERT") — all assertions passed"
```

```bash
chmod +x scripts/db/try-work-item-spine.sh
mkdir -p scripts/db/assertions && touch scripts/db/assertions/.gitkeep
```

- [ ] **Step 6: Watch the loop fail for the right reason.** Both migration files are missing, so this must fail with a file-not-found, not silently pass.

```bash
scripts/db/try-work-item-spine.sh scripts/db/assertions/.gitkeep
```

Expected: `cat: .../00191_work_item_project_settings.sql: No such file or directory`, non-zero exit. That is your red.

- [ ] **Step 7: Commit.**

```bash
git add scripts/db/try-work-item-spine.sh scripts/db/assertions/.gitkeep
git commit -m "chore(work-items): rolled-back-transaction harness for the spine migrations

Applies both migration files plus an assertion file in one transaction
against production and ROLLBACKs, so every SQL step in the spine plan is a
real red/green cycle against the real schema, RLS and grants.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2 — The TypeScript half of the registry

The database is authoritative. This module exists for three reasons only: `@esite/shared` must carry the type union so §12 §(h) test 1 can assert set equality against application code; an optimistic UI must be able to predict the next ball-in-court holder before the round trip (§12 §(g)); and the ref prefixes and per-type state labels must be **one** copy that the pages, the PDF renderers and the recap all read (improvements 1 and 9).

**Files:**
- Create: `packages/shared/src/work-items/types.ts`
- Create: `packages/shared/src/work-items/index.ts`
- Test: `packages/shared/src/work-items/ball-in-court.test.ts`
- Modify: `packages/shared/src/index.ts` (append after line 44 — the file is 44 lines today)

- [ ] **Step 1: Write the failing test first.** The fixture must be able to fail: it names all five statuses and asserts the two that must return null, so an implementation that always returns the assignee — the obvious wrong one — cannot pass.

Create `packages/shared/src/work-items/ball-in-court.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  ballInCourt, refPrefix, stateLabel,
  WORK_ITEM_STATUSES, WORK_ITEM_TYPE_KEYS, REF_PREFIXES, STATE_LABELS,
} from './types'

const ASSIGNEE = '11111111-1111-1111-1111-111111111111'
const GATEKEEPER = '22222222-2222-2222-2222-222222222222'

describe('ballInCourt — the TypeScript mirror of work_items.ball_in_court_id', () => {
  it('points at the assignee while triage or open', () => {
    expect(ballInCourt('triage', ASSIGNEE, GATEKEEPER)).toBe(ASSIGNEE)
    expect(ballInCourt('open', ASSIGNEE, GATEKEEPER)).toBe(ASSIGNEE)
  })

  it('points at the gatekeeper once answered', () => {
    expect(ballInCourt('answered', ASSIGNEE, GATEKEEPER)).toBe(GATEKEEPER)
  })

  it('is null exactly for closed and void, and for nothing else', () => {
    const nulls = WORK_ITEM_STATUSES.filter(
      (s) => ballInCourt(s, ASSIGNEE, GATEKEEPER) === null,
    )
    expect(nulls).toEqual(['closed', 'void'])
  })

  it('covers every status in the vocabulary — no unmapped arm', () => {
    for (const s of WORK_ITEM_STATUSES) {
      expect(() => ballInCourt(s, ASSIGNEE, GATEKEEPER)).not.toThrow()
    }
    expect(WORK_ITEM_STATUSES).toHaveLength(5)
  })
})

describe('REF_PREFIXES — the permanent human half of every work-item reference', () => {
  it('covers every registered type, with no unregistered key', () => {
    expect(Object.keys(REF_PREFIXES).sort()).toEqual([...WORK_ITEM_TYPE_KEYS].sort())
  })

  it('is short, upper-case and free of underscores — it is read on a phone', () => {
    for (const [key, prefix] of Object.entries(REF_PREFIXES)) {
      expect(prefix, `${key}`).toMatch(/^[A-Z]{2,5}$/)
    }
  })

  it('gives the spec examples', () => {
    expect(refPrefix('rfi')).toBe('RFI')
    expect(refPrefix('qc_defect')).toBe('QC')
    expect(refPrefix('order_followup')).toBe('ORD')
    expect(refPrefix('diary_action')).toBe('DIARY')
  })
})

describe('STATE_LABELS — the reader-facing word for a universal status', () => {
  it('covers every type × every status', () => {
    expect(Object.keys(STATE_LABELS).sort()).toEqual([...WORK_ITEM_TYPE_KEYS].sort())
    for (const key of WORK_ITEM_TYPE_KEYS) {
      for (const s of WORK_ITEM_STATUSES) {
        expect(stateLabel(key, s), `${key}/${s}`).toBeTruthy()
      }
    }
  })

  it('does not say "Answered" on a snag, an inspection, a task or a form', () => {
    expect(stateLabel('snag', 'answered')).toBe('Fixed — awaiting sign-off')
    expect(stateLabel('inspection', 'answered')).toBe('Awaiting verification')
    expect(stateLabel('task', 'answered')).toBe('Done — awaiting the creator')
    expect(stateLabel('form_action', 'answered')).toBe('Submitted')
    expect(stateLabel('rfi', 'answered')).toBe('Answered')
  })
})
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
cd "/Volumes/Extreme SSD/DEVELOPER/APPS/ESITE.V1/wt-v2-roadmap"
pnpm --filter @esite/shared test -- ball-in-court
```

Expected: `Failed to resolve import "./types"` — nine failing tests. That is your red.

- [ ] **Step 3: Write the module.** The per-type table is data, and every value in it is Appendix A(b)'s. Nothing here is invented; the `write_roles` on each row is a reference to a role constant that already exists in `packages/shared/src/types/index.ts:36-92`, which is what Task 14's contract test checks.

Create `packages/shared/src/work-items/types.ts`:

```ts
/**
 * The TypeScript half of the work-item registry.
 *
 * The DATABASE is authoritative — `projects.work_item_types` is the registry
 * and `work_items.ball_in_court_id` is a STORED generated column. This module
 * exists for exactly three jobs:
 *
 *   1. §12 §(h) test 1 asserts set equality in both directions between
 *      Appendix A(b), the DB registry and this union, so an `item_type`
 *      literal that appears in application code and nowhere else fails CI.
 *   2. An optimistic UI must predict the next ball-in-court holder before the
 *      round trip. `ballInCourt()` is a MIRROR, never a second source: a
 *      contract test asserts it agrees with the generated column over all
 *      five statuses.
 *   3. REF_PREFIXES and STATE_LABELS are read by the Inbox, My Work, the PDF
 *      renderers and the 07:00 recap. One copy, here, or four copies later.
 *
 * Pure. Imports nothing outside this package (packages/shared/src/index.ts:33-38
 * — a heavy transitive import from the barrel crashes the admin layout).
 */
import {
  ORG_WRITE_ROLES,
  MARKUP_WRITE_ROLES,
  QC_WRITE_ROLES,
  SNAG_FIELD_ROLES,
  FORMS_FIELD_ROLES,
  type OrgRole,
} from '../types'

/** Appendix A(a) — the five universal states. Source vocabularies are mirrored
 *  into the display-only `source_status`, never into this set. */
export const WORK_ITEM_STATUSES = ['triage', 'open', 'answered', 'closed', 'void'] as const
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number]

/** Appendix A(a) — priority. `qc_defect` maps severity onto this
 *  (minor→low, major→high, critical→critical), never a flat medium. */
export const WORK_ITEM_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const
export type WorkItemPriority = (typeof WORK_ITEM_PRIORITIES)[number]

/** Appendix A(a) — how the row came to exist. `split` is the deliberate
 *  two-people-one-source case the per-source partial UNIQUE excludes. */
export const WORK_ITEM_ORIGINS = ['mirror', 'split', 'manual'] as const
export type WorkItemOrigin = (typeof WORK_ITEM_ORIGINS)[number]

/** Appendix A(h) — the two named calendars, resolved from
 *  `project_settings.working_days`. `site` = `office` plus Saturday. */
export const WORK_ITEM_CALENDARS = ['office', 'site'] as const
export type WorkItemCalendar = (typeof WORK_ITEM_CALENDARS)[number]

/** How the gatekeeper is resolved for a type. Stored as
 *  `work_item_types.gatekeeper_rule`; read by item 3's mirror triggers. */
export const GATEKEEPER_RULES = ['project_pm', 'verifier_else_pm', 'creator'] as const
export type GatekeeperRule = (typeof GATEKEEPER_RULES)[number]

export interface WorkItemTypeSpec {
  readonly key: string
  readonly label: string
  /** Fully-qualified source table, or null for a sourceless type. */
  readonly sourceTable: string | null
  /** The source's own owner column, read at mirror time as the seed assignee. */
  readonly sourceColumn: string | null
  readonly defaultDays: number
  readonly calendar: WorkItemCalendar
  readonly gatekeeperRule: GatekeeperRule
  readonly writeRoles: readonly OrgRole[]
  readonly sortOrder: number
}

/**
 * Appendix A(b), Q1 rows only. `instruction` (Q2), `approval` (Q3) and
 * `valuation` (Q4) are registered by the migration of the quarter that first
 * creates rows of them — they are NOT listed here as headroom.
 *
 * `rfi`'s 7 is not a new number: it is the platform's existing
 * `project_settings.default_rfi_due_days` default (00101_project_settings.sql:30),
 * and the due-date trigger reads that COLUMN live rather than a copy of it.
 */
export const WORK_ITEM_TYPES: readonly WorkItemTypeSpec[] = [
  { key: 'rfi',            label: 'RFI',              sourceTable: 'projects.rfis',                sourceColumn: 'assigned_to',     defaultDays: 7,  calendar: 'office', gatekeeperRule: 'project_pm',       writeRoles: MARKUP_WRITE_ROLES, sortOrder: 1 },
  { key: 'snag',           label: 'Snag',             sourceTable: 'field.snags',                  sourceColumn: 'assigned_to',     defaultDays: 5,  calendar: 'site',   gatekeeperRule: 'project_pm',       writeRoles: SNAG_FIELD_ROLES,   sortOrder: 2 },
  { key: 'qc_defect',      label: 'QC defect',        sourceTable: 'projects.qc_entries',          sourceColumn: null,              defaultDays: 5,  calendar: 'site',   gatekeeperRule: 'project_pm',       writeRoles: QC_WRITE_ROLES,     sortOrder: 3 },
  { key: 'inspection',     label: 'Inspection',       sourceTable: 'inspections.inspections',      sourceColumn: 'assigned_to_id',  defaultDays: 3,  calendar: 'site',   gatekeeperRule: 'verifier_else_pm', writeRoles: ORG_WRITE_ROLES,    sortOrder: 4 },
  { key: 'diary_action',   label: 'Diary action',     sourceTable: 'projects.site_diary_entries',  sourceColumn: null,              defaultDays: 2,  calendar: 'site',   gatekeeperRule: 'project_pm',       writeRoles: MARKUP_WRITE_ROLES, sortOrder: 5 },
  { key: 'form_action',    label: 'Form action',      sourceTable: 'field.site_forms',             sourceColumn: null,              defaultDays: 3,  calendar: 'site',   gatekeeperRule: 'project_pm',       writeRoles: FORMS_FIELD_ROLES,  sortOrder: 6 },
  { key: 'order_followup', label: 'Order follow-up',  sourceTable: 'structure.node_orders',        sourceColumn: null,              defaultDays: 10, calendar: 'office', gatekeeperRule: 'project_pm',       writeRoles: ORG_WRITE_ROLES,    sortOrder: 7 },
  { key: 'task',           label: 'Task',             sourceTable: null,                           sourceColumn: null,              defaultDays: 5,  calendar: 'office', gatekeeperRule: 'creator',          writeRoles: MARKUP_WRITE_ROLES, sortOrder: 8 },
] as const

export const WORK_ITEM_TYPE_KEYS = WORK_ITEM_TYPES.map((t) => t.key)
export type WorkItemTypeKey = (typeof WORK_ITEM_TYPES)[number]['key']

/**
 * The human half of `work_items.ref`.
 *
 * `ref` is IMMUTABLE by design — it is a permanent identifier in emails, PDFs
 * and other people's notes — and §15 §(e) lists work-item ids in client deep
 * links as a one-way door. So the prefix is decided once, here and in the
 * matching CASE inside projects.work_items_ensure_ref(), and the contract test
 * asserts the two agree. `upper(item_type)` would have shipped QC_DEFECT-7 and
 * ORDER_FOLLOWUP-3 to a foreman on WhatsApp, permanently.
 *
 * This is NOT a column on work_item_types: A(b) fixes that table's column set
 * and §12 §(h) test 1 asserts it.
 */
export const REF_PREFIXES: Readonly<Record<string, string>> = {
  rfi: 'RFI',
  snag: 'SNAG',
  qc_defect: 'QC',
  inspection: 'INSP',
  diary_action: 'DIARY',
  form_action: 'FORM',
  order_followup: 'ORD',
  task: 'TASK',
}

export function refPrefix(key: string): string {
  return REF_PREFIXES[key] ?? key.toUpperCase()
}

/**
 * The reader-facing word for a universal status, per type.
 *
 * The STORED vocabulary stays A(a)'s five values — that is what the schema,
 * the metrics and the policies are written against. But five universal states
 * are right for the schema and wrong for the reader: a foreman marking a snag
 * fixed is hunting for "Done", and a landlord reading "Answered" on an
 * inspection learns nothing. Every field product in the research set narrows
 * the vocabulary by role and context rather than exposing its internal one.
 *
 * Items 5, 6 and 7 and the PDF renderers all read this map, so there is one
 * copy of the wording rather than four.
 */
export const STATE_LABELS: Readonly<
  Record<string, Readonly<Record<WorkItemStatus, string>>>
> = {
  rfi: {            triage: 'Needs an owner', open: 'Open',        answered: 'Answered',                  closed: 'Closed',   void: 'Withdrawn' },
  snag: {           triage: 'Needs an owner', open: 'To fix',      answered: 'Fixed — awaiting sign-off', closed: 'Signed off', void: 'Withdrawn' },
  qc_defect: {      triage: 'Needs an owner', open: 'To fix',      answered: 'Fixed — awaiting re-check', closed: 'Cleared',  void: 'Withdrawn' },
  inspection: {     triage: 'Needs an owner', open: 'To inspect',  answered: 'Awaiting verification',     closed: 'Verified', void: 'Cancelled' },
  diary_action: {   triage: 'Needs an owner', open: 'To action',   answered: 'Done — awaiting review',    closed: 'Closed',   void: 'Withdrawn' },
  form_action: {    triage: 'Needs an owner', open: 'To complete', answered: 'Submitted',                 closed: 'Accepted', void: 'Withdrawn' },
  order_followup: { triage: 'Needs an owner', open: 'Chasing',     answered: 'Supplier replied',          closed: 'Resolved', void: 'Dropped' },
  task: {           triage: 'Needs an owner', open: 'To do',       answered: 'Done — awaiting the creator', closed: 'Done',   void: 'Dropped' },
}

export function stateLabel(key: string, status: WorkItemStatus): string {
  return STATE_LABELS[key]?.[status] ?? status
}

/**
 * Mirror of Appendix A(a)'s STORED generated column:
 *
 *   CASE status WHEN 'triage'   THEN assignee_id
 *               WHEN 'open'     THEN assignee_id
 *               WHEN 'answered' THEN gatekeeper_id
 *               ELSE NULL END
 *
 * The database column is authoritative and unwritable by anyone. Use this only
 * to render the next holder before a mutation returns.
 */
export function ballInCourt(
  status: WorkItemStatus,
  assigneeId: string,
  gatekeeperId: string,
): string | null {
  switch (status) {
    case 'triage':
    case 'open':
      return assigneeId
    case 'answered':
      return gatekeeperId
    case 'closed':
    case 'void':
      return null
  }
}
```

Create `packages/shared/src/work-items/index.ts`:

```ts
export * from './types'
```

- [ ] **Step 4: Run it and watch it pass.**

```bash
pnpm --filter @esite/shared test -- ball-in-court
```

Expected: `Test Files 1 passed`, `Tests 9 passed`.

- [ ] **Step 5: Prove the test can fail (mutation proof).** Temporarily change the `'answered'` arm of `ballInCourt` to `return assigneeId`, re-run, and confirm **exactly one** test fails — `points at the gatekeeper once answered`. The null-set test still passes (`nulls` is still `['closed','void']`), and so does the coverage test (nothing throws, and the length is still 5), **which is why the gatekeeper assertion has to be a separate `it()` rather than folded into either of them.** Restore the arm and re-run to green. Record the 9 → 8 → 9 counts in the PR body; this is the branch §12 §(h) names by hand ("inverting that branch of the generated column must fail").

- [ ] **Step 6: Export from the barrel.** Append to the end of `packages/shared/src/index.ts` (44 lines today):

```ts

// Work items — the Q1 spine's type registry, ref prefixes, state labels and
// the ball-in-court mirror. Pure; safe from the barrel (no next/*, react-pdf,
// pizzip or node:fs).
export * from './work-items'
```

- [ ] **Step 7: Type-check the whole package, because the barrel is load-bearing.**

```bash
pnpm --filter @esite/shared type-check && pnpm --filter web type-check
```

Both must exit 0. `Sidebar.tsx` imports `OWNER_ADMIN` from this barrel, so a bad export here crashes the admin layout at runtime, not at test time.

- [ ] **Step 8: Commit.**

```bash
git add packages/shared/src/work-items packages/shared/src/index.ts
git commit -m "feat(work-items): shared type registry, ref prefixes, state labels and the BIC mirror

Appendix A(b)'s eight Q1 types as data, the five-status vocabulary, short human
ref prefixes (RFI/SNAG/QC/INSP/DIARY/FORM/ORD/TASK — ref is immutable and ends
up in emails and client deep links, so upper(item_type) would have shipped
QC_DEFECT-7 permanently), per-type state labels so a foreman sees 'Done' rather
than 'Answered', and ballInCourt() — a mirror of A(a)'s STORED generated column
for optimistic UI, never a second source. Pure module; safe from the barrel.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3 — Migration A: `triage_owner_id`, `work_item_defaults`, the shutdown window and the resolvers

A(f) ordinal 6, item 2's slice. **This must precede the spine**: `assignee_id` is `NOT NULL`, and without a resolved triage owner the backfill fails mid-flight on exactly the projects that most need triaging.

⚠ **`triage_owner_id` is NULLABLE, and that is a decision, not an oversight.** `projects.ensure_project_settings_row()` is an `AFTER INSERT` trigger on `projects.projects` that inserts only `(project_id, organisation_id)` (`00103_project_settings_backfill_and_autocreate.sql:19-30`). A third **mandatory** column makes that insert raise and aborts the transaction that created the project — project creation breaks platform-wide. The DB-level guarantee is `work_items.assignee_id NOT NULL`, never a settings column.

⚠ **The `-- @verify:` block uses ONE `--` per line and sits OUTSIDE the `-- ===` banner.** Item 1's parser matches each directive with `/^--\s*([a-z_]+)\s*:\s*(.+?)\s*$/` against the trimmed line, and its sentinels with `/^--\s*@verify:begin\s*$/`. A doubled prefix (`-- -- column: …`) matches neither: `-` is not `[a-z_]`, so the block is not even found and `parseVerifyBlock` returns `null`. Close the banner first, then write the block.

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00191_work_item_project_settings.sql`
- Create: `scripts/db/assertions/work-item-settings.sql`

- [ ] **Step 1: Write the assertion file first.** It asserts against the *live* estate, so it can only pass if the backfill actually resolved owners for all 14 projects — including the one with zero project managers.

Create `scripts/db/assertions/work-item-settings.sql`:

```sql
-- Assertions for migration A (project_settings work-item columns).
-- Run inside the rolled-back transaction opened by try-work-item-spine.sh.
DO $$
DECLARE n int; v_pm uuid; v_proj uuid; v_owner uuid;
BEGIN
  -- 1. The four columns exist with the shapes the spine depends on.
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema='projects' AND table_name='project_settings'
     AND column_name IN ('work_item_defaults','triage_owner_id',
                         'builders_shutdown_start_md','builders_shutdown_end_md');
  IF n <> 4 THEN RAISE EXCEPTION 'expected 4 new project_settings columns, found %', n; END IF;

  -- 2. triage_owner_id is NULLABLE. A NOT NULL column here breaks project creation.
  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema='projects' AND table_name='project_settings'
         AND column_name='triage_owner_id') <> 'YES'
  THEN RAISE EXCEPTION 'triage_owner_id must be NULLABLE (00103 inserts only project_id + organisation_id)'; END IF;

  -- 3. work_item_defaults is NOT NULL with a {} default, so the spine's
  --    `defaults -> type ->> key` never dereferences a NULL jsonb.
  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema='projects' AND table_name='project_settings'
         AND column_name='work_item_defaults') <> 'NO'
  THEN RAISE EXCEPTION 'work_item_defaults must be NOT NULL DEFAULT ''{}'''; END IF;

  -- 4. EVERY live settings row now names a triage owner. Zero exceptions:
  --    the backfill terminates at the org owner, so no project can be missed.
  SELECT count(*) INTO n FROM projects.project_settings WHERE triage_owner_id IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'backfill left % project_settings rows with a NULL triage_owner_id', n; END IF;

  -- 5. Every resolved owner is a real, still-resolvable person on that project.
  SELECT count(*) INTO n
    FROM projects.project_settings ps
   WHERE public.user_effective_project_role(ps.project_id, ps.triage_owner_id) IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION '% triage owners have no effective role on their own project', n; END IF;

  -- 6. THE FALLBACK CASE. Exactly one live project has zero project_manager
  --    memberships (the Sandton demo). Its owner must come from created_by or
  --    the org owner — this is the arm that would otherwise never be exercised.
  SELECT p.id INTO v_proj
    FROM projects.projects p
   WHERE NOT EXISTS (SELECT 1 FROM projects.project_members pm
                      WHERE pm.project_id = p.id AND pm.is_active AND pm.role='project_manager')
   LIMIT 1;
  IF v_proj IS NULL THEN
    RAISE EXCEPTION 'no PM-less project found — the created_by/org-owner fallback is untested. Create one in this transaction rather than skipping the assertion.';
  END IF;
  SELECT ps.triage_owner_id INTO v_pm FROM projects.project_settings ps WHERE ps.project_id = v_proj;
  SELECT p.created_by INTO v_owner FROM projects.projects p WHERE p.id = v_proj;
  IF v_pm IS NULL THEN RAISE EXCEPTION 'PM-less project % resolved a NULL triage owner', v_proj; END IF;
  IF v_pm <> v_owner AND public.user_effective_project_role(v_proj, v_pm) NOT IN ('owner','admin','project_manager')
  THEN RAISE EXCEPTION 'PM-less project % fell through to % which is neither created_by nor an org admin', v_proj, v_pm; END IF;

  -- 7. A NEW project gets a triage owner from the rewritten trigger, not from
  --    a backfill. Walk from the empty state: insert a project, read it back.
  INSERT INTO projects.projects (organisation_id, name, created_by)
  SELECT p.organisation_id, '_assert_new_project', p.created_by FROM projects.projects p LIMIT 1
  RETURNING id INTO v_proj;
  SELECT ps.triage_owner_id INTO v_pm FROM projects.project_settings ps WHERE ps.project_id = v_proj;
  IF v_pm IS NULL THEN
    RAISE EXCEPTION 'ensure_project_settings_row() left a brand-new project with no triage owner';
  END IF;

  -- 8. ensure_project_settings_row() must NOT use current_user for anything.
  IF (SELECT prosrc FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid=p.pronamespace
       WHERE nsp.nspname='projects' AND p.proname='ensure_project_settings_row') ILIKE '%current_user%'
  THEN RAISE EXCEPTION 'ensure_project_settings_row() references current_user — inside SECURITY DEFINER that is the function OWNER (00179:341-346)'; END IF;

  -- 9. anon holds no EXECUTE on any of the three new resolvers.
  SELECT count(*) INTO n FROM (VALUES
    ('projects.org_owner(uuid)'),
    ('projects.resolve_project_pm(uuid)'),
    ('projects.resolve_triage_owner(uuid)')) AS f(sig)
   WHERE has_function_privilege('anon', f.sig, 'EXECUTE');
  IF n <> 0 THEN RAISE EXCEPTION '% new function(s) still executable by anon', n; END IF;

  RAISE NOTICE 'work-item-settings: 9/9 assertions passed';
END $$;
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
scripts/db/try-work-item-spine.sh scripts/db/assertions/work-item-settings.sql
```

Expected: the harness cannot find `00191_work_item_project_settings.sql`. Red.

- [ ] **Step 3: Write the migration.** Create `apps/edge-functions/supabase/migrations/00191_work_item_project_settings.sql`:

```sql
-- =============================================================================
-- Migration: 00191_work_item_project_settings.sql
-- Programme: V2 platform roadmap — Q1, A(f) ordinal 6 (item 2's slice)
-- Spec: docs/superpowers/specs/2026-09-09-v2-platform-roadmap/
--         16-appendix-registries.md A(b), A(f), A(h)
--         03-work-items.md §1.5, §1.6
--
-- Adds the work-item columns to the existing projects.project_settings row and
-- rewrites projects.ensure_project_settings_row() so a NEW project arrives with
-- a named triage owner. MUST precede the spine: work_items.assignee_id is
-- NOT NULL, and without a resolved owner the backfill aborts on exactly the
-- projects that most need triaging.
--
-- triage_owner_id is NULLABLE by decision (§03 §1.6). ensure_project_settings_row()
-- is an AFTER INSERT trigger inserting only (project_id, organisation_id)
-- (00103:19-30); a third MANDATORY column makes that insert raise and aborts the
-- transaction that created the project — project creation breaks platform-wide.
--
-- Restore:
--   ALTER TABLE projects.project_settings
--     DROP COLUMN work_item_defaults, DROP COLUMN triage_owner_id,
--     DROP COLUMN builders_shutdown_start_md, DROP COLUMN builders_shutdown_end_md;
--   DROP FUNCTION projects.resolve_triage_owner(uuid), projects.resolve_project_pm(uuid),
--                 projects.org_owner(uuid);
--   -- then restore ensure_project_settings_row() from 00103:19-26 verbatim.
-- =============================================================================

-- @verify:begin
-- column: projects.project_settings.work_item_defaults
-- column: projects.project_settings.triage_owner_id
-- column: projects.project_settings.builders_shutdown_start_md
-- column: projects.project_settings.builders_shutdown_end_md
-- function: projects.org_owner(uuid)
-- function: projects.resolve_project_pm(uuid)
-- function: projects.resolve_triage_owner(uuid)
-- function: projects.ensure_project_settings_row()
-- constraint: project_settings_shutdown_md_format ON projects.project_settings
-- grant_absent: anon EXECUTE ON projects.org_owner(uuid)
-- grant_absent: anon EXECUTE ON projects.resolve_project_pm(uuid)
-- grant_absent: anon EXECUTE ON projects.resolve_triage_owner(uuid)
-- sql: SELECT count(*) = 0 FROM projects.project_settings WHERE triage_owner_id IS NULL
-- @verify:end

-- ─── 1. Columns ──────────────────────────────────────────────────────────────
-- The 00102 audit trigger snapshots with to_jsonb(NEW) and diffs generically
-- (00102:30-45), so adding columns needs no change there.
ALTER TABLE projects.project_settings
  ADD COLUMN IF NOT EXISTS work_item_defaults        jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS triage_owner_id           uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS builders_shutdown_start_md text NOT NULL DEFAULT '12-15',
  ADD COLUMN IF NOT EXISTS builders_shutdown_end_md   text NOT NULL DEFAULT '01-15';

COMMENT ON COLUMN projects.project_settings.work_item_defaults IS
  'Per-item_type defaults: { "<type>": { days_to_respond, triage_owner_id, gatekeeper_id } }. '
  'Keys validated against projects.work_item_types by trigger (a CHECK cannot reference another '
  'table). Typed columns were rejected: eight types in Q1, each new one forcing a migration on a '
  'hot 1:1 table carrying an audit trigger (00102:30,61-63). NOTE: the rfi key holds a NULL '
  'days_to_respond by design — the due-date trigger reads project_settings.default_rfi_due_days '
  'LIVE, so editing that setting moves the next RFI rather than drifting from a migration-time copy.';
COMMENT ON COLUMN projects.project_settings.triage_owner_id IS
  'Default assignee backstop. NULLABLE by decision (§03 §1.6) — a NOT NULL column with no default '
  'makes ensure_project_settings_row() raise and breaks project creation platform-wide. The DB-level '
  'guarantee is work_items.assignee_id NOT NULL, not this column.';
COMMENT ON COLUMN projects.project_settings.builders_shutdown_start_md IS
  'MM-DD. The SA construction year-end shutdown window, gated by the existing builders_holiday '
  'boolean. Default 12-15..01-15 matches crossesBuildersHoliday (lib/jbcc/working-days.ts:67-75). '
  'A due date landing inside it is pushed to the first SITE working day of the new year (A(h)).';

-- MM-DD, so the window recurs annually without a per-year row.
ALTER TABLE projects.project_settings
  DROP CONSTRAINT IF EXISTS project_settings_shutdown_md_format;
ALTER TABLE projects.project_settings
  ADD CONSTRAINT project_settings_shutdown_md_format CHECK (
    builders_shutdown_start_md ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
AND builders_shutdown_end_md   ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$');

-- ─── 2. Resolvers ────────────────────────────────────────────────────────────
-- All three are STABLE SECURITY DEFINER with row_security off (§12 §(b) rule 6)
-- because they read user_organisations and project_members, which a caller's own
-- RLS would hide. None uses current_user: inside SECURITY DEFINER that resolves
-- to the function OWNER, which is what made the first site-form transition
-- trigger silently inert (00179:341-346).

CREATE OR REPLACE FUNCTION projects.org_owner(p_organisation_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public' SET row_security TO 'off'
AS $fn$
  SELECT uo.user_id FROM public.user_organisations uo
   WHERE uo.organisation_id = p_organisation_id AND uo.is_active AND uo.role = 'owner'
   ORDER BY uo.created_at ASC LIMIT 1;
$fn$;

-- §03 §1.5's "project PM" chain, in 00107's order: oldest active project_members
-- PM row → oldest active org PM → org admin → org owner. Used as the GATEKEEPER
-- default for every type whose gatekeeper_rule is 'project_pm'. Terminates at
-- the owner so it can never return NULL for a project that exists.
CREATE OR REPLACE FUNCTION projects.resolve_project_pm(p_project_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public' SET row_security TO 'off'
AS $fn$
  WITH proj AS (SELECT id, organisation_id FROM projects.projects WHERE id = p_project_id)
  SELECT COALESCE(
    (SELECT pm.user_id FROM projects.project_members pm
      WHERE pm.project_id = p_project_id AND pm.is_active AND pm.role = 'project_manager'
      ORDER BY pm.created_at ASC LIMIT 1),
    (SELECT uo.user_id FROM public.user_organisations uo JOIN proj ON TRUE
      WHERE uo.organisation_id = proj.organisation_id AND uo.is_active AND uo.role = 'project_manager'
      ORDER BY uo.created_at ASC LIMIT 1),
    (SELECT uo.user_id FROM public.user_organisations uo JOIN proj ON TRUE
      WHERE uo.organisation_id = proj.organisation_id AND uo.is_active AND uo.role = 'admin'
      ORDER BY uo.created_at ASC LIMIT 1),
    (SELECT projects.org_owner(proj.organisation_id) FROM proj));
$fn$;

-- The TRIAGE-OWNER chain is deliberately different from the PM chain and shorter:
-- oldest active project_manager on the project → the project's created_by → the
-- org owner. created_by sits ABOVE the org owner, which is why this cannot reuse
-- resolve_project_pm (that one already terminates at the owner, so created_by
-- would never be reached).
CREATE OR REPLACE FUNCTION projects.resolve_triage_owner(p_project_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public' SET row_security TO 'off'
AS $fn$
  WITH proj AS (SELECT id, organisation_id, created_by FROM projects.projects WHERE id = p_project_id)
  SELECT COALESCE(
    (SELECT pm.user_id FROM projects.project_members pm
      WHERE pm.project_id = p_project_id AND pm.is_active AND pm.role = 'project_manager'
      ORDER BY pm.created_at ASC LIMIT 1),
    (SELECT proj.created_by FROM proj),
    (SELECT projects.org_owner(proj.organisation_id) FROM proj));
$fn$;

REVOKE ALL ON FUNCTION projects.org_owner(uuid)            FROM PUBLIC;
REVOKE ALL ON FUNCTION projects.resolve_project_pm(uuid)   FROM PUBLIC;
REVOKE ALL ON FUNCTION projects.resolve_triage_owner(uuid) FROM PUBLIC;
-- FROM PUBLIC does NOT remove anon's grant: Supabase's ALTER DEFAULT PRIVILEGES
-- grants anon EXECUTE *directly* at creation, a separate grant (00113:15-24).
REVOKE EXECUTE ON FUNCTION projects.org_owner(uuid)            FROM anon;
REVOKE EXECUTE ON FUNCTION projects.resolve_project_pm(uuid)   FROM anon;
REVOKE EXECUTE ON FUNCTION projects.resolve_triage_owner(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION projects.org_owner(uuid)            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION projects.resolve_project_pm(uuid)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION projects.resolve_triage_owner(uuid) TO authenticated, service_role;

-- ─── 3. ensure_project_settings_row() rewrite ────────────────────────────────
-- Was SECURITY INVOKER with no search_path (00103:19-26). It now reads
-- project_members and user_organisations through the resolvers, so it must be
-- DEFINER or a contractor creating a project would resolve NULL under their own
-- RLS. It stays an AFTER INSERT trigger, which is what makes NEW.id visible to
-- resolve_triage_owner's SELECT — a BEFORE INSERT trigger could not do this.
CREATE OR REPLACE FUNCTION projects.ensure_project_settings_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'projects', 'public'
SET row_security TO 'off'
AS $fn$
BEGIN
    INSERT INTO projects.project_settings (project_id, organisation_id, triage_owner_id)
    VALUES (NEW.id, NEW.organisation_id, projects.resolve_triage_owner(NEW.id))
    ON CONFLICT (project_id) DO NOTHING;
    RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION projects.ensure_project_settings_row() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.ensure_project_settings_row() FROM anon;

-- ─── 4. Backfill every live settings row ─────────────────────────────────────
-- Fires the 00102 audit trigger, writing one history row per project with
-- changed_by = updated_by (NULL for a migration). That is correct: the change
-- has no human author.
UPDATE projects.project_settings ps
   SET triage_owner_id = projects.resolve_triage_owner(ps.project_id)
 WHERE ps.triage_owner_id IS NULL;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 4: Run it and watch it pass.**

```bash
scripts/db/try-work-item-spine.sh scripts/db/assertions/work-item-settings.sql
```

It will still fail — on the *missing* `00192_work_item_spine.sql`. Create a placeholder so migration A can be exercised alone:

```bash
printf -- '-- placeholder; filled in from Task 4 onward.\nSELECT 1;\n' \
  > apps/edge-functions/supabase/migrations/00192_work_item_spine.sql
scripts/db/try-work-item-spine.sh scripts/db/assertions/work-item-settings.sql
```

Expected: `✓ work-item-settings.sql — all assertions passed`.

- [ ] **Step 5: Mutation proof — break the nullability and watch assertion 2 fail.** Change `triage_owner_id uuid REFERENCES public.profiles(id)` to `triage_owner_id uuid NOT NULL REFERENCES public.profiles(id)` and re-run. Expected: the migration itself fails, because the existing 14 rows hold NULL at the moment the column is added — which is the platform-wide project-creation break, made visible. Restore the nullable form and re-run to green.

- [ ] **Step 6: Mutation proof — break the fallback and watch assertion 6 fail.** In `resolve_triage_owner`, delete the `(SELECT proj.created_by FROM proj)` arm and re-run. Expected: assertion 6 raises naming the PM-less project, because it now falls straight to the org owner. Restore the arm and re-run to green. Record both mutation results in the PR body.

- [ ] **Step 7: Prove the `-- @verify:` block parses.** A block the parser silently skips is the decorative test this programme exists to end, and a doubled `--` prefix produces exactly that.

```bash
node -e "
const { readFileSync } = require('node:fs');
const sql = readFileSync('apps/edge-functions/supabase/migrations/00191_work_item_project_settings.sql','utf8');
const lines = sql.split(/\r?\n/);
const s = lines.findIndex(l => /^--\s*@verify:begin\s*\$/.test(l.trim()));
const e = lines.findIndex((l,i) => i>s && /^--\s*@verify:end\s*\$/.test(l.trim()));
if (s < 0 || e < 0) { console.error('NO BLOCK FOUND — the sentinels do not match item 1 grammar'); process.exit(1); }
const bad = lines.slice(s+1,e).filter(l => !/^--\s*[a-z_]+\s*:\s*.+\$/.test(l.trim()));
console.log('directives:', e-s-1, 'unparseable:', bad.length);
if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
"
```

Expected: `directives: 13 unparseable: 0`. If it says `NO BLOCK FOUND`, you wrote the block inside the `-- ===` banner with a doubled `--`; move it below the banner and use one `--` per line.

- [ ] **Step 8: Commit.**

```bash
git add apps/edge-functions/supabase/migrations/00191_work_item_project_settings.sql \
        apps/edge-functions/supabase/migrations/00192_work_item_spine.sql \
        scripts/db/assertions/work-item-settings.sql
git commit -m "feat(work-items): project_settings triage owner, defaults and shutdown window

A(f) ordinal 6, item 2's slice. Nullable triage_owner_id (a NOT NULL column
here breaks project creation platform-wide via 00103's AFTER INSERT trigger),
work_item_defaults jsonb, the MM-DD builders'-shutdown window, three resolvers
and the ensure_project_settings_row() rewrite. All 14 live rows backfilled.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4 — `projects.work_item_types` and the eight-type seed (§1)

The registry is a table, not an enum, because "a new **sourceless** type costs one registry row and nothing else" (§03 §1.7) — `approval` in Q3 must require no `ALTER` on the hottest table on the platform.

⚠ **A(b) is authoritative for this table's column list** — `(key, label, source_table, source_column, default_days, calendar, gatekeeper_rule, write_roles text[], sort_order, is_active)`. **Do not add a `ref_prefix` column.** §12 §(h) test 1 asserts set equality against A(b). The ref prefix is a `CASE` **inside the allocator function** (Task 7), which adds no column and therefore does not touch that test — see improvement 1.

**Files:**
- Modify: `apps/edge-functions/supabase/migrations/00192_work_item_spine.sql` (replace the placeholder with the header + section 1)
- Create: `scripts/db/assertions/work-item-registry.sql`

- [ ] **Step 1: Write the assertion file first.**

Create `scripts/db/assertions/work-item-registry.sql`:

```sql
DO $$
DECLARE n int; r record;
BEGIN
  -- 1. Exactly the eight Q1 keys from Appendix A(b). Not seven, not nine —
  --    `instruction` (Q2), `approval` (Q3) and `valuation` (Q4) are registered
  --    by the migration of the quarter that first creates rows of them.
  IF (SELECT array_agg(key ORDER BY key) FROM projects.work_item_types)
     <> ARRAY['diary_action','form_action','inspection','order_followup',
              'qc_defect','rfi','snag','task']
  THEN RAISE EXCEPTION 'work_item_types is not exactly A(b)''s eight Q1 keys: %',
        (SELECT array_agg(key ORDER BY key) FROM projects.work_item_types); END IF;

  -- 2. A(b)'s due offsets and calendars, row by row. A flat default would pass
  --    a count test, so this asserts the values.
  FOR r IN SELECT * FROM (VALUES
      ('rfi',7,'office','project_pm'), ('snag',5,'site','project_pm'),
      ('qc_defect',5,'site','project_pm'), ('inspection',3,'site','verifier_else_pm'),
      ('diary_action',2,'site','project_pm'), ('form_action',3,'site','project_pm'),
      ('order_followup',10,'office','project_pm'), ('task',5,'office','creator')
    ) AS e(key, days, cal, gk) LOOP
    IF NOT EXISTS (SELECT 1 FROM projects.work_item_types t
                    WHERE t.key=r.key AND t.default_days=r.days
                      AND t.calendar=r.cal AND t.gatekeeper_rule=r.gk)
    THEN RAISE EXCEPTION 'A(b) mismatch on %: expected %wd/%/%', r.key, r.days, r.cal, r.gk; END IF;
  END LOOP;

  -- 3. NO type admits client_viewer. §03 §1.9: the Watcher-tier write set lands
  --    in Q3, not here. NOTE: 00161_client_viewer_readonly_write_block.sql is
  --    NOT a second layer for work_items — see the comment on section 9.
  SELECT count(*) INTO n FROM projects.work_item_types WHERE 'client_viewer' = ANY(write_roles);
  IF n <> 0 THEN RAISE EXCEPTION '% type(s) admit client_viewer in Q1', n; END IF;

  -- 4. order_followup has a source_table but NO projection trigger anywhere.
  --    A(b): explicit chase only. A seventh trigger would project all 440 live
  --    procurement rows into inboxes on day one.
  SELECT count(*) INTO n FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_namespace nsp ON nsp.oid = c.relnamespace
   WHERE nsp.nspname='structure' AND c.relname='node_orders' AND NOT tg.tgisinternal
     AND pg_get_triggerdef(tg.oid) ILIKE '%work_item%';
  IF n <> 0 THEN RAISE EXCEPTION 'structure.node_orders carries % work-item trigger(s); A(b) forbids any', n; END IF;

  -- 5. The registry is readable but not writable by a client, and not by anon.
  IF has_table_privilege('anon','projects.work_item_types','SELECT')
  THEN RAISE EXCEPTION 'anon can SELECT projects.work_item_types'; END IF;
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='projects' AND tablename='work_item_types' AND cmd <> 'SELECT';
  IF n <> 0 THEN RAISE EXCEPTION 'work_item_types has % write policy/policies; the registry is migration-managed', n; END IF;

  RAISE NOTICE 'work-item-registry: 5/5 assertions passed';
END $$;
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
scripts/db/try-work-item-spine.sh scripts/db/assertions/work-item-registry.sql
```

Expected: `relation "projects.work_item_types" does not exist`. Red.

- [ ] **Step 3: Replace the placeholder with the migration header and section 1.** Overwrite `apps/edge-functions/supabase/migrations/00192_work_item_spine.sql`:

```sql
-- =============================================================================
-- Migration: 00192_work_item_spine.sql
-- Programme: V2 platform roadmap — Q1, A(f) ordinal 7 — THE SPINE
-- Spec: docs/superpowers/specs/2026-09-09-v2-platform-roadmap/
--         16-appendix-registries.md A(a) (DDL + index set + write path),
--         A(b) (the eight Q1 types), A(h) (the two calendars)
--         03-work-items.md §1.2-§1.9 · 12-data-model-and-migrations.md §(b)
--         15-metrics-risks-open-questions.md §(b) (event columns) + metric 5
--
-- Depends on A(f) ordinal 1 (projects.public_holidays, projects.calendar_years)
-- and ordinal 6 (project_settings.work_item_defaults / triage_owner_id / the
-- shutdown window). due_date is NOT NULL and its BEFORE INSERT trigger computes
-- working days, which raises no_data_found on an unseeded year — A(h) forbids a
-- calendar-day fallback, because a silent one-day drift changes whether an item
-- escalates. Section 0 therefore refuses to apply against an under-seeded
-- calendar, so the failure lands on the deployer and not on a foreman who
-- cannot log a snag.
--
-- SECTION ORDER IS A DEPENDENCY ORDER. CREATE POLICY resolves function
-- references at creation time, so the helpers (§8) precede every policy (§9),
-- and both precede the triggers whose assertion files act as real authenticated
-- users (§11, §12) — an UPDATE as `authenticated` against a table with RLS on
-- and no policy affects zero rows and does NOT raise, which makes a guard
-- assertion written against it record a false result in both directions.
--
-- NOT in this migration, by ruling:
--   * work_items.instruction_recipient_id — Q2 (A(f)); it references
--     projects.instruction_recipients, which does not exist yet. Q2 re-declares
--     BOTH source CHECKs wholesale when it lands, because DROP CONSTRAINT
--     discards the other one silently.
--   * The six projection triggers and the backfill — item 3, A(f) ordinal 9.
--   * Any public.notifications write — item 4. append_work_item_event() writes
--     events and watchers only; item 4 adds the emit branch with CREATE OR REPLACE.
--   * project_module_enabled() on the INSERT policy — item 8 adds that arm.
--
-- Restore:
--   DROP TABLE projects.work_item_events, projects.work_item_watchers,
--              projects.work_items, projects.work_item_types CASCADE;
--   DROP FUNCTION projects.add_working_days(date,int,uuid,text),
--     projects.push_past_builders_shutdown(date,uuid),
--     projects.resolve_work_item_assignee(uuid,text,uuid),
--     projects.user_can_read_work_item(uuid),
--     projects.user_can_write_work_item(uuid,text),
--     projects.work_items_set_due_date(), projects.work_items_ensure_ref(),
--     projects.work_items_assert_membership(), projects.work_items_transition_guard(),
--     projects.append_work_item_event(), projects.validate_work_item_defaults();
--   ALTER DEFAULT PRIVILEGES IN SCHEMA projects GRANT SELECT ON TABLES TO anon;
-- =============================================================================

-- @verify:begin
-- table: projects.work_item_types
-- table: projects.work_items
-- table: projects.work_item_events
-- table: projects.work_item_watchers
-- column: projects.work_item_events.from_ball_in_court_id
-- column: projects.work_item_events.to_ball_in_court_id
-- column: projects.work_item_events.actor_role
-- function: projects.add_working_days(date,int,uuid,text)
-- function: projects.push_past_builders_shutdown(date,uuid)
-- function: projects.resolve_work_item_assignee(uuid,text,uuid)
-- function: projects.user_can_read_work_item(uuid)
-- function: projects.user_can_write_work_item(uuid,text)
-- function: projects.work_items_set_due_date()
-- function: projects.work_items_ensure_ref()
-- function: projects.work_items_assert_membership()
-- function: projects.work_items_transition_guard()
-- function: projects.append_work_item_event()
-- function: projects.validate_work_item_defaults()
-- constraint: work_items_one_source ON projects.work_items
-- constraint: work_items_source_required ON projects.work_items
-- constraint: work_items_bic_present ON projects.work_items
-- constraint: work_items_ref_unique ON projects.work_items
-- index: work_items_my_work_idx ON projects.work_items
-- index: work_items_inbox_idx ON projects.work_items
-- index: work_items_project_module_idx ON projects.work_items
-- index: work_items_org_idx ON projects.work_items
-- policy: work_items_select ON projects.work_items
-- policy: work_items_insert ON projects.work_items
-- policy: work_items_insert_gate ON projects.work_items
-- policy: work_items_update ON projects.work_items
-- policy: work_items_update_gate ON projects.work_items
-- policy: work_item_events_select ON projects.work_item_events
-- grant_absent: anon SELECT ON projects.work_items
-- grant_absent: anon SELECT ON projects.work_item_types
-- grant_absent: anon SELECT ON projects.work_item_events
-- grant_absent: anon SELECT ON projects.work_item_watchers
-- grant_absent: anon EXECUTE ON projects.user_can_read_work_item(uuid)
-- grant_absent: anon EXECUTE ON projects.user_can_write_work_item(uuid,text)
-- grant_absent: anon EXECUTE ON projects.add_working_days(date,int,uuid,text)
-- sql: SELECT count(*) = 8 FROM projects.work_item_types WHERE is_active
-- @verify:end

-- ─── 1. projects.work_item_types — the registry ──────────────────────────────
-- Columns are Appendix A(b)'s, exactly. A ref_prefix column was rejected: §12
-- §(h) test 1 asserts this column set, and the prefix lives as a CASE inside
-- projects.work_items_ensure_ref() (§6) instead, mirrored by REF_PREFIXES in
-- packages/shared/src/work-items/types.ts.
CREATE TABLE IF NOT EXISTS projects.work_item_types (
  key             text PRIMARY KEY,
  label           text NOT NULL,
  source_table    text,                       -- NULL for a sourceless type
  source_column   text,                       -- the module's own owner column
  default_days    int  NOT NULL CHECK (default_days > 0),
  calendar        text NOT NULL CHECK (calendar IN ('office','site')),
  gatekeeper_rule text NOT NULL CHECK (gatekeeper_rule IN ('project_pm','verifier_else_pm','creator')),
  write_roles     text[] NOT NULL CHECK (cardinality(write_roles) > 0),
  sort_order      int  NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true
);

COMMENT ON TABLE projects.work_item_types IS
  'Appendix A(b). A new SOURCELESS type costs one row here and nothing else — which is why '
  'approval (Q3) needs no ALTER on work_items: work_items_source_required already names it. '
  'A new MIRRORED type costs a row, one nullable FK column, one arm on both source CHECKs, one '
  'mirror trigger, one scoped unique index, one arm in work_items_ensure_ref()''s prefix CASE '
  'and one rbac-matrix row.';

-- Appendix A(b), Q1 rows. write_roles mirrors the role constant each module
-- already uses (packages/shared/src/types/index.ts:36-92), so nothing here is
-- invented:
--   rfi/diary_action/task -> MARKUP_WRITE_ROLES   snag -> SNAG_FIELD_ROLES
--   qc_defect -> QC_WRITE_ROLES                   form_action -> FORMS_FIELD_ROLES
--   inspection/order_followup -> ORG_WRITE_ROLES
-- NO type admits client_viewer in Q1 (§03 §1.9); the Watcher-tier write set
-- lands in Q3.
INSERT INTO projects.work_item_types
  (key, label, source_table, source_column, default_days, calendar, gatekeeper_rule, write_roles, sort_order)
VALUES
  ('rfi',            'RFI',             'projects.rfis',               'assigned_to',    7,  'office', 'project_pm',       ARRAY['owner','admin','project_manager','contractor'],                       1),
  ('snag',           'Snag',            'field.snags',                 'assigned_to',    5,  'site',   'project_pm',       ARRAY['owner','admin','project_manager','contractor','inspector','supplier'], 2),
  ('qc_defect',      'QC defect',       'projects.qc_entries',          NULL,            5,  'site',   'project_pm',       ARRAY['owner','admin','project_manager','contractor'],                       3),
  ('inspection',     'Inspection',      'inspections.inspections',     'assigned_to_id', 3,  'site',   'verifier_else_pm', ARRAY['owner','admin','project_manager'],                                    4),
  ('diary_action',   'Diary action',    'projects.site_diary_entries',  NULL,            2,  'site',   'project_pm',       ARRAY['owner','admin','project_manager','contractor'],                       5),
  ('form_action',    'Form action',     'field.site_forms',             NULL,            3,  'site',   'project_pm',       ARRAY['owner','admin','project_manager','contractor','inspector','supplier'], 6),
  ('order_followup', 'Order follow-up', 'structure.node_orders',        NULL,            10, 'office', 'project_pm',       ARRAY['owner','admin','project_manager'],                                    7),
  ('task',           'Task',             NULL,                          NULL,            5,  'office', 'creator',          ARRAY['owner','admin','project_manager','contractor'],                       8)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE projects.work_item_types ENABLE ROW LEVEL SECURITY;

-- Read-only to every authenticated user: the registry is a vocabulary, not data,
-- and the create forms need it. NO write policy — it is migration-managed, so a
-- row insert can never grant a class of work a write set without a code review.
CREATE POLICY work_item_types_select ON projects.work_item_types
  FOR SELECT TO authenticated USING (true);
```

- [ ] **Step 4: Run it and watch it pass — except assertion 5.**

```bash
scripts/db/try-work-item-spine.sh scripts/db/assertions/work-item-registry.sql
```

Assertion 5 will still fail: the `anon` revoke lands in Task 9 §10. Confirm the failure message is exactly `anon can SELECT projects.work_item_types` — that is `00025_grant_schema_permissions.sql:26`'s `ALTER DEFAULT PRIVILEGES` doing precisely what §12 §(a) warns about, and seeing it fail here is the point. Comment assertion 5 out with a `-- TODO(Task 9)` marker and re-run; assertions 1–4 must pass.

- [ ] **Step 5: Mutation proof — drop a type and watch assertion 1 fail.** Delete the `task` row from the `VALUES` list, re-run, and confirm the failure names the seven-key array. Restore it. Then change `rfi`'s `7` to `5`, re-run, and confirm assertion 2 fails with `A(b) mismatch on rfi: expected 7wd/office/project_pm`. Restore and re-run to green.

- [ ] **Step 6: Commit.**

```bash
git add apps/edge-functions/supabase/migrations/00192_work_item_spine.sql \
        scripts/db/assertions/work-item-registry.sql
git commit -m "feat(work-items): the type registry, seeded with A(b)'s eight Q1 types

projects.work_item_types with A(b)'s exact column set (no ref_prefix column —
the prefix is a CASE inside the allocator, mirrored by REF_PREFIXES in
@esite/shared). write_roles mirrors the existing shared role constant per
module; no type admits client_viewer in Q1. structure.node_orders is seeded as a
source_table but gets no projection trigger: order_followup is explicit chase
only, and a seventh trigger would project all 440 live procurement rows into
inboxes on day one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5 — Preconditions, `projects.work_items` (A(a)), the index set, events and watchers (§0, §2–§4)

⚠ **`ball_in_court_id` is a `STORED` generated column and it is legal Postgres.** The expression is a `CASE` over three columns **of the same row** and calls nothing — no subquery, no function over another table, no volatility. §12's earlier objection ("a `GENERATED` column cannot call a resolver") and §02's ("subqueries are rejected outright") are both correct about a **different** design — one that derives the holder by walking child tables or a settings cascade — and neither applies here. Both objections are withdrawn in §12 §(a) and A(a). `projects.resolve_ball_in_court()` in Q4 is a separate function with a separate job. **Do not replace this with a trigger.** It is generated precisely so it cannot drift, cannot be forged by a direct PostgREST write, and can be sorted and filtered offline by a PowerSync device with no resolver to reimplement (§12 §(g)).

⚠ **`work_item_events` carries three columns A(a) does not show, and they are load-bearing metrics infrastructure.** `from_ball_in_court_id` / `to_ball_in_court_id` are metric 5's denominator ("work items that entered the caller's ball-in-court that week, counted off `projects.work_item_events`"), and `actor_role` is §15 §(b)'s "effective role stamped **at event time**, not re-resolved later" — the only first-party evidence that the spine reached the 13 contractor accounts, since `email_sequences.opened_at`/`clicked_at` have never been written by anything. **None of the three can be backfilled**: the event stream is the only record of what a row used to be. Improvements 2 and 3.

**Files:**
- Modify: `apps/edge-functions/supabase/migrations/00192_work_item_spine.sql` (append sections 0 and 2–4)
- Create: `scripts/db/assertions/work-item-ddl.sql`

- [ ] **Step 1: Write the assertion file first.** Every one of the five constraints gets an assertion that *attempts the violation*, because "the table was created" always passes and proves nothing.

Create `scripts/db/assertions/work-item-ddl.sql`:

```sql
DO $$
DECLARE v_proj uuid; v_org uuid; v_pm uuid; v_rfi uuid; v_snag uuid; v_id uuid; n int; ok boolean;
BEGIN
  SELECT p.id, p.organisation_id INTO v_proj, v_org
    FROM projects.projects p WHERE p.status='active' ORDER BY p.created_at LIMIT 1;
  v_pm := projects.resolve_project_pm(v_proj);

  -- Seed the calendar years this file's inserts walk into. EVERY assertion file
  -- carries this prelude, because every insert runs work_items_set_due_date ->
  -- add_working_days, which raises no_data_found on an unseeded year — and a
  -- run in late December pushes the scan window into the following year.
  INSERT INTO projects.calendar_years (year)
  VALUES (EXTRACT(YEAR FROM CURRENT_DATE)::int), (EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)
  ON CONFLICT DO NOTHING;

  -- Source fixtures. RAISE rather than skip: a LIMIT 1 that returns nothing
  -- turns three constraint proofs into no-ops with a green tick.
  SELECT r.id INTO v_rfi FROM projects.rfis r WHERE r.project_id = v_proj LIMIT 1;
  IF v_rfi IS NULL THEN
    RAISE EXCEPTION 'no rfi on project % — work_items_one_source, the per-source partial UNIQUE and the split case cannot fail and would be decorative', v_proj;
  END IF;
  SELECT s.id INTO v_snag FROM field.snags s LIMIT 1;
  IF v_snag IS NULL THEN
    RAISE EXCEPTION 'no snag anywhere — the two-source violation in assertion 4 cannot be constructed';
  END IF;

  -- 1. A minimal legal row inserts, and every derived column is populated.
  --    status defaults to 'triage' AT THE COLUMN LEVEL, deliberately: the
  --    database cannot tell whether an assignee was chosen or resolved. §03
  --    §1.6's "born open when an assignee was named" is enforced where that
  --    fact is known — createWorkItemTaskAction (Task 13) and item 3's mirror
  --    triggers both supply status explicitly.
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (v_org, v_proj, 'task', 'assert row', v_pm, v_pm, v_pm)
  RETURNING id INTO v_id;

  SELECT ball_in_court_id = assignee_id AND due_date IS NOT NULL
     AND ref IS NOT NULL AND status='triage' AND origin='mirror' AND priority='medium'
    INTO ok FROM projects.work_items WHERE id = v_id;
  IF NOT ok THEN RAISE EXCEPTION 'defaults/generated columns wrong on a fresh row'; END IF;

  -- 2. work_items_bic_present — ball-in-court is generated, so this asserts the
  --    CASE, not a stored value. answered must point at the GATEKEEPER, which is
  --    the case the whole primitive exists for (§12 §(h)).
  UPDATE projects.work_items SET status='open'     WHERE id=v_id;
  SELECT ball_in_court_id = assignee_id   INTO ok FROM projects.work_items WHERE id=v_id;
  IF NOT ok THEN RAISE EXCEPTION 'open: ball_in_court must be the assignee'; END IF;
  UPDATE projects.work_items SET status='answered' WHERE id=v_id;
  SELECT ball_in_court_id = gatekeeper_id INTO ok FROM projects.work_items WHERE id=v_id;
  IF NOT ok THEN RAISE EXCEPTION 'answered: ball_in_court must be the GATEKEEPER, not the assignee'; END IF;

  -- 3. ball_in_court_id has NO write path at all. A generated column rejects a
  --    direct write, which is why §12 §(b) rule 4 needs no attribution guard for it.
  BEGIN
    EXECUTE format('UPDATE projects.work_items SET ball_in_court_id = %L WHERE id = %L', v_pm, v_id);
    RAISE EXCEPTION 'ball_in_court_id accepted a direct write';
  EXCEPTION WHEN generated_always THEN NULL; END;

  -- 4. work_items_one_source — two sources on one row is refused.
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by,
       rfi_id, snag_id)
    VALUES (v_org, v_proj, 'rfi', 'two sources', v_pm, v_pm, v_pm, v_rfi, v_snag);
    RAISE EXCEPTION 'work_items_one_source did not fire on two source columns';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 5. work_items_source_required — a MIRRORED type with no source is refused,
  --    while task/approval and any void row stay legal.
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
    VALUES (v_org, v_proj, 'rfi', 'sourceless rfi', v_pm, v_pm, v_pm);
    RAISE EXCEPTION 'work_items_source_required did not fire on a sourceless rfi';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 6. work_items_ref_unique — the same ref twice on one project is refused.
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, ref)
    SELECT v_org, v_proj, 'task', 'dupe ref', v_pm, v_pm, v_pm, ref
      FROM projects.work_items WHERE id = v_id;
    RAISE EXCEPTION 'work_items_ref_unique did not fire on a duplicate ref';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- 7. The per-source partial UNIQUE is idempotent for mirrors but permits a
  --    deliberate split — which is what makes two people on one source possible
  --    while an accidental double-mirror is not (§03 §1.3).
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, rfi_id, origin)
  VALUES (v_org, v_proj, 'rfi', 'mirror', v_pm, v_pm, v_pm, v_rfi, 'mirror');
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, rfi_id, origin)
    VALUES (v_org, v_proj, 'rfi', 'double mirror', v_pm, v_pm, v_pm, v_rfi, 'mirror');
    RAISE EXCEPTION 'a second mirror row on one rfi_id was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, rfi_id, origin)
  VALUES (v_org, v_proj, 'rfi', 'deliberate split', v_pm, v_pm, v_pm, v_rfi, 'split');

  -- 8. The four A(a) indexes exist under the names the Inbox and My Work read.
  SELECT count(*) INTO n FROM pg_indexes
   WHERE schemaname='projects' AND tablename='work_items'
     AND indexname IN ('work_items_my_work_idx','work_items_inbox_idx',
                       'work_items_project_module_idx','work_items_org_idx');
  IF n <> 4 THEN RAISE EXCEPTION 'expected A(a)''s 4 named indexes, found %', n; END IF;

  -- 9. work_item_events carries a SELECT policy and NO write policy (§12 §(a),
  --    the 00179:504-506 shape). An INSERT policy here lets a client forge history.
  --    (The SELECT policy itself is created in §9; here we assert only that no
  --    write policy exists, which is true from the moment the table does.)
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='projects' AND tablename='work_item_events' AND cmd <> 'SELECT';
  IF n <> 0 THEN RAISE EXCEPTION 'work_item_events has % write policy/policies; it must have none', n; END IF;

  -- 10. The three metric columns exist. They cannot be backfilled — the event
  --     stream is the only record of what a row used to be — so a migration
  --     that shipped without them would make metric 5's denominator and metric
  --     2a's role diagnostic permanently unanswerable for every row written
  --     before the fix.
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema='projects' AND table_name='work_item_events'
     AND column_name IN ('from_ball_in_court_id','to_ball_in_court_id','actor_role');
  IF n <> 3 THEN RAISE EXCEPTION 'work_item_events is missing % of the 3 metric columns', 3 - n; END IF;

  -- 11. Nothing anywhere references the Q2 column. Its FK target does not exist.
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema='projects' AND table_name='work_items' AND column_name='instruction_recipient_id';
  IF n <> 0 THEN RAISE EXCEPTION 'instruction_recipient_id is a Q2 column and must not exist yet'; END IF;

  RAISE NOTICE 'work-item-ddl: 11/11 assertions passed';
END $$;
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
scripts/db/try-work-item-spine.sh scripts/db/assertions/work-item-ddl.sql
```

Expected: `relation "projects.work_items" does not exist`. Red.

- [ ] **Step 3: Append sections 0 and 2–4 to `00192_work_item_spine.sql`.**

```sql
-- ─── 0. Preconditions ────────────────────────────────────────────────────────
-- This migration REFUSES TO APPLY against an under-seeded calendar, and that is
-- the point of it.
--
-- add_working_days() raises no_data_found on an unseeded year (A(h) [R24], which
-- forbids a calendar-day fallback outright). It runs inside a BEFORE INSERT
-- trigger on the spine, and from item 3 onward every mirrored source writes
-- through that trigger — so a missed October re-seed does not merely break
-- escalation, it makes raising an RFI, logging a snag or submitting a form fail
-- outright, with an error no support person can act on. The re-seed is a manual
-- annual task (§15 §(b2)) and this programme's own history is cloud-sync-poll:
-- specified, merged, never scheduled, found two months later by users.
--
-- ASSERT, never seed as a side effect: the annual seed is item 1's operational
-- task, and a migration that quietly repaired it would hide the miss.
DO $pre$
DECLARE
  y int := EXTRACT(YEAR FROM (now() AT TIME ZONE 'Africa/Johannesburg'))::int;
  missing int;
BEGIN
  IF to_regclass('projects.calendar_years') IS NULL THEN
    RAISE EXCEPTION 'work-item spine: projects.calendar_years does not exist. Apply the Q1 metrics/calendar migration (A(f) ordinal 1) first.'
      USING ERRCODE = 'undefined_table';
  END IF;

  SELECT count(*) INTO missing
    FROM generate_series(y, y + 2) AS g(yr)
   WHERE NOT EXISTS (SELECT 1 FROM projects.calendar_years cy WHERE cy.year = g.yr);

  IF missing > 0 THEN
    RAISE EXCEPTION 'work-item spine: % of the calendar years %..% are not seeded in projects.calendar_years', missing, y, y + 2
      USING ERRCODE = 'no_data_found',
            HINT = 'Seed them first, then re-apply: INSERT INTO projects.calendar_years (year) SELECT g FROM generate_series(<y>, <y+2>) g ON CONFLICT DO NOTHING; and run item 1''s listHolidays() seeder for each of those years into projects.public_holidays.';
  END IF;
END $pre$;

-- ─── 2. projects.work_items — Appendix A(a), reproduced ──────────────────────
-- Three properties are load-bearing and every dependent section is written
-- against them (A(a)):
--   1. assignee_id is NOT NULL. An item that belongs to nobody cannot exist, so
--      there is no unassigned arm anywhere in the data model.
--   2. due_date is NOT NULL, computed in working days by the BEFORE INSERT
--      trigger against A(h)'s calendar.
--   3. ball_in_court_id is a STORED GENERATED column, null only for closed and
--      void. It is a CASE over three columns OF THE SAME ROW and calls nothing,
--      which is exactly what Postgres permits. It has NO write path at all.
--
-- status DEFAULTS to 'triage'. §03 §1.6's "an item created WITH an explicit
-- assignee is born open" is enforced by the two writers that know whether the
-- assignee was chosen or resolved — createWorkItemTaskAction and item 3's mirror
-- triggers — because the database cannot tell the difference from the row alone.
--
-- instruction_recipient_id (Q2) is deliberately absent, and both source CHECKs
-- omit its term. Q2 re-declares BOTH wholesale in one statement, because
-- DROP CONSTRAINT discards the other one silently.
CREATE TABLE IF NOT EXISTS projects.work_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES public.organisations(id),
  project_id       uuid NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  item_type        text NOT NULL REFERENCES projects.work_item_types(key),
  origin           text NOT NULL DEFAULT 'mirror'
                   CHECK (origin IN ('mirror','split','manual')),
  ref              text NOT NULL,                -- 'RFI-12', per project, per type
  title            text NOT NULL,
  priority         text NOT NULL DEFAULT 'medium'
                   CHECK (priority IN ('low','medium','high','critical')),
  status           text NOT NULL DEFAULT 'triage'
                   CHECK (status IN ('triage','open','answered','closed','void')),
  source_status    text,                         -- display-only mirror of the module's vocabulary
  void_reason      text,
  assignee_id      uuid NOT NULL REFERENCES public.profiles(id),
  gatekeeper_id    uuid NOT NULL REFERENCES public.profiles(id),
  ball_in_court_id uuid GENERATED ALWAYS AS (
                     CASE status
                       WHEN 'triage'   THEN assignee_id
                       WHEN 'open'     THEN assignee_id
                       WHEN 'answered' THEN gatekeeper_id
                       ELSE NULL END) STORED,
  due_date         date NOT NULL,
  opened_at        timestamptz NOT NULL DEFAULT now(),
  closed_at        timestamptz, closed_by uuid REFERENCES public.profiles(id),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL REFERENCES public.profiles(id),
  created_at       timestamptz NOT NULL DEFAULT now(),

  -- Q1 sources. Typed nullable FKs, one per source — never a polymorphic
  -- (schema, table, id) triple: a polymorphic key cannot be enforced, and an
  -- orphaned row in a personal inbox is the worst failure this primitive can
  -- have. ON DELETE SET NULL, never CASCADE: deleting a diary entry is a live
  -- gated action, and a cascade would destroy the events behind metric 4.
  rfi_id        uuid REFERENCES projects.rfis(id)               ON DELETE SET NULL,
  snag_id       uuid REFERENCES field.snags(id)                 ON DELETE SET NULL,
  qc_entry_id   uuid REFERENCES projects.qc_entries(id)         ON DELETE SET NULL,
  diary_id      uuid REFERENCES projects.site_diary_entries(id) ON DELETE SET NULL,
  site_form_id  uuid REFERENCES field.site_forms(id)            ON DELETE SET NULL,
  node_order_id uuid REFERENCES structure.node_orders(id)       ON DELETE SET NULL,
  inspection_id uuid REFERENCES inspections.inspections(id)     ON DELETE SET NULL,

  CONSTRAINT work_items_one_source CHECK (
    (rfi_id IS NOT NULL)::int + (snag_id IS NOT NULL)::int + (qc_entry_id IS NOT NULL)::int
  + (diary_id IS NOT NULL)::int + (site_form_id IS NOT NULL)::int
  + (node_order_id IS NOT NULL)::int + (inspection_id IS NOT NULL)::int <= 1),

  -- 'approval' is named here in Q1 deliberately (§03 §1.2). Relaxing this later
  -- would mean an ALTER on the hottest table on the platform; Q3 should cost a
  -- registry row, not a constraint rewrite.
  CONSTRAINT work_items_source_required CHECK (
    item_type IN ('task','approval') OR status = 'void'
    OR (rfi_id IS NOT NULL)::int + (snag_id IS NOT NULL)::int + (qc_entry_id IS NOT NULL)::int
     + (diary_id IS NOT NULL)::int + (site_form_id IS NOT NULL)::int
     + (node_order_id IS NOT NULL)::int + (inspection_id IS NOT NULL)::int = 1),

  CONSTRAINT work_items_bic_present CHECK (
    status IN ('closed','void') OR ball_in_court_id IS NOT NULL),
  CONSTRAINT work_items_ref_unique UNIQUE (project_id, ref)
);

-- Appendix A(a)'s index set, and nothing else. Keyset pagination is
-- ORDER BY due_date ASC, id ASC with a two-part cursor — there is no NULLS
-- ordering because due_date is NOT NULL and there are no nulls to order.
CREATE INDEX IF NOT EXISTS work_items_my_work_idx
  ON projects.work_items (assignee_id, status, due_date) WHERE status <> 'closed';
CREATE INDEX IF NOT EXISTS work_items_inbox_idx
  ON projects.work_items (ball_in_court_id, due_date) WHERE status IN ('triage','open','answered');
CREATE INDEX IF NOT EXISTS work_items_project_module_idx
  ON projects.work_items (project_id, item_type, status);
CREATE INDEX IF NOT EXISTS work_items_org_idx
  ON projects.work_items (organisation_id);

-- One partial UNIQUE per source column, predicated on origin = 'mirror'. This
-- makes the projection idempotent on retry while leaving a deliberate 'split'
-- row legal and untouched by source-status pushback (§03 §1.2, §1.3).
CREATE UNIQUE INDEX IF NOT EXISTS work_items_src_rfi_uidx        ON projects.work_items (rfi_id)        WHERE rfi_id        IS NOT NULL AND origin = 'mirror';
CREATE UNIQUE INDEX IF NOT EXISTS work_items_src_snag_uidx       ON projects.work_items (snag_id)       WHERE snag_id       IS NOT NULL AND origin = 'mirror';
CREATE UNIQUE INDEX IF NOT EXISTS work_items_src_qc_uidx         ON projects.work_items (qc_entry_id)   WHERE qc_entry_id   IS NOT NULL AND origin = 'mirror';
CREATE UNIQUE INDEX IF NOT EXISTS work_items_src_diary_uidx      ON projects.work_items (diary_id)      WHERE diary_id      IS NOT NULL AND origin = 'mirror';
CREATE UNIQUE INDEX IF NOT EXISTS work_items_src_form_uidx       ON projects.work_items (site_form_id)  WHERE site_form_id  IS NOT NULL AND origin = 'mirror';
CREATE UNIQUE INDEX IF NOT EXISTS work_items_src_order_uidx      ON projects.work_items (node_order_id) WHERE node_order_id IS NOT NULL AND origin = 'mirror';
CREATE UNIQUE INDEX IF NOT EXISTS work_items_src_inspection_uidx ON projects.work_items (inspection_id) WHERE inspection_id IS NOT NULL AND origin = 'mirror';

-- ─── 3. projects.work_item_events — append-only ──────────────────────────────
-- Feeds ball-in-court history, the activity feed and three of the eight metrics:
-- metric 4 (first open -> answered transition), the ball-in-court-arrivals half
-- of metric 5's denominator, and metric 7. NEVER purged (§12 §(f)) — it dies
-- only with its project, by cascade.
CREATE TABLE IF NOT EXISTS projects.work_item_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id    uuid NOT NULL REFERENCES projects.work_items(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES projects.projects(id)   ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES public.organisations(id),
  verb            text NOT NULL CHECK (verb IN
                    ('created','assigned','reassigned','status_changed','due_changed','closed','voided')),
  from_status     text, to_status   text,
  from_user_id    uuid REFERENCES public.profiles(id),
  to_user_id      uuid REFERENCES public.profiles(id),
  from_due_date   date, to_due_date date,

  -- Metric 5's denominator is "work items that entered the caller's ball-in-court
  -- that week, counted off projects.work_item_events" (§15 metric 5). Without
  -- these two columns that number can only be reconstructed from the row's
  -- CURRENT gatekeeper_id — which is precisely the error §15 §(b) forbids, and
  -- it is wrong for every item whose gatekeeper was ever corrected.
  from_ball_in_court_id uuid REFERENCES public.profiles(id),
  to_ball_in_court_id   uuid REFERENCES public.profiles(id),

  -- The actor, from auth.uid() inside the definer trigger — NEVER current_user,
  -- which resolves to the function owner. NULL for a service-role path.
  actor_id        uuid REFERENCES public.profiles(id),
  -- §15 §(b): "the effective role stamped AT EVENT TIME, not re-resolved later".
  -- Metric 2a's diagnostic — the share of contractor-held items that moved —
  -- is the only first-party evidence the spine reached the 13 contractor
  -- accounts, because email engagement is unmeasurable: 246 automated emails
  -- have been sent and email_sequences.opened_at/clicked_at are NULL on every
  -- row, the Resend webhook of 00030:24-25 having never been built.
  actor_role      text,

  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS work_item_events_item_idx
  ON projects.work_item_events (work_item_id, created_at);

-- ─── 4. projects.work_item_watchers — notification-only, never blocking ──────
-- Replaces two fan-outs: createRfiAction bells every active project member
-- (rfi.actions.ts:84-95) and emails the same roster (:98-105). Together with the
-- diary path those produce the 964 notifications of which 57 have ever been read.
-- Auto-populated by projects.append_work_item_event() (§11) on create and on
-- every reassignment — §03 §1.8's "auto-populated on create, assign and
-- @mention", minus the @mention half, which arrives with threads.
CREATE TABLE IF NOT EXISTS projects.work_item_watchers (
  work_item_id uuid NOT NULL REFERENCES projects.work_items(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.profiles(id)     ON DELETE CASCADE,
  reason       text NOT NULL CHECK (reason IN ('creator','raiser','assignee','gatekeeper','mention','manual')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (work_item_id, user_id)
);

ALTER TABLE projects.work_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.work_item_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.work_item_watchers ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 4: Run it.** Assertions 1–7 will fail with `null value in column "ref"` / `"due_date"` — the two `BEFORE INSERT` triggers do not exist yet. **This is the correct red for Tasks 6 and 7**; confirm the message names `due_date` or `ref` and nothing else. Assertions 8–11 pass. Do not add a column default to make it go away — a defaulted `due_date` is precisely the "item without a target date" Aconex's mandatory response-required forbids.

- [ ] **Step 5: Prove section 0 can fail.** Temporarily change `generate_series(y, y + 2)` to `generate_series(y, y + 40)` and re-run any assertion file. Expected: the migration aborts with `work-item spine: N of the calendar years …–… are not seeded`, and the HINT names the re-seed command. Restore `y + 2`. Record it — this is the guard that turns a missed annual seed from a platform-wide write outage into a migration that will not apply.

- [ ] **Step 6: Commit.**

```bash
git add apps/edge-functions/supabase/migrations/00192_work_item_spine.sql \
        scripts/db/assertions/work-item-ddl.sql
git commit -m "feat(work-items): calendar precondition, the spine table, A(a)'s indexes, events and watchers

work_items reproduced from Appendix A(a) with the Q2 instruction_recipient_id
column omitted and both source CHECKs written without its term (Q2 re-declares
both wholesale). ball_in_court_id is STORED GENERATED — a CASE over three
columns of the same row, calling nothing — so it cannot drift and has no write
path. Seven partial UNIQUEs keep the projection idempotent while leaving a
deliberate 'split' row legal.

work_item_events carries from_ball_in_court_id/to_ball_in_court_id (metric 5's
denominator) and actor_role stamped at event time (§15 §(b), metric 2a's only
first-party signal — email engagement is unmeasurable, the Resend webhook of
00030:24-25 was never built). None of the three can be backfilled.

Section 0 refuses to apply unless the calendar is seeded three years out: the
due-date trigger raises no_data_found on an unseeded year and every mirrored
source writes through it, so a missed October re-seed would stop anyone raising
an RFI or logging a snag.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6 — `add_working_days()`, the shutdown push and the `BEFORE INSERT` due-date trigger (§5)

⚠ **`projects.add_working_days()` is created here, not by item 1.** A(h) names exactly three database objects for item 1's migration — `public_holidays`, `calendar_years`, `working_days_between()` — and `working_days_between` counts days between two dates. The due-date trigger needs the inverse. Step 1 asserts the function does **not** already exist, so if item 1's lane added it you find out before writing a duplicate.

⚠ **`working_days int[]` is read as ISO day-of-week (Mon=1 … Sun=7).** `00101_project_settings.sql:20` defaults it to `ARRAY[1,2,3,4,5]` and A(h) defines `site` as "`office` plus Saturday", so Saturday is 6 and Sunday is 7. **The site calendar therefore works Saturdays, which is the whole point of A(h)'s two calendars** — do not expect a site walk to skip to Monday.

**Files:**
- Modify: `apps/edge-functions/supabase/migrations/00192_work_item_spine.sql` (append section 5)
- Create: `scripts/db/assertions/work-item-due-date.sql`

- [ ] **Step 1: Write the assertion file first.** The fixture question — *what would this have to look like for the test to be able to fail?* — is answered by using **fixed dates**, not `now()`: a test on today's date could pass in June and fail in December.

Create `scripts/db/assertions/work-item-due-date.sql`:

```sql
DO $$
DECLARE v_proj uuid; v_org uuid; v_pm uuid; v_id uuid; d date; n int; d_a date; d_b date;
BEGIN
  -- 0. add_working_days must be OURS. If item 1's lane already shipped one,
  --    stop and reconcile rather than silently redefining it.
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid=p.pronamespace
   WHERE nsp.nspname='projects' AND p.proname='add_working_days';
  IF n <> 1 THEN RAISE EXCEPTION 'expected exactly 1 projects.add_working_days, found %', n; END IF;

  SELECT p.id, p.organisation_id INTO v_proj, v_org
    FROM projects.projects p WHERE p.status='active' ORDER BY p.created_at LIMIT 1;
  v_pm := projects.resolve_project_pm(v_proj);

  -- Seed the years these assertions walk, so the test is about the ARITHMETIC
  -- and not about which years production happens to hold. Rolled back with
  -- everything else. 2026/2027 are the fixed-date assertions; the CURRENT year
  -- and the next are for the trigger assertions at the bottom.
  INSERT INTO projects.calendar_years (year) VALUES (2026),(2027) ON CONFLICT DO NOTHING;
  INSERT INTO projects.calendar_years (year)
  VALUES (EXTRACT(YEAR FROM CURRENT_DATE)::int), (EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)
  ON CONFLICT DO NOTHING;
  INSERT INTO projects.public_holidays (d, name) VALUES
    (DATE '2026-12-16','Day of Reconciliation'), (DATE '2026-12-25','Christmas Day'),
    (DATE '2026-12-26','Day of Goodwill'),       (DATE '2027-01-01','New Year''s Day')
  ON CONFLICT (d) DO NOTHING;

  -- 1. OFFICE calendar skips the weekend. Fri 2026-06-05 + 3 wd = Wed 2026-06-10.
  d := projects.add_working_days(DATE '2026-06-05', 3, v_proj, 'office');
  IF d <> DATE '2026-06-10' THEN RAISE EXCEPTION 'office +3wd from Fri 5 Jun 2026 = %, expected 2026-06-10', d; END IF;

  -- 2. SITE calendar works Saturday, so the same walk lands a day earlier.
  d := projects.add_working_days(DATE '2026-06-05', 3, v_proj, 'site');
  IF d <> DATE '2026-06-09' THEN RAISE EXCEPTION 'site +3wd from Fri 5 Jun 2026 = %, expected 2026-06-09', d; END IF;

  -- 3. Sunday is never a working day on either calendar.
  IF EXTRACT(ISODOW FROM projects.add_working_days(DATE '2026-06-06', 1, v_proj, 'site')) = 7
  THEN RAISE EXCEPTION 'site calendar counted a Sunday'; END IF;

  -- 4. A seeded public holiday is skipped. Tue 2026-12-15 + 1 wd must clear
  --    Wed 16 Dec (Day of Reconciliation) and land Thu 17 Dec.
  d := projects.add_working_days(DATE '2026-12-15', 1, v_proj, 'office');
  IF d <> DATE '2026-12-17' THEN RAISE EXCEPTION 'holiday not skipped: got %', d; END IF;

  -- 5. AN UNSEEDED YEAR RAISES. A(h) forbids a calendar-day fallback outright,
  --    because a silent one-day drift changes whether an item escalates.
  DELETE FROM projects.calendar_years WHERE year = 2031;
  BEGIN
    PERFORM projects.add_working_days(DATE '2031-03-01', 5, v_proj, 'office');
    RAISE EXCEPTION 'add_working_days silently computed against an unseeded year';
  EXCEPTION WHEN no_data_found THEN NULL; END;

  -- 6. p_days = 0 is REFUSED. Accepting it would return p_from unchanged even
  --    when p_from is a Sunday or a public holiday — a non-working day handed
  --    back with no error.
  BEGIN
    PERFORM projects.add_working_days(DATE '2026-06-07', 0, v_proj, 'office');
    RAISE EXCEPTION 'add_working_days accepted p_days = 0 and returned a Sunday';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- 7. An empty working_days array raises rather than looping forever — on BOTH
  --    calendars. The site arm appends Saturday, so a check placed after that
  --    append would silently turn an empty array into a Saturday-only calendar
  --    and this assertion is the only thing that catches it.
  UPDATE projects.project_settings SET working_days = ARRAY[]::int[] WHERE project_id = v_proj;
  BEGIN
    PERFORM projects.add_working_days(DATE '2026-06-05', 1, v_proj, 'office');
    RAISE EXCEPTION 'an empty working_days array did not raise on the office calendar';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM projects.add_working_days(DATE '2026-06-05', 1, v_proj, 'site');
    RAISE EXCEPTION 'an empty working_days array did not raise on the SITE calendar';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  UPDATE projects.project_settings SET working_days = ARRAY[1,2,3,4,5] WHERE project_id = v_proj;

  -- 8. THE DECEMBER SHUTDOWN. A due date inside 15 Dec - 15 Jan is pushed to the
  --    first SITE working day after the window. Fri 2027-01-15 + 1 site working
  --    day is SAT 2027-01-16 — the site calendar works Saturdays, which is the
  --    whole point of A(h)'s two calendars.
  UPDATE projects.project_settings
     SET builders_holiday = true, builders_shutdown_start_md='12-15', builders_shutdown_end_md='01-15'
   WHERE project_id = v_proj;
  d := projects.push_past_builders_shutdown(DATE '2026-12-20', v_proj);
  IF d <> DATE '2027-01-16' THEN RAISE EXCEPTION 'a 20 Dec due date was pushed to % — expected Sat 2027-01-16', d; END IF;
  -- A January date inside the window is pushed by the PREVIOUS year's band.
  IF projects.push_past_builders_shutdown(DATE '2027-01-05', v_proj) <> DATE '2027-01-16'
  THEN RAISE EXCEPTION '5 Jan was not recognised as inside the previous December''s band'; END IF;
  -- A date outside the window is untouched.
  IF projects.push_past_builders_shutdown(DATE '2026-06-10', v_proj) <> DATE '2026-06-10'
  THEN RAISE EXCEPTION 'a June date was pushed'; END IF;
  -- builders_holiday = false disables it entirely, and it STAYS false for the
  -- trigger assertions below. Leaving it on would make assertions 9 and 10
  -- season-dependent: run in December, a 5-working-day and a 1-working-day
  -- offset both land inside the shutdown and get pushed to the SAME January
  -- date, so `d_b < d_a` would fail in December and pass in June — the exact
  -- fixture failure this plan's rule is written against.
  UPDATE projects.project_settings SET builders_holiday = false WHERE project_id = v_proj;
  IF projects.push_past_builders_shutdown(DATE '2026-12-20', v_proj) <> DATE '2026-12-20'
  THEN RAISE EXCEPTION 'the push ran with builders_holiday = false'; END IF;

  -- 9. THE TRIGGER. An insert that passes NO date gets one — that is the §03 §1.5
  --    "path that passed no date at all" case, and due_date NOT NULL always holds.
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (v_org, v_proj, 'task', 'no date supplied', v_pm, v_pm, v_pm) RETURNING id INTO v_id;
  SELECT due_date INTO d_a FROM projects.work_items WHERE id = v_id;
  IF d_a IS NULL OR d_a <= CURRENT_DATE THEN RAISE EXCEPTION 'trigger did not compute a future due_date: %', d_a; END IF;

  -- 10. The per-project override in work_item_defaults beats the registry default.
  UPDATE projects.project_settings
     SET work_item_defaults = jsonb_build_object('task',
           jsonb_build_object('days_to_respond', 1, 'triage_owner_id', NULL, 'gatekeeper_id', NULL))
   WHERE project_id = v_proj;
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (v_org, v_proj, 'task', 'one day', v_pm, v_pm, v_pm) RETURNING id INTO v_id;
  SELECT due_date INTO d_b FROM projects.work_items WHERE id = v_id;
  IF d_b >= d_a THEN
    RAISE EXCEPTION 'work_item_defaults.days_to_respond did not override the registry default (% vs %)', d_b, d_a;
  END IF;

  -- 11. A SUPPLIED due date is respected...
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, due_date)
  VALUES (v_org, v_proj, 'task', 'supplied date', v_pm, v_pm, v_pm, DATE '2026-06-10')
  RETURNING id INTO v_id;
  IF (SELECT due_date FROM projects.work_items WHERE id=v_id) <> DATE '2026-06-10'
  THEN RAISE EXCEPTION 'a supplied due_date was overwritten'; END IF;

  -- 11b. ...and is STILL pushed past the shutdown. The point of the push is that
  --      nobody is on site to do the work, which is true however the date arrived.
  UPDATE projects.project_settings SET builders_holiday = true WHERE project_id = v_proj;
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, due_date)
  VALUES (v_org, v_proj, 'task', 'supplied shutdown date', v_pm, v_pm, v_pm, DATE '2026-12-20')
  RETURNING id INTO v_id;
  IF (SELECT due_date FROM projects.work_items WHERE id=v_id) <> DATE '2027-01-16'
  THEN RAISE EXCEPTION 'a supplied 20 Dec due date was not pushed to Sat 2027-01-16, got %',
       (SELECT due_date FROM projects.work_items WHERE id=v_id); END IF;
  UPDATE projects.project_settings SET builders_holiday = false WHERE project_id = v_proj;

  -- 12. An unregistered item_type cannot reach the trigger at all — the FK to
  --     work_item_types(key) refuses it first.
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
    VALUES (v_org, v_proj, 'not_a_type', 'bogus', v_pm, v_pm, v_pm);
    RAISE EXCEPTION 'an unregistered item_type was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;

  RAISE NOTICE 'work-item-due-date: 14/14 assertions passed';
END $$;
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
scripts/db/try-work-item-spine.sh scripts/db/assertions/work-item-due-date.sql
```

Expected: assertion 0 raises `expected exactly 1 projects.add_working_days, found 0`. Red.

- [ ] **Step 3: Append section 5 to `00192_work_item_spine.sql`.**

```sql
-- ─── 5. The working-day arithmetic and the due-date trigger ──────────────────
-- A(h) supplies projects.public_holidays, projects.calendar_years and
-- working_days_between() (item 1's migration). add_working_days is the INVERSE
-- and lives here, because the due-date trigger needs to ADD days, not count them.
--
-- STABLE, never IMMUTABLE: it reads two tables, and marking it immutable would
-- let the planner fold a result across an October calendar refresh (A(h)).
-- working_days is read as ISO day-of-week (Mon=1 .. Sun=7), matching
-- 00101_project_settings.sql:20's ARRAY[1,2,3,4,5] default; `site` adds 6.
CREATE OR REPLACE FUNCTION projects.add_working_days(
  p_from date, p_days int, p_project uuid, p_calendar text
) RETURNS date
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'projects', 'public'
SET row_security TO 'off'
AS $fn$
DECLARE
  v_days int[]; v_extra date[]; v_cursor date := p_from; v_left int := p_days;
  v_limit date; y int;
BEGIN
  IF p_calendar NOT IN ('office','site') THEN
    RAISE EXCEPTION 'add_working_days: unknown calendar %; A(h) defines exactly office and site', p_calendar
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- p_days = 0 is refused rather than defined. "Return p_from unchanged" would
  -- hand back a Sunday or a public holiday with no error; "return the first
  -- working day on or after p_from" is a different function and nothing calls it.
  IF p_days IS NULL OR p_days < 1 THEN
    RAISE EXCEPTION 'add_working_days: p_days must be >= 1, got %', p_days
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT ps.working_days, ps.extra_holidays INTO v_days, v_extra
    FROM projects.project_settings ps WHERE ps.project_id = p_project;
  IF v_days IS NULL THEN                       -- no settings row yet
    v_days := ARRAY[1,2,3,4,5]; v_extra := ARRAY[]::date[];
  END IF;

  -- The empty-array check comes BEFORE the Saturday append. After it, an empty
  -- working_days array would silently become a Saturday-only calendar on the
  -- site path — a wrong answer instead of an error.
  IF cardinality(v_days) = 0 THEN
    RAISE EXCEPTION 'add_working_days: project % has an empty working_days array; no date can ever be reached', p_project
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_calendar = 'site' AND NOT (6 = ANY (v_days)) THEN
    v_days := v_days || 6;                     -- A(h): site = office + Saturday
  END IF;

  -- Generous upper bound: at most ~2.4 calendar days per working day, plus a
  -- month of shutdown. Used both to bound the loop and to fix the year range.
  v_limit := p_from + (p_days * 3 + 45);

  -- Every year the walk can touch must be seeded. An unseeded year RAISES —
  -- there is no fallback to calendar days (A(h)), because a silent one-day
  -- drift changes whether an item escalates. The HINT names the re-seed,
  -- because this error surfaces to an operator through a failed source write.
  FOR y IN EXTRACT(YEAR FROM p_from)::int .. EXTRACT(YEAR FROM v_limit)::int LOOP
    IF NOT EXISTS (SELECT 1 FROM projects.calendar_years cy WHERE cy.year = y) THEN
      RAISE EXCEPTION USING ERRCODE = 'no_data_found',
        MESSAGE = format('add_working_days: calendar year %s is not seeded in projects.calendar_years', y),
        HINT    = format('Seed it: INSERT INTO projects.calendar_years (year) VALUES (%s) ON CONFLICT DO NOTHING; then load that year''s public holidays from listHolidays(%s). A(h) forbids falling back to calendar days.', y, y);
    END IF;
  END LOOP;

  WHILE v_left > 0 LOOP
    v_cursor := v_cursor + 1;
    IF v_cursor > v_limit THEN
      RAISE EXCEPTION 'add_working_days: no working day found within % days of %', v_limit - p_from, p_from
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF EXTRACT(ISODOW FROM v_cursor)::int = ANY (v_days)
       AND NOT EXISTS (SELECT 1 FROM projects.public_holidays h WHERE h.d = v_cursor)
       AND NOT (v_cursor = ANY (COALESCE(v_extra, ARRAY[]::date[])))
    THEN
      v_left := v_left - 1;
    END IF;
  END LOOP;
  RETURN v_cursor;
END;
$fn$;

-- A(h): "A due date landing inside the December builders' shutdown is pushed to
-- the first site working day of the new year; the shutdown window is a
-- per-project setting." Gated by the EXISTING builders_holiday boolean
-- (00101:23), so a project that does not shut down is untouched.
CREATE OR REPLACE FUNCTION projects.push_past_builders_shutdown(p_date date, p_project uuid)
RETURNS date
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'projects', 'public'
SET row_security TO 'off'
AS $fn$
DECLARE v_on boolean; v_start text; v_end text; y int; band_start date; band_end date;
BEGIN
  SELECT ps.builders_holiday, ps.builders_shutdown_start_md, ps.builders_shutdown_end_md
    INTO v_on, v_start, v_end
    FROM projects.project_settings ps WHERE ps.project_id = p_project;
  IF NOT COALESCE(v_on, false) THEN RETURN p_date; END IF;

  -- Two bands, because the window wraps the year end: a January date belongs to
  -- the PREVIOUS December's band, a December date to its own.
  FOR y IN EXTRACT(YEAR FROM p_date)::int - 1 .. EXTRACT(YEAR FROM p_date)::int LOOP
    band_start := to_date(y::text       || '-' || v_start, 'YYYY-MM-DD');
    band_end   := to_date((y + 1)::text || '-' || v_end,   'YYYY-MM-DD');
    IF p_date BETWEEN band_start AND band_end THEN
      RETURN projects.add_working_days(band_end, 1, p_project, 'site');
    END IF;
  END LOOP;
  RETURN p_date;
END;
$fn$;

-- BEFORE INSERT due-date trigger.
--
-- SECURITY DEFINER with row_security off, and that is deliberate: it computes a
-- value, it authorises nothing, and it must produce the same date whether the
-- caller is a contractor who cannot read project_settings under their own RLS or
-- the service client. It never reads current_user. Contrast the transition guard
-- (§12), which IS an authorisation decision.
--
-- There is no calendar-day fallback. §03 §1.5's "calendar-day fallback" sentence
-- is about a path that supplies no date getting one computed rather than failing;
-- A(h) [R24] governs the unseeded-year case and forbids the fallback outright.
CREATE OR REPLACE FUNCTION projects.work_items_set_due_date() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'projects', 'public'
SET row_security TO 'off'
AS $fn$
DECLARE
  v_days int; v_cal text; v_defaults jsonb; v_rfi_default int; v_override int;
BEGIN
  SELECT t.default_days, t.calendar INTO v_days, v_cal
    FROM projects.work_item_types t WHERE t.key = NEW.item_type;
  IF v_days IS NULL THEN
    RAISE EXCEPTION 'There is no work-item type called "%". Pick one of the registered types.', NEW.item_type
      USING ERRCODE = 'raise_exception';
  END IF;

  SELECT ps.work_item_defaults, ps.default_rfi_due_days
    INTO v_defaults, v_rfi_default
    FROM projects.project_settings ps WHERE ps.project_id = NEW.project_id;

  v_override := NULLIF(v_defaults -> NEW.item_type ->> 'days_to_respond', '')::int;

  -- The rfi arm reads project_settings.default_rfi_due_days LIVE (00101:30),
  -- never a copy taken at migration time. The settings surface writes that
  -- column and does not touch work_item_defaults, so a copy would be correct
  -- only until the first PM edited it — and §13 requires rfi to read the
  -- existing default, not a snapshot of it. work_item_defaults.rfi is therefore
  -- seeded with a NULL days_to_respond (§13), and a per-project OVERRIDE typed
  -- into that key still wins, which is the whole point of the key existing.
  v_days := COALESCE(
    v_override,
    CASE WHEN NEW.item_type = 'rfi' THEN v_rfi_default END,
    v_days);

  IF NEW.due_date IS NULL THEN
    BEGIN
      NEW.due_date := projects.add_working_days(
        (now() AT TIME ZONE 'Africa/Johannesburg')::date, v_days, NEW.project_id, v_cal);
    EXCEPTION WHEN no_data_found THEN
      -- Re-raise with copy an operator can act on. The original message names
      -- the year; this one names the consequence, because this error reaches a
      -- foreman trying to log a snag.
      RAISE EXCEPTION 'The working-day calendar has not been set up far enough ahead, so a due date cannot be worked out. Ask an administrator to load the public holidays for this year and the next two.'
        USING ERRCODE = 'no_data_found', HINT = SQLERRM;
    END;
  END IF;

  -- Applied to a supplied date as well as a computed one: the point of the push
  -- is that nobody is on site to do the work, which is true however the date arrived.
  NEW.due_date := projects.push_past_builders_shutdown(NEW.due_date, NEW.project_id);
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS work_items_set_due_date_trg ON projects.work_items;
CREATE TRIGGER work_items_set_due_date_trg
  BEFORE INSERT ON projects.work_items
  FOR EACH ROW EXECUTE FUNCTION projects.work_items_set_due_date();
```

- [ ] **Step 4: Run it.** Assertions 0–8 pass. Everything from 9 on still fails with `null value in column "ref"` — Task 7's allocator. Confirm the failure names `ref` and not `due_date`.

- [ ] **Step 5: Mutation proof — remove the unseeded-year guard.** Delete the `FOR y IN … RAISE` block, re-run, and confirm assertion 5 fails with `add_working_days silently computed against an unseeded year`. Restore and re-run. This is the assertion that stands between the product and a silent one-day drift on every escalation.

- [ ] **Step 6: Mutation proof — disable the Saturday arm.** Delete the `IF p_calendar = 'site' AND NOT (6 = ANY (v_days))` block, re-run, and confirm assertion 2 fails (`site +3wd … expected 2026-06-09`). Restore.

- [ ] **Step 7: Mutation proof — move the empty-array check below the Saturday append.** Swap the two blocks, re-run, and confirm assertion 7's **site** arm fails with `an empty working_days array did not raise on the SITE calendar` while the office arm still passes — the bug that turns an empty calendar into a Saturday-only one, visible only because the assertion exercises both paths. Restore and re-run to green. Record all three in the PR body.

- [ ] **Step 8: Commit.**

```bash
git add apps/edge-functions/supabase/migrations/00192_work_item_spine.sql \
        scripts/db/assertions/work-item-due-date.sql
git commit -m "feat(work-items): working-day arithmetic, shutdown push and the due-date trigger

add_working_days() is the inverse of item 1's working_days_between() and lives
here because the BEFORE INSERT trigger has to ADD days. Two calendars resolved
from the existing project_settings.working_days int[] (office = as stored,
site = office + Saturday). p_days = 0 is refused rather than silently returning
a Sunday, and the empty-array check precedes the Saturday append so an empty
calendar raises instead of becoming Saturday-only. An unseeded calendar year
RAISES no_data_found with a HINT naming the re-seed — A(h) forbids a calendar-day
fallback, because a one-day drift changes whether an item escalates. rfi's due
offset reads project_settings.default_rfi_due_days LIVE, so editing that setting
moves the next RFI instead of drifting from a migration-time copy.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7 — The `ref` allocator and its permanent prefixes (§6)

`ref` numbers **work items, not source rows.** Only `projects.rfis` carries a number today (`rfi_number INTEGER GENERATED ALWAYS AS IDENTITY`, `00002:83`) and that identity is **global, not per-project** — "RFI-12" would not be the twelfth RFI on the project. RFI refs are renumbered per project at backfill; `rfi_number` stays displayed alongside as the module's own identifier.

⚠ **The prefix is a `CASE`, not `upper(item_type)`, and this is the cheapest irreversible decision in the item.** `ref` is immutable by design — the transition guard enforces it, because it is a permanent identifier in emails, PDFs and other people's notes — and §15 §(e) lists work-item ids in client deep links as a one-way door. `upper(item_type)` would ship `QC_DEFECT-7` and `ORDER_FOLLOWUP-3` to a foreman on WhatsApp and to a landlord reading a PDF, permanently, from the first row. A `CASE` inside the allocator adds **no column**, so A(b)'s set-equality test (§12 §(h) test 1) is untouched — which was the only reason a `ref_prefix` column was rejected.

**Files:**
- Modify: `apps/edge-functions/supabase/migrations/00192_work_item_spine.sql` (append section 6)
- Create: `scripts/db/assertions/work-item-ref.sql`

- [ ] **Step 1: Write the assertion file first.**

Create `scripts/db/assertions/work-item-ref.sql`:

```sql
DO $$
DECLARE v_proj uuid; v_org uuid; v_pm uuid; v_rfi uuid; v_a uuid; v_b uuid; r text; n int;
BEGIN
  SELECT p.id, p.organisation_id INTO v_proj, v_org
    FROM projects.projects p WHERE p.status='active' ORDER BY p.created_at LIMIT 1;
  v_pm := projects.resolve_project_pm(v_proj);
  INSERT INTO projects.calendar_years (year)
  VALUES (EXTRACT(YEAR FROM CURRENT_DATE)::int), (EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)
  ON CONFLICT DO NOTHING;

  SELECT r2.id INTO v_rfi FROM projects.rfis r2 WHERE r2.project_id = v_proj LIMIT 1;
  IF v_rfi IS NULL THEN
    RAISE EXCEPTION 'no rfi on project % — the per-type counter assertion cannot fail and would be decorative', v_proj;
  END IF;

  -- 1. The first task on this project is TASK-1, and the counter is per type.
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (v_org, v_proj, 'task', 'first', v_pm, v_pm, v_pm) RETURNING id, ref INTO v_a, r;
  IF r !~ '^TASK-[0-9]+$' THEN RAISE EXCEPTION 'ref % is not <PREFIX>-<n>', r; END IF;

  INSERT INTO projects.work_items (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (v_org, v_proj, 'task', 'second', v_pm, v_pm, v_pm) RETURNING id INTO v_b;
  IF (SELECT regexp_replace(ref,'^.*-','')::int FROM projects.work_items WHERE id=v_b)
     <> (SELECT regexp_replace(ref,'^.*-','')::int FROM projects.work_items WHERE id=v_a) + 1
  THEN RAISE EXCEPTION 'the per-project per-type counter did not advance by 1'; END IF;

  -- 2. A DIFFERENT type on the SAME project starts its own series, under its own
  --    prefix. A single project-wide counter would pass a "ref exists" test.
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, rfi_id)
  VALUES (v_org, v_proj, 'rfi', 'first rfi', v_pm, v_pm, v_pm, v_rfi)
  RETURNING ref INTO r;
  IF r <> 'RFI-1' THEN RAISE EXCEPTION 'the first rfi on this project is %, expected RFI-1', r; END IF;

  -- 3. THE PREFIXES ARE THE SHORT HUMAN ONES, on every registered type. This is
  --    permanent: ref is immutable and travels into emails, PDFs and client deep
  --    links (§15 §(e)). upper(item_type) would have shipped QC_DEFECT-7.
  --    The ugliest case is asserted directly; the rest are covered by the
  --    both-directions contract test in Task 14, which parses this same CASE.
  IF (SELECT prosrc FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid=p.pronamespace
       WHERE nsp.nspname='projects' AND p.proname='work_items_ensure_ref')
     NOT LIKE '%''qc_defect''%THEN%''QC''%'
  THEN RAISE EXCEPTION 'work_items_ensure_ref does not map qc_defect to QC — upper(item_type) would ship QC_DEFECT-7 permanently'; END IF;

  -- ...and every registered key has an arm, so nothing falls through to the
  -- upper(item_type) ELSE.
  SELECT count(*) INTO n FROM projects.work_item_types t
   WHERE (SELECT prosrc FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid=p.pronamespace
           WHERE nsp.nspname='projects' AND p.proname='work_items_ensure_ref')
         NOT LIKE '%WHEN ''' || t.key || '''%';
  IF n <> 0 THEN RAISE EXCEPTION '% registered type(s) have no arm in work_items_ensure_ref''s prefix CASE', n; END IF;

  -- 4. An explicitly supplied ref is respected (item 3's backfill sets refs).
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, ref)
  VALUES (v_org, v_proj, 'task', 'explicit', v_pm, v_pm, v_pm, 'TASK-9999');
  IF NOT EXISTS (SELECT 1 FROM projects.work_items WHERE project_id=v_proj AND ref='TASK-9999')
  THEN RAISE EXCEPTION 'an explicit ref was overwritten'; END IF;

  -- 5. NEVER REUSED. After TASK-9999 the next allocation is 10000, not 3.
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (v_org, v_proj, 'task', 'after the gap', v_pm, v_pm, v_pm) RETURNING ref INTO r;
  IF r <> 'TASK-10000' THEN RAISE EXCEPTION 'ref after TASK-9999 was %, expected TASK-10000', r; END IF;

  -- 6. NEVER DELETED — there is no DELETE policy for authenticated at all, which
  --    is what makes MAX+1 monotonic. (Verified properly in the RLS assertions;
  --    here we assert the policy's absence.)
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='projects' AND tablename='work_items' AND cmd='DELETE';
  IF n <> 0 THEN RAISE EXCEPTION 'work_items has a DELETE policy; refs could then be reused'; END IF;

  RAISE NOTICE 'work-item-ref: 6/6 assertions passed';
END $$;
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
scripts/db/try-work-item-spine.sh scripts/db/assertions/work-item-ref.sql
```

Expected: `null value in column "ref" of relation "work_items" violates not-null constraint`. Red.

- [ ] **Step 3: Append section 6 to `00192_work_item_spine.sql`.**

```sql
-- ─── 6. The ref allocator ────────────────────────────────────────────────────
-- '<PREFIX>-<n>', n per project per type, allocated at insert, never reused.
-- This is the qc_reports_ensure_no pattern (00172:91-105) with
-- UNIQUE (project_id, ref) above it, plus two things it does not have.
--
-- (1) THE PREFIX IS AN EXPLICIT CASE, not upper(item_type). `ref` is immutable
--     (the transition guard, §12) because it is a permanent identifier in
--     emails, PDFs and other people's notes, and §15 §(e) lists work-item ids in
--     client deep links as a one-way door. upper(item_type) yields QC_DEFECT-7
--     and ORDER_FOLLOWUP-3, permanently, from the first row. This CASE adds no
--     COLUMN, so A(b)'s set-equality test is untouched — which was the only
--     reason a ref_prefix column was rejected. Mirrored by REF_PREFIXES in
--     packages/shared/src/work-items/types.ts, and the contract test asserts
--     the two agree.
--
-- (2) The advisory lock. Item 3's backfill inserts ~50 rows in one statement and
--     future mirrors fire concurrently; without it two concurrent inserts read
--     the same MAX and the second dies on work_items_ref_unique.
--     Transaction-scoped, so it releases on commit or rollback with no cleanup.
--
-- MAX + 1 is monotonic here because work_items are NEVER DELETED — there is no
-- DELETE policy for authenticated and the DELETE grant is revoked in §10, so a
-- row leaves the inbox by becoming 'void', never by disappearing.
CREATE OR REPLACE FUNCTION projects.work_items_ensure_ref() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_n int; v_prefix text;
BEGIN
  IF NEW.ref IS NOT NULL AND NEW.ref <> '' THEN RETURN NEW; END IF;

  v_prefix := CASE NEW.item_type
                WHEN 'rfi'            THEN 'RFI'
                WHEN 'snag'           THEN 'SNAG'
                WHEN 'qc_defect'      THEN 'QC'
                WHEN 'inspection'     THEN 'INSP'
                WHEN 'diary_action'   THEN 'DIARY'
                WHEN 'form_action'    THEN 'FORM'
                WHEN 'order_followup' THEN 'ORD'
                WHEN 'task'           THEN 'TASK'
                -- A type registered in a later quarter without an arm here still
                -- gets a working ref rather than a failed insert. Add the arm in
                -- the same migration that registers the type: the contract test
                -- fails the build until you do.
                ELSE pg_catalog.upper(NEW.item_type)
              END;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.project_id::text || ':' || NEW.item_type, 0));

  SELECT pg_catalog.coalesce(
           pg_catalog.max(pg_catalog.nullif(
             pg_catalog.regexp_replace(wi.ref, '^.*-', ''), '')::int), 0) + 1
    INTO v_n
    FROM projects.work_items wi
   WHERE wi.project_id = NEW.project_id AND wi.item_type = NEW.item_type;

  NEW.ref := v_prefix || '-' || v_n::text;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS work_items_ensure_ref_trg ON projects.work_items;
CREATE TRIGGER work_items_ensure_ref_trg
  BEFORE INSERT ON projects.work_items
  FOR EACH ROW EXECUTE FUNCTION projects.work_items_ensure_ref();
```

> **Trigger firing order matters and it is alphabetical.** Postgres fires `BEFORE ROW` triggers in **name** order, so on `projects.work_items` the sequence is `work_items_assert_membership_trg` → `work_items_ensure_ref_trg` → `work_items_set_due_date_trg`. The membership trigger therefore runs **before** `ref` is allocated, which is why its error messages use `COALESCE(NEW.ref, NEW.title)` rather than `NEW.ref` (Task 8).

- [ ] **Step 4: Run it and watch it pass.**

```bash
scripts/db/try-work-item-spine.sh scripts/db/assertions/work-item-ref.sql
scripts/db/try-work-item-spine.sh scripts/db/assertions/work-item-due-date.sql
scripts/db/try-work-item-spine.sh scripts/db/assertions/work-item-ddl.sql
```

All three must now print `✓`.

- [ ] **Step 5: Mutation proof — make the counter project-wide.** Delete `AND wi.item_type = NEW.item_type` from the `SELECT`, re-run, and confirm assertion 2 fails (`the first rfi on this project is RFI-3, expected RFI-1`). Restore.

- [ ] **Step 6: Mutation proof — revert the prefix to `upper(item_type)`.** Replace the whole `CASE` with `pg_catalog.upper(NEW.item_type)`, re-run, and confirm assertion 3 fails naming `qc_defect`. Restore and re-run to green. Record both — this one is worth a line in the PR body precisely because it is invisible until a client reads `QC_DEFECT-7` in a PDF.

- [ ] **Step 7: Commit.**

```bash
git add apps/edge-functions/supabase/migrations/00192_work_item_spine.sql \
        scripts/db/assertions/work-item-ref.sql
git commit -m "feat(work-items): per-project per-type ref allocator with permanent human prefixes

'<PREFIX>-<n>' from an explicit CASE (RFI/SNAG/QC/INSP/DIARY/FORM/ORD/TASK),
MAX+1 under a transaction-scoped advisory lock so item 3's bulk backfill cannot
collide on work_items_ref_unique. The CASE rather than upper(item_type) because
ref is immutable and ends up in emails, PDFs and client deep links (§15 §(e)) —
QC_DEFECT-7 would be permanent from the first row — and it adds no column, so
A(b)'s set-equality test is untouched. Refs are never reused because work_items
are never deleted. An explicitly supplied ref is respected, which is how the
backfill renumbers RFIs per project (rfi_number is global, so RFI-12 would not
be the twelfth).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8 — The assignee resolution chain and the membership assertion (§7)

Two separate guarantees, both belonging to `assignee_id`:

- **An item can never be assigned to someone who cannot open it.** `assignee_id` is an FK to `public.profiles` with no membership predicate, so *any profile in the database* is nominally assignable — including a person in another organisation.
- **A stale settings value must never block a source write.** `work_item_defaults` holds ids in jsonb, so there is no foreign key, and `public.profiles` cascades from `auth.users` (`00001:62`). A departed employee's id survives in the jsonb, and a naïve insert against `assignee_id NOT NULL` would raise, abort the transaction and make it impossible for anyone to raise an RFI on that project. The chain therefore **terminates at the org owner and never raises**.

⚠ **`client_viewer` may be an assignee from Q1 and must not be excluded here.** In a shopping-centre fit-out the landlord frequently *is* the ball-in-court. Their *write* carve-out lands in Q3; until then a gatekeeper moves the item to `answered` on their behalf (§03 §1.9). Excluding them from assignment would mean an item pointed at them can never exist, which is a different and worse bug.

⚠ **The client_viewer fixture is a project that HAS one — not the oldest project.** Measured on 2026-09-10: the oldest active project is `(643) KINGSWALK`, which has 10 active members and **zero** `client_viewer` rows; the four `client_viewer` memberships live on `(657) MAMAILA PHASE 2` (3) and the Sandton demo (1). An `IF v_cv IS NULL THEN RAISE NOTICE … RETURN` on the wrong project is a skip you never see: the Management API `/database/query` endpoint returns **rows only**, so a `NOTICE` never reaches the caller and the harness prints a green `✓`.

**Files:**
- Modify: `apps/edge-functions/supabase/migrations/00192_work_item_spine.sql` (append section 7)
- Create: `scripts/db/assertions/work-item-membership.sql`

- [ ] **Step 1: Write the assertion file first.**

Create `scripts/db/assertions/work-item-membership.sql`:

```sql
DO $$
DECLARE
  v_proj uuid; v_org uuid; v_pm uuid; v_outsider uuid;
  v_cv uuid; v_cv_proj uuid; v_cv_org uuid; v_cv_pm uuid; v_res uuid;
BEGIN
  SELECT p.id, p.organisation_id INTO v_proj, v_org
    FROM projects.projects p WHERE p.status='active' ORDER BY p.created_at LIMIT 1;
  v_pm := projects.resolve_project_pm(v_proj);
  INSERT INTO projects.calendar_years (year)
  VALUES (EXTRACT(YEAR FROM CURRENT_DATE)::int), (EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)
  ON CONFLICT DO NOTHING;

  -- A real profile with NO effective role on this project. The fixture is only
  -- able to fail if such a person exists, so assert that it found one.
  SELECT pr.id INTO v_outsider FROM public.profiles pr
   WHERE public.user_effective_project_role(v_proj, pr.id) IS NULL LIMIT 1;
  IF v_outsider IS NULL THEN
    RAISE EXCEPTION 'no profile without access to % exists; the membership assertion cannot fail and is decorative', v_proj;
  END IF;

  -- 1. An outsider cannot be the assignee. Assert on the MESSAGE, not merely on
  --    failure: a bare "it raised" handler passes whenever the statement failed
  --    for ANY reason, which is not the reason under test.
  BEGIN
    INSERT INTO projects.work_items (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
    VALUES (v_org, v_proj, 'task', 'outsider assignee', v_outsider, v_pm, v_pm);
    RAISE EXCEPTION 'SENTINEL: an item was assigned to a user with no effective role on the project';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%not on this project%' THEN
      RAISE EXCEPTION 'wrong failure for the outsider-assignee case: %', SQLERRM;
    END IF;
  END;

  -- 2. ...nor the gatekeeper.
  BEGIN
    INSERT INTO projects.work_items (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
    VALUES (v_org, v_proj, 'task', 'outsider gatekeeper', v_pm, v_outsider, v_pm);
    RAISE EXCEPTION 'SENTINEL: an item named a gatekeeper with no effective role on the project';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%not on this project%' THEN
      RAISE EXCEPTION 'wrong failure for the outsider-gatekeeper case: %', SQLERRM;
    END IF;
  END;

  -- 3. ...nor by a later UPDATE. RLS cannot compare OLD and NEW, so the trigger
  --    must fire on UPDATE too or reassignment is the hole.
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (v_org, v_proj, 'task', 'reassign subject', v_pm, v_pm, v_pm);
  BEGIN
    UPDATE projects.work_items SET assignee_id = v_outsider
     WHERE project_id = v_proj AND title = 'reassign subject';
    RAISE EXCEPTION 'SENTINEL: an item was REASSIGNED to a user with no access';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%not on this project%' THEN
      RAISE EXCEPTION 'wrong failure for the reassign-to-outsider case: %', SQLERRM;
    END IF;
  END;

  -- 4. A client_viewer CAN be an assignee from Q1. The landlord is frequently
  --    the ball-in-court; their WRITE carve-out is Q3, their assignability is now.
  --    The fixture is the oldest active project THAT HAS one — measured on
  --    2026-09-10, KINGSWALK (the oldest active project) has none, and a
  --    RAISE NOTICE skip is invisible through the Management API, which returns
  --    rows only.
  SELECT pm.user_id, pm.project_id, p.organisation_id
    INTO v_cv, v_cv_proj, v_cv_org
    FROM projects.project_members pm
    JOIN projects.projects p ON p.id = pm.project_id
   WHERE pm.is_active AND pm.role='client_viewer' AND p.status='active'
   ORDER BY p.created_at LIMIT 1;
  IF v_cv IS NULL THEN
    RAISE EXCEPTION 'no active client_viewer membership anywhere; the client-viewer assignability assertion cannot fail and is decorative. Create one inside this transaction rather than skipping it.';
  END IF;
  v_cv_pm := projects.resolve_project_pm(v_cv_proj);
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (v_cv_org, v_cv_proj, 'task', 'client viewer holds the ball', v_cv, v_cv_pm, v_cv_pm);

  -- 5. THE CHAIN NEVER RAISES, even with a dead id in work_item_defaults. This
  --    is the "departed employee makes RFIs unraisable" failure.
  UPDATE projects.project_settings
     SET work_item_defaults = jsonb_build_object('rfi', jsonb_build_object(
           'days_to_respond', NULL,
           'triage_owner_id', '00000000-0000-0000-0000-0000deadbeef'::uuid, 'gatekeeper_id', NULL))
   WHERE project_id = v_proj;
  v_res := projects.resolve_work_item_assignee(v_proj, 'rfi', NULL);
  IF v_res IS NULL THEN RAISE EXCEPTION 'the resolution chain returned NULL — assignee_id NOT NULL would abort the source write'; END IF;
  IF public.user_effective_project_role(v_proj, v_res) IS NULL
  THEN RAISE EXCEPTION 'the chain terminated on someone with no access: %', v_res; END IF;

  -- 6. An explicit assignee wins over every default.
  IF projects.resolve_work_item_assignee(v_proj, 'rfi', v_pm) <> v_pm
  THEN RAISE EXCEPTION 'an explicit assignee was overridden by the default chain'; END IF;

  -- 7. An explicit assignee with NO access does NOT win — it falls through to
  --    the chain rather than being returned and blowing up in the trigger.
  IF projects.resolve_work_item_assignee(v_proj, 'rfi', v_outsider) = v_outsider
  THEN RAISE EXCEPTION 'the chain returned an explicit assignee who has no access to the project'; END IF;

  RAISE NOTICE 'work-item-membership: 7/7 assertions passed';
END $$;
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
scripts/db/try-work-item-spine.sh scripts/db/assertions/work-item-membership.sql
```

Expected: assertion 1 raises `SENTINEL: an item was assigned to a user with no effective role on the project` — the insert succeeded. Red, and it is the real hole.

- [ ] **Step 3: Append section 7 to `00192_work_item_spine.sql`.**

```sql
-- ─── 7. Assignment: the resolution chain and the membership assertion ────────
-- §03 §1.6's chain, in order:
--   explicit assignee
--     -> work_item_defaults.<type>.triage_owner_id
--     -> project_settings.triage_owner_id
--     -> the §1.5 PM resolver
--     -> the org owner
-- Every step is validated before it is returned, and the chain TERMINATES at the
-- org owner rather than raising. It has to: work_item_defaults holds ids in jsonb
-- with no foreign key, public.profiles cascades from auth.users (00001:62), and a
-- departed employee's id surviving there would otherwise abort the transaction
-- and make it impossible for anyone to raise an RFI on that project.
CREATE OR REPLACE FUNCTION projects.resolve_work_item_assignee(
  p_project_id uuid, p_item_type text, p_explicit uuid
) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'projects', 'public'
SET row_security TO 'off'
AS $fn$
DECLARE v_org uuid; v_candidate uuid; v_defaults jsonb; v_settings_owner uuid;
BEGIN
  SELECT p.organisation_id INTO v_org FROM projects.projects p WHERE p.id = p_project_id;

  IF p_explicit IS NOT NULL
     AND public.user_effective_project_role(p_project_id, p_explicit) IS NOT NULL THEN
    RETURN p_explicit;
  END IF;

  SELECT ps.work_item_defaults, ps.triage_owner_id INTO v_defaults, v_settings_owner
    FROM projects.project_settings ps WHERE ps.project_id = p_project_id;

  v_candidate := NULLIF(v_defaults -> p_item_type ->> 'triage_owner_id', '')::uuid;
  IF v_candidate IS NOT NULL
     AND public.user_effective_project_role(p_project_id, v_candidate) IS NOT NULL THEN
    RETURN v_candidate;
  END IF;

  IF v_settings_owner IS NOT NULL
     AND public.user_effective_project_role(p_project_id, v_settings_owner) IS NOT NULL THEN
    RETURN v_settings_owner;
  END IF;

  v_candidate := projects.resolve_project_pm(p_project_id);
  IF v_candidate IS NOT NULL
     AND public.user_effective_project_role(p_project_id, v_candidate) IS NOT NULL THEN
    RETURN v_candidate;
  END IF;

  RETURN projects.org_owner(v_org);
END;
$fn$;

-- An item can never be assigned to someone who cannot open it. assignee_id is an
-- FK to public.profiles with NO membership predicate, so any profile in the
-- database — including one in another organisation — is nominally assignable.
-- The assign UI's people-picker reads the same set (§03 §1.9).
--
-- client_viewer is NOT excluded: in a shopping-centre fit-out the landlord is
-- frequently the ball-in-court, and an item that cannot point at them is a worse
-- bug than one they cannot yet clear. Their write carve-out lands in Q3.
--
-- Fires on UPDATE as well as INSERT, because RLS cannot compare OLD and NEW and
-- reassignment would otherwise be the hole the INSERT check closes.
--
-- The message names COALESCE(ref, title), not ref: BEFORE ROW triggers fire in
-- NAME order, so work_items_assert_membership_trg runs before
-- work_items_ensure_ref_trg and NEW.ref is still NULL on INSERT. It is written
-- as a sentence because every server action returns error.message straight to
-- the user — this string is what a PM sees for picking the wrong person from a
-- list.
CREATE OR REPLACE FUNCTION projects.work_items_assert_membership() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'projects', 'public'
SET row_security TO 'off'
AS $fn$
DECLARE v_label text := COALESCE(NEW.ref, NEW.title, 'this item');
BEGIN
  IF TG_OP = 'INSERT' OR NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    IF public.user_effective_project_role(NEW.project_id, NEW.assignee_id) IS NULL THEN
      RAISE EXCEPTION 'That person is not on this project, so % cannot be given to them. Add them to the project first, or choose someone who is already on it.', v_label
        USING ERRCODE = 'raise_exception';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.gatekeeper_id IS DISTINCT FROM OLD.gatekeeper_id THEN
    IF public.user_effective_project_role(NEW.project_id, NEW.gatekeeper_id) IS NULL THEN
      RAISE EXCEPTION 'That person is not on this project, so they cannot sign % off. Add them to the project first, or choose someone who is already on it.', v_label
        USING ERRCODE = 'raise_exception';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS work_items_assert_membership_trg ON projects.work_items;
CREATE TRIGGER work_items_assert_membership_trg
  BEFORE INSERT OR UPDATE OF assignee_id, gatekeeper_id, project_id ON projects.work_items
  FOR EACH ROW EXECUTE FUNCTION projects.work_items_assert_membership();
```

- [ ] **Step 4: Run it and watch it pass.**

```bash
scripts/db/try-work-item-spine.sh scripts/db/assertions/work-item-membership.sql
```

Expected `✓ work-item-membership.sql — all assertions passed`.

- [ ] **Step 5: Mutation proof — drop the UPDATE arm.** Change the trigger declaration to `BEFORE INSERT ON projects.work_items` only, re-run, and confirm assertion 3 fails with `SENTINEL: an item was REASSIGNED to a user with no access`. Restore both the `OR UPDATE OF …` clause and green. This is the exact shape RLS cannot express.

- [ ] **Step 6: Mutation proof — make the chain raise.** Replace the final `RETURN projects.org_owner(v_org);` with `RAISE EXCEPTION 'no assignee'`, re-run, and confirm assertion 5 fails. Restore.

- [ ] **Step 7: Mutation proof — prove the message assertions bite.** Change the assignee message to `'nope'`, re-run, and confirm assertion 1 fails with `wrong failure for the outsider-assignee case: nope` rather than silently passing. Restore and re-run to green. Record all three — this third one is the reason the handlers assert on `SQLERRM` content rather than on the mere fact of a raise.

- [ ] **Step 8: Commit.**

```bash
git add apps/edge-functions/supabase/migrations/00192_work_item_spine.sql \
        scripts/db/assertions/work-item-membership.sql
git commit -m "feat(work-items): assignee resolution chain and the membership assertion

resolve_work_item_assignee walks explicit -> per-type default -> project triage
owner -> PM resolver -> org owner, validating each step and NEVER raising: a
departed employee's id in the no-FK work_item_defaults jsonb would otherwise
abort the transaction and make RFIs unraisable on that project. A BEFORE INSERT
OR UPDATE trigger refuses an assignee or gatekeeper with no effective role —
on UPDATE too, because RLS cannot compare OLD and NEW. client_viewer stays
assignable: the landlord is frequently the ball-in-court, and the fixture for
that assertion is the oldest project that HAS a client viewer, not the oldest
project (KINGSWALK has none). Messages are sentences, because every server
action returns error.message straight to the user.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9 — Helpers, the RLS policy set, grants and the `anon` revokes (§8, §9, §10)

⚠ **A RESTRICTIVE policy grants nothing.** RLS requires at least one **PERMISSIVE** policy to pass before a RESTRICTIVE one is even consulted. `00171_markup_write_roles_rls.sql:115-146` added RESTRICTIVE policies to a table that already had permissive ones; `work_items` is brand new, so **both** are written here. A RESTRICTIVE-only table silently rejects every write, and the failure looks like a broken feature rather than a policy mistake.

⚠ **This section comes before the append trigger and the transition guard, and the reason is testability.** With RLS enabled and no policy, an `UPDATE … WHERE id = …` run as `authenticated` affects zero rows and **does not raise** — so a guard assertion written against it records a false result in both directions. Every later assertion file acts as a real authenticated user, which is only possible once these policies exist.

⚠ **SELECT is deliberately wider than the write gate — for everyone except a client viewer.** Gating on `user_effective_project_role(project_id) IS NOT NULL` would be narrower than the source tables *and* narrower than the assignment rule, producing the worst failure an inbox can have — a user who sees the RFI in the module list but not its work item. `projects.rfis` SELECT is org-wide for non-client-viewers (`00034:103-115`) **or** `user_has_project_access` (`00160:62-66`), while `user_effective_project_role` returns NULL for an org contractor with no `project_members` row (`00107:59-66`) — and `00107`'s own header says it "does NOT gate ACCESS" (`00107:19-21`). **But `public.user_has_project_access()` is TRUE for any `project_members` row regardless of role (`00106` clause (a)), and that is exactly the predicate PR #162 found and closed on saved reports** ("any project member, `client_viewer` included, could list and download any saved report of any kind"). Leaving it unqualified here re-opens the same door onto mirrored `order_followup` and `qc_defect` titles that the same landlord is deliberately gated out of on the Equipment & Materials report. So the project-access arm excludes `client_viewer`, and a client viewer keeps every item they hold, gatekeep or watch — which is what §04 §(d) already describes ("filtered to items where they are ball-in-court"). Improvement 5.

⚠ **`REVOKE … FROM PUBLIC` does not remove `anon`'s grant.** Supabase's `ALTER DEFAULT PRIVILEGES` grants `anon` EXECUTE *directly* at creation — a separate grant. `00113_lock_rbac_function_grants.sql:15-24` pairs every `FROM PUBLIC` with a `FROM anon`; `00179:314-323` is **not** the precedent, because it never names `anon`. Verify with `has_function_privilege('anon', …)`, never by reading `proacl`: a NULL `proacl` looks empty but **is** the PUBLIC grant.

⚠ **Every new table in `projects` is born readable by `anon`.** `00025_grant_schema_permissions.sql:26` sets `ALTER DEFAULT PRIVILEGES IN SCHEMA projects GRANT SELECT ON TABLES TO anon`, and unlike `cable_schedule` and `structure` that default was never revoked (`00168:92-98` revoked only those two). The durable one-line fix goes in this migration.

⚠ **`00161_client_viewer_readonly_write_block.sql` is NOT a second layer for `work_items`.** It loops over a hard-coded `VALUES` list of thirteen tables (`field.snags`, `field.snag_visits`, `projects.rfis`, `projects.drawings`, `projects.project_members`, `public.attachments`, `public.rfi_annotations`, `tenants.floor_plans`, four `gcr` tables and `marketplace.catalogue_items`) — `00161:61-75`. A new table is not covered by anything in it. **The client-viewer write block for `work_items` is `work_items_update_gate` plus the fact that no registered type admits `client_viewer` in `write_roles` (so `work_items_insert_gate` refuses them) plus the absence of any DELETE policy.** One layer, stated deliberately: adding a 00161-style RESTRICTIVE trio would have to be `FOR ALL`, which would also cut the SELECT a client viewer legitimately has on the items they hold. The assertion below therefore has to run, which is why it raises rather than skips when it cannot find a client viewer.

**Files:**
- Modify: `apps/edge-functions/supabase/migrations/00192_work_item_spine.sql` (append sections 8, 9, 10)
- Create: `scripts/db/assertions/work-item-rls.sql`

- [ ] **Step 1: Write the assertion file first.** It runs as the documented production fixture `rbac-test@e-site.live` (`018f2d31-bbe8-4cc1-bbdd-63af0187081e`, a `contractor` on WM-Consulting and KINGSWALK) — a real role on a real project, which is the only way a role assertion can fail.

⚠ **A temp table created as `postgres` is unreadable after `SET LOCAL ROLE authenticated`.** Proven against production: `CREATE TEMP TABLE _probe …; SET LOCAL ROLE authenticated; SELECT count(*) FROM _probe;` → `ERROR: 42501: permission denied for table _probe`, with the hint `GRANT SELECT ON pg_temp_31._probe TO authenticated`. Without the grant, **every role-scoped assertion below dies on its first statement** and the file proves nothing. Grant it, and assert the grant worked before anything else.

Create `scripts/db/assertions/work-item-rls.sql`:

```sql
-- The rbac-test fixture is a permanent prod RBAC regression fixture (CLAUDE.md
-- "Key gotchas"). Never invite it, never email it.
CREATE TEMP TABLE _f AS
SELECT pm.project_id, p.organisation_id,
       '018f2d31-bbe8-4cc1-bbdd-63af0187081e'::uuid AS contractor_id,
       projects.resolve_project_pm(pm.project_id) AS pm_id
  FROM projects.project_members pm
  JOIN projects.projects p ON p.id = pm.project_id
 WHERE pm.user_id = '018f2d31-bbe8-4cc1-bbdd-63af0187081e' AND pm.is_active
 LIMIT 1;

-- Without this every role-scoped block below dies on `SELECT * INTO f FROM _f`
-- with "permission denied for table _f", and assertions 5-11 never execute.
GRANT SELECT ON _f TO authenticated;

-- The client-viewer fixture is the oldest ACTIVE project that HAS an active
-- client_viewer — not the oldest project. Measured 2026-09-10: KINGSWALK, the
-- oldest active project, has ten members and zero client viewers.
CREATE TEMP TABLE _cv AS
SELECT pm.user_id, pm.project_id, p.organisation_id,
       projects.resolve_project_pm(pm.project_id) AS pm_id
  FROM projects.project_members pm
  JOIN projects.projects p ON p.id = pm.project_id
 WHERE pm.is_active AND pm.role = 'client_viewer' AND p.status = 'active'
 ORDER BY p.created_at LIMIT 1;
GRANT SELECT ON _cv TO authenticated;

DO $$
DECLARE n int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _f) THEN
    RAISE EXCEPTION 'the rbac-test contractor fixture has no project membership; every role assertion below would pass vacuously';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _cv) THEN
    RAISE EXCEPTION 'no active client_viewer membership on any active project; the client-viewer read and write assertions cannot fail and would be decorative. Create one inside this transaction rather than skipping them.';
  END IF;
  INSERT INTO projects.calendar_years (year)
  VALUES (EXTRACT(YEAR FROM CURRENT_DATE)::int), (EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)
  ON CONFLICT DO NOTHING;

  -- 0. anon holds NOTHING on any of the four tables, and no EXECUTE on the helpers.
  SELECT count(*) INTO n FROM (VALUES
      ('projects.work_items'),('projects.work_item_types'),
      ('projects.work_item_events'),('projects.work_item_watchers')) t(rel)
   WHERE has_table_privilege('anon', t.rel, 'SELECT');
  IF n <> 0 THEN RAISE EXCEPTION 'anon can SELECT % of the 4 new tables', n; END IF;

  SELECT count(*) INTO n FROM (VALUES
      ('projects.user_can_read_work_item(uuid)'),
      ('projects.user_can_write_work_item(uuid,text)'),
      ('projects.add_working_days(date,int,uuid,text)'),
      ('projects.push_past_builders_shutdown(date,uuid)'),
      ('projects.resolve_work_item_assignee(uuid,text,uuid)')) f(sig)
   WHERE has_function_privilege('anon', f.sig, 'EXECUTE');
  IF n <> 0 THEN RAISE EXCEPTION '% helper(s) still executable by anon', n; END IF;

  -- 1. The default privilege that births anon-readable tables is gone for good.
  SELECT count(*) INTO n
    FROM pg_default_acl d JOIN pg_namespace nsp ON nsp.oid = d.defaclnamespace
   WHERE nsp.nspname = 'projects' AND d.defaclobjtype = 'r'
     AND array_to_string(d.defaclacl, ',') LIKE '%anon=r%';
  IF n <> 0 THEN RAISE EXCEPTION 'ALTER DEFAULT PRIVILEGES still grants anon SELECT on future projects tables'; END IF;

  -- 2. There is a PERMISSIVE policy for INSERT and for UPDATE. A RESTRICTIVE-only
  --    table rejects every write and looks like a broken feature.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='projects' AND tablename='work_items'
     AND permissive='PERMISSIVE' AND cmd IN ('INSERT','UPDATE');
  IF n < 2 THEN RAISE EXCEPTION 'work_items has % permissive write policies; RESTRICTIVE alone grants nothing', n; END IF;

  -- 3. ...and a RESTRICTIVE one for each.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='projects' AND tablename='work_items'
     AND permissive='RESTRICTIVE' AND cmd IN ('INSERT','UPDATE');
  IF n < 2 THEN RAISE EXCEPTION 'work_items has % restrictive write policies, expected 2', n; END IF;

  -- 4. No DELETE policy anywhere: an item becomes void, it never disappears.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='projects' AND tablename='work_items' AND cmd='DELETE';
  IF n <> 0 THEN RAISE EXCEPTION 'work_items has a DELETE policy'; END IF;
END $$;

-- Seed rows while still postgres: one owned by the contractor, one owned by
-- nobody in particular on the client-viewer's project.
DO $$
DECLARE f record; c record;
BEGIN
  SELECT * INTO f FROM _f;
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (f.organisation_id, f.project_id, 'task', 'contractor holds this', f.contractor_id, f.pm_id, f.pm_id);

  SELECT * INTO c FROM _cv;
  -- (a) an item the client viewer HOLDS, and (b) one they do not.
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (c.organisation_id, c.project_id, 'task', 'client viewer holds this', c.user_id, c.pm_id, c.pm_id);
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (c.organisation_id, c.project_id, 'task', 'not the client viewers', c.pm_id, c.pm_id, c.pm_id);
END $$;

SELECT set_config('request.jwt.claims',
  json_build_object('sub','018f2d31-bbe8-4cc1-bbdd-63af0187081e','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE f record; n int; v_id uuid;
BEGIN
  -- 5a. The fixture itself must be readable in this role, or every assertion
  --     below dies on its first statement and the file proves nothing.
  IF NOT EXISTS (SELECT 1 FROM _f) THEN
    RAISE EXCEPTION 'fixture _f is unreadable as authenticated — add GRANT SELECT ON _f TO authenticated';
  END IF;
  SELECT * INTO f FROM _f;

  -- 5b. The contractor can SEE the item they hold.
  SELECT id INTO v_id FROM projects.work_items WHERE title='contractor holds this';
  IF v_id IS NULL THEN RAISE EXCEPTION 'the assignee cannot see their own work item — the worst failure an inbox can have'; END IF;

  -- 6. They can create a TASK: it is the only client-insertable type in Q1.
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (f.organisation_id, f.project_id, 'task', 'contractor task', f.contractor_id, f.pm_id, f.contractor_id);

  -- 7. They CANNOT create a mirrored type directly. The source row is the only
  --    entry point; a direct insert naming a mirrored key is refused by the
  --    RESTRICTIVE gate.
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, rfi_id)
    SELECT f.organisation_id, f.project_id, 'rfi', 'forged rfi item', f.contractor_id, f.pm_id, f.contractor_id, r.id
      FROM projects.rfis r WHERE r.project_id = f.project_id LIMIT 1;
    RAISE EXCEPTION 'SENTINEL: a client inserted a MIRRORED work item directly';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      RAISE EXCEPTION 'the mirrored-insert case failed for the wrong reason: %', SQLERRM;
  END;

  -- 8. They cannot forge created_by.
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
    VALUES (f.organisation_id, f.project_id, 'task', 'forged author', f.contractor_id, f.pm_id, f.pm_id);
    RAISE EXCEPTION 'SENTINEL: created_by was forgeable';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      RAISE EXCEPTION 'the created_by case failed for the wrong reason: %', SQLERRM;
  END;

  -- 9. They cannot bind the row to a FOREIGN organisation — the site-form
  --    org-hop (PR #160 defect 3) in a new place.
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
    SELECT o.id, f.project_id, 'task', 'org hop', f.contractor_id, f.pm_id, f.contractor_id
      FROM public.organisations o WHERE o.id <> f.organisation_id LIMIT 1;
    RAISE EXCEPTION 'SENTINEL: organisation_id was not bound to the project''s own org';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      RAISE EXCEPTION 'the org-hop case failed for the wrong reason: %', SQLERRM;
  END;

  -- 10. They cannot DELETE, which is what keeps refs monotonic.
  BEGIN
    DELETE FROM projects.work_items WHERE id = v_id;
    IF FOUND THEN RAISE EXCEPTION 'SENTINEL: a work item was DELETED by a client'; END IF;
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      RAISE EXCEPTION 'the delete case failed for the wrong reason: %', SQLERRM;
  END;

  -- 11. They cannot write work_item_events directly — no INSERT policy exists
  --     AND the INSERT grant is revoked, so this is a permission error.
  BEGIN
    INSERT INTO projects.work_item_events
      (work_item_id, project_id, organisation_id, verb, to_status, actor_id)
    VALUES (v_id, f.project_id, f.organisation_id, 'closed', 'closed', f.pm_id);
    RAISE EXCEPTION 'SENTINEL: a client forged a work_item_events row';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      RAISE EXCEPTION 'the event-forgery case failed for the wrong reason: %', SQLERRM;
  END;

  RAISE NOTICE 'work-item-rls (contractor): 5-11 passed';
END $$;

RESET ROLE;

-- A client_viewer sees only what they hold, and writes nothing.
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT user_id FROM _cv), 'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE c record; v_mine uuid; v_theirs uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _cv) THEN
    RAISE EXCEPTION 'fixture _cv is unreadable as authenticated — add GRANT SELECT ON _cv TO authenticated';
  END IF;
  SELECT * INTO c FROM _cv;

  -- 12. They CAN see an item they hold. The landlord is frequently the
  --     ball-in-court, and an inbox they cannot read is not an inbox.
  SELECT id INTO v_mine FROM projects.work_items WHERE title='client viewer holds this';
  IF v_mine IS NULL THEN RAISE EXCEPTION 'a client_viewer cannot see the item they are assigned'; END IF;

  -- 13. They CANNOT see a project-wide item they do not hold or watch. This is
  --     PR #162's defect in a new place: user_has_project_access() is TRUE for
  --     ANY project_members row regardless of role (00106 clause (a)).
  SELECT id INTO v_theirs FROM projects.work_items WHERE title='not the client viewers';
  IF v_theirs IS NOT NULL THEN
    RAISE EXCEPTION 'a client_viewer can list every work item on the project — the saved-report read gap (PR #162) re-opened on work_items';
  END IF;

  -- 14. They cannot WRITE, even to the item they hold. work_items_update_gate
  --     is the ONLY layer here: 00161 covers a fixed list of 13 tables and does
  --     not cover work_items.
  UPDATE projects.work_items SET status='open' WHERE id = v_mine;
  IF FOUND THEN RAISE EXCEPTION 'a client_viewer wrote to work_items in Q1'; END IF;
  IF (SELECT status FROM projects.work_items WHERE id = v_mine) <> 'triage' THEN
    RAISE EXCEPTION 'the client_viewer''s update took effect despite FOUND being false';
  END IF;

  RAISE NOTICE 'work-item-rls (client_viewer): 12-14 passed';
END $$;

RESET ROLE;
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
scripts/db/try-work-item-spine.sh scripts/db/assertions/work-item-rls.sql
```

Expected: assertion 0 raises `anon can SELECT 4 of the 4 new tables`. Red — and that is `00025:26` doing exactly what §12 §(a) warns about.

- [ ] **Step 3: Append sections 8, 9 and 10 to `00192_work_item_spine.sql`.**

```sql
-- ─── 8. Helpers ──────────────────────────────────────────────────────────────
-- STABLE SECURITY DEFINER … SET search_path … SET row_security TO 'off'
-- (§12 §(b) rule 6). Neither uses current_user, and every role test is COALESCEd
-- to FALSE, because user_effective_project_role returns NULL for a non-member and
-- `NULL IN (…)` is NULL, not FALSE.
--
-- These come BEFORE §9 because CREATE POLICY resolves function references at
-- creation time: work_item_events_select calls user_can_read_work_item, and the
-- helper's own body references work_items and work_item_watchers (§2, §4).
CREATE OR REPLACE FUNCTION projects.user_can_read_work_item(p_work_item_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public' SET row_security TO 'off'
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM projects.work_items wi
     WHERE wi.id = p_work_item_id
       AND ( ( public.user_has_project_access(wi.project_id)
               AND COALESCE(public.user_effective_project_role(wi.project_id, auth.uid()), '')
                   <> 'client_viewer' )
             OR wi.assignee_id   = auth.uid()
             OR wi.gatekeeper_id = auth.uid()
             OR EXISTS (SELECT 1 FROM projects.work_item_watchers w
                         WHERE w.work_item_id = wi.id AND w.user_id = auth.uid())));
$fn$;

-- Resolves the type's write_roles from the registry, so widening a type's write
-- set is one UPDATE in one place and never a policy rewrite.
CREATE OR REPLACE FUNCTION projects.user_can_write_work_item(p_project_id uuid, p_item_type text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public' SET row_security TO 'off'
AS $fn$
  SELECT COALESCE(
    public.user_effective_project_role(p_project_id, auth.uid()) = ANY (
      SELECT unnest(t.write_roles) FROM projects.work_item_types t
       WHERE t.key = p_item_type AND t.is_active),
    FALSE);
$fn$;

REVOKE ALL ON FUNCTION projects.user_can_read_work_item(uuid)              FROM PUBLIC;
REVOKE ALL ON FUNCTION projects.user_can_write_work_item(uuid,text)        FROM PUBLIC;
REVOKE ALL ON FUNCTION projects.add_working_days(date,int,uuid,text)       FROM PUBLIC;
REVOKE ALL ON FUNCTION projects.push_past_builders_shutdown(date,uuid)     FROM PUBLIC;
REVOKE ALL ON FUNCTION projects.resolve_work_item_assignee(uuid,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION projects.work_items_set_due_date()                  FROM PUBLIC;
REVOKE ALL ON FUNCTION projects.work_items_ensure_ref()                    FROM PUBLIC;
REVOKE ALL ON FUNCTION projects.work_items_assert_membership()             FROM PUBLIC;
-- FROM PUBLIC is NOT enough: ALTER DEFAULT PRIVILEGES grants anon EXECUTE
-- directly at creation, a separate grant (00113:15-24). 00179:314-323 is not the
-- precedent — it never names anon.
REVOKE EXECUTE ON FUNCTION projects.user_can_read_work_item(uuid)              FROM anon;
REVOKE EXECUTE ON FUNCTION projects.user_can_write_work_item(uuid,text)        FROM anon;
REVOKE EXECUTE ON FUNCTION projects.add_working_days(date,int,uuid,text)       FROM anon;
REVOKE EXECUTE ON FUNCTION projects.push_past_builders_shutdown(date,uuid)     FROM anon;
REVOKE EXECUTE ON FUNCTION projects.resolve_work_item_assignee(uuid,text,uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION projects.work_items_set_due_date()                  FROM anon;
REVOKE EXECUTE ON FUNCTION projects.work_items_ensure_ref()                    FROM anon;
REVOKE EXECUTE ON FUNCTION projects.work_items_assert_membership()             FROM anon;

GRANT EXECUTE ON FUNCTION projects.user_can_read_work_item(uuid)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION projects.user_can_write_work_item(uuid,text)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION projects.add_working_days(date,int,uuid,text)       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION projects.push_past_builders_shutdown(date,uuid)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION projects.resolve_work_item_assignee(uuid,text,uuid) TO authenticated, service_role;

-- ─── 9. RLS ──────────────────────────────────────────────────────────────────
-- SELECT is PERMISSIVE and deliberately WIDER than the write gate — for everyone
-- except a client viewer. Gating on user_effective_project_role IS NOT NULL
-- would be narrower than the source tables (rfis is org-wide for
-- non-client-viewers, 00034:103-115) and narrower than the assignment rule,
-- giving a user who sees the RFI in the module list but not its work item.
-- 00107's own header says it "does NOT gate ACCESS".
--
-- The client_viewer exclusion on the project-access arm is PR #162's fix applied
-- to a new table: public.user_has_project_access() is TRUE for ANY
-- project_members row regardless of role (00106 clause (a)), which is precisely
-- how a client viewer could list and download every saved report of every kind.
-- Unqualified here it would expose mirrored order_followup and qc_defect titles
-- the same landlord is deliberately gated out of on the Equipment & Materials
-- report. They keep every item they hold, gatekeep or watch — §04 §(d)'s
-- "filtered to items where they are ball-in-court", enforced in the database
-- rather than left to the query.
CREATE POLICY work_items_select ON projects.work_items
  FOR SELECT TO authenticated
  USING (
    ( public.user_has_project_access(project_id)
      AND COALESCE(public.user_effective_project_role(project_id, auth.uid()), '')
          <> 'client_viewer' )
    OR assignee_id   = auth.uid()
    OR gatekeeper_id = auth.uid()
    OR EXISTS (SELECT 1 FROM projects.work_item_watchers w
                WHERE w.work_item_id = projects.work_items.id AND w.user_id = auth.uid())
  );

-- PERMISSIVE INSERT. Without this the RESTRICTIVE policy below grants nothing
-- and every insert is silently rejected: RESTRICTIVE narrows, it never permits.
CREATE POLICY work_items_insert ON projects.work_items
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_project_access(project_id)
    AND created_by = auth.uid()
    -- Rule 3 (§12 §(b)): bind organisation_id to the PROJECT's own org. The
    -- foreign-org walk this prevents is a real prior incident — a draft site
    -- form could be hopped into an org the author was not a member of.
    AND organisation_id = (SELECT p.organisation_id FROM projects.projects p WHERE p.id = project_id)
  );

-- RESTRICTIVE INSERT gate, 00171's construction (00171:115-146). A restrictive
-- policy is the only construct that cannot be widened by a later permissive
-- policy someone adds in a hurry.
--
-- `task` is the ONLY client-insertable type in Q1. Every mirrored type stays
-- source-only: the source row is the only entry point (§03 §1.2). `order_followup`
-- becomes client-insertable when the explicit chase control on the order line
-- ships; that item adds an arm here requiring node_order_id and nothing else.
-- Item 8 adds the project_module_enabled() arm.
--
-- No registered type admits client_viewer in write_roles, so this gate is also
-- what blocks a client viewer from INSERTING. 00161 does not cover this table.
CREATE POLICY work_items_insert_gate ON projects.work_items
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    item_type = 'task'
    AND rfi_id IS NULL AND snag_id IS NULL AND qc_entry_id IS NULL
    AND diary_id IS NULL AND site_form_id IS NULL
    AND node_order_id IS NULL AND inspection_id IS NULL
    AND projects.user_can_write_work_item(project_id, item_type)
  );

-- PERMISSIVE UPDATE. The three identity clauses are how a contractor answers
-- their own item without holding a project-wide write role.
CREATE POLICY work_items_update ON projects.work_items
  FOR UPDATE TO authenticated
  USING (
    public.user_has_project_access(project_id)
    OR assignee_id = auth.uid() OR gatekeeper_id = auth.uid()
  )
  WITH CHECK (
    organisation_id = (SELECT p.organisation_id FROM projects.projects p WHERE p.id = project_id)
  );

-- RESTRICTIVE UPDATE gate. client_viewer is blocked outright in Q1, and THIS IS
-- THE ONLY LAYER doing it for work_items: 00161_client_viewer_readonly_write_block
-- loops over a hard-coded list of 13 tables (00161:61-75) and a new table is not
-- among them. An item pointed at a client viewer is moved to 'answered' by its
-- gatekeeper on their behalf (§03 §1.9). Q3 replaces this arm with a WITH CHECK
-- admitting client_viewer only when assignee_id = auth.uid() and the row
-- difference is confined to status -> 'answered'.
CREATE POLICY work_items_update_gate ON projects.work_items
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    COALESCE(public.user_effective_project_role(project_id, auth.uid()), '') <> 'client_viewer'
    AND ( projects.user_can_write_work_item(project_id, item_type)
          OR assignee_id = auth.uid() OR gatekeeper_id = auth.uid() )
  )
  WITH CHECK (
    COALESCE(public.user_effective_project_role(project_id, auth.uid()), '') <> 'client_viewer'
    AND ( projects.user_can_write_work_item(project_id, item_type)
          OR assignee_id = auth.uid() OR gatekeeper_id = auth.uid() )
  );

-- NO DELETE policy, deliberately. An item leaves an inbox by becoming 'void',
-- never by disappearing — which is also what keeps the ref counter monotonic
-- and what stops a deletion destroying the events behind metrics 4, 5 and 7.

-- Read the history if you can read the item. NO write policy, deliberately:
-- the append trigger (§11) is SECURITY DEFINER and bypasses RLS by ownership,
-- which is what makes that shape possible (00179:504-506).
CREATE POLICY work_item_events_select ON projects.work_item_events
  FOR SELECT TO authenticated USING (projects.user_can_read_work_item(work_item_id));

CREATE POLICY work_item_watchers_select ON projects.work_item_watchers
  FOR SELECT TO authenticated USING (projects.user_can_read_work_item(work_item_id));
CREATE POLICY work_item_watchers_insert ON projects.work_item_watchers
  FOR INSERT TO authenticated
  WITH CHECK (projects.user_can_read_work_item(work_item_id)
              AND (user_id = auth.uid() OR EXISTS (
                SELECT 1 FROM projects.work_items wi
                 WHERE wi.id = work_item_id
                   AND projects.user_can_write_work_item(wi.project_id, wi.item_type))));
CREATE POLICY work_item_watchers_delete ON projects.work_item_watchers
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM projects.work_items wi
     WHERE wi.id = work_item_id
       AND projects.user_can_write_work_item(wi.project_id, wi.item_type)));

-- ─── 10. Grants ──────────────────────────────────────────────────────────────
-- 00025:26 sets ALTER DEFAULT PRIVILEGES … GRANT SELECT ON TABLES TO anon for
-- this schema, and unlike cable_schedule and structure it was never revoked
-- (00168:92-98 revoked only those two). All four tables are therefore born with
-- a standing anon SELECT grant, leaving RLS as the only thing between an
-- unauthenticated PostgREST caller and the inbox.
REVOKE SELECT ON projects.work_items, projects.work_item_events,
                 projects.work_item_watchers, projects.work_item_types
  FROM anon;

-- No client ever deletes a work item or an event; revoking makes the refusal a
-- clear permission error instead of a silent zero-row update. Revoking
-- INSERT/UPDATE on work_item_events is what turns a SECURITY INVOKER append
-- trigger into a hard permission failure rather than a policy failure — see the
-- mutation proof in Task 10.
REVOKE DELETE ON projects.work_items, projects.work_item_events FROM authenticated;
REVOKE INSERT, UPDATE ON projects.work_item_events FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON projects.work_item_types FROM authenticated;

-- The durable one-line fix, so the NEXT table in this schema is not born
-- anon-readable either.
ALTER DEFAULT PRIVILEGES IN SCHEMA projects REVOKE SELECT ON TABLES FROM anon;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 4: Run it and watch it pass.** Re-enable assertion 5 in `work-item-registry.sql` (the `-- TODO(Task 9)` you commented out) first.

```bash
scripts/db/try-work-item-spine.sh scripts/db/assertions/work-item-rls.sql
scripts/db/try-work-item-spine.sh scripts/db/assertions/work-item-registry.sql
```

Both must print `✓`.

- [ ] **Step 5: Mutation proof — delete the permissive INSERT policy.** Comment out `work_items_insert` (leaving `work_items_insert_gate`), re-run, and confirm assertion 6 fails with `new row violates row-level security policy` on a perfectly legal contractor task. Restore. This is the RESTRICTIVE-alone trap, demonstrated.

- [ ] **Step 6: Mutation proof — remove the `anon` revokes.** Comment out the `REVOKE SELECT … FROM anon` block, re-run, and confirm assertion 0 fails naming 4 tables. Restore. §12 §(h) names this one explicitly ("removing the `anon` revoke must fail the grant assertions").

- [ ] **Step 7: Mutation proof — widen the INSERT gate.** Change `item_type = 'task'` to `TRUE`, re-run, and confirm assertion 7 fails with `SENTINEL: a client inserted a MIRRORED work item directly`. Restore.

- [ ] **Step 8: Mutation proof — drop the client_viewer exclusion from `work_items_select`.** Remove the `AND COALESCE(public.user_effective_project_role(...), '') <> 'client_viewer'` clause, re-run, and confirm assertion 13 fails with `a client_viewer can list every work item on the project — the saved-report read gap (PR #162) re-opened on work_items`. Restore and re-run everything to green. Record all four in the PR body.

- [ ] **Step 9: Mutation proof — remove the temp-table grant.** Delete `GRANT SELECT ON _f TO authenticated;`, re-run, and confirm the file dies with `fixture _f is unreadable as authenticated`. Restore. **Do this one even though it feels like testing the test:** without the grant the whole role-scoped half of this file silently never executes, which is the exact class of decorative assertion this programme exists to end.

- [ ] **Step 10: Commit.**

```bash
git add apps/edge-functions/supabase/migrations/00192_work_item_spine.sql \
        scripts/db/assertions/work-item-rls.sql scripts/db/assertions/work-item-registry.sql
git commit -m "feat(work-items): helpers, the RLS policy set, grants and the anon revokes

SELECT is permissive and wider than the write gate — with three identity clauses,
so nothing can be in your inbox that you cannot open — EXCEPT for client_viewer,
who is excluded from the project-access arm. user_has_project_access() is TRUE
for any project_members row regardless of role (00106 clause (a)), the identical
predicate PR #162 found and closed on saved reports; unqualified it would expose
mirrored procurement and QC titles the same landlord is gated out of elsewhere.
They keep every item they hold, gatekeep or watch.

Writes are a PERMISSIVE policy plus a RESTRICTIVE gate (restrictive alone grants
nothing on a new table). task is the only client-insertable type in Q1; every
mirrored type stays source-only. No DELETE policy at all. anon revoked on all
four tables and every helper, plus the durable ALTER DEFAULT PRIVILEGES fix so
the next table in this schema is not born anon-readable.

NOTE: 00161_client_viewer_readonly_write_block covers a fixed list of 13 tables
and does NOT cover work_items — work_items_update_gate is the only layer, which
is why its assertion raises rather than skips when no client viewer is found.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10 — The `SECURITY DEFINER` append trigger, and the watcher seeding (§11)

⚠ **This trigger must be `SECURITY DEFINER`, and the reason is the opposite of the guard's.** `work_item_events` carries a SELECT policy and **no write policy** (the `00179_site_forms.sql:504-506` shape), and §10 additionally revoked `INSERT` from `authenticated`. A `SECURITY INVOKER` append trigger would run as the calling user and the very first assignment change would fail — with a *permission* error, because of the revoke. A `SECURITY DEFINER` function owned by the table owner bypasses both, which is precisely what makes the no-write-policy shape possible.

⚠ **Attribution comes from `auth.uid()`, never `current_user`.** Inside `SECURITY DEFINER`, `current_user` is the function **owner** — that is what made the first site-form transition trigger silently inert (`00179:341-346`), and attribution forgery recorded as fact was defect 6 of the nine found in PR #160.

⚠ **This trigger also seeds `work_item_watchers`, and nothing else in Q1 does.** Without it the table is created, granted, policied and read by `user_can_read_work_item()`'s watcher clause with **no writer** — the policy arm is dead code, §03 §1.8's "auto-populated on create, assign and @mention" is false, and item 4's notification engine (3.0wk, immediately after this on the critical path) would find an empty subscription list in week 4. Improvement 4.

⚠ **No notification is written here.** Item 4 owns the bell path and adds the emit branch — and the `current_setting('esite.suppress_notifications', true)` guard the backfill sets — to *this same function* with `CREATE OR REPLACE`. Do not add an empty branch now.

**Files:**
- Modify: `apps/edge-functions/supabase/migrations/00192_work_item_spine.sql` (append section 11)
- Create: `scripts/db/assertions/work-item-events.sql`

- [ ] **Step 1: Write the assertion file first.** The event-generating half runs **as a real authenticated project member**, not as the owner. A file that never switches role runs every statement as the table owner, which bypasses RLS and holds every grant — so removing `SECURITY DEFINER` would change nothing and the mutation proof would be decorative.

Create `scripts/db/assertions/work-item-events.sql`:

```sql
CREATE TEMP TABLE _e AS
SELECT pm.project_id, p.organisation_id,
       '018f2d31-bbe8-4cc1-bbdd-63af0187081e'::uuid AS actor_id,
       projects.resolve_project_pm(pm.project_id) AS pm_id,
       (SELECT m.user_id FROM projects.project_members m
         WHERE m.project_id = pm.project_id AND m.is_active
           AND m.user_id <> '018f2d31-bbe8-4cc1-bbdd-63af0187081e'
           AND m.role <> 'client_viewer'
         LIMIT 1) AS other_id
  FROM projects.project_members pm
  JOIN projects.projects p ON p.id = pm.project_id
 WHERE pm.user_id = '018f2d31-bbe8-4cc1-bbdd-63af0187081e' AND pm.is_active
 LIMIT 1;
GRANT SELECT ON _e TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _e) THEN
    RAISE EXCEPTION 'the rbac-test fixture has no project membership; the event assertions cannot run as a real user';
  END IF;
  IF (SELECT other_id FROM _e) IS NULL THEN
    RAISE EXCEPTION 'no second non-client_viewer member on the fixture project; the reassigned/assigned verbs cannot both be reached';
  END IF;
  INSERT INTO projects.calendar_years (year)
  VALUES (EXTRACT(YEAR FROM CURRENT_DATE)::int), (EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)
  ON CONFLICT DO NOTHING;
END $$;

-- Generate the events AS A REAL USER. auth.uid() must be a person, or actor_id
-- and actor_role are both NULL and assertions 6 and 7 pass vacuously.
SELECT set_config('request.jwt.claims',
  json_build_object('sub','018f2d31-bbe8-4cc1-bbdd-63af0187081e','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE e record; v_id uuid;
BEGIN
  SELECT * INTO e FROM _e;

  -- Create, then move it through every arm the trigger has.
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (e.organisation_id, e.project_id, 'task', 'event subject', e.actor_id, e.pm_id, e.actor_id)
  RETURNING id INTO v_id;

  UPDATE projects.work_items SET assignee_id = e.other_id WHERE id = v_id;  -- triage -> 'assigned'
  UPDATE projects.work_items SET status = 'open'          WHERE id = v_id;
  UPDATE projects.work_items SET assignee_id = e.actor_id WHERE id = v_id;  -- open  -> 'reassigned'
  UPDATE projects.work_items SET due_date = due_date + 3  WHERE id = v_id;
  UPDATE projects.work_items SET status = 'answered'      WHERE id = v_id;
END $$;

RESET ROLE;

DO $$
DECLARE v_id uuid; n int; e record;
BEGIN
  SELECT * INTO e FROM _e;
  SELECT id INTO v_id FROM projects.work_items WHERE title='event subject';

  -- 1. Creation writes exactly one 'created' event carrying the opening state,
  --    including the ball-in-court the item was born holding.
  SELECT count(*) INTO n FROM projects.work_item_events
   WHERE work_item_id = v_id AND verb='created';
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 created event, found %', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM projects.work_item_events
                  WHERE work_item_id=v_id AND verb='created'
                    AND to_status='triage' AND to_user_id=e.actor_id
                    AND to_due_date IS NOT NULL AND to_ball_in_court_id=e.actor_id)
  THEN RAISE EXCEPTION 'the created event did not carry the opening status/assignee/due date/ball-in-court'; END IF;

  -- 2. Triage assignment writes 'assigned'; a later change writes 'reassigned'.
  --    Both verbs must be reachable or one of them is decorative.
  IF NOT EXISTS (SELECT 1 FROM projects.work_item_events
                  WHERE work_item_id=v_id AND verb='assigned'
                    AND from_user_id=e.actor_id AND to_user_id=e.other_id)
  THEN RAISE EXCEPTION 'the triage handoff wrote no assigned event with both endpoints'; END IF;
  IF NOT EXISTS (SELECT 1 FROM projects.work_item_events
                  WHERE work_item_id=v_id AND verb='reassigned'
                    AND from_user_id=e.other_id AND to_user_id=e.actor_id)
  THEN RAISE EXCEPTION 'a post-triage reassignment wrote no reassigned event with both endpoints'; END IF;

  -- 3. A due-date change is recorded with both endpoints.
  IF NOT EXISTS (SELECT 1 FROM projects.work_item_events
                  WHERE work_item_id=v_id AND verb='due_changed'
                    AND from_due_date IS NOT NULL AND to_due_date = from_due_date + 3)
  THEN RAISE EXCEPTION 'a due-date change wrote no due_changed event with both endpoints'; END IF;

  -- 4. METRIC 4's ROW. The first open -> answered transition must be findable by
  --    (from_status, to_status). A log that only recorded a verb would pass every
  --    assertion above and make the median-days-to-respond metric unanswerable.
  IF NOT EXISTS (SELECT 1 FROM projects.work_item_events
                  WHERE work_item_id=v_id AND from_status='open' AND to_status='answered')
  THEN RAISE EXCEPTION 'no (open -> answered) event row; metric 4 has no numerator'; END IF;

  -- 5. METRIC 5's DENOMINATOR. The open -> answered move handed the ball from
  --    the assignee to the gatekeeper, and the event must say so ON ITS OWN —
  --    reconstructing it from the row's CURRENT gatekeeper_id is the error §15
  --    §(b) forbids, and it is wrong for every item whose gatekeeper was ever
  --    corrected. This CANNOT be backfilled.
  IF NOT EXISTS (SELECT 1 FROM projects.work_item_events
                  WHERE work_item_id=v_id AND from_status='open' AND to_status='answered'
                    AND from_ball_in_court_id = e.actor_id
                    AND to_ball_in_court_id   = e.pm_id)
  THEN RAISE EXCEPTION 'the open -> answered event does not carry the ball-in-court handover; metric 5 has no denominator'; END IF;

  -- 6. ATTRIBUTION. Every event names the real actor, from auth.uid().
  SELECT count(*) INTO n FROM projects.work_item_events
   WHERE work_item_id=v_id AND actor_id IS DISTINCT FROM e.actor_id;
  IF n <> 0 THEN RAISE EXCEPTION '% event(s) name the wrong actor (or none)', n; END IF;

  -- 7. METRIC 2a's ROLE. actor_role is stamped AT EVENT TIME. Contractor activity
  --    on work items is the only first-party evidence the spine reached the 13
  --    contractor accounts: 246 automated emails have been sent to the estate and
  --    email_sequences.opened_at/clicked_at are NULL on every row, because the
  --    Resend webhook of 00030:24-25 was never built.
  SELECT count(*) INTO n FROM projects.work_item_events
   WHERE work_item_id=v_id AND actor_role IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION '% event(s) have no actor_role stamped', n; END IF;
  IF (SELECT DISTINCT actor_role FROM projects.work_item_events WHERE work_item_id=v_id)
     <> public.user_effective_project_role(e.project_id, e.actor_id)
  THEN RAISE EXCEPTION 'actor_role does not match the actor''s effective role on the project'; END IF;

  -- 8. WATCHERS ARE POPULATED. Nothing else in Q1 writes this table, so without
  --    the seeding arm the SELECT policy's watcher clause is dead code and item
  --    4 inherits an empty subscription list.
  IF NOT EXISTS (SELECT 1 FROM projects.work_item_watchers
                  WHERE work_item_id=v_id AND user_id=e.actor_id)
  THEN RAISE EXCEPTION 'the creator/assignee was not auto-added as a watcher'; END IF;
  IF NOT EXISTS (SELECT 1 FROM projects.work_item_watchers
                  WHERE work_item_id=v_id AND user_id=e.pm_id AND reason='gatekeeper')
  THEN RAISE EXCEPTION 'the gatekeeper was not auto-added as a watcher'; END IF;
  IF NOT EXISTS (SELECT 1 FROM projects.work_item_watchers
                  WHERE work_item_id=v_id AND user_id=e.other_id)
  THEN RAISE EXCEPTION 'the incoming assignee was not added as a watcher on reassignment'; END IF;
  -- One row per person, even though the actor is creator AND assignee.
  SELECT count(*) INTO n FROM projects.work_item_watchers
   WHERE work_item_id=v_id AND user_id=e.actor_id;
  IF n <> 1 THEN RAISE EXCEPTION 'the actor has % watcher rows; the primary key should make that impossible', n; END IF;

  -- 9. NO write policy on work_item_events. An INSERT policy would let a client
  --    forge the history the metrics and the audit trail are read from.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='projects' AND tablename='work_item_events' AND cmd <> 'SELECT';
  IF n <> 0 THEN RAISE EXCEPTION 'work_item_events carries % write policy/policies', n; END IF;

  -- 10. The append function must not reference current_user anywhere.
  IF (SELECT prosrc FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid=p.pronamespace
       WHERE nsp.nspname='projects' AND p.proname='append_work_item_event') ILIKE '%current_user%'
  THEN RAISE EXCEPTION 'append_work_item_event references current_user — under SECURITY DEFINER that is the OWNER'; END IF;

  -- 11. It must be SECURITY DEFINER, or the first event insert dies.
  IF NOT (SELECT prosecdef FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid=p.pronamespace
           WHERE nsp.nspname='projects' AND p.proname='append_work_item_event')
  THEN RAISE EXCEPTION 'append_work_item_event is SECURITY INVOKER; with no write policy and no grant it cannot insert'; END IF;

  -- 12. Item 2 writes NO notification. That is item 4's, added by CREATE OR REPLACE.
  IF (SELECT prosrc FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid=p.pronamespace
       WHERE nsp.nspname='projects' AND p.proname='append_work_item_event') ILIKE '%public.notifications%'
  THEN RAISE EXCEPTION 'the append trigger writes notifications; that is item 4 and it is out of scope here'; END IF;

  RAISE NOTICE 'work-item-events: 12/12 assertions passed';
END $$;
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
scripts/db/try-work-item-spine.sh scripts/db/assertions/work-item-events.sql
```

Expected: `expected 1 created event, found 0`. Red.

- [ ] **Step 3: Append section 11 to `00192_work_item_spine.sql`.**

```sql
-- ─── 11. The append trigger — the only writer of events, and of watchers ─────
-- SECURITY DEFINER, exactly as field.append_form_response_history() is
-- (00179:192-194), and for the same reason: work_item_events carries a SELECT
-- policy and NO write policy (00179:504-506), and §10 additionally revoked
-- INSERT from authenticated — so a SECURITY INVOKER trigger would fail on the
-- very first event with a permission error. A definer function owned by the
-- table owner bypasses both, which is what makes that shape possible.
--
-- Attribution is auth.uid(), NEVER current_user: under SECURITY DEFINER
-- current_user is the function OWNER (00179:341-346), and an append-only history
-- that records a forgery as fact is worse than no history.
--
-- Three columns beyond the obvious, and none of them can be backfilled:
--   * from_ball_in_court_id / to_ball_in_court_id — metric 5's denominator is
--     "work items that entered the caller's ball-in-court that week, counted off
--     projects.work_item_events" (§15 metric 5). Reconstructing that from the
--     row's CURRENT gatekeeper_id is the error §15 §(b) forbids.
--   * actor_role — §15 §(b)'s "effective role stamped AT EVENT TIME, not
--     re-resolved later". Metric 2a's contractor diagnostic depends on it, and
--     it is the only first-party signal available: 246 automated emails have
--     gone to the estate and email_sequences.opened_at/clicked_at are NULL on
--     every row, the Resend webhook of 00030:24-25 never having been built.
--
-- It also seeds work_item_watchers. Nothing else in Q1 writes that table, so
-- without this the SELECT policy's watcher arm is dead code and item 4's
-- notification engine inherits an empty subscription list (§03 §1.8).
--
-- Item 4 adds the notification emit and its
-- current_setting('esite.suppress_notifications', true) guard to THIS function
-- with CREATE OR REPLACE. Nothing here writes a bell.
CREATE OR REPLACE FUNCTION projects.append_work_item_event() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'projects', 'public'
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_role  text := public.user_effective_project_role(NEW.project_id, auth.uid());
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO projects.work_item_events
      (work_item_id, project_id, organisation_id, verb, to_status, to_user_id, to_due_date,
       from_ball_in_court_id, to_ball_in_court_id, actor_id, actor_role)
    VALUES (NEW.id, NEW.project_id, NEW.organisation_id, 'created',
            NEW.status, NEW.assignee_id, NEW.due_date,
            NULL, NEW.ball_in_court_id, v_actor, v_role);

    -- DISTINCT ON, not three VALUES rows: the creator is frequently also the
    -- assignee or the gatekeeper, and one person must produce one row.
    -- Priority: creator > assignee > gatekeeper.
    INSERT INTO projects.work_item_watchers (work_item_id, user_id, reason)
    SELECT DISTINCT ON (w.user_id) NEW.id, w.user_id, w.reason
      FROM (VALUES (1, NEW.created_by,    'creator'),
                   (2, NEW.assignee_id,   'assignee'),
                   (3, NEW.gatekeeper_id, 'gatekeeper')) AS w(pri, user_id, reason)
     ORDER BY w.user_id, w.pri
    ON CONFLICT (work_item_id, user_id) DO NOTHING;

    RETURN NULL;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO projects.work_item_events
      (work_item_id, project_id, organisation_id, verb, from_status, to_status,
       from_ball_in_court_id, to_ball_in_court_id, actor_id, actor_role)
    VALUES (NEW.id, NEW.project_id, NEW.organisation_id,
            CASE NEW.status WHEN 'closed' THEN 'closed'
                            WHEN 'void'   THEN 'voided'
                            ELSE 'status_changed' END,
            OLD.status, NEW.status,
            OLD.ball_in_court_id, NEW.ball_in_court_id, v_actor, v_role);
  END IF;

  IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    INSERT INTO projects.work_item_events
      (work_item_id, project_id, organisation_id, verb, from_user_id, to_user_id,
       from_ball_in_court_id, to_ball_in_court_id, actor_id, actor_role)
    VALUES (NEW.id, NEW.project_id, NEW.organisation_id,
            -- The triage handoff is 'assigned'; every later move is 'reassigned'.
            CASE WHEN OLD.status = 'triage' THEN 'assigned' ELSE 'reassigned' END,
            OLD.assignee_id, NEW.assignee_id,
            OLD.ball_in_court_id, NEW.ball_in_court_id, v_actor, v_role);

    INSERT INTO projects.work_item_watchers (work_item_id, user_id, reason)
    VALUES (NEW.id, NEW.assignee_id, 'assignee') ON CONFLICT DO NOTHING;
  END IF;

  IF NEW.gatekeeper_id IS DISTINCT FROM OLD.gatekeeper_id THEN
    INSERT INTO projects.work_item_events
      (work_item_id, project_id, organisation_id, verb, from_user_id, to_user_id,
       from_ball_in_court_id, to_ball_in_court_id, actor_id, actor_role)
    VALUES (NEW.id, NEW.project_id, NEW.organisation_id, 'reassigned',
            OLD.gatekeeper_id, NEW.gatekeeper_id,
            OLD.ball_in_court_id, NEW.ball_in_court_id, v_actor, v_role);

    INSERT INTO projects.work_item_watchers (work_item_id, user_id, reason)
    VALUES (NEW.id, NEW.gatekeeper_id, 'gatekeeper') ON CONFLICT DO NOTHING;
  END IF;

  IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    INSERT INTO projects.work_item_events
      (work_item_id, project_id, organisation_id, verb, from_due_date, to_due_date,
       from_ball_in_court_id, to_ball_in_court_id, actor_id, actor_role)
    VALUES (NEW.id, NEW.project_id, NEW.organisation_id, 'due_changed',
            OLD.due_date, NEW.due_date,
            OLD.ball_in_court_id, NEW.ball_in_court_id, v_actor, v_role);
  END IF;

  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS append_work_item_event_trg ON projects.work_items;
CREATE TRIGGER append_work_item_event_trg
  AFTER INSERT OR UPDATE ON projects.work_items
  FOR EACH ROW EXECUTE FUNCTION projects.append_work_item_event();

REVOKE ALL ON FUNCTION projects.append_work_item_event() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.append_work_item_event() FROM anon;
```

- [ ] **Step 4: Run it and watch it pass.**

```bash
scripts/db/try-work-item-spine.sh scripts/db/assertions/work-item-events.sql
```

Expected `✓ work-item-events.sql — all assertions passed`.

- [ ] **Step 5: Mutation proof — make the trigger `SECURITY INVOKER`.** Delete `SECURITY DEFINER` from the function, re-run, and confirm the very first insert fails. **The message will be `permission denied for table work_item_events`, not an RLS message**, because §10 revoked `INSERT` from `authenticated` on top of there being no policy — either failure proves the point, and this one proves it twice. This only works because the assertion file switches to a real user first; as the owner nothing would have changed. Restore.

- [ ] **Step 6: Mutation proof — drop `from_status`.** Change the status-change insert to write only `to_status`, re-run, and confirm assertion 4 fails with `no (open -> answered) event row; metric 4 has no numerator`. Restore.

- [ ] **Step 7: Mutation proof — drop the ball-in-court columns from the status arm.** Remove `from_ball_in_court_id, to_ball_in_court_id` (and their values) from the status-change insert, re-run, and confirm assertion 5 fails with `metric 5 has no denominator`. Restore.

- [ ] **Step 8: Mutation proof — delete the watcher seeding.** Remove the `INSERT INTO projects.work_item_watchers` block from the `TG_OP = 'INSERT'` arm, re-run, and confirm assertion 8 fails with `the creator/assignee was not auto-added as a watcher`. Restore and re-run to green. Record all four in the PR body.

- [ ] **Step 9: Commit.**

```bash
git add apps/edge-functions/supabase/migrations/00192_work_item_spine.sql \
        scripts/db/assertions/work-item-events.sql
git commit -m "feat(work-items): SECURITY DEFINER append trigger for events and watchers

The only writer of both tables. Definer because work_item_events carries a
SELECT policy, no write policy (the 00179:504-506 shape) and no INSERT grant for
authenticated — an invoker trigger dies on the first event. Attribution from
auth.uid(), never current_user, which under SECURITY DEFINER is the function
owner.

Records both endpoints of every status, assignee, gatekeeper and due-date change
(metric 4's numerator), the ball-in-court handover on every one of them (metric
5's denominator) and the actor's effective role stamped at event time (§15 §(b),
metric 2a's only first-party signal). None of the three can be backfilled.

Also seeds work_item_watchers on create and on every reassignment — nothing else
in Q1 writes that table, so without this the SELECT policy's watcher arm is dead
code and item 4 inherits an empty subscription list.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 11 — The transition guard: the status machine and "only the gatekeeper closes" (§12)

This is the trigger that ends the current behaviour where **any org member can close any RFI**. `closeRfiAction` (`apps/web/src/actions/rfi.actions.ts:182-234`) checks authentication and nothing else, and the only backstop, `00027_rls_insert_policies.sql:47-50`, permits UPDATE to any active member of the owning org on any project, member or not.

⚠ **It is `SECURITY INVOKER` — the default — because it needs no elevated rights, and it must never test `current_user`.** It reads `OLD`/`NEW`, calls `auth.uid()` and calls `projects.user_can_write_work_item()`, which is itself `SECURITY DEFINER` and granted to `authenticated`. **Be precise about the reason, because the plan this replaces was not:** `auth.uid()` reads a GUC and is completely unaffected by the security context, so declaring this function `SECURITY DEFINER` would change nothing at all. The defect `00179:341-346` documents is specifically a **`current_user`** role test inside a definer function, where `current_user` resolves to the function owner and the test is true for every caller. The house precedent, `projects.qc_reports_status_guard` (`00172_qc_reports.sql:249`), is itself declared `SECURITY DEFINER SET search_path = ''` and is safe *precisely because* it tests `auth.uid()`. Copy its shape, including the `auth.uid() IS NULL` exemption for the service-client paths the action layer already gates.

⚠ **RLS cannot compare OLD and NEW.** That is why this is a trigger and not a policy.

**The manual ball-in-court shift writes the column the *current* status selects** (§03 §1.4): `assignee_id` while `triage` or `open`, `gatekeeper_id` while `answered`. A PM handing an answered RFI to a different reviewer changes the **gatekeeper**; writing `assignee_id` in that state would regenerate an unchanged ball-in-court and look like a broken control.

⚠ **A write-role holder may CORRECT either person column in any live state, and that is not the same rule.** §1.4's restriction is about which column *moves the ball*. Correcting a gatekeeper while the item is still `open` moves nothing — and A(b) makes `task`'s gatekeeper the **creator**, so without this a contractor who raises a task for a WM engineer is the only person who may ever close it, and the PM cannot fix that until the engineer has already done the work. Improvement 10.

⚠ **`title` is immutable while `origin = 'mirror'`.** The PERMISSIVE UPDATE policy lets an assignee edit `title` on any row they hold, and item 3's mirror trigger fires again on the next source change — so without a decision here, either the PM's clarification vanishes or the mirror stops tracking. The decision is recorded in Task 16's hand-off so item 3 does not assume the opposite. Improvement 12.

**Files:**
- Modify: `apps/edge-functions/supabase/migrations/00192_work_item_spine.sql` (append section 12)
- Create: `scripts/db/assertions/work-item-transition.sql`

- [ ] **Step 1: Write the assertion file first.** Every assertion runs **as a real authenticated user**, because a guard tested as `postgres` (where `auth.uid()` is NULL and the exemption fires) is the definition of a test that cannot fail.

⚠ **The assignee fixture must NOT be a write-role holder, or half these assertions cannot fail.** Measured on 2026-09-10, every active `project_members` row in production is `contractor`, `project_manager` or `client_viewer` — there is not one `inspector` or `supplier` — and `contractor` **is** in `MARKUP_WRITE_ROLES`, which is `task`'s write set. So the file demotes the fixture member to `inspector` inside the rolled-back transaction (`user_effective_project_role` falls through to `project_members.role` for anyone whose org role is not owner/admin/PM — `00107:59-66`). Without that demotion the "only the ball-in-court holder may shift the selected column" assertions all pass for the wrong reason.

Create `scripts/db/assertions/work-item-transition.sql`:

```sql
CREATE TEMP TABLE _t AS
SELECT pm.project_id, p.organisation_id,
       '018f2d31-bbe8-4cc1-bbdd-63af0187081e'::uuid AS actor_id,
       projects.resolve_project_pm(pm.project_id) AS pm_id
  FROM projects.project_members pm
  JOIN projects.projects p ON p.id = pm.project_id
 WHERE pm.user_id = '018f2d31-bbe8-4cc1-bbdd-63af0187081e' AND pm.is_active
 LIMIT 1;
GRANT SELECT ON _t TO authenticated;

DO $$
DECLARE t record; v_rfi uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _t) THEN
    RAISE EXCEPTION 'the rbac-test fixture has no project membership; the transition guard cannot be exercised as a real user';
  END IF;
  SELECT * INTO t FROM _t;
  IF t.pm_id = t.actor_id THEN
    RAISE EXCEPTION 'the fixture actor IS the project PM; "the assignee may not close" cannot fail';
  END IF;
  INSERT INTO projects.calendar_years (year)
  VALUES (EXTRACT(YEAR FROM CURRENT_DATE)::int), (EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)
  ON CONFLICT DO NOTHING;

  -- Demote the actor to a NON-write role for the duration of this transaction.
  -- Every live project_members row in production is contractor / project_manager
  -- / client_viewer, and contractor IS in task's write set — so without this the
  -- "only the holder may shift the selected column" assertions pass vacuously.
  UPDATE projects.project_members SET role = 'inspector'
   WHERE project_id = t.project_id AND user_id = t.actor_id;
  IF public.user_effective_project_role(t.project_id, t.actor_id) <> 'inspector' THEN
    RAISE EXCEPTION 'the demotion did not take (org-level role wins); pick a fixture whose org role is not owner/admin/project_manager';
  END IF;
  IF projects.user_can_write_work_item(t.project_id, 'task') THEN
    RAISE EXCEPTION 'the demoted actor still holds a write role for task';
  END IF;

  -- Subject: assignee = the demoted actor, gatekeeper = the PM.
  -- origin = 'manual' EXPLICITLY. The column default is 'mirror', and clause
  -- (a2) freezes the title of a mirrored row — so a defaulted subject would
  -- make assertion 7 (the control proving 6 is not a blanket freeze) fail.
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, origin)
  VALUES (t.organisation_id, t.project_id, 'task', 'transition subject', t.actor_id, t.pm_id, t.pm_id, 'manual');

  -- A mirrored subject, for the title-immutability rule.
  SELECT r.id INTO v_rfi FROM projects.rfis r WHERE r.project_id = t.project_id LIMIT 1;
  IF v_rfi IS NULL THEN
    RAISE EXCEPTION 'no rfi on the fixture project; the origin=mirror title rule cannot be exercised';
  END IF;
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, rfi_id, origin)
  VALUES (t.organisation_id, t.project_id, 'rfi', 'mirrored subject', t.actor_id, t.pm_id, t.pm_id, v_rfi, 'mirror');
END $$;

-- Act as the ASSIGNEE, who is neither the gatekeeper nor a write-role holder.
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT actor_id FROM _t), 'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE v_id uuid; v_mirror uuid;
BEGIN
  SELECT id INTO v_id     FROM projects.work_items WHERE title='transition subject';
  SELECT id INTO v_mirror FROM projects.work_items WHERE title='mirrored subject';
  IF v_id IS NULL OR v_mirror IS NULL THEN
    RAISE EXCEPTION 'the assignee cannot even SEE their subjects; the RLS SELECT policy is wrong';
  END IF;

  -- 1. The assignee may move their own item forward. That is how a contractor answers.
  UPDATE projects.work_items SET status='open'     WHERE id=v_id;
  UPDATE projects.work_items SET status='answered' WHERE id=v_id;

  -- 2. THE ASSIGNEE MAY NOT CLOSE. This is the rule that ends "any contractor can
  --    close any RFI in WM's org". Assert on the MESSAGE: a bare "it raised"
  --    handler passes whenever the statement failed for any reason at all.
  BEGIN
    UPDATE projects.work_items SET status='closed' WHERE id=v_id;
    RAISE EXCEPTION 'SENTINEL: the assignee closed an item they do not gatekeep';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%can close it%' THEN
      RAISE EXCEPTION 'the close attempt failed for the wrong reason: %', SQLERRM; END IF;
  END;

  -- 3. An illegal jump is refused. void is terminal; closed reopens only to open.
  BEGIN
    UPDATE projects.work_items SET status='triage' WHERE id=v_id;
    RAISE EXCEPTION 'SENTINEL: answered -> triage was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%cannot move from%' THEN
      RAISE EXCEPTION 'the illegal-jump attempt failed for the wrong reason: %', SQLERRM; END IF;
  END;

  -- 4. While ANSWERED the shift writes gatekeeper_id, never assignee_id —
  --    writing the unselected column would regenerate an unchanged ball-in-court
  --    and look like a broken control (§03 §1.4). This binds only to someone who
  --    is NOT a write-role holder; a PM correcting the same column is assertion 10.
  BEGIN
    UPDATE projects.work_items SET assignee_id = gatekeeper_id WHERE id=v_id;
    RAISE EXCEPTION 'SENTINEL: assignee_id was writable by a non-write-role holder while the item was answered';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%with the reviewer%' THEN
      RAISE EXCEPTION 'the answered-assignee-write attempt failed for the wrong reason: %', SQLERRM; END IF;
  END;

  -- 5. Immutable columns stay immutable. ref is a permanent identifier in emails,
  --    PDFs and other people's notes.
  BEGIN
    UPDATE projects.work_items SET ref = 'HACK-1' WHERE id=v_id;
    RAISE EXCEPTION 'SENTINEL: ref was mutable';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%cannot be renumbered%' THEN
      RAISE EXCEPTION 'the ref-mutation attempt failed for the wrong reason: %', SQLERRM; END IF;
  END;

  -- 6. A MIRRORED item's title belongs to its source. Without this rule, item 3's
  --    mirror trigger and a PM's clarification silently overwrite each other.
  BEGIN
    UPDATE projects.work_items SET title = 'edited by hand' WHERE id=v_mirror;
    RAISE EXCEPTION 'SENTINEL: a mirrored item''s title was editable';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%mirrored from its source%' THEN
      RAISE EXCEPTION 'the mirrored-title attempt failed for the wrong reason: %', SQLERRM; END IF;
  END;

  -- 7. ...but a MANUAL item's title is editable, or assertion 6 would also pass
  --    for a guard that froze every title.
  UPDATE projects.work_items SET title = 'transition subject' , priority='high' WHERE id=v_id;

  RAISE NOTICE 'work-item-transition (assignee): 1-7 passed';
END $$;

RESET ROLE;

-- Act as the GATEKEEPER, who is also the project PM and therefore a write-role
-- holder — the two affordances that role has are asserted together.
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT pm_id FROM _t), 'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE v_id uuid; v_at timestamptz; v_by uuid; v_bic uuid; t record;
BEGIN
  SELECT * INTO t FROM _t;
  SELECT id INTO v_id FROM projects.work_items WHERE title='transition subject';

  -- 8. VOID DEMANDS A REASON. Run here, not as the assignee: while the item is
  --    `answered` the ball is with the GATEKEEPER, so an assignee attempting a
  --    void is refused for lack of authority and never reaches the reason check.
  BEGIN
    UPDATE projects.work_items SET status='void' WHERE id=v_id;
    RAISE EXCEPTION 'SENTINEL: void was accepted with no void_reason';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%needs a short reason%' THEN
      RAISE EXCEPTION 'the reasonless void failed for the wrong reason: %', SQLERRM; END IF;
  END;

  -- 9. The gatekeeper closes, and closed_at/closed_by are STAMPED by the guard,
  --    not supplied by the caller.
  UPDATE projects.work_items SET status='closed' WHERE id=v_id;
  SELECT closed_at, closed_by, ball_in_court_id INTO v_at, v_by, v_bic
    FROM projects.work_items WHERE id=v_id;
  IF v_at IS NULL OR v_by IS NULL THEN RAISE EXCEPTION 'close did not stamp closed_at/closed_by'; END IF;
  IF v_by <> auth.uid() THEN RAISE EXCEPTION 'closed_by is % not the closer', v_by; END IF;
  IF v_bic IS NOT NULL THEN RAISE EXCEPTION 'a closed item still holds a ball_in_court'; END IF;

  -- 10. Reopening clears the close stamps rather than leaving a lie behind.
  UPDATE projects.work_items SET status='open' WHERE id=v_id;
  SELECT closed_at, closed_by INTO v_at, v_by FROM projects.work_items WHERE id=v_id;
  IF v_at IS NOT NULL OR v_by IS NOT NULL THEN RAISE EXCEPTION 'reopen left closed_at/closed_by set'; END IF;

  -- 11. A WRITE-ROLE HOLDER MAY CORRECT THE GATEKEEPER WHILE THE ITEM IS OPEN.
  --     A(b) makes task's gatekeeper the CREATOR, so without this a contractor
  --     who raises a task for a WM engineer is the only person who may ever
  --     close it, and the PM cannot fix that until the work is already done.
  --     Correcting a gatekeeper while the item is open moves no ball.
  UPDATE projects.work_items SET gatekeeper_id = t.actor_id WHERE id=v_id;
  IF (SELECT gatekeeper_id FROM projects.work_items WHERE id=v_id) <> t.actor_id
  THEN RAISE EXCEPTION 'a write-role holder could not correct the gatekeeper on an open item'; END IF;
  UPDATE projects.work_items SET gatekeeper_id = t.pm_id WHERE id=v_id;

  -- 12. ...but NOT once the item is closed or void. A closed item's people are
  --     part of the record.
  UPDATE projects.work_items SET status='answered' WHERE id=v_id;
  UPDATE projects.work_items SET status='closed'   WHERE id=v_id;
  BEGIN
    UPDATE projects.work_items SET gatekeeper_id = t.actor_id WHERE id=v_id;
    RAISE EXCEPTION 'SENTINEL: a closed item''s gatekeeper was changed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%Reopen it before changing%' THEN
      RAISE EXCEPTION 'the closed-item person change failed for the wrong reason: %', SQLERRM; END IF;
  END;

  -- 13. Void with a reason is accepted, and the item leaves every inbox.
  UPDATE projects.work_items SET status='open' WHERE id=v_id;
  UPDATE projects.work_items SET status='void', void_reason='assertion' WHERE id=v_id;
  IF (SELECT ball_in_court_id FROM projects.work_items WHERE id=v_id) IS NOT NULL
  THEN RAISE EXCEPTION 'a void item still holds a ball_in_court'; END IF;

  RAISE NOTICE 'work-item-transition (gatekeeper): 8-13 passed';
END $$;

RESET ROLE;
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
scripts/db/try-work-item-spine.sh scripts/db/assertions/work-item-transition.sql
```

Expected: assertion 2 raises `SENTINEL: the assignee closed an item they do not gatekeep`. Red — and that is today's production behaviour, reproduced.

- [ ] **Step 3: Append section 12 to `00192_work_item_spine.sql`.**

```sql
-- ─── 12. The transition guard ────────────────────────────────────────────────
-- SECURITY INVOKER (the default), because it needs no elevated rights: it reads
-- OLD/NEW, calls auth.uid(), and calls user_can_write_work_item(), itself
-- SECURITY DEFINER and granted to authenticated.
--
-- BE PRECISE ABOUT WHY. auth.uid() reads a GUC and is unaffected by the security
-- context, so declaring this DEFINER would change nothing on its own. The defect
-- 00179:341-346 documents is a CURRENT_USER role test inside a definer function,
-- where current_user resolves to the function OWNER and the test is true for
-- every caller. THE RULE THIS FUNCTION MUST NEVER BREAK IS: no current_user, in
-- any security context. The house precedent, projects.qc_reports_status_guard
-- (00172:249), is itself declared SECURITY DEFINER SET search_path = '' and is
-- safe precisely because it tests auth.uid().
--
-- RLS can gate WHO may update a row but not WHICH transition they may make, which
-- is why this is a trigger. The auth.uid() IS NULL exemption matches
-- qc_reports_status_guard: service-role and admin server paths run with no JWT
-- and are gated by the action layer.
--
-- Every RAISE below is a SENTENCE naming the item's ref, because all five server
-- actions end `return { error: error.message }` — these strings are user-facing
-- copy, quoted in support conversations and screenshots the day they ship.
CREATE OR REPLACE FUNCTION projects.work_items_transition_guard() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'projects', 'public'
AS $fn$
DECLARE
  v_actor      uuid := auth.uid();
  v_may_write  boolean;
  v_is_holder  boolean;
  v_may_manage boolean;
BEGIN
  NEW.last_activity_at := now();

  IF v_actor IS NULL THEN
    -- Service client / migration. The action layer is what gates these.
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status = 'closed' THEN NEW.closed_at := now();
      ELSE NEW.closed_at := NULL; NEW.closed_by := NULL; END IF;
    END IF;
    RETURN NEW;
  END IF;

  v_may_write  := projects.user_can_write_work_item(NEW.project_id, NEW.item_type);
  v_is_holder  := v_actor = OLD.ball_in_court_id;
  v_may_manage := v_may_write OR v_is_holder;

  -- (a) Immutable columns. ref is immutable because it is a permanent identifier
  --     in emails, PDFs and other people's notes (§15 §(e)).
  IF NEW.project_id      IS DISTINCT FROM OLD.project_id
  OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
  OR NEW.item_type       IS DISTINCT FROM OLD.item_type
  OR NEW.ref             IS DISTINCT FROM OLD.ref
  OR NEW.origin          IS DISTINCT FROM OLD.origin
  OR NEW.created_by      IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION '% cannot be renumbered, retyped or moved to another project — those details are fixed when the item is created.', OLD.ref
      USING ERRCODE = 'raise_exception';
  END IF;

  -- (a2) A MIRRORED item's title belongs to its source row. Item 3's mirror
  --      trigger rewrites it on every source change, so a hand edit here would
  --      silently vanish — or, if item 3 deferred to the edit, the mirror would
  --      stop tracking. Decided here so both lanes cannot assume opposites.
  IF OLD.origin = 'mirror' AND NEW.title IS DISTINCT FROM OLD.title THEN
    RAISE EXCEPTION '% is mirrored from its source record, so its title is edited there and updates here automatically.', OLD.ref
      USING ERRCODE = 'raise_exception';
  END IF;

  -- (b) The person columns.
  --     * A closed or void item's people are part of the record.
  --     * The BALL-IN-COURT HOLDER may only shift the column the CURRENT status
  --       selects (§03 §1.4): assignee while triage/open, gatekeeper while
  --       answered. Writing the other one regenerates an unchanged
  --       ball-in-court and looks like a broken control.
  --     * A WRITE-ROLE HOLDER may CORRECT either column in any live state.
  --       §1.4's restriction is about which column MOVES THE BALL; correcting a
  --       gatekeeper while the item is open moves nothing. A(b) makes task's
  --       gatekeeper the creator, so without this a contractor-raised task on a
  --       WM engineer has the contractor as its only possible closer for the
  --       whole of its open life.
  IF (NEW.assignee_id IS DISTINCT FROM OLD.assignee_id
   OR NEW.gatekeeper_id IS DISTINCT FROM OLD.gatekeeper_id)
   AND OLD.status IN ('closed','void') THEN
    RAISE EXCEPTION '% is %. Reopen it before changing who it belongs to.', OLD.ref, OLD.status
      USING ERRCODE = 'raise_exception';
  END IF;

  IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    IF NOT v_may_write AND OLD.status NOT IN ('triage','open') THEN
      RAISE EXCEPTION '% is with the reviewer. Change the reviewer, not the person who did the work.', OLD.ref
        USING ERRCODE = 'raise_exception';
    END IF;
    IF NOT v_may_manage THEN
      RAISE EXCEPTION 'Only the project team, or whoever is holding %, can hand it to someone else.', OLD.ref
        USING ERRCODE = 'raise_exception';
    END IF;
  END IF;

  IF NEW.gatekeeper_id IS DISTINCT FROM OLD.gatekeeper_id THEN
    IF NOT v_may_write AND OLD.status <> 'answered' THEN
      RAISE EXCEPTION '% is still being worked on. Change who it is assigned to, not who signs it off.', OLD.ref
        USING ERRCODE = 'raise_exception';
    END IF;
    IF NOT v_may_manage THEN
      RAISE EXCEPTION 'Only the project team, or whoever is holding %, can change who signs it off.', OLD.ref
        USING ERRCODE = 'raise_exception';
    END IF;
  END IF;

  -- (c) The status machine. void is terminal; closed reopens only to open.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ( (OLD.status = 'triage'   AND NEW.status IN ('open','void'))
          OR (OLD.status = 'open'     AND NEW.status IN ('answered','closed','void'))
          OR (OLD.status = 'answered' AND NEW.status IN ('open','closed','void'))
          OR (OLD.status = 'closed'   AND NEW.status = 'open') ) THEN
      RAISE EXCEPTION '% cannot move from "%" to "%".', OLD.ref, OLD.status, NEW.status
        USING ERRCODE = 'raise_exception';
    END IF;

    -- (d) ONLY THE GATEKEEPER CLOSES. Compared against auth.uid(), never
    --     current_user. An org admin who needs to close makes themselves the
    --     gatekeeper first — which is itself gated by (b) and recorded as an
    --     event.
    IF NEW.status = 'closed' AND v_actor IS DISTINCT FROM NEW.gatekeeper_id THEN
      RAISE EXCEPTION 'Only the person who signs % off can close it. Take it over first, or ask them to close it.', OLD.ref
        USING ERRCODE = 'raise_exception';
    END IF;

    IF NEW.status = 'void' THEN
      IF NOT v_may_manage THEN
        RAISE EXCEPTION 'Only the project team, or whoever is holding %, can drop it.', OLD.ref
          USING ERRCODE = 'raise_exception';
      END IF;
      -- Enforced here rather than as a sixth CHECK, so A(a)'s constraint set
      -- stays reproduced exactly and §12 §(h)'s DDL diff keeps working.
      IF COALESCE(btrim(NEW.void_reason), '') = '' THEN
        RAISE EXCEPTION 'Dropping % needs a short reason. Say why it is no longer needed.', OLD.ref
          USING ERRCODE = 'raise_exception';
      END IF;
    END IF;

    IF NEW.status = 'closed' THEN
      NEW.closed_at := now(); NEW.closed_by := v_actor;
    ELSE
      NEW.closed_at := NULL;  NEW.closed_by := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS work_items_transition_guard_trg ON projects.work_items;
CREATE TRIGGER work_items_transition_guard_trg
  BEFORE UPDATE ON projects.work_items
  FOR EACH ROW EXECUTE FUNCTION projects.work_items_transition_guard();
```

- [ ] **Step 4: Run it and watch it pass.**

```bash
scripts/db/try-work-item-spine.sh scripts/db/assertions/work-item-transition.sql
```

Expected `✓ work-item-transition.sql — all assertions passed`.

- [ ] **Step 5: Mutation proof — switch the gatekeeper test to `current_user`.** Replace `v_actor IS DISTINCT FROM NEW.gatekeeper_id` with `current_user IS DISTINCT FROM NEW.gatekeeper_id::text`, re-run, and watch it break. `current_user` under RLS is the string `authenticated`, which never equals a uuid, so the comparison is **always** distinct and the guard now refuses `closed` to *everyone* — **assertion 9 fails** (`close did not stamp closed_at/closed_by` never runs; the UPDATE raises `Only the person who signs … off can close it` at the gatekeeper). Assertion 2 still passes, for the wrong reason. Record which assertion broke and confirm it is 9: the lesson is that **`current_user` is not a person**, so a rule about people cannot be written in terms of it, in any direction. Restore.

> **Do NOT bother adding `SECURITY DEFINER` as a mutation.** It would change nothing — `auth.uid()` reads a GUC and is unaffected by the security context — and a "mutation proof" whose mutation cannot fail is precisely the decorative test this plan is written to avoid. The real hazard is `current_user`, which is what Step 5 exercises. (The house precedent `projects.qc_reports_status_guard` is itself `SECURITY DEFINER` and correct, for exactly this reason.)

- [ ] **Step 6: Mutation proof — widen the status machine.** Add `OR TRUE` to the transition matrix, re-run, and confirm assertion 3 fails (`SENTINEL: answered -> triage was accepted`). Restore.

- [ ] **Step 7: Mutation proof — freeze every title, not just mirrored ones.** Delete `OLD.origin = 'mirror' AND` from clause (a2), re-run, and confirm assertion 7 now fails — the control that proves assertion 6 is testing the mirror rule and not a blanket freeze. Restore.

- [ ] **Step 8: Mutation proof — remove the write-role correction affordance.** Change clause (b)'s gatekeeper arm to `IF OLD.status <> 'answered' THEN RAISE …` unconditionally, re-run, and confirm assertion 11 fails with `a write-role holder could not correct the gatekeeper on an open item`. Restore and re-run to green. Record all four in the PR body.

- [ ] **Step 9: Run the whole suite green before moving on.**

```bash
for f in scripts/db/assertions/work-item-*.sql; do
  scripts/db/try-work-item-spine.sh "$f" || { echo "FAILED: $f"; break; }
done
```

Expected: nine `✓` lines (`work-item-defaults.sql` arrives in Task 12).

- [ ] **Step 10: Commit.**

```bash
git add apps/edge-functions/supabase/migrations/00192_work_item_spine.sql \
        scripts/db/assertions/work-item-transition.sql
git commit -m "feat(work-items): transition guard — the status machine and gatekeeper-only close

SECURITY INVOKER because it needs no elevated rights, and it never tests
current_user in ANY security context — that, not the DEFINER keyword, is the
00179:341-346 defect. (qc_reports_status_guard, 00172:249, is itself DEFINER and
safe because it tests auth.uid().) Ends the current behaviour where any org
member can close any RFI.

The ball-in-court holder may shift only the column the current status selects; a
write-role holder may CORRECT either person column in any live state, because
A(b) makes task's gatekeeper the creator and a contractor-raised task would
otherwise have the contractor as its only possible closer. A mirrored item's
title belongs to its source, so item 3's mirror and a hand edit cannot silently
overwrite each other. Void demands a reason; closed_at/closed_by are stamped by
the guard and cleared on reopen.

Every RAISE is a sentence naming the ref: all five server actions return
error.message straight to the user.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 12 — Seeding `work_item_defaults` and validating its keys (§13)

**Defaults are data, not code** (§13 deliverable 2). The per-type due offset, unnamed-assignee rule and gatekeeper live in `projects.project_settings.work_item_defaults`, keyed by `item_type`.

⚠ **The seeding and the validation trigger land here, in migration B, not in migration A.** The column is added in A, but a `CHECK` cannot reference another table, so the key validation is a trigger — and that trigger reads `projects.work_item_types`, which does not exist until B.

⚠ **`rfi`'s `days_to_respond` is seeded NULL, deliberately, and the due-date trigger reads `default_rfi_due_days` LIVE.** Copying `00101:30`'s value into the jsonb at migration time would hold only until the first PM edited the setting: the settings surface writes `default_rfi_due_days` and never touches `work_item_defaults`, and `work_items_set_due_date` reads only the jsonb. The brief requires `rfi` to **read** the existing default, not to snapshot it — so the assertion below is about **behaviour** (change the setting, the next RFI's due date moves), which a copy design cannot satisfy. Today that value is fetched and thrown away — `projectSettingsService.getRfiDefaults` returns `dueDays` (`packages/shared/src/services/project-settings.service.ts:325-340`) and `rfiService.create` writes `due_date: input.dueDate || null` (`rfi.service.ts:98`), ignoring it entirely.

⚠ **A trigger `WHEN` clause cannot reference `TG_OP`, and cannot reference `OLD` on a trigger that covers `INSERT`.** Proven against production: `CREATE TRIGGER … WHEN (TG_OP = 'INSERT' OR NEW.j IS DISTINCT FROM OLD.j)` fails with `ERROR: 42703: column "tg_op" does not exist`, and the `TG_OP`-free form fails on `OLD`. The guard goes in the **function body**.

**Files:**
- Modify: `apps/edge-functions/supabase/migrations/00192_work_item_spine.sql` (append section 13)
- Create: `scripts/db/assertions/work-item-defaults.sql`

- [ ] **Step 1: Write the assertion file first.**

Create `scripts/db/assertions/work-item-defaults.sql`:

```sql
DO $$
DECLARE
  v_proj uuid; v_org uuid; v_pm uuid; v_rfi uuid; v_id uuid;
  n int; v_dead uuid; d date; d_expected date;
BEGIN
  -- The fixture must be a project that HAS an rfi, because assertion 2 inserts
  -- one (work_items_source_required). RAISE rather than skip.
  SELECT p.id, p.organisation_id INTO v_proj, v_org
    FROM projects.projects p
   WHERE p.status='active' AND EXISTS (SELECT 1 FROM projects.rfis r WHERE r.project_id = p.id)
   ORDER BY p.created_at LIMIT 1;
  IF v_proj IS NULL THEN
    RAISE EXCEPTION 'no active project with an rfi; the live default_rfi_due_days assertion cannot be constructed';
  END IF;
  v_pm := projects.resolve_project_pm(v_proj);
  INSERT INTO projects.calendar_years (year)
  VALUES (EXTRACT(YEAR FROM CURRENT_DATE)::int), (EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)
  ON CONFLICT DO NOTHING;

  -- 1. EVERY project's defaults carry EVERY active type. A partial seed would
  --    silently fall back to the registry for the missing ones and look fine.
  SELECT count(*) INTO n
    FROM projects.project_settings ps
   WHERE (SELECT count(*) FROM jsonb_object_keys(ps.work_item_defaults))
      <> (SELECT count(*) FROM projects.work_item_types WHERE is_active);
  IF n <> 0 THEN RAISE EXCEPTION '% project(s) have incomplete work_item_defaults', n; END IF;

  -- 2. rfi's days_to_respond is seeded NULL, ON PURPOSE. A copy of
  --    default_rfi_due_days taken at migration time would be right only until
  --    the first PM edited the setting.
  SELECT count(*) INTO n FROM projects.project_settings ps
   WHERE ps.work_item_defaults -> 'rfi' ->> 'days_to_respond' IS NOT NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION '% project(s) hold a COPY of default_rfi_due_days in work_item_defaults; the trigger must read the column live', n;
  END IF;

  -- 3. THE BEHAVIOUR THAT MATTERS. Move default_rfi_due_days and the next RFI's
  --    due date moves with it. This is the assertion a copy design cannot pass.
  UPDATE projects.project_settings SET default_rfi_due_days = 14 WHERE project_id = v_proj;
  SELECT r.id INTO v_rfi FROM projects.rfis r WHERE r.project_id = v_proj LIMIT 1;
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, rfi_id, origin)
  VALUES (v_org, v_proj, 'rfi', 'live default probe', v_pm, v_pm, v_pm, v_rfi, 'split')
  RETURNING id INTO v_id;
  SELECT due_date INTO d FROM projects.work_items WHERE id = v_id;
  d_expected := projects.push_past_builders_shutdown(
                  projects.add_working_days(
                    (now() AT TIME ZONE 'Africa/Johannesburg')::date, 14, v_proj, 'office'),
                  v_proj);
  IF d <> d_expected THEN
    RAISE EXCEPTION 'an rfi work item is due % but default_rfi_due_days = 14 implies %', d, d_expected;
  END IF;

  -- 4. A per-type OVERRIDE typed into work_item_defaults still wins over the
  --    column — which is the whole reason the key exists.
  UPDATE projects.project_settings ps
     SET work_item_defaults = jsonb_set(ps.work_item_defaults, '{rfi,days_to_respond}', to_jsonb(3))
   WHERE ps.project_id = v_proj;
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, rfi_id, origin)
  VALUES (v_org, v_proj, 'rfi', 'override probe', v_pm, v_pm, v_pm, v_rfi, 'split')
  RETURNING id INTO v_id;
  SELECT due_date INTO d FROM projects.work_items WHERE id = v_id;
  d_expected := projects.push_past_builders_shutdown(
                  projects.add_working_days(
                    (now() AT TIME ZONE 'Africa/Johannesburg')::date, 3, v_proj, 'office'),
                  v_proj);
  IF d <> d_expected THEN
    RAISE EXCEPTION 'a per-project override of 3 days produced %, expected %', d, d_expected;
  END IF;

  -- 5. An unknown key is REFUSED. A CHECK cannot reference work_item_types, so
  --    this has to be a trigger, and a typo'd key would otherwise sit in the
  --    jsonb forever, silently doing nothing.
  BEGIN
    UPDATE projects.project_settings
       SET work_item_defaults = work_item_defaults || jsonb_build_object('rfl', '{}'::jsonb)
     WHERE project_id = v_proj;
    RAISE EXCEPTION 'SENTINEL: an unregistered work_item_defaults key was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%is not a registered work-item type%' THEN
      RAISE EXCEPTION 'the unknown-key case failed for the wrong reason: %', SQLERRM; END IF;
  END;

  -- 6. A STALE id is NULLED, not rejected. Rejecting it would make every
  --    settings write on that project fail; leaving it would hand a dead uuid to
  --    assignee_id NOT NULL and abort the source write.
  v_dead := '00000000-0000-0000-0000-0000deadbeef'::uuid;
  UPDATE projects.project_settings
     SET work_item_defaults = jsonb_set(work_item_defaults, '{task,triage_owner_id}', to_jsonb(v_dead))
   WHERE project_id = v_proj;
  IF (SELECT work_item_defaults -> 'task' ->> 'triage_owner_id'
        FROM projects.project_settings WHERE project_id = v_proj) IS NOT NULL
  THEN RAISE EXCEPTION 'a stale triage_owner_id survived in work_item_defaults'; END IF;

  -- 7. A LIVE id is kept. Assertion 6 alone would pass if the trigger nulled
  --    everything, which would silently disable per-type overrides entirely.
  UPDATE projects.project_settings ps
     SET work_item_defaults = jsonb_set(ps.work_item_defaults, '{task,triage_owner_id}',
           to_jsonb(projects.resolve_project_pm(ps.project_id)))
   WHERE ps.project_id = v_proj;
  IF (SELECT work_item_defaults -> 'task' ->> 'triage_owner_id'
        FROM projects.project_settings WHERE project_id = v_proj) IS NULL
  THEN RAISE EXCEPTION 'the validator nulled a LIVE triage_owner_id'; END IF;

  -- 8. A settings UPDATE that does NOT touch work_item_defaults skips the
  --    validator entirely — that guard lives in the function body, because a
  --    trigger WHEN clause cannot reference TG_OP or OLD on an INSERT-covering
  --    trigger (proven on production: ERROR 42703 column "tg_op" does not exist).
  UPDATE projects.project_settings SET default_rfi_due_days = 9 WHERE project_id = v_proj;
  IF (SELECT default_rfi_due_days FROM projects.project_settings WHERE project_id = v_proj) <> 9
  THEN RAISE EXCEPTION 'an unrelated settings update did not take'; END IF;

  RAISE NOTICE 'work-item-defaults: 8/8 assertions passed';
END $$;
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
scripts/db/try-work-item-spine.sh scripts/db/assertions/work-item-defaults.sql
```

Expected: `14 project(s) have incomplete work_item_defaults`. Red.

- [ ] **Step 3: Append section 13 to `00192_work_item_spine.sql`.**

```sql
-- ─── 13. work_item_defaults: validation and seeding ──────────────────────────
-- The per-type settings are DATA, held as jsonb keyed by item_type, with keys
-- validated against projects.work_item_types by trigger — a CHECK cannot
-- reference another table. Typed columns were rejected: eight types in Q1, each
-- new one forcing a migration on a hot 1:1 table carrying an audit trigger.
--
-- A stale id is NULLED rather than rejected. There is no foreign key (jsonb) and
-- public.profiles cascades from auth.users (00001:62), so a departed employee's
-- id survives here; rejecting the write would make every settings save on that
-- project fail, and keeping it would hand a dead uuid to assignee_id NOT NULL.
--
-- THE NO-OP GUARD IS IN THE FUNCTION BODY, NOT IN A TRIGGER `WHEN` CLAUSE.
-- A WHEN clause cannot reference TG_OP (ERROR 42703: column "tg_op" does not
-- exist) and cannot reference OLD on a trigger that also covers INSERT.
CREATE OR REPLACE FUNCTION projects.validate_work_item_defaults() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'projects', 'public'
SET row_security TO 'off'
AS $fn$
DECLARE k text; v jsonb; cleaned jsonb := '{}'::jsonb; who uuid;
BEGIN
  -- Nothing to validate when this UPDATE did not touch the column. This is the
  -- guard a WHEN clause cannot express.
  IF TG_OP = 'UPDATE' AND NEW.work_item_defaults IS NOT DISTINCT FROM OLD.work_item_defaults THEN
    RETURN NEW;
  END IF;

  IF NEW.work_item_defaults IS NULL THEN
    NEW.work_item_defaults := '{}'::jsonb; RETURN NEW;
  END IF;

  FOR k, v IN SELECT key, value FROM jsonb_each(NEW.work_item_defaults) LOOP
    IF NOT EXISTS (SELECT 1 FROM projects.work_item_types t WHERE t.key = k) THEN
      RAISE EXCEPTION '"%" is not a registered work-item type, so it cannot have project defaults.', k
        USING ERRCODE = 'raise_exception';
    END IF;

    who := NULLIF(v ->> 'triage_owner_id', '')::uuid;
    IF who IS NOT NULL AND public.user_effective_project_role(NEW.project_id, who) IS NULL THEN
      v := jsonb_set(v, '{triage_owner_id}', 'null'::jsonb);
    END IF;

    who := NULLIF(v ->> 'gatekeeper_id', '')::uuid;
    IF who IS NOT NULL AND public.user_effective_project_role(NEW.project_id, who) IS NULL THEN
      v := jsonb_set(v, '{gatekeeper_id}', 'null'::jsonb);
    END IF;

    cleaned := cleaned || jsonb_build_object(k, v);
  END LOOP;

  NEW.work_item_defaults := cleaned;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION projects.validate_work_item_defaults() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.validate_work_item_defaults() FROM anon;

DROP TRIGGER IF EXISTS validate_work_item_defaults_trg ON projects.project_settings;
CREATE TRIGGER validate_work_item_defaults_trg
  BEFORE INSERT OR UPDATE ON projects.project_settings
  FOR EACH ROW EXECUTE FUNCTION projects.validate_work_item_defaults();

-- Seed every project with every active type.
--
-- rfi's days_to_respond is seeded NULL on purpose: work_items_set_due_date (§5)
-- reads project_settings.default_rfi_due_days (00101:30) LIVE for that type, so
-- editing the setting moves the next RFI instead of drifting from a copy taken
-- here. A per-project OVERRIDE typed into this key still wins, which is what the
-- key is for. Today the column's value is fetched by getRfiDefaults and thrown
-- away by rfiService.create (rfi.service.ts:98).
UPDATE projects.project_settings ps
   SET work_item_defaults = (
     SELECT jsonb_object_agg(t.key, jsonb_build_object(
              'days_to_respond',
                CASE WHEN t.key = 'rfi' THEN NULL ELSE to_jsonb(t.default_days) END,
              'triage_owner_id', NULL,
              'gatekeeper_id',   NULL))
       FROM projects.work_item_types t WHERE t.is_active)
 WHERE ps.work_item_defaults = '{}'::jsonb;
```

- [ ] **Step 4: Run it and watch it pass.**

```bash
scripts/db/try-work-item-spine.sh scripts/db/assertions/work-item-defaults.sql
```

Expected `✓ work-item-defaults.sql — all assertions passed`.

- [ ] **Step 5: Mutation proof — restore the `WHEN` clause you were tempted to write.** Replace the trigger with:

```sql
CREATE TRIGGER validate_work_item_defaults_trg
  BEFORE INSERT OR UPDATE ON projects.project_settings
  FOR EACH ROW
  WHEN (TG_OP = 'INSERT' OR NEW.work_item_defaults IS DISTINCT FROM OLD.work_item_defaults)
  EXECUTE FUNCTION projects.validate_work_item_defaults();
```

Re-run and confirm the **migration itself** aborts with `ERROR: 42703: column "tg_op" does not exist` — which means section 13 never applies, and every assertion file below it stops working. Restore the WHEN-less form. Record it: this is a `CREATE`-time syntax error, so it is only ever caught by applying the migration, never by reading it.

- [ ] **Step 6: Mutation proof — seed a copy of `default_rfi_due_days`.** Change the seed's `CASE WHEN t.key = 'rfi' THEN NULL` to `THEN to_jsonb(ps.default_rfi_due_days)` and re-run. Confirm assertion 2 fails naming the projects that now hold a copy. Then, to see why that matters, also delete the `CASE WHEN NEW.item_type = 'rfi' THEN v_rfi_default END` arm from `work_items_set_due_date` and re-run: assertion 3 fails, because the RFI is now due on the copied 7 days rather than the live 14. Restore both.

- [ ] **Step 7: Mutation proof — make the validator reject instead of null.** Replace the `jsonb_set(v, '{triage_owner_id}', 'null')` with a `RAISE EXCEPTION`, re-run, and confirm assertion 6's `UPDATE` now aborts the transaction — the exact "one departed employee makes this project's settings unsavable" failure. Restore.

- [ ] **Step 8: Mutation proof — make the validator null everything.** Remove the `IS NULL` condition so live ids are nulled too, re-run, and confirm assertion 7 fails (`the validator nulled a LIVE triage_owner_id`). Restore and re-run to green. Record all four.

- [ ] **Step 9: Run the whole assertion suite green before moving on.**

```bash
for f in scripts/db/assertions/work-item-*.sql; do
  scripts/db/try-work-item-spine.sh "$f" || { echo "FAILED: $f"; break; }
done
```

Expected: ten `✓` lines, one per assertion file (`settings`, `registry`, `ddl`, `due-date`, `ref`, `membership`, `rls`, `events`, `transition`, `defaults`).

- [ ] **Step 10: Commit.**

```bash
git add apps/edge-functions/supabase/migrations/00192_work_item_spine.sql \
        scripts/db/assertions/work-item-defaults.sql
git commit -m "feat(work-items): work_item_defaults seeding and key validation

Defaults are data, keyed by item_type, validated against work_item_types by
trigger because a CHECK cannot reference another table — and the no-op guard is
in the FUNCTION BODY, because a trigger WHEN clause cannot reference TG_OP
(ERROR 42703) or OLD on an INSERT-covering trigger.

rfi's days_to_respond is seeded NULL and the due-date trigger reads
project_settings.default_rfi_due_days LIVE, so editing that setting moves the
next RFI rather than drifting from a migration-time copy; a per-project override
typed into the key still wins. A stale id in the no-FK jsonb is NULLED, never
rejected: rejecting makes settings unsavable and keeping it hands a dead uuid to
assignee_id NOT NULL.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 13 — The app-layer gate: five server actions, the matrix and CONFORMANCE

The RESTRICTIVE policies are the **backstop, not the gate**. Server actions and `app/api/*` routes sit outside `(admin)/layout.tsx` and are directly invocable — that is how a role-blind read shipped on **every** saved report until PR #162 closed it. Every mutation calls `requireEffectiveRole` as well.

⚠ **Five verbs, not two, and this is the difference between a spine and a demo.** `task` is sourceless: no module owns its lifecycle, so with only create and reassign **no code path in the platform could ever close a task** — while §15 metric 7 (activation, Q1 target 35%) is defined as a new user moving any work item to `closed` in their first session, and the transition guard *requires* a `void_reason` that nothing could supply. §13 item 2 says the triage owner does exactly three things: "reassign, change the due date, or void it with a reason" — two of those three had no caller. Improvement 6.

⚠ **A task created with a named assignee is born `open`.** §03 §1.6: "An item created **with** an explicit assignee is inserted `status = 'open'`. An item created **without** one is inserted `status = 'triage'` … which is what makes the Q1 metric measurable rather than diluted by items already routed to a named person." This action always has an assignee, so it always supplies `'open'` — as a **server-side literal**, never from the payload. The column default stays `'triage'` for item 3's unnamed-assignee path. Improvement 7.

⚠ **`reassignWorkItemAction` admits the current ball-in-court holder.** §03 §1.4: "Only an `ORG_WRITE_ROLES` user **or the current BIC holder** may shift", and the DB guard implements exactly that. Gating the action on `ORG_WRITE_ROLES` alone made the app stricter than both, and the person it blocked is the one the quarter is aimed at: a foreman handed a snag that belongs to his electrician, who then ignores it. Improvement 8.

**Files:**
- Create: `apps/web/src/actions/work-items.actions.ts`
- Test: `apps/web/src/actions/work-items.actions.test.ts`
- Modify: `docs/rbac-matrix.md`
- Modify: `CONFORMANCE.md`

- [ ] **Step 1: Write the failing test first.**

Create `apps/web/src/actions/work-items.actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { createClientMock, requireEffectiveRoleMock, revalidatePathMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  requireEffectiveRoleMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock, revalidateTag: vi.fn() }))
vi.mock('@/lib/auth/require-role', () => ({ requireEffectiveRole: requireEffectiveRoleMock }))

import {
  createWorkItemTaskAction,
  reassignWorkItemAction,
  advanceWorkItemStatusAction,
  setWorkItemDueDateAction,
  voidWorkItemAction,
} from './work-items.actions'

const PROJECT = '11111111-1111-1111-1111-111111111111'
const ITEM    = '44444444-4444-4444-4444-444444444444'
const USER    = '22222222-2222-2222-2222-222222222222'
const OTHER   = '33333333-3333-3333-3333-333333333333'

/** `row` is whatever the single pre-read returns: the project row for create,
 *  the work-item row for every other verb. */
function client(insertSpy = vi.fn(), updateSpy = vi.fn(), row: any = { organisation_id: 'org-1' }) {
  const builder: any = {
    insert: (v: any) => { insertSpy(v); return { select: () => ({ single: async () => ({ data: { id: 'wi-1', ref: 'TASK-1' }, error: null }) }) } },
    update: (v: any) => { updateSpy(v); return { eq: () => ({ error: null }) } },
    select: () => ({ eq: () => ({ single: async () => ({ data: row, error: null }) }) }),
  }
  return {
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
    schema: () => ({ from: () => builder }),
    from: () => builder,
  }
}

const DENIED = { ok: false, error: 'Your role (client_viewer) is not allowed to perform this action' }

beforeEach(() => { vi.clearAllMocks(); createClientMock.mockResolvedValue(client()) })

describe('createWorkItemTaskAction', () => {
  it('refuses a client_viewer', async () => {
    requireEffectiveRoleMock.mockResolvedValue(DENIED)
    const r = await createWorkItemTaskAction({ projectId: PROJECT, title: 'x', assigneeId: USER })
    expect(r.error).toMatch(/not allowed/)
  })

  it('refuses an inspector', async () => {
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'Your role (inspector) is not allowed to perform this action' })
    const r = await createWorkItemTaskAction({ projectId: PROJECT, title: 'x', assigneeId: USER })
    expect(r.error).toBeTruthy()
  })

  it('forces created_by, item_type and status, and forwards no source FK, ref or date', async () => {
    const insertSpy = vi.fn()
    createClientMock.mockResolvedValue(client(insertSpy))
    requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'contractor' })
    await createWorkItemTaskAction({
      projectId: PROJECT, title: 'x', assigneeId: OTHER,
      // a hostile client payload
      ...( { created_by: OTHER, rfi_id: 'r', status: 'closed', ref: 'RFI-1', item_type: 'rfi' } as any ),
    } as any)
    const payload = insertSpy.mock.calls[0][0]
    expect(payload.created_by).toBe(USER)
    expect(payload.item_type).toBe('task')
    // §03 §1.6 — an item created WITH an explicit assignee is born open, so a
    // PM-created task does not land in the Triage filter and dilute the metric.
    expect(payload.status).toBe('open')
    expect(payload).not.toHaveProperty('rfi_id')
    expect(payload).not.toHaveProperty('ref')
    expect(payload).not.toHaveProperty('due_date')
    expect(payload).not.toHaveProperty('ball_in_court_id')
  })

  it('gates on the PROJECT role, not the primary org', async () => {
    requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'project_manager' })
    await createWorkItemTaskAction({ projectId: PROJECT, title: 'x', assigneeId: USER })
    expect(requireEffectiveRoleMock).toHaveBeenCalledWith(expect.anything(), PROJECT, expect.any(Array))
  })

  it('passes a supplied due date through — "by Friday" must not become next Thursday', async () => {
    const insertSpy = vi.fn()
    createClientMock.mockResolvedValue(client(insertSpy))
    requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'project_manager' })
    await createWorkItemTaskAction({ projectId: PROJECT, title: 'x', assigneeId: USER, dueDate: '2026-10-02' })
    expect(insertSpy.mock.calls[0][0].due_date).toBe('2026-10-02')
  })
})

describe('reassignWorkItemAction', () => {
  it('writes assignee_id while open and gatekeeper_id while answered', async () => {
    requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'project_manager' })

    let updateSpy = vi.fn()
    createClientMock.mockResolvedValue(client(vi.fn(), updateSpy, { status: 'open', project_id: PROJECT, ball_in_court_id: OTHER }))
    await reassignWorkItemAction({ workItemId: ITEM, userId: OTHER })
    expect(updateSpy.mock.calls[0][0]).toEqual({ assignee_id: OTHER })

    updateSpy = vi.fn()
    createClientMock.mockResolvedValue(client(vi.fn(), updateSpy, { status: 'answered', project_id: PROJECT, ball_in_court_id: OTHER }))
    await reassignWorkItemAction({ workItemId: ITEM, userId: OTHER })
    expect(updateSpy.mock.calls[0][0]).toEqual({ gatekeeper_id: OTHER })
  })

  it('refuses to write either column on a closed item', async () => {
    requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'project_manager' })
    const updateSpy = vi.fn()
    createClientMock.mockResolvedValue(client(vi.fn(), updateSpy, { status: 'closed', project_id: PROJECT, ball_in_court_id: null }))
    const r = await reassignWorkItemAction({ workItemId: ITEM, userId: OTHER })
    expect(r.error).toBeTruthy()
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('admits the current ball-in-court holder even when the role gate refuses', async () => {
    // §03 §1.4 and the DB guard both permit this; the action used to be stricter
    // than both, which is what stranded a foreman holding someone else's snag.
    requireEffectiveRoleMock.mockResolvedValue(DENIED)
    const updateSpy = vi.fn()
    createClientMock.mockResolvedValue(client(vi.fn(), updateSpy, { status: 'open', project_id: PROJECT, ball_in_court_id: USER }))
    const r = await reassignWorkItemAction({ workItemId: ITEM, userId: OTHER })
    expect(r.error).toBeUndefined()
    expect(updateSpy.mock.calls[0][0]).toEqual({ assignee_id: OTHER })
  })
})

describe('advanceWorkItemStatusAction', () => {
  it('lets the ball-in-court holder move their own item forward', async () => {
    requireEffectiveRoleMock.mockResolvedValue(DENIED)
    const updateSpy = vi.fn()
    createClientMock.mockResolvedValue(client(vi.fn(), updateSpy, { status: 'open', project_id: PROJECT, ball_in_court_id: USER }))
    const r = await advanceWorkItemStatusAction({ workItemId: ITEM, status: 'answered' })
    expect(r.error).toBeUndefined()
    expect(updateSpy.mock.calls[0][0]).toEqual({ status: 'answered' })
  })

  it('refuses a bystander with no write role and no ball', async () => {
    requireEffectiveRoleMock.mockResolvedValue(DENIED)
    const updateSpy = vi.fn()
    createClientMock.mockResolvedValue(client(vi.fn(), updateSpy, { status: 'open', project_id: PROJECT, ball_in_court_id: OTHER }))
    const r = await advanceWorkItemStatusAction({ workItemId: ITEM, status: 'answered' })
    expect(r.error).toBeTruthy()
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('accepts only open, answered and closed — void goes through voidWorkItemAction', async () => {
    requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'project_manager' })
    const r = await advanceWorkItemStatusAction({ workItemId: ITEM, status: 'void' as any })
    expect(r.error).toBeTruthy()
  })
})

describe('voidWorkItemAction', () => {
  it('requires a reason', async () => {
    requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'project_manager' })
    const r = await voidWorkItemAction({ workItemId: ITEM, reason: '  ' })
    expect(r.error).toBeTruthy()
  })

  it('writes the status and the reason together', async () => {
    requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'project_manager' })
    const updateSpy = vi.fn()
    createClientMock.mockResolvedValue(client(vi.fn(), updateSpy, { status: 'open', project_id: PROJECT, ball_in_court_id: OTHER }))
    await voidWorkItemAction({ workItemId: ITEM, reason: 'raised in error' })
    expect(updateSpy.mock.calls[0][0]).toEqual({ status: 'void', void_reason: 'raised in error' })
  })
})

describe('setWorkItemDueDateAction', () => {
  it('refuses a contractor — a due date is a management decision (§13 item 2)', async () => {
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'Your role (contractor) is not allowed to perform this action' })
    const updateSpy = vi.fn()
    createClientMock.mockResolvedValue(client(vi.fn(), updateSpy, { status: 'open', project_id: PROJECT, ball_in_court_id: USER }))
    const r = await setWorkItemDueDateAction({ workItemId: ITEM, dueDate: '2026-10-02' })
    expect(r.error).toBeTruthy()
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('writes the date', async () => {
    requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'project_manager' })
    const updateSpy = vi.fn()
    createClientMock.mockResolvedValue(client(vi.fn(), updateSpy, { status: 'open', project_id: PROJECT, ball_in_court_id: USER }))
    await setWorkItemDueDateAction({ workItemId: ITEM, dueDate: '2026-10-02' })
    expect(updateSpy.mock.calls[0][0]).toEqual({ due_date: '2026-10-02' })
  })
})
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
pnpm --filter web test -- work-items.actions
```

Expected: `Failed to resolve import "./work-items.actions"` — fifteen failing tests. Red.

- [ ] **Step 3: Write the actions.** Create `apps/web/src/actions/work-items.actions.ts`:

```ts
'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { MARKUP_WRITE_ROLES, ORG_WRITE_ROLES } from '@esite/shared'

/**
 * Work-item mutations — the five verbs Q1 needs.
 *
 * The RESTRICTIVE policies on projects.work_items are the BACKSTOP, not the
 * gate. A server action is directly invocable and sits outside
 * (admin)/layout.tsx, which is how a role-blind read shipped on every saved
 * report until PR #162 closed it — so each action re-checks the caller's
 * EFFECTIVE role on the project before touching the database.
 *
 * Nothing here supplies ref or ball_in_court_id, and only the create verb may
 * supply due_date. They are produced by the BEFORE INSERT triggers and the
 * generated column, and the whole point of the spine is that they cannot be
 * dictated by a caller.
 *
 * Two of these are deliberately WIDER than a plain role gate, matching the
 * database: reassign and advance-status also admit the CURRENT ball-in-court
 * holder (§03 §1.4). Two are deliberately NARROWER than the database: the
 * transition guard would let a write-role holder correct a person column in any
 * live state, and Q1 exposes no UI for that.
 */

// ─── create ──────────────────────────────────────────────────────────────────

const createTaskSchema = z.object({
  projectId:  z.string().uuid(),
  title:      z.string().trim().min(1).max(300),
  assigneeId: z.string().uuid(),
  priority:   z.enum(['low', 'medium', 'high', 'critical']).optional(),
  /**
   * "Send me the updated single-line by Friday" is the monday.com row §04 §(g)
   * says `task` exists to replace, and its migration is supposed to preserve
   * due dates. Without this field every manual task silently becomes due in
   * five office working days. work_items_set_due_date() respects a supplied
   * date and still applies the builders'-shutdown push.
   */
  dueDate:    z.string().date().optional(),
})
export type CreateWorkItemTaskInput = z.infer<typeof createTaskSchema>

export async function createWorkItemTaskAction(
  input: CreateWorkItemTaskInput,
): Promise<{ id?: string; ref?: string; error?: string }> {
  const parsed = createTaskSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const { projectId, title, assigneeId, priority, dueDate } = parsed.data

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // `task` is the only client-insertable type in Q1 (§03 §1.2). Its write set is
  // the registry's, mirrored here from the same shared constant the seed uses.
  const gate = await requireEffectiveRole(supabase, projectId, MARKUP_WRITE_ROLES)
  if (!gate.ok) return { error: gate.error }

  const { data: project, error: projErr } = await (supabase as any)
    .schema('projects').from('projects')
    .select('organisation_id').eq('id', projectId).single()
  if (projErr || !project) return { error: 'Project not found' }

  // The payload is built field by field. Spreading `input` is how a hostile
  // client smuggles rfi_id, created_by or a status past the schema.
  const { data, error } = await (supabase as any)
    .schema('projects').from('work_items')
    .insert({
      organisation_id: project.organisation_id,
      project_id:      projectId,
      item_type:       'task',
      origin:          'manual',
      // §03 §1.6: an item created WITH an explicit assignee is born `open`. The
      // column default is 'triage' for the sourceless/unnamed path item 3 uses;
      // this action always has a named assignee, so an 'open' literal here is
      // what keeps the Triage queue to genuinely unowned inbound. Never taken
      // from the payload.
      status:          'open',
      title,
      priority:        priority ?? 'medium',
      assignee_id:     assigneeId,
      gatekeeper_id:   user.id,     // A(b): task's gatekeeper is the creator
      created_by:      user.id,
      ...(dueDate ? { due_date: dueDate } : {}),
    })
    .select('id, ref').single()
  if (error) return { error: error.message }

  revalidatePath(`/projects/${projectId}`)
  return { id: data.id, ref: data.ref }
}

// ─── the four verbs that operate on an existing item ─────────────────────────

type ItemRow = {
  project_id: string
  status: string
  ball_in_court_id: string | null
}

/** One pre-read, shared by every verb below. */
async function readItem(supabase: any, workItemId: string): Promise<ItemRow | null> {
  const { data, error } = await supabase
    .schema('projects').from('work_items')
    .select('project_id, status, ball_in_court_id').eq('id', workItemId).single()
  return error || !data ? null : (data as ItemRow)
}

const reassignSchema = z.object({
  workItemId: z.string().uuid(),
  userId:     z.string().uuid(),
})

/**
 * The manual ball-in-court shift (§03 §1.4).
 *
 * ball_in_court_id is generated from whichever of the two person columns the
 * CURRENT status selects, so the shift writes THAT column: assignee_id while
 * triage or open, gatekeeper_id while answered. A PM handing an answered RFI to
 * a different reviewer changes the gatekeeper; writing assignee_id in that state
 * would regenerate an unchanged ball-in-court and look like a broken control.
 *
 * The gate admits an ORG_WRITE_ROLES holder OR the current ball-in-court holder,
 * exactly as §1.4 states and exactly as the BEFORE UPDATE guard implements. A
 * foreman handed a snag that belongs to his electrician must be able to pass it
 * on; otherwise it sits on him and he stops opening the recap.
 */
export async function reassignWorkItemAction(
  input: z.infer<typeof reassignSchema>,
): Promise<{ ok?: true; error?: string }> {
  const parsed = reassignSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const { workItemId, userId } = parsed.data

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const item = await readItem(supabase, workItemId)
  if (!item) return { error: 'Work item not found' }

  const gate = await requireEffectiveRole(supabase, item.project_id, ORG_WRITE_ROLES)
  if (!gate.ok && user.id !== item.ball_in_court_id) return { error: gate.error }

  const column =
    item.status === 'triage' || item.status === 'open' ? 'assignee_id'
    : item.status === 'answered' ? 'gatekeeper_id'
    : null
  if (!column) {
    return { error: `A ${item.status} item has no ball-in-court to shift. Reopen it first.` }
  }

  const { error } = await (supabase as any)
    .schema('projects').from('work_items')
    .update({ [column]: userId }).eq('id', workItemId)
  if (error) return { error: error.message }

  revalidatePath(`/projects/${item.project_id}`)
  return { ok: true }
}

const advanceSchema = z.object({
  workItemId: z.string().uuid(),
  // `void` is deliberately absent: it needs a reason, so it has its own action.
  status:     z.enum(['open', 'answered', 'closed']),
})

/**
 * Move an item along the status machine.
 *
 * Without this verb nothing in Q1 could close a work item at all — `task` is
 * sourceless, so no module owns its lifecycle — and §15 metric 7 (activation)
 * is defined as a new user moving any work item to `closed` in their first
 * session.
 *
 * The database is the real gate: the transition guard rejects an illegal jump
 * and permits `closed` only to the gatekeeper. This gate exists so a bystander
 * never reaches it.
 */
export async function advanceWorkItemStatusAction(
  input: z.infer<typeof advanceSchema>,
): Promise<{ ok?: true; error?: string }> {
  const parsed = advanceSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid status' }
  const { workItemId, status } = parsed.data

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const item = await readItem(supabase, workItemId)
  if (!item) return { error: 'Work item not found' }

  const gate = await requireEffectiveRole(supabase, item.project_id, MARKUP_WRITE_ROLES)
  if (!gate.ok && user.id !== item.ball_in_court_id) return { error: gate.error }

  const { error } = await (supabase as any)
    .schema('projects').from('work_items')
    .update({ status }).eq('id', workItemId)
  if (error) return { error: error.message }

  revalidatePath(`/projects/${item.project_id}`)
  return { ok: true }
}

const dueDateSchema = z.object({
  workItemId: z.string().uuid(),
  dueDate:    z.string().date(),
})

/**
 * §13 item 2: the triage owner does exactly three things — reassign, change the
 * due date, or void it with a reason. This is the second, and §04's My Work
 * binds `D` to it.
 *
 * ORG_WRITE_ROLES only: moving a deadline is a management decision, not
 * something the person holding the item does to themselves.
 */
export async function setWorkItemDueDateAction(
  input: z.infer<typeof dueDateSchema>,
): Promise<{ ok?: true; error?: string }> {
  const parsed = dueDateSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid date' }
  const { workItemId, dueDate } = parsed.data

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const item = await readItem(supabase, workItemId)
  if (!item) return { error: 'Work item not found' }

  const gate = await requireEffectiveRole(supabase, item.project_id, ORG_WRITE_ROLES)
  if (!gate.ok) return { error: gate.error }

  const { error } = await (supabase as any)
    .schema('projects').from('work_items')
    .update({ due_date: dueDate }).eq('id', workItemId)
  if (error) return { error: error.message }

  revalidatePath(`/projects/${item.project_id}`)
  return { ok: true }
}

const voidSchema = z.object({
  workItemId: z.string().uuid(),
  reason:     z.string().trim().min(3).max(500),
})

/**
 * Drop an item that should never have existed, with a reason.
 *
 * The transition guard REQUIRES a non-empty void_reason — without this action
 * nothing in Q1 could satisfy that requirement, so `void` was an unreachable
 * state guarded by a rule nobody could obey.
 */
export async function voidWorkItemAction(
  input: z.infer<typeof voidSchema>,
): Promise<{ ok?: true; error?: string }> {
  const parsed = voidSchema.safeParse(input)
  if (!parsed.success) return { error: 'Dropping an item needs a short reason.' }
  const { workItemId, reason } = parsed.data

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const item = await readItem(supabase, workItemId)
  if (!item) return { error: 'Work item not found' }

  // Mirrors the guard's v_may_manage: a write-role holder or the current holder.
  const gate = await requireEffectiveRole(supabase, item.project_id, ORG_WRITE_ROLES)
  if (!gate.ok && user.id !== item.ball_in_court_id) return { error: gate.error }

  const { error } = await (supabase as any)
    .schema('projects').from('work_items')
    .update({ status: 'void', void_reason: reason }).eq('id', workItemId)
  if (error) return { error: error.message }

  revalidatePath(`/projects/${item.project_id}`)
  return { ok: true }
}
```

- [ ] **Step 4: Run it and watch it pass.**

```bash
pnpm --filter web test -- work-items.actions
```

Expected: `Tests 15 passed`.

- [ ] **Step 5: Mutation proof — spread the input.** Replace the hand-built `insert({...})` payload in `createWorkItemTaskAction` with `insert({ ...input, created_by: user.id })`, re-run, and confirm the hostile-payload test fails on `rfi_id`. Restore.

- [ ] **Step 6: Mutation proof — narrow the two wide gates.** Change `reassignWorkItemAction`'s gate back to `if (!gate.ok) return { error: gate.error }`, re-run, and confirm `admits the current ball-in-court holder even when the role gate refuses` fails. Then do the same to `advanceWorkItemStatusAction` and confirm `lets the ball-in-court holder move their own item forward` fails. Restore both — the database permits these and the action must not be stricter than the design.

- [ ] **Step 7: Mutation proof — born in triage.** Change `status: 'open'` to `status: 'triage'`, re-run, and confirm the `forces created_by, item_type and status` test fails. Restore. Record all four mutations.

- [ ] **Step 8: Update `docs/rbac-matrix.md` in this same commit.** Insert after the "Site forms" subsection:

```markdown
### Work items (`work-items.actions.ts`)

| Action | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
|---|---|---|---|---|---|---|---|
| `createWorkItemTaskAction` | W | W | W | W | — | — | — |
| `reassignWorkItemAction` | W | W | W | own ball | own ball | own ball | — |
| `advanceWorkItemStatusAction` | W | W | W | W | own ball | own ball | — |
| `setWorkItemDueDateAction` | W | W | W | — | — | — | — |
| `voidWorkItemAction` | W | W | W | own ball | own ball | own ball | — |

> **"own ball" means the caller is the row's current `ball_in_court_id`.** §03 §1.4 says only an `ORG_WRITE_ROLES` user **or the current ball-in-court holder** may shift the ball, and the `BEFORE UPDATE` guard implements exactly that (`v_may_manage := user_can_write_work_item(...) OR v_actor = OLD.ball_in_court_id`). The actions match it rather than being stricter: a foreman handed a snag that belongs to his electrician must be able to pass it on, close it out, or drop it with a reason.
>
> **Where the actions ARE narrower than the database, deliberately.** The transition guard additionally lets an `ORG_WRITE_ROLES` holder **correct** `assignee_id` or `gatekeeper_id` in any live state (not only the one the current status selects), because A(b) makes `task`'s gatekeeper the creator and a contractor-raised task would otherwise have the contractor as its only possible closer. **Q1 exposes no UI for that correction**, so no action calls it; a direct PostgREST caller with a write role can. `setWorkItemDueDateAction` is likewise narrower than the DB, which would accept a due-date change from the ball-in-court holder — a deadline is a management decision (§13 item 2).
>
> **Three DB layers back the action gate, and the action gate is not the load-bearing one.** (1) `requireEffectiveRole` on the **project**, not the primary org. (2) A PERMISSIVE INSERT/UPDATE policy plus a **RESTRICTIVE** gate calling `projects.user_can_write_work_item(project_id, item_type)`, which resolves the type's `write_roles` out of `projects.work_item_types` — so widening a type's write set is one `UPDATE` in one place, never a policy rewrite. (3) A `BEFORE UPDATE` transition guard that RLS cannot express, because RLS cannot compare `OLD` and `NEW`.
>
> **`task` is the only client-insertable type.** Every mirrored type — `rfi`, `snag`, `qc_defect`, `inspection`, `diary_action`, `form_action` — is created **only** by its source row's projection trigger; a direct insert naming one of those keys is refused by the RESTRICTIVE policy. `order_followup` becomes insertable when the explicit chase control on the order line ships, with an arm requiring `node_order_id` and nothing else.
>
> **Only the gatekeeper closes.** This is the rule that ends the current behaviour where any active member of the owning org can close any RFI on any project (`00027_rls_insert_policies.sql:47-50`; `closeRfiAction` checks authentication and nothing else). An org admin who needs to close makes themselves the gatekeeper first — itself gated, and recorded in `work_item_events`.
>
> **`client_viewer` may be an ASSIGNEE from Q1 but may not write, and may not browse.** In a shopping-centre fit-out the landlord is frequently the ball-in-court, so an item must be able to point at them. Their writes are blocked by `work_items_update_gate` and by the fact that no registered type admits `client_viewer` in `write_roles` — **`00161_client_viewer_readonly_write_block.sql` does NOT cover `work_items`**, it loops over a hard-coded list of thirteen tables (`00161:61-75`), so this is one layer, not two. Their **reads** are narrowed too: `work_items_select` excludes `client_viewer` from the project-access arm, because `public.user_has_project_access()` is TRUE for any `project_members` row regardless of role (`00106` clause (a)) — the identical predicate PR #162 closed on saved reports. They see only items they are assigned, gatekeep or watch, which is what §04 §(d) describes. The Q3 Watcher tier replaces the write block.
>
> **`work_item_events` has no write policy at all**, and `INSERT`/`UPDATE` are revoked from `authenticated`. It is written solely by a `SECURITY DEFINER` append trigger, so the assignment and status history cannot be forged by the person it incriminates.
```

- [ ] **Step 9: Update `CONFORMANCE.md` in the same commit.** The new row goes under `## E. Cross-cutting security`, immediately after `E6` — the last row in that section today. Read the existing rows first and take the next free id in that section (`E7` as this plan is written):

```markdown
| E7 | Work-item write authorisation: `projects.user_can_write_work_item(project_id, item_type)` resolving `write_roles` from the registry, a RESTRICTIVE INSERT/UPDATE gate, a SECURITY INVOKER `BEFORE UPDATE` transition guard enforcing "only the gatekeeper closes", and an append-only `work_item_events` with no write policy and no client grant | MUST | ✓ (this pass) | `apps/edge-functions/supabase/migrations/00192_work_item_spine.sql` §8–§12; app-layer gate `apps/web/src/actions/work-items.actions.ts` (five verbs, each `requireEffectiveRole` on the project); matrix rows in `docs/rbac-matrix.md`; role-scoped probes in `scripts/db/assertions/work-item-rls.sql` + `work-item-transition.sql` and post-apply in `scripts/db/smoke-test-work-item-spine.sh` |
```

- [ ] **Step 10: Lint, type-check and commit.**

```bash
pnpm --filter web type-check && pnpm --filter web lint && pnpm --filter web test -- work-items.actions
git add apps/web/src/actions/work-items.actions.ts \
        apps/web/src/actions/work-items.actions.test.ts \
        docs/rbac-matrix.md CONFORMANCE.md
git commit -m "feat(work-items): the five verbs, with the matrix and CONFORMANCE

create / reassign / advance-status / set-due-date / void. Five, not two: task is
sourceless, so with only create and reassign NO code path could ever close a
work item — while metric 7 (activation, 35% in Q1) is defined as a new user
moving one to closed, and the transition guard requires a void_reason nothing
could supply.

Every action re-checks the caller's EFFECTIVE role on the project, because a
server action is directly invocable and page-level gating is not a gate.
Payloads are built field by field, never spread. A created task is born 'open'
(§03 §1.6) via a server-side literal, so a PM-created task does not land in the
Triage filter. reassign and advance-status also admit the current ball-in-court
holder, exactly as §03 §1.4 and the DB guard do — a foreman holding someone
else's snag has to be able to pass it on. createWorkItemTaskAction accepts a due
date, so 'by Friday' does not become next Thursday.

rbac-matrix.md and CONFORMANCE.md move in this commit, per the standing rule,
and the matrix records where the actions are deliberately narrower than the DB.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 14 — The three-way contract test (§12 §(h) test 1)

Set equality **in both directions** between Appendix A(b), the migration seed and the TypeScript union. A key in code and not in the appendix fails; a key in the appendix and not registered fails. The shape is the one proven by `apps/web/src/lib/snag-photo-type.contract.test.ts:38-44` — read the constraint out of the source rather than restating it, and fail naming the offending file.

It also holds the **ref-prefix lockstep**: the `CASE` in `work_items_ensure_ref()` and `REF_PREFIXES` in `@esite/shared` must agree, because `ref` is immutable and a divergence would ship two different permanent identifiers for the same item.

**Files:**
- Test: `packages/shared/src/work-items/work-item-types.contract.test.ts`

- [ ] **Step 1: Write the test.** It parses both sources; nothing is hardcoded except the parsing.

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  WORK_ITEM_TYPES, WORK_ITEM_TYPE_KEYS, WORK_ITEM_STATUSES, REF_PREFIXES,
} from './types'
import {
  ORG_WRITE_ROLES, MARKUP_WRITE_ROLES, QC_WRITE_ROLES,
  SNAG_FIELD_ROLES, FORMS_FIELD_ROLES,
} from '../types'

/**
 * §12 §(h) test 1. Three sources must agree, in both directions:
 *
 *   Appendix A(b)  <->  the projects.work_item_types seed  <->  WORK_ITEM_TYPES
 *
 * A value that exists in code and not in the appendix, or in the appendix and
 * not in code, fails the build. The appendix and the migration are both PARSED,
 * never restated here — a test that restated them would only ever assert that
 * this file agrees with itself.
 */

// packages/shared/src/work-items -> repo root
const ROOT = resolve(__dirname, '../../../..')
const APPENDIX = join(ROOT, 'docs/superpowers/specs/2026-09-09-v2-platform-roadmap/16-appendix-registries.md')
const MIG_DIR = join(ROOT, 'apps/edge-functions/supabase/migrations')

/** The one migration that seeds the registry, located by content not by number
 *  (numbers are claimed at merge and this file must survive a renumber). */
function spineMigration(): { path: string; sql: string } {
  for (const name of readdirSync(MIG_DIR).sort()) {
    if (!name.endsWith('.sql')) continue
    const p = join(MIG_DIR, name)
    const sql = readFileSync(p, 'utf8')
    if (sql.includes('INSERT INTO projects.work_item_types')) return { path: p, sql }
  }
  throw new Error('No migration seeds projects.work_item_types')
}

/** A(b)'s table rows: | `key` | Quarter | Source | Default due | Calendar | ... */
function appendixQ1Keys(): string[] {
  const md = readFileSync(APPENDIX, 'utf8')
  const block = md.split('### A(b)')[1]?.split('### A(c)')[0]
  if (!block) throw new Error('Could not locate the A(b) block in the appendix')
  return [...block.matchAll(/^\|\s*`([a-z_]+)`\s*\|\s*Q1\s*\|/gm)].map((m) => m[1])
}

/** The seeded VALUES rows: ('rfi', 'RFI', ..., 7, 'office', 'project_pm', ARRAY[...], 1) */
function seededRows(sql: string): Array<{ key: string; days: number; calendar: string; roles: string[] }> {
  const block = sql.split('INSERT INTO projects.work_item_types')[1]?.split('ON CONFLICT')[0] ?? ''
  return [...block.matchAll(
    /\(\s*'([a-z_]+)'\s*,[^)]*?,\s*(\d+)\s*,\s*'(office|site)'\s*,\s*'[a-z_]+'\s*,\s*ARRAY\[([^\]]*)\]/g,
  )].map((m) => ({
    key: m[1],
    days: Number(m[2]),
    calendar: m[3],
    roles: [...m[4].matchAll(/'([a-z_]+)'/g)].map((r) => r[1]).sort(),
  }))
}

/** The prefix CASE inside work_items_ensure_ref(): WHEN 'qc_defect' THEN 'QC' */
function sqlRefPrefixes(sql: string): Record<string, string> {
  const fn = sql.split('FUNCTION projects.work_items_ensure_ref()')[1] ?? ''
  const out: Record<string, string> = {}
  for (const m of fn.matchAll(/WHEN\s+'([a-z_]+)'\s+THEN\s+'([A-Z]+)'/g)) out[m[1]] = m[2]
  return out
}

describe('work-item type registry — A(b) <-> migration <-> TypeScript', () => {
  const { path, sql } = spineMigration()
  const seeded = seededRows(sql)

  it('parses a non-empty set from each source (a parser that matched nothing would make every assertion vacuous)', () => {
    expect(appendixQ1Keys().length).toBeGreaterThan(0)
    expect(seeded.length).toBeGreaterThan(0)
    expect(WORK_ITEM_TYPE_KEYS.length).toBeGreaterThan(0)
    expect(Object.keys(sqlRefPrefixes(sql)).length).toBeGreaterThan(0)
  })

  it('Appendix A(b) Q1 == the migration seed, in both directions', () => {
    expect([...seeded.map((r) => r.key)].sort()).toEqual([...appendixQ1Keys()].sort())
  })

  it('the migration seed == WORK_ITEM_TYPE_KEYS, in both directions', () => {
    expect([...WORK_ITEM_TYPE_KEYS].sort()).toEqual([...seeded.map((r) => r.key)].sort())
  })

  it('every type carries the same due offset and calendar in SQL and TypeScript', () => {
    for (const row of seeded) {
      const ts = WORK_ITEM_TYPES.find((t) => t.key === row.key)
      expect(ts, `${row.key} is seeded in ${path} but missing from WORK_ITEM_TYPES`).toBeDefined()
      expect(ts!.defaultDays, `${row.key} default_days`).toBe(row.days)
      expect(ts!.calendar, `${row.key} calendar`).toBe(row.calendar)
    }
  })

  it('every seeded write_roles array IS an existing shared role constant, not an invented list', () => {
    const known: Record<string, readonly string[]> = {
      ORG_WRITE_ROLES, MARKUP_WRITE_ROLES, QC_WRITE_ROLES, SNAG_FIELD_ROLES, FORMS_FIELD_ROLES,
    }
    for (const row of seeded) {
      const match = Object.entries(known).find(
        ([, v]) => JSON.stringify([...v].sort()) === JSON.stringify(row.roles),
      )
      expect(match, `${row.key}'s write_roles [${row.roles}] matches no shared role constant`).toBeDefined()
    }
  })

  it('no type admits client_viewer in Q1 — the Watcher-tier write set lands in Q3', () => {
    for (const row of seeded) expect(row.roles).not.toContain('client_viewer')
  })

  it('the SQL ref-prefix CASE equals REF_PREFIXES, in both directions', () => {
    // `ref` is immutable and travels into emails, PDFs and client deep links
    // (§15 §(e)). Two sources for a permanent identifier is two identifiers.
    expect(sqlRefPrefixes(sql)).toEqual({ ...REF_PREFIXES })
  })

  it('every registered type has a prefix arm — none falls through to upper(item_type)', () => {
    const fromSql = sqlRefPrefixes(sql)
    for (const key of WORK_ITEM_TYPE_KEYS) {
      expect(fromSql[key], `${key} has no arm in work_items_ensure_ref()'s CASE`).toBeDefined()
    }
  })

  it('every item_type literal in application code is a registered key', () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const n of readdirSync(dir, { withFileTypes: true })) {
        if (/node_modules|\.next|dist|build|\.expo/.test(n.name)) continue
        const p = join(dir, n.name)
        if (n.isDirectory()) walk(p)
        else if (/\.(ts|tsx)$/.test(n.name) && !/\.test\.tsx?$/.test(n.name)) files.push(p)
      }
    }
    walk(join(ROOT, 'apps/web/src'))
    walk(join(ROOT, 'packages/shared/src'))

    const offenders: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))  // blank block comments, keep line numbers
        .replace(/^\s*\/\/.*$/gm, '')
      for (const m of src.matchAll(/item_type\s*[:=]\s*'([a-z_]+)'/g)) {
        if (!WORK_ITEM_TYPE_KEYS.includes(m[1])) {
          const line = src.slice(0, m.index).split('\n').length
          offenders.push(`${f.replace(ROOT + '/', '')}:${line} -> '${m[1]}'`)
        }
      }
    }
    expect(offenders, `unregistered item_type literal(s):\n${offenders.join('\n')}`).toEqual([])
  })

  it('the SQL status CHECK equals WORK_ITEM_STATUSES', () => {
    const m = sql.match(/CHECK\s*\(status\s+IN\s*\(([^)]*)\)/i)
    expect(m, 'no status CHECK found in the spine migration').toBeTruthy()
    const fromSql = [...m![1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]).sort()
    expect([...WORK_ITEM_STATUSES].sort()).toEqual(fromSql)
  })
})
```

- [ ] **Step 2: Run it and watch it pass.**

```bash
pnpm --filter @esite/shared test -- work-item-types.contract
```

Expected: `Tests 10 passed`. If the `write_roles` assertion fails, the seed diverged from the shared constants — fix the **seed**, not the test.

- [ ] **Step 3: Mutation proof — add a ninth type to the migration only.** Append `('meeting_action','Meeting action',NULL,NULL,5,'office','creator',ARRAY['owner','admin'],9)` to the seed, re-run, and confirm **three** tests fail: A(b) ⟷ seed, seed ⟷ TypeScript, and the "every registered type has a prefix arm" check. Remove it. (`meeting_action` is explicitly not registered — meeting minutes is cut past twelve months, A(b).)

- [ ] **Step 4: Mutation proof — diverge the ref prefixes.** Change `WHEN 'qc_defect' THEN 'QC'` to `THEN 'QCD'` in the migration, re-run, and confirm `the SQL ref-prefix CASE equals REF_PREFIXES` fails naming the difference. Restore.

- [ ] **Step 5: Mutation proof — plant an unregistered literal.** Add `const x = { item_type: 'rfl' }` to `apps/web/src/actions/work-items.actions.ts`, re-run, and confirm the scanner test fails naming the file and line. Remove it. Record all three.

- [ ] **Step 6: Full suite, then commit.**

```bash
pnpm --filter @esite/shared test && pnpm --filter web test && \
pnpm --filter @esite/shared type-check && pnpm --filter web type-check && pnpm --filter web lint
git add packages/shared/src/work-items/work-item-types.contract.test.ts
git commit -m "test(work-items): three-way contract test for the type registry

Set equality in both directions between Appendix A(b), the migration seed and
WORK_ITEM_TYPE_KEYS, with both sources PARSED rather than restated — a test that
restated them would only assert the file agrees with itself. Also asserts each
seeded write_roles array is an existing shared role constant, that no type admits
client_viewer in Q1, that every item_type literal in application code is
registered, and that the ref-prefix CASE in work_items_ensure_ref() equals
REF_PREFIXES in @esite/shared — ref is immutable, so two sources for it would be
two permanent identifiers for the same item. The migration is located by content,
so a renumber at merge does not break it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 15 — Apply to production and read the objects back

⚠ **A green `Deploy DB Migrations` is not evidence a migration ran.** `supabase db push` keys on the version **prefix**: a number already in `schema_migrations` makes it print "Remote database is up to date", **exit 0 and skip the file**. PR #163 merged that way, went green, and production kept serving the old template. Every claim below is a read-back, not a workflow status.

**Files:**
- Create: `scripts/db/smoke-test-work-item-spine.sh`

- [ ] **Step 1: Re-claim the numbers against both sources, immediately before applying.** Not when you branched — the ledger and `origin/main` both move.

```bash
cd "/Volumes/Extreme SSD/DEVELOPER/APPS/ESITE.V1/wt-v2-roadmap"
. scripts/db/mgmt-api.sh
mgmt_query "SELECT max(version) FROM supabase_migrations.schema_migrations;"
git fetch origin main --quiet && git ls-tree --name-only origin/main apps/edge-functions/supabase/migrations/ | tail -3
```

If either has moved past those, rename **both** files to the next two free numbers with `git mv`, update every reference in `scripts/db/try-work-item-spine.sh`, and announce the new numbers to peer sessions. The contract test locates the migration by content, so it needs no change.

- [ ] **Step 2: Run the full assertion suite one last time against the current production schema.**

```bash
for f in scripts/db/assertions/work-item-*.sql; do scripts/db/try-work-item-spine.sh "$f"; done
```

Ten `✓` lines. Anything else, stop.

- [ ] **Step 3: Write the post-apply smoke test.** This is what you run **after** the migrations are live, and it is deliberately not the same file as the assertions: those run inside a rollback with the migration text inline, this one interrogates what is actually there.

Create `scripts/db/smoke-test-work-item-spine.sh`:

```bash
#!/usr/bin/env bash
# Post-apply verification for the work-item spine (A(f) ordinals 6 and 7).
# Read-only, except for two round-trips inside BEGIN ... ROLLBACK.
# Safe to run against production. Exit 0 on full green.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/mgmt-api.sh"
pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1" >&2; FAILED=1; }
section() { echo ""; echo "── $1 ──"; }
FAILED=0

section "1. All four tables exist with RLS enabled"
N=$(mgmt_query "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='projects'
  AND tablename IN ('work_items','work_item_types','work_item_events','work_item_watchers') AND rowsecurity;" | jq -r '.[0].n')
[[ "$N" == "4" ]] && pass "4 tables, RLS on all" || fail "expected 4 RLS-enabled tables, got $N"

section "2. A(a)'s named constraints are present"
N=$(mgmt_query "SELECT count(*)::int AS n FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
  JOIN pg_namespace nsp ON nsp.oid=t.relnamespace WHERE nsp.nspname='projects' AND t.relname='work_items'
  AND c.conname IN ('work_items_one_source','work_items_source_required','work_items_bic_present','work_items_ref_unique');" | jq -r '.[0].n')
[[ "$N" == "4" ]] && pass "4 named constraints (the 5th is the inline status CHECK)" || fail "expected 4 named constraints, got $N"

section "3. ball_in_court_id is a STORED generated column"
N=$(mgmt_query "SELECT is_generated AS g FROM information_schema.columns
  WHERE table_schema='projects' AND table_name='work_items' AND column_name='ball_in_court_id';" | jq -r '.[0].g')
[[ "$N" == "ALWAYS" ]] && pass "GENERATED ALWAYS … STORED" || fail "ball_in_court_id is_generated = $N"

section "4. The eight Q1 types are registered, and the three metric columns exist"
N=$(mgmt_query "SELECT count(*)::int AS n FROM projects.work_item_types;" | jq -r '.[0].n')
[[ "$N" == "8" ]] && pass "8 types" || fail "expected 8 registered types, got $N"
N=$(mgmt_query "SELECT count(*)::int AS n FROM information_schema.columns
  WHERE table_schema='projects' AND table_name='work_item_events'
    AND column_name IN ('from_ball_in_court_id','to_ball_in_court_id','actor_role');" | jq -r '.[0].n')
[[ "$N" == "3" ]] && pass "from/to ball-in-court + actor_role (metric 5 and metric 2a)" || fail "expected 3 metric columns, got $N"

section "5. anon holds nothing"
N=$(mgmt_query "SELECT count(*)::int AS n FROM (VALUES
   ('projects.work_items'),('projects.work_item_types'),
   ('projects.work_item_events'),('projects.work_item_watchers')) t(rel)
   WHERE has_table_privilege('anon', t.rel, 'SELECT');" | jq -r '.[0].n')
[[ "$N" == "0" ]] && pass "no anon SELECT on any of the 4 tables" || fail "$N table(s) still readable by anon"
N=$(mgmt_query "SELECT count(*)::int AS n FROM (VALUES
   ('projects.user_can_read_work_item(uuid)'),('projects.user_can_write_work_item(uuid,text)'),
   ('projects.add_working_days(date,int,uuid,text)'),('projects.push_past_builders_shutdown(date,uuid)'),
   ('projects.resolve_work_item_assignee(uuid,text,uuid)'),('projects.resolve_triage_owner(uuid)'),
   ('projects.resolve_project_pm(uuid)'),('projects.org_owner(uuid)')) f(sig)
   WHERE has_function_privilege('anon', f.sig, 'EXECUTE');" | jq -r '.[0].n')
[[ "$N" == "0" ]] && pass "no anon EXECUTE on any of the 8 functions" || fail "$N function(s) still executable by anon"
N=$(mgmt_query "SELECT count(*)::int AS n FROM pg_default_acl d JOIN pg_namespace nsp ON nsp.oid=d.defaclnamespace
   WHERE nsp.nspname='projects' AND d.defaclobjtype='r' AND array_to_string(d.defaclacl,',') LIKE '%anon=r%';" | jq -r '.[0].n')
[[ "$N" == "0" ]] && pass "the next table in this schema is not born anon-readable" || fail "ALTER DEFAULT PRIVILEGES still grants anon SELECT"

section "6. Every live project has a triage owner and complete defaults"
R=$(mgmt_query "SELECT
  (SELECT count(*) FROM projects.project_settings WHERE triage_owner_id IS NULL)::int AS no_owner,
  (SELECT count(*) FROM projects.project_settings ps
    WHERE (SELECT count(*) FROM jsonb_object_keys(ps.work_item_defaults))
       <> (SELECT count(*) FROM projects.work_item_types WHERE is_active))::int AS bad_defaults,
  (SELECT count(*) FROM projects.project_settings ps
    WHERE ps.work_item_defaults -> 'rfi' ->> 'days_to_respond' IS NOT NULL)::int AS rfi_copies;" )
[[ "$(echo "$R" | jq -r '.[0].no_owner')" == "0" ]] && pass "0 settings rows without a triage owner" || fail "$(echo "$R" | jq -r '.[0].no_owner') rows have no triage owner"
[[ "$(echo "$R" | jq -r '.[0].bad_defaults')" == "0" ]] && pass "0 settings rows with incomplete work_item_defaults" || fail "incomplete defaults on $(echo "$R" | jq -r '.[0].bad_defaults') rows"
[[ "$(echo "$R" | jq -r '.[0].rfi_copies')" == "0" ]] && pass "0 rows hold a COPY of default_rfi_due_days (it is read live)" || fail "$(echo "$R" | jq -r '.[0].rfi_copies') rows copied default_rfi_due_days into the jsonb"

section "7. The calendar is seeded three years out"
R=$(mgmt_query "WITH y AS (SELECT EXTRACT(YEAR FROM (now() AT TIME ZONE 'Africa/Johannesburg'))::int AS t)
  SELECT (SELECT count(*)::int FROM generate_series((SELECT t FROM y),(SELECT t FROM y)+2) g
           WHERE NOT EXISTS (SELECT 1 FROM projects.calendar_years cy WHERE cy.year=g)) AS missing;")
[[ "$(echo "$R" | jq -r '.[0].missing')" == "0" ]] && pass "this year + 2 are seeded — the due-date trigger cannot fail closed" || fail "$(echo "$R" | jq -r '.[0].missing') year(s) unseeded; RAISE the alarm with item 1's owner"

section "8. The never-null rule (§12 §(i)) holds on live data"
N=$(mgmt_query "SELECT count(*)::int AS n FROM projects.work_items
  WHERE status NOT IN ('closed','void') AND (ball_in_court_id IS NULL OR due_date IS NULL);" | jq -r '.[0].n')
[[ "$N" == "0" ]] && pass "0 open items without a ball-in-court or a due date" || fail "$N open item(s) violate the never-null rule"

section "9. structure.node_orders carries no work-item trigger"
N=$(mgmt_query "SELECT count(*)::int AS n FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid
  JOIN pg_namespace nsp ON nsp.oid=c.relnamespace WHERE nsp.nspname='structure' AND c.relname='node_orders'
  AND NOT tg.tgisinternal AND pg_get_triggerdef(tg.oid) ILIKE '%work_item%';" | jq -r '.[0].n')
[[ "$N" == "0" ]] && pass "no projection trigger — order_followup stays explicit-chase-only" || fail "$N work-item trigger(s) on node_orders"

section "10. Round-trip on live data, rolled back"
R=$(mgmt_query "
BEGIN;
CREATE TEMP TABLE _s AS SELECT p.id AS pid, p.organisation_id AS oid,
  projects.resolve_project_pm(p.id) AS pm FROM projects.projects p WHERE p.status='active' LIMIT 1;
INSERT INTO projects.work_items (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
SELECT oid, pid, 'task', '_smoke', pm, pm, pm FROM _s;
SELECT wi.ref AS ref, wi.due_date::text AS due, (wi.ball_in_court_id = wi.assignee_id) AS bic_ok,
       (SELECT count(*)::int FROM projects.work_item_events e WHERE e.work_item_id = wi.id) AS events,
       (SELECT count(*)::int FROM projects.work_item_watchers w WHERE w.work_item_id = wi.id) AS watchers
  FROM projects.work_items wi WHERE wi.title='_smoke';
ROLLBACK;")
[[ "$(echo "$R" | jq -r '.[0].ref')" =~ ^TASK-[0-9]+$ ]] && pass "ref $(echo "$R" | jq -r '.[0].ref')" || fail "bad ref: $(echo "$R" | jq -r '.[0].ref')"
[[ "$(echo "$R" | jq -r '.[0].due')" != "null" ]] && pass "due_date $(echo "$R" | jq -r '.[0].due')" || fail "no due_date computed"
[[ "$(echo "$R" | jq -r '.[0].bic_ok')" == "true" ]] && pass "ball-in-court = assignee at triage" || fail "ball-in-court wrong on a fresh row"
[[ "$(echo "$R" | jq -r '.[0].events')" == "1" ]] && pass "1 created event appended" || fail "expected 1 event, got $(echo "$R" | jq -r '.[0].events')"
[[ "$(echo "$R" | jq -r '.[0].watchers')" == "1" ]] && pass "1 watcher seeded (creator = assignee = gatekeeper, deduped)" || fail "expected 1 watcher, got $(echo "$R" | jq -r '.[0].watchers')"

section "11. A client viewer sees only what they hold, and writes nothing"
R=$(mgmt_query "
BEGIN;
CREATE TEMP TABLE _c AS
  SELECT pm.user_id, pm.project_id, p.organisation_id, projects.resolve_project_pm(pm.project_id) AS pm_id
    FROM projects.project_members pm JOIN projects.projects p ON p.id = pm.project_id
   WHERE pm.is_active AND pm.role='client_viewer' AND p.status='active'
   ORDER BY p.created_at LIMIT 1;
GRANT SELECT ON _c TO authenticated;
INSERT INTO projects.work_items (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
SELECT organisation_id, project_id, 'task', '_cv_mine',   user_id, pm_id, pm_id FROM _c;
INSERT INTO projects.work_items (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
SELECT organisation_id, project_id, 'task', '_cv_theirs', pm_id,   pm_id, pm_id FROM _c;
SELECT set_config('request.jwt.claims', json_build_object('sub',(SELECT user_id FROM _c),'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT (SELECT count(*)::int FROM projects.work_items WHERE title='_cv_mine')   AS can_see_mine,
       (SELECT count(*)::int FROM projects.work_items WHERE title='_cv_theirs') AS can_see_theirs;
ROLLBACK;")
[[ "$(echo "$R" | jq -r '.[0].can_see_mine')" == "1" ]] && pass "a client viewer can open the item they hold" || fail "a client viewer cannot see their own item"
[[ "$(echo "$R" | jq -r '.[0].can_see_theirs')" == "0" ]] && pass "a client viewer cannot list the rest of the project" || fail "a client viewer can list every work item — PR #162's gap re-opened"

echo ""
[[ "$FAILED" == "0" ]] && echo "ALL GREEN" || { echo "FAILURES ABOVE" >&2; exit 1; }
```

```bash
chmod +x scripts/db/smoke-test-work-item-spine.sh
```

- [ ] **Step 4: Apply both migrations, in order, through the Management API.**

```bash
. scripts/db/mgmt-api.sh
mgmt_apply_sql_file apps/edge-functions/supabase/migrations/00191_work_item_project_settings.sql
mgmt_apply_sql_file apps/edge-functions/supabase/migrations/00192_work_item_spine.sql
```

If the second aborts with `work-item spine: N of the calendar years …–… are not seeded`, **that is section 0 doing its job** — stop, get item 1's owner to seed the years, and re-apply. Do not seed around it.

Then record them in the ledger, or the next `db push` skips or duplicates them:

```bash
mgmt_query "INSERT INTO supabase_migrations.schema_migrations (version, name)
            VALUES ('00191','work_item_project_settings'), ('00192','work_item_spine')
            ON CONFLICT (version) DO NOTHING;"
```

- [ ] **Step 5: Read the objects back. This — not the workflow — is the evidence.**

```bash
scripts/db/smoke-test-work-item-spine.sh
```

Expected: every section `✓` and a final `ALL GREEN`. Paste the whole output into the PR body.

- [ ] **Step 6: Run item 1's verification script over both files.**

```bash
npx tsx scripts/verify-migration-applied.ts \
  apps/edge-functions/supabase/migrations/00191_work_item_project_settings.sql \
  apps/edge-functions/supabase/migrations/00192_work_item_spine.sql
```

Expected: exit 0.

**If `scripts/verify-migration-applied.ts` does not exist** (item 1's Task 3 creates it; Task 1 Step 2 told you whether it was there), do **not** write a second copy of it. Sections 1–5 and 9 of the smoke test cover the same objects and grants; run those, note in the PR body that the `-- @verify:` blocks are declared but not yet machine-checked, and say which item owes the script.

If the script does exist, prove it is **evaluating** rather than **skipping**: add `-- table: projects.does_not_exist` to one header, re-run, watch it exit non-zero naming that line, and remove it. A verification block that silently ignores lines it does not understand is exactly the decorative-test failure this programme exists to end — and this plan's blocks are written with a single `--` per line, outside the `-- ===` banner, because item 1's parser matches `/^--\s*([a-z_]+)\s*:\s*(.+?)\s*$/` against the trimmed line and a doubled prefix matches nothing at all.

- [ ] **Step 7: Walk from the empty state, not a deep link.** The uploader that rendered correctly on a page nobody could reach passed verification once already (PR #158 → #159).

```bash
. scripts/db/mgmt-api.sh
mgmt_query "
BEGIN;
-- A brand-new project, exactly as createProjectAction makes one.
INSERT INTO projects.projects (organisation_id, name, created_by)
SELECT p.organisation_id, '_walk from empty', p.created_by FROM projects.projects p LIMIT 1;
SELECT ps.triage_owner_id IS NOT NULL AS has_owner,
       k.n AS default_keys,
       ps.work_item_defaults -> 'rfi' ->> 'days_to_respond' AS rfi_days
  FROM projects.project_settings ps,
       LATERAL (SELECT count(*)::int AS n FROM jsonb_object_keys(ps.work_item_defaults)) k
 WHERE ps.project_id = (SELECT id FROM projects.projects WHERE name='_walk from empty');
ROLLBACK;"
```

Expected `has_owner: true`, `default_keys: 8`, `rfi_days: null`. A project created today arrives with a named triage owner and a complete defaults map, with no backfill involved — and `rfi` deliberately holds no copy of `default_rfi_due_days`, because the due-date trigger reads that column live.

⚠ **Note the gap this does NOT close.** Signing in means entering a password, which the agent does not do, so **the authenticated UI walkthrough is still owed**: someone must open a project, create a task from the empty state, watch it appear with a `TASK-n` ref and a computed due date, hand it to someone else, and confirm a contractor sees no *Set due date* control. That is the PR #159 lesson and it is unverifiable from here — say so in the PR body rather than implying otherwise.

- [ ] **Step 8: Commit the smoke test.**

```bash
git add scripts/db/smoke-test-work-item-spine.sh
git commit -m "test(work-items): post-apply production read-back for the spine

Eleven sections read the objects, the grants and the live data back out of
production after the migrations are applied — because a green Deploy DB
Migrations is not evidence a migration ran: db push keys on the version prefix
and skips a file whose number is already in the ledger. Includes the never-null
rule, the calendar-seeded-three-years-out check, the no-trigger-on-node_orders
assertion, a rolled-back round trip proving ref/due-date/event/watcher, and a
client-viewer probe proving they see only what they hold.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 16 — Register the new objects in Appendix A(f), then open the PR

§12 §(h) **test 8** diffs every object a programme migration creates against A(f), **in both directions**: an invented table fails because A(f) does not carry it, and an A(f) row nobody built fails because no `-- @verify:` block declares it. A(f)'s Q1 `projects` row today lists four tables plus `activity`, `public_holidays`, `calendar_years` and `working_days_between()` — it does **not** list the eight functions this plan creates. Registering them is part of shipping, not paperwork.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-09-v2-platform-roadmap/16-appendix-registries.md`

- [ ] **Step 1: Add the functions to A(f)'s Q1 `projects` row.** Find the row beginning `| **Q1** | `work_items`, `work_item_types`, …` and extend it so it reads:

```
| **Q1** | `work_items`, `work_item_types`, `work_item_events`, `work_item_watchers`, `activity`, `public_holidays`, `calendar_years`, `working_days_between()`, `add_working_days()`, `push_past_builders_shutdown()`, `org_owner()`, `resolve_project_pm()`, `resolve_triage_owner()`, `resolve_work_item_assignee()`, `user_can_read_work_item()`, `user_can_write_work_item()` | `projects` |
```

Add one sentence beneath the table so the split is not re-litigated:

> `working_days_between()` counts working days between two dates and is created by the Q1 ordinal-1 metrics migration; `add_working_days()` is its inverse and is created by ordinal 7, because the `BEFORE INSERT` due-date trigger has to add days rather than count them. Trigger functions (`work_items_set_due_date`, `work_items_ensure_ref`, `work_items_assert_membership`, `work_items_transition_guard`, `append_work_item_event`, `validate_work_item_defaults`) are declared in each migration's `-- @verify:` block and are covered by test 8 through it.

- [ ] **Step 2: Confirm nothing else in the appendix needs a change.** In particular do **not** edit A(a), A(b) or A(h). Two things that look like appendix amendments are not:

- The Q1 omission of `instruction_recipient_id` is a **migration-scope decision**, recorded in this plan and in the migration header.
- The three extra columns on `work_item_events` (`from_ball_in_court_id`, `to_ball_in_court_id`, `actor_role`) implement §15 §(b) and metric 5, which A(a) does not restate. They are declared in the `-- @verify:` block, which is what test 8 reads. If a reviewer asks, the citation is §15 §(b) ("actor, timestamp and the effective role stamped at event time") and metric 5's denominator ("counted off `projects.work_item_events`").

```bash
cd "/Volumes/Extreme SSD/DEVELOPER/APPS/ESITE.V1/wt-v2-roadmap"
git diff --stat docs/superpowers/specs/
```

Expected: one file, one row plus one paragraph changed.

- [ ] **Step 3: Full green before the PR.**

```bash
pnpm --filter @esite/shared test && pnpm --filter web test && \
pnpm --filter @esite/shared type-check && pnpm --filter web type-check && \
pnpm --filter web lint && \
scripts/db/smoke-test-work-item-spine.sh
```

Every command exits 0. If any does not, fix it — do not open the PR with a known failure and a note.

- [ ] **Step 4: Re-check the migration numbers one final time**, because another session may have merged while you were verifying.

```bash
. scripts/db/mgmt-api.sh
mgmt_query "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;"
git fetch origin main --quiet && git ls-tree --name-only origin/main apps/edge-functions/supabase/migrations/ | tail -5
gh pr list --state open --json number,title,files --jq '.[] | select([.files[].path] | any(test("migrations/"))) | {n:.number, t:.title, m:[.files[].path|select(test("migrations/"))]}'
```

The ledger, `origin/main` and every open PR must agree that `00191` and `00192` are yours. **If another open PR claims either number, resolve it before merging, not after** — two sessions each picking the same free number is exactly how two `00183`s and two `00184`s shipped in one week, and renumbering afterwards is a ledger operation as well as a rename.

- [ ] **Step 5: Commit and push.**

```bash
git add docs/superpowers/specs/2026-09-09-v2-platform-roadmap/16-appendix-registries.md
git commit -m "docs(work-items): register the spine's functions in Appendix A(f)

§12 §(h) test 8 diffs every object a programme migration creates against A(f) in
both directions, so an unregistered function fails the build. Records why
working_days_between (ordinal 1) and add_working_days (ordinal 7) are separate
functions in separate migrations.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"

git push "https://x-access-token:$(gh auth token)@github.com/WattMatt/e-site.git" feat/q1-work-item-spine
```

- [ ] **Step 6: Open the PR with the evidence, not a summary.** The body must carry, in this order:

1. **The mutation ledger.** Every mutation proof from Tasks 2–14 as a four-column table: *what was broken · which assertion failed · the exact failure text · pass counts before → during → after*. There are **34 steps labelled "Mutation proof"** as this plan is written, several of which carry two mutations, so expect around forty rows. §12 §(h) names three by hand and they must all appear: inverting the `answered` branch of the generated column (Task 2 Step 5), removing the `anon` revoke (Task 9 Step 6), and the client-viewer cost gate (which is items 5/6's — note it as out of scope here). Four more are worth calling out in prose because they are invisible on a read: the `TG_OP`-in-a-`WHEN`-clause syntax error (Task 12 Step 5), the missing temp-table grant (Task 9 Step 9), the `current_user` gatekeeper test (Task 11 Step 5) and the `upper(item_type)` ref prefix (Task 7 Step 6).
2. **The full `smoke-test-work-item-spine.sh` output** from Task 15 Step 5, and the `_walk from empty` result from Step 7 — plus the explicit statement that **the authenticated UI walkthrough is still owed**, because the agent cannot sign in.
3. **The two migration numbers**, with the `max(version)` and `origin/main` readings that claimed them and the timestamps of both readings.
4. **The three spec contradictions** from the top of this plan and the ruling taken on each, so a reviewer comparing the migration against A(a) does not file the omitted Q2 column as a bug.
5. **The fourteen folded-in improvements** (the "Improvements folded in" table), each with its one-line reason, and the one deferred index with its reason.
6. **The four scope boundaries** and which item picks each up.

Title: `feat(work-items): the work-item spine, type registry, due dates and triage (Q1 item 2)`

Footer:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 7: Hand off cleanly.** Post the two migration numbers, the names of the eight new functions and the four decisions below to the peer sessions working items 3, 4, 5, 6 and 8, and say explicitly which arms of the RESTRICTIVE INSERT policy are still theirs to add:

- **Item 3** owns the six projection triggers, the two write-backs, the six delete-to-void triggers and the backfill, and calls `projects.resolve_work_item_assignee(project_id, item_type, explicit)`. Its triggers must be `SECURITY DEFINER … SET row_security TO 'off'` with the three loop-suppression rules of §03 §1.2 — `WHEN (OLD.<col> IS DISTINCT FROM NEW.<col>)`, an early return on `pg_trigger_depth() > 1`, and a write-back that writes only when the value actually differs. Without all three the write-back into `projects.rfis.assigned_to` fires `rfis_updated_at` (`00002:100-102`) and the mirror trigger, which updates `work_items`, which fires the write-back again. **Four things item 3 must know and would otherwise guess wrong:**
  - **`title` is immutable while `origin = 'mirror'`** — the transition guard raises on a hand edit, so the mirror **owns** the title on every pass and nothing can silently overwrite a PM's clarification, because there can be no PM clarification. If item 3 wants the opposite, it changes the guard, in its own migration, with a test.
  - **Status on create is item 3's decision, and the DDL default is `'triage'`.** §03 §1.6: with an explicit assignee resolved from the source, insert `status = 'open'`; with none, insert `'triage'` and the resolved triage owner. `createWorkItemTaskAction` already does the first half for manual tasks.
  - **`ref` prefixes come from the `CASE` in `work_items_ensure_ref()`**, and the backfill may supply an explicit `ref` (it is respected) — which is how RFIs get renumbered per project, since `rfis.rfi_number` is a global identity.
  - **The backfill inserts as the service client (`auth.uid()` NULL)**, so the transition guard's exemption applies and `actor_id`/`actor_role` on the resulting events will be NULL. That is correct — the backfill has no human author — but metric 2a must not count those rows.
- **Item 4** adds the notification emit and the `current_setting('esite.suppress_notifications', true)` guard to `projects.append_work_item_event()` with `CREATE OR REPLACE`. **`projects.work_item_watchers` is already populated** by that function (creator, assignee, gatekeeper on create; the incoming holder on every reassignment), so the subscription list exists on day one — it does not need building.
- **Items 5 and 6** get the A(a) index set, the five verbs and `packages/shared/src/work-items/types.ts`'s `STATE_LABELS` — use that map rather than rendering the raw status, and do not invent a second copy in a component. Note that `work_items_select` excludes `client_viewer` from the project-access arm, so the client Inbox is already filtered to what they hold; the page does not need to re-filter, and must not assume a project-wide read.
- **Item 8** adds the `project_module_enabled()` arm to `work_items_insert_gate`.
- **The order-line chase control** adds the `order_followup` arm to `work_items_insert_gate`, requiring `node_order_id IS NOT NULL` and every other source column NULL.

---

## Done means

| Claim | Evidence |
|---|---|
| The spine exists in production | `smoke-test-work-item-spine.sh` sections 1–4 green, read back after apply — not a green workflow |
| Nobody can create work that belongs to nobody | `assignee_id NOT NULL`; the resolution chain terminates at the org owner and never raises; `SELECT count(*) FROM projects.work_items WHERE status NOT IN ('closed','void') AND ball_in_court_id IS NULL` returns **0** |
| Nobody can create work with no target date | `due_date NOT NULL`; the same query for `due_date IS NULL` returns **0**; an unseeded calendar year raises `no_data_found` rather than drifting, and the migration refuses to apply against a calendar seeded less than three years out |
| Only the gatekeeper closes | The transition-guard assertions run as a real assignee (demoted to a non-write role inside the transaction) and a real gatekeeper, every failure handler asserts the message rather than the mere fact of a raise, and the `current_user` mutation proves the guard is not inert |
| A person can actually finish an item | Five verbs, fifteen unit tests; `advanceWorkItemStatusAction` is what makes metric 7's "moved a work item to closed" reachable at all, and `voidWorkItemAction` is what makes the guard's `void_reason` requirement satisfiable |
| A mirrored item cannot be forged from a client | `work-item-rls.sql` assertion 7, run as the `rbac-test` contractor against a real project, with the temp fixture granted so the block actually executes |
| The audit trail cannot be forged | No write policy on `work_item_events`, `INSERT/UPDATE` revoked from `authenticated`, and the `SECURITY INVOKER` mutation — run **as a real user**, not as the table owner — shows why the writer must be a definer trigger |
| The metrics have their inputs | `work_item_events` carries both ball-in-court endpoints (metric 5's denominator) and `actor_role` stamped at event time (§15 §(b), metric 2a) on every row; none of it can be backfilled, and the assertions fail if any is missing |
| The notification engine has a subscription list | `work_item_watchers` is populated by the append trigger on create and on every reassignment; smoke section 10 counts one deduped row for a self-assigned item |
| A client viewer sees only what they hold | `work-item-rls.sql` assertions 12–14 and smoke section 11: they can open their own item, cannot list the project, and cannot write — the `work_items_select` clause that closes PR #162's predicate on a new table |
| `anon` holds nothing | `has_table_privilege` / `has_function_privilege` on all four tables and all eight functions, plus the `pg_default_acl` check proving the next table in this schema is not born anon-readable |
| The registry cannot drift | Three-way contract test, both directions, both sources parsed; a ninth type in SQL alone fails three tests, and a changed ref prefix fails one |
| A new project works from the empty state | The `_walk from empty` round trip: `has_owner: true`, `default_keys: 8`, `rfi_days: null` — no backfill involved, and no copy of `default_rfi_due_days` |
| **Still owed** | The authenticated UI walkthrough. The agent cannot sign in, so nobody has yet created a task from the empty state in a browser, watched `TASK-1` appear with a computed due date, handed it on, and confirmed a contractor sees no *Set due date* control. Say so in the PR body. |
