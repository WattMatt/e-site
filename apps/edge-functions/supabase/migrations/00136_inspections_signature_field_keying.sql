-- 00136_inspections_signature_field_keying.sql
-- Bind a captured signature to the specific signature FIELD that requested it.
-- Additive + nullable: existing role-keyed rows are untouched; the engine
-- (packages/shared/src/inspections/engine.ts) already filters signatures by
-- (section_id, field_id), so this closes the gap that made multi-signature
-- forms collapse to one row and required signatures permanently unsatisfiable.
ALTER TABLE inspections.signatures
  ADD COLUMN IF NOT EXISTS section_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS field_id   TEXT NULL;

-- One signature per (inspection, section, field) when field-keyed; legacy
-- role-keyed rows (field_id NULL) are unaffected by the partial index.
CREATE UNIQUE INDEX IF NOT EXISTS signatures_inspection_section_field_idx
  ON inspections.signatures (inspection_id, section_id, field_id)
  WHERE field_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
