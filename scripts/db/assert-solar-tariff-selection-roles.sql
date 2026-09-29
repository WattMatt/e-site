-- BEHAVIOURAL assertions for 00213_solar_tariff_selection, run as real roles.
--   00207…00210 are not in the production ledger yet, so dry-run the chain:
--     S=/private/tmp/claude-501/solar-2b; M=apps/edge-functions/supabase/migrations
--     cat $M/00207_solar_foundation.sql $M/00208_solar_org_settings.sql $M/00209_tariffs_schema.sql \
--         $M/00210_solar_meter_data.sql > "$S/chain-without-00213.sql"
--     scripts/db/dry-run-migration.sh "$S/chain-without-00213.sql" scripts/db/assert-solar-tariff-selection-roles.sql   (RED: aborts)
--     cat "$S/chain-without-00213.sql" $M/00213_solar_tariff_selection.sql > "$S/chain.sql"
--     scripts/db/dry-run-migration.sh "$S/chain.sql" scripts/db/assert-solar-tariff-selection-roles.sql               (GREEN)
-- Fixtures are minted inside the transaction and rolled back. WM-Consulting is
-- deliberately NOT used (it bypasses the paywall, so it has no negative case).
--
-- REFUSAL PATTERN (as the 00207/00209 assertion files): a "…_REFUSED" check
-- catches ONLY the SQLSTATE the design promises. When the statement is
-- (wrongly) allowed, the block raises P0001 itself so the subtransaction rolls
-- the write back and a mutation run cannot corrupt later checks. Any other
-- error is recorded as false.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_org      UUID := gen_random_uuid();   -- subscribed customer org
  v_org2     UUID := gen_random_uuid();   -- a second subscribed org (foreign)
  v_project  UUID := gen_random_uuid();
  v_project2 UUID := gen_random_uuid();   -- same org, second study (override-of-another-study probe)
  v_admin    UUID := gen_random_uuid();   -- org admin: implicit edit_financials
  v_fin      UUID := gen_random_uuid();   -- contractor granted edit_financials
  v_edit     UUID := gen_random_uuid();   -- contractor granted edit
  v_view     UUID := gen_random_uuid();   -- project_manager granted view
  v_client   UUID := gen_random_uuid();   -- client_viewer (never eligible)
  v_sup      UUID := gen_random_uuid();   -- supplier (never eligible)
  v_foreign  UUID := gen_random_uuid();   -- admin of the other subscribed org
  v_tadmin   UUID := gen_random_uuid();   -- platform tariff admin (allow-list row, no org)
  v_leaver   UUID := gen_random_uuid();   -- a reporter whose auth user is later deleted (no other rows)
  v_c25e     UUID;                        -- v_t25's energy charge
  v_c25b     UUID;                        -- v_t25b's energy charge (another tariff)
  v_oc2      UUID;
  v_ov3      UUID;
  v_rep2     UUID;
  v_cal      UUID;
  v_calj     JSONB;
  v_ss       UUID;
  v_upd2     TIMESTAMPTZ;
  v_ok       BOOLEAN;
  v_ok2      BOOLEAN;
  v_lic      UUID;
  v_lic2     UUID;
  v_src      UUID;
  v_y25      UUID;
  v_y26      UUID;
  v_t25      UUID;                        -- published tariff
  v_t25b     UUID;                        -- second published tariff, same year
  v_t26      UUID;                        -- DRAFT tariff
  v_study    UUID;
  v_study2   UUID;
  v_ov       UUID;
  v_ov2      UUID;
  v_oc       UUID;
  v_upd      TIMESTAMPTZ;
  v_rep      UUID;
  v_job      UUID;
  v_fp       TEXT;
  v_n        INT;
  v_txt      TEXT;
  u          UUID;
