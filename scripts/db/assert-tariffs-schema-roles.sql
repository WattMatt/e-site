-- BEHAVIOURAL assertions for 00210_tariffs_schema, run as real roles.
--   While 00208 is not in the production ledger, dry-run the pair:
--     cat apps/edge-functions/supabase/migrations/00208_solar_foundation.sql \
--         apps/edge-functions/supabase/migrations/00210_tariffs_schema.sql > "$S/combo.sql"
--     scripts/db/dry-run-migration.sh "$S/combo.sql" scripts/db/assert-tariffs-schema-roles.sql      (GREEN)
--   RED first: 00208 alone (no tariffs schema: the file aborts).
-- Fixtures are minted inside the transaction and rolled back.
--
-- PLATFORM TARIFF ADMIN = a row in public.platform_tariff_admins (an explicit
-- allow-list written by the service role only; owner default 10, 2026-09-28).
-- The probe admin is a throwaway user given a row inside the transaction and
-- has NO org membership at all: the allow-list alone is the gate. An ACTIVE
-- WM-Consulting admin WITHOUT a row is proven not to be an admin.
--
-- REFUSAL PATTERN (as assert-solar-foundation-roles.sql): a "…_REFUSED" check
-- catches ONLY the SQLSTATE the design promises; a wrongly-allowed statement
-- raises P0001 itself so its subtransaction rolls back and later checks stay
-- honest; any other error records false.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  c_wm     CONSTANT UUID := 'dddddddd-0000-0000-0000-000000000001';
  v_org    UUID := gen_random_uuid();   -- subscribed customer org
  v_org2   UUID := gen_random_uuid();   -- unsubscribed org
  v_admin  UUID := gen_random_uuid();   -- platform tariff admin (allow-list row, no org membership)
  v_wmadm  UUID := gen_random_uuid();   -- ACTIVE WM-Consulting admin, NOT on the allow-list
  v_wmcon  UUID := gen_random_uuid();   -- active WM-Consulting contractor (reads via the WM bypass, never writes)
  v_wmdead UUID := gen_random_uuid();   -- WM-Consulting admin, DEACTIVATED
  v_sub    UUID := gen_random_uuid();   -- contractor in the subscribed org
  v_unsub  UUID := gen_random_uuid();   -- admin of the unsubscribed org
  v_lic    UUID;
  v_y21 UUID; v_y22 UUID; v_y23 UUID; v_y24 UUID; v_y25 UUID; v_y26 UUID; v_y27 UUID;
  v_t21 UUID; v_t22 UUID; v_t24 UUID; v_t25 UUID; v_t26 UUID; v_t27 UUID;
  v_c25b   UUID;
  v_c27    UUID;
  v_n      INT;
  v_n2     INT;
  v_state  TEXT;
  u        UUID;
