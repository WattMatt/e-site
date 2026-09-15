-- Probe 16 — the one probe that runs as a REAL USER (F9).
--
-- Measured on production 2026-09-10 and again 2026-09-15:
--   current_user = postgres   rolbypassrls = true   auth.uid() = <null>
-- The Management API's /database/query endpoint runs with RLS bypassed and no
-- identity, so EVERY other probe in this plan is authorisation-blind — 05b
-- impersonates for the transition GUARD, but nothing above can fail on an
-- AUTHORISATION defect, including the one the whole design turns on:
--
--   the projection is SECURITY DEFINER so that a contractor's perfectly
--   legitimate INSERT INTO projects.rfis is not refused by item 2's
--   RESTRICTIVE INSERT policy on projects.work_items (00196:1174-1196). A
--   mirrored type is source-only: no client session can insert one. Note the
--   gate is conjunctive — item_type = 'task', the ref shape, the source FKs
--   being NULL and origin = 'manual' all fail for a mirrored row, and a
--   WITH CHECK cannot report WHICH conjunct refused. So: no conjunct of the
--   gate can be satisfied by a mirrored type.
--
-- Apply the fixture-quality rule and it is stark: make the mirror run as the
-- person instead of as its owner, and every probe except this one still
-- passes 100%. Measured 2026-09-15, and the route there corrected two things
-- the plan text got wrong about WHICH object carries the weight:
--
--   (1) SECURITY INVOKER on projects.project_rfi ALONE is INERT — 16/16 still
--       green. The trigger wrapper projects.mirror_rfi_work_item() is itself
--       SECURITY DEFINER, so the nested call runs as the wrapper's definer
--       (postgres) whatever project_rfi declares, and the wrapper's
--       `SET row_security TO 'off'` is still in force for the nested call.
--       project_rfi's own declaration is defence in depth for a future direct
--       caller; the backfill calls it as postgres. Task 16 Step 3's mutation
--       as written would have proved nothing.
--   (2) SECURITY INVOKER on the WRAPPER (with or without (1)) fails EARLY and
--       for the wrong reason: section G revokes EXECUTE on every function this
--       migration creates, so the invoker path dies on
--         ERROR: 42501: permission denied for function project_rfi
--       and then, once that one is granted, on
--         ERROR: 42501: permission denied for function work_item_status_for_mirror
--       The grants are a second, independent layer in front of the RLS one.
--   (3) The mutant that isolates RLS — both functions SECURITY INVOKER, no
--       `row_security off`, and `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA
--       projects TO authenticated` so nothing but the policies is left
--       standing — makes the contractor's ordinary `INSERT INTO projects.rfis`
--       fail with
--         ERROR: 42501: new row violates row-level security policy
--                "work_items_insert_gate" for table "work_items"
--       The message names work_items, not rfis: the refusal is item 2's spine
--       gate reaching back through the trigger onto the source statement.
--
-- With that same mutant stacked, probe 04 is 26/26, probe 05 22/22, probe 06
-- 25/25 and probe 07 39/39 — all GREEN. That contrast is the whole
-- justification for this file.
--
-- The identity is the permanent production fixture rbac-test@e-site.live
-- (018f2d31-bbe8-4cc1-bbdd-63af0187081e, contractor on WM-Consulting). It is
-- not a real user: never invite it, email it, or send it a notification.
-- Nothing here writes a bell or an email (§11 writes no notification; the
-- probe project sets no notify_* toggle and is rolled back).
--
-- Contract (probe 00's header): every id the setup needs is captured as
-- postgres BEFORE the first impersonation (Task 1 rule 3); each impersonating
-- block ends with EXECUTE 'RESET ROLE' + set_config('request.jwt.claims','',true)
-- and asserts auth.uid() IS NULL; exactly ONE row-producing statement and it is
-- the last. set_config(…, true) is TRANSACTION-local and outlives RESET ROLE,
-- which is why the claim is cleared explicitly between the two identities and
-- why `identity_cleared` is the FIRST assertion row.
--
-- THE FAILURE MODE THIS FILE EXISTS TO EXPOSE is a probe that silently ran as
-- postgres after all: it looks identical to one that worked, because postgres
-- bypasses every policy. Two assertions catch it — `insert_really_ran_as_
-- authenticated` records current_user from INSIDE the impersonated block, and
-- `contractor_cannot_write_that_row_by_hand` needs a refusal that only a
-- non-bypassing role can receive. Mutation-verified 2026-09-15: comment out
-- `EXECUTE 'SET LOCAL ROLE authenticated'` and the run is 14/16 with exactly
-- those two red ("Got: postgres, …" and "Got: <none> <no error>").
--
-- Every fixture RAISEs rather than skips (a NOTICE never reaches the
-- Management API caller). Every refusal asserts on MESSAGE content AND
-- SQLSTATE — an error is not evidence of the RIGHT error. Only the expected
-- condition is caught in each arm (insufficient_privilege for the RLS refusal,
-- raise_exception for the guard's sentence); any other error aborts the
-- transaction and surfaces verbatim as an API error. Each impersonated write
-- checks ROW_COUNT: an RLS USING that filters the row is a silent zero rows,
-- indistinguishable from a write that was allowed through.
--
-- Fixtures, and why each exists:
--   rfi_a  raised BY THE CONTRACTOR in their own authenticated session. This is
--          F9 itself: the mirror INSERT into work_items happens inside that
--          session. gatekeeper_rule = 'creator' (section C'), so the
--          contractor is its gatekeeper and the resolver chain hands the
--          ASSIGNEE to the project's triage owner / PM — a value the
--          contractor could not have written themselves.
--   rfi_b  raised by the org owner and assigned to the contractor AT THE
--          SOURCE during setup (service path), so it is `open` with the
--          contractor holding the ball and the OWNER as gatekeeper. It is the
--          only shape in which a contractor's close reaches the guard's (d)
--          rather than (c) — a fresh mirror is `triage`, and triage → closed
--          is refused by the machine, which would have measured nothing about
--          who may close.
--   diary  authored by the contractor in their own session, with a real delay,
--          then DELETEd by them through "Authors can delete their diary
--          entries" (00149:30-36) — the one delete-to-void path a person can
--          actually reach on this project (Task 18's DELETE-policy table).
--          Probe 11 seeds the entry as postgres; here the INSERT, the
--          projection and the DELETE all run under the contractor's identity.
--
-- ⚠ Two RFI inserts consume two values of projects.rfis_rfi_number_seq, which
-- a rollback does not return; scripts/db/rehearse-sql.ts restores the sequence
-- inside the transaction.
--
-- Expected: 16 rows. If the printed `assertions seen:` list is shorter than
-- sixteen names, a UNION ALL arm was dropped — read the list, not the total.

DO $setup$
DECLARE
  v_org  uuid := 'dddddddd-0000-0000-0000-000000000001';  -- WM-Consulting
  v_ctr  uuid := '018f2d31-bbe8-4cc1-bbdd-63af0187081e';  -- rbac-test, contractor
  v_pm   uuid; v_proj uuid; v_rfi_b uuid;
  v_row  record;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'fixture: setup must run as postgres with no claim (auth.uid() = %)', auth.uid();
  END IF;
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'fixture: setup must run as postgres (current_user = %)', current_user;
  END IF;

  SELECT u.user_id INTO v_pm FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role = 'owner' AND u.is_active
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_pm IS NULL THEN
    RAISE EXCEPTION 'fixture: WM-Consulting has no active owner in user_organisations (1 on 2026-09-15)';
  END IF;
  IF v_pm = v_ctr THEN
    RAISE EXCEPTION 'fixture: the org owner IS rbac-test — the governing and contractor actors would coincide';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_organisations u
                  WHERE u.user_id = v_ctr AND u.organisation_id = v_org
                    AND u.role = 'contractor' AND u.is_active) THEN
    RAISE EXCEPTION 'fixture: rbac-test is not an active contractor on WM-Consulting — the rfis INSERT policy (00027:42-46) needs organisation_id = ANY(get_user_org_ids())';
  END IF;

  -- status 'active', never 'payment_paused': 00145's diary INSERT policy
  -- refuses a paused project outright and the diary arm would measure nothing.
  INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
  VALUES (v_org, '_probe_rls_identity', 'active', 'ZAR', v_pm)
  RETURNING id INTO v_proj;   -- ensure_project_settings_row() fires here

  -- An org-level contractor has no EFFECTIVE role on a project they are not a
  -- member of (00107), and project_members.organisation_id is NOT NULL.
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active)
  VALUES (v_proj, v_ctr, v_org, 'contractor', true);
  IF public.user_effective_project_role(v_proj, v_ctr) IS DISTINCT FROM 'contractor' THEN
    RAISE EXCEPTION 'fixture: the contractor''s role is not effective on the probe project (got %)',
      public.user_effective_project_role(v_proj, v_ctr);
  END IF;
  IF COALESCE(public.user_effective_project_role(v_proj, v_pm), 'client_viewer')
     NOT IN ('owner','admin','project_manager') THEN
    RAISE EXCEPTION 'fixture: the org owner is not a governing actor on the probe project (got %)',
      public.user_effective_project_role(v_proj, v_pm);
  END IF;

  -- rfi_b: raised by the owner (so the OWNER is its gatekeeper under
  -- gatekeeper_rule = 'creator'), then assigned to the contractor at the
  -- SOURCE. The projection's un-triage rule moves it to open with the
  -- contractor as assignee, so the contractor's close below reaches clause (d)
  -- and not the status machine.
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description, priority, status, raised_by)
  VALUES (v_proj, v_org, 'Owner-raised, contractor-assigned', 'body', 'medium', 'open', v_pm)
  RETURNING id INTO v_rfi_b;
  UPDATE projects.rfis SET assigned_to = v_ctr WHERE id = v_rfi_b;

  SELECT w.status, w.assignee_id, w.gatekeeper_id, w.origin INTO v_row
    FROM projects.work_items w WHERE w.rfi_id = v_rfi_b AND w.origin = 'mirror';
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'fixture: rfi_b was not mirrored at all — is 00199 stacked with --with?';
  END IF;
  IF v_row.status <> 'open' OR v_row.assignee_id IS DISTINCT FROM v_ctr
     OR v_row.gatekeeper_id IS DISTINCT FROM v_pm THEN
    RAISE EXCEPTION 'fixture: rfi_b after source assignment is (%, assignee %, gatekeeper %) — expected (open, contractor, owner)',
      v_row.status, v_row.assignee_id, v_row.gatekeeper_id;
  END IF;

  CREATE TEMP TABLE rls_ctx(
    proj uuid, ctr uuid, pm uuid, rfi_b uuid,
    who text, ctr_uid uuid, pm_uid uuid,
    rfi_a uuid, a_item uuid, a_visible boolean,
    arm_access boolean, arm_assignee boolean, arm_gatekeeper boolean, arm_watcher boolean,
    ins_err text, ins_state text,
    close_err text, close_state text,
    subject_after text, subject_rows int,
    pm_close_rows int,
    diary uuid, diary_item uuid, diary_rows int
  ) ON COMMIT DROP;
  INSERT INTO rls_ctx (proj, ctr, pm, rfi_b) VALUES (v_proj, v_ctr, v_pm, v_rfi_b);
  -- A postgres temp table is unreadable after SET LOCAL ROLE (item 2, measured).
  GRANT SELECT, UPDATE ON rls_ctx TO authenticated;
END $setup$;

DO $as_contractor$
DECLARE
  c        record;
  v_rfi_a  uuid;
  v_item   uuid;
  v_diary  uuid;
  v_err    text; v_state text;
  v_n      int;
  v_a      boolean; v_b boolean; v_g boolean; v_w boolean;
  v_subj   text := 'RFI raised as a contractor — subject edited in the same session';
BEGIN
  SELECT * INTO c FROM rls_ctx;

  -- Become a real, non-privileged user. postgres holds rolbypassrls, so
  -- without these two lines every RLS policy in the database is inert here.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', c.ctr::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE rls_ctx SET who = current_user, ctr_uid = auth.uid();
  IF auth.uid() IS DISTINCT FROM c.ctr THEN
    RAISE EXCEPTION 'fixture: impersonation did not take — auth.uid() is %, expected the contractor', auth.uid();
  END IF;

  -- 1. THE ORDINARY ACT. A contractor raises an RFI on a project they belong
  --    to. The mirror then INSERTs into projects.work_items, which item 2
  --    gates with a RESTRICTIVE INSERT policy this session cannot satisfy
  --    (arm 5 below is the same session's proof). It only works because
  --    projects.project_rfi is SECURITY DEFINER with row_security off.
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                             priority, status, raised_by)
  VALUES (c.proj, (SELECT p.organisation_id FROM projects.projects p WHERE p.id = c.proj),
          'RFI raised as a contractor', 'body', 'medium', 'open', c.ctr)
  RETURNING id INTO v_rfi_a;
  UPDATE rls_ctx SET rfi_a = v_rfi_a;

  -- 2. Can they SEE the item their own act created, and through WHICH arm of
  --    work_items_select (00196:1107-1119)? Visibility alone says nothing:
  --    the policy has four independent arms and a reader needs to know which
  --    one is load-bearing before item 5/6 builds an inbox query on it.
  SELECT w.id INTO v_item FROM projects.work_items w
   WHERE w.rfi_id = v_rfi_a AND w.origin = 'mirror';
  UPDATE rls_ctx SET a_item = v_item, a_visible = (v_item IS NOT NULL);
  IF v_item IS NULL THEN
    RAISE EXCEPTION 'fixture: the contractor cannot see the mirror of the RFI they just raised — work_items_select admitted no arm, so arms 2-4 below cannot be measured';
  END IF;

  -- The four arms, evaluated exactly as the policy writes them.
  SELECT public.user_has_project_access(c.proj)
         AND COALESCE(public.user_effective_project_role(c.proj, auth.uid()), 'client_viewer')
             <> 'client_viewer'
    INTO v_a;
  SELECT w.assignee_id = auth.uid(), w.gatekeeper_id = auth.uid()
    INTO v_b, v_g
    FROM projects.work_items w WHERE w.id = v_item;
  SELECT EXISTS (SELECT 1 FROM projects.work_item_watchers w
                  WHERE w.work_item_id = v_item AND w.user_id = auth.uid())
    INTO v_w;
  UPDATE rls_ctx SET arm_access = v_a, arm_assignee = v_b,
                     arm_gatekeeper = v_g, arm_watcher = v_w;

  -- 3. THE COUNTERPART. The same session, doing by hand what the mirror just
  --    did for it: a mirrored-type item on the spine. Every CHECK is satisfied
  --    (origin 'split' keeps work_items_src_rfi_uidx out of the way and
  --    work_items_source_required is met by rfi_id), the BEFORE triggers fill
  --    ref and due_date, and the permissive work_items_insert passes — so the
  --    ONLY thing that can refuse this row is the RESTRICTIVE gate's
  --    item_type = 'task' arm. 42501, and the message names work_items.
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, origin, title,
       assignee_id, gatekeeper_id, created_by, rfi_id)
    VALUES ((SELECT p.organisation_id FROM projects.projects p WHERE p.id = c.proj),
            c.proj, 'rfi', 'split', 'hand-built mirror',
            c.ctr, c.ctr, c.ctr, v_rfi_a);
    v_err := '<no error>'; v_state := '<none>';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
  END;
  UPDATE rls_ctx SET ins_err = v_err, ins_state = v_state;

  -- 4. The contractor cannot CLOSE what they do not gatekeep. rfi_b is open,
  --    they hold the ball, the owner signs it off. (c) admits open → closed,
  --    so the clause that answers is (d) — and it is compared against
  --    auth.uid(), which inside a SECURITY DEFINER function is still them.
  BEGIN
    UPDATE projects.work_items SET status = 'closed' WHERE rfi_id = c.rfi_b AND origin = 'mirror';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_err := CASE WHEN v_n = 0 THEN '<no error, 0 rows: RLS USING filtered the row>' ELSE '<no error>' END;
    v_state := '<none>';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
  END;
  UPDATE rls_ctx SET close_err = v_err, close_state = v_state;

  -- 5. Their own later edit of the RFI's subject re-projects the title. The
  --    source write is admitted by "Org members can update rfis" (00027:47-51,
  --    org-scoped) and 00161's RESTRICTIVE client-viewer block passes them;
  --    the re-projection then runs at depth 2 and rides C''s exemption, which
  --    is the only reason (a2) does not refuse the title change.
  UPDATE projects.rfis SET subject = v_subj WHERE id = v_rfi_a;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE rls_ctx SET subject_after = v_subj, subject_rows = v_n;

  -- 6. The delete-to-void path a person can actually reach. The contractor
  --    authors the entry themselves — so the diary INSERT policy (00145:25-36)
  --    and the diary projection both run under their identity — and the delay
  --    text is one the stop-list treats as a real delay.
  INSERT INTO projects.site_diary_entries
    (project_id, organisation_id, entry_date, progress_notes, delays, created_by)
  VALUES (c.proj, (SELECT p.organisation_id FROM projects.projects p WHERE p.id = c.proj),
          DATE '2026-09-14', 'Second fix', 'Crane stood down 4h awaiting sparks', c.ctr)
  RETURNING id INTO v_diary;
  -- Captured BEFORE the delete: RI's ON DELETE SET NULL nulls diary_id, after
  -- which the item cannot be found from the source side at all.
  SELECT w.id INTO v_item FROM projects.work_items w
   WHERE w.diary_id = v_diary AND w.origin = 'mirror';
  UPDATE rls_ctx SET diary = v_diary, diary_item = v_item;
  IF v_item IS NULL THEN
    RAISE EXCEPTION 'fixture: the contractor''s diary entry with a real delay did not mirror';
  END IF;

  DELETE FROM projects.site_diary_entries WHERE id = v_diary;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE rls_ctx SET diary_rows = v_n;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'fixture: the impersonated delete touched % rows — "Authors can delete their diary entries" (00149:30-36) did not admit rbac-test', v_n;
  END IF;

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'fixture: the claim survived its clear (auth.uid() = %)', auth.uid();
  END IF;
