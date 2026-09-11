-- =============================================================================
-- Migration 00194 — Q1 ordinal 1: metrics, presence and the working-day calendar
-- =============================================================================
-- Appendix A(f)'s Q1 ledger, migration 1. It lands first of the substantive set
-- because everything downstream reads it:
--
--   • public.product_events          — the append-only first-party event stream
--   • public.platform_metrics_weekly — the immutable weekly snapshot store
--   • public.metric_cohorts          — the FROZEN September-2026 denominators
--   • public.metric_accounts (view)  — fixture exclusion, stated once
--   • public.metric_account_excluded — the exclusion RULE, in one function
--   • public.user_presence / user_sessions / touch_presence()
--   • public.user_is_org_admin()     — the zero-arg SQL counterpart of OWNER_ADMIN
--   • projects.public_holidays / calendar_years / working_days_between()
--   • projects.project_had_activity() — the cohorts' human-activity predicate
--   • the pg_cron job `platform-metrics-weekly`
--
-- The calendar is here, not in the spine's migration, because work_items.due_date
-- is NOT NULL and its BEFORE INSERT trigger raises no_data_found on an unseeded
-- year. Creating it first satisfies that ordering for free (§12 §(c) hard
-- dependency 4) and removes the second place it was previously booked.
--
-- Additive. NOT re-runnable: plain CREATE throughout; `db push` applies it in
-- one transaction so a failure rolls back whole — never re-apply by hand.
-- No schema is created — `public` and `projects` are both already
-- PostgREST-exposed (config.toml:9) — so a trailing NOTIFY suffices and NO
-- Management-API config PATCH is required (the 00117 / 00183 precedent).
--
-- Destructive? NO. Nothing is dropped, so no backup_<version>_<object> snapshot
-- is taken (§12 §(j) applies only to destructive migrations).
--
-- TWO DELIBERATE DIVERGENCES FROM §15, recorded so a later reader does not
-- treat either as drift:
--   (a) §15 §(a) specifies the weekly job "following the inline-key
--       net.http_post pattern (00148:136-142)". This schedules the function
--       DIRECTLY, because there is no edge function to call and the direct form
--       removes the sb_secret_-is-not-a-JWT failure that broke cloud-sync-poll
--       4/4 on its first tick.
--   (b) §15 §(b) specifies public.touch_presence(p_platform), one argument.
--       This ships two — p_user_agent has no other source, and user_agent is in
--       §15's own user_sessions column list.
--
-- @verify:begin
-- table: public.product_events
-- table: public.platform_metrics_weekly
-- table: public.metric_cohorts
-- table: public.user_presence
-- table: public.user_sessions
-- table: projects.public_holidays
-- table: projects.calendar_years
-- view: public.metric_accounts
-- function: public.user_is_org_admin()
-- function: public.metric_account_excluded(text)
-- function: public.emit_product_event(uuid,uuid,text,jsonb,uuid,uuid)
-- function: public.touch_presence(text,text)
-- function: public.compute_platform_metrics_weekly(date,date,boolean)
-- function: projects.working_days_between(timestamp with time zone,timestamp with time zone,uuid,text)
-- function: projects.project_had_activity(uuid,timestamp with time zone,timestamp with time zone)
-- policy: product_events_read ON public.product_events PERMISSIVE
-- policy: product_events_admin_only ON public.product_events RESTRICTIVE
-- policy: platform_metrics_weekly_read ON public.platform_metrics_weekly PERMISSIVE
-- policy: platform_metrics_weekly_admin_only ON public.platform_metrics_weekly RESTRICTIVE
-- policy: metric_cohorts_read ON public.metric_cohorts PERMISSIVE
-- policy: metric_cohorts_admin_only ON public.metric_cohorts RESTRICTIVE
-- policy: user_sessions_own ON public.user_sessions PERMISSIVE
-- policy: user_presence_own ON public.user_presence PERMISSIVE
-- policy: public_holidays_read ON projects.public_holidays PERMISSIVE
-- policy: calendar_years_read ON projects.calendar_years PERMISSIVE
-- constraint: platform_metrics_weekly_window ON public.platform_metrics_weekly
-- constraint: platform_metrics_weekly_baseline_week ON public.platform_metrics_weekly
-- constraint: platform_metrics_weekly_measured_has_value ON public.platform_metrics_weekly
-- constraint: platform_metrics_weekly_iso_matches_window ON public.platform_metrics_weekly
-- constraint: platform_metrics_weekly_weekly_window ON public.platform_metrics_weekly
-- index: platform_metrics_weekly_week_uk ON public.platform_metrics_weekly
-- index: platform_metrics_weekly_baseline_uk ON public.platform_metrics_weekly
-- index: product_events_org_time_idx ON public.product_events
-- index: product_events_actor_time_idx ON public.product_events
-- index: product_events_event_time_idx ON public.product_events
-- index: product_events_project_idx ON public.product_events
-- index: user_sessions_user_last_seen_idx ON public.user_sessions
-- cron: platform-metrics-weekly
-- grant_absent: anon SELECT ON public.product_events
-- grant_absent: anon SELECT ON public.platform_metrics_weekly
-- grant_absent: anon SELECT ON public.metric_cohorts
-- grant_absent: anon SELECT ON public.metric_accounts
-- grant_absent: anon SELECT ON public.user_presence
-- grant_absent: anon SELECT ON public.user_sessions
-- grant_absent: anon SELECT ON projects.public_holidays
-- grant_absent: anon SELECT ON projects.calendar_years
-- grant_absent: anon EXECUTE ON public.user_is_org_admin()
-- grant_absent: anon EXECUTE ON public.metric_account_excluded(text)
-- grant_absent: anon EXECUTE ON public.emit_product_event(uuid,uuid,text,jsonb,uuid,uuid)
-- grant_absent: anon EXECUTE ON public.touch_presence(text,text)
-- grant_absent: anon EXECUTE ON public.compute_platform_metrics_weekly(date,date,boolean)
-- grant_absent: anon EXECUTE ON projects.working_days_between(timestamp with time zone,timestamp with time zone,uuid,text)
-- grant_absent: anon EXECUTE ON projects.project_had_activity(uuid,timestamp with time zone,timestamp with time zone)
-- sql: SELECT bool_and(EXISTS (SELECT 1 FROM projects.public_holidays ph WHERE extract(year from ph.d)::int = cy.year)) FROM projects.calendar_years cy
-- sql: SELECT count(*) >= 3 FROM projects.calendar_years WHERE year BETWEEN extract(year from CURRENT_DATE)::int AND extract(year from CURRENT_DATE)::int + 2
-- sql: SELECT count(*) BETWEEN 10 AND 35 FROM public.metric_cohorts WHERE cohort_key = 'weekly_active_denominator' AND as_of = DATE '2026-09-09'
-- sql: SELECT count(*) = 12 FROM public.metric_cohorts WHERE cohort_key = 'contractor_frozen' AND as_of = DATE '2026-09-09'
-- sql: SELECT count(*) = 4 FROM public.metric_cohorts WHERE cohort_key = 'client_viewer_frozen' AND as_of = DATE '2026-09-09'
-- @verify:end
--
-- ⚠ ON THE FIVE `sql:` DIRECTIVES. The two calendar ones assert an INVARIANT,
-- never a row count. `SELECT count(*) = 8 FROM projects.calendar_years` would be
-- false the day §15 §(b2)'s scheduled re-seed adds a year, the CLI would exit 1,
-- and `Deploy DB Migrations` would fail for EVERY subsequent migration — a hard
-- block on the whole programme, self-inflicted by the tool built to prevent
-- silent failure. The first directive instead catches a real defect (a year
-- registered with no holidays seeded); the second catches the horizon running
-- out, which is what makes working_days_between raise in production.
--
-- The THIRD is a bounded count on a DATED frozen set, and the `as_of` pin is
-- what makes it safe: metric_cohorts' PK is (cohort_key, user_id, as_of), so a
-- second freeze is legal. Without the pin that second freeze doubles the count
-- past 35 and blocks every later deploy exactly as the calendar case would.
--
-- The FOURTH and FIFTH are EXACT (= 12, = 4) where the third is a band, and
-- that is safe because two things hold together: the set is FROZEN (dated
-- as_of, never recomputed) AND the seed is PINNED — section 3b's activity
-- window and membership cut-off are literal timestamps, so the same rows come
-- out on any apply date — and user_id carries no ON DELETE CASCADE, which
-- removes the only thing that could shrink the count after the apply. The DO
-- block in 3b raises on the same two numbers, so a drift is caught at apply
-- time rather than by the verifier afterwards.