BEGIN
  -- ── Fixtures (as postgres) ────────────────────────────────────────────────
  INSERT INTO public.organisations (id, name) VALUES (v_org, 'tariffs-probe-org'), (v_org2, 'tariffs-probe-org-2');
  FOREACH u IN ARRAY ARRAY[v_admin, v_wmadm, v_wmcon, v_wmdead, v_sub, v_unsub] LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'tariffs-probe-' || u || '@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  END LOOP;
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
    (v_wmadm, c_wm, 'admin', TRUE), (v_wmcon, c_wm, 'contractor', TRUE), (v_wmdead, c_wm, 'admin', FALSE),
    (v_sub, v_org, 'contractor', TRUE), (v_unsub, v_org2, 'admin', TRUE);
  INSERT INTO billing.org_addon_subscriptions (organisation_id, feature_key, status, amount_kobo, current_period_end)
  VALUES (v_org, 'solar', 'active', 199900, now() + interval '1 year');
  -- The allow-list row, written as the service path would (postgres here).
  INSERT INTO public.platform_tariff_admins (user_id, added_by) VALUES (v_admin, NULL);
  INSERT INTO tariffs.ingest_run (parser, status) VALUES ('province_xlsx', 'succeeded');

  -- ── 1. The platform tariff admin writes, reviews and publishes ────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('admin_is_platform_tariff_admin', public.is_platform_tariff_admin());
  SELECT count(*) INTO v_n FROM public.platform_tariff_admins;
  INSERT INTO _r VALUES ('admin_sees_only_own_allowlist_row', v_n = 1);
  INSERT INTO tariffs.licensee (kind, name, province) VALUES ('municipal', 'TARIFFS PROBE MUNICIPALITY', 'GP') RETURNING id INTO v_lic;
  INSERT INTO tariffs.licensee_alias (alias, licensee_id) VALUES ('TARIFFS PROBE MUNI', v_lic);

  INSERT INTO tariffs.tariff_year (licensee_id, financial_year, effective_from, effective_to, approved_increase_pct)
  VALUES (v_lic, '2025/26', '2025-07-01', '2026-06-30', 12.72) RETURNING id INTO v_y25;
  INSERT INTO tariffs.tariff (tariff_year_id, name, category, metering, structure)
  VALUES (v_y25, 'Probe Domestic', 'domestic', 'conventional', 'flat') RETURNING id INTO v_t25;
  INSERT INTO tariffs.charge (tariff_id, component, unit, amount_excl_vat, vat_basis, extraction_method)
  VALUES (v_t25, 'energy', 'c_per_kWh', 250, 'assumed_excl', 'parser');
  INSERT INTO tariffs.charge (tariff_id, component, unit, amount_excl_vat, vat_basis, extraction_method, unit_inferred, inference_reason)
  VALUES (v_t25, 'basic', 'R_per_month', 100, 'assumed_excl', 'parser', true, 'fixed charge without a unit: assumed R/month')
  RETURNING id INTO v_c25b;
  UPDATE tariffs.tariff_year SET state = 'in_review' WHERE id = v_y25;

  -- the validation record (blocking-issue count from the TS validators) is written by the
  -- service role only; an admin cannot declare their own year clean
  BEGIN
    UPDATE tariffs.tariff_year SET validated_at = now(), validation_blocking = 0 WHERE id = v_y25;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('admin_write_validation_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('admin_write_validation_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('admin_write_validation_REFUSED', false);
  END;
  RESET ROLE;
  UPDATE tariffs.tariff_year SET validated_at = now(), validation_blocking = 0 WHERE id = v_y25;
  SET LOCAL ROLE authenticated;

  BEGIN
    UPDATE tariffs.tariff_year SET state = 'published' WHERE id = v_y25;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('publish_with_unreviewed_inference_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('publish_with_unreviewed_inference_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('publish_with_unreviewed_inference_REFUSED', false);
  END;

  -- the review stamp is the caller and now, whatever was sent
  UPDATE tariffs.charge SET reviewed_at = '2000-01-01', reviewed_by = v_sub WHERE id = v_c25b;
  SELECT count(*) INTO v_n FROM tariffs.charge WHERE id = v_c25b AND reviewed_by = v_admin AND reviewed_at > '2001-01-01';
  INSERT INTO _r VALUES ('review_stamp_bound_to_caller', v_n = 1);
  SELECT count(*) INTO v_n FROM tariffs.tariff_year WHERE id = v_y25 AND validated_at IS NOT NULL AND validation_blocking = 0;
  INSERT INTO _r VALUES ('review_stamp_keeps_validation', v_n = 1);

  -- publish; the stamp is the caller, not the forged published_by
  UPDATE tariffs.tariff_year SET state = 'published', published_by = v_sub WHERE id = v_y25;
  SELECT count(*) INTO v_n FROM tariffs.tariff_year
   WHERE id = v_y25 AND state = 'published' AND published_by = v_admin AND published_at IS NOT NULL;
  INSERT INTO _r VALUES ('admin_publishes_with_bound_stamp', v_n = 1);

  -- published data is immutable, even for the admin
  BEGIN
    UPDATE tariffs.charge SET amount_excl_vat = 1 WHERE tariff_id = v_t25;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('published_charge_update_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('published_charge_update_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('published_charge_update_REFUSED', false);
  END;
  BEGIN
    DELETE FROM tariffs.charge WHERE tariff_id = v_t25;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('published_charge_delete_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('published_charge_delete_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('published_charge_delete_REFUSED', false);
  END;
  BEGIN
    INSERT INTO tariffs.charge (tariff_id, component, unit, amount_excl_vat, vat_basis, extraction_method)
    VALUES (v_t25, 'service', 'R_per_month', 5, 'assumed_excl', 'manual');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('published_charge_insert_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('published_charge_insert_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('published_charge_insert_REFUSED', false);
  END;
  BEGIN
    UPDATE tariffs.tariff SET name = 'Renamed' WHERE id = v_t25;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('published_tariff_update_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('published_tariff_update_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('published_tariff_update_REFUSED', false);
  END;
  BEGIN
    UPDATE tariffs.tariff_year SET approved_increase_pct = 1 WHERE id = v_y25;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('published_year_update_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('published_year_update_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('published_year_update_REFUSED', false);
  END;
  BEGIN
    DELETE FROM tariffs.tariff_year WHERE id = v_y25;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('published_year_delete_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('published_year_delete_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('published_year_delete_REFUSED', false);
  END;
  BEGIN
    UPDATE tariffs.tariff_year SET state = 'in_review' WHERE id = v_y25;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('published_to_in_review_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('published_to_in_review_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('published_to_in_review_REFUSED', false);
  END;
  BEGIN
    INSERT INTO tariffs.tariff_year (licensee_id, financial_year, effective_from, effective_to, state)
    VALUES (v_lic, '2019/20', '2019-07-01', '2020-06-30', 'published');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('insert_as_published_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('insert_as_published_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('insert_as_published_REFUSED', false);
  END;

  -- an empty year cannot publish
  INSERT INTO tariffs.tariff_year (licensee_id, financial_year, effective_from, effective_to, state)
  VALUES (v_lic, '2023/24', '2023-07-01', '2024-06-30', 'in_review') RETURNING id INTO v_y23;
  BEGIN
    UPDATE tariffs.tariff_year SET state = 'published' WHERE id = v_y23;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('publish_empty_year_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('publish_empty_year_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('publish_empty_year_REFUSED', false);
  END;

  -- a tariff with no charge blocks a publish
  INSERT INTO tariffs.tariff_year (licensee_id, financial_year, effective_from, effective_to, state)
  VALUES (v_lic, '2020/21', '2020-07-01', '2021-06-30', 'in_review') RETURNING id INTO v_y21;
  INSERT INTO tariffs.tariff (tariff_year_id, name, structure) VALUES (v_y21, 'Chargeless', 'flat') RETURNING id INTO v_t21;
  BEGIN
    UPDATE tariffs.tariff_year SET state = 'published' WHERE id = v_y21;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('publish_tariff_without_charge_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('publish_tariff_without_charge_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('publish_tariff_without_charge_REFUSED', false);
  END;

  -- ingesting cannot jump straight to published
  INSERT INTO tariffs.tariff_year (licensee_id, financial_year, effective_from, effective_to)
  VALUES (v_lic, '2022/23', '2022-07-01', '2023-06-30') RETURNING id INTO v_y22;
  INSERT INTO tariffs.tariff (tariff_year_id, name, structure) VALUES (v_y22, 'Probe 22', 'flat') RETURNING id INTO v_t22;
  INSERT INTO tariffs.charge (tariff_id, component, unit, amount_excl_vat, vat_basis, extraction_method)
  VALUES (v_t22, 'energy', 'c_per_kWh', 200, 'assumed_excl', 'parser');
  BEGIN
    UPDATE tariffs.tariff_year SET state = 'published' WHERE id = v_y22;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('ingesting_to_published_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('ingesting_to_published_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('ingesting_to_published_REFUSED', false);
  END;

  -- publishing 2026/27 supersedes 2025/26
  INSERT INTO tariffs.tariff_year (licensee_id, financial_year, effective_from, effective_to, state, approved_increase_pct)
  VALUES (v_lic, '2026/27', '2026-07-01', '2027-06-30', 'in_review', 9.01) RETURNING id INTO v_y26;
  INSERT INTO tariffs.tariff (tariff_year_id, name, structure) VALUES (v_y26, 'Probe Domestic', 'flat') RETURNING id INTO v_t26;
  INSERT INTO tariffs.charge (tariff_id, component, unit, amount_excl_vat, vat_basis, extraction_method)
  VALUES (v_t26, 'energy', 'c_per_kWh', 272.53, 'assumed_excl', 'parser');
  BEGIN
    UPDATE tariffs.tariff_year SET state = 'published' WHERE id = v_y26;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('publish_unvalidated_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('publish_unvalidated_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('publish_unvalidated_REFUSED', false);
  END;
  RESET ROLE;
  UPDATE tariffs.tariff_year SET validated_at = now(), validation_blocking = 2 WHERE id = v_y26;
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE tariffs.tariff_year SET state = 'published' WHERE id = v_y26;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('publish_with_blocking_issues_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('publish_with_blocking_issues_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('publish_with_blocking_issues_REFUSED', false);
  END;
  RESET ROLE;
  UPDATE tariffs.tariff_year SET validated_at = now(), validation_blocking = 0 WHERE id = v_y26;
  SET LOCAL ROLE authenticated;
  UPDATE tariffs.tariff_year SET state = 'published' WHERE id = v_y26;
  SELECT state INTO v_state FROM tariffs.tariff_year WHERE id = v_y25;
  INSERT INTO _r VALUES ('publish_supersedes_prior_year', v_state = 'superseded');
  SELECT count(*) INTO v_n FROM tariffs.tariff_year WHERE licensee_id = v_lic AND state = 'published';
  INSERT INTO _r VALUES ('one_published_year_per_licensee', v_n = 1);
  BEGIN
    UPDATE tariffs.tariff_year SET state = 'published' WHERE id = v_y25;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('superseded_to_published_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('superseded_to_published_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('superseded_to_published_REFUSED', false);
  END;

  -- a back-filled OLDER year arrives as history and leaves the newer one current
  INSERT INTO tariffs.tariff_year (licensee_id, financial_year, effective_from, effective_to, state)
  VALUES (v_lic, '2024/25', '2024-07-01', '2025-06-30', 'in_review') RETURNING id INTO v_y24;
  INSERT INTO tariffs.tariff (tariff_year_id, name, structure) VALUES (v_y24, 'Probe Domestic', 'flat') RETURNING id INTO v_t24;
  INSERT INTO tariffs.charge (tariff_id, component, unit, amount_excl_vat, vat_basis, extraction_method)
  VALUES (v_t24, 'energy', 'c_per_kWh', 221.8, 'assumed_excl', 'parser');
  RESET ROLE;
  UPDATE tariffs.tariff_year SET validated_at = now(), validation_blocking = 0 WHERE id = v_y24;
  SET LOCAL ROLE authenticated;
  UPDATE tariffs.tariff_year SET state = 'published' WHERE id = v_y24;
  SELECT state INTO v_state FROM tariffs.tariff_year WHERE id = v_y24;
  INSERT INTO _r VALUES ('backfilled_older_year_lands_superseded', v_state = 'superseded');
  SELECT state INTO v_state FROM tariffs.tariff_year WHERE id = v_y26;
  INSERT INTO _r VALUES ('newer_year_stays_published', v_state = 'published');

  -- a draft year for the visibility checks; a changed fact loses its review stamp
  INSERT INTO tariffs.tariff_year (licensee_id, financial_year, effective_from, effective_to, state)
  VALUES (v_lic, '2027/28', '2027-07-01', '2028-06-30', 'in_review') RETURNING id INTO v_y27;
  INSERT INTO tariffs.tariff (tariff_year_id, name, structure) VALUES (v_y27, 'Probe Draft', 'flat') RETURNING id INTO v_t27;
  INSERT INTO tariffs.charge (tariff_id, component, unit, amount_excl_vat, vat_basis, extraction_method)
  VALUES (v_t27, 'energy', 'c_per_kWh', 290, 'assumed_excl', 'parser') RETURNING id INTO v_c27;
  UPDATE tariffs.charge SET reviewed_at = now() WHERE id = v_c27;
  UPDATE tariffs.charge SET amount_excl_vat = 300 WHERE id = v_c27;
  SELECT count(*) INTO v_n FROM tariffs.charge WHERE id = v_c27 AND reviewed_at IS NULL AND reviewed_by IS NULL;
  INSERT INTO _r VALUES ('review_stamp_cleared_when_fact_changes', v_n = 1);
  -- a validated draft whose content changes must be validated again before it can publish
  RESET ROLE;
  UPDATE tariffs.tariff_year SET validated_at = now(), validation_blocking = 0 WHERE id = v_y27;
  SET LOCAL ROLE authenticated;
  UPDATE tariffs.charge SET amount_excl_vat = 310 WHERE id = v_c27;
  SELECT count(*) INTO v_n FROM tariffs.tariff_year WHERE id = v_y27 AND validated_at IS NULL AND validation_blocking IS NULL;
  INSERT INTO _r VALUES ('content_change_clears_validation', v_n = 1);

  -- shape constraints
  BEGIN
    INSERT INTO tariffs.charge (tariff_id, component, unit, amount_excl_vat, vat_basis, extraction_method)
    VALUES (v_t27, 'energy', 'c/kWh', 1, 'assumed_excl', 'parser');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('unknown_unit_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('unknown_unit_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('unknown_unit_REFUSED', false);
  END;
  BEGIN
    INSERT INTO tariffs.charge (tariff_id, component, unit, amount_excl_vat, vat_basis, extraction_method, unit_inferred)
    VALUES (v_t27, 'energy', 'R_per_kWh', 3.09, 'assumed_excl', 'parser', true);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('inferred_without_reason_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('inferred_without_reason_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('inferred_without_reason_REFUSED', false);
  END;
  BEGIN
    INSERT INTO tariffs.charge (tariff_id, component, unit, amount_excl_vat, vat_basis, extraction_method, block_min_kwh, block_max_kwh, block_basis)
    VALUES (v_t27, 'energy', 'c_per_kWh', 200, 'assumed_excl', 'parser', 500, 100, 'monthly');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('inverted_block_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('inverted_block_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('inverted_block_REFUSED', false);
  END;
  BEGIN
    INSERT INTO tariffs.licensee_alias (alias, licensee_id) VALUES ('CITY OF CAPE ', v_lic);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('unnormalised_alias_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('unnormalised_alias_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('unnormalised_alias_REFUSED', false);
  END;
  BEGIN
    INSERT INTO tariffs.tariff_year (licensee_id, financial_year, effective_from, effective_to)
    VALUES (v_lic, '2026/28', '2026-07-01', '2028-06-30');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('bad_financial_year_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('bad_financial_year_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('bad_financial_year_REFUSED', false);
  END;
  SELECT count(*) INTO v_n FROM tariffs.ingest_run;
  INSERT INTO _r VALUES ('admin_reads_ingest_runs', v_n >= 1);

  -- source documents: a file (sha256 + storage) or a URL-only reference (owner default 8)
  INSERT INTO tariffs.source_document (licensee_id, kind, title, financial_year, status, url)
  VALUES (v_lic, 'nersa_decision', 'Probe decision (URL only)', '2026/27', 'nersa_approved', 'https://example.invalid/decision');
  SELECT count(*) INTO v_n FROM tariffs.source_document WHERE title = 'Probe decision (URL only)' AND sha256 IS NULL;
  INSERT INTO _r VALUES ('url_only_source_document_accepted', v_n = 1);
  BEGIN
    INSERT INTO tariffs.source_document (kind, title, status) VALUES ('rules', 'Probe nothing', 'final');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('source_document_without_file_or_url_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('source_document_without_file_or_url_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('source_document_without_file_or_url_REFUSED', false);
  END;
  BEGIN
    INSERT INTO tariffs.source_document (kind, title, status, storage_path, url)
    VALUES ('rules', 'Probe stored file without hash', 'final', 'reference/probe.pdf', 'https://example.invalid/r');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('stored_file_without_sha256_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('stored_file_without_sha256_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('stored_file_without_sha256_REFUSED', false);
  END;
  INSERT INTO tariffs.source_document (kind, title, status, storage_path, sha256)
  VALUES ('rules', 'Probe rules file', 'final', 'reference/probe-rules.pdf', repeat('ab', 32));
  BEGIN
    UPDATE tariffs.source_document SET sha256 = repeat('cd', 32) WHERE title = 'Probe rules file';
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('source_document_sha256_change_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('source_document_sha256_change_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('source_document_sha256_change_REFUSED', false);
  END;
  BEGIN
    UPDATE tariffs.source_document SET sha256 = NULL, storage_path = NULL WHERE title = 'Probe rules file';
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('source_document_sha256_clear_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('source_document_sha256_clear_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('source_document_sha256_clear_REFUSED', false);
  END;
  -- even an admin cannot add admins: the allow-list is service-role-only
  BEGIN
    INSERT INTO public.platform_tariff_admins (user_id) VALUES (v_sub);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('admin_allowlist_insert_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('admin_allowlist_insert_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('admin_allowlist_insert_REFUSED', false);
  END;
  RESET ROLE;

  -- ── 2. A subscriber reads published data only, and writes nothing ─────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sub::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('sub_is_not_admin', NOT public.is_platform_tariff_admin());
  INSERT INTO _r VALUES ('sub_has_a_solar_org', public.caller_has_any_solar_org());
  SELECT count(*) INTO v_n FROM public.platform_tariff_admins;
  INSERT INTO _r VALUES ('sub_cannot_read_allowlist', v_n = 0);
  SELECT count(*) INTO v_n FROM tariffs.licensee WHERE id = v_lic;
  INSERT INTO _r VALUES ('sub_reads_licensees', v_n = 1);
  -- visible: 2024/25 (superseded), 2025/26 (superseded), 2026/27 (published); hidden: 20/21, 22/23, 23/24, 27/28
  SELECT count(*) INTO v_n FROM tariffs.tariff_year WHERE licensee_id = v_lic;
  INSERT INTO _r VALUES ('sub_sees_only_published_and_superseded_years', v_n = 3);
  SELECT count(*) INTO v_n FROM tariffs.tariff WHERE id = v_t27;
  INSERT INTO _r VALUES ('sub_cannot_see_draft_tariff', v_n = 0);
  SELECT count(*) INTO v_n FROM tariffs.charge WHERE tariff_id = v_t27;
  INSERT INTO _r VALUES ('sub_cannot_see_draft_charges', v_n = 0);
  SELECT count(*) INTO v_n FROM tariffs.charge WHERE tariff_id = v_t26;
  INSERT INTO _r VALUES ('sub_reads_published_charges', v_n = 1);
  SELECT count(*) INTO v_n FROM tariffs.ingest_run;
  INSERT INTO _r VALUES ('sub_cannot_read_ingest_runs', v_n = 0);
  UPDATE tariffs.charge SET amount_excl_vat = 1 WHERE tariff_id = v_t27;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('sub_update_affects_nothing', v_n = 0);
  BEGIN
    INSERT INTO tariffs.licensee (kind, name) VALUES ('private', 'SUB FORGED LICENSEE');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('sub_licensee_insert_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('sub_licensee_insert_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('sub_licensee_insert_REFUSED', false);
  END;
  BEGIN
    INSERT INTO tariffs.charge (tariff_id, component, unit, amount_excl_vat, vat_basis, extraction_method)
    VALUES (v_t27, 'energy', 'c_per_kWh', 1, 'assumed_excl', 'manual');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('sub_charge_insert_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('sub_charge_insert_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('sub_charge_insert_REFUSED', false);
  END;
  BEGIN
    INSERT INTO public.platform_tariff_admins (user_id) VALUES (v_sub);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('sub_self_promotion_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('sub_self_promotion_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('sub_self_promotion_REFUSED', false);
  END;
  RESET ROLE;

  -- ── 3. A WM-Consulting contractor reads (WM bypass) but is not an admin ───
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_wmcon::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('wm_contractor_not_admin', NOT public.is_platform_tariff_admin());
  SELECT count(*) INTO v_n FROM tariffs.tariff_year WHERE licensee_id = v_lic;
  INSERT INTO _r VALUES ('wm_contractor_reads_published', v_n = 3);
  BEGIN
    INSERT INTO tariffs.licensee (kind, name) VALUES ('private', 'WM CONTRACTOR FORGED');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('wm_contractor_insert_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('wm_contractor_insert_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('wm_contractor_insert_REFUSED', false);
  END;
  RESET ROLE;

  -- ── 3b. An ACTIVE WM-Consulting admin off the allow-list is not an admin ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_wmadm::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('wm_admin_off_allowlist_not_admin', NOT public.is_platform_tariff_admin());
  SELECT count(*) INTO v_n FROM tariffs.tariff_year WHERE licensee_id = v_lic;
  INSERT INTO _r VALUES ('wm_admin_off_allowlist_sees_no_drafts', v_n = 3);
  BEGIN
    INSERT INTO tariffs.licensee (kind, name) VALUES ('private', 'WM ADMIN FORGED');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('wm_admin_off_allowlist_insert_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('wm_admin_off_allowlist_insert_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('wm_admin_off_allowlist_insert_REFUSED', false);
  END;
  RESET ROLE;

  -- ── 4. A deactivated WM admin is nobody ───────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_wmdead::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('deactivated_wm_admin_not_admin', NOT public.is_platform_tariff_admin());
  SELECT count(*) INTO v_n FROM tariffs.licensee WHERE id = v_lic;
  INSERT INTO _r VALUES ('deactivated_wm_admin_reads_nothing', v_n = 0);
  RESET ROLE;

  -- ── 5. An unsubscribed org reads the PUBLISHED library only ──────────────
  -- D-03b ("an unsubscribed org reads nothing") was superseded by E7 D1 /
  -- 00224 (2026-10-05): every signed-in org reads published years; drafts stay
  -- admin-only. scripts/db/assert-tariff-explorer.sql covers it in full.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_unsub::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO _r VALUES ('unsubscribed_has_no_solar_org', NOT public.caller_has_any_solar_org());
  SELECT count(*) INTO v_n FROM tariffs.licensee WHERE id = v_lic;
  SELECT count(*) INTO v_n2 FROM tariffs.tariff_year WHERE licensee_id = v_lic AND state IN ('ingesting', 'in_review');
  INSERT INTO _r VALUES ('unsubscribed_reads_licensee_but_no_draft_00224', v_n = 1 AND v_n2 = 0);
  RESET ROLE;

  -- ── 6. The service role (ingestion) sees drafts but cannot edit history ───
  PERFORM set_config('request.jwt.claims', '{}', true);
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO v_n FROM tariffs.tariff_year WHERE id = v_y27;
  INSERT INTO _r VALUES ('service_role_reads_drafts', v_n = 1);
  BEGIN
    UPDATE tariffs.charge SET amount_excl_vat = 2 WHERE tariff_id = v_t26;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('service_role_cannot_edit_published', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('service_role_cannot_edit_published', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('service_role_cannot_edit_published', false);
  END;
  -- the service role records validation (the 2b validator) but cannot publish: a platform admin approves each year (D-03)
  UPDATE tariffs.tariff_year SET validated_at = now(), validation_blocking = 0 WHERE id = v_y27;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('service_role_writes_validation', v_n = 1);
  BEGIN
    UPDATE tariffs.tariff_year SET state = 'published' WHERE id = v_y27;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('service_role_publish_REFUSED', true);
    WHEN raise_exception THEN INSERT INTO _r VALUES ('service_role_publish_REFUSED', false);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('service_role_publish_REFUSED', false);
  END;
  INSERT INTO tariffs.ingest_run (parser, status) VALUES ('rfd_pdf', 'partial');
  INSERT INTO _r VALUES ('ingest_run_partial_status_accepted', true);
  -- the service role maintains the allow-list
  INSERT INTO public.platform_tariff_admins (user_id) VALUES (v_wmadm);
  DELETE FROM public.platform_tariff_admins WHERE user_id = v_wmadm;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('service_role_maintains_allowlist', v_n = 1);
  RESET ROLE;

  -- ── 7. anon: no schema, no helper, no allow-list ──────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM tariffs.licensee LIMIT 1;
    INSERT INTO _r VALUES ('anon_read_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_read_REFUSED', true);
  END;
  BEGIN
    PERFORM public.is_platform_tariff_admin();
    INSERT INTO _r VALUES ('anon_execute_admin_helper_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_execute_admin_helper_REFUSED', true);
  END;
  BEGIN
    PERFORM 1 FROM public.platform_tariff_admins LIMIT 1;
    INSERT INTO _r VALUES ('anon_allowlist_read_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_allowlist_read_REFUSED', true);
  END;
  RESET ROLE;

  -- ── 8. The source bucket is private ───────────────────────────────────────
  SELECT count(*) INTO v_n FROM storage.buckets WHERE id = 'tariff-sources' AND NOT public;
  INSERT INTO _r VALUES ('tariff_sources_bucket_private', v_n = 1);
END $$;

SELECT k AS "check", v AS ok FROM _r ORDER BY k;
