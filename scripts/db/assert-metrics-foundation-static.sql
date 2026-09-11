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
UNION ALL
-- Section 3: metric_accounts (view), metric_cohorts, platform_metrics_weekly.
SELECT 'metric_accounts excludes the rbac-test fixture',
       NOT EXISTS (SELECT 1 FROM public.metric_accounts WHERE email = 'rbac-test@e-site.live')
UNION ALL
SELECT 'metric_accounts excludes %probe% accounts',
       NOT EXISTS (SELECT 1 FROM public.metric_accounts WHERE email LIKE '%probe%')
UNION ALL
-- Measured 2026-09-10: 35 of 36 profiles survive the exclusion rule.
SELECT 'metric_accounts still holds the real estate (>= 30 of 36)',
       (SELECT count(*) FROM public.metric_accounts) >= 30
UNION ALL
SELECT 'weekly_active cohort is inside the 10..35 band',
       (SELECT count(*) FROM public.metric_cohorts
         WHERE cohort_key = 'weekly_active_denominator' AND as_of = DATE '2026-09-09') BETWEEN 10 AND 35
UNION ALL
SELECT 'contractor cohort is frozen at 12 (13 minus the fixture), by EFFECTIVE role',
       (SELECT count(*) FROM public.metric_cohorts
         WHERE cohort_key = 'contractor_frozen' AND as_of = DATE '2026-09-09') = 12
UNION ALL
SELECT 'client-viewer cohort is frozen at 4',
       (SELECT count(*) FROM public.metric_cohorts
         WHERE cohort_key = 'client_viewer_frozen' AND as_of = DATE '2026-09-09') = 4
UNION ALL
SELECT 'every cohort row carries an organisation, so its read gate can be org-scoped',
       NOT EXISTS (SELECT 1 FROM public.metric_cohorts WHERE organisation_id IS NULL)
UNION ALL
SELECT 'metric_cohorts read gate is org-scoped, not platform-wide',
       COALESCE((SELECT qual LIKE '%user_is_org_admin(organisation_id)%'
                   FROM pg_policies WHERE schemaname='public' AND tablename='metric_cohorts'
                    AND policyname='metric_cohorts_admin_only'), false)
UNION ALL
SELECT 'platform_metrics_weekly exists with RLS on',
       COALESCE((SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='platform_metrics_weekly'), false)
UNION ALL
-- COALESCE to false, so an ABSENT constraint fails. Without it the subquery
-- returns NULL for a missing constraint and NULL is not true — but a NOT
-- EXISTS phrasing would have passed vacuously, which is the pathology this
-- whole file exists to avoid.
SELECT 'the baseline/iso_week constraint exists and references iso_week',
       COALESCE((SELECT pg_get_constraintdef(c.oid) LIKE '%iso_week%'
                   FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
                  WHERE t.relname = 'platform_metrics_weekly'
                    AND c.conname = 'platform_metrics_weekly_baseline_week'), false)
UNION ALL
SELECT 'the measured-has-value constraint exists',
       COALESCE((SELECT true FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
                  WHERE t.relname = 'platform_metrics_weekly'
                    AND c.conname = 'platform_metrics_weekly_measured_has_value'), false)
UNION ALL
SELECT 'the iso-matches-window constraint exists',
       COALESCE((SELECT true FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
                  WHERE t.relname = 'platform_metrics_weekly'
                    AND c.conname = 'platform_metrics_weekly_iso_matches_window'), false)
UNION ALL
SELECT 'the weekly-window constraint exists',
       COALESCE((SELECT true FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
                  WHERE t.relname = 'platform_metrics_weekly'
                    AND c.conname = 'platform_metrics_weekly_weekly_window'), false)
UNION ALL
-- CASE-guarded like every other privilege arm. service_role only: the seeds
-- and the rollup call it without a user session, and nothing else should.
SELECT 'anon cannot EXECUTE project_had_activity',
       CASE WHEN to_regprocedure('projects.project_had_activity(uuid,timestamptz,timestamptz)') IS NULL THEN false
            ELSE NOT has_function_privilege('anon', 'projects.project_had_activity(uuid,timestamptz,timestamptz)', 'EXECUTE') END
UNION ALL
SELECT 'authenticated cannot EXECUTE project_had_activity',
       CASE WHEN to_regprocedure('projects.project_had_activity(uuid,timestamptz,timestamptz)') IS NULL THEN false
            ELSE NOT has_function_privilege('authenticated', 'projects.project_had_activity(uuid,timestamptz,timestamptz)', 'EXECUTE') END