END $as_contractor$;

DO $as_owner$
DECLARE
  c record; v_n int;
BEGIN
  SELECT * INTO c FROM rls_ctx;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', c.pm::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE rls_ctx SET pm_uid = auth.uid();
  IF auth.uid() IS DISTINCT FROM c.pm THEN
    RAISE EXCEPTION 'fixture: impersonation did not take — auth.uid() is %, expected the owner', auth.uid();
  END IF;

  -- 7. The same statement the contractor was refused in arm 4, by the person
  --    who signs the item off. Nothing about it is service-path: depth 1, a
  --    real claim, (d) satisfied because v_actor = NEW.gatekeeper_id. The
  --    guard stamps closed_at and closed_by := auth.uid() itself.
  UPDATE projects.work_items SET status = 'closed' WHERE rfi_id = c.rfi_b AND origin = 'mirror';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE rls_ctx SET pm_close_rows = v_n;

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'fixture: the claim survived its clear (auth.uid() = %)', auth.uid();
  END IF;
END $as_owner$;

SELECT 'identity_cleared' AS probe,
       current_user = 'postgres' AND auth.uid() IS NULL AS ok,
       'Task 1 rule 3: the claim is transaction-local and outlives RESET ROLE, so every assertion below is read as postgres with no identity' AS detail
