-- ---------------------------------------------------------------------------
-- Migration 00262: Programme — record an MS Project import with a revision
-- baseline (P4a).
-- ---------------------------------------------------------------------------
-- ⚠ NUMBER: claimed at APPLY time, not now. Immediately before applying,
-- re-check THREE places: the ledger max(version), origin/main's migration
-- filenames, and the migration filenames in every OPEN PR. If 00262 is taken,
-- renumber this file above the head (and after 00261, which it needs).
-- Claiming a number is not holding it: the head moves when someone APPLIES.
--
-- Spec: docs/superpowers/specs/2026-11-16-project-programme-design.md §4.7
-- (each contractor revision is kept as an imports row plus an automatic
-- baseline). Plan: docs/superpowers/plans/2026-11-18-programme-p4a-mspdi-import.md
-- Task 3.
--
-- WHAT
--   1. programme.snapshot_baseline (internal, granted to nobody): the snapshot
--      body save_baseline had inline (live activities, the links between them,
--      budgeted cost summed into the masked baseline_costs). It neither locks
--      nor gates nor audits: its callers do.
--   2. programme.save_baseline is re-created to call it. Its behaviour is
--      unchanged: same lock, gate, sentences, source 'manual' and audit row
--      (assert-programme-roles.sql section 4 re-proves it).
--   3. programme.record_import(programme, file name, revision label, diff,
--      mapping) → { import_id, baseline_id }. Editor only (can_edit), under the
--      programme advisory lock. It snapshots an ACTIVE baseline with source
--      'import' named from the revision label (else "Import <file> <date>"),
--      inserts the imports row (format 'mspdi') pointing at it, and writes one
--      'import.recorded' audit row of ids and counts.
--
-- WHY THE DIFF IS CHECKED HERE. imports.diff and imports.mapping are readable
-- by every programme reader, contractors included; the cost mask covers the
-- four cost tables only (docs/programme/runbook.md). So the diff may carry
-- only the ImportDiff shape of packages/shared/src/programme/exchange/
-- mspdi-plan.ts: activity uids, names, changed-field names, counts, a boolean
-- and the data-date pair. Any other key, at any level, or a count that is not
-- a number, is refused with 22023; the mapping may only map text to text.
--
-- 00261's @verify counts are untouched: its definer-function count lists the
-- nine functions by name, and this file adds no table and no policy.
-- NO BEGIN/COMMIT in this file: scripts/db/dry-run-migration.sh wraps it in
-- BEGIN … ROLLBACK, and a COMMIT here would make that dry run permanent.
-- ---------------------------------------------------------------------------

-- @verify:begin
-- function: programme.snapshot_baseline(uuid, text, boolean, text)
-- function: programme.record_import(uuid, text, text, jsonb, jsonb)
-- function: programme.save_baseline(uuid, text, boolean)
-- grant_present: authenticated EXECUTE ON programme.save_baseline(uuid, text, boolean)
-- grant_present: authenticated EXECUTE ON programme.record_import(uuid, text, text, jsonb, jsonb)
-- grant_absent: authenticated EXECUTE ON programme.snapshot_baseline(uuid, text, boolean, text)
-- anon_execute_absent: ALL prosecdef functions in programme
-- sql: (SELECT count(*) = 2 AND bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'programme' AND p.proname IN ('snapshot_baseline', 'record_import'))
-- sql: (SELECT p.prosrc LIKE '%snapshot_baseline%' AND p.prosrc LIKE '%''manual''%' FROM pg_proc p WHERE p.oid = 'programme.save_baseline(uuid, text, boolean)'::regprocedure)
-- sql: (SELECT p.prosrc LIKE '%pg_advisory_xact_lock%' AND p.prosrc LIKE '%can_edit%' AND p.prosrc LIKE '%''import.recorded''%' AND p.prosrc LIKE '%''22023''%' FROM pg_proc p WHERE p.oid = 'programme.record_import(uuid, text, text, jsonb, jsonb)'::regprocedure)
-- sql: (SELECT NOT has_function_privilege('authenticated', 'programme.snapshot_baseline(uuid, text, boolean, text)', 'EXECUTE') AND NOT has_function_privilege('anon', 'programme.record_import(uuid, text, text, jsonb, jsonb)', 'EXECUTE'))
-- behaviour: scripts/db/assert-programme-roles.sql — every row ok (section 10 is record_import)
-- @verify:end

