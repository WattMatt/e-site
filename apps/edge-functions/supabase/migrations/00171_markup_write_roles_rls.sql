-- ---------------------------------------------------------------------------
-- 00171_markup_write_roles_rls.sql
--
-- SECURITY (defense-in-depth / authz gap): enforce MARKUP_WRITE_ROLES on
-- public.rfi_annotations writes at the DATABASE layer, so the boundary holds
-- across EVERY write path uniformly:
--   * the gated server actions (apps/web/src/actions/rfi-annotation.actions.ts,
--     gated in-app 2026-07-09),
--   * the client-side RFI create / respond / gallery re-edit flow
--     (apps/web/src/components/attachments/commit.ts — writes rfi_annotations
--     directly with NO app-layer role gate), and
--   * any direct PostgREST / SQL call.
--
-- Root cause
-- ----------
-- rfi_annotations write policies (00033) authorise by ORG MEMBERSHIP alone
-- (organisation_id = ANY(public.get_user_org_ids())). 00161 added a RESTRICTIVE
-- block for client_viewer only. Every OTHER read-only role (inspector,
-- supplier) is an active org member and is NOT a client_viewer, so 00161 lets
-- them mutate a floor-plan markup. Concretely: an inspector re-edits an
-- existing markup from the RFI detail gallery -> commit.ts replaceAnnotation
-- UPDATEs rfi_annotations under RLS only -> succeeds. The 2026-07-09 app-layer
-- gate (requireEffectiveRole + MARKUP_WRITE_ROLES) closes the /floor-plans
-- markup entry point, but not this client path. This migration makes the DB
-- the single, uniform enforcement point.
--
-- Model
-- -----
-- Markup authoring is allowed for the /rfis + /floor-plans write set —
-- owner / admin / project_manager / contractor (MARKUP_WRITE_ROLES in
-- @esite/shared) — resolved as the caller's EFFECTIVE project role via
-- public.user_effective_project_role (00107: RETURNS TEXT, STABLE SECURITY
-- DEFINER, honours per-project promotions in projects.project_members).
--
-- The project is resolved from the annotation's source floor plan
-- (rfi_annotations.source_floor_plan_id -> tenants.floor_plans.project_id) via
-- the SECURITY DEFINER helper below (row_security off), so resolution does not
-- depend on the caller's own RLS visibility of tenants.floor_plans and cannot
-- be defeated by a nested-policy gap. source_floor_plan_id (not rfi_id) is the
-- resolver because the commit.ts insert populates source_floor_plan_id but not
-- rfi_id; every markup row has a source floor plan at creation time.
--
-- Why RESTRICTIVE
-- ---------------
-- PostgreSQL OR-combines PERMISSIVE policies, so guarding the 00033 permissive
-- policies would not stop a future permissive policy from re-granting the
-- write. A RESTRICTIVE policy is AND-combined and blocks regardless of how many
-- permissive policies exist now or later. Same pattern as 00161/00162/00166.
-- SELECT is deliberately untouched — any project-visible role keeps read
-- access to markups (the right rail, the RFI detail view, PDF export).
--
-- Fail-closed
-- -----------
-- If the source floor plan cannot be resolved (source_floor_plan_id NULL — e.g.
-- the plan was deleted, ON DELETE SET NULL — or the id does not exist),
-- floor_plan_project_id() returns NULL, user_effective_project_role(NULL)
-- returns NULL, and `NULL IN (...)` is NULL (treated as FALSE in USING /
-- WITH CHECK) -> the write is blocked. A markup with no floor plan is
-- nonsensical, so blocking its mutation is correct.
--
-- Non-viewer safety
-- -----------------
-- This policy is stricter than 00161 (which only blocked client_viewer): it now
-- also blocks inspector/supplier writes to rfi_annotations. It does NOT change
-- behaviour for the four write roles — a legitimate owner/admin/project_manager/
-- contractor on the annotation's project passes user_effective_project_role and
-- is unaffected on all three verbs.
--
-- NOT covered here (deliberately, separate concerns / higher risk):
--   * tenants.floor_plans management writes (upload / calibrate / adopt-latest)
--     remain org-member-minus-client_viewer at the DB (00161). The 2026-07-09
--     UI hides those controls for read-only roles; a DB gate on floor_plans
--     writes must not disturb the cloud-sync adopt path and is tracked as a
--     follow-up.
--   * public.attachments rows (the composited-PNG attachment) — shared across
--     entity types (photos, docs); a role gate there would over-reach. The
--     markup identity lives in rfi_annotations, gated here.
--
-- Reversible:
--   DROP POLICY IF EXISTS "markup_write_roles_insert" ON public.rfi_annotations;
--   DROP POLICY IF EXISTS "markup_write_roles_update" ON public.rfi_annotations;
--   DROP POLICY IF EXISTS "markup_write_roles_delete" ON public.rfi_annotations;
--   DROP FUNCTION IF EXISTS public.floor_plan_project_id(uuid);
--
-- Post-apply verification (read-only structural check — expects 3 rows, all
-- polpermissive = false):
--   SELECT polname, polcmd, polpermissive
--   FROM pg_policy
--   WHERE polrelid = 'public.rfi_annotations'::regclass
--     AND polname LIKE 'markup_write_roles_%';
-- Behavioural check with a throwaway inspector fixture active on a real project:
--   as inspector : UPDATE public.rfi_annotations SET annotation_data = annotation_data
--                  WHERE id = '<existing markup on that project>';
--                  -> expect 0 rows / "new row violates row-level security policy"
--   as owner/PM/contractor on that project : same UPDATE -> succeeds.
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER resolver: annotation's source floor plan -> project id,
-- with row_security off so the RESTRICTIVE policies below resolve the project
-- regardless of the caller's floor_plans RLS visibility. Mirrors the
-- house helper style (user_is_client_viewer / user_effective_project_role).
CREATE OR REPLACE FUNCTION public.floor_plan_project_id(p_floor_plan_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
  SELECT project_id FROM tenants.floor_plans WHERE id = p_floor_plan_id
$function$;

REVOKE ALL ON FUNCTION public.floor_plan_project_id(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.floor_plan_project_id(UUID) TO authenticated;

DROP POLICY IF EXISTS "markup_write_roles_insert" ON public.rfi_annotations;
DROP POLICY IF EXISTS "markup_write_roles_update" ON public.rfi_annotations;
DROP POLICY IF EXISTS "markup_write_roles_delete" ON public.rfi_annotations;

CREATE POLICY "markup_write_roles_insert" ON public.rfi_annotations
    AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (
        public.user_effective_project_role(
            public.floor_plan_project_id(source_floor_plan_id)
        ) IN ('owner', 'admin', 'project_manager', 'contractor')
    );

CREATE POLICY "markup_write_roles_update" ON public.rfi_annotations
    AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (
        public.user_effective_project_role(
            public.floor_plan_project_id(source_floor_plan_id)
        ) IN ('owner', 'admin', 'project_manager', 'contractor')
    )
    WITH CHECK (
        public.user_effective_project_role(
            public.floor_plan_project_id(source_floor_plan_id)
        ) IN ('owner', 'admin', 'project_manager', 'contractor')
    );

CREATE POLICY "markup_write_roles_delete" ON public.rfi_annotations
    AS RESTRICTIVE FOR DELETE TO authenticated
    USING (
        public.user_effective_project_role(
            public.floor_plan_project_id(source_floor_plan_id)
        ) IN ('owner', 'admin', 'project_manager', 'contractor')
    );

-- Adding policies does not change the schema cache, but NOTIFY is harmless and
-- keeps parity with the project's migration conventions.
NOTIFY pgrst, 'reload schema';
