-- assert-uhpa-jwt-claims.sql — subject D (the MOBILE half) for migration 00204.
--
-- Run through scripts/db/dry-run-migration.sh, which wraps this file as
--   BEGIN; <migration>; <this file>; ROLLBACK;
-- so NOTHING here persists: the rbac-test fixture's KINGSWALK membership is
-- soft-deactivated inside the transaction, the token hook is called on both
-- sides of that flip, and everything is rolled back.
--
-- Red/green: run it first against a no-op migration and watch
-- "deactivated member's next token DROPS KINGSWALK" fail — that is the mobile
-- leak (the web helper is fixed, the token is not). Against 00204 every row
-- must be ok.
--
-- WHY THIS IS CALLED AS postgres AND NOT IMPERSONATED. custom_jwt_claims is
-- the GoTrue custom-access-token hook: it is invoked by supabase_auth_admin
-- with the user id in its `event` payload, NOT by the user's own session, and
-- it reads no auth.uid(). postgres owns it, so calling it directly here is the
-- same code path the hook takes. Impersonating `authenticated` would instead
-- prove the grant is absent, which the last two rows assert separately.
--
-- WHAT THIS DOES NOT CLAIM. It proves the next token drops the project. It
-- says nothing about tokens already issued — deactivation is not a session
-- kill, and an outstanding access token keeps its project_ids until it
-- expires and is re-minted. That is unchanged by this migration and is stated
-- in the function's COMMENT.

SELECT set_config('x.kw',      '81fc2329-2462-457d-9d24-9b051673c909', true);  -- (643) KINGSWALK
SELECT set_config('x.fixture', '018f2d31-bbe8-4cc1-bbdd-63af0187081e', true);  -- rbac-test@e-site.live

-- A DIFFERENT active member, to prove the fix is narrow: whoever else holds an
-- active membership on KINGSWALK and is not the fixture. NULL if none exists,
-- which the ground-truth row below catches rather than passing vacuously.
SELECT set_config('x.control',
  coalesce((SELECT pm.user_id::text
              FROM projects.project_members pm
              JOIN public.user_organisations uo
                ON uo.user_id = pm.user_id AND uo.organisation_id = pm.organisation_id
             WHERE pm.project_id = current_setting('x.kw')::uuid
               AND pm.user_id <> current_setting('x.fixture')::uuid
               AND pm.is_active AND uo.is_active
             LIMIT 1), ''), true);

-- Baseline: the token the hook would mint for each of them RIGHT NOW.
SELECT set_config('x.before',
  (public.custom_jwt_claims(jsonb_build_object(
     'user_id', current_setting('x.fixture'), 'claims', '{}'::jsonb))
   -> 'claims' -> 'project_ids')::text, true);
SELECT set_config('x.ctrl_before',
  coalesce((public.custom_jwt_claims(jsonb_build_object(
     'user_id', nullif(current_setting('x.control'), ''), 'claims', '{}'::jsonb))
   -> 'claims' -> 'project_ids')::text, 'null'), true);

-- The act under test: soft-deactivate, do not delete.
UPDATE projects.project_members
   SET is_active = false
 WHERE user_id    = current_setting('x.fixture')::uuid
   AND project_id = current_setting('x.kw')::uuid;

-- Guard: exactly one row flipped, or the probe proves nothing.
DO $$
BEGIN
  IF (SELECT count(*) FROM projects.project_members
       WHERE user_id = current_setting('x.fixture')::uuid
         AND project_id = current_setting('x.kw')::uuid
         AND NOT is_active) <> 1 THEN
    RAISE EXCEPTION 'fixture membership was not deactivated — probe is void';
  END IF;
END $$;

-- The same two mints, after.
SELECT set_config('x.after',
  (public.custom_jwt_claims(jsonb_build_object(
     'user_id', current_setting('x.fixture'), 'claims', '{}'::jsonb))
   -> 'claims' -> 'project_ids')::text, true);
SELECT set_config('x.ctrl_after',
  coalesce((public.custom_jwt_claims(jsonb_build_object(
     'user_id', nullif(current_setting('x.control'), ''), 'claims', '{}'::jsonb))
   -> 'claims' -> 'project_ids')::text, 'null'), true);

-- org_id must keep being stamped — the fix touches project_ids only.
SELECT set_config('x.org_after',
  coalesce((public.custom_jwt_claims(jsonb_build_object(
     'user_id', current_setting('x.fixture'), 'claims', '{}'::jsonb))
   -> 'claims' ->> 'org_id'), ''), true);

SELECT * FROM (VALUES
  ('ground truth: the ACTIVE fixture token listed KINGSWALK (probe is not vacuous)',
     current_setting('x.before')::jsonb @> jsonb_build_array(current_setting('x.kw'))),
  ('deactivated member: next token DROPS KINGSWALK from claims.project_ids',
     NOT (current_setting('x.after')::jsonb @> jsonb_build_array(current_setting('x.kw')))),
  ('deactivated member: project_ids stays a JSON ARRAY (sync rule''s json_each still degrades cleanly)',
     jsonb_typeof(current_setting('x.after')::jsonb) = 'array'),
  ('deactivated member: claims.org_id is still stamped (org buckets untouched)',
     current_setting('x.org_after') <> ''),
  ('ground truth: a second ACTIVE member exists on KINGSWALK to control against',
     current_setting('x.control') <> ''),
  ('control: that active member''s token is byte-identical before and after',
     current_setting('x.ctrl_before') = current_setting('x.ctrl_after')),
  ('control: and it still lists KINGSWALK',
     current_setting('x.ctrl_after')::jsonb @> jsonb_build_array(current_setting('x.kw'))),
  ('hook attributes retained: SECURITY DEFINER, VOLATILE, search_path=public, owner postgres',
     (SELECT p.prosecdef AND p.provolatile = 'v'
             AND 'search_path=public' = ANY (p.proconfig)
             AND pg_get_userbyid(p.proowner) = 'postgres'
        FROM pg_proc p WHERE p.oid = 'public.custom_jwt_claims(jsonb)'::regprocedure)),
  ('the hook role can still EXECUTE it (a revoked hook breaks every sign-in)',
     has_function_privilege('supabase_auth_admin', 'public.custom_jwt_claims(jsonb)'::regprocedure, 'EXECUTE')),
  ('anon and authenticated still cannot EXECUTE it (CREATE OR REPLACE kept the ACL)',
     NOT has_function_privilege('anon', 'public.custom_jwt_claims(jsonb)'::regprocedure, 'EXECUTE')
     AND NOT has_function_privilege('authenticated', 'public.custom_jwt_claims(jsonb)'::regprocedure, 'EXECUTE'))
) AS t("check", ok);
