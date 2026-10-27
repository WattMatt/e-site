-- BEHAVIOURAL assertions for 00257 (public.mcp_tool_calls and its two RPCs), run as the real roles.
--
--   scripts/db/dry-run-migration.sh scripts/db/fixtures/noop.sql scripts/db/assert-mcp-tool-calls.sql   (red first)
--   scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00257_mcp_tool_calls.sql \
--                                   scripts/db/assert-mcp-tool-calls.sql                                  (green)
--
-- What is proved, by impersonation, not by reading pg_policy:
--   * a member reads only their own rows, and only those on projects they can access;
--   * an org owner/admin reads every row of their org (and nothing of another org);
--   * authenticated and anon cannot INSERT/UPDATE/DELETE, and cannot execute either RPC;
--   * mcp_rate_status counts the last 60 seconds per user, with writes = preview + write;
--   * record_mcp_call works for service_role only;
--   * product_events accepts 'mcp_tool_called' and every earlier event is still accepted.
--
-- Impersonation mechanics this project has already paid for:
--   * set_config('request.jwt.claims', …, true) is TRANSACTION-local and outlives RESET ROLE, so every
--     fixture is seeded BEFORE the first SET LOCAL ROLE and the claim is re-set (or cleared) per identity.
--   * FORCE ROW LEVEL SECURITY is on; postgres has BYPASSRLS, which is what lets the definer RPCs write.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_contractor  UUID := '018f2d31-bbe8-4cc1-bbdd-63af0187081e';
  v_org         UUID;
  v_proj_on     UUID;   -- a project the contractor is on
  v_proj_off    UUID;   -- a project in the same org the contractor is NOT on
  v_admin       UUID := gen_random_uuid();
  v_stranger    UUID := gen_random_uuid();
  v_foreign_org UUID;
  v_id1 UUID; v_id2 UUID; v_id3 UUID; v_id4 UUID; v_id5 UUID;
  v_n           INT;
  v_calls       INT;
  v_writes      INT;
