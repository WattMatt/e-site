-- =============================================================================
-- 00152 — user_can_manage_project must respect user_organisations.is_active
--
-- Problem
--   public.user_can_manage_project() (introduced in 00085) gates the storage
--   INSERT/DELETE policies on the tenant-documents, node-order-documents,
--   shop-drawings and gcr-report buckets, but its user_organisations join has
--   no is_active predicate. Every other authorization layer treats a
--   deactivated membership as revoked (user_has_project_access in 00106,
--   requireRole in the web app), yet a deactivated owner/admin/project_manager
--   whose auth session is still alive kept full write/delete access to those
--   buckets. This matters more now that tenant-document uploads go directly
--   from the browser to storage (bytes no longer transit a Next.js route), so
--   these policies are the sole gate on the upload path.
--
-- Fix
--   Recreate the helper with AND uo.is_active = TRUE. All policies referencing
--   the function pick the fix up immediately — no policy changes needed.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.user_can_manage_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM projects.projects p
    JOIN public.user_organisations uo
      ON uo.organisation_id = p.organisation_id
    WHERE p.id = p_project_id
      AND uo.user_id = auth.uid()
      AND uo.is_active = TRUE
      AND uo.role IN ('owner', 'admin', 'project_manager')
  );
$$;

GRANT EXECUTE ON FUNCTION public.user_can_manage_project(uuid) TO authenticated;
