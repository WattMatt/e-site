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

DROP POLICY IF EXISTS gcr_report_revisions_select ON gcr.report_revisions;
CREATE POLICY gcr_report_revisions_select ON gcr.report_revisions FOR SELECT TO authenticated
  USING (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS gcr_report_revisions_write ON gcr.report_revisions;
CREATE POLICY gcr_report_revisions_write ON gcr.report_revisions FOR ALL TO authenticated
  USING (organisation_id = ANY(public.get_user_org_ids()))
  WITH CHECK (organisation_id = ANY(public.get_user_org_ids()));

GRANT SELECT, INSERT, UPDATE, DELETE ON gcr.report_revisions TO authenticated;
GRANT ALL ON gcr.report_revisions TO service_role;

NOTIFY pgrst, 'reload schema';
