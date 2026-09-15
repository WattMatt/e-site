-- 11-delete-to-void.sql — Task 12: the six delete-to-void triggers (00199
-- section F, F1). Asserted against production inside one rolled-back
-- transaction:
--   projects.void_work_item_on_source_delete()  — one BEFORE DELETE function, keyed on TG_ARGV[0]
--   rfis_void_work_item / snags_void_work_item / inspections_void_work_item /
--   qc_entries_void_work_item / site_diary_entries_void_work_item /
--   site_forms_void_work_item                  — BEFORE DELETE, one per source
--
-- Run (00199 is not applied, so it is stacked):
--   node --experimental-strip-types scripts/db/rehearse-sql.ts scripts/db/probes/11-delete-to-void.sql \
--     --with apps/edge-functions/supabase/migrations/00199_work_item_source_mirrors_and_backfill.sql
--
-- ⚠ Before section F existed this did not report FAIL rows — it ABORTED: the
-- first DELETE died with `23514: new row for relation "work_items" violates
-- check constraint "work_items_source_required"` and the harness returned
-- exit 5 with no assertion rows at all (Task 12 Step 2). That error IS the
-- finding: A(a)'s CHECK is re-evaluated on the ON DELETE SET NULL update while
-- the item is still open with zero sources, so deleting an RFI, a snag or a
-- diary entry stops working the moment a mirror item exists. The AFTER DELETE
-- form the spec prescribed (§03 §1.2) produces exactly the same abort (Step 5,
-- measured against the real table — the earlier synthetic-table probe that
-- reported a silent orphan is withdrawn), which is why the harness's zero-rows
-- guard (Task 1 Step 7) matters: an aborted statement returns no rows, and a
-- harness that treated "no rows" as "nothing failed" would have called it green.
--
-- Every source gets a row here, not three: rfi, snag, inspection, site form,
-- diary AND a qc entry through a REPORT delete (qc_entries.report_id is ON
-- DELETE CASCADE, 00172:112, so the entry-level BEFORE DELETE fires once per
-- cascaded row, at depth 2). Fixtures RAISE; every row asserts on an item that
-- was captured LIVE before the delete, so a source with no item cannot pass a
-- row vacuously.
--
-- Two deletes run under IMPERSONATION (probe 05b's pattern; the rest run as
-- postgres, the service path): rbac-test — a contractor, the only sanctioned
-- fixture — deletes two diary entries they authored, through "Authors can
-- delete their diary entries" (00149:30-36: author + org member + not a
-- client viewer). Person-satisfiable DELETE policies exist on four sources:
-- that one, qc_reports_delete / qc_entries_delete (00176:122-128 / 183-192,
-- owner/admin/PM by effective project role; the entry path is frozen on a
-- CLOSED report) and site_forms_delete (00179:483-485, drafts,
-- owner/admin/PM); rfis/snags carry no permissive DELETE policy (00161's
-- client-viewer RESTRICTIVE only) and inspections none — those are
-- service-role deletes in every path. (The Task 12 review measured the qc
-- path too: rbac-test as project_manager deleted a PASSED entry under
-- impersonation → item void / 'source deleted', one voided event with
-- actor_id = rbac-test, actor_role = 'project_manager', from_status =
-- 'closed'.) That pins two things the service path cannot:
--   (1) §11 writes the `voided` event with auth.uid() as the actor — the
--       DELETER — and the void UPDATE runs at pg_trigger_depth() = 2 (DELETE
--       → BEFORE trigger → work_items' BEFORE UPDATE guard), where section
--       C''s exemption applies: void_reason travels on the statement, the
--       guard's reason check is skipped, ball_in_court_id goes NULL by itself.
--   (2) One of the two items is CLOSED first (service path, as probe 09
--       closes a diary item). A closed item whose source is deleted is voided
--       too — FORCED, not chosen: work_items_source_required admits a
--       source-less mirror item only while status = 'void', so a closed item
--       left closed with its FK nulled fails the CHECK on the SET NULL and
--       the DELETE aborts. The machine forbids closed → void at depth 1 (C'
--       clause (c): closed reopens only to open), so under impersonation this
--       delete succeeds ONLY because the exemption holds at depth 2 — the
--       exemption is load-bearing here, not decorative. The exempt path
--       clears closed_at / closed_by on every non-close transition (probe 10
--       distributed_then_void_is_void), so the closed stamps do NOT survive
--       the void: pinned as closed_stamps_are_cleared_by_the_void. The
--       alternative — amending the CHECK to admit 'closed' — is an item-2
--       constraint change left for the owner (deviation 21).
-- An already-VOID item (a born-abandoned inspection) is left alone: it keeps
-- its own reason and gains no second `voided` event.
--
-- Contract (probe 00's header): every id is captured as postgres BEFORE the
-- first impersonation; the impersonating block ends with RESET ROLE + a
-- cleared claim (set_config(…, true) is TRANSACTION-local and outlives RESET
-- ROLE — hence claim_cleared at the end); exactly ONE row-producing statement,
-- last. A postgres temp table is unreadable after SET LOCAL ROLE (item 2,
-- measured), so the impersonated block reads a GRANTed one.
--
-- ⚠ The RFI insert consumes one value of projects.rfis_rfi_number_seq, which a
-- rollback does not return (probe 04's note).
--
-- Expected: 15 rows. If the printed `assertions seen:` list is shorter than
-- fifteen names, a UNION ALL arm was dropped — read the list, not the total.
DO $probe$
DECLARE
  v_org   uuid := 'dddddddd-0000-0000-0000-000000000001';  -- WM-Consulting
  v_ctr   uuid := '018f2d31-bbe8-4cc1-bbdd-63af0187081e';  -- rbac-test, contractor: authors + deletes the two diary entries
  v_pm    uuid;   -- the org owner: creates the project, raises every other source, closes the closed diary item
  v_proj  uuid;
  v_tpl_insp uuid;   -- an active inspections.templates row for the org (39 on 2026-09-13)
  v_tpl_form uuid;   -- an active field.form_templates row (1 of 2 on 2026-09-13)
  -- the sources, one live item each (two for the report)
  v_rfi   uuid;
  v_snag  uuid;
  v_insp  uuid;
  v_form  uuid;
  v_rep   uuid;   -- deleted as a REPORT: the entries go by cascade
  v_qc1   uuid;
  v_qc2   uuid;
  v_aband uuid;   -- born abandoned WITH a reason: an already-void item
  v_diary_live   uuid;   -- authored by rbac-test, live, deleted under impersonation
  v_diary_closed uuid;   -- authored by rbac-test, CLOSED on the spine, deleted under impersonation
  v_n     int;
  v_kinds int;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'fixture: auth.uid() is % before the first impersonation — the seed must run as postgres', auth.uid();
  END IF;

  SELECT u.user_id INTO v_pm FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_pm IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active owner in user_organisations (1 on 2026-09-13)';
  END IF;
  IF v_pm = v_ctr THEN
    RAISE EXCEPTION 'fixture: the owner IS rbac-test — the actor rows could not discriminate';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_organisations u
                  WHERE u.user_id = v_ctr AND u.organisation_id = v_org AND u.is_active) THEN
    RAISE EXCEPTION 'fixture: rbac-test (%) is not an active WM-Consulting member — the diary DELETE policy needs organisation_id = ANY(get_user_org_ids())', v_ctr;
  END IF;

  SELECT t.id INTO v_tpl_insp FROM inspections.templates t
   WHERE t.organisation_id = v_org AND t.is_active
   ORDER BY t.created_at, t.id LIMIT 1;
  IF v_tpl_insp IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active inspections.templates row (39 on 2026-09-13)';
  END IF;
  SELECT t.id INTO v_tpl_form FROM field.form_templates t
   WHERE t.is_active ORDER BY t.created_at, t.id LIMIT 1;
  IF v_tpl_form IS NULL THEN
    RAISE EXCEPTION 'fixture: field.form_templates has no active row (1 of 2 on 2026-09-13) — site_forms.template_row_id is NOT NULL';
  END IF;

  INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
  VALUES (v_org, '_probe_delete_to_void', 'active', 'ZAR', v_pm)
  RETURNING id INTO v_proj;   -- ensure_project_settings_row() fires here

  -- rbac-test needs a project_members row to be a person on this project
  -- (00107: an org-level contractor has no effective role on a project they
  -- are not a member of); it is what makes the diary item's author eligible
  -- and what stamps actor_role on the `voided` event. The DELETE policy itself
  -- reads org membership, not project membership.
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active)
  VALUES (v_proj, v_ctr, v_org, 'contractor', true);
  IF public.user_effective_project_role(v_proj, v_ctr) IS DISTINCT FROM 'contractor' THEN
    RAISE EXCEPTION 'fixture: rbac-test''s role is not effective on the probe project (got %)',
      public.user_effective_project_role(v_proj, v_ctr);
  END IF;

  -- ── the six sources, each projecting a LIVE item ──────────────────────────
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                             priority, status, raised_by)
  VALUES (v_proj, v_org, 'Doomed RFI', 'x', 'medium', 'open', v_pm) RETURNING id INTO v_rfi;

  INSERT INTO field.snags (project_id, organisation_id, title, location, priority, status, raised_by)
  VALUES (v_proj, v_org, 'Doomed snag', 'Unit 1 — DB-01', 'medium', 'open', v_pm) RETURNING id INTO v_snag;

  INSERT INTO inspections.inspections (organisation_id, project_id, template_id,
    target_node_type, target_label, assigned_to_id, verifier_id, status, created_by)
  VALUES (v_org, v_proj, v_tpl_insp, 'adhoc', 'Doomed board', v_pm, v_pm, 'assigned', v_pm)
  RETURNING id INTO v_insp;

  INSERT INTO field.site_forms (organisation_id, project_id, template_row_id, board_ref, board_label, status, created_by)
  VALUES (v_org, v_proj, v_tpl_form, 'DB-DOOMED', 'Doomed form board', 'draft', v_pm)
  RETURNING id INTO v_form;

  -- A report ISSUED with two failing entries: both project at issue (D.4's
  -- report-level entry point), and the report is what gets deleted.
  INSERT INTO projects.qc_reports (project_id, organisation_id, title, status, raised_by)
  VALUES (v_proj, v_org, 'Doomed handover QC', 'draft', v_pm) RETURNING id INTO v_rep;
  INSERT INTO projects.qc_entries (report_id, organisation_id, project_id, title, conformance, severity, created_by)
  VALUES (v_rep, v_org, v_proj, 'Earth continuity', 'fail', 'major', v_pm) RETURNING id INTO v_qc1;
  INSERT INTO projects.qc_entries (report_id, organisation_id, project_id, title, conformance, severity, created_by)
  VALUES (v_rep, v_org, v_proj, 'Label missing', 'fail', 'minor', v_pm) RETURNING id INTO v_qc2;
  UPDATE projects.qc_reports SET status = 'issued', issued_at = now(), issued_by = v_pm WHERE id = v_rep;

  -- An already-VOID item: born abandoned with the module's reason (probe 07
  -- abandoned_voids_with_reason). The delete must leave its reason alone.
  INSERT INTO inspections.inspections (organisation_id, project_id, template_id,
    target_node_type, target_label, assigned_to_id, verifier_id, status,
    abandoned_at, abandoned_by, abandoned_reason, created_by)
  VALUES (v_org, v_proj, v_tpl_insp, 'adhoc', 'Abandoned board', v_pm, v_pm, 'abandoned',
          now() - interval '2 days', v_pm, 'Probe: site closed for the season', v_pm)
  RETURNING id INTO v_aband;

  -- The two diary entries rbac-test authored (the DELETE policy's created_by =
  -- auth.uid()). Real delays, so both project (improvement 1's stop-list).
  INSERT INTO projects.site_diary_entries (project_id, organisation_id, entry_date, progress_notes, delays, created_by)
  VALUES (v_proj, v_org, CURRENT_DATE, 'Crane', 'Crane stood down 4h awaiting sparks', v_ctr)
  RETURNING id INTO v_diary_live;
  INSERT INTO projects.site_diary_entries (project_id, organisation_id, entry_date, progress_notes, delays, created_by)
  VALUES (v_proj, v_org, CURRENT_DATE - 1, 'DB-02', 'Sparks no-show, DB-02 not wired', v_ctr)
  RETURNING id INTO v_diary_closed;
  -- Closed on the service path (as postgres, auth.uid() NULL — the shape
  -- section H's backfill and item 2's service client write; probe 09 does the
  -- same). closed_by supplied; C' keeps it and stamps closed_at = now().
  UPDATE projects.work_items SET status = 'closed', closed_by = v_pm
   WHERE diary_id = v_diary_closed AND origin = 'mirror';

  -- ── capture every item LIVE, before any delete ────────────────────────────
  -- pre_voided_n is the `voided` event count before the delete: 0 for every
  -- item here — a born-void item's only event is `created` (§11 writes
  -- `voided` on a transition, not on a void INSERT; measured, Task 12 Step 2).
  CREATE TEMP TABLE del_ctx(
    kind text, src uuid, item uuid,
    pre_status text, pre_reason text, pre_closed_at timestamptz, pre_closed_by uuid,
    pre_voided_n int) ON COMMIT DROP;
  INSERT INTO del_ctx
  SELECT k.kind, k.src, w.id, w.status, w.void_reason, w.closed_at, w.closed_by,
         (SELECT count(*) FROM projects.work_item_events e WHERE e.work_item_id = w.id AND e.verb = 'voided')
    FROM (VALUES ('rfi', v_rfi), ('snag', v_snag), ('inspection', v_insp), ('form', v_form),
                 ('qc', v_qc1), ('qc', v_qc2), ('void_inspection', v_aband),
                 ('diary_live', v_diary_live), ('diary_closed', v_diary_closed)) AS k(kind, src)
    JOIN projects.work_items w
      ON w.origin = 'mirror'
     AND w.id = CASE k.kind
                  WHEN 'rfi'             THEN (SELECT x.id FROM projects.work_items x WHERE x.rfi_id        = k.src AND x.origin = 'mirror')
                  WHEN 'snag'            THEN (SELECT x.id FROM projects.work_items x WHERE x.snag_id       = k.src AND x.origin = 'mirror')
                  WHEN 'inspection'      THEN (SELECT x.id FROM projects.work_items x WHERE x.inspection_id = k.src AND x.origin = 'mirror')
                  WHEN 'void_inspection' THEN (SELECT x.id FROM projects.work_items x WHERE x.inspection_id = k.src AND x.origin = 'mirror')
                  WHEN 'form'            THEN (SELECT x.id FROM projects.work_items x WHERE x.site_form_id  = k.src AND x.origin = 'mirror')
                  WHEN 'qc'              THEN (SELECT x.id FROM projects.work_items x WHERE x.qc_entry_id   = k.src AND x.origin = 'mirror')
                  ELSE                        (SELECT x.id FROM projects.work_items x WHERE x.diary_id      = k.src AND x.origin = 'mirror')
                END;

  -- The fixture must have produced every item, in the state each row assumes,
  -- or the rows below pass on nothing.
  SELECT count(*), count(DISTINCT kind) INTO v_n, v_kinds FROM del_ctx;
  IF v_n <> 9 OR v_kinds <> 8 THEN
    RAISE EXCEPTION 'fixture: expected 9 mirror items across 8 kinds before the deletes, found % across % (kinds: %)',
      v_n, v_kinds, (SELECT string_agg(kind, ',' ORDER BY kind) FROM del_ctx);
  END IF;
  IF EXISTS (SELECT 1 FROM del_ctx d WHERE d.kind IN ('rfi','snag','inspection','form','qc','diary_live')
                                       AND d.pre_status NOT IN ('triage','open')) THEN
    RAISE EXCEPTION 'fixture: a source that should project a LIVE item did not (%)',
      (SELECT string_agg(d.kind || '=' || d.pre_status, ',') FROM del_ctx d WHERE d.pre_status NOT IN ('triage','open'));
  END IF;
  IF (SELECT d.pre_status FROM del_ctx d WHERE d.kind = 'void_inspection') IS DISTINCT FROM 'void'
     OR (SELECT d.pre_reason FROM del_ctx d WHERE d.kind = 'void_inspection') IS DISTINCT FROM 'Probe: site closed for the season' THEN
    RAISE EXCEPTION 'fixture: the born-abandoned inspection did not project a void item carrying its reason';
  END IF;
  IF (SELECT d.pre_status FROM del_ctx d WHERE d.kind = 'diary_closed') IS DISTINCT FROM 'closed'
     OR (SELECT d.pre_closed_at FROM del_ctx d WHERE d.kind = 'diary_closed') IS NULL
     OR (SELECT d.pre_closed_by FROM del_ctx d WHERE d.kind = 'diary_closed') IS DISTINCT FROM v_pm THEN
    RAISE EXCEPTION 'fixture: the closed diary item is not closed with both stamps before its delete';
  END IF;

  -- ── the service-path deletes (postgres, auth.uid() NULL) ──────────────────
  -- ⚠ Before section F existed the FIRST of these aborted the whole probe with
  -- 23514 work_items_source_required — the finding. ROW_COUNT is read after
  -- each so a trigger that RETURNs NULL (silently suppressing the delete) is a
  -- fixture abort, never a quietly-passing row.
  DELETE FROM projects.rfis WHERE id = v_rfi;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'fixture: the RFI delete touched % rows', v_n; END IF;
  DELETE FROM field.snags WHERE id = v_snag;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'fixture: the snag delete touched % rows', v_n; END IF;
  DELETE FROM inspections.inspections WHERE id = v_insp;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'fixture: the inspection delete touched % rows', v_n; END IF;
  DELETE FROM field.site_forms WHERE id = v_form;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'fixture: the site-form delete touched % rows', v_n; END IF;
  -- The REPORT, not the entries: qc_entries.report_id ON DELETE CASCADE.
  DELETE FROM projects.qc_reports WHERE id = v_rep;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'fixture: the report delete touched % rows', v_n; END IF;
  DELETE FROM inspections.inspections WHERE id = v_aband;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'fixture: the abandoned-inspection delete touched % rows', v_n; END IF;

  -- What the impersonated block needs, on a table it can read.
  CREATE TEMP TABLE imp_ctx(
    ctr uuid, diary_live uuid, diary_closed uuid,
    n_live int, n_closed int, who text, uid uuid) ON COMMIT DROP;
  INSERT INTO imp_ctx (ctr, diary_live, diary_closed) VALUES (v_ctr, v_diary_live, v_diary_closed);
  GRANT SELECT, UPDATE ON imp_ctx TO authenticated;
