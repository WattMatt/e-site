-- Project type / sector classifier on projects.projects.
-- Nullable; constrained to a known enum via a named CHECK (idempotent).

ALTER TABLE projects.projects
  ADD COLUMN IF NOT EXISTS project_type TEXT;

ALTER TABLE projects.projects DROP CONSTRAINT IF EXISTS projects_project_type_check;
ALTER TABLE projects.projects ADD CONSTRAINT projects_project_type_check
  CHECK (project_type IS NULL OR project_type IN (
    'commercial', 'residential', 'retail', 'industrial', 'civil',
    'mixed_use', 'healthcare', 'education', 'electrical_mv', 'other'
  ));
