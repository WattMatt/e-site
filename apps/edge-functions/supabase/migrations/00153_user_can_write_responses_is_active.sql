-- =============================================================================
-- 00153 — user_can_write_responses must respect user_organisations.is_active
--
-- Problem
--   inspections.user_can_write_responses() (00066, last touched in 00068)
--   gates the responses/photos table writes AND the storage INSERT/DELETE
--   policies on the inspection-photos / inspection-signatures /
--   inspection-attachments buckets (00073), but its user_organisations join
--   has no is_active predicate. Every other authorization layer treats a
--   deactivated membership as revoked (user_has_project_access in 00106,
--   user_can_manage_project since 00152, requireRole in the web app), yet a
--   deactivated member whose auth session is still alive kept write access.
--   This matters more now that inspection file attachments go directly from
--   the browser to storage (bytes no longer transit a Next.js route), so
--   these policies are the sole gate on the upload path — same reasoning as
--   00152 for the tenant-documents bucket.
--
-- Fix
--   Recreate the helper with AND uo.is_active = TRUE. All table + storage
--   policies referencing the function pick the fix up immediately — no
--   policy changes needed.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.
-- =============================================================================

CREATE OR REPLACE FUNCTION inspections.user_can_write_responses(_inspection_id UUID) RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM inspections.inspections i
    JOIN projects.project_members pm ON pm.project_id = i.project_id AND pm.user_id = auth.uid()
    JOIN public.user_organisations uo
      ON uo.user_id = auth.uid() AND uo.organisation_id = i.organisation_id
    WHERE i.id = _inspection_id
      AND uo.is_active = TRUE
      AND uo.role <> 'client_viewer'
      AND i.status IN ('assigned','in_progress','re-inspect_required')
  );
$fn$;

GRANT EXECUTE ON FUNCTION inspections.user_can_write_responses(UUID) TO authenticated;
