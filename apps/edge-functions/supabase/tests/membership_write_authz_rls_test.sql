-- ---------------------------------------------------------------------------
-- membership_write_authz_rls_test.sql   (pgTAP — run via `supabase test db`)
--
-- Regression test for 00177_membership_write_authz_rls.sql.
--
-- Guards the privilege-escalation gap where BOTH RBAC membership tables
-- authorised writes by membership alone, with no predicate on the caller's role:
--   projects.project_members  INSERT/UPDATE/DELETE gated only on
--                             organisation_id = ANY(get_user_org_ids())  (00027)
--   public.user_organisations INSERT/UPDATE gated only on
--                             user_id = auth.uid()                       (00026)
-- letting any org member self-promote (project_manager per project, or 'owner'
-- org-wide) and letting a contractor DELETE every colleague's project membership.
-- public.user_effective_project_role then honours the forged role everywhere
-- requireEffectiveRole is trusted.
--
-- Two layers:
--   1. STRUCTURAL — the six RESTRICTIVE policies and both helper functions must
--      exist and be role-scoped. Fails if a future migration drops or reverts
--      them. Seed-free, environment-independent.
--   2. BEHAVIOURAL — reproduce each exploit as a contractor (must be BLOCKED)
--      and run the legitimate flows as org owner/admin (must be ALLOWED — the
--      positive control proving the guard does not over-block real admins).
--
-- NOTE: requires the local Supabase stack (`supabase test db`). The behavioural
-- seed inserts into auth.users; if your GoTrue schema version differs, adjust
-- the seed columns. The structural section is independent of that seed.
-- ---------------------------------------------------------------------------
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT no_plan();

-- ─────────────────────────────────────────────────────────────────────────
-- (1) STRUCTURAL: the RESTRICTIVE guards and helpers exist.
-- ─────────────────────────────────────────────────────────────────────────
SELECT is(
    (SELECT count(*)::int FROM pg_policies
      WHERE schemaname = 'projects' AND tablename = 'project_members'
        AND policyname LIKE 'membership_write_authz_%'
        AND permissive = 'RESTRICTIVE'),
    3,
    'projects.project_members has 3 RESTRICTIVE write guards (insert/update/delete)'
);

SELECT is(
    (SELECT count(*)::int FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'user_organisations'
        AND policyname LIKE 'org_membership_write_authz_%'
        AND permissive = 'RESTRICTIVE'),
    3,
    'public.user_organisations has 3 RESTRICTIVE write guards (insert/update/delete)'
);

-- The UPDATE guards must carry BOTH USING and WITH CHECK: 00027/00026 defined
-- UPDATE with USING only, so the *new* row was never validated.
SELECT ok(
    (SELECT coalesce(with_check, '') <> '' AND coalesce(qual, '') <> ''
       FROM pg_policies
      WHERE schemaname = 'projects' AND tablename = 'project_members'
        AND policyname = 'membership_write_authz_update'),
    'project_members UPDATE guard validates both the old and the new row'
);

SELECT ok(
    (SELECT coalesce(with_check, '') <> '' AND coalesce(qual, '') <> ''
       FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'user_organisations'
        AND policyname = 'org_membership_write_authz_update'),
    'user_organisations UPDATE guard validates both the old and the new row'
);

-- The project_members guard must key on the PROJECT, not the row's org, so the
-- cross-org (sub-org identity) convention from 00160 stays expressible.
SELECT ok(
    (SELECT coalesce(with_check, '') LIKE '%user_can_manage_project_members%'
       FROM pg_policies
      WHERE schemaname = 'projects' AND tablename = 'project_members'
        AND policyname = 'membership_write_authz_insert'),
    'project_members INSERT guard authorises via the project-scoped helper'
);

SELECT has_function('public', 'user_can_manage_project_members', ARRAY['uuid']);
SELECT has_function('public', 'user_is_org_admin',               ARRAY['uuid']);

-- Both helpers must be SECURITY DEFINER with row_security off: that is what
-- lets a policy ON user_organisations call a helper that READS
-- user_organisations without tripping the RLS recursion 00026 documents.
SELECT ok(
    (SELECT p.prosecdef AND array_to_string(p.proconfig, ',') LIKE '%row_security=off%'
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'user_is_org_admin'),
    'user_is_org_admin is SECURITY DEFINER with row_security off'
);

