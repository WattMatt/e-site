# E-Site Solar Phase 5b — Schedule (Gantt) — Part 3 of 5: `solar_task` registry and migration 00212

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal / Architecture / Tech stack / Ground rules:** see Part 1. **Prerequisite:** Parts 1–2 committed.

## Decisions this part implements (read before coding)

1. **`solar_task` is a SOURCELESS work-item type** (D-20): the side row points at the work item (`solar.schedule_tasks.work_item_id → projects.work_items`), not the other way round, so no FK column is added to the hottest table. Registry row (mirrors `00196_work_item_spine.sql:236-248`): `('solar_task', 'Solar task', NULL, NULL, 5, 'office', 'creator', MARKUP_WRITE_ROLES, 20)`.
   - `gatekeeper_rule = 'creator'` like `task` (`00196:247`): whoever schedules a task signs it off.
   - `write_roles = MARKUP_WRITE_ROLES` (owner, admin, PM, contractor): the E-Site roles that can hold Solar Edit on their own org in practice, and an existing shared constant (the contract test at `work-item-types.contract.test.ts:234` refuses an invented list). An own-org **inspector** with Solar Edit can edit Gantt fields but the 00196 transition guard (`00196:1509-1760`) will refuse them the work-item-governed changes (void, due date); the RPC skips the due-date mirror when the caller may not write it rather than failing the drag (see open question 3).
2. **Two spine objects enumerate types and must be re-declared in 00212**, because the 00196 comment "A new SOURCELESS type costs one row here and nothing else" (`00196:217`) is only true for `approval`:
   - `work_items_source_required` (`00196:343-347`) lists `('task','approval')` → re-declared with `'solar_task'` in ONE `ALTER TABLE … DROP CONSTRAINT …, ADD CONSTRAINT …` statement (the 00196 note at `:274-276` about re-declaring wholesale).
   - `projects.work_items_ensure_ref()` (`00196:752-800`) → re-declared verbatim plus `WHEN 'solar_task' THEN 'SOLAR'` (otherwise refs would be `SOLAR_TASK-3`, and the contract test "every registered type has a prefix arm" fails).
