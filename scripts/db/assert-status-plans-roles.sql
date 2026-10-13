-- BEHAVIOURAL assertions for status plans after 00249 (tenant plans), run as real roles.
--
--   red:   scripts/db/dry-run-migration.sh scripts/db/fixtures/noop.sql scripts/db/assert-status-plans-roles.sql
--   green: scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00249_tenant_plans.sql scripts/db/assert-status-plans-roles.sql
--
-- 00245 is already applied on production; this file describes the state that
-- 00249 leaves on top of it: plans per (project, purpose), sheets with their
-- own files in tenant-plan-files, shapes on sheets.
--
-- Mechanics this project has paid for:
--   * set_config('request.jwt.claims', ..., true) is transaction-local and
--     outlives RESET ROLE, so the claim is cleared before later postgres-path
--     writes that must not be stamped with a person.
--   * UPDATE needs SELECT visibility: refused UPDATEs are probed on rows the
--     caller CAN read, so a zero is the write gate, not the read policy.
--   * Every refused-write probe that could wrongly SUCCEED runs in a sub-block
--     ending in SQLSTATE ZZ001, so a broken gate cannot delete a fixture and
--     abort the rest of the file.
--   * The site-scope probe is an active project PM whose organisation
--     membership LAPSED: the role helper still admits them, project access
--     does not (fixture row proves both).
--   * storage.allow_delete_query lifts the storage API's delete guard so the
--     DELETE policies decide (as in assert-load-profile-rls.sql).

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_project        UUID;
  v_org            UUID;
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
  v_sheet1         UUID := gen_random_uuid();
  v_sheet2         UUID := gen_random_uuid();
  v_ssheet         UUID := gen_random_uuid();
  v_lprefix        TEXT;
  v_sprefix        TEXT;
  v_path1          TEXT;
  v_path1b         TEXT;
  v_shape          UUID;
  v_shape2         UUID;
  v_n              INT;
  v_int            INT;
  v_txt            TEXT;
  v_uuid           UUID;
  v_uuid2          UUID;
  v_ts             TIMESTAMPTZ;
  v_num            NUMERIC;
