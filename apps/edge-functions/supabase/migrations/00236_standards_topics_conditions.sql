-- =============================================================================
-- Migration 00236 — Standards reference: topics and printed conditions
-- =============================================================================
-- The /standards page becomes an engineering lookup grouped by topic, and every
-- extracted table shows the conditions it is valid for (ambient and conductor
-- temperature, depth of burial, soil resistivity …) as printed beside it.
--
--   * sans_tables.topic       cable_ratings | volt_drop | derating |
--                             earthing_protection | building_energy
--   * sans_tables.conditions  [{ key, label, unit, value, page_pdf, page_printed }]
--                             read from the PDF by scripts/standards/extract.ts
--
-- An extracted table must carry both, and every condition must cite its page —
-- enforced here. The legacy tables get their topic from their category.
--
-- NO TABLE DATA IN THIS FILE (public repo, licensed standards): the existing
-- extracted tables are given an empty conditions array here and re-stamped from
-- the PDF by scripts/standards/load.ts after this applies.
-- =============================================================================

ALTER TABLE cable_schedule.sans_tables
    ADD COLUMN IF NOT EXISTS topic      TEXT,
    ADD COLUMN IF NOT EXISTS conditions JSONB;

ALTER TABLE cable_schedule.sans_tables DROP CONSTRAINT IF EXISTS sans_tables_topic_check;
ALTER TABLE cable_schedule.sans_tables ADD CONSTRAINT sans_tables_topic_check
    CHECK (topic IS NULL OR topic IN ('cable_ratings', 'volt_drop', 'derating', 'earthing_protection', 'building_energy'));

-- Legacy tables: topic from the category 00059 stamped.
UPDATE cable_schedule.sans_tables SET topic = CASE
    WHEN category = 'MASTER_PROPERTIES' THEN 'cable_ratings'
    WHEN category LIKE 'DERATING_%'     THEN 'derating'
    WHEN category IN ('EARTH_FAULT_RATING', 'CONDUCTOR_PROPERTIES') THEN 'earthing_protection'
  END
 WHERE topic IS NULL AND provenance = 'transcribed';

-- Extracted tables so far are the derating suite; conditions are re-read from the PDF by the loader.
UPDATE cable_schedule.sans_tables
   SET topic = coalesce(topic, 'derating'), conditions = coalesce(conditions, '[]'::jsonb)
 WHERE provenance = 'extracted';

-- coalesce(…, false) throughout: a CHECK that evaluates to NULL passes.
ALTER TABLE cable_schedule.sans_tables DROP CONSTRAINT IF EXISTS sans_tables_extracted_has_topic_conditions;
ALTER TABLE cable_schedule.sans_tables ADD CONSTRAINT sans_tables_extracted_has_topic_conditions
    CHECK (provenance <> 'extracted' OR coalesce(topic IS NOT NULL AND jsonb_typeof(conditions) = 'array', false));

-- Malformed input (a non-array, or non-object elements) makes this return false or
-- raise inside the CHECK — either way the write is refused, never accepted.
CREATE OR REPLACE FUNCTION cable_schedule.reference_conditions_cited(c JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT c IS NULL OR (
    jsonb_typeof(c) = 'array'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(c) e
       WHERE NOT coalesce(
               jsonb_typeof(e) = 'object'
               AND btrim(coalesce(e->>'label', '')) <> ''
               AND btrim(coalesce(e->>'value', '')) <> ''
               AND jsonb_typeof(e->'page_pdf') = 'number'
               AND jsonb_typeof(e->'page_printed') = 'number', false)))
$$;
REVOKE EXECUTE ON FUNCTION cable_schedule.reference_conditions_cited(JSONB) FROM PUBLIC, anon;

ALTER TABLE cable_schedule.sans_tables DROP CONSTRAINT IF EXISTS sans_tables_conditions_cited;
ALTER TABLE cable_schedule.sans_tables ADD CONSTRAINT sans_tables_conditions_cited
    CHECK (cable_schedule.reference_conditions_cited(conditions));

NOTIFY pgrst, 'reload schema';

-- @verify:begin
-- column: cable_schedule.sans_tables.topic
-- column: cable_schedule.sans_tables.conditions
-- constraint: sans_tables_topic_check ON cable_schedule.sans_tables
-- constraint: sans_tables_extracted_has_topic_conditions ON cable_schedule.sans_tables
-- constraint: sans_tables_conditions_cited ON cable_schedule.sans_tables
-- function: cable_schedule.reference_conditions_cited(jsonb)
-- sql: (SELECT count(*) = 0 FROM cable_schedule.sans_tables WHERE topic IS NULL)
-- sql: (SELECT count(*) = 0 FROM cable_schedule.sans_tables WHERE provenance = 'extracted' AND NOT cable_schedule.reference_conditions_cited(conditions))
-- behaviour: scripts/db/assert-standards-topics-conditions.sql, every row ok
-- @verify:end
