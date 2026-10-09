-- BEHAVIOURAL assertions for 00245 (status plans), run as real roles.
--
--   red:   scripts/db/dry-run-migration.sh scripts/db/fixtures/noop.sql scripts/db/assert-status-plans-roles.sql
--   green: scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00245_status_plans.sql scripts/db/assert-status-plans-roles.sql
--
-- Mechanics this project has paid for:
--   * set_config('request.jwt.claims', ..., true) is transaction-local and
--     outlives RESET ROLE, so all fixtures are seeded first and the claim is
--     cleared before any later postgres-path write.
--   * UPDATE needs SELECT visibility: the contractor's refused UPDATE is probed
--     on a row the contractor CAN read, so a zero is the write gate, not the
--     read policy.
--   * The site_scope probe is the one person only site scope stops: an active
--     project PM whose organisation membership LAPSED. A control row proves the
--     role helper still admits them and user_has_project_access does not.
--     Because every permissive policy here also uses user_has_project_access,
--     site_scope is belt and braces on these tables; the lapsed-PM rows prove
--     the end state, not site_scope alone.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_project        UUID;
  v_org            UUID;
  v_drawing        UUID;
  v_drawing_file   TEXT;
  v_other_project  UUID;
  v_other_proj_org UUID;
  v_other_org      UUID;
  v_contractor     UUID;
  v_pm             UUID := gen_random_uuid();
  v_client         UUID := gen_random_uuid();
  v_lapsed         UUID := gen_random_uuid();
  v_t1             UUID;
  v_t2             UUID;
  v_t3_deleted     UUID;
  v_mb             UUID;
  v_foreign        UUID;
  v_layout         UUID;
  v_schematic      UUID;
  v_shape          UUID;
  v_pm_plan        UUID;
  v_pm_shape       UUID;
  v_n              INT;
  v_txt            TEXT;
  v_uuid           UUID;