END $probe$;

-- ── rbac-test deletes the two diary entries they authored ───────────────────
DO $imp$
DECLARE
  c   record;
  v_n int;
BEGIN
  SELECT * INTO c FROM imp_ctx;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', c.ctr::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF auth.uid() IS DISTINCT FROM c.ctr THEN
    RAISE EXCEPTION 'fixture: impersonation did not take — auth.uid() is %, expected rbac-test', auth.uid();
  END IF;

  -- RLS turns a refused DELETE into a silent zero-row, so ROW_COUNT is the
  -- evidence that the author policy admitted it.
  DELETE FROM projects.site_diary_entries WHERE id = c.diary_live;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'fixture: the impersonated delete of the LIVE diary entry touched % rows — the author DELETE policy (00149:30-36) did not admit rbac-test', v_n;
  END IF;
  UPDATE imp_ctx SET n_live = v_n;

  -- The CLOSED item: closed → void is illegal on the machine at depth 1, so
  -- this DELETE succeeds only because the void UPDATE runs at depth 2, exempt.
  DELETE FROM projects.site_diary_entries WHERE id = c.diary_closed;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'fixture: the impersonated delete of the CLOSED diary entry touched % rows', v_n;
  END IF;
  UPDATE imp_ctx SET n_closed = v_n, who = current_user, uid = auth.uid();

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'fixture: the claim survived its clear (auth.uid() = %)', auth.uid();
  END IF;
