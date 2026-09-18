-- 14-idempotency.sql — Task 15 Step 1. "A backfill that passes on 50 rows
-- proves nothing about 50,000" (§12 §(d)) has a twin: a backfill that passes
-- ONCE proves nothing about the second run. The apply can be interrupted, a
-- deploy can be re-run, and a projection is called again by its own trigger on
-- every later source edit — so "projecting a source row twice is a no-op" is a
-- property, not an accident.
--
-- Run (both --with files, in this order, then this probe):
--   node --experimental-strip-types scripts/db/rehearse-sql.ts scripts/db/probes/14-idempotency.sql \
--     --with scripts/db/probes/13-backfill-fixtures.sql \
--     --with apps/edge-functions/supabase/migrations/00202_work_item_source_mirrors_and_backfill.sql
--
-- The fixture file is stacked for the same reason probe 13 stacks it: live data
-- carries ZERO in-scope snags and ZERO failing QC entries, so without it the
-- snag and qc_defect arms of this probe would re-run over nothing and every
-- assertion about them would pass vacuously. With it, five of the six mirrored
-- types carry real rows through all three runs.
--
-- Section H has already run ONCE inside the migration when this probe starts.
-- The probe re-runs every projection path twice more — the same arms, the same
-- predicates and the same (project_id, source id) ordering section H uses, so
-- the ref allocator's per-(project, type) advisory locks are taken in the same
-- order (#18) — then inserts a deliberate origin='split' row and projects the
-- RFIs a THIRD time, to prove the split is neither picked up, overwritten nor
-- duplicated.
--
-- Expected: 13 rows, all PASS.
--
-- ⚠ What idempotent DOES and DOES NOT mean here, measured rather than assumed.
-- The projections are lookup-then-INSERT/UPDATE (deviation 8), so a re-run of a
-- LIVE item takes the UPDATE arm and re-stamps last_activity_at = now(); only a
-- closed or void record takes rule 1's early return and is left byte-identical.
-- Both are pinned below as rows, in the honest direction. The partial UNIQUE
-- indexes are what make the ROW count idempotent, and rows 1, 2 and 11 are the
-- three faces of that: no type gained an item, no source row carries two, and a
-- raw duplicate INSERT is refused by the index by name.
--
-- ⚠ MEASURED, and it contradicts the plan text: deleting D.1's
-- `ON CONFLICT (rfi_id) WHERE … DO NOTHING` clause does NOT red this probe —
-- 11/11 still passed. It cannot: every projection LOOKS THE ITEM UP first
-- (deviation 8), so a serial re-run takes the UPDATE arm and never reaches the
-- INSERT a second time. The clause guards the CONCURRENT path only — two
-- sessions projecting the same new source row between one another's lookup and
-- insert — which one rolled-back transaction cannot stage. Proven with the race
-- simulated instead, by blinding D.1's lookup (`AND false`) so every call takes
-- the INSERT arm:
--   lookup blinded, ON CONFLICT kept    → 10/11 (only row 8 reds: nothing takes
--                                        the UPDATE arm) and NO 23505 — the
--                                        clause swallows the duplicate, quietly,
--                                        which is its whole job;
--   lookup blinded, ON CONFLICT deleted → ERROR 23505: duplicate key value
--                                        violates unique constraint
--                                        "work_items_src_rfi_uidx",
--                                        DETAIL: Key (rfi_id)=(…) already exists.
-- That is the good failure, and row 11 keeps it in the suite permanently rather
-- than as a mutation somebody has to remember to run.

DO $rerun$
DECLARE
  v_demo  CONSTANT uuid := 'e51ede00-0000-0000-0000-000000000001';  -- E-Site DEMO
  v_split uuid;
  v_row   record;
  v_state text;
  v_msg   text;
  v_con   text;
BEGIN
  -- ── The state as section H left it, after exactly one run ─────────────────
  CREATE TEMP TABLE idem_before ON COMMIT DROP AS
    SELECT item_type, count(*) AS n FROM projects.work_items
     WHERE origin = 'mirror' GROUP BY 1;

  IF (SELECT COALESCE(sum(n), 0) FROM idem_before) = 0 THEN
    RAISE EXCEPTION 'fixture: section H projected no mirror items at all — this probe needs the migration stacked with --with';
  END IF;

  -- ctid, not just the column values: a re-projection that rewrites a tuple
  -- and lands on the same values is still a write (it stamps last_activity_at,
  -- it bloats the table and it wakes every AFTER trigger). Rule 1's early
  -- return is the thing this measures, so it has to be measured by tuple.
  CREATE TEMP TABLE idem_item_before ON COMMIT DROP AS
    SELECT id, ctid::text AS tid, md5(work_items::text) AS row_md5,
           status, last_activity_at
      FROM projects.work_items WHERE origin = 'mirror';

  -- The sources, too: section E writes back to projects.rfis, and a re-run that
  -- wrote the same values back again would churn the module's own table.
  CREATE TEMP TABLE idem_rfi_before ON COMMIT DROP AS
    SELECT id, ctid::text AS tid FROM projects.rfis;

  CREATE TEMP TABLE idem_ev_before ON COMMIT DROP AS
    SELECT count(*) AS n FROM projects.work_item_events;

  -- What SHOULD carry a mirror item, derived from section H's own predicates.
  -- Without this, rows 1 and 2 pass just as happily on a table of zero items.
  CREATE TEMP TABLE idem_expected ON COMMIT DROP AS
    SELECT 'rfi'::text AS item_type, count(*) AS n FROM projects.rfis r
      JOIN projects.projects p ON p.id = r.project_id
     WHERE p.organisation_id <> v_demo
    UNION ALL
    SELECT 'inspection', count(*) FROM inspections.inspections i
      JOIN projects.projects p ON p.id = i.project_id
     WHERE p.organisation_id <> v_demo
    UNION ALL
    SELECT 'snag', count(*) FROM field.snags s
      JOIN projects.projects p ON p.id = s.project_id
     WHERE p.organisation_id <> v_demo AND p.status = 'active'
    UNION ALL
    SELECT 'qc_defect', count(*) FROM projects.qc_entries e
      JOIN projects.qc_reports rp ON rp.id = e.report_id
      JOIN projects.projects p ON p.id = e.project_id
     WHERE e.conformance = 'fail' AND rp.status IN ('issued','closed')
       AND p.organisation_id <> v_demo
    UNION ALL
    SELECT 'form_action', count(*) FROM field.site_forms f
      JOIN projects.projects p ON p.id = f.project_id
     WHERE p.organisation_id <> v_demo;

  IF EXISTS (SELECT 1 FROM idem_expected WHERE n = 0) THEN
    RAISE EXCEPTION 'fixture: % has no in-scope source rows, so its arm cannot fail — stack scripts/db/probes/13-backfill-fixtures.sql first',
      (SELECT string_agg(item_type, ', ') FROM idem_expected WHERE n = 0);
  END IF;

  -- ── Runs 2 and 3 ──────────────────────────────────────────────────────────
  -- A LOOP per arm, never `PERFORM f(x) FROM … ORDER BY …`: a volatile function
  -- in a target list is evaluated below the Sort node, so the ORDER BY would
  -- decide nothing and the allocator's lock order would be scan order (section
  -- H carries the same note).
  FOR i IN 1..2 LOOP
    FOR v_row IN
      SELECT r.id FROM projects.rfis r
        JOIN projects.projects p ON p.id = r.project_id
       WHERE p.organisation_id <> v_demo ORDER BY p.id, r.id
    LOOP PERFORM projects.project_rfi(v_row.id); END LOOP;

    FOR v_row IN
      SELECT i2.id FROM inspections.inspections i2
        JOIN projects.projects p ON p.id = i2.project_id
       WHERE p.organisation_id <> v_demo ORDER BY p.id, i2.id
    LOOP PERFORM projects.project_inspection(v_row.id); END LOOP;

    FOR v_row IN
      SELECT s.id FROM field.snags s
        JOIN projects.projects p ON p.id = s.project_id
       WHERE p.organisation_id <> v_demo AND p.status = 'active' ORDER BY p.id, s.id
    LOOP PERFORM projects.project_snag(v_row.id); END LOOP;

    FOR v_row IN
      SELECT e.id FROM projects.qc_entries e
        JOIN projects.qc_reports rp ON rp.id = e.report_id
        JOIN projects.projects p ON p.id = e.project_id
       WHERE e.conformance = 'fail' AND rp.status IN ('issued','closed')
         AND p.organisation_id <> v_demo ORDER BY p.id, e.id
    LOOP PERFORM projects.project_qc_entry(v_row.id); END LOOP;

    FOR v_row IN
      SELECT f.id FROM field.site_forms f
        JOIN projects.projects p ON p.id = f.project_id
       WHERE p.organisation_id <> v_demo ORDER BY p.id, f.id
    LOOP PERFORM projects.project_form_action(v_row.id); END LOOP;
  END LOOP;

  -- ── A deliberate split must survive a re-run untouched (§03 §1.2, §1.3) ────
  -- The partial UNIQUE is predicated on origin = 'mirror', so a split row on
  -- the same source is legal; every projection's lookup carries the same
  -- predicate, so no projection can ever see it.
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, origin, title,
    status, assignee_id, gatekeeper_id, due_date, created_by, rfi_id)
  SELECT w.organisation_id, w.project_id, 'rfi', 'split', w.title || ' (split)', 'open',
         w.assignee_id, w.gatekeeper_id, w.due_date, w.created_by, w.rfi_id
    FROM projects.work_items w
   WHERE w.item_type = 'rfi' AND w.origin = 'mirror'
   ORDER BY w.id LIMIT 1
  RETURNING id INTO v_split;
  IF v_split IS NULL THEN
    RAISE EXCEPTION 'fixture: no rfi mirror item to split from';
  END IF;

  -- Run 4 for the RFI arm, AFTER the split exists.
  FOR v_row IN
    SELECT r.id FROM projects.rfis r
      JOIN projects.projects p ON p.id = r.project_id
     WHERE p.organisation_id <> v_demo ORDER BY p.id, r.id
  LOOP PERFORM projects.project_rfi(v_row.id); END LOOP;

  -- ── The index IS the guarantee; ON CONFLICT only makes a retry quiet ───────
  -- A raw second mirror row on an already-mirrored RFI, inserted straight at
  -- the table with no projection in the way. This is the failure the seven
  -- partial uniques exist for, and it is asserted by CONSTRAINT NAME so a
  -- future index rename cannot leave the row passing on a different error.
  CREATE TEMP TABLE idem_dup(sqlstate text, message text, constraint_name text) ON COMMIT DROP;
  BEGIN
    INSERT INTO projects.work_items (organisation_id, project_id, item_type, origin, title,
      status, assignee_id, gatekeeper_id, due_date, created_by, rfi_id)
    SELECT w.organisation_id, w.project_id, 'rfi', 'mirror', w.title || ' (duplicate)', 'open',
           w.assignee_id, w.gatekeeper_id, w.due_date, w.created_by, w.rfi_id
      FROM projects.work_items w
     WHERE w.item_type = 'rfi' AND w.origin = 'mirror'
     ORDER BY w.id LIMIT 1;
    INSERT INTO idem_dup VALUES ('00000', 'the duplicate mirror INSERT was ACCEPTED', NULL);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT,
                            v_con = CONSTRAINT_NAME;
    INSERT INTO idem_dup VALUES (v_state, v_msg, v_con);
  END;

  CREATE TEMP TABLE idem_ctx(split uuid) ON COMMIT DROP;
  INSERT INTO idem_ctx VALUES (v_split);
