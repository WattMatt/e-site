-- 04-rfi-mirror.sql — Task 5: the RFI projection (00198 section D, the
-- reference implementation Tasks 7-11 copy). Asserted against production inside
-- one rolled-back transaction:
--   projects.project_rfi(uuid)          — the projection body (no recursion guard)
--   projects.mirror_rfi_work_item()     — the trigger wrapper (depth guard, F2)
--   rfis_mirror_work_item_ins / _upd    — AFTER INSERT / AFTER UPDATE OF … WHEN (F7)
--
-- Run (00198 is not applied, so it is stacked):
--   node --experimental-strip-types scripts/db/rehearse-sql.ts scripts/db/probes/04-rfi-mirror.sql \
--     --with apps/edge-functions/supabase/migrations/00198_work_item_source_mirrors_and_backfill.sql
-- Before section D existed this reported 0/16 (the source_assignment row was
-- added afterwards, red first under its own mutation): no trigger fires, both
-- RFIs project nothing, and every recorded observation is NULL (a NULL `ok`
-- is a FAIL in the harness, never a coerced false).
--
-- Walks from an empty project, never from seeded data (§12 §(h)). Every
-- fixture RAISEs rather than skips: a NOTICE never reaches the Management API
-- caller, and a skipped fixture is a probe that cannot fail.
--
-- ⚠ Every mutation is inside the DO block. `UPDATE … RETURNING` cannot appear
-- in a FROM clause (42601), and sibling parts of one statement read the
-- pre-update snapshot — so an assertion that "the status changed" written as a
-- subquery beside the UPDATE can never be true.
--
-- ⚠ This probe runs as postgres with auth.uid() NULL (F9), which is item 2's
-- guard's SERVICE path (00196:1540): its UPDATE-arm assertions pass whatever
-- the guard says. F8's evidence is probe 05b (Task 5½), under impersonation.
--
-- ⚠ The two RFI inserts consume two values of projects.rfis_rfi_number_seq,
-- which a rollback does not return (last_value was 16 on 2026-09-13). Two
-- numbers; the 50,000-row scale probe in Task 15 is the one that must restore
-- the sequence.
--
-- Contract: exactly ONE row-producing statement, last in the file. No
-- impersonation.
--
-- Expected: 17 rows. If the printed `assertions seen:` list is shorter than
-- seventeen names, a UNION ALL arm was dropped — read the list, not the total.
DO $probe$
DECLARE
  v_org   uuid := 'dddddddd-0000-0000-0000-000000000001';  -- WM-Consulting
  v_pm    uuid;   -- the org owner: creates the project, closes the born-closed RFI
  v_other uuid;   -- a contractor: raises both RFIs (12 of 15 live RFIs were raised by contractors)
  v_proj  uuid;
  v_rfi   uuid;
  v_closed_rfi uuid;
  -- Historical stamps for the born-closed RFI. now() is fixed for the whole
  -- transaction, so these are exact equality targets, not approximations.
  v_hist_created timestamptz := now() - interval '40 days';
  v_hist_closed  timestamptz := now() - interval '20 days';
  v_after_insert  record;
  v_after_assign  record;
  v_after_respond record;
  v_closed_item   record;
  v_closed_last_activity timestamptz;
