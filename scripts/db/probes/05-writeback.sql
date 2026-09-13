-- 05-writeback.sql — Task 6: the assignment + due-date write-back (00198
-- section E). Asserted against production inside one rolled-back transaction:
--   projects.work_item_assignment_writeback()        — SECURITY DEFINER, NO depth guard (F2)
--   work_items_assignment_writeback_ins / _upd        — AFTER INSERT / AFTER UPDATE OF … WHEN (F7)
--
-- Run (00198 is not applied, so it is stacked):
--   node --experimental-strip-types scripts/db/rehearse-sql.ts scripts/db/probes/05-writeback.sql \
--     --with apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql
-- Before section E existed this reported 10/21: the mirror (section D) resolved a
-- holder and projected every RFI, but nothing reached rfis.assigned_to /
-- rfis.due_date or field.snags.assigned_to, and the round trip REVERTED a spine
-- reassignment on the next unrelated source edit (the explicit source assignee
-- won, because nothing had kept rfis.assigned_to in step).
--
-- Three rules (Task 6), each with a row that fails when it is undone:
--   F2  — no pg_trigger_depth() guard on the write-back (holder_reaches_source,
--         source_matches_item, triage_holder_is_written_back,
--         due_date_reaches_source_on_insert go red with one — every
--         source-originated write, since the write-back then runs at depth 2);
--         and the WRAPPER's guard is what terminates the cycle
--         (depth_guard_stops_reprojection_of_spine_writes);
--   i11 — due_date is written back too (redate_flows_to_source,
--         due_date_reaches_source_on_insert);
--   i9  — closed / void items and closed / signed_off sources are skipped, and
--         each predicate has its own row: closed_record_untouched (both),
--         reopened_item_on_closed_source_untouched (the SOURCE-status rule
--         alone), closed_item_does_not_write_to_open_source (the ITEM-status
--         rule alone), snag_signed_off_source_untouched.
-- Plus the controller's additions: the ROUND TRIP (spine reassign → source
-- updated → unrelated source edit → spine assignee unchanged), triage write-back
-- + its inertness on re-projection, a spine re-date reaching the source while a
-- later SOURCE re-date does not move the spine, the snag arm (assignment only —
-- the snag MIRROR is Task 7's, so the item is inserted directly as postgres
-- with snag_id set; the write-back fires on that INSERT exactly as it will on
-- the mirror's), and a write-amplification measurement
-- (value_predicate_stops_write_amplification) read from
-- pg_stat_xact_user_tables, which counts tuple updates so far in THIS
-- transaction.
--
-- Walks from an empty project, never from seeded data (§12 §(h)). Every
-- fixture RAISEs rather than skips. Every mutation is inside the DO block.
--
-- ⚠ Runs as postgres with auth.uid() NULL (F9): every spine-side UPDATE here
-- takes item 2's guard's SERVICE path, so nothing in this file is evidence
-- about a person's authority — probe 05b is. What this file measures is the
-- data flow between the two tables, which is the same on both paths.
--
-- ⚠ The five RFI inserts consume five values of projects.rfis_rfi_number_seq,
-- which a rollback does not return.
--
-- Contract: exactly ONE row-producing statement, last in the file. No
-- impersonation.
--
-- Expected: 21 rows. If the printed `assertions seen:` list is shorter than
-- twenty-one names, a UNION ALL arm was dropped — read the list, not the total.
DO $probe$
DECLARE
  v_org   uuid := 'dddddddd-0000-0000-0000-000000000001';  -- WM-Consulting
  v_pm    uuid;   -- the org owner: creates the project, so ensure_project_settings_row makes them the triage owner
  v_other uuid;   -- an active org admin: eligible on any org project with no project_members row (00107)
  v_third uuid;   -- a second active org admin: the spine reassign target, distinct from every chain answer
  v_proj  uuid;
  v_triage_owner uuid;
  -- (a)/(b)/(c): the task's three rules
  v_rfi uuid; v_closed uuid;
  v_a1 uuid; v_d1 date; v_a2 uuid; v_d2 date;
  v_ins_status text; v_ins_assignee uuid; v_ins_due date;
  v_unrel_status text; v_unrel_assignee uuid;
  v_untriage_assignee uuid; v_untriage_source uuid;
  v_upd_before bigint; v_upd_after bigint;
  v_after_src_redate_due date;
  v_closed_assignee uuid; v_closed_due date; v_closed_updated_at timestamptz;
  v_hist timestamptz := now() - interval '20 days';
  -- the round trip
  v_rt uuid;
  v_rt_born_status text;
  v_rt_source_after_reassign uuid; v_rt_item_after_reassign uuid; v_rt_item_after_edit uuid;
  -- the reopen shape: an OPEN item on a CLOSED source
  v_reopen uuid; v_reopen_item uuid; v_reopen_source_assignee uuid; v_reopen_item_status text;
  -- the spine-closed shape: a CLOSED item on a still-OPEN source
  v_sc uuid; v_sc_item uuid; v_sc_due_before date; v_sc_due_after date; v_sc_item_status text;
  -- the wrapper's depth guard, observed as work_items tuple updates per spine statement
  v_wi_upd_before bigint; v_wi_upd_after bigint;
  -- the snag arm
  v_snag uuid; v_snag_item uuid; v_snag_a1 uuid; v_snag_a2 uuid;
  v_snag_so uuid; v_snag_so_item uuid; v_snag_so_a_insert uuid; v_snag_so_a_reassign uuid;
BEGIN
  SELECT u.user_id INTO v_pm FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_pm IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active owner in user_organisations (1 on 2026-09-13)';
  END IF;

  -- Admins, not contractors: an org-level contractor has NO effective role on a
  -- project they are not a member of (00107), so item 2's membership trigger
  -- would refuse the spine reassign for a fixture reason. Owner/admin always win.
  SELECT u.user_id INTO v_other FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'admin' AND u.is_active AND u.user_id <> v_pm
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_other IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active admin in user_organisations (7 on 2026-09-13)';
  END IF;
  SELECT u.user_id INTO v_third FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'admin' AND u.is_active
     AND u.user_id NOT IN (v_pm, v_other)
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_third IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no second active admin (7 on 2026-09-13)';
  END IF;

  INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
  VALUES (v_org, '_probe_writeback', 'active', 'ZAR', v_pm)
  RETURNING id INTO v_proj;   -- ensure_project_settings_row() fires here

  IF NOT projects.work_item_person_eligible(v_proj, v_other)
     OR NOT projects.work_item_person_eligible(v_proj, v_third) THEN
    RAISE EXCEPTION 'fixture: an admin (% / %) is not eligible on the probe project', v_other, v_third;
  END IF;
  -- The chain's answer for an RFI raised with no assignee on a fresh settings
  -- row: no explicit, no default_rfi_assignee_id, no per-type default, so the
  -- project triage owner — seeded as created_by, the owner. Read back, not
  -- assumed, so triage_holder_is_written_back measures the write-back and not
  -- the seeding.
  SELECT s.triage_owner_id INTO v_triage_owner
    FROM projects.project_settings s WHERE s.project_id = v_proj;
  IF v_triage_owner IS NULL OR NOT projects.work_item_person_eligible(v_proj, v_triage_owner) THEN
    RAISE EXCEPTION 'fixture: ensure_project_settings_row seeded no eligible triage_owner_id (got %)', v_triage_owner;
  END IF;
  IF v_triage_owner IN (v_other, v_third) THEN
    RAISE EXCEPTION 'fixture: the triage owner (%) coincides with a reassign target', v_triage_owner;
  END IF;

  -- ── (a) raised with NO assignee: the resolved holder must reach rfis.assigned_to
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                             priority, status, raised_by)
  VALUES (v_proj, v_org, 'Probe writeback', 'body', 'medium', 'open', v_pm)
  RETURNING id INTO v_rfi;

  SELECT r.assigned_to, r.due_date INTO v_a1, v_d1 FROM projects.rfis r WHERE r.id = v_rfi;
  SELECT w.status, w.assignee_id, w.due_date INTO v_ins_status, v_ins_assignee, v_ins_due
    FROM projects.work_items w WHERE w.rfi_id = v_rfi AND w.origin = 'mirror';

  -- Inertness: the write-back's value now sits in rfis.assigned_to. An
  -- unrelated source edit re-projects; the item must stay in triage on the same
  -- holder (D.1's un-triage flag is "eligible AND distinct from what the item
  -- holds", and the source now names exactly what the item holds).
  UPDATE projects.rfis SET priority = 'high' WHERE id = v_rfi;
  SELECT w.status, w.assignee_id INTO v_unrel_status, v_unrel_assignee
    FROM projects.work_items w WHERE w.rfi_id = v_rfi AND w.origin = 'mirror';

  -- Write amplification, measured. A source-side assign to an eligible,
  -- different person un-triages the item (probe 04) and CHANGES its assignee,
  -- so the write-back's _upd trigger fires — and finds the source already
  -- naming that person. The value predicate must write nothing: exactly ONE
  -- tuple update on projects.rfis for this statement (the client's own).
  -- Without the predicate the write-back rewrites the row with its own values
  -- (2 updates) and rfis_updated_at bumps updated_at for nothing.
  SELECT COALESCE(x.n_tup_upd, 0) INTO v_upd_before
    FROM pg_stat_xact_user_tables x WHERE x.schemaname = 'projects' AND x.relname = 'rfis';
  UPDATE projects.rfis SET assigned_to = v_other WHERE id = v_rfi;
  SELECT COALESCE(x.n_tup_upd, 0) INTO v_upd_after
    FROM pg_stat_xact_user_tables x WHERE x.schemaname = 'projects' AND x.relname = 'rfis';
  SELECT w.assignee_id INTO v_untriage_assignee
    FROM projects.work_items w WHERE w.rfi_id = v_rfi AND w.origin = 'mirror';
  SELECT r.assigned_to INTO v_untriage_source FROM projects.rfis r WHERE r.id = v_rfi;

  -- ── (b) reassign + re-date on the spine ⇒ both reach the source.
  -- Measured on projects.work_items as well: ONE tuple update for this
  -- statement. The write-back's UPDATE on rfis fires rfis_mirror_work_item_upd
  -- (assigned_to moved), whose wrapper runs at depth 2 and must return before
  -- project_rfi() — otherwise the spine's own write is re-projected back over
  -- itself (a second work_items update, last_activity_at re-stamped, §11
  -- re-entered). That extra hop is the wrapper's depth guard's only observable
  -- while the values converge, so it is what pins the guard (Step 7, G0 alone).
  SELECT COALESCE(x.n_tup_upd, 0) INTO v_wi_upd_before
    FROM pg_stat_xact_user_tables x WHERE x.schemaname = 'projects' AND x.relname = 'work_items';
  UPDATE projects.work_items
     SET assignee_id = v_third, due_date = CURRENT_DATE + 21
   WHERE rfi_id = v_rfi AND origin = 'mirror';
  SELECT COALESCE(x.n_tup_upd, 0) INTO v_wi_upd_after
    FROM pg_stat_xact_user_tables x WHERE x.schemaname = 'projects' AND x.relname = 'work_items';

  SELECT r.assigned_to, r.due_date INTO v_a2, v_d2 FROM projects.rfis r WHERE r.id = v_rfi;

  -- A later SOURCE re-date: due_date is not in the _upd trigger's lists (Task 5
  -- review F1), so this fires no projection and the spine's date stays. The
  -- source now disagrees with the spine — improvement 11 is spine → source
  -- only, by design; the RFI page's own re-date control is item 4's to point
  -- at the spine.
  UPDATE projects.rfis SET due_date = CURRENT_DATE + 40 WHERE id = v_rfi;
  SELECT w.due_date INTO v_after_src_redate_due
    FROM projects.work_items w WHERE w.rfi_id = v_rfi AND w.origin = 'mirror';

  -- ── (c) a CLOSED record must not acquire an assignee it never had. Inserted
  -- with a historical updated_at so that ANY write — even a same-value one —
  -- is visible as a bump to now().
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                             priority, status, raised_by, closed_at, closed_by,
                             created_at, updated_at)
  VALUES (v_proj, v_org, 'Probe closed', 'body', 'medium', 'closed', v_pm, v_hist, v_pm,
          v_hist - interval '10 days', v_hist)
  RETURNING id INTO v_closed;

  SELECT r.assigned_to, r.due_date, r.updated_at
    INTO v_closed_assignee, v_closed_due, v_closed_updated_at
    FROM projects.rfis r WHERE r.id = v_closed;

  -- ── The ROUND TRIP (Task 5 review, pA case 2). Raised WITH an explicit,
  -- eligible assignee (the owner), so D.1's UPDATE arm will keep preferring the
  -- source's name over the spine's holder. A spine reassign must reach the
  -- source, so that the next unrelated source edit re-projects the SAME person
  -- and the reassignment survives. Without the write-back it reverts.
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                             priority, status, raised_by, assigned_to)
  VALUES (v_proj, v_org, 'Probe round trip', 'body', 'medium', 'open', v_pm, v_pm)
  RETURNING id INTO v_rt;
  SELECT w.status INTO v_rt_born_status
    FROM projects.work_items w WHERE w.rfi_id = v_rt AND w.origin = 'mirror';
  IF v_rt_born_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'fixture: the round-trip RFI was born % (expected open — an explicit eligible assignee)', v_rt_born_status;
  END IF;

  UPDATE projects.work_items SET assignee_id = v_other
   WHERE rfi_id = v_rt AND origin = 'mirror';
  SELECT r.assigned_to INTO v_rt_source_after_reassign FROM projects.rfis r WHERE r.id = v_rt;
  SELECT w.assignee_id INTO v_rt_item_after_reassign
    FROM projects.work_items w WHERE w.rfi_id = v_rt AND w.origin = 'mirror';

  UPDATE projects.rfis SET priority = 'low' WHERE id = v_rt;   -- unrelated, but watched: re-projects
  SELECT w.assignee_id INTO v_rt_item_after_edit
    FROM projects.work_items w WHERE w.rfi_id = v_rt AND w.origin = 'mirror';

  -- ── The REOPEN shape: an OPEN item on a CLOSED source. A closed RFI's mirror
  -- is born closed; the spine reopens it (closed → open is legal, §12 (c)) while
  -- the source stays closed; then a spine reassign fires the write-back with an
  -- open item — and the SOURCE-status predicate is the only thing between that
  -- reassign and an assignee stamped on a closed RFI.
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                             priority, status, raised_by, closed_at, closed_by)
  VALUES (v_proj, v_org, 'Probe reopen', 'body', 'medium', 'closed', v_pm, now(), v_pm)
  RETURNING id INTO v_reopen;
  SELECT w.id INTO v_reopen_item
    FROM projects.work_items w WHERE w.rfi_id = v_reopen AND w.origin = 'mirror';
  IF v_reopen_item IS NULL THEN
    RAISE EXCEPTION 'fixture: the closed RFI projected no mirror item (section D)';
  END IF;
  UPDATE projects.work_items SET status = 'open' WHERE id = v_reopen_item;
  UPDATE projects.work_items SET assignee_id = v_other WHERE id = v_reopen_item;
  SELECT w.status INTO v_reopen_item_status FROM projects.work_items w WHERE w.id = v_reopen_item;
  SELECT r.assigned_to INTO v_reopen_source_assignee FROM projects.rfis r WHERE r.id = v_reopen;

  -- ── The SPINE-CLOSED shape: a CLOSED item on a still-OPEN source. Nothing in
  -- Q1 writes status back to a source, so an item the gatekeeper closes on the
  -- spine sits closed over an RFI that is still 'open' at the source until
  -- someone closes it there. §12 (a4) lets the project team re-date a closed
  -- item, and the source-status predicate admits the open source — so the
  -- ITEM-status rule (`NEW.status IN ('closed','void') → RETURN`) is the only
  -- thing between that re-date and a new deadline on a record that is finished.
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                             priority, status, raised_by)
  VALUES (v_proj, v_org, 'Probe spine-closed', 'body', 'medium', 'open', v_pm)
  RETURNING id INTO v_sc;
  SELECT w.id INTO v_sc_item
    FROM projects.work_items w WHERE w.rfi_id = v_sc AND w.origin = 'mirror';
  IF v_sc_item IS NULL THEN
    RAISE EXCEPTION 'fixture: the open RFI projected no mirror item (section D)';
  END IF;
  SELECT r.due_date INTO v_sc_due_before FROM projects.rfis r WHERE r.id = v_sc;
  UPDATE projects.work_items SET status = 'closed' WHERE id = v_sc_item;   -- service path: §12 stamps closed_at
  UPDATE projects.work_items SET due_date = CURRENT_DATE + 30 WHERE id = v_sc_item;
  SELECT w.status INTO v_sc_item_status FROM projects.work_items w WHERE w.id = v_sc_item;
  SELECT r.due_date INTO v_sc_due_after FROM projects.rfis r WHERE r.id = v_sc;

  -- ── The SNAG arm. field.snags has no due_date column (00004:10-32), so
  -- assignment only. The snag mirror is Task 7's; until it exists the only way
  -- to put a mirrored snag item on the spine is to insert it directly, which
  -- fires §5/§6/§7/§11 and this write-back exactly as the mirror's INSERT will.
  INSERT INTO field.snags (project_id, organisation_id, title, raised_by)
  VALUES (v_proj, v_org, 'Probe snag', v_pm)
  RETURNING id INTO v_snag;
  INSERT INTO projects.work_items (
    organisation_id, project_id, item_type, origin, title, priority,
    status, source_status, assignee_id, gatekeeper_id, created_by, snag_id)
  VALUES (v_org, v_proj, 'snag', 'mirror', 'Probe snag', 'medium',
          'open', 'open', v_pm, v_pm, v_pm, v_snag)
  RETURNING id INTO v_snag_item;
  SELECT s.assigned_to INTO v_snag_a1 FROM field.snags s WHERE s.id = v_snag;

  UPDATE projects.work_items SET assignee_id = v_other WHERE id = v_snag_item;
  SELECT s.assigned_to INTO v_snag_a2 FROM field.snags s WHERE s.id = v_snag;

  -- A signed-off snag: skipped on the closed item's INSERT (item-status rule),
  -- and — in the reopen shape — skipped by the source-status rule alone.
  INSERT INTO field.snags (project_id, organisation_id, title, raised_by,
                           status, signed_off_by, signed_off_at)
  VALUES (v_proj, v_org, 'Probe signed-off snag', v_pm, 'signed_off', v_pm, now())
  RETURNING id INTO v_snag_so;
  INSERT INTO projects.work_items (
    organisation_id, project_id, item_type, origin, title, priority,
    status, source_status, assignee_id, gatekeeper_id, created_by, snag_id,
    closed_at, closed_by)
  VALUES (v_org, v_proj, 'snag', 'mirror', 'Probe signed-off snag', 'medium',
          'closed', 'signed_off', v_pm, v_pm, v_pm, v_snag_so, now(), v_pm)
  RETURNING id INTO v_snag_so_item;
  SELECT s.assigned_to INTO v_snag_so_a_insert FROM field.snags s WHERE s.id = v_snag_so;
  UPDATE projects.work_items SET status = 'open' WHERE id = v_snag_so_item;
  UPDATE projects.work_items SET assignee_id = v_other WHERE id = v_snag_so_item;
  SELECT s.assigned_to INTO v_snag_so_a_reassign FROM field.snags s WHERE s.id = v_snag_so;

  CREATE TEMP TABLE wb_ctx(
    rfi uuid, closed uuid, rt uuid, reopen uuid, snag uuid, snag_so uuid,
    pm uuid, other uuid, third uuid, triage_owner uuid,
    a1 uuid, d1 date, a2 uuid, d2 date,
    ins_status text, ins_assignee uuid, ins_due date,
    unrel_status text, unrel_assignee uuid,
    untriage_assignee uuid, untriage_source uuid, upd_delta bigint,
    after_src_redate_due date,
    ca uuid, cd date, closed_updated_at timestamptz, hist timestamptz,
    rt_source_after_reassign uuid, rt_item_after_reassign uuid, rt_item_after_edit uuid,
    reopen_item_status text, reopen_source_assignee uuid,
    sc_item_status text, sc_due_before date, sc_due_after date,
    wi_upd_delta bigint,
    snag_a1 uuid, snag_a2 uuid, snag_so_a_insert uuid, snag_so_a_reassign uuid)
    ON COMMIT DROP;
  INSERT INTO wb_ctx VALUES (
    v_rfi, v_closed, v_rt, v_reopen, v_snag, v_snag_so,
    v_pm, v_other, v_third, v_triage_owner,
    v_a1, v_d1, v_a2, v_d2,
    v_ins_status, v_ins_assignee, v_ins_due,
    v_unrel_status, v_unrel_assignee,
    v_untriage_assignee, v_untriage_source, v_upd_after - v_upd_before,
    v_after_src_redate_due,
    v_closed_assignee, v_closed_due, v_closed_updated_at, v_hist,
    v_rt_source_after_reassign, v_rt_item_after_reassign, v_rt_item_after_edit,
    v_reopen_item_status, v_reopen_source_assignee,
    v_sc_item_status, v_sc_due_before, v_sc_due_after,
    v_wi_upd_after - v_wi_upd_before,
    v_snag_a1, v_snag_a2, v_snag_so_a_insert, v_snag_so_a_reassign);