SELECT ok(
    (SELECT p.prosecdef AND array_to_string(p.proconfig, ',') LIKE '%row_security=off%'
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'user_can_manage_project_members'),
    'user_can_manage_project_members is SECURITY DEFINER with row_security off'
);

-- SELECT must stay untouched — get_user_org_ids(), the team roster and
-- notification recipient resolution all depend on reading these tables.
SELECT is(
    (SELECT count(*)::int FROM pg_policies
      WHERE ((schemaname = 'projects' AND tablename = 'project_members')
          OR (schemaname = 'public'   AND tablename = 'user_organisations'))
        AND permissive = 'RESTRICTIVE' AND cmd = 'SELECT'
        AND policyname LIKE '%membership_write_authz%'),
    0,
    'no RESTRICTIVE guard narrows SELECT on either membership table'
);

-- ─────────────────────────────────────────────────────────────────────────
-- (2) BEHAVIOURAL: reproduce the escalation and prove it is blocked.
-- ─────────────────────────────────────────────────────────────────────────
-- Identities: org 1a…01 owns project 1e…01.
--   owner 1c…01 | admin 1d…01 | contractor 1f…01
-- Second org 2a…01 exists only as a cross-org target.
INSERT INTO auth.users (instance_id, id, aud, role, email,
                        created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-000000000000','1c000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','mem-owner@test.local',      now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000','1d000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','mem-admin@test.local',      now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000','1f000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','mem-contractor@test.local', now(), now(), '{}', '{}');

INSERT INTO public.organisations (id, name, slug) VALUES
  ('1a000000-0000-0000-0000-000000000001','Membership RLS Test Org','mem-rls-test-org'),
  ('2a000000-0000-0000-0000-000000000001','Membership RLS Other Org','mem-rls-other-org');

INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
  ('1c000000-0000-0000-0000-000000000001','1a000000-0000-0000-0000-000000000001','owner',     TRUE),
  ('1d000000-0000-0000-0000-000000000001','1a000000-0000-0000-0000-000000000001','admin',     TRUE),
  ('1f000000-0000-0000-0000-000000000001','1a000000-0000-0000-0000-000000000001','contractor',TRUE);

INSERT INTO projects.projects (id, organisation_id, created_by, name, code, status)
VALUES ('1e000000-0000-0000-0000-000000000001','1a000000-0000-0000-0000-000000000001',
        '1c000000-0000-0000-0000-000000000001','Membership RLS Test Project','MEM-RLS-1','active');

-- The contractor's own (legitimate, narrow) project membership.
INSERT INTO projects.project_members (project_id, user_id, organisation_id, role)
VALUES ('1e000000-0000-0000-0000-000000000001','1f000000-0000-0000-0000-000000000001',
        '1a000000-0000-0000-0000-000000000001','contractor');

CREATE TEMP TABLE _mem_results (name TEXT, passed BOOLEAN) ON COMMIT DROP;

-- (a) contractor self-inserts a project_manager row — the core escalation.
DO $b$
DECLARE ok BOOLEAN;
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub','1f000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub','1f000000-0000-0000-0000-000000000001', true);
    PERFORM set_config('role','authenticated', true);
    BEGIN
        INSERT INTO projects.project_members (project_id, user_id, organisation_id, role)
        VALUES ('1e000000-0000-0000-0000-000000000001','1c000000-0000-0000-0000-000000000001',
                '1a000000-0000-0000-0000-000000000001','project_manager');
        ok := FALSE;
    EXCEPTION WHEN insufficient_privilege THEN
        ok := TRUE;
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _mem_results VALUES ('contractor INSERT into project_members is blocked', ok);
END $b$;

-- (b) contractor promotes their OWN project_members row.
DO $b$
DECLARE n INT;
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub','1f000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub','1f000000-0000-0000-0000-000000000001', true);
    PERFORM set_config('role','authenticated', true);
    UPDATE projects.project_members SET role = 'project_manager'
     WHERE user_id = '1f000000-0000-0000-0000-000000000001';
    GET DIAGNOSTICS n = ROW_COUNT;
    EXECUTE 'RESET ROLE';
    INSERT INTO _mem_results VALUES ('contractor cannot self-promote their project_members row', n = 0);
END $b$;

-- (c) contractor DELETEs a colleague's project membership (destructive path).
DO $b$
DECLARE n INT;
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub','1f000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub','1f000000-0000-0000-0000-000000000001', true);
    PERFORM set_config('role','authenticated', true);
    DELETE FROM projects.project_members
     WHERE project_id = '1e000000-0000-0000-0000-000000000001';
    GET DIAGNOSTICS n = ROW_COUNT;
    EXECUTE 'RESET ROLE';
    INSERT INTO _mem_results VALUES ('contractor cannot DELETE project_members rows', n = 0);
END $b$;

-- (d) contractor self-inserts an 'owner' membership into a FOREIGN org.
DO $b$
DECLARE ok BOOLEAN;
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub','1f000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub','1f000000-0000-0000-0000-000000000001', true);
    PERFORM set_config('role','authenticated', true);
    BEGIN
        INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active)
        VALUES ('1f000000-0000-0000-0000-000000000001','2a000000-0000-0000-0000-000000000001','owner',TRUE);
        ok := FALSE;
    EXCEPTION WHEN insufficient_privilege THEN
        ok := TRUE;
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _mem_results VALUES ('contractor INSERT into user_organisations is blocked', ok);
END $b$;

