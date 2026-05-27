-- =============================================================================
-- Migration: 00103_project_settings_backfill_and_autocreate.sql
-- Description: One-time backfill of project_settings rows for every existing
--              project, plus an AFTER INSERT trigger on projects.projects so
--              new projects always get a default settings row automatically.
-- Spec: SPEC DOCS/2026-05-26-project-settings-design.md §5.4
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Backfill — one row per existing project
-- ---------------------------------------------------------------------------
INSERT INTO projects.project_settings (project_id, organisation_id)
SELECT id, organisation_id FROM projects.projects
ON CONFLICT (project_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Auto-create trigger — every new project gets a default settings row
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION projects.ensure_project_settings_row() RETURNS trigger AS $$
BEGIN
    INSERT INTO projects.project_settings (project_id, organisation_id)
    VALUES (NEW.id, NEW.organisation_id)
    ON CONFLICT (project_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER project_ensure_settings
    AFTER INSERT ON projects.projects
    FOR EACH ROW EXECUTE FUNCTION projects.ensure_project_settings_row();

NOTIFY pgrst, 'reload schema';
