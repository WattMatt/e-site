-- ---------------------------------------------------------------------------
-- Migration 00206: split 00205's markup policies by verb
-- ---------------------------------------------------------------------------
-- WHY. `00205` shipped its write gate as ONE policy:
--
--     CREATE POLICY floor_plan_markups_write_authz ... AS RESTRICTIVE FOR ALL
--
-- `FOR ALL` includes SELECT. A RESTRICTIVE policy narrows EVERY verb it
-- covers, so the role set intended to gate writing was silently gating
-- reading too, and an `inspector` or `supplier` on the project could not see a
-- saved markup at all. `docs/rbac-matrix.md` said they could. The migration and
-- the documentation disagreed, and the migration was wrong.
--
-- HOW IT WAS FOUND, because the method matters more than the defect. 00205's
-- assertions checked that the policy EXISTED and that `polpermissive = false`.
-- Both were true. Neither says anything about who the policy lets through: the
-- whole 00051 family of gaps were policies that existed and authorised
-- nothing. `scripts/db/assert-floor-plan-markups-roles.sql` impersonates real
-- production users and asserts what each can actually DO, and it went red on
-- the first run with "inspector may still read" — a claim no structural check
-- in the original file was capable of testing.
--
-- THE SECOND DEFECT, which the first was masking. 00205's PERMISSIVE half was
-- also `FOR ALL`:
--
--     CREATE POLICY floor_plan_markups_write ... FOR ALL
--         USING (public.user_has_project_access(project_id))
--
-- and `user_has_project_access` is TRUE for a `client_viewer` who is a project
-- member. Permissive policies OR together, so that USING clause was a second
-- read path with no client-viewer exclusion. It was inert only because the
-- RESTRICTIVE `FOR ALL` refused them anyway. Narrowing just the restrictive
-- half would therefore have OPENED markup reads to client viewers while
-- appearing to be a pure relaxation. Both halves are split by verb here, so
-- SELECT is governed by exactly one policy and that policy is the one that
-- carries the exclusion.
--
-- SHAPE. Three permissive write policies + three RESTRICTIVE write policies,
-- the `hist_write_authz_*` shape from `00200`. No data changes; production
-- holds 0 markups.
--
-- WHAT THE FOUR sql: DIRECTIVES BELOW PIN, since a policy name alone says
-- nothing about which verbs it covers:
--   1. 00205's two FOR ALL policies must be GONE, not merely superseded. Left
--      in place they would keep narrowing SELECT and this migration would be a
--      no-op that reads as a fix.
--   2. EXACTLY ONE policy may cover SELECT. polcmd 'r' is SELECT and '*' is
--      FOR ALL; if either write policy ever goes back to FOR ALL, this count
--      moves off 1 and the deploy says so.
--   3. That one policy must be the one carrying the client-viewer exclusion.
--   4. Every RESTRICTIVE policy left on the table must be a write verb
--      ('a' INSERT, 'w' UPDATE, 'd' DELETE). A restrictive policy on 'r' or
--      '*' IS the defect this migration exists to remove.
-- ---------------------------------------------------------------------------

-- @verify:begin
-- policy: floor_plan_markups_select ON tenants.floor_plan_markups PERMISSIVE
-- policy: floor_plan_markups_insert ON tenants.floor_plan_markups PERMISSIVE
-- policy: floor_plan_markups_update ON tenants.floor_plan_markups PERMISSIVE
-- policy: floor_plan_markups_delete ON tenants.floor_plan_markups PERMISSIVE
-- policy: floor_plan_markups_insert_authz ON tenants.floor_plan_markups RESTRICTIVE
-- policy: floor_plan_markups_update_authz ON tenants.floor_plan_markups RESTRICTIVE
-- policy: floor_plan_markups_delete_authz ON tenants.floor_plan_markups RESTRICTIVE
-- sql: (SELECT count(*) = 0 FROM pg_policy WHERE polrelid = 'tenants.floor_plan_markups'::regclass AND polname IN ('floor_plan_markups_write', 'floor_plan_markups_write_authz'))
-- sql: (SELECT count(*) = 1 FROM pg_policy WHERE polrelid = 'tenants.floor_plan_markups'::regclass AND polcmd IN ('r', '*'))
-- sql: (SELECT pg_get_expr(polqual, polrelid) LIKE '%client_viewer%' FROM pg_policy WHERE polrelid = 'tenants.floor_plan_markups'::regclass AND polcmd IN ('r', '*'))
-- sql: (SELECT count(*) = 0 FROM pg_policy WHERE polrelid = 'tenants.floor_plan_markups'::regclass AND polpermissive = false AND polcmd NOT IN ('a', 'w', 'd'))
-- @verify:end

