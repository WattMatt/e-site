-- scripts/db/assert-inspection-assessed-photos.sql
-- Migration 00256: the LV Line Shop Board Audit's 20 top-level photo fields carry `assess: true`,
-- nothing else in the schema changed (md5 against production's schema on 2026-10-27, before the
-- migration), the Snag List photo is not assessed, and no stored answer was written.
-- Run (red without the migration, green with it):
--   printf 'SELECT 1;\n' > /tmp/noop.sql
--   scripts/db/dry-run-migration.sh /tmp/noop.sql scripts/db/assert-inspection-assessed-photos.sql
--   scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00256_inspection_lv_line_shop_assessed_photos.sql \
--     scripts/db/assert-inspection-assessed-photos.sql
SELECT * FROM (
  SELECT 'LV Line Shop 1.0: all 20 top-level photo fields are assessed' AS "check",
         coalesce((SELECT count(*) = 20
                     FROM inspections.templates t, jsonb_path_query(t.schema_json, '$.sections[*].fields[*] ? (@.type == "photo")') f
                    WHERE t.id = '0e44af07-c5bd-466b-8189-487bfd13c9bc'::uuid AND (f->>'assess')::boolean), false) AS ok
  UNION ALL
  SELECT 'LV Line Shop 1.0: no top-level photo field is left unassessed',
         coalesce((SELECT count(*) = 0
                     FROM inspections.templates t, jsonb_path_query(t.schema_json, '$.sections[*].fields[*] ? (@.type == "photo")') f
                    WHERE t.id = '0e44af07-c5bd-466b-8189-487bfd13c9bc'::uuid AND NOT coalesce((f->>'assess')::boolean, false)), false)
  UNION ALL
  SELECT 'LV Line Shop 1.0: assess appears on exactly 20 fields in the whole schema (nothing but the photos)',
         coalesce((SELECT count(*) = 20 FROM inspections.templates t, jsonb_path_query(t.schema_json, 'strict $.**.fields[*] ? (@.assess == true)') f
                    WHERE t.id = '0e44af07-c5bd-466b-8189-487bfd13c9bc'::uuid), false)
  UNION ALL
  SELECT 'LV Line Shop 1.0: the Snag List photo (inside the group) is not assessed',
         coalesce((SELECT NOT jsonb_path_exists(t.schema_json, '$.sections[*].fields[*].fields[*] ? (@.assess == true)')
                     AND jsonb_path_exists(t.schema_json, '$.sections[*] ? (@.section_id == "snags").fields[*] ? (@.field_id == "snag_list").fields[*] ? (@.type == "photo")')
                     FROM inspections.templates t WHERE t.id = '0e44af07-c5bd-466b-8189-487bfd13c9bc'::uuid), false)
  UNION ALL
  SELECT 'LV Line Shop 1.0: nothing else changed (schema minus assess = the pre-migration schema)',
         coalesce((SELECT md5(jsonb_set(t.schema_json, '{sections}', (
                     SELECT jsonb_agg(jsonb_set(s, '{fields}', coalesce((SELECT jsonb_agg((f - 'assess') ORDER BY fi) FROM jsonb_array_elements(s->'fields') WITH ORDINALITY fx(f, fi)), '[]'::jsonb)) ORDER BY si)
                       FROM jsonb_array_elements(t.schema_json->'sections') WITH ORDINALITY sx(s, si)))::text) = '7597cdecb9bac1c4ec23d99833c0b285'
                     AND t.is_active AND t.version = '1.0' AND t.template_id = 'lv-line-shop-board-audit'
                     FROM inspections.templates t WHERE t.id = '0e44af07-c5bd-466b-8189-487bfd13c9bc'::uuid), false)
  UNION ALL
  SELECT 'LV Line Shop: 1.0 is still the only row of this template (no new version was minted)',
         coalesce((SELECT count(*) = 1 FROM inspections.templates t WHERE t.template_id = 'lv-line-shop-board-audit'), false)
  UNION ALL
  SELECT 'No other template carries assess',
         coalesce((SELECT NOT EXISTS (SELECT 1 FROM inspections.templates t WHERE t.id <> '0e44af07-c5bd-466b-8189-487bfd13c9bc'::uuid AND jsonb_path_exists(t.schema_json, 'strict $.**.fields[*] ? (@.assess == true)'))), false)
  UNION ALL
  SELECT 'Precondition: no certified or abandoned inspection uses the edited row',
         coalesce((SELECT NOT EXISTS (SELECT 1 FROM inspections.inspections i WHERE i.template_id = '0e44af07-c5bd-466b-8189-487bfd13c9bc'::uuid AND i.status IN ('certified', 'abandoned'))), false)
  UNION ALL
  -- True before and after: the migration writes no answer. A result lives in pass_state /
  -- value_bool only; the comment "fail" typed on normal_main_cable_gland stays a comment.
  SELECT 'No answer on this template holds a result (pass_state / value_bool are all NULL); the typed "fail" is a comment',
         coalesce((SELECT count(*) FILTER (WHERE r.pass_state IS NOT NULL OR r.value_bool IS NOT NULL) = 0
                     AND count(*) FILTER (WHERE r.field_id = 'normal_main_cable_gland' AND r.value_text = 'fail') = 1
                     FROM inspections.responses r JOIN inspections.inspections i ON i.id = r.inspection_id
                    WHERE i.template_id = '0e44af07-c5bd-466b-8189-487bfd13c9bc'::uuid), false)
  UNION ALL
  SELECT 'trg_template_immutability is enabled again',
         coalesce((SELECT tgenabled = 'O' FROM pg_trigger WHERE tgname = 'trg_template_immutability'), false)
) x;
