-- BEHAVIOURAL assertions for 00216_solar_cases (Solar Phase 4b), run as real roles.
--   RED:   scripts/db/dry-run-migration.sh <00208..00211 concatenated> scripts/db/assert-solar-cases-roles.sql
--   GREEN: scripts/db/dry-run-migration.sh <00208..00211 + 00216 concatenated> scripts/db/assert-solar-cases-roles.sql
-- Fixtures are minted inside the transaction and rolled back. WM-Consulting is NOT used (it bypasses
-- the paywall, so it has no negative case).

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_org     UUID := gen_random_uuid();
  v_org2    UUID := gen_random_uuid();
  v_p       UUID := gen_random_uuid();
  v_p2      UUID := gen_random_uuid();
  v_admin   UUID := gen_random_uuid();   -- admin of v_org (grantor)
  v_edit    UUID := gen_random_uuid();   -- contractor, EDIT grant on v_p
  v_money   UUID := gen_random_uuid();   -- contractor, EDIT_FINANCIALS grant on v_p
  v_view    UUID := gen_random_uuid();   -- contractor, VIEW grant on v_p
  v_nogrant UUID := gen_random_uuid();   -- contractor member of v_p, no grant
  v_client  UUID := gen_random_uuid();   -- client_viewer on v_p with a FORGED edit grant
  v_foreign UUID := gen_random_uuid();   -- admin of v_org2
  v_study   UUID;
  v_study2  UUID;
  v_w       UUID;
  v_w2      UUID;
  v_case    UUID;
  v_case2   UUID;
  v_run     UUID;
  v_run2    UUID;
  v_fin     UUID;
  v_eq      UUID;
  v_platform UUID;
  v_plat_inv UUID;
  v_plat_bat UUID;
  v_eq_foreign UUID;
  v_cfg     JSONB;
  v_org_out UUID;
  v_proj_out UUID;
  v_status  TEXT;
  v_n       INT;
  v_b       BOOLEAN;
  u         UUID;
  v_hash CONSTANT TEXT := repeat('c', 64);
