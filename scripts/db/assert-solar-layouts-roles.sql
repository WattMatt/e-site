-- BEHAVIOURAL assertions for 00212_solar_layouts, run as real roles.
--   S=$(mktemp -d)
--   cat apps/edge-functions/supabase/migrations/00208_solar_foundation.sql \
--       apps/edge-functions/supabase/migrations/00209_solar_org_settings.sql > "$S/base.sql"
--   scripts/db/dry-run-migration.sh "$S/base.sql" scripts/db/assert-solar-layouts-roles.sql          (expect RED)
--   cat "$S/base.sql" apps/edge-functions/supabase/migrations/00212_solar_layouts.sql > "$S/combo.sql"
--   scripts/db/dry-run-migration.sh "$S/combo.sql" scripts/db/assert-solar-layouts-roles.sql         (expect GREEN)
-- (Once 00208/00209 are in the ledger, use 00212 alone and /tmp/noop.sql for the red run.)
-- Fixtures are minted inside the transaction and rolled back; WM-Consulting is
-- not used (it bypasses the paywall, so it has no negative case).
-- REFUSAL PATTERN (as 00208's file): a "…_REFUSED" check catches only the
-- SQLSTATE the design promises; if the statement is wrongly allowed the block
-- raises P0001 itself so the write is rolled back and later checks still run.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_org     UUID := gen_random_uuid();
  v_org2    UUID := gen_random_uuid();
  v_p1      UUID := gen_random_uuid();
  v_p2      UUID := gen_random_uuid();
  v_admin   UUID := gen_random_uuid();   -- org admin: grantor, implicit edit_financials
  v_editor  UUID := gen_random_uuid();   -- contractor with an EDIT grant on P1
  v_viewer  UUID := gen_random_uuid();   -- project_manager with a VIEW grant on P1
  v_nogrant UUID := gen_random_uuid();   -- contractor, project member, no grant
  v_client  UUID := gen_random_uuid();   -- client_viewer on P1
  v_foreign UUID := gen_random_uuid();   -- admin of another org
  v_fp1     UUID := gen_random_uuid();   -- P1 drawing, page 1 scale 50 px/m, page 2 scale 25
  v_fp2     UUID := gen_random_uuid();   -- P2 drawing
  v_fp3     UUID := gen_random_uuid();   -- P1 drawing, uncalibrated
  v_node1   UUID := gen_random_uuid();
  v_node2   UUID := gen_random_uuid();
  v_s1      UUID := gen_random_uuid();
  v_s2      UUID := gen_random_uuid();
  v_rs1     UUID := gen_random_uuid();
  v_rs2     UUID := gen_random_uuid();
  v_rs3     UUID := gen_random_uuid();
  v_rs_p2   UUID := gen_random_uuid();
  v_l1      UUID := gen_random_uuid();
  v_l2      UUID := gen_random_uuid();
  v_l3      UUID := gen_random_uuid();
  v_l_p2    UUID := gen_random_uuid();
  v_o_roof  UUID := gen_random_uuid();
  v_o_arr   UUID := gen_random_uuid();
  v_o_new   UUID := gen_random_uuid();
  v_t0      TIMESTAMPTZ;
  v_t1      TIMESTAMPTZ;
  v_t2      TIMESTAMPTZ;
  v_n       INT;
  v_num     NUMERIC;
  u         UUID;
  c_roof    JSONB;
  c_arr     JSONB;
BEGIN
  -- ── Fixtures (as postgres, before any impersonation) ─────────────────────
  INSERT INTO public.organisations (id, name) VALUES (v_org, 'solar-layout-probe-org'), (v_org2, 'solar-layout-probe-org-2');
  FOREACH u IN ARRAY ARRAY[v_admin, v_editor, v_viewer, v_nogrant, v_client, v_foreign] LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'solar-layout-probe-' || u || '@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  END LOOP;
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
    (v_admin, v_org, 'admin', TRUE), (v_editor, v_org, 'contractor', TRUE), (v_viewer, v_org, 'project_manager', TRUE),
    (v_nogrant, v_org, 'contractor', TRUE), (v_client, v_org, 'client_viewer', TRUE), (v_foreign, v_org2, 'admin', TRUE);
  INSERT INTO projects.projects (id, organisation_id, name, created_by) VALUES
    (v_p1, v_org, 'solar-layout-probe-p1', v_admin), (v_p2, v_org, 'solar-layout-probe-p2', v_admin);
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active) VALUES
    (v_p1, v_editor, v_org, 'contractor', TRUE), (v_p1, v_viewer, v_org, 'project_manager', TRUE),
    (v_p1, v_nogrant, v_org, 'contractor', TRUE), (v_p1, v_client, v_org, 'client_viewer', TRUE),
    (v_p2, v_editor, v_org, 'contractor', TRUE);
  INSERT INTO structure.nodes (id, project_id, organisation_id, kind, code) VALUES
    (v_node1, v_p1, v_org, 'main_board', 'SOLAR-LAYOUT-MB1'), (v_node2, v_p2, v_org, 'main_board', 'SOLAR-LAYOUT-MB2');
  INSERT INTO tenants.floor_plans (id, organisation_id, project_id, name, file_path, uploaded_by, pixels_per_meter, source_revision_id) VALUES
    (v_fp1, v_org, v_p1, 'Roof plan', 'probe/p1/roof-v1.pdf', v_admin, 50, 'rev-1'),
    (v_fp2, v_org, v_p2, 'Other roof', 'probe/p2/roof.pdf', v_admin, 40, NULL),
    (v_fp3, v_org, v_p1, 'Uncalibrated', 'probe/p1/uncal.pdf', v_admin, NULL, NULL);
  INSERT INTO tenants.floor_plan_page_scales (floor_plan_id, page_index, organisation_id, pixels_per_meter) VALUES (v_fp1, 2, v_org, 25);
  INSERT INTO billing.org_addon_subscriptions (organisation_id, feature_key, status, amount_kobo, current_period_end)
    VALUES (v_org, 'solar', 'active', 199900, now() + interval '1 year');
  INSERT INTO solar.studies (id, project_id) VALUES (v_s1, v_p1), (v_s2, v_p2);
  -- A saved layout sheet on P1, for the report read gate.
  INSERT INTO projects.reports (organisation_id, project_id, kind, title, storage_path, status, version)
    VALUES (v_org, v_p1, 'solar_layout_sheet', 'probe sheet', 'probe/p1/sheet.pdf', 'issued', 1);

  c_roof := jsonb_build_object('id', v_o_roof, 'kind', 'roof',
    'geometry', jsonb_build_object('points', jsonb_build_array(0, 0, 1000, 0, 1000, 600, 0, 600)),
    'props', jsonb_build_object('name', 'Main roof'),
    'pixels_per_meter', 999);   -- a forged scale: must be ignored
  c_arr := jsonb_build_object('id', v_o_arr, 'kind', 'array',
    'geometry', jsonb_build_object('modules', jsonb_build_array(jsonb_build_array(50, 50, 107, 50, 107, 160, 50, 160))),
    'props', '{}'::jsonb);

  -- ── Grants (as the org admin, through 00208's own path) ──────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO solar.project_access (project_id, user_id, level) VALUES (v_p1, v_editor, 'edit'), (v_p1, v_viewer, 'view'), (v_p2, v_editor, 'edit');
  RESET ROLE;

  -- ── 1. Roof sources: anchor stamped from the drawing, org bound ──────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_editor::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO solar.roof_sources (id, study_id, kind, floor_plan_id, page_index, file_path, source_revision_id, organisation_id)
    VALUES (v_rs1, v_s1, 'drawing', v_fp1, 1, 'forged/path.pdf', 'forged-rev', v_org2);
  SELECT count(*) INTO v_n FROM solar.roof_sources
   WHERE id = v_rs1 AND organisation_id = v_org AND project_id = v_p1 AND file_path = 'probe/p1/roof-v1.pdf' AND source_revision_id = 'rev-1';
  INSERT INTO _r VALUES ('roof_source_anchor_and_org_bound', v_n = 1);
  INSERT INTO solar.roof_sources (id, study_id, kind, floor_plan_id, page_index) VALUES (v_rs2, v_s1, 'drawing', v_fp1, 2);
  INSERT INTO solar.roof_sources (id, study_id, kind, floor_plan_id, page_index) VALUES (v_rs3, v_s1, 'drawing', v_fp3, 1);

  BEGIN
    INSERT INTO solar.roof_sources (study_id, kind, floor_plan_id) VALUES (v_s1, 'drawing', v_fp2);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('roof_source_foreign_drawing_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('roof_source_foreign_drawing_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.roof_sources (study_id, kind, floor_plan_id, page_index) VALUES (v_s1, 'drawing', v_fp1, 1);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN unique_violation THEN INSERT INTO _r VALUES ('roof_source_duplicate_page_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('roof_source_duplicate_page_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.roof_sources (study_id, kind, storage_path, m_per_px) VALUES (v_s1, 'satellite', v_org || '/' || v_p1 || '/sat.png', 0.067);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('satellite_without_attribution_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('satellite_without_attribution_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.roof_sources (study_id, kind, storage_path, m_per_px, attribution) VALUES (v_s1, 'satellite', v_org2 || '/' || v_p1 || '/sat.png', 0.067, '© Mapbox');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('satellite_foreign_storage_path_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('satellite_foreign_storage_path_REFUSED', false);
  END;
  INSERT INTO solar.roof_sources (study_id, kind, storage_path, m_per_px, attribution) VALUES (v_s1, 'satellite', v_org || '/' || v_p1 || '/sat.png', 0.067, '© Mapbox');
  SELECT count(*) INTO v_n FROM solar.roof_sources WHERE study_id = v_s1 AND kind = 'satellite' AND north_bearing_deg = 0;
  INSERT INTO _r VALUES ('satellite_defaults_north_up', v_n = 1);
  UPDATE solar.roof_sources SET north_bearing_deg = 12.5 WHERE id = v_rs1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('editor_sets_north', v_n = 1);
  BEGIN
    UPDATE solar.roof_sources SET page_index = 2 WHERE id = v_rs1;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('roof_source_sheet_immutable_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('roof_source_sheet_immutable_REFUSED', false);
  END;
  UPDATE solar.roof_sources SET file_path = 'forged.pdf' WHERE id = v_rs1;
  SELECT count(*) INTO v_n FROM solar.roof_sources WHERE id = v_rs1 AND file_path = 'probe/p1/roof-v1.pdf';
  INSERT INTO _r VALUES ('roof_source_anchor_pinned_on_update', v_n = 1);

  -- ── 2. Layouts ────────────────────────────────────────────────────────────
  INSERT INTO solar.layouts (id, study_id, roof_source_id, name, module_spec, organisation_id)
    VALUES (v_l1, v_s1, v_rs1, 'Option A', '{"make":"x"}'::jsonb, v_org2);
  SELECT count(*) INTO v_n FROM solar.layouts WHERE id = v_l1 AND organisation_id = v_org AND project_id = v_p1;
  INSERT INTO _r VALUES ('layout_org_bound', v_n = 1);
  INSERT INTO solar.layouts (id, study_id, roof_source_id, name, module_spec) VALUES (v_l2, v_s1, v_rs2, 'Page two', '{}'::jsonb);
  INSERT INTO solar.layouts (id, study_id, roof_source_id, name, module_spec) VALUES (v_l3, v_s1, v_rs3, 'Uncalibrated', '{}'::jsonb);
  BEGIN
    INSERT INTO solar.layouts (study_id, roof_source_id, name, module_spec) VALUES (v_s1, v_rs1, '  option a ', '{}'::jsonb);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN unique_violation THEN INSERT INTO _r VALUES ('layout_name_unique_per_study_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('layout_name_unique_per_study_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.layouts SET roof_source_id = v_rs2 WHERE id = v_l1;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('layout_roof_source_immutable_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('layout_roof_source_immutable_REFUSED', false);
  END;
  RESET ROLE;
  -- a roof source of ANOTHER study (P2), made as postgres, cannot carry a P1 layout
  INSERT INTO solar.roof_sources (id, study_id, kind, floor_plan_id) VALUES (v_rs_p2, v_s2, 'drawing', v_fp2);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.layouts (study_id, roof_source_id, name, module_spec) VALUES (v_s1, v_rs_p2, 'Cross', '{}'::jsonb);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('layout_foreign_roof_source_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('layout_foreign_roof_source_REFUSED', false);
  END;

  -- ── 3. Saving objects: scale and anchor stamped by the database ──────────
  SELECT updated_at INTO v_t0 FROM solar.layouts WHERE id = v_l1;
  BEGIN
    v_t1 := public.solar_save_layout_objects(v_l1, v_t0, jsonb_build_array(c_roof, c_arr), ARRAY[]::uuid[], '{"moduleCount":1}'::jsonb);
    INSERT INTO _r VALUES ('editor_saves_objects', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_saves_objects', false);
  END;
  SELECT count(*) INTO v_n FROM solar.layout_objects
   WHERE layout_id = v_l1 AND pixels_per_meter = 50 AND floor_plan_id = v_fp1 AND page_index = 1 AND project_id = v_p1 AND organisation_id = v_org;
  INSERT INTO _r VALUES ('objects_scale_and_anchor_stamped', v_n = 2);
  INSERT INTO _r VALUES ('save_returns_a_newer_token', v_t1 IS NOT NULL AND v_t1 > v_t0);
  SELECT count(*) INTO v_n FROM solar.layouts WHERE id = v_l1 AND summary->>'moduleCount' = '1' AND updated_at = v_t1;
  INSERT INTO _r VALUES ('summary_and_token_saved_together', v_n = 1);
  BEGIN
    PERFORM public.solar_save_layout_objects(v_l1, v_t0, '[]'::jsonb, ARRAY[]::uuid[], '{}'::jsonb);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN serialization_failure THEN INSERT INTO _r VALUES ('stale_save_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('stale_save_REFUSED', false);
  END;
  SELECT count(*) INTO v_n FROM solar.layout_objects WHERE layout_id = v_l1;
  INSERT INTO _r VALUES ('stale_save_changed_nothing', v_n = 2);
  -- page 2 takes its own page scale
  SELECT updated_at INTO v_t2 FROM solar.layouts WHERE id = v_l2;
  PERFORM public.solar_save_layout_objects(v_l2, v_t2,
    jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'kind', 'roof', 'geometry', jsonb_build_object('points', jsonb_build_array(0, 0, 10, 0, 10, 10)), 'props', '{}'::jsonb)),
    ARRAY[]::uuid[], '{}'::jsonb);
  SELECT count(*) INTO v_n FROM solar.layout_objects WHERE layout_id = v_l2 AND pixels_per_meter = 25 AND page_index = 2;
  INSERT INTO _r VALUES ('page_two_uses_its_page_scale', v_n = 1);
  -- an uncalibrated page refuses objects
  SELECT updated_at INTO v_t2 FROM solar.layouts WHERE id = v_l3;
  BEGIN
    PERFORM public.solar_save_layout_objects(v_l3, v_t2,
      jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'kind', 'roof', 'geometry', jsonb_build_object('points', jsonb_build_array(0, 0, 10, 0, 10, 10)), 'props', '{}'::jsonb)),
      ARRAY[]::uuid[], '{}'::jsonb);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('uncalibrated_sheet_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('uncalibrated_sheet_REFUSED', false);
  END;
  -- an object id from another layout cannot be hijacked; kind cannot change
  SELECT updated_at INTO v_t2 FROM solar.layouts WHERE id = v_l2;
  BEGIN
    PERFORM public.solar_save_layout_objects(v_l2, v_t2, jsonb_build_array(c_roof), ARRAY[]::uuid[], '{}'::jsonb);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('cross_layout_object_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('cross_layout_object_REFUSED', false);
  END;
  BEGIN
    PERFORM public.solar_save_layout_objects(v_l1, v_t1, jsonb_build_array(jsonb_set(c_roof, '{kind}', '"obstruction"')), ARRAY[]::uuid[], '{}'::jsonb);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('object_kind_change_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('object_kind_change_REFUSED', false);
  END;
  -- equipment: a DB symbol must link to a board of THIS project
  BEGIN
    PERFORM public.solar_save_layout_objects(v_l1, v_t1, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'kind', 'equipment',
      'geometry', jsonb_build_object('x', 1, 'y', 1), 'props', jsonb_build_object('equipmentKind', 'db', 'name', 'DB', 'nodeId', NULL))), ARRAY[]::uuid[], '{}'::jsonb);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('free_floating_db_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('free_floating_db_REFUSED', false);
  END;
  BEGIN
    PERFORM public.solar_save_layout_objects(v_l1, v_t1, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'kind', 'equipment',
      'geometry', jsonb_build_object('x', 1, 'y', 1), 'props', jsonb_build_object('equipmentKind', 'db', 'name', 'DB', 'nodeId', v_node2))), ARRAY[]::uuid[], '{}'::jsonb);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('foreign_board_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('foreign_board_REFUSED', false);
  END;
  RESET ROLE;

  -- ── 4. The scale snapshot survives a recalibration ────────────────────────
  UPDATE tenants.floor_plans SET pixels_per_meter = 100 WHERE id = v_fp1;
  SET LOCAL ROLE authenticated;
  v_t2 := public.solar_save_layout_objects(v_l1, v_t1,
    jsonb_build_array(jsonb_set(c_roof, '{geometry}', jsonb_build_object('points', jsonb_build_array(0, 0, 900, 0, 900, 600, 0, 600))),
                      jsonb_build_object('id', v_o_new, 'kind', 'obstruction', 'geometry', jsonb_build_object('cx', 5, 'cy', 5, 'r', 2), 'props', '{}'::jsonb)),
    ARRAY[v_o_arr], '{}'::jsonb);
  SELECT pixels_per_meter INTO v_num FROM solar.layout_objects WHERE id = v_o_roof;
  INSERT INTO _r VALUES ('object_scale_pinned_on_update', v_num = 50);
  SELECT pixels_per_meter INTO v_num FROM solar.layout_objects WHERE id = v_o_new;
  INSERT INTO _r VALUES ('new_object_takes_current_scale', v_num = 100);
  SELECT count(*) INTO v_n FROM solar.layout_objects WHERE id = v_o_arr;
  INSERT INTO _r VALUES ('delete_list_applied', v_n = 0);
  RESET ROLE;

  -- ── 5. View reads; View cannot write ──────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_viewer::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM solar.layout_objects WHERE layout_id = v_l1;
  INSERT INTO _r VALUES ('viewer_reads_objects', v_n = 2);
  SELECT count(*) INTO v_n FROM solar.roof_sources WHERE study_id = v_s1;
  INSERT INTO _r VALUES ('viewer_reads_roof_sources', v_n = 4);
  BEGIN
    PERFORM public.solar_save_layout_objects(v_l1, v_t2, '[]'::jsonb, ARRAY[v_o_roof], '{}'::jsonb);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('viewer_save_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('viewer_save_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.layout_objects (layout_id, kind, geometry, props) VALUES (v_l1, 'roof', '{"points":[0,0,1,0,1,1]}'::jsonb, '{}'::jsonb);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('viewer_direct_object_insert_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('viewer_direct_object_insert_REFUSED', false);
  END;
  UPDATE solar.layouts SET name = 'hijacked' WHERE id = v_l1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('viewer_update_affects_nothing', v_n = 0);
  DELETE FROM solar.layout_objects WHERE layout_id = v_l1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('viewer_delete_affects_nothing', v_n = 0);
  SELECT count(*) INTO v_n FROM projects.reports WHERE project_id = v_p1 AND kind = 'solar_layout_sheet';
  INSERT INTO _r VALUES ('viewer_reads_layout_sheet', v_n = 1);
  RESET ROLE;

  -- ── 6. No grant, client viewer, foreign admin: nothing ────────────────────
  FOREACH u IN ARRAY ARRAY[v_nogrant, v_client, v_foreign] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT (SELECT count(*) FROM solar.roof_sources WHERE study_id = v_s1)
         + (SELECT count(*) FROM solar.layouts WHERE study_id = v_s1)
         + (SELECT count(*) FROM solar.layout_objects WHERE project_id = v_p1)
         + (SELECT count(*) FROM projects.reports WHERE project_id = v_p1 AND kind = 'solar_layout_sheet')
      INTO v_n;
    INSERT INTO _r VALUES ('no_level_reads_nothing_' || CASE u WHEN v_nogrant THEN 'nogrant' WHEN v_client THEN 'client' ELSE 'foreign' END, v_n = 0);
    RESET ROLE;
  END LOOP;

  -- ── 7. Lapse: hidden but kept ──────────────────────────────────────────────
  UPDATE billing.org_addon_subscriptions SET current_period_end = now() - interval '1 day' WHERE organisation_id = v_org;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_editor::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM solar.layout_objects WHERE layout_id = v_l1;
  INSERT INTO _r VALUES ('lapsed_editor_sees_nothing', v_n = 0);
  UPDATE solar.layouts SET name = 'while lapsed' WHERE id = v_l1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('lapsed_editor_update_affects_nothing', v_n = 0);
  RESET ROLE;
  SELECT count(*) INTO v_n FROM solar.layout_objects WHERE layout_id = v_l1;
  INSERT INTO _r VALUES ('lapsed_rows_kept', v_n = 2);
  UPDATE billing.org_addon_subscriptions SET current_period_end = now() + interval '1 year' WHERE organisation_id = v_org;

  -- ── 8. Drawing protection and cascades ─────────────────────────────────────
  BEGIN
    DELETE FROM tenants.floor_plans WHERE id = v_fp1;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN foreign_key_violation THEN INSERT INTO _r VALUES ('drawing_delete_with_layout_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('drawing_delete_with_layout_REFUSED', false);
  END;
  INSERT INTO solar.layouts (id, study_id, roof_source_id, name, module_spec) VALUES (v_l_p2, v_s2, v_rs_p2, 'P2', '{}'::jsonb);
  INSERT INTO solar.layout_objects (layout_id, kind, geometry, props) VALUES (v_l_p2, 'roof', '{"points":[0,0,1,0,1,1]}'::jsonb, '{}'::jsonb);
  BEGIN
    DELETE FROM projects.projects WHERE id = v_p2;
    SELECT count(*) INTO v_n FROM solar.layouts WHERE id = v_l_p2;
    INSERT INTO _r VALUES ('project_delete_cascades_layouts', v_n = 0);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('project_delete_cascades_layouts', false);
  END;

  -- ── 9. Service role bypasses (asserted AFTER rows exist); anon refused ────
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO v_n FROM solar.layout_objects WHERE layout_id = v_l1;
  INSERT INTO _r VALUES ('service_role_reads_objects', v_n = 2);
  SELECT count(*) INTO v_n FROM solar.roof_sources WHERE floor_plan_id = v_fp1;
  INSERT INTO _r VALUES ('service_role_reads_roof_sources', v_n = 2);
  RESET ROLE;
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM solar.layout_objects LIMIT 1;
    INSERT INTO _r VALUES ('anon_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_REFUSED', true);
  END;
  RESET ROLE;
  INSERT INTO _r VALUES ('anon_cannot_execute_save',
    NOT has_function_privilege('anon', 'public.solar_save_layout_objects(uuid, timestamptz, jsonb, uuid[], jsonb)', 'EXECUTE'));
  INSERT INTO _r VALUES ('roof_images_bucket_private',
    EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'solar-roof-images' AND public = false));
END $$;

SELECT k AS "check", v AS ok FROM _r ORDER BY k;
