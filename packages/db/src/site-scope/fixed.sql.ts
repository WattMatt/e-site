// packages/db/src/site-scope/fixed.sql.ts
// Hand-written parts of the site_scope migration. See spec §3 and §4.

export const ROLE_FUNCTIONS_SQL = `
CREATE OR REPLACE FUNCTION public.user_has_project_access(_project_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public' SET row_security TO 'off'
AS $function$
  SELECT
    -- (a) an active membership row whose identity org membership is active (00204)
    EXISTS (
      SELECT 1 FROM projects.project_members pm
      JOIN public.user_organisations uo ON uo.user_id = pm.user_id AND uo.organisation_id = pm.organisation_id
      WHERE pm.project_id = _project_id AND pm.user_id = auth.uid() AND pm.is_active AND uo.is_active)
    -- (b) owner or admin of the project's org sees every site (site-scoped access)
    OR EXISTS (
      SELECT 1 FROM projects.projects p
      JOIN public.user_organisations uo ON uo.organisation_id = p.organisation_id
      WHERE p.id = _project_id AND uo.user_id = auth.uid() AND uo.is_active AND uo.role IN ('owner', 'admin'))
$function$;

CREATE OR REPLACE FUNCTION public.user_effective_project_role(p_project_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public' SET row_security TO 'off'
AS $function$
  WITH org AS (
    SELECT uo.role FROM projects.projects p
    JOIN public.user_organisations uo ON uo.organisation_id = p.organisation_id
    WHERE p.id = p_project_id AND uo.user_id = p_user_id AND uo.is_active = TRUE LIMIT 1
  ), pm AS (
    SELECT pm.role FROM projects.project_members pm
    WHERE pm.project_id = p_project_id AND pm.user_id = p_user_id AND pm.is_active = TRUE LIMIT 1
  )
  SELECT CASE
    WHEN (SELECT role FROM org) IN ('owner', 'admin') THEN (SELECT role FROM org)   -- org owner/admin: every site
    WHEN (SELECT role FROM pm) IS NOT NULL THEN (SELECT role FROM pm)               -- everyone else: their membership
    ELSE NULL
  END;
$function$;
`

/**
 * projects.projects. The access lookup cannot see a row inserted by the same
 * statement, and INSERT ... RETURNING re-reads the new row under USING, so the
 * policy also decides from the row's own columns: org owner/admin of its
 * organisation (same meaning as clause b), or an org project manager on a
 * project they created. Measured: without this an admin could not create a project.
 */
export const PROJECTS_SQL = `
DROP POLICY IF EXISTS site_scope ON projects.projects;
CREATE POLICY site_scope ON projects.projects AS RESTRICTIVE FOR ALL
  USING (
    public.user_has_project_access(id)
    OR EXISTS (SELECT 1 FROM public.user_organisations uo
               WHERE uo.organisation_id = projects.organisation_id AND uo.user_id = auth.uid() AND uo.is_active
                 AND (uo.role IN ('owner', 'admin') OR (uo.role = 'project_manager' AND projects.created_by = auth.uid())))
  )
  WITH CHECK (
    public.user_has_project_access(id)
    OR EXISTS (SELECT 1 FROM public.user_organisations uo
               WHERE uo.organisation_id = projects.organisation_id AND uo.user_id = auth.uid() AND uo.is_active
                 AND (uo.role IN ('owner', 'admin') OR (uo.role = 'project_manager' AND projects.created_by = auth.uid())))
  );
`

/** Profiles: yourself, people who share a project with you, or anyone in an org you own/administer. */
export const PROFILES_SQL = `
CREATE OR REPLACE FUNCTION public.user_can_see_profile(p_target uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public' SET row_security TO 'off'
AS $function$
  SELECT p_target = auth.uid()
    OR EXISTS (SELECT 1 FROM projects.project_members a JOIN projects.project_members b ON b.project_id = a.project_id
               WHERE a.user_id = auth.uid() AND a.is_active AND b.user_id = p_target AND b.is_active)
    OR EXISTS (SELECT 1 FROM public.user_organisations me JOIN public.user_organisations them ON them.organisation_id = me.organisation_id
               WHERE me.user_id = auth.uid() AND me.is_active AND me.role IN ('owner', 'admin')
                 AND them.user_id = p_target AND them.is_active)
$function$;
REVOKE ALL ON FUNCTION public.user_can_see_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_can_see_profile(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS site_scope ON public.profiles;
CREATE POLICY site_scope ON public.profiles AS RESTRICTIVE FOR SELECT
  USING (public.user_can_see_profile(id));
`

const SITE_BUCKETS = ['drawings', 'project-documents', 'rfi-attachments', 'diary-attachments', 'snag-photos',
  'coc-documents', 'qc-report-entries', 'jbcc-letters', 'cable-schedule-evidence']

