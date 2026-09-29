-- BEHAVIOURAL assertions for 00219_solar_integration_fixes, run as real roles.
--   RED:   scripts/db/dry-run-migration.sh <00208..00216 concatenated>          scripts/db/assert-solar-integration-fixes.sql
--   GREEN: scripts/db/dry-run-migration.sh <00208..00216 + 00219 concatenated>  scripts/db/assert-solar-integration-fixes.sql
-- Fixtures are minted inside the transaction and rolled back. WM-Consulting is NOT used.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_org    UUID := gen_random_uuid();
  v_org2   UUID := gen_random_uuid();
  v_p      UUID := gen_random_uuid();
  v_p2     UUID := gen_random_uuid();
  v_admin  UUID := gen_random_uuid();   -- admin of v_org (Solar edit_financials by role)
  v_edit   UUID := gen_random_uuid();   -- contractor, EDIT grant
  v_money  UUID := gen_random_uuid();   -- contractor, EDIT_FINANCIALS grant
  v_view   UUID := gen_random_uuid();   -- contractor, VIEW grant
  v_admin2 UUID := gen_random_uuid();   -- admin of v_org2
  v_fp     UUID := gen_random_uuid();
  v_fp2    UUID := gen_random_uuid();
  v_study  UUID;
  v_study2 UUID;
  v_rs     UUID;
  v_rs2    UUID;
  v_lay    UUID;
  v_lay2   UUID;
  v_lay3   UUID;
  v_case   UUID;
  v_upd    TIMESTAMPTZ;
  v_n      INT;
  v_t      TEXT;
  v_ok     BOOLEAN;
  u        UUID;
