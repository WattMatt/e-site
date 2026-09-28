-- BEHAVIOURAL assertions for 00208_solar_org_settings, run as real roles.
--   Red:   scripts/db/dry-run-migration.sh <red.sql>   scripts/db/assert-solar-org-settings-roles.sql
--   Green: scripts/db/dry-run-migration.sh <green.sql> scripts/db/assert-solar-org-settings-roles.sql
-- where red.sql / green.sql are built in the plan (Task 4 Step 2): 00207 must be in
-- front of 00208 while 00207 is not yet applied to production.
-- Fixtures are minted inside the transaction and rolled back. Seeding happens as
-- postgres before any impersonation (request.jwt.claims outlives RESET ROLE).
-- REFUSAL PATTERN: a "…_REFUSED" check catches only the SQLSTATE the design
-- promises; an allowed statement raises P0001 itself so the write rolls back.

CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  v_org     UUID := gen_random_uuid();
  v_org2    UUID := gen_random_uuid();
  v_admin   UUID := gen_random_uuid();   -- admin of v_org (settings writer)
  v_con     UUID := gen_random_uuid();   -- contractor of v_org
  v_foreign UUID := gen_random_uuid();   -- admin of v_org2
  v_n       INT;
  v_by      UUID;
  u         UUID;
  t         TEXT;
BEGIN
  -- ── Fixtures (as postgres) ────────────────────────────────────────────────
  INSERT INTO public.organisations (id, name) VALUES
    (v_org, 'solar-settings-probe'), (v_org2, 'solar-settings-probe-2');
  FOREACH u IN ARRAY ARRAY[v_admin, v_con, v_foreign] LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'solar-settings-probe-' || u || '@example.invalid', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  END LOOP;
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
    (v_admin, v_org, 'admin', TRUE), (v_con, v_org, 'contractor', TRUE), (v_foreign, v_org2, 'admin', TRUE);

  -- ── 1. Admin writes own org's settings; updated_by is bound, not trusted ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO solar.org_settings (organisation_id, settings, updated_by)
    VALUES (v_org, '{"version":1,"values":{"discount_rate_pct":11}}'::jsonb, v_con);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('admin_inserts_own_org', v_n = 1);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('admin_inserts_own_org', false);
  END;
  SELECT updated_by INTO v_by FROM solar.org_settings WHERE organisation_id = v_org;
  INSERT INTO _r VALUES ('updated_by_bound_to_caller', v_by IS NOT DISTINCT FROM v_admin);
  BEGIN
    UPDATE solar.org_settings SET settings = '{"version":1,"values":{"discount_rate_pct":12}}'::jsonb
     WHERE organisation_id = v_org;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('admin_updates_own_org', v_n = 1);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('admin_updates_own_org', false);
  END;
  BEGIN
    UPDATE solar.org_settings SET settings = '[]'::jsonb WHERE organisation_id = v_org;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('non_object_settings_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('non_object_settings_REFUSED', false);
  END;
  BEGIN
    UPDATE solar.org_settings SET organisation_id = v_org2 WHERE organisation_id = v_org;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('org_move_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('org_move_REFUSED', false);
  END;
  BEGIN
    DELETE FROM solar.org_settings WHERE organisation_id = v_org;
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('admin_delete_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('admin_delete_REFUSED', false);
  END;
  BEGIN
    INSERT INTO solar.org_settings (organisation_id) VALUES (v_org2);
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN INSERT INTO _r VALUES ('admin_insert_foreign_org_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('admin_insert_foreign_org_REFUSED', false);
  END;
  RESET ROLE;

  -- ── 2. Contractor of the same org: reads nothing, writes nothing ─────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_con::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM solar.org_settings WHERE organisation_id = v_org;
  INSERT INTO _r VALUES ('contractor_reads_nothing', v_n = 0);
  BEGIN
    UPDATE solar.org_settings SET settings = '{}'::jsonb WHERE organisation_id = v_org;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('contractor_update_affects_nothing', v_n = 0);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('contractor_update_affects_nothing', false);
  END;
  RESET ROLE;

  -- ── 3. Admin of another org: reads nothing, writes nothing ───────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_foreign::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM solar.org_settings WHERE organisation_id = v_org;
  INSERT INTO _r VALUES ('foreign_admin_reads_nothing', v_n = 0);
  BEGIN
    UPDATE solar.org_settings SET settings = '{}'::jsonb WHERE organisation_id = v_org;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r VALUES ('foreign_admin_update_affects_nothing', v_n = 0);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES ('foreign_admin_update_affects_nothing', false);
  END;
  RESET ROLE;

  -- ── 4. anon has no access at all ─────────────────────────────────────────
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM solar.org_settings LIMIT 1;
    INSERT INTO _r VALUES ('anon_REFUSED', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _r VALUES ('anon_REFUSED', true);
  END;
  RESET ROLE;

  -- ── 5. The re-declared CHECKs accept the new values, keep the old, refuse junk
  FOREACH t IN ARRAY ARRAY['solar_subscribe_requested', 'solar_access_requested',
                           'solar_access_changed', 'solar_access_declined', 'billing_dispute_opened'] LOOP
    BEGIN
      INSERT INTO public.notifications (user_id, organisation_id, type, title) VALUES (v_admin, v_org, t, 'probe');
      INSERT INTO _r VALUES ('notification_type_' || t, true);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _r VALUES ('notification_type_' || t, false);
    END;
  END LOOP;
  BEGIN
    INSERT INTO public.notifications (user_id, organisation_id, type, title) VALUES (v_admin, v_org, 'solar_bogus', 'probe');
    RAISE EXCEPTION 'allowed' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN check_violation THEN INSERT INTO _r VALUES ('notification_unknown_type_REFUSED', true);
    WHEN OTHERS THEN INSERT INTO _r VALUES ('notification_unknown_type_REFUSED', false);
  END;
  FOREACH t IN ARRAY ARRAY['solar_subscribe_requested', 'solar_access_requested', 'solar_access_changed',
                           'solar_site_saved', 'solar_settings_saved', 'cable_route_sheet_exported'] LOOP
    BEGIN
      INSERT INTO public.product_events (organisation_id, event) VALUES (v_org, t);
      INSERT INTO _r VALUES ('product_event_' || t, true);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _r VALUES ('product_event_' || t, false);
    END;
  END LOOP;
END $$;

SELECT k AS "check", v AS ok FROM _r ORDER BY k;