UNION ALL
SELECT 'insert_really_ran_as_authenticated',
       (SELECT who = 'authenticated' AND ctr_uid = ctr AND pm_uid = pm FROM rls_ctx),
       'without this, a probe that silently fell back to postgres looks identical to one that worked. Got: ' ||
       (SELECT COALESCE(who, '<null>') || ', contractor uid ' || COALESCE(ctr_uid::text, '<null>')
               || ', owner uid ' || COALESCE(pm_uid::text, '<null>') FROM rls_ctx)
UNION ALL
SELECT 'contractor_rfi_insert_succeeded',
       (SELECT rfi_a IS NOT NULL FROM rls_ctx),
       'F9: as authenticated, not postgres — the whole point of SECURITY DEFINER on the mirror. (This row cannot print FAIL: a refused INSERT aborts the whole rehearsal, which is exactly how the stripped-definer mutant manifests. It is here to name the precondition the rows below depend on.)'
UNION ALL
SELECT 'item_was_projected_under_the_contractors_identity',
       (SELECT count(*) FROM projects.work_items w, rls_ctx c
         WHERE w.rfi_id = c.rfi_a AND w.origin = 'mirror') = 1,
       'the projection ran inside a signed-in session and still wrote projects.work_items'
UNION ALL
SELECT 'contractor_cannot_write_that_row_by_hand',
       (SELECT ins_state = '42501'
               AND ins_err LIKE '%row-level security policy%'
               AND ins_err LIKE '%work_items%' FROM rls_ctx),
       'item 2''s RESTRICTIVE INSERT gate (00196:1174-1196) refuses every mirrored type to a client session — the refusal names work_items, not rfis. Got: ' ||
       (SELECT COALESCE(ins_state, '<null>') || ' ' || COALESCE(ins_err, '<null>') FROM rls_ctx)
