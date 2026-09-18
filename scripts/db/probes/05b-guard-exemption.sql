-- Probe 05b — the transition guard's depth-scoped exemption, under IMPERSONATION.
--
-- Runs the RFI mirror in a SIGNED-IN session, which is the only place item 2's
-- guard can refuse it (F8): a mirror trigger runs in the source writer's
-- session, where auth.uid() is a person, and item 2's guard exempted only
-- auth.uid() IS NULL (00196:1540). Probe 04 runs as postgres — the service path
-- — and cannot see any of this. Section C' of 00202 replaces the guard with
--   IF v_actor IS NULL OR pg_trigger_depth() > 1 THEN …
-- and adds source_status to clause (a). This file is the evidence for both.
--
-- rbac-test (contractor on WM-Consulting) is the permanent prod fixture —
-- never invite, email or notify it. The org owner plays the governing actor.
--
-- Contract (probe 00's header): every id is captured as postgres BEFORE the
-- first impersonation (Task 1 rule 3); each impersonating block ends with
-- RESET ROLE + a cleared claim; exactly ONE row-producing statement, last.
-- set_config(…, true) is TRANSACTION-local and outlives RESET ROLE — hence
-- the explicit clear, and `claim_cleared` at the end.
--
-- Every fixture RAISEs rather than skips: a NOTICE never reaches the
-- Management API caller, and a skipped fixture is a probe that cannot fail.
-- Each impersonated source UPDATE checks ROW_COUNT — an RLS USING that filters
-- the row is a silent zero rows, which would otherwise be indistinguishable
-- from a guard that let it through. Only `raise_exception` (P0001, the guard's
-- ERRCODE) is caught in the direct-edit arms: any other error (23505, 42501,
-- 23514) aborts the transaction and surfaces verbatim as an API error.
--
-- Fixtures: three RFIs. rfi1 and rfi2 are raised by the contractor (born
-- triage, gatekeeper = the raiser under gatekeeper_rule = 'creator'). rfi3 is
-- raised by the PM and assigned to the contractor AT THE SOURCE during setup
-- (service path): the source assignment un-triages it, so it is `open` with
-- the contractor holding the ball and the PM as gatekeeper — the one shape in
-- which a contractor's direct close reaches clause (d) rather than (c).
--
-- ⚠ The three RFI inserts consume three values of projects.rfis_rfi_number_seq,
-- which a rollback does not return (probe 04's caveat; Task 15 restores it).
--
-- Expected: 9 rows. If the printed `assertions seen:` list is shorter than
-- nine names, a UNION ALL arm was dropped — read the list, not the total.
DO $setup$
DECLARE
  v_org  uuid := 'dddddddd-0000-0000-0000-000000000001';  -- WM-Consulting
  v_ctr  uuid := '018f2d31-bbe8-4cc1-bbdd-63af0187081e';  -- rbac-test, contractor
  v_pm   uuid; v_proj uuid; v_rfi1 uuid; v_rfi2 uuid; v_rfi3 uuid;
  v_n    int;
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
    RAISE EXCEPTION 'fixture: WM-Consulting has no active owner in user_organisations (1 on 2026-09-13)';
  END IF;
  IF v_pm = v_ctr THEN
    RAISE EXCEPTION 'fixture: the org owner IS rbac-test — the governing and contractor actors would coincide';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_organisations u
                  WHERE u.user_id = v_ctr AND u.organisation_id = v_org
                    AND u.role = 'contractor' AND u.is_active) THEN
    RAISE EXCEPTION 'fixture: rbac-test is not an active contractor on WM-Consulting';
  END IF;

  INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
  VALUES (v_org, '_probe_guard', 'active', 'ZAR', v_pm)
  RETURNING id INTO v_proj;   -- ensure_project_settings_row() fires here

  -- An org-level contractor has no effective role on a project they are not a
  -- member of (00107); project_members.organisation_id is NOT NULL.
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

  -- Seeded as postgres (service path): all three born triage.
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description, priority, status, raised_by)
  VALUES (v_proj, v_org, 'Guard probe 1', 'body', 'medium', 'open', v_ctr) RETURNING id INTO v_rfi1;
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description, priority, status, raised_by)
  VALUES (v_proj, v_org, 'Guard probe 2', 'body', 'medium', 'open', v_ctr) RETURNING id INTO v_rfi2;
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description, priority, status, raised_by)
  VALUES (v_proj, v_org, 'Guard probe 3', 'body', 'medium', 'open', v_pm)  RETURNING id INTO v_rfi3;

  SELECT count(*) INTO v_n FROM projects.work_items w WHERE w.rfi_id IN (v_rfi1, v_rfi2, v_rfi3);
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'fixture: expected 3 mirrored items, found % — is 00202 stacked with --with?', v_n;
  END IF;
  FOR v_row IN
    SELECT w.rfi_id, w.status, w.gatekeeper_id, w.origin, r.raised_by
      FROM projects.work_items w JOIN projects.rfis r ON r.id = w.rfi_id
     WHERE w.rfi_id IN (v_rfi1, v_rfi2, v_rfi3)
  LOOP
    IF v_row.origin <> 'mirror' OR v_row.status <> 'triage' THEN
      RAISE EXCEPTION 'fixture: a fresh RFI mirror is not (mirror, triage) — got (%, %)', v_row.origin, v_row.status;
    END IF;
    IF v_row.gatekeeper_id IS DISTINCT FROM v_row.raised_by THEN
      RAISE EXCEPTION 'fixture: the mirror''s gatekeeper (%) is not the raiser (%) — improvement 4 / gatekeeper_rule = creator is not in force',
        v_row.gatekeeper_id, v_row.raised_by;
    END IF;
  END LOOP;

  -- rfi3: assigned to the contractor at the SOURCE, on the service path. The
  -- projection's un-triage rule (probe 04 source_assignment_untriages_item)
  -- moves it to open with the contractor as assignee and the PM (its raiser)
  -- still the gatekeeper. Pinned here so the (d) arm below measures the guard,
  -- not the fixture.
  UPDATE projects.rfis SET assigned_to = v_ctr WHERE id = v_rfi3;
  SELECT w.status, w.assignee_id, w.gatekeeper_id, w.ball_in_court_id INTO v_row
    FROM projects.work_items w WHERE w.rfi_id = v_rfi3;
  IF v_row.status <> 'open' OR v_row.assignee_id IS DISTINCT FROM v_ctr
     OR v_row.gatekeeper_id IS DISTINCT FROM v_pm THEN
    RAISE EXCEPTION 'fixture: rfi3 after source assignment is (%, assignee %, gatekeeper %) — expected (open, contractor, PM)',
      v_row.status, v_row.assignee_id, v_row.gatekeeper_id;
  END IF;

  CREATE TEMP TABLE gd_ctx(
    proj uuid, ctr uuid, pm uuid, rfi1 uuid, rfi2 uuid, rfi3 uuid,
    who text, ctr_uid uuid, pm_uid uuid,
    resp_status text, title_err text, src_status_err text, close_err text,
    close_status text, close_by uuid,
    pm_close_status text, pm_gate uuid, pm_gate_err text
  ) ON COMMIT DROP;
  INSERT INTO gd_ctx (proj, ctr, pm, rfi1, rfi2, rfi3)
  VALUES (v_proj, v_ctr, v_pm, v_rfi1, v_rfi2, v_rfi3);
  -- A postgres temp table is unreadable after SET LOCAL ROLE (item 2, measured).
  GRANT SELECT, UPDATE ON gd_ctx TO authenticated;
