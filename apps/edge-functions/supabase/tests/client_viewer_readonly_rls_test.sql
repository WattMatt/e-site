-- ---------------------------------------------------------------------------
-- client_viewer_readonly_rls_test.sql   (pgTAP — run via `supabase test db`)
--
-- Regression test for 00161_client_viewer_readonly_write_block.sql.
--
-- Guards against the production authz gap where a client_viewer could write
-- org-scoped rows via the REST API (confirmed: HTTP 201 creating field.snags),
-- because write policies authorised by org membership alone.
--
-- Two layers:
--   1. STRUCTURAL — every covered table must carry RESTRICTIVE INSERT/UPDATE/
--      DELETE policies that reference public.user_is_client_viewer. This fails
--      if a future migration drops a guard or a new write surface is added to
--      the list without one. Seed-free, environment-independent.
--   2. BEHAVIOURAL — reproduce the exploit on field.snags: a client_viewer is
--      blocked from INSERT/UPDATE/DELETE, while a project_manager still can
--      (positive control — proves the guard does not over-block real roles).
--
-- NOTE: requires the local Supabase stack (`supabase test db`). The behavioural
-- seed inserts into auth.users; if your GoTrue schema version differs, adjust
-- the seed columns. The structural section is independent of that seed.
-- ---------------------------------------------------------------------------
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT no_plan();

-- ─────────────────────────────────────────────────────────────────────────
-- (1) STRUCTURAL: coverage over every table 00161 is meant to protect.
-- ─────────────────────────────────────────────────────────────────────────
SELECT ok(
    EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname = tbl.s
          AND p.tablename  = tbl.t
          AND p.permissive = 'RESTRICTIVE'
          AND p.cmd        = cmd.c
          AND coalesce(p.qual, '') || coalesce(p.with_check, '')
              LIKE '%user_is_client_viewer%'
    ),
    format('%I.%I has a RESTRICTIVE %s guard against client_viewer', tbl.s, tbl.t, cmd.c)
)
FROM (VALUES
    -- Group A: direct organisation_id column
    ('field','snags'),               ('field','snag_visits'),
    ('projects','rfis'),             ('projects','drawings'),
    ('projects','project_members'),  ('public','attachments'),
    ('public','rfi_annotations'),    ('tenants','floor_plans'),
    ('gcr','settings'),              ('gcr','zones'),
    ('gcr','zone_generators'),       ('gcr','tenant_assignments'),
    ('marketplace','catalogue_items'),
    -- Group B: org resolved through parent row
    ('field','snag_photos'),         ('projects','rfi_responses'),
    ('projects','site_diary_attachments'),
    -- Group C: marketplace orders + items
    ('marketplace','orders'),        ('marketplace','order_items')
) AS tbl(s, t)
CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE')) AS cmd(c);

-- storage.objects org-path bucket write guards (00162).
SELECT ok(
    EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'storage'
          AND p.tablename  = 'objects'
          AND p.policyname = v.pol
          AND p.permissive = 'RESTRICTIVE'
          AND p.cmd        = v.c
          AND coalesce(p.qual, '') || coalesce(p.with_check, '')
              LIKE '%user_is_client_viewer%'
    ),
    format('storage.objects has %s (%s) blocking client_viewer bucket writes', v.pol, v.c)
)
FROM (VALUES
    ('client_viewer_no_bucket_insert','INSERT'),
    ('client_viewer_no_bucket_update','UPDATE'),
    ('client_viewer_no_bucket_delete','DELETE')
) AS v(pol, c);

-- ─────────────────────────────────────────────────────────────────────────
-- (2) BEHAVIOURAL: reproduce and block the field.snags exploit.
-- ─────────────────────────────────────────────────────────────────────────

-- Fixed test identities.
--   org      0a…01   |  viewer 0b…01 (client_viewer)  |  pm 0c…01 (project_manager)
--   project  0d…01   |  snag(update) 0e…01  |  snag(delete) 0e…02
-- Inserting into auth.users fires the public.handle_new_user() trigger, which
-- auto-creates the matching public.profiles row (full_name defaults to the
-- email local-part). Do NOT insert profiles explicitly — that would duplicate.
INSERT INTO auth.users (instance_id, id, aud, role, email,
                        created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-000000000000','0b000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','rls-viewer@test.local', now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000','0c000000-0000-0000-0000-000000000001',
   'authenticated','authenticated','rls-pm@test.local',     now(), now(), '{}', '{}');

INSERT INTO public.organisations (id, name, slug)
VALUES ('0a000000-0000-0000-0000-000000000001','RLS Test Org','rls-test-org');

INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES
  ('0b000000-0000-0000-0000-000000000001','0a000000-0000-0000-0000-000000000001','client_viewer',TRUE),
  ('0c000000-0000-0000-0000-000000000001','0a000000-0000-0000-0000-000000000001','project_manager',TRUE);