BEGIN
  -- ── Fixtures ────────────────────────────────────────────────────────────
  SELECT pm.project_id, pm.organisation_id INTO v_proj_on, v_org
    FROM projects.project_members pm
    JOIN projects.projects p ON p.id = pm.project_id
   WHERE pm.user_id = v_contractor AND pm.is_active
   ORDER BY (p.name ILIKE '%KINGSWALK%') DESC, p.name
   LIMIT 1;
  IF v_proj_on IS NULL THEN RAISE EXCEPTION 'rbac-test contractor has no active project membership'; END IF;

  SELECT p.id INTO v_proj_off
    FROM projects.projects p
   WHERE p.organisation_id = v_org
     AND NOT EXISTS (SELECT 1 FROM projects.project_members pm
                      WHERE pm.project_id = p.id AND pm.user_id = v_contractor AND pm.is_active)
   LIMIT 1;
  IF v_proj_off IS NULL THEN RAISE EXCEPTION 'no project in the org that the contractor is not on'; END IF;

  SELECT o.id INTO v_foreign_org FROM public.organisations o WHERE o.id <> v_org LIMIT 1;
  v_foreign_org := COALESCE(v_foreign_org, gen_random_uuid());

  -- A throwaway org admin (NOT a member of any project: admin reach must come from the org role).
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  VALUES (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'probe-mcp-admin@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active)
  VALUES (v_admin, v_org, 'admin', TRUE);

  -- ── Rows, written on the service path through the definer RPC ──────────
  -- (The definer RPC is the only writer. Clear the claim so the service path is really the service path.)
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  SET LOCAL ROLE service_role;

  -- contractor: on a project they are on (read), on a project they are NOT on (write), project-less (preview)
  v_id1 := public.record_mcp_call(v_contractor, 'client-a', v_org, v_proj_on,  'tool_read',    'read',    'd1', 'ok',      NULL,       '["x"]'::jsonb, 12);
  v_id2 := public.record_mcp_call(v_contractor, 'client-a', v_org, v_proj_off, 'tool_write',   'write',   'd2', 'refused', 'no access', NULL,         3);
  v_id4 := public.record_mcp_call(v_contractor, 'client-a', v_org, NULL,       'tool_preview', 'preview', 'd4', 'ok',      NULL,       NULL,           5);
  -- the admin's own row, and a row in a foreign org
  v_id3 := public.record_mcp_call(v_admin,      'client-b', v_org, NULL,       'tool_read',    'read',    'd3', 'ok',      NULL,       NULL,           7);
  v_id5 := public.record_mcp_call(v_stranger,   'client-c', v_foreign_org, NULL, 'tool_read',  'read',    'd5', 'error',   'boom',     NULL,           9);

  INSERT INTO _r VALUES ('rpc_returns_ids', v_id1 IS NOT NULL AND v_id2 IS NOT NULL AND v_id3 IS NOT NULL
                                            AND v_id4 IS NOT NULL AND v_id5 IS NOT NULL);

  SELECT count(*) INTO v_n FROM public.mcp_tool_calls WHERE id IN (v_id1, v_id2, v_id3, v_id4, v_id5);
  INSERT INTO _r VALUES ('service_role_sees_all_five_rows', v_n = 5);

  -- Kind and outcome are CHECK-constrained.
  BEGIN
    PERFORM public.record_mcp_call(v_contractor, 'c', v_org, NULL, 't', 'banana', 'd', 'ok', NULL, NULL, 1);
    INSERT INTO _r VALUES ('bad_kind_refused', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _r VALUES ('bad_kind_refused', true);
  END;
  BEGIN
    PERFORM public.record_mcp_call(v_contractor, 'c', v_org, NULL, 't', 'read', 'd', 'maybe', NULL, NULL, 1);
    INSERT INTO _r VALUES ('bad_outcome_refused', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _r VALUES ('bad_outcome_refused', true);
  END;

  -- Rate status: contractor has 3 calls (read, write, preview) of which 2 are writes (preview + write).
  SELECT s.calls, s.writes INTO v_calls, v_writes FROM public.mcp_rate_status(v_contractor) s;
  INSERT INTO _r VALUES ('rate_status_counts_calls', v_calls = 3);
  INSERT INTO _r VALUES ('rate_status_writes_are_preview_plus_write', v_writes = 2);
  SELECT s.calls, s.writes INTO v_calls, v_writes FROM public.mcp_rate_status(v_stranger) s;
  INSERT INTO _r VALUES ('rate_status_stranger_one_call_no_writes', v_calls = 1 AND v_writes = 0);
  SELECT s.calls, s.writes INTO v_calls, v_writes FROM public.mcp_rate_status(gen_random_uuid()) s;
  INSERT INTO _r VALUES ('rate_status_unknown_user_is_zero_zero', v_calls = 0 AND v_writes = 0);

  -- The window is 60 seconds: age one row past it and it drops out.
  RESET ROLE;
  UPDATE public.mcp_tool_calls SET created_at = now() - interval '61 seconds' WHERE id = v_id1;
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  SET LOCAL ROLE service_role;
  SELECT s.calls, s.writes INTO v_calls, v_writes FROM public.mcp_rate_status(v_contractor) s;
  INSERT INTO _r VALUES ('rate_status_window_is_60_seconds', v_calls = 2 AND v_writes = 2);
  RESET ROLE;

  -- ═══ 1. CONTRACTOR — own rows on accessible projects only ══════════════
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_contractor::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- Control FIRST: the project they are off really is closed to them, and the other is open.
  INSERT INTO _r VALUES ('control_contractor_has_access_to_proj_on',  public.user_has_project_access(v_proj_on));
  INSERT INTO _r VALUES ('control_contractor_has_NO_access_to_proj_off', NOT public.user_has_project_access(v_proj_off));

  SELECT count(*) INTO v_n FROM public.mcp_tool_calls WHERE id = v_id1;
  INSERT INTO _r VALUES ('contractor_reads_own_row_on_accessible_project', v_n = 1);
  SELECT count(*) INTO v_n FROM public.mcp_tool_calls WHERE id = v_id4;
  INSERT INTO _r VALUES ('contractor_reads_own_project_less_row', v_n = 1);
  SELECT count(*) INTO v_n FROM public.mcp_tool_calls WHERE id = v_id2;
  INSERT INTO _r VALUES ('contractor_does_NOT_read_own_row_on_a_project_they_are_not_on', v_n = 0);
  SELECT count(*) INTO v_n FROM public.mcp_tool_calls WHERE id IN (v_id3, v_id5);
  INSERT INTO _r VALUES ('contractor_does_NOT_read_other_users_rows', v_n = 0);
  SELECT count(*) INTO v_n FROM public.mcp_tool_calls WHERE id IN (v_id1, v_id2, v_id3, v_id4, v_id5);
  INSERT INTO _r VALUES ('contractor_sees_exactly_two_of_the_five', v_n = 2);

  BEGIN
    INSERT INTO public.mcp_tool_calls (user_id, tool, kind, args_digest, outcome, duration_ms)
    VALUES (v_contractor, 'forged', 'read', 'x', 'ok', 1);
    INSERT INTO _r VALUES ('contractor_direct_insert_REFUSED_42501', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('contractor_direct_insert_REFUSED_42501', true);
  END;
  BEGIN
    UPDATE public.mcp_tool_calls SET outcome = 'ok' WHERE id = v_id1;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('contractor_direct_update_REFUSED', v_n = 0);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('contractor_direct_update_REFUSED', true);
  END;
  BEGIN
    DELETE FROM public.mcp_tool_calls WHERE id = v_id1;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('contractor_direct_delete_REFUSED', v_n = 0);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('contractor_direct_delete_REFUSED', true);
  END;
  BEGIN
    PERFORM public.record_mcp_call(v_contractor, 'c', v_org, NULL, 't', 'read', 'd', 'ok', NULL, NULL, 1);
    INSERT INTO _r VALUES ('authenticated_cannot_execute_record_mcp_call', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('authenticated_cannot_execute_record_mcp_call', true);
  END;
  BEGIN
    PERFORM public.mcp_rate_status(v_contractor);
    INSERT INTO _r VALUES ('authenticated_cannot_execute_mcp_rate_status', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('authenticated_cannot_execute_mcp_rate_status', true);
  END;
  RESET ROLE;

  -- ═══ 2. ORG ADMIN — every row of the org, none of another org ══════════
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO _r VALUES ('control_admin_is_org_admin', public.user_is_org_admin(v_org));
  SELECT count(*) INTO v_n FROM public.mcp_tool_calls WHERE id IN (v_id1, v_id2, v_id3, v_id4);
  INSERT INTO _r VALUES ('admin_reads_all_four_org_rows_including_other_users_and_off_project', v_n = 4);
  SELECT count(*) INTO v_n FROM public.mcp_tool_calls WHERE id = v_id5;
  INSERT INTO _r VALUES ('admin_does_NOT_read_a_foreign_orgs_row', v_n = 0);
  BEGIN
    INSERT INTO public.mcp_tool_calls (user_id, organisation_id, tool, kind, args_digest, outcome, duration_ms)
    VALUES (v_admin, v_org, 'forged', 'read', 'x', 'ok', 1);
    INSERT INTO _r VALUES ('admin_direct_insert_REFUSED_42501', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('admin_direct_insert_REFUSED_42501', true);
  END;
  RESET ROLE;

  -- ═══ 3. ANON ════════════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM public.mcp_tool_calls LIMIT 1;
    INSERT INTO _r VALUES ('anon_cannot_select', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_cannot_select', true);
  END;
  BEGIN
    INSERT INTO public.mcp_tool_calls (user_id, tool, kind, args_digest, outcome, duration_ms)
    VALUES (v_contractor, 'forged', 'read', 'x', 'ok', 1);
    INSERT INTO _r VALUES ('anon_cannot_insert', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_cannot_insert', true);
  END;
  BEGIN
    PERFORM public.mcp_rate_status(v_contractor);
    INSERT INTO _r VALUES ('anon_cannot_execute_mcp_rate_status', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_cannot_execute_mcp_rate_status', true);
  END;
  BEGIN
    PERFORM public.record_mcp_call(v_contractor, 'c', v_org, NULL, 't', 'read', 'd', 'ok', NULL, NULL, 1);
    INSERT INTO _r VALUES ('anon_cannot_execute_record_mcp_call', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_cannot_execute_record_mcp_call', true);
  END;
  RESET ROLE;

  -- ═══ 4. GRANTS, read from the catalogue (has_function_privilege, never proacl) ═══
  INSERT INTO _r VALUES ('grants_service_role_only_on_both_functions',
        has_function_privilege('service_role', 'public.record_mcp_call(uuid,text,uuid,uuid,text,text,text,text,text,jsonb,integer)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.mcp_rate_status(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon',          'public.record_mcp_call(uuid,text,uuid,uuid,text,text,text,text,text,jsonb,integer)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.record_mcp_call(uuid,text,uuid,uuid,text,text,text,text,text,jsonb,integer)', 'EXECUTE')
    AND NOT has_function_privilege('anon',          'public.mcp_rate_status(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.mcp_rate_status(uuid)', 'EXECUTE'));

  -- ═══ 5. product_events accepts the new event ═══════════════════════════
  BEGIN
    INSERT INTO public.product_events (organisation_id, event) VALUES (v_org, 'mcp_tool_called');
    INSERT INTO _r VALUES ('product_events_accepts_mcp_tool_called', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('product_events_accepts_mcp_tool_called', false);
  END;
  BEGIN
    INSERT INTO public.product_events (organisation_id, event) VALUES (v_org, 'not_a_real_event');
    INSERT INTO _r VALUES ('product_events_still_refuses_unknown_events', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _r VALUES ('product_events_still_refuses_unknown_events', true);
  END;
  -- The earliest and the latest of the 33 events that were legal before 00257 are still legal.
  BEGIN
    INSERT INTO public.product_events (organisation_id, event) VALUES (v_org, 'rfi_created');
    INSERT INTO public.product_events (organisation_id, event) VALUES (v_org, 'solar_handover_updated');
    INSERT INTO _r VALUES ('product_events_keeps_earlier_events', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('product_events_keeps_earlier_events', false);
  END;
  INSERT INTO _r VALUES ('product_events_check_lists_34_events',
    (SELECT (length(d) - length(replace(d, '::text', ''))) / 6 = 34
       FROM (SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
              WHERE conrelid = 'public.product_events'::regclass AND conname = 'product_events_event_check') c));
END $$;

SELECT * FROM (VALUES
  ('record_mcp_call returns an id for each insert',                                   (SELECT v FROM _r WHERE k='rpc_returns_ids')),
  ('service_role sees all five seeded rows',                                          (SELECT v FROM _r WHERE k='service_role_sees_all_five_rows')),
  ('a bad kind is refused by the CHECK',                                              (SELECT v FROM _r WHERE k='bad_kind_refused')),
  ('a bad outcome is refused by the CHECK',                                           (SELECT v FROM _r WHERE k='bad_outcome_refused')),
  ('mcp_rate_status counts the contractor''s 3 calls',                                 (SELECT v FROM _r WHERE k='rate_status_counts_calls')),
  ('mcp_rate_status writes = preview + write (2)',                                    (SELECT v FROM _r WHERE k='rate_status_writes_are_preview_plus_write')),
  ('mcp_rate_status for a different user counts only theirs (1 call, 0 writes)',      (SELECT v FROM _r WHERE k='rate_status_stranger_one_call_no_writes')),
  ('mcp_rate_status for a user with no rows is 0/0',                                  (SELECT v FROM _r WHERE k='rate_status_unknown_user_is_zero_zero')),
  ('mcp_rate_status window is 60 seconds (a 61 s old row drops out)',                 (SELECT v FROM _r WHERE k='rate_status_window_is_60_seconds')),
  ('CONTROL: contractor has access to the project they are on',                       (SELECT v FROM _r WHERE k='control_contractor_has_access_to_proj_on')),
  ('CONTROL: contractor has no access to the other project in the org',               (SELECT v FROM _r WHERE k='control_contractor_has_NO_access_to_proj_off')),
  ('contractor reads own row on a project they can access',                           (SELECT v FROM _r WHERE k='contractor_reads_own_row_on_accessible_project')),
  ('contractor reads own project-less row',                                           (SELECT v FROM _r WHERE k='contractor_reads_own_project_less_row')),
  ('contractor does NOT read own row on a project they are not on',                   (SELECT v FROM _r WHERE k='contractor_does_NOT_read_own_row_on_a_project_they_are_not_on')),
  ('contractor does NOT read another user''s rows',                                   (SELECT v FROM _r WHERE k='contractor_does_NOT_read_other_users_rows')),
  ('contractor sees exactly 2 of the 5 rows',                                         (SELECT v FROM _r WHERE k='contractor_sees_exactly_two_of_the_five')),
  ('contractor direct INSERT refused 42501',                                          (SELECT v FROM _r WHERE k='contractor_direct_insert_REFUSED_42501')),
  ('contractor direct UPDATE refused',                                                (SELECT v FROM _r WHERE k='contractor_direct_update_REFUSED')),
  ('contractor direct DELETE refused',                                                (SELECT v FROM _r WHERE k='contractor_direct_delete_REFUSED')),
  ('authenticated cannot execute record_mcp_call',                                    (SELECT v FROM _r WHERE k='authenticated_cannot_execute_record_mcp_call')),
  ('authenticated cannot execute mcp_rate_status',                                    (SELECT v FROM _r WHERE k='authenticated_cannot_execute_mcp_rate_status')),
  ('CONTROL: the throwaway admin is an org admin',                                    (SELECT v FROM _r WHERE k='control_admin_is_org_admin')),
  ('org admin reads all 4 rows of the org (other users, off-project)',                (SELECT v FROM _r WHERE k='admin_reads_all_four_org_rows_including_other_users_and_off_project')),
  ('org admin does NOT read a foreign org''s row',                                    (SELECT v FROM _r WHERE k='admin_does_NOT_read_a_foreign_orgs_row')),
  ('org admin direct INSERT refused 42501',                                           (SELECT v FROM _r WHERE k='admin_direct_insert_REFUSED_42501')),
  ('anon cannot select',                                                              (SELECT v FROM _r WHERE k='anon_cannot_select')),
  ('anon cannot insert',                                                              (SELECT v FROM _r WHERE k='anon_cannot_insert')),
  ('anon cannot execute mcp_rate_status',                                             (SELECT v FROM _r WHERE k='anon_cannot_execute_mcp_rate_status')),
  ('anon cannot execute record_mcp_call',                                             (SELECT v FROM _r WHERE k='anon_cannot_execute_record_mcp_call')),
  ('grants: both RPCs executable by service_role only (catalogue check)',             (SELECT v FROM _r WHERE k='grants_service_role_only_on_both_functions')),
  ('product_events accepts mcp_tool_called',                                          (SELECT v FROM _r WHERE k='product_events_accepts_mcp_tool_called')),
  ('product_events still refuses an unknown event',                                   (SELECT v FROM _r WHERE k='product_events_still_refuses_unknown_events')),
  ('product_events still accepts the first and last earlier events',                  (SELECT v FROM _r WHERE k='product_events_keeps_earlier_events')),
  ('product_events check lists 34 events (33 earlier + mcp_tool_called)',             (SELECT v FROM _r WHERE k='product_events_check_lists_34_events'))
) AS t("check", ok);
