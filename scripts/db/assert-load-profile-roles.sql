-- Behaviour assertions for 00242 (load-profile source roles + Solar library meters), in a
-- rolled-back transaction against production:
--
--   scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00242_load_profile_roles_library.sql scripts/db/assert-load-profile-roles.sql
--
-- Red first against a no-op (role / solar_meter_id do not exist), then green.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_admin    UUID;
  v_org      UUID;
  v_project  UUID;
  v_profile  UUID;
  v_other    UUID;
  v_meter    UUID;
  v_foreign  UUID;
  v_src      UUID;
  v_n        INT;
BEGIN
  -- A WM owner/admin and one of the org's projects.
  SELECT uo.user_id, uo.organisation_id INTO v_admin, v_org FROM public.user_organisations uo
   WHERE uo.is_active AND uo.role IN ('owner', 'admin')
     AND EXISTS (SELECT 1 FROM projects.projects p WHERE p.organisation_id = uo.organisation_id)
     AND solar.org_subscription_active(uo.organisation_id)
   LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'no Solar-enabled org admin fixture'; END IF;
  SELECT p.id INTO v_project FROM projects.projects p WHERE p.organisation_id = v_org LIMIT 1;
  INSERT INTO projects.load_profiles (project_id) VALUES (v_project) ON CONFLICT (project_id) DO NOTHING;
  SELECT id INTO v_profile FROM projects.load_profiles WHERE project_id = v_project;
  SELECT o.id INTO v_other FROM public.organisations o WHERE o.id <> v_org LIMIT 1;

  -- Library meters: one in the org, one in another org (postgres path, rolled back).
  INSERT INTO solar.meters (organisation_id, label, kind) VALUES (v_org, 'probe bulk', 'bulk') RETURNING id INTO v_meter;
  INSERT INTO solar.meters (organisation_id, label, kind) VALUES (v_other, 'probe foreign', 'tenant') RETURNING id INTO v_foreign;

  -- Backfill and the role check.
  INSERT INTO projects.load_profile_sources (profile_id, kind, label, params) VALUES (v_profile, 'admd', 'probe admd', '{"units":1}') RETURNING id INTO v_src;
  INSERT INTO _r SELECT 'role_defaults_to_tenant', role = 'tenant' FROM projects.load_profile_sources WHERE id = v_src;
  BEGIN
    UPDATE projects.load_profile_sources SET role = 'everything' WHERE id = v_src;
    INSERT INTO _r VALUES ('bad_role_REFUSED', false);
  EXCEPTION WHEN check_violation THEN INSERT INTO _r VALUES ('bad_role_REFUSED', true);
  END;
  INSERT INTO _r SELECT 'no_admd_left_without_addition_role_in_prod', count(*) = 0 FROM projects.load_profile_sources WHERE kind = 'admd' AND role <> 'addition' AND id <> v_src;

  -- Shapes.
  BEGIN
    INSERT INTO projects.load_profile_sources (profile_id, kind, label) VALUES (v_profile, 'library_meter', 'no meter');
    INSERT INTO _r VALUES ('library_without_meter_REFUSED', false);
  EXCEPTION WHEN check_violation THEN INSERT INTO _r VALUES ('library_without_meter_REFUSED', true);
  END;
  BEGIN
    INSERT INTO projects.load_profile_sources (profile_id, kind, label, params, solar_meter_id) VALUES (v_profile, 'admd', 'admd with meter', '{}', v_meter);
    INSERT INTO _r VALUES ('synthetic_with_meter_REFUSED', false);
  EXCEPTION WHEN check_violation THEN INSERT INTO _r VALUES ('synthetic_with_meter_REFUSED', true);
  END;
  BEGIN
    INSERT INTO projects.load_profile_sources (profile_id, kind, label, solar_meter_id) VALUES (v_profile, 'library_meter', 'foreign', v_foreign);
    INSERT INTO _r VALUES ('foreign_org_meter_REFUSED', false);
  EXCEPTION WHEN foreign_key_violation THEN INSERT INTO _r VALUES ('foreign_org_meter_REFUSED', true);
  END;

  -- The org admin, through RLS, can reference the org's own library meter, once.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO projects.load_profile_sources (profile_id, kind, label, role, solar_meter_id) VALUES (v_profile, 'library_meter', 'probe bulk', 'bulk', v_meter);
    INSERT INTO _r VALUES ('admin_adds_library_meter', true);
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('admin_adds_library_meter', false);
  END;
  BEGIN
    INSERT INTO projects.load_profile_sources (profile_id, kind, label, solar_meter_id) VALUES (v_profile, 'library_meter', 'again', v_meter);
    INSERT INTO _r VALUES ('same_library_meter_twice_REFUSED', false);
  EXCEPTION WHEN unique_violation THEN INSERT INTO _r VALUES ('same_library_meter_twice_REFUSED', true);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- Deleting the library meter removes the reference.
  DELETE FROM solar.meters WHERE id = v_meter;
  SELECT count(*) INTO v_n FROM projects.load_profile_sources WHERE solar_meter_id = v_meter;
  INSERT INTO _r VALUES ('meter_delete_cascades_to_source', v_n = 0);
END $$;

SELECT k AS "check", v AS ok FROM _r ORDER BY k;
