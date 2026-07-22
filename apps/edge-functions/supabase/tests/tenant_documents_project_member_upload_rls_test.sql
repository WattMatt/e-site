-- ---------------------------------------------------------------------------
-- tenant_documents_project_member_upload_rls_test.sql  (pgTAP — `supabase test db`)
--
-- Regression test for 00174_user_can_manage_project_effective_role.sql.
--
-- Guards against the latent authorization regression where the two authorities
-- that answer "can this user manage this project?" had diverged:
--
--   • Web gate    — requireEffectiveRole → public.user_effective_project_role
--                   (00107): org owner/admin/PM win, ELSE the user's active
--                   projects.project_members.role applies (per-project promotion).
--   • Storage RLS — public.user_can_manage_project (00085, is_active-fixed 00152):
--                   active org owner/admin/project_manager ONLY. No
--                   project_members promotion path.
--
-- Since PR #117 tenant drawing/scope uploads (and node-order-documents uploads,
-- incl. shop drawings) write DIRECTLY from the user's session to storage, so the
-- storage.objects INSERT policies — which gate on user_can_manage_project — are
-- the live upload gate. A user promoted to a write role via project_members (but
-- NOT an active org owner/admin/PM) passed the web gate and saw the upload UI,
-- yet the direct .upload() was denied ("new row violates row-level security
-- policy"). 00174 redefines user_can_manage_project as a wrapper over
-- user_effective_project_role, so the DB gate and the web gate are identical.
--
-- Two layers:
--   1. STRUCTURAL — user_can_manage_project must consult
--      user_effective_project_role (the single source of truth), and the two
--      live-upload buckets must still gate on it. Fails if a future migration
--      reverts the helper to an org-role-only body. Seed-free.
--   2. BEHAVIOURAL — reproduce the fix: a project-promoted contractor (org role
--      'contractor', project_members role 'project_manager') can INSERT into the
--      tenant-documents AND node-order-documents buckets; a plain contractor and
--      a project_members client_viewer are BLOCKED (negative controls — the gate
--      did not open to everyone), and an org admin still can (positive control —
--      no over-block).
--
-- NOTE: requires the local Supabase stack (`supabase test db`). The behavioural
-- seed inserts into auth.users; if your GoTrue schema version differs, adjust
-- the seed columns. The structural section is independent of that seed.
-- ---------------------------------------------------------------------------
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT no_plan();

-- ─────────────────────────────────────────────────────────────────────────
-- (1) STRUCTURAL: the helper is unified with the effective-role SSOT, and the
--     two live-upload storage buckets still gate on it.
-- ─────────────────────────────────────────────────────────────────────────
SELECT ok(
    EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'user_can_manage_project'
          AND pg_get_functiondef(p.oid) LIKE '%user_effective_project_role%'
    ),
    'user_can_manage_project consults user_effective_project_role (honours project_members promotion)'
);

SELECT ok(
    EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'tenant-documents write'
          AND coalesce(with_check, '') LIKE '%user_can_manage_project%'
    ),
    'tenant-documents write policy gates on user_can_manage_project'
);

SELECT ok(
    EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'node-order-documents write'
          AND coalesce(with_check, '') LIKE '%user_can_manage_project%'
    ),
    'node-order-documents write policy gates on user_can_manage_project'
);