-- ---------------------------------------------------------------------------
-- 1a. public.user_is_org_admin() — the zero-argument overload
-- ---------------------------------------------------------------------------
-- OWNER_ADMIN is a TypeScript constant (packages/shared/src/types/index.ts:36)
-- and has no meaning inside Postgres; this is its SQL counterpart.
--
-- ⚠ SCOPE. This returns true for an owner/admin of ANY organisation, so it is
-- used as the RESTRICTIVE read gate ONLY on public.platform_metrics_weekly,
-- which holds platform-wide aggregates and carries no per-org row. The two
-- tables that DO carry per-org rows — product_events (organisation_id NOT NULL)
-- and metric_cohorts — are gated with the existing ONE-ARGUMENT overload, so an
-- admin of org A cannot read org B's event stream or cohort membership through
-- PostgREST. Invisible today because WM-Consulting is effectively the only real
-- org; a cross-tenant leak the moment metric 8 succeeds.
--
-- ⚠ This is an OVERLOAD, not a replacement. public.user_is_org_admin(p_org_id
-- uuid) already exists (00177:256) and THREE RESTRICTIVE write policies on
-- public.user_organisations depend on it. Never re-declare that signature here.
--
-- COALESCE to FALSE because the scalar subquery returns NO ROW for a non-member
-- (role itself is NOT NULL), and a scalar subquery with no row is NULL, not false.
-- auth.uid(), never current_user — inside SECURITY DEFINER, current_user is the
-- function OWNER, which is what made 00179's transition trigger silently inert.
CREATE OR REPLACE FUNCTION public.user_is_org_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $$
  SELECT COALESCE(
    (SELECT true
       FROM public.user_organisations
      WHERE user_id = auth.uid()
        AND is_active
        AND role IN ('owner', 'admin')
      LIMIT 1),
    false);