END $imp$;

SELECT 'nine_items_existed' AS probe,
       (SELECT count(*) FROM del_ctx) = 9
         AND (SELECT count(*) FROM del_ctx d WHERE d.pre_status IN ('triage','open')) = 7
         AND (SELECT count(*) FROM del_ctx d WHERE d.pre_status = 'closed') = 1
         AND (SELECT count(*) FROM del_ctx d WHERE d.pre_status = 'void') = 1 AS ok,
       'the fixture must actually have produced items — seven live, one closed, one already void — or every row below passes vacuously' AS detail
UNION ALL
SELECT 'deletes_succeeded',
       NOT EXISTS (SELECT 1 FROM projects.rfis r               JOIN del_ctx d ON d.src = r.id)
       AND NOT EXISTS (SELECT 1 FROM field.snags s             JOIN del_ctx d ON d.src = s.id)
       AND NOT EXISTS (SELECT 1 FROM inspections.inspections i JOIN del_ctx d ON d.src = i.id)
       AND NOT EXISTS (SELECT 1 FROM field.site_forms f        JOIN del_ctx d ON d.src = f.id)
       AND NOT EXISTS (SELECT 1 FROM projects.qc_entries e     JOIN del_ctx d ON d.src = e.id)
       AND NOT EXISTS (SELECT 1 FROM projects.site_diary_entries y JOIN del_ctx d ON d.src = y.id),
       'F1: every source row is gone — with AFTER DELETE (or no trigger) the DELETE itself aborts on work_items_source_required and this probe returns no rows at all'