-- ─────────────────────────────────────────────────────────────────────────
-- (2) BEHAVIOURAL: reproduce the project-promoted upload path end to end.
--
-- Fixed test identities (single org 0a…d1):
--   admin              0c…d1  (user_organisations.role = admin)
--   promoted-PM        0f…d1  (org 'contractor' + project_members 'project_manager')
--   plain contractor   0e…d1  (org 'contractor', NO project_members row)
--   promoted-viewer    0b…d1  (org 'contractor' + project_members 'client_viewer')
-- Inserting into auth.users fires public.handle_new_user(), which auto-creates
-- the matching public.profiles row. Do NOT insert profiles explicitly.
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO auth.users (instance_id, id, aud, role, email,
                        created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-000000000000','0c000000-0000-0000-0000-0000000000d1',
   'authenticated','authenticated','td-admin@test.local',      now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000','0f000000-0000-0000-0000-0000000000d1',
   'authenticated','authenticated','td-promoted-pm@test.local', now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000','0e000000-0000-0000-0000-0000000000d1',
   'authenticated','authenticated','td-contractor@test.local',  now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000','0b000000-0000-0000-0000-0000000000d1',
   'authenticated','authenticated','td-promoted-viewer@test.local', now(), now(), '{}', '{}');

INSERT INTO public.organisations (id, name, slug)
VALUES ('0a000000-0000-0000-0000-0000000000d1','Tenant-Docs RLS Test Org','td-rls-test-org');

INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
  ('0c000000-0000-0000-0000-0000000000d1','0a000000-0000-0000-0000-0000000000d1','admin',      TRUE),
  ('0f000000-0000-0000-0000-0000000000d1','0a000000-0000-0000-0000-0000000000d1','contractor', TRUE),
  ('0e000000-0000-0000-0000-0000000000d1','0a000000-0000-0000-0000-0000000000d1','contractor', TRUE),
  ('0b000000-0000-0000-0000-0000000000d1','0a000000-0000-0000-0000-0000000000d1','contractor', TRUE);

-- Project + tenant node (code/organisation auto-context). created_by must be a
-- real profile; use the admin. projects.code is trigger-filled (00095).
INSERT INTO projects.projects (id, organisation_id, name, status, created_by)
VALUES ('0d000000-0000-0000-0000-0000000000d1','0a000000-0000-0000-0000-0000000000d1',
        'Tenant-Docs RLS Test Project','active','0c000000-0000-0000-0000-0000000000d1');

INSERT INTO structure.nodes (id, project_id, organisation_id, kind, code, name, created_by)
VALUES ('01000000-0000-0000-0000-0000000000d1','0d000000-0000-0000-0000-0000000000d1',
        '0a000000-0000-0000-0000-0000000000d1','tenant_db','T-TEST','Test Tenant DB',
        '0c000000-0000-0000-0000-0000000000d1');

-- Per-project promotions: contractor 0f…d1 → project_manager, contractor 0b…d1 → client_viewer.
INSERT INTO projects.project_members (project_id, user_id, organisation_id, role, is_active) VALUES
  ('0d000000-0000-0000-0000-0000000000d1','0f000000-0000-0000-0000-0000000000d1',
   '0a000000-0000-0000-0000-0000000000d1','project_manager', TRUE),
  ('0d000000-0000-0000-0000-0000000000d1','0b000000-0000-0000-0000-0000000000d1',
   '0a000000-0000-0000-0000-0000000000d1','client_viewer',   TRUE);

CREATE TEMP TABLE _td_results (name TEXT, passed BOOLEAN) ON COMMIT DROP;

-- Helper pattern (inlined per block): act as `who` (JWT sub), attempt the
-- storage INSERT, record whether RLS allowed it, then RESET ROLE.
-- storage.objects RLS on the tenant-documents / node-order-documents buckets
-- extracts the project id from foldername[1] of `name`, so the path must be
-- {projectId}/{anything}/{file}.

-- (a) THE FIX: project-promoted contractor (effective role project_manager)
--     must be ALLOWED to upload into tenant-documents. RED before 00174.
DO $b$
DECLARE ok BOOLEAN;
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub','0f000000-0000-0000-0000-0000000000d1','role','authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub','0f000000-0000-0000-0000-0000000000d1', true);
    PERFORM set_config('role','authenticated', true);
    BEGIN
        INSERT INTO storage.objects (bucket_id, name)
        VALUES ('tenant-documents',
                '0d000000-0000-0000-0000-0000000000d1/01000000-0000-0000-0000-0000000000d1/promoted.pdf');
        ok := TRUE;                        -- allowed → PASS
    EXCEPTION WHEN insufficient_privilege THEN
        ok := FALSE;                       -- RLS blocked the promoted user → FAIL (the regression)
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _td_results VALUES ('project-promoted PM can upload to tenant-documents', ok);
END $b$;

