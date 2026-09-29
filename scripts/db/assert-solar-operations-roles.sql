-- BEHAVIOURAL assertions for 00217_solar_operations (Solar Phase 7), run as real roles.
--   RED:   scripts/db/dry-run-migration.sh <00207..00216 chain> scripts/db/assert-solar-operations-roles.sql
--   GREEN: scripts/db/dry-run-migration.sh <00207..00216 chain + 00217> scripts/db/assert-solar-operations-roles.sql
-- Fixtures are minted inside the transaction and rolled back. WM-Consulting is NOT used (it
-- bypasses the paywall, so it has no negative case).

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_org      UUID := gen_random_uuid();
  v_org2     UUID := gen_random_uuid();
  v_p        UUID := gen_random_uuid();
  v_p2       UUID := gen_random_uuid();
  v_admin    UUID := gen_random_uuid();   -- admin of v_org
  v_edit     UUID := gen_random_uuid();   -- contractor, EDIT grant
  v_money    UUID := gen_random_uuid();   -- contractor, EDIT_FINANCIALS grant
  v_view     UUID := gen_random_uuid();   -- contractor, VIEW grant
  v_nogrant  UUID := gen_random_uuid();   -- contractor member, no grant
  v_client   UUID := gen_random_uuid();   -- client_viewer on v_p (FORGED edit_financials grant)
  v_foreign  UUID := gen_random_uuid();   -- admin of v_org2
  v_study    UUID;
  v_study2   UUID;
  v_w        UUID;
  v_case     UUID;
  v_run      UUID;
  v_prop_acc UUID := gen_random_uuid();
  v_prop_dr  UUID := gen_random_uuid();
  v_inst     UUID;
  v_msolar   UUID;
  v_mbig     UUID;
  v_mcouncil UUID;
  v_mtenant  UUID;
  v_mforeign UUID;
  v_f1       UUID;
  v_f2       UUID;
  v_f3       UUID;
  v_c1       UUID;
  v_c2       UUID;
  v_c4       UUID;
  v_d1       UUID;
  v_doc1     UUID := gen_random_uuid();
  v_doc2     UUID := gen_random_uuid();
  v_item     UUID;
  v_rep1     UUID;
  v_rep2     UUID;
  v_m1       UUID;
  v_m2       UUID;
  v_j        JSONB;
  v_n        INT;
  u          UUID;
  v_hash     CONSTANT TEXT := repeat('c', 64);
  v_sha1     CONSTANT TEXT := repeat('1', 64);
  v_sha2     CONSTANT TEXT := repeat('2', 64);
  v_sha3     CONSTANT TEXT := repeat('3', 64);
  -- Set once the run exists: 00217 binds baseline.caseRunId to the accepted proposal's run.
  v_baseline JSONB;
  v_mov      UUID;
  v_c5       UUID;
  v_c6       UUID;
  v_d2       UUID;