UNION ALL
SELECT 'all_voided_with_reason',
       (SELECT count(*) FROM projects.work_items w JOIN del_ctx d ON d.item = w.id
         WHERE d.pre_status <> 'void' AND w.status = 'void' AND w.void_reason = 'source deleted') = 8,
       'the eight non-void items (seven live, one closed) are voided BEFORE the RI SET NULL empties their source column, with the reason on the same statement — the exempt guard path performs no reason check at depth 2, so the trigger is the only reason-supplier'
UNION ALL
SELECT 'fk_is_null',
       (SELECT count(*) FROM projects.work_items w JOIN del_ctx d ON d.item = w.id
         WHERE w.rfi_id IS NULL AND w.snag_id IS NULL AND w.inspection_id IS NULL
           AND w.qc_entry_id IS NULL AND w.diary_id IS NULL AND w.site_form_id IS NULL) = 9,
       'ON DELETE SET NULL still applied, after the void — on a void row work_items_source_required and work_items_one_source both pass'
UNION ALL
SELECT 'bic_cleared',
       (SELECT count(*) FROM projects.work_items w JOIN del_ctx d ON d.item = w.id
         WHERE w.ball_in_court_id IS NULL) = 9,
       'A(a): the generated column is NULL on void, so the item leaves every inbox — nothing in the trigger clears it'
