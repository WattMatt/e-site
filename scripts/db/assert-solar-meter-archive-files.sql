-- Behaviour assertions for 00237 (org meter-archive files need no project), rolled back:
--   scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00237_solar_meter_archive_files.sql scripts/db/assert-solar-meter-archive-files.sql
CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_admin   UUID;
  v_org     UUID;
  v_project UUID;
  v_file    UUID;
  v_arch    UUID;
  v_n       INT;
BEGIN
  SELECT uo.user_id, uo.organisation_id INTO v_admin, v_org FROM public.user_organisations uo
   WHERE uo.is_active AND uo.role IN ('owner', 'admin') AND solar.org_subscription_active(uo.organisation_id)
     AND EXISTS (SELECT 1 FROM projects.projects p WHERE p.organisation_id = uo.organisation_id) LIMIT 1;
  SELECT id INTO v_project FROM projects.projects WHERE organisation_id = v_org LIMIT 1;

  -- Service path: an archive file (no project) is accepted.
  BEGIN
    INSERT INTO solar.meter_files (organisation_id, project_id, sha256, size_bytes, storage_path, original_name)
    VALUES (v_org, NULL, repeat('e', 64), 1, v_org::text || '/archive/' || repeat('e', 64) || '.csv', 'probe archive.csv') RETURNING id INTO v_arch;
    INSERT INTO _r VALUES ('service_inserts_archive_file', true);
  EXCEPTION WHEN not_null_violation THEN INSERT INTO _r VALUES ('service_inserts_archive_file', false);
  END;
  INSERT INTO solar.meter_files (organisation_id, project_id, sha256, size_bytes, storage_path, original_name)
  VALUES (v_org, v_project, repeat('f', 64), 1, v_org::text || '/' || v_project::text || '/' || repeat('f', 64) || '.csv', 'probe project.csv') RETURNING id INTO v_file;

  -- Signed-in admin: may read the archive file; may not create one; may not move a file's project.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM solar.meter_files WHERE id = v_arch;
  INSERT INTO _r VALUES ('admin_reads_archive_file', v_n = 1);
  BEGIN
    INSERT INTO solar.meter_files (organisation_id, project_id, sha256, size_bytes, storage_path, original_name)
    VALUES (v_org, NULL, repeat('d', 64), 1, v_org::text || '/archive/' || repeat('d', 64) || '.csv', 'user archive.csv');
    INSERT INTO _r VALUES ('user_archive_insert_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('user_archive_insert_REFUSED', true);
  END;
  BEGIN
    UPDATE solar.meter_files SET project_id = NULL WHERE id = v_file;
    INSERT INTO _r VALUES ('user_moves_file_to_archive_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('user_moves_file_to_archive_REFUSED', true);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- Service path may move a project file into the archive (the retirement step): project and path only.
  BEGIN
    UPDATE solar.meter_files SET project_id = NULL WHERE id = v_file;
    INSERT INTO _r VALUES ('service_detach_without_archive_path_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('service_detach_without_archive_path_REFUSED', true);
  END;
  UPDATE solar.meter_files SET project_id = NULL, storage_path = v_org::text || '/archive/' || repeat('f', 64) || '.csv' WHERE id = v_file;
  INSERT INTO _r SELECT 'service_moves_file_to_archive', project_id IS NULL AND storage_path LIKE '%/archive/%' FROM solar.meter_files WHERE id = v_file;
  -- A project file still keeps its project-bound path rule.
  BEGIN
    INSERT INTO solar.meter_files (organisation_id, project_id, sha256, size_bytes, storage_path, original_name)
    VALUES (v_org, v_project, repeat('c', 64), 1, v_org::text || '/archive/' || repeat('c', 64) || '.csv', 'wrong path.csv');
    INSERT INTO _r VALUES ('project_file_on_archive_path_REFUSED', false);
  EXCEPTION WHEN check_violation THEN INSERT INTO _r VALUES ('project_file_on_archive_path_REFUSED', true);
  END;
END $$;

SELECT k AS "check", v AS ok FROM _r ORDER BY k;