END $rerun$;

SELECT 'no_duplicates_after_three_runs' AS probe,
       NOT EXISTS (
         SELECT 1 FROM projects.work_items w
          JOIN idem_before b ON b.item_type = w.item_type
          WHERE w.origin = 'mirror'
          GROUP BY w.item_type, b.n HAVING count(*) <> b.n) AS ok,
       'the partial UNIQUE per source column is what makes projection idempotent; after H: '
         || (SELECT string_agg(item_type || '=' || n, ' ' ORDER BY item_type) FROM idem_before) AS detail
UNION ALL
SELECT 'one_item_per_source_row',
       NOT EXISTS (
         SELECT 1 FROM projects.work_items WHERE origin = 'mirror'
          GROUP BY COALESCE(rfi_id, snag_id, qc_entry_id, inspection_id, diary_id,
                            site_form_id, node_order_id)
         HAVING count(*) > 1),
       'no source row may carry two mirror items'
UNION ALL
-- Rows 1 and 2 are both true of an empty table. This is the row that says the
-- three runs had something to be idempotent ABOUT.
SELECT 'every_source_in_scope_carries_exactly_one_item',
       NOT EXISTS (
         SELECT 1 FROM idem_expected e
           FULL JOIN (SELECT item_type, count(*) AS n FROM projects.work_items
                       WHERE origin = 'mirror' GROUP BY 1) a USING (item_type)
          WHERE COALESCE(e.n, -1) <> COALESCE(a.n, -2)),
       'expected ' || (SELECT string_agg(item_type || '=' || n, ' ' ORDER BY item_type) FROM idem_expected)