UNION ALL
SELECT 'events_survive',
       (SELECT count(DISTINCT d.item) FROM del_ctx d
          JOIN projects.work_item_events e ON e.work_item_id = d.item AND e.verb = 'created') = 9,
       '§03 §1.2: the events are why this is SET NULL and not a CASCADE — every item still carries its created event after its source is gone'
UNION ALL
SELECT 'voided_event_written_once',
       (SELECT count(*) FROM del_ctx d
         WHERE d.pre_status <> 'void'
           AND (SELECT count(*) FROM projects.work_item_events e
                 WHERE e.work_item_id = d.item AND e.verb = 'voided'
                   AND e.from_status = d.pre_status AND e.to_status = 'void') = 1) = 8,
       '§11 at depth 2: exactly one `voided` event per newly-voided item, from its pre-delete status to void'
UNION ALL
SELECT 'voided_event_actor_is_the_deleter',
       (SELECT count(*) FROM del_ctx d JOIN imp_ctx c ON true
          JOIN projects.work_item_events e ON e.work_item_id = d.item AND e.verb = 'voided'
         WHERE d.kind IN ('diary_live','diary_closed') AND e.actor_id = c.ctr AND e.actor_role = 'contractor') = 2,
       '§11 writes the event with auth.uid(): under impersonation the actor is rbac-test, the person who deleted the entry, stamped with their effective role — a definer trigger reading current_user would have recorded postgres'
