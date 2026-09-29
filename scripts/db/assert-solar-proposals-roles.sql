-- BEHAVIOURAL assertions for 00216_solar_proposals (Solar Phase 6), run as real roles.
--   RED:   scripts/db/dry-run-migration.sh <00207..00210 (+00213) + 00215> scripts/db/assert-solar-proposals-roles.sql
--   GREEN: scripts/db/dry-run-migration.sh <00207..00210 (+00213) + 00215 + 00216> scripts/db/assert-solar-proposals-roles.sql
-- Fixtures are minted inside the transaction and rolled back. WM-Consulting is NOT used (it
-- bypasses the paywall, so it has no negative case).

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_org     UUID := gen_random_uuid();
  v_org2    UUID := gen_random_uuid();
  v_p       UUID := gen_random_uuid();
  v_p2      UUID := gen_random_uuid();
  v_admin   UUID := gen_random_uuid();   -- admin of v_org
  v_edit    UUID := gen_random_uuid();   -- contractor, EDIT grant
  v_money   UUID := gen_random_uuid();   -- contractor, EDIT_FINANCIALS grant
  v_view    UUID := gen_random_uuid();   -- contractor, VIEW grant
  v_nogrant UUID := gen_random_uuid();   -- contractor member, no grant
  v_client  UUID := gen_random_uuid();   -- client_viewer on v_p (FORGED edit_financials grant)
  v_foreign UUID := gen_random_uuid();   -- admin of v_org2
  v_cvx     UUID := gen_random_uuid();   -- client_viewer of v_org2 ONLY; contractor member of v_p (review M1)
  v_pm      UUID := gen_random_uuid();   -- project_manager of v_org + v_p, Solar EDIT only (review round 2, C1)
  v_study   UUID;
  v_study2  UUID;
  v_w       UUID;
  v_case    UUID;
  v_run     UUID;
  v_prop    UUID;   -- family A (will be accepted)
  v_prop_b  UUID;   -- family B (expires)
  v_c1      UUID;   -- family C v1
  v_c2      UUID;   -- family C v2
  v_a2      UUID;   -- family A v2 draft, created before v1 is accepted (review I2)
  v_tmp     UUID;
  v_upd     TIMESTAMPTZ;
  v_j       JSONB;
  v_n       INT;
  v_status  TEXT;
  u         UUID;
  v_hash    CONSTANT TEXT := repeat('c', 64);
  v_pdfsha  CONSTANT TEXT := repeat('a', 64);
  v_tok_a   CONSTANT TEXT := rpad('tokA', 43, 'x');
  v_tok_b   CONSTANT TEXT := rpad('tokB', 43, 'y');
  v_tok_c1  CONSTANT TEXT := rpad('tokC1', 43, 'z');
  v_tok_c2  CONSTANT TEXT := rpad('tokC2', 43, 'w');
  v_tok_c2b CONSTANT TEXT := rpad('tokC2b', 43, 'v');
  v_tok_a2  CONSTANT TEXT := rpad('tokA2', 43, 'u');
  v_snap    CONSTANT JSONB := '{"version":1,"issuer":{"orgName":"Probe","proposerName":"Pat Proposer","proposerEmail":"pat@example.invalid"},"system":{"dcKwp":100},"price":{"offerExclVatZar":1150000}}';
