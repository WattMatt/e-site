-- ---------------------------------------------------------------------------
-- Migration 00186: revoke anon EXECUTE on every SECURITY DEFINER function in a
--                  PostgREST-exposed schema
-- ---------------------------------------------------------------------------
-- ⚠ MIGRATION NUMBER IS A PLACEHOLDER. Production head is 00185. Re-check
-- max(version) in schema_migrations AND origin/main immediately before applying
-- — 00183 and 00184 both raced twice in August (see CLAUDE.md 2026-08-13).
--
-- WHY. `public.project_notification_recipients(uuid,uuid)` (00146) is
-- SECURITY DEFINER with `SET row_security TO 'off'`, so RLS is irrelevant to
-- it, and `anon` held EXECUTE. An unauthenticated POST to
-- /rest/v1/rpc/project_notification_recipients carrying nothing but the public
-- anon key — which ships inside the browser bundle — and a real project UUID
-- returned HTTP 200 and 2,040 bytes of `user_id, email, full_name` for the
-- KINGSWALK project. A nonexistent UUID returned 2 bytes, so this was not a
-- boolean oracle: it was the roster itself. CLAUDE.md records this same
-- function resolving 12-13 real wmeng.co.za people for a WM-Consulting project.
-- Project UUIDs are held by every participant and by anyone ever sent a deep
-- link, so this is bulk disclosure of a consulting firm's staff and its
-- clients' staff to any unauthenticated party — a POPIA §19 security-safeguards
-- failure.
--
-- It was not alone. Thirty-two SECURITY DEFINER functions across nine of the
-- eleven exposed schemas were anon-EXECUTE-able. This migration closes all of
-- them, because a per-incident revoke leaves the class open.
--
-- HOW anon HOLDS IT — two independent mechanisms, and missing either one makes
-- the revoke a no-op that still reads as a fix:
--
--   (a) The Postgres built-in default: a newly created function is EXECUTE-able
--       by PUBLIC. Read from `pg_proc.proacl` this is the empty-grantee item
--       `=X/postgres`, and on a function nobody has ever GRANTed on, proacl is
--       NULL — which looks like "no grants" and IS the PUBLIC grant. Twelve of
--       the thirty-two are in exactly that state.
--   (b) Supabase ships `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE
--       ON FUNCTIONS TO anon, authenticated, service_role`, which grants anon
--       DIRECTLY at creation. Verified against production `pg_default_acl`:
--       `public` is the ONLY exposed schema with an `f`-type default ACL naming
--       anon; `inspections` names authenticated + service_role only (00069);
--       projects, field, structure, cable_schedule, marketplace, billing,
--       tenants, suppliers and gcr have no function default ACL at all.
--
-- `00164_powersync_jwt_project_access.sql:68` does `REVOKE EXECUTE ON FUNCTION
-- public.custom_jwt_claims(JSONB) FROM PUBLIC` and `custom_jwt_claims` was
-- STILL anon-executable in production two years later — mechanism (b) survived.
-- Every statement below therefore names PUBLIC **and** anon.
--
-- VERIFY WITH `has_function_privilege('anon', oid, 'EXECUTE')`, NEVER by
-- reading proacl.
--
-- THE RE-GRANTS ARE NOT DECORATION. Revoking PUBLIC also removes whatever
-- reached a role only through PUBLIC. Two functions would have broken outright:
--   · marketplace.refresh_supplier_rating_summary() — proacl held service_role
--     but NOT authenticated, and `rating.actions.ts:64` calls it through the
--     cookie-authenticated client. Its authenticated EXECUTE was PUBLIC's.
--   · projects.jbcc_allocate_letter_reference(uuid) — proacl held authenticated
--     but NOT service_role, and it is reached from the SECURITY **INVOKER**
--     trigger `projects.jbcc_letters_ensure_reference()`, so a service-role
--     INSERT into projects.jbcc_letters checks EXECUTE as service_role.
-- Each re-grant below restores exactly the roles that hold EXECUTE today and
-- have an evidenced caller. Nothing gains a privilege it did not have.
--
-- TRIGGER FUNCTIONS GET NO RE-GRANT, deliberately. Postgres checks EXECUTE on a
-- trigger function at CREATE TRIGGER time, not on each fire, so removing PUBLIC
-- does not stop the trigger. This is not a reading of the manual: production
-- already contains the control. `field.append_form_response_history()` has
-- proacl `{postgres=X/postgres}` — neither anon nor authenticated holds EXECUTE
-- — and its trigger fires on every live site-forms response write. The same was
-- re-verified for this migration inside a rolled-back transaction on production
-- (see @verify below). The twelve trigger functions here also cannot be reached
-- over PostgREST at all: they return `trigger`, which PostgREST does not expose.
--
-- ⚠ ONE FUNCTION LOSES `authenticated` AS WELL, and it is the headline one.
-- `public.project_notification_recipients` is called from exactly one place in
-- the monorepo — `apps/web/src/lib/recipients.ts:25`, which builds a
-- `createServiceClient()`. Leaving `authenticated` in place would have kept the
-- identical roster disclosure one free signup away: the function ignores RLS,
-- so ANY signed-in user of ANY organisation — a contractor, a client_viewer at
-- a client firm — could POST any project UUID and read that project's staff
-- names and email addresses. It is now service_role only.
--
-- ⚠ `public.custom_jwt_claims(jsonb)` keeps ONLY its `supabase_auth_admin`
-- grant (00164:67), which is the role GoTrue uses for the custom-access-token
-- hook. Checked before revoking: `hook_custom_access_token_enabled` is FALSE in
-- production today, and when enabled the hook is invoked as supabase_auth_admin,
-- never as anon.
--
-- ⚠ `public.handle_new_user()` is the `on_auth_user_created` trigger on
-- auth.users. It is covered by the trigger-function rule above; new-user signup
-- is verified below by actually creating a user inside a rolled-back
-- transaction and reading the resulting public.profiles row.
--
-- NOTHING LEGITIMATE NEEDS anon. Production holds exactly six RLS policies that
-- name `anon` — the RESTRICTIVE membership-write policies from 00177 — and not
-- one anon SELECT policy anywhere in the database. There is no anonymous data
-- surface in this application. Of those six, only `public.user_organisations`
-- also grants anon table-level INSERT/UPDATE/DELETE, so that is the one path
-- where an anon write actually reaches a policy calling `user_is_org_admin`;
-- it is verified below to stay denied after the revoke.
--
-- Reversible: re-GRANT EXECUTE ... TO anon on the functions listed (do not).
--
-- @verify:begin
-- anon_execute_absent: ALL prosecdef functions in public, projects, inspections,
--     field, tenants, suppliers, billing, marketplace, cable_schedule,
--     structure, gcr  -- has_function_privilege('anon', oid, 'EXECUTE') = false
-- grant_present: authenticated EXECUTE ON public.has_feature(uuid,text)
-- grant_present: authenticated EXECUTE ON public.has_feature_seat(uuid,uuid,text)
-- grant_present: authenticated EXECUTE ON public.user_has_mv_access(uuid)
-- grant_present: authenticated EXECUTE ON public.user_can_manage_project(uuid)
-- grant_present: authenticated EXECUTE ON public.user_can_manage_project_members(uuid)
-- grant_present: authenticated EXECUTE ON public.user_is_org_admin(uuid)
-- grant_present: authenticated EXECUTE ON public.floor_plan_project_id(uuid)
-- grant_present: authenticated EXECUTE ON structure.node_order_project_id(uuid)
-- grant_present: authenticated EXECUTE ON marketplace.refresh_supplier_rating_summary()
-- grant_present: authenticated EXECUTE ON projects.jbcc_allocate_letter_reference(uuid)
-- grant_present: service_role  EXECUTE ON projects.jbcc_allocate_letter_reference(uuid)
-- grant_present: service_role  EXECUTE ON public.project_notification_recipients(uuid,uuid)
-- grant_absent:  authenticated EXECUTE ON public.project_notification_recipients(uuid,uuid)
-- grant_present: supabase_auth_admin EXECUTE ON public.custom_jwt_claims(jsonb)
-- behaviour: INSERT auth.users still populates public.profiles (handle_new_user trigger fires)
-- behaviour: INSERT projects.valuations still allocates valuation_no (valuations_set_no trigger fires)
-- behaviour: anon INSERT/UPDATE/DELETE on public.user_organisations still denied
-- behaviour: authenticated SELECT public.has_feature(<wm org>, 'inspections') still true
-- @verify:end
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. public — the eleven the audit named
-- ===========================================================================