UNION ALL
SELECT 'holder_is_not_the_contractor',
       (SELECT w.assignee_id <> c.ctr FROM projects.work_items w, rls_ctx c
         WHERE w.rfi_id = c.rfi_a AND w.origin = 'mirror'),
       'the resolved holder is a value the contractor could not have written themselves'
UNION ALL
SELECT 'gatekeeper_is_the_contractor',
       (SELECT w.gatekeeper_id = c.ctr FROM projects.work_items w, rls_ctx c
         WHERE w.rfi_id = c.rfi_a AND w.origin = 'mirror'),
       'improvement 4 / gatekeeper_rule = creator: the raiser signs it off, and here the raiser is a contractor'
UNION ALL
-- ⚠ This row states FACTS the arms key on; it does not exercise the policy.
-- Measured (Task 16 review): stripping the assignee, gatekeeper and watcher
-- arms out of work_items_select entirely leaves this probe 16/16 and still
-- printing gatekeeper=true watcher=true — because project_access alone already
-- admits the reader, so the other arms are not load-bearing for the raiser and
-- cannot be isolated by this fixture. The half that carries weight is
-- NOT arm_assignee.
SELECT 'select_arm_facts_for_the_raiser',
       (SELECT arm_access AND NOT arm_assignee AND arm_gatekeeper AND arm_watcher FROM rls_ctx),
       'the raiser is NOT the assignee — items 5 and 6 must not build "my work" on assignee_id. project_access alone already admits them; this row pins the facts the arms key on, not which arm answers. Got: ' ||
       (SELECT 'project_access=' || COALESCE(arm_access::text, '<null>')
             || ' assignee=' || COALESCE(arm_assignee::text, '<null>')
             || ' gatekeeper=' || COALESCE(arm_gatekeeper::text, '<null>')
             || ' watcher=' || COALESCE(arm_watcher::text, '<null>') FROM rls_ctx)
