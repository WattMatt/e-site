-- =============================================================================
-- Migration 00142 — gcr.change_requests (client captured proposals + comments)
-- =============================================================================
-- One row = one per-tenant captured proposal (old -> new) on a published
-- snapshot, plus the client's comment. Proposable fields are editable INPUTS
-- ONLY (area, category, participation, zone, manual_kw_override) — never derived
-- outputs (D1, spec §5.3). Pinned to the snapshot + the revision it was reviewed
-- against. Admin accepts (auto-apply), declines (reason), or replies.
-- =============================================================================

CREATE TABLE IF NOT EXISTS gcr.change_requests (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID        NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  organisation_id  UUID        NOT NULL REFERENCES public.organisations(id),
  snapshot_id      UUID        NOT NULL REFERENCES gcr.review_snapshots(id) ON DELETE CASCADE,
  node_id          UUID        NOT NULL REFERENCES structure.nodes(id) ON DELETE CASCADE,
  client_id        UUID        NOT NULL REFERENCES public.profiles(id),
  field            TEXT        NOT NULL CHECK (field IN ('area','category','participation','zone','manual_kw_override')),
  old_value        TEXT,
  new_value        TEXT,
  comment          TEXT,
  status           TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','declined')),
  admin_reply      TEXT,
  actioned_by      UUID        REFERENCES public.profiles(id),
  actioned_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gcr_change_requests_project  ON gcr.change_requests (project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gcr_change_requests_snapshot ON gcr.change_requests (snapshot_id);
CREATE INDEX IF NOT EXISTS idx_gcr_change_requests_client   ON gcr.change_requests (client_id);

ALTER TABLE gcr.change_requests ENABLE ROW LEVEL SECURITY;

-- SELECT: a granted client sees their OWN requests for granted sites; project
-- managers/admins see all requests for their projects (WM owner-org via
-- user_can_manage_project / user_has_project_access).
DROP POLICY IF EXISTS gcr_change_requests_select ON gcr.change_requests;
CREATE POLICY gcr_change_requests_select ON gcr.change_requests FOR SELECT TO authenticated
  USING (
    (client_id = auth.uid() AND public.user_has_client_site_grant(auth.uid(), project_id))
    OR public.user_has_project_access(project_id)
  );

-- INSERT: a granted client inserts their own requests for a granted site only,
-- pinned to the project's real org. client_id must be the caller.
DROP POLICY IF EXISTS gcr_change_requests_insert ON gcr.change_requests;
CREATE POLICY gcr_change_requests_insert ON gcr.change_requests FOR INSERT TO authenticated
  WITH CHECK (
    client_id = auth.uid()
    AND public.user_has_client_site_grant(auth.uid(), project_id)
    AND organisation_id = (SELECT p.organisation_id FROM projects.projects p WHERE p.id = project_id)
  );

-- UPDATE: only owner/admin/PM may action (accept/decline/reply) requests on
-- their projects. Clients cannot edit a submitted request.
DROP POLICY IF EXISTS gcr_change_requests_update ON gcr.change_requests;
CREATE POLICY gcr_change_requests_update ON gcr.change_requests FOR UPDATE TO authenticated
  USING (public.user_can_manage_project(project_id))
  WITH CHECK (public.user_can_manage_project(project_id));

GRANT SELECT, INSERT, UPDATE ON gcr.change_requests TO authenticated;
GRANT ALL ON gcr.change_requests TO service_role;

NOTIFY pgrst, 'reload schema';
