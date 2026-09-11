-- ---------------------------------------------------------------------------
-- Migration 00193: cable_schedule — RESTRICTIVE write-role gate on the core
--                  schedule tables (the 00192 pattern, applied backwards)
-- ---------------------------------------------------------------------------
-- WHY.
--
-- Every cable-schedule server action gates writes on ORG_WRITE_ROLES —
-- owner / admin / project_manager — via
-- `requireRoleForRevision(supabase, revisionId, ROLES_ENGINEER)`
-- (apps/web/src/lib/cable-schedule/require-role.ts, where ROLES_ENGINEER and
-- ROLES_ENGINEER_AND_FIELD are both aliases of ORG_WRITE_ROLES). Every role
-- outside that set maps to `Viewer` in ROLE_CAPS
-- (apps/web/src/lib/cable-schedule/roles.ts) with every capability false, so
-- the application permits a contractor / inspector / supplier no write at all.
--
-- The TABLE policies from 00051 are far looser. `sup_write`, `cab_write`,
-- `src_write`, `cl_write`, `trm_write`, `tag_write`, `chg_write` and
-- `rev_write_org_members` all carry the same predicate:
--
--     organisation_id = ANY(public.get_user_org_ids())
--     AND NOT public.user_is_client_viewer(organisation_id)
--
-- — a membership test, not an authorisation test. `cable_schedule` is a
-- PostgREST-exposed schema and `authenticated` holds INSERT / UPDATE / DELETE
-- on all of these tables, so an authenticated session can POST straight past
-- the application. Page and action gating is not a gate when the table policy
-- is wider.
--
-- DEMONSTRATED ON PRODUCTION, 2026-09-11, inside rolled-back transactions, as
-- the `rbac-test` fixture (018f2d31-bbe8-4cc1-bbdd-63af0187081e — org role
-- `contractor` on WM-Consulting), impersonating exactly as PostgREST does
-- (`SET LOCAL ROLE authenticated` + a `request.jwt.claims` sub):
--
--   cables      UPDATE  measured_length_m 63 -> 1062 on the live KINGSWALK
--                       DRAFT revision 51506e03            1 row
--   cables      DELETE                                     1 row
--   supplies    UPDATE  notes / design_load_a              1 row
--   supplies    INSERT  (clone of a live row)              1 row
--   sources     UPDATE  code -> 'PWNED', rating_kva -> 1   1 row
--   cost_lines  UPDATE  supply_rate / install_rate -> 1    1 row
--   cost_lines  DELETE  every rate line on the revision   13 rows
--   cable_tags  UPDATE  tag_text -> 'PWNED'                1 row
--   cable_tags  DELETE  every tag in the database         74 rows
--   terminations INSERT                                    1 row
--   change_log  INSERT  a forged audit entry               1 row
--   change_log  DELETE  the audit trail of a revision    729 rows
--   revisions   UPDATE  status DRAFT -> ISSUED             1 row
--   revisions   DELETE  -> cascade wiped 6 cables + 6 supplies
--
-- Production was unchanged: 13 revisions / 545 cables / 400 supplies / 729
-- change_log rows / 0 terminations read back identical afterwards.
--
-- SCOPE — why this migration covers more than the six obvious tables.
--
-- `revisions` and `change_log` are included because gating only the six leaf
-- tables does not close the hole:
--
--   * A referential-integrity CASCADE bypasses row security on the child
--     table — the RI triggers are not subject to RLS. One
--     `DELETE FROM cable_schedule.revisions` therefore destroys every
--     supply, cable, source, cost line, termination, tag and change-log row
--     under it regardless of what the child policies say. This was measured,
--     not assumed: 6 cables -> 0 and 6 supplies -> 0 from a single contractor
--     DELETE of a revision.
--   * `UPDATE revisions SET status='ISSUED'` lets a contractor freeze a live
--     design permanently — after which 00168's freeze triggers block the
--     legitimate engineer from editing it.
--   * `change_log` is the audit trail OF these tables. Leaving it writable
--     means the record of tampering is both forgeable and erasable.
--
-- `cable_schedule.boards` is NOT covered because it no longer exists —
-- supplies reference `structure.nodes` via from_node_id / to_node_id now.
--
-- NOT IN SCOPE, same class, deliberately left for their own change: the MV
-- module tables (`fault_sources`, `fault_results`, `protection_devices`,
-- `discrimination_checks`, `mv_study_settings`, `mv_study_signoff`) and
-- `sans_overrides` carry the identical 00051 predicate. The two MV tables
-- with a RESTRICTIVE overlay (00191) gate the paid ENTITLEMENT, not role.
--
-- WHY THE PREDICATE IS KEYED ON THE PARENT, NOT ON organisation_id.
--
-- 00192 keys its RESTRICTIVE policies on the row's own `organisation_id` and
-- says why that is safe there: "organisation_id is safe to key on here
-- because the BEFORE triggers in §3 derive it from the parent, so it is the
-- revision's org and not the client's claim by the time these WITH CHECKs
-- run." These tables have no such binding trigger, so on an INSERT
-- `organisation_id` is whatever the client sent. A gate that can be satisfied
-- by choosing its own input is not a gate, so each policy resolves the org
-- from the row's PARENT instead — the same reasoning, one hop further back.
-- This is also the established house pattern: 00177's
-- `public.user_can_manage_project_members(project_id)` is keyed on the
-- project "not the row's organisation_id" for exactly this reason.
--
-- Verified first that the two are identical for every row that exists: 0
-- mismatches between child `organisation_id` and parent `organisation_id`
-- across supplies (400), cables (545), sources, cost_lines, change_log
-- (1,150), terminations, cable_tags (74) and revisions (13), and 0 cables
-- whose revision_id disagrees with their supply's. So no existing row changes
-- behaviour. ⚠ That invariant has never been stressed cross-org — production
-- has exactly ONE organisation holding cable schedules — so treat it as
-- evidence that nothing breaks, not as evidence the column was trustworthy.
--
-- ROLE SEMANTICS — org role, matching 00192 and the 20-odd server actions.
--
-- `cable_schedule.user_can_edit_schedule(uuid)` (00192) reads
-- `public.user_organisations` for owner/admin/project_manager. TWO write
-- paths instead gate on the PROJECT-effective role
-- (`public.user_effective_project_role`, which falls back to
-- `projects.project_members.role` when the org role is narrower):
--
--   * POST /api/cable-schedule/commit  (requireEffectiveRole, ORG_WRITE_ROLES)
--   * overrideFaultLevel               (mv-protection.actions.ts, same gate)
--
-- Measured on production: ZERO users hold a `project_members` row of
-- owner/admin/project_manager while holding a narrower org role, across 47
-- active project memberships (22 of them project_manager) and 31 active org
-- memberships. So the two gates select the same people today. Should such a
-- user ever be created, those two paths fail CLOSED at the database with a
-- 42501 while the app gate says yes — the safe direction, and the reason the
-- org-level anchor was chosen: authorising a schedule write off
-- `project_members.role` would re-open the self-promotion class 00177 closed.
--
-- markTagsPrintedAction IS NOT AFFECTED.
--
-- Its gate is ROLES_ENGINEER_AND_FIELD, an alias of ORG_WRITE_ROLES, so it
-- passes `user_can_edit_schedule`. Its right to write `printed` /
-- `printed_at` / `printed_by` on an ISSUED revision comes from the exemption
-- inside 00168 §3c's `enforce_cable_child_frozen()` TRIGGER, which this
-- migration does not touch. Policies and triggers are independent gates; the
-- printed-bookkeeping path must satisfy both, and does.
--
-- SELECT IS UNTOUCHED.
--
-- Every policy below is scoped to INSERT / UPDATE / DELETE. A RESTRICTIVE
-- `FOR ALL` would also restrict SELECT and would silently cut off both the
-- project-scoped `client_viewer` read that `*_select` allows and the
-- "Project members can view … (cross-org)" policies that exist on all eight
-- tables in production.
--
-- Reversible:
--   DROP POLICY sup_write_authz_insert ON cable_schedule.supplies;  -- etc,
--   24 policies across 8 tables, then
--   DROP FUNCTION cable_schedule.user_can_edit_revision(UUID);
--   DROP FUNCTION cable_schedule.user_can_edit_cable(UUID);
--   DROP FUNCTION cable_schedule.user_can_edit_project(UUID);
--
-- No new schema and no new table, so a NOTIFY is enough; no Management-API
-- PostgREST db_schema PATCH is required.
--
-- @verify:begin
-- function: cable_schedule.user_can_edit_revision(uuid)
-- function: cable_schedule.user_can_edit_cable(uuid)
-- function: cable_schedule.user_can_edit_project(uuid)
-- policy: sup_write_authz_insert ON cable_schedule.supplies      -- RESTRICTIVE
-- policy: sup_write_authz_update ON cable_schedule.supplies      -- RESTRICTIVE
-- policy: sup_write_authz_delete ON cable_schedule.supplies      -- RESTRICTIVE
-- policy: cab_write_authz_insert ON cable_schedule.cables        -- RESTRICTIVE
-- policy: cab_write_authz_update ON cable_schedule.cables        -- RESTRICTIVE
-- policy: cab_write_authz_delete ON cable_schedule.cables        -- RESTRICTIVE
-- policy: src_write_authz_insert ON cable_schedule.sources       -- RESTRICTIVE
-- policy: src_write_authz_update ON cable_schedule.sources       -- RESTRICTIVE
-- policy: src_write_authz_delete ON cable_schedule.sources       -- RESTRICTIVE
-- policy: cl_write_authz_insert  ON cable_schedule.cost_lines    -- RESTRICTIVE
-- policy: cl_write_authz_update  ON cable_schedule.cost_lines    -- RESTRICTIVE
-- policy: cl_write_authz_delete  ON cable_schedule.cost_lines    -- RESTRICTIVE
-- policy: trm_write_authz_insert ON cable_schedule.terminations  -- RESTRICTIVE
-- policy: trm_write_authz_update ON cable_schedule.terminations  -- RESTRICTIVE
-- policy: trm_write_authz_delete ON cable_schedule.terminations  -- RESTRICTIVE
-- policy: tag_write_authz_insert ON cable_schedule.cable_tags    -- RESTRICTIVE
-- policy: tag_write_authz_update ON cable_schedule.cable_tags    -- RESTRICTIVE
-- policy: tag_write_authz_delete ON cable_schedule.cable_tags    -- RESTRICTIVE
-- policy: rev_write_authz_insert ON cable_schedule.revisions     -- RESTRICTIVE
-- policy: rev_write_authz_update ON cable_schedule.revisions     -- RESTRICTIVE
-- policy: rev_write_authz_delete ON cable_schedule.revisions     -- RESTRICTIVE
-- policy: chg_write_authz_insert ON cable_schedule.change_log    -- RESTRICTIVE
-- policy: chg_write_authz_update ON cable_schedule.change_log    -- RESTRICTIVE
-- policy: chg_write_authz_delete ON cable_schedule.change_log    -- RESTRICTIVE
-- grant_present: authenticated EXECUTE ON cable_schedule.user_can_edit_revision(uuid)
-- grant_present: authenticated EXECUTE ON cable_schedule.user_can_edit_cable(uuid)
-- grant_present: authenticated EXECUTE ON cable_schedule.user_can_edit_project(uuid)
-- grant_absent: anon EXECUTE ON cable_schedule.user_can_edit_revision(uuid)
-- grant_absent: anon EXECUTE ON cable_schedule.user_can_edit_cable(uuid)
-- grant_absent: anon EXECUTE ON cable_schedule.user_can_edit_project(uuid)
--   (all three via has_function_privilege('anon', oid, 'EXECUTE') = false,
--    never by reading proacl — a NULL proacl looks empty but IS the PUBLIC
--    grant; this keeps 00186's anon-EXECUTE sweep true for cable_schedule)
-- unchanged: SELECT policies on all 8 tables (count and definition)
-- behaviour: contractor INSERT/UPDATE/DELETE on any of the 8 tables -> denied
-- behaviour: org admin INSERT/UPDATE/DELETE on the same rows -> still allowed
-- behaviour: contractor SELECT on cables/supplies -> still allowed (unchanged)
-- behaviour: markTagsPrintedAction-shaped UPDATE on an ISSUED revision's tag,
--            as an org admin -> still allowed (00168 §3c exemption intact)
-- @verify:end
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. Parent-resolving write-authority helpers
-- ===========================================================================
-- Each resolves the owning organisation from the row's PARENT and defers to
-- `cable_schedule.user_can_edit_schedule` (00192) for the role decision, so
-- there is exactly ONE definition of "may edit a cable schedule" in this
-- schema and these three only decide WHOSE schedule the row belongs to.
--
-- SECURITY DEFINER with `row_security = off` so the parent lookup does not
-- depend on the caller's own visibility of the parent table — a policy that
-- silently loosened or tightened with the caller's read grants would be very
-- hard to reason about.
--
-- `search_path = ''` forces full qualification everywhere. Each returns FALSE
-- rather than NULL when the parent is missing (an EXISTS over no rows is
-- FALSE, and `user_can_edit_schedule(NULL)` is FALSE for the same reason), so
-- they are safe inside a RESTRICTIVE USING clause — the trap 00183 hit, where
-- `NULL IN (…)` read as "no row" rather than "denied".

CREATE OR REPLACE FUNCTION cable_schedule.user_can_edit_revision(p_revision_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'off'
AS $function$
  SELECT cable_schedule.user_can_edit_schedule(
    (SELECT r.organisation_id
       FROM cable_schedule.revisions r
      WHERE r.id = p_revision_id)
  );
$function$;

COMMENT ON FUNCTION cable_schedule.user_can_edit_revision(UUID) IS
'TRUE when the caller may edit the cable schedule the given revision belongs to — i.e. holds an active owner / admin / project_manager role in the REVISION''s organisation. Keyed on the revision rather than on the row''s own organisation_id column, which is client-supplied on INSERT and bound by no trigger on the 00051 tables. FALSE, never NULL, for an unknown revision.';

CREATE OR REPLACE FUNCTION cable_schedule.user_can_edit_cable(p_cable_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'off'
AS $function$
  SELECT cable_schedule.user_can_edit_schedule(
    (SELECT r.organisation_id
       FROM cable_schedule.cables c
       JOIN cable_schedule.revisions r ON r.id = c.revision_id
      WHERE c.id = p_cable_id)
  );
$function$;

COMMENT ON FUNCTION cable_schedule.user_can_edit_cable(UUID) IS
'Sibling of user_can_edit_revision for terminations and cable_tags, which reach a revision only through their cable. Roots at revisions.organisation_id — two hops — so every policy in this family resolves authority from the same place. FALSE, never NULL, for an unknown cable.';

CREATE OR REPLACE FUNCTION cable_schedule.user_can_edit_project(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'off'
AS $function$
  SELECT cable_schedule.user_can_edit_schedule(
    (SELECT p.organisation_id
       FROM projects.projects p
      WHERE p.id = p_project_id)
  );
$function$;

COMMENT ON FUNCTION cable_schedule.user_can_edit_project(UUID) IS
'For cable_schedule.revisions itself, whose parent is the project. Note this is the PROJECT''s organisation, not the caller''s claimed one, and not projects.project_members — a project-scoped project_manager promotion does not grant schedule-write authority at the database (see 00177). FALSE, never NULL, for an unknown project.';

-- Supabase's bootstrap ALTER DEFAULT PRIVILEGES grants `anon` EXECUTE DIRECTLY
-- at creation time in some schemas, which is a SEPARATE grant that
-- `REVOKE … FROM PUBLIC` does not touch (the 00162 finding; 00186 then swept
-- the whole database). `cable_schedule` has no function default ACL naming
-- anon, but name it explicitly anyway so the guarantee does not depend on that
-- staying true. Verify with has_function_privilege('anon', oid, 'EXECUTE'),
-- never by reading proacl.
REVOKE ALL ON FUNCTION cable_schedule.user_can_edit_revision(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION cable_schedule.user_can_edit_cable(UUID)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION cable_schedule.user_can_edit_project(UUID)  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION cable_schedule.user_can_edit_revision(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION cable_schedule.user_can_edit_cable(UUID)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION cable_schedule.user_can_edit_project(UUID)  TO authenticated, service_role;

-- ===========================================================================
-- 2. RESTRICTIVE write gate — the six core schedule tables
-- ===========================================================================
-- RESTRICTIVE policies AND with the permissive ones, so the 00051 family is
-- left in place untouched: a caller must satisfy both. That also means a
-- future permissive policy copied onto one of these tables cannot reopen the
-- role gate.
--
-- `TO authenticated, anon` matches 00177 / 00192. `anon` holds no table grant
-- here (00168 revoked them; re-verified 2026-09-11 — SELECT/INSERT/UPDATE/
-- DELETE all false on all eight tables) so naming it is belt-and-braces; it
-- deliberately does NOT name `postgres` or `service_role`, whose migration and
-- service-client writes must stay unaffected.

-- ── supplies ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "sup_write_authz_insert" ON cable_schedule.supplies;
DROP POLICY IF EXISTS "sup_write_authz_update" ON cable_schedule.supplies;
DROP POLICY IF EXISTS "sup_write_authz_delete" ON cable_schedule.supplies;

CREATE POLICY "sup_write_authz_insert" ON cable_schedule.supplies
    AS RESTRICTIVE FOR INSERT TO authenticated, anon
    WITH CHECK (cable_schedule.user_can_edit_revision(revision_id));

CREATE POLICY "sup_write_authz_update" ON cable_schedule.supplies
    AS RESTRICTIVE FOR UPDATE TO authenticated, anon
    USING      (cable_schedule.user_can_edit_revision(revision_id))
    WITH CHECK (cable_schedule.user_can_edit_revision(revision_id));

CREATE POLICY "sup_write_authz_delete" ON cable_schedule.supplies
    AS RESTRICTIVE FOR DELETE TO authenticated, anon
    USING (cable_schedule.user_can_edit_revision(revision_id));

-- ── cables ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cab_write_authz_insert" ON cable_schedule.cables;
DROP POLICY IF EXISTS "cab_write_authz_update" ON cable_schedule.cables;
DROP POLICY IF EXISTS "cab_write_authz_delete" ON cable_schedule.cables;

CREATE POLICY "cab_write_authz_insert" ON cable_schedule.cables
    AS RESTRICTIVE FOR INSERT TO authenticated, anon
    WITH CHECK (cable_schedule.user_can_edit_revision(revision_id));

CREATE POLICY "cab_write_authz_update" ON cable_schedule.cables
    AS RESTRICTIVE FOR UPDATE TO authenticated, anon
    USING      (cable_schedule.user_can_edit_revision(revision_id))
    WITH CHECK (cable_schedule.user_can_edit_revision(revision_id));

CREATE POLICY "cab_write_authz_delete" ON cable_schedule.cables
    AS RESTRICTIVE FOR DELETE TO authenticated, anon
    USING (cable_schedule.user_can_edit_revision(revision_id));

-- ── sources ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "src_write_authz_insert" ON cable_schedule.sources;
DROP POLICY IF EXISTS "src_write_authz_update" ON cable_schedule.sources;
DROP POLICY IF EXISTS "src_write_authz_delete" ON cable_schedule.sources;

CREATE POLICY "src_write_authz_insert" ON cable_schedule.sources
    AS RESTRICTIVE FOR INSERT TO authenticated, anon
    WITH CHECK (cable_schedule.user_can_edit_revision(revision_id));

CREATE POLICY "src_write_authz_update" ON cable_schedule.sources
    AS RESTRICTIVE FOR UPDATE TO authenticated, anon
    USING      (cable_schedule.user_can_edit_revision(revision_id))
    WITH CHECK (cable_schedule.user_can_edit_revision(revision_id));

CREATE POLICY "src_write_authz_delete" ON cable_schedule.sources
    AS RESTRICTIVE FOR DELETE TO authenticated, anon
    USING (cable_schedule.user_can_edit_revision(revision_id));

-- ── cost_lines ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cl_write_authz_insert" ON cable_schedule.cost_lines;
DROP POLICY IF EXISTS "cl_write_authz_update" ON cable_schedule.cost_lines;
DROP POLICY IF EXISTS "cl_write_authz_delete" ON cable_schedule.cost_lines;

CREATE POLICY "cl_write_authz_insert" ON cable_schedule.cost_lines
    AS RESTRICTIVE FOR INSERT TO authenticated, anon
    WITH CHECK (cable_schedule.user_can_edit_revision(revision_id));

CREATE POLICY "cl_write_authz_update" ON cable_schedule.cost_lines
    AS RESTRICTIVE FOR UPDATE TO authenticated, anon
    USING      (cable_schedule.user_can_edit_revision(revision_id))
    WITH CHECK (cable_schedule.user_can_edit_revision(revision_id));

CREATE POLICY "cl_write_authz_delete" ON cable_schedule.cost_lines
    AS RESTRICTIVE FOR DELETE TO authenticated, anon
    USING (cable_schedule.user_can_edit_revision(revision_id));

-- ── terminations (reaches the revision through its cable) ──────────────────
DROP POLICY IF EXISTS "trm_write_authz_insert" ON cable_schedule.terminations;
DROP POLICY IF EXISTS "trm_write_authz_update" ON cable_schedule.terminations;
DROP POLICY IF EXISTS "trm_write_authz_delete" ON cable_schedule.terminations;

CREATE POLICY "trm_write_authz_insert" ON cable_schedule.terminations
    AS RESTRICTIVE FOR INSERT TO authenticated, anon
    WITH CHECK (cable_schedule.user_can_edit_cable(cable_id));

CREATE POLICY "trm_write_authz_update" ON cable_schedule.terminations
    AS RESTRICTIVE FOR UPDATE TO authenticated, anon
    USING      (cable_schedule.user_can_edit_cable(cable_id))
    WITH CHECK (cable_schedule.user_can_edit_cable(cable_id));

CREATE POLICY "trm_write_authz_delete" ON cable_schedule.terminations
    AS RESTRICTIVE FOR DELETE TO authenticated, anon
    USING (cable_schedule.user_can_edit_cable(cable_id));

-- ── cable_tags (reaches the revision through its cable) ────────────────────
-- markTagsPrintedAction is an org admin / PM writing printed / printed_at /
-- printed_by on an ISSUED revision's tag. It satisfies this UPDATE policy on
-- the role axis, and 00168 §3c's trigger exemption on the frozen-revision
-- axis. Both gates still hold; neither is touched here.
DROP POLICY IF EXISTS "tag_write_authz_insert" ON cable_schedule.cable_tags;
DROP POLICY IF EXISTS "tag_write_authz_update" ON cable_schedule.cable_tags;
DROP POLICY IF EXISTS "tag_write_authz_delete" ON cable_schedule.cable_tags;

CREATE POLICY "tag_write_authz_insert" ON cable_schedule.cable_tags
    AS RESTRICTIVE FOR INSERT TO authenticated, anon
    WITH CHECK (cable_schedule.user_can_edit_cable(cable_id));

CREATE POLICY "tag_write_authz_update" ON cable_schedule.cable_tags
    AS RESTRICTIVE FOR UPDATE TO authenticated, anon
    USING      (cable_schedule.user_can_edit_cable(cable_id))
    WITH CHECK (cable_schedule.user_can_edit_cable(cable_id));

CREATE POLICY "tag_write_authz_delete" ON cable_schedule.cable_tags
    AS RESTRICTIVE FOR DELETE TO authenticated, anon
    USING (cable_schedule.user_can_edit_cable(cable_id));

-- ===========================================================================
-- 3. RESTRICTIVE write gate — revisions and change_log
-- ===========================================================================
-- Without these two, §2 is decorative: `DELETE FROM cable_schedule.revisions`
-- takes every §2 row with it through ON DELETE CASCADE, and referential-
-- integrity cascades are not subject to row security on the child table.
-- See the SCOPE note in the header for the measured proof.

-- ── revisions (parent is the project) ──────────────────────────────────────
DROP POLICY IF EXISTS "rev_write_authz_insert" ON cable_schedule.revisions;
DROP POLICY IF EXISTS "rev_write_authz_update" ON cable_schedule.revisions;
DROP POLICY IF EXISTS "rev_write_authz_delete" ON cable_schedule.revisions;

CREATE POLICY "rev_write_authz_insert" ON cable_schedule.revisions
    AS RESTRICTIVE FOR INSERT TO authenticated, anon
    WITH CHECK (cable_schedule.user_can_edit_project(project_id));

CREATE POLICY "rev_write_authz_update" ON cable_schedule.revisions
    AS RESTRICTIVE FOR UPDATE TO authenticated, anon
    USING      (cable_schedule.user_can_edit_project(project_id))
    WITH CHECK (cable_schedule.user_can_edit_project(project_id));

CREATE POLICY "rev_write_authz_delete" ON cable_schedule.revisions
    AS RESTRICTIVE FOR DELETE TO authenticated, anon
    USING (cable_schedule.user_can_edit_project(project_id));

-- ── change_log ─────────────────────────────────────────────────────────────
-- Gated to the same role set rather than made append-only, so this schema has
-- ONE rule. Note that no application code DELETEs change_log directly: rows
-- only ever disappear through the revision cascade, which RLS does not see. A
-- stricter append-only stance (deny DELETE/UPDATE to every end-user role) is a
-- reasonable follow-up but is a behaviour change, not a role gate.
DROP POLICY IF EXISTS "chg_write_authz_insert" ON cable_schedule.change_log;
DROP POLICY IF EXISTS "chg_write_authz_update" ON cable_schedule.change_log;
DROP POLICY IF EXISTS "chg_write_authz_delete" ON cable_schedule.change_log;

CREATE POLICY "chg_write_authz_insert" ON cable_schedule.change_log
    AS RESTRICTIVE FOR INSERT TO authenticated, anon
    WITH CHECK (cable_schedule.user_can_edit_revision(revision_id));

CREATE POLICY "chg_write_authz_update" ON cable_schedule.change_log
    AS RESTRICTIVE FOR UPDATE TO authenticated, anon
    USING      (cable_schedule.user_can_edit_revision(revision_id))
    WITH CHECK (cable_schedule.user_can_edit_revision(revision_id));

CREATE POLICY "chg_write_authz_delete" ON cable_schedule.change_log
    AS RESTRICTIVE FOR DELETE TO authenticated, anon
    USING (cable_schedule.user_can_edit_revision(revision_id));

-- ===========================================================================
-- 4. Reload PostgREST's schema cache
-- ===========================================================================
NOTIFY pgrst, 'reload schema';
