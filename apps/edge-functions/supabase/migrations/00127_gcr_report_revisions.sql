-- =============================================================================
-- Migration 00127 — gcr.report_revisions (saved generator report PDFs)
-- =============================================================================
-- Each "Generate report" run persists an immutable, numbered revision (Rev 1,
-- 2, 3…) per project: a row here + the rendered PDF in the existing private
-- `reports` bucket (00117, path {org_id}/{project_id}/…). Mirrors the
-- structure.tenant_document_revisions pattern (00118).
--
-- gcr schema grants/exposure: 00126 set USAGE + DEFAULT PRIVILEGES for the gcr
-- schema and gcr is in PostgREST's exposed schemas (config.toml + prod), so no
-- exposure work is needed here — explicit grants below are belt-and-braces per
-- the 00118 convention.
-- =============================================================================

CREATE TABLE IF NOT EXISTS gcr.report_revisions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID        NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  organisation_id  UUID        NOT NULL REFERENCES public.organisations(id),
  revision_number  INTEGER     NOT NULL,
  storage_path     TEXT        NOT NULL,
  file_name        TEXT        NOT NULL,
  note             TEXT,
  -- Headline numbers for the revision list (monthlyCapitalRepayment,
  -- finalTariff, totalCapitalCost, tenantCount) so listing never needs to
  -- re-run the engine or touch storage.
  summary          JSONB,
  created_by       UUID        REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_gcr_report_revisions_project
  ON gcr.report_revisions (project_id, revision_number DESC);

ALTER TABLE gcr.report_revisions ENABLE ROW LEVEL SECURITY;

-- SELECT: project members, EXCLUDING client viewers (00118 pattern) — the
-- summary jsonb holds cost figures that must never reach the client portal.
DROP POLICY IF EXISTS gcr_report_revisions_select ON gcr.report_revisions;
CREATE POLICY gcr_report_revisions_select ON gcr.report_revisions FOR SELECT TO authenticated
  USING (
    public.user_has_project_access(project_id)
    AND NOT public.user_is_client_viewer(organisation_id)
  );

-- Writes: project- and role-scoped via user_can_manage_project (00085), with
-- organisation_id pinned to the project's actual org so a member of org A can
-- never inject a row into org B's report list. Deliberately NO UPDATE policy
-- (and no UPDATE grant): revisions are immutable — generate appends, delete
-- removes; nothing edits. The service-role insert path bypasses RLS as usual.
DROP POLICY IF EXISTS gcr_report_revisions_write ON gcr.report_revisions;
DROP POLICY IF EXISTS gcr_report_revisions_insert ON gcr.report_revisions;
CREATE POLICY gcr_report_revisions_insert ON gcr.report_revisions FOR INSERT TO authenticated
  WITH CHECK (
    public.user_can_manage_project(project_id)
    AND organisation_id = (SELECT p.organisation_id FROM projects.projects p WHERE p.id = project_id)
  );

DROP POLICY IF EXISTS gcr_report_revisions_delete ON gcr.report_revisions;
CREATE POLICY gcr_report_revisions_delete ON gcr.report_revisions FOR DELETE TO authenticated
  USING (public.user_can_manage_project(project_id));

GRANT SELECT, INSERT, DELETE ON gcr.report_revisions TO authenticated; -- no UPDATE: immutable
-- 00126's schema-level DEFAULT PRIVILEGES include UPDATE for authenticated, so
-- this table inherited it at CREATE — revoke explicitly to match the no-UPDATE
-- policy set (RLS already denies UPDATE; this makes the grants tell the truth).
REVOKE UPDATE ON gcr.report_revisions FROM authenticated;
REVOKE UPDATE ON gcr.report_revisions FROM anon;
GRANT ALL ON gcr.report_revisions TO service_role;

NOTIFY pgrst, 'reload schema';
