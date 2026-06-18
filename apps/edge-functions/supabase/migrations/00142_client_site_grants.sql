-- =============================================================================
-- Migration 00142 — public.client_site_grants (per-site client access)
-- =============================================================================
-- A client's GCR review visibility derives ONLY from this table, NOT from
-- org-level client_viewer membership (spec D5/§8). One row = one client user may
-- review one site (project). Default = no rows = no client visibility. Grants are
-- keyed to the project, so a client may span sites across sub-orgs (D6).
--
-- The existing 00127 policy that BLOCKS client_viewer from gcr.report_revisions
-- (and 00124's cost-input tables, which never grant client access) is left fully
-- intact — clients still cannot read raw gcr.* cost data.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.client_site_grants (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id      UUID        NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  organisation_id UUID        NOT NULL REFERENCES public.organisations(id),
  granted_by      UUID        REFERENCES public.profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_client_site_grants_user    ON public.client_site_grants (user_id);
CREATE INDEX IF NOT EXISTS idx_client_site_grants_project ON public.client_site_grants (project_id);

-- SECURITY DEFINER helper used by gcr review RLS/RPCs. row_security off + empty
-- search_path mirror the 00106/00085 helper convention (avoids RLS recursion).
CREATE OR REPLACE FUNCTION public.user_has_client_site_grant(p_user_id UUID, p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.client_site_grants g
    WHERE g.user_id = p_user_id
      AND g.project_id = p_project_id
  );
$$;

ALTER TABLE public.client_site_grants ENABLE ROW LEVEL SECURITY;

-- SELECT: the granted client sees their own grant rows; project managers/admins
-- (and WM owner-org via user_can_manage_project) see grants for their projects.
DROP POLICY IF EXISTS client_site_grants_select ON public.client_site_grants;
CREATE POLICY client_site_grants_select ON public.client_site_grants FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.user_can_manage_project(project_id)
  );

-- INSERT/DELETE: only owner/admin/PM of the project's org may grant/revoke, and
-- organisation_id must be pinned to the project's real org (no cross-org inject).
DROP POLICY IF EXISTS client_site_grants_insert ON public.client_site_grants;
CREATE POLICY client_site_grants_insert ON public.client_site_grants FOR INSERT TO authenticated
  WITH CHECK (
    public.user_can_manage_project(project_id)
    AND organisation_id = (SELECT p.organisation_id FROM projects.projects p WHERE p.id = project_id)
  );

DROP POLICY IF EXISTS client_site_grants_delete ON public.client_site_grants;
CREATE POLICY client_site_grants_delete ON public.client_site_grants FOR DELETE TO authenticated
  USING (public.user_can_manage_project(project_id));

-- No UPDATE: grants are insert/delete only.
GRANT SELECT, INSERT, DELETE ON public.client_site_grants TO authenticated;
REVOKE UPDATE ON public.client_site_grants FROM authenticated, anon;
GRANT ALL ON public.client_site_grants TO service_role;
GRANT EXECUTE ON FUNCTION public.user_has_client_site_grant(UUID, UUID) TO authenticated, anon, service_role;

NOTIFY pgrst, 'reload schema';
