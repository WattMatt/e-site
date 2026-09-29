-- BEHAVIOURAL assertions for 00211_solar_meter_data (Solar Phase 3a), run as real roles.
--   scripts/db/dry-run-migration.sh /tmp/noop.sql scripts/db/assert-solar-meter-data-roles.sql        (expect RED)
--   scripts/db/dry-run-migration.sh <00211 or 00208+00211> scripts/db/assert-solar-meter-data-roles.sql (expect GREEN)
--   (If 00208 is not in the ledger, the RED "no-op" is 00208 alone, so the file fails on 00211's
--   missing objects rather than on 00208's.)
-- Decision 2 (owner, 2026-09-28) is section 9b: an external View member reads the meters LINKED to a
-- study they can view (and those meters' channels and readings), nothing else, and writes nothing.
-- Fixtures are minted inside the transaction and rolled back. WM-Consulting is NOT used (it bypasses
-- the paywall, so it has no negative case). All seeding happens as postgres BEFORE the first
-- impersonation: request.jwt.claims is transaction-local and outlives RESET ROLE; it is cleared
-- explicitly before every later postgres step.
-- REFUSAL PATTERN (as 00208): a "…_REFUSED" check catches ONLY the SQLSTATE the design promises; if the
-- statement is wrongly allowed the block raises P0001 itself so the write is rolled back; any other
-- error records false instead of aborting the file.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_org     UUID := gen_random_uuid();
  v_org2    UUID := gen_random_uuid();
  v_p       UUID := gen_random_uuid();   -- project in v_org
  v_p2      UUID := gen_random_uuid();   -- project in v_org2
  v_node    UUID := gen_random_uuid();   -- board on v_p
  v_node2   UUID := gen_random_uuid();   -- board on v_p2
  v_admin   UUID := gen_random_uuid();   -- admin of v_org
  v_con     UUID := gen_random_uuid();   -- contractor, EDIT grant on v_p
  v_view    UUID := gen_random_uuid();   -- contractor, VIEW grant on v_p
  v_nogrant UUID := gen_random_uuid();   -- contractor member of v_p, no grant
  v_client  UUID := gen_random_uuid();   -- client_viewer on v_p with a FORGED edit grant
  v_ext     UUID := gen_random_uuid();   -- external: active in v_org2, member of v_p, VIEW grant
  v_foreign UUID := gen_random_uuid();   -- admin of v_org2
  v_study   UUID;
  v_file    UUID;
  v_meter   UUID;
  v_meter2  UUID;   -- org2 meter
  v_meter3  UUID;   -- second v_org meter (for link/delete tests)
  v_meter4  UUID;   -- v_org meter never linked to a study, with a channel and readings (decision 2)
  v_ch4     UUID;   -- its channel
  v_ch5     UUID;   -- a second channel on v_meter4, emptied by the editor through clear_channel_readings
  v_ch      UUID;
  v_rep     UUID;
  v_org_out UUID;
  v_uuid    UUID;
  v_n       INT;
  v_x       DOUBLE PRECISION;
  v_b       BOOLEAN;
  u         UUID;
  v_sha  CONSTANT TEXT := repeat('a', 64);
  v_ts   CONSTANT TIMESTAMPTZ[] := ARRAY['2025-03-10 00:30+02', '2025-03-10 01:00+02', '2025-03-10 01:30+02']::timestamptz[];
  v_path TEXT;
BEGIN
  -- ── Fixtures (as postgres) ────────────────────────────────────────────────
  INSERT INTO public.organisations (id, name) VALUES (v_org, 'solar-3a-probe'), (v_org2, 'solar-3a-probe-2');
  FOREACH u IN ARRAY ARRAY[v_admin, v_con, v_view, v_nogrant, v_client, v_ext, v_foreign] LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'solar-3a-probe-' || u || '@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  END LOOP;
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
    (v_admin, v_org, 'admin', TRUE), (v_con, v_org, 'contractor', TRUE), (v_view, v_org, 'contractor', TRUE),
    (v_nogrant, v_org, 'contractor', TRUE), (v_client, v_org, 'client_viewer', TRUE),
    (v_ext, v_org2, 'contractor', TRUE), (v_foreign, v_org2, 'admin', TRUE);
  INSERT INTO projects.projects (id, organisation_id, name, created_by) VALUES
    (v_p, v_org, 'solar-3a-probe-p', v_admin), (v_p2, v_org2, 'solar-3a-probe-p2', v_foreign);
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active) VALUES
    (v_p, v_con, v_org, 'contractor', TRUE), (v_p, v_view, v_org, 'contractor', TRUE),
    (v_p, v_nogrant, v_org, 'contractor', TRUE), (v_p, v_client, v_org, 'client_viewer', TRUE),
    (v_p, v_ext, v_org2, 'contractor', TRUE);
  INSERT INTO structure.nodes (id, project_id, organisation_id, kind, code) VALUES
    (v_node, v_p, v_org, 'main_board', 'SOLAR3A-MB1'), (v_node2, v_p2, v_org2, 'main_board', 'SOLAR3A-MB2');
  INSERT INTO billing.org_addon_subscriptions (organisation_id, feature_key, status, amount_kobo, current_period_end) VALUES
    (v_org, 'solar', 'active', 199900, now() + interval '30 days'),
    (v_org2, 'solar', 'active', 199900, now() + interval '30 days');
  INSERT INTO solar.project_access (project_id, user_id, level) VALUES
    (v_p, v_con, 'edit'), (v_p, v_view, 'view'), (v_p, v_ext, 'view');
  -- A forged grant for a client viewer (the eligibility trigger would refuse it).
  SET LOCAL session_replication_role = replica;
  INSERT INTO solar.project_access (project_id, user_id, organisation_id, level) VALUES (v_p, v_client, v_org, 'edit');
  SET LOCAL session_replication_role = origin;
  INSERT INTO solar.studies (project_id) VALUES (v_p) RETURNING id INTO v_study;
  INSERT INTO solar.studies (project_id) VALUES (v_p2);
  INSERT INTO solar.meters (organisation_id, label) VALUES (v_org2, 'org2 meter') RETURNING id INTO v_meter2;
  INSERT INTO solar.meters (organisation_id, label) VALUES (v_org, 'second meter') RETURNING id INTO v_meter3;
  -- Decision 2: an UNLINKED library meter with a channel and readings, which the external must never see.
  INSERT INTO solar.meters (organisation_id, label) VALUES (v_org, 'unlinked meter') RETURNING id INTO v_meter4;
  INSERT INTO solar.meter_channels (meter_id, source_column, quantity, direction, source_unit, unit,
                                    interval_min, tz_convention, parser_version)
  VALUES (v_meter4, 'p14', 'active_power', 'import', 'kW', 'kW', 30, 'begin', '3a.1') RETURNING id INTO v_ch4;
  PERFORM solar.write_readings(v_ch4, v_ts[1:2], ARRAY[4, 5]::float8[], ARRAY[0, 0]::smallint[]);
  INSERT INTO solar.meter_channels (meter_id, source_column, quantity, direction, source_unit, unit,
                                    interval_min, tz_convention, parser_version)
  VALUES (v_meter4, 'q14', 'reactive_power', 'import', 'kvar', 'kvar', 30, 'begin', '3a.1') RETURNING id INTO v_ch5;
  PERFORM solar.write_readings(v_ch5, v_ts, ARRAY[1, 2, 3]::float8[], ARRAY[0, 0, 0]::smallint[]);
  -- A raw object in the private bucket at the canonical path (for the storage read policy).
  INSERT INTO storage.objects (bucket_id, name) VALUES ('solar-meter-raw', v_org || '/' || v_p || '/' || v_sha || '.csv');

  -- ── 1. Files: organisation bound from the project; path must be <org>/<project>/<sha>.<ext> ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.meter_files (project_id, organisation_id, sha256, size_bytes, storage_path, original_name)
    VALUES (v_p, v_org2, v_sha, 100, v_org || '/' || v_p || '/' || v_sha || '.csv', 'a.csv')
    RETURNING id, organisation_id INTO v_file, v_org_out;
    INSERT INTO _r VALUES ('admin_registers_file_org_bound', v_org_out = v_org);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('admin_registers_file_org_bound', false);
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_con::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.meter_files (project_id, sha256, size_bytes, storage_path, original_name)
    VALUES (v_p, repeat('b', 64), 100, v_org2 || '/' || v_p || '/' || repeat('b', 64) || '.csv', 'b.csv');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('file_foreign_path_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('file_foreign_path_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.meter_files (project_id, sha256, size_bytes, storage_path, original_name)
    VALUES (v_p, repeat('b', 64), 100, v_org || '/' || v_p || '/' || repeat('b', 64) || '.csv', 'b.csv');
    INSERT INTO _r VALUES ('editor_registers_file', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_registers_file', false);
  END;

  -- ── 2. Meters and channels (editor) ──
  BEGIN
    INSERT INTO solar.meters (organisation_id, label, serials) VALUES (v_org, 'M1', '{30000001}') RETURNING id INTO v_meter;
    INSERT INTO _r VALUES ('editor_creates_meter', v_meter IS NOT NULL);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_creates_meter', false);
  END;
  BEGIN
    INSERT INTO solar.meter_channels (organisation_id, meter_id, file_id, source_column, quantity, direction,
                                      source_unit, unit, interval_min, tz_convention, is_primary, parser_version)
    VALUES (v_org2, v_meter, v_file, 'p14', 'active_power', 'import', 'kW', 'kW', 30, 'begin', TRUE, '3a.1')
    RETURNING id, organisation_id INTO v_ch, v_org_out;
    INSERT INTO _r VALUES ('editor_creates_channel_org_bound', v_org_out = v_org);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_creates_channel_org_bound', false);
  END;
  BEGIN
    INSERT INTO solar.meter_channels (meter_id, file_id, source_column, quantity, direction, source_unit, unit,
                                      interval_min, tz_convention, parser_version)
    VALUES (v_meter, v_file, 'x', 'unknown', 'none', 'kW', 'unknown', 30, 'end', '3a.1');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('channel_unknown_unit_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('channel_unknown_unit_REFUSED', false);
  END;

  -- ── 3. Readings: only through solar.write_readings; upsert on the PK ──
  BEGIN
    SELECT solar.write_readings(v_ch, v_ts, ARRAY[1.5, 2.5, NULL]::float8[], ARRAY[0, 0, 1]::smallint[]) INTO v_n;
    INSERT INTO _r VALUES ('editor_writes_readings', v_n = 3);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_writes_readings', false);
  END;
  BEGIN
    PERFORM solar.write_readings(v_ch, v_ts, ARRAY[9, 9, NULL]::float8[], ARRAY[0, 0, 1]::smallint[]);
    SELECT count(*) INTO v_n FROM solar.meter_readings WHERE channel_id = v_ch;
    SELECT value INTO v_x FROM solar.meter_readings WHERE channel_id = v_ch AND ts_end = v_ts[1];
    INSERT INTO _r VALUES ('write_readings_idempotent_upsert', v_n = 3 AND v_x = 9);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('write_readings_idempotent_upsert', false);
  END;
  BEGIN
    INSERT INTO solar.meter_readings (channel_id, organisation_id, ts_end, value, quality) VALUES (v_ch, v_org, now(), 1, 0);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('direct_readings_insert_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('direct_readings_insert_REFUSED', false);
  END;
  -- A re-commit REPLACES a channel's readings: the editor empties it through solar.clear_channel_readings
  -- (the channel row, and anything pointing at it, is kept).
  BEGIN
    SELECT solar.clear_channel_readings(v_ch5) INTO v_n;
    INSERT INTO _r VALUES ('editor_clears_own_channel_readings',
      v_n = 3
      AND (SELECT count(*) FROM solar.meter_readings WHERE channel_id = v_ch5) = 0
      AND (SELECT count(*) FROM solar.meter_channels WHERE id = v_ch5) = 1
      AND (SELECT count(*) FROM solar.meter_readings WHERE channel_id = v_ch4) = 2);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_clears_own_channel_readings', false);
  END;

  -- ── 4. Study-scoped tables (editor) ──
  BEGIN
    INSERT INTO solar.study_meters (study_id, meter_id) VALUES (v_study, v_meter) RETURNING project_id INTO v_uuid;
    INSERT INTO _r VALUES ('editor_links_study_meter_project_bound', v_uuid = v_p);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_links_study_meter_project_bound', false);
  END;
  BEGIN
    INSERT INTO solar.study_meters (study_id, meter_id) VALUES (v_study, v_meter2);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('study_meter_cross_org_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('study_meter_cross_org_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.tenant_load_basis (study_id, node_id, source) VALUES (v_study, v_node2, 'synthesised');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('tlb_foreign_node_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('tlb_foreign_node_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.tenant_load_basis (study_id, node_id, source, meters)
    VALUES (v_study, v_node, 'metered', jsonb_build_array(jsonb_build_object('meter_id', v_meter, 'weight', 0)));
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('tlb_zero_weight_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('tlb_zero_weight_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.tenant_load_basis (study_id, node_id, source, meters, archetype)
    VALUES (v_study, v_node, 'metered', jsonb_build_array(jsonb_build_object('meter_id', v_meter, 'weight', 1)), 'retail');
    INSERT INTO _r VALUES ('editor_writes_tenant_basis', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_writes_tenant_basis', false);
  END;
  BEGIN
    INSERT INTO solar.site_load (study_id, basis, reference_year, series, inputs_hash, engine_version)
    VALUES (v_study, 'S2', 2027, array_fill(1::real, ARRAY[10]), repeat('d', 64), '3a');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('site_load_wrong_length_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('site_load_wrong_length_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.site_load (study_id, basis, reference_year, series, inputs_hash, engine_version)
    VALUES (v_study, 'S2', 2027, array_fill(1::real, ARRAY[8760]), repeat('d', 64), '3a');
    INSERT INTO _r VALUES ('editor_writes_site_load', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_writes_site_load', false);
  END;

  -- ── 5. Register and import report (editor); accepted_by is bound ──
  BEGIN
    INSERT INTO solar.meter_register (organisation_id, kind, serial, mall_name) VALUES (v_org, 'download_log', '30000001', 'SITE PD');
    INSERT INTO _r VALUES ('editor_writes_register', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_writes_register', false);
  END;
  BEGIN
    INSERT INTO solar.meter_import_reports (file_id, parser_version, report) VALUES (v_file, '3a.1', '{}'::jsonb) RETURNING id INTO v_rep;
    UPDATE solar.meter_import_reports SET accepted_at = now(), accepted_by = v_admin WHERE id = v_rep;
    SELECT accepted_by INTO v_uuid FROM solar.meter_import_reports WHERE id = v_rep;
    INSERT INTO _r VALUES ('report_accepted_by_bound', v_uuid = v_con);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('report_accepted_by_bound', false);
  END;

  -- ── 6. Library delete is owner/admin only ──
  BEGIN
    DELETE FROM solar.meters WHERE id = v_meter3;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('editor_cannot_delete_meter', v_n = 0);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('editor_cannot_delete_meter', false);
  END;

  -- ── 7. Raw-file path helper (the storage policies call it) ──
  v_path := v_org || '/' || v_p || '/' || v_sha || '.csv';
  INSERT INTO _r VALUES ('raw_path_editor_can_upload', solar.raw_path_allowed(v_path, 'edit'));
  INSERT INTO _r VALUES ('raw_path_foreign_org_segment_refused', NOT solar.raw_path_allowed(v_org2 || '/' || v_p || '/' || v_sha || '.csv', 'edit'));
  INSERT INTO _r VALUES ('raw_path_bad_name_refused', NOT solar.raw_path_allowed(v_org || '/' || v_p || '/a.csv', 'edit'));
  INSERT INTO _r VALUES ('raw_path_wrong_extension_refused', NOT solar.raw_path_allowed(v_org || '/' || v_p || '/' || v_sha || '.exe', 'edit'));
  RESET ROLE;

  -- ── 8. View-only member: reads the library, writes nothing ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT (SELECT count(*) FROM solar.meters WHERE id = v_meter) = 1
     AND (SELECT count(*) FROM solar.meter_readings WHERE channel_id = v_ch) = 3
     AND (SELECT count(*) FROM solar.meter_files WHERE organisation_id = v_org) = 2 INTO v_b;
  INSERT INTO _r VALUES ('viewer_reads_library', v_b);
  BEGIN
    INSERT INTO solar.meters (organisation_id, label) VALUES (v_org, 'nope');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('viewer_create_meter_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('viewer_create_meter_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.meter_files (project_id, sha256, size_bytes, storage_path, original_name)
    VALUES (v_p, repeat('c', 64), 100, v_org || '/' || v_p || '/' || repeat('c', 64) || '.csv', 'c.csv');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('viewer_register_file_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('viewer_register_file_REFUSED', false);
  END;
  BEGIN
    PERFORM solar.write_readings(v_ch, v_ts, ARRAY[1, 1, 1]::float8[], ARRAY[0, 0, 0]::smallint[]);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('viewer_write_readings_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('viewer_write_readings_REFUSED', false);
  END;
  BEGIN
    PERFORM solar.clear_channel_readings(v_ch);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('viewer_clear_readings_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('viewer_clear_readings_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.study_meters (study_id, meter_id) VALUES (v_study, v_meter3);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('viewer_link_study_meter_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('viewer_link_study_meter_REFUSED', false);
  END;
  BEGIN
    PERFORM count(*) FROM solar.meter_readings_p0;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('partition_direct_read_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('partition_direct_read_REFUSED', false);
  END;
  INSERT INTO _r VALUES ('viewer_reads_eight_archetypes', (SELECT count(*) FROM solar.load_archetypes) = 8);
  INSERT INTO _r VALUES ('raw_path_viewer_can_read', solar.raw_path_allowed(v_path, 'view'));
  INSERT INTO _r VALUES ('viewer_reads_raw_object',
    (SELECT count(*) FROM storage.objects WHERE bucket_id = 'solar-meter-raw' AND name = v_path) = 1);
  INSERT INTO _r VALUES ('raw_path_viewer_cannot_upload', NOT solar.raw_path_allowed(v_path, 'edit'));
  RESET ROLE;

  -- ── 9. Everyone else reads nothing from the library ──
  -- (The external View member is no longer here: decision 2 lets them read LINKED meters; section 9b.)
  FOREACH u IN ARRAY ARRAY[v_nogrant, v_client, v_foreign] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT (SELECT count(*) FROM solar.meters WHERE organisation_id = v_org) = 0
       AND (SELECT count(*) FROM solar.meter_files WHERE organisation_id = v_org) = 0
       AND (SELECT count(*) FROM solar.meter_readings WHERE channel_id = v_ch) = 0
       AND NOT solar.raw_path_allowed(v_path, 'edit') INTO v_b;
    INSERT INTO _r VALUES (CASE u WHEN v_nogrant THEN 'no_grant_member_reads_nothing'
                                  WHEN v_client  THEN 'client_forged_grant_reads_nothing'
                                  ELSE 'foreign_admin_reads_nothing' END, v_b);
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_foreign::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM solar.write_readings(v_ch, v_ts, ARRAY[1, 1, 1]::float8[], ARRAY[0, 0, 0]::smallint[]);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('foreign_write_readings_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('foreign_write_readings_REFUSED', false);
  END;
  BEGIN
    PERFORM solar.clear_channel_readings(v_ch);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('foreign_clear_readings_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('foreign_clear_readings_REFUSED', false);
  END;
  RESET ROLE;

  -- ── 9b. Decision 2 (owner, 2026-09-28): an external project member with a View grant reads the
  --        meters LINKED (solar.study_meters) to a study on a project they can view, with those
  --        meters' channels and readings. Nothing unlinked, no other library record, no write. ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ext::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('ext_reads_linked_meter', (SELECT count(*) FROM solar.meters WHERE id = v_meter) = 1);
  INSERT INTO _r VALUES ('ext_reads_linked_channel', (SELECT count(*) FROM solar.meter_channels WHERE id = v_ch) = 1);
  INSERT INTO _r VALUES ('ext_reads_linked_readings', (SELECT count(*) FROM solar.meter_readings WHERE channel_id = v_ch) = 3);
  INSERT INTO _r VALUES ('ext_no_unlinked_meter',
    (SELECT count(*) FROM solar.meters WHERE id IN (v_meter3, v_meter4)) = 0
    AND (SELECT count(*) FROM solar.meters WHERE organisation_id = v_org) = 1);
  INSERT INTO _r VALUES ('ext_no_unlinked_channel',
    (SELECT count(*) FROM solar.meter_channels WHERE id = v_ch4) = 0
    AND (SELECT count(*) FROM solar.meter_channels WHERE organisation_id = v_org) = 1);
  INSERT INTO _r VALUES ('ext_no_unlinked_readings',
    (SELECT count(*) FROM solar.meter_readings WHERE channel_id = v_ch4) = 0
    AND (SELECT count(*) FROM solar.meter_readings WHERE organisation_id = v_org) = 3);
  INSERT INTO _r VALUES ('ext_reads_no_other_library_records',
    (SELECT count(*) FROM solar.meter_files WHERE organisation_id = v_org) = 0
    AND (SELECT count(*) FROM solar.meter_register WHERE organisation_id = v_org) = 0
    AND (SELECT count(*) FROM solar.meter_import_reports WHERE organisation_id = v_org) = 0
    AND (SELECT count(*) FROM solar.meter_series_hashes WHERE organisation_id = v_org) = 0
    AND NOT solar.raw_path_allowed(v_path, 'edit'));
  -- The raw object is readable only through the org library, like its meter_files record.
  INSERT INTO _r VALUES ('ext_raw_path_read_refused', NOT solar.raw_path_allowed(v_path, 'view'));
  INSERT INTO _r VALUES ('ext_raw_object_read_REFUSED',
    (SELECT count(*) FROM storage.objects WHERE bucket_id = 'solar-meter-raw' AND name = v_path) = 0);
  BEGIN
    INSERT INTO solar.meters (organisation_id, label) VALUES (v_org, 'ext');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('ext_create_meter_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('ext_create_meter_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.meters SET label = 'ext' WHERE id = v_meter;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('ext_update_linked_meter_REFUSED', v_n = 0);
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('ext_update_linked_meter_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('ext_update_linked_meter_REFUSED', false);
  END;
  BEGIN
    DELETE FROM solar.meters WHERE id = v_meter;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('ext_delete_linked_meter_REFUSED', v_n = 0);
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('ext_delete_linked_meter_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('ext_delete_linked_meter_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.meter_channels (meter_id, source_column, quantity, direction, source_unit, unit,
                                      interval_min, tz_convention, parser_version)
    VALUES (v_meter, 'ext', 'active_power', 'import', 'kW', 'kW', 30, 'begin', '3a.1');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('ext_create_channel_on_linked_meter_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('ext_create_channel_on_linked_meter_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.meter_channels SET is_primary = FALSE WHERE id = v_ch;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('ext_update_linked_channel_REFUSED', v_n = 0);
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('ext_update_linked_channel_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('ext_update_linked_channel_REFUSED', false);
  END;
  BEGIN
    PERFORM solar.write_readings(v_ch, v_ts, ARRAY[1, 1, 1]::float8[], ARRAY[0, 0, 0]::smallint[]);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('ext_write_readings_linked_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('ext_write_readings_linked_REFUSED', false);
  END;
  BEGIN
    PERFORM solar.clear_channel_readings(v_ch);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('ext_clear_readings_linked_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('ext_clear_readings_linked_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.study_meters (study_id, meter_id) VALUES (v_study, v_meter4);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('ext_link_study_meter_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('ext_link_study_meter_REFUSED', false);
  END;
  RESET ROLE;

  -- Revocation: each case runs in a sub-transaction that is undone by raising P0001, so the link and
  -- the grant are back for the later sections. The verdict is kept in a variable (not rolled back).
  -- (a) the grant is removed
  v_b := NULL;
  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    DELETE FROM solar.project_access WHERE project_id = v_p AND user_id = v_ext;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ext::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_b := (SELECT count(*) FROM solar.meters WHERE organisation_id = v_org) = 0
       AND (SELECT count(*) FROM solar.meter_channels WHERE organisation_id = v_org) = 0
       AND (SELECT count(*) FROM solar.meter_readings WHERE organisation_id = v_org) = 0;
    RESET ROLE;
    RAISE EXCEPTION 'undo' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN NULL;
    WHEN OTHERS THEN v_b := FALSE;
  END;
  INSERT INTO _r VALUES ('ext_grant_revoked_reads_nothing', coalesce(v_b, FALSE));
  -- (b) the meter is unlinked from the study
  v_b := NULL;
  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    DELETE FROM solar.study_meters WHERE study_id = v_study AND meter_id = v_meter;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ext::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_b := (SELECT count(*) FROM solar.meters WHERE organisation_id = v_org) = 0
       AND (SELECT count(*) FROM solar.meter_channels WHERE organisation_id = v_org) = 0
       AND (SELECT count(*) FROM solar.meter_readings WHERE organisation_id = v_org) = 0;
    RESET ROLE;
    RAISE EXCEPTION 'undo' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN NULL;
    WHEN OTHERS THEN v_b := FALSE;
  END;
  INSERT INTO _r VALUES ('ext_link_removed_reads_nothing', coalesce(v_b, FALSE));
  -- The sub-transactions really were undone (else the later sections would test a different state).
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _r VALUES ('ext_revocation_fixtures_restored',
    EXISTS (SELECT 1 FROM solar.project_access WHERE project_id = v_p AND user_id = v_ext)
    AND EXISTS (SELECT 1 FROM solar.study_meters WHERE study_id = v_study AND meter_id = v_meter));

  -- ── 10. Admin: deletes a library meter; cannot write platform archetypes ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    DELETE FROM solar.meters WHERE id = v_meter3;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('admin_deletes_meter', v_n = 1);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('admin_deletes_meter', false);
  END;
  BEGIN
    INSERT INTO solar.load_archetypes (code, version, name, profiles, operating, seasonal)
    VALUES ('retail', 99, 'x', '{}'::jsonb, '{}'::jsonb, '[1,1,1,1,1,1,1,1,1,1,1,1]'::jsonb);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('archetype_write_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('archetype_write_REFUSED', false);
  END;
  RESET ROLE;

  -- ── 11. Storage policies are wired to the helper; bucket is private ──
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _r VALUES ('storage_policies_call_helper', (
    SELECT count(*) = 2 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname IN ('solar_meter_raw_read', 'solar_meter_raw_insert')
       AND coalesce(qual, with_check) LIKE '%raw_path_allowed%'));
  INSERT INTO _r VALUES ('bucket_private', (SELECT NOT public FROM storage.buckets WHERE id = 'solar-meter-raw'));

  -- ── 12. Lapse = hidden but kept (D-02) ──
  UPDATE billing.org_addon_subscriptions SET current_period_end = now() - interval '1 day' WHERE organisation_id = v_org;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('lapsed_admin_reads_nothing', (SELECT count(*) FROM solar.meters WHERE organisation_id = v_org) = 0);
  RESET ROLE;
  -- Decision 2: a lapse hides the LINKED meters from the external too (their own org's subscription
  -- is still live; what lapsed is the project's org).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ext::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('lapsed_ext_reads_linked_nothing',
    (SELECT count(*) FROM solar.meters WHERE id = v_meter) = 0
    AND (SELECT count(*) FROM solar.meter_channels WHERE id = v_ch) = 0
    AND (SELECT count(*) FROM solar.meter_readings WHERE channel_id = v_ch) = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_con::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM solar.write_readings(v_ch, v_ts, ARRAY[1, 1, 1]::float8[], ARRAY[0, 0, 0]::smallint[]);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('lapsed_write_readings_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('lapsed_write_readings_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _r VALUES ('lapsed_rows_kept', (SELECT count(*) FROM solar.meter_readings WHERE channel_id = v_ch) = 3);

  -- ── 13. Service role bypasses RLS ──
  SET LOCAL ROLE service_role;
  INSERT INTO _r VALUES ('service_role_reads_library', (SELECT count(*) FROM solar.meters WHERE organisation_id = v_org) >= 1);
  RESET ROLE;
END $$;

SELECT k AS "check", v AS ok FROM _r ORDER BY k;