END $probe$;

SELECT 'holder_reaches_source' AS probe,
       (SELECT c.a1 IS NOT NULL FROM wb_ctx c) AS ok,
       'F2: with a depth guard on the write-back this stays NULL and the RFI page renders nothing' AS detail
UNION ALL
SELECT 'source_matches_item',
       (SELECT c.a1 = c.ins_assignee FROM wb_ctx c),
       'rfis.assigned_to and work_items.assignee_id agree'
UNION ALL
SELECT 'reassign_flows_to_source',
       (SELECT c.a2 = c.third FROM wb_ctx c),
       'a work-item reassign writes projects.rfis.assigned_to'
UNION ALL
-- Improvement 11.
SELECT 'redate_flows_to_source',
       (SELECT c.d2 = CURRENT_DATE + 21 FROM wb_ctx c),
       'a work-item re-date writes projects.rfis.due_date, or the RFI page and the Inbox disagree'
UNION ALL
-- Improvement 9. The historical updated_at is asserted too: a same-value write
-- would be invisible in assigned_to/due_date but bumps updated_at to now().
SELECT 'closed_record_untouched',
       (SELECT c.ca IS NULL AND c.cd IS NULL AND c.closed_updated_at = c.hist FROM wb_ctx c),
       '6 of 15 live RFIs are closed; inventing an assignee on a historical record is the as_left_status lesson'
