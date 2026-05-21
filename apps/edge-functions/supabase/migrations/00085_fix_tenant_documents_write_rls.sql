-- =============================================================================
-- Migration 00085 — fix tenant-documents storage INSERT/DELETE RLS policies
-- =============================================================================
-- Bug (two layers):
--   Migration 00080 created the "tenant-documents write" and
--   "tenant-documents delete" policies with an EXISTS subquery that inline-joins
--   projects.projects and public.user_organisations.
--
--   Layer 1 — column mis-binding: the subquery called
--     structure.tenant_doc_project_id(name); inside the subquery `name` bound to
--     projects.projects.name (the PROJECT name) instead of the storage object's
--     path, so the function returned NULL.
--
--   Layer 2 — RLS-inside-RLS: an RLS policy is evaluated as the `authenticated`
--     user, so the inline join to projects.projects / user_organisations is
--     itself RLS-gated. user_organisations in particular is not directly
--     readable in that nested context (the app reads it only via the
--     SECURITY DEFINER helper get_user_org_ids() for exactly this reason). The
--     join returned no rows, the EXISTS was always empty, and every
--     authenticated INSERT/DELETE was denied with "new row violates row-level
--     security policy".
--
--   The "tenant-documents read" policy was unaffected — it has no subquery and
--   gates purely on public.user_has_project_access(), a SECURITY DEFINER helper.
--
-- Fix:
--   Add a SECURITY DEFINER helper, public.user_can_manage_project(uuid), that
--   answers "is the current user an owner/admin/project_manager of this
--   project's organisation?" without RLS interference (it runs as the function
--   owner). Recreate the write + delete policies to gate on that helper only —
--   no inline joins, no ambiguous `name`.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP POLICY IF EXISTS + CREATE.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Helper: owner/admin/project_manager of a project's organisation
-- ─────────────────────────────────────────────────────────────────────────────

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
      AND uo.role IN ('owner', 'admin', 'project_manager')
  );
$$;

GRANT EXECUTE ON FUNCTION public.user_can_manage_project(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Recreate the tenant-documents write + delete policies using the helper.
--    `name` here is unambiguous — there is no subquery — so it binds to
--    storage.objects.name as intended.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "tenant-documents write" ON storage.objects;
CREATE POLICY "tenant-documents write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'tenant-documents'
    AND public.user_can_manage_project(structure.tenant_doc_project_id(name))
  );

DROP POLICY IF EXISTS "tenant-documents delete" ON storage.objects;
CREATE POLICY "tenant-documents delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'tenant-documents'
    AND public.user_can_manage_project(structure.tenant_doc_project_id(name))
  );
