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
BEGIN
  -- ── Fixtures (as postgres) ────────────────────────────────────────────────
  INSERT INTO public.organisations (id, name) VALUES (v_org, 'solar-schedule-probe'), (v_org2, 'solar-schedule-probe-2');
  FOREACH u IN ARRAY ARRAY[v_admin, v_pm, v_con, v_viewer, v_nogrant, v_client, v_supplier, v_foreign, v_outsider] LOOP
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
    (v_outsider, v_org, 'contractor', TRUE), (v_foreign, v_org2, 'admin', TRUE);
  INSERT INTO projects.projects (id, organisation_id, name, created_by) VALUES
    (v_project, v_org, 'solar-schedule-probe', v_admin), (v_project2, v_org, 'solar-schedule-probe-2', v_admin);
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active) VALUES
    (v_project, v_con, v_org, 'contractor', TRUE), (v_project, v_viewer, v_org, 'contractor', TRUE),
    (v_project, v_nogrant, v_org, 'contractor', TRUE), (v_project, v_client, v_org, 'client_viewer', TRUE),
    (v_project, v_supplier, v_org, 'supplier', TRUE),
    (v_project2, v_con, v_org, 'contractor', TRUE), (v_project2, v_nogrant, v_org, 'contractor', TRUE),
    (v_project2, v_client, v_org, 'client_viewer', TRUE), (v_project2, v_supplier, v_org, 'supplier', TRUE);
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
    (v_project, v_con, 'edit'), (v_project, v_viewer, 'view'), (v_project2, v_con, 'edit');
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
  BEGIN
    UPDATE projects.work_items SET assignee_id = v_client WHERE id = v_qwi;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION 'allowed (% rows)', v_n USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE 'SOL01' THEN INSERT INTO _r VALUES ('direct_reassign_to_client_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('direct_reassign_to_client_REFUSED', false);
  END;
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
  BEGIN
    INSERT INTO solar.schedule_segments (task_id, start_date, end_date) VALUES (v_b, DATE '2026-10-01', DATE '2026-10-06');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('segment_outside_task_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('segment_outside_task_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.schedule_segments (task_id, start_date, end_date) VALUES (v_b, DATE '2026-10-06', DATE '2026-10-07');
    INSERT INTO solar.schedule_segments (task_id, start_date, end_date) VALUES (v_b, DATE '2026-10-07', DATE '2026-10-08');
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
  UPDATE solar.schedule_tasks SET progress = 50 WHERE project_id = v_project;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('viewer_update_affects_nothing', v_n = 0);
  DELETE FROM solar.schedule_tasks WHERE project_id = v_project;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('viewer_delete_affects_nothing', v_n = 0);
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

  -- ── 15. Lapse = hidden but kept (D-02) ────────────────────────────────────
  UPDATE billing.org_addon_subscriptions SET current_period_end = now() - interval '1 day' WHERE organisation_id = v_org;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_con::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM solar.schedule_tasks WHERE project_id = v_project;
  INSERT INTO _r VALUES ('lapsed_editor_reads_nothing', v_n = 0);
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