UNION ALL
SELECT 'closed_item_still_exists',
       (SELECT count(*) FROM projects.work_items w, wb_ctx c WHERE w.rfi_id = c.closed) = 1,
       'the item is still projected — only the write-back is skipped'
UNION ALL
SELECT 'no_runaway_recursion', true,
       'reaching this row at all proves the mirror ⇄ write-back cycle terminated'
UNION ALL
-- The plan's rule (a) for a TRIAGE item (controller decision, 2026-09-13).
SELECT 'triage_holder_is_written_back',
       (SELECT c.ins_status = 'triage' AND c.a1 = c.triage_owner FROM wb_ctx c),
       'an RFI raised with no assignee is born triage on the triage owner, and THAT person reaches rfis.assigned_to — the RFI page renders the resolved holder for the first time'
UNION ALL
SELECT 'writeback_value_is_inert_on_reprojection',
       (SELECT c.unrel_status = 'triage' AND c.unrel_assignee = c.ins_assignee FROM wb_ctx c),
       'after the write-back the source names exactly what the item holds, so an unrelated source edit (priority) re-projects without un-triaging the item (D.1''s flag: eligible AND distinct)'
UNION ALL
-- Improvement 11 on the insert path: the source had no due date; the spine
-- computed A(b)''s +7 wd; the source now shows the same date.
SELECT 'due_date_reaches_source_on_insert',
       (SELECT c.d1 IS NOT NULL AND c.d1 = c.ins_due FROM wb_ctx c),
       'the spine''s computed due date is written to rfis.due_date on projection — one answer to "when is this due"'
