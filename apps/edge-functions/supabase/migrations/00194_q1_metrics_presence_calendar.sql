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
-- constraint: user_presence_platform_check ON public.user_presence
-- constraint: user_sessions_platform_check ON public.user_sessions
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
-- window and membership cut-off are literal timestamps (the predicates 3b
-- reads LIVE at apply time are the caveat recorded there) — and NEITHER
-- user_id NOR organisation_id carries a foreign key, so no ON DELETE CASCADE
-- can shrink the count after the apply. The DO block in 3b raises on the same
-- two numbers, so a drift is caught at apply time rather than by the verifier
-- afterwards.

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
    -- NO FK on user_id OR organisation_id, deliberately. ON DELETE CASCADE
    -- would silently shrink a FROZEN denominator: on user_id the day a profile
    -- is deleted (the numerator already excludes deleted users because it
    -- counts through metric_accounts); on organisation_id the day an
    -- organisation is deleted. A rolled-back probe showed every cohort spans
    -- TWO organisations, and the second is "E-Site DEMO — Contractor/Client
    -- Preview" (2 of 23, 1 of 12, 1 of 4). Deleting that org would cascade the
    -- frozen counts to 21 / 11 / 3, the exact `sql:` guards in the @verify
    -- block would go red, and the post-push verifier would fail EVERY later
    -- deploy. A dangling organisation_id merely makes the row invisible —
    -- user_is_org_admin(<dangling>) is false for everyone — because the
    -- org-scoped read gate keys on the column's VALUE, not on a constraint.
    user_id         uuid NOT NULL,
    organisation_id uuid NOT NULL,
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
-- A trailing-90-days predicate would enumerate a different set on each apply
-- day (a merge slips; a deploy is re-run) while still passing the band — a
-- "frozen" cohort whose membership depends on the apply date. [2026-06-12,
-- 2026-09-10) is the 90 days ending on the measurement date; the membership
-- cut-off is the same instant.
--
-- ⚠ Pinning the literals does NOT make the seed a pure function of its text.
-- pm.is_active, user_effective_project_role(...) and the existence of a
-- profiles row (via metric_accounts) are read LIVE at apply time, so the
-- exact guards below — and the `sql:` directives in the @verify block — WILL
-- abort `db push` if a membership is deactivated, a contractor is promoted or
-- a profile is deleted between the last dry run and merge. That is the
-- intended failure, and the guards stay: recovery is to read the live count,
-- adjust the guard in a new commit, and re-deploy — never to widen it.
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
-- platform is NOT NULL as well as CHECKed: `NULL IN (…)` is NULL, so a bare
-- CHECK passes NULL — an implicit fourth vocabulary value. The RPC always
-- writes a non-null platform; service-role writes and future migrations do
-- not go through it, so the column must refuse NULL on its own.
CREATE TABLE public.user_presence (
    user_id        uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    last_active_at timestamptz NOT NULL DEFAULT now(),
    platform       text NOT NULL CHECK (platform IN ('web','mobile_web','mobile_app'))
);

CREATE TABLE public.user_sessions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    started_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    user_agent   text,
    platform     text NOT NULL CHECK (platform IN ('web','mobile_web','mobile_app'))
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
    -- The presence upsert above row-locks this user, so concurrent calls
    -- serialise here and cannot open two sessions — do not reorder.
    SELECT s.id INTO v_session
      FROM public.user_sessions s
     WHERE s.user_id = v_uid
       AND s.last_seen_at > now() - interval '30 minutes'
     ORDER BY s.last_seen_at DESC
     LIMIT 1;

    IF v_session IS NULL THEN
        -- Bounded and blank-collapsed: the RPC is authenticated-executable over
        -- PostgREST and the column is otherwise unbounded caller-supplied text.
        INSERT INTO public.user_sessions (user_id, user_agent, platform)
        VALUES (v_uid, NULLIF(left(p_user_agent, 512), ''), v_plat);
    ELSE
        UPDATE public.user_sessions SET last_seen_at = now() WHERE id = v_session;
    END IF;
END;
$$;

