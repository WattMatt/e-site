-- BEHAVIOURAL assertions for 00205's row security, run as the real roles.
--
-- The structural file (assert-floor-plan-markups.sql) proves the policy EXISTS
-- and is RESTRICTIVE. That is not the same as proving it BITES — the 00051
-- family of gaps were all policies that existed and authorised nothing. This
-- file impersonates real production users and asserts what each one can
-- actually do, which is the only evidence that counts.
--
--   scripts/db/dry-run-migration.sh /tmp/noop.sql scripts/db/assert-floor-plan-markups-roles.sql
--
-- Impersonation mechanics this project has already paid for:
--   * set_config('request.jwt.claims', …, true) is TRANSACTION-local and
--     outlives RESET ROLE, so every fixture is seeded BEFORE the first
--     SET LOCAL ROLE and the claim is re-set for each identity.
--   * FORCE ROW LEVEL SECURITY is on, so even the table owner is subject to
--     the policies; the postgres-path writes below are the control.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
-- The probe records its findings while impersonating, so the impersonated
-- roles need to be able to write to the scratch table itself.
GRANT ALL ON _r TO authenticated, anon;

DO $$
DECLARE
  v_contractor   UUID;
  v_project      UUID;
  v_org          UUID;
  v_plan         UUID;
  v_client       UUID;
  v_client_proj  UUID;
  v_client_plan  UUID;
  v_markup       UUID;
  v_seen         INT;
  v_inspector    UUID;
