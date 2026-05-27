-- 00106_relax_user_has_project_access.sql
--
-- Relax public.user_has_project_access(_project_id) so org-level owners,
-- admins, and project_managers gain access to every project in their org
-- WITHOUT requiring an explicit row in projects.project_members.
--
-- Previously: required `projects.project_members(user_id, project_id)` row
-- regardless of org-level role. That made every newly-invited org-level
-- project_manager invisible to all project data (structure.nodes, cables,
-- materials, etc.) until manually added to project_members for each project.
-- That's the wrong default for org-level admins — they should see everything
-- in their own organisation.
--
-- After this migration:
--   user_has_project_access(p) = TRUE iff
--     (a) user is in projects.project_members for p AND active org member, OR
--     (b) user has role owner / admin / project_manager in p's organisation
--         AND is active.
--
-- Clause (a) preserves explicit per-project narrowing for contractor /
-- inspector / supplier / client_viewer — those roles still need to be added
-- to project_members to see anything (matches the spec's RBAC matrix).
--
-- Clause (b) gives org-level admins implicit access to all projects, which
-- is what most teams expect.
--
-- All existing RLS policies that call user_has_project_access(...) inherit
-- the new behaviour with zero changes to the policy bodies.
--
-- SECURITY DEFINER + SET row_security TO 'off' is preserved so the function
-- bypasses RLS on user_organisations + project_members + projects (it must;
-- otherwise it would infinitely recurse). The search_path is locked to
-- 'public' to prevent function-resolution attacks.

CREATE OR REPLACE FUNCTION public.user_has_project_access(_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
  SELECT
    -- Clause (a): explicit project_members entry (existing behaviour).
    EXISTS (
      SELECT 1
      FROM projects.project_members pm
      JOIN public.user_organisations uo
        ON uo.user_id = pm.user_id
       AND uo.organisation_id = pm.organisation_id
      WHERE pm.project_id = _project_id
        AND pm.user_id = auth.uid()
        AND uo.is_active = TRUE
    )
    -- Clause (b): NEW. Org-level admin auto-pass.
    OR EXISTS (
      SELECT 1
      FROM projects.projects p
      JOIN public.user_organisations uo
        ON uo.organisation_id = p.organisation_id
      WHERE p.id = _project_id
        AND uo.user_id = auth.uid()
        AND uo.is_active = TRUE
        AND uo.role IN ('owner', 'admin', 'project_manager')
    )
$function$;
