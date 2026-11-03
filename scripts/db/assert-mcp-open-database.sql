-- BEHAVIOURAL assertions for the MCP open-database migration (public.mcp_previews, public.mcp_run_select,
-- public.mcp_catalog), run as the real roles.
--
--   scripts/db/dry-run-migration.sh scripts/db/fixtures/noop.sql scripts/db/assert-mcp-open-database.sql   (red first)
--   scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00259_mcp_open_database.sql \
--                                   scripts/db/assert-mcp-open-database.sql                                  (green)
--
-- What is proved, by impersonation, not by reading pg_policy:
--   * mcp_run_select is for owners/admins/PMs only, judged on EVERY active org membership: rbac-test
--     (contractor), a user with no membership, and a user who is admin in WM but contractor elsewhere are all
--     refused with the SQL-role sentence;
--   * it runs as the caller: a throwaway WM org admin gets exactly the structure.nodes count RLS gives them
--     directly (562 of 563: one node sits in a throwaway foreign org), and 0 for that foreign project;
--   * it switches the transaction to read-only itself, so a VOLATILE function called from inside the SELECT
--     cannot write (25006);
--   * the text check refuses a second statement, a non-SELECT, the word list, any reference to the net schema
--     and any U& token with the exact sentence; one trailing ';' is tolerated;
--   * a data-modifying CTE and SELECT … FOR UPDATE are refused by the database; the SQLSTATEs are recorded;
--   * reach beyond the 14 schemas: net (three spellings), vault, auth.users, cron.job, storage.objects;
--   * the 1001-row fetch cap holds, and a statement with its own LIMIT still runs;
--   * EXECUTE: authenticated yes; anon and service_role no (by attempting, and by has_function_privilege);
--   * mcp_catalog: 14 schemas in the fixed order; a schema's tables with columns; a non-exposed schema the role
--     DOES hold grants in (storage) is [];
--   * mcp_previews: a person reads and writes only their own rows; a forged user_id is refused 42501; only
--     consumed_at is updatable; TRUNCATE is refused; anon cannot select.
--
-- ORDER MATTERS: mcp_run_select switches the transaction to read-only (writes to the temp tables stay legal,
-- writes to real tables do not). Every write fixture and every mcp_previews write is in the FIRST DO block;
-- every mcp_run_select check by an authenticated caller is in the SECOND. Measured: each call in BLOCK 2 sits
-- in an EXCEPTION block (a subtransaction), and committing a subtransaction restores the parent's read-write
-- state, so BLOCK 3 makes one call outside any subtransaction to prove the switch persists there.
--
-- Every call into the new objects sits in its own BEGIN … EXCEPTION block, so the red run against noop.sql
-- reports every check false instead of aborting on the first missing object. SET LOCAL ROLE is always issued
-- OUTSIDE those blocks: an exception rolls the block's subtransaction back, which would also undo a role
-- switch made inside it.
--
-- Impersonation mechanics this project has already paid for:
--   * set_config('request.jwt.claims', …, true) is TRANSACTION-local and outlives RESET ROLE, so every
--     fixture is seeded BEFORE the first SET LOCAL ROLE and the claim is re-set per identity.

CREATE TEMP TABLE _r (k text, v boolean, note text) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;
CREATE TEMP TABLE _f (k text PRIMARY KEY, u uuid, n bigint) ON COMMIT DROP;
GRANT ALL ON _f TO authenticated, anon, service_role;

-- A VOLATILE writer, called later from inside a SELECT through mcp_run_select. Without the read-only
-- transaction it would insert as the caller (the STABLE SPI mode does not reach into a VOLATILE callee).
CREATE FUNCTION pg_temp.writer() RETURNS int LANGUAGE plpgsql VOLATILE AS $w$
BEGIN
  INSERT INTO public.mcp_previews (tool, args_digest, would_affect) VALUES ('t', 'd', 0);
  RETURN 1;
END
$w$;
GRANT EXECUTE ON FUNCTION pg_temp.writer() TO authenticated;