BEGIN
  -- ── Fixtures (postgres path, no claims) ─────────────────────────────────
  SELECT pm.user_id, pm.project_id INTO v_contractor, v_project
    FROM projects.project_members pm
   WHERE pm.role = 'contractor' AND pm.is_active
     AND EXISTS (SELECT 1 FROM public.user_organisations uo
                  WHERE uo.user_id = pm.user_id AND uo.role = 'contractor' AND uo.is_active)
     AND NOT EXISTS (SELECT 1 FROM tenants.status_plans sp WHERE sp.project_id = pm.project_id)
   LIMIT 1;
  IF v_contractor IS NULL THEN RAISE EXCEPTION 'fixture: no contractor on a project without status plans'; END IF;

  SELECT p.organisation_id INTO v_org FROM projects.projects p WHERE p.id = v_project;
  SELECT p.id, p.organisation_id INTO v_other_project, v_other_proj_org
    FROM projects.projects p WHERE p.id <> v_project LIMIT 1;
  SELECT o.id INTO v_other_org FROM public.organisations o WHERE o.id <> v_org LIMIT 1;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES (v_pm,     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'probe-tp-pm@example.invalid',     '', now(), now(), now(), '{}', '{}'),
         (v_client, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'probe-tp-client@example.invalid', '', now(), now(), now(), '{}', '{}'),
         (v_lapsed, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'probe-tp-lapsed@example.invalid', '', now(), now(), now(), '{}', '{}');
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active)
  VALUES (v_pm, v_org, 'project_manager', TRUE),
         (v_client, v_org, 'client_viewer', TRUE),
         (v_lapsed, v_org, 'project_manager', FALSE);
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active)
  VALUES (v_project, v_pm, v_org, 'project_manager', TRUE),
         (v_project, v_client, v_org, 'client_viewer', TRUE),
         (v_project, v_lapsed, v_org, 'project_manager', TRUE);

  INSERT INTO structure.nodes (project_id, organisation_id, kind, code, shop_number, shop_name)
  VALUES (v_project, v_org, 'tenant_db', 'ZZTP-T1', 'ZZTP-1', 'Probe Lantern') RETURNING id INTO v_t1;
  INSERT INTO structure.nodes (project_id, organisation_id, kind, code, shop_number, shop_name)
  VALUES (v_project, v_org, 'tenant_db', 'ZZTP-T2', 'ZZTP-2', 'Probe Kettle') RETURNING id INTO v_t2;
  INSERT INTO structure.nodes (project_id, organisation_id, kind, code, shop_number, shop_name, deleted_at)
  VALUES (v_project, v_org, 'tenant_db', 'ZZTP-T3', 'ZZTP-3', 'Probe Gone', now()) RETURNING id INTO v_t3_deleted;
  INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name)
  VALUES (v_project, v_org, 'main_board', 'ZZTP-MB', 'Probe Main Board') RETURNING id INTO v_mb;
  INSERT INTO structure.nodes (project_id, organisation_id, kind, code, shop_number, shop_name)
  VALUES (v_other_project, v_other_proj_org, 'tenant_db', 'ZZTP-FX', 'ZZTP-9', 'Probe Elsewhere') RETURNING id INTO v_foreign;

  -- The line diagram and its sheet are seeded on the postgres path; the PM
  -- creates the floor plan below, so its bindings are tested as a person.
  INSERT INTO tenants.status_plans (project_id, organisation_id, purpose, name)
  VALUES (v_project, v_org, 'distribution_schematic', 'ZZ probe line diagram') RETURNING id INTO v_schematic;
  v_sprefix := v_org::text || '/' || v_project::text || '/' || v_schematic::text || '/';
  INSERT INTO tenants.status_plan_sheets (id, status_plan_id, organisation_id, sort_order, label, file_path, page_index, file_name, mime)
  VALUES (v_ssheet, v_schematic, v_org, 0, 'Sheet 1 of 1', v_sprefix || v_ssheet::text || '/1.pdf', 1, 'zz-300.pdf', 'application/pdf');

  -- ═══ 1. PROJECT MANAGER (ORG_WRITE_ROLES) ═══════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pm::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO _r VALUES ('fx_pm_role',
    COALESCE(public.user_effective_project_role(v_project), '') = 'project_manager'
    AND public.user_has_project_access(v_project));

  -- Plans
  BEGIN
    INSERT INTO tenants.status_plans (project_id, organisation_id, purpose, name, created_by)
    VALUES (v_project, v_other_org, 'tenant_layout', 'ZZ probe floor plan', v_contractor)
    RETURNING id INTO v_layout;
    INSERT INTO _r VALUES ('pm_plan_insert_ok', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('pm_plan_insert_ok', false);
  END;
  SELECT organisation_id, created_by INTO v_uuid, v_uuid2 FROM tenants.status_plans WHERE id = v_layout;
  INSERT INTO _r VALUES ('pm_plan_org_bound_from_project', v_uuid = v_org);
  INSERT INTO _r VALUES ('pm_plan_created_by_is_caller', v_uuid2 = v_pm);

  BEGIN
    INSERT INTO tenants.status_plans (project_id, purpose, name) VALUES (v_project, 'tenant_layout', 'Second floor plan');
    INSERT INTO _r VALUES ('pm_plan_one_per_purpose', false);
  EXCEPTION
    WHEN unique_violation THEN INSERT INTO _r VALUES ('pm_plan_one_per_purpose', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_plan_one_per_purpose', false);
  END;

  BEGIN
    UPDATE tenants.status_plans SET purpose = 'distribution_schematic' WHERE id = v_layout;
    INSERT INTO _r VALUES ('pm_plan_purpose_fixed', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_plan_purpose_fixed', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_plan_purpose_fixed', false);
  END;

  BEGIN
    UPDATE tenants.status_plans SET project_id = v_other_project WHERE id = v_layout;
    INSERT INTO _r VALUES ('pm_plan_project_fixed', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_plan_project_fixed', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_plan_project_fixed', false);
  END;

  UPDATE tenants.status_plans SET name = 'ZZ probe floor plan renamed' WHERE id = v_layout;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('pm_plan_rename_ok', v_n = 1);

  v_lprefix := v_org::text || '/' || v_project::text || '/' || v_layout::text || '/';
  v_path1 := v_lprefix || v_sheet1::text || '/1.pdf';

  -- Files
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('tenant-plan-files', v_path1, v_pm);
    INSERT INTO _r VALUES ('pm_file_upload_ok', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('pm_file_upload_ok', false);
  END;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('tenant-plan-files', v_org::text || '/' || v_project::text || '/' || gen_random_uuid()::text || '/' || gen_random_uuid()::text || '/1.pdf', v_pm);
    INSERT INTO _r VALUES ('pm_file_upload_unknown_plan_refused', false);
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('pm_file_upload_unknown_plan_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_file_upload_unknown_plan_refused', false);
  END;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('tenant-plan-files', v_lprefix || gen_random_uuid()::text || '/1.exe', v_pm);
    INSERT INTO _r VALUES ('pm_file_upload_bad_name_refused', false);
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('pm_file_upload_bad_name_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_file_upload_bad_name_refused', false);
  END;

  -- Path binding: every malformed or foreign path resolves to no project, so the insert is refused.
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('tenant-plan-files', v_other_org::text || '/' || v_project::text || '/' || v_layout::text || '/' || gen_random_uuid()::text || '/1.pdf', v_pm);
    INSERT INTO _r VALUES ('pm_file_other_org_segment_refused', false);
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('pm_file_other_org_segment_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_file_other_org_segment_refused', false);
  END;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('tenant-plan-files', v_org::text || '/' || v_project::text || '/' || v_layout::text || '/../' || gen_random_uuid()::text || '/1.pdf', v_pm);
    INSERT INTO _r VALUES ('pm_file_dotdot_segment_refused', false);
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('pm_file_dotdot_segment_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_file_dotdot_segment_refused', false);
  END;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('tenant-plan-files', v_lprefix || gen_random_uuid()::text || '/extra/1.pdf', v_pm);
    INSERT INTO _r VALUES ('pm_file_extra_segment_refused', false);
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('pm_file_extra_segment_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_file_extra_segment_refused', false);
  END;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('tenant-plan-files', upper(v_lprefix) || gen_random_uuid()::text || '/1.pdf', v_pm);
    INSERT INTO _r VALUES ('pm_file_uppercase_uuid_refused', false);
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('pm_file_uppercase_uuid_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_file_uppercase_uuid_refused', false);
  END;

  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id = 'tenant-plan-files' AND name = v_path1;
  INSERT INTO _r VALUES ('pm_file_read_ok', v_n = 1);

  -- Sheets
  BEGIN
    INSERT INTO tenants.status_plan_sheets (id, status_plan_id, organisation_id, sort_order, label, file_path, page_index, file_name, mime,
                                            revision, replaced_at, replaced_from_path, created_by)
    VALUES (v_sheet1, v_layout, v_other_org, 0, 'Sheet 1 of 2', v_path1, 1, 'zz-100.pdf', 'application/pdf',
            7, now(), 'forged.pdf', v_contractor);
    INSERT INTO _r VALUES ('pm_sheet_insert_ok', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('pm_sheet_insert_ok', false);
  END;
  SELECT organisation_id, revision, replaced_at, replaced_from_path, created_by
    INTO v_uuid, v_int, v_ts, v_txt, v_uuid2
    FROM tenants.status_plan_sheets WHERE id = v_sheet1;
  INSERT INTO _r VALUES ('pm_sheet_org_bound_from_plan', v_uuid = v_org);
  INSERT INTO _r VALUES ('pm_sheet_starts_at_revision_1_unreplaced', v_int = 1 AND v_ts IS NULL AND v_txt IS NULL);
  INSERT INTO _r VALUES ('pm_sheet_created_by_is_caller', v_uuid2 = v_pm);

  BEGIN
    INSERT INTO tenants.status_plan_sheets (id, status_plan_id, sort_order, label, file_path, page_index, file_name, mime)
    VALUES (v_sheet2, v_layout, 1, 'Sheet 2 of 2', v_path1, 2, 'zz-100.pdf', 'application/pdf');
    INSERT INTO _r VALUES ('pm_second_sheet_same_file_ok', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('pm_second_sheet_same_file_ok', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_sheets (status_plan_id, sort_order, label, file_path, page_index, file_name, mime)
    VALUES (v_layout, 1, 'Clash', v_lprefix || gen_random_uuid()::text || '/1.pdf', 1, 'clash.pdf', 'application/pdf');
    INSERT INTO _r VALUES ('pm_sheet_duplicate_position_refused', false);
  EXCEPTION
    WHEN unique_violation THEN INSERT INTO _r VALUES ('pm_sheet_duplicate_position_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_sheet_duplicate_position_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_sheets (status_plan_id, sort_order, label, file_path, page_index, file_name, mime)
    VALUES (v_layout, 2, 'Other org', v_other_org::text || '/' || v_project::text || '/' || v_layout::text || '/' || gen_random_uuid()::text || '/1.pdf', 1, 'o.pdf', 'application/pdf');
    INSERT INTO _r VALUES ('pm_sheet_path_of_another_org_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_sheet_path_of_another_org_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_sheet_path_of_another_org_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_sheets (status_plan_id, sort_order, label, file_path, page_index, file_name, mime)
    VALUES (v_layout, 2, 'Borrowed', v_sprefix || gen_random_uuid()::text || '/1.pdf', 1, 'b.pdf', 'application/pdf');
    INSERT INTO _r VALUES ('pm_sheet_path_of_another_plan_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_sheet_path_of_another_plan_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_sheet_path_of_another_plan_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_sheets (status_plan_id, sort_order, label, file_path, page_index, file_name, mime)
    VALUES (v_layout, 3, 'Elsewhere', v_org::text || '/' || v_other_project::text || '/' || v_layout::text || '/' || gen_random_uuid()::text || '/1.pdf', 1, 'e.pdf', 'application/pdf');
    INSERT INTO _r VALUES ('pm_sheet_path_of_another_project_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_sheet_path_of_another_project_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_sheet_path_of_another_project_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_sheets (status_plan_id, sort_order, label, file_path, page_index, file_name, mime)
    VALUES (v_layout, 4, 'Mislabelled', v_lprefix || gen_random_uuid()::text || '/1.pdf', 1, 'm.png', 'image/png');
    INSERT INTO _r VALUES ('pm_sheet_mime_must_match_file', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_sheet_mime_must_match_file', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_sheet_mime_must_match_file', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_sheets (status_plan_id, sort_order, label, file_path, page_index, file_name, mime)
    VALUES (v_layout, 5, 'Image page 2', v_lprefix || gen_random_uuid()::text || '/1.png', 2, 'i.png', 'image/png');
    INSERT INTO _r VALUES ('pm_sheet_image_has_one_page', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_sheet_image_has_one_page', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_sheet_image_has_one_page', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_sheets (status_plan_id, sort_order, label, file_path, page_index, file_name, mime)
    VALUES (v_layout, 6, '   ', v_lprefix || gen_random_uuid()::text || '/1.pdf', 1, 'blank.pdf', 'application/pdf');
    INSERT INTO _r VALUES ('pm_sheet_blank_label_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_sheet_blank_label_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_sheet_blank_label_refused', false);
  END;

  BEGIN
    UPDATE tenants.status_plan_sheets SET pixels_per_meter = 10 WHERE id = v_sheet2;
    INSERT INTO _r VALUES ('pm_sheet_half_scale_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_sheet_half_scale_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_sheet_half_scale_refused', false);
  END;

  UPDATE tenants.status_plan_sheets
     SET pixels_per_meter = 20, calibration_points = '[0,0,100,0]'::jsonb, calibration_metres = 5
   WHERE id = v_sheet1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('pm_sheet_calibrate_ok', v_n = 1);

  -- Replace: the trigger, not the client, decides revision, flag and old path.
  v_path1b := v_lprefix || v_sheet1::text || '/2.pdf';
  UPDATE tenants.status_plan_sheets
     SET file_path = v_path1b, revision = 99, replaced_from_path = 'forged.pdf', replaced_at = NULL
   WHERE id = v_sheet1;
  SELECT revision, replaced_at, replaced_from_path, pixels_per_meter INTO v_int, v_ts, v_txt, v_num
    FROM tenants.status_plan_sheets WHERE id = v_sheet1;
  INSERT INTO _r VALUES ('pm_sheet_replace_bumps_revision', v_int = 2);
  INSERT INTO _r VALUES ('pm_sheet_replace_flags_and_remembers_old_file', v_ts IS NOT NULL AND v_txt = v_path1);
  INSERT INTO _r VALUES ('pm_sheet_replace_keeps_scale', v_num = 20);

  UPDATE tenants.status_plan_sheets SET page_index = 5 WHERE id = v_sheet2;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  SELECT page_index INTO v_int FROM tenants.status_plan_sheets WHERE id = v_sheet2;
  INSERT INTO _r VALUES ('pm_sheet_page_needs_a_new_file', v_n = 1 AND v_int = 2);

  UPDATE tenants.status_plan_sheets SET replaced_at = now() WHERE id = v_sheet2;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  SELECT replaced_at INTO v_ts FROM tenants.status_plan_sheets WHERE id = v_sheet2;
  INSERT INTO _r VALUES ('pm_sheet_replaced_flag_cannot_be_forged', v_n = 1 AND v_ts IS NULL);

  UPDATE tenants.status_plan_sheets SET replaced_at = NULL WHERE id = v_sheet1;
  SELECT replaced_at, revision INTO v_ts, v_int FROM tenants.status_plan_sheets WHERE id = v_sheet1;
  INSERT INTO _r VALUES ('pm_sheet_reanchor_clears_flag', v_ts IS NULL AND v_int = 2);

  BEGIN
    UPDATE tenants.status_plan_sheets SET status_plan_id = v_schematic WHERE id = v_sheet2;
    INSERT INTO _r VALUES ('pm_sheet_cannot_move_plan', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_sheet_cannot_move_plan', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_sheet_cannot_move_plan', false);
  END;

  -- Shapes
  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, sheet_id, shape, points, node_id)
    VALUES (v_layout, v_sheet1, 'polygon', '[10,10,200,10,200,120,10,120]'::jsonb, v_t1)
    RETURNING id INTO v_shape;
    INSERT INTO _r VALUES ('pm_shape_insert_ok', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('pm_shape_insert_ok', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, sheet_id, shape, points, node_id)
    VALUES (v_layout, v_sheet2, 'polygon', '[0,0,50,0,50,50]'::jsonb, v_t1);
    INSERT INTO _r VALUES ('pm_node_once_across_sheets', false);
  EXCEPTION
    WHEN unique_violation THEN INSERT INTO _r VALUES ('pm_node_once_across_sheets', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_node_once_across_sheets', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, sheet_id, shape, points)
    VALUES (v_layout, v_ssheet, 'polygon', '[0,0,50,0,50,50]'::jsonb);
    INSERT INTO _r VALUES ('pm_shape_sheet_of_another_plan_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_shape_sheet_of_another_plan_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_shape_sheet_of_another_plan_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, sheet_id, shape, points, node_id)
    VALUES (v_layout, v_sheet2, 'polygon', '[300,10,420,10,420,90,300,90]'::jsonb, v_t2)
    RETURNING id INTO v_shape2;
    INSERT INTO _r VALUES ('pm_shape_on_second_sheet_ok', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('pm_shape_on_second_sheet_ok', false);
  END;

  BEGIN
    UPDATE tenants.status_plan_shapes SET sheet_id = v_sheet2 WHERE id = v_shape;
    INSERT INTO _r VALUES ('pm_shape_cannot_move_sheet', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_shape_cannot_move_sheet', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_shape_cannot_move_sheet', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, sheet_id, shape, points, node_id)
    VALUES (v_layout, v_sheet1, 'polygon', '[0,0,5,0,5,5]'::jsonb, v_foreign);
    INSERT INTO _r VALUES ('pm_shape_foreign_node_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_shape_foreign_node_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_shape_foreign_node_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, sheet_id, shape, points, node_id)
    VALUES (v_layout, v_sheet1, 'polygon', '[0,0,5,0,5,5]'::jsonb, v_t3_deleted);
    INSERT INTO _r VALUES ('pm_shape_soft_deleted_node_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_shape_soft_deleted_node_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_shape_soft_deleted_node_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, sheet_id, shape, points, node_id)
    VALUES (v_layout, v_sheet1, 'polygon', '[0,0,5,0,5,5]'::jsonb, v_mb);
    INSERT INTO _r VALUES ('pm_shape_main_board_on_layout_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_shape_main_board_on_layout_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_shape_main_board_on_layout_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, sheet_id, shape, points, node_id, source, detected_tag)
    VALUES (v_schematic, v_ssheet, 'rect', '[0,0,80,0,80,40,0,40]'::jsonb, v_mb, 'detected', 'MB-9.9');
    INSERT INTO _r VALUES ('pm_shape_main_board_on_schematic_ok', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('pm_shape_main_board_on_schematic_ok', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, sheet_id, shape, points, area_type)
    VALUES (v_schematic, v_ssheet, 'rect', '[0,0,80,0,80,40,0,40]'::jsonb, 'common');
    INSERT INTO _r VALUES ('pm_shape_area_on_schematic_refused', false);
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pm_shape_area_on_schematic_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_shape_area_on_schematic_refused', false);
  END;

  RESET ROLE;

  -- ═══ 2. CONTRACTOR (reads, never writes) ════════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_contractor::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO _r VALUES ('fx_contractor_role',
    COALESCE(public.user_effective_project_role(v_project), '') = 'contractor'
    AND public.user_has_project_access(v_project));

  SELECT count(*) INTO v_n FROM tenants.status_plans WHERE id = v_layout;
  INSERT INTO _r VALUES ('contractor_reads_plan', v_n = 1);
  SELECT count(*) INTO v_n FROM tenants.status_plan_sheets WHERE status_plan_id = v_layout;
  INSERT INTO _r VALUES ('contractor_reads_sheets', v_n = 2);
  SELECT count(*) INTO v_n FROM tenants.status_plan_shapes WHERE id = v_shape;
  INSERT INTO _r VALUES ('contractor_reads_shape', v_n = 1);
  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id = 'tenant-plan-files' AND name = v_path1;
  INSERT INTO _r VALUES ('contractor_reads_file', v_n = 1);

  BEGIN
    INSERT INTO tenants.status_plan_sheets (status_plan_id, sort_order, label, file_path, page_index, file_name, mime)
    VALUES (v_layout, 9, 'Contractor sheet', v_lprefix || gen_random_uuid()::text || '/1.pdf', 1, 'c.pdf', 'application/pdf');
    RAISE EXCEPTION 'probe write succeeded' USING ERRCODE = 'ZZ001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('contractor_sheet_insert_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('contractor_sheet_insert_refused', false);
  END;

  v_n := NULL;
  BEGIN
    UPDATE tenants.status_plan_sheets SET label = 'x' WHERE id = v_sheet2;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN NULL;
  END;
  INSERT INTO _r VALUES ('contractor_sheet_update_affects_nothing', v_n = 0);

  v_n := NULL;
  BEGIN
    DELETE FROM tenants.status_plan_sheets WHERE id = v_sheet2;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN NULL;
  END;
  INSERT INTO _r VALUES ('contractor_sheet_delete_affects_nothing', v_n = 0);

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, sheet_id, shape, points, area_type)
    VALUES (v_layout, v_sheet2, 'polygon', '[0,0,5,0,5,5]'::jsonb, 'vacant');
    RAISE EXCEPTION 'probe write succeeded' USING ERRCODE = 'ZZ001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('contractor_shape_insert_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('contractor_shape_insert_refused', false);
  END;

  v_n := NULL;
  BEGIN
    UPDATE tenants.status_plans SET name = 'x' WHERE id = v_layout;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN NULL;
  END;
  INSERT INTO _r VALUES ('contractor_plan_update_affects_nothing', v_n = 0);

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('tenant-plan-files', v_lprefix || gen_random_uuid()::text || '/1.pdf', v_contractor);
    RAISE EXCEPTION 'probe write succeeded' USING ERRCODE = 'ZZ001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('contractor_file_upload_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('contractor_file_upload_refused', false);
  END;

  RESET ROLE;

  -- ═══ 3. CLIENT VIEWER (reads, never writes) ═════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO _r VALUES ('fx_client_role', COALESCE(public.user_effective_project_role(v_project), '') = 'client_viewer');
  SELECT count(*) INTO v_n FROM tenants.status_plans WHERE id = v_layout;
  INSERT INTO _r VALUES ('client_reads_plan', v_n = 1);
  SELECT count(*) INTO v_n FROM tenants.status_plan_sheets WHERE status_plan_id = v_layout;
  INSERT INTO _r VALUES ('client_reads_sheets', v_n = 2);
  SELECT count(*) INTO v_n FROM tenants.status_plan_shapes WHERE id = v_shape;
  INSERT INTO _r VALUES ('client_reads_shape', v_n = 1);
  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id = 'tenant-plan-files' AND name = v_path1;
  INSERT INTO _r VALUES ('client_reads_file', v_n = 1);

  BEGIN
    INSERT INTO tenants.status_plan_sheets (status_plan_id, sort_order, label, file_path, page_index, file_name, mime)
    VALUES (v_layout, 10, 'Client sheet', v_lprefix || gen_random_uuid()::text || '/1.pdf', 1, 'c.pdf', 'application/pdf');
    RAISE EXCEPTION 'probe write succeeded' USING ERRCODE = 'ZZ001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('client_sheet_insert_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('client_sheet_insert_refused', false);
  END;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('tenant-plan-files', v_lprefix || gen_random_uuid()::text || '/1.pdf', v_client);
    RAISE EXCEPTION 'probe write succeeded' USING ERRCODE = 'ZZ001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('client_file_upload_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('client_file_upload_refused', false);
  END;

  v_n := NULL;
  BEGIN
    UPDATE tenants.status_plan_sheets SET label = 'x' WHERE id = v_sheet2;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN NULL;
  END;
  INSERT INTO _r VALUES ('client_sheet_update_affects_nothing', v_n = 0);

  v_n := NULL;
  BEGIN
    DELETE FROM tenants.status_plan_sheets WHERE id = v_sheet2;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN NULL;
  END;
  INSERT INTO _r VALUES ('client_sheet_delete_affects_nothing', v_n = 0);

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, sheet_id, shape, points, area_type)
    VALUES (v_layout, v_sheet2, 'polygon', '[0,0,5,0,5,5]'::jsonb, 'vacant');
    RAISE EXCEPTION 'probe write succeeded' USING ERRCODE = 'ZZ001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('client_shape_insert_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('client_shape_insert_refused', false);
  END;

  v_n := NULL;
  BEGIN
    DELETE FROM tenants.status_plan_shapes WHERE id = v_shape;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN NULL;
  END;
  INSERT INTO _r VALUES ('client_shape_delete_affects_nothing', v_n = 0);

  PERFORM set_config('storage.allow_delete_query', 'true', true);
  v_n := NULL;
  BEGIN
    DELETE FROM storage.objects WHERE bucket_id = 'tenant-plan-files' AND name = v_path1;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN NULL;
  END;
  INSERT INTO _r VALUES ('client_file_delete_affects_nothing', v_n = 0);

  RESET ROLE;

  -- ═══ 4. LAPSED PM (only site scope / project access stops them) ═════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lapsed::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO _r VALUES ('fx_lapsed_probe_is_the_right_person',
    COALESCE(public.user_effective_project_role(v_project), '') = 'project_manager'
    AND NOT public.user_has_project_access(v_project));
  SELECT count(*) INTO v_n FROM tenants.status_plans WHERE project_id = v_project;
  INSERT INTO _r VALUES ('lapsed_sees_no_plan', v_n = 0);
  SELECT count(*) INTO v_n FROM tenants.status_plan_sheets WHERE status_plan_id IN (v_layout, v_schematic);
  INSERT INTO _r VALUES ('lapsed_sees_no_sheet', v_n = 0);
  SELECT count(*) INTO v_n FROM tenants.status_plan_shapes WHERE status_plan_id IN (v_layout, v_schematic);
  INSERT INTO _r VALUES ('lapsed_sees_no_shape', v_n = 0);
  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id = 'tenant-plan-files' AND name = v_path1;
  INSERT INTO _r VALUES ('lapsed_sees_no_file', v_n = 0);

  BEGIN
    INSERT INTO tenants.status_plan_sheets (status_plan_id, sort_order, label, file_path, page_index, file_name, mime)
    VALUES (v_layout, 11, 'Lapsed sheet', v_lprefix || gen_random_uuid()::text || '/1.pdf', 1, 'l.pdf', 'application/pdf');
    RAISE EXCEPTION 'probe write succeeded' USING ERRCODE = 'ZZ001';
  EXCEPTION
    -- The BEFORE trigger runs as the caller and cannot see the plan (site scope), so it may
    -- raise 23503 before RLS raises 42501. Either way the write is refused; the fixture row
    -- below proves the plan exists, so a 23503 is not a vacuous "plan not found".
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('lapsed_sheet_insert_refused', true);
    WHEN foreign_key_violation THEN INSERT INTO _r VALUES ('lapsed_sheet_insert_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('lapsed_sheet_insert_refused', false);
  END;

  BEGIN
    INSERT INTO tenants.status_plan_shapes (status_plan_id, sheet_id, shape, points, area_type)
    VALUES (v_layout, v_sheet2, 'polygon', '[0,0,5,0,5,5]'::jsonb, 'vacant');
    RAISE EXCEPTION 'probe write succeeded' USING ERRCODE = 'ZZ001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('lapsed_shape_insert_refused', true);
    WHEN foreign_key_violation THEN INSERT INTO _r VALUES ('lapsed_shape_insert_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('lapsed_shape_insert_refused', false);
  END;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('tenant-plan-files', v_lprefix || gen_random_uuid()::text || '/1.pdf', v_lapsed);
    RAISE EXCEPTION 'probe write succeeded' USING ERRCODE = 'ZZ001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('lapsed_file_upload_refused', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('lapsed_file_upload_refused', false);
  END;

  PERFORM set_config('storage.allow_delete_query', 'true', true);
  v_n := NULL;
  BEGIN
    DELETE FROM storage.objects WHERE bucket_id = 'tenant-plan-files' AND name = v_path1;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'ZZ001';
  EXCEPTION WHEN SQLSTATE 'ZZ001' THEN NULL;
  END;
  INSERT INTO _r VALUES ('lapsed_file_delete_affects_nothing', v_n = 0);

  RESET ROLE;
  -- The things the lapsed PM was refused on really exist (postgres path).
  INSERT INTO _r VALUES ('fx_lapsed_targets_exist',
    EXISTS (SELECT 1 FROM tenants.status_plans WHERE id = v_layout)
    AND EXISTS (SELECT 1 FROM tenants.status_plan_sheets WHERE id = v_sheet2)
    AND EXISTS (SELECT 1 FROM tenants.status_plan_shapes WHERE id = v_shape)
    AND EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'tenant-plan-files' AND name = v_path1));
  PERFORM set_config('request.jwt.claims', '', true);

  -- ═══ 5. SERVICE ROLE (report, Export sheet and portal read through it) ═══
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO v_n FROM tenants.status_plan_sheets WHERE status_plan_id IN (v_layout, v_schematic);
  INSERT INTO _r VALUES ('service_role_sees_sheets', v_n = 3);
  RESET ROLE;

  -- ═══ 6. ANON (refused at the grant) ═════════════════════════════════════
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM tenants.status_plan_sheets LIMIT 1;
    INSERT INTO _r VALUES ('anon_sheets_table_refused', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_sheets_table_refused', true);
  END;
  BEGIN
    PERFORM tenants.tenant_plan_file_project(v_path1);
    INSERT INTO _r VALUES ('anon_file_project_fn_refused', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_file_project_fn_refused', true);
  END;
  RESET ROLE;

  -- ═══ 7. STORAGE DELETE (the policies decide) ════════════════════════════
  PERFORM set_config('storage.allow_delete_query', 'true', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_contractor::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  DELETE FROM storage.objects WHERE bucket_id = 'tenant-plan-files' AND name = v_path1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('contractor_file_delete_affects_nothing', v_n = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pm::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  DELETE FROM storage.objects WHERE bucket_id = 'tenant-plan-files' AND name = v_path1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('pm_file_delete_ok', v_n = 1);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ═══ 8. Cascades and unlinking (postgres path) ══════════════════════════
  SELECT count(*) INTO v_n FROM tenants.status_plan_shapes WHERE sheet_id = v_sheet1;
  INSERT INTO _r VALUES ('fx_sheet1_has_a_shape', v_n = 1);
  DELETE FROM tenants.status_plan_sheets WHERE id = v_sheet1;
  SELECT count(*) INTO v_n FROM tenants.status_plan_shapes WHERE id = v_shape;
  INSERT INTO _r VALUES ('sheet_delete_cascades_its_shapes', v_n = 0);

  DELETE FROM structure.nodes WHERE id = v_t2;
  SELECT node_id INTO v_uuid FROM tenants.status_plan_shapes WHERE id = v_shape2;
  INSERT INTO _r VALUES ('node_hard_delete_unlinks_shape',
    v_uuid IS NULL AND EXISTS (SELECT 1 FROM tenants.status_plan_shapes WHERE id = v_shape2));

  -- ═══ 9. Deleting the author clears created_by (FK SET NULL survives the triggers)
  SELECT created_by INTO v_uuid FROM tenants.status_plan_sheets WHERE id = v_sheet2;
  INSERT INTO _r VALUES ('fx_sheet2_stamped', v_uuid = v_pm);
  DELETE FROM auth.users WHERE id = v_pm;
  SELECT created_by INTO v_uuid FROM tenants.status_plans WHERE id = v_layout;
  INSERT INTO _r VALUES ('author_delete_clears_plan_created_by',
    v_uuid IS NULL AND EXISTS (SELECT 1 FROM tenants.status_plans WHERE id = v_layout));
  SELECT created_by INTO v_uuid FROM tenants.status_plan_sheets WHERE id = v_sheet2;
  INSERT INTO _r VALUES ('author_delete_clears_sheet_created_by',
    v_uuid IS NULL AND EXISTS (SELECT 1 FROM tenants.status_plan_sheets WHERE id = v_sheet2));
END $$;

SELECT * FROM (VALUES
  ('FIXTURE: PM resolves to project_manager with project access',      (SELECT v FROM _r WHERE k='fx_pm_role')),
  ('FIXTURE: contractor resolves to contractor with project access',   (SELECT v FROM _r WHERE k='fx_contractor_role')),
  ('FIXTURE: client viewer resolves to client_viewer',                 (SELECT v FROM _r WHERE k='fx_client_role')),
  ('FIXTURE: lapsed PM passes the role helper, fails project access',  (SELECT v FROM _r WHERE k='fx_lapsed_probe_is_the_right_person')),
  ('FIXTURE: sheet 1 carries a shape before it is deleted',            (SELECT v FROM _r WHERE k='fx_sheet1_has_a_shape')),
  ('FIXTURE: sheet 2 is stamped with its author before the delete',    (SELECT v FROM _r WHERE k='fx_sheet2_stamped')),
  ('PM creates the floor plan',                                        (SELECT v FROM _r WHERE k='pm_plan_insert_ok')),
  ('plan organisation is bound from the project (wrong value discarded)', (SELECT v FROM _r WHERE k='pm_plan_org_bound_from_project')),
  ('plan created_by is the caller, not the supplied id',               (SELECT v FROM _r WHERE k='pm_plan_created_by_is_caller')),
  ('one plan per project per purpose',                                 (SELECT v FROM _r WHERE k='pm_plan_one_per_purpose')),
  ('a plan''s purpose is fixed',                                       (SELECT v FROM _r WHERE k='pm_plan_purpose_fixed')),
  ('a plan''s project is fixed',                                       (SELECT v FROM _r WHERE k='pm_plan_project_fixed')),
  ('PM renames a plan',                                                (SELECT v FROM _r WHERE k='pm_plan_rename_ok')),
  ('PM uploads a file under the plan''s folder',                       (SELECT v FROM _r WHERE k='pm_file_upload_ok')),
  ('a file under a plan that does not exist is refused',               (SELECT v FROM _r WHERE k='pm_file_upload_unknown_plan_refused')),
  ('a file with a name outside the pattern is refused',                (SELECT v FROM _r WHERE k='pm_file_upload_bad_name_refused')),
  ('PM reads the file',                                                (SELECT v FROM _r WHERE k='pm_file_read_ok')),
  ('PM adds a sheet',                                                  (SELECT v FROM _r WHERE k='pm_sheet_insert_ok')),
  ('sheet organisation is bound from the plan',                        (SELECT v FROM _r WHERE k='pm_sheet_org_bound_from_plan')),
  ('a new sheet starts at revision 1, not replaced (client values discarded)', (SELECT v FROM _r WHERE k='pm_sheet_starts_at_revision_1_unreplaced')),
  ('sheet created_by is the caller',                                   (SELECT v FROM _r WHERE k='pm_sheet_created_by_is_caller')),
  ('a second sheet may be page 2 of the same file',                    (SELECT v FROM _r WHERE k='pm_second_sheet_same_file_ok')),
  ('two sheets cannot share a position',                               (SELECT v FROM _r WHERE k='pm_sheet_duplicate_position_refused')),
  ('a sheet cannot point at another plan''s folder',                   (SELECT v FROM _r WHERE k='pm_sheet_path_of_another_plan_refused')),
  ('a sheet cannot point at another project''s folder',                (SELECT v FROM _r WHERE k='pm_sheet_path_of_another_project_refused')),
  ('a sheet''s type must match its file',                              (SELECT v FROM _r WHERE k='pm_sheet_mime_must_match_file')),
  ('an image sheet is page 1',                                         (SELECT v FROM _r WHERE k='pm_sheet_image_has_one_page')),
  ('a blank sheet label is refused',                                   (SELECT v FROM _r WHERE k='pm_sheet_blank_label_refused')),
  ('a scale without its points and distance is refused',               (SELECT v FROM _r WHERE k='pm_sheet_half_scale_refused')),
  ('PM sets a sheet''s scale',                                         (SELECT v FROM _r WHERE k='pm_sheet_calibrate_ok')),
  ('replacing the file bumps the revision by exactly one',             (SELECT v FROM _r WHERE k='pm_sheet_replace_bumps_revision')),
  ('replacing flags the sheet and remembers the old file',             (SELECT v FROM _r WHERE k='pm_sheet_replace_flags_and_remembers_old_file')),
  ('replacing keeps the scale',                                        (SELECT v FROM _r WHERE k='pm_sheet_replace_keeps_scale')),
  ('the page changes only together with the file',                     (SELECT v FROM _r WHERE k='pm_sheet_page_needs_a_new_file')),
  ('a sheet cannot point at another org's folder',                     (SELECT v FROM _r WHERE k='pm_sheet_path_of_another_org_refused')),
  ('file path with another org's segment is refused',                  (SELECT v FROM _r WHERE k='pm_file_other_org_segment_refused')),
  ('file path with a '..' segment is refused',                         (SELECT v FROM _r WHERE k='pm_file_dotdot_segment_refused')),
  ('file path with an extra segment is refused',                       (SELECT v FROM _r WHERE k='pm_file_extra_segment_refused')),
  ('file path with an uppercase UUID is refused',                      (SELECT v FROM _r WHERE k='pm_file_uppercase_uuid_refused')),
  ('the replaced flag cannot be set by hand',                          (SELECT v FROM _r WHERE k='pm_sheet_replaced_flag_cannot_be_forged')),
  ('re-anchoring clears the flag and keeps the revision',              (SELECT v FROM _r WHERE k='pm_sheet_reanchor_clears_flag')),
  ('a sheet cannot move to another plan',                              (SELECT v FROM _r WHERE k='pm_sheet_cannot_move_plan')),
  ('PM masks a shop on a sheet',                                       (SELECT v FROM _r WHERE k='pm_shape_insert_ok')),
  ('a board appears once per plan, across sheets',                     (SELECT v FROM _r WHERE k='pm_node_once_across_sheets')),
  ('a shape''s sheet must belong to its plan',                         (SELECT v FROM _r WHERE k='pm_shape_sheet_of_another_plan_refused')),
  ('PM masks another shop on the second sheet',                        (SELECT v FROM _r WHERE k='pm_shape_on_second_sheet_ok')),
  ('a shape cannot move to another sheet',                             (SELECT v FROM _r WHERE k='pm_shape_cannot_move_sheet')),
  ('a board from another project is refused',                          (SELECT v FROM _r WHERE k='pm_shape_foreign_node_refused')),
  ('a soft-deleted board is refused',                                  (SELECT v FROM _r WHERE k='pm_shape_soft_deleted_node_refused')),
  ('a floor plan refuses a main board',                                (SELECT v FROM _r WHERE k='pm_shape_main_board_on_layout_refused')),
  ('a line diagram accepts a main board (detected)',                   (SELECT v FROM _r WHERE k='pm_shape_main_board_on_schematic_ok')),
  ('a line diagram refuses an area type',                              (SELECT v FROM _r WHERE k='pm_shape_area_on_schematic_refused')),
  ('contractor reads the plan',                                        (SELECT v FROM _r WHERE k='contractor_reads_plan')),
  ('contractor reads the sheets',                                      (SELECT v FROM _r WHERE k='contractor_reads_sheets')),
  ('contractor reads the shape',                                       (SELECT v FROM _r WHERE k='contractor_reads_shape')),
  ('contractor reads the file',                                        (SELECT v FROM _r WHERE k='contractor_reads_file')),
  ('RESTRICTIVE gate bites: contractor sheet insert refused 42501',    (SELECT v FROM _r WHERE k='contractor_sheet_insert_refused')),
  ('contractor update of a readable sheet affects nothing',            (SELECT v FROM _r WHERE k='contractor_sheet_update_affects_nothing')),
  ('contractor delete of a readable sheet affects nothing',            (SELECT v FROM _r WHERE k='contractor_sheet_delete_affects_nothing')),
  ('contractor shape insert refused 42501',                            (SELECT v FROM _r WHERE k='contractor_shape_insert_refused')),
  ('contractor update of a readable plan affects nothing',             (SELECT v FROM _r WHERE k='contractor_plan_update_affects_nothing')),
  ('contractor file upload refused',                                   (SELECT v FROM _r WHERE k='contractor_file_upload_refused')),
  ('client viewer reads the plan',                                     (SELECT v FROM _r WHERE k='client_reads_plan')),
  ('client viewer reads the sheets',                                   (SELECT v FROM _r WHERE k='client_reads_sheets')),
  ('client viewer reads the shape',                                    (SELECT v FROM _r WHERE k='client_reads_shape')),
  ('client viewer reads the file',                                     (SELECT v FROM _r WHERE k='client_reads_file')),
  ('client viewer sheet insert refused',                               (SELECT v FROM _r WHERE k='client_sheet_insert_refused')),
  ('client viewer sheet update affects nothing',                       (SELECT v FROM _r WHERE k='client_sheet_update_affects_nothing')),
  ('client viewer sheet delete affects nothing',                       (SELECT v FROM _r WHERE k='client_sheet_delete_affects_nothing')),
  ('client viewer shape insert refused',                               (SELECT v FROM _r WHERE k='client_shape_insert_refused')),
  ('client viewer shape delete affects nothing',                       (SELECT v FROM _r WHERE k='client_shape_delete_affects_nothing')),
  ('client viewer file delete affects nothing',                        (SELECT v FROM _r WHERE k='client_file_delete_affects_nothing')),
  ('client viewer file upload refused',                                (SELECT v FROM _r WHERE k='client_file_upload_refused')),
  ('site scope: lapsed PM sees no plan',                               (SELECT v FROM _r WHERE k='lapsed_sees_no_plan')),
  ('site scope: lapsed PM sees no sheet',                              (SELECT v FROM _r WHERE k='lapsed_sees_no_sheet')),
  ('site scope: lapsed PM sees no shape',                              (SELECT v FROM _r WHERE k='lapsed_sees_no_shape')),
  ('site scope: lapsed PM sees no file',                               (SELECT v FROM _r WHERE k='lapsed_sees_no_file')),
  ('FIXTURE: the plan, sheet, shape and file the lapsed PM was refused on exist', (SELECT v FROM _r WHERE k='fx_lapsed_targets_exist')),
  ('site scope: lapsed PM shape insert refused',                       (SELECT v FROM _r WHERE k='lapsed_shape_insert_refused')),
  ('site scope: lapsed PM file upload refused',                        (SELECT v FROM _r WHERE k='lapsed_file_upload_refused')),
  ('site scope: lapsed PM file delete affects nothing',                (SELECT v FROM _r WHERE k='lapsed_file_delete_affects_nothing')),
  ('site scope: lapsed PM sheet insert refused',                       (SELECT v FROM _r WHERE k='lapsed_sheet_insert_refused')),
  ('service role sees every sheet (renderers are not blind)',          (SELECT v FROM _r WHERE k='service_role_sees_sheets')),
  ('anon refused on the sheets table',                                 (SELECT v FROM _r WHERE k='anon_sheets_table_refused')),
  ('anon refused on the file-path function',                           (SELECT v FROM _r WHERE k='anon_file_project_fn_refused')),
  ('contractor file delete affects nothing',                           (SELECT v FROM _r WHERE k='contractor_file_delete_affects_nothing')),
  ('PM deletes a file',                                                (SELECT v FROM _r WHERE k='pm_file_delete_ok')),
  ('deleting a sheet deletes its shapes',                              (SELECT v FROM _r WHERE k='sheet_delete_cascades_its_shapes')),
  ('hard-deleting a board unlinks its shape and keeps the shape',      (SELECT v FROM _r WHERE k='node_hard_delete_unlinks_shape')),
  ('deleting the author clears the plan''s created_by, keeps the plan',  (SELECT v FROM _r WHERE k='author_delete_clears_plan_created_by')),
  ('deleting the author clears the sheet''s created_by, keeps the sheet', (SELECT v FROM _r WHERE k='author_delete_clears_sheet_created_by'))
) AS t("check", ok);