BEGIN
  -- ── Fixtures (as postgres) ────────────────────────────────────────────────
  INSERT INTO public.organisations (id, name) VALUES (v_org, 'solar-6-probe'), (v_org2, 'solar-6-probe-2');
  FOREACH u IN ARRAY ARRAY[v_admin, v_edit, v_money, v_view, v_nogrant, v_client, v_foreign, v_cvx, v_pm] LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'solar-6-probe-' || u || '@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  END LOOP;
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
    (v_admin, v_org, 'admin', TRUE), (v_edit, v_org, 'contractor', TRUE), (v_money, v_org, 'contractor', TRUE),
    (v_view, v_org, 'contractor', TRUE), (v_nogrant, v_org, 'contractor', TRUE),
    (v_client, v_org, 'client_viewer', TRUE), (v_foreign, v_org2, 'admin', TRUE),
    (v_cvx, v_org2, 'client_viewer', TRUE), (v_pm, v_org, 'project_manager', TRUE);
  INSERT INTO projects.projects (id, organisation_id, name, created_by) VALUES
    (v_p, v_org, 'solar-6-probe-p', v_admin), (v_p2, v_org2, 'solar-6-probe-p2', v_foreign);
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active) VALUES
    (v_p, v_edit, v_org, 'contractor', TRUE), (v_p, v_money, v_org, 'contractor', TRUE),
    (v_p, v_view, v_org, 'contractor', TRUE), (v_p, v_nogrant, v_org, 'contractor', TRUE),
    (v_p, v_client, v_org, 'client_viewer', TRUE),
    (v_p, v_cvx, v_org2, 'contractor', TRUE), (v_p, v_pm, v_org, 'project_manager', TRUE);
  INSERT INTO billing.org_addon_subscriptions (organisation_id, feature_key, status, amount_kobo, current_period_end) VALUES
    (v_org, 'solar', 'active', 199900, now() + interval '30 days'),
    (v_org2, 'solar', 'active', 199900, now() + interval '30 days');
  INSERT INTO solar.project_access (project_id, user_id, level) VALUES
    (v_p, v_edit, 'edit'), (v_p, v_money, 'edit_financials'), (v_p, v_view, 'view'), (v_p, v_pm, 'edit');
  SET LOCAL session_replication_role = replica;
  INSERT INTO solar.project_access (project_id, user_id, organisation_id, level) VALUES (v_p, v_client, v_org, 'edit_financials');
  SET LOCAL session_replication_role = origin;
  INSERT INTO solar.studies (project_id) VALUES (v_p) RETURNING id INTO v_study;
  INSERT INTO solar.studies (project_id) VALUES (v_p2) RETURNING id INTO v_study2;
  INSERT INTO solar.weather_datasets (organisation_id, source, lat_round, lng_round, storage_path, content_sha256)
  VALUES (v_org, 'pvgis_tmy', -26.20, 28.05, v_org || '/w1.csv.gz', v_hash) RETURNING id INTO v_w;
  INSERT INTO solar.cases (study_id, name, config) VALUES (v_study, 'Base', '{"version":1}') RETURNING id INTO v_case;
  INSERT INTO solar.case_runs (case_id, engine_version, inputs, inputs_hash, config_snapshot, weather_dataset_id)
  VALUES (v_case, '0.1.0', '{}', v_hash, '{}', v_w) RETURNING id INTO v_run;
  UPDATE solar.case_runs SET status = 'succeeded', outputs = '{"kpis":{"dcKwp":100}}', hourly_path = 'h.csv.gz' WHERE id = v_run;
  UPDATE solar.studies SET selected_case_id = v_case WHERE id = v_study;
  INSERT INTO projects.reports (organisation_id, project_id, kind, title, storage_path, status, version) VALUES
    (v_org, v_p, 'solar_technical', 't', 'x/t.pdf', 'issued', 1),
    (v_org, v_p, 'solar_feasibility', 'f', 'x/f.pdf', 'issued', 1),
    (v_org, v_p, 'solar_proposal', 'p', 'x/p.pdf', 'issued', 1);
  -- Objects in bucket 'reports' (review C1): two Solar money PDFs and one non-Solar control.
  INSERT INTO storage.objects (bucket_id, name) VALUES
    ('reports', v_org || '/' || v_p || '/solar-proposals/probe-v1.pdf'),
    ('reports', v_org || '/' || v_p || '/solar-reports/solar_feasibility-v1-probe.pdf'),
    ('reports', v_org || '/' || v_p || '/tenant-schedule/probe-control.pdf');

  -- ── 1. Money user: drafts only ────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_money::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.proposals (study_id, project_id, organisation_id, case_id, status, snapshot, share_token_hash, draft)
    VALUES (v_study, v_p2, v_org2, v_case, 'issued', v_snap, v_hash, '{"marginPct":15}')
    RETURNING id INTO v_prop;
    INSERT INTO _r VALUES ('draft_born_clean', (SELECT status = 'draft' AND snapshot IS NULL AND share_token_hash IS NULL
      AND family_id = id AND version = 1 AND project_id = v_p AND organisation_id = v_org FROM solar.proposals WHERE id = v_prop));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('draft_born_clean', false);
  END;
  BEGIN
    UPDATE solar.proposals SET draft = '{"marginPct":20}' WHERE id = v_prop;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('money_user_edits_draft', v_n = 1);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('money_user_edits_draft', false);
  END;
  BEGIN
    UPDATE solar.proposals SET status = 'issued' WHERE id = v_prop;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('user_issue_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('user_issue_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.proposals SET share_token_hash = v_hash WHERE id = v_prop;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('user_sets_token_on_draft_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('user_sets_token_on_draft_REFUSED', false);
  END;
  INSERT INTO _r VALUES ('money_user_reads_feasibility_kind', public.user_can_read_report_kind(v_p, 'solar_feasibility'));
  INSERT INTO _r VALUES ('money_user_lists_proposal_report', (SELECT count(*) FROM projects.reports WHERE project_id = v_p AND kind = 'solar_proposal') = 1);
  -- Family B and family C drafts (created now, issued later as the service path)
  INSERT INTO solar.proposals (study_id, case_id) VALUES (v_study, v_case) RETURNING id INTO v_prop_b;
  INSERT INTO solar.proposals (study_id, case_id) VALUES (v_study, v_case) RETURNING id INTO v_c1;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 2. Editor (no money), View, client (forged grant), no grant, foreign ──
  FOREACH u IN ARRAY ARRAY[v_edit, v_view, v_client, v_nogrant, v_foreign] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO _r VALUES ('no_money_reads_no_proposals_' || CASE u WHEN v_edit THEN 'editor' WHEN v_view THEN 'view'
      WHEN v_client THEN 'client' WHEN v_nogrant THEN 'nogrant' ELSE 'foreign' END,
      (SELECT count(*) FROM solar.proposals WHERE project_id = v_p) = 0
      AND (SELECT count(*) FROM solar.proposal_events WHERE project_id = v_p) = 0);
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_edit::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.proposals (study_id, case_id) VALUES (v_study, v_case);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('editor_creates_proposal_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('editor_creates_proposal_REFUSED', false);
  END;
  INSERT INTO _r VALUES ('editor_cannot_read_feasibility_kind', NOT public.user_can_read_report_kind(v_p, 'solar_feasibility'));
  INSERT INTO _r VALUES ('editor_reads_technical_kind', public.user_can_read_report_kind(v_p, 'solar_technical'));
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('view_user_lists_technical_not_feasibility',
    (SELECT count(*) FROM projects.reports WHERE project_id = v_p AND kind = 'solar_technical') = 1
    AND (SELECT count(*) FROM projects.reports WHERE project_id = v_p AND kind IN ('solar_feasibility', 'solar_proposal')) = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_nogrant::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('nogrant_reads_no_solar_report', (SELECT count(*) FROM projects.reports WHERE project_id = v_p AND kind LIKE 'solar_%') = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_client::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('client_reads_no_proposal_report', (SELECT count(*) FROM projects.reports WHERE project_id = v_p AND kind = 'solar_proposal') = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 3. anon and authenticated have no client function; anon has no table ──
  INSERT INTO _r VALUES ('anon_no_table_privilege', NOT has_table_privilege('anon', 'solar.proposals', 'SELECT')
    AND NOT has_table_privilege('anon', 'solar.proposal_events', 'SELECT'));
  INSERT INTO _r VALUES ('client_functions_service_only',
    NOT has_function_privilege('anon', 'public.solar_proposal_by_token(text, text, text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.solar_proposal_by_token(text, text, text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.solar_issue_proposal(uuid, timestamptz, uuid, jsonb, text, text, text, timestamptz, uuid, uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.solar_portal_respond(uuid, uuid, uuid, text, text, text, boolean, text, text, text, text)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.solar_proposal_by_token(text, text, text)', 'EXECUTE'));
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM count(*) FROM solar.proposals;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('anon_reads_proposals_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('anon_reads_proposals_REFUSED', false);
  END;
  RESET ROLE;

  -- ── 3b. Solar PDFs in bucket 'reports' are service-only (review C1) ───────
  FOREACH u IN ARRAY ARRAY[v_nogrant, v_client, v_money] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO _r VALUES ('storage_solar_pdfs_hidden_' || CASE u WHEN v_nogrant THEN 'nogrant' WHEN v_client THEN 'client' ELSE 'money' END,
      (SELECT count(*) FROM storage.objects WHERE bucket_id = 'reports' AND name LIKE v_org || '/' || v_p || '/solar-%') = 0);
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_nogrant::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('storage_control_object_readable',
    (SELECT count(*) FROM storage.objects WHERE bucket_id = 'reports' AND name = v_org || '/' || v_p || '/tenant-schedule/probe-control.pdf') = 1);
  BEGIN
    UPDATE storage.objects SET metadata = '{"forged":true}'::jsonb WHERE bucket_id = 'reports' AND name LIKE v_org || '/' || v_p || '/solar-%';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('storage_solar_update_REFUSED', v_n = 0);
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('storage_solar_update_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('storage_solar_update_REFUSED', false);
  END;
  -- storage.protect_delete() refuses EVERY direct delete unless storage.allow_delete_query is set;
  -- the Storage API sets it and then runs the DELETE under the caller's role, so set it here too
  -- (without it this check could not fail).
  PERFORM set_config('storage.allow_delete_query', 'true', true);
  BEGIN
    DELETE FROM storage.objects WHERE bucket_id = 'reports' AND name LIKE v_org || '/' || v_p || '/solar-%';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('storage_solar_delete_REFUSED', v_n = 0);
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('storage_solar_delete_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('storage_solar_delete_REFUSED', false);
  END;
  PERFORM set_config('storage.allow_delete_query', 'false', true);
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('reports', v_org || '/' || v_p || '/solar-proposals/forged-v9.pdf');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('storage_solar_insert_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('storage_solar_insert_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _r VALUES ('storage_solar_objects_intact',
    (SELECT count(*) FROM storage.objects WHERE bucket_id = 'reports' AND name LIKE v_org || '/' || v_p || '/solar-%'
       AND metadata IS DISTINCT FROM '{"forged":true}'::jsonb) = 2);
  -- An org admin (reports_write, and a Solar grantor) cannot rewrite or delete the proposal report row.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE projects.reports SET title = 'forged' WHERE project_id = v_p AND kind = 'solar_proposal';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('admin_update_proposal_report_REFUSED', v_n = 0);
  DELETE FROM projects.reports WHERE project_id = v_p AND kind = 'solar_proposal';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('admin_delete_proposal_report_REFUSED', v_n = 0);
  BEGIN
    INSERT INTO projects.reports (organisation_id, project_id, kind, title, storage_path, status, version)
    VALUES (v_org, v_p, 'solar_proposal', 'forged', 'x/forged.pdf', 'issued', 9);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('admin_insert_proposal_report_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('admin_insert_proposal_report_REFUSED', false);
  END;
  -- Review round 2 (C1): no session writes ANY Solar report row, nor any row pointing at a Solar PDF
  -- path. getProjectReportUrlAction service-signs a row's storage_path after gating on its KIND, so a
  -- forged row (a Solar View/Edit kind, or an open kind) aimed at a feasibility path is a money leak.
  UPDATE projects.reports SET title = 't2' WHERE project_id = v_p AND kind = 'solar_technical';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('admin_update_technical_report_REFUSED', v_n = 0
    AND (SELECT count(*) FROM projects.reports WHERE project_id = v_p AND kind = 'solar_technical') = 1);
  BEGIN
    INSERT INTO projects.reports (organisation_id, project_id, kind, title, storage_path, status, version)
    VALUES (v_org, v_p, 'solar_technical', 'forged', v_org || '/' || v_p || '/solar-reports/solar_feasibility-v1-' || v_run || '.pdf', 'issued', 9);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('admin_insert_technical_solar_path_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('admin_insert_technical_solar_path_REFUSED', false);
  END;
  BEGIN
    INSERT INTO projects.reports (organisation_id, project_id, kind, title, storage_path, status, version)
    VALUES (v_org, v_p, 'tenant_schedule', 'forged', v_org || '/' || v_p || '/solar-reports/solar_feasibility-v1-' || v_run || '.pdf', 'issued', 9);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('admin_insert_open_kind_solar_path_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('admin_insert_open_kind_solar_path_REFUSED', false);
  END;
  -- Control: a non-Solar row on a non-Solar path still inserts; re-pointing it at a Solar PDF does not.
  BEGIN
    INSERT INTO projects.reports (organisation_id, project_id, kind, title, storage_path, status, version)
    VALUES (v_org, v_p, 'tenant_schedule', 'ctl', v_org || '/' || v_p || '/tenant-schedule-v9.pdf', 'issued', 9);
    INSERT INTO _r VALUES ('admin_inserts_non_solar_report_control', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('admin_inserts_non_solar_report_control:' || left(SQLERRM, 120), false);
  END;
  BEGIN
    UPDATE projects.reports SET storage_path = v_org || '/' || v_p || '/solar-proposals/probe-v1.pdf'
      WHERE project_id = v_p AND kind = 'tenant_schedule' AND title = 'ctl';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION 'allowed:%', v_n USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('admin_repoint_open_row_to_solar_path_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('admin_repoint_open_row_to_solar_path_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  -- A project manager holding only Solar EDIT (reports_write admits PMs; no money access).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pm::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('pm_sees_technical_report_precondition',
    (SELECT count(*) FROM projects.reports WHERE project_id = v_p AND kind = 'solar_technical') = 1
    AND (SELECT count(*) FROM projects.reports WHERE project_id = v_p AND kind IN ('solar_feasibility', 'solar_proposal')) = 0);
  BEGIN
    INSERT INTO projects.reports (organisation_id, project_id, kind, title, storage_path, status, version)
    VALUES (v_org, v_p, 'solar_technical', 'forged', v_org || '/' || v_p || '/solar-reports/solar_feasibility-v1-' || v_run || '.pdf', 'issued', 9);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('pm_insert_technical_solar_path_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_insert_technical_solar_path_REFUSED', false);
  END;
  BEGIN
    INSERT INTO projects.reports (organisation_id, project_id, kind, title, storage_path, status, version)
    VALUES (v_org, v_p, 'tenant_schedule', 'forged', v_org || '/' || v_p || '/solar-reports/solar_feasibility-v1-' || v_run || '.pdf', 'issued', 9);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('pm_insert_open_kind_solar_path_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_insert_open_kind_solar_path_REFUSED', false);
  END;
  BEGIN
    UPDATE projects.reports SET storage_path = v_org || '/' || v_p || '/solar-reports/solar_feasibility-v1-' || v_run || '.pdf'
      WHERE project_id = v_p AND kind = 'solar_technical';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('pm_update_technical_storage_path_REFUSED', v_n = 0);
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('pm_update_technical_storage_path_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('pm_update_technical_storage_path_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _r VALUES ('technical_report_row_intact',
    (SELECT count(*) FROM projects.reports WHERE project_id = v_p AND kind = 'solar_technical' AND title = 't' AND storage_path = 'x/t.pdf') = 1
    AND (SELECT count(*) FROM projects.reports WHERE project_id = v_p AND title = 'forged') = 0);
  INSERT INTO _r VALUES ('proposal_report_row_intact',
    (SELECT count(*) FROM projects.reports WHERE project_id = v_p AND kind = 'solar_proposal' AND title = 'p') = 1);

  -- ── 4. Issue family A (service path) ──────────────────────────────────────
  SELECT updated_at INTO v_upd FROM solar.proposals WHERE id = v_prop;
  v_j := public.solar_issue_proposal(v_prop, v_upd - interval '1 second', v_run, v_snap, 'o/p/a.pdf', v_pdfsha,
           solar.proposal_hash_token(v_tok_a), now() + interval '30 days', NULL, v_money);
  INSERT INTO _r VALUES ('issue_stale_REFUSED', v_j ->> 'error' = 'stale');
  v_j := public.solar_issue_proposal(v_prop, v_upd, v_run, v_snap, 'o/p/a.pdf', v_pdfsha,
           solar.proposal_hash_token(v_tok_a), now() + interval '30 days', NULL, v_money);
  INSERT INTO _r VALUES ('issue_ok', (v_j ->> 'ok')::boolean
    AND (SELECT status = 'issued' AND issued_by = v_money AND case_run_id = v_run AND snapshot = v_snap FROM solar.proposals WHERE id = v_prop)
    AND (SELECT count(*) FROM solar.proposal_events WHERE proposal_id = v_prop AND kind = 'issued' AND pdf_sha256 = v_pdfsha) = 1);
  INSERT INTO _r VALUES ('stored_hash_is_sha256_of_token',
    (SELECT share_token_hash = encode(sha256(convert_to(v_tok_a, 'UTF8')), 'hex') AND share_token_hash <> v_tok_a FROM solar.proposals WHERE id = v_prop));
  BEGIN
    UPDATE solar.proposals SET share_token_hash = v_tok_a WHERE id = v_prop;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('raw_token_storage_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('raw_token_storage_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.proposals SET snapshot = '{"forged":true}' WHERE id = v_prop;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('issued_snapshot_immutable_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('issued_snapshot_immutable_REFUSED', false);
  END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_money::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE solar.proposals SET draft = '{"marginPct":1}' WHERE id = v_prop;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('issued_user_update_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('issued_user_update_REFUSED', false);
  END;
  BEGIN
    DELETE FROM solar.proposals WHERE id = v_prop;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('issued_delete_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('issued_delete_REFUSED', false);
  END;
  -- Family A v2 draft, created while v1 is still live (review I2).
  INSERT INTO solar.proposals (study_id, family_id, case_id) VALUES (v_study, v_prop, v_case) RETURNING id INTO v_a2;
  -- Tamper: change the case and its money AFTER issue.
  UPDATE solar.cases SET config = config || '{"tampered":true}' WHERE id = v_case;
  INSERT INTO solar.case_financials (case_id, config) VALUES (v_case, '{"tampered":true}');
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 5. Token view ─────────────────────────────────────────────────────────
  v_j := public.solar_proposal_by_token(v_tok_a, '203.0.113.7', 'probe-agent');
  INSERT INTO _r VALUES ('token_view_marks_viewed', v_j ->> 'state' = 'viewed'
    AND (v_j -> 'snapshot' -> 'system' ->> 'dcKwp')::int = 100 AND v_j ->> 'pdfSha256' = v_pdfsha);
  INSERT INTO _r VALUES ('snapshot_unchanged_after_case_edit', v_j -> 'snapshot' = v_snap
    AND (SELECT pdf_sha256 = v_pdfsha FROM solar.proposals WHERE id = v_prop));
  v_j := public.solar_proposal_by_token(v_tok_a, '203.0.113.7', 'probe-agent');
  INSERT INTO _r VALUES ('second_view_no_duplicate_event',
    (SELECT count(*) FROM solar.proposal_events WHERE proposal_id = v_prop AND kind = 'viewed') = 1);
  v_j := public.solar_proposal_by_token(encode(sha256(convert_to(v_tok_a, 'UTF8')), 'hex'), NULL, NULL);
  INSERT INTO _r VALUES ('lookup_by_hash_string_REFUSED', v_j ->> 'state' = 'not_found');
  v_j := public.solar_proposal_by_token(rpad('nope', 43, 'q'), NULL, NULL);
  INSERT INTO _r VALUES ('unknown_token_not_found', v_j ->> 'state' = 'not_found' AND v_j -> 'snapshot' IS NULL);

  -- ── 6. Respond ────────────────────────────────────────────────────────────
  v_j := public.solar_proposal_respond_by_token(v_tok_a, 'accepted', ' ', 'c@example.invalid', TRUE, NULL, NULL, '203.0.113.7', 'ua');
  INSERT INTO _r VALUES ('respond_validates_name', v_j ->> 'error' = 'invalid_name');
  v_j := public.solar_proposal_respond_by_token(v_tok_a, 'accepted', 'Client Name', 'not-an-email', TRUE, NULL, NULL, '203.0.113.7', 'ua');
  INSERT INTO _r VALUES ('respond_validates_email', v_j ->> 'error' = 'invalid_email');
  v_j := public.solar_proposal_respond_by_token(v_tok_a, 'accepted', 'Client Name', 'c@example.invalid', FALSE, NULL, NULL, '203.0.113.7', 'ua');
  INSERT INTO _r VALUES ('accept_requires_authority', v_j ->> 'error' = 'authority_required');
  v_j := public.solar_proposal_respond_by_token(v_tok_a, 'accepted', 'Client Name', 'C@Example.invalid', TRUE,
           'data:image/png;base64,iVBORw0KGgo=', NULL, '203.0.113.7', 'probe-agent');
  INSERT INTO _r VALUES ('accept_stamps_evidence', (v_j ->> 'ok')::boolean
    AND (SELECT status = 'accepted' AND responded_at IS NOT NULL FROM solar.proposals WHERE id = v_prop)
    AND (SELECT count(*) FROM solar.proposal_events WHERE proposal_id = v_prop AND kind = 'accepted'
          AND actor_name = 'Client Name' AND actor_email = 'c@example.invalid' AND authority_confirmed
          AND ip = '203.0.113.7' AND user_agent = 'probe-agent' AND pdf_sha256 = v_pdfsha
          AND signature_png LIKE 'data:image/png;base64,%' AND via = 'token') = 1);
  v_j := public.solar_proposal_respond_by_token(v_tok_a, 'declined', 'Client Name', 'c@example.invalid', FALSE, NULL, 'x', NULL, NULL);
  INSERT INTO _r VALUES ('second_response_REFUSED', v_j ->> 'error' = 'accepted');
  BEGIN
    UPDATE solar.proposal_events SET actor_name = 'Forged' WHERE proposal_id = v_prop;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('events_update_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('events_update_REFUSED', false);
  END;
  SET LOCAL ROLE service_role;
  BEGIN
    DELETE FROM solar.proposal_events WHERE proposal_id = v_prop;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('events_delete_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('events_delete_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_money::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('money_user_reads_acceptance_record',
    (SELECT count(*) FROM solar.proposal_events WHERE proposal_id = v_prop AND kind IN ('issued', 'viewed', 'accepted')) = 3);
  BEGIN
    INSERT INTO solar.proposals (study_id, family_id, case_id) VALUES (v_study, v_prop, v_case);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('revise_accepted_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('revise_accepted_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- Review I2: v1 is accepted, so its pre-existing draft v2 cannot be issued.
  SELECT updated_at INTO v_upd FROM solar.proposals WHERE id = v_a2;
  v_j := public.solar_issue_proposal(v_a2, v_upd, v_run, v_snap, 'o/p/a2.pdf', v_pdfsha,
           solar.proposal_hash_token(v_tok_a2), now() + interval '30 days', NULL, v_money);
  INSERT INTO _r VALUES ('issue_after_family_accept_REFUSED', v_j ->> 'error' = 'family_accepted'
    AND (SELECT status = 'draft' FROM solar.proposals WHERE id = v_a2)
    AND (SELECT status = 'accepted' FROM solar.proposals WHERE id = v_prop));
  -- ...and if a live sibling exists anyway (older data), a response to it is refused.
  SET LOCAL session_replication_role = replica;
  UPDATE solar.proposals SET status = 'issued', snapshot = v_snap, pdf_path = 'o/p/a2.pdf', pdf_sha256 = v_pdfsha,
         share_token_hash = solar.proposal_hash_token(v_tok_a2), expires_at = now() + interval '30 days', issued_at = now()
   WHERE id = v_a2;
  SET LOCAL session_replication_role = origin;
  v_j := public.solar_proposal_respond_by_token(v_tok_a2, 'accepted', 'Client Name', 'c@example.invalid', TRUE, NULL, NULL, NULL, NULL);
  INSERT INTO _r VALUES ('respond_after_family_accept_REFUSED', v_j ->> 'error' = 'family_accepted'
    AND (SELECT status = 'issued' FROM solar.proposals WHERE id = v_a2));
  SET LOCAL session_replication_role = replica;
  UPDATE solar.proposals SET status = 'draft', snapshot = NULL, pdf_path = NULL, pdf_sha256 = NULL,
         share_token_hash = NULL, expires_at = NULL, issued_at = NULL, responded_at = NULL
   WHERE id = v_a2;
  SET LOCAL session_replication_role = origin;

  -- ── 7. Expired (family B) ─────────────────────────────────────────────────
  SELECT updated_at INTO v_upd FROM solar.proposals WHERE id = v_prop_b;
  v_j := public.solar_issue_proposal(v_prop_b, v_upd, v_run, v_snap, 'o/p/b.pdf', v_pdfsha,
           solar.proposal_hash_token(v_tok_b), now() + interval '1 day', NULL, v_money);
  SET LOCAL session_replication_role = replica;
  UPDATE solar.proposals SET expires_at = now() - interval '1 minute' WHERE id = v_prop_b;
  SET LOCAL session_replication_role = origin;
  v_j := public.solar_proposal_by_token(v_tok_b, NULL, NULL);
  INSERT INTO _r VALUES ('expired_token_REFUSED', v_j ->> 'state' = 'expired' AND v_j -> 'snapshot' IS NULL
    AND v_j -> 'issuer' ->> 'proposerName' = 'Pat Proposer');
  v_j := public.solar_proposal_respond_by_token(v_tok_b, 'accepted', 'Client Name', 'c@example.invalid', TRUE, NULL, NULL, NULL, NULL);
  INSERT INTO _r VALUES ('expired_accept_REFUSED', v_j ->> 'error' = 'expired'
    AND (SELECT status = 'issued' FROM solar.proposals WHERE id = v_prop_b));

  -- ── 8. Family C: rotate, revise, supersede, withdraw ──────────────────────
  SELECT updated_at INTO v_upd FROM solar.proposals WHERE id = v_c1;
  v_j := public.solar_issue_proposal(v_c1, v_upd, v_run, v_snap, 'o/p/c1.pdf', v_pdfsha,
           solar.proposal_hash_token(v_tok_c1), now() + interval '30 days', NULL, v_money);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_money::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.proposals (study_id, family_id, case_id, draft) VALUES (v_study, v_c1, v_case, '{"marginPct":10}') RETURNING id INTO v_c2;
    INSERT INTO _r VALUES ('revision_is_next_version', (SELECT version = 2 AND family_id = v_c1 AND status = 'draft' FROM solar.proposals WHERE id = v_c2));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('revision_is_next_version', false);
  END;
  BEGIN
    INSERT INTO solar.proposals (study_id, family_id, case_id) VALUES (v_study, v_c1, v_case);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN unique_violation THEN INSERT INTO _r VALUES ('second_draft_in_family_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('second_draft_in_family_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT updated_at INTO v_upd FROM solar.proposals WHERE id = v_c2;
  v_j := public.solar_issue_proposal(v_c2, v_upd, v_run, v_snap, 'o/p/c2.pdf', v_pdfsha,
           solar.proposal_hash_token(v_tok_c2), now() + interval '30 days', NULL, v_money);
  INSERT INTO _r VALUES ('issue_supersedes_previous', (v_j ->> 'ok')::boolean
    AND (SELECT status = 'withdrawn' FROM solar.proposals WHERE id = v_c1)
    AND (SELECT count(*) FROM solar.proposal_events WHERE proposal_id = v_c1 AND kind = 'withdrawn' AND reason = 'Superseded by version 2') = 1);
  v_j := public.solar_proposal_by_token(v_tok_c1, NULL, NULL);
  INSERT INTO _r VALUES ('withdrawn_token_REFUSED', v_j ->> 'state' = 'withdrawn' AND v_j -> 'snapshot' IS NULL);
  v_j := public.solar_proposal_respond_by_token(v_tok_c1, 'accepted', 'Client Name', 'c@example.invalid', TRUE, NULL, NULL, NULL, NULL);
  INSERT INTO _r VALUES ('withdrawn_accept_REFUSED', v_j ->> 'error' = 'withdrawn');
  v_j := public.solar_rotate_proposal_link(v_c2, solar.proposal_hash_token(v_tok_c2b), v_money);
  INSERT INTO _r VALUES ('rotate_kills_old_link', (v_j ->> 'ok')::boolean
    AND public.solar_proposal_by_token(v_tok_c2, NULL, NULL) ->> 'state' = 'not_found'
    AND public.solar_proposal_by_token(v_tok_c2b, NULL, NULL) ->> 'state' = 'viewed');

  -- ── 9. Portal ─────────────────────────────────────────────────────────────
  v_j := public.solar_portal_proposals(v_p, v_client);
  INSERT INTO _r VALUES ('portal_lists_for_client_viewer', jsonb_array_length(v_j) = 4
    AND NOT (v_j::text LIKE '%"snapshot"%'));
  INSERT INTO _r VALUES ('portal_refuses_non_client', public.solar_portal_proposals(v_p, v_edit) = '[]'::jsonb
    AND public.solar_portal_proposal(v_p, v_edit, v_c2, NULL, NULL) ->> 'state' = 'not_found');
  INSERT INTO _r VALUES ('portal_refuses_foreign_org_client_viewer', public.solar_portal_proposals(v_p, v_cvx) = '[]'::jsonb
    AND public.solar_portal_proposal(v_p, v_cvx, v_c2, NULL, NULL) ->> 'state' = 'not_found');
  INSERT INTO _r VALUES ('portal_refuses_foreign_project', public.solar_portal_proposal(v_p2, v_client, v_c2, NULL, NULL) ->> 'state' = 'not_found');
  v_j := public.solar_portal_respond(v_p, v_client, v_c2, 'declined', 'Client Viewer', 'cv@example.invalid', NULL, NULL, 'Too expensive', '198.51.100.9', 'portal-agent');
  INSERT INTO _r VALUES ('portal_decline_stamps_user', (v_j ->> 'ok')::boolean
    AND (SELECT count(*) FROM solar.proposal_events WHERE proposal_id = v_c2 AND kind = 'declined' AND via = 'portal'
          AND actor_user_id = v_client AND reason = 'Too expensive' AND signature_png IS NULL) = 1);
  v_j := public.solar_withdraw_proposal(v_c2, v_money);
  INSERT INTO _r VALUES ('withdraw_after_decline_REFUSED', v_j ->> 'error' = 'not_live');

  -- ── 10. Portfolio ─────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_money::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('portfolio_money_user', (SELECT count(*) = 1 AND bool_and(stage = 'accepted' AND selected_kwp = 100 AND can_see_money AND proposed_kwp = 100)
    FROM public.solar_portfolio(v_org)));
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('portfolio_view_user_no_money', (SELECT count(*) = 1 AND bool_and(NOT can_see_money AND year1_saving_zar IS NULL)
    FROM public.solar_portfolio(v_org)));
  RESET ROLE;
  FOREACH u IN ARRAY ARRAY[v_nogrant, v_foreign] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO _r VALUES ('portfolio_empty_' || CASE u WHEN v_nogrant THEN 'nogrant' ELSE 'foreign' END,
      (SELECT count(*) FROM public.solar_portfolio(v_org)) = 0);
    RESET ROLE;
  END LOOP;

  -- ── 11. Templates ─────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.proposal_templates (organisation_id, terms_text, validity_days) VALUES (v_org, 'Terms v1', 45);
    INSERT INTO _r VALUES ('admin_writes_templates', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('admin_writes_templates', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_money::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('money_user_reads_templates', (SELECT terms_text = 'Terms v1' FROM solar.proposal_templates WHERE organisation_id = v_org));
  UPDATE solar.proposal_templates SET terms_text = 'Forged' WHERE organisation_id = v_org;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('money_user_writes_templates_noop', v_n = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('view_user_reads_no_templates', (SELECT count(*) FROM solar.proposal_templates WHERE organisation_id = v_org) = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 12. Toggle column ─────────────────────────────────────────────────────
  INSERT INTO _r VALUES ('notify_solar_email_defaults_true', (SELECT column_default = 'true' AND is_nullable = 'NO'
    FROM information_schema.columns WHERE table_schema = 'projects' AND table_name = 'project_settings' AND column_name = 'notify_solar_email'));

  -- ── 12b. Issued evidence survives a case or study delete (review M2, I1) ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_edit::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    DELETE FROM solar.cases WHERE id = v_case;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('case_delete_with_issued_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('case_delete_with_issued_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_money::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    DELETE FROM solar.studies WHERE id = v_study;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('study_delete_with_issued_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('study_delete_with_issued_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _r VALUES ('issued_evidence_intact_after_deletes',
    (SELECT count(*) FROM solar.proposals WHERE project_id = v_p AND status <> 'draft' AND case_id = v_case) = 4
    AND (SELECT count(*) FROM solar.proposal_events WHERE project_id = v_p AND kind = 'accepted') = 1);

  -- ── 13. Lapsed subscription: staff read nothing, rows kept, issued link still works ──
  UPDATE billing.org_addon_subscriptions SET status = 'cancelled', current_period_end = now() - interval '1 day' WHERE organisation_id = v_org;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_money::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('lapsed_money_user_reads_nothing', (SELECT count(*) FROM solar.proposals WHERE project_id = v_p) = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO _r VALUES ('lapsed_rows_kept', (SELECT count(*) FROM solar.proposals WHERE project_id = v_p) = 5);
  INSERT INTO _r VALUES ('lapsed_token_still_works', public.solar_proposal_by_token(v_tok_a, NULL, NULL) ->> 'state' = 'accepted');

  -- ── 14. A PROJECT delete still cascades the study, proposals and evidence ─
  BEGIN
    DELETE FROM projects.projects WHERE id = v_p;
    INSERT INTO _r VALUES ('project_delete_cascades_proposals', (SELECT count(*) FROM solar.studies WHERE project_id = v_p) = 0
      AND (SELECT count(*) FROM solar.proposals WHERE project_id = v_p) = 0
      AND (SELECT count(*) FROM solar.proposal_events WHERE project_id = v_p) = 0);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('project_delete_cascades_proposals:' || left(SQLERRM, 120), false);
  END;
END $$;

SELECT k AS "check", v AS ok FROM _r ORDER BY k;
