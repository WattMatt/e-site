-- BEHAVIOURAL assertions for the MCP open-database migration (public.mcp_previews, public.mcp_run_select,
-- public.mcp_catalog), run as the real roles.
--
--   scripts/db/dry-run-migration.sh scripts/db/fixtures/noop.sql scripts/db/assert-mcp-open-database.sql   (red first)
--   scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00259_mcp_open_database.sql \
--                                   scripts/db/assert-mcp-open-database.sql                                  (green)
--
-- What is proved, by impersonation, not by reading pg_policy:
--   * mcp_run_select runs as the caller: rbac-test (contractor on KINGSWALK) gets exactly the structure.nodes
--     count RLS gives them directly, and 0 for a project they are not on;
--   * the text check refuses a second statement, a non-SELECT, pg_sleep and set_config with the exact sentence;
--   * a data-modifying CTE (which passes the text check) is refused by the database; the SQLSTATE is recorded;
--   * the 1001-row fetch cap holds, and a statement with its own LIMIT still runs;
--   * EXECUTE: authenticated yes; anon and service_role no (by attempting, and by has_function_privilege);
--   * mcp_catalog: 14 schemas in the fixed order; a schema's tables with columns; any other name is [];
--   * mcp_previews: a person reads and writes only their own rows; a forged user_id is refused 42501;
--     anon cannot select.
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