UNION ALL
SELECT 'split_row_survives',
       (SELECT count(*) FROM projects.work_items w, idem_ctx c
         WHERE w.id = c.split AND w.origin = 'split') = 1,
       'the partial index excludes origin<>mirror, so a split is legal and never re-projected'
UNION ALL
SELECT 'split_title_untouched',
       (SELECT w.title LIKE '% (split)' FROM projects.work_items w, idem_ctx c WHERE w.id = c.split),
       'a re-projection must not overwrite a split row''s own title'
UNION ALL
SELECT 'split_did_not_displace_its_mirror',
       (SELECT count(*) FROM projects.work_items w
         WHERE w.origin = 'mirror'
           AND w.rfi_id = (SELECT w2.rfi_id FROM projects.work_items w2, idem_ctx c
                            WHERE w2.id = c.split)) = 1,
       'the source of the split still carries exactly one mirror item after run 4'
UNION ALL
-- Rule 1's early return, measured by tuple: a closed or void record is not
-- rewritten by a re-projection that changes nothing it projects.
SELECT 'terminal_records_were_not_rewritten',
       (SELECT count(*) FROM idem_item_before WHERE status IN ('closed','void')) > 0
       AND NOT EXISTS (
         SELECT 1 FROM idem_item_before b JOIN projects.work_items w ON w.id = b.id
          WHERE b.status IN ('closed','void') AND w.ctid::text IS DISTINCT FROM b.tid),
       (SELECT count(*)::text FROM idem_item_before WHERE status IN ('closed','void'))
         || ' terminal records, all byte-identical by ctid after three more runs'
