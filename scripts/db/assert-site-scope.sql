-- BEHAVIOURAL assertions for site-scoped access, as real roles.
--   scripts/db/dry-run-migration.sh scripts/db/fixtures/noop.sql scripts/db/assert-site-scope.sql            (red)
--   scripts/db/dry-run-migration.sh scripts/db/site-scope/site_scoped_access.sql scripts/db/assert-site-scope.sql (green)
CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  c_org      CONSTANT uuid := 'dddddddd-0000-0000-0000-000000000001';
  v_con      uuid;  v_own uuid;  v_foreign uuid;
  v_admin    uuid;  v_cv uuid;   v_cv_proj uuid;  v_pm uuid;
  v_n        int;   v_m int;     v_ok boolean;    v_obj text;   v_new uuid;
BEGIN
  -- contractor with exactly one active membership in WM
  SELECT pm.user_id, min(pm.project_id::text)::uuid INTO v_con, v_own
    FROM projects.project_members pm
    JOIN public.user_organisations uo ON uo.user_id=pm.user_id AND uo.organisation_id=c_org AND uo.is_active AND uo.role='contractor'
   WHERE pm.is_active AND pm.organisation_id=c_org
   GROUP BY pm.user_id HAVING count(*)=1 LIMIT 1;
  IF v_con IS NULL THEN RAISE EXCEPTION 'fixture: no single-project contractor'; END IF;

  SELECT p.id INTO v_foreign FROM projects.projects p
   WHERE p.organisation_id=c_org AND p.id<>v_own
     AND EXISTS (SELECT 1 FROM tenants.floor_plans f WHERE f.project_id=p.id)
     AND EXISTS (SELECT 1 FROM structure.nodes x WHERE x.project_id=p.id)
     AND NOT EXISTS (SELECT 1 FROM projects.project_members m WHERE m.project_id=p.id AND m.user_id=v_con)
   LIMIT 1;
  SELECT uo.user_id INTO v_admin FROM public.user_organisations uo
   WHERE uo.organisation_id=c_org AND uo.is_active AND uo.role='admin' LIMIT 1;
  SELECT pm.user_id, pm.project_id INTO v_cv, v_cv_proj FROM projects.project_members pm
   WHERE pm.role='client_viewer' AND pm.is_active AND pm.organisation_id=c_org LIMIT 1;
  SELECT o.name INTO v_obj FROM storage.objects o
   WHERE o.bucket_id='drawings' AND split_part(o.name,'/',2)=v_foreign::text LIMIT 1;

  -- org-level PM with no membership (minted, rolled back)
  v_pm := gen_random_uuid();
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES (v_pm, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'site-scope-probe-pm@e-site.invalid', '', now(), now(), now(), '{}', '{}');
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES (v_pm, c_org, 'project_manager', true);

  -- ── contractor ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_con, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM projects.projects;                                  INSERT INTO _r VALUES ('contractor sees exactly 1 project', v_n=1);
  SELECT count(*) INTO v_n FROM projects.projects WHERE id=v_foreign;               INSERT INTO _r VALUES ('contractor cannot see foreign project', v_n=0);
  SELECT count(*) INTO v_n FROM tenants.floor_plans WHERE project_id=v_foreign;     INSERT INTO _r VALUES ('contractor sees 0 foreign floor plans', v_n=0);
  SELECT count(*) INTO v_n FROM structure.nodes WHERE project_id=v_foreign;         INSERT INTO _r VALUES ('contractor sees 0 foreign nodes', v_n=0);
  SELECT count(*) INTO v_n FROM projects.rfis WHERE project_id=v_foreign;           INSERT INTO _r VALUES ('contractor sees 0 foreign rfis', v_n=0);
  SELECT count(*) INTO v_n FROM projects.project_members WHERE project_id=v_foreign; INSERT INTO _r VALUES ('contractor sees 0 foreign members', v_n=0);
  SELECT count(*) INTO v_n FROM cable_schedule.cables c
   WHERE public.site_project_of_revision(c.revision_id)=v_foreign;                 INSERT INTO _r VALUES ('contractor sees 0 foreign cables (child gate)', v_n=0);
  SELECT count(*) INTO v_m FROM structure.nodes WHERE project_id=v_own;             -- as the contractor
  RESET ROLE;
  SELECT count(*) INTO v_n FROM structure.nodes WHERE project_id=v_own;             -- as postgres: the truth
  INSERT INTO _r VALUES ('contractor still sees every own-site node', v_m=v_n);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_con, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM projects.projects WHERE id=v_own;                   INSERT INTO _r VALUES ('contractor still sees own project', v_n=1);
  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id='drawings' AND name=v_obj; INSERT INTO _r VALUES ('contractor cannot read foreign drawing file', v_obj IS NOT NULL AND v_n=0);
  -- tenants.floor_plans "Org members can manage floor plans" lets ANY org member write today
  UPDATE tenants.floor_plans SET name = name WHERE project_id = v_foreign;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('contractor cannot write a foreign floor plan', v_n = 0);
  RESET ROLE;

  -- ── org PM without membership ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pm, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM projects.projects;                                  INSERT INTO _r VALUES ('org PM without membership sees 0 projects', v_n=0);
  INSERT INTO _r VALUES ('effective role of org PM on a project is NULL', public.user_effective_project_role(v_foreign) IS NULL);
  RESET ROLE;

  -- ── admin ──
  SELECT count(*) INTO v_m FROM projects.projects WHERE organisation_id=c_org;      -- as postgres
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM projects.projects WHERE organisation_id=c_org;      INSERT INTO _r VALUES ('admin sees every WM project', v_n=v_m AND v_m>1);
  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id='drawings' AND name=v_obj; INSERT INTO _r VALUES ('admin reads foreign drawing file', v_n=1);
  BEGIN
    INSERT INTO projects.projects (organisation_id, name, status, created_by) VALUES (c_org, 'site-scope probe project', 'planning', v_admin) RETURNING id INTO v_new;
    v_ok := v_new IS NOT NULL;
  EXCEPTION WHEN OTHERS THEN v_ok := false;
  END;
  INSERT INTO _r VALUES ('admin can still create a project', v_ok);
  RESET ROLE;

  -- ── client viewer: unchanged ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cv, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM projects.projects;                                  INSERT INTO _r VALUES ('client viewer sees only their projects', v_n>=1 AND v_n<=(SELECT count(*) FROM projects.project_members WHERE user_id=v_cv AND is_active));
  RESET ROLE;
END $$;

SELECT k AS check, v AS ok FROM _r ORDER BY k;
