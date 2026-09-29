-- BEHAVIOURAL assertions for 00219_solar_pricing_guards, run as real roles.
--   RED:   scripts/db/dry-run-migration.sh <00207..00215 + 00218 concatenated>          scripts/db/assert-solar-pricing-guards.sql
--   GREEN: scripts/db/dry-run-migration.sh <00207..00215 + 00218 + 00219 concatenated>  scripts/db/assert-solar-pricing-guards.sql
-- Fixtures are minted inside the transaction and rolled back. WM-Consulting is NOT used.
--
-- The export-rule guard is a DEFERRED constraint trigger (it must let save_export_rule delete and
-- re-insert rates inside one statement). The harness never commits, so every probe forces the check
-- with SET CONSTRAINTS … IMMEDIATE, exactly what COMMIT would do, and puts it back to DEFERRED.
-- On the RED run (no 00219) the SET CONSTRAINTS names do not exist: that raises, and the probe
-- records false — which is the red.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_org    UUID := gen_random_uuid();
  v_org2   UUID := gen_random_uuid();
  v_p      UUID := gen_random_uuid();
  v_admin  UUID := gen_random_uuid();
  v_edit   UUID := gen_random_uuid();   -- contractor, EDIT grant
  v_money  UUID := gen_random_uuid();   -- contractor, EDIT_FINANCIALS grant
  v_fp     UUID := gen_random_uuid();
  v_study  UUID;
  v_rs     UUID;
  v_lay    UUID;
  v_mod    UUID;   -- own-org module
  v_mod2   UUID;   -- another org's module
  v_inv    UUID;   -- own-org inverter
  v_plat   UUID;   -- platform module
  v_upd    TIMESTAMPTZ;
  v_n      INT;
  v_t      TEXT;
  u        UUID;
