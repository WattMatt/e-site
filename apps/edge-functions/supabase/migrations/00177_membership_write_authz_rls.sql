-- ---------------------------------------------------------------------------
-- 00177_membership_write_authz_rls.sql
--
-- SECURITY (privilege escalation): enforce role-scoped authorisation on writes
-- to the two RBAC membership tables at the DATABASE layer:
--   * projects.project_members  (per-project role — feeds user_effective_project_role)
--   * public.user_organisations (org role — feeds get_user_org_ids + every org gate)
--
-- Root cause
-- ----------
-- Both tables authorise writes by MEMBERSHIP ALONE, with no predicate on the
-- caller's role and no predicate on the role being written:
--
--   projects.project_members (00027)
--     INSERT WITH CHECK (organisation_id = ANY(public.get_user_org_ids()))
--     UPDATE USING       (organisation_id = ANY(public.get_user_org_ids()))  -- no WITH CHECK
--     DELETE USING       (organisation_id = ANY(public.get_user_org_ids()))
--   public.user_organisations (00026)
--     INSERT WITH CHECK (user_id = auth.uid())
--     UPDATE USING      (user_id = auth.uid())                               -- no WITH CHECK
--
-- `get_user_org_ids()` returns EVERY active membership org, so any org member —
-- contractor, inspector, supplier — satisfies the project_members predicate for
-- their whole org. `user_id = auth.uid()` is a "this row is mine" test, not an
-- authorisation test: it is exactly what a self-promotion needs.
--
-- 00161 added RESTRICTIVE write blocks on project_members for client_viewer
-- ONLY, so every other non-privileged role passes. user_organisations had no
-- RESTRICTIVE guard at all.
--
-- The app-layer server actions ARE gated — apps/web/src/actions/project-members*.ts
-- and users.actions.ts all check requireRole(..., ORG_WRITE_ROLES / OWNER_ADMIN)
-- — but PostgREST is a public HTTP surface: an authenticated session can POST /
-- PATCH / DELETE these tables directly and never traverse a server action.
--
-- Confirmed on production (2026-07-31) as the rbac-test contractor fixture,
-- inside a rolled-back transaction:
--   A1  INSERT project_members(role='project_manager') on a project they are
--       not a member of                                        -> ALLOWED
--   A2  UPDATE own project_members row -> 'project_manager'     -> ALLOWED (1 row)
--   A3  DELETE every OTHER member's project_members row in the
--       org                                                    -> ALLOWED (29 rows)
--   A4  INSERT user_organisations(role='owner') into a FOREIGN
--       org the caller has no relationship with                -> ALLOWED
--   A5  UPDATE own user_organisations row -> 'owner'            -> ALLOWED (1 row)
--   A6  user_effective_project_role() after A5                  -> 'owner'
-- A3 is not escalation but destruction: a contractor could strip project access
-- from every colleague. A5 then makes the escalation total — org 'owner' is the
-- top of the tree, and user_effective_project_role returns it for EVERY project
-- in the org, which is what requireEffectiveRole trusts everywhere (cost-bearing
-- cable exports included).
--
-- Model
-- -----
-- Membership is administered by ORG-LEVEL authority, matching the app gates:
--   * projects.project_members -> the caller must be owner / admin /
--     project_manager of the org that OWNS THE PROJECT. This mirrors
--     project-members.actions.ts, which gates on
--     requireRole(supabase, project.organisation_id, ORG_WRITE_ROLES).
--     The predicate keys on project_id, NOT on the row's organisation_id,
--     because addProjectMembersFromSubOrgAction writes rows whose
--     organisation_id is the member's SUB-ORG while the caller's authority
--     comes from the parent org that owns the project (00160's cross-org
--     identity convention).
--     Note: that cross-org write is ALREADY denied today by 00027's permissive
--     INSERT policy (organisation_id = ANY(get_user_org_ids()) — the parent-org
--     caller is not a member of the sub-org), verified on prod, and prod holds
--     0 rows where project_members.organisation_id <> the project's org. So the
--     sub-org flow is broken upstream of this migration, not by it; keying on
--     project_id is what keeps THIS policy from becoming a second, harder-to-
--     find blocker once the permissive policy is repaired. Tracked as a
--     follow-up (see PR body).
--   * public.user_organisations -> the caller must be owner / admin of the
--     target org, matching users.actions.ts (requireRoleAPI(OWNER_ADMIN)).
--
-- Why RESTRICTIVE
-- ---------------
-- PostgreSQL OR-combines PERMISSIVE policies, so hardening the 00026/00027
-- policies in place would not stop a future permissive policy from re-granting
-- the write. A RESTRICTIVE policy is AND-combined and holds regardless of how
-- many permissive policies exist now or later. Same pattern as 00161/00162/
-- 00166/00171. SELECT is deliberately untouched on both tables — visibility is
-- a separate concern already settled by 00026/00034/00160/00161, and narrowing
-- reads here would break the team roster, notification recipient resolution and
-- get_user_org_ids() itself.
--
-- Scoped `TO authenticated, anon`
-- -------------------------------
--  * service_role has BYPASSRLS (verified on prod), so every service-role write
--    is structurally unaffected — the naming the TO clause makes that explicit
--    and survives a future revocation of that attribute.
--  * `anon` is named because it holds full INSERT/UPDATE/DELETE grants on
--    public.user_organisations (a legacy grant). Those writes are already
--    unreachable (auth.uid() is NULL, so `user_id = auth.uid()` matches nothing),
--    but leaving anon out of a RESTRICTIVE guard would rest that on the
--    permissive policy's shape rather than on an explicit deny.
--
-- Fail-closed
-- -----------
-- Both helpers are EXISTS predicates returning FALSE (never NULL) for an
-- unresolvable project, a deleted org or an anonymous caller, so the write is
-- denied rather than defaulting open.
--
-- Legitimate write paths — verified unaffected
-- --------------------------------------------
-- Every membership write in the codebase was classified by client:
--   SERVICE-ROLE (BYPASSRLS — untouched by this migration):
--     onboarding.actions.ts               founder org + 'owner' membership
--     users.actions.ts                    invite / update / remove org user
--     project-members-bulk.actions.ts     invited-user membership + project row
--     sub-org-members.actions.ts          sub-org member invite (single + bulk)
--   USER SESSION (must satisfy the new policies — all do):
--     project.actions.ts:139              creator self-insert as PM. projects
--                                         INSERT is already gated to owner/admin/PM
--                                         by "PMs and above can manage projects",
--                                         so the creator always passes.
--     onboarding.actions.ts:129           createFirstProjectAction, same shape;
--                                         the caller is the org founder ('owner').
--     project-members.actions.ts          add / update-role / remove — already
--                                         gated on ORG_WRITE_ROLES of the
--                                         project's org.
--     project-members-bulk.actions.ts:187 existing-org-user add — same gate.
--     project-members-from-sub-org.ts:144 cross-org add — caller is parent-org
--                                         owner/admin/PM of the project's org.
--
-- Two user-session paths change behaviour, both deliberately:
--   1. apps/mobile/app/(auth)/invite/[token].tsx:86 self-upserts a
--      user_organisations row using role read from auth user_metadata. Every
--      invite path already creates that row SERVER-SIDE with the service client
--      before the email is sent, so the upsert is redundant on the happy path;
--      it is wrapped in try/catch with an explicit `/* ignore */`, so the newly
--      denied write is swallowed exactly as a conflict would be. It is also a
--      self-promotion vector in its own right (user_metadata is writable by the
--      user via auth.updateUser), and today it can silently OVERWRITE the
--      admin-assigned role with the metadata value — including the literal
--      'member' default in that file. Denying it is a fix, not a regression.
--   2. apps/web/src/actions/supplier.actions.ts:114 self-inserts an 'owner'
--      membership after registerSupplierAction creates an org with the user
--      session. That flow is ALREADY dead one statement earlier: the only
--      INSERT policy on public.organisations is "Parent admins can insert
--      shadow children" (WITH CHECK is_shadow = true AND parent_organisation_id
--      IS NOT NULL), and the action inserts a non-shadow org — verified on prod,
--      the INSERT is rejected with 42501. So line 114 is unreachable and this
--      migration adds no new breakage. Repairing supplier self-registration
--      means moving BOTH writes to the service client (the pattern
--      onboarding.actions.ts already documents: "Use service client to bypass
--      RLS for initial org creation (new user has no org membership yet)") —
--      tracked as a follow-up, deliberately out of scope here because it changes
--      who may create an organisation.
--
-- Deliberately NOT solved here
-- ----------------------------
--   * An org admin may still promote themselves to 'owner' via
--     user_organisations. The app treats owner+admin as one tier (OWNER_ADMIN)
--     and both administer users, so this is a tier-internal move, not an
--     escalation across a trust boundary. Narrowing role CHANGES to owners only
--     is a product decision, not a security backstop.
--   * A per-project 'project_manager' (promoted via project_members without an
--     org write role) cannot administer membership. That is intentional and
--     matches the app: project-members.actions.ts gates on requireRole (ORG
--     role), not requireEffectiveRole. It is also why this migration defines its
--     own helper instead of reusing public.user_can_manage_project — that helper
--     is slated to become promotion-aware, and a project_members policy calling
--     a function that reads project_members would additionally risk the RLS
--     recursion 00026 documents.
--
-- Reversible:
--   DROP POLICY IF EXISTS "membership_write_authz_insert" ON projects.project_members;
--   DROP POLICY IF EXISTS "membership_write_authz_update" ON projects.project_members;
--   DROP POLICY IF EXISTS "membership_write_authz_delete" ON projects.project_members;
--   DROP POLICY IF EXISTS "org_membership_write_authz_insert" ON public.user_organisations;
--   DROP POLICY IF EXISTS "org_membership_write_authz_update" ON public.user_organisations;
--   DROP POLICY IF EXISTS "org_membership_write_authz_delete" ON public.user_organisations;
--   DROP FUNCTION IF EXISTS public.user_can_manage_project_members(uuid);
--   DROP FUNCTION IF EXISTS public.user_is_org_admin(uuid);
--
-- Verified on production (2026-07-31), migration applied inside a transaction
-- that was ROLLED BACK — zero residue (membership row counts and role
-- distributions re-checked identical afterwards):
--   Exploits, as the rbac-test contractor — all now denied:
--     A1 INSERT project_members role=project_manager      ALLOWED -> 42501
--     A2 UPDATE own project_members role                  1 row   -> 0 rows
--     A3 DELETE 29 colleagues' project_members rows       29 rows -> 0 rows
--     A4 INSERT user_organisations role=owner, foreign org ALLOWED -> 42501
--     A5 UPDATE own user_organisations role -> owner      1 row   -> 0 rows
--     A6 self-insert own org membership                   ALLOWED -> 42501
--   Positive controls — all still work:
--     P1/P2/P3 org owner+admin INSERT / UPDATE / DELETE project_members
--     P7/P8    service_role INSERT on both tables (the invite flows)
--     P9       create project + creator self-inserts as PM (project.actions.ts)
--     P10/P11  contractor still READs the roster and their own membership
--     P12      get_user_org_ids() still resolves (no policy recursion)
--   Helper truth table: user_is_org_admin and user_can_manage_project_members
--   both return TRUE for owner/admin (+PM for the project helper), FALSE for a
--   contractor and FALSE across an org boundary.
--   Isolation check: with 00026's self-only permissive policies temporarily
--   replaced by a permissive-true policy (so the RESTRICTIVE layer is the sole
--   decider), an org admin's UPDATE of another member's row is ALLOWED and a
--   contractor's is BLOCKED — i.e. the new layer admits real admins rather than
--   relying on the old permissive policy to do the blocking.
--   No 42P17 (policy recursion) anywhere, despite the user_organisations
--   policies calling a helper that reads user_organisations — SECURITY DEFINER
--   + row_security=off avoids the re-entry 00026 documents.
--
-- Regression test:
--   apps/edge-functions/supabase/tests/membership_write_authz_rls_test.sql
--   (pgTAP; run via `supabase test db`).
--
-- Post-apply verification (structural — expects 6 rows, all polpermissive = false):
--   SELECT polrelid::regclass AS tbl, polname, polcmd, polpermissive
--   FROM pg_policy
--   WHERE polname LIKE '%membership_write_authz%';
--
-- ⚠ Do NOT hand-apply. deploy-migrations.yml runs `supabase db push` on merge to
--   main; hand-applying via the Management API desyncs schema_migrations.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP POLICY IF EXISTS before CREATE.
-- ---------------------------------------------------------------------------

-- ── Helpers ─────────────────────────────────────────────────────────────────
-- Both are SECURITY DEFINER with row_security off so the policies resolve the
-- caller's authority regardless of the caller's own RLS visibility of
-- projects.projects / public.user_organisations, and so the user_organisations
-- policies below cannot re-enter user_organisations' own policies (the RLS
-- recursion 00026 hit). Mirrors the house helper style
-- (user_is_client_viewer / user_effective_project_role / get_user_org_ids).

