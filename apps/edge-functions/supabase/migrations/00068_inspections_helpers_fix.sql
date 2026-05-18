-- 00068_inspections_helpers_fix.sql
-- Hotfix: RLS helper functions in 00066 referenced public.project_members,
-- but project_members lives in the `projects` schema. This broke PostgREST
-- schema cache rebuild (PGRST002 on every query). CREATE OR REPLACE the
-- functions with correct schema qualification + add public.user_has_project_access.

BEGIN;

CREATE OR REPLACE FUNCTION public.user_has_project_access(_project_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
SET row_security = off
AS $$
    SELECT EXISTS (
        SELECT 1 FROM projects.project_members pm
        JOIN public.user_organisations uo
          ON uo.user_id = pm.user_id
         AND uo.organisation_id = pm.organisation_id
        WHERE pm.project_id = _project_id
          AND pm.user_id = auth.uid()
          AND uo.is_active = TRUE
    )
$$;

GRANT EXECUTE ON FUNCTION public.user_has_project_access(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION inspections.user_can_verify(_project_id UUID) RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM projects.project_members pm
    JOIN public.user_organisations uo
      ON uo.user_id = pm.user_id AND uo.organisation_id = pm.organisation_id
    WHERE pm.project_id = _project_id
      AND pm.user_id = auth.uid()
      AND uo.role IN ('owner','admin','project_manager')
  );
$fn$;

CREATE OR REPLACE FUNCTION inspections.user_can_write_responses(_inspection_id UUID) RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM inspections.inspections i
    JOIN projects.project_members pm ON pm.project_id = i.project_id AND pm.user_id = auth.uid()
    JOIN public.user_organisations uo
      ON uo.user_id = auth.uid() AND uo.organisation_id = i.organisation_id
    WHERE i.id = _inspection_id
      AND uo.role <> 'client_viewer'
      AND i.status IN ('assigned','in_progress','re-inspect_required')
  );
$fn$;

CREATE OR REPLACE FUNCTION inspections.user_has_inspection_read(_inspection_id UUID) RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM inspections.inspections i
    JOIN projects.project_members pm ON pm.project_id = i.project_id AND pm.user_id = auth.uid()
    JOIN public.user_organisations uo
      ON uo.user_id = auth.uid() AND uo.organisation_id = i.organisation_id
    WHERE i.id = _inspection_id
      AND (
        uo.role <> 'client_viewer'
        OR (uo.role = 'client_viewer' AND i.status = 'certified')
      )
  );
$fn$;

NOTIFY pgrst, 'reload schema';

COMMIT;
