-- SEEDED assertions for the Q1 metrics/presence/calendar migration.
--
-- ⚠ THIS FILE WRITES ROWS. It must ONLY ever be run inside a transaction that
-- rolls back — scripts/db/dry-run-migration.sh wraps it, and the smoke test
-- runs it inside its own BEGIN … ROLLBACK. Never run it read-only against
-- production.
--
-- Everything that reads only applied structure belongs in
-- assert-metrics-foundation-static.sql instead, so that file can run
-- read-only after the apply.
--
-- MUST end in exactly one statement returning (check text, ok boolean).

-- Exercise the writer against a real project and a real member, inside the
-- rolled-back transaction. Picks an ACTIVE member whose effective role
-- resolves, so the role stamp is a real role and not a null. 13 of the 14
-- live projects have at least one project_manager membership (measured
-- 2026-09-10); all 47 memberships resolve a role (measured 2026-09-11).
--
-- The row is TAGGED (properties.seeded_by) so the arm below counts only the
-- row this file wrote. After the real apply the live table holds genuine
-- rfi_created rows (15 RFIs exist today), and an untagged `event =
-- 'rfi_created'` count would drift away from 1 the first time the smoke test
-- runs against production.
SELECT public.emit_product_event(
         pm.user_id, pm.project_id, 'rfi_created',
         jsonb_build_object('assignee_source','none','seeded_by','assert-metrics-foundation-seeded'),
         NULL, NULL)
  FROM projects.project_members pm
 WHERE pm.is_active
   AND public.user_effective_project_role(pm.project_id, pm.user_id) IS NOT NULL
 ORDER BY pm.project_id, pm.user_id
 LIMIT 1;

-- Exercise the extend-vs-open branch directly against real profile ids, inside
-- the rolled-back transaction. touch_presence() itself reads auth.uid(), which
-- is NULL for the Management API, so it returns without writing — the RPC's
-- own round-trip is proven in Task 10 Step 5 and by the smoke test instead.
-- What this covers is the interval arithmetic the branch depends on.
--
-- The rows are TAGGED (user_agent) so the arm below counts only the rows this
-- file wrote. After the real apply the live table holds genuine sessions for
-- this user (ORDER BY id LIMIT 1 resolves to the rbac-test fixture, measured
-- 2026-09-11), and an untagged count would drift away from 1 the first time
-- the smoke test runs against production.
INSERT INTO public.user_sessions (user_id, last_seen_at, platform, user_agent)
SELECT id, now() - interval '45 minutes', 'web', 'assert-metrics-foundation-seeded'
  FROM public.profiles ORDER BY id LIMIT 1;
INSERT INTO public.user_sessions (user_id, last_seen_at, platform, user_agent)
SELECT id, now() - interval '2 minutes', 'web', 'assert-metrics-foundation-seeded'
  FROM public.profiles ORDER BY id LIMIT 1;

-- Two real windows, both computed inside the rolled-back transaction.
--
-- ⚠ If weeks 28 or 36 of 2026 are ever BACKFILLED into the live table, these
-- two calls will raise on platform_metrics_weekly_week_uk and the smoke test
-- will fail for that reason alone — pick two other PAST Monday→Monday weeks
-- (one with diary rows, one without) if that ever happens.
--
-- (1) 2026-08-31 is a Monday (ISO week 36 of 2026) and the window is complete.
--     It contains 2 diary rows (measured), so every ratio arm has a denominator.
SELECT public.compute_platform_metrics_weekly(DATE '2026-08-31', DATE '2026-09-07', false);
--
-- (2) 2026-07-06 is a Monday (ISO week 28 of 2026) containing ZERO diary rows
--     (measured: only 10 of the last 27 weeks contain any). This is the window
--     that proves a zero denominator does not abort the whole INSERT. Without
--     it the loop never exercises the path that breaks ~63% of Monday ticks.
SELECT public.compute_platform_metrics_weekly(DATE '2026-07-06', DATE '2026-07-13', false);

-- The rollup arms below filter on the exact (iso_year, iso_week) pairs the two
-- calls above write — that pair is the tag. After the real apply the live
-- table fills with the cron's own weeks (the first tick writes week 37 of
-- 2026 at the earliest), so the two seeded pairs stay unique to this file;
-- every arm names the YEAR as well as the week because from September 2027
-- the cron writes week 28 and week 36 of 2027, and a week-only filter would
-- make each scalar subquery return two rows and abort the chain.
SELECT 'seeded assertions file is reachable' AS check, true AS ok
UNION ALL
SELECT 'emit_product_event stamps effective_role at write time',
       (SELECT count(*) = 1 FROM public.product_events pe
         WHERE pe.properties->>'seeded_by' = 'assert-metrics-foundation-seeded'
           AND pe.effective_role IS NOT NULL
           AND pe.organisation_id IS NOT NULL)