UNION ALL
SELECT 'writeback_reached_the_source',
       (SELECT r.assigned_to IS NOT NULL AND r.assigned_to = w.assignee_id AND r.due_date = w.due_date
          FROM projects.rfis r, projects.work_items w, rls_ctx c
         WHERE r.id = c.rfi_a AND w.rfi_id = c.rfi_a AND w.origin = 'mirror'),
       'the write-back is SECURITY DEFINER too and bypasses the RLS on projects.rfis. Got: ' ||
       (SELECT COALESCE(r.assigned_to::text, '<null>') || ' due ' || COALESCE(r.due_date::text, '<null>')
          FROM projects.rfis r, rls_ctx c WHERE r.id = c.rfi_a)
UNION ALL
SELECT 'contractor_subject_edit_reprojects_the_title',
       (SELECT c.subject_rows = 1 AND w.title = c.subject_after
          FROM projects.work_items w, rls_ctx c WHERE w.rfi_id = c.rfi_a AND w.origin = 'mirror'),
       '(a2) would refuse a hand edit of a mirrored title at depth 1; the source edit re-projects at depth 2. Got: ' ||
       (SELECT COALESCE(c.subject_rows::text, '<null>') || ' row(s), title ' || COALESCE(w.title, '<null>')
          FROM projects.work_items w, rls_ctx c WHERE w.rfi_id = c.rfi_a AND w.origin = 'mirror')
