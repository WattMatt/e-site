-- ---------------------------------------------------------------------------
-- anon_execute_secdef_test.sql   (pgTAP — run via `supabase test db`, or paste
--                                 the body into a rolled-back transaction on
--                                 production to verify a candidate 00186)
--
-- Regression test for 00186_revoke_anon_execute_security_definer.sql.
--
-- CONTRACT: no SECURITY DEFINER function in a PostgREST-exposed schema may be
-- EXECUTE-able by `anon`. Every such function is reachable at
-- /rest/v1/rpc/<name> by anybody holding the public anon key, which ships in
-- the browser bundle, and SECURITY DEFINER means RLS is not the backstop —
-- `public.project_notification_recipients` additionally carries
-- `SET row_security TO 'off'`, and returned 2,040 bytes of staff names and
-- email addresses to an unauthenticated caller in production.
--
-- ⚠ has_function_privilege IS THE ONLY VALID ORACLE. Do NOT assert on
-- `pg_proc.proacl`: a NULL proacl looks like "no grants" and IS the built-in
-- PUBLIC EXECUTE grant. Twelve of the thirty-two functions 00186 closes were in
-- exactly that state, so a proacl-based test would have reported them clean.
--
-- ⚠ The `has_function_privilege('anon', ...)` form is also what catches the
-- other half: Supabase's ALTER DEFAULT PRIVILEGES grants anon DIRECTLY at
-- creation in the `public` schema, so a `REVOKE ... FROM PUBLIC` that reads
-- like a fix leaves anon's own grant untouched (00164:68 did this to
-- custom_jwt_claims and it stayed anon-executable).
--
-- The allow-list is empty on purpose: this application has no anonymous data
-- surface. Production holds six RLS policies naming `anon` — the RESTRICTIVE
-- membership-write guards from 00177 — and zero anon SELECT policies.
-- ---------------------------------------------------------------------------
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT no_plan();

-- The production PostgREST `db_schema` list, verbatim
-- (GET /v1/projects/<ref>/postgrest, 2026-09-10).
CREATE TEMP TABLE _exposed(schema_name TEXT) ON COMMIT DROP;
INSERT INTO _exposed VALUES
  ('public'),('projects'),('inspections'),('field'),('tenants'),('suppliers'),
  ('billing'),('marketplace'),('cable_schedule'),('structure'),('gcr');

-- Deliberate exceptions. Every row needs a reason; the list is empty today.
CREATE TEMP TABLE _allowed(signature TEXT, reason TEXT) ON COMMIT DROP;

-- (0) Fixture guard. If the catalog query matched nothing — wrong schema names,
--     an empty database — every assertion below would pass vacuously.
SELECT cmp_ok(
    (SELECT count(*)::int
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN (SELECT schema_name FROM _exposed) AND p.prosecdef),
    '>=', 40,
    'the catalog query actually finds the SECURITY DEFINER functions'
);

-- (1) THE CONTRACT.
SELECT is(
    (SELECT coalesce(string_agg(sig, E'\n' ORDER BY sig), '')
       FROM (
         SELECT n.nspname || '.' || p.proname || '(' ||
                pg_get_function_identity_arguments(p.oid) || ')' AS sig
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname IN (SELECT schema_name FROM _exposed)
            AND p.prosecdef
            AND has_function_privilege('anon', p.oid, 'EXECUTE')
       ) s
      WHERE sig NOT IN (SELECT signature FROM _allowed)),
    '',
    'no SECURITY DEFINER function in an exposed schema is anon-EXECUTE-able'
);

-- (2) The headline function is service_role only — leaving `authenticated` in
--     place would keep the identical roster disclosure one free signup away,
--     since the function ignores RLS and its only caller
--     (apps/web/src/lib/recipients.ts) uses the service client.
SELECT ok(
    NOT has_function_privilege('anon', 'public.project_notification_recipients(uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.project_notification_recipients(uuid,uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.project_notification_recipients(uuid,uuid)', 'EXECUTE'),
    'project_notification_recipients is service_role only'
);

-- (3) POSITIVE CONTROLS. The revoke must not over-reach. Each of these is
--     called through the cookie-authenticated client or evaluated inside an RLS
--     policy that is TO authenticated, so losing `authenticated` here would be
--     a silent product outage rather than a security win.
--     marketplace.refresh_supplier_rating_summary and
--     projects.jbcc_allocate_letter_reference are the two that held the role
--     ONLY through PUBLIC, i.e. the two a naive REVOKE would have broken.
SELECT ok(has_function_privilege('authenticated', sig, 'EXECUTE'), 'authenticated keeps ' || sig)
FROM unnest(ARRAY[
    'public.has_feature(uuid,text)',
    'public.has_feature_seat(uuid,uuid,text)',
    'public.user_has_mv_access(uuid)',
    'public.user_can_manage_project(uuid)',
    'public.user_can_manage_project_members(uuid)',
    'public.user_is_org_admin(uuid)',
    'public.floor_plan_project_id(uuid)',
    'structure.node_order_project_id(uuid)',
    'inspections.allocate_coc_number(uuid)',
    'inspections.is_inspection_verifier(uuid)',
    'inspections.user_can_verify(uuid)',
    'inspections.user_can_write_responses(uuid)',
    'inspections.user_has_inspection_read(uuid)',
    'marketplace.refresh_supplier_rating_summary()',
    'projects.jbcc_allocate_letter_reference(uuid)'
]) AS sig;

SELECT ok(has_function_privilege('service_role', 'projects.jbcc_allocate_letter_reference(uuid)', 'EXECUTE'),
          'service_role can allocate a JBCC letter reference (SECURITY INVOKER trigger calls it as the writer)');

SELECT ok(has_function_privilege('supabase_auth_admin', 'public.custom_jwt_claims(jsonb)', 'EXECUTE'),
          'GoTrue keeps its custom-access-token hook grant');

-- (4) TRIGGERS STILL FIRE with no caller EXECUTE at all. Postgres checks
--     EXECUTE on a trigger function at CREATE TRIGGER time, not per fire.
--     This is the assertion that would catch it if that were wrong.
CREATE TEMP TABLE _trg_results(name TEXT, passed BOOLEAN) ON COMMIT DROP;

DO $b$
DECLARE
    v_org  UUID;
    v_proj UUID;
    v_val  TEXT;
BEGIN
    SELECT id INTO v_org  FROM public.organisations LIMIT 1;
    SELECT id INTO v_proj FROM projects.projects WHERE organisation_id = v_org LIMIT 1;
    IF v_proj IS NULL THEN
        INSERT INTO _trg_results VALUES ('valuations_set_no trigger fires (skipped: no seed project)', TRUE);
        RETURN;
    END IF;

    INSERT INTO projects.valuations (project_id, organisation_id, valuation_date)
    VALUES (v_proj, v_org, CURRENT_DATE)
    RETURNING valuation_no INTO v_val;

    INSERT INTO _trg_results VALUES
      ('projects.valuations_set_no still allocates a number with EXECUTE revoked from every caller role',
       v_val IS NOT NULL AND v_val <> '');
END $b$;

SELECT ok(passed, name) FROM _trg_results ORDER BY name;

SELECT * FROM finish();
ROLLBACK;
