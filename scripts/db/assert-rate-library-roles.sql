-- BEHAVIOURAL assertions for 00231_rate_library, run as real roles.
--   Red:   scripts/db/dry-run-migration.sh <noop.sql> scripts/db/assert-rate-library-roles.sql
--   Green: scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00231_rate_library.sql scripts/db/assert-rate-library-roles.sql
-- Fixtures are minted inside the transaction and rolled back. Seeding happens as
-- postgres BEFORE any impersonation (request.jwt.claims outlives RESET ROLE).
-- REFUSAL PATTERN: a "…_REFUSED" check passes only on the SQLSTATE the design
-- promises; an allowed statement raises P0001 itself so the write rolls back.
-- What this proves that the @verify block cannot: WHO can see and do WHAT.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_org    UUID := gen_random_uuid();
  v_org2   UUID := gen_random_uuid();
  v_owner  UUID := gen_random_uuid();   -- owner of v_org
  v_pm     UUID := gen_random_uuid();   -- org-level project_manager of v_org
  v_con    UUID := gen_random_uuid();   -- contractor of v_org, PROMOTED to PM on its project
  v_cv     UUID := gen_random_uuid();   -- client_viewer of v_org
  v_gone   UUID := gen_random_uuid();   -- deactivated admin of v_org
  v_admin2 UUID := gen_random_uuid();   -- admin of v_org2
  v_proj   UUID := gen_random_uuid();
  v_item   UUID := gen_random_uuid();
  v_item2  UUID := gen_random_uuid();   -- v_org2's item
  v_src    UUID := gen_random_uuid();
  v_line   UUID := gen_random_uuid();
  v_obs    UUID := gen_random_uuid();
  v_new    UUID;
  v_lid    UUID := gen_random_uuid();
  v_l2     UUID := gen_random_uuid();
  v_l3     UUID := gen_random_uuid();
  v_res    JSONB;
  v_n      INT;
  v_by     UUID;
  u        UUID;