END $setup$;

DO $as_contractor$
DECLARE
  c record; v_err text; v_status text; v_by uuid; v_n int;
BEGIN
  SELECT * INTO c FROM gd_ctx;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', c.ctr::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE gd_ctx SET who = current_user, ctr_uid = auth.uid();
  IF auth.uid() IS DISTINCT FROM c.ctr THEN
    RAISE EXCEPTION 'fixture: impersonation did not take — auth.uid() is %, expected the contractor', auth.uid();
  END IF;

  -- 1. The contractor responds to their own UNTRIAGED RFI: triage → answered
  --    through the mirror, at depth 2. Clause (c) forbids triage→answered for
  --    a client; the exemption must let the trigger-driven UPDATE through.
  --    Without it the refusal lands HERE, on the RFI respond (F8).
  UPDATE projects.rfis SET status = 'responded' WHERE id = c.rfi1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'fixture: the contractor''s respond touched % rows of projects.rfis — RLS filtered it, the guard was never reached', v_n;
  END IF;
  SELECT w.status INTO v_status FROM projects.work_items w WHERE w.rfi_id = c.rfi1;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'fixture: the contractor cannot see the mirror row under work_items_select';
  END IF;
  UPDATE gd_ctx SET resp_status = v_status;

  -- 2. The same contractor edits the mirror row DIRECTLY: still refused. This
  --    is the assertion that proves the exemption is depth-scoped and not
  --    `> 0`: a client statement is depth 1 and (a2) still bites.
  BEGIN
    UPDATE projects.work_items SET title = 'hand edit' WHERE rfi_id = c.rfi1;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_err := CASE WHEN v_n = 0 THEN '<no error, 0 rows: RLS USING filtered the row>' ELSE '<no error>' END;
  EXCEPTION WHEN raise_exception THEN v_err := SQLERRM; END;
  UPDATE gd_ctx SET title_err = v_err;

  -- 3. source_status is now in clause (a): a direct edit is refused too.
  BEGIN
    UPDATE projects.work_items SET source_status = 'hacked' WHERE rfi_id = c.rfi1;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_err := CASE WHEN v_n = 0 THEN '<no error, 0 rows: RLS USING filtered the row>' ELSE '<no error>' END;
  EXCEPTION WHEN raise_exception THEN v_err := SQLERRM; END;
  UPDATE gd_ctx SET src_status_err = v_err;

  -- 4. A NON-GATEKEEPER's direct close: rfi3 is open, the contractor holds the
  --    ball, the PM is the gatekeeper. (c) admits open→closed, so the clause
  --    that answers is (d) — the exemption did not open the close gate to a
  --    depth-1 client.
  BEGIN
    UPDATE projects.work_items SET status = 'closed' WHERE rfi_id = c.rfi3;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_err := CASE WHEN v_n = 0 THEN '<no error, 0 rows: RLS USING filtered the row>' ELSE '<no error>' END;
  EXCEPTION WHEN raise_exception THEN v_err := SQLERRM; END;
  UPDATE gd_ctx SET close_err = v_err;

  -- 5. The raiser (= gatekeeper) closes through the source. Under the
  --    exemption the guard stamps closed_at := now() and keeps the closed_by
  --    the mirror supplied (00196:1540-1547 — the service-path treatment).
  UPDATE projects.rfis SET status = 'closed', closed_at = now(), closed_by = c.ctr WHERE id = c.rfi1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'fixture: the contractor''s close touched % rows of projects.rfis — RLS filtered it', v_n;
  END IF;
  SELECT w.status, w.closed_by INTO v_status, v_by FROM projects.work_items w WHERE w.rfi_id = c.rfi1;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'fixture: the contractor cannot see the closed mirror row under work_items_select';
  END IF;
  UPDATE gd_ctx SET close_status = v_status, close_by = v_by;

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'fixture: the claim survived its clear (auth.uid() = %)', auth.uid();
  END IF;