REVOKE ALL     ON FUNCTION public.touch_presence(text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.touch_presence(text,text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.touch_presence(text,text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The working-day calendar (Appendix A(h)) — one statutory source
-- ---------------------------------------------------------------------------
-- Created HERE, in the first substantive migration, because the spine's
-- BEFORE INSERT trigger computes a NOT NULL due_date and raises without it
-- (§12 §(c) hard dependency 4). public.sa_public_holidays is NOT created —
-- it would duplicate a set the JBCC module already computes. No
-- works_saturdays column is added — working_days already carries that fact.
CREATE TABLE projects.public_holidays (
    d    date PRIMARY KEY,
    name text NOT NULL
);

CREATE TABLE projects.calendar_years (
    year      int PRIMARY KEY,
    seeded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE projects.public_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.calendar_years  ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_holidays_read ON projects.public_holidays FOR SELECT TO authenticated USING (true);
CREATE POLICY calendar_years_read  ON projects.calendar_years  FOR SELECT TO authenticated USING (true);
-- ALL, not just SELECT: 00025:25-26's default privileges hand anon SELECT (and
-- authenticated SELECT/INSERT/UPDATE/DELETE) to every new table in projects at
-- creation. No write policy exists, so RLS already denies every write, but a
-- grant that RLS happens to neutralise is still a grant.
REVOKE ALL ON projects.public_holidays FROM anon;
REVOKE ALL ON projects.calendar_years  FROM anon;

-- ⚠ SEED GENERATED — do not hand-edit. Regenerate with
--   node --experimental-strip-types scripts/db/gen-public-holidays-seed.ts 2024 2035
-- packages/shared/src/lib/calendar/public-holidays.contract.test.ts asserts
-- these rows equal listHolidaysNamed() for every seeded year, so a hand edit
-- fails the build naming the date.
--
-- The horizon is 2035, not 2031: working_days_between RAISES on an unseeded
-- year with no fallback, so the last seeded year is the year after which every
-- due-date computation in the product throws when a user saves an RFI.
--
-- 159 VALUES rows across 12 years (2024-2035). 159, not 160: 2033-12-26 is ONE
-- row — Christmas Day 2033 falls on a Sunday and its observed Monday is already
-- Day of Goodwill (Public Holidays Act 36 of 1994 s2(1); the 2016/2022
-- precedent declared no further day).
INSERT INTO projects.public_holidays (d, name) VALUES
  ('2024-01-01', 'New Year''s Day'),
  ('2024-03-21', 'Human Rights Day'),
  ('2024-03-29', 'Good Friday'),
  ('2024-04-01', 'Family Day'),
  ('2024-04-27', 'Freedom Day'),
  ('2024-05-01', 'Workers'' Day'),
  ('2024-06-16', 'Youth Day'),
  ('2024-06-17', 'Youth Day (observed)'),
  ('2024-08-09', 'National Women''s Day'),
  ('2024-09-24', 'Heritage Day'),
  ('2024-12-16', 'Day of Reconciliation'),
  ('2024-12-25', 'Christmas Day'),
  ('2024-12-26', 'Day of Goodwill'),
  ('2025-01-01', 'New Year''s Day'),
  ('2025-03-21', 'Human Rights Day'),
  ('2025-04-18', 'Good Friday'),
  ('2025-04-21', 'Family Day'),
  ('2025-04-27', 'Freedom Day'),
  ('2025-04-28', 'Freedom Day (observed)'),
  ('2025-05-01', 'Workers'' Day'),
  ('2025-06-16', 'Youth Day'),
  ('2025-08-09', 'National Women''s Day'),
  ('2025-09-24', 'Heritage Day'),
  ('2025-12-16', 'Day of Reconciliation'),
  ('2025-12-25', 'Christmas Day'),
  ('2025-12-26', 'Day of Goodwill'),
  ('2026-01-01', 'New Year''s Day'),
  ('2026-03-21', 'Human Rights Day'),
  ('2026-04-03', 'Good Friday'),
  ('2026-04-06', 'Family Day'),
  ('2026-04-27', 'Freedom Day'),
  ('2026-05-01', 'Workers'' Day'),
  ('2026-06-16', 'Youth Day'),
  ('2026-08-09', 'National Women''s Day'),
  ('2026-08-10', 'National Women''s Day (observed)'),
  ('2026-09-24', 'Heritage Day'),
  ('2026-12-16', 'Day of Reconciliation'),
  ('2026-12-25', 'Christmas Day'),
  ('2026-12-26', 'Day of Goodwill'),
  ('2027-01-01', 'New Year''s Day'),
  ('2027-03-21', 'Human Rights Day'),
  ('2027-03-22', 'Human Rights Day (observed)'),
  ('2027-03-26', 'Good Friday'),
  ('2027-03-29', 'Family Day'),
  ('2027-04-27', 'Freedom Day'),
  ('2027-05-01', 'Workers'' Day'),
  ('2027-06-16', 'Youth Day'),
  ('2027-08-09', 'National Women''s Day'),
  ('2027-09-24', 'Heritage Day'),
  ('2027-12-16', 'Day of Reconciliation'),
  ('2027-12-25', 'Christmas Day'),
  ('2027-12-26', 'Day of Goodwill'),
  ('2027-12-27', 'Day of Goodwill (observed)'),
  ('2028-01-01', 'New Year''s Day'),
  ('2028-03-21', 'Human Rights Day'),
  ('2028-04-14', 'Good Friday'),
  ('2028-04-17', 'Family Day'),
  ('2028-04-27', 'Freedom Day'),
  ('2028-05-01', 'Workers'' Day'),
  ('2028-06-16', 'Youth Day'),
  ('2028-08-09', 'National Women''s Day'),
  ('2028-09-24', 'Heritage Day'),
  ('2028-09-25', 'Heritage Day (observed)'),
  ('2028-12-16', 'Day of Reconciliation'),
  ('2028-12-25', 'Christmas Day'),
  ('2028-12-26', 'Day of Goodwill'),
  ('2029-01-01', 'New Year''s Day'),
  ('2029-03-21', 'Human Rights Day'),
  ('2029-03-30', 'Good Friday'),
  ('2029-04-02', 'Family Day'),
  ('2029-04-27', 'Freedom Day'),
  ('2029-05-01', 'Workers'' Day'),
  ('2029-06-16', 'Youth Day'),
  ('2029-08-09', 'National Women''s Day'),
  ('2029-09-24', 'Heritage Day'),
  ('2029-12-16', 'Day of Reconciliation'),
  ('2029-12-17', 'Day of Reconciliation (observed)'),
  ('2029-12-25', 'Christmas Day'),
  ('2029-12-26', 'Day of Goodwill'),
  ('2030-01-01', 'New Year''s Day'),
  ('2030-03-21', 'Human Rights Day'),
  ('2030-04-19', 'Good Friday'),
  ('2030-04-22', 'Family Day'),
  ('2030-04-27', 'Freedom Day'),
  ('2030-05-01', 'Workers'' Day'),
  ('2030-06-16', 'Youth Day'),
  ('2030-06-17', 'Youth Day (observed)'),
  ('2030-08-09', 'National Women''s Day'),
  ('2030-09-24', 'Heritage Day'),
  ('2030-12-16', 'Day of Reconciliation'),
  ('2030-12-25', 'Christmas Day'),
  ('2030-12-26', 'Day of Goodwill'),
  ('2031-01-01', 'New Year''s Day'),
  ('2031-03-21', 'Human Rights Day'),
  ('2031-04-11', 'Good Friday'),
  ('2031-04-14', 'Family Day'),
  ('2031-04-27', 'Freedom Day'),
  ('2031-04-28', 'Freedom Day (observed)'),
  ('2031-05-01', 'Workers'' Day'),
  ('2031-06-16', 'Youth Day'),
  ('2031-08-09', 'National Women''s Day'),
  ('2031-09-24', 'Heritage Day'),
  ('2031-12-16', 'Day of Reconciliation'),
  ('2031-12-25', 'Christmas Day'),
  ('2031-12-26', 'Day of Goodwill'),
  ('2032-01-01', 'New Year''s Day'),
  ('2032-03-21', 'Human Rights Day'),
  ('2032-03-22', 'Human Rights Day (observed)'),
  ('2032-03-26', 'Good Friday'),
  ('2032-03-29', 'Family Day'),
  ('2032-04-27', 'Freedom Day'),
  ('2032-05-01', 'Workers'' Day'),
  ('2032-06-16', 'Youth Day'),
  ('2032-08-09', 'National Women''s Day'),
  ('2032-09-24', 'Heritage Day'),
  ('2032-12-16', 'Day of Reconciliation'),
  ('2032-12-25', 'Christmas Day'),
  ('2032-12-26', 'Day of Goodwill'),
  ('2032-12-27', 'Day of Goodwill (observed)'),
  ('2033-01-01', 'New Year''s Day'),
  ('2033-03-21', 'Human Rights Day'),
  ('2033-04-15', 'Good Friday'),
  ('2033-04-18', 'Family Day'),
  ('2033-04-27', 'Freedom Day'),
  ('2033-05-01', 'Workers'' Day'),
  ('2033-05-02', 'Workers'' Day (observed)'),
  ('2033-06-16', 'Youth Day'),
  ('2033-08-09', 'National Women''s Day'),
  ('2033-09-24', 'Heritage Day'),
  ('2033-12-16', 'Day of Reconciliation'),
  ('2033-12-25', 'Christmas Day'),
  ('2033-12-26', 'Day of Goodwill'),
  ('2034-01-01', 'New Year''s Day'),
  ('2034-01-02', 'New Year''s Day (observed)'),
  ('2034-03-21', 'Human Rights Day'),
  ('2034-04-07', 'Good Friday'),
  ('2034-04-10', 'Family Day'),
  ('2034-04-27', 'Freedom Day'),
  ('2034-05-01', 'Workers'' Day'),
  ('2034-06-16', 'Youth Day'),
  ('2034-08-09', 'National Women''s Day'),
  ('2034-09-24', 'Heritage Day'),
  ('2034-09-25', 'Heritage Day (observed)'),
  ('2034-12-16', 'Day of Reconciliation'),
  ('2034-12-25', 'Christmas Day'),
  ('2034-12-26', 'Day of Goodwill'),
  ('2035-01-01', 'New Year''s Day'),
  ('2035-03-21', 'Human Rights Day'),
  ('2035-03-23', 'Good Friday'),
  ('2035-03-26', 'Family Day'),
  ('2035-04-27', 'Freedom Day'),
  ('2035-05-01', 'Workers'' Day'),
  ('2035-06-16', 'Youth Day'),
  ('2035-08-09', 'National Women''s Day'),
  ('2035-09-24', 'Heritage Day'),
  ('2035-12-16', 'Day of Reconciliation'),
  ('2035-12-17', 'Day of Reconciliation (observed)'),
  ('2035-12-25', 'Christmas Day'),
  ('2035-12-26', 'Day of Goodwill')
ON CONFLICT (d) DO NOTHING;

INSERT INTO projects.calendar_years (year)
SELECT generate_series(2024, 2035)
ON CONFLICT (year) DO NOTHING;

-- ---------------------------------------------------------------------------
-- projects.working_days_between — STABLE, never IMMUTABLE, no default calendar
-- ---------------------------------------------------------------------------
-- It reads a table; marking it IMMUTABLE would let the planner fold a result
-- across a calendar refresh. Both bounds are evaluated AT TIME ZONE
-- 'Africa/Johannesburg'. An unseeded year raises no_data_found; there is NO
-- fallback to calendar days.
--
-- ⚠ p_calendar has NO DEFAULT, deliberately. §15 fixes three calendars for
-- three consumers — metric 4 is 'office', the chase ladder is 'site', JBCC is
-- statutory-only — and the chase ladder is written by a different author in a
-- later item. A silent 'office' default would compute a Saturday-working
-- contractor's deadline on a Mon-Fri week, drifting one day in the direction
-- that makes him look late. The same reasoning that forbids a calendar-day
-- fallback forbids a calendar default.
--
-- No shutdown arm here, by design (A(h)): the December push belongs to the
-- due-date rule (addProjectWorkingDays in @esite/shared), and the count must
-- not skip a window it never entered. Keep the two in step.
--
-- working_days and extra_holidays are read from the EXISTING project_settings
-- row (00101:20,22) — no new column. A project with no settings row falls back
-- to the column defaults, which is what the row would have carried.
CREATE OR REPLACE FUNCTION projects.working_days_between(
    p_from     timestamptz,
    p_to       timestamptz,
    p_project  uuid,
    p_calendar text
) RETURNS int
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'projects', 'public'
SET row_security TO 'off'
AS $$
DECLARE
    v_from  date := (p_from AT TIME ZONE 'Africa/Johannesburg')::date;
    v_to    date := (p_to   AT TIME ZONE 'Africa/Johannesburg')::date;
    v_days  int[];
    v_extra date[];
    v_count int := 0;
    v_cur   date;
    y       int;
BEGIN
    IF p_calendar IS NULL OR p_calendar NOT IN ('office', 'site') THEN
        RAISE EXCEPTION 'working_days_between: unknown calendar %', COALESCE(p_calendar, '<null>');
    END IF;

    -- LEAST .. GREATEST, not generate_series(from, to): on a reversed span the
    -- series was empty, so an unseeded year returned 0 silently instead of raising.
    FOR y IN LEAST(extract(year from v_from)::int, extract(year from v_to)::int)
          .. GREATEST(extract(year from v_from)::int, extract(year from v_to)::int) LOOP
        IF NOT EXISTS (SELECT 1 FROM projects.calendar_years cy WHERE cy.year = y) THEN
            RAISE EXCEPTION 'working_days_between: % is not seeded in projects.calendar_years', y
              USING ERRCODE = 'no_data_found';
        END IF;
    END LOOP;

    SELECT ps.working_days, ps.extra_holidays INTO v_days, v_extra
      FROM projects.project_settings ps WHERE ps.project_id = p_project;
    v_days  := COALESCE(v_days, ARRAY[1,2,3,4,5]);
    v_extra := COALESCE(v_extra, ARRAY[]::date[]);

    -- site = office plus Saturday where Saturday is absent from working_days.
    IF p_calendar = 'site' AND NOT (6 = ANY(v_days)) THEN
        v_days := v_days || 6;
    END IF;

    IF v_to <= v_from THEN RETURN 0; END IF;

    v_cur := v_from;
    WHILE v_cur < v_to LOOP
        v_cur := v_cur + 1;
        IF extract(isodow from v_cur)::int = ANY(v_days)
           AND NOT EXISTS (SELECT 1 FROM projects.public_holidays ph WHERE ph.d = v_cur)
           AND NOT (v_cur = ANY(v_extra))
        THEN
            v_count := v_count + 1;
        END IF;
    END LOOP;

    RETURN v_count;
END;
$$;

REVOKE ALL     ON FUNCTION projects.working_days_between(timestamptz,timestamptz,uuid,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.working_days_between(timestamptz,timestamptz,uuid,text) FROM anon;
GRANT  EXECUTE ON FUNCTION projects.working_days_between(timestamptz,timestamptz,uuid,text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. The weekly rollup and its schedule
-- ---------------------------------------------------------------------------
-- §15 §(b2) rule 1: a row per metric on EVERY tick, including a tick that
-- measured nothing. The snapshot IS this job's run ledger, so "no row" must
-- mean "did not run". cloud-sync-poll was merged and never scheduled, and the
-- only reason anyone found out was users reporting stale floor plans.
--
-- p_is_baseline writes the single frozen row per metric (§13 item 1's "four
-- weeks to 30 September"). value is a WEEKLY RATE or a ratio — never a
-- cumulative all-time figure — because a weekly rate is the only thing a
-- weekly target can be measured against. ONE deliberate exception:
-- paying_organisations is a STOCK (the count of paying organisations at the
-- window's end), because "how many pay" is the question §11.7 asks, not "how
-- many started paying this week".
--
-- timezone is pinned to UTC for the function body: CURRENT_DATE and every
-- date -> timestamptz promotion below would otherwise follow the CALLER's
-- session TimeZone, so a Management-API or psql caller in another zone could
-- pass the whole-window guard on a window the cron would have refused.
CREATE OR REPLACE FUNCTION public.compute_platform_metrics_weekly(
    p_window_start date,
    p_window_end   date,               -- exclusive
    p_is_baseline  boolean DEFAULT false
) RETURNS int
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'projects', 'billing', 'field', 'inspections'
SET row_security TO 'off'
SET timezone TO 'UTC'
AS $$
DECLARE
    v_days       int     := p_window_end - p_window_start;
    v_weeks      numeric := GREATEST(1, (p_window_end - p_window_start) / 7.0);
    v_year       int     := extract(isoyear from p_window_start)::int;
    v_week       int     := CASE WHEN p_is_baseline THEN NULL ELSE extract(week from p_window_start)::int END;
    v_as_of      date    := DATE '2026-09-09';   -- the ONE frozen cohort date
    -- Appended to the four active-ratio notes on the BASELINE row only: that
    -- window is 28 days, so "active" there means active at least once in four
    -- weeks, which a 7-day tick cannot be read against directly. The owner's
    -- decision on averaging is recorded separately; the row is deliberately
    -- not restructured into sub-windows.
    v_baseline_note text := CASE WHEN p_is_baseline
                              THEN ' 28-day window — active means active at least once in four weeks; not directly comparable to a 7-day tick.'
                              ELSE '' END;
    v_cohort     int;
    v_contract   int;
    v_client     int;
    v_all_contr  int;
    v_writes     int;
    v_diary      int;
    -- Numerators, computed ONCE before the INSERT and read by numerator and
    -- value alike, so the two columns of a row can never disagree.
    v_active           int;
    v_contr_active     int;
    v_all_contr_active int;
    v_client_active    int;
    v_diary_same       int;
    v_notif            int;
    v_paying           int;
    v_written    int := 0;
BEGIN
    -- Whole-window guards, for EVERY call. A snapshot over a window that has
    -- not finished is a lie; and a "weekly" row whose window is not one ISO
    -- week Monday->Monday would be labelled (iso_year, iso_week) and deduped
    -- by platform_metrics_weekly_week_uk on a label that does not describe
    -- its data. The cron passes both by construction: it runs at 04:00 UTC on
    -- Monday for [previous Monday, this Monday), and this Monday is
    -- CURRENT_DATE in UTC, never beyond it.
    IF p_window_end > CURRENT_DATE THEN
        IF p_is_baseline THEN
            RAISE EXCEPTION 'refusing to freeze a baseline over an incomplete window (ends %, today is %)',
                            p_window_end, CURRENT_DATE;
        END IF;
        RAISE EXCEPTION 'refusing to compute over an incomplete window (ends %, today is %)',
                        p_window_end, CURRENT_DATE;
    END IF;
    IF NOT p_is_baseline
       AND NOT (extract(isodow from p_window_start) = 1 AND p_window_end = p_window_start + 7) THEN
        RAISE EXCEPTION 'weekly rows must cover exactly one ISO week Monday→Monday (got % → %)',
                        p_window_start, p_window_end;
    END IF;

    -- ⚠ as_of is filtered, not omitted. The PK is (cohort_key, user_id, as_of),
    -- so a second as_of is LEGAL and the table's name invites one. Without this
    -- filter, the day anyone re-freezes, both denominators roughly double and
    -- every ratio on /metrics halves, silently, with no error anywhere. A
    -- frozen cohort that can silently unfreeze is not frozen.
    SELECT count(*) INTO v_cohort   FROM public.metric_cohorts WHERE cohort_key = 'weekly_active_denominator' AND as_of = v_as_of;
    SELECT count(*) INTO v_contract FROM public.metric_cohorts WHERE cohort_key = 'contractor_frozen'          AND as_of = v_as_of;
    SELECT count(*) INTO v_client   FROM public.metric_cohorts WHERE cohort_key = 'client_viewer_frozen'       AND as_of = v_as_of;

    -- ---------------------------------------------------------------------
    -- FIRST-PARTY WRITES in the window, from the author columns that already
    -- exist and already carry history. This is what makes metric 1 measure
    -- BEHAVIOUR rather than the office lane's instrumentation schedule:
    -- product_events covers ten trackServer call sites in five office files,
    -- user_sessions has one writer (the admin shell's touchPresence) until
    -- item 4's heartbeat, and the source mirrors for diary/QC/forms/inspections
    -- are item 3. A foreman who writes a diary entry every day would otherwise
    -- read as inactive for two-thirds of Q1.
    --
    -- It is also the only arm measurable RETROSPECTIVELY, which is exactly
    -- what a frozen baseline over a window in the past requires.
    -- ---------------------------------------------------------------------
    -- pg_temp-qualified on DROP, CREATE and every read: this is SECURITY
    -- DEFINER with public first on the search path, and an unqualified DROP
    -- TABLE IF EXISTS _writes would resolve to — and drop — a public._writes
    -- if one ever existed. The temp namespace is named, never searched for.
    DROP TABLE IF EXISTS pg_temp._writes;
    CREATE TEMP TABLE pg_temp._writes ON COMMIT DROP AS
    SELECT d.created_by AS user_id FROM projects.site_diary_entries d
     WHERE d.created_at >= p_window_start AND d.created_at < p_window_end
    UNION ALL
    SELECT s.raised_by FROM field.snags s
     WHERE s.created_at >= p_window_start AND s.created_at < p_window_end
    UNION ALL
    SELECT q.created_by FROM projects.qc_entries q
     WHERE q.created_at >= p_window_start AND q.created_at < p_window_end
    UNION ALL
    SELECT r.raised_by FROM projects.rfis r
     WHERE r.created_at >= p_window_start AND r.created_at < p_window_end
    UNION ALL
    SELECT rr.responded_by FROM projects.rfi_responses rr
     WHERE rr.created_at >= p_window_start AND rr.created_at < p_window_end
    UNION ALL
    SELECT i.created_by FROM inspections.inspections i
     WHERE i.created_at >= p_window_start AND i.created_at < p_window_end
    UNION ALL
    SELECT f.latest_responded_by FROM field.form_responses f
     WHERE f.latest_responded_at >= p_window_start AND f.latest_responded_at < p_window_end
    UNION ALL
    SELECT rp.generated_by FROM projects.reports rp
     WHERE rp.created_at >= p_window_start AND rp.created_at < p_window_end;

    -- Only authors inside metric_accounts count, so notifications_created's
    -- denominator is the SAME population metric 1 counts — a fixture or probe
    -- account writing a diary entry must not inflate one and not the other.
    SELECT count(*) INTO v_writes FROM pg_temp._writes
     WHERE user_id IS NOT NULL
       AND user_id IN (SELECT user_id FROM public.metric_accounts);

    -- Active = a session row touched in the window, OR a first-party event in
    -- it, OR a write to any source table in it.
    DROP TABLE IF EXISTS pg_temp._active;
    CREATE TEMP TABLE pg_temp._active ON COMMIT DROP AS
    SELECT DISTINCT ma.user_id
      FROM public.metric_accounts ma
     WHERE EXISTS (SELECT 1 FROM public.user_sessions s
                    WHERE s.user_id = ma.user_id
                      AND s.last_seen_at >= p_window_start AND s.last_seen_at < p_window_end)
        OR EXISTS (SELECT 1 FROM public.product_events pe
                    WHERE pe.actor_id = ma.user_id
                      AND pe.occurred_at >= p_window_start AND pe.occurred_at < p_window_end)
        OR EXISTS (SELECT 1 FROM pg_temp._writes w WHERE w.user_id = ma.user_id);

    -- Metric 2b's denominator, by EFFECTIVE PROJECT ROLE (§15 §(a): "every
    -- account whose effective role on any ACTIVE project is contractor"), never
    -- user_organisations.role. Those are different facts: a contractor invited
    -- onto one project with no org row is invisible to the org-role query, and
    -- an org contractor promoted to PM on every live project still counts.
    --
    -- ⚠ "Active project" is projects.project_had_activity over the 90 days
    -- ending at the window's close, NOT projects.updated_at. Measured: the
    -- cloud-sync-poll cron (PR #152) rewrites cloud_storage_last_sync_at every
    -- 15 minutes on every Dropbox-mapped project and the set_updated_at
    -- trigger bumps updated_at with it, so an updated_at test reads every
    -- mapped project as "active" forever — machine activity, not use. The
    -- window is anchored on p_window_end, not now(), so a baseline over a past
    -- window and a cron tick over last week both ask the same question of the
    -- same 90 days. Same predicate the cohort seeds in section 3b use.
    SELECT count(DISTINCT pm.user_id) INTO v_all_contr
      FROM projects.project_members pm
      JOIN public.metric_accounts ma ON ma.user_id = pm.user_id
     WHERE pm.is_active
       AND projects.project_had_activity(pm.project_id, (p_window_end - interval '90 days')::timestamptz, p_window_end::timestamptz)
       AND public.user_effective_project_role(pm.project_id, pm.user_id) = 'contractor';

    SELECT count(*) INTO v_diary FROM projects.site_diary_entries d
     WHERE d.created_at >= p_window_start AND d.created_at < p_window_end;

    -- ---------------------------------------------------------------------
    -- Numerators, once. Each ratio arm below writes the variable as its
    -- numerator and derives value as ROUND(numerator / denominator, 4)
    -- inside its status CASE, so a row's numerator, value and status are
    -- three views of one computation rather than three computations.
    -- ---------------------------------------------------------------------
    SELECT count(*) INTO v_active FROM pg_temp._active;

    SELECT count(*) INTO v_contr_active
      FROM pg_temp._active a
      JOIN public.metric_cohorts c
        ON c.user_id = a.user_id AND c.cohort_key = 'contractor_frozen' AND c.as_of = v_as_of;

    SELECT count(*) INTO v_client_active
      FROM pg_temp._active a
      JOIN public.metric_cohorts c
        ON c.user_id = a.user_id AND c.cohort_key = 'client_viewer_frozen' AND c.as_of = v_as_of;

    -- Same "active project" predicate and window anchor as v_all_contr above.
    SELECT count(DISTINCT a.user_id) INTO v_all_contr_active
      FROM pg_temp._active a
     WHERE EXISTS (SELECT 1 FROM projects.project_members pm
                    WHERE pm.user_id = a.user_id
                      AND pm.is_active
                      AND projects.project_had_activity(pm.project_id, (p_window_end - interval '90 days')::timestamptz, p_window_end::timestamptz)
                      AND public.user_effective_project_role(pm.project_id, pm.user_id) = 'contractor');

    -- SAST is UTC+2 with no DST, so the UTC date runs BEHIND the local date;
    -- the misclassification window is 00:00-02:00 SAST.
    SELECT count(*) INTO v_diary_same FROM projects.site_diary_entries d
     WHERE d.created_at >= p_window_start AND d.created_at < p_window_end
       AND d.entry_date = (d.created_at AT TIME ZONE 'Africa/Johannesburg')::date;

    SELECT count(*) INTO v_notif FROM public.notifications n
     WHERE n.created_at >= p_window_start AND n.created_at < p_window_end;

    -- "Paying" = an ACTIVE subscription on a tier other than free that carries
    -- a Paystack subscription code. status is load-bearing: the live CHECK
    -- admits past_due / grace_period / paused / cancelled / trialing, and a
    -- cancelled subscription keeps both its tier and its code.
    SELECT count(*) INTO v_paying FROM billing.subscriptions s
     WHERE s.status = 'active'
       AND s.tier <> 'free'
       AND s.paystack_subscription_code IS NOT NULL
       AND s.organisation_id <> 'dddddddd-0000-0000-0000-000000000001'::uuid;

    INSERT INTO public.platform_metrics_weekly
      (metric_key, iso_year, iso_week, window_start, window_end, numerator, denominator, value, status, is_baseline, note, detail)

    -- 1 — weekly active, against the FROZEN cohort.
    -- ⚠ status is a CASE, never the literal 'measured'. A zero denominator
    -- gives a NULL value, and 'measured' + NULL violates
    -- platform_metrics_weekly_measured_has_value, which aborts this ENTIRE
    -- INSERT and writes zero rows — read downstream as "the job did not run".
    SELECT 'weekly_active', v_year, v_week, p_window_start, p_window_end,
           v_active, v_cohort,
           CASE WHEN v_cohort > 0 THEN ROUND(v_active::numeric / v_cohort, 4) END,
           CASE WHEN v_cohort > 0 THEN 'measured' ELSE 'unmeasurable' END, p_is_baseline,
           'Denominator is the frozen September-2026 cohort (as_of 2026-09-09), never a running count. Active = a session, a first-party event, OR a write to any source table.' || v_baseline_note,
           jsonb_build_object('window_days', v_days,
                              'accounts_total', (SELECT count(*) FROM public.metric_accounts),
                              'first_party_writes', v_writes)

    -- 2a — contractor, frozen cohort
    UNION ALL SELECT 'contractor_active_frozen', v_year, v_week, p_window_start, p_window_end,
           v_contr_active, v_contract,
           CASE WHEN v_contract > 0 THEN ROUND(v_contr_active::numeric / v_contract, 4) END,
           CASE WHEN v_contract > 0 THEN 'measured' ELSE 'unmeasurable' END, p_is_baseline,
           'Frozen at 12: 13 accounts hold a contractor role, one is the rbac-test fixture that metric_accounts excludes. Q1 target restated as 6 of 12 (50%).' || v_baseline_note,
           jsonb_build_object('window_days', v_days)

    -- 2b — contractor, all, by EFFECTIVE PROJECT ROLE on an active project
    -- (project_had_activity over the trailing 90 days, never updated_at — see
    -- the v_all_contr comment above).
    UNION ALL SELECT 'contractor_active_all', v_year, v_week, p_window_start, p_window_end,
           v_all_contr_active, v_all_contr,
           CASE WHEN v_all_contr > 0 THEN ROUND(v_all_contr_active::numeric / v_all_contr, 4) END,
           CASE WHEN v_all_contr > 0 THEN 'measured' ELSE 'unmeasurable' END, p_is_baseline,
           'Effective role on an active project, per §15 §(a) — never user_organisations.role, which is a different fact.' || v_baseline_note,
           jsonb_build_object('window_days', v_days)

    -- 2c — client viewers, frozen cohort. There is no client metric in §15's
    -- eight, and §15 §(c) puts client viewers in Wave 3 (Q3). Instrumenting it
    -- now means Q3's portal is judged against a baseline that exists, instead
    -- of one first computed the quarter it ships.
    UNION ALL SELECT 'client_active', v_year, v_week, p_window_start, p_window_end,
           v_client_active, v_client,
           CASE WHEN v_client > 0 THEN ROUND(v_client_active::numeric / v_client, 4) END,
           CASE WHEN v_client > 0 THEN 'measured' ELSE 'unmeasurable' END, p_is_baseline,
           'No client wave runs before Q3 (§15 §(c)), so a low figure here is a fact about the programme sequence, not about clients. Frozen cohort of 4.' || v_baseline_note,
           jsonb_build_object('window_days', v_days)

    -- 3 — diary same day (v_diary_same is computed in SAST above).
    -- ⚠ THE arm that proved the CHECK violation: 53 diary rows exist all-time
    -- and only 10 of the last 27 weeks contain any (measured 2026-09-10), so
    -- ~63% of Monday ticks have a zero denominator here.
    UNION ALL SELECT 'diary_same_day', v_year, v_week, p_window_start, p_window_end,
           v_diary_same, v_diary,
           CASE WHEN v_diary > 0 THEN ROUND(v_diary_same::numeric / v_diary, 4) END,
           CASE WHEN v_diary > 0 THEN 'measured' ELSE 'unmeasurable' END, p_is_baseline,
           CASE WHEN v_diary > 0 THEN NULL ELSE 'No diary entries in this window, so there is no same-day share to compute. A zero here would be an invented number.' END,
           jsonb_build_object('window_days', v_days)

    -- 4 — RFI response median. CENSORED until work_item_events exists: the
    -- pre-release median over items RAISED is not retrospectively recoverable.
    UNION ALL SELECT 'rfi_response_median_wd', v_year, v_week, p_window_start, p_window_end,
           NULL, NULL, NULL, 'censored', p_is_baseline,
           'No work_item_events before Q1 item 2. Published as the answered-ever share plus the unanswered count.',
           jsonb_build_object(
             'window_days',   v_days,
             'rfis_total',    (SELECT count(*) FROM projects.rfis),
             'answered_ever', (SELECT count(DISTINCT rr.rfi_id) FROM projects.rfi_responses rr),
             'response_rows', (SELECT count(*) FROM projects.rfi_responses))

    -- 5 — inbox engagement. UNMEASURABLE: read_at has existed since
    -- 00001_initial_schema.sql:151 and NOTHING has ever written it — the only
    -- writers set is_read alone (components/ui/NotificationCentre.tsx:52-55,
    -- :62). public.inbox_state does not exist until Q1 item 8.
    --
    -- detail also carries the EMAIL-DELIVERY evidence, because the entire Q1
    -- outcome is delivered over email. Two generations of it: the legacy
    -- email_sequence_events columns (246 sends, opened_at / clicked_at NULL on
    -- all 246 — 00030_email_sequences.sql:24-25's "Phase 2" webhook never
    -- wrote them) and public.email_events, the Resend webhook ledger Q1 item 0
    -- shipped (measured 2026-09-11: email.sent 96, email.delivered 48,
    -- email.bounced 48, email.opened 11). Opens and bounces are now recorded
    -- PER MESSAGE, but nothing joins them back to a notification or a sequence
    -- row yet, so the engagement RATIO is still unmeasurable; the counts are
    -- published so the join's arrival is visible here, not in a markdown file.
    UNION ALL SELECT 'inbox_engagement', v_year, v_week, p_window_start, p_window_end,
           NULL, NULL, NULL, 'unmeasurable', p_is_baseline,
           'read_at has never been written and inbox_state does not exist yet, so no per-notification engagement exists. Email opens and bounces ARE recorded per message in email_events (Resend webhook, Q1 item 0) but are not yet joined to notifications or email_sequence_events. Re-based at method_version 2 when items 4 and 8 land.',
           jsonb_build_object(
             'window_days',               v_days,
             'is_read_true_all_time',     (SELECT count(*) FROM public.notifications WHERE is_read),
             'created_all_time',          (SELECT count(*) FROM public.notifications),
             'emails_sent_all_time',      (SELECT count(*) FROM public.email_sequence_events),
             'emails_with_open_evidence', (SELECT count(opened_at) FROM public.email_sequence_events),
             'emails_accepted_by_resend', (SELECT count(resend_message_id) FROM public.email_sequence_events),
             'email_events_by_type',      COALESCE((SELECT jsonb_object_agg(event_type, n)
                                                      FROM (SELECT event_type, count(*) AS n
                                                              FROM public.email_events GROUP BY 1) t),
                                                   '{}'::jsonb))

    -- 5b — notification VOLUME, as a RATIO. The Q1 exit criterion is "down
    -- >= 60% on the Sept-2026 baseline"; 750 of the 964 production
    -- notifications (measured 2026-09-10; 822 of 1036 on 2026-09-11) are
    -- diary_created, so a bare count falls whenever diary volume falls — a
    -- contractor leaves, a project completes — and the target is met while
    -- the notification engine has changed nothing. A metric where success and
    -- abandonment are the same number is not a metric.
    UNION ALL SELECT 'notifications_created', v_year, v_week, p_window_start, p_window_end,
           v_notif, v_writes,
           CASE WHEN v_writes > 0 THEN ROUND(v_notif::numeric / v_writes, 4) END,
           CASE WHEN v_writes > 0 THEN 'measured' ELSE 'unmeasurable' END, p_is_baseline,
           'Notifications per first-party write, so a quiet quarter cannot be mistaken for a fixed engine. The denominator counts only authors inside metric_accounts — the same population as weekly_active. The raw weekly rate is in detail.per_week.',
           jsonb_build_object('window_days', v_days,
                              'per_week', ROUND(v_notif::numeric / v_weeks, 2))

    -- 6 — report schedules. projects.report_schedules does not exist until Q3,
    -- so a non-zero target here would be unattainable by construction. The
    -- denominator is "active projects" by the same project_had_activity
    -- predicate as 2b, for the same reason: updated_at is machine-bumped.
    UNION ALL SELECT 'report_schedules_per_project', v_year, v_week, p_window_start, p_window_end,
           0,
           (SELECT count(*) FROM projects.projects pr
             WHERE projects.project_had_activity(pr.id, (p_window_end - interval '90 days')::timestamptz, p_window_end::timestamptz)),
           0, 'not_yet_instrumented', p_is_baseline,
           'projects.report_schedules lands in Q3. Zero by construction, instrumented now so the arrival is visible.',
           jsonb_build_object('window_days', v_days)

    -- 7 — activation. Needs user_sessions x work_item_events; the latter
    -- arrives with the spine.
    UNION ALL SELECT 'activation_first_session', v_year, v_week, p_window_start, p_window_end,
           NULL, NULL, NULL, 'not_yet_instrumented', p_is_baseline,
           'projects.work_item_events lands with Q1 item 2. Session boundary is user_sessions, never auth_events.',
           jsonb_build_object('window_days', v_days)

    -- 8 — the commercial metric. Instrumented now, zero by design until Q3.
    -- A STOCK, not a rate: the count of paying organisations at the window's
    -- end (see the header). v_paying is computed above with status = 'active'.
    -- ⚠ The live CHECK on billing.subscriptions.tier is
    -- ('free','starter','professional','enterprise') — MEASURED, not assumed.
    -- §11.7's practice_solo / practice / practice_unlimited bands do not exist
    -- until the Q4 pricing cutover widens that CHECK (A(f), Q4). Writing them
    -- here would silently match nothing forever, so the predicate is
    -- "paid band" = anything but free, which survives the cutover unchanged.
    -- WM-Consulting's own row is excluded per §11.7.
    UNION ALL SELECT 'paying_organisations', v_year, v_week, p_window_start, p_window_end,
           v_paying, NULL, v_paying,
           'measured', p_is_baseline,
           'Zero by design until Q3. "Paying" = an ACTIVE subscription on a tier other than free that carries a Paystack subscription code; a cancelled or paused subscription keeps its tier and code and does not count. A stock at window end, not a weekly rate. Publishing a commercial metric that reads zero for two quarters is the point.',
           jsonb_build_object('window_days', v_days)
    ;

    GET DIAGNOSTICS v_written = ROW_COUNT;
    RETURN v_written;
END;
$$;

REVOKE ALL     ON FUNCTION public.compute_platform_metrics_weekly(date,date,boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.compute_platform_metrics_weekly(date,date,boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.compute_platform_metrics_weekly(date,date,boolean) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.compute_platform_metrics_weekly(date,date,boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- The schedule. NOT left as a commented-out block: that is exactly how
-- cloud-sync-poll came to be specified, merged and never scheduled (00148:130-147).
-- 04:00 UTC Monday = 06:00 SAST, no DST. date_trunc('week') is Monday-based.
--
-- ⚠ Divergence from §15 §(a), deliberate: §15 says to follow the inline-key
-- net.http_post pattern (00148:136-142). There is no edge function to call
-- here, and calling the function directly removes the whole class of failure
-- that broke cloud-sync-poll 4/4 on its first tick — the edge runtime injects
-- SUPABASE_SERVICE_ROLE_KEY as sb_secret_…, not a JWT, so a function-to-
-- function call fails the JWT-role gate.
-- ---------------------------------------------------------------------------
-- Guarded by an existence test, not by EXCEPTION WHEN OTHERS: a blanket catch
-- would also swallow a permissions or connectivity error and let the schedule
-- below silently duplicate or silently fail.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'platform-metrics-weekly') THEN
        PERFORM cron.unschedule('platform-metrics-weekly');
    END IF;
END $$;

SELECT cron.schedule(
    'platform-metrics-weekly',
    '0 4 * * 1',
    $cron$
    SELECT public.compute_platform_metrics_weekly(
             (date_trunc('week', now() AT TIME ZONE 'UTC') - interval '7 days')::date,
              date_trunc('week', now() AT TIME ZONE 'UTC')::date,
             false)
    $cron$
);

NOTIFY pgrst, 'reload schema';