-- 1. The snapshot. Internal: callable only by its owner (the definer
-- functions below run as that owner). Returns the new baseline id and counts.
CREATE OR REPLACE FUNCTION programme.snapshot_baseline(p_programme_id uuid, p_name text, p_active boolean, p_source text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
DECLARE v_id uuid; v_n_act int; v_n_dep int; v_n_cost int;
BEGIN
    IF coalesce(p_active, false) THEN
        UPDATE programme.baselines SET is_active = false WHERE programme_id = p_programme_id AND is_active;
    END IF;
    INSERT INTO programme.baselines (programme_id, name, is_active, source)
        VALUES (p_programme_id, btrim(p_name), coalesce(p_active, false), p_source) RETURNING id INTO v_id;

    INSERT INTO programme.baseline_activities (baseline_id, programme_id, activity_id, name, type, parent_id, wbs_code, code,
        original_duration, remaining_duration, early_start, early_finish, late_start, late_finish, total_float, free_float,
        percent_complete, sort_order)
    SELECT v_id, p_programme_id, a.id, a.name, a.type, a.parent_id, a.wbs_code, a.code, a.original_duration, a.remaining_duration,
           a.early_start, a.early_finish, a.late_start, a.late_finish, a.total_float, a.free_float, a.percent_complete, a.sort_order
      FROM programme.activities a WHERE a.programme_id = p_programme_id AND NOT a.is_tombstoned;
    GET DIAGNOSTICS v_n_act = ROW_COUNT;

    INSERT INTO programme.baseline_dependencies (baseline_id, programme_id, pred_id, succ_id, type, lag, lag_unit, lag_calendar)
    SELECT v_id, p_programme_id, d.pred_id, d.succ_id, d.type, d.lag, d.lag_unit, d.lag_calendar
      FROM programme.dependencies d
      JOIN programme.activities p ON p.id = d.pred_id AND NOT p.is_tombstoned
      JOIN programme.activities s ON s.id = d.succ_id AND NOT s.is_tombstoned
     WHERE d.programme_id = p_programme_id;
    GET DIAGNOSTICS v_n_dep = ROW_COUNT;

    INSERT INTO programme.baseline_costs (baseline_id, activity_id, programme_id, budgeted_cost)
    SELECT v_id, ra.activity_id, p_programme_id, sum(ac.budgeted_cost)
      FROM programme.resource_assignments ra
      JOIN programme.assignment_costs ac ON ac.assignment_id = ra.id
      JOIN programme.activities a ON a.id = ra.activity_id AND NOT a.is_tombstoned
     WHERE ra.programme_id = p_programme_id
     GROUP BY ra.activity_id;
    GET DIAGNOSTICS v_n_cost = ROW_COUNT;

    RETURN jsonb_build_object('baseline_id', v_id, 'activities', v_n_act, 'dependencies', v_n_dep, 'cost_rows', v_n_cost);
END $$;

-- 2. save_baseline, now through the shared snapshot. Same lock, gate,
-- sentences and audit as 00261.
CREATE OR REPLACE FUNCTION programme.save_baseline(p_programme_id uuid, p_name text, p_set_active boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
DECLARE v_snap jsonb;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('programme:' || p_programme_id::text, 0));
    IF NOT coalesce(programme.can_edit(p_programme_id), false) THEN
        RAISE EXCEPTION 'You do not have permission to edit this programme.' USING ERRCODE = '42501';
    END IF;
    IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 120 THEN
        RAISE EXCEPTION 'Give the baseline a name of up to 120 characters.' USING ERRCODE = '22023';
    END IF;
    v_snap := programme.snapshot_baseline(p_programme_id, p_name, coalesce(p_set_active, false), 'manual');
    PERFORM programme.write_audit(p_programme_id, 'baseline.saved', jsonb_build_object(
        'baseline_id', v_snap->'baseline_id', 'active', coalesce(p_set_active, false),
        'activities', v_snap->'activities', 'dependencies', v_snap->'dependencies', 'cost_rows', v_snap->'cost_rows'));
    RETURN (v_snap->>'baseline_id')::uuid;
END $$;

-- 3. record_import.
CREATE OR REPLACE FUNCTION programme.record_import(
    p_programme_id uuid, p_file_name text, p_revision_label text, p_diff jsonb, p_mapping jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
DECLARE
    v_file text := btrim(coalesce(p_file_name, ''));
    v_label text := nullif(btrim(coalesce(p_revision_label, '')), '');
    v_name text;
    v_snap jsonb;
    v_import uuid;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('programme:' || p_programme_id::text, 0));
    IF NOT coalesce(programme.can_edit(p_programme_id), false) THEN
        RAISE EXCEPTION 'You do not have permission to edit this programme.' USING ERRCODE = '42501';
    END IF;
    IF char_length(v_file) NOT BETWEEN 1 AND 255 THEN
        RAISE EXCEPTION 'Name the imported file (up to 255 characters).' USING ERRCODE = '22023';
    END IF;
    IF v_label IS NOT NULL AND char_length(v_label) > 120 THEN
        RAISE EXCEPTION 'Give the revision label up to 120 characters.' USING ERRCODE = '22023';
    END IF;

    -- The diff: the ImportDiff shape only (see the header). CASE guards every
    -- jsonb_array_elements / jsonb_each, because SQL does not promise to
    -- evaluate AND/OR left to right.
    IF p_diff IS NULL OR jsonb_typeof(p_diff) <> 'object'
       OR EXISTS (
            SELECT 1 FROM jsonb_each(p_diff) e
             WHERE e.key NOT IN ('added', 'changed', 'removed', 'linksAdded', 'linksRemoved', 'linksChanged',
                                 'calendarChanged', 'dataDate', 'unchanged')
                OR (e.key IN ('linksAdded', 'linksRemoved', 'linksChanged', 'unchanged') AND jsonb_typeof(e.value) <> 'number')
                OR (e.key = 'calendarChanged' AND jsonb_typeof(e.value) <> 'boolean')
                OR (e.key IN ('added', 'changed', 'removed') AND jsonb_typeof(e.value) <> 'array')
                OR (e.key = 'dataDate' AND jsonb_typeof(e.value) NOT IN ('null', 'object')))
       OR EXISTS (
            SELECT 1 FROM jsonb_each(p_diff) e
              CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e.value) = 'array' THEN e.value ELSE '[]'::jsonb END) it
             WHERE e.key IN ('added', 'changed', 'removed')
               AND (jsonb_typeof(it) <> 'object'
                    OR EXISTS (
                        SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(it) = 'object' THEN it ELSE '{}'::jsonb END) f
                         WHERE NOT (
                            (f.key IN ('uid', 'name') AND jsonb_typeof(f.value) = 'string')
                            OR (f.key = 'fields' AND e.key = 'changed' AND jsonb_typeof(f.value) = 'array'
                                AND NOT EXISTS (
                                    SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(f.value) = 'array' THEN f.value ELSE '[]'::jsonb END) x
                                     WHERE jsonb_typeof(x) <> 'string'))))))
       OR EXISTS (
            SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(p_diff->'dataDate') = 'object' THEN p_diff->'dataDate' ELSE '{}'::jsonb END) f
             WHERE f.key NOT IN ('from', 'to') OR jsonb_typeof(f.value) NOT IN ('string', 'null'))
    THEN
        RAISE EXCEPTION 'The import summary may hold only counts, activity ids and names.' USING ERRCODE = '22023';
    END IF;

    IF p_mapping IS NOT NULL AND (jsonb_typeof(p_mapping) <> 'object' OR EXISTS (
            SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(p_mapping) = 'object' THEN p_mapping ELSE '{}'::jsonb END) m
             WHERE jsonb_typeof(m.value) <> 'string')) THEN
        RAISE EXCEPTION 'The import mapping may only map names to names.' USING ERRCODE = '22023';
    END IF;

    v_name := coalesce(v_label,
        left('Import ' || v_file, 109) || ' ' || to_char((now() AT TIME ZONE 'Africa/Johannesburg')::date, 'YYYY-MM-DD'));
    v_snap := programme.snapshot_baseline(p_programme_id, v_name, true, 'import');

    INSERT INTO programme.imports (programme_id, format, file_name, mapping, diff, revision_label, baseline_id)
        VALUES (p_programme_id, 'mspdi', v_file, p_mapping, p_diff, v_label, (v_snap->>'baseline_id')::uuid)
        RETURNING id INTO v_import;

    PERFORM programme.write_audit(p_programme_id, 'import.recorded', jsonb_build_object(
        'import_id', v_import, 'baseline_id', v_snap->'baseline_id', 'format', 'mspdi',
        'added', jsonb_array_length(coalesce(p_diff->'added', '[]'::jsonb)),
        'changed', jsonb_array_length(coalesce(p_diff->'changed', '[]'::jsonb)),
        'removed', jsonb_array_length(coalesce(p_diff->'removed', '[]'::jsonb)),
        'activities', v_snap->'activities', 'dependencies', v_snap->'dependencies', 'cost_rows', v_snap->'cost_rows'));

    RETURN jsonb_build_object('import_id', v_import, 'baseline_id', (v_snap->>'baseline_id')::uuid);
END $$;

-- Grants. PUBLIC holds EXECUTE by default and Supabase's default privileges
-- grant anon directly, so both are named. The snapshot goes to nobody.
REVOKE ALL ON FUNCTION programme.snapshot_baseline(uuid, text, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION programme.record_import(uuid, text, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION programme.record_import(uuid, text, text, jsonb, jsonb) TO authenticated;