-- The payload. Service-role only from here: recipients.ts is the sole caller
-- and it uses createServiceClient().
REVOKE ALL ON FUNCTION public.project_notification_recipients(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_notification_recipients(UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.has_feature(UUID, TEXT)                       FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_feature(UUID, TEXT)                    TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.has_feature_seat(UUID, UUID, TEXT)            FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_feature_seat(UUID, UUID, TEXT)         TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.user_has_mv_access(UUID)                      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_has_mv_access(UUID)                   TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.user_can_manage_project(UUID)                 FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_can_manage_project(UUID)              TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.user_can_manage_project_members(UUID)         FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_can_manage_project_members(UUID)      TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.user_is_org_admin(UUID)                       FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_is_org_admin(UUID)                    TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.floor_plan_project_id(UUID)                   FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.floor_plan_project_id(UUID)                TO authenticated, service_role;

-- Zero callers anywhere: no RLS policy references it (checked in pg_policies),
-- no other function body calls it (checked in pg_proc.prosrc), no app code.
-- Superseded by public.get_user_org_ids() (00026-era). Kept executable by
-- authenticated + service_role so this migration removes anon and nothing else.
REVOKE ALL ON FUNCTION public.get_user_org_ids_bypass()                     FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_org_ids_bypass()                  TO authenticated, service_role;

-- GoTrue hook only. 00164:68 already revoked PUBLIC; anon's DIRECT grant is
-- what survived, and this is the statement that removes it.
REVOKE ALL ON FUNCTION public.custom_jwt_claims(JSONB)                      FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.custom_jwt_claims(JSONB)                   TO supabase_auth_admin;

-- Trigger on auth.users. No re-grant: see the trigger-function note above.
REVOKE ALL ON FUNCTION public.handle_new_user()                             FROM PUBLIC, anon, authenticated, service_role;

-- ===========================================================================
-- 2. inspections — RLS helpers ({authenticated} policies) + one allocator
-- ===========================================================================
-- These carry the PUBLIC grant only (00069's ALTER DEFAULT PRIVILEGES names
-- authenticated and service_role, never anon), so PUBLIC is the whole leak.

REVOKE ALL ON FUNCTION inspections.allocate_coc_number(UUID)                FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION inspections.allocate_coc_number(UUID)             TO authenticated, service_role;

REVOKE ALL ON FUNCTION inspections.is_inspection_verifier(UUID)             FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION inspections.is_inspection_verifier(UUID)          TO authenticated, service_role;

REVOKE ALL ON FUNCTION inspections.user_can_verify(UUID)                    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION inspections.user_can_verify(UUID)                 TO authenticated, service_role;

REVOKE ALL ON FUNCTION inspections.user_can_write_responses(UUID)           FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION inspections.user_can_write_responses(UUID)        TO authenticated, service_role;

REVOKE ALL ON FUNCTION inspections.user_has_inspection_read(UUID)           FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION inspections.user_has_inspection_read(UUID)        TO authenticated, service_role;

-- ===========================================================================
-- 3. projects / structure / marketplace / field / cable_schedule
-- ===========================================================================

-- Reached from a SECURITY INVOKER trigger, so BOTH writer roles need it.
REVOKE ALL ON FUNCTION projects.jbcc_allocate_letter_reference(UUID)        FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.jbcc_allocate_letter_reference(UUID)     TO authenticated, service_role;

-- rating.actions.ts:64, cookie-authenticated client. `authenticated` is granted
-- here for the first time — it only ever held this through PUBLIC.
REVOKE ALL ON FUNCTION marketplace.refresh_supplier_rating_summary()        FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION marketplace.refresh_supplier_rating_summary()     TO authenticated, service_role;

-- RLS helper, policies are TO authenticated (structure.node_orders family).
REVOKE ALL ON FUNCTION structure.node_order_project_id(UUID)                FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION structure.node_order_project_id(UUID)             TO authenticated, service_role;

-- Not a trigger function, but its only two callers are the SECURITY DEFINER
-- trigger functions below, which run as their owner (postgres). No re-grant.
REVOKE ALL ON FUNCTION structure.recompute_tenant_doc_status(UUID, TEXT)    FROM PUBLIC, anon, authenticated, service_role;

-- ===========================================================================
-- 4. Trigger functions — PUBLIC only, no re-grant (see header)
-- ===========================================================================

REVOKE ALL ON FUNCTION cable_schedule.enforce_cable_child_frozen()          FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION cable_schedule.enforce_revision_data_frozen()        FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION cable_schedule.enforce_revision_lifecycle()          FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION field.snag_visits_ensure_no()                        FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION projects.project_settings_audit()                    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION projects.qc_report_children_frozen()                 FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION projects.qc_reports_ensure_no()                      FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION projects.qc_reports_status_guard()                   FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION projects.valuations_set_no()                         FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION projects.variation_orders_set_no()                   FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION structure.tenant_doc_delete_status_trg()             FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION structure.tenant_doc_revision_status_trg()           FROM PUBLIC, anon, authenticated, service_role;

-- Privileges are not part of the PostgREST schema cache, but the RPC surface
-- PostgREST advertises is, so reload it.
NOTIFY pgrst, 'reload schema';