UNION ALL
SELECT 'source_redate_does_not_move_the_spine',
       (SELECT c.after_src_redate_due = CURRENT_DATE + 21 FROM wb_ctx c),
       'a later rfis.due_date edit fires no projection (D.1 does not watch it): the spine keeps the re-date it was given — improvement 11 is spine → source only'
UNION ALL
-- The round trip (Task 5 review pA case 2).
SELECT 'round_trip_source_updated',
       (SELECT c.rt_source_after_reassign = c.other AND c.rt_item_after_reassign = c.other FROM wb_ctx c),
       'an RFI raised WITH an explicit assignee: a spine reassign reaches rfis.assigned_to'
UNION ALL
SELECT 'round_trip_spine_assignee_unchanged_by_unrelated_edit',
       (SELECT c.rt_item_after_edit = c.other FROM wb_ctx c),
       'the next unrelated source edit re-projects the person the write-back put on the source — without the write-back the explicit source assignee REVERTS the spine reassignment'
UNION ALL
SELECT 'value_predicate_stops_write_amplification',
       (SELECT c.untriage_assignee = c.other AND c.untriage_source = c.other AND c.upd_delta = 1 FROM wb_ctx c),
       'a source-side assign un-triages the item and CHANGES its assignee, so the write-back fires — and must write nothing back to a source that already agrees: exactly 1 tuple update on projects.rfis (pg_stat_xact_user_tables), not 2'
