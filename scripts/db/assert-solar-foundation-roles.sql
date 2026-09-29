-- BEHAVIOURAL assertions for 00207_solar_foundation, run as real roles.
--   scripts/db/dry-run-migration.sh /tmp/noop.sql scripts/db/assert-solar-foundation-roles.sql   (expect RED)
--   scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00207_solar_foundation.sql scripts/db/assert-solar-foundation-roles.sql  (expect GREEN)
-- Fixtures are minted inside the transaction and rolled back. The WM-Consulting
-- org is deliberately NOT used: it bypasses the paywall, so it has no negative case.
-- Mechanics (paid for before): request.jwt.claims is transaction-local and
-- outlives RESET ROLE, so all seeding happens as postgres before impersonating.
--
-- REFUSAL PATTERN. A "…_REFUSED" check catches ONLY the SQLSTATE the design
-- promises. When the statement is (wrongly) allowed, the block raises P0001
-- itself, so the subtransaction rolls the write back and a mutation run does
-- not corrupt the checks that follow it. Any OTHER error is recorded as
-- false rather than aborting the file, so every check always reports.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_org      UUID := gen_random_uuid();
  v_org2     UUID := gen_random_uuid();
  v_org3     UUID := gen_random_uuid();   -- a sub-org identity the v_subid user is NOT active in
  v_project  UUID := gen_random_uuid();   -- P1
  v_project2 UUID := gen_random_uuid();   -- P2, same org
  v_node1    UUID := gen_random_uuid();   -- a board on P1
  v_node2    UUID := gen_random_uuid();   -- a board on P2
  v_admin    UUID := gen_random_uuid();   -- org admin (grantor)
  v_pm       UUID := gen_random_uuid();   -- project_manager, will get VIEW (P1, P2)
  v_con      UUID := gen_random_uuid();   -- contractor, will get EDIT (P1, P2)
  v_nogrant  UUID := gen_random_uuid();   -- contractor, no grant
  v_client   UUID := gen_random_uuid();   -- client_viewer
  v_sup      UUID := gen_random_uuid();   -- supplier
  v_orgpm    UUID := gen_random_uuid();   -- org-level project_manager, NO project_members row
  v_deact    UUID := gen_random_uuid();   -- contractor with a grant, later deactivated in the org
  v_foreign  UUID := gen_random_uuid();   -- admin of ANOTHER org
  v_ext      UUID := gen_random_uuid();   -- EXTERNAL: active in org2, active pm row on P1 (contractor)
  v_ext2     UUID := gen_random_uuid();   -- external whose pm row is INACTIVE
  v_ext3     UUID := gen_random_uuid();   -- external DEACTIVATED in their own org2
  v_extcv    UUID := gen_random_uuid();   -- external, pm row role client_viewer
  v_extsup   UUID := gen_random_uuid();   -- external, pm row role supplier
  v_extuocv  UUID := gen_random_uuid();   -- external, pm row contractor but identity-org role client_viewer
  v_subid    UUID := gen_random_uuid();   -- own-org contractor whose pm row carries org3, where they are NOT active
  v_req5     UUID;
  v_req4     UUID;
  v_level    TEXT;
  v_n        INT;
  v_req      UUID;
  v_req2     UUID;
  v_req3     UUID;
  u          UUID;
