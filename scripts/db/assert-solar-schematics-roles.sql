-- BEHAVIOURAL assertions for 00214_solar_schematics (Solar Phase 3b), run as real roles.
--   cat 00207 00208 00209 00210            > $SCRATCH/3b-red.sql    ; dry-run-migration.sh $SCRATCH/3b-red.sql   <this file>  (expect RED)
--   cat 00207 00208 00209 00210 00214      > $SCRATCH/3b-green.sql  ; dry-run-migration.sh $SCRATCH/3b-green.sql <this file>  (expect GREEN)
-- Fixtures are minted inside the transaction and rolled back. WM-Consulting is NOT used (it bypasses the
-- paywall, so it has no negative case). All seeding happens as postgres BEFORE the first impersonation:
-- request.jwt.claims is transaction-local and outlives RESET ROLE; it is cleared before later postgres steps.
-- REFUSAL PATTERN (as 00207/00210): a "..._REFUSED" check catches ONLY the SQLSTATE the design promises;
-- if the statement is wrongly allowed the block raises P0001 itself so the write is rolled back; any
-- other error records false instead of aborting the file.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_org     UUID := gen_random_uuid();
  v_org2    UUID := gen_random_uuid();
  v_p       UUID := gen_random_uuid();
  v_p2      UUID := gen_random_uuid();
  v_admin   UUID := gen_random_uuid();   -- admin of v_org
  v_edit    UUID := gen_random_uuid();   -- contractor, EDIT grant on v_p
  v_view    UUID := gen_random_uuid();   -- contractor, VIEW grant on v_p
  v_nogrant UUID := gen_random_uuid();   -- contractor member of v_p, no grant
  v_client  UUID := gen_random_uuid();   -- client_viewer on v_p with a FORGED edit grant
  v_foreign UUID := gen_random_uuid();   -- admin of v_org2
  v_fp1     UUID := gen_random_uuid();   -- active drawing on v_p
  v_fp2     UUID := gen_random_uuid();   -- drawing on v_p2
  v_fp3     UUID := gen_random_uuid();   -- inactive drawing on v_p
  v_fp4     UUID := gen_random_uuid();   -- second active drawing on v_p (replace target)
  v_study   UUID;
  v_study2  UUID;
  v_m1      UUID;
  v_m2      UUID;
  v_m3      UUID;   -- linked, never placed
  v_mx      UUID;   -- org meter NOT linked to the study
  v_mf      UUID;   -- org2 meter linked to study2
  v_ch      UUID;
  v_sch     UUID;
  v_sch2    UUID;
  v_blank   UUID;
  v_ack     UUID;
  v_ts      TIMESTAMPTZ;
  v_ts2     TIMESTAMPTZ;
  v_n       INT;
  v_t       TEXT;
  v_u       UUID;
  u         UUID;
