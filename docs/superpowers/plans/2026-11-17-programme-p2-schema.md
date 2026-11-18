# Programme P2 — Schema, Security, Writes and Server Actions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the P1 engine a home: a `programme` database schema with security, definer write functions, an audit trail, a module-summary rollup, the engine↔row mapping, and server actions that recalculate with the engine and save in one transaction — all dark behind `PROGRAMME_ENABLED`.

**Architecture:** One migration creates schema `programme` (core tables P2 writes, plus the tables later phases fill, so P3–P8 need no schema change for them). Clients get SELECT only; every write is a SECURITY DEFINER function that checks the caller, locks the programme, refuses stale versions and writes `programme.audit` in the same transaction. The web server action loads the programme as the person, applies the edit in memory, runs `scheduleProgramme`, and sends ops + the computed cache to `programme.save_changes` in one call.

**Tech Stack:** Postgres 15 (Supabase), plpgsql, TypeScript, Next.js 15 server actions, vitest.

**Spec:** `docs/superpowers/specs/2026-11-16-project-programme-design.md` (§4.1 principles, §4.2 data model, §4.6 roles, §4.7 decisions). P1 engine: `packages/shared/src/programme/` (read `types.ts` and `index.ts` for the API).

## Global Constraints

- Migration file: `apps/edge-functions/supabase/migrations/00261_programme_schema.sql`. **The number is provisional** — it is claimed at apply time after checking the ledger, `origin/main` and open-PR filenames. Header says so (copy the 00213 header wording).
- No `BEGIN`/`COMMIT` in the migration (the dry-run wraps it).
- Every migration ≥00185 carries a `-- @verify:begin … -- @verify:end` block using only the grammar words: `table view function column policy constraint index trigger cron grant_absent grant_present anon_execute_absent sql behaviour`. A `sql:` payload is executed byte-for-byte; explanations go in `/* */`, never as trailing prose lines; no em dash outside a string or comment.
- New schema ⇒ PostgREST `db_schema` PATCH **after** apply (never before; PGRST002). Document it in the runbook (Task 7); do not perform it.
- Every SECURITY DEFINER function: `SET search_path = ''`, fully qualified names, `REVOKE ALL ... FROM PUBLIC, anon` then explicit `GRANT EXECUTE ... TO authenticated` (or service_role only for internals). Never use `current_user` for authorisation; identity is `auth.uid()`.
- No RLS policy `FOR ALL` except `site_scope` (whose expression is the read predicate). Write gates, where any, are RESTRICTIVE and split by verb. Every table: `ENABLE` + `FORCE ROW LEVEL SECURITY`.
- Read: every effective project role except `client_viewer`, via `public.user_has_project_access(project_id)` and `public.user_effective_project_role(project_id)`; module programmes (`kind='module'`, `module_key='solar'`) additionally need `public.solar_can_view(project_id)`.
- Edit (project/contractor programmes): effective project role in `owner, admin, project_manager` (= `ORG_WRITE_ROLES`). Edit (solar module programme): `public.solar_can_edit(project_id)`.
- Cost (rands only): effective project role in `owner, admin, project_manager` (= `COST_VIEW_ROLES`). Rand columns live in separate tables whose SELECT policy requires the cost rule; nothing else is masked. Percent complete is weighted by duration, never cost.
- Field updates: recorded as `reported`; they move no dates until a planner decides them.
- Error sentences are plain English, no internals; SQLSTATEs: `42501` refused, `40001` stale, `22023` bad input, `P0002` gone, `23505` duplicate.
- Web: server-action results are `{ ok: true, ... } | { ok: false, error: string }` (never throw to the client — prod redacts thrown messages). Gates use `requireEffectiveRole` and check `.allowed` on the returned object (never `if (!allowed)` on the object). Anything a page hands a client component is JSON.
- `packages/db/src/types.ts` does not know `programme`: cast `(supabase as any).schema('programme')`. Do not regenerate types.
- Test suites to run on every task that touches SQL or shared code: `pnpm --filter @esite/shared test`, `pnpm --filter @esite/db test:ci`, `pnpm --filter web test` (web only when web files change), plus type-check/lint for touched packages.

## Review Focus