BEGIN
  -- ── Fixtures (as postgres) ────────────────────────────────────────────────
  INSERT INTO public.organisations (id, name) VALUES (v_org, 'solar-probe-org'), (v_org2, 'solar-probe-org-2'), (v_org3, 'solar-probe-org-3');
  FOREACH u IN ARRAY ARRAY[v_admin, v_pm, v_con, v_nogrant, v_client, v_sup, v_orgpm, v_deact, v_foreign, v_ext, v_ext2, v_ext3, v_extcv, v_extsup, v_extuocv, v_subid] LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'solar-probe-' || u || '@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  END LOOP;
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
    (v_admin, v_org, 'admin', TRUE), (v_pm, v_org, 'project_manager', TRUE),
    (v_con, v_org, 'contractor', TRUE), (v_nogrant, v_org, 'contractor', TRUE),
    (v_client, v_org, 'client_viewer', TRUE), (v_sup, v_org, 'supplier', TRUE),
    (v_orgpm, v_org, 'project_manager', TRUE), (v_deact, v_org, 'contractor', TRUE),
    (v_foreign, v_org2, 'admin', TRUE),
    (v_ext, v_org2, 'contractor', TRUE), (v_ext2, v_org2, 'contractor', TRUE), (v_ext3, v_org2, 'contractor', FALSE),
    (v_extcv, v_org2, 'contractor', TRUE), (v_extsup, v_org2, 'contractor', TRUE),
    (v_extuocv, v_org2, 'client_viewer', TRUE),
    (v_subid, v_org, 'contractor', TRUE), (v_subid, v_org3, 'contractor', FALSE);
  INSERT INTO projects.projects (id, organisation_id, name, created_by) VALUES
    (v_project, v_org, 'solar-probe-project', v_admin),
    (v_project2, v_org, 'solar-probe-project-2', v_admin);
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active) VALUES
    (v_project, v_pm, v_org, 'project_manager', TRUE), (v_project, v_con, v_org, 'contractor', TRUE),
    (v_project, v_nogrant, v_org, 'contractor', TRUE), (v_project, v_client, v_org, 'client_viewer', TRUE),
    (v_project, v_sup, v_org, 'supplier', TRUE), (v_project, v_deact, v_org, 'contractor', TRUE),
    (v_project2, v_pm, v_org, 'project_manager', TRUE), (v_project2, v_con, v_org, 'contractor', TRUE),
    -- externals: the row carries THEIR identity org (the sub-org convention)
    (v_project, v_ext, v_org2, 'contractor', TRUE), (v_project, v_ext2, v_org2, 'contractor', FALSE),
    (v_project, v_ext3, v_org2, 'contractor', TRUE),
    (v_project, v_extcv, v_org2, 'client_viewer', TRUE), (v_project, v_extsup, v_org2, 'supplier', TRUE),
    (v_project, v_extuocv, v_org2, 'contractor', TRUE),
    (v_project, v_subid, v_org3, 'contractor', TRUE);
  INSERT INTO structure.nodes (id, project_id, organisation_id, kind, code) VALUES
    (v_node1, v_project, v_org, 'main_board', 'SOLAR-PROBE-MB1'),
    (v_node2, v_project2, v_org, 'main_board', 'SOLAR-PROBE-MB2');

  -- ── 1. Not subscribed: nobody has Solar, not even the org admin ───────────
  INSERT INTO _r VALUES ('unsubscribed_org_has_no_solar', NOT public.org_has_solar(v_org));
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('unsubscribed_admin_level_null', public.solar_access_level(v_project) IS NULL);
  RESET ROLE;

  -- ── Subscription table rules (M3) ─────────────────────────────────────────
  BEGIN
    INSERT INTO billing.org_addon_subscriptions (organisation_id, feature_key, status, amount_kobo, current_period_end)
    VALUES (v_org2, 'solar', 'active', 199900, NULL);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('live_subscription_without_period_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('live_subscription_without_period_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('live_subscription_without_period_REFUSED', false);
  END;

  -- ── Subscribe the org (service path, like the webhook) ────────────────────
  INSERT INTO billing.org_addon_subscriptions (organisation_id, feature_key, status, amount_kobo, current_period_end)
  VALUES (v_org, 'solar', 'active', 199900, now() + interval '1 year');
  INSERT INTO _r VALUES ('subscribed_org_has_solar', public.org_has_solar(v_org));
  -- FORCE RLS on the subscription table must not stop the webhook's role.
  SET LOCAL ROLE service_role;
  BEGIN
    UPDATE billing.org_addon_subscriptions SET last_event_id = 'probe' WHERE organisation_id = v_org;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('service_role_writes_subscription', v_n = 1);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('service_role_writes_subscription', false);
  END;
  RESET ROLE;

  -- ── 2. Org admin: implicit edit_financials, and is a grantor ──────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('admin_is_edit_financials', public.solar_access_level(v_project) = 'edit_financials');
  INSERT INTO _r VALUES ('admin_is_grantor', public.solar_is_grantor(v_project));
  -- grants (granted_by forced to the caller; organisation_id bound, never trusted)
  INSERT INTO solar.project_access (project_id, user_id, level, organisation_id) VALUES (v_project, v_pm, 'view', v_org2);
  INSERT INTO solar.project_access (project_id, user_id, level, granted_by, granted_at) VALUES (v_project, v_con, 'edit', v_pm, '2000-01-01');
  SELECT count(*) INTO v_n FROM solar.project_access WHERE project_id = v_project AND user_id = v_con AND granted_at > '2001-01-01';
  INSERT INTO _r VALUES ('grant_insert_granted_at_ignored', v_n = 1);
  INSERT INTO solar.project_access (project_id, user_id, level) VALUES (v_project, v_deact, 'edit');
  INSERT INTO solar.project_access (project_id, user_id, level) VALUES (v_project2, v_pm, 'view'), (v_project2, v_con, 'edit');
  SELECT count(*) INTO v_n FROM solar.project_access WHERE project_id = v_project AND granted_by = v_admin;
  INSERT INTO _r VALUES ('granted_by_bound_to_caller', v_n = 3);
  SELECT count(*) INTO v_n FROM solar.project_access WHERE project_id = v_project AND user_id = v_pm AND organisation_id = v_org;
  INSERT INTO _r VALUES ('forged_org_on_grant_bound', v_n = 1);
  -- granted_at is the moment of the grant; an edit cannot rewrite it
  UPDATE solar.project_access SET granted_at = '2000-01-01', level = 'view' WHERE project_id = v_project AND user_id = v_pm;
  SELECT count(*) INTO v_n FROM solar.project_access WHERE project_id = v_project AND user_id = v_pm AND granted_at > '2001-01-01';
  INSERT INTO _r VALUES ('grant_granted_at_pinned', v_n = 1);
  -- a client viewer or a supplier can never be granted
  BEGIN
    INSERT INTO solar.project_access (project_id, user_id, level) VALUES (v_project, v_client, 'view');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('client_viewer_grant_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('client_viewer_grant_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('client_viewer_grant_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.project_access (project_id, user_id, level) VALUES (v_project, v_sup, 'view');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('supplier_grant_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('supplier_grant_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('supplier_grant_REFUSED', false);
  END;
  -- the admin creates the study
  INSERT INTO solar.studies (project_id, nmd_kva, created_at) VALUES (v_project, 500, '2000-01-01');
  SELECT count(*) INTO v_n FROM solar.studies WHERE project_id = v_project;
  INSERT INTO _r VALUES ('admin_creates_study', v_n = 1);
  SELECT count(*) INTO v_n FROM solar.studies WHERE project_id = v_project AND created_at > '2001-01-01';
  INSERT INTO _r VALUES ('study_insert_created_at_ignored', v_n = 1);
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
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('view_user_grant_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('view_user_grant_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('view_user_grant_REFUSED', false);
  END;
  -- P2 has no study yet; a view user may not create one
  BEGIN
    INSERT INTO solar.studies (project_id, nmd_kva) VALUES (v_project2, 100);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('view_user_insert_study_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('view_user_insert_study_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('view_user_insert_study_REFUSED', false);
  END;
  -- recording activity is an edit (M2)
  BEGIN
    INSERT INTO solar.audit_events (project_id, verb) VALUES (v_project, 'probe.view');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('view_user_audit_insert_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('view_user_audit_insert_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('view_user_audit_insert_REFUSED', false);
  END;
  RESET ROLE;

  -- ── 4. EDIT user: writes inputs, sees no money, cannot rewrite attribution ─
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_con::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('con_level_is_edit', public.solar_access_level(v_project) = 'edit');
  UPDATE solar.studies SET nmd_kva = 630 WHERE project_id = v_project;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('edit_user_updates_study', v_n = 1);
  INSERT INTO _r VALUES ('edit_user_cannot_see_money', NOT public.solar_can_see_money(v_project));
  UPDATE solar.studies SET created_by = v_con, created_at = '2000-01-01' WHERE project_id = v_project;
  SELECT count(*) INTO v_n FROM solar.studies
   WHERE project_id = v_project AND created_by = v_admin AND created_at > '2001-01-01';
  INSERT INTO _r VALUES ('edit_user_cannot_rewrite_created_by', v_n = 1);
  BEGIN
    UPDATE solar.studies SET project_id = v_project2 WHERE project_id = v_project;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('study_project_move_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('study_project_move_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('study_project_move_REFUSED', false);
  END;
  -- activity is SERVICE-written since 00218: an editor cannot post a line directly
  BEGIN
    INSERT INTO solar.audit_events (project_id, verb, actor_id, organisation_id)
    VALUES (v_project, 'probe.forged', v_admin, v_org2);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('edit_user_audit_insert_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('edit_user_audit_insert_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('edit_user_audit_insert_REFUSED', false);
  END;
  -- a request for LESS than the contractor already holds (M6 re-approval path)
  INSERT INTO solar.access_requests (project_id, kind, requested_level) VALUES (v_project, 'access', 'view')
  RETURNING id INTO v_req3;
  RESET ROLE;
  -- the trusted path (the JWT claim still names the contractor): actor and org are bound even when supplied
  INSERT INTO solar.audit_events (project_id, verb, actor_id, organisation_id)
  VALUES (v_project, 'probe.edit', v_admin, v_org2);
  SELECT count(*) INTO v_n FROM solar.audit_events WHERE project_id = v_project AND verb = 'probe.edit' AND actor_id = v_con;
  INSERT INTO _r VALUES ('audit_actor_bound_to_caller', v_n = 1);
  SELECT count(*) INTO v_n FROM solar.audit_events WHERE project_id = v_project AND verb = 'probe.edit' AND organisation_id = v_org;
  INSERT INTO _r VALUES ('forged_org_on_audit_bound', v_n = 1);

  -- ── 4b. Admin: P2 study (node + org binding), delete gate, append-only ────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.studies (project_id, nmd_kva, poc_node_id) VALUES (v_project2, 100, v_node1);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('poc_node_other_project_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('poc_node_other_project_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('poc_node_other_project_REFUSED', false);
  END;
  INSERT INTO solar.studies (project_id, nmd_kva, poc_node_id, organisation_id) VALUES (v_project2, 100, v_node2, v_org2);
  SELECT count(*) INTO v_n FROM solar.studies WHERE project_id = v_project2 AND poc_node_id = v_node2;
  INSERT INTO _r VALUES ('poc_node_same_project_accepted', v_n = 1);
  SELECT count(*) INTO v_n FROM solar.studies WHERE project_id = v_project2 AND organisation_id = v_org;
  INSERT INTO _r VALUES ('forged_org_on_study_bound', v_n = 1);
  -- append-only activity: no UPDATE, no DELETE, even for an admin
  BEGIN
    UPDATE solar.audit_events SET verb = 'rewritten' WHERE project_id = v_project;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001'; END IF;
    INSERT INTO _r VALUES ('audit_update_REFUSED', true);
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('audit_update_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('audit_update_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('audit_update_REFUSED', false);
  END;
  BEGIN
    DELETE FROM solar.audit_events WHERE project_id = v_project;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001'; END IF;
    INSERT INTO _r VALUES ('audit_delete_REFUSED', true);
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('audit_delete_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('audit_delete_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('audit_delete_REFUSED', false);
  END;
  RESET ROLE;
  -- an EDIT user may not delete a whole study; an admin may
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_con::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  DELETE FROM solar.studies WHERE project_id = v_project2;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('edit_user_delete_affects_nothing', v_n = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  DELETE FROM solar.studies WHERE project_id = v_project2;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('admin_deletes_study', v_n = 1);
  RESET ROLE;

  -- ── 5. Member without a grant: nothing; can request access ────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_nogrant::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('nogrant_level_null', public.solar_access_level(v_project) IS NULL);
  SELECT count(*) INTO v_n FROM solar.studies WHERE project_id = v_project;
  INSERT INTO _r VALUES ('nogrant_sees_no_study', v_n = 0);
  INSERT INTO solar.access_requests (project_id, kind, requested_level, note, organisation_id)
  VALUES (v_project, 'access', 'edit', 'please', v_org2) RETURNING id INTO v_req;
  SELECT count(*) INTO v_n FROM solar.access_requests WHERE id = v_req AND requester_id = v_nogrant AND status = 'pending';
  INSERT INTO _r VALUES ('request_bound_to_requester_pending', v_n = 1);
  SELECT count(*) INTO v_n FROM solar.access_requests WHERE id = v_req AND organisation_id = v_org;
  INSERT INTO _r VALUES ('forged_org_on_request_bound', v_n = 1);
  -- the requester cannot pre-fill the decision, or rewrite what they asked for
  UPDATE solar.access_requests SET approved_level = 'edit_financials' WHERE id = v_req;
  SELECT count(*) INTO v_n FROM solar.access_requests WHERE id = v_req AND approved_level IS NULL AND status = 'pending';
  INSERT INTO _r VALUES ('requester_cannot_set_approved_level', v_n = 1);
  UPDATE solar.access_requests SET requested_level = 'edit_financials', note = 'rewritten',
                                   organisation_id = v_org2, created_at = '2000-01-01' WHERE id = v_req;
  SELECT count(*) INTO v_n FROM solar.access_requests
   WHERE id = v_req AND requested_level = 'edit' AND note = 'please' AND organisation_id = v_org AND created_at > '2001-01-01';
  INSERT INTO _r VALUES ('requester_cannot_rewrite_request', v_n = 1);
  -- requester may not approve their own request
  BEGIN
    UPDATE solar.access_requests SET status = 'approved', approved_level = 'edit_financials' WHERE id = v_req;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('self_approve_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('self_approve_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('self_approve_REFUSED', false);
  END;
  RESET ROLE;

  -- ── 5b. Client viewer and supplier cannot request ─────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.access_requests (project_id, kind, requested_level) VALUES (v_project, 'access', 'view');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('client_viewer_request_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('client_viewer_request_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('client_viewer_request_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sup::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.access_requests (project_id, kind, requested_level) VALUES (v_project, 'access', 'view');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('supplier_request_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('supplier_request_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('supplier_request_REFUSED', false);
  END;
  RESET ROLE;

  -- ── 5c. Org-level PM with no project_members row can request ──────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_orgpm::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.access_requests (project_id, kind, requested_level) VALUES (v_project, 'access', 'edit')
    RETURNING id INTO v_req2;
    INSERT INTO _r VALUES ('org_pm_can_request', v_req2 IS NOT NULL);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('org_pm_can_request', false);
  END;
  RESET ROLE;

  -- ── 6. Admin decides the requests → grant rows ────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE solar.access_requests SET status = 'approved', approved_level = 'view' WHERE id = v_req;
  SELECT count(*) INTO v_n FROM solar.project_access WHERE project_id = v_project AND user_id = v_nogrant AND level = 'view';
  INSERT INTO _r VALUES ('approval_creates_grant', v_n = 1);
  BEGIN
    UPDATE solar.access_requests SET status = 'approved', approved_level = 'edit' WHERE id = v_req2;
    SELECT count(*) INTO v_n FROM solar.project_access WHERE project_id = v_project AND user_id = v_orgpm AND level = 'edit';
    INSERT INTO _r VALUES ('org_pm_approval_creates_grant', v_n = 1);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('org_pm_approval_creates_grant', false);
  END;
  -- approving a LOWER level than the holder has must not downgrade them (M6)
  UPDATE solar.access_requests SET status = 'approved', approved_level = 'view' WHERE id = v_req3;
  SELECT count(*) INTO v_n FROM solar.project_access WHERE project_id = v_project AND user_id = v_con AND level = 'edit';
  INSERT INTO _r VALUES ('reapproval_never_downgrades', v_n = 1);
  RESET ROLE;

  -- ── 7. Forged grant rows (bind trigger bypassed) are inert ────────────────
  ALTER TABLE solar.project_access DISABLE TRIGGER project_access_bind;
  INSERT INTO solar.project_access (project_id, user_id, organisation_id, level) VALUES
    (v_project, v_client, v_org, 'edit'), (v_project, v_sup, v_org, 'edit');
  ALTER TABLE solar.project_access ENABLE TRIGGER project_access_bind;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_level := public.solar_access_level(v_project);
  SELECT count(*) INTO v_n FROM solar.studies WHERE project_id = v_project;
  INSERT INTO _r VALUES ('forged_grant_client_viewer_inert', v_level IS NULL AND v_n = 0);
  INSERT INTO _r VALUES ('client_viewer_sees_no_study', v_n = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sup::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_level := public.solar_access_level(v_project);
  SELECT count(*) INTO v_n FROM solar.studies WHERE project_id = v_project;
  INSERT INTO _r VALUES ('forged_grant_supplier_inert', v_level IS NULL AND v_n = 0);
  RESET ROLE;

  -- ── 7b. Foreign admin sees nothing, learns nothing, grants nothing ────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_foreign::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM solar.studies WHERE project_id = v_project;
  INSERT INTO _r VALUES ('foreign_admin_sees_no_study', v_n = 0);
  INSERT INTO _r VALUES ('foreign_admin_not_grantor', NOT public.solar_is_grantor(v_project));
  INSERT INTO _r VALUES ('foreign_admin_org_has_solar_false', NOT public.org_has_solar(v_org));
  BEGIN
    INSERT INTO solar.project_access (project_id, user_id, level) VALUES (v_project, v_admin, 'view');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('foreign_admin_grant_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('foreign_admin_grant_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('foreign_admin_grant_REFUSED', false);
  END;
  RESET ROLE;

  -- ── 7c. Deactivated in the org: the grant and project row no longer count ─
  UPDATE public.user_organisations SET is_active = FALSE WHERE user_id = v_deact AND organisation_id = v_org;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_deact::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('deactivated_member_level_null', public.solar_access_level(v_project) IS NULL);
  SELECT count(*) INTO v_n FROM solar.studies WHERE project_id = v_project;
  INSERT INTO _r VALUES ('deactivated_member_sees_no_study', v_n = 0);
  RESET ROLE;

  -- ── 7d. External project members: eligible, capped at VIEW ───────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ext::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  -- 00204 clause (a) joins the row's identity org, so the external passes it
  INSERT INTO _r VALUES ('external_passes_user_has_project_access', public.user_has_project_access(v_project));
  BEGIN
    INSERT INTO solar.access_requests (project_id, kind, requested_level) VALUES (v_project, 'access', 'edit')
    RETURNING id INTO v_req4;
  EXCEPTION WHEN OTHERS THEN
    v_req4 := NULL;   -- reported by external_request_clamped_to_view below
  END;
  SELECT count(*) INTO v_n FROM solar.access_requests WHERE id = v_req4 AND requested_level = 'view';
  INSERT INTO _r VALUES ('external_request_clamped_to_view', v_n = 1);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE solar.access_requests SET status = 'approved', approved_level = 'edit' WHERE id = v_req4;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('external_approval_above_view_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('external_approval_above_view_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('external_approval_above_view_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.project_access (project_id, user_id, level) VALUES (v_project, v_ext, 'edit');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('external_grant_edit_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('external_grant_edit_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('external_grant_edit_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.project_access (project_id, user_id, level) VALUES (v_project, v_ext, 'view');
    SELECT count(*) INTO v_n FROM solar.project_access WHERE project_id = v_project AND user_id = v_ext AND level = 'view';
    INSERT INTO _r VALUES ('external_grant_view_accepted', v_n = 1);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('external_grant_view_accepted', false);
  END;
  -- the grant path itself (not only the read path) rejects a lapsed external
  BEGIN
    INSERT INTO solar.project_access (project_id, user_id, level) VALUES (v_project, v_ext2, 'view');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('external_inactive_pm_grant_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('external_inactive_pm_grant_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('external_inactive_pm_grant_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.project_access (project_id, user_id, level) VALUES (v_project, v_ext3, 'view');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('external_deactivated_grant_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('external_deactivated_grant_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('external_deactivated_grant_REFUSED', false);
  END;
  RESET ROLE;
  -- a forged 'edit' row (bind trigger bypassed) still resolves to 'view'
  ALTER TABLE solar.project_access DISABLE TRIGGER project_access_bind;
  UPDATE solar.project_access SET level = 'edit' WHERE project_id = v_project AND user_id = v_ext;
  INSERT INTO solar.project_access (project_id, user_id, organisation_id, level) VALUES
    (v_project, v_ext2, v_org, 'view'), (v_project, v_ext3, v_org, 'view');
  ALTER TABLE solar.project_access ENABLE TRIGGER project_access_bind;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ext::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('external_forged_edit_resolves_view', public.solar_access_level(v_project) = 'view');
  SELECT count(*) INTO v_n FROM solar.studies WHERE project_id = v_project;
  INSERT INTO _r VALUES ('external_reads_study', v_n = 1);
  UPDATE solar.studies SET nmd_kva = 3 WHERE project_id = v_project;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('external_update_affects_nothing', v_n = 0);
  RESET ROLE;
  -- approving 'view' over the forged 'edit': highest-wins merge still capped
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE solar.access_requests SET status = 'approved', approved_level = 'view' WHERE id = v_req4;
    SELECT count(*) INTO v_n FROM solar.project_access WHERE project_id = v_project AND user_id = v_ext AND level = 'view';
    INSERT INTO _r VALUES ('external_reapproval_merge_capped_at_view', v_n = 1);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('external_reapproval_merge_capped_at_view', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ext2::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('external_inactive_pm_row_null', public.solar_access_level(v_project) IS NULL);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ext3::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('external_deactivated_in_own_org_null', public.solar_access_level(v_project) IS NULL);
  RESET ROLE;

  -- ── 7e. Ineligible shapes: client-facing externals, and an own-org member
  --        whose project row points at a sub-org they are not active in ────
  DECLARE
    v_who   UUID[] := ARRAY[v_extcv, v_extsup, v_extuocv, v_subid];
    v_name  TEXT[] := ARRAY['external_client_viewer', 'external_supplier',
                            'external_identity_client_viewer', 'sub_org_inactive_identity'];
    i       INT;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    FOR i IN 1 .. array_length(v_who, 1) LOOP
      BEGIN
        INSERT INTO solar.project_access (project_id, user_id, level) VALUES (v_project, v_who[i], 'view');
        RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
      EXCEPTION
        WHEN check_violation THEN INSERT INTO _r VALUES (v_name[i] || '_grant_REFUSED', true);
        WHEN OTHERS THEN INSERT INTO _r VALUES (v_name[i] || '_grant_REFUSED', false);
      END;
    END LOOP;
    RESET ROLE;
    FOR i IN 1 .. array_length(v_who, 1) LOOP
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_who[i]::text, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      BEGIN
        INSERT INTO solar.access_requests (project_id, kind, requested_level) VALUES (v_project, 'access', 'view');
        RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
      EXCEPTION
        WHEN insufficient_privilege THEN INSERT INTO _r VALUES (v_name[i] || '_request_REFUSED', true);
        WHEN OTHERS THEN INSERT INTO _r VALUES (v_name[i] || '_request_REFUSED', false);
      END;
      RESET ROLE;
    END LOOP;
    ALTER TABLE solar.project_access DISABLE TRIGGER project_access_bind;
    FOR i IN 1 .. array_length(v_who, 1) LOOP
      INSERT INTO solar.project_access (project_id, user_id, organisation_id, level) VALUES (v_project, v_who[i], v_org, 'edit');
    END LOOP;
    ALTER TABLE solar.project_access ENABLE TRIGGER project_access_bind;
    FOR i IN 1 .. array_length(v_who, 1) LOOP
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_who[i]::text, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      v_level := public.solar_access_level(v_project);
      SELECT count(*) INTO v_n FROM solar.studies WHERE project_id = v_project;
      INSERT INTO _r VALUES (v_name[i] || '_forged_grant_inert', v_level IS NULL AND v_n = 0);
      RESET ROLE;
    END LOOP;
  END;

  -- ── 7f. Subscribe requests: own org only, and approval carries no level ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ext::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.access_requests (project_id, kind) VALUES (v_project, 'subscribe');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('external_subscribe_request_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('external_subscribe_request_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pm::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.access_requests (project_id, kind) VALUES (v_project, 'subscribe') RETURNING id INTO v_req5;
    INSERT INTO _r VALUES ('own_org_subscribe_request_accepted', v_req5 IS NOT NULL);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('own_org_subscribe_request_accepted', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE solar.access_requests SET status = 'approved', approved_level = 'edit_financials' WHERE id = v_req5;
  SELECT count(*) INTO v_n FROM solar.access_requests WHERE id = v_req5 AND status = 'approved' AND approved_level IS NULL;
  SELECT v_n + count(*) INTO v_n FROM solar.project_access WHERE project_id = v_project AND user_id = v_pm AND level = 'view';
  INSERT INTO _r VALUES ('subscribe_approval_carries_no_level', v_n = 2);
  RESET ROLE;
  BEGIN
    INSERT INTO billing.org_addon_subscriptions (organisation_id, feature_key, status, amount_kobo)
    VALUES (v_org2, 'solar', 'pending', -1);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('negative_amount_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('negative_amount_REFUSED', false);
  END;

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