DO $$
DECLARE
  c_sentence    CONSTANT text := 'Only one read-only SELECT is allowed here.';
  v_contractor  UUID := '018f2d31-bbe8-4cc1-bbdd-63af0187081e';
  v_other       UUID := gen_random_uuid();
  v_org         UUID;
  v_proj_on     UUID;   -- a project the contractor is on
  v_proj_off    UUID;   -- a project in the same org the contractor is NOT on (with nodes)
  v_total       BIGINT; -- every structure.nodes row (postgres, BYPASSRLS)
  v_off_total   BIGINT; -- structure.nodes rows on v_proj_off (postgres)
  v_direct      BIGINT; -- what the contractor reads directly
  v_res         JSONB;
  v_pid         UUID;
  v_n           INT;
  v_state       TEXT;
  v_msg         TEXT;
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
   ORDER BY (SELECT count(*) FROM structure.nodes n WHERE n.project_id = p.id) DESC, p.id
   LIMIT 1;
  IF v_proj_off IS NULL THEN RAISE EXCEPTION 'no project in the org that the contractor is not on'; END IF;

  SELECT count(*) INTO v_total FROM structure.nodes;
  SELECT count(*) INTO v_off_total FROM structure.nodes WHERE project_id = v_proj_off;
  INSERT INTO _r VALUES ('control_off_project_has_nodes', v_off_total > 0, v_off_total::text);

  -- A throwaway second signed-in user with no memberships at all.
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  VALUES (v_other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'probe-mcp-open-db@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

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

  -- ═══ RBAC-TEST (contractor on KINGSWALK) ════════════════════════════════
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_contractor::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_direct FROM structure.nodes;
  INSERT INTO _r VALUES ('control_rls_filters_nodes_for_contractor', v_direct > 0 AND v_direct < v_total,
                         v_direct::text || ' of ' || v_total::text);
  INSERT INTO _r VALUES ('control_contractor_has_no_access_to_proj_off',
                         NOT public.user_has_project_access(v_proj_off), NULL);

  -- 1. RLS applies identically through the function.
  BEGIN
    v_res := public.mcp_run_select('select count(*) as n from structure.nodes');
    INSERT INTO _r VALUES ('run_select_count_matches_direct', (v_res->0->>'n')::bigint = v_direct, v_res::text);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('run_select_count_matches_direct', false, v_state || ' ' || v_msg);
  END;

  -- 2. A project the contractor is not on returns 0.
  BEGIN
    v_res := public.mcp_run_select(format('select count(*) as n from structure.nodes where project_id = %L', v_proj_off));
    INSERT INTO _r VALUES ('run_select_off_project_is_zero', v_res = '[{"n":0}]'::jsonb, v_res::text);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('run_select_off_project_is_zero', false, v_state || ' ' || v_msg);
  END;

  -- 3. A leading line comment is stripped.
  BEGIN
    v_res := public.mcp_run_select('-- note' || E'\n' || 'select 1 as x');
    INSERT INTO _r VALUES ('run_select_strips_line_comment', v_res = '[{"x":1}]'::jsonb, v_res::text);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('run_select_strips_line_comment', false, v_state || ' ' || v_msg);
  END;

  -- 3b. A block comment is stripped too.
  BEGIN
    v_res := public.mcp_run_select('/* a' || E'\n' || 'b */ select 2 as y');
    INSERT INTO _r VALUES ('run_select_strips_block_comment', v_res = '[{"y":2}]'::jsonb, v_res::text);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('run_select_strips_block_comment', false, v_state || ' ' || v_msg);
  END;

  -- 3c. The fetch cap is 1001 rows (the tool returns 1000 and flags truncation).
  BEGIN
    v_res := public.mcp_run_select('select g from generate_series(1, 2000) g');
    INSERT INTO _r VALUES ('run_select_caps_at_1001_rows', jsonb_array_length(v_res) = 1001,
                           jsonb_array_length(v_res)::text);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('run_select_caps_at_1001_rows', false, v_state || ' ' || v_msg);
  END;

  -- 3d. A statement carrying its own ORDER BY … LIMIT still runs (and keeps its order).
  BEGIN
    v_res := public.mcp_run_select('select g from generate_series(1, 10) g order by g desc limit 3');
    INSERT INTO _r VALUES ('run_select_accepts_own_limit', v_res = '[{"g":10},{"g":9},{"g":8}]'::jsonb, v_res::text);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('run_select_accepts_own_limit', false, v_state || ' ' || v_msg);
  END;

  -- 3e. Nothing selected is an empty array, not NULL.
  BEGIN
    v_res := public.mcp_run_select('select 1 as x where false');
    INSERT INTO _r VALUES ('run_select_empty_is_empty_array', v_res = '[]'::jsonb, coalesce(v_res::text, 'NULL'));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('run_select_empty_is_empty_array', false, v_state || ' ' || v_msg);
  END;

  -- 4. Two statements: the sentence, P0001.
  BEGIN
    v_res := public.mcp_run_select('select 1; select 2');
    INSERT INTO _r VALUES ('refuse_two_statements', false, 'returned ' || coalesce(v_res::text, 'NULL'));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('refuse_two_statements', v_state = 'P0001' AND v_msg = c_sentence, v_state || ' ' || v_msg);
  END;

  -- 5. A plain DELETE: the sentence.
  BEGIN
    v_res := public.mcp_run_select('delete from public.mcp_previews');
    INSERT INTO _r VALUES ('refuse_delete', false, 'returned ' || coalesce(v_res::text, 'NULL'));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('refuse_delete', v_state = 'P0001' AND v_msg = c_sentence, v_state || ' ' || v_msg);
  END;

  -- 6. A data-modifying CTE passes the text check; the database refuses it. Record the SQLSTATE.
  BEGIN
    v_res := public.mcp_run_select('with d as (delete from public.mcp_previews returning id) select count(*) from d');
    INSERT INTO _r VALUES ('refuse_cte_delete', false, 'returned ' || coalesce(v_res::text, 'NULL'));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('refuse_cte_delete', v_state IN ('25006', '0A000'), v_state || ' ' || v_msg);
  END;

  -- 6b. SELECT … FOR UPDATE passes the text check and takes row locks; the STABLE function's read-only SPI
  --     refuses it. Record the SQLSTATE.
  BEGIN
    v_res := public.mcp_run_select('select id from public.mcp_previews for update');
    INSERT INTO _r VALUES ('refuse_select_for_update', false, 'returned ' || coalesce(v_res::text, 'NULL'));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('refuse_select_for_update', v_state IN ('25006', '0A000'), v_state || ' ' || v_msg);
  END;

  -- 7. pg_sleep: the sentence (and it does not sleep).
  BEGIN
    v_res := public.mcp_run_select('select pg_sleep(20)');
    INSERT INTO _r VALUES ('refuse_pg_sleep', false, 'returned ' || coalesce(v_res::text, 'NULL'));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('refuse_pg_sleep', v_state = 'P0001' AND v_msg = c_sentence, v_state || ' ' || v_msg);
  END;

  -- 8. set_config: the sentence.
  BEGIN
    v_res := public.mcp_run_select('select set_config(''x.y'',''1'',true)');
    INSERT INTO _r VALUES ('refuse_set_config', false, 'returned ' || coalesce(v_res::text, 'NULL'));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('refuse_set_config', v_state = 'P0001' AND v_msg = c_sentence, v_state || ' ' || v_msg);
  END;

  -- 10. The catalogue, as the contractor.
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
  BEGIN
    v_res := public.mcp_catalog('auth');
    INSERT INTO _r VALUES ('catalog_unexposed_schema_is_empty', v_res = '[]'::jsonb, coalesce(v_res::text, 'NULL'));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('catalog_unexposed_schema_is_empty', false, v_state || ' ' || v_msg);
  END;

  -- 11. mcp_previews: insert own row (defaults fill user_id), read it back.
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
    VALUES ('esite_db_delete', 'digest-2', NULL, 7);
    INSERT INTO _r VALUES ('previews_count_only_allowed', true, NULL);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('previews_count_only_allowed', false, v_state || ' ' || v_msg);
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
  RESET ROLE;

  -- ═══ THE SECOND USER ════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
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

  -- The row really is untouched (read as postgres).
  BEGIN
    SELECT count(*) INTO v_n FROM public.mcp_previews WHERE id = v_pid AND consumed_at IS NULL;
    INSERT INTO _r VALUES ('previews_first_row_untouched', v_n = 1, v_n::text);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES ('previews_first_row_untouched', false, v_state || ' ' || v_msg);
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

SELECT t."check" || coalesce('  [' || r.note || ']', '') AS "check", coalesce(r.v, false) AS ok
  FROM (VALUES
    (1,  'control_off_project_has_nodes',                   'CONTROL: the off-project has structure.nodes rows (postgres count)'),
    (2,  'control_rls_filters_nodes_for_contractor',        'CONTROL: RLS gives the contractor some but not all structure.nodes'),
    (3,  'control_contractor_has_no_access_to_proj_off',    'CONTROL: contractor has no access to the off-project'),
    (4,  'run_select_count_matches_direct',                 '1. run_select count(*) on structure.nodes = the contractor''s direct count'),
    (5,  'run_select_off_project_is_zero',                  '2. run_select on a project the contractor is not on = [{"n":0}]'),
    (6,  'run_select_strips_line_comment',                  '3. a leading -- comment is stripped: [{"x":1}]'),
    (7,  'run_select_strips_block_comment',                 '3b. a /* */ comment is stripped: [{"y":2}]'),
    (8,  'run_select_caps_at_1001_rows',                    '3c. 2000 rows come back as 1001'),
    (9,  'run_select_accepts_own_limit',                    '3d. a statement with its own ORDER BY … LIMIT 3 runs, order kept'),
    (10, 'run_select_empty_is_empty_array',                 '3e. no rows = []'),
    (11, 'refuse_two_statements',                           '4. "select 1; select 2" refused: P0001 + the sentence'),
    (12, 'refuse_delete',                                   '5. "delete from …" refused: P0001 + the sentence'),
    (13, 'refuse_cte_delete',                               '6. a data-modifying CTE is refused by the database (25006 or 0A000)'),
    (13.5, 'refuse_select_for_update',                      '6b. SELECT … FOR UPDATE is refused by the database (25006 or 0A000)'),
    (14, 'refuse_pg_sleep',                                '7. pg_sleep refused: P0001 + the sentence'),
    (15, 'refuse_set_config',                               '8. set_config refused: P0001 + the sentence'),
    (16, 'hfp_anon_no_execute',                             '9. has_function_privilege anon EXECUTE mcp_run_select = false'),
    (17, 'hfp_authenticated_execute',                       '9. has_function_privilege authenticated EXECUTE mcp_run_select = true'),
    (18, 'hfp_service_role_no_execute',                     '9. has_function_privilege service_role EXECUTE mcp_run_select = false'),
    (19, 'hfp_catalog_anon_no_authenticated_yes_service_no','9. mcp_catalog EXECUTE: anon no, authenticated yes, service_role no'),
    (20, 'anon_execute_run_select_42501',                   '9. anon calling mcp_run_select is refused 42501'),
    (21, 'anon_execute_catalog_42501',                      '9. anon calling mcp_catalog is refused 42501'),
    (22, 'service_role_execute_run_select_42501',           '9. service_role calling mcp_run_select is refused 42501'),
    (23, 'catalog_lists_14_schemas_in_order',               '10. mcp_catalog() = the 14 schemas in order, each with a numeric table count'),
    (24, 'catalog_inspections_has_responses_value_text',    '10. mcp_catalog(''inspections'') lists table responses with column value_text (text)'),
    (25, 'catalog_unexposed_schema_is_empty',               '10. mcp_catalog(''auth'') = []'),
    (26, 'previews_own_insert_defaults_user_and_reads_back','11. contractor inserts a preview (user_id defaulted) and reads it back'),
    (27, 'previews_count_only_allowed',                     '11. a count-only preview (matched_ids NULL) is allowed'),
    (28, 'previews_forged_user_refused_42501',              '11. contractor inserting a preview for another user is refused 42501'),
    (28.5, 'previews_truncate_refused_42501',               '11. contractor TRUNCATE of mcp_previews is refused 42501 (TRUNCATE ignores RLS)'),
    (29, 'previews_other_user_reads_zero',                 '11. the second user reads 0 previews'),
    (30, 'previews_other_user_update_affects_zero',         '11. the second user''s UPDATE of the first user''s preview affects 0 rows'),
    (31, 'previews_other_user_delete_affects_zero',         '11. the second user''s DELETE of the first user''s preview affects 0 rows'),
    (32, 'previews_first_row_untouched',                    '11. the first user''s preview is still there and unconsumed'),
    (33, 'anon_select_previews_42501',                      '12. anon SELECT on mcp_previews is refused 42501')
  ) AS t(ord, k, "check")
  LEFT JOIN _r r ON r.k = t.k
 ORDER BY t.ord;