1. **A client_viewer, a non-member, or an off-site org PM reading programme rows** — expected: zero rows on every table, including the cost tables and audit.
2. **A contractor writing** — expected: every definer write refuses with `42501` and a sentence; no direct INSERT/UPDATE/DELETE grant exists on any table.
3. **A stale save** (two planners) — expected: the second `save_changes` with the old version refuses `40001`, nothing written.
4. **A Solar-blind user on a project with a solar module programme** — expected: sees the project programme and the module summary bar's dates/%, sees zero rows of the module programme's activities.
5. **Cost leakage** — a contractor (no cost role) reads activities, assignments, baselines and progress periods but every rand lives in tables they read zero rows from.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/edge-functions/supabase/migrations/00261_programme_schema.sql` | Schema, tables, constraints, bind triggers, helpers, RLS, grants, definer writes, rollup, @verify |
| `scripts/db/assert-programme-roles.sql` | Behavioural assertions as real roles (red on noop, green with the migration) |
| `packages/db/src/site-scope/manifest.ts` | `GATED` entries for every programme table (direct `project_id`) |
| `scripts/db/assert-site-scope-coverage.sql` | Add `'programme'` to `site_schemas` |
| `apps/web/src/lib/programme-site-scope.contract.test.ts` | Migration's site_scope text == generator text |
| `packages/shared/src/programme/persistence/rows.ts` | DB row types + `rowsToProgrammeInput` + `computedFromResult` |
| `packages/shared/src/programme/persistence/calendars.ts` | `calendarSeedsFromProjectSettings` |
| `packages/shared/src/programme/persistence/ops.ts` | `ProgrammeOp` union + `applyOps` (in-memory) |
| `apps/web/src/lib/programme/flag.ts` | `programmeEnabled()` |
| `apps/web/src/lib/programme/load.ts` | `loadProgramme(supabase, programmeId)` as the person |
| `apps/web/src/actions/programme.actions.ts` | create / save changes / baselines / field updates |
| `docs/rbac-matrix.md`, `docs/programme/runbook.md` | Roles rows; apply + PATCH runbook |

---

### Task 1: Migration — schema, tables, bind triggers

**Files:** Create `apps/edge-functions/supabase/migrations/00261_programme_schema.sql` (sections 0–3; later tasks append).

**Interfaces — Produces** (exact names later tasks use):

Schema `programme`. Every table has `id uuid pk default gen_random_uuid()` (except link tables noted), `project_id uuid not null → projects.projects on delete cascade`, `organisation_id uuid not null → public.organisations`, both **set by a BEFORE trigger from the parent, never trusted from the caller**; `created_at`, and where mutable `updated_at` set to `clock_timestamp()` by trigger.

| Table | Columns (beyond the above) |
|---|---|
| `programmes` | `kind text check in ('project','module','contractor')`, `module_key text` (required iff module; check in ('solar')), `contractor_label text` (required iff contractor, ≤120), `scheduling_rules text default 'msp' check in ('msp','p6')`, `name text not null` (1–200, btrim), `project_start date not null`, `data_date date`, `default_calendar_id uuid` (FK to calendars, deferrable, set after seeding), `options jsonb not null default '{"progress":"retained_logic","critical":{"kind":"total_float","threshold":0},"floatOn":"finish"}'`, `status text default 'active' check in ('active','archived')`, `project_finish date` (computed cache), `created_by`, `updated_by`. Unique partial indexes: `(project_id) where kind='project'`; `(project_id, module_key) where kind='module'`; `(project_id, lower(contractor_label)) where kind='contractor'`. |
| `calendars` | `programme_id → programmes cascade`, `name` (1–80), `variant text check in ('site','office','custom')`, `work_weekdays smallint[] not null` (values 1–7, non-empty, ≤7), `hours_per_day numeric(4,2) check >0 and ≤24`, `coverage_from date`, `coverage_to date`. |
| `calendar_exceptions` | `calendar_id → calendars cascade`, `programme_id`, `day date`, `kind text check in ('non_work','work')`, `label text`. Unique `(calendar_id, day)`. |
| `activities` | `programme_id → programmes cascade`, `parent_id → activities (on delete restrict)`, `wbs_code`, `code` (≤40), `name` (1–300), `type` (the six ActivityType values), `original_duration numeric(10,2) ≥0`, `remaining_duration numeric(10,2) ≥0 null`, `calendar_id → calendars on delete set null`, `constraint_type` (seven values, null), `constraint_date date`, `deadline date`, `actual_start date`, `actual_finish date`, `percent_complete numeric(5,2) 0–100 default 0`, `percent_complete_type text default 'duration' check in ('duration','physical','units')`, `fixed_start date`, `fixed_finish date` (module_summary only), cache: `early_start, early_finish, late_start, late_finish date`, `total_float numeric(10,2)`, `free_float numeric(10,2)`, `is_critical bool default false`, `is_driving bool default false`; `sort_order int`, `external_uid text`, `anchor text` (null or matching `^(opening_date|practical_completion|tenant_bo:[0-9a-f-]{36}|inspection:[0-9a-f-]{36})$`), `work_item_id uuid → projects.work_items on delete set null`, `is_tombstoned bool default false`, `created_by`, `updated_by`. Checks: milestones have `original_duration = 0`; `actual_finish ≥ actual_start`; `constraint_type is null or constraint_type='alap' or constraint_date is not null`. Unique `(programme_id, external_uid) where external_uid is not null`. Index `(programme_id, sort_order)`. |
| `dependencies` | `programme_id`, `pred_id → activities cascade`, `succ_id → activities cascade`, `type text check in ('FS','SS','FF','SF')`, `lag numeric(10,2) default 0`, `lag_unit text default 'working_days'` (three values), `lag_calendar text default 'pred'` (three values). Check `pred_id <> succ_id`. Unique `(pred_id, succ_id, type)`. Bind trigger refuses pred/succ in a different programme (`22023`). |
| `code_types` | `programme_id`, `name` (1–60), `sort_order`. Unique `(programme_id, lower(name))`. |
| `code_values` | `code_type_id → code_types cascade`, `programme_id`, `value` (1–60), `description`, `colour text check ~ '^#[0-9a-f]{6}$'`, `organisation_tag uuid → public.organisations null`, `user_tag uuid → auth.users null` (the field-update tag, spec §4.6). |
| `activity_codes` | pk `(activity_id, code_type_id)`; `code_value_id → code_values cascade`, `programme_id`. Trigger refuses a value of another type. |
| `resources` | org library: **no `project_id`** — `organisation_id` only, `name`, `kind text check in ('labour','plant','material')`, `max_units numeric`, `unit text`. (Rate is in `resource_rates`.) |
| `resource_rates` | pk `resource_id → resources cascade`, `organisation_id`, `rate numeric(14,2)`, `currency text default 'ZAR'`. **Cost table.** |
| `resource_assignments` | `programme_id`, `activity_id → activities cascade`, `resource_id → resources restrict`, `units_per_day numeric`, `budgeted_qty numeric`, `actual_qty numeric`. Unique `(activity_id, resource_id)`. |
| `assignment_costs` | pk `assignment_id → resource_assignments cascade`, `programme_id`, `budgeted_cost numeric(16,2)`, `actual_cost numeric(16,2)`. **Cost table.** |
| `baselines` | `programme_id`, `name` (1–120), `is_active bool default false`, `source text check in ('manual','import')`, `created_by`. Partial unique `(programme_id) where is_active`. |
| `baseline_activities` | `baseline_id → baselines cascade`, `programme_id`, `activity_id uuid` (no FK; activities may be deleted later), plus snapshot columns: `name, type, parent_id, wbs_code, code, original_duration, remaining_duration, early_start, early_finish, late_start, late_finish, total_float, free_float, percent_complete, sort_order`. |
| `baseline_dependencies` | `baseline_id → baselines cascade`, `programme_id`, `pred_id, succ_id uuid`, `type, lag, lag_unit, lag_calendar`. |
| `baseline_costs` | pk `(baseline_id, activity_id)`, `programme_id`, `budgeted_cost numeric(16,2)`. **Cost table.** |
| `progress_periods` | `programme_id`, `data_date date`, `percent_complete numeric(5,2)`, `planned_percent numeric(5,2)`, `spi numeric(8,4)`, `per_activity jsonb` (non-rand values only), `created_by`. Unique `(programme_id, data_date)`. |
| `progress_period_costs` | pk `period_id → progress_periods cascade`, `programme_id`, `pv, ev, ac numeric(16,2)`, `per_activity jsonb`. **Cost table.** |
| `field_updates` | `programme_id`, `activity_id → activities cascade`, `author_id uuid not null`, `reported_start date`, `reported_finish date`, `reported_percent numeric(5,2)`, `reported_remaining numeric(10,2)`, `note text ≤2000`, `photo_path text`, `status text default 'reported' check in ('reported','applied','adjusted','rejected')`, `decided_by uuid`, `decided_at timestamptz`, `decision_note text`. |
| `imports` | `programme_id`, `format text check in ('mspdi','xer','csv','xlsx')`, `file_path text`, `file_name text`, `mapping jsonb`, `diff jsonb`, `revision_label text`, `baseline_id → baselines set null`, `imported_by`. |
| `audit` | `programme_id → programmes cascade` (nullable for org-level resource writes), `actor_id uuid`, `verb text not null`, `object_ref jsonb`, `created_at`. |

Bind triggers (one function per shape, named `programme.<table>_bind()` or a shared `programme.child_bind()` that derives `project_id`/`organisation_id` from `programme_id` via `programme.programmes`; `programmes_bind()` derives `organisation_id` from `projects.projects`). On UPDATE: `project_id`, `organisation_id`, `programme_id`, `created_at`, `created_by` are immutable (restore OLD / refuse `42501` if a parent key changes).

- [ ] **Step 1:** Write sections 0 (header, preconditions: `CREATE SCHEMA IF NOT EXISTS programme; GRANT USAGE ON SCHEMA programme TO authenticated, service_role;`), 1 (tables + constraints + indexes), 2 (bind triggers). Leave a `-- @verify:begin`/`end` block listing every `table:`, `constraint:`, `trigger:`, `function:` created so far.
- [ ] **Step 2:** Dry-run on production (rolls back): `scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00261_programme_schema.sql scripts/db/fixtures/noop-assert.sql` (read the script's usage header first for the exact argument shape and how it obtains the PAT). Expected: applies with no error.
- [ ] **Step 3:** Commit `feat(programme): P2 schema tables and bind triggers`.

### Task 2: Migration — helpers, RLS, grants, site scope

**Files:** Modify the migration (section 4–5); modify `packages/db/src/site-scope/manifest.ts`, `scripts/db/assert-site-scope-coverage.sql`; create `apps/web/src/lib/programme-site-scope.contract.test.ts`.

**Interfaces — Produces:**
- `programme.can_read(p_programme_id uuid) returns boolean` — STABLE, SECURITY DEFINER, `row_security off`: programme exists AND `public.user_has_project_access(project)` AND `coalesce(public.user_effective_project_role(project),'client_viewer') <> 'client_viewer'` AND (`kind <> 'module'` OR `public.solar_can_view(project)`).
- `programme.can_edit(p_programme_id uuid) returns boolean` — `can_read` AND (module ⇒ `public.solar_can_edit(project)`; else effective role in `('owner','admin','project_manager')`).
- `programme.cost_visible(p_project_id uuid) returns boolean` — effective role in `('owner','admin','project_manager')`.
- `programme.can_read_org_library(p_org uuid) returns boolean` — active `user_organisations` row in that org with role not `client_viewer`; `programme.org_cost_visible(p_org uuid)` — role in `('owner','admin','project_manager')`.

Policies (all `TO authenticated`):
- Every programme-scoped table: `<t>_select FOR SELECT USING (programme.can_read(programme_id))` (`programmes` uses `id`).
- Cost tables (`assignment_costs`, `baseline_costs`, `progress_period_costs`): select USING `programme.can_read(programme_id) AND programme.cost_visible(project_id)`.
- `resources`: USING `programme.can_read_org_library(organisation_id)`; `resource_rates`: AND `programme.org_cost_visible(organisation_id)`.
- `audit`: select USING `programme.can_read(programme_id)`.
- `site_scope` RESTRICTIVE FOR ALL on every table that has `project_id`, **the generator's text byte for byte** — add each table to `GATED` in `manifest.ts` as `direct` and copy the text `generateMigration()` emits for it. `resources`/`resource_rates` have no `project_id`: add them to the coverage `exempt` list with reason `'org resource library, not site data'`.
- Grants: `GRANT SELECT ON ALL TABLES IN SCHEMA programme TO authenticated`; no INSERT/UPDATE/DELETE to `authenticated` or `anon` on any table; `REVOKE ALL ON ALL TABLES IN SCHEMA programme FROM anon`. `service_role` ALL.

- [ ] **Step 1:** Write the contract test first: it runs `generateMigration()`, extracts each programme table's `site_scope` block, and asserts the migration contains it verbatim; and asserts every programme table with `project_id` in the migration's `CREATE TABLE` list is in `GATED`. Run `pnpm --filter web test programme-site-scope` → FAIL.
- [ ] **Step 2:** Add manifest entries, coverage schema + exempt rows, migration sections 4–5. Append @verify lines: every `policy:` (with `PERMISSIVE`/`RESTRICTIVE`), `function:` for the four helpers, `grant_absent: authenticated INSERT ON programme.<t>` / `UPDATE` / `DELETE` for every table, `grant_absent: anon SELECT ON programme.activities`, `anon_execute_absent: ALL prosecdef functions in programme`, and `sql:` checks: all programme tables have `relrowsecurity AND relforcerowsecurity`; zero policies with `polcmd = '*'` other than `site_scope`.
- [ ] **Step 3:** Run the contract test → PASS; `pnpm --filter @esite/db test:ci` → PASS; dry-run the migration with `scripts/db/assert-site-scope-coverage.sql` → green.
- [ ] **Step 4:** Commit `feat(programme): read gates, cost mask, site scope`.

### Task 3: Migration — definer writes, audit, module rollup

**Files:** Modify the migration (section 6–7).

**Interfaces — Produces** (all SECURITY DEFINER, `search_path=''`, EXECUTE to `authenticated` only; each takes `pg_advisory_xact_lock(hashtextextended('programme:' || programme_id, 0))` before reading; each writes ≥1 `programme.audit` row):

1. `programme.create_programme(p_project_id uuid, p_kind text, p_name text, p_project_start date, p_module_key text default null, p_contractor_label text default null) returns uuid`
   - Refuses unless the caller would pass `can_edit` for that kind (evaluate the rule on the project directly, since the row does not exist yet). Duplicate kind ⇒ `23505` "This project already has a programme of that kind."
   - Seeds two calendars, `Site` (variant `site`) and `Office` (variant `office`), from `projects.project_settings` (`working_days` → ISO weekdays; `extra_holidays` and builders' shutdown dates → `non_work` exceptions) plus `projects.public_holidays` rows for the coverage window `p_project_start - 1 year` … `p_project_start + 5 years`; `hours_per_day = 8`. **Read the actual column names/types of `project_settings` and `public_holidays` from migrations 00101 and 00194 before writing this** and record what you found in the migration comment. Sets `default_calendar_id` to Site.
   - `scheduling_rules` = `'msp'`.
2. `programme.save_changes(p_programme_id uuid, p_expected_version timestamptz, p_ops jsonb, p_computed jsonb) returns jsonb`
   - Refuses unless `can_edit`; refuses `40001` "Someone else changed this programme. Reload to see their version." when `p_expected_version <> programmes.updated_at`.
   - `p_ops` is an array applied in order; op shapes (the TS `ProgrammeOp` in Task 5 mirrors these exactly):
     `{op:'upsert_activity', key, id?, fields:{…}}`, `{op:'delete_activity', id}`, `{op:'upsert_dependency', key, id?, pred, succ, type, lag, lag_unit, lag_calendar}`, `{op:'delete_dependency', id}`, `{op:'upsert_calendar', key, id?, fields}`, `{op:'set_calendar_exceptions', calendar, exceptions:[{day,kind,label}]}`, `{op:'upsert_code_type', key, id?, name}`, `{op:'upsert_code_value', key, id?, code_type, value, colour?, organisation_tag?, user_tag?}`, `{op:'set_activity_code', activity, code_type, code_value|null}`, `{op:'set_programme', fields:{name?, data_date?, project_start?, options?, default_calendar_id?}}`.
     `pred`/`succ`/`activity`/`calendar`/`code_type`/`code_value`/`parent_id`/`calendar_id` may be an existing uuid **or a `key` created earlier in the same call**; resolve keys through a temp map. Unknown ids ⇒ `P0002`. Rows of another programme ⇒ `22023`. `delete_activity` refuses when it has children (`22023` "Delete or move its sub-activities first.").
     Activity `fields` writable: `parent_id, wbs_code, code, name, type, original_duration, remaining_duration, calendar_id, constraint_type, constraint_date, deadline, actual_start, actual_finish, percent_complete, percent_complete_type, fixed_start, fixed_finish, sort_order, external_uid, anchor`. **Never** the cache columns or `work_item_id` from ops.
   - `p_computed` = `{project_finish, activities:[{id|key, early_start, early_finish, late_start, late_finish, total_float, free_float, is_critical, is_driving}]}`; writes the cache columns only, for activities of this programme. Activities not listed keep their cache.
   - Bumps `programmes.updated_at` (`clock_timestamp()`), returns `{version, ids:{key: uuid}}`.
   - Ruling recorded in the comment: the cache is written by the caller's server action after an engine run; an editor calling the RPC directly can only falsify a cache that the next recalculation overwrites; read paths treat it as a cache.
3. `programme.save_baseline(p_programme_id uuid, p_name text, p_set_active boolean) returns uuid` — snapshots non-tombstoned activities, dependencies, and `baseline_costs` from `assignment_costs` sums per activity; `p_set_active` clears the previous active one.
4. `programme.set_active_baseline(p_baseline_id uuid)`, `programme.delete_baseline(p_baseline_id uuid)` — editor only.
5. `programme.submit_field_update(p_activity_id uuid, p_start date, p_finish date, p_percent numeric, p_remaining numeric, p_note text) returns uuid`
   - Caller must pass `can_read` AND be either an editor OR the activity carries a code value whose `user_tag = auth.uid()` or whose `organisation_tag` is an org the caller has an active `user_organisations` row in. Otherwise `42501` "You can only report progress on activities assigned to your company or crew."
   - At least one reported value or a note; `p_percent` 0–100; finish ≥ start. Inserts `status='reported'`, `author_id=auth.uid()`. Moves nothing.
6. `programme.decide_field_updates(p_programme_id uuid, p_decisions jsonb) returns integer` — editor only; each `{id, status:'applied'|'adjusted'|'rejected', note?}` on a `reported` row; sets `decided_by/at`. **It does not change activity actuals** — the server action does that through `save_changes` in the same request (ruling: one write path for activity fields).
7. `programme.module_summary(p_project_id uuid, p_module_key text) returns table(start date, finish date, percent_complete numeric)` — SECURITY DEFINER, `row_security off`; requires `public.user_has_project_access(p_project_id)` and not client_viewer, **not** the module gate; returns min `coalesce(actual_start, early_start)`, max `coalesce(actual_finish, early_finish)`, and `sum(percent_complete*original_duration)/nullif(sum(original_duration),0)` over the module programme's non-summary, non-tombstoned activities; nothing else.
8. Internal `programme.write_audit(p_programme_id uuid, p_verb text, p_ref jsonb)` — EXECUTE revoked from authenticated.

- [ ] **Step 1:** Write sections 6–7. Append @verify `function:` lines with exact signatures, `grant_present: authenticated EXECUTE ON …` for 1–7, `grant_absent: authenticated EXECUTE ON programme.write_audit(uuid, text, jsonb)`, and `sql:` checks that `save_changes` source contains `pg_advisory_xact_lock` and `'40001'`.
- [ ] **Step 2:** Dry-run applies cleanly. Commit `feat(programme): definer writes, baselines, field updates, module rollup`.

### Task 4: Behavioural assertions as real roles

**Files:** Create `scripts/db/assert-programme-roles.sql`. Add `-- behaviour: scripts/db/assert-programme-roles.sql — every row ok` to the migration's @verify block.

Follow `scripts/db/assert-solar-schedule-roles.sql` for structure: temp result table, fixtures minted as postgres **before** any impersonation in a fresh org (not WM-Consulting), impersonate with `set_config('request.jwt.claims', …, true)` + `SET LOCAL ROLE authenticated`, refusal checks that catch only the promised SQLSTATE, final SELECT of failing rows. Fixtures: org owner, project PM (project_members), contractor (with an org-tagged code value on one activity), inspector without tag, client_viewer, an off-site org PM (org role `project_manager`, not a member — expected refused since 00238), a member with no Solar grant, a supplier.

Assertions (each one a named row):
- owner creates a project programme; second create ⇒ 23505; contractor create ⇒ 42501.
- save_changes: owner inserts 3 activities + 2 links using keys, receives ids; cache written; stale version ⇒ 40001 and nothing written; cache column in `fields` is ignored; cross-programme link ⇒ 22023; delete parent with child ⇒ 22023.
- direct `INSERT/UPDATE/DELETE` on `programme.activities` as owner ⇒ 42501 (no grant).
- reads: PM/contractor/inspector/supplier see rows; client_viewer, off-site org PM and a stranger see 0 on `programmes`, `activities`, `dependencies`, `audit`.
- cost: owner/PM see `assignment_costs`/`baseline_costs`/`progress_period_costs` rows; contractor sees 0 but does see the `resource_assignments` and `baseline_activities` rows.
- module: create a `module` programme for solar on a Solar-subscribed fixture project; member without Solar grant sees 0 module activities, `module_summary` returns the right min/max/weighted % to them; a Solar-edit contractor can `save_changes` on the module programme but not on the project programme.
- field updates: tagged contractor submits ⇒ row `reported`, activity actuals unchanged; untagged inspector ⇒ 42501; editor decides ⇒ `applied`, contractor decide ⇒ 42501.
- baseline: save (active), second save active clears the first; contractor ⇒ 42501.
- audit rows exist for every successful write above.

- [ ] **Step 1:** Run red: `scripts/db/dry-run-migration.sh scripts/db/fixtures/noop.sql scripts/db/assert-programme-roles.sql` → rows fail (schema absent). Record the count.
- [ ] **Step 2:** Run green with the migration → every row ok. Fix the migration (not the assertion) where a row is red for a real defect.
- [ ] **Step 3:** Mutation-test 4 arms, each must turn ≥1 row red, then restore: (a) drop the `client_viewer` clause from `can_read`; (b) make `cost_visible` return true; (c) remove the version check in `save_changes`; (d) drop the tag check in `submit_field_update`. Record results in the task report.
- [ ] **Step 4:** Run the `@verify` sweep under the new head: `npx tsx scripts/db/emit-verify-sweep.ts` (read its header for usage) through the dry-run → all directives green.
- [ ] **Step 5:** Commit `test(programme): role assertions for the programme schema`.

### Task 5: Shared persistence mapping

**Files:** Create `packages/shared/src/programme/persistence/{rows,calendars,ops}.ts` + tests beside them; export from `packages/shared/src/programme/index.ts`.

**Interfaces — Produces:**
- `rows.ts`: `ProgrammeRow`, `CalendarRow`, `CalendarExceptionRow`, `ActivityRow`, `DependencyRow` (snake_case, mirroring Task 1 columns; dates as `string` `YYYY-MM-DD`; numerics as `number`).
  `rowsToProgrammeInput(p: { programme: ProgrammeRow; calendars: CalendarRow[]; exceptions: CalendarExceptionRow[]; activities: ActivityRow[]; dependencies: DependencyRow[] }): ProgrammeInput` — tombstoned activities and their links excluded; `fixed` set only for `module_summary` with both fixed dates; options parsed from `programme.options` with the defaults in Task 1; calendar `coverage` from the row, defaulting to `project_start - 1y … project_start + 5y`.
  `computedFromResult(result: ScheduleResult): { project_finish: string | null; activities: ComputedRow[] }` where `ComputedRow = { id: string; early_start; early_finish; late_start; late_finish; total_float; free_float; is_critical; is_driving }` — `is_driving` true when the activity is the successor of any `drivingLinkIds` link (needs the dependencies: signature takes `(result, dependencies: DependencyRow[])`).
- `calendars.ts`: `calendarSeedsFromProjectSettings(s: { workingDays: …; extraHolidays: …; shutdown: … }, holidays: CalendarDate[]): { site: …; office: … }` — **only if** Task 3 seeds in SQL you do not need this; implement it as the TS mirror used by tests and by P3's "new calendar" button, and match whatever Task 3's comment records about the setting columns.
- `ops.ts`: `type ProgrammeOp` (exact mirror of Task 3's op shapes) and `applyOps(state: ProgrammeState, ops: ProgrammeOp[]): ProgrammeState` where `ProgrammeState = { programme; calendars; exceptions; activities; dependencies; codeTypes; codeValues; activityCodes }` — pure, assigns `key:<k>` ids for new rows, throws `ProgrammeOpError` with a plain sentence on unknown ids/cross-programme/child-delete (same rules as SQL).

- [ ] **Step 1:** Tests first: round-trip a 6-activity programme with a summary, a module_summary, a tombstoned activity, two calendars with exceptions; `scheduleProgramme(rowsToProgrammeInput(...))` matches a hand-checked result; `computedFromResult` maps driving flags; `applyOps` rejects each invalid case with the SQL sentence. Run → FAIL.
- [ ] **Step 2:** Implement. Run `pnpm --filter @esite/shared test` → PASS; type-check + lint.
- [ ] **Step 3:** Commit `feat(programme): row mapping and in-memory ops`.

### Task 6: Server actions + flag + loader

**Files:** Create `apps/web/src/lib/programme/flag.ts`, `apps/web/src/lib/programme/load.ts`, `apps/web/src/actions/programme.actions.ts`, tests beside each (use `@/test/fake-supabase` like `solar-schedule-import.actions.test.ts`).

**Interfaces — Produces:**
- `programmeEnabled(): boolean` — `process.env.PROGRAMME_ENABLED === 'true'`.
- `loadProgramme(supabase, programmeId): Promise<{ ok: true; state: ProgrammeState } | { ok: false; error: string }>` — reads the tables as the person (pages ≤1000 rows with a stable order: PostgREST caps at 1000).
- Actions (all `'use server'`, async only, each first checks `programmeEnabled()` → `{ ok:false, error:'The programme module is not switched on yet.' }`):
  - `createProgrammeAction({ projectId, kind, name, projectStart, moduleKey?, contractorLabel? })` → `{ ok, programmeId }` — gate: `requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)` for project/contractor; `requireSolarLevel(projectId,'edit')` for module.
  - `saveProgrammeChangesAction({ programmeId, expectedVersion, ops })` → `{ ok, version, ids, issues }` — load → `applyOps` → `scheduleProgramme(rowsToProgrammeInput(...))` → if `result.ok` is false return `{ ok:false, error: <first error message>, issues }` without writing → else call `programme.save_changes` with `p_computed = computedFromResult(...)` (ids for new rows given as keys). Map `40001` to "Someone else changed this programme. Reload to see their version.", `42501` to the database sentence.
  - `recalculateProgrammeAction({ programmeId, expectedVersion })` = save with `ops: []`.
  - `saveBaselineAction`, `setActiveBaselineAction`, `deleteBaselineAction`.
  - `submitFieldUpdateAction({ activityId, start?, finish?, percent?, remaining?, note? })`.
  - `decideFieldUpdatesAction({ programmeId, expectedVersion, decisions })` — calls `decide_field_updates`, then for `applied`/`adjusted` builds `upsert_activity` ops (actual_start/actual_finish/percent_complete/remaining_duration from the update, or the planner's adjusted values in the decision) and runs the save path; one response.
  - `moduleSummaryAction({ projectId, moduleKey })`.
- No page or nav entry in P2.

- [ ] **Step 1:** Tests first per action: flag off ⇒ refusal and zero RPC calls; gate refused ⇒ refusal and zero RPC calls; engine error (a cycle via ops) ⇒ refusal, no `save_changes` call; happy path ⇒ exactly one `save_changes` call carrying ops + computed with keys; 40001 mapped. Run → FAIL.
- [ ] **Step 2:** Implement; run `pnpm --filter web test programme` → PASS; web type-check + lint; `pnpm --filter web build` must pass (catches `'use server'` const exports).
- [ ] **Step 3:** Commit `feat(programme): server actions behind PROGRAMME_ENABLED`.

### Task 7: Docs — rbac matrix, runbook

**Files:** Modify `docs/rbac-matrix.md` (a "Programme" section: each action and table, who reads, who writes, cost rule, field-update tag rule, module gate). Create `docs/programme/runbook.md`: apply order — (1) merge → deploy workflow applies the migration and `@verify` passes; (2) read back: `select count(*) from pg_tables where schemaname='programme'`, helper functions exist, anon has no EXECUTE; (3) **then** PATCH PostgREST `db_schema` to add `programme` (Management API `PATCH /v1/projects/{ref}/postgrest`, full current list + `programme`, re-GET twice); (4) `NOTIFY pgrst, 'reload schema'`; (5) `PROGRAMME_ENABLED` stays unset until P1–P9 are done.

- [ ] **Step 1:** Write both. Commit `docs(programme): roles and apply runbook for P2`.