BEGIN
  -- ── Fixtures (as postgres) ────────────────────────────────────────────────
  INSERT INTO public.organisations (id, name) VALUES (v_org, 'solar-3b-probe'), (v_org2, 'solar-3b-probe-2');
  FOREACH u IN ARRAY ARRAY[v_admin, v_edit, v_view, v_nogrant, v_client, v_foreign] LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'solar-3b-probe-' || u || '@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  END LOOP;
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
    (v_admin, v_org, 'admin', TRUE), (v_edit, v_org, 'contractor', TRUE), (v_view, v_org, 'contractor', TRUE),
    (v_nogrant, v_org, 'contractor', TRUE), (v_client, v_org, 'client_viewer', TRUE), (v_foreign, v_org2, 'admin', TRUE);
  INSERT INTO projects.projects (id, organisation_id, name, created_by) VALUES
    (v_p, v_org, 'solar-3b-probe-p', v_admin), (v_p2, v_org2, 'solar-3b-probe-p2', v_foreign);
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active) VALUES
    (v_p, v_edit, v_org, 'contractor', TRUE), (v_p, v_view, v_org, 'contractor', TRUE),
    (v_p, v_nogrant, v_org, 'contractor', TRUE), (v_p, v_client, v_org, 'client_viewer', TRUE);
  INSERT INTO billing.org_addon_subscriptions (organisation_id, feature_key, status, amount_kobo, current_period_end) VALUES
    (v_org, 'solar', 'active', 199900, now() + interval '30 days'),
    (v_org2, 'solar', 'active', 199900, now() + interval '30 days');
  INSERT INTO solar.project_access (project_id, user_id, level) VALUES (v_p, v_edit, 'edit'), (v_p, v_view, 'view');
  SET LOCAL session_replication_role = replica;
  INSERT INTO solar.project_access (project_id, user_id, organisation_id, level) VALUES (v_p, v_client, v_org, 'edit');
  SET LOCAL session_replication_role = origin;
  INSERT INTO tenants.floor_plans (id, organisation_id, project_id, name, file_path, uploaded_by, source_revision_id) VALUES
    (v_fp1, v_org, v_p, 'SLD', 'probe/p/sld-v1.pdf', v_admin, 'rev-1'),
    (v_fp2, v_org2, v_p2, 'Other SLD', 'probe/p2/sld.pdf', v_foreign, NULL),
    (v_fp3, v_org, v_p, 'Retired SLD', 'probe/p/old.pdf', v_admin, NULL),
    (v_fp4, v_org, v_p, 'SLD rev B', 'probe/p/sld-v2.pdf', v_admin, 'rev-2');
  UPDATE tenants.floor_plans SET is_active = FALSE WHERE id = v_fp3;
  INSERT INTO solar.studies (project_id) VALUES (v_p) RETURNING id INTO v_study;
  INSERT INTO solar.studies (project_id) VALUES (v_p2) RETURNING id INTO v_study2;
  INSERT INTO solar.meters (organisation_id, label, kind) VALUES (v_org, 'Bulk', 'bulk') RETURNING id INTO v_m1;
  INSERT INTO solar.meters (organisation_id, label, kind) VALUES (v_org, 'Shop 1', 'tenant') RETURNING id INTO v_m2;
  INSERT INTO solar.meters (organisation_id, label, kind) VALUES (v_org, 'Shop 2', 'tenant') RETURNING id INTO v_m3;
  INSERT INTO solar.meters (organisation_id, label, kind) VALUES (v_org, 'Unlinked', 'tenant') RETURNING id INTO v_mx;
  INSERT INTO solar.meters (organisation_id, label, kind) VALUES (v_org2, 'Foreign', 'tenant') RETURNING id INTO v_mf;
  INSERT INTO solar.study_meters (study_id, meter_id) VALUES (v_study, v_m1), (v_study, v_m2), (v_study, v_m3), (v_study2, v_mf);
  INSERT INTO solar.meter_channels (meter_id, source_column, quantity, direction, source_unit, unit, interval_min, tz_convention, parser_version)
    VALUES (v_m2, 'p14', 'active_power', 'import', 'kW', 'kW', 30, 'end', 'probe') RETURNING id INTO v_ch;
  PERFORM solar.write_readings(v_ch, ARRAY['2025-03-10 00:30+02', '2025-03-10 01:00+02', '2025-03-10 01:30+02']::timestamptz[],
                               ARRAY[1.5, 2.5, NULL]::float8[], ARRAY[0, 0, 1]::smallint[]);

  -- ── 1. Editor: schematics, anchors, cards, lines ──────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_edit::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.schematics (study_id, name, kind, floor_plan_id, page_index, file_path, organisation_id)
    VALUES (v_study, 'Main SLD', 'drawing', v_fp1, 2, 'forged.pdf', v_org2)
    RETURNING id, file_path, organisation_id INTO v_sch, v_t, v_u;
    INSERT INTO _r VALUES ('editor_creates_schematic_anchor_stamped',
      v_t = 'probe/p/sld-v1.pdf' AND v_u = v_org
      AND (SELECT source_revision_id FROM solar.schematics WHERE id = v_sch) = 'rev-1');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_creates_schematic_anchor_stamped', false);
  END;
  BEGIN
    INSERT INTO solar.schematics (study_id, name, kind, floor_plan_id) VALUES (v_study, 'Foreign sheet', 'drawing', v_fp2);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('schematic_foreign_drawing_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('schematic_foreign_drawing_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.schematics (study_id, name, kind, floor_plan_id) VALUES (v_study, 'Retired sheet', 'drawing', v_fp3);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('schematic_inactive_drawing_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('schematic_inactive_drawing_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.schematics (study_id, name, kind, floor_plan_id, file_path) VALUES (v_study, 'Blank', 'blank', v_fp1, 'x.pdf')
    RETURNING id INTO v_blank;
    INSERT INTO _r VALUES ('blank_schematic_has_no_anchor',
      (SELECT floor_plan_id IS NULL AND file_path IS NULL AND page_index = 1 FROM solar.schematics WHERE id = v_blank));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('blank_schematic_has_no_anchor', false);
  END;
  BEGIN
    INSERT INTO solar.schematics (study_id, name, kind) VALUES (v_study, '  main sld ', 'blank');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN unique_violation THEN INSERT INTO _r VALUES ('schematic_duplicate_name_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('schematic_duplicate_name_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.schematic_cards (schematic_id, meter_id, x, y, w, h, floor_plan_id) VALUES (v_sch, v_m1, 10, 20, 160, 70, v_fp2);
    INSERT INTO solar.schematic_cards (schematic_id, meter_id, x, y, w, h) VALUES (v_sch, v_m2, 300, 20, 160, 70);
    INSERT INTO _r VALUES ('editor_places_study_meters_anchor_bound',
      (SELECT bool_and(floor_plan_id = v_fp1 AND project_id = v_p) FROM solar.schematic_cards WHERE schematic_id = v_sch));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_places_study_meters_anchor_bound', false);
  END;
  BEGIN
    INSERT INTO solar.schematic_cards (schematic_id, meter_id, x, y, w, h) VALUES (v_sch, v_mx, 0, 0, 100, 50);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('card_unlinked_meter_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('card_unlinked_meter_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.schematic_cards (schematic_id, meter_id, x, y, w, h) VALUES (v_sch, v_mf, 0, 0, 100, 50);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('card_foreign_meter_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('card_foreign_meter_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.schematic_lines (schematic_id, from_meter_id, to_meter_id, waypoints) VALUES (v_sch, v_m1, v_m2, '[100, 50, 200, 50]');
    INSERT INTO _r VALUES ('editor_connects_placed_meters_anchor_bound',
      (SELECT floor_plan_id = v_fp1 FROM solar.schematic_lines WHERE schematic_id = v_sch));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_connects_placed_meters_anchor_bound', false);
  END;
  BEGIN
    INSERT INTO solar.schematic_lines (schematic_id, from_meter_id, to_meter_id) VALUES (v_sch, v_m1, v_m3);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('line_unplaced_meter_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('line_unplaced_meter_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.schematic_lines (schematic_id, from_meter_id, to_meter_id, waypoints) VALUES (v_sch, v_m1, v_m2, '[1, 2, 3]');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('line_odd_waypoints_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('line_odd_waypoints_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.schematic_lines (schematic_id, from_meter_id, to_meter_id) VALUES (v_sch, v_m2, v_m1);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('line_cycle_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('line_cycle_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.schematics (study_id, name, kind) VALUES (v_study, 'Second', 'blank') RETURNING id INTO v_sch2;
    INSERT INTO solar.schematic_cards (schematic_id, meter_id, x, y, w, h) VALUES (v_sch2, v_m1, 0, 0, 100, 50), (v_sch2, v_m2, 0, 100, 100, 50);
    INSERT INTO solar.schematic_lines (schematic_id, from_meter_id, to_meter_id) VALUES (v_sch2, v_m2, v_m1);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('line_cycle_across_schematics_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('line_cycle_across_schematics_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.schematic_lines (schematic_id, from_meter_id, to_meter_id, line_type) VALUES (v_sch, v_m2, v_m1, 'check');
    INSERT INTO _r VALUES ('check_line_is_outside_the_hierarchy', true);
    DELETE FROM solar.schematic_lines WHERE schematic_id = v_sch AND line_type = 'check';
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('check_line_is_outside_the_hierarchy', false);
  END;
  BEGIN
    UPDATE solar.schematics SET floor_plan_id = v_fp4, page_index = 1 WHERE id = v_sch;
    INSERT INTO _r VALUES ('replace_drawing_restamps_and_propagates',
      (SELECT file_path = 'probe/p/sld-v2.pdf' AND source_revision_id = 'rev-2' FROM solar.schematics WHERE id = v_sch)
      AND (SELECT bool_and(floor_plan_id = v_fp4) FROM solar.schematic_cards WHERE schematic_id = v_sch)
      AND (SELECT bool_and(floor_plan_id = v_fp4) FROM solar.schematic_lines WHERE schematic_id = v_sch)
      AND (SELECT x = 10 FROM solar.schematic_cards WHERE schematic_id = v_sch AND meter_id = v_m1));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('replace_drawing_restamps_and_propagates', false);
  END;
  BEGIN
    UPDATE solar.schematics SET name = 'Main SLD (renamed)' WHERE id = v_sch;
    INSERT INTO _r VALUES ('rename_keeps_anchor', (SELECT file_path = 'probe/p/sld-v2.pdf' FROM solar.schematics WHERE id = v_sch));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('rename_keeps_anchor', false);
  END;
  BEGIN
    DELETE FROM solar.schematic_cards WHERE schematic_id = v_sch AND meter_id = v_m2;
    INSERT INTO _r VALUES ('delete_card_deletes_its_lines', (SELECT count(*) FROM solar.schematic_lines WHERE schematic_id = v_sch) = 0);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('delete_card_deletes_its_lines', false);
  END;

  -- ── 2. The save RPC (replace-all, stale refused) ──────────────────────────
  BEGIN
    SELECT updated_at INTO v_ts FROM solar.schematics WHERE id = v_sch;
    SELECT public.solar_save_schematic(v_sch, v_ts,
      jsonb_build_array(
        jsonb_build_object('meterId', v_m1, 'x', 5, 'y', 5, 'w', 150, 'h', 60),
        jsonb_build_object('meterId', v_m2, 'x', 5, 'y', 200, 'w', 150, 'h', 60, 'colour', '#2563eb')),
      jsonb_build_array(jsonb_build_object('fromMeterId', v_m1, 'toMeterId', v_m2, 'waypoints', jsonb_build_array(80, 120))))
      INTO v_ts2;
    INSERT INTO _r VALUES ('save_rpc_roundtrip',
      v_ts2 > v_ts
      AND (SELECT count(*) FROM solar.schematic_cards WHERE schematic_id = v_sch) = 2
      AND (SELECT count(*) FROM solar.schematic_lines WHERE schematic_id = v_sch) = 1
      AND (SELECT colour = '#2563eb' FROM solar.schematic_cards WHERE schematic_id = v_sch AND meter_id = v_m2));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('save_rpc_roundtrip', false);
  END;
  BEGIN
    PERFORM public.solar_save_schematic(v_sch, v_ts, '[]'::jsonb, '[]'::jsonb);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN serialization_failure THEN INSERT INTO _r VALUES ('save_rpc_stale_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('save_rpc_stale_REFUSED', false);
  END;
  INSERT INTO _r VALUES ('stale_save_changed_nothing', (SELECT count(*) FROM solar.schematic_cards WHERE schematic_id = v_sch) = 2);

  -- ── 3. Acknowledgements, studies columns, bulk reads ──────────────────────
  BEGIN
    INSERT INTO solar.load_check_acks (study_id, check_key, note, acknowledged_by, organisation_id)
    VALUES (v_study, ' recon_bulk:x:3 ', 'known: common area', v_admin, v_org2) RETURNING id INTO v_ack;
    INSERT INTO _r VALUES ('editor_acks_attributed_to_self',
      (SELECT acknowledged_by = v_edit AND organisation_id = v_org AND check_key = 'recon_bulk:x:3' FROM solar.load_check_acks WHERE id = v_ack));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_acks_attributed_to_self', false);
  END;
  BEGIN
    UPDATE solar.load_check_acks SET note = 'edited' WHERE id = v_ack;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('ack_update_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('ack_update_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.studies SET schematic_waived = TRUE, load_growth_pct = 2.5,
      monthly_bills = '{"archetype":"retail","powerFactor":0.95,"months":[]}'::jsonb WHERE id = v_study;
    INSERT INTO _r VALUES ('editor_sets_new_study_columns',
      (SELECT schematic_waived AND load_growth_pct = 2.5 FROM solar.studies WHERE id = v_study));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_sets_new_study_columns', false);
  END;
  BEGIN
    UPDATE solar.studies SET load_growth_pct = 99 WHERE id = v_study;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('load_growth_out_of_range_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('load_growth_out_of_range_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.studies SET monthly_bills = '[1,2]'::jsonb WHERE id = v_study;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('monthly_bills_not_object_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('monthly_bills_not_object_REFUSED', false);
  END;
  BEGIN
    SELECT cardinality(ts_ends) INTO v_n FROM solar.channel_readings(ARRAY[v_ch], '2025-03-09', '2025-03-11');
    INSERT INTO _r VALUES ('editor_bulk_reads_readings', v_n = 3);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_bulk_reads_readings', false);
  END;
  BEGIN
    SELECT n_rows::int INTO v_n FROM solar.channel_summaries(ARRAY[v_ch]) WHERE n_usable = 2 AND max_value = 2.5 AND sum_value = 4;
    INSERT INTO _r VALUES ('editor_reads_channel_summary', v_n = 3);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_reads_channel_summary', false);
  END;
  BEGIN
    PERFORM * FROM solar.channel_readings(ARRAY[v_ch], '2020-01-01', '2026-01-01');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN invalid_parameter_value THEN INSERT INTO _r VALUES ('bulk_read_window_too_long_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('bulk_read_window_too_long_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 4. Viewer: reads, never writes ─────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('viewer_reads_schematics',
    (SELECT count(*) FROM solar.schematics WHERE study_id = v_study) >= 2
    AND (SELECT count(*) FROM solar.schematic_cards WHERE schematic_id = v_sch) = 2
    AND (SELECT count(*) FROM solar.schematic_lines WHERE schematic_id = v_sch) = 1
    AND (SELECT count(*) FROM solar.load_check_acks WHERE study_id = v_study) = 1);
  BEGIN
    INSERT INTO solar.schematics (study_id, name, kind) VALUES (v_study, 'Viewer', 'blank');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('viewer_insert_schematic_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('viewer_insert_schematic_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.schematic_cards (schematic_id, meter_id, x, y, w, h) VALUES (v_blank, v_m3, 0, 0, 100, 50);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('viewer_insert_card_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('viewer_insert_card_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.schematic_cards SET x = 999 WHERE schematic_id = v_sch;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('viewer_update_card_no_effect', v_n = 0);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('viewer_update_card_no_effect', false);
  END;
  BEGIN
    PERFORM public.solar_save_schematic(v_sch, v_ts2, '[]'::jsonb, '[]'::jsonb);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('viewer_save_rpc_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('viewer_save_rpc_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.load_check_acks (study_id, check_key) VALUES (v_study, 'viewer:ack');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('viewer_ack_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('viewer_ack_REFUSED', false);
  END;
  INSERT INTO _r VALUES ('viewer_reads_readings_rpc',
    (SELECT cardinality(ts_ends) FROM solar.channel_readings(ARRAY[v_ch], '2025-03-09', '2025-03-11')) = 3);
  INSERT INTO _r VALUES ('viewer_reads_schematic_sheet_kind', public.user_can_read_report_kind(v_p, 'solar_schematic_sheet'));
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 5. No grant, forged client grant, foreign admin: read nothing ─────────
  FOREACH u IN ARRAY ARRAY[v_nogrant, v_client, v_foreign] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO _r VALUES ('outsider_reads_nothing:' || CASE u WHEN v_nogrant THEN 'nogrant' WHEN v_client THEN 'client' ELSE 'foreign' END,
      (SELECT count(*) FROM solar.schematics WHERE study_id = v_study) = 0
      AND (SELECT count(*) FROM solar.schematic_cards WHERE schematic_id = v_sch) = 0
      AND (SELECT count(*) FROM solar.schematic_lines WHERE schematic_id = v_sch) = 0
      AND (SELECT count(*) FROM solar.load_check_acks WHERE study_id = v_study) = 0
      AND (SELECT count(*) FROM solar.channel_readings(ARRAY[v_ch], '2025-03-09', '2025-03-11')) = 0
      AND NOT COALESCE(public.user_can_read_report_kind(v_p, 'solar_schematic_sheet'), false));
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
  END LOOP;

  -- ── 6. Lapse: nobody reads or writes, rows kept ───────────────────────────
  UPDATE billing.org_addon_subscriptions SET current_period_end = now() - interval '1 day' WHERE organisation_id = v_org;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('lapsed_admin_reads_nothing', (SELECT count(*) FROM solar.schematics WHERE study_id = v_study) = 0);
  BEGIN
    INSERT INTO solar.schematics (study_id, name, kind) VALUES (v_study, 'Lapsed', 'blank');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('lapsed_insert_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('lapsed_insert_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _r VALUES ('lapsed_rows_kept', (SELECT count(*) FROM solar.schematic_cards WHERE schematic_id = v_sch) = 2);

  -- ── 7. Service role bypasses RLS ───────────────────────────────────────────
  SET LOCAL ROLE service_role;
  INSERT INTO _r VALUES ('service_role_reads_schematics', (SELECT count(*) FROM solar.schematics WHERE study_id = v_study) >= 2);
  RESET ROLE;
END $$;

SELECT k AS "check", v AS ok FROM _r ORDER BY k;