END $as_contractor$;

DO $as_pm$
DECLARE
  c record; v_status text; v_gate uuid; v_err text; v_n int;
BEGIN
  SELECT * INTO c FROM gd_ctx;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', c.pm::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE gd_ctx SET pm_uid = auth.uid();
  IF auth.uid() IS DISTINCT FROM c.pm THEN
    RAISE EXCEPTION 'fixture: impersonation did not take — auth.uid() is %, expected the PM', auth.uid();
  END IF;

  -- 6. The PM closes an RFI they did NOT raise, through the RFI module's own
  --    path. Clause (d) would refuse a non-gatekeeper close on the spine; the
  --    module already gated the source write, and the mirror follows at depth 2.
  UPDATE projects.rfis SET status = 'closed', closed_at = now(), closed_by = c.pm WHERE id = c.rfi2;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'fixture: the PM''s close touched % rows of projects.rfis — RLS filtered it', v_n;
  END IF;
  SELECT w.status INTO v_status FROM projects.work_items w WHERE w.rfi_id = c.rfi2;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'fixture: the PM cannot see the mirror row under work_items_select';
  END IF;
  UPDATE gd_ctx SET pm_close_status = v_status;

  -- 7. A GOVERNED direct write still works: the PM re-seats rfi3's gatekeeper
  --    on the spine, directly, at depth 1. Clause (b) admits a governing actor
  --    in any live state; the exemption narrowed nothing for a client that
  --    was already allowed.
  BEGIN
    UPDATE projects.work_items SET gatekeeper_id = c.ctr WHERE rfi_id = c.rfi3;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_err := CASE WHEN v_n = 0 THEN '<no error, 0 rows: RLS USING filtered the row>' ELSE '<no error>' END;
  EXCEPTION WHEN raise_exception THEN v_err := SQLERRM; END;
  SELECT w.gatekeeper_id INTO v_gate FROM projects.work_items w WHERE w.rfi_id = c.rfi3;
  UPDATE gd_ctx SET pm_gate = v_gate, pm_gate_err = v_err;

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'fixture: the claim survived its clear (auth.uid() = %)', auth.uid();
  END IF;