-- ═════════════════ BLOCK 1: fixtures and every write (before any successful mcp_run_select) ═════════════════
DO $$
DECLARE
  c_sql_role    CONSTANT text := 'SQL is for owners, admins and project managers; use esite_db_select.';
  v_contractor  UUID := '018f2d31-bbe8-4cc1-bbdd-63af0187081e';
  v_other       UUID := gen_random_uuid();   -- signed in, no memberships at all
  v_admin       UUID := gen_random_uuid();   -- active admin in WM only
  v_mixed       UUID := gen_random_uuid();   -- admin in WM AND contractor in the throwaway org
  v_org         UUID;
  v_zz_org      UUID := gen_random_uuid();   -- throwaway foreign org
  v_zz_proj     UUID := gen_random_uuid();   -- throwaway project in it, with one node
  v_proj_on     UUID;
  v_total       BIGINT;
  v_res         JSONB;
  v_pid         UUID;   -- the contractor's preview that must stay untouched
  v_pid2        UUID;   -- the contractor's count-only preview, consumed by the owner
  v_n           INT;
  v_state       TEXT;
  v_msg         TEXT;
  v_case        RECORD;
BEGIN
  -- ── Fixtures ────────────────────────────────────────────────────────────
  SELECT pm.project_id, pm.organisation_id INTO v_proj_on, v_org
    FROM projects.project_members pm
    JOIN projects.projects p ON p.id = pm.project_id
   WHERE pm.user_id = v_contractor AND pm.is_active
   ORDER BY (p.name ILIKE '%KINGSWALK%') DESC, p.name
   LIMIT 1;
  IF v_proj_on IS NULL THEN RAISE EXCEPTION 'rbac-test contractor has no active project membership'; END IF;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  SELECT u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         u.email, '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb
    FROM (VALUES (v_other, 'probe-mcp-open-db-other@example.invalid'),
                 (v_admin, 'probe-mcp-open-db-admin@example.invalid'),
                 (v_mixed, 'probe-mcp-open-db-mixed@example.invalid')) AS u(id, email);

  -- The throwaway foreign org, with one project and one node the WM admin must not see.
  INSERT INTO public.organisations (id, name, slug) VALUES (v_zz_org, 'ZZ MCP probe org', 'zz-mcp-probe-' || left(v_zz_org::text, 8));
  INSERT INTO projects.projects (id, organisation_id, name, created_by, code)
  VALUES (v_zz_proj, v_zz_org, 'ZZ MCP probe project', v_contractor, 'ZZMCP');
  INSERT INTO structure.nodes (project_id, organisation_id, kind, code) VALUES (v_zz_proj, v_zz_org, 'main_board', 'ZZ-MB');

  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
    (v_admin, v_org,    'admin',      TRUE),
    (v_mixed, v_org,    'admin',      TRUE),
    (v_mixed, v_zz_org, 'contractor', TRUE);

  SELECT count(*) INTO v_total FROM structure.nodes;
  SELECT count(*) INTO v_n FROM structure.nodes WHERE project_id = v_zz_proj;
  INSERT INTO _r VALUES ('control_foreign_project_has_a_node', v_n = 1, v_n::text);

  INSERT INTO _f (k, u, n) VALUES ('contractor', v_contractor, NULL), ('admin', v_admin, NULL),
                                  ('zz_proj', v_zz_proj, NULL), ('total', NULL, v_total);

  -- ── 9. EXECUTE grants, read through has_function_privilege (never proacl) ──
  BEGIN
    INSERT INTO _r VALUES ('hfp_anon_no_execute',
      NOT has_function_privilege('anon', 'public.mcp_run_select(text)', 'EXECUTE'), NULL);
    INSERT INTO _r VALUES ('hfp_authenticated_execute',
      has_function_privilege('authenticated', 'public.mcp_run_select(text)', 'EXECUTE'), NULL);
    INSERT INTO _r VALUES ('hfp_service_role_no_execute',
      NOT has_function_privilege('service_role', 'public.mcp_run_select(text)', 'EXECUTE'), NULL);
    INSERT INTO _r VALUES ('hfp_catalog_anon_no_authenticated_yes_service_no',
      NOT has_function_privilege('anon', 'public.mcp_catalog(text)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.mcp_catalog(text)', 'EXECUTE')
      AND NOT has_function_privilege('service_role', 'public.mcp_catalog(text)', 'EXECUTE'), NULL);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    INSERT INTO _r VALUES ('hfp_anon_no_execute', false, v_state), ('hfp_authenticated_execute', false, v_state),
                          ('hfp_service_role_no_execute', false, v_state),
                          ('hfp_catalog_anon_no_authenticated_yes_service_no', false, v_state);
  END;

  -- ═══ RBAC-TEST: previews writes + catalogue + the SQL role gate ═════════
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_contractor::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- The SQL role gate refuses a contractor (refused before the read-only switch, so nothing changes).
  BEGIN
    v_res := public.mcp_run_select('select 1 as x');
    INSERT INTO _r VALUES ('sql_gate_refuses_contractor', false, 'returned ' || coalesce(v_res::text, 'NULL'));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('sql_gate_refuses_contractor', v_state = 'P0001' AND v_msg = c_sql_role, v_state || ' ' || v_msg);
  END;

  -- 11. Insert own row (defaults fill user_id), read it back.
  BEGIN
    INSERT INTO public.mcp_previews (tool, args_digest, matched_ids, would_affect)
    VALUES ('esite_db_update', 'digest-1', '["a","b"]'::jsonb, 2)
    RETURNING id INTO v_pid;
    SELECT count(*) INTO v_n FROM public.mcp_previews WHERE id = v_pid AND user_id = v_contractor;
    INSERT INTO _r VALUES ('previews_own_insert_defaults_user_and_reads_back', v_n = 1, v_n::text);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('previews_own_insert_defaults_user_and_reads_back', false, v_state || ' ' || v_msg);
  END;
  -- A count-only preview (matched_ids NULL) is allowed.
  BEGIN
    INSERT INTO public.mcp_previews (tool, args_digest, matched_ids, would_affect)
    VALUES ('esite_db_delete', 'digest-2', NULL, 7)
    RETURNING id INTO v_pid2;
    INSERT INTO _r VALUES ('previews_count_only_allowed', v_pid2 IS NOT NULL, NULL);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('previews_count_only_allowed', false, v_state || ' ' || v_msg);
  END;
  -- The owner may set consumed_at …
  BEGIN
    UPDATE public.mcp_previews SET consumed_at = now() WHERE id = v_pid2;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('previews_owner_updates_consumed_at', v_n = 1, v_n::text);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('previews_owner_updates_consumed_at', false, v_state || ' ' || v_msg);
  END;
  -- … and nothing else (column grant).
  BEGIN
    UPDATE public.mcp_previews SET created_at = now() WHERE id = v_pid;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('previews_owner_update_created_at_42501', false, 'updated ' || v_n::text);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('previews_owner_update_created_at_42501', v_state = '42501', v_state || ' ' || v_msg);
  END;
  -- A forged user_id is refused by WITH CHECK.
  BEGIN
    INSERT INTO public.mcp_previews (user_id, tool, args_digest, matched_ids, would_affect)
    VALUES (v_other, 'esite_db_update', 'forged', '[]'::jsonb, 0);
    INSERT INTO _r VALUES ('previews_forged_user_refused_42501', false, 'inserted');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('previews_forged_user_refused_42501', v_state = '42501', v_state || ' ' || v_msg);
  END;
  -- TRUNCATE ignores RLS, so authenticated must not hold it (Supabase's default privileges grant it).
  BEGIN
    TRUNCATE public.mcp_previews;
    INSERT INTO _r VALUES ('previews_truncate_refused_42501', false, 'truncated');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('previews_truncate_refused_42501', v_state = '42501', v_state || ' ' || v_msg);
  END;

  -- 10. The catalogue, as the contractor (mcp_catalog has no role gate: it lists names, not rows).
  BEGIN
    v_res := public.mcp_catalog();
    INSERT INTO _r VALUES ('catalog_lists_14_schemas_in_order',
      (SELECT array_agg(e->>'schema' ORDER BY o) FROM jsonb_array_elements(v_res) WITH ORDINALITY AS x(e, o))
        = ARRAY['public','projects','inspections','field','tenants','suppliers','billing','marketplace',
                'cable_schedule','structure','gcr','solar','tariffs','whatsapp']
      AND (SELECT bool_and(jsonb_typeof(e->'tables') = 'number') FROM jsonb_array_elements(v_res) e),
      v_res::text);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('catalog_lists_14_schemas_in_order', false, v_state || ' ' || v_msg);
  END;
  BEGIN
    v_res := public.mcp_catalog('inspections');
    INSERT INTO _r VALUES ('catalog_inspections_has_responses_value_text',
      EXISTS (SELECT 1 FROM jsonb_array_elements(v_res) t, jsonb_array_elements(t->'columns') c
               WHERE t->>'table' = 'responses' AND t->>'kind' = 'table'
                 AND c->>'name' = 'value_text' AND c->>'type' = 'text'
                 AND jsonb_typeof(c->'nullable') = 'boolean' AND c ? 'default'),
      (SELECT string_agg(t->>'table', ',') FROM jsonb_array_elements(v_res) t));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('catalog_inspections_has_responses_value_text', false, v_state || ' ' || v_msg);
  END;
  -- storage is NOT exposed, yet authenticated holds grants there: only the exposed-list gate makes this [].
  INSERT INTO _r VALUES ('control_contractor_can_see_storage_in_information_schema',
    (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'storage') > 0,
    (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'storage')::text);
  BEGIN
    v_res := public.mcp_catalog('storage');
    INSERT INTO _r VALUES ('catalog_unexposed_schema_is_empty', v_res = '[]'::jsonb,
                           left(coalesce(v_res::text, 'NULL'), 120));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('catalog_unexposed_schema_is_empty', false, v_state || ' ' || v_msg);
  END;
  RESET ROLE;

  -- ═══ THE MIXED USER: admin in WM, contractor in the throwaway org → refused ═══
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_mixed::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('control_mixed_user_reads_both_memberships',
    (SELECT count(*) FROM public.user_organisations WHERE user_id = auth.uid() AND is_active) = 2, NULL);
  BEGIN
    v_res := public.mcp_run_select('select 1 as x');
    INSERT INTO _r VALUES ('sql_gate_refuses_admin_who_is_contractor_elsewhere', false, 'returned ' || coalesce(v_res::text, 'NULL'));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('sql_gate_refuses_admin_who_is_contractor_elsewhere', v_state = 'P0001' AND v_msg = c_sql_role, v_state || ' ' || v_msg);
  END;
  RESET ROLE;

  -- ═══ THE SECOND USER (no memberships): previews isolation + SQL gate ════
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_res := public.mcp_run_select('select 1 as x');
    INSERT INTO _r VALUES ('sql_gate_refuses_user_without_membership', false, 'returned ' || coalesce(v_res::text, 'NULL'));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('sql_gate_refuses_user_without_membership', v_state = 'P0001' AND v_msg = c_sql_role, v_state || ' ' || v_msg);
  END;
  BEGIN
    SELECT count(*) INTO v_n FROM public.mcp_previews;
    INSERT INTO _r VALUES ('previews_other_user_reads_zero', v_n = 0 AND v_pid IS NOT NULL, v_n::text);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('previews_other_user_reads_zero', false, v_state || ' ' || v_msg);
  END;
  BEGIN
    UPDATE public.mcp_previews SET consumed_at = now() WHERE id = v_pid;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('previews_other_user_update_affects_zero', v_n = 0 AND v_pid IS NOT NULL, v_n::text);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('previews_other_user_update_affects_zero', false, v_state || ' ' || v_msg);
  END;
  BEGIN
    DELETE FROM public.mcp_previews WHERE id = v_pid;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('previews_other_user_delete_affects_zero', v_n = 0 AND v_pid IS NOT NULL, v_n::text);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('previews_other_user_delete_affects_zero', false, v_state || ' ' || v_msg);
  END;
  RESET ROLE;

  -- The row really is untouched, and the consumed one really is consumed (read as postgres).
  BEGIN
    SELECT count(*) INTO v_n FROM public.mcp_previews WHERE id = v_pid AND consumed_at IS NULL;
    INSERT INTO _r VALUES ('previews_first_row_untouched', v_n = 1, v_n::text);
    SELECT count(*) INTO v_n FROM public.mcp_previews WHERE id = v_pid2 AND consumed_at IS NOT NULL;
    INSERT INTO _r VALUES ('previews_consumed_row_is_consumed', v_n = 1, v_n::text);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('previews_first_row_untouched', false, v_state || ' ' || v_msg),
                          ('previews_consumed_row_is_consumed', false, v_state || ' ' || v_msg);
  END;

  -- ═══ 12. ANON ═══════════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*) INTO v_n FROM public.mcp_previews;
    INSERT INTO _r VALUES ('anon_select_previews_42501', false, 'selected ' || v_n::text);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('anon_select_previews_42501', v_state = '42501', v_state || ' ' || v_msg);
  END;
  BEGIN
    v_res := public.mcp_run_select('select 1 as x');
    INSERT INTO _r VALUES ('anon_execute_run_select_42501', false, 'returned ' || coalesce(v_res::text, 'NULL'));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('anon_execute_run_select_42501', v_state = '42501', v_state || ' ' || v_msg);
  END;
  BEGIN
    v_res := public.mcp_catalog();
    INSERT INTO _r VALUES ('anon_execute_catalog_42501', false, 'returned ' || coalesce(v_res::text, 'NULL'));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('anon_execute_catalog_42501', v_state = '42501', v_state || ' ' || v_msg);
  END;
  RESET ROLE;

  -- ═══ SERVICE ROLE: not granted EXECUTE (the tool runs as the person) ════
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  SET LOCAL ROLE service_role;
  BEGIN
    v_res := public.mcp_run_select('select 1 as x');
    INSERT INTO _r VALUES ('service_role_execute_run_select_42501', false, 'returned ' || coalesce(v_res::text, 'NULL'));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('service_role_execute_run_select_42501', v_state = '42501', v_state || ' ' || v_msg);
  END;
  RESET ROLE;
