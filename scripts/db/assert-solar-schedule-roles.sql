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
--
-- Owner decision Q4 (2026-09-28): a solar_task owner must be SOLAR-ELIGIBLE —
-- an active project member whose effective project role is neither
-- client_viewer nor supplier. Refused with SQLSTATE 'SOL01' on every path that
-- sets work_items.assignee_id (create RPC, update RPC, a direct UPDATE), and
-- the no-owner resolver chain skips an ineligible pick (section 5b).
--
-- Review round (sections 16-25 + lapse additions in 15), on project 3:
--   C1  without Solar Edit a solar_task work item takes only a status move by
--       its assignee/gatekeeper (42501 otherwise), also under lapse;
--   I1  solar_task rows invisible to suppliers / no-grant members / everyone
--       lapsed (assignee keeps their own); every non-solar row's visibility is
--       compared per user with 00196's own predicate evaluated as postgres;
--   I6  no direct INSERT/UPDATE/DELETE on schedule_tasks / schedule_segments;
--       reorder is Edit-gated and project-scoped;
--   Spec-I2  a My Work void removes the side row; baselines exclude it, older
--       baselines keep it with task_id NULL;  Spec-I4  create's gatekeeper_id;
--   I2  inspector-with-Edit behaviour (owner decision Q2) as documented in
--       00212 item 11;  M2  link UPDATE loop;  Spec-8  p_replace atomicity and
--       direct reassign to a supplier;  M12  candidate emails only for editors.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_org      UUID := gen_random_uuid();
  v_org2     UUID := gen_random_uuid();
  v_project  UUID := gen_random_uuid();
  v_project2 UUID := gen_random_uuid();
  v_admin    UUID := gen_random_uuid();   -- org admin: implicit edit_financials, grantor
  v_pm       UUID := gen_random_uuid();   -- org project manager, no Solar grant (Q4 positive control)
  v_con      UUID := gen_random_uuid();   -- contractor, EDIT grant
  v_viewer   UUID := gen_random_uuid();   -- contractor, VIEW grant
  v_nogrant  UUID := gen_random_uuid();   -- contractor, project member, no grant
  v_client   UUID := gen_random_uuid();   -- client_viewer
  v_supplier UUID := gen_random_uuid();   -- supplier, project member
  v_foreign  UUID := gen_random_uuid();   -- admin of another org
  v_outsider UUID := gen_random_uuid();   -- contractor of the org, NOT on the project
  v_insp     UUID := gen_random_uuid();   -- own-org inspector, EDIT grant on project 3 (I2: not in write_roles)
  v_project3 UUID := gen_random_uuid();   -- review-round project (sections 16-22)
  v_plain    UUID;                        -- a plain 'task' work item on project 3 (I1 control)
  v_s1 UUID; v_s2 UUID; v_s3 UUID; v_s4 UUID; v_n1 UUID;
  v_w1 UUID; v_w2 UUID; v_w3 UUID; v_w4 UUID; v_wn1 UUID;
  v_l2       UUID;
  v_exp      INT;
  v_n2       INT;
  v_map      JSONB;
  v_a        UUID;
  v_b        UUID;
  v_q        UUID;
  v_qwi      UUID;
  v_p2task   UUID;
  v_wi       RECORD;
  v_ts       TIMESTAMPTZ;
  v_n        INT;
  v_txt      TEXT;
  u          UUID;
  i          INT;
  v_users    UUID[];
  v_labels   TEXT[];
  v_ids      UUID[];                      -- non-solar work items on project 3 (18b control)
  v_sol      UUID[];                      -- solar_task work items (18b / 15)
  v_exp2     INT;