INSERT INTO projects.projects (id, organisation_id, name, status, created_by)
VALUES ('0d000000-0000-0000-0000-000000000001','0a000000-0000-0000-0000-000000000001',
        'RLS Test Project','active','0c000000-0000-0000-0000-000000000001');

-- Seed rows (owned by the org) for UPDATE / DELETE attempts.
INSERT INTO field.snags (id, project_id, organisation_id, title, raised_by) VALUES
  ('0e000000-0000-0000-0000-000000000001','0d000000-0000-0000-0000-000000000001',
   '0a000000-0000-0000-0000-000000000001','seed snag (update)','0c000000-0000-0000-0000-000000000001'),
  ('0e000000-0000-0000-0000-000000000002','0d000000-0000-0000-0000-000000000001',
   '0a000000-0000-0000-0000-000000000001','seed snag (delete)','0c000000-0000-0000-0000-000000000001');

CREATE TEMP TABLE _rls_results (name TEXT, passed BOOLEAN) ON COMMIT DROP;

-- Helper: run `body` as the given user (Supabase JWT sim), always reset after.
-- Results are recorded by each block; pgTAP assertions run afterwards as the
-- test (superuser) role so pgTAP never executes as `authenticated`.
DO $b$
DECLARE ok BOOLEAN;
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub','0b000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub','0b000000-0000-0000-0000-000000000001', true);
    PERFORM set_config('role','authenticated', true);
    BEGIN
        INSERT INTO field.snags (project_id, organisation_id, title, raised_by)
        VALUES ('0d000000-0000-0000-0000-000000000001','0a000000-0000-0000-0000-000000000001',
                'viewer should not create this','0b000000-0000-0000-0000-000000000001');
        ok := FALSE;                       -- insert unexpectedly succeeded → FAIL
    EXCEPTION WHEN insufficient_privilege THEN
        ok := TRUE;                        -- RLS blocked the write → PASS
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _rls_results VALUES ('client_viewer INSERT into field.snags is blocked', ok);
END $b$;

DO $b$
DECLARE ok BOOLEAN;
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub','0c000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub','0c000000-0000-0000-0000-000000000001', true);
    PERFORM set_config('role','authenticated', true);
    BEGIN
        INSERT INTO field.snags (project_id, organisation_id, title, raised_by)
        VALUES ('0d000000-0000-0000-0000-000000000001','0a000000-0000-0000-0000-000000000001',
                'pm may create this','0c000000-0000-0000-0000-000000000001');
        ok := TRUE;                        -- allowed → PASS
    EXCEPTION WHEN insufficient_privilege THEN
        ok := FALSE;                       -- over-blocked a real role → FAIL
    END;
    EXECUTE 'RESET ROLE';
    INSERT INTO _rls_results VALUES ('project_manager INSERT into field.snags is allowed', ok);
END $b$;

DO $b$
DECLARE n INT;
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub','0b000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub','0b000000-0000-0000-0000-000000000001', true);
    PERFORM set_config('role','authenticated', true);
    UPDATE field.snags SET title = 'viewer edit'
      WHERE id = '0e000000-0000-0000-0000-000000000001';
    GET DIAGNOSTICS n = ROW_COUNT;         -- RESTRICTIVE USING filters the row out
    EXECUTE 'RESET ROLE';
    INSERT INTO _rls_results VALUES ('client_viewer UPDATE of field.snags affects 0 rows', n = 0);
END $b$;

DO $b$
DECLARE n INT;
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub','0b000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub','0b000000-0000-0000-0000-000000000001', true);
    PERFORM set_config('role','authenticated', true);
    DELETE FROM field.snags WHERE id = '0e000000-0000-0000-0000-000000000002';
    GET DIAGNOSTICS n = ROW_COUNT;
    EXECUTE 'RESET ROLE';
    INSERT INTO _rls_results VALUES ('client_viewer DELETE of field.snags affects 0 rows', n = 0);
END $b$;

DO $b$
DECLARE n INT;
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub','0c000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub','0c000000-0000-0000-0000-000000000001', true);
    PERFORM set_config('role','authenticated', true);
    UPDATE field.snags SET title = 'pm edit'
      WHERE id = '0e000000-0000-0000-0000-000000000001';
    GET DIAGNOSTICS n = ROW_COUNT;
    EXECUTE 'RESET ROLE';
    INSERT INTO _rls_results VALUES ('project_manager UPDATE of field.snags affects 1 row', n = 1);
END $b$;

SELECT ok(passed, name) FROM _rls_results ORDER BY name;

SELECT * FROM finish();
ROLLBACK;
