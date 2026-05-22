-- 00094_inspections_template_description.sql
-- Adds an editable free-text description to inspection templates.
--
-- `description` is pure metadata (a label for the template library), NOT part
-- of schema_json — so editing it never trips the schema_json immutability
-- trigger (inspections.enforce_template_immutability) and never requires a
-- version bump. `name` and `description` are both family-level: every version
-- row of a given template_id is kept in sync to the same value.

ALTER TABLE inspections.templates
  ADD COLUMN IF NOT EXISTS description TEXT NULL;

NOTIFY pgrst, 'reload schema';