END $$;

-- ═════════════════ BLOCK 2: mcp_run_select as the throwaway WM admin ═════════════════
DO $$
DECLARE
  c_sentence    CONSTANT text := 'Only one read-only SELECT is allowed here.';
  v_admin       UUID := (SELECT u FROM _f WHERE k = 'admin');
  v_zz_proj     UUID := (SELECT u FROM _f WHERE k = 'zz_proj');
  v_total       BIGINT := (SELECT n FROM _f WHERE k = 'total');
  v_direct      BIGINT;
  v_storage     BIGINT;
  v_res         JSONB;
  v_state       TEXT;
  v_msg         TEXT;
  v_case        RECORD;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_direct FROM structure.nodes;
  INSERT INTO _r VALUES ('control_rls_filters_nodes_for_admin', v_direct > 0 AND v_direct < v_total,
                         v_direct::text || ' of ' || v_total::text);
  INSERT INTO _r VALUES ('control_admin_has_no_access_to_foreign_project',
                         NOT public.user_has_project_access(v_zz_proj), NULL);
  INSERT INTO _r VALUES ('control_transaction_read_write_before_first_call',
                         current_setting('transaction_read_only') = 'off', current_setting('transaction_read_only'));
  SELECT count(*) INTO v_storage FROM storage.objects;

  -- 1. RLS applies identically through the function.
  BEGIN
    v_res := public.mcp_run_select('select count(*) as n from structure.nodes');
    INSERT INTO _r VALUES ('run_select_count_matches_direct', (v_res->0->>'n')::bigint = v_direct, v_res::text);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('run_select_count_matches_direct', false, v_state || ' ' || v_msg);
  END;

  -- 1a. The statement runs in a read-only transaction. (Measured DURING the call: each call in this block
  --     sits in an EXCEPTION block, a subtransaction, whose commit restores the parent's read-write state;
  --     after-the-call is checked in BLOCK 3, outside any subtransaction.)
  BEGIN
    v_res := public.mcp_run_select('select current_setting(''transaction_read_only'') as ro');
    INSERT INTO _r VALUES ('transaction_read_only_during_call', v_res = '[{"ro":"on"}]'::jsonb, v_res::text);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('transaction_read_only_during_call', false, v_state || ' ' || v_msg);
  END;

  -- 1b. A VOLATILE function called from inside the SELECT cannot write.
  BEGIN
    v_res := public.mcp_run_select('select pg_temp.writer() as w');
    INSERT INTO _r VALUES ('refuse_volatile_writer_25006', false, 'returned ' || coalesce(v_res::text, 'NULL'));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('refuse_volatile_writer_25006', v_state = '25006', v_state || ' ' || v_msg);
  END;

  -- 2. A project in an org the admin is not in returns 0.
  BEGIN
    v_res := public.mcp_run_select(format('select count(*) as n from structure.nodes where project_id = %L', v_zz_proj));
    INSERT INTO _r VALUES ('run_select_foreign_project_is_zero', v_res = '[{"n":0}]'::jsonb, v_res::text);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('run_select_foreign_project_is_zero', false, v_state || ' ' || v_msg);
  END;

  -- Positive cases: (key, sql, expected jsonb, or NULL to compare the length to 1001).
  FOR v_case IN SELECT * FROM (VALUES
      ('run_select_strips_line_comment',    '-- note' || E'\n' || 'select 1 as x',   '[{"x":1}]'),
      ('run_select_strips_block_comment',   '/* a' || E'\n' || 'b */ select 2 as y', '[{"y":2}]'),
      ('run_select_accepts_own_limit',      'select g from generate_series(1, 10) g order by g desc limit 3',
                                                                                     '[{"g":10},{"g":9},{"g":8}]'),
      ('run_select_empty_is_empty_array',   'select 1 as x where false',             '[]'),
      ('run_select_one_trailing_semicolon', 'select 1 as x ; ',                      '[{"x":1}]'),
      ('run_select_column_named_copy',      'select 1 as copy',                      '[{"copy":1}]'),
      ('run_select_caps_at_1001_rows',      'select g from generate_series(1, 2000) g', NULL)
    ) AS c(k, q, expected)
  LOOP
    BEGIN
      v_res := public.mcp_run_select(v_case.q);
      INSERT INTO _r VALUES (v_case.k,
        CASE WHEN v_case.expected IS NULL THEN jsonb_array_length(v_res) = 1001
             ELSE v_res = v_case.expected::jsonb END,
        CASE WHEN v_case.expected IS NULL THEN jsonb_array_length(v_res)::text ELSE v_res::text END);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
      INSERT INTO _r VALUES (v_case.k, false, v_state || ' ' || v_msg);
    END;
  END LOOP;

  -- Refusals by the text check: P0001 and the exact sentence.
  FOR v_case IN SELECT * FROM (VALUES
      ('refuse_two_statements',     'select 1; select 2'),
      ('refuse_two_trailing_semis', 'select 1 as x;;'),
      ('refuse_delete',             'delete from public.mcp_previews'),
      ('refuse_pg_sleep',           'select pg_sleep(20)'),
      ('refuse_pg_sleep_for',       'select pg_sleep_for(''20 seconds'')'),
      ('refuse_set_config',         'select set_config(''x.y'',''1'',true)'),
      ('refuse_advisory_lock',      'select pg_advisory_lock(1)'),
      ('refuse_read_file',          'select pg_read_file(''/etc/hostname'')'),
      ('refuse_terminate_backend',  'select pg_terminate_backend(1)'),
      ('refuse_query_to_xml',       'select query_to_xml(''select count(*) from ne'' || ''t._http_response'', true, false, '''')'),
      ('reach_net_http_response',   'select count(*) as n from net._http_response'),
      ('reach_net_quoted_queue',    'select count(*) as n from "net"."http_request_queue"'),
      ('reach_net_unicode_escape',  'select count(*) as n from U&"\006eet"."_http_response"')
    ) AS c(k, q)
  LOOP
    BEGIN
      v_res := public.mcp_run_select(v_case.q);
      INSERT INTO _r VALUES (v_case.k, false, 'returned ' || coalesce(v_res::text, 'NULL'));
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
      INSERT INTO _r VALUES (v_case.k, v_state = 'P0001' AND v_msg = c_sentence, v_state || ' ' || v_msg);
    END;
  END LOOP;

  -- Refusals by the database: record the SQLSTATE.
  BEGIN
    v_res := public.mcp_run_select('with d as (delete from public.mcp_previews returning id) select count(*) from d');
    INSERT INTO _r VALUES ('refuse_cte_delete', false, 'returned ' || coalesce(v_res::text, 'NULL'));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('refuse_cte_delete', v_state IN ('25006', '0A000'), v_state || ' ' || v_msg);
  END;
  BEGIN
    v_res := public.mcp_run_select('select id from public.mcp_previews for update');
    INSERT INTO _r VALUES ('refuse_select_for_update', false, 'returned ' || coalesce(v_res::text, 'NULL'));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('refuse_select_for_update', v_state IN ('25006', '0A000'), v_state || ' ' || v_msg);
  END;

  -- Reach beyond the 14 schemas: refused 42501 (cron.job: 42501 or 0 rows).
  FOR v_case IN SELECT * FROM (VALUES
      ('reach_vault_decrypted_secrets', 'select count(*) as n from vault.decrypted_secrets', false),
      ('reach_auth_users',              'select count(*) as n from auth.users',              false),
      ('reach_cron_job',                'select count(*) as n from cron.job',                true)
    ) AS c(k, q, zero_ok)
  LOOP
    BEGIN
      v_res := public.mcp_run_select(v_case.q);
      INSERT INTO _r VALUES (v_case.k, v_case.zero_ok AND v_res = '[{"n":0}]'::jsonb, 'READABLE ' || v_res::text);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
      INSERT INTO _r VALUES (v_case.k, v_state = '42501', v_state || ' ' || v_msg);
    END;
  END LOOP;
  BEGIN
    v_res := public.mcp_run_select('select count(*) as n from storage.objects');
    INSERT INTO _r VALUES ('reach_storage_objects_same_as_direct', (v_res->0->>'n')::bigint = v_storage,
                           v_res::text || ' direct ' || v_storage::text);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('reach_storage_objects_same_as_direct', false, v_state || ' ' || v_msg);
  END;
  RESET ROLE;
END $$;

-- ═════════════════ BLOCK 3: one call OUTSIDE any subtransaction (PostgREST's shape) ═════════════════
-- No EXCEPTION block here, so the read-only switch is not undone by a subtransaction commit. The guard on
-- to_regprocedure keeps the red run reporting a false check instead of aborting the file.
DO $$
DECLARE
  v_res    JSONB;
  v_before TEXT := current_setting('transaction_read_only');
BEGIN
  IF to_regprocedure('public.mcp_run_select(text)') IS NULL THEN
    INSERT INTO _r VALUES ('transaction_read_only_after_call', false, 'mcp_run_select(text) does not exist');
  ELSE
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', (SELECT u FROM _f WHERE k = 'admin')::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_res := public.mcp_run_select('select 1 as x');
    RESET ROLE;
    INSERT INTO _r VALUES ('transaction_read_only_after_call',
      v_before = 'off' AND current_setting('transaction_read_only') = 'on',
      'before ' || v_before || ', after ' || current_setting('transaction_read_only'));
  END IF;
END $$;

SELECT t."check" || coalesce('  [' || r.note || ']', '') AS "check", coalesce(r.v, false) AS ok
  FROM (SELECT v.*, row_number() OVER () AS ord FROM (VALUES
    ('control_foreign_project_has_a_node',               'CONTROL: the throwaway foreign project has 1 structure.nodes row (postgres)'),
    ('control_rls_filters_nodes_for_admin',              'CONTROL: RLS gives the WM admin some but not all structure.nodes'),
    ('control_admin_has_no_access_to_foreign_project',   'CONTROL: the WM admin has no access to the foreign project'),
    ('control_mixed_user_reads_both_memberships',        'CONTROL: the mixed user reads both own memberships (invoker self-read works)'),
    ('control_transaction_read_write_before_first_call', 'CONTROL: the transaction is read-write before the first successful mcp_run_select'),
    ('sql_gate_refuses_contractor',                      'G1. rbac-test (contractor) is refused: P0001 + the SQL-role sentence'),
    ('sql_gate_refuses_user_without_membership',         'G2. a user with no membership is refused: P0001 + the SQL-role sentence'),
    ('sql_gate_refuses_admin_who_is_contractor_elsewhere','G3. admin in WM + contractor elsewhere is refused (every membership counts)'),
    ('run_select_count_matches_direct',                  '1. admin: run_select count(*) on structure.nodes = the admin''s direct count'),
    ('transaction_read_only_during_call',                '1a. the statement runs in a read-only transaction (current_setting inside the call = on)'),
    ('transaction_read_only_after_call',                 '1a′. called outside a subtransaction, the transaction stays read-only after the call'),
    ('refuse_volatile_writer_25006',                     '1b. a VOLATILE writer called inside the SELECT is refused 25006'),
    ('run_select_foreign_project_is_zero',               '2. admin: run_select on a project in another org = [{"n":0}]'),
    ('run_select_strips_line_comment',                   '3. a leading -- comment is stripped: [{"x":1}]'),
    ('run_select_strips_block_comment',                  '3b. a /* */ comment is stripped: [{"y":2}]'),
    ('run_select_caps_at_1001_rows',                     '3c. 2000 rows come back as 1001'),
    ('run_select_accepts_own_limit',                     '3d. a statement with its own ORDER BY … LIMIT 3 runs, order kept'),
    ('run_select_empty_is_empty_array',                  '3e. no rows = []'),
    ('run_select_one_trailing_semicolon',                '3f. one trailing ";" is tolerated: "select 1 as x ; "'),
    ('run_select_column_named_copy',                     '3g. a column named copy is allowed'),
    ('refuse_two_statements',                            '4. "select 1; select 2" refused: P0001 + the sentence'),
    ('refuse_two_trailing_semis',                        '4b. "select 1 as x;;" refused: P0001 + the sentence'),
    ('refuse_delete',                                    '5. "delete from …" refused: P0001 + the sentence'),
    ('refuse_cte_delete',                                '6. a data-modifying CTE is refused by the database (25006 or 0A000)'),
    ('refuse_select_for_update',                         '6b. SELECT … FOR UPDATE is refused by the database (25006 or 0A000)'),
    ('refuse_pg_sleep',                                  '7. pg_sleep refused: P0001 + the sentence'),
    ('refuse_pg_sleep_for',                              '7b. pg_sleep_for refused: P0001 + the sentence'),
    ('refuse_set_config',                                '8. set_config refused: P0001 + the sentence'),
    ('refuse_advisory_lock',                             '8b. pg_advisory_lock refused: P0001 + the sentence'),
    ('refuse_read_file',                                 '8c. pg_read_file refused: P0001 + the sentence'),
    ('refuse_terminate_backend',                         '8d. pg_terminate_backend refused: P0001 + the sentence'),
    ('refuse_query_to_xml',                              '8e. query_to_xml (runs SQL from a string, spells net around the regex) refused'),
    ('hfp_anon_no_execute',                              '9. has_function_privilege anon EXECUTE mcp_run_select = false'),
    ('hfp_authenticated_execute',                        '9. has_function_privilege authenticated EXECUTE mcp_run_select = true'),
    ('hfp_service_role_no_execute',                      '9. has_function_privilege service_role EXECUTE mcp_run_select = false'),
    ('hfp_catalog_anon_no_authenticated_yes_service_no', '9. mcp_catalog EXECUTE: anon no, authenticated yes, service_role no'),
    ('anon_execute_run_select_42501',                    '9. anon calling mcp_run_select is refused 42501'),
    ('anon_execute_catalog_42501',                       '9. anon calling mcp_catalog is refused 42501'),
    ('service_role_execute_run_select_42501',            '9. service_role calling mcp_run_select is refused 42501'),
    ('catalog_lists_14_schemas_in_order',                '10. mcp_catalog() = the 14 schemas in order, each with a numeric table count'),
    ('catalog_inspections_has_responses_value_text',     '10. mcp_catalog(''inspections'') lists table responses with column value_text (text)'),
    ('control_contractor_can_see_storage_in_information_schema', 'CONTROL: storage tables are visible to the contractor in information_schema'),
    ('catalog_unexposed_schema_is_empty',                '10. mcp_catalog(''storage'') = [] (not exposed, though granted)'),
    ('previews_own_insert_defaults_user_and_reads_back', '11. contractor inserts a preview (user_id defaulted) and reads it back'),
    ('previews_count_only_allowed',                      '11. a count-only preview (matched_ids NULL) is allowed'),
    ('previews_owner_updates_consumed_at',               '11. the owner can set consumed_at (1 row)'),
    ('previews_owner_update_created_at_42501',           '11. the owner updating created_at is refused 42501 (column grant)'),
    ('previews_forged_user_refused_42501',               '11. contractor inserting a preview for another user is refused 42501'),
    ('previews_truncate_refused_42501',                  '11. contractor TRUNCATE of mcp_previews is refused 42501 (TRUNCATE ignores RLS)'),
    ('previews_other_user_reads_zero',                   '11. the second user reads 0 previews'),
    ('previews_other_user_update_affects_zero',          '11. the second user''s UPDATE of the first user''s preview affects 0 rows'),
    ('previews_other_user_delete_affects_zero',          '11. the second user''s DELETE of the first user''s preview affects 0 rows'),
    ('previews_first_row_untouched',                     '11. the first user''s preview is still there and unconsumed'),
    ('previews_consumed_row_is_consumed',                '11. the consumed preview has consumed_at set'),
    ('anon_select_previews_42501',                       '12. anon SELECT on mcp_previews is refused 42501'),
    ('reach_net_http_response',                          'R4. admin: net._http_response refused by the text check (P0001)'),
    ('reach_net_quoted_queue',                           'R5. admin: "net"."http_request_queue" refused by the text check (P0001)'),
    ('reach_net_unicode_escape',                         'R5b. admin: U&"\006eet"."_http_response" (spells net) refused by the text check (P0001)'),
    ('reach_vault_decrypted_secrets',                    'R1. admin: vault.decrypted_secrets refused 42501'),
    ('reach_auth_users',                                 'R2. admin: auth.users refused 42501'),
    ('reach_cron_job',                                   'R3. admin: cron.job refused 42501 or 0 rows'),
    ('reach_storage_objects_same_as_direct',             'R6. admin: run_select count on storage.objects = the admin''s direct count (RLS)')
  ) AS v(k, "check")) t
  LEFT JOIN _r r ON r.k = t.k
 ORDER BY t.ord;