-- (e) contractor promotes their OWN org membership to 'owner'.
DO $b$
DECLARE n INT;
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub','1f000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub','1f000000-0000-0000-0000-000000000001', true);
    PERFORM set_config('role','authenticated', true);
    UPDATE public.user_organisations SET role = 'owner'
     WHERE user_id = '1f000000-0000-0000-0000-000000000001';
    GET DIAGNOSTICS n = ROW_COUNT;
    EXECUTE 'RESET ROLE';
    INSERT INTO _mem_results VALUES ('contractor cannot self-promote to org owner', n = 0);
END $b$;

-- (f) POSITIVE CONTROL: org owner may still add a project member.
DO $b$
DECLARE ok BOOLEAN;
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub','1c000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub','1c000000-0000-0000-0000-000000000001', true);
    PERFORM set_config('role','authenticated', true);
    BEGIN
        INSERT INTO projects.project_members (project_id, user_id, organisation_id, role)
        VALUES ('1e000000-0000-0000-0000-000000000001','1d000000-0000-0000-0000-000000000001',
                '1a000000-0000-0000-0000-000000000001','inspector');
        ok := TRUE;
    EXCEPTION WHEN insufficient_privilege THEN
        ok := FALSE;
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _mem_results VALUES ('org owner INSERT into project_members is allowed', ok);
END $b$;

-- (g) POSITIVE CONTROL: org admin may still change a project member's role.
DO $b$
DECLARE n INT;
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub','1d000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub','1d000000-0000-0000-0000-000000000001', true);
    PERFORM set_config('role','authenticated', true);
    UPDATE projects.project_members SET role = 'client_viewer'
     WHERE user_id = '1f000000-0000-0000-0000-000000000001';
    GET DIAGNOSTICS n = ROW_COUNT;
    EXECUTE 'RESET ROLE';
    INSERT INTO _mem_results VALUES ('org admin UPDATE of a project_members role is allowed', n = 1);
END $b$;

-- (h) POSITIVE CONTROL: reads are untouched — the contractor still sees the
--     roster, and get_user_org_ids() (which every other policy leans on) works.
DO $b$
DECLARE n INT; orgs INT;
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub','1f000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub','1f000000-0000-0000-0000-000000000001', true);
    PERFORM set_config('role','authenticated', true);
    SELECT count(*) INTO n FROM projects.project_members
     WHERE project_id = '1e000000-0000-0000-0000-000000000001';
    SELECT coalesce(array_length(public.get_user_org_ids(), 1), 0) INTO orgs;
    EXECUTE 'RESET ROLE';
    INSERT INTO _mem_results VALUES ('contractor still reads project_members and resolves org ids',
                                     n > 0 AND orgs > 0);
END $b$;

SELECT ok(passed, name) FROM _mem_results ORDER BY name;

SELECT * FROM finish();
ROLLBACK;