BEGIN
  -- ── Fixtures (as postgres) ────────────────────────────────────────────────
  INSERT INTO public.organisations (id, name) VALUES (v_org, 'solar-7-probe'), (v_org2, 'solar-7-probe-2');
  FOREACH u IN ARRAY ARRAY[v_admin, v_edit, v_money, v_view, v_nogrant, v_client, v_foreign] LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'solar-7-probe-' || u || '@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  END LOOP;
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
    (v_admin, v_org, 'admin', TRUE), (v_edit, v_org, 'contractor', TRUE), (v_money, v_org, 'contractor', TRUE),
    (v_view, v_org, 'contractor', TRUE), (v_nogrant, v_org, 'contractor', TRUE),
    (v_client, v_org, 'client_viewer', TRUE), (v_foreign, v_org2, 'admin', TRUE);
  INSERT INTO projects.projects (id, organisation_id, name, created_by) VALUES
    (v_p, v_org, 'solar-7-probe-p', v_admin), (v_p2, v_org2, 'solar-7-probe-p2', v_foreign);
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
  INSERT INTO solar.project_access (project_id, user_id, organisation_id, level) VALUES (v_p, v_client, v_org, 'edit_financials');
  SET LOCAL session_replication_role = origin;
  INSERT INTO solar.studies (project_id, latitude, longitude) VALUES (v_p, -25.75, 28.19) RETURNING id INTO v_study;
  INSERT INTO solar.studies (project_id) VALUES (v_p2) RETURNING id INTO v_study2;
  INSERT INTO solar.weather_datasets (organisation_id, source, lat_round, lng_round, storage_path, content_sha256)
  VALUES (v_org, 'pvgis_tmy', -25.75, 28.19, v_org || '/w1.csv.gz', v_hash) RETURNING id INTO v_w;
  INSERT INTO solar.cases (study_id, name, config) VALUES (v_study, 'Base', '{"version":1}') RETURNING id INTO v_case;
  INSERT INTO solar.case_runs (case_id, engine_version, inputs, inputs_hash, config_snapshot, weather_dataset_id)
  VALUES (v_case, '0.1.0', '{}', v_hash, '{}', v_w) RETURNING id INTO v_run;
  UPDATE solar.case_runs SET status = 'succeeded', outputs = '{"kpis":{"dcKwp":100}}', hourly_path = 'h.csv.gz' WHERE id = v_run;
  v_baseline := jsonb_build_object('version', 1, 'caseRunId', v_run::text, 'inputsHash', 'h', 'dcKwp', 100, 'acKw', 80,
    'performanceRatio', 0.8,
    'monthlyKwh', '[15000,14000,14500,13000,12000,11000,11500,13000,14000,15000,15500,16000]'::jsonb,
    'diurnalKw', (SELECT jsonb_agg(to_jsonb(array_fill(0, ARRAY[24]))) FROM generate_series(1, 12)),
    'ghiKwhM2', NULL);
  -- Proposals straight to their end states (the 00216 guard is exercised by its own file).
  SET LOCAL session_replication_role = replica;
  INSERT INTO solar.proposals (id, study_id, project_id, organisation_id, family_id, version, case_id, case_run_id, status,
                               snapshot, pdf_path, pdf_sha256, share_token_hash, expires_at, issued_at, responded_at)
  VALUES (v_prop_acc, v_study, v_p, v_org, v_prop_acc, 1, v_case, v_run, 'accepted',
          '{"version":1}', 'o/p/a.pdf', v_hash, v_hash, now() + interval '30 days', now(), now());
  INSERT INTO solar.proposals (id, study_id, project_id, organisation_id, family_id, version, case_id, status)
  VALUES (v_prop_dr, v_study, v_p, v_org, v_prop_dr, 1, v_case, 'draft');
  SET LOCAL session_replication_role = origin;
  -- Meter library
  INSERT INTO solar.meters (organisation_id, label, kind) VALUES (v_org, 'PV main', 'solar') RETURNING id INTO v_msolar;
  INSERT INTO solar.meters (organisation_id, label, kind) VALUES (v_org, 'PV roof B', 'solar') RETURNING id INTO v_mbig;
  INSERT INTO solar.meters (organisation_id, label, kind) VALUES (v_org, 'Council', 'council') RETURNING id INTO v_mcouncil;
  INSERT INTO solar.meters (organisation_id, label, kind) VALUES (v_org, 'Shop 1', 'tenant') RETURNING id INTO v_mtenant;
  INSERT INTO solar.meters (organisation_id, label, kind) VALUES (v_org2, 'Other PV', 'solar') RETURNING id INTO v_mforeign;
  INSERT INTO solar.meter_files (project_id, sha256, size_bytes, storage_path, original_name, status)
  VALUES (v_p, v_sha1, 10, v_org || '/' || v_p || '/' || v_sha1 || '.csv', 'march-a.csv', 'accepted') RETURNING id INTO v_f1;
  INSERT INTO solar.meter_files (project_id, sha256, size_bytes, storage_path, original_name, status)
  VALUES (v_p, v_sha2, 10, v_org || '/' || v_p || '/' || v_sha2 || '.csv', 'march-b.csv', 'accepted') RETURNING id INTO v_f2;
  INSERT INTO solar.meter_files (project_id, sha256, size_bytes, storage_path, original_name, status)
  VALUES (v_p, v_sha3, 10, v_org || '/' || v_p || '/' || v_sha3 || '.csv', 'may.csv', 'accepted') RETURNING id INTO v_f3;
  -- c1 (older file) and c2 (newer file) both feed PV main with the SAME timestamp.
  -- Distinct source_column: 00210's meter_channels_source_key is UNIQUE NULLS NOT DISTINCT on
  -- (meter_id, file_id, source_column) and file_id is ON DELETE SET NULL, so two same-named
  -- channels of one meter collide when the project delete in section 11 nulls both file ids
  -- (a 00210 trap, reported separately; the dedupe under test does not depend on the name).
  INSERT INTO solar.meter_channels (meter_id, file_id, source_column, quantity, direction, source_unit, unit,
                                    interval_min, tz_convention, is_primary, parser_version, created_at)
  VALUES (v_msolar, v_f1, 'kW', 'active_power', 'export', 'kW', 'kW', 30, 'end', TRUE, 'probe', now() - interval '1 day')
  RETURNING id INTO v_c1;
  INSERT INTO solar.meter_channels (meter_id, file_id, source_column, quantity, direction, source_unit, unit,
                                    interval_min, tz_convention, is_primary, parser_version, created_at)
  VALUES (v_msolar, v_f2, 'PV kW', 'active_power', 'export', 'kW', 'kW', 30, 'end', TRUE, 'probe', now())
  RETURNING id INTO v_c2;
  INSERT INTO solar.meter_channels (meter_id, file_id, source_column, quantity, direction, source_unit, unit,
                                    interval_min, tz_convention, is_primary, parser_version)
  VALUES (v_mbig, v_f3, 'kW', 'active_power', 'export', 'kW', 'kW', 15, 'end', TRUE, 'probe')
  RETURNING id INTO v_c4;
  INSERT INTO solar.meter_channels (meter_id, file_id, source_column, quantity, direction, source_unit, unit,
                                    interval_min, tz_convention, is_primary, parser_version)
  VALUES (v_mcouncil, v_f1, 'import kW', 'active_power', 'import', 'kW', 'kW', 30, 'end', TRUE, 'probe');
  INSERT INTO solar.meter_readings (channel_id, organisation_id, ts_end, value, quality) VALUES
    (v_c1, v_org, '2026-03-10 12:00+02', 5, 0),
    (v_c2, v_org, '2026-03-10 12:00+02', 7, 0),
    -- ends at midnight on 1 January: the interval STARTED on 31 December.
    (v_c2, v_org, '2026-01-01 00:00+02', 4, 0);
  -- 31 days x 96 fifteen-minute intervals of May 2026 (more than PostgREST's 1,000-row cap).
  INSERT INTO solar.meter_readings (channel_id, organisation_id, ts_end, value, quality)
  SELECT v_c4, v_org, t, 1, 0
    FROM generate_series(timestamptz '2026-05-01 00:15+02', timestamptz '2026-06-01 00:00+02', interval '15 minutes') AS t;
  -- Re-import at a DIFFERENT interval (review B1): PV roof C first arrives as a 15-minute export
  -- (older channel c5), then the same April morning arrives again as a 30-minute export (newer
  -- channel c6). The 15-minute readings ending 08:15/08:45/09:15/09:45 share no end time with the
  -- newer file, so an end-time-only dedupe would keep them beside it. June's older reading has no
  -- newer reading over its span and must be kept.
  INSERT INTO solar.meters (organisation_id, label, kind) VALUES (v_org, 'PV roof C', 'solar') RETURNING id INTO v_mov;
  INSERT INTO solar.meter_channels (meter_id, file_id, source_column, quantity, direction, source_unit, unit,
                                    interval_min, tz_convention, is_primary, parser_version, created_at)
  VALUES (v_mov, v_f1, 'kW 15', 'active_power', 'export', 'kW', 'kW', 15, 'end', TRUE, 'probe', now() - interval '2 days')
  RETURNING id INTO v_c5;
  INSERT INTO solar.meter_channels (meter_id, file_id, source_column, quantity, direction, source_unit, unit,
                                    interval_min, tz_convention, is_primary, parser_version, created_at)
  VALUES (v_mov, v_f2, 'kW 30', 'active_power', 'export', 'kW', 'kW', 30, 'end', TRUE, 'probe', now() - interval '12 hours')
  RETURNING id INTO v_c6;
  INSERT INTO solar.meter_readings (channel_id, organisation_id, ts_end, value, quality)
  SELECT v_c5, v_org, t, 10, 0
    FROM generate_series(timestamptz '2026-04-01 08:15+02', timestamptz '2026-04-01 10:00+02', interval '15 minutes') AS t;
  INSERT INTO solar.meter_readings (channel_id, organisation_id, ts_end, value, quality)
  SELECT v_c6, v_org, t, 20, 0
    FROM generate_series(timestamptz '2026-04-01 08:30+02', timestamptz '2026-04-01 10:00+02', interval '30 minutes') AS t;
  INSERT INTO solar.meter_readings (channel_id, organisation_id, ts_end, value, quality) VALUES
    (v_c5, v_org, '2026-06-01 08:15+02', 10, 0), (v_c5, v_org, '2026-06-01 08:30+02', 10, 0);
  -- A COMPLETE July at two intervals (review round 2): 1-15 July only in the older 15-minute file,
  -- 16-31 July only in the newer 30-minute file. Covered minutes = 31 x 1440 = 44640; readings =
  -- 15 x 96 + 16 x 48 = 2208, and 2208 x the month's smallest interval (15) = 33120 (74 %).
  INSERT INTO solar.meter_readings (channel_id, organisation_id, ts_end, value, quality)
  SELECT v_c5, v_org, t, 10, 0
    FROM generate_series(timestamptz '2026-07-01 00:15+02', timestamptz '2026-07-16 00:00+02', interval '15 minutes') AS t;
  INSERT INTO solar.meter_readings (channel_id, organisation_id, ts_end, value, quality)
  SELECT v_c6, v_org, t, 10, 0
    FROM generate_series(timestamptz '2026-07-16 00:30+02', timestamptz '2026-08-01 00:00+02', interval '30 minutes') AS t;
  INSERT INTO tenants.documents (id, organisation_id, project_id, name, storage_path) VALUES
    (v_doc1, v_org, v_p, 'CoC.pdf', v_org || '/' || v_p || '/coc.pdf'),
    (v_doc2, v_org2, v_p2, 'Other.pdf', v_org2 || '/' || v_p2 || '/other.pdf');

  -- ── 1. Installation ───────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.installations (study_id, proposal_id, baseline, as_built) VALUES (v_study, v_prop_acc, v_baseline, '{}');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('view_user_creates_installation_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('view_user_creates_installation_REFUSED', false);
  END;
  RESET ROLE;
  -- The baseline is the guarantee's yardstick and immutable, so no session may write it (review A1):
  -- even a VALID row from an Edit user is refused. createInstallationAction inserts with the service
  -- role after its Edit gate, from the accepted run it read itself.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_edit::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.installations (study_id, proposal_id, baseline, as_built) VALUES (v_study, v_prop_acc, v_baseline, '{}');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('editor_direct_insert_installation_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('editor_direct_insert_installation_REFUSED', false);
  END;
  RESET ROLE;
  -- Service path: no JWT, so auth.uid() is NULL and the author comes from the supplied value.
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE service_role;
  BEGIN
    INSERT INTO solar.installations (study_id, proposal_id, baseline, as_built) VALUES (v_study, v_prop_dr, v_baseline, '{}');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('installation_from_draft_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('installation_from_draft_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.installations (study_id, proposal_id, baseline, as_built)
    VALUES (v_study, v_prop_acc, v_baseline || '{"caseRunId":"another-run"}', '{}');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('baseline_from_another_run_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('baseline_from_another_run_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.installations (study_id, proposal_id, baseline, as_built)
    VALUES (v_study, v_prop_acc, v_baseline || '{"diurnalKw":[[0],[0],[0],[0],[0],[0],[0],[0],[0],[0],[0],[0]]}', '{}');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('baseline_short_diurnal_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('baseline_short_diurnal_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.installations (study_id, proposal_id, baseline, as_built)
    VALUES (v_study, v_prop_acc, v_baseline - 'version', '{}');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('baseline_unversioned_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('baseline_unversioned_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.installations (study_id, project_id, organisation_id, proposal_id, baseline, as_built, created_by, updated_by)
    VALUES (v_study, v_p2, v_org2, v_prop_acc, v_baseline, '{"dcKwp":100}', v_edit, v_edit) RETURNING id INTO v_inst;
    INSERT INTO _r VALUES ('installation_bound_to_study', (SELECT project_id = v_p AND organisation_id = v_org
      AND created_by = v_edit AND updated_by = v_edit FROM solar.installations WHERE id = v_inst));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('installation_bound_to_study', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_edit::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE solar.installations SET commissioning_date = '2026-02-15', as_built = '{"dcKwp":101}' WHERE id = v_inst;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('editor_updates_as_built', v_n = 1);
  BEGIN
    UPDATE solar.installations SET baseline = v_baseline || '{"dcKwp":999}' WHERE id = v_inst;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('baseline_immutable_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('baseline_immutable_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('view_user_reads_installation', (SELECT count(*) FROM solar.installations WHERE id = v_inst) = 1);
  UPDATE solar.installations SET notes = 'forged' WHERE id = v_inst;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('view_user_update_noop', v_n = 0);
  RESET ROLE;
  FOREACH u IN ARRAY ARRAY[v_nogrant, v_client, v_foreign] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO _r VALUES ('reads_no_installation_' || CASE u WHEN v_nogrant THEN 'nogrant' WHEN v_client THEN 'client' ELSE 'foreign' END,
      (SELECT count(*) FROM solar.installations WHERE project_id = v_p) = 0);
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 2. Meter roles ────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_edit::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.installation_meters (installation_id, meter_id, role) VALUES (v_inst, v_mcouncil, 'generation');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('council_as_generation_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('council_as_generation_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.installation_meters (installation_id, meter_id, role) VALUES (v_inst, v_mtenant, 'generation');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('tenant_as_generation_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('tenant_as_generation_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.installation_meters (installation_id, meter_id, role) VALUES (v_inst, v_mforeign, 'generation');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('foreign_meter_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('foreign_meter_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.installation_meters (installation_id, meter_id, role) VALUES
      (v_inst, v_msolar, 'generation'), (v_inst, v_mbig, 'generation'), (v_inst, v_mcouncil, 'consumption');
    INSERT INTO _r VALUES ('editor_links_meters', (SELECT count(*) FROM solar.installation_meters WHERE installation_id = v_inst) = 3);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_links_meters', false);
  END;
  BEGIN
    -- A meter is linked once per installation (PK), so it can never be counted in two roles.
    INSERT INTO solar.installation_meters (installation_id, meter_id, role) VALUES (v_inst, v_mcouncil, 'consumption');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN unique_violation THEN INSERT INTO _r VALUES ('meter_linked_twice_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('meter_linked_twice_REFUSED', false);
  END;
  INSERT INTO solar.installation_meters (installation_id, meter_id, role) VALUES (v_inst, v_mov, 'generation');

  -- ── 3. Generation aggregation ─────────────────────────────────────────────
  v_j := public.solar_ops_monthly_kwh(v_inst, 'generation');
  -- 7 kW x 0.5 h from the NEWER file only; 5 + 7 would be 6.0 kWh.
  INSERT INTO _r VALUES ('reimport_does_not_double', (v_j -> v_msolar::text -> '2026-03' ->> 'kwh')::numeric = 3.5
    AND (v_j -> v_msolar::text -> '2026-03' ->> 'n')::int = 1);
  INSERT INTO _r VALUES ('month_from_interval_start', (v_j -> v_msolar::text -> '2025-12' ->> 'kwh')::numeric = 2.0
    AND v_j -> v_msolar::text -> '2026-01' IS NULL);
  INSERT INTO _r VALUES ('council_never_in_generation', v_j -> v_mcouncil::text IS NULL);
  -- 4 × 20 kW × 0.5 h from the newer 30-minute file only; keeping the four 15-minute readings whose
  -- end times the newer file lacks would add 10 kWh (50) and 4 readings (n = 8).
  INSERT INTO _r VALUES ('reimport_other_interval_does_not_double', (v_j -> v_mov::text -> '2026-04' ->> 'kwh')::numeric = 40
    AND (v_j -> v_mov::text -> '2026-04' ->> 'n')::int = 4);
  INSERT INTO _r VALUES ('uncovered_older_reading_kept', (v_j -> v_mov::text -> '2026-06' ->> 'kwh')::numeric = 5
    AND (v_j -> v_mov::text -> '2026-06' ->> 'n')::int = 2);
  -- Coverage is the minutes the kept readings SPAN, not count x one interval (review round 2).
  INSERT INTO _r VALUES ('mixed_interval_month_minutes_covered', (v_j -> v_mov::text -> '2026-07' ->> 'minutes')::int = 44640
    AND (v_j -> v_mov::text -> '2026-07' ->> 'n')::int = 2208);
  v_j := public.solar_ops_series(v_inst, 'generation', DATE '2026-04-01');
  INSERT INTO _r VALUES ('series_reimport_other_interval_one_value_per_newer_interval', jsonb_array_length(v_j -> 'points') = 4
    AND (SELECT bool_and((p ->> 1)::numeric = 20 AND (p ->> 2)::int = 30) FROM jsonb_array_elements(v_j -> 'points') AS p));
  v_j := public.solar_ops_series(v_inst, 'generation', DATE '2026-05-01');
  INSERT INTO _r VALUES ('series_not_capped_at_1000', jsonb_array_length(v_j -> 'points') = 2976);
  v_j := public.solar_ops_series(v_inst, 'generation', DATE '2026-03-01');
  INSERT INTO _r VALUES ('series_one_value_per_interval', jsonb_array_length(v_j -> 'points') = 1
    AND (v_j -> 'points' -> 0 ->> 1)::numeric = 7);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('view_user_reads_generation', public.solar_ops_monthly_kwh(v_inst, 'generation') -> v_msolar::text IS NOT NULL);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_nogrant::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('nogrant_reads_no_generation', public.solar_ops_monthly_kwh(v_inst, 'generation') = '{}'::jsonb
    AND jsonb_array_length(public.solar_ops_series(v_inst, 'generation', DATE '2026-05-01') -> 'points') = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 4. Guarantee and irradiation ──────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_edit::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.guarantees (installation_id, basis, degradation_pct_per_year) VALUES (v_inst, 'p50', 0.5);
    INSERT INTO _r VALUES ('editor_saves_guarantee', (SELECT project_id = v_p FROM solar.guarantees WHERE installation_id = v_inst));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_saves_guarantee', false);
  END;
  BEGIN
    UPDATE solar.guarantees SET basis = 'pct_of_modelled' WHERE installation_id = v_inst;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('pct_basis_needs_pct_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pct_basis_needs_pct_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.guarantees SET basis = 'manual', manual_monthly_kwh = ARRAY[1,2,3,4,5,6,7,8,9,10,11]::numeric[] WHERE installation_id = v_inst;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('manual_needs_twelve_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('manual_needs_twelve_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.ops_irradiation (installation_id, month, plane, kwh_per_m2, source_note) VALUES (v_inst, '2026-03-15', 'poa', 180, 'Station X');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('irradiation_mid_month_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('irradiation_mid_month_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.ops_irradiation (installation_id, month, plane, kwh_per_m2, source_note) VALUES (v_inst, '2026-03-01', 'poa', 180, 'Station X');
    INSERT INTO _r VALUES ('editor_saves_irradiation', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_saves_irradiation', false);
  END;

  -- ── 5. Downtime ───────────────────────────────────────────────────────────
  BEGIN
    INSERT INTO solar.downtime (installation_id, starts_at, ends_at, cause) VALUES (v_inst, '2026-03-10 10:00+02', '2026-03-10 12:00+02', 'inverter_fault')
    RETURNING id INTO v_d1;
    INSERT INTO _r VALUES ('editor_adds_downtime', (SELECT created_by = v_edit AND source = 'manual' FROM solar.downtime WHERE id = v_d1));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_adds_downtime', false);
  END;
  BEGIN
    INSERT INTO solar.downtime (installation_id, starts_at, ends_at, cause) VALUES (v_inst, '2026-03-10 11:00+02', '2026-03-10 13:00+02', 'other');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN exclusion_violation THEN INSERT INTO _r VALUES ('downtime_overlap_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('downtime_overlap_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.downtime (installation_id, starts_at, ends_at, cause) VALUES (v_inst, '2026-02-01 10:00+02', '2026-02-01 11:00+02', 'other');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('downtime_before_commissioning_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('downtime_before_commissioning_REFUSED', false);
  END;
  UPDATE solar.downtime SET excluded_from_guarantee = TRUE WHERE id = v_d1;
  INSERT INTO _r VALUES ('downtime_edit_recorded', (SELECT count(*) FROM solar.downtime_history
    WHERE downtime_id = v_d1 AND op = 'update' AND actor_id = v_edit AND (old_row ->> 'excluded_from_guarantee')::boolean = FALSE) = 1);
  DELETE FROM solar.downtime WHERE id = v_d1;
  INSERT INTO _r VALUES ('downtime_delete_recorded', (SELECT count(*) FROM solar.downtime_history WHERE downtime_id = v_d1 AND op = 'delete') = 1);
  BEGIN
    INSERT INTO solar.downtime_history (downtime_id, installation_id, project_id, organisation_id, op, old_row) VALUES (v_d1, v_inst, v_p, v_org, 'update', '{}');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('history_forge_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('history_forge_REFUSED', false);
  END;
  -- Moving the commissioning date later than recorded downtime would leave that downtime before
  -- commissioning, which the downtime insert refuses (review A6/B10): the move is refused too.
  INSERT INTO solar.downtime (installation_id, starts_at, ends_at, cause) VALUES (v_inst, '2026-03-20 10:00+02', '2026-03-20 11:00+02', 'other')
  RETURNING id INTO v_d2;
  BEGIN
    UPDATE solar.installations SET commissioning_date = '2026-03-25' WHERE id = v_inst;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('commissioning_after_downtime_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('commissioning_after_downtime_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.installations SET commissioning_date = '2026-03-20' WHERE id = v_inst;
    UPDATE solar.installations SET commissioning_date = '2026-02-15' WHERE id = v_inst;
    INSERT INTO _r VALUES ('commissioning_on_downtime_day_allowed', (SELECT commissioning_date = '2026-02-15' FROM solar.installations WHERE id = v_inst));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('commissioning_on_downtime_day_allowed', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.downtime (installation_id, starts_at, ends_at, cause) VALUES (v_inst, '2026-03-11 10:00+02', '2026-03-11 12:00+02', 'other');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('view_user_adds_downtime_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('view_user_adds_downtime_REFUSED', false);
  END;
  INSERT INTO _r VALUES ('view_user_reads_history', (SELECT count(*) FROM solar.downtime_history WHERE downtime_id = v_d1) = 2);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 6. Commentary (money) ─────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_money::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.monthly_report_notes (installation_id, period_month, section, body) VALUES (v_inst, '2026-03-01', 'summary', 'Good month');
    INSERT INTO _r VALUES ('money_user_writes_note', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('money_user_writes_note', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_edit::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('editor_reads_no_notes', (SELECT count(*) FROM solar.monthly_report_notes WHERE installation_id = v_inst) = 0);
  BEGIN
    INSERT INTO solar.monthly_report_notes (installation_id, period_month, section, body) VALUES (v_inst, '2026-03-01', 'actions', 'x');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('editor_writes_note_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('editor_writes_note_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 7. Monthly report versions (service path) ─────────────────────────────
  INSERT INTO projects.reports (organisation_id, project_id, kind, source_table, source_id, title, storage_path, status, version)
  VALUES (v_org, v_p, 'solar_monthly', 'solar.installations', v_inst, 'March', 'o/p/m1.pdf', 'issued', 1) RETURNING id INTO v_rep1;
  INSERT INTO projects.reports (organisation_id, project_id, kind, source_table, source_id, title, storage_path, status, version)
  VALUES (v_org, v_p, 'solar_monthly', 'solar.installations', v_inst, 'March', 'o/p/m2.pdf', 'issued', 2) RETURNING id INTO v_rep2;
  SET LOCAL ROLE service_role;
  BEGIN
    INSERT INTO solar.monthly_reports (installation_id, period_month, version, report_id, snapshot, snapshot_sha256, pdf_sha256)
    VALUES (v_inst, '2026-03-01', 1, v_rep1, '{"period":"2026-03","actualKwh":1}', v_sha1, v_sha1) RETURNING id INTO v_m1;
    INSERT INTO solar.monthly_reports (installation_id, period_month, version, report_id, snapshot, snapshot_sha256, pdf_sha256)
    VALUES (v_inst, '2026-03-01', 2, v_rep2, '{"period":"2026-03","actualKwh":2}', v_sha2, v_sha2) RETURNING id INTO v_m2;
    INSERT INTO _r VALUES ('service_writes_two_versions', (SELECT array_agg(version ORDER BY version) = ARRAY[1, 2]
      FROM solar.monthly_reports WHERE installation_id = v_inst AND period_month = '2026-03-01'));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('service_writes_two_versions', false);
  END;
  BEGIN
    INSERT INTO solar.monthly_reports (installation_id, period_month, version, snapshot, snapshot_sha256, pdf_sha256)
    VALUES (v_inst, '2026-03-01', 5, '{"period":"2026-03"}', v_sha3, v_sha3);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN unique_violation THEN INSERT INTO _r VALUES ('skipped_version_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('skipped_version_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.monthly_reports (installation_id, period_month, version, snapshot, snapshot_sha256, pdf_sha256)
    VALUES (v_inst, '2026-04-01', 1, '{"period":"2026-03"}', v_sha3, v_sha3);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('snapshot_period_mismatch_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('snapshot_period_mismatch_REFUSED', false);
  END;
  -- These two attempts are NOT rolled back when wrongly allowed: an edited v1 must also turn
  -- report_v2_leaves_v1_unchanged red below (the "edit v1 instead of issuing v2" defect, WM M1/M2).
  BEGIN
    UPDATE solar.monthly_reports SET snapshot = '{"period":"2026-03","actualKwh":99}' WHERE id = v_m1;
    INSERT INTO _r VALUES ('service_update_v1_REFUSED', false);
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('service_update_v1_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('service_update_v1_REFUSED', false);
  END;
  RESET ROLE;
  BEGIN
    UPDATE solar.monthly_reports SET snapshot = '{"period":"2026-03","actualKwh":98}' WHERE id = v_m1;
    INSERT INTO _r VALUES ('owner_update_v1_REFUSED', false);
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('owner_update_v1_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('owner_update_v1_REFUSED', false);
  END;
  INSERT INTO _r VALUES ('report_v2_leaves_v1_unchanged', (SELECT snapshot = '{"period":"2026-03","actualKwh":1}'::jsonb
    AND snapshot_sha256 = v_sha1 AND pdf_sha256 = v_sha1 AND report_id = v_rep1 FROM solar.monthly_reports WHERE id = v_m1));
  BEGIN
    DELETE FROM solar.monthly_reports WHERE id = v_m1;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('owner_delete_v1_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('owner_delete_v1_REFUSED', false);
  END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_money::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.monthly_reports (installation_id, period_month, version, snapshot, snapshot_sha256, pdf_sha256)
    VALUES (v_inst, '2026-04-01', 1, '{"period":"2026-04"}', v_sha3, v_sha3);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('user_writes_monthly_report_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('user_writes_monthly_report_REFUSED', false);
  END;
  INSERT INTO _r VALUES ('money_user_reads_monthly_reports', (SELECT count(*) FROM solar.monthly_reports WHERE installation_id = v_inst) = 2);
  INSERT INTO _r VALUES ('money_user_reads_monthly_kind', public.user_can_read_report_kind(v_p, 'solar_monthly'));
  INSERT INTO _r VALUES ('money_user_lists_monthly_report', (SELECT count(*) FROM projects.reports WHERE project_id = v_p AND kind = 'solar_monthly') = 2);
  RESET ROLE;
  FOREACH u IN ARRAY ARRAY[v_edit, v_view, v_client, v_nogrant, v_foreign] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO _r VALUES ('no_money_reads_no_monthly_reports_' || CASE u WHEN v_edit THEN 'editor' WHEN v_view THEN 'view'
      WHEN v_client THEN 'client' WHEN v_nogrant THEN 'nogrant' ELSE 'foreign' END,
      (SELECT count(*) FROM solar.monthly_reports WHERE project_id = v_p) = 0
      AND (SELECT count(*) FROM projects.reports WHERE project_id = v_p AND kind = 'solar_monthly') = 0);
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_edit::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('earlier_kinds_still_gated', NOT public.user_can_read_report_kind(v_p, 'solar_feasibility')
    AND public.user_can_read_report_kind(v_p, 'solar_technical') AND NOT public.user_can_read_report_kind(v_p, 'solar_monthly'));
  RESET ROLE;
  -- An org admin (reports_write admits owner/admin/PM to DELETE) sees the monthly report row but
  -- cannot delete it: it is evidence of what the client received. A wrongly-allowed delete is
  -- rolled back so the later checks still see both rows.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    DELETE FROM projects.reports WHERE id = v_rep1;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001'; END IF;
    INSERT INTO _r VALUES ('admin_deletes_monthly_report_row_REFUSED', (SELECT count(*) FROM projects.reports WHERE id = v_rep1) = 1);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('admin_deletes_monthly_report_row_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 8. Handover ───────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.handover_templates (organisation_id, items) VALUES (v_org, '[{"key":"coc","label":"CoC","required":true}]');
    INSERT INTO _r VALUES ('admin_writes_template', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('admin_writes_template', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_money::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE solar.handover_templates SET name = 'Forged' WHERE organisation_id = v_org;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('non_admin_template_noop', v_n = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('view_user_reads_template', (SELECT count(*) FROM solar.handover_templates WHERE organisation_id = v_org) = 1);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_edit::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.handover_items (installation_id, item_key, label, document_id) VALUES (v_inst, 'coc', 'CoC', v_doc1) RETURNING id INTO v_item;
    INSERT INTO _r VALUES ('handover_link_completes', (SELECT completed_at IS NOT NULL AND completed_by = v_edit FROM solar.handover_items WHERE id = v_item));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('handover_link_completes', false);
  END;
  BEGIN
    UPDATE solar.handover_items SET document_id = v_doc2 WHERE id = v_item;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('foreign_document_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('foreign_document_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.handover_items SET not_applicable = TRUE WHERE id = v_item;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('na_with_document_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('na_with_document_REFUSED', false);
  END;
  UPDATE solar.handover_items SET document_id = NULL WHERE id = v_item;
  INSERT INTO _r VALUES ('handover_unlink_clears', (SELECT completed_at IS NULL AND completed_by IS NULL FROM solar.handover_items WHERE id = v_item));
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 9. anon ───────────────────────────────────────────────────────────────
  INSERT INTO _r VALUES ('anon_no_table_privilege', NOT has_table_privilege('anon', 'solar.installations', 'SELECT')
    AND NOT has_table_privilege('anon', 'solar.monthly_reports', 'SELECT') AND NOT has_table_privilege('anon', 'solar.downtime', 'SELECT'));
  INSERT INTO _r VALUES ('read_functions_not_anon',
    NOT has_function_privilege('anon', 'public.solar_ops_monthly_kwh(uuid, text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.solar_ops_series(uuid, text, date)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.solar_ops_series(uuid, text, date)', 'EXECUTE'));

  -- ── 10. Lapsed subscription: staff read nothing, rows kept ────────────────
  UPDATE billing.org_addon_subscriptions SET status = 'cancelled', current_period_end = now() - interval '1 day' WHERE organisation_id = v_org;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_money::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('lapsed_money_user_reads_nothing', (SELECT count(*) FROM solar.installations WHERE project_id = v_p) = 0
    AND (SELECT count(*) FROM solar.monthly_reports WHERE project_id = v_p) = 0
    AND public.solar_ops_monthly_kwh(v_inst, 'generation') = '{}'::jsonb);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _r VALUES ('lapsed_rows_kept', (SELECT count(*) FROM solar.installations WHERE project_id = v_p) = 1
    AND (SELECT count(*) FROM solar.monthly_reports WHERE project_id = v_p) = 2);

  -- ── 11. A project delete cascades every operations row (no history FK trap) ─
  -- A DIRECT study delete is refused by 00216 (solar.studies_keep_issued_proposals) while the
  -- accepted proposal exists, and an installation cannot exist without one. The project-delete
  -- cascade passes that guard at depth > 1 and must take every operations row with it: the
  -- installation/study cascades reach the 00217 triggers at depth > 1 (no history row, no guard).
  BEGIN
    INSERT INTO solar.downtime (installation_id, starts_at, ends_at, cause) VALUES (v_inst, '2026-03-12 10:00+02', '2026-03-12 12:00+02', 'other');
    DELETE FROM projects.projects WHERE id = v_p;
    INSERT INTO _r VALUES ('project_delete_cascades_operations', (SELECT count(*) FROM solar.installations WHERE project_id = v_p) = 0
      AND (SELECT count(*) FROM solar.monthly_reports WHERE project_id = v_p) = 0
      AND (SELECT count(*) FROM solar.downtime WHERE project_id = v_p) = 0
      AND (SELECT count(*) FROM solar.downtime_history WHERE project_id = v_p) = 0
      AND (SELECT count(*) FROM solar.handover_items WHERE project_id = v_p) = 0
      AND (SELECT count(*) FROM solar.studies WHERE id = v_study) = 0);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('project_delete_cascades_operations', false);
  END;
END $$;

SELECT k AS "check", v AS ok FROM _r ORDER BY k;
