-- 00105_relax_project_code_format.sql
--
-- Relax the projects_code_format CHECK to allow digit-first codes and hyphens.
--
-- Before: ^[A-Z][A-Z0-9]{1,11}$   — must start with an uppercase LETTER.
-- After:  ^[A-Z0-9][A-Z0-9-]{1,11}$ — start with letter OR digit; hyphens
--                                    allowed in subsequent positions.
--
-- Why: users want to reference projects by their internal numeric IDs
-- (e.g. '643') and by hyphenated codes like '2024-A'. Letter-first was an
-- accidental design constraint from the original migration 00065; not load-
-- bearing on any downstream system.
--
-- Length is still capped at 12 chars total (1 leading + up to 11 trailing).
-- Existing data (KNG, TNK) remains valid — only the regex is more permissive.

ALTER TABLE projects.projects
  DROP CONSTRAINT IF EXISTS projects_code_format;

ALTER TABLE projects.projects
  ADD CONSTRAINT projects_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{1,11}$');
