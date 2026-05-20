-- =============================================================================
-- Migration 00075 — RLS policies + grants on structure.nodes
-- =============================================================================
-- Adds row-level security and role grants to structure.nodes.
-- The policy shape mirrors inspections.inspections (00066):
--   SELECT  — org members with project access; client_viewer scoped to
--             assigned projects (no status gate — unlike inspections, all
--             nodes are visible regardless of status).
--   INSERT  — org members with project access whose org role is
--             owner | admin | project_manager.
--   UPDATE  — same gate as INSERT.
--   DELETE  — same gate as INSERT. A missing DELETE policy silently
--             no-ops (returns success with 0 rows affected); include it
--             unconditionally (see: Session 32 post-mortem).
-- This migration does NOT apply to any database — apply via Task 0.3.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enable RLS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE structure.nodes ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. SELECT policies
-- ─────────────────────────────────────────────────────────────────────────────

-- Internal org members (non-client_viewer) see all nodes on their projects.
CREATE POLICY nodes_select_members ON structure.nodes
  FOR SELECT TO authenticated
  USING (
    public.user_has_project_access(project_id)
    AND NOT public.user_is_client_viewer(organisation_id)
  );

-- client_viewer sees nodes on their assigned projects (no status restriction).
CREATE POLICY nodes_select_client_viewer ON structure.nodes
  FOR SELECT TO authenticated
  USING (
    public.user_is_client_viewer(organisation_id)
    AND public.user_has_project_access(project_id)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. INSERT policy
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY nodes_insert ON structure.nodes
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_project_access(project_id)
    AND EXISTS (
      SELECT 1 FROM public.user_organisations
      WHERE user_id = auth.uid()
        AND organisation_id = structure.nodes.organisation_id
        AND role IN ('owner', 'admin', 'project_manager')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. UPDATE policy
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY nodes_update ON structure.nodes
  FOR UPDATE TO authenticated
  USING (
    public.user_has_project_access(project_id)
    AND EXISTS (
      SELECT 1 FROM public.user_organisations
      WHERE user_id = auth.uid()
        AND organisation_id = structure.nodes.organisation_id
        AND role IN ('owner', 'admin', 'project_manager')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. DELETE policy
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY nodes_delete ON structure.nodes
  FOR DELETE TO authenticated
  USING (
    public.user_has_project_access(project_id)
    AND EXISTS (
      SELECT 1 FROM public.user_organisations
      WHERE user_id = auth.uid()
        AND organisation_id = structure.nodes.organisation_id
        AND role IN ('owner', 'admin', 'project_manager')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Grants
-- ─────────────────────────────────────────────────────────────────────────────

GRANT USAGE ON SCHEMA structure TO authenticated, service_role, anon;

GRANT SELECT ON ALL TABLES IN SCHEMA structure TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA structure TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA structure TO service_role;

-- Apply same defaults to future tables created in the structure schema.
ALTER DEFAULT PRIVILEGES IN SCHEMA structure
  GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA structure
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA structure
  GRANT ALL ON TABLES TO service_role;
