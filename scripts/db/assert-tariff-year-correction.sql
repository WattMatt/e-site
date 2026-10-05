-- BEHAVIOURAL assertions for 00236_tariff_year_correction, run as real roles.
--   scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00236_tariff_year_correction.sql \
--       scripts/db/assert-tariff-year-correction.sql                                   (GREEN)
--   RED first: the same with an empty migration file (no correction path exists).
-- Fixtures are minted inside the transaction and rolled back.
--
-- What is proven: a published or superseded year is corrected only by a draft that names it
-- (replaces_year_id, written by the service path), at most once; publishing that draft moves
-- the old year to 'replaced' inside the guard and nowhere else; a replaced year is as immutable
-- as a published one and still readable by a library reader (a study pinned to it keeps
-- loading); a plain second draft for a financial year that is already live is refused.
--
-- REFUSAL PATTERN (as assert-tariffs-schema-roles.sql): a "…_REFUSED" check catches ONLY the
-- SQLSTATE the design promises; a wrongly-allowed statement raises P0001 so its subtransaction
-- rolls back and later checks stay honest; any other error records false.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_org    UUID := gen_random_uuid();   -- subscribed customer org
  v_admin  UUID := gen_random_uuid();   -- platform tariff admin (allow-list row)
  v_sub    UUID := gen_random_uuid();   -- contractor in the subscribed org (a library reader)
  v_lic    UUID;
  v_y25 UUID; v_y26 UUID; v_c25 UUID; v_c26 UUID;
  v_t UUID; v_tr26 UUID;
  v_n INT;
  u   UUID;
