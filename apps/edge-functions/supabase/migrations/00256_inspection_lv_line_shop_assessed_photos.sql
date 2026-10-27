-- 00256_inspection_lv_line_shop_assessed_photos.sql
--
-- Owner decision, 2026-10-27, for the Low Voltage Line Shop Board Audit: every photo item is
-- assessed. On the capture page each one gets Pass / Fail / N/A, a comment that is always shown
-- (where and why; it doubles as the reason when there is no photo) and "Mark up where" on a
-- photo. A Fail FAILS the inspection (packages/shared engine: verdictFailure on a photo field
-- with `assess`). A required assessed item needs a result before submit; the photo itself never
-- blocks (00253's rule for photos is unchanged).
--
-- This applies to the OPEN inspections too, so the change is made IN PLACE on the one active row
-- (id 0e44af07-c5bd-466b-8189-487bfd13c9bc, version 1.0). Production 2026-10-27: 3 inspections
-- use it (2 in progress, 1 awaiting verification), none certified or abandoned, so no closed
-- result can shift under the edit; the immutability trigger is disabled for this one UPDATE, as
-- 00253 and 00255 did. The UPDATE refuses the row if a certified or abandoned inspection has
-- appeared on it since (a new version would be needed then, as 00255 did for Line Shop Handover).
--
-- What changes: `"assess": true` on the 20 top-level photo fields (sections normal_board_images,
-- emergency_board_images, component_images, normal_wiring_images, emergency_wiring_images).
-- The Snag List's photo (a sub-field of the snag_list group) is NOT assessed: a snag carries its
-- own risk, which already fails the inspection at high/critical. Nothing else in the schema
-- changes; scripts/db/assert-inspection-assessed-photos.sql proves it by md5 against the
-- pre-migration schema.
--
-- Stored answers are untouched. A result is read from pass_state / value_bool only
-- (assessedResult); value_text is the comment. One in-progress inspection has value_text 'fail'
-- on normal_main_cable_gland with no pass_state: after this migration it is a comment, not a
-- result, and the item still needs Pass / Fail / N/A before resubmit.
--
-- On a database without this row (local, CI) the UPDATE matches nothing and does nothing.
--
-- @verify:begin
-- sql: (SELECT count(*) = 20 FROM inspections.templates t, jsonb_path_query(t.schema_json, '$.sections[*].fields[*] ? (@.type == "photo")') f WHERE t.id = '0e44af07-c5bd-466b-8189-487bfd13c9bc'::uuid AND (f->>'assess')::boolean)
-- sql: (SELECT NOT EXISTS (SELECT 1 FROM inspections.templates t, jsonb_path_query(t.schema_json, '$.sections[*].fields[*] ? (@.type == "photo")') f WHERE t.id = '0e44af07-c5bd-466b-8189-487bfd13c9bc'::uuid AND NOT coalesce((f->>'assess')::boolean, false)))
-- sql: (SELECT NOT jsonb_path_exists(t.schema_json, '$.sections[*].fields[*].fields[*] ? (@.assess == true)') FROM inspections.templates t WHERE t.id = '0e44af07-c5bd-466b-8189-487bfd13c9bc'::uuid)
-- sql: (SELECT tgenabled = 'O' FROM pg_trigger WHERE tgname = 'trg_template_immutability')
-- behaviour: the row is its old schema plus `assess: true` on the 20 top-level photo fields, nothing else, and no answer changed; proven by scripts/db/assert-inspection-assessed-photos.sql
-- @verify:end

ALTER TABLE inspections.templates DISABLE TRIGGER trg_template_immutability;

UPDATE inspections.templates t
   SET schema_json = jsonb_set(t.schema_json, '{sections}', (
     SELECT jsonb_agg(
              jsonb_set(s, '{fields}', coalesce((
                SELECT jsonb_agg(
                         CASE WHEN f->>'type' = 'photo' THEN f || '{"assess": true}'::jsonb ELSE f END
                         ORDER BY fi)
                  FROM jsonb_array_elements(s->'fields') WITH ORDINALITY AS fx(f, fi)), '[]'::jsonb))
              ORDER BY si)
       FROM jsonb_array_elements(t.schema_json->'sections') WITH ORDINALITY AS sx(s, si)))
 WHERE t.id = '0e44af07-c5bd-466b-8189-487bfd13c9bc'::uuid
   AND t.template_id = 'lv-line-shop-board-audit'
   AND NOT EXISTS (SELECT 1 FROM inspections.inspections i
                    WHERE i.template_id = t.id AND i.status IN ('certified', 'abandoned'));

ALTER TABLE inspections.templates ENABLE TRIGGER trg_template_immutability;