UNION ALL
-- That `= 1` is the load-bearing number. If it returns 2 the interval
-- comparison is wrong, and metric 7's denominator silently collapses every
-- user to one lifetime session.
SELECT 'the 30-minute window excludes a 45-minute-old session and includes a 2-minute-old one',
       (SELECT count(*) FROM public.user_sessions s
         WHERE s.user_id = (SELECT id FROM public.profiles ORDER BY id LIMIT 1)
           AND s.user_agent = 'assert-metrics-foundation-seeded'
           AND s.last_seen_at > now() - interval '30 minutes') = 1
UNION ALL
-- Section 6: the rollup. §15 §(b2) rule 1 — a row for EVERY key on EVERY tick.
SELECT 'the rollup writes a row for ALL eleven metric keys, measurable or not',
       (SELECT count(DISTINCT metric_key) FROM public.platform_metrics_weekly) = 11
UNION ALL
SELECT 'a ZERO-denominator week still writes all eleven rows and does not abort',
       (SELECT count(*) FROM public.platform_metrics_weekly
         WHERE iso_week = 28 AND iso_year = 2026 AND NOT is_baseline) = 11
UNION ALL
SELECT 'a zero-denominator ratio is unmeasurable with a NULL value, never measured-and-null',
       (SELECT status = 'unmeasurable' AND value IS NULL
          FROM public.platform_metrics_weekly
         WHERE metric_key = 'diary_same_day' AND iso_week = 28 AND iso_year = 2026)
UNION ALL
SELECT 'the same metric IS measured in a week that has diary rows',
       (SELECT status = 'measured' AND value IS NOT NULL
          FROM public.platform_metrics_weekly
         WHERE metric_key = 'diary_same_day' AND iso_week = 36 AND iso_year = 2026)
UNION ALL
SELECT 'weekly_active is measured against the FROZEN cohort at its as_of date',
       (SELECT denominator = (SELECT count(*) FROM public.metric_cohorts
                               WHERE cohort_key = 'weekly_active_denominator' AND as_of = DATE '2026-09-09')
          FROM public.platform_metrics_weekly
         WHERE metric_key = 'weekly_active' AND iso_week = 36 AND iso_year = 2026)
UNION ALL
SELECT '_active sees a source-table writer, not only a trackServer call site',
       (SELECT numerator > 0 FROM public.platform_metrics_weekly
         WHERE metric_key = 'weekly_active' AND iso_week = 36 AND iso_year = 2026)
UNION ALL
SELECT 'client_active is instrumented against the frozen client cohort of 4',
       (SELECT denominator = 4 FROM public.platform_metrics_weekly
         WHERE metric_key = 'client_active' AND iso_week = 36 AND iso_year = 2026)
UNION ALL
SELECT 'inbox_engagement is honestly unmeasurable and carries the email-delivery gap',
       (SELECT status = 'unmeasurable' AND value IS NULL AND detail ? 'emails_sent_all_time'
          FROM public.platform_metrics_weekly
         WHERE metric_key = 'inbox_engagement' AND iso_week = 36 AND iso_year = 2026)
UNION ALL
SELECT 'report_schedules_per_project is not_yet_instrumented (table lands Q3)',
       (SELECT status = 'not_yet_instrumented'
          FROM public.platform_metrics_weekly
         WHERE metric_key = 'report_schedules_per_project' AND iso_week = 36 AND iso_year = 2026)
UNION ALL
SELECT 'rfi_response_median_wd is censored and carries the answered share',
       (SELECT status = 'censored' AND detail ? 'answered_ever'
          FROM public.platform_metrics_weekly
         WHERE metric_key = 'rfi_response_median_wd' AND iso_week = 36 AND iso_year = 2026)
UNION ALL
SELECT 'notifications_created is a RATIO with a first-party-write denominator',
       (SELECT denominator IS NOT NULL AND detail ? 'per_week'
          FROM public.platform_metrics_weekly
         WHERE metric_key = 'notifications_created' AND iso_week = 36 AND iso_year = 2026)
UNION ALL
SELECT 'paying_organisations is measured and reads zero by design',
       (SELECT status = 'measured' AND value = 0
          FROM public.platform_metrics_weekly
         WHERE metric_key = 'paying_organisations' AND iso_week = 36 AND iso_year = 2026)
UNION ALL
-- Over the whole table, deliberately: after the real apply this also covers
-- every row the cron has written, and a row without window_days would mean a
-- writer other than the rollup — or a rollup edit that dropped the key.
SELECT 'every row carries window_days',
       NOT EXISTS (SELECT 1 FROM public.platform_metrics_weekly WHERE NOT (detail ? 'window_days'))
;