3. **`work_items_insert_gate` is NOT changed** (`00196:1174-1188`, `item_type = 'task'` only). A `solar_task` work item can therefore only be born inside `solar.schedule_create_tasks()` (SECURITY DEFINER, checks `solar_can_edit`), which creates the work item AND its side row in one transaction. Every later work-item change still passes the spine's triggers: membership (`00196:949`), ref (`:752`), due date (`:616`), transition guard (`:1509`), events (`:1357`).
4. **Owner = `work_items.assignee_id`.** An explicit owner who is not an active project member is refused with a sentence (the resolver `projects.resolve_work_item_assignee` would otherwise silently substitute the PM, `00196:843-903`); no owner → the resolver chain. Reassignment writes a `reassigned` event and watcher row through the spine (spec §14.3 "reassignment notifies the new owner (work-item events)"; bells/emails arrive with Q1 item 4).
5. **PR #193 (`00202_work_item_source_mirrors_and_backfill.sql`, open, stranded below the ledger head) interaction:** it re-declares `work_items_transition_guard()` (adds `source_status` to the immutable list and a `pg_trigger_depth() > 1` bypass). Nothing here writes `source_status` and every work-item write here runs at trigger depth 1 inside an RPC, so the rules are identical before and after #193. #193 does not re-declare `work_items_source_required` or `work_items_ensure_ref()`; **if a later migration re-declares either, it must keep the `solar_task` arm** — recorded in 00212's header and the PR body.
6. **RLS shape** (docs/solar/03 §3.1; `00207_solar_foundation.sql:548-563`): SELECT permissive `solar_can_view`; each write verb = permissive `user_has_project_access` + RESTRICTIVE `solar_can_edit`, one per verb (never RESTRICTIVE FOR ALL — `00205`/`00206`). FORCE RLS on every table (00207's schema-wide `@verify` directive re-checks it on every deploy). Presets are per user (`user_id = auth.uid()`), writable at View level (filtering is a read feature). Templates are org-level, owner/admin only (like `solar.org_settings`, `00208`).

---

### Task 10: Register `solar_task` in TypeScript, Appendix A(b) and both registry contract tests

**Files:**
- Modify: `packages/shared/src/work-items/types.ts` (WORK_ITEM_TYPES, REF_PREFIXES, STATE_LABELS)
- Modify: `packages/shared/src/work-items/work-item-types.contract.test.ts`
- Modify: `packages/shared/src/work-items/work-item-types-appendix.contract.test.ts`
- Modify: `docs/superpowers/specs/2026-09-09-v2-platform-roadmap/16-appendix-registries.md` (A(b) table)

The two contract tests currently read the registry from the FIRST migration containing `INSERT INTO projects.work_item_types` (00196) and the ref-prefix CASE from that same file. 00212 adds a second seeding statement and a newer `work_items_ensure_ref()`, so the tests must read **every** seed and the **latest** function body — otherwise they would keep passing against 00196 while production runs 00212.

- [ ] **Step 1: Add the A(b) row**

In `docs/superpowers/specs/2026-09-09-v2-platform-roadmap/16-appendix-registries.md`, under the `### A(b)` table, insert after the `task` row:
```markdown
| `solar_task` | Solar | none (sourceless; `solar.schedule_tasks.work_item_id` points back at it) | +5 wd | office | the owner chosen in the Schedule task dialog, else `triage_owner_id` | creator |
```

- [ ] **Step 2: Make the contract tests read every seed and the latest ref function (they go RED first)**

In `packages/shared/src/work-items/work-item-types.contract.test.ts`:

(a) After `function spineMigration()` add:
```ts
/** EVERY migration that inserts registry rows, in file order (00196's Q1 seed, then add-on types such as 00212's solar_task). */
function registrySeedMigrations(): Array<{ path: string; sql: string }> {
  return readdirSync(MIG_DIR).sort()
    .filter((n) => n.endsWith('.sql'))
    .map((n) => ({ path: join(MIG_DIR, n), sql: readFileSync(join(MIG_DIR, n), 'utf8') }))
    .filter(({ sql }) => stripSqlLineComments(sql).includes(SEED_NEEDLE))
}

/** The LAST migration that (re)defines projects.work_items_ensure_ref() — the body in force. */
function latestEnsureRefMigration(): { path: string; sql: string } {
  const all = readdirSync(MIG_DIR).sort().filter((n) => n.endsWith('.sql'))
    .map((n) => ({ path: join(MIG_DIR, n), sql: readFileSync(join(MIG_DIR, n), 'utf8') }))
    .filter(({ sql }) => /FUNCTION\s+projects\.work_items_ensure_ref\s*\(\)/.test(stripSqlLineComments(sql)))
  if (all.length === 0) throw new Error('No migration defines projects.work_items_ensure_ref()')
  return all[all.length - 1]
}
```

(b) Change `appendixQ1Keys()`'s regex so add-on rows count:
```ts
function appendixQ1Keys(): string[] {
  return [...appendixAb().matchAll(/^\|\s*`([a-z_]+)`\s*\|\s*(?:Q1|Solar)\s*\|/gm)].map((m) => m[1])
}
```

(c) At the top of `describe('work-item type registry — A(b) <-> migration <-> TypeScript', …)` replace
```ts
  const { path, sql } = spineMigration()
  const seeded = seededRows(sql)
```
with
```ts
  const { path, sql } = spineMigration()
  const seeded = registrySeedMigrations().flatMap((m) => seededRows(m.sql))
  const refSql = latestEnsureRefMigration().sql
```

(d) In the two prefix tests replace `sqlRefPrefixes(sql)` with `sqlRefPrefixes(refSql)` (both occurrences).

(e) In `it('every seeded write_roles array IS an existing shared role constant…')` nothing changes — `solar_task` uses `MARKUP_WRITE_ROLES`.

In `packages/shared/src/work-items/work-item-types-appendix.contract.test.ts`:

(f) After `function spineMigration()` add:
```ts
function registrySeedMigrations(): Array<{ name: string; sql: string }> {
  return readdirSync(MIG_DIR).sort()
    .filter((n) => n.endsWith('.sql'))
    .map((name) => ({ name, sql: readFileSync(join(MIG_DIR, name), 'utf8') }))
    .filter(({ sql }) => stripSqlLineComments(sql).includes(SEED_NEEDLE))
}

/** Quarters whose A(b) rows are registered by a migration today (Q2–Q4 rows are not yet). */
const REGISTERED_QUARTERS = new Set(['Q1', 'Solar'])
```

(g) In `appendixQ1Rows()` replace `.filter((r) => r[idx('Quarter')] === 'Q1')` with `.filter((r) => REGISTERED_QUARTERS.has(r[idx('Quarter')]))` and `quarter: 'Q1',` with `quarter: r[idx('Quarter')],`.

(h) In the `describe(…)` body replace
```ts
  const registry = applyAmendments(seededRows(sql), amendments)
```
with
```ts
  const registry = applyAmendments(registrySeedMigrations().flatMap((m) => seededRows(m.sql)), amendments)
```

- [ ] **Step 3: Run the two contract tests — expect RED**

Run: `pnpm --filter @esite/shared exec vitest run src/work-items/work-item-types.contract.test.ts src/work-items/work-item-types-appendix.contract.test.ts`
Expected: FAIL — A(b) now lists `solar_task` but no migration seeds it ("A(b) Q1 == the migration seed"), and `solar_task` is not in `WORK_ITEM_TYPE_KEYS`. (This is the proof the extended readers bite; Task 11 turns them green.)

- [ ] **Step 4: Register the type in TypeScript**

In `packages/shared/src/work-items/types.ts`:

Append to `WORK_ITEM_TYPES` (after the `task` row):
```ts
  // Solar add-on (00212): the Schedule tab's Gantt tasks (D-20). Sourceless —
  // solar.schedule_tasks.work_item_id points back at the item.
  { key: 'solar_task',     label: 'Solar task',       sourceTable: null,                           sourceColumn: null,              defaultDays: 5,  calendar: 'office', gatekeeperRule: 'creator',          writeRoles: MARKUP_WRITE_ROLES, sortOrder: 20 },
```
Add to `REF_PREFIXES`:
```ts
  solar_task: 'SOLAR',
```
Add to `STATE_LABELS`:
```ts
  solar_task: {     triage: 'Needs an owner', open: 'Planned',     answered: 'Done — awaiting sign-off',  closed: 'Done',     void: 'Removed' },
```

- [ ] **Step 5: Type-check the package**

Run: `pnpm --filter @esite/shared type-check`
Expected: exit 0 (both `Record<WorkItemTypeKey, …>` maps now carry `solar_task`). Also run `pnpm --filter web type-check` — any other exhaustive `Record<WorkItemTypeKey, …>` in `apps/web` fails here and gets a `solar_task` entry in this commit.

Commit together with Task 11 (the tests are green only once 00212 exists).

---

### Task 11: Migration `00212_solar_schedule.sql` — behavioural assertions red → green → mutations

**Files:**
- Create: `scripts/db/assert-solar-schedule-roles.sql`
- Create: `apps/edge-functions/supabase/migrations/00212_solar_schedule.sql`

- [ ] **Step 1: Write the behavioural assertions (they must fail before the migration exists)**

`scripts/db/assert-solar-schedule-roles.sql`:
```sql
-- BEHAVIOURAL assertions for 00212_solar_schedule, run as real roles.
--   Red:   scripts/db/dry-run-migration.sh "$S/red.sql"   scripts/db/assert-solar-schedule-roles.sql
--   Green: scripts/db/dry-run-migration.sh "$S/green.sql" scripts/db/assert-solar-schedule-roles.sql
-- red.sql = 00207 + 00208 (whichever are not yet in the ledger); green.sql = those + 00212.
-- Fixtures are minted inside the transaction and rolled back; the WM-Consulting
-- org is NOT used (it bypasses the paywall, so it has no lapse case).
-- Seeding happens as postgres BEFORE any impersonation (request.jwt.claims is
-- transaction-local and outlives RESET ROLE). REFUSAL PATTERN (00207 file): a
-- "…_REFUSED" check catches only the SQLSTATE the design promises; a wrongly
-- allowed statement raises P0001 itself so the write rolls back.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_org      UUID := gen_random_uuid();
  v_org2     UUID := gen_random_uuid();
  v_project  UUID := gen_random_uuid();
  v_project2 UUID := gen_random_uuid();
  v_admin    UUID := gen_random_uuid();   -- org admin: implicit edit_financials, grantor
  v_con      UUID := gen_random_uuid();   -- contractor, EDIT grant
  v_viewer   UUID := gen_random_uuid();   -- contractor, VIEW grant
  v_nogrant  UUID := gen_random_uuid();   -- contractor, project member, no grant
  v_client   UUID := gen_random_uuid();   -- client_viewer
  v_foreign  UUID := gen_random_uuid();   -- admin of another org
  v_outsider UUID := gen_random_uuid();   -- contractor of the org, NOT on the project
  v_map      JSONB;
  v_a        UUID;
  v_b        UUID;
  v_p2task   UUID;
  v_wi       RECORD;
  v_ts       TIMESTAMPTZ;
  v_n        INT;
  v_txt      TEXT;
  u          UUID;
  i          INT;
  v_users    UUID[];
  v_labels   TEXT[];
BEGIN
  -- ── Fixtures (as postgres) ────────────────────────────────────────────────
  INSERT INTO public.organisations (id, name) VALUES (v_org, 'solar-schedule-probe'), (v_org2, 'solar-schedule-probe-2');
  FOREACH u IN ARRAY ARRAY[v_admin, v_con, v_viewer, v_nogrant, v_client, v_foreign, v_outsider] LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'solar-schedule-probe-' || u || '@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  END LOOP;
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
    (v_admin, v_org, 'admin', TRUE), (v_con, v_org, 'contractor', TRUE), (v_viewer, v_org, 'contractor', TRUE),
    (v_nogrant, v_org, 'contractor', TRUE), (v_client, v_org, 'client_viewer', TRUE),
    (v_outsider, v_org, 'contractor', TRUE), (v_foreign, v_org2, 'admin', TRUE);
  INSERT INTO projects.projects (id, organisation_id, name, created_by) VALUES
    (v_project, v_org, 'solar-schedule-probe', v_admin), (v_project2, v_org, 'solar-schedule-probe-2', v_admin);
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active) VALUES
    (v_project, v_con, v_org, 'contractor', TRUE), (v_project, v_viewer, v_org, 'contractor', TRUE),
    (v_project, v_nogrant, v_org, 'contractor', TRUE), (v_project, v_client, v_org, 'client_viewer', TRUE),
    (v_project2, v_con, v_org, 'contractor', TRUE);
  INSERT INTO billing.org_addon_subscriptions (organisation_id, feature_key, status, amount_kobo, current_period_end)
  VALUES (v_org, 'solar', 'active', 199900, now() + interval '1 year');

  -- Grants, written by the grantor as 00207 requires.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO solar.project_access (project_id, user_id, level) VALUES
    (v_project, v_con, 'edit'), (v_project, v_viewer, 'view'), (v_project2, v_con, 'edit');
  RESET ROLE;

  -- ── 1. Registry ────────────────────────────────────────────────────────────
  INSERT INTO _r SELECT 'registry_row_solar_task', EXISTS (
    SELECT 1 FROM projects.work_item_types WHERE key = 'solar_task' AND is_active AND source_table IS NULL
       AND gatekeeper_rule = 'creator' AND write_roles @> ARRAY['owner','admin','project_manager','contractor']);

  -- ── 2. The editor creates two tasks and an FS link through the RPC ────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_con::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_map := solar.schedule_create_tasks(v_project, jsonb_build_array(
        jsonb_build_object('key', 'a', 'name', 'Design', 'start', '2026-10-01', 'end', '2026-10-05', 'owner_id', v_con),
        jsonb_build_object('key', 'b', 'name', 'Install', 'start', '2026-10-06', 'end', '2026-10-08', 'category', 'Installation')),
      jsonb_build_array(jsonb_build_object('from', 'a', 'to', 'b', 'type', 'FS', 'lag', 0)), false);
    v_a := (v_map->>'a')::uuid;
    v_b := (v_map->>'b')::uuid;
    INSERT INTO _r VALUES ('editor_creates_via_rpc', v_a IS NOT NULL AND v_b IS NOT NULL);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_creates_via_rpc', false);
  END;
  RESET ROLE;

  SELECT wi.* INTO v_wi FROM solar.schedule_tasks t JOIN projects.work_items wi ON wi.id = t.work_item_id WHERE t.id = v_a;
  INSERT INTO _r VALUES ('work_item_type_is_solar_task', v_wi.item_type IS NOT DISTINCT FROM 'solar_task');
  INSERT INTO _r VALUES ('ref_prefix_is_SOLAR', COALESCE(v_wi.ref ~ '^SOLAR-[0-9]+$', false));
  INSERT INTO _r VALUES ('work_item_born_open', v_wi.status IS NOT DISTINCT FROM 'open');
  INSERT INTO _r VALUES ('gatekeeper_is_creator', v_wi.gatekeeper_id IS NOT DISTINCT FROM v_con);
  INSERT INTO _r VALUES ('explicit_owner_kept', v_wi.assignee_id IS NOT DISTINCT FROM v_con);
  INSERT INTO _r VALUES ('due_date_is_end_date', v_wi.due_date IS NOT DISTINCT FROM DATE '2026-10-05');
  INSERT INTO _r SELECT 'dates_stored_exactly', EXISTS (SELECT 1 FROM solar.schedule_tasks WHERE id = v_a
    AND start_date = DATE '2026-10-01' AND end_date = DATE '2026-10-05' AND organisation_id = v_org AND project_id = v_project);
  INSERT INTO _r SELECT 'unowned_task_resolved_to_a_member', EXISTS (SELECT 1 FROM solar.schedule_tasks t
    JOIN projects.work_items wi ON wi.id = t.work_item_id
   WHERE t.id = v_b AND public.user_effective_project_role(v_project, wi.assignee_id) IS NOT NULL);
  INSERT INTO _r SELECT 'created_events_written', (SELECT count(*) FROM projects.work_item_events e
    JOIN solar.schedule_tasks t ON t.work_item_id = e.work_item_id WHERE t.project_id = v_project AND e.verb = 'created') = 2;
  INSERT INTO _r SELECT 'link_created', (SELECT count(*) FROM solar.schedule_dependencies WHERE project_id = v_project) = 1;

  -- ── 3. Nobody below Edit can create ───────────────────────────────────────
  v_users := ARRAY[v_viewer, v_nogrant, v_client, v_foreign];
  v_labels := ARRAY['viewer', 'nogrant', 'client', 'foreign'];
  FOR i IN 1..4 LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_users[i]::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM solar.schedule_create_tasks(v_project, '[{"key":"x","name":"X","start":"2026-10-01","end":"2026-10-01"}]'::jsonb, '[]'::jsonb, false);
      RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
    EXCEPTION
      WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('create_' || v_labels[i] || '_REFUSED', true);
      WHEN OTHERS THEN INSERT INTO _r VALUES ('create_' || v_labels[i] || '_REFUSED', false);
    END;
    RESET ROLE;
  END LOOP;

  -- ── 4. The RPC is the only door: a direct solar_task insert is refused ────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_con::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO projects.work_items (organisation_id, project_id, item_type, origin, title, status, assignee_id, gatekeeper_id, due_date, created_by)
    VALUES (v_org, v_project, 'solar_task', 'manual', 'Sneaky', 'open', v_con, v_con, DATE '2026-10-10', v_con);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('direct_solar_task_insert_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('direct_solar_task_insert_REFUSED', false);
  END;

  -- ── 5. Owner must be an active project member ─────────────────────────────
  BEGIN
    PERFORM solar.schedule_create_tasks(v_project,
      jsonb_build_array(jsonb_build_object('key', 'o', 'name', 'Owned', 'start', '2026-10-01', 'end', '2026-10-01', 'owner_id', v_outsider)),
      '[]'::jsonb, false);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN invalid_parameter_value THEN INSERT INTO _r VALUES ('owner_not_member_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('owner_not_member_REFUSED', false);
  END;

  -- ── 6. Links: loops, self links and cross-project links are refused ──────
  BEGIN
    INSERT INTO solar.schedule_dependencies (predecessor_task_id, successor_task_id, link_type, lag_days) VALUES (v_b, v_a, 'FS', 0);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('link_cycle_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('link_cycle_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.schedule_dependencies (predecessor_task_id, successor_task_id) VALUES (v_a, v_a);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('link_self_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('link_self_REFUSED', false);
  END;
  BEGIN
    v_map := solar.schedule_create_tasks(v_project2,
      '[{"key":"z","name":"Other project","start":"2026-10-01","end":"2026-10-02"}]'::jsonb, '[]'::jsonb, false);
    v_p2task := (v_map->>'z')::uuid;
    INSERT INTO solar.schedule_dependencies (predecessor_task_id, successor_task_id) VALUES (v_a, v_p2task);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('link_cross_project_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('link_cross_project_REFUSED', false);
  END;

  -- ── 7. Segments stay inside their task and never overlap ──────────────────
  BEGIN
    INSERT INTO solar.schedule_segments (task_id, start_date, end_date) VALUES (v_b, DATE '2026-10-01', DATE '2026-10-06');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('segment_outside_task_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('segment_outside_task_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.schedule_segments (task_id, start_date, end_date) VALUES (v_b, DATE '2026-10-06', DATE '2026-10-07');
    INSERT INTO solar.schedule_segments (task_id, start_date, end_date) VALUES (v_b, DATE '2026-10-07', DATE '2026-10-08');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('segment_overlap_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('segment_overlap_REFUSED', false);
  END;

  -- ── 8. Milestones are one day ─────────────────────────────────────────────
  BEGIN
    v_map := solar.schedule_create_tasks(v_project,
      '[{"key":"m","name":"Go live","start":"2026-10-10","end":"2026-10-20","is_milestone":true}]'::jsonb, '[]'::jsonb, false);
    INSERT INTO _r SELECT 'milestone_end_equals_start', EXISTS (SELECT 1 FROM solar.schedule_tasks
      WHERE id = (v_map->>'m')::uuid AND end_date = DATE '2026-10-10');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('milestone_end_equals_start', false);
  END;

  -- ── 9. Update RPC: move, due date follows, stale write refused ────────────
  RESET ROLE;
  SELECT updated_at INTO v_ts FROM solar.schedule_tasks WHERE id = v_a;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM solar.schedule_update_tasks(v_project, jsonb_build_array(jsonb_build_object(
      'id', v_a, 'start', '2026-10-02', 'end', '2026-10-06', 'expected_updated_at', v_ts)));
    INSERT INTO _r VALUES ('editor_moves_task', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_moves_task', false);
  END;
  BEGIN
    PERFORM solar.schedule_update_tasks(v_project, jsonb_build_array(jsonb_build_object(
      'id', v_a, 'progress', 10, 'expected_updated_at', v_ts)));
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN serialization_failure THEN INSERT INTO _r VALUES ('stale_update_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('stale_update_REFUSED', false);
  END;
  RESET ROLE;
  INSERT INTO _r SELECT 'move_stored_and_due_follows', EXISTS (SELECT 1 FROM solar.schedule_tasks t
    JOIN projects.work_items wi ON wi.id = t.work_item_id
   WHERE t.id = v_a AND t.start_date = DATE '2026-10-02' AND t.end_date = DATE '2026-10-06' AND wi.due_date = DATE '2026-10-06');

  -- ── 10. Done: the gatekeeper closes, anyone else hands it for sign-off ────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_con::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM solar.schedule_update_tasks(v_project, jsonb_build_array(jsonb_build_object('id', v_a, 'status', 'done')));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RESET ROLE;
  INSERT INTO _r SELECT 'gatekeeper_done_closes', EXISTS (SELECT 1 FROM solar.schedule_tasks t
    JOIN projects.work_items wi ON wi.id = t.work_item_id WHERE t.id = v_a AND wi.status = 'closed' AND t.progress = 100);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM solar.schedule_update_tasks(v_project, jsonb_build_array(jsonb_build_object('id', v_b, 'status', 'done')));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RESET ROLE;
  INSERT INTO _r SELECT 'non_gatekeeper_done_awaits_sign_off', EXISTS (SELECT 1 FROM solar.schedule_tasks t
    JOIN projects.work_items wi ON wi.id = t.work_item_id WHERE t.id = v_b AND wi.status = 'answered' AND t.gantt_status = 'done');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_con::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM solar.schedule_update_tasks(v_project, jsonb_build_array(jsonb_build_object('id', v_b, 'status', 'in_progress')));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RESET ROLE;
  INSERT INTO _r SELECT 'undone_reopens', EXISTS (SELECT 1 FROM solar.schedule_tasks t
    JOIN projects.work_items wi ON wi.id = t.work_item_id WHERE t.id = v_b AND wi.status = 'open' AND t.gantt_status = 'in_progress');

  -- ── 11. Viewer reads, cannot write; others read nothing ───────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_viewer::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM solar.schedule_tasks WHERE project_id = v_project;
  INSERT INTO _r VALUES ('viewer_reads_tasks', v_n = 3);
  UPDATE solar.schedule_tasks SET progress = 50 WHERE project_id = v_project;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('viewer_update_affects_nothing', v_n = 0);
  DELETE FROM solar.schedule_tasks WHERE project_id = v_project;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('viewer_delete_affects_nothing', v_n = 0);
  BEGIN
    PERFORM solar.schedule_save_baseline(v_project, 'Viewer baseline', NULL);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('viewer_baseline_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('viewer_baseline_REFUSED', false);
  END;
  -- Presets are per user and allowed at View; user_id is bound, not trusted.
  BEGIN
    INSERT INTO solar.schedule_filter_presets (project_id, user_id, name, filters)
    VALUES (v_project, v_con, 'Mine', '{"search":"","statuses":[],"ownerIds":[],"colours":[]}'::jsonb);
    INSERT INTO _r VALUES ('viewer_saves_preset', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('viewer_saves_preset', false);
  END;
  RESET ROLE;
  INSERT INTO _r SELECT 'preset_user_bound', EXISTS (SELECT 1 FROM solar.schedule_filter_presets
    WHERE project_id = v_project AND name = 'Mine' AND user_id = v_viewer);

  v_users := ARRAY[v_nogrant, v_client, v_foreign];
  v_labels := ARRAY['nogrant', 'client', 'foreign'];
  FOR i IN 1..3 LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_users[i]::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM solar.schedule_tasks WHERE project_id = v_project;
    INSERT INTO _r VALUES (v_labels[i] || '_reads_nothing', v_n = 0);
    SELECT count(*) INTO v_n FROM solar.schedule_owner_candidates(v_project);
    INSERT INTO _r VALUES (v_labels[i] || '_gets_no_owner_list', v_n = 0);
    RESET ROLE;
  END LOOP;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_con::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM solar.schedule_filter_presets WHERE project_id = v_project;
  INSERT INTO _r VALUES ('presets_private', v_n = 0);
  INSERT INTO _r SELECT 'owner_candidates_members_only',
    EXISTS (SELECT 1 FROM solar.schedule_owner_candidates(v_project) c WHERE c.user_id = v_con)
    AND NOT EXISTS (SELECT 1 FROM solar.schedule_owner_candidates(v_project) c WHERE c.user_id = v_outsider);

  -- ── 12. Baseline, then delete: the work item is voided, history kept ──────
  BEGIN
    PERFORM solar.schedule_save_baseline(v_project, 'Base 1', 'probe');
    INSERT INTO _r SELECT 'baseline_snapshots_every_task', (SELECT count(*) FROM solar.schedule_baseline_tasks bt
      JOIN solar.schedule_baselines b ON b.id = bt.baseline_id WHERE b.project_id = v_project AND b.name = 'Base 1') = 3;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('baseline_snapshots_every_task', false);
  END;
  BEGIN
    SELECT solar.schedule_delete_tasks(v_project, ARRAY[v_a]) INTO v_n;
    INSERT INTO _r VALUES ('editor_deletes_task', v_n = 1);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_deletes_task', false);
  END;
  RESET ROLE;
  INSERT INTO _r SELECT 'delete_voids_work_item', EXISTS (SELECT 1 FROM projects.work_items
    WHERE id = v_wi.id AND status = 'void' AND void_reason = 'Removed from the solar schedule.');
  INSERT INTO _r SELECT 'delete_removes_side_row_and_links',
    NOT EXISTS (SELECT 1 FROM solar.schedule_tasks WHERE id = v_a)
    AND NOT EXISTS (SELECT 1 FROM solar.schedule_dependencies WHERE predecessor_task_id = v_a OR successor_task_id = v_a);
  INSERT INTO _r SELECT 'baseline_keeps_removed_task', EXISTS (SELECT 1 FROM solar.schedule_baseline_tasks
    WHERE name = 'Design' AND task_id IS NULL AND start_date = DATE '2026-10-02');

  -- ── 13. The spine CHECK still refuses a sourceless mirrored type ─────────
  BEGIN
    INSERT INTO projects.work_items (organisation_id, project_id, item_type, origin, title, status, assignee_id, gatekeeper_id, due_date, created_by)
    VALUES (v_org, v_project, 'rfi', 'mirror', 'No source', 'open', v_con, v_con, DATE '2026-10-10', v_con);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('sourceless_rfi_still_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('sourceless_rfi_still_REFUSED', false);
  END;

  -- ── 14. service_role bypasses; anon has nothing ───────────────────────────
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO v_n FROM solar.schedule_tasks WHERE project_id = v_project;
  INSERT INTO _r VALUES ('service_role_reads', v_n = 2);
  RESET ROLE;
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM solar.schedule_tasks LIMIT 1;
    INSERT INTO _r VALUES ('anon_select_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_select_REFUSED', true);
  END;
  BEGIN
    PERFORM solar.schedule_delete_tasks(v_project, ARRAY[v_b]);
    INSERT INTO _r VALUES ('anon_rpc_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_rpc_REFUSED', true);
  END;
  RESET ROLE;

  -- ── 15. Lapse = hidden but kept (D-02) ────────────────────────────────────
  UPDATE billing.org_addon_subscriptions SET current_period_end = now() - interval '1 day' WHERE organisation_id = v_org;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_con::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM solar.schedule_tasks WHERE project_id = v_project;
  INSERT INTO _r VALUES ('lapsed_editor_reads_nothing', v_n = 0);
  BEGIN
    PERFORM solar.schedule_create_tasks(v_project, '[{"key":"x","name":"X","start":"2026-10-01","end":"2026-10-01"}]'::jsonb, '[]'::jsonb, false);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('lapsed_create_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('lapsed_create_REFUSED', false);
  END;
  RESET ROLE;
  SELECT count(*) INTO v_n FROM solar.schedule_tasks WHERE project_id = v_project;
  INSERT INTO _r VALUES ('lapsed_rows_kept', v_n = 2);
END $$;

SELECT k AS "check", v AS ok FROM _r ORDER BY k;
```

The file reports **56** checks.

- [ ] **Step 2: Run it RED**

From `/tmp/solar-5b-base.txt` (Task 0), read `has_00207` / `has_00208`. Build `$S/red.sql` (`S=$(mktemp -d)`):
```bash
: > "$S/red.sql"
[ "$HAS_00207" = t ] || cat apps/edge-functions/supabase/migrations/00207_solar_foundation.sql >> "$S/red.sql"
[ "$HAS_00208" = t ] || cat apps/edge-functions/supabase/migrations/00208_solar_org_settings.sql >> "$S/red.sql"
[ -s "$S/red.sql" ] || echo 'SELECT 1;' > "$S/red.sql"
scripts/db/dry-run-migration.sh "$S/red.sql" scripts/db/assert-solar-schedule-roles.sql 2>&1 | tee "$S/red.out"
```
Expected: RED — the file aborts (`function solar.schedule_create_tasks(...) does not exist` or `relation "solar.schedule_tasks" does not exist`) and is reported as one failed assertion.

- [ ] **Step 3: Write the migration — header, `@verify`, registry, spine re-declarations**

`apps/edge-functions/supabase/migrations/00212_solar_schedule.sql` (Steps 3–6 are ONE file, written top to bottom):
```sql
-- ---------------------------------------------------------------------------
-- Migration 00212: Solar schedule (Gantt) — solar_task work items + side tables
-- ---------------------------------------------------------------------------
-- ⚠ NUMBER: claimed at APPLY time, not now. Immediately before applying,
-- re-check THREE places: the ledger max(version), origin/main's migration
-- filenames, and the migration filenames in every OPEN PR (tariffs 00209 and
-- the other Solar phases included). If 00212 is taken, renumber this file and
-- the header of scripts/db/assert-solar-schedule-roles.sql above the head.
-- Claiming a number is not holding it: the head moves when someone APPLIES.
--
-- Spec: docs/solar/01-functional-spec.md §14 (Schedule tab), decision D-20
-- (tasks are E-Site work items of type solar_task + Gantt side tables);
-- docs/solar/03-data-model-and-security.md §3 (schedule tables) and §3.1 (RLS).
-- Behavioural reference and defects not to repeat: docs/solar/as-is/06 Part B.
--
-- WHAT.
--   1. projects.work_item_types row 'solar_task' — sourceless, gatekeeper =
--      creator, write set = MARKUP_WRITE_ROLES (00196 §1 conventions).
--   2. work_items_source_required re-declared with 'solar_task' as sourceless
--      (one ALTER statement: DROP + ADD). 00196's "a new sourceless type costs
--      one row" held only for 'approval', which that CHECK already named.
--   3. projects.work_items_ensure_ref() re-declared VERBATIM from 00196 §6 plus
--      WHEN 'solar_task' THEN 'SOLAR'. ⚠ Any later migration that re-declares
--      either object (Q2 re-declares both source CHECKs; PR #193 does not) must
--      keep the solar_task arm.
--   4. solar.schedule_settings / schedule_tasks / schedule_segments /
--      schedule_dependencies / schedule_baselines / schedule_baseline_tasks /
--      schedule_filter_presets / schedule_templates. Dates are `date`, never
--      timestamptz (WM shifted every edited task one day earlier in SAST).
--   5. Bind triggers: organisation (and project) derived, never trusted;
--      attribution bound to auth.uid(); links refuse self, cross-project and
--      LOOPS (WM had none of these checks); segments stay inside their task
--      and never overlap.
--   6. RPCs. solar.schedule_create_tasks / _update_tasks / _delete_tasks are
--      SECURITY DEFINER because the spine's work_items_insert_gate admits only
--      'task' to client sessions — which is exactly what keeps a solar_task
--      from being born anywhere but here. Each checks solar_can_edit itself
--      and writes the work item and its side row in ONE transaction. Every
--      work-item change still passes the spine's triggers, including
--      work_items_transition_guard() with auth.uid() = the caller (depth 1),
--      so the spine's governance holds exactly as for any other type.
--      solar.schedule_reorder / _save_baseline are SECURITY INVOKER (RLS decides).
--
-- PR #193 (item 3, 00202, open) re-declares work_items_transition_guard():
-- source_status becomes immutable to client sessions and trigger-depth > 1
-- writes bypass it. Nothing here writes source_status and every work-item write
-- here runs at depth 1, so behaviour is identical before and after #193.
--
-- 00207's schema-wide @verify directives are re-checked on every deploy and
-- this migration conforms: FORCE RLS on every new relkind 'r' table; no
-- RESTRICTIVE policy covering SELECT anywhere in solar (restrictive policies
-- here are per write verb only); every SECURITY DEFINER function in solar has
-- EXECUTE revoked from PUBLIC and anon.
--
-- No new schema, so no PostgREST db_schema PATCH (solar is exposed since 00207).
-- NO BEGIN/COMMIT in this file: scripts/db/dry-run-migration.sh wraps it in
-- BEGIN … ROLLBACK, and a COMMIT here would make that dry run permanent.
-- ---------------------------------------------------------------------------

-- @verify:begin
-- table: solar.schedule_settings
-- table: solar.schedule_tasks
-- table: solar.schedule_segments
-- table: solar.schedule_dependencies
-- table: solar.schedule_baselines
-- table: solar.schedule_baseline_tasks
-- table: solar.schedule_filter_presets
-- table: solar.schedule_templates
-- constraint: work_items_source_required ON projects.work_items
-- sql: (SELECT pg_get_constraintdef(oid) LIKE '%solar_task%' FROM pg_constraint WHERE conrelid = 'projects.work_items'::regclass AND conname = 'work_items_source_required')
-- sql: EXISTS (SELECT 1 FROM projects.work_item_types WHERE key = 'solar_task' AND is_active AND source_table IS NULL AND gatekeeper_rule = 'creator')
-- sql: (SELECT p.prosrc LIKE '%''solar_task''%THEN ''SOLAR''%' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'projects' AND p.proname = 'work_items_ensure_ref')
-- constraint: schedule_tasks_dates_ordered ON solar.schedule_tasks
-- constraint: schedule_tasks_milestone_one_day ON solar.schedule_tasks
-- constraint: schedule_dependencies_not_self ON solar.schedule_dependencies
-- constraint: schedule_dependencies_pair_unique ON solar.schedule_dependencies
-- function: solar.schedule_tasks_bind()
-- function: solar.schedule_segments_bind()
-- function: solar.schedule_dependencies_bind()
-- function: solar.schedule_project_row_bind()
-- function: solar.schedule_baseline_tasks_bind()
-- function: solar.schedule_templates_bind()
-- function: solar.schedule_assert_editor(uuid)
-- function: solar.schedule_remove_tasks(uuid, uuid[])
-- function: solar.schedule_create_tasks(uuid, jsonb, jsonb, boolean)
-- function: solar.schedule_update_tasks(uuid, jsonb)
-- function: solar.schedule_delete_tasks(uuid, uuid[])
-- function: solar.schedule_reorder(uuid, uuid[])
-- function: solar.schedule_save_baseline(uuid, text, text)
-- function: solar.schedule_owner_candidates(uuid)
-- function: solar.schedule_org_template(uuid)
-- trigger: schedule_tasks_bind ON solar.schedule_tasks
-- trigger: schedule_segments_bind ON solar.schedule_segments
-- trigger: schedule_dependencies_bind ON solar.schedule_dependencies
-- trigger: schedule_settings_bind ON solar.schedule_settings
-- trigger: schedule_baselines_bind ON solar.schedule_baselines
-- trigger: schedule_filter_presets_bind ON solar.schedule_filter_presets
-- trigger: schedule_baseline_tasks_bind ON solar.schedule_baseline_tasks
-- trigger: schedule_templates_bind ON solar.schedule_templates
-- policy: schedule_tasks_select ON solar.schedule_tasks PERMISSIVE
-- policy: schedule_tasks_insert ON solar.schedule_tasks PERMISSIVE
-- policy: schedule_tasks_update ON solar.schedule_tasks PERMISSIVE
-- policy: schedule_tasks_delete ON solar.schedule_tasks PERMISSIVE
-- policy: schedule_tasks_insert_authz ON solar.schedule_tasks RESTRICTIVE
-- policy: schedule_tasks_update_authz ON solar.schedule_tasks RESTRICTIVE
-- policy: schedule_tasks_delete_authz ON solar.schedule_tasks RESTRICTIVE
-- policy: schedule_dependencies_insert_authz ON solar.schedule_dependencies RESTRICTIVE
-- policy: schedule_segments_insert_authz ON solar.schedule_segments RESTRICTIVE
-- policy: schedule_baselines_insert_authz ON solar.schedule_baselines RESTRICTIVE
-- policy: schedule_baseline_tasks_insert_authz ON solar.schedule_baseline_tasks RESTRICTIVE
-- policy: schedule_settings_update_authz ON solar.schedule_settings RESTRICTIVE
-- policy: schedule_filter_presets_select ON solar.schedule_filter_presets PERMISSIVE
-- policy: schedule_filter_presets_insert_authz ON solar.schedule_filter_presets RESTRICTIVE
-- policy: schedule_templates_select ON solar.schedule_templates PERMISSIVE
-- grant_absent: anon SELECT ON solar.schedule_tasks
-- grant_absent: anon SELECT ON solar.schedule_filter_presets
-- grant_absent: anon SELECT ON solar.schedule_templates
-- grant_absent: authenticated UPDATE ON solar.schedule_baseline_tasks
-- grant_absent: authenticated DELETE ON solar.schedule_baseline_tasks
-- grant_absent: authenticated UPDATE ON solar.schedule_baselines
-- grant_absent: authenticated DELETE ON solar.schedule_settings
-- grant_absent: authenticated DELETE ON solar.schedule_templates
-- grant_absent: authenticated EXECUTE ON solar.schedule_assert_editor(uuid)
-- grant_absent: authenticated EXECUTE ON solar.schedule_remove_tasks(uuid, uuid[])
-- grant_absent: anon EXECUTE ON solar.schedule_create_tasks(uuid, jsonb, jsonb, boolean)
-- grant_absent: anon EXECUTE ON solar.schedule_owner_candidates(uuid)
-- grant_present: authenticated EXECUTE ON solar.schedule_create_tasks(uuid, jsonb, jsonb, boolean)
-- anon_execute_absent: ALL prosecdef functions in solar
-- sql: (SELECT bool_and(c.relrowsecurity AND c.relforcerowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'solar' AND c.relname LIKE 'schedule%' AND c.relkind = 'r')
-- sql: (SELECT count(*) = 0 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'solar' AND c.relname LIKE 'schedule%' AND p.polcmd = '*')
-- behaviour: scripts/db/assert-solar-schedule-roles.sql — every row ok
-- @verify:end

-- ── 0. Preconditions ────────────────────────────────────────────────────────
DO $pre$
BEGIN
    IF to_regclass('projects.work_items') IS NULL OR to_regprocedure('projects.work_items_transition_guard()') IS NULL THEN
        RAISE EXCEPTION '00212 needs the work-item spine (00196) applied first';
    END IF;
    IF to_regprocedure('public.solar_can_edit(uuid)') IS NULL THEN
        RAISE EXCEPTION '00212 needs the Solar foundation (00207) applied first';
    END IF;
END $pre$;

-- ── 1. Registry row (00196 §1 columns and conventions) ──────────────────────
INSERT INTO projects.work_item_types
  (key, label, source_table, source_column, default_days, calendar, gatekeeper_rule, write_roles, sort_order)
VALUES
  ('solar_task', 'Solar task', NULL, NULL, 5, 'office', 'creator', ARRAY['owner','admin','project_manager','contractor'], 20)
ON CONFLICT (key) DO NOTHING;

-- ── 2. The sourceless list gains solar_task (00196 §2, one statement) ───────
ALTER TABLE projects.work_items
  DROP CONSTRAINT work_items_source_required,
  ADD CONSTRAINT work_items_source_required CHECK (
    item_type IN ('task','approval','solar_task') OR status = 'void'
    OR (rfi_id IS NOT NULL)::int + (snag_id IS NOT NULL)::int + (qc_entry_id IS NOT NULL)::int
     + (diary_id IS NOT NULL)::int + (site_form_id IS NOT NULL)::int
     + (node_order_id IS NOT NULL)::int + (inspection_id IS NOT NULL)::int = 1);

-- ── 3. The ref allocator gains its SOLAR arm (00196 §6 body, verbatim + one arm)
CREATE OR REPLACE FUNCTION projects.work_items_ensure_ref() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET row_security TO 'off'
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
                WHEN 'solar_task'     THEN 'SOLAR'
                -- A type registered in a later quarter without an arm here still
                -- gets a working ref rather than a failed insert. Add the arm in
                -- the same migration that registers the type: the contract test
                -- fails the build until you do.
                ELSE pg_catalog.upper(NEW.item_type)
              END;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.project_id::text || ':' || NEW.item_type, 0));

  SELECT COALESCE(
           pg_catalog.max(NULLIF(
             pg_catalog.regexp_replace(wi.ref, '^.*-', ''), '')::int), 0) + 1
    INTO v_n
    FROM projects.work_items wi
   WHERE wi.project_id = NEW.project_id AND wi.item_type = NEW.item_type
     AND wi.ref ~ '-[0-9]{1,9}$';

  NEW.ref := v_prefix || '-' || v_n::text;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION projects.work_items_ensure_ref() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.work_items_ensure_ref() FROM anon;
```

Before writing section 3, diff it against the source so the "verbatim" claim is true:
```bash
sed -n '/^CREATE OR REPLACE FUNCTION projects.work_items_ensure_ref/,/^\$fn\$;/p' apps/edge-functions/supabase/migrations/00196_work_item_spine.sql > "$S/ref-00196.sql"
sed -n '/^CREATE OR REPLACE FUNCTION projects.work_items_ensure_ref/,/^\$fn\$;/p' apps/edge-functions/supabase/migrations/00212_solar_schedule.sql > "$S/ref-00212.sql"
diff "$S/ref-00196.sql" "$S/ref-00212.sql"
```
Expected: the only non-comment difference is the added `WHEN 'solar_task' THEN 'SOLAR'` line (the 00196 body carries a longer comment block above the SELECT; copying it too is fine, dropping it is fine — the executable lines must match).

- [ ] **Step 4: Tables, bind triggers, RLS, grants (same file, appended)**

```sql
-- ── 4. Tables ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.schedule_settings (
    project_id          UUID PRIMARY KEY REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id),
    duration_mode       TEXT NOT NULL DEFAULT 'calendar' CHECK (duration_mode IN ('calendar', 'working')),
    workload_threshold  INTEGER NOT NULL DEFAULT 2 CHECK (workload_threshold BETWEEN 1 AND 50),
    updated_by          UUID REFERENCES auth.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS solar.schedule_tasks (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    work_item_id     UUID NOT NULL UNIQUE REFERENCES projects.work_items(id) ON DELETE CASCADE,
    category         TEXT NOT NULL DEFAULT '' CHECK (length(category) <= 120),
    zone             TEXT NOT NULL DEFAULT '' CHECK (length(zone) <= 120),
    start_date       DATE NOT NULL,
    end_date         DATE NOT NULL,
    progress         SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    colour           TEXT NOT NULL DEFAULT '#3b82f6' CHECK (colour ~ '^#[0-9a-f]{6}$'),
    sort_order       INTEGER NOT NULL DEFAULT 0,
    is_milestone     BOOLEAN NOT NULL DEFAULT false,
    gantt_status     TEXT NOT NULL DEFAULT 'not_started' CHECK (gantt_status IN ('not_started', 'in_progress', 'done')),
    description      TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
    created_by       UUID REFERENCES auth.users(id),
    updated_by       UUID REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT schedule_tasks_dates_ordered CHECK (end_date >= start_date),
    CONSTRAINT schedule_tasks_milestone_one_day CHECK (NOT is_milestone OR start_date = end_date)
);
CREATE INDEX IF NOT EXISTS schedule_tasks_project_sort_idx ON solar.schedule_tasks (project_id, sort_order);

CREATE TABLE IF NOT EXISTS solar.schedule_segments (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id          UUID NOT NULL REFERENCES solar.schedule_tasks(id) ON DELETE CASCADE,
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    start_date       DATE NOT NULL,
    end_date         DATE NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT schedule_segments_dates_ordered CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS schedule_segments_task_idx ON solar.schedule_segments (task_id, start_date);

CREATE TABLE IF NOT EXISTS solar.schedule_dependencies (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id           UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id      UUID NOT NULL REFERENCES public.organisations(id),
    predecessor_task_id  UUID NOT NULL REFERENCES solar.schedule_tasks(id) ON DELETE CASCADE,
    successor_task_id    UUID NOT NULL REFERENCES solar.schedule_tasks(id) ON DELETE CASCADE,
    link_type            TEXT NOT NULL DEFAULT 'FS' CHECK (link_type IN ('FS', 'SS', 'FF', 'SF')),
    lag_days             INTEGER NOT NULL DEFAULT 0 CHECK (lag_days BETWEEN -365 AND 365),
    created_by           UUID REFERENCES auth.users(id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT schedule_dependencies_not_self CHECK (predecessor_task_id <> successor_task_id),
    CONSTRAINT schedule_dependencies_pair_unique UNIQUE (predecessor_task_id, successor_task_id)
);
CREATE INDEX IF NOT EXISTS schedule_dependencies_successor_idx ON solar.schedule_dependencies (successor_task_id);
CREATE INDEX IF NOT EXISTS schedule_dependencies_project_idx ON solar.schedule_dependencies (project_id);

CREATE TABLE IF NOT EXISTS solar.schedule_baselines (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    name             TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
    description      TEXT CHECK (description IS NULL OR length(description) <= 1000),
    duration_mode    TEXT NOT NULL DEFAULT 'calendar' CHECK (duration_mode IN ('calendar', 'working')),
    created_by       UUID REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT schedule_baselines_name_unique UNIQUE (project_id, name)
);

-- task_id is SET NULL on delete: a baseline must still show scope that was
-- later removed (WM cascaded and silently rewrote history, as-is/06 B.7 D2).
CREATE TABLE IF NOT EXISTS solar.schedule_baseline_tasks (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    baseline_id      UUID NOT NULL REFERENCES solar.schedule_baselines(id) ON DELETE CASCADE,
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    task_id          UUID REFERENCES solar.schedule_tasks(id) ON DELETE SET NULL,
    work_item_ref    TEXT NOT NULL,
    name             TEXT NOT NULL,
    start_date       DATE NOT NULL,
    end_date         DATE NOT NULL,
    is_milestone     BOOLEAN NOT NULL DEFAULT false,
    sort_order       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS schedule_baseline_tasks_baseline_idx ON solar.schedule_baseline_tasks (baseline_id);

-- Per user, in the database (WM kept presets in localStorage, per browser).
CREATE TABLE IF NOT EXISTS solar.schedule_filter_presets (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),
    user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name             TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
    filters          JSONB NOT NULL CHECK (jsonb_typeof(filters) = 'object'),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT schedule_filter_presets_name_unique UNIQUE (project_id, user_id, name)
);

CREATE TABLE IF NOT EXISTS solar.schedule_templates (
    organisation_id  UUID PRIMARY KEY REFERENCES public.organisations(id) ON DELETE CASCADE,
    content          JSONB NOT NULL CHECK (jsonb_typeof(content) = 'object' AND jsonb_typeof(content->'items') = 'array'),
    updated_by       UUID REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 5. Bind triggers (SECURITY DEFINER, search_path '', 00207 pattern) ─────
CREATE OR REPLACE FUNCTION solar.schedule_tasks_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_project UUID; v_org UUID; v_type TEXT;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.work_item_id <> OLD.work_item_id OR NEW.project_id <> OLD.project_id THEN
            RAISE EXCEPTION 'solar.schedule_tasks: a schedule task cannot move to another work item or project' USING ERRCODE = '42501';
        END IF;
        NEW.organisation_id := OLD.organisation_id;
        NEW.created_by := OLD.created_by;
        NEW.created_at := OLD.created_at;
    ELSE
        SELECT wi.project_id, wi.organisation_id, wi.item_type INTO v_project, v_org, v_type
          FROM projects.work_items wi WHERE wi.id = NEW.work_item_id;
        IF v_project IS NULL THEN
            RAISE EXCEPTION 'solar.schedule_tasks: work item % not found', NEW.work_item_id USING ERRCODE = '23503';
        END IF;
        IF v_type <> 'solar_task' THEN
            RAISE EXCEPTION 'solar.schedule_tasks: the work item is not a solar task' USING ERRCODE = '23514';
        END IF;
        NEW.project_id := v_project;
        NEW.organisation_id := v_org;
        NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
        IF auth.uid() IS NOT NULL THEN NEW.created_at := NOW(); END IF;
    END IF;
    IF NEW.is_milestone THEN NEW.end_date := NEW.start_date; END IF;
    NEW.colour := lower(NEW.colour);
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    NEW.updated_at := clock_timestamp();   -- strictly increasing: it is the optimistic-concurrency token
    RETURN NEW;
END $$;
CREATE TRIGGER schedule_tasks_bind BEFORE INSERT OR UPDATE ON solar.schedule_tasks
    FOR EACH ROW EXECUTE FUNCTION solar.schedule_tasks_bind();

CREATE OR REPLACE FUNCTION solar.schedule_segments_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_project UUID; v_org UUID; v_start DATE; v_end DATE;
BEGIN
    SELECT t.project_id, t.organisation_id, t.start_date, t.end_date INTO v_project, v_org, v_start, v_end
      FROM solar.schedule_tasks t WHERE t.id = NEW.task_id;
    IF v_project IS NULL THEN
        RAISE EXCEPTION 'solar.schedule_segments: task % not found', NEW.task_id USING ERRCODE = '23503';
    END IF;
    NEW.project_id := v_project;
    NEW.organisation_id := v_org;
    IF NEW.start_date < v_start OR NEW.end_date > v_end THEN
        RAISE EXCEPTION 'solar.schedule_segments: a segment must lie inside its task' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM solar.schedule_segments s
                WHERE s.task_id = NEW.task_id AND s.id <> NEW.id
                  AND s.start_date <= NEW.end_date AND NEW.start_date <= s.end_date) THEN
        RAISE EXCEPTION 'solar.schedule_segments: segments of one task cannot overlap' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER schedule_segments_bind BEFORE INSERT OR UPDATE ON solar.schedule_segments
    FOR EACH ROW EXECUTE FUNCTION solar.schedule_segments_bind();

CREATE OR REPLACE FUNCTION solar.schedule_dependencies_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_pp UUID; v_sp UUID; v_org UUID;
BEGIN
    IF NEW.predecessor_task_id = NEW.successor_task_id THEN
        RAISE EXCEPTION 'solar.schedule_dependencies: a task cannot depend on itself' USING ERRCODE = '23514';
    END IF;
    SELECT project_id, organisation_id INTO v_pp, v_org FROM solar.schedule_tasks WHERE id = NEW.predecessor_task_id;
    SELECT project_id INTO v_sp FROM solar.schedule_tasks WHERE id = NEW.successor_task_id;
    IF v_pp IS NULL OR v_sp IS NULL THEN
        RAISE EXCEPTION 'solar.schedule_dependencies: task not found' USING ERRCODE = '23503';
    END IF;
    IF v_pp <> v_sp THEN
        RAISE EXCEPTION 'solar.schedule_dependencies: both tasks must be on the same project' USING ERRCODE = '23514';
    END IF;
    NEW.project_id := v_pp;
    NEW.organisation_id := v_org;
    -- Serialise link writes per project so two concurrent links cannot close a loop together.
    PERFORM pg_advisory_xact_lock(hashtextextended('solar.schedule:' || v_pp::text, 0));
    IF EXISTS (
        WITH RECURSIVE reach(id) AS (
            SELECT NEW.successor_task_id
            UNION
            SELECT d.successor_task_id
              FROM solar.schedule_dependencies d JOIN reach r ON d.predecessor_task_id = r.id
             WHERE d.id <> NEW.id
        )
        SELECT 1 FROM reach WHERE id = NEW.predecessor_task_id
    ) THEN
        RAISE EXCEPTION 'solar.schedule_dependencies: this link would create a loop' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
        NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
        NEW.created_at := NOW();
    ELSE
        NEW.created_by := OLD.created_by;
        NEW.created_at := OLD.created_at;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER schedule_dependencies_bind BEFORE INSERT OR UPDATE ON solar.schedule_dependencies
    FOR EACH ROW EXECUTE FUNCTION solar.schedule_dependencies_bind();

-- Project-scoped rows (settings, baselines, presets): org derived, project immutable,
-- attribution bound. Branches on TG_TABLE_NAME; each branch touches only its table's columns.
CREATE OR REPLACE FUNCTION solar.schedule_project_row_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.project_id <> OLD.project_id THEN
            RAISE EXCEPTION 'solar.%: project_id is immutable', TG_TABLE_NAME USING ERRCODE = '42501';
        END IF;
        NEW.organisation_id := OLD.organisation_id;
    ELSE
        SELECT organisation_id INTO NEW.organisation_id FROM projects.projects WHERE id = NEW.project_id;
        IF NEW.organisation_id IS NULL THEN
            RAISE EXCEPTION 'solar.%: project % not found', TG_TABLE_NAME, NEW.project_id USING ERRCODE = '23503';
        END IF;
    END IF;
    IF TG_TABLE_NAME = 'schedule_settings' THEN
        IF TG_OP = 'UPDATE' THEN NEW.created_at := OLD.created_at; END IF;
        NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
        NEW.updated_at := clock_timestamp();
    ELSIF TG_TABLE_NAME = 'schedule_baselines' THEN
        NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
        NEW.created_at := NOW();
        NEW.name := btrim(NEW.name);
    ELSIF TG_TABLE_NAME = 'schedule_filter_presets' THEN
        IF TG_OP = 'INSERT' THEN
            NEW.user_id := COALESCE(auth.uid(), NEW.user_id);
            NEW.created_at := NOW();
        ELSE
            NEW.user_id := OLD.user_id;
            NEW.created_at := OLD.created_at;
        END IF;
        NEW.name := btrim(NEW.name);
        NEW.updated_at := clock_timestamp();
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER schedule_settings_bind BEFORE INSERT OR UPDATE ON solar.schedule_settings
    FOR EACH ROW EXECUTE FUNCTION solar.schedule_project_row_bind();
CREATE TRIGGER schedule_baselines_bind BEFORE INSERT ON solar.schedule_baselines
    FOR EACH ROW EXECUTE FUNCTION solar.schedule_project_row_bind();
CREATE TRIGGER schedule_filter_presets_bind BEFORE INSERT OR UPDATE ON solar.schedule_filter_presets
    FOR EACH ROW EXECUTE FUNCTION solar.schedule_project_row_bind();

CREATE OR REPLACE FUNCTION solar.schedule_baseline_tasks_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    SELECT project_id, organisation_id INTO NEW.project_id, NEW.organisation_id
      FROM solar.schedule_baselines WHERE id = NEW.baseline_id;
    IF NEW.project_id IS NULL THEN
        RAISE EXCEPTION 'solar.schedule_baseline_tasks: baseline % not found', NEW.baseline_id USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER schedule_baseline_tasks_bind BEFORE INSERT ON solar.schedule_baseline_tasks
    FOR EACH ROW EXECUTE FUNCTION solar.schedule_baseline_tasks_bind();

CREATE OR REPLACE FUNCTION solar.schedule_templates_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.organisation_id <> OLD.organisation_id THEN
            RAISE EXCEPTION 'solar.schedule_templates: organisation_id is immutable' USING ERRCODE = '42501';
        END IF;
        NEW.created_at := OLD.created_at;
    END IF;
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END $$;
CREATE TRIGGER schedule_templates_bind BEFORE INSERT OR UPDATE ON solar.schedule_templates
    FOR EACH ROW EXECUTE FUNCTION solar.schedule_templates_bind();

REVOKE ALL ON FUNCTION solar.schedule_tasks_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.schedule_tasks_bind() FROM anon;
REVOKE ALL ON FUNCTION solar.schedule_segments_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.schedule_segments_bind() FROM anon;
REVOKE ALL ON FUNCTION solar.schedule_dependencies_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.schedule_dependencies_bind() FROM anon;
REVOKE ALL ON FUNCTION solar.schedule_project_row_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.schedule_project_row_bind() FROM anon;
REVOKE ALL ON FUNCTION solar.schedule_baseline_tasks_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.schedule_baseline_tasks_bind() FROM anon;
REVOKE ALL ON FUNCTION solar.schedule_templates_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.schedule_templates_bind() FROM anon;

-- ── 6. RLS: SELECT permissive on solar_can_view; each write verb = permissive
--      membership + RESTRICTIVE solar_can_edit (00207 / 00200 shape). ──────────
ALTER TABLE solar.schedule_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.schedule_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.schedule_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.schedule_tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.schedule_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.schedule_segments FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.schedule_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.schedule_dependencies FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.schedule_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.schedule_baselines FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.schedule_baseline_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.schedule_baseline_tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.schedule_filter_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.schedule_filter_presets FORCE ROW LEVEL SECURITY;
ALTER TABLE solar.schedule_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.schedule_templates FORCE ROW LEVEL SECURITY;

-- settings: read / insert / update (no delete)
CREATE POLICY schedule_settings_select ON solar.schedule_settings FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY schedule_settings_insert ON solar.schedule_settings FOR INSERT TO authenticated
    WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY schedule_settings_update ON solar.schedule_settings FOR UPDATE TO authenticated
    USING (public.user_has_project_access(project_id)) WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY schedule_settings_insert_authz ON solar.schedule_settings AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY schedule_settings_update_authz ON solar.schedule_settings AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_edit(project_id)) WITH CHECK (public.solar_can_edit(project_id));

-- tasks, segments, dependencies: full verb set
CREATE POLICY schedule_tasks_select ON solar.schedule_tasks FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY schedule_tasks_insert ON solar.schedule_tasks FOR INSERT TO authenticated
    WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY schedule_tasks_update ON solar.schedule_tasks FOR UPDATE TO authenticated
    USING (public.user_has_project_access(project_id)) WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY schedule_tasks_delete ON solar.schedule_tasks FOR DELETE TO authenticated
    USING (public.user_has_project_access(project_id));
CREATE POLICY schedule_tasks_insert_authz ON solar.schedule_tasks AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY schedule_tasks_update_authz ON solar.schedule_tasks AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_edit(project_id)) WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY schedule_tasks_delete_authz ON solar.schedule_tasks AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_edit(project_id));

CREATE POLICY schedule_segments_select ON solar.schedule_segments FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY schedule_segments_insert ON solar.schedule_segments FOR INSERT TO authenticated
    WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY schedule_segments_update ON solar.schedule_segments FOR UPDATE TO authenticated
    USING (public.user_has_project_access(project_id)) WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY schedule_segments_delete ON solar.schedule_segments FOR DELETE TO authenticated
    USING (public.user_has_project_access(project_id));
CREATE POLICY schedule_segments_insert_authz ON solar.schedule_segments AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY schedule_segments_update_authz ON solar.schedule_segments AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_edit(project_id)) WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY schedule_segments_delete_authz ON solar.schedule_segments AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_edit(project_id));

CREATE POLICY schedule_dependencies_select ON solar.schedule_dependencies FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY schedule_dependencies_insert ON solar.schedule_dependencies FOR INSERT TO authenticated
    WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY schedule_dependencies_update ON solar.schedule_dependencies FOR UPDATE TO authenticated
    USING (public.user_has_project_access(project_id)) WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY schedule_dependencies_delete ON solar.schedule_dependencies FOR DELETE TO authenticated
    USING (public.user_has_project_access(project_id));
CREATE POLICY schedule_dependencies_insert_authz ON solar.schedule_dependencies AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY schedule_dependencies_update_authz ON solar.schedule_dependencies AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_edit(project_id)) WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY schedule_dependencies_delete_authz ON solar.schedule_dependencies AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_edit(project_id));

-- baselines: read / insert / delete (a baseline is never edited)
CREATE POLICY schedule_baselines_select ON solar.schedule_baselines FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY schedule_baselines_insert ON solar.schedule_baselines FOR INSERT TO authenticated
    WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY schedule_baselines_delete ON solar.schedule_baselines FOR DELETE TO authenticated
    USING (public.user_has_project_access(project_id));
CREATE POLICY schedule_baselines_insert_authz ON solar.schedule_baselines AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));
CREATE POLICY schedule_baselines_delete_authz ON solar.schedule_baselines AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_edit(project_id));

-- baseline tasks: append-only snapshot rows (deleted only with their baseline)
CREATE POLICY schedule_baseline_tasks_select ON solar.schedule_baseline_tasks FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY schedule_baseline_tasks_insert ON solar.schedule_baseline_tasks FOR INSERT TO authenticated
    WITH CHECK (public.user_has_project_access(project_id));
CREATE POLICY schedule_baseline_tasks_insert_authz ON solar.schedule_baseline_tasks AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_edit(project_id));

-- presets: the caller's own rows; saving a filter is a View-level action
CREATE POLICY schedule_filter_presets_select ON solar.schedule_filter_presets FOR SELECT TO authenticated
    USING (user_id = auth.uid() AND public.solar_can_view(project_id));
CREATE POLICY schedule_filter_presets_insert ON solar.schedule_filter_presets FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid() AND public.user_has_project_access(project_id));
CREATE POLICY schedule_filter_presets_update ON solar.schedule_filter_presets FOR UPDATE TO authenticated
    USING (user_id = auth.uid() AND public.user_has_project_access(project_id))
    WITH CHECK (user_id = auth.uid() AND public.user_has_project_access(project_id));
CREATE POLICY schedule_filter_presets_delete ON solar.schedule_filter_presets FOR DELETE TO authenticated
    USING (user_id = auth.uid() AND public.user_has_project_access(project_id));
CREATE POLICY schedule_filter_presets_insert_authz ON solar.schedule_filter_presets AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (public.solar_can_view(project_id));
CREATE POLICY schedule_filter_presets_update_authz ON solar.schedule_filter_presets AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (public.solar_can_view(project_id)) WITH CHECK (public.solar_can_view(project_id));
CREATE POLICY schedule_filter_presets_delete_authz ON solar.schedule_filter_presets AS RESTRICTIVE FOR DELETE TO authenticated
    USING (public.solar_can_view(project_id));

-- templates: org owners/admins (like solar.org_settings, 00208); seeding reads it via a definer RPC
CREATE POLICY schedule_templates_select ON solar.schedule_templates FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.user_organisations uo WHERE uo.user_id = auth.uid()
                     AND uo.organisation_id = schedule_templates.organisation_id AND uo.is_active AND uo.role IN ('owner', 'admin')));
CREATE POLICY schedule_templates_insert ON solar.schedule_templates FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public.user_organisations uo WHERE uo.user_id = auth.uid()
                     AND uo.organisation_id = schedule_templates.organisation_id AND uo.is_active AND uo.role IN ('owner', 'admin')));
CREATE POLICY schedule_templates_update ON solar.schedule_templates FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.user_organisations uo WHERE uo.user_id = auth.uid()
                     AND uo.organisation_id = schedule_templates.organisation_id AND uo.is_active AND uo.role IN ('owner', 'admin')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.user_organisations uo WHERE uo.user_id = auth.uid()
                     AND uo.organisation_id = schedule_templates.organisation_id AND uo.is_active AND uo.role IN ('owner', 'admin')));

-- ── 7. Grants (the schema's default privileges granted everything; narrow them) ─
GRANT SELECT, INSERT, UPDATE, DELETE ON solar.schedule_tasks, solar.schedule_segments,
    solar.schedule_dependencies, solar.schedule_filter_presets TO authenticated;
GRANT SELECT, INSERT, UPDATE ON solar.schedule_settings, solar.schedule_templates TO authenticated;
REVOKE DELETE ON solar.schedule_settings, solar.schedule_templates FROM authenticated;
GRANT SELECT, INSERT, DELETE ON solar.schedule_baselines TO authenticated;
REVOKE UPDATE ON solar.schedule_baselines FROM authenticated;
GRANT SELECT, INSERT ON solar.schedule_baseline_tasks TO authenticated;
REVOKE UPDATE, DELETE ON solar.schedule_baseline_tasks FROM authenticated;
REVOKE TRUNCATE ON solar.schedule_settings, solar.schedule_tasks, solar.schedule_segments, solar.schedule_dependencies,
    solar.schedule_baselines, solar.schedule_baseline_tasks, solar.schedule_filter_presets, solar.schedule_templates FROM authenticated;
GRANT ALL ON solar.schedule_settings, solar.schedule_tasks, solar.schedule_segments, solar.schedule_dependencies,
    solar.schedule_baselines, solar.schedule_baseline_tasks, solar.schedule_filter_presets, solar.schedule_templates TO service_role;
REVOKE ALL ON solar.schedule_settings, solar.schedule_tasks, solar.schedule_segments, solar.schedule_dependencies,
    solar.schedule_baselines, solar.schedule_baseline_tasks, solar.schedule_filter_presets, solar.schedule_templates FROM anon;
```

- [ ] **Step 5: RPCs (same file, appended)**

```sql
-- ── 8. RPCs ─────────────────────────────────────────────────────────────────
-- Internal: the Edit gate every definer RPC calls first. Not executable by clients.
CREATE OR REPLACE FUNCTION solar.schedule_assert_editor(p_project_id UUID)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT public.solar_can_edit(p_project_id) THEN
        RAISE EXCEPTION 'You need Edit access to Solar on this project to change the schedule.' USING ERRCODE = '42501';
    END IF;
END $$;

-- Internal: remove tasks = void their work items (reopening a closed one first,
-- which the spine's guard allows the write set or the gatekeeper) and delete the
-- side rows (segments and links cascade; baseline rows keep a NULL task_id).
CREATE OR REPLACE FUNCTION solar.schedule_remove_tasks(p_project_id UUID, p_task_ids UUID[])
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r RECORD; v_n INTEGER := 0;
BEGIN
    FOR r IN SELECT t.id, t.work_item_id, wi.status
               FROM solar.schedule_tasks t JOIN projects.work_items wi ON wi.id = t.work_item_id
              WHERE t.project_id = p_project_id AND t.id = ANY (p_task_ids)
              ORDER BY t.sort_order
              FOR UPDATE OF t LOOP
        IF r.status = 'closed' THEN
            UPDATE projects.work_items SET status = 'open' WHERE id = r.work_item_id;
        END IF;
        IF r.status <> 'void' THEN
            UPDATE projects.work_items SET status = 'void', void_reason = 'Removed from the solar schedule.' WHERE id = r.work_item_id;
        END IF;
        DELETE FROM solar.schedule_tasks WHERE id = r.id;
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END $$;

-- Create tasks (Add task / Add milestone / template / import / undo of a delete).
-- p_tasks: [{key, name, start, end, is_milestone?, category?, zone?, owner_id?,
--            status?, progress?, colour?, description?, segments?: [{start,end}]}]
-- p_links: [{from, to, type, lag}] where from/to are keys in p_tasks or ids of
--          tasks already on this project. p_replace: remove every live task first,
--          INSIDE this transaction (WM deleted first and inserted row by row).
-- Returns {key: task_id}.
CREATE OR REPLACE FUNCTION solar.schedule_create_tasks(
    p_project_id UUID, p_tasks JSONB, p_links JSONB DEFAULT '[]'::jsonb, p_replace BOOLEAN DEFAULT false)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_uid     UUID := auth.uid();
    v_org     UUID;
    v_map     JSONB := '{}'::jsonb;
    v_sort    INTEGER;
    t         JSONB;
    l         JSONB;
    s         JSONB;
    v_name    TEXT;
    v_owner   UUID;
    v_start   DATE;
    v_end     DATE;
    v_ms      BOOLEAN;
    v_status  TEXT;
    v_wi      UUID;
    v_task    UUID;
    v_pred    UUID;
    v_succ    UUID;
BEGIN
    PERFORM solar.schedule_assert_editor(p_project_id);
    IF jsonb_typeof(p_tasks) IS DISTINCT FROM 'array' OR jsonb_array_length(p_tasks) = 0 THEN
        RAISE EXCEPTION 'There is nothing to add.' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(p_tasks) > 2000 THEN
        RAISE EXCEPTION 'At most 2,000 tasks can be added at once.' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('solar.schedule:' || p_project_id::text, 0));
    SELECT organisation_id INTO v_org FROM projects.projects WHERE id = p_project_id;

    IF p_replace THEN
        PERFORM solar.schedule_remove_tasks(p_project_id,
            ARRAY(SELECT id FROM solar.schedule_tasks WHERE project_id = p_project_id));
    END IF;
    SELECT COALESCE(max(sort_order), 0) INTO v_sort FROM solar.schedule_tasks WHERE project_id = p_project_id;

    FOR t IN SELECT * FROM jsonb_array_elements(p_tasks) LOOP
        v_name := btrim(COALESCE(t->>'name', ''));
        IF v_name = '' THEN
            RAISE EXCEPTION 'Every task needs a name.' USING ERRCODE = '22023';
        END IF;
        v_ms := COALESCE((t->>'is_milestone')::boolean, false);
        v_start := (t->>'start')::date;
        v_end := CASE WHEN v_ms THEN v_start ELSE (t->>'end')::date END;
        IF v_start IS NULL OR v_end IS NULL THEN
            RAISE EXCEPTION '"%" needs a start and an end date.', v_name USING ERRCODE = '22023';
        END IF;
        IF v_end < v_start THEN
            RAISE EXCEPTION '"%" ends before it starts.', v_name USING ERRCODE = '22023';
        END IF;
        v_status := COALESCE(NULLIF(t->>'status', ''), 'not_started');
        IF v_status NOT IN ('not_started', 'in_progress', 'done') THEN
            RAISE EXCEPTION '"%" has an unknown status.', v_name USING ERRCODE = '22023';
        END IF;
        v_owner := NULLIF(t->>'owner_id', '')::uuid;
        IF v_owner IS NOT NULL AND public.user_effective_project_role(p_project_id, v_owner) IS NULL THEN
            RAISE EXCEPTION 'That person is not an active member of this project, so "%" cannot be given to them.', v_name
                USING ERRCODE = '22023';
        END IF;
        v_owner := projects.resolve_work_item_assignee(p_project_id, 'solar_task', v_owner);
        IF v_owner IS NULL THEN
            RAISE EXCEPTION 'Nobody on this project can own "%". Add a project manager first.', v_name USING ERRCODE = '22023';
        END IF;
        v_sort := v_sort + 1;

        INSERT INTO projects.work_items
            (organisation_id, project_id, item_type, origin, title, status, assignee_id, gatekeeper_id, due_date, created_by)
        VALUES (v_org, p_project_id, 'solar_task', 'manual', left(v_name, 300), 'open', v_owner, v_uid, v_end, v_uid)
        RETURNING id INTO v_wi;

        INSERT INTO solar.schedule_tasks
            (work_item_id, project_id, category, zone, start_date, end_date, progress, colour, sort_order,
             is_milestone, gantt_status, description)
        VALUES (v_wi, p_project_id,
                left(btrim(COALESCE(t->>'category', '')), 120), left(btrim(COALESCE(t->>'zone', '')), 120),
                v_start, v_end,
                CASE WHEN v_status = 'done' THEN 100
                     ELSE LEAST(100, GREATEST(0, COALESCE((t->>'progress')::int, 0))) END,
                COALESCE(NULLIF(lower(t->>'colour'), ''), '#3b82f6'), v_sort, v_ms, v_status,
                left(COALESCE(t->>'description', ''), 4000))
        RETURNING id INTO v_task;

        IF jsonb_typeof(t->'segments') = 'array' AND jsonb_array_length(t->'segments') >= 2 THEN
            FOR s IN SELECT * FROM jsonb_array_elements(t->'segments') LOOP
                INSERT INTO solar.schedule_segments (task_id, start_date, end_date)
                VALUES (v_task, (s->>'start')::date, (s->>'end')::date);
            END LOOP;
        END IF;

        IF v_status = 'done' THEN
            -- The creator is the gatekeeper (gatekeeper_rule = 'creator'), so the guard admits the close.
            UPDATE projects.work_items SET status = 'closed' WHERE id = v_wi;
        END IF;
        v_map := v_map || jsonb_build_object(COALESCE(NULLIF(t->>'key', ''), v_task::text), v_task);
    END LOOP;

    IF jsonb_typeof(p_links) = 'array' THEN
        FOR l IN SELECT * FROM jsonb_array_elements(p_links) LOOP
            v_pred := (v_map->>(l->>'from'))::uuid;
            IF v_pred IS NULL THEN
                SELECT id INTO v_pred FROM solar.schedule_tasks WHERE project_id = p_project_id AND id::text = l->>'from';
            END IF;
            v_succ := (v_map->>(l->>'to'))::uuid;
            IF v_succ IS NULL THEN
                SELECT id INTO v_succ FROM solar.schedule_tasks WHERE project_id = p_project_id AND id::text = l->>'to';
            END IF;
            IF v_pred IS NULL OR v_succ IS NULL THEN
                RAISE EXCEPTION 'A dependency points at a task that is not in this schedule.' USING ERRCODE = '22023';
            END IF;
            INSERT INTO solar.schedule_dependencies (predecessor_task_id, successor_task_id, link_type, lag_days)
            VALUES (v_pred, v_succ, COALESCE(NULLIF(l->>'type', ''), 'FS'), COALESCE((l->>'lag')::int, 0));
        END LOOP;
    END IF;
    RETURN v_map;
END $$;

-- Update tasks (drag, dialog, bulk bar, undo). p_patches: [{id, expected_updated_at?,
-- name?, category?, zone?, start?, end?, progress?, colour?, description?,
-- owner_id?, status?, is_milestone?, segments?}]. A key that is absent is left
-- alone. Dates of a split task must come WITH its segments (the client computes
-- them with fitSegments). Returns [{id, updated_at}].
CREATE OR REPLACE FUNCTION solar.schedule_update_tasks(p_project_id UUID, p_patches JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_uid      UUID := auth.uid();
    p          JSONB;
    s          JSONB;
    v_t        solar.schedule_tasks%ROWTYPE;
    v_wi       projects.work_items%ROWTYPE;
    v_start    DATE;
    v_end      DATE;
    v_ms       BOOLEAN;
    v_status   TEXT;
    v_target   TEXT;
    v_owner    UUID;
    v_name     TEXT;
    v_old_end  DATE;
    v_out      JSONB := '[]'::jsonb;
BEGIN
    PERFORM solar.schedule_assert_editor(p_project_id);
    IF jsonb_typeof(p_patches) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'There is nothing to change.' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('solar.schedule:' || p_project_id::text, 0));

    FOR p IN SELECT * FROM jsonb_array_elements(p_patches) LOOP
        SELECT * INTO v_t FROM solar.schedule_tasks
         WHERE id = (p->>'id')::uuid AND project_id = p_project_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'That task is no longer on this schedule. Reload to see the current programme.' USING ERRCODE = 'P0002';
        END IF;
        IF NULLIF(p->>'expected_updated_at', '') IS NOT NULL
           AND (p->>'expected_updated_at')::timestamptz <> v_t.updated_at THEN
            RAISE EXCEPTION 'Someone else changed this — reload to see their version.' USING ERRCODE = '40001';
        END IF;
        SELECT * INTO v_wi FROM projects.work_items WHERE id = v_t.work_item_id FOR UPDATE;
        v_old_end := v_t.end_date;

        v_ms := COALESCE((p->>'is_milestone')::boolean, v_t.is_milestone);
        v_start := COALESCE((p->>'start')::date, v_t.start_date);
        v_end := CASE WHEN v_ms THEN v_start ELSE COALESCE((p->>'end')::date, v_t.end_date) END;
        IF p ? 'segments' THEN
            DELETE FROM solar.schedule_segments WHERE task_id = v_t.id;
            IF jsonb_typeof(p->'segments') = 'array' AND jsonb_array_length(p->'segments') >= 2 THEN
                SELECT min((x->>'start')::date), max((x->>'end')::date) INTO v_start, v_end
                  FROM jsonb_array_elements(p->'segments') x;
            END IF;
        ELSIF (v_start <> v_t.start_date OR v_end <> v_t.end_date)
              AND EXISTS (SELECT 1 FROM solar.schedule_segments WHERE task_id = v_t.id) THEN
            RAISE EXCEPTION 'This task is split. Send its segments with the new dates.' USING ERRCODE = '22023';
        END IF;
        IF v_end < v_start THEN
            RAISE EXCEPTION 'A task cannot end before it starts.' USING ERRCODE = '22023';
        END IF;
        v_status := COALESCE(NULLIF(p->>'status', ''), v_t.gantt_status);
        IF v_status NOT IN ('not_started', 'in_progress', 'done') THEN
            RAISE EXCEPTION 'That status is not one of Not started, In progress or Done.' USING ERRCODE = '22023';
        END IF;

        UPDATE solar.schedule_tasks SET
            category     = CASE WHEN p ? 'category' THEN left(btrim(COALESCE(p->>'category', '')), 120) ELSE category END,
            zone         = CASE WHEN p ? 'zone' THEN left(btrim(COALESCE(p->>'zone', '')), 120) ELSE zone END,
            start_date   = v_start,
            end_date     = v_end,
            is_milestone = v_ms,
            progress     = CASE WHEN v_status = 'done' AND NOT (p ? 'progress') THEN 100
                                WHEN p ? 'progress' THEN LEAST(100, GREATEST(0, (p->>'progress')::int))
                                ELSE progress END,
            colour       = CASE WHEN p ? 'colour' THEN lower(p->>'colour') ELSE colour END,
            description  = CASE WHEN p ? 'description' THEN left(COALESCE(p->>'description', ''), 4000) ELSE description END,
            gantt_status = v_status
         WHERE id = v_t.id
        RETURNING * INTO v_t;

        IF p ? 'segments' AND jsonb_typeof(p->'segments') = 'array' AND jsonb_array_length(p->'segments') >= 2 THEN
            FOR s IN SELECT * FROM jsonb_array_elements(p->'segments') LOOP
                INSERT INTO solar.schedule_segments (task_id, start_date, end_date)
                VALUES (v_t.id, (s->>'start')::date, (s->>'end')::date);
            END LOOP;
        END IF;

        -- The work item: title, owner, due date, status — each through the spine's triggers.
        IF p ? 'name' THEN
            v_name := btrim(COALESCE(p->>'name', ''));
            IF v_name = '' THEN RAISE EXCEPTION 'Every task needs a name.' USING ERRCODE = '22023'; END IF;
            UPDATE projects.work_items SET title = left(v_name, 300) WHERE id = v_wi.id AND title IS DISTINCT FROM left(v_name, 300);
        END IF;
        IF p ? 'owner_id' THEN
            v_owner := NULLIF(p->>'owner_id', '')::uuid;
            IF v_owner IS NULL OR public.user_effective_project_role(p_project_id, v_owner) IS NULL THEN
                RAISE EXCEPTION 'That person is not an active member of this project.' USING ERRCODE = '22023';
            END IF;
            UPDATE projects.work_items SET assignee_id = v_owner WHERE id = v_wi.id AND assignee_id IS DISTINCT FROM v_owner;
        END IF;
        IF v_t.end_date IS DISTINCT FROM v_old_end
           AND (projects.user_can_write_work_item(p_project_id, 'solar_task') OR v_uid = v_wi.gatekeeper_id) THEN
            UPDATE projects.work_items SET due_date = v_t.end_date WHERE id = v_wi.id;
        END IF;
        IF p ? 'status' THEN
            SELECT * INTO v_wi FROM projects.work_items WHERE id = v_wi.id;
            v_target := NULL;
            IF v_status = 'done' THEN
                IF v_wi.status IN ('triage', 'open') THEN
                    v_target := CASE WHEN v_uid = v_wi.gatekeeper_id THEN 'closed' ELSE 'answered' END;
                ELSIF v_wi.status = 'answered' AND v_uid = v_wi.gatekeeper_id THEN
                    v_target := 'closed';
                END IF;
            ELSIF v_wi.status IN ('answered', 'closed') THEN
                v_target := 'open';
            END IF;
            IF v_target IS NOT NULL AND v_target <> v_wi.status THEN
                UPDATE projects.work_items SET status = v_target WHERE id = v_wi.id;
            END IF;
        END IF;
        v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_t.id, 'updated_at', v_t.updated_at));
    END LOOP;
    RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION solar.schedule_delete_tasks(p_project_id UUID, p_task_ids UUID[])
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM solar.schedule_assert_editor(p_project_id);
    PERFORM pg_advisory_xact_lock(hashtextextended('solar.schedule:' || p_project_id::text, 0));
    RETURN solar.schedule_remove_tasks(p_project_id, p_task_ids);
END $$;

-- Reorder: sort_order = position in p_ids (the FULL list — WM renumbered only the
-- filtered rows and collided). INVOKER: RLS (solar_can_edit on UPDATE) decides.
CREATE OR REPLACE FUNCTION solar.schedule_reorder(p_project_id UUID, p_ids UUID[])
RETURNS INTEGER LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
    WITH o AS (SELECT u.id, u.ord FROM unnest(p_ids) WITH ORDINALITY AS u(id, ord)),
         upd AS (UPDATE solar.schedule_tasks t SET sort_order = o.ord::int
                   FROM o WHERE t.id = o.id AND t.project_id = p_project_id AND t.sort_order <> o.ord::int
                 RETURNING 1)
    SELECT count(*)::int FROM upd;
$$;

-- Save the current programme as a baseline. INVOKER: RLS decides (Edit to insert).
CREATE OR REPLACE FUNCTION solar.schedule_save_baseline(p_project_id UUID, p_name TEXT, p_description TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_id UUID; v_mode TEXT;
BEGIN
    SELECT duration_mode INTO v_mode FROM solar.schedule_settings WHERE project_id = p_project_id;
    INSERT INTO solar.schedule_baselines (project_id, name, description, duration_mode)
    VALUES (p_project_id, p_name, NULLIF(btrim(COALESCE(p_description, '')), ''), COALESCE(v_mode, 'calendar'))
    RETURNING id INTO v_id;
    INSERT INTO solar.schedule_baseline_tasks (baseline_id, task_id, work_item_ref, name, start_date, end_date, is_milestone, sort_order)
    SELECT v_id, t.id, wi.ref, wi.title, t.start_date, t.end_date, t.is_milestone, t.sort_order
      FROM solar.schedule_tasks t JOIN projects.work_items wi ON wi.id = t.work_item_id
     WHERE t.project_id = p_project_id;
    RETURN v_id;
END $$;

-- Owner picker: active members of the project (effective role non-null), visible
-- to anyone who can view the schedule; empty for everyone else.
CREATE OR REPLACE FUNCTION solar.schedule_owner_candidates(p_project_id UUID)
RETURNS TABLE (user_id UUID, full_name TEXT, email TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT p.id, p.full_name, p.email
      FROM public.profiles p
     WHERE public.solar_can_view(p_project_id)
       AND p.id IN (
             SELECT pm.user_id FROM projects.project_members pm WHERE pm.project_id = p_project_id AND pm.is_active
             UNION
             SELECT uo.user_id FROM public.user_organisations uo
               JOIN projects.projects pr ON pr.organisation_id = uo.organisation_id
              WHERE pr.id = p_project_id AND uo.is_active AND uo.role IN ('owner', 'admin', 'project_manager'))
       AND public.user_effective_project_role(p_project_id, p.id) IS NOT NULL
     ORDER BY p.full_name;
$$;

-- The org's schedule template for seeding (Edit level); NULL = use the built-in default.
CREATE OR REPLACE FUNCTION solar.schedule_org_template(p_project_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_content JSONB;
BEGIN
    PERFORM solar.schedule_assert_editor(p_project_id);
    SELECT st.content INTO v_content
      FROM solar.schedule_templates st JOIN projects.projects p ON p.organisation_id = st.organisation_id
     WHERE p.id = p_project_id;
    RETURN v_content;
END $$;

-- Spelled out per function (not a format() loop): the repo-wide anon-EXECUTE
-- guard in packages/db reads the migration TEXT.
REVOKE ALL ON FUNCTION solar.schedule_assert_editor(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.schedule_assert_editor(uuid) FROM anon;
REVOKE ALL ON FUNCTION solar.schedule_assert_editor(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION solar.schedule_remove_tasks(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.schedule_remove_tasks(uuid, uuid[]) FROM anon;
REVOKE ALL ON FUNCTION solar.schedule_remove_tasks(uuid, uuid[]) FROM authenticated;
REVOKE ALL ON FUNCTION solar.schedule_create_tasks(uuid, jsonb, jsonb, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.schedule_create_tasks(uuid, jsonb, jsonb, boolean) FROM anon;
REVOKE ALL ON FUNCTION solar.schedule_update_tasks(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.schedule_update_tasks(uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION solar.schedule_delete_tasks(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.schedule_delete_tasks(uuid, uuid[]) FROM anon;
REVOKE ALL ON FUNCTION solar.schedule_reorder(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.schedule_reorder(uuid, uuid[]) FROM anon;
REVOKE ALL ON FUNCTION solar.schedule_save_baseline(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.schedule_save_baseline(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION solar.schedule_owner_candidates(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.schedule_owner_candidates(uuid) FROM anon;
REVOKE ALL ON FUNCTION solar.schedule_org_template(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.schedule_org_template(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION solar.schedule_assert_editor(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION solar.schedule_remove_tasks(uuid, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION solar.schedule_create_tasks(uuid, jsonb, jsonb, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION solar.schedule_update_tasks(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION solar.schedule_delete_tasks(uuid, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION solar.schedule_reorder(uuid, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION solar.schedule_save_baseline(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION solar.schedule_owner_candidates(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION solar.schedule_org_template(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 6: Run it GREEN**

```bash
grep -n "COMMIT\|^BEGIN;" apps/edge-functions/supabase/migrations/00212_solar_schedule.sql   # must print nothing
cp "$S/red.sql" "$S/green.sql"
[ "$(cat "$S/green.sql")" = 'SELECT 1;' ] && : > "$S/green.sql"
cat apps/edge-functions/supabase/migrations/00212_solar_schedule.sql >> "$S/green.sql"
scripts/db/dry-run-migration.sh "$S/green.sql" scripts/db/assert-solar-schedule-roles.sql 2>&1 | tee "$S/green.out"
```
Expected: 56 rows, every `ok = t`. If one is `f`, fix the **migration**, not the assertion (the assertion states the spec). A failure the migration cannot fix because the spine behaves differently than documented (e.g. the transition guard refuses a move this plan assumed it allows) is a STOP: report it, do not weaken the check.

- [ ] **Step 7: Mutation checks (prove the checks can fail)**

Rebuild `green.sql` after each edit, re-run, record, revert:

| Mutation in 00212 | Expected red |
|---|---|
| In `schedule_assert_editor`, change `IF auth.uid() IS NULL OR NOT public.solar_can_edit(p_project_id)` to `IF auth.uid() IS NULL` | `create_viewer_REFUSED`, `create_nogrant_REFUSED`, `lapsed_create_REFUSED` go `f` |
| In `schedule_dependencies_bind`, delete the `IF EXISTS (WITH RECURSIVE …) THEN RAISE … END IF;` block | `link_cycle_REFUSED` goes `f` |
| In `schedule_project_row_bind`, delete `NEW.user_id := COALESCE(auth.uid(), NEW.user_id);` | `viewer_saves_preset` and `preset_user_bound` go `f` |
| Change `schedule_baseline_tasks.task_id … ON DELETE SET NULL` to `ON DELETE CASCADE` | `baseline_keeps_removed_task` goes `f` |

Then revert all four, rebuild, re-run → 56/56 `t`. Save red, green and the four mutation outputs to `/tmp/solar-5b-dryrun.txt` (PR body evidence).

- [ ] **Step 8: Contract tests + the three suites**

```bash
pnpm --filter @esite/shared exec vitest run src/work-items
pnpm --filter web exec vitest run src/lib/migration-verify-block.contract.test.ts
pnpm --filter @esite/db test:ci 2>&1 | tail -8
```
Expected: all PASS — the registry tests now find `solar_task` in 00212's seed, the `SOLAR` arm in the latest `work_items_ensure_ref()`, and the A(b) row; the `@verify` block parses (no unknown directive, no em dash inside a `sql:` payload); the anon-EXECUTE replay finds every definer function in solar revoked.

- [ ] **Step 9: Commit (Task 10 + Task 11 together)**

```bash
git add apps/edge-functions/supabase/migrations/00212_solar_schedule.sql scripts/db/assert-solar-schedule-roles.sql \
  packages/shared/src/work-items docs/superpowers/specs/2026-09-09-v2-platform-roadmap/16-appendix-registries.md
git commit -m "feat(solar-schedule): 00212 — solar_task work items + Gantt side tables, per-verb RLS, gated RPCs

solar_task registered sourceless (creator gatekeeper, MARKUP_WRITE_ROLES); the
two spine objects that enumerate types re-declared with it. Tasks are born only
through solar.schedule_create_tasks (solar_can_edit, one transaction). Links
refuse self/cross-project/loops; baselines keep removed scope; presets per user.
Dry run red → green 56/56; four mutations each turn their checks red.
Registry contract tests now read every seed and the latest ref function.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Continue with Part 4 (`2026-09-28-solar-phase-5b-schedule-4-server.md`).