BEGIN
  -- ── Fixtures (as postgres) ────────────────────────────────────────────────
  INSERT INTO public.organisations (id, name) VALUES (v_org, 'rate-library-probe'), (v_org2, 'rate-library-probe-2');
  FOREACH u IN ARRAY ARRAY[v_owner, v_pm, v_con, v_cv, v_gone, v_admin2] LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'rate-library-probe-' || u || '@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  END LOOP;
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
    (v_owner, v_org, 'owner', TRUE), (v_pm, v_org, 'project_manager', TRUE), (v_con, v_org, 'contractor', TRUE),
    (v_cv, v_org, 'client_viewer', TRUE), (v_gone, v_org, 'admin', FALSE), (v_admin2, v_org2, 'admin', TRUE);
  INSERT INTO projects.projects (id, organisation_id, name, created_by) VALUES (v_proj, v_org, 'rate-library-probe', v_owner);
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active)
    VALUES (v_proj, v_con, v_org, 'project_manager', TRUE);

  INSERT INTO public.rate_items (id, organisation_id, code, signature, category, description, unit) VALUES
    (v_item, v_org, 'CONDUIT-20-PVC-M', 'conduit|m|dia=20|material=pvc', 'conduit', 'Conduit, PVC, 20 mm dia', 'm'),
    (v_item2, v_org2, 'CONDUIT-20-PVC-M', 'conduit|m|dia=20|material=pvc', 'conduit', 'Conduit, PVC, 20 mm dia', 'm');
  INSERT INTO public.rate_sources (id, organisation_id, kind, source_ref, contractor_name, project_id, province, priced_on, priced_on_basis)
    VALUES (v_src, v_org, 'historical_file', 'probe.xlsx', 'Probe Electrical', v_proj, 'Gauteng', DATE '2026-06-25', 'document_date');
  INSERT INTO public.rate_source_lines (id, organisation_id, source_id, section_path, description, unit, supply_rate, install_rate, group_key, match_status, matched_item_id, match_method)
    VALUES (v_line, v_org, v_src, ARRAY['CONDUIT'], '20mm Ø', 'm', 5.15, 4.5, 'conduit | 20mm dia | m', 'auto_confirmed', v_item, 'rule');
  INSERT INTO public.rate_observations (id, organisation_id, rate_item_id, source_id, source_line_id, unit, supply_rate, install_rate, rate, contractor_name, project_id, province, priced_on)
    VALUES (v_obs, v_org, v_item, v_src, v_line, 'm', 5.15, 4.5, 9.65, 'Probe Electrical', v_proj, 'Gauteng', DATE '2026-06-25');
  -- Two queued lines, worded differently, same contractor and same rate.
  INSERT INTO public.rate_source_lines (id, organisation_id, source_id, section_path, description, unit, supply_rate, install_rate, group_key, match_status)
    VALUES (v_l2, v_org, v_src, ARRAY['CONDUITS'], '20 mm PVC', 'm', 7, 3, 'g2', 'unmatched'),
           (v_l3, v_org, v_src, ARRAY['PVC CONDUIT'], '20mm dia', 'm', 7, 3, 'g3', 'unmatched');

  -- ── 1. Owner: reads, inserts (attribution bound), never edits a fact ─────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.rate_observations;            INSERT INTO _r VALUES ('owner_reads_observations', v_n = 1);
  SELECT count(*) INTO v_n FROM public.rate_items;                    INSERT INTO _r VALUES ('owner_reads_only_own_org_items', v_n = 1);
  SELECT count(*) INTO v_n FROM public.rate_source_lines;             INSERT INTO _r VALUES ('owner_reads_lines', v_n = 3);
  SELECT count(*) INTO v_n FROM public.rate_index_values WHERE series = 'statssa_cpi_headline';
  INSERT INTO _r VALUES ('owner_reads_cpi', v_n = 140);
  BEGIN
    INSERT INTO public.rate_observations (organisation_id, rate_item_id, source_id, unit, rate, contractor_name, priced_on, created_by)
      VALUES (v_org, v_item, v_src, 'm', 10, 'Probe Electrical', DATE '2026-06-25', v_con) RETURNING id, created_by INTO v_new, v_by;
    INSERT INTO _r VALUES ('owner_inserts_observation', v_new IS NOT NULL);
    INSERT INTO _r VALUES ('created_by_bound_to_caller', v_by = v_owner);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('owner_inserts_observation', false);
    INSERT INTO _r VALUES ('created_by_bound_to_caller', false);
  END;
  BEGIN
    UPDATE public.rate_observations SET rate = 1 WHERE id = v_obs;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('owner_update_observation_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('owner_update_observation_REFUSED', false);
  END;
  BEGIN
    DELETE FROM public.rate_observations WHERE id = v_obs;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('owner_delete_observation_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('owner_delete_observation_REFUSED', false);
  END;
  BEGIN
    INSERT INTO public.rate_observations (organisation_id, rate_item_id, source_id, unit, rate, contractor_name, priced_on)
      VALUES (v_org2, v_item2, v_src, 'm', 10, 'x', DATE '2026-06-25');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('owner_insert_foreign_org_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('owner_insert_foreign_org_REFUSED', false);
  END;
  BEGIN
    -- Own org on the row, another org's item: the composite FK refuses it.
    INSERT INTO public.rate_observations (organisation_id, rate_item_id, source_id, unit, rate, contractor_name, priced_on)
      VALUES (v_org, v_item2, v_src, 'm', 10, 'x', DATE '2026-06-25');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN foreign_key_violation THEN INSERT INTO _r VALUES ('cross_org_item_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('cross_org_item_REFUSED', false);
  END;
  BEGIN
    INSERT INTO public.rate_observations (organisation_id, kind, rate_item_id, source_id, supersedes_id, unit, contractor_name, priced_on, note)
      VALUES (v_org, 'void', v_item, v_src, v_obs, 'm', 'Probe Electrical', DATE '2026-06-25', 'wrong match');
    INSERT INTO _r VALUES ('owner_voids_by_new_row', true);
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('owner_voids_by_new_row', false);
  END;
  SELECT count(*) INTO v_n FROM public.rate_observations_active WHERE id = v_obs;
  INSERT INTO _r VALUES ('voided_observation_leaves_active_view', v_n = 0);
  BEGIN
    INSERT INTO public.rate_observations (organisation_id, kind, rate_item_id, source_id, supersedes_id, unit, contractor_name, priced_on)
      VALUES (v_org, 'void', v_item, v_src, v_obs, 'm', 'Probe Electrical', DATE '2026-06-25');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN unique_violation THEN INSERT INTO _r VALUES ('second_supersede_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('second_supersede_REFUSED', false);
  END;
  BEGIN
    UPDATE public.rate_source_lines SET supply_rate = 1 WHERE id = v_line;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('line_content_edit_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('line_content_edit_REFUSED', false);
  END;
  BEGIN
    UPDATE public.rate_source_lines SET match_status = 'rejected', matched_item_id = NULL WHERE id = v_line;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('line_review_state_editable', v_n = 1);
    SELECT reviewed_by INTO v_by FROM public.rate_source_lines WHERE id = v_line;
    INSERT INTO _r VALUES ('reviewed_by_bound_to_caller', v_by = v_owner);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('line_review_state_editable', false);
    INSERT INTO _r VALUES ('reviewed_by_bound_to_caller', false);
  END;
  BEGIN
    INSERT INTO public.rate_library_access_log (organisation_id, user_id, action) VALUES (v_org, v_con, 'export_budget')
      RETURNING user_id INTO v_by;
    INSERT INTO _r VALUES ('access_log_user_bound_to_caller', v_by = v_owner);
  EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('access_log_user_bound_to_caller', false);
  END;
  SELECT count(*) INTO v_n FROM public.rate_library_access_log;      INSERT INTO _r VALUES ('owner_reads_access_log', v_n = 1);
  -- Atomic ingest: one document in, observations linked to its line, re-run writes nothing.
  v_res := public.rate_library_ingest(v_org,
    jsonb_build_object('kind', 'historical_file', 'source_ref', 'ingest-probe', 'contractor_name', 'Probe B', 'province', 'Limpopo',
                       'priced_on', '2026-05-01', 'priced_on_basis', 'document_date'),
    jsonb_build_array(jsonb_build_object('code', 'CONDUIT-25-PVC-M', 'signature', 'conduit|m|dia=25|material=pvc', 'category', 'conduit',
                                         'description', 'Conduit, PVC, 25 mm dia', 'unit', 'm', 'attributes', '{}'::jsonb)),
    jsonb_build_array(jsonb_build_object('id', v_lid, 'section_path', ARRAY['CONDUIT'], 'description', '25mm Ø', 'unit', 'm',
                                         'supply_rate', 6, 'install_rate', 4, 'group_key', 'k', 'match_status', 'auto_confirmed',
                                         'matched_signature', 'conduit|m|dia=25|material=pvc', 'match_method', 'rule')),
    jsonb_build_array(jsonb_build_object('signature', 'conduit|m|dia=25|material=pvc', 'source_line_id', v_lid, 'occurrences', 3,
                                         'unit', 'm', 'supply_rate', 6, 'install_rate', 4, 'rate', 10)));
  INSERT INTO _r VALUES ('ingest_writes_source_lines_observation',
    (v_res->>'already')::boolean = false AND (v_res->>'lines')::int = 1 AND (v_res->>'observations')::int = 1 AND (v_res->>'items')::int = 1);
  SELECT count(*) INTO v_n FROM public.rate_observations o WHERE o.source_line_id = v_lid AND o.province = 'Limpopo' AND o.occurrences = 3;
  INSERT INTO _r VALUES ('ingest_observation_takes_source_fields', v_n = 1);
  v_res := public.rate_library_ingest(v_org, jsonb_build_object('kind', 'historical_file', 'source_ref', 'ingest-probe'), '[]', '[]', '[]');
  INSERT INTO _r VALUES ('ingest_rerun_is_a_no_op', (v_res->>'already')::boolean);
  BEGIN
    -- An auto-confirmed line naming an item that does not exist: the whole call must roll back.
    PERFORM public.rate_library_ingest(v_org,
      jsonb_build_object('kind', 'historical_file', 'source_ref', 'ingest-broken', 'contractor_name', 'X', 'priced_on', '2026-05-01', 'priced_on_basis', 'stated'),
      '[]', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'description', 'x', 'group_key', 'k', 'match_status', 'auto_confirmed',
                                                 'matched_signature', 'nope|m')), '[]');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('ingest_broken_payload_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('ingest_broken_payload_REFUSED', false);
  END;
  SELECT count(*) INTO v_n FROM public.rate_sources WHERE source_ref = 'ingest-broken';
  INSERT INTO _r VALUES ('ingest_broken_payload_leaves_nothing', v_n = 0);
  -- Confirm: one observation; the same rate from the same document again adds none.
  v_res := public.rate_library_confirm_lines(v_org, ARRAY[v_l2], v_item, 'manual');
  INSERT INTO _r VALUES ('confirm_adds_observation', (v_res->>'lines')::int = 1 AND (v_res->>'observations')::int = 1);
  v_res := public.rate_library_confirm_lines(v_org, ARRAY[v_l3], v_item, 'manual');
  INSERT INTO _r VALUES ('confirm_same_rate_twice_not_double_counted', (v_res->>'lines')::int = 1 AND (v_res->>'observations')::int = 0);
  BEGIN
    PERFORM public.rate_library_confirm_lines(v_org, ARRAY[v_l2, v_line], v_item, 'manual');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN serialization_failure THEN INSERT INTO _r VALUES ('confirm_lines_not_in_queue_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('confirm_lines_not_in_queue_REFUSED', false);
  END;
  SELECT count(*) INTO v_n FROM public.rate_source_lines WHERE id = v_line AND match_status = 'rejected';
  INSERT INTO _r VALUES ('refused_confirm_changed_nothing', v_n = 1);
  -- Retract: the observation leaves the statistics and BOTH its lines go back to the queue.
  SELECT id INTO v_new FROM public.rate_observations WHERE source_line_id = v_l2;
  v_res := public.rate_library_void_observation(v_org, v_new, 'assigned to the wrong item');
  INSERT INTO _r VALUES ('void_requeues_its_lines', (v_res->>'lines_requeued')::int = 2);
  SELECT count(*) INTO v_n FROM public.rate_observations_active WHERE id = v_new;
  INSERT INTO _r VALUES ('void_removes_from_active', v_n = 0);
  BEGIN
    UPDATE public.rate_items SET unit = 'no' WHERE id = v_item;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('item_unit_change_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('item_unit_change_REFUSED', false);
  END;
  RESET ROLE;

  -- ── 2. Org-level project manager: reads the library, not the audit log ───
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pm::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.rate_observations (organisation_id, rate_item_id, source_id, unit, rate, contractor_name, priced_on)
    VALUES (v_org, v_item, v_src, 'm', 11, 'Probe Electrical', DATE '2026-06-25');
  SELECT count(*) INTO v_n FROM public.rate_items;                    INSERT INTO _r VALUES ('pm_reads_items', v_n = 2);  -- the fixture item + the one the owner's ingest added
  SELECT count(*) INTO v_n FROM public.rate_library_access_log;      INSERT INTO _r VALUES ('pm_cannot_read_access_log', v_n = 0);
  RESET ROLE;

  -- ── 3. Everyone else in the org — and the other org — sees nothing ──────
  FOREACH u IN ARRAY ARRAY[v_con, v_cv, v_gone, v_admin2] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT (SELECT count(*) FROM public.rate_observations) + (SELECT count(*) FROM public.rate_sources)
         + (SELECT count(*) FROM public.rate_source_lines) + (SELECT count(*) FROM public.rate_observations_active)
         + (SELECT count(*) FROM public.rate_items WHERE organisation_id = v_org)
      INTO v_n;
    INSERT INTO _r VALUES ('sees_no_org_rates:' || CASE u WHEN v_con THEN 'contractor_promoted_pm' WHEN v_cv THEN 'client_viewer'
                                                       WHEN v_gone THEN 'deactivated_admin' ELSE 'other_org_admin' END, v_n = 0);
    BEGIN
      INSERT INTO public.rate_observations (organisation_id, rate_item_id, source_id, unit, rate, contractor_name, priced_on)
        VALUES (v_org, v_item, v_src, 'm', 1, 'x', DATE '2026-06-25');
      RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
    EXCEPTION
      WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('insert_REFUSED:' || u, true);
      WHEN OTHERS THEN INSERT INTO _r VALUES ('insert_REFUSED:' || u, false);
    END;
    BEGIN
      PERFORM public.rate_library_ingest(v_org, jsonb_build_object('kind', 'manual', 'source_ref', 'x' || u, 'contractor_name', 'X',
        'priced_on', '2026-05-01', 'priced_on_basis', 'stated'), '[]', '[]', '[]');
      RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
    EXCEPTION
      WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('ingest_REFUSED:' || u, true);
      WHEN OTHERS THEN INSERT INTO _r VALUES ('ingest_REFUSED:' || u, false);
    END;
    RESET ROLE;
  END LOOP;
  SELECT count(*) INTO v_n FROM _r WHERE k LIKE 'sees_no_org_rates:other_org_admin';
  -- the other org's admin does see their OWN item
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin2::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.rate_items;                    INSERT INTO _r VALUES ('other_org_admin_reads_own_item', v_n = 1);
  RESET ROLE;

  -- ── 4. anon: no access at all ───────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM count(*) FROM public.rate_observations;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('anon_read_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('anon_read_REFUSED', false);
  END;
  RESET ROLE;

  -- ── 5. Even postgres cannot rewrite a fact (the trigger is the floor) ───
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    UPDATE public.rate_observations SET rate = 1 WHERE id = v_obs;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('postgres_update_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('postgres_update_REFUSED', false);
  END;

  -- ── 6. A person who recorded rates can still be deleted; the facts stay ──
  BEGIN
    DELETE FROM auth.users WHERE id = v_pm;
    SELECT count(*) INTO v_n FROM public.rate_observations WHERE rate = 11 AND created_by IS NULL AND organisation_id = v_org;
    INSERT INTO _r VALUES ('deleting_a_user_keeps_their_observations', v_n = 1);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('deleting_a_user_keeps_their_observations', false);
    RAISE NOTICE 'user delete failed: %', SQLERRM;
  END;
END $$;

SELECT k AS check, v AS ok FROM _r ORDER BY k;
