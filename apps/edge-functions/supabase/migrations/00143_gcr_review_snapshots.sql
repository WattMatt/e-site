-- =============================================================================
-- Migration 00143 — gcr.review_snapshots (frozen client-facing GCR dataset)
-- =============================================================================
-- "Publish for client review" freezes the current engine model into one
-- immutable row. The payload JSONB holds ONLY outputs-only fields produced by
-- @esite/shared toClientReviewPayload() — NO contractor cost inputs (generator
-- capital, total capital, diesel/maintenance, tariff build-up, margin) are ever
-- written here. Separate from gcr.report_revisions specifically so client read
-- access never touches the cost-bearing summary in report_revisions (00127),
-- whose client_viewer block stays intact.
-- =============================================================================

CREATE TABLE IF NOT EXISTS gcr.review_snapshots (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id             UUID        NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  organisation_id        UUID        NOT NULL REFERENCES public.organisations(id),
  report_revision_id     UUID        REFERENCES gcr.report_revisions(id) ON DELETE SET NULL,
  -- Outputs-only frozen dataset: { tenants: [...], banks: [...], scheme: {...} }.
  -- Shape == @esite/shared ClientGcrReviewPayload. Never holds cost inputs.
  payload                JSONB       NOT NULL,
  published_for_client_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by             UUID        REFERENCES auth.users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gcr_review_snapshots_project
  ON gcr.review_snapshots (project_id, published_for_client_at DESC);

ALTER TABLE gcr.review_snapshots ENABLE ROW LEVEL SECURITY;

-- SELECT: project managers/admins (via project access, EXCLUDING raw cost tables
-- is irrelevant here — this payload is already outputs-only) OR a granted client.
-- Granted clients read snapshots ONLY for sites in client_site_grants.
DROP POLICY IF EXISTS gcr_review_snapshots_select ON gcr.review_snapshots;
CREATE POLICY gcr_review_snapshots_select ON gcr.review_snapshots FOR SELECT TO authenticated
  USING (
    public.user_has_project_access(project_id)
    OR public.user_has_client_site_grant(auth.uid(), project_id)
  );

-- INSERT: only owner/admin/PM (publish action). Immutable — no UPDATE policy.
DROP POLICY IF EXISTS gcr_review_snapshots_insert ON gcr.review_snapshots;
CREATE POLICY gcr_review_snapshots_insert ON gcr.review_snapshots FOR INSERT TO authenticated
  WITH CHECK (
    public.user_can_manage_project(project_id)
    AND organisation_id = (SELECT p.organisation_id FROM projects.projects p WHERE p.id = project_id)
  );

DROP POLICY IF EXISTS gcr_review_snapshots_delete ON gcr.review_snapshots;
CREATE POLICY gcr_review_snapshots_delete ON gcr.review_snapshots FOR DELETE TO authenticated
  USING (public.user_can_manage_project(project_id));

GRANT SELECT, INSERT, DELETE ON gcr.review_snapshots TO authenticated; -- no UPDATE: immutable
-- 00126's schema-level DEFAULT PRIVILEGES include UPDATE for authenticated, so
-- this table inherited it at CREATE — revoke explicitly to match the no-UPDATE
-- policy set (RLS already denies UPDATE; this makes the grants tell the truth).
REVOKE UPDATE ON gcr.review_snapshots FROM authenticated, anon;
GRANT ALL ON gcr.review_snapshots TO service_role;

NOTIFY pgrst, 'reload schema';
