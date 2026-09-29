-- ---------------------------------------------------------------------------
-- Migration 00213: Solar schedule (Gantt) — solar_task work items + side tables
-- ---------------------------------------------------------------------------
-- ⚠ NUMBER: claimed at APPLY time, not now. Immediately before applying,
-- re-check THREE places: the ledger max(version), origin/main's migration
-- filenames, and the migration filenames in every OPEN PR (tariffs 00210 and
-- the other Solar phases included). If 00213 is taken, renumber this file and
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
--      keep the solar_task arm. Both are the 00196 definitions: no migration
--      between 00196 and this one re-declares them, and the live bodies were
--      read back on 2026-09-28 and are byte-identical to 00196's.
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
--      solar.schedule_reorder is DEFINER too (Edit gate, scoped to its project);
--      solar.schedule_save_baseline is SECURITY INVOKER (RLS decides) and
--      skips void items. Create takes an optional per-task "gatekeeper_id"
--      (Undo of a delete keeps the original sign-off), honoured only when
--      schedule_owner_is_eligible(); otherwise the caller signs off.
--      DELIBERATE: the DB cannot tell an Undo from any other create, so ANY
--      editor may name another eligible member as the sign-off person. The
--      named member takes the gatekeeper seat (who alone closes); the naming
--      editor gains no ability to close. Undo uses it to restore the
--      original creator.
--      schedule_owner_candidates returns email only to an editor.
--   6a. schedule_tasks and schedule_segments are READ-ONLY to clients: no
--      INSERT/UPDATE/DELETE grant, SELECT policy only. The RPCs are the only
--      writers, so the work item, due date, segment fit and status stay in
--      step. schedule_dependencies keeps direct writes (the link editor).
--      schedule_segments_bind takes the per-project advisory lock.
--   7. OWNER ELIGIBILITY (owner decision Q4, 2026-09-28). A solar_task owner
--      (work_items.assignee_id) must be SOLAR-ELIGIBLE: an active project
--      member whose effective project role (00107) is neither client_viewer
--      nor supplier. ONE definition, solar.schedule_owner_is_eligible(), read
--      by (a) work_items_solar_owner_guard_trg — a BEFORE INSERT OR UPDATE OF
--      assignee_id, project_id trigger on projects.work_items that fires only
--      WHEN item_type = 'solar_task', so every path that sets the owner (the
--      create and update RPCs, a direct PostgREST UPDATE from My Work, any
--      future bulk path) is refused with SQLSTATE 'SOL01' and one sentence;
--      (b) the create RPC's no-owner fallback, which skips an ineligible pick
--      from projects.resolve_work_item_assignee() (a client-viewer triage
--      owner is legal for the spine, 00196 §7) and gives the task to its
--      creator — a Solar editor, eligible by 00208's grant rule; and (c) the
--      owner picker (schedule_owner_candidates). The spine's own rule —
--      client_viewer MAY hold other item types — is unchanged for them.
--      The trigger sorts after work_items_assert_membership_trg ('a' < 's'),
--      so a non-member is still refused by the spine's sentence first.
--   8. SOLAR EDIT GOVERNS THE WORK ITEM (review C1). work_items_solar_edit_guard_trg
--      (BEFORE UPDATE, WHEN OLD.item_type = 'solar_task') → solar.
--      schedule_work_item_edit_guard(): with a JWT and without
--      solar_can_edit(project) the only write is a status move by the
--      assignee or gatekeeper, never to 'void'; any other column change →
--      SQLSTATE 42501 + a sentence. The spine's write_roles alone (e.g. a
--      contractor with no grant, a View grant, or a lapsed subscription) no
--      longer reach a solar_task's title, due date, owner or void. BEFORE-row
--      order on work_items: assert_membership → solar_edit_guard →
--      solar_owner_guard → transition_guard.
--   9. SOLAR_TASK ROWS ARE SOLAR DATA (review I1). work_items_solar_select_authz:
--      RESTRICTIVE FOR SELECT on projects.work_items — item_type <> 'solar_task'
--      OR solar_can_view(project) OR the reader is its assignee / gatekeeper.
--      Other item types are untouched (asserted per user against 00196's
--      predicate).
--  9a. …AND SO ARE ITS EVENTS AND WATCHERS (re-review). 00196's
--      work_item_events_select / work_item_watchers_select / _insert call
--      projects.user_can_read_work_item() (definer, row_security off), which
--      9 cannot reach. solar.work_item_visible(id) (definer, EXECUTE to
--      authenticated because the policies call it) carries 9's arms, and
--      RESTRICTIVE policies per verb narrow SELECT on work_item_events and
--      SELECT / INSERT / DELETE on work_item_watchers (no UPDATE policy or
--      grant exists there). The spine helper is NOT redeclared. A watcher
--      without Solar View sees none of a solar_task's events. PR #193 (00202)
--      checked 2026-09-29: it declares no policy on either table, does not
--      touch user_can_read_work_item(), writes events/watchers only through
--      the spine's definer triggers, and its backfill's departed-watcher
--      DELETE runs as the migration role — none of it is subject to these.
--  10. A VOID FROM ANY PATH REMOVES THE BAR (review Spec-I2).
--      work_items_solar_void_cleanup_trg (AFTER UPDATE OF status, on the move
--      INTO void) deletes the side row; segments/links cascade, baseline rows
--      keep their snapshot with task_id NULL.
--  11. OWNER DECISION Q2 (write_roles = MARKUP_WRITE_ROLES), as built: an
--      own-org INSPECTOR with Solar Edit is NOT in the write set, so the
--      spine refuses them work-item governance. Moving a task they neither
--      created nor sign off saves the Gantt dates but leaves the work item's
--      due_date unchanged (the update RPC skips the mirror rather than trip
--      the spine's (a4)); deleting a task they do not hold is refused whole
--      with the spine's sentence "Only the project team, or whoever is
--      holding SOLAR-n, can drop it." (P0001). Asserted, not an accident.
--
-- No DOCX anywhere (owner decision Q7): nothing here enumerates export formats.
--
-- PR #193 (item 3, 00202, open) re-declares work_items_transition_guard():
-- source_status becomes immutable to client sessions and trigger-depth > 1
-- writes bypass it. Nothing here writes source_status and every work-item write
-- here runs at depth 1, so behaviour is identical before and after #193.
-- #193's other work_items triggers (work_items_assignment_writeback_ins/_upd,
-- AFTER) and its projection functions are SECURITY DEFINER with row_security
-- off and act only on sourced types, so neither section 8's guard (no
-- pg_trigger_depth() bypass needed: no trigger writes a solar_task) nor
-- section 9's RESTRICTIVE SELECT (definer, row_security off) changes them.
--
-- 00208's schema-wide @verify directives are re-checked on every deploy and
-- this migration conforms: FORCE RLS on every new relkind 'r' table; no
-- RESTRICTIVE policy covering SELECT anywhere in solar (restrictive policies
-- in solar are per write verb only; the one RESTRICTIVE SELECT this file adds
-- is on projects.work_items, item 9, and is deliberate); every SECURITY DEFINER function in solar has
-- EXECUTE revoked from PUBLIC and anon.
--
-- No new schema, so no PostgREST db_schema PATCH (solar is exposed since 00208).
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
-- function: projects.work_items_ensure_ref()
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
-- function: solar.schedule_owner_is_eligible(uuid, uuid)
-- function: solar.schedule_work_item_owner_guard()
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
-- trigger: work_items_solar_owner_guard_trg ON projects.work_items
-- sql: (SELECT p.prosrc LIKE '%''client_viewer''%''supplier''%' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'solar' AND p.proname = 'schedule_owner_is_eligible')
-- function: solar.schedule_work_item_edit_guard()
-- trigger: work_items_solar_edit_guard_trg ON projects.work_items
-- sql: (SELECT p.prosrc LIKE '%solar_can_edit%' AND p.prosrc LIKE '%''42501''%' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'solar' AND p.proname = 'schedule_work_item_edit_guard')
-- function: solar.schedule_work_item_void_cleanup()
-- trigger: work_items_solar_void_cleanup_trg ON projects.work_items
-- policy: work_items_solar_select_authz ON projects.work_items RESTRICTIVE
-- sql: (SELECT p.polcmd = 'r' AND pg_get_expr(p.polqual, p.polrelid) LIKE '%solar_can_view%' FROM pg_policy p WHERE p.polrelid = 'projects.work_items'::regclass AND p.polname = 'work_items_solar_select_authz')
-- function: solar.work_item_visible(uuid)
-- grant_absent: anon EXECUTE ON solar.work_item_visible(uuid)
-- grant_present: authenticated EXECUTE ON solar.work_item_visible(uuid)
-- policy: work_item_events_solar_select_authz ON projects.work_item_events RESTRICTIVE
-- policy: work_item_watchers_solar_select_authz ON projects.work_item_watchers RESTRICTIVE
-- policy: work_item_watchers_solar_insert_authz ON projects.work_item_watchers RESTRICTIVE
-- policy: work_item_watchers_solar_delete_authz ON projects.work_item_watchers RESTRICTIVE
-- sql: (SELECT count(*) = 4 FROM pg_policy p WHERE p.polrelid IN ('projects.work_item_events'::regclass, 'projects.work_item_watchers'::regclass) AND NOT p.polpermissive AND p.polcmd <> '*' AND coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') LIKE '%work_item_visible%')
-- policy: schedule_tasks_select ON solar.schedule_tasks PERMISSIVE
-- policy: schedule_segments_select ON solar.schedule_segments PERMISSIVE
-- sql: (SELECT count(*) = 0 FROM pg_policy p WHERE p.polrelid IN ('solar.schedule_tasks'::regclass, 'solar.schedule_segments'::regclass) AND p.polcmd <> 'r')
-- grant_absent: authenticated INSERT ON solar.schedule_tasks
-- grant_absent: authenticated UPDATE ON solar.schedule_tasks
-- grant_absent: authenticated DELETE ON solar.schedule_tasks
-- grant_absent: authenticated INSERT ON solar.schedule_segments
-- grant_absent: authenticated UPDATE ON solar.schedule_segments
-- grant_absent: authenticated DELETE ON solar.schedule_segments
-- sql: (SELECT p.prosecdef AND p.prosrc LIKE '%schedule_assert_editor%' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'solar' AND p.proname = 'schedule_reorder')
-- sql: (SELECT p.prosrc LIKE '%pg_advisory_xact_lock%' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'solar' AND p.proname = 'schedule_segments_bind')
-- sql: (SELECT p.prosrc LIKE '%status <> ''void''%' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'solar' AND p.proname = 'schedule_save_baseline')
-- sql: (SELECT p.prosrc LIKE '%gatekeeper_id%schedule_owner_is_eligible%' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'solar' AND p.proname = 'schedule_create_tasks')
-- sql: (SELECT p.prosrc LIKE '%solar_can_edit%email%' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'solar' AND p.proname = 'schedule_owner_candidates')
-- grant_absent: authenticated EXECUTE ON solar.schedule_work_item_edit_guard()
-- grant_absent: authenticated EXECUTE ON solar.schedule_work_item_void_cleanup()
-- policy: schedule_dependencies_insert_authz ON solar.schedule_dependencies RESTRICTIVE
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
-- grant_absent: authenticated EXECUTE ON solar.schedule_owner_is_eligible(uuid, uuid)
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
        RAISE EXCEPTION '00213 needs the work-item spine (00196) applied first';
    END IF;
    IF to_regprocedure('public.solar_can_edit(uuid)') IS NULL THEN
        RAISE EXCEPTION '00213 needs the Solar foundation (00208) applied first';
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

  -- Count only tails the allocator can parse. An explicit ref with no numeric
  -- tail ('JUNK') or a tail past int4 ('TASK-2147483647') is a legal row — and
  -- a permanent one: ref is immutable from §12 and rows are never deleted, so
  -- there is NO repair path. Casting it would raise 22P02 / 22003 on every
  -- later auto insert of that type on that project, forever (measured, rolled
  -- back). {1,9} keeps MAX + 1 inside int4. The predicate is deliberately NOT
  -- prefix-anchored: the prefix implies the type, so anchoring on it would
  -- silently paper over a lost item_type predicate.
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

-- ── 5. Bind triggers (SECURITY DEFINER, search_path '', 00208 pattern) ─────
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
    -- The same per-project lock the link bind and the RPCs take (review M3):
    -- two concurrent segment writes cannot both pass the overlap check below.
    PERFORM pg_advisory_xact_lock(hashtextextended('solar.schedule:' || v_project::text, 0));
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

-- ── 5b. Owner eligibility (owner decision Q4) ──────────────────────────────
-- THE one definition of "may own a solar task": an active project member
-- (00107's effective role is non-NULL: org owner/admin/PM, or an active
-- project_members row) whose effective role is neither client_viewer nor
-- supplier. Takes another user's id, so it is an oracle: NOT executable by
-- authenticated/anon (00208's user_max_grant_level convention).
CREATE OR REPLACE FUNCTION solar.schedule_owner_is_eligible(p_project_id UUID, p_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT COALESCE(public.user_effective_project_role(p_project_id, p_user_id)
                    NOT IN ('client_viewer', 'supplier'), false);
$$;

-- Refuses an ineligible owner on EVERY path that sets a solar_task's
-- assignee_id — the RPCs below and a direct UPDATE of the work item alike.
-- SQLSTATE 'SOL01' is this refusal's alone, so the web layer can map it
-- without parsing the sentence. A non-member never reaches here with a
-- different answer: work_items_assert_membership_trg sorts first and refuses
-- them with the spine's own sentence.
CREATE OR REPLACE FUNCTION solar.schedule_work_item_owner_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NEW.item_type = 'solar_task' AND NEW.assignee_id IS NOT NULL AND NEW.project_id IS NOT NULL
       AND (TG_OP = 'INSERT'
            OR NEW.assignee_id IS DISTINCT FROM OLD.assignee_id
            OR NEW.project_id IS DISTINCT FROM OLD.project_id)
       AND NOT solar.schedule_owner_is_eligible(NEW.project_id, NEW.assignee_id) THEN
        RAISE EXCEPTION 'Client viewers and suppliers cannot own solar tasks, so "%" cannot be given to them. Choose someone on the project team.',
            COALESCE(NEW.ref, NEW.title, 'this task')
            USING ERRCODE = 'SOL01';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS work_items_solar_owner_guard_trg ON projects.work_items;
CREATE TRIGGER work_items_solar_owner_guard_trg
    BEFORE INSERT OR UPDATE OF assignee_id, project_id ON projects.work_items
    FOR EACH ROW WHEN (NEW.item_type = 'solar_task')
    EXECUTE FUNCTION solar.schedule_work_item_owner_guard();

-- ── 5c. Solar Edit governs a solar_task's work item (review C1) ──────────────
-- The spine's work_items_update / _update_gate (00196 §9) admit the TYPE's
-- write set, so a contractor with no Solar grant (or a View grant, or while the
-- org's subscription has lapsed) could rename, void, re-date or reassign a
-- SOLAR-n item over PostgREST, bypassing solar_can_edit. Without Solar Edit the
-- ONLY write left is a STATUS move by the item's current assignee or
-- gatekeeper (My Work's "done"/"sign off"), never to 'void'. Everything else is
-- refused with SQLSTATE 42501 and a sentence.
--   * Compared as the whole row minus the columns the spine itself writes on a
--     transition: closed_at / closed_by / last_activity_at are stamped or
--     restored by work_items_transition_guard(), which fires AFTER this one
--     ('solar_e' < 't'), and ball_in_court_id is generated. void_reason is
--     compared, so a void row's reason cannot be edited without Edit either.
--   * The definer RPCs pass because auth.uid() there is the calling editor.
--   * Service role / migrations (auth.uid() IS NULL) pass.
--   * No pg_trigger_depth() bypass: nothing writes a solar_task from inside a
--     trigger (PR #193's projections touch only sourced types), so every write
--     is judged — a bypass here would be an unused door.
-- Sorts after work_items_assert_membership_trg ('a' < 's') and before
-- work_items_solar_owner_guard_trg ('solar_e' < 'solar_o'), so a no-Edit
-- reassignment gets THIS sentence, not SOL01.
CREATE OR REPLACE FUNCTION solar.schedule_work_item_edit_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_spine CONSTANT TEXT[] := ARRAY['status', 'closed_at', 'closed_by', 'last_activity_at', 'ball_in_court_id'];
BEGIN
    IF v_actor IS NULL OR public.solar_can_edit(OLD.project_id) THEN
        RETURN NEW;
    END IF;
    IF (pg_catalog.to_jsonb(NEW) - v_spine) IS DISTINCT FROM (pg_catalog.to_jsonb(OLD) - v_spine) THEN
        RAISE EXCEPTION 'Changing % needs Edit access to Solar on this project. Without it you can only move a task you hold to its next step.', OLD.ref
            USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NEW.status = 'void' THEN
            RAISE EXCEPTION 'Removing % from the programme needs Edit access to Solar on this project.', OLD.ref
                USING ERRCODE = '42501';
        END IF;
        IF v_actor IS DISTINCT FROM OLD.assignee_id AND v_actor IS DISTINCT FROM OLD.gatekeeper_id THEN
            RAISE EXCEPTION 'Only the person % is assigned to, or whoever signs it off, can move it along without Edit access to Solar.', OLD.ref
                USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS work_items_solar_edit_guard_trg ON projects.work_items;
CREATE TRIGGER work_items_solar_edit_guard_trg
    BEFORE UPDATE ON projects.work_items
    FOR EACH ROW WHEN (OLD.item_type = 'solar_task')
    EXECUTE FUNCTION solar.schedule_work_item_edit_guard();

-- ── 5d. A void from ANY path removes the bar (review Spec-I2) ───────────────
-- schedule_remove_tasks voids and deletes in one go, but an editor can also
-- drop a SOLAR-n item from My Work (a plain work_items UPDATE). Without this
-- the side row outlived its item: still drawn, still counted by the
-- readiness step, still snapshotted by the next baseline. AFTER UPDATE OF
-- status, only on the transition INTO void: segments and links cascade;
-- baseline rows keep their snapshot with task_id SET NULL (history kept).
-- Void is terminal (00196 §12 (c)), so there is no un-void to restore from.
CREATE OR REPLACE FUNCTION solar.schedule_work_item_void_cleanup()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    DELETE FROM solar.schedule_tasks WHERE work_item_id = NEW.id;
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS work_items_solar_void_cleanup_trg ON projects.work_items;
CREATE TRIGGER work_items_solar_void_cleanup_trg
    AFTER UPDATE OF status ON projects.work_items
    FOR EACH ROW WHEN (NEW.item_type = 'solar_task' AND NEW.status = 'void' AND OLD.status IS DISTINCT FROM 'void')
    EXECUTE FUNCTION solar.schedule_work_item_void_cleanup();

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
REVOKE ALL ON FUNCTION solar.schedule_owner_is_eligible(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.schedule_owner_is_eligible(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION solar.schedule_owner_is_eligible(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION solar.schedule_owner_is_eligible(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION solar.schedule_work_item_owner_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.schedule_work_item_owner_guard() FROM anon;
REVOKE ALL ON FUNCTION solar.schedule_work_item_edit_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.schedule_work_item_edit_guard() FROM anon;
REVOKE ALL ON FUNCTION solar.schedule_work_item_edit_guard() FROM authenticated;
REVOKE ALL ON FUNCTION solar.schedule_work_item_void_cleanup() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.schedule_work_item_void_cleanup() FROM anon;
REVOKE ALL ON FUNCTION solar.schedule_work_item_void_cleanup() FROM authenticated;

-- ── 6. RLS: SELECT permissive on solar_can_view; each write verb = permissive
--      membership + RESTRICTIVE solar_can_edit (00208 / 00200 shape). ──────────
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

-- tasks and segments: READ ONLY to clients (review I6). Every write goes
-- through the definer RPCs (section 8), which keep the work item, its due
-- date, the segment fit and the gantt status in step. A direct DELETE left a
-- live SOLAR-n with no bar; a direct end_date skipped the due-date mirror and
-- the segment re-fit; a direct gantt_status never closed the item. The web
-- writes neither table directly (grep apps/web: reads only).
CREATE POLICY schedule_tasks_select ON solar.schedule_tasks FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));
CREATE POLICY schedule_segments_select ON solar.schedule_segments FOR SELECT TO authenticated
    USING (public.solar_can_view(project_id));

-- dependencies: full verb set (the link editor writes them directly; the bind
-- trigger refuses self, cross-project and loops on INSERT and UPDATE)

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

-- templates: org owners/admins (like solar.org_settings, 00209); seeding reads it via a definer RPC
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

-- ── 6b. A SOLAR-n work item is Solar data (review I1) ──────────────────────
-- 00196's work_items_select admits every project member except a client
-- viewer — suppliers, members with no Solar grant, and everyone while the
-- org's Solar subscription has lapsed. 00208's rule is that they never see
-- Solar data. RESTRICTIVE and FOR SELECT ONLY (a RESTRICTIVE FOR ALL would
-- also narrow the write verbs' visibility in ways 00196 did not intend —
-- 00205/00206). Every non-solar row passes the first arm untouched, so no
-- other item type's visibility moves (asserted per user against 00196's own
-- predicate). A person the item is assigned to, or who signs it off, keeps it
-- in My Work regardless of grant. Definer paths (the RPCs, PR #193's
-- projections: SECURITY DEFINER, row_security off, sourced types only) and
-- service_role are not subject to it. Because UPDATE applies SELECT policies
-- to the rows it reads, a no-grant member's UPDATE of a solar item they do not
-- hold matches nothing — 5c is the refusal for the items they can see.
DROP POLICY IF EXISTS work_items_solar_select_authz ON projects.work_items;
CREATE POLICY work_items_solar_select_authz ON projects.work_items
    AS RESTRICTIVE FOR SELECT TO authenticated
    USING (item_type <> 'solar_task'
           OR public.solar_can_view(project_id)
           OR assignee_id = auth.uid()
           OR gatekeeper_id = auth.uid());

-- ── 6b. …and so are its EVENTS and WATCHERS (re-review; header item 9a) ────
-- 00196's work_item_events_select, work_item_watchers_select and
-- work_item_watchers_insert gate on projects.user_can_read_work_item(), a
-- SECURITY DEFINER, row_security-off helper repeating 00196's permissive
-- predicate — it reads work_items itself, so 6's RESTRICTIVE SELECT never
-- reaches it. Without this a supplier or a no-grant member (or anyone while
-- the subscription is lapsed) read every SOLAR-n event (status moves, actors,
-- due dates) and could INSERT themselves as a watcher on any solar_task.
-- The spine helper is NOT redeclared (PR #193 or a later migration could
-- overwrite it); solar.work_item_visible() answers 6's question for one work
-- item id and RESTRICTIVE policies, one per verb, narrow the permissive ones.
-- Same arms as 6: not a solar_task, or Solar View, or the caller is its
-- assignee / gatekeeper. A watcher WITHOUT Solar View therefore sees none of
-- a solar_task's events (00196's watcher arm is not honoured for this type,
-- exactly as 6 does not honour it for the row itself).
--   * DELETE is covered too, the caller's own row always removable. It has no
--     observable effect today — 00196's DELETE policy looks the item up in
--     work_items under RLS, which 6 already hides — and holds if that lookup
--     ever moves into a definer helper.
--   * work_item_watchers has no UPDATE policy (grant revoked in 00196) and
--     work_item_events takes no client writes, so nothing else needs covering.
--   * An unknown id, or any non-solar item, answers TRUE: only solar_task rows
--     are narrowed; the permissive policy still decides everything else.
--   * EXECUTE is granted to authenticated because the policies call it in the
--     caller's session; it says only whether THIS caller may see an item.
CREATE OR REPLACE FUNCTION solar.work_item_visible(p_work_item_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = '' SET row_security = off AS $$
    SELECT NOT EXISTS (
        SELECT 1 FROM projects.work_items wi
         WHERE wi.id = p_work_item_id
           AND wi.item_type = 'solar_task'
           AND NOT COALESCE(public.solar_can_view(wi.project_id)
                            OR wi.assignee_id = auth.uid()
                            OR wi.gatekeeper_id = auth.uid(), false));
$$;
REVOKE ALL ON FUNCTION solar.work_item_visible(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.work_item_visible(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION solar.work_item_visible(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS work_item_events_solar_select_authz ON projects.work_item_events;
CREATE POLICY work_item_events_solar_select_authz ON projects.work_item_events
    AS RESTRICTIVE FOR SELECT TO authenticated
    USING (solar.work_item_visible(work_item_id));
DROP POLICY IF EXISTS work_item_watchers_solar_select_authz ON projects.work_item_watchers;
CREATE POLICY work_item_watchers_solar_select_authz ON projects.work_item_watchers
    AS RESTRICTIVE FOR SELECT TO authenticated
    USING (solar.work_item_visible(work_item_id));
DROP POLICY IF EXISTS work_item_watchers_solar_insert_authz ON projects.work_item_watchers;
CREATE POLICY work_item_watchers_solar_insert_authz ON projects.work_item_watchers
    AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (solar.work_item_visible(work_item_id));
DROP POLICY IF EXISTS work_item_watchers_solar_delete_authz ON projects.work_item_watchers;
CREATE POLICY work_item_watchers_solar_delete_authz ON projects.work_item_watchers
    AS RESTRICTIVE FOR DELETE TO authenticated
    USING (user_id = auth.uid() OR solar.work_item_visible(work_item_id));

-- ── 7. Grants (the schema's default privileges granted everything; narrow them) ─
GRANT SELECT ON solar.schedule_tasks, solar.schedule_segments TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON solar.schedule_tasks, solar.schedule_segments FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON solar.schedule_dependencies, solar.schedule_filter_presets TO authenticated;
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
-- Owner (Q4): an explicit owner_id must be an active project member (22023
-- here) AND Solar-eligible (SOL01 from work_items_solar_owner_guard_trg). No
-- owner → the spine's resolver chain; a pick that is not Solar-eligible (a
-- client-viewer triage owner is legal for the spine) falls back to the
-- creator, who holds Solar Edit and is therefore eligible by 00208's rule.
-- Gatekeeper (review Spec-I4): an optional per-task "gatekeeper_id" — sent by
-- Undo of a delete so sign-off stays with the ORIGINAL creator (Q1) instead of
-- whoever pressed Undo. Honoured only when solar.schedule_owner_is_eligible()
-- (active member, not client_viewer / supplier); otherwise the caller, as for
-- every other create. A task created "done" closes only when the caller IS the
-- gatekeeper; with someone else's seat it waits for their sign-off (answered).
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
    v_gk      UUID;
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
        IF v_owner IS NULL THEN
            v_owner := projects.resolve_work_item_assignee(p_project_id, 'solar_task', NULL);
            IF v_owner IS NULL OR NOT solar.schedule_owner_is_eligible(p_project_id, v_owner) THEN
                v_owner := v_uid;
            END IF;
        END IF;
        v_gk := NULLIF(t->>'gatekeeper_id', '')::uuid;
        IF v_gk IS NULL OR NOT solar.schedule_owner_is_eligible(p_project_id, v_gk) THEN
            v_gk := v_uid;
        END IF;
        v_sort := v_sort + 1;

        INSERT INTO projects.work_items
            (organisation_id, project_id, item_type, origin, title, status, assignee_id, gatekeeper_id, due_date, created_by)
        VALUES (v_org, p_project_id, 'solar_task', 'manual', left(v_name, 300), 'open', v_owner, v_gk, v_end, v_uid)
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
            -- Only the gatekeeper closes (00196 §12 (d)); anyone else hands it for sign-off.
            UPDATE projects.work_items SET status = CASE WHEN v_gk = v_uid THEN 'closed' ELSE 'answered' END WHERE id = v_wi;
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
-- them with fitSegments). A new owner must be an active member (22023 here)
-- and Solar-eligible (SOL01 from work_items_solar_owner_guard_trg).
-- Returns [{id, updated_at}].
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
-- filtered rows and collided). DEFINER since review I6 (clients hold no UPDATE
-- on schedule_tasks): the Edit gate is schedule_assert_editor, and only rows
-- of p_project_id move — an id from another project is ignored.
CREATE OR REPLACE FUNCTION solar.schedule_reorder(p_project_id UUID, p_ids UUID[])
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_n INTEGER;
BEGIN
    PERFORM solar.schedule_assert_editor(p_project_id);
    PERFORM pg_advisory_xact_lock(hashtextextended('solar.schedule:' || p_project_id::text, 0));
    WITH o AS (SELECT u.id, u.ord FROM unnest(p_ids) WITH ORDINALITY AS u(id, ord))
    UPDATE solar.schedule_tasks t SET sort_order = o.ord::int
      FROM o WHERE t.id = o.id AND t.project_id = p_project_id AND t.sort_order <> o.ord::int;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END $$;

-- Save the current programme as a baseline. INVOKER: RLS decides (Edit to
-- insert). Voided items are excluded (belt and braces: 5d already removed
-- their side rows).
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
     WHERE t.project_id = p_project_id AND wi.status <> 'void';
    RETURN v_id;
END $$;

-- Owner picker: Solar-eligible members of the project (Q4: active, effective
-- role neither client_viewer nor supplier — the same rule the write path
-- enforces), visible to anyone who can view the schedule; empty for everyone else.
-- email only for an EDITOR (review M12): a View user may be external, and
-- only the editor paths (owner picker in the dialog, import matching) use it.
CREATE OR REPLACE FUNCTION solar.schedule_owner_candidates(p_project_id UUID)
RETURNS TABLE (user_id UUID, full_name TEXT, email TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT p.id, p.full_name, CASE WHEN public.solar_can_edit(p_project_id) THEN p.email END
      FROM public.profiles p
     WHERE public.solar_can_view(p_project_id)
       AND p.id IN (
             SELECT pm.user_id FROM projects.project_members pm WHERE pm.project_id = p_project_id AND pm.is_active
             UNION
             SELECT uo.user_id FROM public.user_organisations uo
               JOIN projects.projects pr ON pr.organisation_id = uo.organisation_id
              WHERE pr.id = p_project_id AND uo.is_active AND uo.role IN ('owner', 'admin', 'project_manager'))
       AND solar.schedule_owner_is_eligible(p_project_id, p.id)
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