UNION ALL
SELECT 'service_path_voided_event_actor_is_null',
       (SELECT count(*) FROM del_ctx d
          JOIN projects.work_item_events e ON e.work_item_id = d.item AND e.verb = 'voided'
         WHERE d.kind IN ('rfi','snag','inspection','form','qc') AND e.actor_id IS NULL) = 6,
       'the six service-path deletes (deleteDiaryEntryAction''s shape: the service client, auth.uid() NULL) record no actor — nobody is invented'
UNION ALL
SELECT 'impersonation_took',
       (SELECT c.who = 'authenticated' AND c.uid = c.ctr AND c.n_live = 1 AND c.n_closed = 1 FROM imp_ctx c),
       'both diary deletes ran as authenticated with auth.uid() = rbac-test and each touched exactly one row: the author DELETE policy (00149) admitted them and no trigger suppressed them'
UNION ALL
SELECT 'report_delete_voids_entry_items',
       (SELECT count(*) FROM projects.work_items w JOIN del_ctx d ON d.item = w.id
         WHERE d.kind = 'qc' AND w.status = 'void' AND w.void_reason = 'source deleted' AND w.qc_entry_id IS NULL) = 2
       AND NOT EXISTS (SELECT 1 FROM projects.qc_entries e JOIN del_ctx d ON d.src = e.id WHERE d.kind = 'qc'),
       'qc_entries.report_id is ON DELETE CASCADE (00172:112): deleting the REPORT cascades to both entries, the entry-level BEFORE DELETE fires once per cascaded row (depth 2; the void UPDATE at depth 3, still exempt) and both items are voided before their FK is nulled'