-- Authority to administer PROJECT membership: owner/admin/project_manager of the
-- org that owns the project. Deliberately reads projects.projects +
-- public.user_organisations only — never projects.project_members — so a policy
-- ON project_members can call it with no recursion risk.
CREATE OR REPLACE FUNCTION public.user_can_manage_project_members(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM projects.projects p
    JOIN public.user_organisations uo
      ON uo.organisation_id = p.organisation_id
    WHERE p.id        = p_project_id
      AND uo.user_id  = auth.uid()
      AND uo.is_active
      AND uo.role IN ('owner', 'admin', 'project_manager')
  );
$function$;

REVOKE ALL ON FUNCTION public.user_can_manage_project_members(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_manage_project_members(UUID) TO authenticated;

-- Authority to administer ORG membership: active owner/admin of that org.
-- Matches OWNER_ADMIN, the gate on users.actions.ts / /settings/users.
CREATE OR REPLACE FUNCTION public.user_is_org_admin(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_organisations
    WHERE user_id         = auth.uid()
      AND organisation_id = p_org_id
      AND is_active
      AND role IN ('owner', 'admin')
  );
$function$;

REVOKE ALL ON FUNCTION public.user_is_org_admin(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_is_org_admin(UUID) TO authenticated;

-- ── projects.project_members ────────────────────────────────────────────────
DROP POLICY IF EXISTS "membership_write_authz_insert" ON projects.project_members;
DROP POLICY IF EXISTS "membership_write_authz_update" ON projects.project_members;
DROP POLICY IF EXISTS "membership_write_authz_delete" ON projects.project_members;

CREATE POLICY "membership_write_authz_insert" ON projects.project_members
    AS RESTRICTIVE FOR INSERT TO authenticated, anon
    WITH CHECK (public.user_can_manage_project_members(project_id));

-- USING gates the row as it stands, WITH CHECK the row as it would become, so a
-- member cannot be moved onto a project the caller has no authority over (the
-- 00027 UPDATE policy had no WITH CHECK at all).
CREATE POLICY "membership_write_authz_update" ON projects.project_members
    AS RESTRICTIVE FOR UPDATE TO authenticated, anon
    USING      (public.user_can_manage_project_members(project_id))
    WITH CHECK (public.user_can_manage_project_members(project_id));

CREATE POLICY "membership_write_authz_delete" ON projects.project_members
    AS RESTRICTIVE FOR DELETE TO authenticated, anon
    USING (public.user_can_manage_project_members(project_id));

-- ── public.user_organisations ───────────────────────────────────────────────
DROP POLICY IF EXISTS "org_membership_write_authz_insert" ON public.user_organisations;
DROP POLICY IF EXISTS "org_membership_write_authz_update" ON public.user_organisations;
DROP POLICY IF EXISTS "org_membership_write_authz_delete" ON public.user_organisations;

CREATE POLICY "org_membership_write_authz_insert" ON public.user_organisations
    AS RESTRICTIVE FOR INSERT TO authenticated, anon
    WITH CHECK (public.user_is_org_admin(organisation_id));

CREATE POLICY "org_membership_write_authz_update" ON public.user_organisations
    AS RESTRICTIVE FOR UPDATE TO authenticated, anon
    USING      (public.user_is_org_admin(organisation_id))
    WITH CHECK (public.user_is_org_admin(organisation_id));

-- There is no permissive DELETE policy on user_organisations today, so session
-- deletes are already denied. This RESTRICTIVE guard is the backstop that keeps
-- them denied if one is ever added.
CREATE POLICY "org_membership_write_authz_delete" ON public.user_organisations
    AS RESTRICTIVE FOR DELETE TO authenticated, anon
    USING (public.user_is_org_admin(organisation_id));

-- Adding policies does not change the schema cache, but NOTIFY is harmless and
-- keeps parity with the project's migration conventions.
NOTIFY pgrst, 'reload schema';