-- ── The FOR ALL pair, removed ────────────────────────────────────────────────

DROP POLICY IF EXISTS floor_plan_markups_write       ON tenants.floor_plan_markups;
DROP POLICY IF EXISTS floor_plan_markups_write_authz ON tenants.floor_plan_markups;

-- ── Permissive half: membership, write verbs only ───────────────────────────
-- On its own this is a membership test and NOT an authorisation test. It is
-- paired with the RESTRICTIVE gates below and both must pass.

DROP POLICY IF EXISTS floor_plan_markups_insert ON tenants.floor_plan_markups;
CREATE POLICY floor_plan_markups_insert ON tenants.floor_plan_markups FOR INSERT
    TO authenticated
    WITH CHECK (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS floor_plan_markups_update ON tenants.floor_plan_markups;
CREATE POLICY floor_plan_markups_update ON tenants.floor_plan_markups FOR UPDATE
    TO authenticated
    USING      (public.user_has_project_access(project_id))
    WITH CHECK (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS floor_plan_markups_delete ON tenants.floor_plan_markups;
CREATE POLICY floor_plan_markups_delete ON tenants.floor_plan_markups FOR DELETE
    TO authenticated
    USING (public.user_has_project_access(project_id));

-- ── Restrictive half: the role gate, write verbs only ───────────────────────
-- MARKUP_WRITE_ROLES in @esite/shared. COALESCE because
-- user_effective_project_role returns NULL for a non-member and `NULL IN (...)`
-- is NULL, not FALSE (00183).

DROP POLICY IF EXISTS floor_plan_markups_insert_authz ON tenants.floor_plan_markups;
CREATE POLICY floor_plan_markups_insert_authz ON tenants.floor_plan_markups
    AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (
        COALESCE(public.user_effective_project_role(project_id), '')
            IN ('owner', 'admin', 'project_manager', 'contractor')
    );

DROP POLICY IF EXISTS floor_plan_markups_update_authz ON tenants.floor_plan_markups;
CREATE POLICY floor_plan_markups_update_authz ON tenants.floor_plan_markups
    AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (
        COALESCE(public.user_effective_project_role(project_id), '')
            IN ('owner', 'admin', 'project_manager', 'contractor')
    )
    WITH CHECK (
        COALESCE(public.user_effective_project_role(project_id), '')
            IN ('owner', 'admin', 'project_manager', 'contractor')
    );

DROP POLICY IF EXISTS floor_plan_markups_delete_authz ON tenants.floor_plan_markups;
CREATE POLICY floor_plan_markups_delete_authz ON tenants.floor_plan_markups
    AS RESTRICTIVE FOR DELETE TO authenticated
    USING (
        COALESCE(public.user_effective_project_role(project_id), '')
            IN ('owner', 'admin', 'project_manager', 'contractor')
    );

COMMENT ON TABLE tenants.floor_plan_markups IS
'One named, reopenable markup layer on one drawing, shared within the project. This is the object the product was missing: before it, a markup could only be stored as an RFI attachment (rfi_annotations is rfi_id NOT NULL), so "save my work on this drawing" had nowhere to live and the only Save button said "Attach to RFI".

READ and WRITE are deliberately different sets. Reading is open to everyone on the project EXCEPT a client viewer, because an inspector who can already see the drawing, its RFI markups and its snag pins gains nothing from being blocked here. Writing is MARKUP_WRITE_ROLES. 00205 expressed the write gate as a single RESTRICTIVE FOR ALL policy, which narrowed reading to the write set as a side effect; 00206 splits both halves by verb so exactly one policy governs SELECT.';

NOTIFY pgrst, 'reload schema';