-- (b) Same promoted contractor must ALSO be ALLOWED into node-order-documents
--     (the twin bucket the unified helper fixes).
DO $b$
DECLARE ok BOOLEAN;
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub','0f000000-0000-0000-0000-0000000000d1','role','authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub','0f000000-0000-0000-0000-0000000000d1', true);
    PERFORM set_config('role','authenticated', true);
    BEGIN
        INSERT INTO storage.objects (bucket_id, name)
        VALUES ('node-order-documents',
                '0d000000-0000-0000-0000-0000000000d1/01000000-0000-0000-0000-0000000000d1/promoted-order.pdf');
        ok := TRUE;
    EXCEPTION WHEN insufficient_privilege THEN
        ok := FALSE;
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _td_results VALUES ('project-promoted PM can upload to node-order-documents', ok);
END $b$;

-- (c) NEGATIVE CONTROL: a plain contractor with NO project_members row must
--     stay BLOCKED — the fix must not open the gate to every project member.
DO $b$
DECLARE ok BOOLEAN;
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub','0e000000-0000-0000-0000-0000000000d1','role','authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub','0e000000-0000-0000-0000-0000000000d1', true);
    PERFORM set_config('role','authenticated', true);
    BEGIN
        INSERT INTO storage.objects (bucket_id, name)
        VALUES ('tenant-documents',
                '0d000000-0000-0000-0000-0000000000d1/01000000-0000-0000-0000-0000000000d1/contractor.pdf');
        ok := FALSE;                       -- unexpectedly allowed → FAIL
    EXCEPTION WHEN insufficient_privilege THEN
        ok := TRUE;                        -- RLS blocked → PASS
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _td_results VALUES ('plain contractor (no project_members) is blocked from tenant-documents', ok);
END $b$;

-- (d) NEGATIVE CONTROL: a project_members promotion to a READ-ONLY role
--     (client_viewer) must stay BLOCKED — only write roles can manage.
DO $b$
DECLARE ok BOOLEAN;
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub','0b000000-0000-0000-0000-0000000000d1','role','authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub','0b000000-0000-0000-0000-0000000000d1', true);
    PERFORM set_config('role','authenticated', true);
    BEGIN
        INSERT INTO storage.objects (bucket_id, name)
        VALUES ('tenant-documents',
                '0d000000-0000-0000-0000-0000000000d1/01000000-0000-0000-0000-0000000000d1/viewer.pdf');
        ok := FALSE;
    EXCEPTION WHEN insufficient_privilege THEN
        ok := TRUE;
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _td_results VALUES ('project_members client_viewer is blocked from tenant-documents', ok);
END $b$;

-- (e) POSITIVE CONTROL: an org admin is still ALLOWED (no over-block).
DO $b$
DECLARE ok BOOLEAN;
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub','0c000000-0000-0000-0000-0000000000d1','role','authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub','0c000000-0000-0000-0000-0000000000d1', true);
    PERFORM set_config('role','authenticated', true);
    BEGIN
        INSERT INTO storage.objects (bucket_id, name)
        VALUES ('tenant-documents',
                '0d000000-0000-0000-0000-0000000000d1/01000000-0000-0000-0000-0000000000d1/admin.pdf');
        ok := TRUE;
    EXCEPTION WHEN insufficient_privilege THEN
        ok := FALSE;
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _td_results VALUES ('org admin can still upload to tenant-documents (no over-block)', ok);
END $b$;

SELECT ok(passed, name) FROM _td_results ORDER BY name;

SELECT * FROM finish();
ROLLBACK;
