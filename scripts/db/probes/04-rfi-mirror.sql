-- 04-rfi-mirror.sql — Task 5: the RFI projection (00199 section D, the
-- reference implementation Tasks 7-11 copy). Asserted against production inside
-- one rolled-back transaction:
--   projects.project_rfi(uuid)          — the projection body (no recursion guard)
--   projects.mirror_rfi_work_item()     — the trigger wrapper (depth guard, F2)
--   rfis_mirror_work_item_ins / _upd    — AFTER INSERT / AFTER UPDATE OF … WHEN (F7)
--
-- Run (00199 is not applied, so it is stacked):
--   node --experimental-strip-types scripts/db/rehearse-sql.ts scripts/db/probes/04-rfi-mirror.sql \
--     --with apps/edge-functions/supabase/migrations/00199_work_item_source_mirrors_and_backfill.sql
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
-- ⚠ The three RFI inserts consume three values of projects.rfis_rfi_number_seq,
-- which a rollback does not return (last_value was 16 on 2026-09-13). Three
-- numbers; the 50,000-row scale probe in Task 15 is the one that must restore
-- the sequence.
--
-- Contract: exactly ONE row-producing statement, last in the file. No
-- impersonation.
--
-- Expected: 26 rows. If the printed `assertions seen:` list is shorter than
-- twenty-six names, a UNION ALL arm was dropped — read the list, not the total.
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
  v_cv        uuid;   -- an active WM client viewer: never eligible on the probe project (F2)
  v_chain_pm  uuid;   -- resolve_project_pm(v_proj): the oldest active org admin (F3/F4)
  v_admin2    uuid;   -- a second active org admin: the un-triage target, distinct from every chain answer
  v_triage_owner uuid;
  v_cv_rfi    uuid;
  v_after_cv   record;
  v_after_same record;
  v_cv_item    record;
  v_redate     record;
  v_closed_people record;   -- the born-closed item's people after a post-close source reassignment (Task 8 review S1)
  v_admin3    uuid;   -- arm 2 on the THIRD project: distinct from arm 1b's chain_pm, admin2 and the owner, so a live move must re-run the chain to be seen
  v_proj3     uuid;   -- the live-move target (a moved item keeps its ref; two moves into one project collide on work_items_ref_unique)
  v_livemv    record; -- the client-viewer-named RFI's item, re-pointed at the viewer and then moved
  v_livemv_err text;  -- the move's error, if any: a dropped move arm leaves the raiser as gatekeeper on a project he is not on, and the membership trigger refuses the move
  v_cl_ctid_before text;   -- the born-closed record's tuple identity before an unrelated watched edit (Task 10 review, rule 1)
  v_cl_restamp     record; -- …and its ctid / last_activity_at / closed_by after a closed_by re-stamp on the source
  v_void_rfi   uuid;       -- a fourth RFI, voided ON THE SPINE while the source stays alive (rule 2, via Task 14)
  v_void_at    record;     -- the item as the void left it: title + ctid
  v_void_ren1  record;     -- after a source RENAME alone — rule 1 must return early, so the tuple is not even rewritten
  v_void_ren2  record;     -- after a rename PAIRED with a status edit — the arm runs, and rule 2 freezes the title
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
  v_chain_pm := projects.resolve_project_pm(v_proj);

  -- Task 5 review F3 + F4, one fixture. F4: resolver arm 1b
  -- (project_settings.default_rfi_assignee_id) must DECIDE the born assignee,
  -- so the 'rfi' literal project_rfi passes is load-bearing — a typo ('rfl')
  -- skips arm 1b and falls to the triage owner, who must therefore be a
  -- DIFFERENT person (ensure_project_settings_row seeds it as created_by, the
  -- owner). F3: under the owner default the gatekeeper is the raiser; a
  -- gatekeeper that fell back to the PM chain must COINCIDE with the assignee
  -- so assignee_is_not_the_gatekeeper and bic_moves_to_gatekeeper can go red
  -- — hence the default is exactly resolve_project_pm(v_proj). (The review's
  -- own fixture set triage_owner_id to that person instead; with arm 1b also
  -- pointing there the F4 row could never fail, so the two are reconciled
  -- this way.)
  IF v_chain_pm = v_pm THEN
    RAISE EXCEPTION 'fixture: the PM chain resolved to the owner (%), who is also the triage owner — arm 1b and the triage-owner arm would answer alike', v_pm;
  END IF;
  SELECT s.triage_owner_id INTO v_triage_owner
    FROM projects.project_settings s WHERE s.project_id = v_proj;
  IF v_triage_owner IS DISTINCT FROM v_pm THEN
    RAISE EXCEPTION 'fixture: ensure_project_settings_row seeded triage_owner_id = % (expected created_by = the owner %)', v_triage_owner, v_pm;
  END IF;
  UPDATE projects.project_settings SET default_rfi_assignee_id = v_chain_pm WHERE project_id = v_proj;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fixture: ensure_project_settings_row did not seed a settings row for the probe project';
  END IF;
  IF NOT projects.work_item_person_eligible(v_proj, v_chain_pm) THEN
    RAISE EXCEPTION 'fixture: the PM-chain person (%) is not eligible on the probe project', v_chain_pm;
  END IF;

  -- The un-triage target: eligible (an org admin always wins, 00107) and
  -- DIFFERENT from both the arm-1b answer and the triage-owner fallback, so
  -- source_assignment_untriages_item measures the flag whichever arm answered.
  SELECT u.user_id INTO v_admin2 FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'admin' AND u.is_active
     AND u.user_id NOT IN (v_pm, v_other, v_chain_pm)
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_admin2 IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no second active admin besides the PM-chain person (7 admins on 2026-09-13)';
  END IF;
  IF NOT projects.work_item_person_eligible(v_proj, v_admin2) THEN
    RAISE EXCEPTION 'fixture: the second admin (%) is not eligible on the probe project', v_admin2;
  END IF;

  -- F2: an active WM client viewer — ineligible on the probe project whatever
  -- their membership (client_viewer is excluded by the mirror's chain).
  SELECT u.user_id INTO v_cv FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'client_viewer' AND u.is_active
     AND u.user_id NOT IN (v_pm, v_other)
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_cv IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active client_viewer in user_organisations (3 on 2026-09-13)';
  END IF;
  IF projects.work_item_person_eligible(v_proj, v_cv) THEN
    RAISE EXCEPTION 'fixture: the client viewer (%) is eligible on the probe project', v_cv;
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

  -- F2 (a): assigned at the source to an INELIGIBLE person. The un-triage flag
  -- is "eligible AND different from what the item holds"; a client viewer is
  -- not eligible, so the item stays in triage on the chain's answer.
  UPDATE projects.rfis SET assigned_to = v_cv WHERE id = v_rfi;
  SELECT w.status, w.assignee_id INTO v_after_cv
    FROM projects.work_items w WHERE w.rfi_id = v_rfi;

  -- F2 (b): assigned at the source to EXACTLY what the item already holds —
  -- the shape section E's write-back produces for a triage item. Eligible,
  -- but not different: the item stays in triage. (The CURRENT holder, read
  -- back, not a fixture guess at it — so this row measures the flag, not
  -- which chain arm answered.)
  UPDATE projects.rfis SET assigned_to = v_after_cv.assignee_id WHERE id = v_rfi;
  SELECT w.status, w.assignee_id INTO v_after_same
    FROM projects.work_items w WHERE w.rfi_id = v_rfi;

  -- A source-side assignment to an ELIGIBLE, DIFFERENT person (the RFI page's
  -- own assign control) UN-TRIAGES the item (decided 2026-09-13, Task 4
  -- review carry-forward 2; flag revised by the Task 5 review, F2).
  UPDATE projects.rfis SET assigned_to = v_admin2 WHERE id = v_rfi;

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

  SELECT w.status, w.opened_at, w.closed_at, w.closed_by, w.due_date INTO v_closed_item
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

  -- F1: a source RE-DATE. due_date is read on INSERT only — the spine owns the
  -- due date once the item exists (improvement 11 is spine → source only) —
  -- so it is no longer in the _upd trigger's lists and this must not fire a
  -- projection at all: neither the item's due_date nor its historical
  -- last_activity_at moves.
  UPDATE projects.rfis SET due_date = CURRENT_DATE + 40 WHERE id = v_closed_rfi;
  SELECT w.due_date, w.last_activity_at INTO v_redate
    FROM projects.work_items w WHERE w.rfi_id = v_closed_rfi AND w.origin = 'mirror';

  -- A source reassignment AFTER the close (the RFI page's assign control on
  -- a closed RFI — nothing stops it): the closed item's people are part of
  -- the record and must not follow (Task 8 review S1). v_admin2 is eligible
  -- and different from what the item holds (arm 1b's answer), so without the
  -- rule the forward read would move assignee_id here.
  UPDATE projects.rfis SET assigned_to = v_admin2 WHERE id = v_closed_rfi;
  SELECT w.status, w.assignee_id, w.gatekeeper_id INTO v_closed_people
    FROM projects.work_items w WHERE w.rfi_id = v_closed_rfi AND w.origin = 'mirror';

  -- Task 10 review, rule 1 (via Task 13): a closed_by RE-STAMP on the closed
  -- source — watched, so the _upd trigger fires — changes nothing the closed
  -- record projects (first closer wins: closed_by = COALESCE(the item's, the
  -- source's)), so the UPDATE arm must return early and leave the tuple
  -- alone. Measured by ctid AND by the historical last_activity_at the INSERT
  -- path kept: without the rule the arm rewrote the tuple and stamped now()
  -- over it — the same signal same_value_write_does_not_reproject reads.
  SELECT w.ctid::text INTO v_cl_ctid_before
    FROM projects.work_items w WHERE w.rfi_id = v_closed_rfi AND w.origin = 'mirror';
  UPDATE projects.rfis SET closed_by = v_chain_pm WHERE id = v_closed_rfi;
  SELECT w.ctid::text AS ctid_after, w.last_activity_at, w.closed_by, w.status INTO v_cl_restamp
    FROM projects.work_items w WHERE w.rfi_id = v_closed_rfi AND w.origin = 'mirror';

  -- F2 (c): BORN with an ineligible explicit assignee. Nobody eligible was
  -- named, so §03 §1.6 says triage, on the chain's answer (arm 1b here).
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                             priority, status, raised_by, assigned_to)
  VALUES (v_proj, v_org, 'Probe CV RFI', 'body', 'high', 'open', v_other, v_cv)
  RETURNING id INTO v_cv_rfi;
  SELECT w.status, w.assignee_id INTO v_cv_item
    FROM projects.work_items w WHERE w.rfi_id = v_cv_rfi AND w.origin = 'mirror';

  -- ── Task 9 review I1 (via Task 12): a LIVE move re-runs the chain ─────────
  -- A THIRD project whose arm 2 (work_item_defaults.rfi.triage_owner_id)
  -- names a THIRD admin — distinct from arm 1b's answer on the first project
  -- (chain_pm), from admin2 and from the owner (arm 3) — so the move arm's
  -- resolver call and its 'rfi' literal are both load-bearing: a typo key
  -- falls to the owner (proj3's triage owner), a dropped `ELSIF v_moved` arm
  -- keeps chain_pm. The moved RFI must name nobody ELIGIBLE at move time, or
  -- arm 1 answers on the new project too: section E wrote arm 1b's answer
  -- back to rfis.assigned_to at birth, so the source is re-pointed at the
  -- client viewer first (a later source edit naming an ineligible person
  -- stays on the source and moves nothing on the spine — improvement 7,
  -- deviation 11; asserted so the row measures the move). A fresh third
  -- project: a moved item keeps its ref and the allocator numbers per
  -- project (deviation 20).
  SELECT u.user_id INTO v_admin3 FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'admin' AND u.is_active
     AND u.user_id NOT IN (v_pm, v_other, v_chain_pm, v_admin2)
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_admin3 IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no third active admin besides the PM-chain person and admin2 (11 admins on 2026-09-13)';
  END IF;
  INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
  VALUES (v_org, '_probe_rfi_mirror_3', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj3;
  UPDATE projects.project_settings
     SET work_item_defaults = jsonb_build_object('rfi', jsonb_build_object('triage_owner_id', v_admin3::text))
   WHERE project_id = v_proj3;
  IF projects.resolve_mirror_assignee(v_proj3, 'rfi', v_cv) IS DISTINCT FROM v_admin3 THEN
    RAISE EXCEPTION 'fixture: on the third project the chain answers % rather than arm 2''s admin3 % — the live-move row could not discriminate',
      projects.resolve_mirror_assignee(v_proj3, 'rfi', v_cv), v_admin3;
  END IF;
  IF projects.resolve_mirror_assignee(v_proj3, 'rfl', v_cv) IS NOT DISTINCT FROM v_admin3 THEN
    RAISE EXCEPTION 'fixture: a typo key answers arm 2 on the third project too — the live-move row could not discriminate the literal';
  END IF;
  UPDATE projects.rfis SET assigned_to = v_cv WHERE id = v_cv_rfi;
  SELECT w.status, w.assignee_id INTO v_livemv
    FROM projects.work_items w WHERE w.rfi_id = v_cv_rfi AND w.origin = 'mirror';
  IF v_livemv.status <> 'triage' OR v_livemv.assignee_id IS DISTINCT FROM v_cv_item.assignee_id THEN
    RAISE EXCEPTION 'fixture: re-pointing the source at the client viewer moved the item (% on %) — the live-move row would measure that, not the move',
      v_livemv.status, v_livemv.assignee_id;
  END IF;
  -- The move itself, error captured: with the move arm dropped the gatekeeper
  -- stays the raiser (a contractor who is NOT on proj3) and item 2's
  -- membership trigger refuses the whole UPDATE with its sentence — captured
  -- so that mutation reads as this row going red, not as the probe aborting.
  BEGIN
    UPDATE projects.rfis SET project_id = v_proj3 WHERE id = v_cv_rfi;
    v_livemv_err := NULL;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_livemv_err = MESSAGE_TEXT;
  END;
  SELECT w.status, w.project_id, w.assignee_id, w.gatekeeper_id INTO v_livemv
    FROM projects.work_items w WHERE w.rfi_id = v_cv_rfi AND w.origin = 'mirror';

  -- ── Rule 2 (Task 10 review; landed in D.1 by Task 14): a VOID row's title is
  --    FROZEN, while a closed row keeps following the source ────────────────
  -- The case is the SPINE-side void with the source still alive: a person
  -- voids the ITEM with a reason (§03 §1.7), the RFI lives on, and the record
  -- must keep saying what it said when it was voided. Section F's
  -- delete-to-void cannot express this — it nulls rfi_id, which puts the row
  -- beyond project_rfi() forever.
  --   1. a source RENAME alone: rule 1's early return fires (a void row's
  --      title is never compared), so the tuple is not even rewritten;
  --   2. a rename PAIRED with a status edit: source_status moves, rule 1
  --      cannot return, the UPDATE arm runs — and everything it projects
  --      follows the source EXCEPT the title. source_status is asserted below
  --      precisely so this row cannot pass by the arm never running.
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                             priority, status, raised_by)
  VALUES (v_proj, v_org, 'Probe VOID RFI', 'body', 'medium', 'open', v_other)
  RETURNING id INTO v_void_rfi;
  -- Service path (auth.uid() IS NULL): the guard's exemption returns NEW after
  -- clearing the closed stamps, so a direct void with a reason is legal here.
  UPDATE projects.work_items
     SET status = 'void', void_reason = 'voided on the spine, source still live'
   WHERE rfi_id = v_void_rfi AND origin = 'mirror';
  SELECT w.title, w.ctid::text AS ctid INTO v_void_at
    FROM projects.work_items w WHERE w.rfi_id = v_void_rfi AND w.origin = 'mirror';
  IF v_void_at.title IS DISTINCT FROM 'Probe VOID RFI' THEN
    RAISE EXCEPTION 'fixture: the spine-side void did not leave the item titled "Probe VOID RFI" (got %)', v_void_at.title;
  END IF;

  UPDATE projects.rfis SET subject = 'Renamed once' WHERE id = v_void_rfi;
  SELECT w.title, w.ctid::text AS ctid INTO v_void_ren1
    FROM projects.work_items w WHERE w.rfi_id = v_void_rfi AND w.origin = 'mirror';

  UPDATE projects.rfis SET subject = 'Renamed twice', status = 'responded'
   WHERE id = v_void_rfi;
  SELECT w.title, w.status, w.source_status, w.void_reason INTO v_void_ren2
    FROM projects.work_items w WHERE w.rfi_id = v_void_rfi AND w.origin = 'mirror';

  CREATE TEMP TABLE rfi_ctx(
    rfi uuid, closed_rfi uuid, proj uuid, pm uuid, other uuid,
    ins_status text, ins_bic uuid, ins_assignee uuid, ins_gate uuid,
    ins_due date, ins_title text, ins_priority text, ins_source_status text, ins_type text,
    ins_opened_at timestamptz,
    assign_status text, assign_assignee uuid,
    resp_status text, resp_bic uuid,
    closed_status text, closed_opened_at timestamptz, closed_closed_at timestamptz, closed_closed_by uuid,
    closed_last_activity timestamptz, hist_created timestamptz, hist_closed timestamptz,
    chain_pm uuid, admin2 uuid, cv uuid, cv_rfi uuid,
    cv_assign_status text, cv_assign_assignee uuid,
    same_status text, same_assignee uuid,
    closed_due_before date, redate_due date, redate_last_activity timestamptz,
    cv_status text, cv_assignee uuid,
    closed_people_status text, closed_people_assignee uuid, closed_people_gate uuid,
    proj3 uuid, admin3 uuid,
    livemv_status text, livemv_project uuid, livemv_assignee uuid, livemv_gate uuid, livemv_err text,
    cl_ctid_before text, cl_ctid_after text, cl_restamp_last_activity timestamptz,
    cl_restamp_closed_by uuid, cl_restamp_status text,
    void_rfi uuid, void_title_at_void text, void_ctid_at_void text,
    void_title_ren1 text, void_ctid_ren1 text,
    void_title_ren2 text, void_status_ren2 text, void_source_status_ren2 text,
    void_reason_ren2 text)
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
    v_closed_last_activity, v_hist_created, v_hist_closed,
    v_chain_pm, v_admin2, v_cv, v_cv_rfi,
    v_after_cv.status, v_after_cv.assignee_id,
    v_after_same.status, v_after_same.assignee_id,
    v_closed_item.due_date, v_redate.due_date, v_redate.last_activity_at,
    v_cv_item.status, v_cv_item.assignee_id,
    v_closed_people.status, v_closed_people.assignee_id, v_closed_people.gatekeeper_id,
    v_proj3, v_admin3,
    v_livemv.status, v_livemv.project_id, v_livemv.assignee_id, v_livemv.gatekeeper_id, v_livemv_err,
    v_cl_ctid_before, v_cl_restamp.ctid_after, v_cl_restamp.last_activity_at,
    v_cl_restamp.closed_by, v_cl_restamp.status,
    v_void_rfi, v_void_at.title, v_void_at.ctid,
    v_void_ren1.title, v_void_ren1.ctid,
    v_void_ren2.title, v_void_ren2.status, v_void_ren2.source_status,
    v_void_ren2.void_reason);
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
-- Task 5 review F4: resolver arm 1b decides the born assignee, so the 'rfi'
-- literal passed to resolve_mirror_assignee is load-bearing ('rfl' skips it
-- and falls to the triage owner — a different person by fixture).
SELECT 'default_rfi_assignee_resolves_through_arm_1b',
       (SELECT c.ins_assignee = c.chain_pm AND c.ins_assignee <> c.pm FROM rfi_ctx c),
       'project_settings.default_rfi_assignee_id is arm 1b of the mirror chain — reachable only when project_rfi passes exactly ''rfi''; the triage owner (the owner) is the fallback and must not be the answer'
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
                WHERE ww.user_id = c.other AND ww.reason = 'creator'),
       '§03 §1.5: the raiser is a watcher WITH reason = creator — seeded by item 2''s §11 from created_by (00196:1378-1387), which the mirror sets to raised_by; this migration seeds nothing (S1: the reason is asserted, not only the row)'
UNION ALL
-- Task 4 review carry-forward 2, revised by the Task 5 review (F2): the UPDATE
-- arm's un-triage flag is "an ELIGIBLE source assignee DIFFERENT from what the
-- item holds", so assigning an eligible newcomer at the source un-triages.
SELECT 'source_assignment_untriages_item',
       (SELECT c.assign_status = 'open' AND c.assign_assignee = c.admin2 FROM rfi_ctx c),
       'rfis.assigned_to → a second admin on the RFI page (eligible, different from the item''s assignee): the item leaves triage and carries that assignee'
UNION ALL
SELECT 'ineligible_source_assignment_does_not_untriage',
       (SELECT c.cv_assign_status = 'triage' AND c.cv_assign_assignee = c.ins_assignee FROM rfi_ctx c),
       'F2: assigning a client viewer at the source must not un-triage the item, nor move it off the chain''s answer (the old flag, r.assigned_to IS NOT NULL, was eligibility-blind)'
UNION ALL
SELECT 'same_assignee_on_source_does_not_untriage',
       (SELECT c.same_status = 'triage' AND c.same_assignee = c.ins_assignee FROM rfi_ctx c),
       'F2: the source naming exactly what the item holds — section E''s write-back shape for a triage item — must not un-triage it on the next edit'
UNION ALL
SELECT 'ineligible_explicit_is_born_triage',
       (SELECT c.cv_status = 'triage' AND c.cv_assignee <> c.cv AND c.cv_assignee = c.ins_assignee FROM rfi_ctx c),
       'F2: born with a client viewer named — nobody eligible was named, so §03 §1.6 says triage on the chain''s answer, the same answer the first RFI was born with (improvement 7: the viewer never holds it)'
UNION ALL
-- Service-path push-back. NOT F8's evidence: as postgres the guard is exempt.
SELECT 'status_pushback',
       (SELECT c.resp_status = 'answered' FROM rfi_ctx c),
       'responded ⇒ answered on the service path. The signed-in case is probe 05b (Task 5½)'
UNION ALL
SELECT 'bic_moves_to_gatekeeper',
       (SELECT c.resp_bic = c.other FROM rfi_ctx c),
       'answered ⇒ the ball is with the person who ASKED — compared to the raiser directly, not to whatever the gatekeeper resolved to (F3: against ins_gate this row could not fail when the gatekeeper fell back to the PM)'
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
       'the _upd trigger''s WHEN clause: a full-row save that changes nothing it watches must not fire the projection (it would stamp last_activity_at = now() over the historical value)'
UNION ALL
-- Task 5 review F1: due_date left the _upd trigger's UPDATE OF and WHEN lists.
SELECT 'source_redate_does_not_fire_a_projection',
       (SELECT c.redate_due IS NOT DISTINCT FROM c.closed_due_before
           AND c.redate_last_activity = c.hist_closed FROM rfi_ctx c),
       'rfis.due_date moved +40: the spine owns the due date once the item exists, so the re-date fires nothing — the item''s due_date and its historical last_activity_at are untouched (with due_date watched, a no-op projection stamped now() over the history)'
UNION ALL
-- Task 8 review S1: a closed item's people are part of the record.
SELECT 'closed_item_people_are_not_reprojected',
       (SELECT c.closed_people_status = 'closed' AND c.closed_people_assignee = c.chain_pm
           AND c.closed_people_assignee <> c.admin2 AND c.closed_people_gate = c.other FROM rfi_ctx c),
       'rfis.assigned_to → a second admin AFTER the close: the closed record keeps the people it was closed with (the guard''s clause (b) sentence, which the depth-2 path never reaches, so the projection holds the line itself) — without the rule the forward read would move assignee_id'
UNION ALL
-- Task 9 review I1 (via Task 12): the live-move arm.
SELECT 'live_move_reruns_the_chain_through_the_rfi_key',
       (SELECT c.livemv_err IS NULL
           AND c.livemv_status = 'triage' AND c.livemv_project = c.proj3 AND c.livemv_assignee = c.admin3
           AND c.livemv_assignee <> c.chain_pm AND c.livemv_assignee <> c.pm
           AND c.livemv_gate = c.chain_pm AND c.livemv_gate <> c.other FROM rfi_ctx c),
       'improvement 8 on a LIVE item: the move re-runs BOTH people on the NEW project — arm 2 there (admin3) through the move arm''s ''rfi'' literal (a typo key falls to the owner), and the gatekeeper falls from the raiser (not a member of the new project) to the PM chain; a dropped ELSIF v_moved arm leaves the raiser as gatekeeper and item 2''s membership trigger refuses the whole move ("That person is not on this project…" — captured into livemv_err)'
UNION ALL
-- Task 10 review, rule 1 (via Task 13): a closed record is not rewritten by a
-- source edit that changes nothing it projects.
SELECT 'closed_item_unrelated_source_edit_leaves_the_record',
       (SELECT c.cl_ctid_before = c.cl_ctid_after
           AND c.cl_restamp_last_activity = c.hist_closed
           AND c.cl_restamp_closed_by = c.pm AND c.cl_restamp_status = 'closed'
           AND (SELECT r.closed_by FROM projects.rfis r WHERE r.id = c.closed_rfi) = c.chain_pm
          FROM rfi_ctx c),
       'a closed_by re-stamp on a CLOSED RFI fires the _upd trigger (the column is watched) but changes nothing the closed record projects — first closer wins — so the UPDATE arm returns early: same ctid, last_activity_at keeps its historical value instead of the guard''s now(), and the record still names the first closer while the source names the second'
UNION ALL
-- Task 10 review, rule 2 (via Task 14): a VOID row's title is frozen.
SELECT 'spine_voided_item_title_is_frozen',
       (SELECT c.void_title_at_void = 'Probe VOID RFI'
           AND c.void_title_ren1 = 'Probe VOID RFI' AND c.void_ctid_ren1 = c.void_ctid_at_void
           AND c.void_title_ren2 = 'Probe VOID RFI'
           AND c.void_status_ren2 = 'void' AND c.void_source_status_ren2 = 'responded'
           AND c.void_reason_ren2 = 'voided on the spine, source still live'
           AND (SELECT r.subject FROM projects.rfis r WHERE r.id = c.void_rfi) = 'Renamed twice'
          FROM rfi_ctx c),
       'an item voided ON THE SPINE while its RFI lives on keeps the title it was voided with: a rename ALONE returns early on rule 1 (same ctid — the tuple is not even rewritten), and a rename PAIRED with a status edit runs the UPDATE arm — source_status follows to ''responded'' and void_reason survives, but the title does not move, while the source now reads "Renamed twice"';