BEGIN
  -- ── Fixtures (as postgres) ────────────────────────────────────────────────
  INSERT INTO public.organisations (id, name) VALUES (v_org, 'solar-fix-probe'), (v_org2, 'solar-fix-probe-2');
  FOREACH u IN ARRAY ARRAY[v_admin, v_edit, v_money, v_view, v_admin2] LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'solar-fix-probe-' || u || '@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  END LOOP;
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
    (v_admin, v_org, 'admin', TRUE), (v_edit, v_org, 'contractor', TRUE), (v_money, v_org, 'contractor', TRUE),
    (v_view, v_org, 'contractor', TRUE), (v_admin2, v_org2, 'admin', TRUE);
  INSERT INTO projects.projects (id, organisation_id, name, created_by) VALUES
    (v_p, v_org, 'solar-fix-probe-p', v_admin), (v_p2, v_org2, 'solar-fix-probe-p2', v_admin2);
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active) VALUES
    (v_p, v_edit, v_org, 'contractor', TRUE), (v_p, v_money, v_org, 'contractor', TRUE), (v_p, v_view, v_org, 'contractor', TRUE);
  INSERT INTO billing.org_addon_subscriptions (organisation_id, feature_key, status, amount_kobo, current_period_end) VALUES
    (v_org, 'solar', 'active', 199900, now() + interval '30 days'),
    (v_org2, 'solar', 'active', 199900, now() + interval '30 days');
  INSERT INTO solar.project_access (project_id, user_id, level) VALUES
    (v_p, v_edit, 'edit'), (v_p, v_money, 'edit_financials'), (v_p, v_view, 'view');
  INSERT INTO solar.studies (project_id) VALUES (v_p) RETURNING id INTO v_study;
  INSERT INTO solar.studies (project_id) VALUES (v_p2) RETURNING id INTO v_study2;
  INSERT INTO tenants.floor_plans (id, organisation_id, project_id, name, file_path, uploaded_by, pixels_per_meter) VALUES
    (v_fp, v_org, v_p, 'Roof', 'probe/fix/roof.pdf', v_admin, 50),
    (v_fp2, v_org2, v_p2, 'Roof 2', 'probe/fix/roof2.pdf', v_admin2, 50);
  INSERT INTO solar.roof_sources (study_id, kind, floor_plan_id, page_index) VALUES (v_study, 'drawing', v_fp, 1) RETURNING id INTO v_rs;
  INSERT INTO solar.roof_sources (study_id, kind, floor_plan_id, page_index) VALUES (v_study2, 'drawing', v_fp2, 1) RETURNING id INTO v_rs2;
  INSERT INTO solar.layouts (study_id, roof_source_id, name, module_spec) VALUES (v_study, v_rs, 'Roof A', '{"pmaxW":550}') RETURNING id INTO v_lay;
  INSERT INTO solar.layouts (study_id, roof_source_id, name, module_spec) VALUES (v_study, v_rs, 'Roof B', '{"pmaxW":550}') RETURNING id INTO v_lay3;
  INSERT INTO solar.layouts (study_id, roof_source_id, name, module_spec) VALUES (v_study2, v_rs2, 'Foreign roof', '{"pmaxW":550}') RETURNING id INTO v_lay2;

  -- ── (a) audit_events: no direct user INSERT; the service path works ─────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_edit::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.audit_events (project_id, verb, object_ref) VALUES (v_p, 'layout_deleted', '{"forged":true}');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('a_editor_direct_audit_insert_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('a_editor_direct_audit_insert_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.audit_events (project_id, verb) VALUES (v_p, 'case_created');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('a_org_admin_direct_audit_insert_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('a_org_admin_direct_audit_insert_REFUSED', false);
  END;
  RESET ROLE;
  -- The server path: service role, no user JWT, actor passed by the gated action.
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  SET LOCAL ROLE service_role;
  BEGIN
    INSERT INTO solar.audit_events (project_id, verb, actor_id, organisation_id) VALUES (v_p, 'probe.service', v_edit, v_org2);
    SELECT count(*) INTO v_n FROM solar.audit_events WHERE project_id = v_p AND verb = 'probe.service' AND actor_id = v_edit AND organisation_id = v_org;
    INSERT INTO _r VALUES ('a_service_path_writes_org_bound', v_n = 1);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('a_service_path_writes_org_bound', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM solar.audit_events WHERE project_id = v_p AND verb = 'probe.service';
  INSERT INTO _r VALUES ('a_view_user_still_reads_activity', v_n = 1);
  RESET ROLE;

  -- ── (b) the export source note is money ───────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_money::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT updated_at INTO v_upd FROM solar.studies WHERE id = v_study;
  BEGIN
    v_upd := solar.save_export_rule(v_p, v_upd, '{"version": 1, "method": "manual", "sourceNote": "City SSEG schedule p4"}'::jsonb,
      '[{"season":"all","tou":"all","unit":"c_per_kWh","amount_excl_vat":95}]'::jsonb);
    SELECT count(*) INTO v_n FROM solar.study_export_rates WHERE study_id = v_study AND source_note = 'City SSEG schedule p4';
    SELECT NOT (export_rule ? 'sourceNote') AND export_rule->>'method' = 'manual' INTO v_ok FROM solar.studies WHERE id = v_study;
    INSERT INTO _r VALUES ('b_note_on_money_rows_not_on_study', v_n = 1 AND v_ok);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('b_note_on_money_rows_not_on_study', false);
  END;
  BEGIN
    UPDATE solar.studies SET export_rule = '{"version": 1, "method": "manual", "sourceNote": "smuggled"}' WHERE id = v_study;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('b_direct_note_on_study_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('b_direct_note_on_study_REFUSED', false);
  END;
  BEGIN
    PERFORM solar.save_export_rule(v_p, v_upd, '{"version": 1, "method": "manual", "sourceNote": "no rates"}'::jsonb, '[]'::jsonb);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('b_manual_without_rates_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('b_manual_without_rates_REFUSED', false);
  END;
  BEGIN
    PERFORM solar.save_export_rule(v_p, v_upd, '{"version": 1, "method": "manual", "sourceNote": "  "}'::jsonb,
      '[{"season":"all","tou":"all","unit":"c_per_kWh","amount_excl_vat":95}]'::jsonb);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('b_manual_blank_note_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('b_manual_blank_note_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*), bool_and(export_rule::text NOT LIKE '%City SSEG%') INTO v_n, v_ok FROM solar.studies WHERE id = v_study;
  INSERT INTO _r VALUES ('b_view_user_reads_study_without_note', v_n = 1 AND coalesce(v_ok, false));
  SELECT count(*) INTO v_n FROM solar.study_export_rates WHERE study_id = v_study;
  INSERT INTO _r VALUES ('b_view_user_cannot_read_rates_or_note', v_n = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_edit::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM solar.study_export_rates WHERE study_id = v_study;
  INSERT INTO _r VALUES ('b_edit_user_cannot_read_note', v_n = 0);
  RESET ROLE;

  -- ── (d) cases.layout_id → solar.layouts ───────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_edit::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.cases (study_id, name, pv_source, layout_id, config) VALUES (v_study, 'From roof A', 'layout', v_lay, '{"version":1}') RETURNING id INTO v_case;
    INSERT INTO _r VALUES ('d_editor_links_case_to_own_layout', v_case IS NOT NULL);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('d_editor_links_case_to_own_layout', false);
  END;
  BEGIN
    INSERT INTO solar.cases (study_id, name, pv_source, layout_id, config) VALUES (v_study, 'Foreign', 'layout', v_lay2, '{"version":1}');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('d_foreign_project_layout_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('d_foreign_project_layout_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.cases (study_id, name, pv_source, layout_id, config) VALUES (v_study, 'Ghost', 'layout', gen_random_uuid(), '{"version":1}');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN foreign_key_violation OR check_violation THEN INSERT INTO _r VALUES ('d_nonexistent_layout_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('d_nonexistent_layout_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.cases SET layout_id = v_lay2 WHERE id = v_case;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('d_relink_to_foreign_layout_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('d_relink_to_foreign_layout_REFUSED', false);
  END;
  -- The editor may delete layouts (00212); a used one is refused by the FK.
  BEGIN
    DELETE FROM solar.layouts WHERE id = v_lay;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN foreign_key_violation THEN INSERT INTO _r VALUES ('d_delete_used_layout_REFUSED_23503', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('d_delete_used_layout_REFUSED_23503', false);
  END;
  DELETE FROM solar.layouts WHERE id = v_lay3;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('d_delete_unused_layout_ok', v_n = 1);
  BEGIN
    UPDATE solar.cases SET pv_source = 'manual', layout_id = NULL WHERE id = v_case;
    DELETE FROM solar.layouts WHERE id = v_lay;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('d_unlinked_layout_deletes', v_n = 1);
    RAISE EXCEPTION 'undo' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN raise_exception THEN NULL;
    WHEN OTHERS THEN INSERT INTO _r VALUES ('d_unlinked_layout_deletes', false);
  END;
  RESET ROLE;

  -- Cascades still work with a linked case in place (RESTRICT is checked immediately, so
  -- this is the case that would break if the cascade order ever deleted the layout first).
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    DELETE FROM solar.studies WHERE id = v_study;
    RAISE EXCEPTION 'undo' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN raise_exception THEN INSERT INTO _r VALUES ('d_study_delete_with_linked_case_ok', true);
    WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_t = MESSAGE_TEXT;
      INSERT INTO _r VALUES ('d_study_delete_with_linked_case_ok: ' || v_t, false);
  END;
  BEGIN
    DELETE FROM projects.projects WHERE id = v_p;
    RAISE EXCEPTION 'undo' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN raise_exception THEN INSERT INTO _r VALUES ('d_project_delete_with_linked_case_ok', true);
    WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_t = MESSAGE_TEXT;
      INSERT INTO _r VALUES ('d_project_delete_with_linked_case_ok: ' || v_t, false);
  END;
END $$;

SELECT k AS "check", v AS ok FROM _r ORDER BY k;