UNION ALL
SELECT 'closed_item_is_voided_on_source_delete',
       (SELECT d.pre_status = 'closed' AND w.status = 'void' AND w.void_reason = 'source deleted'
          FROM del_ctx d JOIN projects.work_items w ON w.id = d.item WHERE d.kind = 'diary_closed'),
       'FORCED, not chosen: work_items_source_required admits a source-less mirror item only while void, so a closed item left closed with its FK nulled would abort the DELETE; closed → void is illegal on the machine at depth 1, so under impersonation this delete succeeds only through C''s depth-2 exemption'
UNION ALL
SELECT 'closed_stamps_are_cleared_by_the_void',
       (SELECT d.pre_closed_at IS NOT NULL AND d.pre_closed_by IS NOT NULL
           AND w.closed_at IS NULL AND w.closed_by IS NULL
          FROM del_ctx d JOIN projects.work_items w ON w.id = d.item WHERE d.kind = 'diary_closed'),
       'the negation of closed_stamps_survive_the_void, pinned honestly: the VOID is a constraint necessity (work_items_source_required forces void for a source-less mirror item; no constraint names closed_at / closed_by), the STAMP LOSS is C''s exempt-path rule (IF NEW.status = ''closed'' THEN closed_at := now() ELSE closed_at := NULL; closed_by := NULL — inherited from 00196:1545-1546), which section F cannot preserve — so WHEN and BY WHOM the item was closed survive only in the closed and voided events. Kept as built: stamps ⇔ closed stays a simple invariant. Alternatives for the owner: keep the stamps on closed → void in C''s exempt path (one line, item 3''s migration — a void row would then carry close stamps), or admit closed in work_items_source_required (item 2) — deviation 21'
UNION ALL
SELECT 'void_item_keeps_its_reason',
       (SELECT d.pre_status = 'void' AND w.status = 'void'
           AND w.void_reason = 'Probe: site closed for the season' AND w.void_reason = d.pre_reason
           AND w.inspection_id IS NULL
           AND (SELECT count(*) FROM projects.work_item_events e WHERE e.work_item_id = w.id AND e.verb = 'voided') = d.pre_voided_n
          FROM del_ctx d JOIN projects.work_items w ON w.id = d.item WHERE d.kind = 'void_inspection'),
       'an already-void item is left alone (status <> ''void'' in the trigger''s WHERE): it keeps the reason its own projection supplied and gains no voided event (a born-void item''s only event is created — the count is compared to its pre-delete value, not to a literal); only the RI SET NULL touches it'
UNION ALL
SELECT 'claim_cleared',
       auth.uid() IS NULL,
       'set_config(…, true) outlives RESET ROLE; the impersonating block must clear the claim before the service-path rows above are read';
