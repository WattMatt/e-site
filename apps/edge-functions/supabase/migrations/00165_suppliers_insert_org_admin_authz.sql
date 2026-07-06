-- ---------------------------------------------------------------------------
-- 00165_suppliers_insert_org_admin_authz.sql
--
-- SECURITY (over-permissive authz): give the suppliers.suppliers INSERT policy
-- a real authorization check. This is a SEPARATE, broader bug from the
-- client_viewer read-only work (00161) — it is open to ANY authenticated user,
-- not just client_viewer — and 00161 explicitly deferred it (see its header).
--
-- Root cause
-- ----------
-- The policy "Org admins can insert suppliers" (00027) has `WITH CHECK (TRUE)`
-- with the note "supplier creation is handled by service role in practice".
-- But the authenticated role holds an INSERT grant on the suppliers schema
-- (00025), so RLS is the ONLY gate — and WITH CHECK (TRUE) is no gate at all.
-- Any authenticated user (including a client_viewer or a plain contractor) can
-- INSERT an arbitrary supplier row. Because "Anyone can view active suppliers"
-- (00009) exposes every is_active row to all authenticated users, an injected
-- row is globally visible cross-org, not merely a local-integrity problem.
--
-- Intended authorization (what the policy NAME already promises)
-- --------------------------------------------------------------
-- An owner/admin, ACTIVE in the row's organisation, may create a supplier
-- SCOPED to that organisation. External suppliers (organisation_id IS NULL)
-- remain service-role-only: service_role bypasses RLS, so the documented
-- "handled by service role in practice" path is unaffected. A NULL org fails
-- the membership check below (NULL IN (...) is never TRUE), so authenticated
-- users cannot mint global/external suppliers — exactly the desired split.
--
-- Pattern: the `organisation_id IN (SELECT ... user_organisations ... role IN
-- ('owner','admin') ...)` form is the house idiom for org-admin writes
-- (cf. 00009 "Admins can manage org memberships", 00027 "Contractors can create
-- order items"). role IN ('owner','admin') already excludes client_viewer.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Org admins can insert suppliers" ON suppliers.suppliers;
CREATE POLICY "Org admins can insert suppliers"
    ON suppliers.suppliers FOR INSERT TO authenticated
    WITH CHECK (
        organisation_id IN (
            SELECT uo.organisation_id
            FROM public.user_organisations uo
            WHERE uo.user_id = auth.uid()
              AND uo.role IN ('owner', 'admin')
              AND uo.is_active = TRUE
        )
    );

-- ── Defense-in-depth: client_viewer never writes suppliers ──────────────────
-- The permissive policy above already blocks client_viewer (they are not
-- owner/admin). This RESTRICTIVE guard is AND-combined, so it holds the
-- "client_viewer is read-only" invariant even if a future permissive policy
-- re-opens this table — matching the 00161 pattern. INSERT is the only live
-- write surface today (no permissive UPDATE/DELETE policy exists on this
-- table); UPDATE/DELETE guards are added for parity so the invariant is
-- complete if such policies are ever introduced.
--
-- Helper: public.user_is_client_viewer(org_id) — SECURITY DEFINER, STABLE,
-- true iff the caller is a client_viewer in that org (00034). For an external
-- supplier (organisation_id IS NULL) it returns FALSE, so this guard never
-- fights the permissive policy, which already blocks the NULL-org case.
DROP POLICY IF EXISTS "client_viewer_no_insert" ON suppliers.suppliers;
DROP POLICY IF EXISTS "client_viewer_no_update" ON suppliers.suppliers;
DROP POLICY IF EXISTS "client_viewer_no_delete" ON suppliers.suppliers;

CREATE POLICY "client_viewer_no_insert" ON suppliers.suppliers
    AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (NOT public.user_is_client_viewer(organisation_id));

CREATE POLICY "client_viewer_no_update" ON suppliers.suppliers
    AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (NOT public.user_is_client_viewer(organisation_id))
    WITH CHECK (NOT public.user_is_client_viewer(organisation_id));

CREATE POLICY "client_viewer_no_delete" ON suppliers.suppliers
    AS RESTRICTIVE FOR DELETE TO authenticated
    USING (NOT public.user_is_client_viewer(organisation_id));