BEGIN
  -- ── Fixtures (as postgres) ────────────────────────────────────────────────
  INSERT INTO public.organisations (id, name) VALUES (v_org, 'solar-schedule-probe'), (v_org2, 'solar-schedule-probe-2');
  FOREACH u IN ARRAY ARRAY[v_admin, v_pm, v_con, v_viewer, v_nogrant, v_client, v_supplier, v_foreign, v_outsider, v_insp] LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'solar-schedule-probe-' || u || '@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  END LOOP;
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
    (v_admin, v_org, 'admin', TRUE), (v_pm, v_org, 'project_manager', TRUE),
    (v_con, v_org, 'contractor', TRUE), (v_viewer, v_org, 'contractor', TRUE),
    (v_nogrant, v_org, 'contractor', TRUE), (v_client, v_org, 'client_viewer', TRUE),
    (v_supplier, v_org, 'supplier', TRUE),
    (v_outsider, v_org, 'contractor', TRUE), (v_foreign, v_org2, 'admin', TRUE),
    (v_insp, v_org, 'inspector', TRUE);
  INSERT INTO projects.projects (id, organisation_id, name, created_by) VALUES
    (v_project, v_org, 'solar-schedule-probe', v_admin), (v_project2, v_org, 'solar-schedule-probe-2', v_admin),
    (v_project3, v_org, 'solar-schedule-probe-3', v_admin);
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active) VALUES
    (v_project, v_con, v_org, 'contractor', TRUE), (v_project, v_viewer, v_org, 'contractor', TRUE),
    (v_project, v_nogrant, v_org, 'contractor', TRUE), (v_project, v_client, v_org, 'client_viewer', TRUE),
    (v_project, v_supplier, v_org, 'supplier', TRUE),
    (v_project2, v_con, v_org, 'contractor', TRUE), (v_project2, v_nogrant, v_org, 'contractor', TRUE),
    (v_project2, v_client, v_org, 'client_viewer', TRUE), (v_project2, v_supplier, v_org, 'supplier', TRUE),
    (v_project3, v_con, v_org, 'contractor', TRUE), (v_project3, v_viewer, v_org, 'contractor', TRUE),
    (v_project3, v_nogrant, v_org, 'contractor', TRUE), (v_project3, v_client, v_org, 'client_viewer', TRUE),
    (v_project3, v_supplier, v_org, 'supplier', TRUE), (v_project3, v_insp, v_org, 'inspector', TRUE);
  -- I1 control: a plain 'task' on project 3, seeded as postgres before any
  -- impersonation. Its visibility must not change for anyone.
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, origin, title, status, assignee_id, gatekeeper_id, due_date, created_by)
  VALUES (v_org, v_project3, 'task', 'manual', 'Plain task', 'open', v_con, v_admin, DATE '2026-11-20', v_admin)
  RETURNING id INTO v_plain;
  INSERT INTO billing.org_addon_subscriptions (organisation_id, feature_key, status, amount_kobo, current_period_end)
  VALUES (v_org, 'solar', 'active', 199900, now() + interval '1 year');

  -- Q4 resolver premise: project 2's triage owner is a client viewer, which the
  -- spine's resolver accepts (00196 §7 does not exclude client_viewer). Both
  -- halves are asserted, so the fallback check below cannot pass vacuously.
  UPDATE projects.project_settings SET triage_owner_id = v_client WHERE project_id = v_project2;
  INSERT INTO _r VALUES ('fixture_resolver_picks_client_on_project2',
    projects.resolve_work_item_assignee(v_project2, 'solar_task', NULL) IS NOT DISTINCT FROM v_client);

  -- Grants, written by the grantor as 00207 requires.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO solar.project_access (project_id, user_id, level) VALUES
    (v_project, v_con, 'edit'), (v_project, v_viewer, 'view'), (v_project2, v_con, 'edit'),
    (v_project3, v_con, 'edit'), (v_project3, v_viewer, 'view'), (v_project3, v_insp, 'edit');
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

  -- ── 5b. Owner must be SOLAR-ELIGIBLE (Q4): not a client viewer or supplier ─
  -- All on project 2 (v_con holds Edit there), so project 1's counts below are untouched.
  v_users := ARRAY[v_client, v_supplier];
  v_labels := ARRAY['client', 'supplier'];
  FOR i IN 1..2 LOOP
    BEGIN
      PERFORM solar.schedule_create_tasks(v_project2,
        jsonb_build_array(jsonb_build_object('key', 'q', 'name', 'Owned by ' || v_labels[i], 'start', '2026-10-01', 'end', '2026-10-01', 'owner_id', v_users[i])),
        '[]'::jsonb, false);
      RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
    EXCEPTION
      WHEN SQLSTATE 'SOL01' THEN INSERT INTO _r VALUES ('create_owner_' || v_labels[i] || '_REFUSED', true);
      WHEN OTHERS THEN INSERT INTO _r VALUES ('create_owner_' || v_labels[i] || '_REFUSED', false);
    END;
  END LOOP;
  -- Positive controls: a contractor and a PM are accepted as owners.
  BEGIN
    v_map := solar.schedule_create_tasks(v_project2, jsonb_build_array(
        jsonb_build_object('key', 'c', 'name', 'Contractor-owned', 'start', '2026-10-01', 'end', '2026-10-02', 'owner_id', v_nogrant),
        jsonb_build_object('key', 'p', 'name', 'PM-owned', 'start', '2026-10-01', 'end', '2026-10-02', 'owner_id', v_pm)),
      '[]'::jsonb, false);
    v_q := (v_map->>'c')::uuid;
    SELECT work_item_id INTO v_qwi FROM solar.schedule_tasks WHERE id = v_q;
    INSERT INTO _r SELECT 'create_owner_contractor_accepted', EXISTS (SELECT 1 FROM projects.work_items WHERE id = v_qwi AND assignee_id = v_nogrant);
    INSERT INTO _r SELECT 'create_owner_pm_accepted', EXISTS (SELECT 1 FROM solar.schedule_tasks t
      JOIN projects.work_items wi ON wi.id = t.work_item_id WHERE t.id = (v_map->>'p')::uuid AND wi.assignee_id = v_pm);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('create_owner_contractor_accepted', false), ('create_owner_pm_accepted', false);
  END;
  -- Reassigning through the update RPC.
  FOR i IN 1..2 LOOP
    BEGIN
      PERFORM solar.schedule_update_tasks(v_project2, jsonb_build_array(jsonb_build_object('id', v_q, 'owner_id', v_users[i])));
      RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
    EXCEPTION
      WHEN SQLSTATE 'SOL01' THEN INSERT INTO _r VALUES ('reassign_owner_' || v_labels[i] || '_REFUSED', true);
      WHEN OTHERS THEN INSERT INTO _r VALUES ('reassign_owner_' || v_labels[i] || '_REFUSED', false);
    END;
  END LOOP;
  -- Reassigning with a direct UPDATE of the work item (My Work / PostgREST path).
  FOR i IN 1..2 LOOP
    BEGIN
      UPDATE projects.work_items SET assignee_id = v_users[i] WHERE id = v_qwi;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      RAISE EXCEPTION 'allowed (% rows)', v_n USING ERRCODE = 'P0001';
    EXCEPTION
      WHEN SQLSTATE 'SOL01' THEN INSERT INTO _r VALUES ('direct_reassign_to_' || v_labels[i] || '_REFUSED', true);
      WHEN OTHERS THEN INSERT INTO _r VALUES ('direct_reassign_to_' || v_labels[i] || '_REFUSED', false);
    END;
  END LOOP;
  BEGIN
    PERFORM solar.schedule_update_tasks(v_project2, jsonb_build_array(jsonb_build_object('id', v_q, 'owner_id', v_pm)));
    INSERT INTO _r SELECT 'reassign_owner_pm_accepted', EXISTS (SELECT 1 FROM projects.work_items WHERE id = v_qwi AND assignee_id = v_pm);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('reassign_owner_pm_accepted', false);
  END;
  -- No owner: the resolver would pick the client-viewer triage owner; the RPC
  -- skips an ineligible pick and falls back to the creator.
  BEGIN
    v_map := solar.schedule_create_tasks(v_project2,
      '[{"key":"r","name":"Unowned","start":"2026-10-01","end":"2026-10-01"}]'::jsonb, '[]'::jsonb, false);
    INSERT INTO _r SELECT 'unowned_skips_ineligible_triage_owner', EXISTS (SELECT 1 FROM solar.schedule_tasks t
      JOIN projects.work_items wi ON wi.id = t.work_item_id WHERE t.id = (v_map->>'r')::uuid AND wi.assignee_id = v_con);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('unowned_skips_ineligible_triage_owner', false);
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
  -- Through the create RPC (the only door since direct segment writes are
  -- revoked, I6); a refused create rolls back whole, so project 1's counts hold.
  BEGIN
    PERFORM solar.schedule_create_tasks(v_project, '[{"key":"so","name":"Seg outside","start":"2026-10-06","end":"2026-10-08",
      "segments":[{"start":"2026-10-01","end":"2026-10-06"},{"start":"2026-10-07","end":"2026-10-08"}]}]'::jsonb, '[]'::jsonb, false);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('segment_outside_task_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('segment_outside_task_REFUSED', false);
  END;
  BEGIN
    PERFORM solar.schedule_create_tasks(v_project, '[{"key":"sv","name":"Seg overlap","start":"2026-10-06","end":"2026-10-08",
      "segments":[{"start":"2026-10-06","end":"2026-10-07"},{"start":"2026-10-07","end":"2026-10-08"}]}]'::jsonb, '[]'::jsonb, false);
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
  -- I6: nobody holds direct write privileges on schedule_tasks any more.
  BEGIN
    UPDATE solar.schedule_tasks SET progress = 50 WHERE project_id = v_project;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('viewer_direct_task_update_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('viewer_direct_task_update_REFUSED', false);
  END;
  BEGIN
    DELETE FROM solar.schedule_tasks WHERE project_id = v_project;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('viewer_direct_task_delete_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('viewer_direct_task_delete_REFUSED', false);
  END;
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
  -- Q4: the picker offers only Solar-eligible owners (the same rule the write path enforces).
  INSERT INTO _r SELECT 'owner_candidates_exclude_client_and_supplier',
    EXISTS (SELECT 1 FROM solar.schedule_owner_candidates(v_project) c WHERE c.user_id = v_nogrant)
    AND NOT EXISTS (SELECT 1 FROM solar.schedule_owner_candidates(v_project) c WHERE c.user_id IN (v_client, v_supplier));

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

  -- ═══ Review round (sections 16-23), all on project 3 ══════════════════════
  -- ── 16. Fixtures: four tasks by the editor; s2 is split ──────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_con::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_map := solar.schedule_create_tasks(v_project3, jsonb_build_array(
      jsonb_build_object('key', 's1', 'name', 'Nogrant-owned', 'start', '2026-11-02', 'end', '2026-11-06', 'owner_id', v_nogrant),
      jsonb_build_object('key', 's2', 'name', 'Split task', 'start', '2026-11-02', 'end', '2026-11-06', 'owner_id', v_con,
        'segments', '[{"start":"2026-11-02","end":"2026-11-03"},{"start":"2026-11-05","end":"2026-11-06"}]'::jsonb),
      jsonb_build_object('key', 's3', 'name', 'To be voided', 'start', '2026-11-02', 'end', '2026-11-06', 'owner_id', v_con),
      jsonb_build_object('key', 's4', 'name', 'Inspector target', 'start', '2026-11-02', 'end', '2026-11-06', 'owner_id', v_con)),
    '[]'::jsonb, false);
  RESET ROLE;
  v_s1 := (v_map->>'s1')::uuid; v_s2 := (v_map->>'s2')::uuid; v_s3 := (v_map->>'s3')::uuid; v_s4 := (v_map->>'s4')::uuid;
  SELECT work_item_id INTO v_w1 FROM solar.schedule_tasks WHERE id = v_s1;
  SELECT work_item_id INTO v_w2 FROM solar.schedule_tasks WHERE id = v_s2;
  SELECT work_item_id INTO v_w3 FROM solar.schedule_tasks WHERE id = v_s3;
  SELECT work_item_id INTO v_w4 FROM solar.schedule_tasks WHERE id = v_s4;

  -- ── 17. Spec-I4: create honours an ELIGIBLE gatekeeper (undo of a delete) ─
  SET LOCAL ROLE authenticated;
  BEGIN
    v_map := solar.schedule_create_tasks(v_project3, jsonb_build_array(
        jsonb_build_object('key', 'g1', 'name', 'Undo PM', 'start', '2026-11-02', 'end', '2026-11-03', 'owner_id', v_con, 'gatekeeper_id', v_pm),
        jsonb_build_object('key', 'g2', 'name', 'Undo client', 'start', '2026-11-02', 'end', '2026-11-03', 'owner_id', v_con, 'gatekeeper_id', v_client),
        jsonb_build_object('key', 'g3', 'name', 'Undo done', 'start', '2026-11-02', 'end', '2026-11-03', 'owner_id', v_con, 'gatekeeper_id', v_pm, 'status', 'done')),
      '[]'::jsonb, false);
    INSERT INTO _r SELECT 'create_honours_eligible_gatekeeper', EXISTS (SELECT 1 FROM solar.schedule_tasks t
      JOIN projects.work_items wi ON wi.id = t.work_item_id WHERE t.id = (v_map->>'g1')::uuid AND wi.gatekeeper_id = v_pm);
    INSERT INTO _r SELECT 'create_ineligible_gatekeeper_falls_back_to_caller', EXISTS (SELECT 1 FROM solar.schedule_tasks t
      JOIN projects.work_items wi ON wi.id = t.work_item_id WHERE t.id = (v_map->>'g2')::uuid AND wi.gatekeeper_id = v_con);
    INSERT INTO _r SELECT 'create_done_with_other_gatekeeper_awaits_sign_off', EXISTS (SELECT 1 FROM solar.schedule_tasks t
      JOIN projects.work_items wi ON wi.id = t.work_item_id
     WHERE t.id = (v_map->>'g3')::uuid AND wi.gatekeeper_id = v_pm AND wi.status = 'answered' AND t.gantt_status = 'done');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('create_honours_eligible_gatekeeper', false), ('create_ineligible_gatekeeper_falls_back_to_caller', false),
                          ('create_done_with_other_gatekeeper_awaits_sign_off', false);
  END;
  RESET ROLE;

  -- ── 18. I1: solar_task rows are Solar data; every other item is unchanged ─
  -- Expected non-solar count = 00196's work_items_select predicate evaluated
  -- verbatim as postgres with the user's claim, so "unchanged" is measured
  -- against the spine's rule, not against a number typed here.
  v_users := ARRAY[v_supplier, v_nogrant, v_viewer, v_insp];
  v_labels := ARRAY['supplier', 'nogrant', 'viewer', 'inspector'];
  FOR i IN 1..4 LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_users[i]::text, 'role', 'authenticated')::text, true);
    SELECT count(*) INTO v_exp FROM projects.work_items wi
     WHERE wi.project_id = v_project3 AND wi.item_type <> 'solar_task'
       AND ( ( public.user_has_project_access(wi.project_id)
               AND COALESCE(public.user_effective_project_role(wi.project_id, auth.uid()), 'client_viewer') <> 'client_viewer' )
             OR wi.assignee_id = auth.uid() OR wi.gatekeeper_id = auth.uid()
             OR EXISTS (SELECT 1 FROM projects.work_item_watchers w WHERE w.work_item_id = wi.id AND w.user_id = auth.uid()));
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM projects.work_items WHERE project_id = v_project3 AND item_type <> 'solar_task';
    INSERT INTO _r VALUES (v_labels[i] || '_non_solar_items_unchanged', v_n = v_exp AND v_exp >= 1);
    RESET ROLE;
  END LOOP;
  SELECT count(*) INTO v_exp FROM projects.work_items WHERE project_id = v_project3 AND item_type = 'solar_task';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_supplier::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM projects.work_items WHERE project_id = v_project3 AND item_type = 'solar_task';
  INSERT INTO _r VALUES ('supplier_sees_no_solar_work_items', v_n = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_nogrant::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*), count(*) FILTER (WHERE id = v_w1) INTO v_n, v_n2 FROM projects.work_items WHERE project_id = v_project3 AND item_type = 'solar_task';
  INSERT INTO _r VALUES ('nogrant_sees_only_own_solar_work_item', v_n = 1 AND v_n2 = 1);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_viewer::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM projects.work_items WHERE project_id = v_project3 AND item_type = 'solar_task';
  INSERT INTO _r VALUES ('view_user_sees_every_solar_work_item', v_n = v_exp AND v_exp >= 7);
  RESET ROLE;

  -- ── 18b. I1 follow-through: a solar_task's EVENTS and WATCHERS are Solar data
  -- 00196's work_item_events_select / work_item_watchers_select / _insert gate
  -- on projects.user_can_read_work_item() — a definer, row_security-off helper
  -- that repeats 00196's permissive predicate, so section 18's RESTRICTIVE
  -- SELECT on work_items never reached them. Expected non-solar counts are
  -- that very helper evaluated as postgres with the user's claim.
  SELECT array_agg(id) INTO v_ids FROM projects.work_items WHERE project_id = v_project3 AND item_type <> 'solar_task';
  SELECT array_agg(id) INTO v_sol FROM projects.work_items WHERE project_id = v_project3 AND item_type = 'solar_task';
  SELECT count(*) INTO v_exp FROM projects.work_item_events WHERE work_item_id = ANY (v_sol);
  SELECT count(*) INTO v_n2 FROM projects.work_item_events WHERE work_item_id = v_w1;
  INSERT INTO _r VALUES ('fixture_solar_events_and_watchers_exist', v_exp >= 7 AND v_n2 >= 1
    AND EXISTS (SELECT 1 FROM projects.work_item_watchers WHERE work_item_id = v_w2 AND user_id = v_con)
    AND EXISTS (SELECT 1 FROM projects.work_item_events WHERE work_item_id = ANY (v_ids)));
  FOR i IN 1..4 LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_users[i]::text, 'role', 'authenticated')::text, true);
    SELECT count(*) INTO v_exp2 FROM projects.work_item_events
     WHERE work_item_id = ANY (v_ids) AND projects.user_can_read_work_item(work_item_id);
    SELECT count(*) INTO v_n FROM projects.work_item_watchers
     WHERE work_item_id = ANY (v_ids) AND projects.user_can_read_work_item(work_item_id);
    SET LOCAL ROLE authenticated;
    INSERT INTO _r SELECT v_labels[i] || '_non_solar_events_and_watchers_unchanged',
      v_exp2 >= 1 AND (SELECT count(*) FROM projects.work_item_events WHERE work_item_id = ANY (v_ids)) = v_exp2
      AND (SELECT count(*) FROM projects.work_item_watchers WHERE work_item_id = ANY (v_ids)) = v_n;
    RESET ROLE;
  END LOOP;
  -- supplier: nothing of any solar item, and cannot follow one.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_supplier::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r SELECT 'supplier_sees_no_solar_events_or_watchers',
    (SELECT count(*) FROM projects.work_item_events WHERE work_item_id = ANY (v_sol)) = 0
    AND (SELECT count(*) FROM projects.work_item_watchers WHERE work_item_id = ANY (v_sol)) = 0;
  BEGIN
    INSERT INTO projects.work_item_watchers (work_item_id, user_id, reason) VALUES (v_w2, v_supplier, 'manual');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('supplier_watch_solar_item_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('supplier_watch_solar_item_REFUSED', false);
  END;
  RESET ROLE;
  -- no-grant member: only the events of the item they are assigned (s1).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_nogrant::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r SELECT 'nogrant_sees_only_own_solar_item_events',
    (SELECT count(*) FROM projects.work_item_events WHERE work_item_id = ANY (v_sol)) = v_n2
    AND (SELECT count(*) FROM projects.work_item_events WHERE work_item_id = v_w1) = v_n2
    AND (SELECT count(*) FROM projects.work_item_watchers WHERE work_item_id = ANY (v_sol) AND work_item_id <> v_w1) = 0;
  BEGIN
    INSERT INTO projects.work_item_watchers (work_item_id, user_id, reason) VALUES (v_w2, v_nogrant, 'manual');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('nogrant_watch_solar_item_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('nogrant_watch_solar_item_REFUSED', false);
  END;
  -- A contractor is in solar_task's write set, so 00196's DELETE policy would let
  -- them drop someone else's watch; hidden rows match nothing. Rolled back by ZZ001.
  BEGIN
    DELETE FROM projects.work_item_watchers WHERE work_item_id = v_w2 AND user_id = v_con;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION 'rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION
    WHEN SQLSTATE 'ZZ001' THEN INSERT INTO _r VALUES ('nogrant_cannot_drop_a_solar_items_watcher', v_n = 0);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('nogrant_cannot_drop_a_solar_items_watcher', false);
  END;
  -- CONTROL: the same member may still follow a non-solar item (rolled back).
  BEGIN
    INSERT INTO projects.work_item_watchers (work_item_id, user_id, reason) VALUES (v_plain, v_nogrant, 'manual');
    RAISE EXCEPTION 'rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION
    WHEN SQLSTATE 'ZZ001' THEN INSERT INTO _r VALUES ('nogrant_may_still_watch_a_plain_task', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('nogrant_may_still_watch_a_plain_task', false);
  END;
  RESET ROLE;
  -- View user: every solar item's events and watchers, and may follow one.
  SELECT count(*) INTO v_exp2 FROM projects.work_item_watchers WHERE work_item_id = ANY (v_sol);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_viewer::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r SELECT 'view_user_sees_every_solar_event_and_watcher',
    (SELECT count(*) FROM projects.work_item_events WHERE work_item_id = ANY (v_sol)) = v_exp
    AND (SELECT count(*) FROM projects.work_item_watchers WHERE work_item_id = ANY (v_sol)) = v_exp2 AND v_exp2 >= 1;
  BEGIN
    INSERT INTO projects.work_item_watchers (work_item_id, user_id, reason) VALUES (v_w2, v_viewer, 'manual');
    RAISE EXCEPTION 'rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION
    WHEN SQLSTATE 'ZZ001' THEN INSERT INTO _r VALUES ('view_user_may_watch_a_solar_item', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('view_user_may_watch_a_solar_item', false);
  END;
  RESET ROLE;

  -- ── 19. C1: without Solar Edit a work-item write is a status move by the holder, nothing else
  -- v_nogrant: contractor (in solar_task write_roles), NO grant, assignee of s1.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_nogrant::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE projects.work_items SET title = 'Renamed without Edit' WHERE id = v_w1;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION 'allowed (% rows)', v_n USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('noedit_assignee_rename_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('noedit_assignee_rename_REFUSED', false);
  END;
  BEGIN
    UPDATE projects.work_items SET status = 'void', void_reason = 'not needed' WHERE id = v_w1;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION 'allowed (% rows)', v_n USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('noedit_assignee_void_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('noedit_assignee_void_REFUSED', false);
  END;
  BEGIN
    UPDATE projects.work_items SET due_date = due_date + 30 WHERE id = v_w1;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION 'allowed (% rows)', v_n USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('noedit_assignee_due_date_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('noedit_assignee_due_date_REFUSED', false);
  END;
  BEGIN
    UPDATE projects.work_items SET assignee_id = v_con WHERE id = v_w1;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION 'allowed (% rows)', v_n USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('noedit_assignee_reassign_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('noedit_assignee_reassign_REFUSED', false);
  END;
  BEGIN
    UPDATE projects.work_items SET priority = 'critical' WHERE id = v_w1;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION 'allowed (% rows)', v_n USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('noedit_assignee_priority_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('noedit_assignee_priority_REFUSED', false);
  END;
  -- Positive control: the holder still moves their own task forward.
  BEGIN
    UPDATE projects.work_items SET status = 'answered' WHERE id = v_w1;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r SELECT 'noedit_assignee_moves_own_task_forward', v_n = 1
      AND EXISTS (SELECT 1 FROM projects.work_items WHERE id = v_w1 AND status = 'answered' AND title = 'Nogrant-owned');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('noedit_assignee_moves_own_task_forward', false);
  END;
  -- A solar task they do not hold is not even visible to them (I1): nothing to write.
  BEGIN
    UPDATE projects.work_items SET title = 'Hijacked' WHERE id = v_w2;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('noedit_nonholder_update_affects_nothing', v_n = 0);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('noedit_nonholder_update_affects_nothing', false);
  END;
  RESET ROLE;
  -- v_viewer: contractor with a VIEW grant — sees s2 but may not write it.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_viewer::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE projects.work_items SET title = 'Renamed at View' WHERE id = v_w2;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION 'allowed (% rows)', v_n USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('view_user_rename_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('view_user_rename_REFUSED', false);
  END;
  BEGIN
    UPDATE projects.work_items SET status = 'answered' WHERE id = v_w2;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION 'allowed (% rows)', v_n USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('view_user_moves_unheld_task_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('view_user_moves_unheld_task_REFUSED', false);
  END;
  RESET ROLE;
  -- Positive controls: the editor renames through the RPC; the service path passes.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_con::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM solar.schedule_update_tasks(v_project3, jsonb_build_array(jsonb_build_object('id', v_s2, 'name', 'Split task renamed')));
    INSERT INTO _r SELECT 'editor_renames_via_rpc', EXISTS (SELECT 1 FROM projects.work_items WHERE id = v_w2 AND title = 'Split task renamed');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_renames_via_rpc', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE service_role;
  BEGIN
    UPDATE projects.work_items SET priority = 'high' WHERE id = v_w2;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('service_role_updates_solar_work_item', v_n = 1);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('service_role_updates_solar_work_item', false);
  END;
  RESET ROLE;

  -- ── 20. I6: schedule_tasks / schedule_segments are written only by the RPCs
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_con::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.schedule_tasks (work_item_id, project_id, start_date, end_date) VALUES (v_plain, v_project3, DATE '2026-11-02', DATE '2026-11-03');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('editor_direct_task_insert_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('editor_direct_task_insert_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.schedule_tasks SET end_date = end_date + 7 WHERE id = v_s4;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('editor_direct_task_update_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('editor_direct_task_update_REFUSED', false);
  END;
  BEGIN
    DELETE FROM solar.schedule_tasks WHERE id = v_s4;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('editor_direct_task_delete_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('editor_direct_task_delete_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.schedule_segments (task_id, start_date, end_date) VALUES (v_s4, DATE '2026-11-02', DATE '2026-11-03');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('editor_direct_segment_insert_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('editor_direct_segment_insert_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.schedule_segments SET end_date = start_date WHERE task_id = v_s2;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('editor_direct_segment_update_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('editor_direct_segment_update_REFUSED', false);
  END;
  BEGIN
    DELETE FROM solar.schedule_segments WHERE task_id = v_s2;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('editor_direct_segment_delete_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('editor_direct_segment_delete_REFUSED', false);
  END;
  -- Reorder through the RPC: positions 1..4, so exactly four rows move.
  BEGIN
    SELECT solar.schedule_reorder(v_project3, ARRAY[v_s4, v_s3, v_s2, v_s1]) INTO v_n;
    INSERT INTO _r SELECT 'editor_reorders_via_rpc', v_n = 4
      AND EXISTS (SELECT 1 FROM solar.schedule_tasks WHERE id = v_s4 AND sort_order = 1);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_reorders_via_rpc', false);
  END;
  -- A task id of ANOTHER project is ignored even by someone who can edit both.
  BEGIN
    SELECT sort_order INTO v_exp FROM solar.schedule_tasks WHERE id = v_q;
    SELECT solar.schedule_reorder(v_project3, ARRAY[v_q]) INTO v_n;
    INSERT INTO _r SELECT 'reorder_scoped_to_its_project', v_n = 0
      AND EXISTS (SELECT 1 FROM solar.schedule_tasks WHERE id = v_q AND sort_order = v_exp);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('reorder_scoped_to_its_project', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_viewer::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM solar.schedule_reorder(v_project3, ARRAY[v_s1, v_s2]);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('viewer_reorder_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('viewer_reorder_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_insp::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM solar.schedule_reorder(v_project2, ARRAY[v_q]);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('reorder_of_project_without_edit_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('reorder_of_project_without_edit_REFUSED', false);
  END;
  RESET ROLE;

  -- ── 21. M2: an UPDATE of an existing link may not close a loop ────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_con::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO solar.schedule_dependencies (predecessor_task_id, successor_task_id) VALUES (v_s1, v_s4);
  INSERT INTO solar.schedule_dependencies (predecessor_task_id, successor_task_id) VALUES (v_s4, v_s2) RETURNING id INTO v_l2;
  BEGIN
    UPDATE solar.schedule_dependencies SET successor_task_id = v_s1 WHERE id = v_l2;   -- s4 -> s1 with s1 -> s4
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('link_update_closing_loop_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('link_update_closing_loop_REFUSED', false);
  END;

  -- ── 22. Spec-I2: a void from outside the schedule (My Work) removes the bar ─
  BEGIN
    PERFORM solar.schedule_save_baseline(v_project3, 'P3 before void', NULL);
    UPDATE projects.work_items SET status = 'void', void_reason = 'Dropped from My Work' WHERE id = v_w3;
    PERFORM solar.schedule_save_baseline(v_project3, 'P3 after void', NULL);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('my_work_void_fixture', false);
  END;
  RESET ROLE;
  INSERT INTO _r SELECT 'my_work_void_removes_side_row',
    EXISTS (SELECT 1 FROM projects.work_items WHERE id = v_w3 AND status = 'void')
    AND NOT EXISTS (SELECT 1 FROM solar.schedule_tasks WHERE id = v_s3);
  INSERT INTO _r SELECT 'baseline_after_void_excludes_task',
    EXISTS (SELECT 1 FROM solar.schedule_baselines WHERE project_id = v_project3 AND name = 'P3 after void')
    AND NOT EXISTS (SELECT 1 FROM solar.schedule_baseline_tasks bt JOIN solar.schedule_baselines b ON b.id = bt.baseline_id
                     WHERE b.project_id = v_project3 AND b.name = 'P3 after void' AND bt.name = 'To be voided');
  INSERT INTO _r SELECT 'earlier_baseline_keeps_voided_task', EXISTS (SELECT 1 FROM solar.schedule_baseline_tasks bt
    JOIN solar.schedule_baselines b ON b.id = bt.baseline_id
   WHERE b.project_id = v_project3 AND b.name = 'P3 before void' AND bt.name = 'To be voided' AND bt.task_id IS NULL);

  -- ── 23. I2 (owner decision Q2): an own-org INSPECTOR with Solar Edit is NOT
  -- in solar_task's write_roles (MARKUP_WRITE_ROLES), so the spine refuses them
  -- work-item governance. Documented behaviour: moving a task they neither
  -- created nor sign off saves the Gantt dates and leaves the work item's
  -- due_date where it was (the RPC skips the mirror; the spine's (a4) would
  -- refuse it); deleting a task they do not hold is refused whole, with the
  -- spine's sentence.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_insp::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM solar.schedule_update_tasks(v_project3, jsonb_build_array(jsonb_build_object('id', v_s4, 'start', '2026-11-09', 'end', '2026-11-13')));
    INSERT INTO _r VALUES ('inspector_move_ran', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('inspector_move_ran', false);
  END;
  BEGIN
    PERFORM solar.schedule_delete_tasks(v_project3, ARRAY[v_s4]);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN raise_exception THEN INSERT INTO _r VALUES ('inspector_delete_unheld_REFUSED_with_sentence', SQLERRM LIKE 'Only the project team, or whoever is holding SOLAR-%, can drop it.');
    WHEN OTHERS THEN INSERT INTO _r VALUES ('inspector_delete_unheld_REFUSED_with_sentence', false);
  END;
  RESET ROLE;
  INSERT INTO _r SELECT 'inspector_move_saves_gantt_dates', EXISTS (SELECT 1 FROM solar.schedule_tasks
    WHERE id = v_s4 AND start_date = DATE '2026-11-09' AND end_date = DATE '2026-11-13');
  INSERT INTO _r SELECT 'inspector_move_leaves_due_date', EXISTS (SELECT 1 FROM projects.work_items WHERE id = v_w4 AND due_date = DATE '2026-11-06');
  INSERT INTO _r SELECT 'inspector_delete_refusal_is_atomic', EXISTS (SELECT 1 FROM solar.schedule_tasks t
    JOIN projects.work_items wi ON wi.id = t.work_item_id WHERE t.id = v_s4 AND wi.status = 'open');

  -- ── 24. M12: owner-picker emails only for editors ─────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_viewer::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*), count(*) FILTER (WHERE email IS NOT NULL) INTO v_n, v_n2 FROM solar.schedule_owner_candidates(v_project3);
  INSERT INTO _r VALUES ('view_user_owner_candidates_without_email', v_n > 0 AND v_n2 = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_con::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*), count(*) FILTER (WHERE email IS NOT NULL) INTO v_n, v_n2 FROM solar.schedule_owner_candidates(v_project3);
  INSERT INTO _r VALUES ('editor_owner_candidates_with_email', v_n > 0 AND v_n2 = v_n);

  -- ── 25. Spec-8: p_replace is one transaction ──────────────────────────────
  SELECT count(*) INTO v_exp FROM solar.schedule_tasks WHERE project_id = v_project3;
  SELECT count(*) INTO v_n2 FROM projects.work_items WHERE project_id = v_project3 AND item_type = 'solar_task' AND status = 'void';
  BEGIN
    PERFORM solar.schedule_create_tasks(v_project3, jsonb_build_array(
        jsonb_build_object('key', 'n1', 'name', 'New one', 'start', '2026-12-01', 'end', '2026-12-02', 'owner_id', v_con),
        jsonb_build_object('key', 'n2', 'name', '   ', 'start', '2026-12-01', 'end', '2026-12-02')),
      '[]'::jsonb, true);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN invalid_parameter_value THEN INSERT INTO _r VALUES ('replace_with_failing_row_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('replace_with_failing_row_REFUSED', false);
  END;
  SELECT count(*) INTO v_n FROM solar.schedule_tasks WHERE project_id = v_project3;
  INSERT INTO _r SELECT 'replace_failure_leaves_old_tasks', v_n = v_exp AND v_exp >= 6
    AND (SELECT count(*) FROM projects.work_items WHERE project_id = v_project3 AND item_type = 'solar_task' AND status = 'void') = v_n2;
  BEGIN
    v_map := solar.schedule_create_tasks(v_project3, jsonb_build_array(
        jsonb_build_object('key', 'n1', 'name', 'New one', 'start', '2026-12-01', 'end', '2026-12-02', 'owner_id', v_con)),
      '[]'::jsonb, true);
    v_n1 := (v_map->>'n1')::uuid;
    SELECT work_item_id INTO v_wn1 FROM solar.schedule_tasks WHERE id = v_n1;
    INSERT INTO _r SELECT 'replace_voids_old_and_inserts_new',
      (SELECT count(*) FROM solar.schedule_tasks WHERE project_id = v_project3) = 1
      AND NOT EXISTS (SELECT 1 FROM projects.work_items WHERE project_id = v_project3 AND item_type = 'solar_task'
                       AND status <> 'void' AND id <> v_wn1)
      AND EXISTS (SELECT 1 FROM projects.work_items WHERE id = v_wn1 AND status = 'open');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('replace_voids_old_and_inserts_new', false);
  END;
  RESET ROLE;

  -- ── 15. Lapse = hidden but kept (D-02) ────────────────────────────────────
  UPDATE billing.org_addon_subscriptions SET current_period_end = now() - interval '1 day' WHERE organisation_id = v_org;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_con::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM solar.schedule_tasks WHERE project_id = v_project;
  INSERT INTO _r VALUES ('lapsed_editor_reads_nothing', v_n = 0);
  -- C1 under lapse: the Edit grant is dormant, so a direct rename of a task
  -- they hold (visible to them as its assignee) is refused.
  BEGIN
    UPDATE projects.work_items SET title = 'Renamed while lapsed' WHERE id = v_wn1;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION 'allowed (% rows)', v_n USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('lapsed_editor_direct_rename_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('lapsed_editor_direct_rename_REFUSED', false);
  END;
  RESET ROLE;
  -- I1 under lapse: a View user sees no solar work items at all, nor their
  -- events; the assignee still sees their own item's events (ids as postgres).
  SELECT array_agg(id) INTO v_sol FROM projects.work_items WHERE project_id IN (v_project, v_project3) AND item_type = 'solar_task';
  SELECT count(*) INTO v_exp2 FROM projects.work_item_events WHERE work_item_id = v_wn1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_viewer::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM projects.work_items WHERE project_id IN (v_project, v_project3) AND item_type = 'solar_task';
  INSERT INTO _r VALUES ('lapsed_view_user_sees_no_solar_work_items', v_n = 0);
  SELECT count(*) INTO v_n FROM projects.work_item_events WHERE work_item_id = ANY (v_sol);
  INSERT INTO _r VALUES ('lapsed_view_user_sees_no_solar_events', v_n = 0 AND cardinality(v_sol) >= 2);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_con::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM projects.work_item_events WHERE work_item_id = v_wn1;
  INSERT INTO _r VALUES ('lapsed_assignee_sees_own_solar_item_events', v_n = v_exp2 AND v_exp2 >= 1);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_con::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
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
