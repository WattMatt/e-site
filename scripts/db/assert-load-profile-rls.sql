-- BEHAVIOURAL assertions for 00231 (projects.load_profiles / load_profile_sources /
-- bucket load-profile-files), run as real production roles in a rolled-back
-- transaction:
--
--   scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00231_load_profiles.sql scripts/db/assert-load-profile-rls.sql
--
-- Proven RED first against a no-op migration (every row fails: the tables do
-- not exist), then GREEN with 00231.
--
-- Impersonation: set_config('request.jwt.claims', …, true) is transaction-local
-- and outlives RESET ROLE, so fixtures are seeded on the postgres path BEFORE the
-- first SET LOCAL ROLE. FORCE RLS applies to the owner, so the postgres-path
-- writes go through the same binding triggers.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_contractor  UUID;
  v_project     UUID;
  v_org         UUID;
  v_admin       UUID;
  v_client      UUID;
  v_client_proj UUID;
  v_other_org   UUID;
  v_profile     UUID;
  v_source      UUID;
  v_n           INT;
  v_sha         TEXT := repeat('a', 64);
  v_path        TEXT;
  v_pm          UUID;
  v_other_proj  UUID;
  v_other_prof  UUID;
  v_tmp_proj    UUID;
  v_tmp_prof    UUID;
