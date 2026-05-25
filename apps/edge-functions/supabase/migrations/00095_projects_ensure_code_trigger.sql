-- 00095_projects_ensure_code_trigger.sql
-- Auto-fills projects.projects.code on INSERT when the caller omits it, by
-- generating projects.suggest_code(name) and resolving collisions within the
-- organisation. Mirrors public.ensure_org_slug() (migration 00022).
--
-- Before this, `code` was NOT NULL with no default and no trigger, so every
-- application project-creation path (createProjectAction, createFirstProjectAction,
-- projectService.create) omitted it and would fail with a not-null violation.

BEGIN;

CREATE OR REPLACE FUNCTION projects.ensure_project_code()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  base_code TEXT;
  candidate TEXT;
  suffix    INT;
BEGIN
  IF NEW.code IS NULL OR NEW.code = '' THEN
    base_code := projects.suggest_code(NEW.name);
    candidate := base_code;
    suffix    := 2;
    WHILE EXISTS (
      SELECT 1 FROM projects.projects
      WHERE organisation_id = NEW.organisation_id AND code = candidate
    ) LOOP
      candidate := base_code || suffix::text;
      suffix    := suffix + 1;
    END LOOP;
    NEW.code := candidate;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS projects_ensure_code ON projects.projects;

CREATE TRIGGER projects_ensure_code
  BEFORE INSERT ON projects.projects
  FOR EACH ROW EXECUTE FUNCTION projects.ensure_project_code();

NOTIFY pgrst, 'reload schema';

COMMIT;