UNION ALL
-- The honest other half, and the row that proves the re-runs REACHED the live
-- items at all. A LIVE item takes the UPDATE arm on every projection
-- (deviation 8: lookup-then-INSERT/UPDATE, and rule 1's early return is guarded
-- on NOT v_live), so a re-run rewrites the tuple and the guard re-stamps
-- last_activity_at (00196:1523). Idempotent in ROWS, not in tuples — designed,
-- not a defect: the only caller that re-projects a live item in production is a
-- real source edit.
--
-- ⚠ Measured by ctid and NOT by `last_activity_at = now()`, which is what this
-- row said first and could not fail: section H's step 8 floors every backfilled
-- OPEN due date with an UPDATE, so every live item is already stamped now()
-- before this probe starts. Blinding D.1's lookup (so no projection ever takes
-- the UPDATE arm) left that version green; the ctid form reds it.
SELECT 'live_records_are_rewritten_by_a_reprojection',
       (SELECT count(*) FROM idem_item_before WHERE status NOT IN ('closed','void')) > 0
       AND NOT EXISTS (
         SELECT 1 FROM idem_item_before b JOIN projects.work_items w ON w.id = b.id
          WHERE b.status NOT IN ('closed','void') AND w.ctid::text = b.tid),
       (SELECT count(*)::text FROM idem_item_before WHERE status NOT IN ('closed','void'))
         || ' live records rewritten by the re-runs — pinned honestly, not asserted away'