BEGIN
  SELECT u.user_id INTO v_pm FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_pm IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active owner in user_organisations (1 on 2026-09-13)';
  END IF;

  SELECT u.user_id INTO v_other FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'contractor' AND u.is_active
     AND u.user_id <> v_pm
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_other IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active contractor in user_organisations (12 on 2026-09-13)';
  END IF;

  INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
  VALUES (v_org, '_probe_rfi_mirror', 'active', 'ZAR', v_pm)
  RETURNING id INTO v_proj;   -- ensure_project_settings_row() fires here

  -- An org-level contractor has NO effective role on a project they are not a
  -- member of (00107: only owner/admin/project_manager "always win"; everyone
  -- else falls back to project_members). Without this row the raiser is
  -- ineligible, the gatekeeper falls back to the PM, and gatekeeper_is_the_raiser
  -- would fail for a fixture reason. project_members.organisation_id is NOT NULL.
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active)
  VALUES (v_proj, v_other, v_org, 'contractor', true);
  IF public.user_effective_project_role(v_proj, v_other) IS DISTINCT FROM 'contractor' THEN
    RAISE EXCEPTION 'fixture: the contractor''s role is not effective on the probe project (got %)',
      public.user_effective_project_role(v_proj, v_other);
  END IF;

  -- The assignee chain (no explicit, no per-project defaults on a fresh
  -- settings row) ends in 00195's PM chain: no project PM, no org PM, so the
  -- oldest active org admin. That is never the contractor — asserted here so
  -- assignee_is_not_the_gatekeeper below measures the mirror, not the fixture.
  IF projects.resolve_project_pm(v_proj) IS NULL THEN
    RAISE EXCEPTION 'fixture: the probe project resolves no PM — WM-Consulting has lost its owner/admins';
  END IF;
  IF projects.resolve_project_pm(v_proj) = v_other THEN
    RAISE EXCEPTION 'fixture: the PM chain resolved to the contractor (%), so assignee and gatekeeper would coincide for a fixture reason', v_other;
  END IF;

  -- Raised by the contractor, with NO assignee and a due date of TODAY — the
  -- exact live shape of RFI "Drawings" (created and due 2026-07-23).
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                             priority, status, raised_by, due_date)
  VALUES (v_proj, v_org, 'Probe RFI', 'body', 'high', 'open', v_other, CURRENT_DATE)
  RETURNING id INTO v_rfi;

  SELECT w.id, w.item_type, w.title, w.priority, w.status, w.source_status,
         w.assignee_id, w.gatekeeper_id, w.ball_in_court_id, w.due_date, w.origin,
         w.opened_at, w.closed_at, w.closed_by
    INTO v_after_insert
    FROM projects.work_items w WHERE w.rfi_id = v_rfi AND w.origin = 'mirror';

  -- A source-side assignment (the RFI page's own assign control) UN-TRIAGES
  -- the item (decided 2026-09-13, Task 4 review carry-forward 2): the UPDATE
  -- arm passes `r.assigned_to IS NOT NULL` as the explicit-assignee flag.
  -- The owner is eligible (00107: org owner always wins).
  UPDATE projects.rfis SET assigned_to = v_pm WHERE id = v_rfi;

  SELECT w.status, w.assignee_id INTO v_after_assign
    FROM projects.work_items w WHERE w.rfi_id = v_rfi;

  -- Push-back from the source. This probe runs as postgres (auth.uid() NULL),
  -- which is the guard's SERVICE path — so this UPDATE cannot be refused here
  -- whatever the guard says. F8's evidence is probe 05b (Task 5½), which does
  -- the same thing as a signed-in contractor.
  UPDATE projects.rfis SET status = 'responded' WHERE id = v_rfi;

  SELECT w.status, w.ball_in_court_id INTO v_after_respond
    FROM projects.work_items w WHERE w.rfi_id = v_rfi;

  -- A second projection through a column in the UPDATE OF list that does NOT
  -- change status. If the existing-row lookup were wrong the INSERT arm would
  -- run again: with the explicit ON CONFLICT target it is swallowed (and the
  -- status push-back below is lost); with no ON CONFLICT it is 23505 on
  -- work_items_src_rfi_uidx. Either way there is never a second item while
  -- that index exists — which is F6's whole point.
  UPDATE projects.rfis SET priority = 'low' WHERE id = v_rfi;

  -- A BORN-CLOSED source with historical stamps — the shape of the 6 closed
  -- RFIs the backfill will project (#4). On the service path §5 keeps a
  -- supplied opened_at (00196:629-636) and there is no guard on INSERT, so
  -- what the projection supplies is what the row carries. updated_at is set
  -- explicitly too, so last_activity_at has a value a re-projection would
  -- visibly disturb (see the same-value write below).
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                             priority, status, raised_by, closed_at, closed_by,
                             created_at, updated_at)
  VALUES (v_proj, v_org, 'Probe closed RFI', 'body', 'low', 'closed', v_other,
          v_hist_closed, v_pm, v_hist_created, v_hist_closed)
  RETURNING id INTO v_closed_rfi;

  SELECT w.status, w.opened_at, w.closed_at, w.closed_by INTO v_closed_item
    FROM projects.work_items w WHERE w.rfi_id = v_closed_rfi AND w.origin = 'mirror';

  -- A full-row save that changes only the description: every watched column
  -- is in the SET list with its old value. The _upd trigger's column list
  -- admits it; only the WHEN clause stops it firing. If it fired, the UPDATE
  -- arm would stamp last_activity_at = now() over the historical value.
  UPDATE projects.rfis
     SET description = 'edited', subject = subject, priority = priority,
         status = status, due_date = due_date, assigned_to = assigned_to
   WHERE id = v_closed_rfi;

  SELECT w.last_activity_at INTO v_closed_last_activity
    FROM projects.work_items w WHERE w.rfi_id = v_closed_rfi AND w.origin = 'mirror';

  CREATE TEMP TABLE rfi_ctx(
    rfi uuid, closed_rfi uuid, proj uuid, pm uuid, other uuid,
    ins_status text, ins_bic uuid, ins_assignee uuid, ins_gate uuid,
    ins_due date, ins_title text, ins_priority text, ins_source_status text, ins_type text,
    ins_opened_at timestamptz,
    assign_status text, assign_assignee uuid,
    resp_status text, resp_bic uuid,
    closed_status text, closed_opened_at timestamptz, closed_closed_at timestamptz, closed_closed_by uuid,
    closed_last_activity timestamptz, hist_created timestamptz, hist_closed timestamptz)
    ON COMMIT DROP;
  INSERT INTO rfi_ctx VALUES (
    v_rfi, v_closed_rfi, v_proj, v_pm, v_other,
    v_after_insert.status, v_after_insert.ball_in_court_id, v_after_insert.assignee_id,
    v_after_insert.gatekeeper_id, v_after_insert.due_date, v_after_insert.title,
    v_after_insert.priority, v_after_insert.source_status, v_after_insert.item_type,
    v_after_insert.opened_at,
    v_after_assign.status, v_after_assign.assignee_id,
    v_after_respond.status, v_after_respond.ball_in_court_id,
    v_closed_item.status, v_closed_item.opened_at, v_closed_item.closed_at, v_closed_item.closed_by,
    v_closed_last_activity, v_hist_created, v_hist_closed);
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
-- Task 3 review: the item_type literal the projection passes is unvalidated
-- text on the resolver side, so it is pinned to the registry key here.
SELECT 'item_type_is_registry_key',
       EXISTS (SELECT 1 FROM projects.work_item_types t WHERE t.key = 'rfi')
       AND (SELECT c.ins_type = (SELECT t.key FROM projects.work_item_types t WHERE t.key = 'rfi')
              FROM rfi_ctx c),
       'the literal ''rfi'' in project_rfi() is exactly projects.work_item_types.key — a typo skips resolver arms silently'
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
       '§03 §1.5: the raiser is a watcher — seeded by item 2''s §11 from created_by (00196:1378-1387), which the mirror sets to raised_by; this migration seeds nothing'
UNION ALL
-- Task 4 review carry-forward 2: the UPDATE arm passes the explicit-assignee
-- flag too, so assigning at the source un-triages the item.
SELECT 'source_assignment_untriages_item',
       (SELECT c.assign_status = 'open' AND c.assign_assignee = c.pm FROM rfi_ctx c),
       'rfis.assigned_to NULL → owner on the RFI page: the item leaves triage and carries that assignee (the UPDATE arm passes r.assigned_to IS NOT NULL)'
UNION ALL
-- Service-path push-back. NOT F8's evidence: as postgres the guard is exempt.
SELECT 'status_pushback',
       (SELECT c.resp_status = 'answered' FROM rfi_ctx c),
       'responded ⇒ answered on the service path. The signed-in case is probe 05b (Task 5½)'
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
       'the update arm must not reset a terminal status on an unrelated edit'
UNION ALL
-- #4: historical stamps travel with the projection.
SELECT 'opened_at_is_source_created_at',
       (SELECT c.closed_opened_at = c.hist_created
           AND c.closed_opened_at = (SELECT r.created_at FROM projects.rfis r WHERE r.id = c.closed_rfi)
          FROM rfi_ctx c),
       '#4: opened_at = rfis.created_at, kept on the service path (00196:629-636); §11 dates the created event at it'
UNION ALL
SELECT 'born_closed_carries_source_stamps',
       (SELECT c.closed_status = 'closed'
           AND c.closed_closed_at = c.hist_closed
           AND c.closed_closed_at = (SELECT r.closed_at FROM projects.rfis r WHERE r.id = c.closed_rfi)
           AND c.closed_closed_by = c.pm
          FROM rfi_ctx c),
       '#4: a born-closed RFI carries closed_at/closed_by from the source, or metric 7 and the feed lie for the 6 closed live RFIs'
UNION ALL
-- F7 / §03 §1.2: the WHEN clause. A same-value write of every watched column
-- (a full-row save that changed only the description) must not re-project.
SELECT 'same_value_write_does_not_reproject',
       (SELECT c.closed_last_activity = c.hist_closed FROM rfi_ctx c),
       'the _upd trigger''s WHEN clause: a full-row save that changes nothing it watches must not fire the projection (it would stamp last_activity_at = now() over the historical value)';
