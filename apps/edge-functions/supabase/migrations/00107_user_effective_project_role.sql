-- 00107_user_effective_project_role.sql
--
-- Introduce public.user_effective_project_role(p_project_id, p_user_id) —
-- the single source of truth for "what role does this user have ON this
-- specific project?" Used by web-layer role gates that need to honour
-- per-project promotions/overrides via projects.project_members.role.
--
-- Resolution order:
--   1. owner / admin / project_manager at the org level → return that role.
--      Org-level admins always win and cannot be demoted per-project. This
--      keeps the post-00106 auto-pass semantics intact.
--   2. Otherwise, if an active projects.project_members row exists for the
--      (user, project), return that row's role. This is where per-project
--      promotion happens: a user whose org role is 'contractor' but whose
--      project_members.role is 'project_manager' on KINGSWALK gets PM
--      treatment on KINGSWALK only.
--   3. Otherwise NULL — no effective role, no access.
--
-- This function does NOT gate ACCESS — public.user_has_project_access(p)
-- (migration 00106) still owns that. It only resolves the role to use for
-- visibility decisions once access is granted.
--
-- SECURITY DEFINER + row_security off so it can read user_organisations +
-- project_members without recursive RLS (same pattern as 00106).
-- search_path locked to 'public' to prevent function-resolution attacks.
--
-- Reversible: DROP FUNCTION public.user_effective_project_role(uuid, uuid).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.user_effective_project_role(
  p_project_id UUID,
  p_user_id    UUID DEFAULT auth.uid()
)
RETURNS TEXT
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
  WITH org AS (
    SELECT uo.role
    FROM projects.projects p
    JOIN public.user_organisations uo
      ON uo.organisation_id = p.organisation_id
    WHERE p.id = p_project_id
      AND uo.user_id = p_user_id
      AND uo.is_active = TRUE
    LIMIT 1
  ),
  pm AS (
    SELECT pm.role
    FROM projects.project_members pm
    WHERE pm.project_id = p_project_id
      AND pm.user_id    = p_user_id
      AND pm.is_active  = TRUE
    LIMIT 1
  )
  SELECT CASE
    -- Clause 1: org-level admin auto-wins.
    WHEN (SELECT role FROM org) IN ('owner', 'admin', 'project_manager')
      THEN (SELECT role FROM org)
    -- Clause 2: narrower role with explicit project_members row.
    WHEN (SELECT role FROM pm) IS NOT NULL
      THEN (SELECT role FROM pm)
    -- Clause 3: no effective role.
    ELSE NULL
  END;
$function$;

COMMENT ON FUNCTION public.user_effective_project_role(uuid, uuid) IS
  'Resolves a user''s effective role on a project. Org owner/admin/PM always '
  'win; otherwise falls back to projects.project_members.role. Returns NULL '
  'when the user has no access. See migration 00107 for full semantics.';

-- Grant execute to authenticated users — the web layer calls this via RPC.
GRANT EXECUTE ON FUNCTION public.user_effective_project_role(uuid, uuid) TO authenticated;