/** Storage: path {org}/{project}/... ({org}/projects/{project}/... for jbcc-letters). Org owner/admin always pass (orphans of deleted projects stay readable to them). */
export const STORAGE_SQL = `
CREATE OR REPLACE FUNCTION public.storage_site_access(p_bucket text, p_name text)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public' SET row_security TO 'off'
AS $function$
DECLARE
  v_org  text := split_part(p_name, '/', 1);
  v_proj text := CASE WHEN p_bucket = 'jbcc-letters' THEN split_part(p_name, '/', 3) ELSE split_part(p_name, '/', 2) END;
  c_uuid CONSTANT text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  IF v_org ~ c_uuid AND EXISTS (SELECT 1 FROM public.user_organisations uo
       WHERE uo.organisation_id = v_org::uuid AND uo.user_id = auth.uid() AND uo.is_active AND uo.role IN ('owner', 'admin')) THEN
    RETURN true;
  END IF;
  RETURN v_proj ~ c_uuid AND public.user_has_project_access(v_proj::uuid);
END;
$function$;
REVOKE ALL ON FUNCTION public.storage_site_access(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_site_access(text, text) TO authenticated, service_role;

DROP POLICY IF EXISTS site_scope_objects ON storage.objects;
CREATE POLICY site_scope_objects ON storage.objects AS RESTRICTIVE FOR ALL
  USING (CASE WHEN bucket_id IN (${SITE_BUCKETS.map((b) => `'${b}'`).join(', ')}) THEN public.storage_site_access(bucket_id, name) ELSE true END)
  WITH CHECK (CASE WHEN bucket_id IN (${SITE_BUCKETS.map((b) => `'${b}'`).join(', ')}) THEN public.storage_site_access(bucket_id, name) ELSE true END);
`

/** Mobile token: add all_sites (owner/admin of the first active org). Body otherwise identical to 00204's. */
export const JWT_HOOK_SQL = `
CREATE OR REPLACE FUNCTION public.custom_jwt_claims(event jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _user_id uuid; _org_id uuid; _org_role text; _project_ids jsonb; _claims jsonb;
BEGIN
  _user_id := (event ->> 'user_id')::uuid;
  SELECT organisation_id, role INTO _org_id, _org_role FROM public.user_organisations
   WHERE user_id = _user_id AND is_active = true ORDER BY created_at ASC LIMIT 1;
  SELECT COALESCE(jsonb_agg(DISTINCT pm.project_id), '[]'::jsonb) INTO _project_ids
    FROM projects.project_members pm
    JOIN public.user_organisations uo ON uo.user_id = pm.user_id AND uo.organisation_id = pm.organisation_id
   WHERE pm.user_id = _user_id AND pm.is_active = TRUE AND uo.is_active = TRUE;
  _claims := event -> 'claims';
  IF _org_id IS NOT NULL THEN
    _claims := jsonb_set(_claims, '{org_id}', to_jsonb(_org_id::text));
  END IF;
  _claims := jsonb_set(_claims, '{project_ids}', _project_ids);
  _claims := jsonb_set(_claims, '{all_sites}', to_jsonb(COALESCE(_org_role IN ('owner', 'admin'), false)));
  RETURN jsonb_set(event, '{claims}', _claims);
END;
$function$;
`

export const FIXED_VERIFY = [
  `-- sql: (SELECT pg_get_functiondef('public.user_has_project_access(uuid)'::regprocedure) NOT LIKE '%project_manager%')`,
  `-- sql: (SELECT pg_get_functiondef('public.user_effective_project_role(uuid,uuid)'::regprocedure) NOT LIKE '%project_manager%')`,
  `-- policy: site_scope ON projects.projects RESTRICTIVE`,
  `-- policy: site_scope ON public.profiles RESTRICTIVE`,
  `-- policy: site_scope_objects ON storage.objects RESTRICTIVE`,
  `-- function: public.user_has_project_access(uuid)`,
  `-- function: public.user_effective_project_role(uuid, uuid)`,
  `-- function: public.custom_jwt_claims(jsonb)`,
  `-- function: public.storage_site_access(text, text)`,
  `-- function: public.user_can_see_profile(uuid)`,
  `-- sql: (SELECT NOT has_function_privilege('anon', 'public.storage_site_access(text,text)', 'EXECUTE'))`,
  `-- sql: (SELECT NOT has_function_privilege('anon', 'public.user_can_see_profile(uuid)', 'EXECUTE'))`,
  `-- sql: (SELECT pg_get_functiondef('public.custom_jwt_claims(jsonb)'::regprocedure) LIKE '%all_sites%')`,
]