BEGIN
  -- ── Fixture: the rbac-test contractor, on a project that HAS a drawing ────
  SELECT pm.user_id, pm.project_id INTO v_contractor, v_project
    FROM projects.project_members pm
   WHERE pm.role = 'contractor' AND pm.is_active
     AND EXISTS (SELECT 1 FROM tenants.floor_plans fp WHERE fp.project_id = pm.project_id)
   LIMIT 1;
  IF v_contractor IS NULL THEN RAISE EXCEPTION 'no contractor on a project with drawings'; END IF;

  SELECT fp.id, fp.organisation_id INTO v_plan, v_org
    FROM tenants.floor_plans fp WHERE fp.project_id = v_project LIMIT 1;

  -- ── Fixture: a real client_viewer, on a project that HAS a drawing ───────
  SELECT pm.user_id, pm.project_id INTO v_client, v_client_proj
    FROM projects.project_members pm
   WHERE pm.role = 'client_viewer' AND pm.is_active
     AND EXISTS (SELECT 1 FROM tenants.floor_plans fp WHERE fp.project_id = pm.project_id)
   LIMIT 1;
  SELECT fp.id INTO v_client_plan FROM tenants.floor_plans fp WHERE fp.project_id = v_client_proj LIMIT 1;

  -- ── Fixture: an inspector. None exists in production, so one is minted
  --    here and rolled back. Without it the RESTRICTIVE gate has no negative
  --    case at all and the whole file would only prove the happy path.
  v_inspector := gen_random_uuid();
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  VALUES (v_inspector, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'probe-inspector@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active)
  VALUES (v_inspector, v_org, 'inspector', TRUE);
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active)
  VALUES (v_project, v_inspector, v_org, 'inspector', TRUE);

  -- ── Control: a row written on the service path, so the reads below have
  --    something to find. FORCE RLS applies to the owner too, so this is
  --    written with the trigger binding parents as usual.
  INSERT INTO tenants.floor_plan_markups (floor_plan_id, name, scene, file_path)
  VALUES (v_plan, 'role-probe', '{"version":1,"canvas":{"w":1,"h":1},"shapes":[]}'::jsonb, 'probe.pdf')
  RETURNING id INTO v_markup;

  -- ═══ 1. CONTRACTOR — in MARKUP_WRITE_ROLES, must read AND write ═════════
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_contractor::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_seen FROM tenants.floor_plan_markups WHERE id = v_markup;
  INSERT INTO _r VALUES ('contractor_reads', v_seen = 1);

  BEGIN
    INSERT INTO tenants.floor_plan_markups (floor_plan_id, name, scene, file_path)
    VALUES (v_plan, 'contractor-wrote', '{"version":1}'::jsonb, 'probe2.pdf');
    INSERT INTO _r VALUES ('contractor_writes', true);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('contractor_writes', false);
  END;

  RESET ROLE;

  -- ═══ 2. INSPECTOR — a project member NOT in MARKUP_WRITE_ROLES ══════════
  -- The permissive policy admits them (user_has_project_access is true).
  -- ONLY the RESTRICTIVE gate can refuse them, so this is the assertion that
  -- proves the gate does anything at all.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_inspector::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO _r VALUES ('inspector_has_project_access',
    public.user_has_project_access(v_project));
  INSERT INTO _r VALUES ('inspector_effective_role_is_inspector',
    COALESCE(public.user_effective_project_role(v_project), '') = 'inspector');

  BEGIN
    INSERT INTO tenants.floor_plan_markups (floor_plan_id, name, scene, file_path)
    VALUES (v_plan, 'inspector-wrote', '{"version":1}'::jsonb, 'probe3.pdf');
    INSERT INTO _r VALUES ('inspector_write_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('inspector_write_REFUSED', true);
  END;

  -- An inspector may still READ: the select policy excludes only client_viewer.
  SELECT count(*) INTO v_seen FROM tenants.floor_plan_markups WHERE id = v_markup;
  INSERT INTO _r VALUES ('inspector_reads', v_seen = 1);

  -- And must not be able to DELETE someone else's layer.
  DELETE FROM tenants.floor_plan_markups WHERE id = v_markup;
  GET DIAGNOSTICS v_seen = ROW_COUNT;
  INSERT INTO _r VALUES ('inspector_delete_affects_nothing', v_seen = 0);

  RESET ROLE;

  -- ═══ 3. CLIENT VIEWER — must not see a markup at all ════════════════════
  IF v_client IS NOT NULL AND v_client_plan IS NOT NULL THEN
    INSERT INTO tenants.floor_plan_markups (floor_plan_id, name, scene, file_path)
    VALUES (v_client_plan, 'client-probe', '{"version":1}'::jsonb, 'probe4.pdf');

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_client::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    -- Control FIRST: prove this client_viewer really can see OTHER project
    -- data, so a zero below is the markup policy and not a broken fixture.
    SELECT count(*) INTO v_seen FROM tenants.floor_plans WHERE id = v_client_plan;
    INSERT INTO _r VALUES ('client_viewer_CAN_see_the_drawing', v_seen = 1);

    SELECT count(*) INTO v_seen FROM tenants.floor_plan_markups
     WHERE floor_plan_id = v_client_plan;
    INSERT INTO _r VALUES ('client_viewer_sees_NO_markup', v_seen = 0);

    RESET ROLE;
  ELSE
    INSERT INTO _r VALUES ('client_viewer_CAN_see_the_drawing', false);
    INSERT INTO _r VALUES ('client_viewer_sees_NO_markup', false);
  END IF;

  -- ═══ 4. ANON — must be refused at the grant, before any policy ══════════
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM tenants.floor_plan_markups LIMIT 1;
    INSERT INTO _r VALUES ('anon_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_REFUSED', true);
  END;
  RESET ROLE;
END $$;

SELECT * FROM (VALUES
  ('contractor (MARKUP_WRITE_ROLES) can read a saved markup',        (SELECT v FROM _r WHERE k='contractor_reads')),
  ('contractor (MARKUP_WRITE_ROLES) can save one',                   (SELECT v FROM _r WHERE k='contractor_writes')),
  ('inspector IS a project member (permissive half would admit)',    (SELECT v FROM _r WHERE k='inspector_has_project_access')),
  ('inspector resolves to the inspector role',                       (SELECT v FROM _r WHERE k='inspector_effective_role_is_inspector')),
  ('RESTRICTIVE gate BITES: inspector write refused 42501',          (SELECT v FROM _r WHERE k='inspector_write_REFUSED')),
  ('inspector may still read (select excludes only client_viewer)',  (SELECT v FROM _r WHERE k='inspector_reads')),
  ('inspector delete affects zero rows',                             (SELECT v FROM _r WHERE k='inspector_delete_affects_nothing')),
  ('CONTROL: client_viewer can see the drawing itself',              (SELECT v FROM _r WHERE k='client_viewer_CAN_see_the_drawing')),
  ('client_viewer sees no markup on it',                             (SELECT v FROM _r WHERE k='client_viewer_sees_NO_markup')),
  ('anon is refused at the grant',                                   (SELECT v FROM _r WHERE k='anon_REFUSED'))
) AS t("check", ok);
