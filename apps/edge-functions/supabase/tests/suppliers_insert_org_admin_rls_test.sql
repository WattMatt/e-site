-- ---------------------------------------------------------------------------
-- suppliers_insert_org_admin_rls_test.sql   (pgTAP — run via `supabase test db`)
--
-- Regression test for 00165_suppliers_insert_org_admin_authz.sql.
--
-- Guards against the over-permissive authz gap where the INSERT policy on
-- suppliers.suppliers had `WITH CHECK (TRUE)` (00027), letting ANY authenticated
-- user create arbitrary — and globally visible — supplier rows.
--
-- Two layers:
--   1. STRUCTURAL — the INSERT policy must authorise by org-admin membership
--      (references public.user_organisations) and must NOT be WITH CHECK (TRUE);
--      plus a RESTRICTIVE INSERT guard against client_viewer must exist. This
--      fails if a future migration reverts the policy to a permissive stub.
--      Seed-free, environment-independent.
--   2. BEHAVIOURAL — reproduce the exploit: a plain contractor and a
--      client_viewer are BLOCKED from INSERT, while an org admin still can
--      (positive control — proves the guard does not over-block real admins),
--      and even an admin cannot mint an EXTERNAL (organisation_id IS NULL)
--      supplier (that path is service-role-only).
--
-- NOTE: requires the local Supabase stack (`supabase test db`). The behavioural
-- seed inserts into auth.users; if your GoTrue schema version differs, adjust
-- the seed columns. The structural section is independent of that seed.
-- ---------------------------------------------------------------------------
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT no_plan();

-- ─────────────────────────────────────────────────────────────────────────
-- (1) STRUCTURAL: the INSERT policy is a real org-admin check, not a stub.
-- ─────────────────────────────────────────────────────────────────────────
SELECT ok(
    EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'suppliers'
          AND p.tablename  = 'suppliers'
          AND p.cmd        = 'INSERT'
          AND p.permissive = 'PERMISSIVE'
          AND coalesce(p.with_check, '') LIKE '%user_organisations%'
    ),
    'suppliers.suppliers INSERT is authorised by org-admin membership'
);

SELECT ok(
    NOT EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'suppliers'
          AND p.tablename  = 'suppliers'
          AND p.cmd        = 'INSERT'
          AND p.permissive = 'PERMISSIVE'
          AND lower(coalesce(p.with_check, '')) = 'true'
    ),
    'no suppliers.suppliers INSERT policy is WITH CHECK (TRUE)'
);

SELECT ok(
    EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'suppliers'
          AND p.tablename  = 'suppliers'
          AND p.cmd        = 'INSERT'
          AND p.permissive = 'RESTRICTIVE'
          AND coalesce(p.with_check, '') LIKE '%user_is_client_viewer%'
    ),
    'suppliers.suppliers has a RESTRICTIVE INSERT guard against client_viewer'
);

-- ─────────────────────────────────────────────────────────────────────────
-- (2) BEHAVIOURAL: reproduce and block the suppliers INSERT exploit.
-- ─────────────────────────────────────────────────────────────────────────

-- Fixed test identities (single org):
--   org    0a…01
--   admin  0c…01 (admin)  |  contractor 0f…01 (contractor)  |  viewer 0b…01 (client_viewer)
-- Inserting into auth.users fires public.handle_new_user(), which auto-creates
-- the matching public.profiles row. Do NOT insert profiles explicitly.
INSERT INTO auth.users (instance_id, id, aud, role, email,
                        created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-000000000000','0c000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','sup-admin@test.local',      now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000','0f000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','sup-contractor@test.local', now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000','0b000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','sup-viewer@test.local',     now(), now(), '{}', '{}');

INSERT INTO public.organisations (id, name, slug)
VALUES ('0a000000-0000-0000-0000-000000000001','Suppliers RLS Test Org','sup-rls-test-org');

INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
  ('0c000000-0000-0000-0000-000000000001','0a000000-0000-0000-0000-000000000001','admin',        TRUE),
  ('0f000000-0000-0000-0000-000000000001','0a000000-0000-0000-0000-000000000001','contractor',   TRUE),
  ('0b000000-0000-0000-0000-000000000001','0a000000-0000-0000-0000-000000000001','client_viewer',TRUE);

CREATE TEMP TABLE _sup_results (name TEXT, passed BOOLEAN) ON COMMIT DROP;

-- Helper macro (inlined per block): run an INSERT as `who`, record whether RLS
-- blocked it. Always RESET ROLE afterwards so pgTAP runs as the test role.

-- (a) plain contractor — the "non-admin authenticated user" — must be BLOCKED.
DO $b$
DECLARE ok BOOLEAN;
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub','0f000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub','0f000000-0000-0000-0000-000000000001', true);
    PERFORM set_config('role','authenticated', true);
    BEGIN
        INSERT INTO suppliers.suppliers (organisation_id, name)
        VALUES ('0a000000-0000-0000-0000-000000000001','contractor should not create this');
        ok := FALSE;                       -- insert unexpectedly succeeded → FAIL
    EXCEPTION WHEN insufficient_privilege THEN
        ok := TRUE;                        -- RLS blocked the write → PASS
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _sup_results VALUES ('contractor (non-admin) INSERT into suppliers.suppliers is blocked', ok);
END $b$;

-- (b) client_viewer — must be BLOCKED (by role and by RESTRICTIVE guard).
DO $b$
DECLARE ok BOOLEAN;
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub','0b000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub','0b000000-0000-0000-0000-000000000001', true);
    PERFORM set_config('role','authenticated', true);
    BEGIN
        INSERT INTO suppliers.suppliers (organisation_id, name)
        VALUES ('0a000000-0000-0000-0000-000000000001','viewer should not create this');
        ok := FALSE;
    EXCEPTION WHEN insufficient_privilege THEN
        ok := TRUE;
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _sup_results VALUES ('client_viewer INSERT into suppliers.suppliers is blocked', ok);
END $b$;

-- (c) org admin — positive control: must be ALLOWED to create an org-scoped supplier.
DO $b$
DECLARE ok BOOLEAN;
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub','0c000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub','0c000000-0000-0000-0000-000000000001', true);
    PERFORM set_config('role','authenticated', true);
    BEGIN
        INSERT INTO suppliers.suppliers (organisation_id, name)
        VALUES ('0a000000-0000-0000-0000-000000000001','admin may create this');
        ok := TRUE;                        -- allowed → PASS
    EXCEPTION WHEN insufficient_privilege THEN
        ok := FALSE;                       -- over-blocked a real admin → FAIL
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _sup_results VALUES ('org admin INSERT of org-scoped supplier is allowed', ok);
END $b$;

-- (d) org admin — must NOT be able to mint an EXTERNAL supplier (org IS NULL);
--     that path is service-role-only (service_role bypasses RLS).
DO $b$
DECLARE ok BOOLEAN;
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub','0c000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub','0c000000-0000-0000-0000-000000000001', true);
    PERFORM set_config('role','authenticated', true);
    BEGIN
        INSERT INTO suppliers.suppliers (organisation_id, name)
        VALUES (NULL,'admin should not mint an external supplier');
        ok := FALSE;
    EXCEPTION WHEN insufficient_privilege THEN
        ok := TRUE;
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _sup_results VALUES ('org admin INSERT of external (NULL-org) supplier is blocked', ok);
END $b$;

SELECT ok(passed, name) FROM _sup_results ORDER BY name;

SELECT * FROM finish();
ROLLBACK;