BEGIN
  -- ── Fixtures (postgres path, no claims) ─────────────────────────────────
  SELECT pm.user_id, pm.project_id INTO v_contractor, v_project
    FROM projects.project_members pm
   WHERE pm.role = 'contractor' AND pm.is_active
     AND EXISTS (SELECT 1 FROM tenants.floor_plans fp WHERE fp.project_id = pm.project_id)
     AND EXISTS (SELECT 1 FROM public.user_organisations uo
                  WHERE uo.user_id = pm.user_id AND uo.role = 'contractor' AND uo.is_active)
   LIMIT 1;
  IF v_contractor IS NULL THEN RAISE EXCEPTION 'fixture: no contractor on a project with drawings'; END IF;

  SELECT fp.id, fp.organisation_id, fp.file_path INTO v_drawing, v_org, v_drawing_file
    FROM tenants.floor_plans fp WHERE fp.project_id = v_project LIMIT 1;
  SELECT p.id, p.organisation_id INTO v_other_project, v_other_proj_org
    FROM projects.projects p WHERE p.id <> v_project LIMIT 1;
  SELECT o.id INTO v_other_org FROM public.organisations o WHERE o.id <> v_org LIMIT 1;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES (v_pm,     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'probe-sp-pm@example.invalid',     '', now(), now(), now(), '{}', '{}'),
         (v_client, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'probe-sp-client@example.invalid', '', now(), now(), now(), '{}', '{}'),
         (v_lapsed, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'probe-sp-lapsed@example.invalid', '', now(), now(), now(), '{}', '{}');
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active)
  VALUES (v_pm, v_org, 'project_manager', TRUE),
         (v_client, v_org, 'client_viewer', TRUE),
         (v_lapsed, v_org, 'project_manager', FALSE);
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active)
  VALUES (v_project, v_pm, v_org, 'project_manager', TRUE),
         (v_project, v_client, v_org, 'client_viewer', TRUE),
         (v_project, v_lapsed, v_org, 'project_manager', TRUE);

  INSERT INTO structure.nodes (project_id, organisation_id, kind, code, shop_number, shop_name)
  VALUES (v_project, v_org, 'tenant_db', 'ZZSP-T1', 'ZZSP-1', 'Probe Lantern') RETURNING id INTO v_t1;
  INSERT INTO structure.nodes (project_id, organisation_id, kind, code, shop_number, shop_name)
  VALUES (v_project, v_org, 'tenant_db', 'ZZSP-T2', 'ZZSP-2', 'Probe Kettle') RETURNING id INTO v_t2;
  INSERT INTO structure.nodes (project_id, organisation_id, kind, code, shop_number, shop_name, deleted_at)
  VALUES (v_project, v_org, 'tenant_db', 'ZZSP-T3', 'ZZSP-3', 'Probe Gone', now()) RETURNING id INTO v_t3_deleted;
  INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name)
  VALUES (v_project, v_org, 'main_board', 'ZZSP-MB', 'Probe Main Board') RETURNING id INTO v_mb;
  INSERT INTO structure.nodes (project_id, organisation_id, kind, code, shop_number, shop_name)
  VALUES (v_other_project, v_other_proj_org, 'tenant_db', 'ZZSP-FX', 'ZZSP-9', 'Probe Elsewhere') RETURNING id INTO v_foreign;

  -- organisation_id and source_file_path are supplied here so this seed
  -- survives the "binding removed" mutation in Task 20.
  INSERT INTO tenants.status_plans (project_id, organisation_id, floor_plan_id, page_index, purpose, name, source_file_path)
  VALUES (v_project, v_org, v_drawing, 1, 'tenant_layout', 'ZZ probe layout', v_drawing_file) RETURNING id INTO v_layout;
  INSERT INTO tenants.status_plans (project_id, organisation_id, floor_plan_id, page_index, purpose, name, source_file_path)
  VALUES (v_project, v_org, v_drawing, 1, 'distribution_schematic', 'ZZ probe schematic', v_drawing_file) RETURNING id INTO v_schematic;
  INSERT INTO tenants.status_plan_shapes (status_plan_id, shape, points, node_id)
  VALUES (v_layout, 'polygon', '[10,10,200,10,200,120,10,120]'::jsonb, v_t1) RETURNING id INTO v_shape;

  -- ═══ 1. PROJECT MANAGER (ORG_WRITE_ROLES) ═══════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pm::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO _r VALUES ('fx_pm_role',
    COALESCE(public.user_effective_project_role(v_project), '') = 'project_manager'
    AND public.user_has_project_access(v_project));

  BEGIN
    INSERT INTO tenants.status_plans (project_id, organisation_id, floor_plan_id, page_index, purpose, name, source_file_path, created_by)
    VALUES (v_project, v_other_org, v_drawing, 2, 'tenant_layout', 'PM plan', 'forged.pdf', v_contractor)
    RETURNING id INTO v_pm_plan;
    INSERT INTO _r VALUES ('pm_plan_insert_ok', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('pm_plan_insert_ok', false);
  END;
  SELECT organisation_id::text INTO v_txt FROM tenants.status_plans WHERE id = v_pm_plan;
  INSERT INTO _r VALUES ('pm_plan_org_bound_from_drawing', v_txt = v_org::text);
  SELECT source_file_path INTO v_txt FROM tenants.status_plans WHERE id = v_pm_plan;
  INSERT INTO _r VALUES ('pm_plan_source_file_bound_from_drawing', v_txt = v_drawing_file);
  SELECT created_by INTO v_uuid FROM tenants.status_plans WHERE id = v_pm_plan;
  INSERT INTO _r VALUES ('pm_plan_created_by_is_caller', v_uuid = v_pm);

  BEGIN
    INSERT INTO tenants.status_plans (project_id, floor_plan_id, page_index, purpose, name)
    VALUES (v_project, v_drawing, 1, 'tenant_layout', 'Duplicate');
    INSERT INTO _r VALUES ('pm_plan_duplicate_refused', false);
  EXCEPTION
    WHEN unique_violation THEN INSERT INTO _r VALUES ('pm_plan_duplicate_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_plan_duplicate_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plans (project_id, floor_plan_id, page_index, purpose, name)
    VALUES (v_other_project, v_drawing, 3, 'tenant_layout', 'Wrong project');
    INSERT INTO _r VALUES ('pm_plan_wrong_project_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_plan_wrong_project_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_plan_wrong_project_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plans (project_id, floor_plan_id, page_index, purpose, name)
    VALUES (v_project, v_drawing, 4, 'tenant_layout', '   ');
    INSERT INTO _r VALUES ('pm_plan_blank_name_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_plan_blank_name_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_plan_blank_name_refused', false);
  END;

  UPDATE tenants.status_plans SET name = 'ZZ probe layout renamed' WHERE id = v_layout;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('pm_plan_rename_ok', v_n = 1);

  BEGIN
    UPDATE tenants.status_plans SET source_file_path = 'elsewhere.pdf' WHERE id = v_layout;
    INSERT INTO _r VALUES ('pm_plan_forged_anchor_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_plan_forged_anchor_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_plan_forged_anchor_refused', false);
  END;

  BEGIN
    UPDATE tenants.status_plans SET purpose = 'distribution_schematic', page_index = 9 WHERE id = v_layout;
    INSERT INTO _r VALUES ('pm_plan_purpose_change_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_plan_purpose_change_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_plan_purpose_change_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, shape, points, node_id)
    VALUES (v_layout, 'polygon', '[300,10,420,10,420,90,300,90]'::jsonb, v_t2)
    RETURNING id INTO v_pm_shape;
    INSERT INTO _r VALUES ('pm_shape_insert_ok', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('pm_shape_insert_ok', false);
  END;
  SELECT created_by INTO v_uuid FROM tenants.status_plan_shapes WHERE id = v_pm_shape;
  INSERT INTO _r VALUES ('pm_shape_created_by_is_caller', v_uuid = v_pm);

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, shape, points, node_id)
    VALUES (v_layout, 'polygon', '[0,0,5,0,5,5]'::jsonb, v_t1);
    INSERT INTO _r VALUES ('pm_shape_duplicate_node_refused', false);
  EXCEPTION
    WHEN unique_violation THEN INSERT INTO _r VALUES ('pm_shape_duplicate_node_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_shape_duplicate_node_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, shape, points, node_id)
    VALUES (v_layout, 'polygon', '[0,0,5,0,5,5]'::jsonb, v_foreign);
    INSERT INTO _r VALUES ('pm_shape_foreign_node_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_shape_foreign_node_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_shape_foreign_node_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, shape, points, node_id)
    VALUES (v_layout, 'polygon', '[0,0,5,0,5,5]'::jsonb, v_t3_deleted);
    INSERT INTO _r VALUES ('pm_shape_soft_deleted_node_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_shape_soft_deleted_node_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_shape_soft_deleted_node_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, shape, points, node_id)
    VALUES (v_layout, 'polygon', '[0,0,5,0,5,5]'::jsonb, v_mb);
    INSERT INTO _r VALUES ('pm_shape_main_board_on_layout_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_shape_main_board_on_layout_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_shape_main_board_on_layout_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, shape, points, node_id, source, detected_tag)
    VALUES (v_schematic, 'rect', '[0,0,80,0,80,40,0,40]'::jsonb, v_mb, 'detected', 'MB-9.9');
    INSERT INTO _r VALUES ('pm_shape_main_board_on_schematic_ok', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('pm_shape_main_board_on_schematic_ok', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, shape, points, area_type)
    VALUES (v_schematic, 'rect', '[0,0,80,0,80,40,0,40]'::jsonb, 'common');
    INSERT INTO _r VALUES ('pm_shape_area_on_schematic_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_shape_area_on_schematic_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_shape_area_on_schematic_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, shape, points, node_id, area_type)
    VALUES (v_layout, 'polygon', '[0,0,5,0,5,5]'::jsonb, v_t1, 'common');
    INSERT INTO _r VALUES ('pm_shape_node_and_area_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_shape_node_and_area_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_shape_node_and_area_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, shape, points)
    VALUES (v_layout, 'rect', '[0,0,10,0,10,10]'::jsonb);
    INSERT INTO _r VALUES ('pm_shape_rect_three_corners_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_shape_rect_three_corners_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_shape_rect_three_corners_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, shape, points)
    VALUES (v_layout, 'polygon', '[0,0,10,"x",10,10]'::jsonb);
    INSERT INTO _r VALUES ('pm_shape_non_number_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_shape_non_number_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_shape_non_number_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, shape, points)
    VALUES (v_layout, 'polygon', '[0,0,10,0,10,10,5]'::jsonb);
    INSERT INTO _r VALUES ('pm_shape_odd_count_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_shape_odd_count_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_shape_odd_count_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, shape, points, area_type)
    VALUES (v_layout, 'polygon', '[500,10,600,10,600,80,500,80]'::jsonb, 'plant_room');
    INSERT INTO _r VALUES ('pm_shape_area_only_ok', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('pm_shape_area_only_ok', false);
  END;

  UPDATE tenants.status_plan_shapes SET points = '[12,12,205,12,205,125,12,125]'::jsonb WHERE id = v_shape;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('pm_shape_update_ok', v_n = 1);

  BEGIN
    UPDATE tenants.status_plan_shapes SET status_plan_id = v_schematic WHERE id = v_shape;
    INSERT INTO _r VALUES ('pm_shape_move_plan_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_shape_move_plan_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_shape_move_plan_refused', false);
  END;

  DELETE FROM tenants.status_plan_shapes WHERE id = v_pm_shape;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('pm_shape_delete_ok', v_n = 1);

  RESET ROLE;

  -- ═══ 2. CONTRACTOR (not in ORG_WRITE_ROLES) ════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_contractor::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO _r VALUES ('fx_contractor_role',
    COALESCE(public.user_effective_project_role(v_project), '') = 'contractor'
    AND public.user_has_project_access(v_project));

  SELECT count(*) INTO v_n FROM tenants.status_plans WHERE id = v_layout;
  INSERT INTO _r VALUES ('contractor_reads_plan', v_n = 1);
  SELECT count(*) INTO v_n FROM tenants.status_plan_shapes WHERE id = v_shape;
  INSERT INTO _r VALUES ('contractor_reads_shape', v_n = 1);

  BEGIN
    INSERT INTO tenants.status_plans (project_id, floor_plan_id, page_index, purpose, name)
    VALUES (v_project, v_drawing, 5, 'tenant_layout', 'Contractor plan');
    INSERT INTO _r VALUES ('contractor_plan_insert_refused', false);
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('contractor_plan_insert_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('contractor_plan_insert_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, shape, points, area_type)
    VALUES (v_layout, 'polygon', '[0,0,5,0,5,5]'::jsonb, 'vacant');
    INSERT INTO _r VALUES ('contractor_shape_insert_refused', false);
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('contractor_shape_insert_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('contractor_shape_insert_refused', false);
  END;

  UPDATE tenants.status_plan_shapes SET points = '[1,1,2,1,2,2]'::jsonb WHERE id = v_shape;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('contractor_shape_update_affects_nothing', v_n = 0);

  DELETE FROM tenants.status_plan_shapes WHERE id = v_shape;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('contractor_shape_delete_affects_nothing', v_n = 0);

  DELETE FROM tenants.status_plans WHERE id = v_layout;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('contractor_plan_delete_affects_nothing', v_n = 0);

  RESET ROLE;

  -- ═══ 3. CLIENT VIEWER (reads, never writes) ════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO _r VALUES ('fx_client_role',
    COALESCE(public.user_effective_project_role(v_project), '') = 'client_viewer');
  SELECT count(*) INTO v_n FROM tenants.status_plans WHERE id = v_layout;
  INSERT INTO _r VALUES ('client_reads_plan', v_n = 1);
  SELECT count(*) INTO v_n FROM tenants.status_plan_shapes WHERE id = v_shape;
  INSERT INTO _r VALUES ('client_reads_shape', v_n = 1);

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, shape, points)
    VALUES (v_layout, 'polygon', '[0,0,5,0,5,5]'::jsonb);
    INSERT INTO _r VALUES ('client_shape_insert_refused', false);
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('client_shape_insert_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('client_shape_insert_refused', false);
  END;

  RESET ROLE;

  -- ═══ 4. LAPSED PM (only site scope / project access stops them) ════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lapsed::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO _r VALUES ('fx_lapsed_probe_is_the_right_person',
    COALESCE(public.user_effective_project_role(v_project), '') = 'project_manager'
    AND NOT public.user_has_project_access(v_project));
  SELECT count(*) INTO v_n FROM tenants.status_plans WHERE project_id = v_project;
  INSERT INTO _r VALUES ('lapsed_sees_no_plan', v_n = 0);
  SELECT count(*) INTO v_n FROM tenants.status_plan_shapes WHERE status_plan_id IN (v_layout, v_schematic);
  INSERT INTO _r VALUES ('lapsed_sees_no_shape', v_n = 0);

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, shape, points)
    VALUES (v_layout, 'polygon', '[0,0,5,0,5,5]'::jsonb);
    INSERT INTO _r VALUES ('lapsed_shape_insert_refused', false);
  EXCEPTION
    WHEN insufficient_privilege OR foreign_key_violation THEN INSERT INTO _r VALUES ('lapsed_shape_insert_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('lapsed_shape_insert_refused', false);
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ═══ 5. SERVICE ROLE (cloud-sync isAnnotated runs as this) ═════════════
  -- A service role subject to RLS would read ZERO and every drawing with a
  -- status plan would read as unannotated. There is a row by now.
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO v_n FROM tenants.status_plans WHERE floor_plan_id = v_drawing;
  INSERT INTO _r VALUES ('service_role_sees_plans', v_n >= 2);
  RESET ROLE;

  -- ═══ 6. ANON (refused at the grant) ════════════════════════════════════
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM tenants.status_plans LIMIT 1;
    INSERT INTO _r VALUES ('anon_table_refused', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_table_refused', true);
  END;
  BEGIN
    PERFORM public.site_project_of_status_plan(v_layout);
    INSERT INTO _r VALUES ('anon_resolver_refused', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_resolver_refused', true);
  END;
  RESET ROLE;

  -- ═══ 7. A hard-deleted node unlinks its shape, never blocks the delete ═
  DELETE FROM structure.nodes WHERE id = v_t1;
  SELECT node_id INTO v_uuid FROM tenants.status_plan_shapes WHERE id = v_shape;
  INSERT INTO _r VALUES ('node_hard_delete_unlinks_shape',
    v_uuid IS NULL AND EXISTS (SELECT 1 FROM tenants.status_plan_shapes WHERE id = v_shape));
END $$;

SELECT * FROM (VALUES
  ('FIXTURE: PM resolves to project_manager with project access',      (SELECT v FROM _r WHERE k='fx_pm_role')),
  ('FIXTURE: contractor resolves to contractor with project access',   (SELECT v FROM _r WHERE k='fx_contractor_role')),
  ('FIXTURE: client viewer resolves to client_viewer',                 (SELECT v FROM _r WHERE k='fx_client_role')),
  ('FIXTURE: lapsed PM passes the role helper, fails project access',  (SELECT v FROM _r WHERE k='fx_lapsed_probe_is_the_right_person')),
  ('PM creates a plan',                                                (SELECT v FROM _r WHERE k='pm_plan_insert_ok')),
  ('plan organisation is bound from the drawing (wrong value discarded)', (SELECT v FROM _r WHERE k='pm_plan_org_bound_from_drawing')),
  ('plan source_file_path is bound from the drawing',                  (SELECT v FROM _r WHERE k='pm_plan_source_file_bound_from_drawing')),
  ('plan created_by is the caller, not the supplied id',               (SELECT v FROM _r WHERE k='pm_plan_created_by_is_caller')),
  ('a second plan for the same drawing, page and purpose is refused',  (SELECT v FROM _r WHERE k='pm_plan_duplicate_refused')),
  ('a plan naming another project than its drawing is refused',        (SELECT v FROM _r WHERE k='pm_plan_wrong_project_refused')),
  ('a blank plan name is refused',                                     (SELECT v FROM _r WHERE k='pm_plan_blank_name_refused')),
  ('PM renames a plan',                                                (SELECT v FROM _r WHERE k='pm_plan_rename_ok')),
  ('re-anchoring to a file that is not the drawing''s is refused',     (SELECT v FROM _r WHERE k='pm_plan_forged_anchor_refused')),
  ('a plan''s purpose and page are fixed',                             (SELECT v FROM _r WHERE k='pm_plan_purpose_change_refused')),
  ('PM links a shape to a tenant board',                               (SELECT v FROM _r WHERE k='pm_shape_insert_ok')),
  ('shape created_by is the caller',                                   (SELECT v FROM _r WHERE k='pm_shape_created_by_is_caller')),
  ('a board appears at most once per plan',                            (SELECT v FROM _r WHERE k='pm_shape_duplicate_node_refused')),
  ('a board from another project is refused',                          (SELECT v FROM _r WHERE k='pm_shape_foreign_node_refused')),
  ('a soft-deleted board is refused',                                  (SELECT v FROM _r WHERE k='pm_shape_soft_deleted_node_refused')),
  ('a tenant layout refuses a main board',                             (SELECT v FROM _r WHERE k='pm_shape_main_board_on_layout_refused')),
  ('a schematic accepts a main board (detected)',                      (SELECT v FROM _r WHERE k='pm_shape_main_board_on_schematic_ok')),
  ('a schematic refuses an area type',                                 (SELECT v FROM _r WHERE k='pm_shape_area_on_schematic_refused')),
  ('a shape cannot carry both a board and an area type',               (SELECT v FROM _r WHERE k='pm_shape_node_and_area_refused')),
  ('a rectangle needs exactly four corners',                           (SELECT v FROM _r WHERE k='pm_shape_rect_three_corners_refused')),
  ('points must all be numbers',                                       (SELECT v FROM _r WHERE k='pm_shape_non_number_refused')),
  ('points come in x, y pairs',                                        (SELECT v FROM _r WHERE k='pm_shape_odd_count_refused')),
  ('an unlinked area shape is accepted on a layout',                   (SELECT v FROM _r WHERE k='pm_shape_area_only_ok')),
  ('PM moves a shape''s vertices',                                     (SELECT v FROM _r WHERE k='pm_shape_update_ok')),
  ('a shape cannot move to another plan',                              (SELECT v FROM _r WHERE k='pm_shape_move_plan_refused')),
  ('PM deletes a shape',                                               (SELECT v FROM _r WHERE k='pm_shape_delete_ok')),
  ('contractor reads the plan',                                        (SELECT v FROM _r WHERE k='contractor_reads_plan')),
  ('contractor reads the shape',                                       (SELECT v FROM _r WHERE k='contractor_reads_shape')),
  ('RESTRICTIVE gate bites: contractor plan insert refused 42501',     (SELECT v FROM _r WHERE k='contractor_plan_insert_refused')),
  ('RESTRICTIVE gate bites: contractor shape insert refused 42501',    (SELECT v FROM _r WHERE k='contractor_shape_insert_refused')),
  ('contractor update of a readable shape affects nothing',            (SELECT v FROM _r WHERE k='contractor_shape_update_affects_nothing')),
  ('contractor delete of a readable shape affects nothing',            (SELECT v FROM _r WHERE k='contractor_shape_delete_affects_nothing')),
  ('contractor delete of a readable plan affects nothing',             (SELECT v FROM _r WHERE k='contractor_plan_delete_affects_nothing')),
  ('client viewer reads the plan',                                     (SELECT v FROM _r WHERE k='client_reads_plan')),
  ('client viewer reads the shape',                                    (SELECT v FROM _r WHERE k='client_reads_shape')),
  ('client viewer shape insert refused',                               (SELECT v FROM _r WHERE k='client_shape_insert_refused')),
  ('site scope: lapsed PM sees no plan',                               (SELECT v FROM _r WHERE k='lapsed_sees_no_plan')),
  ('site scope: lapsed PM sees no shape',                              (SELECT v FROM _r WHERE k='lapsed_sees_no_shape')),
  ('site scope: lapsed PM shape insert refused',                       (SELECT v FROM _r WHERE k='lapsed_shape_insert_refused')),
  ('service role still sees plans, so isAnnotated() is not blind',     (SELECT v FROM _r WHERE k='service_role_sees_plans')),
  ('anon refused on the table',                                        (SELECT v FROM _r WHERE k='anon_table_refused')),
  ('anon refused on the resolver',                                     (SELECT v FROM _r WHERE k='anon_resolver_refused')),
  ('hard-deleting a board unlinks its shape and keeps the shape',      (SELECT v FROM _r WHERE k='node_hard_delete_unlinks_shape'))
) AS t("check", ok);