$$;

-- Two revokes, not one. pg_default_acl on public still grants anon EXECUTE
-- directly at creation, which FROM PUBLIC does not touch, so FROM anon is
-- load-bearing (00113:15-24). 00177:273 named PUBLIC and authenticated, never
-- anon; 00186's sweep closed it (has_function_privilege on the uuid overload = false today).
REVOKE ALL     ON FUNCTION public.user_is_org_admin()      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.user_is_org_admin()      FROM anon;
GRANT  EXECUTE ON FUNCTION public.user_is_org_admin()      TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1b. public.metric_account_excluded — the exclusion RULE, in ONE place
-- ---------------------------------------------------------------------------
-- Every denominator in this programme selects from public.metric_accounts,
-- which calls this. Keeping the rule in a function rather than in the view's
-- WHERE clause means a future exclusion is one CREATE OR REPLACE, auditable,
-- with each entry and its reason as a comment beside it — instead of a second
-- WHERE clause somewhere else, which is a second source of truth.
--
-- What is excluded, and why, exhaustively:
--   • rbac-test@e-site.live — a PERMANENT production regression fixture
--     (CLAUDE.md), not a user. Holds an active contractor role, so it lands in
--     metric 2a's cohort if not excluded.
--   • %probe% — the throwaway-admin pattern used for prod verification in
--     PRs #142, #154, #158 and #162. Zero such accounts exist right now
--     (measured: metric_accounts holds 35 of 36 profiles), which is exactly why
--     the rule must survive the next one.
--
-- NOT excluded, deliberately: esite-demo.co.za holds 2 accounts (measured), one
-- of them a contractor, and they inflate metric 2b's denominator permanently.
-- Adding them is a PRODUCT decision for the owner, reported as a diagnostic in
-- docs/metrics-baseline-2026-10.md rather than decided here.
--
-- IMMUTABLE is correct ONLY while the body reads no table; a future rule that
-- reads one must be declared STABLE in the same CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION public.metric_account_excluded(p_email text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT p_email IS NULL
      OR p_email = 'rbac-test@e-site.live'
      OR p_email LIKE '%probe%';
$$;

REVOKE ALL     ON FUNCTION public.metric_account_excluded(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.metric_account_excluded(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.metric_account_excluded(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. public.product_events — the append-only first-party event stream
-- ---------------------------------------------------------------------------
-- §12 §(i): two stores, and they are not the same thing. product_events is the
-- STREAM (what happened, at full granularity); platform_metrics_weekly is the
-- immutable weekly SNAPSHOT (what you quote). public.audit_log stays the
-- compliance record and is not the analytics store.
CREATE TABLE public.product_events (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at     timestamptz NOT NULL DEFAULT now(),
    actor_id        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    project_id      uuid REFERENCES projects.projects(id) ON DELETE SET NULL,  -- nullable: org-level events
    organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    event           text NOT NULL CHECK (event IN (
                      'rfi_created', 'rfi_responded', 'rfi_closed',
                      'snag_resolved',
                      'project_created', 'project_deleted',
                      'marketplace_order_placed',
                      'onboarding_started',
                      'backfill_completed'
                    )),
    effective_role  text,   -- stamped at write time; NEVER re-resolved later
    session_id      uuid,
    properties      jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX product_events_org_time_idx ON public.product_events (organisation_id, occurred_at DESC);
CREATE INDEX product_events_actor_time_idx ON public.product_events (actor_id, occurred_at DESC);
CREATE INDEX product_events_event_time_idx ON public.product_events (event, occurred_at DESC);
-- The project FK has no index of its own; without one, ON DELETE SET NULL
-- seq-scans the whole stream on every project delete.
CREATE INDEX product_events_project_idx ON public.product_events (project_id);

ALTER TABLE public.product_events ENABLE ROW LEVEL SECURITY;

-- A RESTRICTIVE policy alone grants NOTHING — RLS is default-deny and a
-- restrictive policy only intersects. Both halves are required (00183 shape).
--
-- ⚠ The RESTRICTIVE gate calls the ONE-ARGUMENT user_is_org_admin(uuid), which
-- already exists (00177:256) and is already the gate on 00177's membership
-- write policies — nothing new is introduced. The zero-arg overload is true for
-- an owner/admin of ANY org, and this table carries organisation_id NOT NULL,
-- so using it here would expose every organisation's event stream to every
-- other organisation's admins through PostgREST. Invisible today because
-- WM-Consulting is effectively the only real org; a cross-tenant leak the
-- moment metric 8 succeeds.
CREATE POLICY product_events_read ON public.product_events
    FOR SELECT USING (true);
CREATE POLICY product_events_admin_only ON public.product_events
    AS RESTRICTIVE FOR SELECT USING (public.user_is_org_admin(organisation_id));

-- No INSERT / UPDATE / DELETE policy at all. Writes arrive only through
-- emit_product_event() below, and only a service_role holder can call it.

-- ALL, not just SELECT: RLS already denies every write (no INSERT/UPDATE/DELETE
-- policy), but anon receives INSERT/UPDATE/DELETE/SELECT through pg_default_acl
-- at creation, and a grant that RLS happens to neutralise is still a grant.
REVOKE ALL ON public.product_events FROM anon;

-- ---------------------------------------------------------------------------
-- public.emit_product_event — the ONLY writer
-- ---------------------------------------------------------------------------
-- The role stamp and the organisation are resolved SERVER-SIDE so a caller
-- cannot invent either: with a project, the organisation is the PROJECT's and
-- a supplied p_organisation_id must agree with it or the call raises; without
-- a project, p_organisation_id is required. A project_deleted event fires
-- after the row is gone, so it must pass p_project_id => NULL and carry the
-- id in properties (Task 13 does this). Granted to service_role alone: the web
-- app verifies the user with its own client first and then calls this with
-- the service client, the same shape dispatchNotification already uses
-- (lib/notifications.ts:26).
--
-- ⚠ effective_role is stamped HERE, at write time, through
-- user_effective_project_role(project_id, actor_id) and is never re-resolved.
-- Role in this system is per project (00107) and memberships change; a role
-- re-derived later is the role the person holds NOW, which is the one thing a
-- role-split metric must not use.
--
-- ⚠ p_project_id carries DEFAULT NULL. JSON.stringify drops an `undefined`
-- value from the RPC body, and a parameter with NO default makes PostgREST
-- answer 404 "could not find the function" — which emitProductEvent swallows
-- and logs, silently losing every event from that call site. The default turns
-- a dropped key into a null project instead of a lost event.
CREATE OR REPLACE FUNCTION public.emit_product_event(
    p_actor_id        uuid,
    p_project_id      uuid  DEFAULT NULL,
    p_event           text  DEFAULT NULL,
    p_properties      jsonb DEFAULT '{}'::jsonb,
    p_session_id      uuid  DEFAULT NULL,
    p_organisation_id uuid  DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'projects'
SET row_security TO 'off'
AS $$
DECLARE
    v_org         uuid;
    v_project_org uuid;
    v_role        text;
    v_id          uuid;
BEGIN
    -- p_event carries DEFAULT NULL only because PostgreSQL requires every
    -- parameter after p_project_id's default to have one; this RAISE is the real guard.
    IF p_event IS NULL THEN
        RAISE EXCEPTION 'emit_product_event: p_event is required';
    END IF;

    IF p_project_id IS NOT NULL THEN
        -- With a project the organisation is the PROJECT's, full stop. A caller
        -- may pass p_organisation_id alongside, but it must agree.
        SELECT p.organisation_id INTO v_project_org
          FROM projects.projects p
         WHERE p.id = p_project_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'emit_product_event: project % not found — pass p_project_id => NULL for an event about a deleted project', p_project_id;
        END IF;
        IF p_organisation_id IS NOT NULL AND p_organisation_id <> v_project_org THEN
            RAISE EXCEPTION 'emit_product_event: p_organisation_id % disagrees with project %''s organisation %',
                p_organisation_id, p_project_id, v_project_org;
        END IF;
        v_org := v_project_org;
    ELSE
        -- No project: the caller must name the organisation.
        v_org := p_organisation_id;
        IF v_org IS NULL THEN
            RAISE EXCEPTION 'emit_product_event: organisation_id could not be resolved (project_id=%)', p_project_id;
        END IF;
    END IF;

    -- Per project, at event time. NULL when there is no project to stamp against.
    IF p_project_id IS NOT NULL AND p_actor_id IS NOT NULL THEN
        v_role := public.user_effective_project_role(p_project_id, p_actor_id);
    END IF;

    INSERT INTO public.product_events
        (actor_id, project_id, organisation_id, event, effective_role, session_id, properties)
    VALUES
        (p_actor_id, p_project_id, v_org, p_event, v_role, p_session_id, COALESCE(p_properties, '{}'::jsonb))
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

REVOKE ALL     ON FUNCTION public.emit_product_event(uuid,uuid,text,jsonb,uuid,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.emit_product_event(uuid,uuid,text,jsonb,uuid,uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.emit_product_event(uuid,uuid,text,jsonb,uuid,uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.emit_product_event(uuid,uuid,text,jsonb,uuid,uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3a. public.metric_accounts — fixture exclusion, stated once
-- ---------------------------------------------------------------------------
-- Every denominator selects from here, and the RULE lives in
-- public.metric_account_excluded (section 1b) so a future exclusion is one
-- CREATE OR REPLACE rather than a second WHERE clause somewhere else.
-- security_invoker so the view cannot become a way round profiles' own RLS.
--
-- ⚠ The corollary: under a USER session the view is scoped by profiles' RLS
-- and returns only the rows that caller may see — a count taken that way is a
-- count of the caller's visibility, not of the estate. Every denominator (the
-- cohort seeds below, compute_platform_metrics_weekly) reads this view ONLY
-- with row_security off or as service_role, never through a user session.
CREATE VIEW public.metric_accounts
    WITH (security_invoker = true, security_barrier = true) AS
SELECT p.id AS user_id, p.email, p.full_name
  FROM public.profiles p
 WHERE NOT public.metric_account_excluded(p.email);

-- ALL, not just SELECT: pg_default_acl hands anon every privilege on a new
-- relation at creation, and a view is a relation.
REVOKE ALL ON public.metric_accounts FROM anon;

-- ---------------------------------------------------------------------------
-- 3b. public.metric_cohorts — the FROZEN September-2026 denominators
-- ---------------------------------------------------------------------------
-- Enumerated ONCE, here, and never recomputed. Growth is tracked by metric 2b
-- and by the raw account count reported beside it, not by moving this floor.
--
-- organisation_id is NOT decoration: a cohort row names a PERSON, so a
-- platform-wide read gate would expose the identity of every cohort member to
-- an admin of any organisation. Resolved deterministically with DISTINCT ON so
-- a user in two orgs always lands in the same one.
CREATE TABLE public.metric_cohorts (
    cohort_key      text NOT NULL CHECK (cohort_key IN (
                      'weekly_active_denominator', 'contractor_frozen', 'client_viewer_frozen')),
    -- NO FK to profiles, deliberately. ON DELETE CASCADE would silently shrink
    -- a FROZEN denominator the day a profile is deleted, and the numerator
    -- already excludes deleted users because it counts through metric_accounts.
    -- The organisation FK stays: it is what the org-scoped read gate keys on.
    user_id         uuid NOT NULL,
    organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    as_of           date NOT NULL,
    PRIMARY KEY (cohort_key, user_id, as_of)
);

ALTER TABLE public.metric_cohorts ENABLE ROW LEVEL SECURITY;
CREATE POLICY metric_cohorts_read ON public.metric_cohorts FOR SELECT USING (true);
CREATE POLICY metric_cohorts_admin_only ON public.metric_cohorts
    AS RESTRICTIVE FOR SELECT USING (public.user_is_org_admin(organisation_id));
-- ALL, not just SELECT: no write policy exists, but anon's default-ACL
-- INSERT/UPDATE/DELETE grants are still grants until revoked.
REVOKE ALL ON public.metric_cohorts FROM anon;

-- ---------------------------------------------------------------------------
-- projects.project_had_activity — "did a human write to this project?"
-- ---------------------------------------------------------------------------
-- The activity predicate both cohort seeds share, over the half-open window
-- [p_since, p_until). Five HUMAN-write arms only: an RFI, a diary entry, a QC
-- entry, a snag or a report created inside the window.
--
-- ⚠ Deliberately NOT projects.updated_at. Measured: cloud-sync-project writes
-- cloud_storage_last_sync_at every 15 minutes (the cloud-sync-poll cron, PR
-- #152) and the set_updated_at trigger bumps updated_at with it, so under an
-- updated_at test every Dropbox-mapped project reads "active" forever —
-- machine activity, not use. An updated_at arm would have enrolled the members
-- of projects nobody has touched since May into a frozen denominator.
--
-- SECURITY DEFINER with row_security off because the seeds run at apply time
-- as the migration role and the rollup (compute_platform_metrics_weekly) calls
-- it from cron; neither has a user session. service_role only: no user path
-- needs it, and a definer function callable by authenticated is a cross-org
-- "is this project busy?" oracle.
CREATE OR REPLACE FUNCTION projects.project_had_activity(
    p_project_id uuid,
    p_since      timestamptz,
    p_until      timestamptz
) RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'projects', 'field', 'public'
SET row_security TO 'off'
AS $$
  SELECT EXISTS (SELECT 1 FROM projects.rfis r
                  WHERE r.project_id = p_project_id AND r.created_at >= p_since AND r.created_at < p_until)
      OR EXISTS (SELECT 1 FROM projects.site_diary_entries d
                  WHERE d.project_id = p_project_id AND d.created_at >= p_since AND d.created_at < p_until)
      OR EXISTS (SELECT 1 FROM projects.qc_entries q
                  WHERE q.project_id = p_project_id AND q.created_at >= p_since AND q.created_at < p_until)
      OR EXISTS (SELECT 1 FROM field.snags s
                  WHERE s.project_id = p_project_id AND s.created_at >= p_since AND s.created_at < p_until)
      OR EXISTS (SELECT 1 FROM projects.reports rp
                  WHERE rp.project_id = p_project_id AND rp.created_at >= p_since AND rp.created_at < p_until);
$$;

REVOKE ALL     ON FUNCTION projects.project_had_activity(uuid,timestamptz,timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.project_had_activity(uuid,timestamptz,timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION projects.project_had_activity(uuid,timestamptz,timestamptz) FROM authenticated;
GRANT  EXECUTE ON FUNCTION projects.project_had_activity(uuid,timestamptz,timestamptz) TO service_role;

-- Cohort 1: accounts holding >= 1 ACTIVE membership, granted before the
-- cut-off, on a project a human wrote to inside the window. Measured
-- 2026-09-10: 23 accounts.
--
-- ⚠ The window and the cut-off are PINNED literals, never now()-relative.
-- The seed must reproduce 23 / 12 / 4 on whatever day the migration actually
-- applies (a merge slips; a deploy is re-run), and a trailing-90-days
-- predicate would enumerate a different set on each of those days while still
-- passing the band — a "frozen" cohort whose membership depends on the apply
-- date. [2026-06-12, 2026-09-10) is the 90 days ending on the measurement
-- date; the membership cut-off is the same instant.
-- Every literal carries an explicit +00 offset: an offset-less literal resolves
-- through the session TimeZone — UTC today, but a future `ALTER ROLE … SET
-- timezone` would silently shift the cut-off.
INSERT INTO public.metric_cohorts (cohort_key, user_id, organisation_id, as_of)
SELECT DISTINCT ON (ma.user_id)
       'weekly_active_denominator', ma.user_id, pr.organisation_id, DATE '2026-09-09'
  FROM public.metric_accounts ma
  JOIN projects.project_members pm
    ON pm.user_id = ma.user_id
   AND pm.is_active
   AND pm.created_at < TIMESTAMPTZ '2026-09-10 00:00:00+00'
  JOIN projects.projects pr ON pr.id = pm.project_id
 WHERE projects.project_had_activity(pr.id, TIMESTAMPTZ '2026-06-12 00:00:00+00', TIMESTAMPTZ '2026-09-10 00:00:00+00')
 ORDER BY ma.user_id, pr.organisation_id
ON CONFLICT DO NOTHING;

-- Cohorts 2 and 3: contractors and client viewers, frozen, resolved by
-- EFFECTIVE PROJECT ROLE — §15 §(a) metric 2b defines the set as "every account
-- whose effective role on any active project is contractor", and role in this
-- system is per project (00107), which is the whole reason product_events
-- stamps effective_role at write time. "Active project" is the SAME pinned
-- window and predicate as cohort 1. Measured 2026-09-10 inside
-- metric_accounts: 12 contractors, 4 client viewers.
--
-- 13 accounts hold a contractor role; one of them is rbac-test@e-site.live,
-- which metric_accounts excludes by rule. §15 says "13"; 12 is the measured
-- number under §15's own exclusion rule, and the difference is recorded in
-- docs/metrics-baseline-2026-10.md rather than hidden.
INSERT INTO public.metric_cohorts (cohort_key, user_id, organisation_id, as_of)
SELECT DISTINCT ON (cohort_key, ma.user_id)
       CASE eff.role WHEN 'contractor' THEN 'contractor_frozen' ELSE 'client_viewer_frozen' END AS cohort_key,
       ma.user_id, pr.organisation_id, DATE '2026-09-09'
  FROM public.metric_accounts ma
  JOIN projects.project_members pm
    ON pm.user_id = ma.user_id
   AND pm.is_active
   AND pm.created_at < TIMESTAMPTZ '2026-09-10 00:00:00+00'
  JOIN projects.projects pr ON pr.id = pm.project_id
 CROSS JOIN LATERAL (SELECT public.user_effective_project_role(pm.project_id, ma.user_id) AS role) eff
 WHERE projects.project_had_activity(pr.id, TIMESTAMPTZ '2026-06-12 00:00:00+00', TIMESTAMPTZ '2026-09-10 00:00:00+00')
   AND eff.role IN ('contractor', 'client_viewer')
 ORDER BY cohort_key, ma.user_id, pr.organisation_id
ON CONFLICT DO NOTHING;

-- The migration FAILS rather than publishing a wrong denominator for twelve
-- months. Cohort 1 is a BAND: 35 is 36 accounts minus the fixture; 10 is below
-- any plausible membership count for the live projects, given the notification
-- roster resolves 12-13 WM people for a single WM project (00146:32-55).
-- Cohorts 2 and 3 are EXACT: the seed is pinned (above), so any other number
-- means the membership estate changed after the 2026-09-10 measurement — read
-- the live count and report it; do not widen the guard.
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM public.metric_cohorts
     WHERE cohort_key = 'weekly_active_denominator' AND as_of = DATE '2026-09-09';
    IF n NOT BETWEEN 10 AND 35 THEN
        RAISE EXCEPTION 'metric cohort out of band: % (expected 10..35)', n;
    END IF;

    SELECT count(*) INTO n FROM public.metric_cohorts
     WHERE cohort_key = 'contractor_frozen' AND as_of = DATE '2026-09-09';
    IF n <> 12 THEN
        RAISE EXCEPTION 'contractor_frozen cohort is % (expected exactly 12, measured 2026-09-10)', n;
    END IF;

    SELECT count(*) INTO n FROM public.metric_cohorts
     WHERE cohort_key = 'client_viewer_frozen' AND as_of = DATE '2026-09-09';
    IF n <> 4 THEN
        RAISE EXCEPTION 'client_viewer_frozen cohort is % (expected exactly 4, measured 2026-09-10)', n;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3c. public.platform_metrics_weekly — the immutable weekly snapshot store
-- ---------------------------------------------------------------------------
-- A materialised weekly FACT TABLE, not a view over the event log: a target
-- must be readable without re-scanning the stream. Append-only and carrying
-- method_version, so changing a definition writes NEW rows rather than
-- rewriting history — the same discipline as read_at_estimated.
CREATE TABLE public.platform_metrics_weekly (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_key     text NOT NULL CHECK (metric_key IN (
                     'weekly_active',
                     'contractor_active_frozen',
                     'contractor_active_all',
                     'client_active',
                     'diary_same_day',
                     'rfi_response_median_wd',
                     'inbox_engagement',
                     'report_schedules_per_project',
                     'activation_first_session',
                     'paying_organisations',
                     'notifications_created'
                   )),
    iso_year       int  NOT NULL,
    iso_week       int  CHECK (iso_week BETWEEN 1 AND 53),
    window_start   date NOT NULL,
    window_end     date NOT NULL,     -- exclusive
    numerator      numeric,
    denominator    numeric,
    value          numeric,           -- weekly rate or ratio
    status         text NOT NULL CHECK (status IN ('measured','censored','unmeasurable','not_yet_instrumented')),
    method_version int  NOT NULL DEFAULT 1,
    is_baseline    boolean NOT NULL DEFAULT false,
    note           text,
    detail         jsonb NOT NULL DEFAULT '{}',
    captured_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT platform_metrics_weekly_window CHECK (window_end > window_start),
    CONSTRAINT platform_metrics_weekly_baseline_week
      CHECK ((is_baseline AND iso_week IS NULL) OR (NOT is_baseline AND iso_week IS NOT NULL)),
    -- ⚠ This CHECK is why every ratio arm of the rollup declares its OWN status
    -- rather than hard-coding 'measured': a week with a zero denominator yields
    -- a NULL value, and 'measured' + NULL aborts the whole INSERT, so the job
    -- writes ZERO rows and "no row" is read as "the job did not run".
    CONSTRAINT platform_metrics_weekly_measured_has_value
      CHECK (status <> 'measured' OR value IS NOT NULL),
    -- A weekly row's (iso_year, iso_week) must be the ISO week its window
    -- starts in, and the window must be exactly seven days — otherwise the
    -- unique index below dedupes on a label that does not describe the data.
    -- Baseline rows carry no ISO week and a four-week window, so both skip.
    CONSTRAINT platform_metrics_weekly_iso_matches_window
      CHECK (is_baseline OR (iso_year = extract(isoyear from window_start)::int
                         AND iso_week = extract(week from window_start)::int)),
    CONSTRAINT platform_metrics_weekly_weekly_window
      CHECK (is_baseline OR window_end = window_start + 7)
);

CREATE UNIQUE INDEX platform_metrics_weekly_week_uk
    ON public.platform_metrics_weekly (metric_key, iso_year, iso_week, method_version)
    WHERE NOT is_baseline;
CREATE UNIQUE INDEX platform_metrics_weekly_baseline_uk
    ON public.platform_metrics_weekly (metric_key, method_version)
    WHERE is_baseline;

ALTER TABLE public.platform_metrics_weekly ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_metrics_weekly_read ON public.platform_metrics_weekly
    FOR SELECT USING (true);
-- The ZERO-ARG overload, deliberately: this table holds platform-wide
-- aggregates and carries no per-org row, so there is nothing to scope to. The
-- two tables that DO carry per-org rows use the one-arg form.
CREATE POLICY platform_metrics_weekly_admin_only ON public.platform_metrics_weekly
    AS RESTRICTIVE FOR SELECT USING (public.user_is_org_admin());
-- No UPDATE or DELETE policy: the snapshot is never rewritten.
-- ALL, not just SELECT: the snapshot is append-only by the rollup alone, and
-- anon's default-ACL write grants are still grants until revoked.
REVOKE ALL ON public.platform_metrics_weekly FROM anon;

-- ---------------------------------------------------------------------------
-- 4. Presence and sessions — two objects, ONE writer
-- ---------------------------------------------------------------------------
-- user_presence is the current-state row the notification dispatcher branches
-- on. user_sessions is the append-only history the metrics read. The SAME RPC
-- writes both, so they cannot disagree.
--
-- The platform CHECK is fixed HERE, before three callers in three different Q1
-- items invent three spellings. Item 10's success criterion is contractor use
-- on a 375px Android screen, which can only be evidenced by splitting sessions
-- by platform; a vocabulary that drifts is unrecoverable for that quarter.
CREATE TABLE public.user_presence (
    user_id        uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    last_active_at timestamptz NOT NULL DEFAULT now(),
    platform       text CHECK (platform IN ('web','mobile_web','mobile_app'))
);

CREATE TABLE public.user_sessions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    started_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    user_agent   text,
    platform     text CHECK (platform IN ('web','mobile_web','mobile_app'))
);

CREATE INDEX user_sessions_user_last_seen_idx ON public.user_sessions (user_id, last_seen_at DESC);

ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

-- Own-row read only. No write policy: writes arrive through touch_presence().
CREATE POLICY user_presence_own ON public.user_presence
    FOR SELECT USING (user_id = auth.uid());
CREATE POLICY user_sessions_own ON public.user_sessions
    FOR SELECT USING (user_id = auth.uid());

-- ALL, not just SELECT: no write policy exists, but anon's default-ACL
-- INSERT/UPDATE/DELETE grants are still grants until revoked.
REVOKE ALL ON public.user_presence FROM anon;
REVOKE ALL ON public.user_sessions FROM anon;

-- The single writer. SECURITY DEFINER so it can write through the own-row-read
-- policies, and it touches ONLY auth.uid()'s rows — never a user_id argument,
-- which would make it a forgery primitive. auth.uid(), never current_user.
CREATE OR REPLACE FUNCTION public.touch_presence(
    p_platform   text DEFAULT 'web',
    p_user_agent text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $$
DECLARE
    v_uid     uuid := auth.uid();
    v_session uuid;
    v_plat    text := COALESCE(p_platform, 'web');
BEGIN
    IF v_uid IS NULL THEN RETURN; END IF;
    IF v_plat NOT IN ('web','mobile_web','mobile_app') THEN
        RAISE EXCEPTION 'touch_presence: unknown platform %', v_plat;
    END IF;

    INSERT INTO public.user_presence (user_id, last_active_at, platform)
    VALUES (v_uid, now(), v_plat)
    ON CONFLICT (user_id) DO UPDATE
      SET last_active_at = now(), platform = EXCLUDED.platform;

    -- Extend the most recent session, or open a new one. The 30-minute gap is
    -- ALSO applied at read time over last_seen_at (§15 §(b)); this write-time
    -- split is a convenience for the dispatcher, not the metric's authority.
    SELECT s.id INTO v_session
      FROM public.user_sessions s
     WHERE s.user_id = v_uid
       AND s.last_seen_at > now() - interval '30 minutes'
     ORDER BY s.last_seen_at DESC
     LIMIT 1;

    IF v_session IS NULL THEN
        INSERT INTO public.user_sessions (user_id, user_agent, platform)
        VALUES (v_uid, p_user_agent, v_plat);
    ELSE
        UPDATE public.user_sessions SET last_seen_at = now() WHERE id = v_session;
    END IF;
END;
$$;

REVOKE ALL     ON FUNCTION public.touch_presence(text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.touch_presence(text,text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.touch_presence(text,text) TO authenticated, service_role;
