-- 00137_inspections_template_category.sql
-- Optional discipline grouping for the inspection-templates library
-- (e.g. 'medium_voltage'). Nullable + additive: existing templates remain
-- uncategorised and render under a "General" heading.
ALTER TABLE inspections.templates ADD COLUMN IF NOT EXISTS category TEXT NULL;
CREATE INDEX IF NOT EXISTS templates_category_idx ON inspections.templates (category);

NOTIFY pgrst, 'reload schema';