UNION ALL
-- CASE-guarded like every other privilege arm: has_table_privilege RAISES on
-- an absent relation, which would abort the statement and hide every other arm.
SELECT 'anon cannot SELECT platform_metrics_weekly',
       CASE WHEN to_regclass('public.platform_metrics_weekly') IS NULL THEN false
            ELSE NOT has_table_privilege('anon', 'public.platform_metrics_weekly', 'SELECT') END
UNION ALL
SELECT 'anon cannot SELECT metric_cohorts',
       CASE WHEN to_regclass('public.metric_cohorts') IS NULL THEN false
            ELSE NOT has_table_privilege('anon', 'public.metric_cohorts', 'SELECT') END
UNION ALL
-- Section 4: user_presence, user_sessions, touch_presence().
SELECT 'user_presence exists', to_regclass('public.user_presence') IS NOT NULL
UNION ALL
SELECT 'user_sessions exists', to_regclass('public.user_sessions') IS NOT NULL
UNION ALL
-- = 2, one CHECK per table. The vocabulary is fixed HERE, before three callers
-- in three different Q1 items invent three spellings; a drift is unrecoverable
-- for the quarter item 10 needs to split sessions by platform.
SELECT 'the platform vocabulary is fixed by a CHECK on both tables',
       (SELECT count(*) FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
         WHERE t.relname IN ('user_presence','user_sessions')
           AND t.relnamespace = 'public'::regnamespace
           AND c.contype = 'c'
           AND pg_get_constraintdef(c.oid) LIKE '%mobile_app%') = 2
UNION ALL
-- CASE-guarded like every other privilege arm: an absent function must print a
-- red line, not abort the statement.
SELECT 'anon cannot EXECUTE touch_presence',
       CASE WHEN to_regprocedure('public.touch_presence(text,text)') IS NULL THEN false
            ELSE NOT has_function_privilege('anon', 'public.touch_presence(text,text)', 'EXECUTE') END
UNION ALL
SELECT 'authenticated CAN execute touch_presence (the app shell calls it)',
       CASE WHEN to_regprocedure('public.touch_presence(text,text)') IS NULL THEN false
            ELSE has_function_privilege('authenticated', 'public.touch_presence(text,text)', 'EXECUTE') END
UNION ALL
-- COALESCE to false: no policy row means the subquery is NULL, and NULL is not
-- true — but it must read as a red line, not vanish.
SELECT 'a user reads only their own session rows',
       COALESCE((SELECT qual LIKE '%auth.uid()%' FROM pg_policies
                  WHERE schemaname='public' AND tablename='user_sessions'
                    AND policyname='user_sessions_own'), false)
UNION ALL
-- CASE-guarded: has_table_privilege RAISES on an absent relation.
SELECT 'anon cannot SELECT user_sessions',
       CASE WHEN to_regclass('public.user_sessions') IS NULL THEN false
            ELSE NOT has_table_privilege('anon', 'public.user_sessions', 'SELECT') END
UNION ALL
SELECT 'anon cannot SELECT user_presence',
       CASE WHEN to_regclass('public.user_presence') IS NULL THEN false
            ELSE NOT has_table_privilege('anon', 'public.user_presence', 'SELECT') END
UNION ALL
-- Section 5: the A(h) calendar — public_holidays, calendar_years,
-- working_days_between(). The two invariants mirror the migration's `sql:`
-- directives: never a row count, which would go red the day the October
-- re-seed adds a year and block every later deploy.
SELECT 'calendar_years and public_holidays agree — every registered year has holidays seeded',
       (SELECT bool_and(EXISTS (SELECT 1 FROM projects.public_holidays ph
                                 WHERE extract(year from ph.d)::int = cy.year))
          FROM projects.calendar_years cy)
UNION ALL
SELECT 'the calendar horizon reaches at least five years past today',
       (SELECT max(year) FROM projects.calendar_years) >= extract(year from CURRENT_DATE)::int + 5
UNION ALL
-- COALESCE to false: no pg_proc row means the subquery is NULL, and an absent
-- function must read as a red line.
SELECT 'working_days_between is STABLE, never IMMUTABLE',
       COALESCE((SELECT p.provolatile = 's' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'projects' AND p.proname = 'working_days_between'), false)
UNION ALL
SELECT 'p_calendar has NO default — every caller states its calendar',
       COALESCE((SELECT pronargdefaults = 0 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'projects' AND p.proname = 'working_days_between'), false)