UNION ALL
-- ⚠ Near-duplicate of 05b's direct_status_change_refused_for_non_gatekeeper
-- (same shape, same sentence, RFI seeded as postgres in both) — kept for a
-- readable narrative here, but it carries no identity increment over 05b. The
-- row BELOW it does: 05b has no close performed BY the gatekeeper at depth 1.
SELECT 'contractor_cannot_close_what_they_do_not_gatekeep',
       (SELECT close_state = 'P0001'
               AND close_err LIKE '%Only the person who signs%off can close it%' FROM rls_ctx),
       'clause (d), at depth 1, against auth.uid(). Got: ' ||
       (SELECT COALESCE(close_state, '<null>') || ' ' || COALESCE(close_err, '<null>') FROM rls_ctx)
UNION ALL
SELECT 'the_gatekeeper_can_close_it',
       (SELECT c.pm_close_rows = 1 AND w.status = 'closed' AND w.closed_by = c.pm
               AND w.closed_at IS NOT NULL
          FROM projects.work_items w, rls_ctx c WHERE w.rfi_id = c.rfi_b AND w.origin = 'mirror'),
       'the same statement, by the person the item points at: the guard stamps closed_by := auth.uid(). Got: ' ||
       (SELECT COALESCE(c.pm_close_rows::text, '<null>') || ' row(s), ' || w.status
               || ' by ' || COALESCE(w.closed_by::text, '<null>')
          FROM projects.work_items w, rls_ctx c WHERE w.rfi_id = c.rfi_b AND w.origin = 'mirror')
