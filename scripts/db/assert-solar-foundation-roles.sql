-- BEHAVIOURAL assertions for 00207_solar_foundation, run as real roles.
--   scripts/db/dry-run-migration.sh /tmp/noop.sql scripts/db/assert-solar-foundation-roles.sql   (expect RED)
--   scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00207_solar_foundation.sql scripts/db/assert-solar-foundation-roles.sql  (expect GREEN)
-- Fixtures are minted inside the transaction and rolled back. The WM-Consulting
-- org is deliberately NOT used: it bypasses the paywall, so it has no negative case.
-- Mechanics (paid for before): request.jwt.claims is transaction-local and
-- outlives RESET ROLE, so all seeding happens as postgres before impersonating.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_org      UUID := gen_random_uuid();
  v_org2     UUID := gen_random_uuid();
  v_project  UUID := gen_random_uuid();
  v_admin    UUID := gen_random_uuid();   -- org admin (grantor)
  v_pm       UUID := gen_random_uuid();   -- project_manager, will get VIEW
  v_con      UUID := gen_random_uuid();   -- contractor, will get EDIT
  v_nogrant  UUID := gen_random_uuid();   -- contractor, no grant
  v_client   UUID := gen_random_uuid();   -- client_viewer
  v_foreign  UUID := gen_random_uuid();   -- admin of ANOTHER org
  v_level    TEXT;
  v_n        INT;
  v_req      UUID;
  u          UUID;