UNION ALL
-- Every arm below resolves the SAME pinned project: one whose working week is
-- the default Mon-Fri with no extra holidays. Measured 2026-09-10: all 14
-- project_settings rows qualify. An unordered LIMIT 1 over projects.projects
-- would make these numbers flap the day one project works Saturdays.
SELECT 'office: Mon 2026-06-01 -> Fri 2026-06-05 is 4 working days',
       projects.working_days_between(timestamptz '2026-06-01 08:00+02', timestamptz '2026-06-05 08:00+02',
         (SELECT project_id FROM projects.project_settings
           WHERE working_days = ARRAY[1,2,3,4,5] AND COALESCE(array_length(extra_holidays,1),0) = 0
           ORDER BY project_id LIMIT 1), 'office') = 4
UNION ALL
SELECT 'office skips Youth Day: Mon 15 -> Wed 17 June 2026 is 1',
       projects.working_days_between(timestamptz '2026-06-15 08:00+02', timestamptz '2026-06-17 08:00+02',
         (SELECT project_id FROM projects.project_settings
           WHERE working_days = ARRAY[1,2,3,4,5] AND COALESCE(array_length(extra_holidays,1),0) = 0
           ORDER BY project_id LIMIT 1), 'office') = 1
UNION ALL
SELECT 'site adds Saturday: Mon 1 -> Mon 8 June 2026 is 6, office is 5',
       projects.working_days_between(timestamptz '2026-06-01 08:00+02', timestamptz '2026-06-08 08:00+02',
         (SELECT project_id FROM projects.project_settings
           WHERE working_days = ARRAY[1,2,3,4,5] AND COALESCE(array_length(extra_holidays,1),0) = 0
           ORDER BY project_id LIMIT 1), 'site') = 6
   AND projects.working_days_between(timestamptz '2026-06-01 08:00+02', timestamptz '2026-06-08 08:00+02',
         (SELECT project_id FROM projects.project_settings
           WHERE working_days = ARRAY[1,2,3,4,5] AND COALESCE(array_length(extra_holidays,1),0) = 0
           ORDER BY project_id LIMIT 1), 'office') = 5
UNION ALL
-- CASE-guarded like every other privilege arm: has_table_privilege and
-- has_function_privilege RAISE on an absent object, which would abort the
-- statement and hide every other arm.
SELECT 'anon cannot SELECT projects.public_holidays',
       CASE WHEN to_regclass('projects.public_holidays') IS NULL THEN false
            ELSE NOT has_table_privilege('anon', 'projects.public_holidays', 'SELECT') END
UNION ALL
SELECT 'anon cannot SELECT projects.calendar_years',
       CASE WHEN to_regclass('projects.calendar_years') IS NULL THEN false
            ELSE NOT has_table_privilege('anon', 'projects.calendar_years', 'SELECT') END
UNION ALL
SELECT 'anon cannot EXECUTE working_days_between',
       CASE WHEN to_regprocedure('projects.working_days_between(timestamptz,timestamptz,uuid,text)') IS NULL THEN false
            ELSE NOT has_function_privilege('anon', 'projects.working_days_between(timestamptz,timestamptz,uuid,text)', 'EXECUTE') END
UNION ALL
-- Section 6: the rollup and its schedule. The cron arm reads cron.job, which
-- exists on every Supabase project; inside the dry run the row is the one the
-- migration just inserted (and rolls back with it), after the real apply it
-- is the live job. NOT a commented-out block: that is how cloud-sync-poll came
-- to be merged and never scheduled.
SELECT 'the cron job is scheduled AND active',
       EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'platform-metrics-weekly' AND active)
UNION ALL
-- CASE-guarded like every other privilege arm. service_role only: cron runs it
-- as the job owner and nothing else should be able to write a snapshot row.
SELECT 'anon cannot EXECUTE the rollup',
       CASE WHEN to_regprocedure('public.compute_platform_metrics_weekly(date,date,boolean)') IS NULL THEN false
            ELSE NOT has_function_privilege('anon','public.compute_platform_metrics_weekly(date,date,boolean)','EXECUTE') END
UNION ALL
SELECT 'authenticated cannot EXECUTE the rollup either',
       CASE WHEN to_regprocedure('public.compute_platform_metrics_weekly(date,date,boolean)') IS NULL THEN false
            ELSE NOT has_function_privilege('authenticated','public.compute_platform_metrics_weekly(date,date,boolean)','EXECUTE') END
;
