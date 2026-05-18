-- 00067_inspections_rls_with_check.sql
-- Security follow-up to 00066. Adds WITH CHECK clauses to two UPDATE policies
-- so the row owner cannot UPDATE organisation_id (templates) or
-- organisation_id / project_id (inspections) to flip a row out of scope.
-- Without WITH CHECK, PostgreSQL only evaluates USING on the pre-UPDATE row;
-- the post-UPDATE row can land anywhere the column constraints allow.

BEGIN;

DROP POLICY IF EXISTS templates_update ON inspections.templates;
CREATE POLICY templates_update ON inspections.templates FOR UPDATE TO authenticated
  USING (
    organisation_id = ANY(public.get_user_org_ids())
    AND EXISTS (
      SELECT 1 FROM public.user_organisations
      WHERE user_id = auth.uid()
        AND organisation_id = inspections.templates.organisation_id
        AND role IN ('owner','admin')
    )
  )
  WITH CHECK (
    organisation_id = ANY(public.get_user_org_ids())
    AND EXISTS (
      SELECT 1 FROM public.user_organisations
      WHERE user_id = auth.uid()
        AND organisation_id = inspections.templates.organisation_id
        AND role IN ('owner','admin')
    )
  );

DROP POLICY IF EXISTS inspections_update_contributors ON inspections.inspections;
CREATE POLICY inspections_update_contributors ON inspections.inspections FOR UPDATE TO authenticated
  USING (
    public.user_has_project_access(project_id)
    AND NOT public.user_is_client_viewer(organisation_id)
  )
  WITH CHECK (
    public.user_has_project_access(project_id)
    AND NOT public.user_is_client_viewer(organisation_id)
  );

COMMIT;