BEGIN
  -- ── Fixtures (as postgres) ────────────────────────────────────────────────
  INSERT INTO public.organisations (id, name) VALUES (v_org, 'solar-4b-probe'), (v_org2, 'solar-4b-probe-2');
  FOREACH u IN ARRAY ARRAY[v_admin, v_edit, v_money, v_view, v_nogrant, v_client, v_foreign] LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'solar-4b-probe-' || u || '@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  END LOOP;
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
    (v_admin, v_org, 'admin', TRUE), (v_edit, v_org, 'contractor', TRUE), (v_money, v_org, 'contractor', TRUE),
    (v_view, v_org, 'contractor', TRUE), (v_nogrant, v_org, 'contractor', TRUE),
    (v_client, v_org, 'client_viewer', TRUE), (v_foreign, v_org2, 'admin', TRUE);
  INSERT INTO projects.projects (id, organisation_id, name, created_by) VALUES
    (v_p, v_org, 'solar-4b-probe-p', v_admin), (v_p2, v_org2, 'solar-4b-probe-p2', v_foreign);
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active) VALUES
    (v_p, v_edit, v_org, 'contractor', TRUE), (v_p, v_money, v_org, 'contractor', TRUE),
    (v_p, v_view, v_org, 'contractor', TRUE), (v_p, v_nogrant, v_org, 'contractor', TRUE),
    (v_p, v_client, v_org, 'client_viewer', TRUE);
  INSERT INTO billing.org_addon_subscriptions (organisation_id, feature_key, status, amount_kobo, current_period_end) VALUES
    (v_org, 'solar', 'active', 199900, now() + interval '30 days'),
    (v_org2, 'solar', 'active', 199900, now() + interval '30 days');
  INSERT INTO solar.project_access (project_id, user_id, level) VALUES
    (v_p, v_edit, 'edit'), (v_p, v_money, 'edit_financials'), (v_p, v_view, 'view');
  SET LOCAL session_replication_role = replica;
  INSERT INTO solar.project_access (project_id, user_id, organisation_id, level) VALUES (v_p, v_client, v_org, 'edit');
  SET LOCAL session_replication_role = origin;
  INSERT INTO solar.studies (project_id) VALUES (v_p) RETURNING id INTO v_study;
  INSERT INTO solar.studies (project_id) VALUES (v_p2) RETURNING id INTO v_study2;
  INSERT INTO solar.weather_datasets (organisation_id, source, lat_round, lng_round, storage_path, content_sha256)
  VALUES (v_org, 'pvgis_tmy', -26.20, 28.05, v_org || '/w1.csv.gz', v_hash) RETURNING id INTO v_w;
  INSERT INTO solar.weather_datasets (organisation_id, source, lat_round, lng_round, storage_path, content_sha256)
  VALUES (v_org2, 'pvgis_tmy', -26.20, 28.05, v_org2 || '/w2.csv.gz', v_hash) RETURNING id INTO v_w2;
  SELECT id INTO v_platform FROM solar.equipment WHERE organisation_id IS NULL AND kind = 'module' AND make = 'Generic' LIMIT 1;
  SELECT id INTO v_plat_inv FROM solar.equipment WHERE organisation_id IS NULL AND kind = 'inverter' AND make = 'Generic' LIMIT 1;
  SELECT id INTO v_plat_bat FROM solar.equipment WHERE organisation_id IS NULL AND kind = 'battery' AND make = 'Generic' LIMIT 1;
  INSERT INTO solar.equipment (organisation_id, kind, make, model, specs)
  VALUES (v_org2, 'module', 'Foreign', 'F-400', '{"pmaxW":400,"gammaPmaxPctPerC":-0.30}') RETURNING id INTO v_eq_foreign;
  INSERT INTO _r VALUES ('platform_catalogue_seeded', v_platform IS NOT NULL);

  -- ── 1. Editor: cases ──────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_edit::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.cases (study_id, project_id, organisation_id, name, config)
    VALUES (v_study, v_p2, v_org2, 'Base', '{"version":1}')
    RETURNING id, organisation_id, project_id INTO v_case, v_org_out, v_proj_out;
    INSERT INTO _r VALUES ('editor_creates_case_org_bound', v_org_out = v_org AND v_proj_out = v_p);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_creates_case_org_bound', false);
  END;
  BEGIN
    INSERT INTO solar.cases (study_id, name, config) VALUES (v_study, ' base ', '{}');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN unique_violation THEN INSERT INTO _r VALUES ('duplicate_case_name_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('duplicate_case_name_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.cases (study_id, name, pv_source, config) VALUES (v_study, 'Layout without id', 'layout', '{}');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('layout_pairing_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('layout_pairing_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.cases SET study_id = v_study2 WHERE id = v_case;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('case_study_immutable_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('case_study_immutable_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.cases (study_id, name, config) VALUES (v_study, 'Alt', '{}') RETURNING id INTO v_case2;
    INSERT INTO _r VALUES ('editor_creates_second_case', v_case2 IS NOT NULL);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_creates_second_case', false);
  END;

  -- Equipment snapshots are rebuilt from the catalogue row (cases_bind): a PATCH with forged
  -- coefficients under a real equipmentId never reaches a run.
  BEGIN
    UPDATE solar.cases SET config = jsonb_build_object('version', 1,
        'pv', jsonb_build_object(
          'module', jsonb_build_object('equipmentId', v_platform, 'make', 'Forged', 'model', 'Forged', 'pmaxW', 9999, 'gammaPmaxPctPerC', 0),
          'inverter', jsonb_build_object('equipmentId', v_plat_inv, 'make', 'Forged', 'model', 'Forged', 'acKw', 1, 'euroEfficiencyPct', 100)),
        'battery', jsonb_build_object('unit',
          jsonb_build_object('equipmentId', v_plat_bat, 'make', 'Forged', 'model', 'Forged', 'usableKwh', 1, 'powerKw', 1, 'rtePct', 100, 'extra', true)))
     WHERE id = v_case2
    RETURNING config INTO v_cfg;
    INSERT INTO _r VALUES ('editor_forged_snapshots_rebuilt_from_catalogue',
      v_cfg #>> '{pv,module,make}' = 'Generic'
      AND (v_cfg #>> '{pv,module,pmaxW}')::numeric = 550
      AND (v_cfg #>> '{pv,module,gammaPmaxPctPerC}')::numeric = -0.35
      AND (SELECT count(*) FROM jsonb_object_keys(v_cfg #> '{pv,module}')) = 5
      AND (v_cfg #>> '{pv,inverter,acKw}')::numeric = 100
      AND (v_cfg #>> '{pv,inverter,euroEfficiencyPct}')::numeric = 98
      AND (SELECT count(*) FROM jsonb_object_keys(v_cfg #> '{pv,inverter}')) = 5
      AND (v_cfg #>> '{battery,unit,usableKwh}')::numeric = 100
      AND (v_cfg #>> '{battery,unit,powerKw}')::numeric = 50
      AND (v_cfg #>> '{battery,unit,rtePct}')::numeric = 90
      AND (SELECT count(*) FROM jsonb_object_keys(v_cfg #> '{battery,unit}')) = 6);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_forged_snapshots_rebuilt_from_catalogue', false);
  END;
  v_b := NULL;
  BEGIN
    INSERT INTO solar.cases (study_id, name, config) VALUES (v_study, 'Forged insert',
      jsonb_build_object('pv', jsonb_build_object('module',
        jsonb_build_object('equipmentId', v_platform, 'make', 'Forged', 'model', 'Forged', 'pmaxW', 9999, 'gammaPmaxPctPerC', 0))))
    RETURNING config INTO v_cfg;
    v_b := (v_cfg #>> '{pv,module,pmaxW}')::numeric = 550 AND v_cfg #>> '{pv,module,model}' <> 'Forged';
    RAISE EXCEPTION 'undo' USING ERRCODE = 'P0002';   -- roll the probe case back; v_b survives
  EXCEPTION
    WHEN no_data_found THEN NULL;
    WHEN OTHERS THEN v_b := false;
  END;
  INSERT INTO _r VALUES ('editor_insert_snapshot_rebuilt', coalesce(v_b, false));
  BEGIN
    UPDATE solar.cases SET config = jsonb_build_object('pv', jsonb_build_object('module',
        jsonb_build_object('equipmentId', v_eq_foreign, 'make', 'Foreign', 'model', 'F-400', 'pmaxW', 400, 'gammaPmaxPctPerC', -0.3)))
     WHERE id = v_case2;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('foreign_org_equipment_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('foreign_org_equipment_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.cases SET config = jsonb_build_object('pv', jsonb_build_object('module',
        jsonb_build_object('equipmentId', v_plat_inv, 'make', 'Generic', 'model', 'X', 'pmaxW', 400, 'gammaPmaxPctPerC', -0.3)))
     WHERE id = v_case2;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('wrong_kind_equipment_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('wrong_kind_equipment_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.cases SET config = jsonb_build_object('pv', jsonb_build_object('module',
        jsonb_build_object('equipmentId', 'not-a-uuid', 'make', 'Generic', 'model', 'X', 'pmaxW', 400, 'gammaPmaxPctPerC', -0.3)))
     WHERE id = v_case2;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('junk_equipment_id_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('junk_equipment_id_REFUSED', false);
  END;

  -- ── 2. Editor: runs ───────────────────────────────────────────────────────
  BEGIN
    INSERT INTO solar.case_runs (case_id, status, engine_version, inputs, inputs_hash, config_snapshot,
                                 weather_dataset_id, outputs, finished_at)
    VALUES (v_case, 'succeeded', '0.1.0', '{}', v_hash, '{}', v_w, '{"forged":true}', now())
    RETURNING id, status INTO v_run, v_status;
    INSERT INTO _r VALUES ('editor_run_born_running', v_status = 'running'
      AND (SELECT outputs IS NULL AND finished_at IS NULL FROM solar.case_runs WHERE id = v_run));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_run_born_running', false);
  END;
  BEGIN
    INSERT INTO solar.case_runs (case_id, engine_version, inputs, inputs_hash, config_snapshot, weather_dataset_id)
    VALUES (v_case, '0.1.0', '{}', v_hash, '{}', v_w);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN unique_violation THEN INSERT INTO _r VALUES ('second_running_run_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('second_running_run_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.case_runs (case_id, engine_version, inputs, inputs_hash, config_snapshot, weather_dataset_id)
    VALUES (v_case2, '0.1.0', '{}', v_hash, '{}', v_w2);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('foreign_weather_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('foreign_weather_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.case_runs SET status = 'failed', error = 'x' WHERE id = v_run;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('editor_updates_run_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('editor_updates_run_REFUSED', false);
  END;
  BEGIN
    DELETE FROM solar.case_runs WHERE id = v_run;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('editor_deletes_run_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('editor_deletes_run_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.weather_datasets (organisation_id, source, lat_round, lng_round, storage_path, content_sha256)
    VALUES (v_org, 'pvgis_tmy', -25.00, 28.00, v_org || '/w9.csv.gz', v_hash);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('editor_writes_weather_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('editor_writes_weather_REFUSED', false);
  END;
  INSERT INTO _r VALUES ('editor_reads_own_org_weather_only',
    (SELECT count(*) FROM solar.weather_datasets WHERE id = v_w) = 1
    AND (SELECT count(*) FROM solar.weather_datasets WHERE id = v_w2) = 0);
  INSERT INTO _r VALUES ('editor_reads_platform_catalogue',
    (SELECT count(*) FROM solar.equipment WHERE organisation_id IS NULL) >= 3);
  BEGIN
    INSERT INTO solar.equipment (organisation_id, kind, make, model, specs)
    VALUES (v_org, 'battery', 'X', 'Y', '{"usableKwh":10,"powerKw":5,"rtePct":90}');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('editor_writes_equipment_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('editor_writes_equipment_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 3. Service role finishes the run; then it is frozen ──────────────────
  SET LOCAL ROLE service_role;
  BEGIN
    UPDATE solar.case_runs SET inputs_hash = repeat('d', 64), status = 'failed', error = 'x' WHERE id = v_run;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('run_identity_immutable_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('run_identity_immutable_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.case_runs SET status = 'succeeded', outputs = '{"kpis":{}}', hourly_path = 'p.csv.gz'
     WHERE id = v_run RETURNING finished_at IS NOT NULL INTO v_b;
    INSERT INTO _r VALUES ('service_finishes_run', coalesce(v_b, false));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('service_finishes_run', false);
  END;
  BEGIN
    UPDATE solar.case_runs SET error = 'late edit' WHERE id = v_run;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('finished_run_frozen_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('finished_run_frozen_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.case_runs (case_id, engine_version, inputs, inputs_hash, config_snapshot, weather_dataset_id)
    VALUES (v_case2, '0.1.0', '{}', v_hash, '{}', v_w) RETURNING id INTO v_run2;
    UPDATE solar.case_runs SET error = 'still running' WHERE id = v_run2;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('update_must_finish_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('update_must_finish_REFUSED', false);
  END;
  -- the check_violation above rolled back v_run2's insert with its sub-block; make a running run on case 2 again
  INSERT INTO solar.case_runs (case_id, engine_version, inputs, inputs_hash, config_snapshot, weather_dataset_id)
  VALUES (v_case2, '0.1.0', '{}', v_hash, '{}', v_w) RETURNING id INTO v_run2;
  -- Run financials are SERVICE-written (the gated server action, after its edit_financials check):
  -- run_by is supplied explicitly because auth.uid() is NULL on the service path.
  BEGIN
    INSERT INTO solar.case_run_financials (case_run_id, case_id, project_id, organisation_id, engine_version,
                                           fin_inputs, fin_inputs_hash, tariff_ref, results, run_by)
    VALUES (v_run, v_case2, v_p2, v_org2, '0.1.0', '{}', v_hash, '{"tariffId":"t"}', '{}', v_money) RETURNING id INTO v_fin;
    INSERT INTO _r VALUES ('service_records_run_financials_bound_with_run_by',
      (SELECT run_by = v_money AND case_id = v_case AND project_id = v_p AND organisation_id = v_org
         FROM solar.case_run_financials WHERE id = v_fin));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('service_records_run_financials_bound_with_run_by', false);
  END;
  BEGIN
    INSERT INTO solar.case_run_financials (case_run_id, engine_version, fin_inputs, fin_inputs_hash, tariff_ref, results, run_by)
    VALUES (v_run2, '0.1.0', '{}', v_hash, '{"tariffId":"t"}', '{}', v_money);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('financials_on_unfinished_run_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('financials_on_unfinished_run_REFUSED', false);
  END;
  RESET ROLE;

  -- ── 4. Edit + financials: money tables ────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_money::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.case_financials (case_id, study_id, project_id, organisation_id, config)
    VALUES (v_case, v_study2, v_p2, v_org2, '{"version":1}') RETURNING organisation_id INTO v_org_out;
    INSERT INTO _r VALUES ('money_user_writes_financials_org_bound', v_org_out = v_org);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('money_user_writes_financials_org_bound', false);
  END;
  INSERT INTO _r VALUES ('money_user_reads_financials', (SELECT count(*) FROM solar.case_financials WHERE case_id = v_case) = 1);
  INSERT INTO _r VALUES ('money_user_reads_run_financials', (SELECT count(*) FROM solar.case_run_financials WHERE id = v_fin) = 1);
  -- A1: stored results are never user-written — a money user could otherwise post any figures.
  BEGIN
    INSERT INTO solar.case_run_financials (case_run_id, engine_version, fin_inputs, fin_inputs_hash, tariff_ref, results)
    VALUES (v_run, '0.1.0', '{}', v_hash, '{"tariffId":"t"}', '{"forged":true}');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('money_user_forges_run_financials_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('money_user_forges_run_financials_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.case_run_financials SET results = '{"x":1}' WHERE id = v_fin;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('run_financials_immutable_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('run_financials_immutable_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 5. Edit (no financials): sees and writes no money ─────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_edit::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('editor_reads_no_money',
    (SELECT count(*) FROM solar.case_financials) = 0 AND (SELECT count(*) FROM solar.case_run_financials) = 0);
  BEGIN
    INSERT INTO solar.case_financials (case_id, config) VALUES (v_case2, '{}');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('editor_writes_money_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('editor_writes_money_REFUSED', false);
  END;
  UPDATE solar.case_financials SET config = '{"forged":true}' WHERE case_id = v_case;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('editor_updates_money_noop', v_n = 0);

  -- ── 6. Selected case ─────────────────────────────────────────────────────
  BEGIN
    UPDATE solar.studies SET selected_case_id = v_case2 WHERE id = v_study;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('select_case_without_completed_run_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('select_case_without_completed_run_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.studies SET selected_case_id = v_case WHERE id = v_study;
    INSERT INTO _r VALUES ('editor_selects_case', (SELECT selected_case_id = v_case FROM solar.studies WHERE id = v_study));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_selects_case', false);
  END;
  BEGIN
    DELETE FROM solar.cases WHERE id = v_case;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN foreign_key_violation THEN INSERT INTO _r VALUES ('delete_selected_case_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('delete_selected_case_REFUSED', false);
  END;
  BEGIN
    DELETE FROM solar.cases WHERE id = v_case2;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('editor_deletes_unselected_case_cascading_runs', v_n = 1);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_deletes_unselected_case_cascading_runs', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _r VALUES ('cascade_removed_case2_runs', (SELECT count(*) FROM solar.case_runs WHERE id = v_run2) = 0);
  BEGIN
    UPDATE solar.studies SET selected_case_id = v_case WHERE id = v_study2;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('select_foreign_study_case_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('select_foreign_study_case_REFUSED', false);
  END;

  -- ── 7. View user: reads, never writes, no money ──────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('view_user_reads_case_and_run',
    (SELECT count(*) FROM solar.cases WHERE id = v_case) = 1 AND (SELECT count(*) FROM solar.case_runs WHERE id = v_run) = 1);
  INSERT INTO _r VALUES ('view_user_reads_no_money', (SELECT count(*) FROM solar.case_financials) = 0);
  BEGIN
    INSERT INTO solar.cases (study_id, name, config) VALUES (v_study, 'View attempt', '{}');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('view_user_creates_case_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('view_user_creates_case_REFUSED', false);
  END;
  UPDATE solar.cases SET name = 'Renamed by view' WHERE id = v_case;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('view_user_rename_noop', v_n = 0);
  BEGIN
    INSERT INTO solar.case_runs (case_id, engine_version, inputs, inputs_hash, config_snapshot, weather_dataset_id)
    VALUES (v_case, '0.1.0', '{}', v_hash, '{}', v_w);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('view_user_runs_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('view_user_runs_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 8. No grant / forged client grant / foreign admin: read nothing ──────
  FOREACH u IN ARRAY ARRAY[v_nogrant, v_client, v_foreign] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO _r VALUES ('outsider_reads_nothing_' || CASE u WHEN v_nogrant THEN 'nogrant' WHEN v_client THEN 'client' ELSE 'foreign' END,
      (SELECT count(*) FROM solar.cases WHERE project_id = v_p) = 0
      AND (SELECT count(*) FROM solar.case_runs WHERE project_id = v_p) = 0
      AND (SELECT count(*) FROM solar.case_financials WHERE project_id = v_p) = 0
      AND (SELECT count(*) FROM solar.weather_datasets WHERE id = v_w) = 0);
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 9. Equipment: org admin writes; retire, never delete; platform rows untouchable ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.equipment (organisation_id, kind, make, model, specs)
    VALUES (v_org, 'module', 'Acme', 'M-600', '{"pmaxW":600,"gammaPmaxPctPerC":-0.34}') RETURNING id INTO v_eq;
    INSERT INTO _r VALUES ('admin_adds_equipment', v_eq IS NOT NULL);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('admin_adds_equipment', false);
  END;
  -- The case org's OWN catalogue row is accepted by cases_bind (not only platform rows), and the
  -- snapshot is still rebuilt from it: a mutation narrowing the lookup to `organisation_id IS NULL`
  -- would break every org-catalogue module while every refusal above stayed green.
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_edit::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_b := NULL;
  BEGIN
    UPDATE solar.cases SET config = jsonb_set(config, '{pv}', jsonb_build_object('module',
        jsonb_build_object('equipmentId', v_eq, 'make', 'Forged', 'model', 'Forged', 'pmaxW', 9999, 'gammaPmaxPctPerC', 0)))
     WHERE id = v_case
    RETURNING config INTO v_cfg;
    v_b := v_cfg #>> '{pv,module,equipmentId}' = v_eq::text
      AND v_cfg #>> '{pv,module,make}' = 'Acme'
      AND v_cfg #>> '{pv,module,model}' = 'M-600'
      AND (v_cfg #>> '{pv,module,pmaxW}')::numeric = 600
      AND (v_cfg #>> '{pv,module,gammaPmaxPctPerC}')::numeric = -0.34;
    RAISE EXCEPTION 'undo' USING ERRCODE = 'P0002';   -- roll the probe edit back; v_b survives
  EXCEPTION
    WHEN no_data_found THEN NULL;
    WHEN OTHERS THEN v_b := false;
  END;
  INSERT INTO _r VALUES ('editor_uses_own_org_equipment_rebuilt_from_catalogue', coalesce(v_b, false));
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.equipment (organisation_id, kind, make, model, specs)
    VALUES (v_org, 'module', 'Acme', 'M-bad', '{"gammaPmaxPctPerC":-0.34}');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('equipment_without_pmax_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('equipment_without_pmax_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.equipment SET retired_at = now() WHERE id = v_eq;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('admin_retires_equipment', v_n = 1);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('admin_retires_equipment', false);
  END;
  BEGIN
    DELETE FROM solar.equipment WHERE id = v_eq;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('equipment_delete_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('equipment_delete_REFUSED', false);
  END;
  UPDATE solar.equipment SET model = 'hijacked' WHERE id = v_platform;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('admin_updates_platform_row_noop', v_n = 0);
  BEGIN
    INSERT INTO solar.equipment (organisation_id, kind, make, model, specs)
    VALUES (NULL, 'battery', 'Fake', 'Platform', '{"usableKwh":10,"powerKw":5,"rtePct":90}');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('admin_writes_platform_row_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('admin_writes_platform_row_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_foreign::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('foreign_admin_reads_platform_not_org_equipment',
    (SELECT count(*) FROM solar.equipment WHERE id = v_eq) = 0
    AND (SELECT count(*) FROM solar.equipment WHERE organisation_id IS NULL) >= 3);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_nogrant::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('nogrant_reads_no_equipment', (SELECT count(*) FROM solar.equipment) = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 10. Lapse: hidden but kept ────────────────────────────────────────────
  UPDATE billing.org_addon_subscriptions SET status = 'cancelled', current_period_end = now() - interval '1 day'
   WHERE organisation_id = v_org;
  FOREACH u IN ARRAY ARRAY[v_edit, v_admin] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO _r VALUES ('lapsed_reads_nothing_' || CASE u WHEN v_edit THEN 'editor' ELSE 'admin' END,
      (SELECT count(*) FROM solar.cases WHERE project_id = v_p) = 0
      AND (SELECT count(*) FROM solar.case_runs WHERE project_id = v_p) = 0
      AND (SELECT count(*) FROM solar.case_financials WHERE project_id = v_p) = 0);
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_edit::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.cases (study_id, name, config) VALUES (v_study, 'Lapsed attempt', '{}');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('lapsed_write_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('lapsed_write_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _r VALUES ('lapsed_rows_kept',
    (SELECT count(*) FROM solar.cases WHERE project_id = v_p) = 1
    AND (SELECT count(*) FROM solar.case_runs WHERE project_id = v_p) = 1
    AND (SELECT count(*) FROM solar.case_financials WHERE project_id = v_p) = 1);

  -- ── 11. Service role bypasses RLS ─────────────────────────────────────────
  SET LOCAL ROLE service_role;
  INSERT INTO _r VALUES ('service_role_reads_all',
    (SELECT count(*) FROM solar.cases WHERE project_id = v_p) = 1
    AND (SELECT count(*) FROM solar.case_run_financials WHERE project_id = v_p) = 1);
  RESET ROLE;
END $$;

SELECT k AS "check", v AS ok FROM _r ORDER BY k;