BEGIN
  -- ── Fixtures (as postgres) ────────────────────────────────────────────────
  INSERT INTO public.organisations (id, name) VALUES (v_org, 'solar-pricing-probe'), (v_org2, 'solar-pricing-probe-2');
  FOREACH u IN ARRAY ARRAY[v_admin, v_edit, v_money] LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'solar-pricing-probe-' || u || '@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  END LOOP;
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
    (v_admin, v_org, 'admin', TRUE), (v_edit, v_org, 'contractor', TRUE), (v_money, v_org, 'contractor', TRUE);
  INSERT INTO projects.projects (id, organisation_id, name, created_by) VALUES (v_p, v_org, 'solar-pricing-probe-p', v_admin);
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active) VALUES
    (v_p, v_edit, v_org, 'contractor', TRUE), (v_p, v_money, v_org, 'contractor', TRUE);
  INSERT INTO billing.org_addon_subscriptions (organisation_id, feature_key, status, amount_kobo, current_period_end) VALUES
    (v_org, 'solar', 'active', 199900, now() + interval '30 days');
  INSERT INTO solar.project_access (project_id, user_id, level) VALUES (v_p, v_edit, 'edit'), (v_p, v_money, 'edit_financials');
  INSERT INTO solar.studies (project_id) VALUES (v_p) RETURNING id INTO v_study;
  INSERT INTO tenants.floor_plans (id, organisation_id, project_id, name, file_path, uploaded_by, pixels_per_meter) VALUES
    (v_fp, v_org, v_p, 'Roof', 'probe/pricing/roof.pdf', v_admin, 50);
  INSERT INTO solar.roof_sources (study_id, kind, floor_plan_id, page_index) VALUES (v_study, 'drawing', v_fp, 1) RETURNING id INTO v_rs;
  INSERT INTO solar.layouts (study_id, roof_source_id, name, module_spec) VALUES (v_study, v_rs, 'Roof A', '{"pmaxW":550}') RETURNING id INTO v_lay;
  INSERT INTO solar.equipment (organisation_id, kind, make, model, specs) VALUES
    (v_org, 'module', 'Own', 'O-550', '{"pmaxW":550,"gammaPmaxPctPerC":-0.35}') RETURNING id INTO v_mod;
  INSERT INTO solar.equipment (organisation_id, kind, make, model, specs) VALUES
    (v_org2, 'module', 'Foreign', 'F-400', '{"pmaxW":400,"gammaPmaxPctPerC":-0.30}') RETURNING id INTO v_mod2;
  INSERT INTO solar.equipment (organisation_id, kind, make, model, specs) VALUES
    (v_org, 'inverter', 'Own', 'I-100', '{"acKw":100,"euroEfficiencyPct":97}') RETURNING id INTO v_inv;
  SELECT id INTO v_plat FROM solar.equipment WHERE organisation_id IS NULL AND kind = 'module' LIMIT 1;

  -- ── I-2: a manual export rule is tied to its rates ────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_money::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  -- The PATCH the gap describes: a money user writes a manual rule with no rates over REST.
  BEGIN
    UPDATE solar.studies SET export_rule = '{"version": 1, "method": "manual"}' WHERE id = v_study;
    SET CONSTRAINTS solar.studies_export_rule_rates IMMEDIATE;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('i2_direct_manual_rule_without_rates_REFUSED', true);
    WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_t = MESSAGE_TEXT;
      INSERT INTO _r VALUES ('i2_direct_manual_rule_without_rates_REFUSED (' || v_t || ')', false);
  END;
  SET CONSTRAINTS ALL DEFERRED;
  -- The Tariff tab path still works: rates first, rule last, one statement.
  SELECT updated_at INTO v_upd FROM solar.studies WHERE id = v_study;
  BEGIN
    v_upd := solar.save_export_rule(v_p, v_upd, '{"version": 1, "method": "manual", "sourceNote": "City SSEG schedule p4"}'::jsonb,
      '[{"season":"all","tou":"all","unit":"R_per_kWh","amount_excl_vat":0.85}]'::jsonb);
    SET CONSTRAINTS solar.studies_export_rule_rates, solar.export_rates_rule_match IMMEDIATE;
    SELECT count(*) INTO v_n FROM solar.study_export_rates WHERE study_id = v_study;
    INSERT INTO _r VALUES ('i2_save_export_rule_manual_ok', v_n = 1);
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_t = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('i2_save_export_rule_manual_ok (' || v_t || ')', false);
  END;
  SET CONSTRAINTS ALL DEFERRED;
  -- Re-saving manual (delete + re-insert of the same rates) is still one legal statement.
  BEGIN
    v_upd := solar.save_export_rule(v_p, v_upd, '{"version": 1, "method": "manual", "sourceNote": "City SSEG schedule p5"}'::jsonb,
      '[{"season":"all","tou":"all","unit":"R_per_kWh","amount_excl_vat":0.90}]'::jsonb);
    SET CONSTRAINTS solar.studies_export_rule_rates, solar.export_rates_rule_match IMMEDIATE;
    INSERT INTO _r VALUES ('i2_resave_manual_ok', true);
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_t = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('i2_resave_manual_ok (' || v_t || ')', false);
  END;
  SET CONSTRAINTS ALL DEFERRED;
  -- Deleting the rates straight over REST leaves a manual rule with nothing to price.
  BEGIN
    DELETE FROM solar.study_export_rates WHERE study_id = v_study;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    SET CONSTRAINTS solar.export_rates_rule_match IMMEDIATE;
    RAISE EXCEPTION 'allowed %', v_n USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('i2_direct_rate_delete_under_manual_REFUSED', true);
    WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_t = MESSAGE_TEXT;
      INSERT INTO _r VALUES ('i2_direct_rate_delete_under_manual_REFUSED (' || v_t || ')', false);
  END;
  SET CONSTRAINTS ALL DEFERRED;
  -- Switching away through the function clears the rates and passes.
  BEGIN
    v_upd := solar.save_export_rule(v_p, v_upd, '{"version": 1, "method": "none"}'::jsonb, '[]'::jsonb);
    SET CONSTRAINTS solar.studies_export_rule_rates, solar.export_rates_rule_match IMMEDIATE;
    SELECT count(*) INTO v_n FROM solar.study_export_rates WHERE study_id = v_study;
    INSERT INTO _r VALUES ('i2_switch_to_none_ok', v_n = 0);
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_t = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('i2_switch_to_none_ok (' || v_t || ')', false);
  END;
  SET CONSTRAINTS ALL DEFERRED;
  -- A stray rate under a non-manual rule is refused too (the resolver would ignore it; the DB says so).
  BEGIN
    INSERT INTO solar.study_export_rates (study_id, project_id, organisation_id, season, tou, unit, amount_excl_vat, source_note)
    VALUES (v_study, v_p, v_org, 'all', 'all', 'R_per_kWh', 0.85, 'stray');
    SET CONSTRAINTS solar.export_rates_rule_match IMMEDIATE;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('i2_stray_rate_under_none_REFUSED', true);
    WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_t = MESSAGE_TEXT;
      INSERT INTO _r VALUES ('i2_stray_rate_under_none_REFUSED (' || v_t || ')', false);
  END;
  SET CONSTRAINTS ALL DEFERRED;
  -- Control: a linked / none rule with no rates is fine written directly.
  BEGIN
    UPDATE solar.studies SET export_rule = '{"version": 1, "method": "linked_tariff"}' WHERE id = v_study;
    SET CONSTRAINTS solar.studies_export_rule_rates IMMEDIATE;
    INSERT INTO _r VALUES ('i2_direct_linked_rule_ok', true);
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_t = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('i2_direct_linked_rule_ok (' || v_t || ')', false);
  END;
  SET CONSTRAINTS ALL DEFERRED;
  RESET ROLE;

  -- ── solar.layouts.module_id → solar.equipment(id) ─────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_edit::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE solar.layouts SET module_id = gen_random_uuid() WHERE id = v_lay;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    -- The same code as another org's module: no existence oracle across organisations.
    WHEN check_violation THEN INSERT INTO _r VALUES ('m_nonexistent_module_REFUSED_same_code_as_foreign', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('m_nonexistent_module_REFUSED_same_code_as_foreign', false);
  END;
  BEGIN
    UPDATE solar.layouts SET module_id = v_mod2 WHERE id = v_lay;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('m_foreign_org_module_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('m_foreign_org_module_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.layouts SET module_id = v_inv WHERE id = v_lay;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('m_inverter_as_module_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('m_inverter_as_module_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.layouts SET module_id = v_plat WHERE id = v_lay;
    INSERT INTO _r VALUES ('m_platform_module_ok', v_plat IS NOT NULL);
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('m_platform_module_ok', false);
  END;
  BEGIN
    UPDATE solar.layouts SET module_id = v_mod WHERE id = v_lay;
    SELECT count(*) INTO v_n FROM solar.layouts WHERE id = v_lay AND module_id = v_mod AND module_spec = '{"pmaxW":550}'::jsonb;
    INSERT INTO _r VALUES ('m_own_module_ok_snapshot_untouched', v_n = 1);
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('m_own_module_ok_snapshot_untouched', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    DELETE FROM solar.equipment WHERE id = v_mod;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN foreign_key_violation THEN INSERT INTO _r VALUES ('m_delete_used_module_REFUSED_23503', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('m_delete_used_module_REFUSED_23503', false);
  END;
  -- An organisation cannot be deleted while it has projects (project_members / project_settings do not
  -- cascade), so the real order is: projects first (layouts cascade), then equipment. Prove that once
  -- the project is gone the module it pinned deletes (RESTRICT only ever protects a LIVE layout).
  BEGIN
    DELETE FROM projects.projects WHERE id = v_p;
    DELETE FROM solar.equipment WHERE id = v_mod;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    SET CONSTRAINTS ALL IMMEDIATE;
    -- Carried out of the block in the message: the RAISE rolls back everything inside it.
    RAISE EXCEPTION 'undo %', v_n USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN raise_exception THEN GET STACKED DIAGNOSTICS v_t = MESSAGE_TEXT;
      INSERT INTO _r VALUES ('m_module_deletes_once_its_project_is_gone', v_t = 'undo 1');
    WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_t = MESSAGE_TEXT;
      INSERT INTO _r VALUES ('m_module_deletes_once_its_project_is_gone (' || v_t || ')', false);
  END;
  SET CONSTRAINTS ALL DEFERRED;
  -- Deleting the study (and the project) still cascades through layouts.
  BEGIN
    DELETE FROM projects.projects WHERE id = v_p;
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'undo' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN raise_exception THEN INSERT INTO _r VALUES ('project_delete_cascades_ok', true);
    WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_t = MESSAGE_TEXT;
      INSERT INTO _r VALUES ('project_delete_cascades_ok (' || v_t || ')', false);
  END;
  SET CONSTRAINTS ALL DEFERRED;
END $$;

SELECT k AS "check", v AS ok FROM _r ORDER BY k;