BEGIN
  -- ── Fixtures (as postgres) ────────────────────────────────────────────────
  INSERT INTO public.organisations (id, name) VALUES (v_org, 'tsel-probe-org'), (v_org2, 'tsel-probe-org-2');
  FOREACH u IN ARRAY ARRAY[v_admin, v_fin, v_edit, v_view, v_client, v_sup, v_foreign, v_tadmin, v_leaver] LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'tsel-probe-' || u || '@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  END LOOP;
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
    (v_admin, v_org, 'admin', TRUE), (v_fin, v_org, 'contractor', TRUE), (v_edit, v_org, 'contractor', TRUE),
    (v_view, v_org, 'project_manager', TRUE), (v_client, v_org, 'client_viewer', TRUE),
    (v_sup, v_org, 'supplier', TRUE), (v_foreign, v_org2, 'admin', TRUE);
  INSERT INTO projects.projects (id, organisation_id, name, created_by) VALUES
    (v_project, v_org, 'tsel-probe-project', v_admin), (v_project2, v_org, 'tsel-probe-project-2', v_admin);
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active) VALUES
    (v_project, v_fin, v_org, 'contractor', TRUE), (v_project, v_edit, v_org, 'contractor', TRUE),
    (v_project, v_view, v_org, 'project_manager', TRUE), (v_project, v_client, v_org, 'client_viewer', TRUE),
    (v_project, v_sup, v_org, 'supplier', TRUE), (v_project2, v_fin, v_org, 'contractor', TRUE);
  INSERT INTO billing.org_addon_subscriptions (organisation_id, feature_key, status, amount_kobo, current_period_end) VALUES
    (v_org, 'solar', 'active', 199900, now() + interval '1 year'),
    (v_org2, 'solar', 'active', 199900, now() + interval '1 year');
  INSERT INTO solar.project_access (project_id, user_id, organisation_id, level) VALUES
    (v_project, v_fin, v_org, 'edit_financials'), (v_project, v_edit, v_org, 'edit'),
    (v_project, v_view, v_org, 'view'), (v_project2, v_fin, v_org, 'edit_financials');
  INSERT INTO public.platform_tariff_admins (user_id) VALUES (v_tadmin);

  -- Library: licensee, a published 2025/26 year with two tariffs, a DRAFT 2026/27 year.
  INSERT INTO tariffs.licensee (kind, name, province) VALUES ('municipal', 'TSEL PROBE MUNICIPALITY', 'GP') RETURNING id INTO v_lic;
  INSERT INTO tariffs.licensee (kind, name, province) VALUES ('municipal', 'TSEL PROBE OTHER MUNICIPALITY', 'GP') RETURNING id INTO v_lic2;
  INSERT INTO tariffs.source_document (licensee_id, kind, title, financial_year, status, url)
  VALUES (v_lic, 'nersa_decision', 'tsel probe source', '2025/26', 'nersa_approved', 'https://example.invalid/tsel') RETURNING id INTO v_src;
  INSERT INTO tariffs.tariff_year (licensee_id, financial_year, effective_from, effective_to, approved_increase_pct, state)
  VALUES (v_lic, '2025/26', '2025-07-01', '2026-06-30', 12.72, 'in_review') RETURNING id INTO v_y25;
  INSERT INTO tariffs.tariff (tariff_year_id, name, category, metering, structure, min_kva, max_kva)
  VALUES (v_y25, 'TSEL Commercial Flat', 'commercial', 'conventional', 'flat', 0, 1000) RETURNING id INTO v_t25;
  INSERT INTO tariffs.tariff (tariff_year_id, name, category, metering, structure)
  VALUES (v_y25, 'TSEL Commercial Two', 'commercial', 'conventional', 'flat') RETURNING id INTO v_t25b;
  INSERT INTO tariffs.charge (tariff_id, component, unit, amount_excl_vat, vat_basis, extraction_method, source_document_id, source_locator)
  VALUES (v_t25, 'energy', 'c_per_kWh', 250, 'stated_excl', 'parser', v_src, '{"page": 3, "raw_text": "Energy 250.00 c/kWh"}'),
         (v_t25, 'basic', 'R_per_month', 400, 'stated_excl', 'parser', v_src, '{"page": 3}'),
         (v_t25b, 'energy', 'c_per_kWh', 260, 'stated_excl', 'parser', v_src, '{}');
  UPDATE tariffs.tariff_year SET validated_at = now(), validation_blocking = 0 WHERE id = v_y25;
  SELECT id INTO v_c25e FROM tariffs.charge WHERE tariff_id = v_t25 AND component = 'energy';
  SELECT id INTO v_c25b FROM tariffs.charge WHERE tariff_id = v_t25b AND component = 'energy';
  INSERT INTO tariffs.tariff_year (licensee_id, financial_year, effective_from, effective_to, state)
  VALUES (v_lic, '2026/27', '2026-07-01', '2027-06-30', 'in_review') RETURNING id INTO v_y26;
  INSERT INTO tariffs.tariff (tariff_year_id, name, category, metering, structure)
  VALUES (v_y26, 'TSEL Commercial Flat', 'commercial', 'conventional', 'flat') RETURNING id INTO v_t26;
  INSERT INTO tariffs.charge (tariff_id, component, unit, amount_excl_vat, vat_basis, extraction_method)
  VALUES (v_t26, 'energy', 'c_per_kWh', 280, 'stated_excl', 'parser');

  -- Publish 2025/26 as the platform admin (the guard needs a signed-in admin) …
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_tadmin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE tariffs.tariff_year SET state = 'published' WHERE id = v_y25;
  RESET ROLE;
  -- … then CLEAR the claim: it outlives RESET ROLE and would make the postgres
  -- seeding below run "as" the admin.
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO v_n FROM tariffs.tariff_year WHERE id = v_y25 AND state = 'published';
  INSERT INTO _r VALUES ('fixture_year_published', v_n = 1);

  INSERT INTO solar.studies (project_id, licensee_name, nmd_kva) VALUES (v_project, 'TSEL PROBE MUNICIPALITY', 500) RETURNING id INTO v_study;
  INSERT INTO solar.studies (project_id, licensee_name) VALUES (v_project2, 'TSEL PROBE MUNICIPALITY') RETURNING id INTO v_study2;
  -- The service path (auth.uid() NULL) may pin anything published: the guard only checks callers.
  UPDATE solar.studies SET tariff_id = v_t25 WHERE id = v_study2;

  -- ── 1. View level: reads the study, never money, never pins ───────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM solar.studies WHERE id = v_study;
  INSERT INTO _r VALUES ('view_reads_study', v_n = 1);
  UPDATE solar.studies SET tariff_id = v_t25 WHERE id = v_study;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('view_pin_tariff_filtered', v_n = 0);
  RESET ROLE;

  -- ── 2. Edit level: passes the row gate, refused by the money guard ────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_edit::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE solar.studies SET tariff_id = v_t25 WHERE id = v_study;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('edit_pin_tariff_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('edit_pin_tariff_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('edit_pin_tariff_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.studies SET escalation = '{"version": 1, "overrides": {"2": 20}}' WHERE id = v_study;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('edit_set_escalation_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('edit_set_escalation_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('edit_set_escalation_REFUSED', false);
  END;
  -- …but Site & Supply edits (other columns) still work for Edit (00207 unchanged).
  UPDATE solar.studies SET nmd_kva = 600 WHERE id = v_study;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('edit_still_saves_site_columns', v_n = 1);
  SELECT count(*) INTO v_n FROM solar.tariff_overrides;
  INSERT INTO _r VALUES ('edit_sees_no_overrides', v_n = 0);
  SELECT count(*) INTO v_n FROM solar.bill_checks;
  INSERT INTO _r VALUES ('edit_sees_no_bill_checks', v_n = 0);
  BEGIN
    INSERT INTO solar.bill_checks (study_id, billing_month, import_kwh_standard, actual_total_excl_vat,
                                   modelled_total_excl_vat, difference_pct, engine_version)
    VALUES (v_study, '2026-03-01', 1000, 3000, 2900, -3.333, 'probe');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('edit_insert_bill_check_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('edit_insert_bill_check_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('edit_insert_bill_check_REFUSED', false);
  END;
  BEGIN
    INSERT INTO tariffs.error_report (tariff_id, project_id, note) VALUES (v_t25, v_project, 'edit-level report');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('edit_report_error_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('edit_report_error_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('edit_report_error_REFUSED', false);
  END;
  RESET ROLE;

  -- ── 3. Edit + financials: pins, overrides, bill checks, export rates ──────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_fin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE solar.studies SET tariff_id = v_t26 WHERE id = v_study;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('fin_pin_draft_tariff_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('fin_pin_draft_tariff_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('fin_pin_draft_tariff_REFUSED', false);
  END;
  UPDATE solar.studies SET tariff_id = v_t25, licensee_id = v_lic2 WHERE id = v_study;
  SELECT count(*) INTO v_n FROM solar.studies WHERE id = v_study AND tariff_id = v_t25 AND licensee_id = v_lic;
  INSERT INTO _r VALUES ('fin_pins_published_tariff_licensee_rebound', v_n = 1);
  BEGIN
    UPDATE solar.studies SET export_rule = '{"version": 1, "method": "manual"}' WHERE id = v_study;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('manual_export_rule_without_note_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('manual_export_rule_without_note_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('manual_export_rule_without_note_REFUSED', false);
  END;
  UPDATE solar.studies SET export_rule = '{"version": 1, "method": "manual", "sourceNote": "City SSEG schedule 2026/27 p4"}',
                           escalation = '{"version": 1, "overrides": {"2": 12.5}}' WHERE id = v_study;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('fin_saves_export_rule_and_escalation', v_n = 1);
  INSERT INTO solar.study_export_rates (study_id, project_id, season, tou, unit, amount_excl_vat, source_note)
  VALUES (v_study, v_project2, 'all', 'all', 'c_per_kWh', 95, 'City SSEG schedule 2026/27 p4');
  SELECT count(*) INTO v_n FROM solar.study_export_rates WHERE study_id = v_study AND project_id = v_project AND organisation_id = v_org;
  INSERT INTO _r VALUES ('export_rate_project_bound_from_study', v_n = 1);

  -- The export rule and its rates save in ONE transaction (solar.save_export_rule).
  BEGIN
    PERFORM solar.save_export_rule(v_project, '2000-01-01'::timestamptz,
      '{"version": 1, "method": "manual", "sourceNote": "stale"}'::jsonb,
      '[{"season": "all", "tou": "all", "unit": "c_per_kWh", "amount_excl_vat": 1}]'::jsonb);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN serialization_failure THEN INSERT INTO _r VALUES ('export_rule_stale_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('export_rule_stale_REFUSED', false);
  END;
  SELECT count(*) INTO v_n FROM solar.study_export_rates WHERE study_id = v_study;
  SELECT count(*) = 1 AND v_n = 1 INTO v_ok FROM solar.study_export_rates WHERE study_id = v_study AND amount_excl_vat = 95;
  INSERT INTO _r VALUES ('export_rule_stale_left_rates_unchanged', v_ok);
  SELECT updated_at INTO v_upd FROM solar.studies WHERE id = v_study;
  BEGIN
    PERFORM solar.save_export_rule(v_project, v_upd, '{"version": 1, "method": "none"}'::jsonb,
      '[{"season": "all", "tou": "all", "unit": "c_per_kWh", "amount_excl_vat": 1}]'::jsonb);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('export_rule_rates_without_manual_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('export_rule_rates_without_manual_REFUSED', false);
  END;
  BEGIN
    SELECT updated_at INTO v_upd FROM solar.studies WHERE id = v_study;
    v_upd2 := solar.save_export_rule(v_project, v_upd,
      '{"version": 1, "method": "manual", "sourceNote": "City SSEG schedule 2026/27 p5"}'::jsonb,
      '[{"season": "all", "tou": "all", "unit": "c_per_kWh", "amount_excl_vat": 90}]'::jsonb);
    SELECT count(*) INTO v_n FROM solar.study_export_rates WHERE study_id = v_study;
    v_ok := v_n = 1
      AND EXISTS (SELECT 1 FROM solar.study_export_rates WHERE study_id = v_study AND amount_excl_vat = 90
                    AND source_note = 'City SSEG schedule 2026/27 p5' AND project_id = v_project)
      AND EXISTS (SELECT 1 FROM solar.studies WHERE id = v_study
                    AND export_rule->>'sourceNote' = 'City SSEG schedule 2026/27 p5' AND updated_at = v_upd2);
  EXCEPTION WHEN OTHERS THEN v_ok := false;
  END;
  INSERT INTO _r VALUES ('fin_save_export_rule_atomic', v_ok);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_edit::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT updated_at INTO v_upd FROM solar.studies WHERE id = v_study;
  BEGIN
    PERFORM solar.save_export_rule(v_project, v_upd, '{"version": 1, "method": "none"}'::jsonb, '[]'::jsonb);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('edit_save_export_rule_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('edit_save_export_rule_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_fin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- Override: stale expected timestamp refused, then created with every charge copied.
  BEGIN
    PERFORM solar.create_tariff_override(v_project, '2000-01-01'::timestamptz);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN serialization_failure THEN INSERT INTO _r VALUES ('create_override_stale_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('create_override_stale_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('create_override_stale_REFUSED', false);
  END;
  SELECT updated_at INTO v_upd FROM solar.studies WHERE id = v_study;
  v_ov := solar.create_tariff_override(v_project, v_upd);
  SELECT count(*) INTO v_n FROM solar.tariff_override_charges WHERE override_id = v_ov AND project_id = v_project;
  INSERT INTO _r VALUES ('override_copies_every_charge', v_n = 2);
  SELECT count(*) INTO v_n FROM solar.studies WHERE id = v_study AND tariff_override_id = v_ov;
  INSERT INTO _r VALUES ('override_linked_on_study', v_n = 1);
  SELECT id INTO v_oc FROM solar.tariff_override_charges WHERE override_id = v_ov AND component = 'energy';
  BEGIN
    UPDATE solar.tariff_override_charges SET amount_excl_vat = 199 WHERE id = v_oc;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('override_edit_without_reason_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('override_edit_without_reason_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('override_edit_without_reason_REFUSED', false);
  END;
  UPDATE solar.tariff_override_charges SET amount_excl_vat = 199, reason = 'Landlord resale rate per lease cl. 14', edited_by = v_admin,
                                           source_locator = '{"page": 77}'
   WHERE id = v_oc;
  SELECT count(*) INTO v_n FROM solar.tariff_override_charges WHERE id = v_oc AND edited_by = v_fin AND edited_at IS NOT NULL;
  INSERT INTO _r VALUES ('override_edit_stamped_to_caller', v_n = 1);
  SELECT count(*) INTO v_n FROM solar.tariff_override_charges WHERE id = v_oc AND source_locator->>'page' = '3';
  INSERT INTO _r VALUES ('override_edit_source_bound_to_base', v_n = 1);
  -- The same base charge cannot be copied twice into one override (double counting).
  BEGIN
    INSERT INTO solar.tariff_override_charges (override_id, project_id, organisation_id, base_charge_id, component, unit, amount_excl_vat, vat_basis)
    VALUES (v_ov, v_project, v_org, v_c25e, 'energy', 'c_per_kWh', 250, 'stated_excl');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN unique_violation THEN INSERT INTO _r VALUES ('duplicate_unedited_copy_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('duplicate_unedited_copy_REFUSED', false);
  END;
  -- Provenance: a row claiming a base charge of ANOTHER tariff, or a changed rate, is an edit and needs a reason.
  BEGIN
    INSERT INTO solar.tariff_override_charges (override_id, project_id, organisation_id, base_charge_id, component, unit, amount_excl_vat, vat_basis)
    VALUES (v_ov, v_project, v_org, v_c25b, 'energy', 'c_per_kWh', 260, 'stated_excl');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('override_insert_foreign_base_charge_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('override_insert_foreign_base_charge_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.tariff_override_charges (override_id, project_id, organisation_id, base_charge_id, component, unit, amount_excl_vat, vat_basis)
    VALUES (v_ov, v_project, v_org, v_c25e, 'energy', 'c_per_kWh', 111, 'stated_excl');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('override_insert_altered_rate_without_reason_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('override_insert_altered_rate_without_reason_REFUSED', false);
  END;
  -- On a fresh override (study2's, replaced inside a rolled-back block): an unedited copy carries no
  -- reason and its source comes from the base charge; an edited copy's source does too.
  BEGIN
    UPDATE solar.studies SET tariff_override_id = NULL WHERE id = v_study2;
    DELETE FROM solar.tariff_overrides WHERE id = v_ov2;
    INSERT INTO solar.tariff_overrides (study_id, project_id, organisation_id, base_tariff_id)
    VALUES (v_study2, v_project2, v_org, v_t25) RETURNING id INTO v_ov3;
    INSERT INTO solar.tariff_override_charges (override_id, project_id, organisation_id, base_charge_id, component, unit, amount_excl_vat, vat_basis,
                                               source_locator, reason)
    VALUES (v_ov3, v_project2, v_org, v_c25e, 'energy', 'c_per_kWh', 250, 'stated_excl', '{"page": 99}', 'forged')
    RETURNING id INTO v_oc2;
    SELECT count(*) = 1 INTO v_ok FROM solar.tariff_override_charges
     WHERE id = v_oc2 AND edited_at IS NULL AND reason IS NULL AND source_locator->>'page' = '3';
    INSERT INTO solar.tariff_override_charges (override_id, project_id, organisation_id, base_charge_id, component, unit, amount_excl_vat, vat_basis,
                                               source_locator, reason)
    SELECT v_ov3, v_project2, v_org, c.id, 'basic', 'R_per_month', 450, 'stated_excl', '{"page": 99}', 'Landlord basic'
      FROM tariffs.charge c WHERE c.tariff_id = v_t25 AND c.component = 'basic'
    RETURNING id INTO v_oc2;
    SELECT count(*) = 1 INTO v_ok2 FROM solar.tariff_override_charges
     WHERE id = v_oc2 AND edited_at IS NOT NULL AND source_locator->>'page' = '3';
    RAISE EXCEPTION 'undo' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN raise_exception THEN NULL;
    WHEN OTHERS THEN v_ok := false; v_ok2 := false;
  END;
  INSERT INTO _r VALUES ('override_insert_edited_source_bound_to_base', v_ok2);
  INSERT INTO _r VALUES ('override_insert_unedited_copy_bound_to_base', v_ok);
  -- The reason and source change only with the rate: an edit of either alone is refused, never a silent no-op.
  BEGIN
    UPDATE solar.tariff_override_charges SET reason = 'rewritten later' WHERE id = v_oc;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('override_reason_only_edit_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('override_reason_only_edit_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.tariff_override_charges SET source_locator = '{"page": 99}' WHERE id = v_oc;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('override_source_only_edit_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('override_source_only_edit_REFUSED', false);
  END;
  SELECT count(*) INTO v_n FROM solar.tariff_override_charges
   WHERE id = v_oc AND reason = 'Landlord resale rate per lease cl. 14' AND source_locator->>'page' = '3';
  INSERT INTO _r VALUES ('override_reason_and_source_unchanged_after_refusals', v_n = 1);
  -- A row leaves only with its override (revert), never on its own.
  BEGIN
    DELETE FROM solar.tariff_override_charges WHERE id = v_oc;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('override_charge_delete_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('override_charge_delete_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.studies SET tariff_id = v_t25b WHERE id = v_study;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('change_tariff_under_override_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('change_tariff_under_override_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('change_tariff_under_override_REFUSED', false);
  END;
  -- An override belonging to ANOTHER study cannot be attached here.
  SELECT updated_at INTO v_upd FROM solar.studies WHERE id = v_study2;
  v_ov2 := solar.create_tariff_override(v_project2, v_upd);
  BEGIN
    UPDATE solar.studies SET tariff_override_id = v_ov2 WHERE id = v_study;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('foreign_override_attach_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('foreign_override_attach_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('foreign_override_attach_REFUSED', false);
  END;

  INSERT INTO solar.bill_checks (study_id, project_id, billing_month, import_kwh_standard, actual_total_excl_vat,
                                 modelled_total_excl_vat, difference_pct, engine_version, tariff_id)
  VALUES (v_study, v_project2, '2026-03-01', 1000, 3000, 2900, -3.333, 'probe', v_t25);
  SELECT count(*) INTO v_n FROM solar.bill_checks WHERE study_id = v_study AND project_id = v_project AND created_by = v_fin;
  INSERT INTO _r VALUES ('fin_bill_check_bound_and_stamped', v_n = 1);
  SELECT count(*) INTO v_n FROM solar.bill_checks WHERE study_id = v_study AND tariff_id = v_t25 AND tariff_override_id = v_ov;
  INSERT INTO _r VALUES ('bill_check_tariff_and_override_bound_from_study', v_n = 1);
  BEGIN
    INSERT INTO solar.bill_checks (study_id, billing_month, import_kwh_standard, actual_total_excl_vat,
                                   modelled_total_excl_vat, difference_pct, engine_version, tariff_id, tariff_override_id)
    VALUES (v_study, '2026-04-01', 1000, 3000, 2900, -3.333, 'probe', v_t25, v_ov2);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('bill_check_forged_override_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('bill_check_forged_override_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.bill_checks (study_id, billing_month, import_kwh_standard, actual_total_excl_vat,
                                   modelled_total_excl_vat, difference_pct, engine_version, tariff_id)
    VALUES (v_study, '2026-04-01', 1000, 3000, 2900, -3.333, 'probe', v_t25b);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('bill_check_other_tariff_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('bill_check_other_tariff_REFUSED', false);
  END;
  -- An override missing some of the tariff's charges cannot be linked (REST path around create_tariff_override).
  BEGIN
    UPDATE solar.studies SET tariff_override_id = NULL WHERE id = v_study2;
    DELETE FROM solar.tariff_overrides WHERE id = v_ov2;
    INSERT INTO solar.tariff_overrides (study_id, project_id, organisation_id, base_tariff_id)
    VALUES (v_study2, v_project2, v_org, v_t25) RETURNING id INTO v_ov3;
    INSERT INTO solar.tariff_override_charges (override_id, project_id, organisation_id, base_charge_id, component, unit, amount_excl_vat, vat_basis)
    VALUES (v_ov3, v_project2, v_org, v_c25e, 'energy', 'c_per_kWh', 250, 'stated_excl');
    UPDATE solar.studies SET tariff_override_id = v_ov3 WHERE id = v_study2;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('link_incomplete_override_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('link_incomplete_override_REFUSED', false);
  END;
  SELECT count(*) INTO v_n FROM solar.studies WHERE id = v_study2 AND tariff_override_id = v_ov2;
  INSERT INTO _r VALUES ('refused_link_left_study2_override', v_n = 1);
  BEGIN
    INSERT INTO solar.bill_checks (study_id, billing_month, import_kwh_standard, actual_total_excl_vat,
                                   modelled_total_excl_vat, difference_pct, engine_version)
    VALUES (v_study, '2026-03-15', 1000, 3000, 2900, -3.333, 'probe');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('bill_check_mid_month_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('bill_check_mid_month_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('bill_check_mid_month_REFUSED', false);
  END;

  INSERT INTO tariffs.error_report (tariff_id, project_id, note, reporter_id, status)
  VALUES (v_t25, v_project, 'Basic charge looks like last year''s', v_admin, 'resolved') RETURNING id INTO v_rep;
  SELECT count(*) INTO v_n FROM tariffs.error_report WHERE id = v_rep AND reporter_id = v_fin AND status = 'open';
  INSERT INTO _r VALUES ('fin_report_bound_reporter_and_open', v_n = 1);
  UPDATE tariffs.error_report SET status = 'resolved' WHERE id = v_rep;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('reporter_cannot_resolve', v_n = 0);
  BEGIN
    INSERT INTO tariffs.ingest_job (source_document_id, parser, financial_year) VALUES (v_src, 'rfd_pdf', '2025/26');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('customer_queue_ingest_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('customer_queue_ingest_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('customer_queue_ingest_REFUSED', false);
  END;
  RESET ROLE;

  -- ── 4. View / Edit / client / supplier / foreign never read money ─────────
  FOREACH u IN ARRAY ARRAY[v_view, v_edit, v_client, v_sup, v_foreign] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT (SELECT count(*) FROM solar.tariff_overrides) + (SELECT count(*) FROM solar.tariff_override_charges)
         + (SELECT count(*) FROM solar.study_export_rates) + (SELECT count(*) FROM solar.bill_checks)
      INTO v_n;
    INSERT INTO _r VALUES ('no_money_rows_for_' || CASE u WHEN v_view THEN 'view' WHEN v_edit THEN 'edit'
                           WHEN v_client THEN 'client' WHEN v_sup THEN 'supplier' ELSE 'foreign' END, v_n = 0);
    SELECT count(*) INTO v_n FROM tariffs.error_report;
    INSERT INTO _r VALUES ('no_error_reports_for_' || CASE u WHEN v_view THEN 'view' WHEN v_edit THEN 'edit'
                           WHEN v_client THEN 'client' WHEN v_sup THEN 'supplier' ELSE 'foreign' END, v_n = 0);
    RESET ROLE;
  END LOOP;

  -- ── 5. Admin (implicit edit_financials) reads money ───────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM solar.tariff_override_charges WHERE override_id = v_ov;
  INSERT INTO _r VALUES ('org_admin_reads_override_charges', v_n = 2);
  SELECT updated_at INTO v_upd FROM solar.studies WHERE id = v_study;
  PERFORM solar.revert_tariff_override(v_project, v_upd);
  SELECT count(*) INTO v_n FROM solar.tariff_overrides WHERE id = v_ov;
  INSERT INTO _r VALUES ('revert_deletes_override', v_n = 0);
  SELECT count(*) INTO v_n FROM solar.studies WHERE id = v_study AND tariff_override_id IS NULL AND tariff_id = v_t25;
  INSERT INTO _r VALUES ('revert_keeps_published_pin', v_n = 1);
  -- An unlinked (orphan) override for the study cannot block a new one forever.
  BEGIN
    INSERT INTO solar.tariff_overrides (study_id, project_id, organisation_id, base_tariff_id)
    VALUES (v_study, v_project, v_org, v_t25) RETURNING id INTO v_oc2;
    SELECT updated_at INTO v_upd FROM solar.studies WHERE id = v_study;
    v_ov3 := solar.create_tariff_override(v_project, v_upd);
    SELECT count(*) INTO v_n FROM solar.tariff_overrides WHERE study_id = v_study;
    v_ok := v_n = 1 AND v_ov3 <> v_oc2
      AND EXISTS (SELECT 1 FROM solar.studies WHERE id = v_study AND tariff_override_id = v_ov3);
  EXCEPTION WHEN OTHERS THEN v_ok := false;
  END;
  INSERT INTO _r VALUES ('create_override_replaces_orphan', v_ok);
  RESET ROLE;

  -- ── 6. Platform tariff admin: reads + resolves reports, queues jobs ───────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_tadmin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM tariffs.error_report WHERE id = v_rep;
  INSERT INTO _r VALUES ('tariff_admin_reads_report', v_n = 1);
  UPDATE tariffs.error_report SET status = 'resolved', resolution_note = 'Corrected in 2026/27', resolved_by = v_fin WHERE id = v_rep;
  SELECT count(*) INTO v_n FROM tariffs.error_report WHERE id = v_rep AND status = 'resolved' AND resolved_by = v_tadmin AND resolved_at IS NOT NULL;
  INSERT INTO _r VALUES ('tariff_admin_resolves_report_stamped', v_n = 1);
  BEGIN
    UPDATE tariffs.error_report SET note = 'rewritten' WHERE id = v_rep;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('report_note_rewrite_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('report_note_rewrite_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('report_note_rewrite_REFUSED', false);
  END;
  INSERT INTO tariffs.ingest_job (source_document_id, parser, financial_year, licensee_name, status, requested_by)
  VALUES (v_src, 'rfd_pdf', '2025/26', 'TSEL PROBE MUNICIPALITY', 'succeeded', v_fin) RETURNING id INTO v_job;
  SELECT count(*) INTO v_n FROM tariffs.ingest_job WHERE id = v_job AND status = 'queued' AND requested_by = v_tadmin;
  INSERT INTO _r VALUES ('tariff_admin_queues_job_status_forced', v_n = 1);
  BEGIN
    UPDATE tariffs.ingest_job SET status = 'succeeded' WHERE id = v_job;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('tariff_admin_job_update_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('tariff_admin_job_update_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('tariff_admin_job_update_REFUSED', false);
  END;
  BEGIN
    PERFORM tariffs.record_year_validation(v_y26, 0, 'x');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('tariff_admin_record_validation_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('tariff_admin_record_validation_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('tariff_admin_record_validation_REFUSED', false);
  END;
  -- TOU calendars save in ONE transaction (tariffs.save_tou_calendar), stale-guarded.
  BEGIN
    v_calj := tariffs.save_tou_calendar(NULL, NULL,
      jsonb_build_object('licensee_id', v_lic, 'valid_from', '2025-07-01', 'valid_to', NULL,
                         'high_season_months', jsonb_build_array(6, 7, 8), 'source', 'assumed_eskom'),
      '[{"season": "high", "day_type": "weekday", "start_minute": 360, "end_minute": 540, "period": "peak"}]'::jsonb, 'sunday');
    v_cal := (v_calj->>'id')::uuid;
    v_ok := (SELECT count(*) FROM tariffs.tou_window WHERE calendar_id = v_cal) = 1
      AND EXISTS (SELECT 1 FROM tariffs.holiday_rule WHERE calendar_id = v_cal AND treated_as = 'sunday')
      AND EXISTS (SELECT 1 FROM tariffs.tou_calendar WHERE id = v_cal AND updated_at = (v_calj->>'updated_at')::timestamptz);
  EXCEPTION WHEN OTHERS THEN v_ok := false;
  END;
  INSERT INTO _r VALUES ('tariff_admin_creates_calendar', v_ok);
  BEGIN
    PERFORM tariffs.save_tou_calendar(v_cal, '2000-01-01'::timestamptz,
      jsonb_build_object('licensee_id', v_lic, 'valid_from', '2025-07-01', 'high_season_months', jsonb_build_array(6, 7, 8), 'source', 'assumed_eskom'),
      '[]'::jsonb, NULL);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN serialization_failure THEN INSERT INTO _r VALUES ('calendar_save_stale_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('calendar_save_stale_REFUSED', false);
  END;
  SELECT count(*) INTO v_n FROM tariffs.tou_window WHERE calendar_id = v_cal;
  INSERT INTO _r VALUES ('calendar_stale_left_windows', v_n = 1);
  BEGIN
    v_upd := (v_calj->>'updated_at')::timestamptz;
    v_calj := tariffs.save_tou_calendar(v_cal, v_upd,
      jsonb_build_object('licensee_id', v_lic, 'valid_from', '2025-07-01', 'high_season_months', jsonb_build_array(6, 7, 8), 'source', 'assumed_eskom'),
      '[{"season": "high", "day_type": "weekday", "start_minute": 360, "end_minute": 540, "period": "peak"},
        {"season": "low", "day_type": "weekday", "start_minute": 420, "end_minute": 600, "period": "peak"}]'::jsonb, NULL);
    v_ok := (SELECT count(*) FROM tariffs.tou_window WHERE calendar_id = v_cal) = 2
      AND NOT EXISTS (SELECT 1 FROM tariffs.holiday_rule WHERE calendar_id = v_cal)
      AND (v_calj->>'updated_at')::timestamptz > v_upd;
  EXCEPTION WHEN OTHERS THEN v_ok := false;
  END;
  INSERT INTO _r VALUES ('tariff_admin_saves_calendar_replacing_windows', v_ok);
  -- SSEG rule rows carry updated_at so the admin save is stale-guarded.
  BEGIN
    INSERT INTO tariffs.sseg_rule (tariff_year_id, licensee_id, crediting, carry_forward, fy_end_month, cap_rule)
    VALUES (v_y26, v_lic, 'net_billing_tou', 'none', 6, 'kwh_per_tou_period') RETURNING id INTO v_ss;
    SELECT updated_at INTO v_upd FROM tariffs.sseg_rule WHERE id = v_ss;
    UPDATE tariffs.sseg_rule SET max_kva = 500 WHERE id = v_ss;
    v_ok := EXISTS (SELECT 1 FROM tariffs.sseg_rule WHERE id = v_ss AND updated_at > v_upd);
  EXCEPTION WHEN OTHERS THEN v_ok := false;
  END;
  INSERT INTO _r VALUES ('sseg_rule_updated_at_bumps', v_ok);
  RESET ROLE;
  -- A customer (reads calendars) cannot save one.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_fin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM tariffs.save_tou_calendar(v_cal, (v_calj->>'updated_at')::timestamptz,
      jsonb_build_object('licensee_id', v_lic, 'valid_from', '2025-07-01', 'high_season_months', jsonb_build_array(6, 7, 8), 'source', 'assumed_eskom'),
      '[]'::jsonb, NULL);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('non_admin_save_calendar_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('non_admin_save_calendar_REFUSED', false);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── 7. Service role: validation fingerprint, job claim, bypass ────────────
  SET LOCAL ROLE service_role;
  v_fp := tariffs.year_content_fingerprint(v_y26);
  PERFORM tariffs.record_year_validation(v_y26, 0, v_fp);
  SELECT count(*) INTO v_n FROM tariffs.tariff_year WHERE id = v_y26 AND validated_at IS NOT NULL AND validation_blocking = 0;
  INSERT INTO _r VALUES ('service_records_validation_on_matching_fingerprint', v_n = 1);
  UPDATE tariffs.charge SET amount_excl_vat = 281 WHERE tariff_id = v_t26;
  BEGIN
    PERFORM tariffs.record_year_validation(v_y26, 0, v_fp);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN serialization_failure THEN INSERT INTO _r VALUES ('stale_fingerprint_validation_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('stale_fingerprint_validation_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('stale_fingerprint_validation_REFUSED', false);
  END;
  SELECT count(*) INTO v_n FROM tariffs.claim_ingest_job() c WHERE c.id = v_job AND c.status = 'running';
  INSERT INTO _r VALUES ('service_claims_queued_job', v_n = 1);
  SELECT count(*) INTO v_n FROM tariffs.claim_ingest_job() c WHERE c.id = v_job;
  INSERT INTO _r VALUES ('claimed_job_not_claimed_twice', v_n = 0);
  SELECT count(*) INTO v_n FROM solar.bill_checks WHERE study_id = v_study;
  INSERT INTO _r VALUES ('service_role_reads_bill_checks', v_n = 1);
  RESET ROLE;

  -- ── 8. Deleting a reporter's auth user keeps the report (FK SET NULL) ─────
  INSERT INTO tariffs.error_report (tariff_id, project_id, note, reporter_id)
  VALUES (v_t25, v_project, 'filed by someone who later leaves', v_leaver) RETURNING id INTO v_rep2;
  BEGIN
    DELETE FROM auth.users WHERE id = v_leaver;
    SELECT count(*) = 1 INTO v_ok FROM tariffs.error_report WHERE id = v_rep2 AND reporter_id IS NULL;
  EXCEPTION WHEN OTHERS THEN v_ok := false;
  END;
  INSERT INTO _r VALUES ('reporter_user_delete_keeps_report', v_ok);

  -- ── 8b. Due-year monitor (cron runs as postgres) ──────────────────────────
  v_n := tariffs.record_due_year_alerts('municipal', DATE '2026-07-02');
  SELECT count(*) INTO v_n FROM tariffs.due_year_alert
   WHERE licensee_id = v_lic AND missing_financial_year = '2026/27' AND latest_published_fy = '2025/26' AND resolved_at IS NULL;
  INSERT INTO _r VALUES ('monitor_alerts_licensee_without_current_year', v_n = 1);
  SELECT count(*) INTO v_n FROM tariffs.due_year_alert WHERE licensee_id = v_lic2;
  INSERT INTO _r VALUES ('monitor_ignores_never_ingested_licensee', v_n = 0);
  PERFORM tariffs.record_due_year_alerts('municipal', DATE '2026-07-02');
  SELECT count(*) INTO v_n FROM tariffs.due_year_alert WHERE licensee_id = v_lic;
  INSERT INTO _r VALUES ('monitor_is_idempotent', v_n = 1);
  PERFORM tariffs.record_due_year_alerts('municipal', DATE '2026-01-15');
  SELECT count(*) INTO v_n FROM tariffs.due_year_alert WHERE licensee_id = v_lic AND resolved_at IS NOT NULL;
  INSERT INTO _r VALUES ('monitor_resolves_when_covered', v_n = 1);
  BEGIN
    PERFORM tariffs.record_due_year_alerts('weekly', DATE '2026-01-15');
    INSERT INTO _r VALUES ('monitor_unknown_regime_REFUSED', false);
  EXCEPTION WHEN invalid_parameter_value THEN
    INSERT INTO _r VALUES ('monitor_unknown_regime_REFUSED', true);
  END;

  -- ── 9. Lapse: hidden but kept ─────────────────────────────────────────────
  UPDATE billing.org_addon_subscriptions SET status = 'cancelled' WHERE organisation_id = v_org;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_fin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM solar.bill_checks;
  INSERT INTO _r VALUES ('lapsed_fin_reads_no_money', v_n = 0);
  UPDATE solar.studies SET tariff_id = v_t25b WHERE id = v_study;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('lapsed_fin_pin_filtered', v_n = 0);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO v_n FROM solar.bill_checks WHERE study_id = v_study;
  INSERT INTO _r VALUES ('lapsed_rows_kept', v_n = 1);

  -- ── 10. anon: nothing ─────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM solar.bill_checks LIMIT 1;
    INSERT INTO _r VALUES ('anon_bill_checks_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_bill_checks_REFUSED', true);
  END;
  BEGIN
    PERFORM 1 FROM tariffs.error_report LIMIT 1;
    INSERT INTO _r VALUES ('anon_error_report_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_error_report_REFUSED', true);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
END $$;

SELECT k AS "check", v AS ok FROM _r ORDER BY k;