BEGIN
  -- ── Fixtures (as postgres) ────────────────────────────────────────────────
  INSERT INTO public.organisations (id, name) VALUES (v_org, 'tariff-correction-probe-org');
  FOREACH u IN ARRAY ARRAY[v_admin, v_sub] LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'tariff-correction-probe-' || u || '@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  END LOOP;
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES (v_sub, v_org, 'contractor', TRUE);
  INSERT INTO billing.org_addon_subscriptions (organisation_id, feature_key, status, amount_kobo, current_period_end)
  VALUES (v_org, 'solar', 'active', 199900, now() + interval '1 year');
  INSERT INTO public.platform_tariff_admins (user_id, added_by) VALUES (v_admin, NULL);
  INSERT INTO tariffs.licensee (kind, name, province) VALUES ('municipal', 'TARIFF CORRECTION PROBE', 'GP') RETURNING id INTO v_lic;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  -- Two published years the ordinary way: 2025/26, then 2026/27 (which supersedes 2025/26).
  INSERT INTO tariffs.tariff_year (licensee_id, financial_year, effective_from, effective_to, state)
  VALUES (v_lic, '2025/26', '2025-07-01', '2026-06-30', 'in_review') RETURNING id INTO v_y25;
  INSERT INTO tariffs.tariff (tariff_year_id, name, category, metering, structure)
  VALUES (v_y25, 'Probe Domestic', 'domestic', 'conventional', 'flat') RETURNING id INTO v_t;
  INSERT INTO tariffs.charge (tariff_id, component, unit, amount_excl_vat, vat_basis, extraction_method)
  VALUES (v_t, 'energy', 'c_per_kWh', 250, 'assumed_excl', 'parser');
  INSERT INTO tariffs.tariff_year (licensee_id, financial_year, effective_from, effective_to, state)
  VALUES (v_lic, '2026/27', '2026-07-01', '2027-06-30', 'in_review') RETURNING id INTO v_y26;
  INSERT INTO tariffs.tariff (tariff_year_id, name, category, metering, structure)
  VALUES (v_y26, 'Based on the available information and the analysis performed, the REC decided:', 'other', 'both', 'flat') RETURNING id INTO v_tr26;
  INSERT INTO tariffs.charge (tariff_id, component, unit, amount_excl_vat, vat_basis, extraction_method)
  VALUES (v_tr26, 'energy', 'c_per_kWh', 471.38, 'assumed_excl', 'parser');
  UPDATE tariffs.tariff_year SET validated_at = now(), validation_blocking = 0 WHERE id IN (v_y25, v_y26);
  SET LOCAL ROLE authenticated;
  UPDATE tariffs.tariff_year SET state = 'published' WHERE id = v_y25;
  UPDATE tariffs.tariff_year SET state = 'published' WHERE id = v_y26;
  RESET ROLE;
  SELECT count(*) INTO v_n FROM tariffs.tariff_year WHERE (id = v_y25 AND state = 'superseded') OR (id = v_y26 AND state = 'published');
  INSERT INTO _r VALUES ('fixture_two_live_years', v_n = 2);

  -- ── 1. A plain second draft for a live financial year is refused ──────────
  BEGIN
    INSERT INTO tariffs.tariff_year (licensee_id, financial_year, effective_from, effective_to, state)
    VALUES (v_lic, '2026/27', '2026-07-01', '2027-06-30', 'ingesting');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('plain_draft_for_live_fy_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('plain_draft_for_live_fy_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('plain_draft_for_live_fy_REFUSED', false);
  END;

  -- ── 2. The service path opens a correction draft that names the live year ─
  INSERT INTO tariffs.tariff_year (licensee_id, financial_year, effective_from, effective_to, state, replaces_year_id)
  VALUES (v_lic, '2026/27', '2026-07-01', '2027-06-30', 'ingesting', v_y26) RETURNING id INTO v_c26;
  INSERT INTO _r VALUES ('correction_draft_opened', v_c26 IS NOT NULL);
  BEGIN
    INSERT INTO tariffs.tariff_year (licensee_id, financial_year, effective_from, effective_to, state, replaces_year_id)
    VALUES (v_lic, '2026/27', '2026-07-01', '2027-06-30', 'ingesting', v_y26);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN unique_violation THEN INSERT INTO _r VALUES ('second_correction_of_same_year_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('second_correction_of_same_year_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('second_correction_of_same_year_REFUSED', false);
  END;
  BEGIN
    INSERT INTO tariffs.tariff_year (licensee_id, financial_year, effective_from, effective_to, state, replaces_year_id)
    VALUES (v_lic, '2024/25', '2024-07-01', '2025-06-30', 'ingesting', v_y25);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('correction_of_other_fy_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('correction_of_other_fy_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('correction_of_other_fy_REFUSED', false);
  END;
  BEGIN
    UPDATE tariffs.tariff_year SET replaces_year_id = NULL WHERE id = v_c26;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('correction_target_change_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('correction_target_change_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('correction_target_change_REFUSED', false);
  END;

  -- ── 3. Nobody moves a year to 'replaced' by hand ──────────────────────────
  BEGIN
    UPDATE tariffs.tariff_year SET state = 'replaced' WHERE id = v_y26;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('service_replace_by_hand_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('service_replace_by_hand_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('service_replace_by_hand_REFUSED', false);
  END;
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE tariffs.tariff_year SET state = 'replaced' WHERE id = v_y26;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('admin_replace_by_hand_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('admin_replace_by_hand_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('admin_replace_by_hand_REFUSED', false);
  END;
  RESET ROLE;

  -- ── 4. Publishing the correction replaces the old year, atomically ────────
  INSERT INTO tariffs.tariff (tariff_year_id, name, category, metering, structure)
  VALUES (v_c26, 'Megaflex', 'industrial', 'both', 'tou') RETURNING id INTO v_t;
  INSERT INTO tariffs.charge (tariff_id, component, season, tou, unit, amount_excl_vat, vat_basis, extraction_method)
  VALUES (v_t, 'energy', 'high', 'peak', 'c_per_kWh', 783.03, 'assumed_excl', 'parser');
  UPDATE tariffs.tariff_year SET state = 'in_review' WHERE id = v_c26;
  UPDATE tariffs.tariff_year SET validated_at = now(), validation_blocking = 0 WHERE id = v_c26;
  SET LOCAL ROLE authenticated;
  UPDATE tariffs.tariff_year SET state = 'published' WHERE id = v_c26;
  RESET ROLE;
  SELECT count(*) INTO v_n FROM tariffs.tariff_year WHERE id = v_c26 AND state = 'published' AND published_by = v_admin;
  INSERT INTO _r VALUES ('correction_published', v_n = 1);
  SELECT count(*) INTO v_n FROM tariffs.tariff_year WHERE id = v_y26 AND state = 'replaced' AND superseded_at IS NOT NULL AND published_at IS NOT NULL;
  INSERT INTO _r VALUES ('old_year_replaced_with_history_kept', v_n = 1);
  SELECT count(*) INTO v_n FROM tariffs.tariff_year WHERE licensee_id = v_lic AND state = 'published';
  INSERT INTO _r VALUES ('still_exactly_one_published', v_n = 1);

  -- ── 5. A replaced year is immutable ───────────────────────────────────────
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE tariffs.charge SET amount_excl_vat = 1 WHERE tariff_id = v_tr26;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('replaced_charge_update_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('replaced_charge_update_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('replaced_charge_update_REFUSED', false);
  END;
  BEGIN
    DELETE FROM tariffs.tariff WHERE id = v_tr26;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('replaced_tariff_delete_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('replaced_tariff_delete_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('replaced_tariff_delete_REFUSED', false);
  END;
  BEGIN
    DELETE FROM tariffs.tariff_year WHERE id = v_y26;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('replaced_year_delete_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('replaced_year_delete_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('replaced_year_delete_REFUSED', false);
  END;
  BEGIN
    UPDATE tariffs.tariff_year SET state = 'published' WHERE id = v_y26;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('replaced_year_republish_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('replaced_year_republish_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('replaced_year_republish_REFUSED', false);
  END;
  RESET ROLE;

  -- ── 6. Correcting history: a superseded year's correction arrives superseded ─
  INSERT INTO tariffs.tariff_year (licensee_id, financial_year, effective_from, effective_to, state, replaces_year_id)
  VALUES (v_lic, '2025/26', '2025-07-01', '2026-06-30', 'in_review', v_y25) RETURNING id INTO v_c25;
  INSERT INTO tariffs.tariff (tariff_year_id, name, category, metering, structure)
  VALUES (v_c25, 'Probe Domestic', 'domestic', 'conventional', 'flat') RETURNING id INTO v_t;
  INSERT INTO tariffs.charge (tariff_id, component, unit, amount_excl_vat, vat_basis, extraction_method)
  VALUES (v_t, 'energy', 'c_per_kWh', 251, 'assumed_excl', 'parser');
  UPDATE tariffs.tariff_year SET validated_at = now(), validation_blocking = 0 WHERE id = v_c25;
  SET LOCAL ROLE authenticated;
  UPDATE tariffs.tariff_year SET state = 'published' WHERE id = v_c25;
  RESET ROLE;
  SELECT count(*) INTO v_n FROM tariffs.tariff_year
   WHERE (id = v_c25 AND state = 'superseded' AND published_at IS NOT NULL) OR (id = v_y25 AND state = 'replaced') OR (id = v_c26 AND state = 'published');
  INSERT INTO _r VALUES ('history_correction_arrives_superseded', v_n = 3);

  -- ── 7. A library reader still reads a replaced year (pinned studies keep loading) ─
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sub::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM tariffs.charge c JOIN tariffs.tariff t ON t.id = c.tariff_id WHERE t.tariff_year_id = v_y26;
  INSERT INTO _r VALUES ('reader_sees_replaced_year_charges', v_n = 1);
  SELECT count(*) INTO v_n FROM tariffs.tariff_year WHERE licensee_id = v_lic AND state IN ('published', 'superseded');
  INSERT INTO _r VALUES ('reader_live_list_excludes_replaced', v_n = 2);
  RESET ROLE;

  -- ── 8. The old one-row-per-year constraint is gone; the draft and live slots remain ─
  SELECT count(*) INTO v_n FROM pg_constraint WHERE conrelid = 'tariffs.tariff_year'::regclass AND conname = 'tariff_year_licensee_fy';
  INSERT INTO _r VALUES ('old_unique_constraint_dropped', v_n = 0);
END $$;

SELECT k AS "check", v AS ok FROM _r ORDER BY k;
