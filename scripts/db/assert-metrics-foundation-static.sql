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
UNION ALL
-- Section 2: public.product_events + emit_product_event().
SELECT 'product_events exists', to_regclass('public.product_events') IS NOT NULL
UNION ALL
SELECT 'product_events has RLS on',
       COALESCE((SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='product_events'), false)
UNION ALL
SELECT 'product_events is append-only (no UPDATE/DELETE policy)',
       NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='product_events'
                     AND cmd IN ('UPDATE','DELETE'))
UNION ALL
-- The gate must be ORG-SCOPED, not the zero-arg overload: product_events
-- carries organisation_id NOT NULL and a zero-arg check is true for an
-- owner/admin of ANY org, which is a cross-tenant read.
SELECT 'product_events read gate is org-scoped, not platform-wide',
       COALESCE((SELECT qual LIKE '%user_is_org_admin(organisation_id)%'
                   FROM pg_policies WHERE schemaname='public' AND tablename='product_events'
                    AND policyname='product_events_admin_only'), false)
UNION ALL
-- CASE-guarded like the function arms: has_table_privilege RAISES on an absent
-- relation, which would abort the statement and hide every other arm.
SELECT 'anon cannot SELECT product_events',
       CASE WHEN to_regclass('public.product_events') IS NULL THEN false
            ELSE NOT has_table_privilege('anon', 'public.product_events', 'SELECT') END
UNION ALL
-- CASE-guarded for the same reason as the arms above: an absent function
-- must print a red line, not abort the statement.
SELECT 'anon cannot EXECUTE emit_product_event',
       CASE WHEN to_regprocedure('public.emit_product_event(uuid,uuid,text,jsonb,uuid,uuid)') IS NULL THEN false
            ELSE NOT has_function_privilege('anon', 'public.emit_product_event(uuid,uuid,text,jsonb,uuid,uuid)', 'EXECUTE') END
UNION ALL
SELECT 'authenticated cannot EXECUTE emit_product_event',
       CASE WHEN to_regprocedure('public.emit_product_event(uuid,uuid,text,jsonb,uuid,uuid)') IS NULL THEN false
            ELSE NOT has_function_privilege('authenticated', 'public.emit_product_event(uuid,uuid,text,jsonb,uuid,uuid)', 'EXECUTE') END
;