UNION ALL
SELECT 'contractor_diary_entry_mirrored',
       (SELECT c.diary_item IS NOT NULL AND w.item_type = 'diary_action'
               AND w.created_by = c.ctr AND w.title LIKE 'Delay 2026-09-14: Crane stood down%'
          FROM projects.work_items w, rls_ctx c WHERE w.id = c.diary_item),
       'a second source type projected under the same identity. Got: ' ||
       (SELECT COALESCE(w.title, '<null>') FROM projects.work_items w, rls_ctx c WHERE w.id = c.diary_item)
UNION ALL
SELECT 'authors_delete_voided_its_item',
       (SELECT c.diary_rows = 1 AND w.status = 'void' AND w.void_reason = 'source deleted'
               AND w.diary_id IS NULL
          FROM projects.work_items w, rls_ctx c WHERE w.id = c.diary_item),
       'BEFORE DELETE voids first, then RI SET NULL lands on a void row. Got: ' ||
       (SELECT w.status || ' / ' || COALESCE(w.void_reason, '<null>')
          FROM projects.work_items w, rls_ctx c WHERE w.id = c.diary_item)
UNION ALL
-- ⚠ Probe 11 already pins the voided actor (voided_event_actor_is_the_deleter,
-- same actor_role = 'contractor' check) on the service side. This probe's
-- increment is upstream of the assertion: the contractor AUTHORS the diary
-- entry in their own signed-in session, so the mirror runs inside that session
-- rather than under a postgres-seeded fixture.
SELECT 'voided_event_actor_is_the_contractor',
       (SELECT count(*) FROM projects.work_item_events e, rls_ctx c
         WHERE e.work_item_id = c.diary_item AND e.verb = 'voided'
           AND e.actor_id = c.ctr AND e.actor_role = 'contractor') = 1,
       'probe 11 pins this shape; here the deleter is a real session, not the service path. Got: ' ||
       (SELECT COALESCE(string_agg(e.verb || '/' || COALESCE(e.actor_id::text, '<null>')
                                   || '/' || COALESCE(e.actor_role, '<null>'), ', ' ORDER BY e.seq), '<none>')
          FROM projects.work_item_events e, rls_ctx c WHERE e.work_item_id = c.diary_item)
UNION ALL
SELECT 'source_row_is_gone',
       (SELECT NOT EXISTS (SELECT 1 FROM projects.site_diary_entries d, rls_ctx c WHERE d.id = c.diary)),
       'the DELETE completed: the void is what let work_items_source_required pass on the RI SET NULL';