END $as_pm$;

SELECT 'ran_as_authenticated' AS probe,
       (SELECT who = 'authenticated' AND ctr_uid = ctr AND pm_uid = pm FROM gd_ctx) AS ok,
       'without this a probe that silently stayed postgres is indistinguishable from one that worked' AS detail
UNION ALL
SELECT 'contractor_respond_pushed_back',
       (SELECT resp_status = 'answered' FROM gd_ctx),
       'F8: triage → answered through the mirror in a signed-in session. Without the exemption item 2''s (c) refuses it ON THE RFI RESPOND. Got: ' || (SELECT COALESCE(resp_status, '<null>') FROM gd_ctx)
UNION ALL
SELECT 'direct_title_edit_refused',
       (SELECT title_err LIKE '%mirrored from its source record%' FROM gd_ctx),
       'the exemption is depth-scoped: a client statement is depth 1 and (a2) still bites. Got: ' || (SELECT title_err FROM gd_ctx)
UNION ALL
SELECT 'direct_source_status_edit_refused',
       (SELECT src_status_err LIKE '%cannot be renumbered, retyped or moved%' FROM gd_ctx),
       'source_status joined clause (a) (00196:1600-1605 books it here). Got: ' || (SELECT src_status_err FROM gd_ctx)
UNION ALL
SELECT 'direct_status_change_refused_for_non_gatekeeper',
       (SELECT close_err LIKE '%Only the person who signs%off can close it%' FROM gd_ctx),
       '(d) still answers a depth-1 close by the holder who is not the gatekeeper. Got: ' || (SELECT close_err FROM gd_ctx)
UNION ALL
SELECT 'raiser_close_pushed_back',
       (SELECT close_status = 'closed' AND close_by = ctr FROM gd_ctx),
       'the raiser-gatekeeper closes through the source; closed_by is what the mirror supplied. Got: ' || (SELECT COALESCE(close_status, '<null>') || ' by ' || COALESCE(close_by::text, '<null>') FROM gd_ctx)
UNION ALL
SELECT 'pm_close_through_source_succeeds',
       (SELECT pm_close_status = 'closed' FROM gd_ctx),
       'a non-gatekeeper close through the module''s own path is followed by the spine; (d) is skipped at depth 2. Got: ' || (SELECT COALESCE(pm_close_status, '<null>') FROM gd_ctx)
UNION ALL
SELECT 'governed_direct_write_still_works',
       (SELECT pm_gate = ctr AND pm_gate_err = '<no error>' FROM gd_ctx),
       'clause (b): the PM re-seats an open item''s gatekeeper directly at depth 1 — the exemption narrowed nothing for a governing client. Got: ' || (SELECT pm_gate_err || ', gatekeeper ' || COALESCE(pm_gate::text, '<null>') FROM gd_ctx)
UNION ALL
SELECT 'claim_cleared',
       current_user = 'postgres' AND auth.uid() IS NULL,
       'Task 1 rule 3: the claim is transaction-local and must be cleared before the assertion SELECT';
