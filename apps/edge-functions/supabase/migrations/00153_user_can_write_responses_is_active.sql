-- =============================================================================
-- 00153 — inspections.user_can_write_responses must respect is_active
--
-- Same class as 00152 (user_can_manage_project): the helper gating inspection
-- response/photo/file writes joined user_organisations without an is_active
-- predicate, so a deactivated member with a live session kept write access.
-- Body otherwise identical to the 00068 definition.
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