BEGIN
  -- ── Fixtures ──────────────────────────────────────────────────────────────
  -- The rbac-test contractor (a project member whose effective role is contractor).
  SELECT pm.user_id, pm.project_id, p.organisation_id INTO v_contractor, v_project, v_org
    FROM projects.project_members pm JOIN projects.projects p ON p.id = pm.project_id
   WHERE pm.role = 'contractor' AND pm.is_active
     AND public.user_effective_project_role(pm.project_id, pm.user_id) = 'contractor'
   LIMIT 1;
  IF v_contractor IS NULL THEN RAISE EXCEPTION 'no contractor fixture'; END IF;

  SELECT uo.user_id INTO v_admin FROM public.user_organisations uo
   WHERE uo.organisation_id = v_org AND uo.is_active AND uo.role IN ('owner', 'admin') LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'no org owner/admin fixture'; END IF;

  SELECT pm.user_id, pm.project_id INTO v_client, v_client_proj
    FROM projects.project_members pm
   WHERE pm.role = 'client_viewer' AND pm.is_active
     AND public.user_effective_project_role(pm.project_id, pm.user_id) = 'client_viewer'
   LIMIT 1;

  SELECT o.id INTO v_other_org FROM public.organisations o WHERE o.id <> v_org LIMIT 1;

  -- Control row on the postgres path, with a FORGED organisation_id: the trigger must discard it.
  INSERT INTO projects.load_profiles (project_id, organisation_id) VALUES (v_project, v_other_org) RETURNING id INTO v_profile;
  INSERT INTO _r SELECT 'org_bound_from_project', organisation_id = v_org FROM projects.load_profiles WHERE id = v_profile;

  INSERT INTO projects.load_profile_sources (profile_id, project_id, organisation_id, kind, label, file_sha256, source_column, interval_min, first_ts_end, "values", quality)
  VALUES (v_profile, v_client_proj, v_other_org, 'meter', 'probe meter', v_sha, 'p14', 30, now(), ARRAY[1.5, NULL]::real[], ARRAY[0, 1]::smallint[])
  RETURNING id INTO v_source;
  INSERT INTO _r SELECT 'source_parents_bound', project_id = v_project AND organisation_id = v_org FROM projects.load_profile_sources WHERE id = v_source;

  -- Shape guards, by attempting the bad row.
  BEGIN
    INSERT INTO projects.load_profile_sources (profile_id, kind, label, file_sha256, source_column, interval_min, first_ts_end, "values", quality)
    VALUES (v_profile, 'meter', 'bad', v_sha, 'x', 30, now(), ARRAY[1]::real[], ARRAY[0, 0]::smallint[]);
    INSERT INTO _r VALUES ('meter_length_mismatch_REFUSED', false);
  EXCEPTION WHEN check_violation THEN INSERT INTO _r VALUES ('meter_length_mismatch_REFUSED', true);
  END;
  BEGIN
    INSERT INTO projects.load_profile_sources (profile_id, kind, label, file_sha256, source_column, interval_min, first_ts_end, "values", quality)
    VALUES (v_profile, 'meter', 'bad', v_sha, 'x', 7, now(), ARRAY[1]::real[], ARRAY[0]::smallint[]);
    INSERT INTO _r VALUES ('meter_odd_interval_REFUSED', false);
  EXCEPTION WHEN check_violation THEN INSERT INTO _r VALUES ('meter_odd_interval_REFUSED', true);
  END;
  BEGIN
    INSERT INTO projects.load_profile_sources (profile_id, kind, label) VALUES (v_profile, 'admd', 'no params');
    INSERT INTO _r VALUES ('synthetic_without_params_REFUSED', false);
  EXCEPTION WHEN check_violation THEN INSERT INTO _r VALUES ('synthetic_without_params_REFUSED', true);
  END;
  BEGIN
    INSERT INTO projects.load_profile_sources (profile_id, kind, label, file_sha256, source_column, interval_min, first_ts_end, "values", quality)
    VALUES (v_profile, 'meter', 'dup', v_sha, 'p14', 30, now(), ARRAY[1]::real[], ARRAY[0]::smallint[]);
    INSERT INTO _r VALUES ('same_file_column_twice_REFUSED', false);
  EXCEPTION WHEN unique_violation THEN INSERT INTO _r VALUES ('same_file_column_twice_REFUSED', true);
  END;
  -- Two synthetic blocks (NULL sha, NULL column) must coexist: the key is NULLS DISTINCT (00221).
  INSERT INTO projects.load_profile_sources (profile_id, kind, label, params) VALUES (v_profile, 'admd', 'block 1', '{"units":1}');
  INSERT INTO projects.load_profile_sources (profile_id, kind, label, params) VALUES (v_profile, 'admd', 'block 2', '{"units":2}');
  INSERT INTO _r SELECT 'two_synthetic_blocks_coexist', count(*) = 2 FROM projects.load_profile_sources WHERE profile_id = v_profile AND kind = 'admd';

  -- A stored raw file for the storage policies.
  v_path := v_project::text || '/' || v_sha || '.csv';
  INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('load-profile-files', v_path, v_admin);
  INSERT INTO _r VALUES ('path_parses_to_project', projects.load_profile_file_project(v_path) = v_project);
  INSERT INTO _r VALUES ('malformed_path_is_null', projects.load_profile_file_project(v_project::text || '/../x.csv') IS NULL
                                                 AND projects.load_profile_file_project('not-a-uuid/' || v_sha || '.csv') IS NULL);

  -- ═══ 1. CONTRACTOR — reads, cannot write ═════════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_contractor::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM projects.load_profile_sources WHERE id = v_source;
  INSERT INTO _r VALUES ('contractor_reads_source', v_n = 1);
  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id = 'load-profile-files' AND name = v_path;
  INSERT INTO _r VALUES ('contractor_reads_file', v_n = 1);
  BEGIN
    INSERT INTO projects.load_profile_sources (profile_id, kind, label, params) VALUES (v_profile, 'admd', 'contractor', '{}');
    INSERT INTO _r VALUES ('contractor_insert_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('contractor_insert_REFUSED', true);
  END;
  UPDATE projects.load_profiles SET power_factor = 0.5 WHERE id = v_profile;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('contractor_update_affects_nothing', v_n = 0);
  DELETE FROM projects.load_profile_sources WHERE id = v_source;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('contractor_delete_affects_nothing', v_n = 0);
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('load-profile-files', v_project::text || '/' || repeat('b', 64) || '.csv', v_contractor);
    INSERT INTO _r VALUES ('contractor_upload_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('contractor_upload_REFUSED', true);
  END;
  RESET ROLE;

  -- ═══ 2. ORG OWNER/ADMIN — writes ═════════════════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO projects.load_profile_sources (profile_id, kind, label, params) VALUES (v_profile, 'tenant_schedule', 'admin wrote', '{"commonAreaPct":0}');
    INSERT INTO _r VALUES ('admin_inserts', true);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('admin_inserts', false);
  END;
  UPDATE projects.load_profiles SET power_factor = 0.9 WHERE id = v_profile;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('admin_updates', v_n = 1);
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('load-profile-files', v_project::text || '/' || repeat('c', 64) || '.xlsx', v_admin);
    INSERT INTO _r VALUES ('admin_uploads', true);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('admin_uploads', false);
  END;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('load-profile-files', v_project::text || '/evil.exe', v_admin);
    INSERT INTO _r VALUES ('admin_bad_path_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('admin_bad_path_REFUSED', true);
  END;
  RESET ROLE;

  -- ═══ 3. CLIENT VIEWER — sees the project, never the profile ══════════════
  IF v_client IS NOT NULL THEN
    INSERT INTO projects.load_profiles (project_id) VALUES (v_client_proj) ON CONFLICT (project_id) DO NOTHING;
    INSERT INTO projects.load_profile_sources (profile_id, kind, label, params)
      SELECT id, 'admd', 'client probe', '{}' FROM projects.load_profiles WHERE project_id = v_client_proj;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM projects.projects WHERE id = v_client_proj;
    INSERT INTO _r VALUES ('client_viewer_CAN_see_the_project', v_n = 1);
    SELECT count(*) INTO v_n FROM projects.load_profile_sources WHERE project_id = v_client_proj;
    INSERT INTO _r VALUES ('client_viewer_sees_no_source', v_n = 0);
    SELECT count(*) INTO v_n FROM projects.load_profiles WHERE project_id = v_client_proj;
    INSERT INTO _r VALUES ('client_viewer_sees_no_profile', v_n = 0);
    RESET ROLE;
  ELSE
    INSERT INTO _r VALUES ('client_viewer_fixture_exists', false);
  END IF;

  -- ═══ 4. NON-MEMBER — sees nothing ════════════════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM projects.load_profile_sources WHERE id = v_source;
  INSERT INTO _r VALUES ('stranger_sees_nothing', v_n = 0);
  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id = 'load-profile-files' AND name = v_path;
  INSERT INTO _r VALUES ('stranger_sees_no_file', v_n = 0);
  RESET ROLE;
  -- ═══ 5. PROJECT-PROMOTED PROJECT MANAGER — writes on that project only ════
  -- None exists in production, so one is minted here and rolled back: an org contractor promoted
  -- to project_manager on v_project by a project_members row (user_effective_project_role clause 2).
  v_pm := gen_random_uuid();
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES (v_pm, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'probe-lp-pm@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES (v_pm, v_org, 'contractor', TRUE);
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active) VALUES (v_project, v_pm, v_org, 'project_manager', TRUE);
  -- Another org's project with its own profile: nobody above may touch it.
  SELECT p.id INTO v_other_proj FROM projects.projects p WHERE p.organisation_id <> v_org LIMIT 1;
  INSERT INTO projects.load_profiles (project_id) VALUES (v_other_proj) ON CONFLICT (project_id) DO NOTHING;
  SELECT id INTO v_other_prof FROM projects.load_profiles WHERE project_id = v_other_proj;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pm::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('promoted_pm_effective_role', public.user_effective_project_role(v_project) = 'project_manager');
  BEGIN
    INSERT INTO projects.load_profile_sources (profile_id, kind, label, params) VALUES (v_profile, 'admd', 'pm wrote', '{}');
    INSERT INTO _r VALUES ('promoted_pm_inserts', true);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('promoted_pm_inserts', false);
  END;
  RESET ROLE;

  -- ═══ 6. CROSS-PROJECT — a writer on A cannot reach B through profile_id ═══
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO projects.load_profile_sources (profile_id, kind, label, params) VALUES (v_other_prof, 'admd', 'smuggled', '{}');
    INSERT INTO _r VALUES ('insert_into_foreign_profile_REFUSED', false);
  -- The bind trigger runs under the caller's RLS, so it cannot see the foreign profile and raises
  -- 23503 "not found" before WITH CHECK would: either refusal is the right outcome.
  EXCEPTION WHEN insufficient_privilege OR foreign_key_violation THEN INSERT INTO _r VALUES ('insert_into_foreign_profile_REFUSED', true);
  END;
  BEGIN
    UPDATE projects.load_profile_sources SET profile_id = v_other_prof WHERE id = v_source;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('move_source_to_foreign_profile_REFUSED', v_n = 0);
  EXCEPTION WHEN insufficient_privilege OR foreign_key_violation THEN INSERT INTO _r VALUES ('move_source_to_foreign_profile_REFUSED', true);
  END;
  RESET ROLE;

  -- ═══ 7. STORAGE DELETE — the policy decides (the API's own flag lifts protect_delete) ═══
  PERFORM set_config('storage.allow_delete_query', 'true', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_contractor::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  DELETE FROM storage.objects WHERE bucket_id = 'load-profile-files' AND name = v_path;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('contractor_file_delete_affects_nothing', v_n = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  DELETE FROM storage.objects WHERE bucket_id = 'load-profile-files' AND name = v_path;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('admin_file_delete_works', v_n = 1);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- ═══ 8. PROJECT DELETE CASCADES — the 00221 failure mode ═════════════════
  -- Two channels of the same column from two files, then delete the whole project.
  INSERT INTO projects.projects (organisation_id, name, created_by) VALUES (v_org, 'probe load profile project', v_admin) RETURNING id INTO v_tmp_proj;
  INSERT INTO projects.load_profiles (project_id) VALUES (v_tmp_proj) RETURNING id INTO v_tmp_prof;
  INSERT INTO projects.load_profile_sources (profile_id, kind, label, file_sha256, source_column, interval_min, first_ts_end, "values", quality)
  VALUES (v_tmp_prof, 'meter', 'f1', repeat('1', 64), 'kW', 30, now(), ARRAY[1]::real[], ARRAY[0]::smallint[]),
         (v_tmp_prof, 'meter', 'f2', repeat('2', 64), 'kW', 30, now(), ARRAY[1]::real[], ARRAY[0]::smallint[]);
  BEGIN
    DELETE FROM projects.projects WHERE id = v_tmp_proj;
    INSERT INTO _r SELECT 'project_delete_cascades', NOT EXISTS (SELECT 1 FROM projects.load_profiles WHERE project_id = v_tmp_proj)
                                                 AND NOT EXISTS (SELECT 1 FROM projects.load_profile_sources WHERE project_id = v_tmp_proj);
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('project_delete_cascades', false);
  END;

  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

SELECT k AS "check", v AS ok FROM _r ORDER BY k;