UNION ALL
-- Improvement 9, the source-status rule on its own.
SELECT 'reopened_item_on_closed_source_untouched',
       (SELECT c.reopen_item_status = 'open' AND c.reopen_source_assignee IS NULL FROM wb_ctx c),
       'a closed RFI''s item reopened on the spine, then reassigned: the item is open, so only `status NOT IN (''closed'')` on projects.rfis stops the write — the closed RFI keeps no assignee'
UNION ALL
-- Improvement 9, the item-status rule on its own.
SELECT 'closed_item_does_not_write_to_open_source',
       (SELECT c.sc_item_status = 'closed' AND c.sc_due_before IS NOT NULL
           AND c.sc_due_after = c.sc_due_before FROM wb_ctx c),
       'an item closed on the spine over a still-open RFI, then re-dated: the source is open, so only `NEW.status IN (''closed'',''void'') → RETURN` stops the write — the RFI keeps the date it had'
UNION ALL
-- F2''s other half: the WRAPPER''s depth guard, observed.
SELECT 'depth_guard_stops_reprojection_of_spine_writes',
       (SELECT c.wi_upd_delta = 1 FROM wb_ctx c),
       'a spine reassign + re-date is exactly 1 tuple update on projects.work_items (pg_stat_xact_user_tables): the write-back reaches rfis, rfis_mirror_work_item_upd fires, and the wrapper returns at depth 2 instead of re-projecting the spine''s own write back over itself'
UNION ALL
-- The snag arm (assignment only).
SELECT 'snag_assignment_reaches_source',
       (SELECT c.snag_a1 = c.pm FROM wb_ctx c),
       'a mirrored snag item''s assignee reaches field.snags.assigned_to on INSERT'
UNION ALL
SELECT 'snag_reassign_flows_to_source',
       (SELECT c.snag_a2 = c.other FROM wb_ctx c),
       'a spine reassign of a snag item writes field.snags.assigned_to'
UNION ALL
SELECT 'snag_signed_off_source_untouched',
       (SELECT c.snag_so_a_insert IS NULL AND c.snag_so_a_reassign IS NULL FROM wb_ctx c),
       'improvement 9 for snags: skipped on the closed item''s INSERT, and — reopened on the spine, then reassigned — skipped by `status NOT IN (''signed_off'',''closed'')` on field.snags alone'
UNION ALL
SELECT 'snag_has_no_due_date_column',
       NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'field' AND table_name = 'snags' AND column_name = 'due_date'),
       'the snag arm writes assignment only because field.snags has no due_date (00004:10-32); if this row ever fails, the arm must start writing it';
