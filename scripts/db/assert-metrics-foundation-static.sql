-- STATIC assertions for the Q1 metrics/presence/calendar migration.
--
-- Reads only APPLIED STRUCTURE — objects, RLS, policies, grants, calendar
-- arithmetic, the cron job. Nothing here depends on a row this file inserted,
-- so it is safe to run read-only against production after the real apply
-- (scripts/db/smoke-test-metrics-foundation.sh section 1).
--
-- Anything that needs a seeded row lives in assert-metrics-foundation-seeded.sql
-- and only ever runs inside a transaction that rolls back.
--
-- MUST end in exactly one statement returning (check text, ok boolean).

SELECT 'user_is_org_admin() zero-arg overload exists' AS check,
       to_regprocedure('public.user_is_org_admin()') IS NOT NULL AS ok
UNION ALL
SELECT '00177''s one-arg user_is_org_admin(uuid) survives untouched',
       to_regprocedure('public.user_is_org_admin(uuid)') IS NOT NULL
UNION ALL
-- MEASURED against production 2026-09-10, not assumed: exactly THREE policies
-- reference user_is_org_admin, all on public.user_organisations (the insert,
-- update and delete RESTRICTIVE gates from 00177). projects.project_members'
-- three RESTRICTIVE policies call a DIFFERENT function and are pinned below.
--
-- COALESCE on BOTH sides: qual is NULL on an INSERT policy, and
-- NULL || COALESCE(with_check,'') is NULL, which silently drops that policy
-- from the count. The un-COALESCEd form returns 2 and reads as a regression.
--
-- The argument is part of the pattern: a future policy calling the zero-arg
-- overload must not make `= 3` read as a regression of 00177's three.
SELECT '00177''s three user_organisations write policies survive',
       (SELECT count(*) FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'user_organisations'
           AND COALESCE(qual,'') || COALESCE(with_check,'') LIKE '%user_is_org_admin(organisation_id)%') = 3
UNION ALL
SELECT '00177''s three project_members write policies still use user_can_manage_project_members',
       (SELECT count(*) FROM pg_policies
         WHERE schemaname = 'projects' AND tablename = 'project_members'
           AND COALESCE(qual,'') || COALESCE(with_check,'') LIKE '%user_can_manage_project_members%') = 3
UNION ALL
-- CASE-guarded: has_function_privilege RAISES on an absent function, which aborts
-- the whole statement and hides every other arm. Each arm must honour the
-- (check, ok) contract on its own, so an absent function is a red line instead.
SELECT 'anon has no EXECUTE on user_is_org_admin()',
       CASE WHEN to_regprocedure('public.user_is_org_admin()') IS NULL THEN false
            ELSE NOT has_function_privilege('anon', 'public.user_is_org_admin()', 'EXECUTE') END
UNION ALL
SELECT 'anon has no EXECUTE on metric_account_excluded(text)',
       CASE WHEN to_regprocedure('public.metric_account_excluded(text)') IS NULL THEN false
            ELSE NOT has_function_privilege('anon', 'public.metric_account_excluded(text)', 'EXECUTE') END
;