BEGIN
  -- ── Fixtures (as postgres) ────────────────────────────────────────────────
  INSERT INTO public.organisations (id, name) VALUES (v_org, 'solar-probe-org'), (v_org2, 'solar-probe-org-2');
  FOREACH u IN ARRAY ARRAY[v_admin, v_pm, v_con, v_nogrant, v_client, v_foreign] LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'solar-probe-' || u || '@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  END LOOP;
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
    (v_admin, v_org, 'admin', TRUE), (v_pm, v_org, 'project_manager', TRUE),
    (v_con, v_org, 'contractor', TRUE), (v_nogrant, v_org, 'contractor', TRUE),
    (v_client, v_org, 'client_viewer', TRUE), (v_foreign, v_org2, 'admin', TRUE);
  INSERT INTO projects.projects (id, organisation_id, name, created_by) VALUES (v_project, v_org, 'solar-probe-project', v_admin);
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active) VALUES
    (v_project, v_pm, v_org, 'project_manager', TRUE), (v_project, v_con, v_org, 'contractor', TRUE),
    (v_project, v_nogrant, v_org, 'contractor', TRUE), (v_project, v_client, v_org, 'client_viewer', TRUE);

  -- ── 1. Not subscribed: nobody has Solar, not even the org admin ───────────
  INSERT INTO _r VALUES ('unsubscribed_org_has_no_solar', NOT public.org_has_solar(v_org));
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('unsubscribed_admin_level_null', public.solar_access_level(v_project) IS NULL);
  RESET ROLE;

  -- ── Subscribe the org (service path, like the webhook) ────────────────────
  INSERT INTO billing.org_addon_subscriptions (organisation_id, feature_key, status, amount_kobo, current_period_end)
  VALUES (v_org, 'solar', 'active', 199900, now() + interval '1 year');
  INSERT INTO _r VALUES ('subscribed_org_has_solar', public.org_has_solar(v_org));

  -- ── 2. Org admin: implicit edit_financials, and is a grantor ──────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('admin_is_edit_financials', public.solar_access_level(v_project) = 'edit_financials');
  INSERT INTO _r VALUES ('admin_is_grantor', public.solar_is_grantor(v_project));
  -- grant VIEW to the PM and EDIT to the contractor (granted_by forced to the caller)
  INSERT INTO solar.project_access (project_id, user_id, level) VALUES (v_project, v_pm, 'view');
  INSERT INTO solar.project_access (project_id, user_id, level, granted_by) VALUES (v_project, v_con, 'edit', v_pm);
  SELECT count(*) INTO v_n FROM solar.project_access WHERE project_id = v_project AND granted_by = v_admin;
  INSERT INTO _r VALUES ('granted_by_bound_to_caller', v_n = 2);
  -- a client viewer can never be granted
  BEGIN
    INSERT INTO solar.project_access (project_id, user_id, level) VALUES (v_project, v_client, 'view');
    INSERT INTO _r VALUES ('client_viewer_grant_REFUSED', false);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('client_viewer_grant_REFUSED', true);
  END;
  -- the admin creates the study
  INSERT INTO solar.studies (project_id, nmd_kva) VALUES (v_project, 500);
  SELECT count(*) INTO v_n FROM solar.studies WHERE project_id = v_project;
  INSERT INTO _r VALUES ('admin_creates_study', v_n = 1);
  RESET ROLE;

  -- ── 3. VIEW user: reads, cannot write, is not a grantor ───────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pm::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('pm_level_is_view', public.solar_access_level(v_project) = 'view');
  SELECT count(*) INTO v_n FROM solar.studies WHERE project_id = v_project;
  INSERT INTO _r VALUES ('view_user_reads_study', v_n = 1);
  UPDATE solar.studies SET nmd_kva = 1 WHERE project_id = v_project;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('view_user_update_affects_nothing', v_n = 0);
  INSERT INTO _r VALUES ('view_user_not_grantor', NOT public.solar_is_grantor(v_project));
  BEGIN
    INSERT INTO solar.project_access (project_id, user_id, level) VALUES (v_project, v_nogrant, 'edit');
    INSERT INTO _r VALUES ('view_user_grant_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('view_user_grant_REFUSED', true);
  END;
  RESET ROLE;

  -- ── 4. EDIT user: writes inputs, sees no money ────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_con::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('con_level_is_edit', public.solar_access_level(v_project) = 'edit');
  UPDATE solar.studies SET nmd_kva = 630 WHERE project_id = v_project;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('edit_user_updates_study', v_n = 1);
  INSERT INTO _r VALUES ('edit_user_cannot_see_money', NOT public.solar_can_see_money(v_project));
  RESET ROLE;

  -- ── 5. Member without a grant: nothing; can request access ────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_nogrant::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('nogrant_level_null', public.solar_access_level(v_project) IS NULL);
  SELECT count(*) INTO v_n FROM solar.studies WHERE project_id = v_project;
  INSERT INTO _r VALUES ('nogrant_sees_no_study', v_n = 0);
  INSERT INTO solar.access_requests (project_id, kind, requested_level, note)
  VALUES (v_project, 'access', 'edit', 'please') RETURNING id INTO v_req;
  SELECT count(*) INTO v_n FROM solar.access_requests WHERE id = v_req AND requester_id = v_nogrant AND status = 'pending';
  INSERT INTO _r VALUES ('request_bound_to_requester_pending', v_n = 1);
  -- requester may not approve their own request
  BEGIN
    UPDATE solar.access_requests SET status = 'approved', approved_level = 'edit_financials' WHERE id = v_req;
    INSERT INTO _r VALUES ('self_approve_REFUSED', false);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('self_approve_REFUSED', true);
  END;
  RESET ROLE;

  -- ── 6. Admin approves the request → grant row appears ─────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE solar.access_requests SET status = 'approved', approved_level = 'view' WHERE id = v_req;
  SELECT count(*) INTO v_n FROM solar.project_access WHERE project_id = v_project AND user_id = v_nogrant AND level = 'view';
  INSERT INTO _r VALUES ('approval_creates_grant', v_n = 1);
  RESET ROLE;

  -- ── 7. Client viewer and foreign admin see nothing ────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM solar.studies WHERE project_id = v_project;
  INSERT INTO _r VALUES ('client_viewer_sees_no_study', v_n = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_foreign::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM solar.studies WHERE project_id = v_project;
  INSERT INTO _r VALUES ('foreign_admin_sees_no_study', v_n = 0);
  INSERT INTO _r VALUES ('foreign_admin_not_grantor', NOT public.solar_is_grantor(v_project));
  RESET ROLE;

  -- ── 8. Lapse: hidden but kept ─────────────────────────────────────────────
  UPDATE billing.org_addon_subscriptions SET current_period_end = now() - interval '1 day' WHERE organisation_id = v_org;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM solar.studies WHERE project_id = v_project;
  INSERT INTO _r VALUES ('lapsed_admin_sees_nothing', v_n = 0);
  UPDATE solar.studies SET nmd_kva = 2 WHERE project_id = v_project;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('lapsed_admin_update_affects_nothing', v_n = 0);
  RESET ROLE;
  SELECT count(*) INTO v_n FROM solar.studies WHERE project_id = v_project AND nmd_kva = 630;
  INSERT INTO _r VALUES ('lapsed_rows_kept_unchanged', v_n = 1);

  -- ── 9. Service role bypasses; anon refused ────────────────────────────────
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO v_n FROM solar.studies WHERE project_id = v_project;
  INSERT INTO _r VALUES ('service_role_sees_study', v_n = 1);
  RESET ROLE;
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM solar.studies LIMIT 1;
    INSERT INTO _r VALUES ('anon_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_REFUSED', true);
  END;
  RESET ROLE;
END $$;

SELECT k AS "check", v AS ok FROM _r ORDER BY k;
