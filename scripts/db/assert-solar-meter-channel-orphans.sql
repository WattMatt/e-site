-- BEHAVIOURAL assertions for 00221_solar_meter_channel_orphans (Solar release assembly).
--   RED:   scripts/db/dry-run-migration.sh <00207..00220 chain>          scripts/db/assert-solar-meter-channel-orphans.sql
--   GREEN: scripts/db/dry-run-migration.sh <00207..00220 chain + 00221>  scripts/db/assert-solar-meter-channel-orphans.sql
--
-- The defect (00211): meter_channels_source_key was UNIQUE NULLS NOT DISTINCT on
-- (meter_id, file_id, source_column) while file_id is ON DELETE SET NULL. Meters are ORG library rows
-- and outlive a project; its meter FILES do not (project_id ON DELETE CASCADE). So a meter fed by two
-- imported files that share a column name ("kW") made DELETE of the project fail with 23505: the
-- cascade set both channels' file_id to NULL, and two NULLs counted as equal.
-- Fixtures are minted inside the transaction and rolled back.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;

DO $$
DECLARE
  v_org   UUID := gen_random_uuid();
  v_user  UUID := gen_random_uuid();
  v_p     UUID := gen_random_uuid();
  v_m     UUID;
  v_f1    UUID;
  v_f2    UUID;
  v_c1    UUID;
  v_c2    UUID;
  v_sha1  TEXT := encode(sha256('orphan-probe-1'::bytea), 'hex');
  v_sha2  TEXT := encode(sha256('orphan-probe-2'::bytea), 'hex');
  v_state TEXT;
BEGIN
  INSERT INTO public.organisations (id, name) VALUES (v_org, 'solar-orphan-probe');
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'orphan-probe-' || v_user || '@example.invalid', '', now(), now(), now());
  INSERT INTO projects.projects (id, organisation_id, name, created_by) VALUES (v_p, v_org, 'solar-orphan-probe-p', v_user);
  INSERT INTO solar.meters (organisation_id, label, kind) VALUES (v_org, 'PV main', 'solar') RETURNING id INTO v_m;
  INSERT INTO solar.meter_files (project_id, sha256, size_bytes, storage_path, original_name, status)
  VALUES (v_p, v_sha1, 10, v_org || '/' || v_p || '/' || v_sha1 || '.csv', 'march.csv', 'accepted') RETURNING id INTO v_f1;
  INSERT INTO solar.meter_files (project_id, sha256, size_bytes, storage_path, original_name, status)
  VALUES (v_p, v_sha2, 10, v_org || '/' || v_p || '/' || v_sha2 || '.csv', 'april.csv', 'accepted') RETURNING id INTO v_f2;
  -- The ordinary case: two exports of the same logger, both with a column called "kW".
  INSERT INTO solar.meter_channels (meter_id, file_id, source_column, quantity, direction, source_unit, unit,
                                    interval_min, tz_convention, is_primary, parser_version)
  VALUES (v_m, v_f1, 'kW', 'active_power', 'export', 'kW', 'kW', 30, 'end', TRUE, 'probe') RETURNING id INTO v_c1;
  INSERT INTO solar.meter_channels (meter_id, file_id, source_column, quantity, direction, source_unit, unit,
                                    interval_min, tz_convention, is_primary, parser_version)
  VALUES (v_m, v_f2, 'kW', 'active_power', 'export', 'kW', 'kW', 30, 'end', TRUE, 'probe') RETURNING id INTO v_c2;
  INSERT INTO solar.meter_readings (channel_id, organisation_id, ts_end, value, quality) VALUES
    (v_c1, v_org, '2026-03-10 12:00+02', 5, 0), (v_c2, v_org, '2026-04-10 12:00+02', 7, 0);

  -- A re-import of the SAME file and column must still be one channel (the import's upsert target).
  BEGIN
    INSERT INTO solar.meter_channels (meter_id, file_id, source_column, quantity, direction, source_unit, unit,
                                      interval_min, tz_convention, is_primary, parser_version)
    VALUES (v_m, v_f1, 'kW', 'active_power', 'export', 'kW', 'kW', 30, 'end', FALSE, 'probe');
    INSERT INTO _r VALUES ('same_file_same_column_still_refused', false);
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO _r VALUES ('same_file_same_column_still_refused', true);
  END;

  -- The defect: deleting the project cascades the files and orphans both channels.
  BEGIN
    DELETE FROM projects.projects WHERE id = v_p;
    INSERT INTO _r VALUES ('project_delete_with_two_same_named_file_channels_succeeds', true);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    RAISE NOTICE 'project delete failed: %', v_state;
    INSERT INTO _r VALUES ('project_delete_with_two_same_named_file_channels_succeeds', false);
  END;
  INSERT INTO _r VALUES ('project_gone', NOT EXISTS (SELECT 1 FROM projects.projects WHERE id = v_p));
  -- The library meter and its readings outlive the project (file_id is SET NULL, not CASCADE).
  INSERT INTO _r VALUES ('library_meter_and_readings_kept',
    EXISTS (SELECT 1 FROM solar.meters WHERE id = v_m)
    AND (SELECT count(*) FROM solar.meter_readings WHERE channel_id IN (v_c1, v_c2)) = 2
    AND (SELECT count(*) FROM solar.meter_channels WHERE id IN (v_c1, v_c2) AND file_id IS NULL) = 2);
  -- The import's ON CONFLICT (meter_id, file_id, source_column) still has a unique constraint to infer.
  INSERT INTO _r VALUES ('upsert_target_constraint_present', EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'meter_channels_source_key' AND conrelid = 'solar.meter_channels'::regclass AND contype = 'u'));
END $$;

SELECT k AS check, v AS ok FROM _r ORDER BY k;