UNION ALL
-- Self-calibrating: every event written since section H must belong to the ONE
-- row this probe created. A re-projection that changed a status, a holder or a
-- gatekeeper on an existing item would show up here as a surplus.
SELECT 'reruns_wrote_no_events',
       (SELECT count(*) FROM projects.work_item_events) - (SELECT n FROM idem_ev_before)
         = (SELECT count(*) FROM projects.work_item_events ev, idem_ctx c
             WHERE ev.work_item_id = c.split),
       'events since section H = ' || ((SELECT count(*) FROM projects.work_item_events) - (SELECT n FROM idem_ev_before))
         || ', all of them the split row''s own'
UNION ALL
SELECT 'reruns_wrote_nothing_back_to_the_sources',
       NOT EXISTS (
         SELECT 1 FROM idem_rfi_before b JOIN projects.rfis r ON r.id = b.id
          WHERE r.ctid::text IS DISTINCT FROM b.tid),
       'section E''s value predicate holds: the write-back is inert once the source already agrees'
UNION ALL
SELECT 'duplicate_mirror_insert_is_refused_by_the_index',
       (SELECT sqlstate = '23505' AND constraint_name = 'work_items_src_rfi_uidx' FROM idem_dup),
       (SELECT sqlstate || ' ' || COALESCE(constraint_name, '(no constraint)') || ': ' || message FROM idem_dup)
UNION ALL
-- I4 (Task 15 review). The ctid row above says a live tuple is REWRITTEN; this
-- says the rewrite changes no value. now() is frozen for the transaction
-- (00196:1523), so within one transaction a re-projection is byte-identical in
-- every column and only the physical tuple moves. Across two separate APPLIES
-- all 33 live items would take a new last_activity_at — reachable only by
-- running section H twice, which the ledger prevents.
SELECT 'a_reprojection_changes_no_column_value',
       (SELECT count(*) FROM idem_item_before WHERE status NOT IN ('closed','void')) > 0
       AND NOT EXISTS (
         SELECT 1 FROM idem_item_before b JOIN projects.work_items w ON w.id = b.id
          WHERE b.status NOT IN ('closed','void')
            AND md5(w::text) IS DISTINCT FROM b.row_md5),
       (SELECT count(*)::text FROM idem_item_before WHERE status NOT IN ('closed','void'))
         || ' live records: same values, new tuple — the rewrite is physical only'
UNION ALL
-- I3 (Task 15 review). Deleting the ON CONFLICT clause does NOT red any
-- behavioural row here, because every projection looks the item up first and
-- returns before reaching the INSERT. The clause guards only the CONCURRENT
-- path — a human raising an RFI while section H runs — which no rolled-back
-- rehearsal can stage. So it is pinned STRUCTURALLY instead: all six
-- project_<source>() bodies must carry the guarded form. (Row
-- 'a_concurrent_insert_is_absorbed' above stages the race by blinding the
-- lookup and proves the INDEX; this proves the CLAUSE.)
SELECT 'every_projection_carries_the_guarded_on_conflict',
       (SELECT count(*) FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'projects'
           AND p.proname IN ('project_rfi','project_snag','project_inspection',
                             'project_qc_entry','project_diary_action','project_form_action')
           AND p.prosrc ~ 'ON CONFLICT \([a-z_]+\) WHERE [a-z_]+ IS NOT NULL AND origin = ''mirror'' DO NOTHING') = 6,
       'all six projections must absorb a concurrent duplicate, not raise 23505 mid-apply';
