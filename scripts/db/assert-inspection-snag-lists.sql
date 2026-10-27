-- scripts/db/assert-inspection-snag-lists.sql
-- Migration 00255: every inspection template has the Snag List (high/critical fail), LV Line Shop's
-- quality scores 1-2 fail, and nothing else changed. Expected checksums are production's
-- schemas on 2026-10-27, before the migration.
-- Run (red without the migration, green with it):
--   printf 'SELECT 1;\n' > /tmp/noop.sql
--   scripts/db/dry-run-migration.sh /tmp/noop.sql scripts/db/assert-inspection-snag-lists.sql
--   scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00255_inspection_snag_lists_and_quality_fail.sql \
--     scripts/db/assert-inspection-snag-lists.sql
CREATE TEMP TABLE _rows (id uuid, label text, h text, lv boolean, sig boolean);
INSERT INTO _rows VALUES
  ('c0855579-c2ee-4799-bb6f-98c8cedb655d', 'Distribution Board Inspection 1.0', 'b24a14f7661863bbe2cb4f8850518399', false, false),
  ('28d86014-4f59-4f13-bfbf-ebe4a95ff04d', 'Distribution Board Inspection 1.1', 'bb4e5ad490411f4ac366361aa20ad287', false, false),
  ('062cceb3-9dc0-4909-8098-c915d641604c', 'Electrical Installation Certificate (COC) 1.2', '98217b2c5b1bb362dadcf879003460d9', false, true),
  ('53dcc4c5-bfb9-4374-894a-71847bdb30a6', 'Electrical Meter Inspection Report 1.1', '81986a911fbc0baae971279875539aa6', false, false),
  ('6bf6d805-c322-479f-b241-dd37f44099aa', 'Factory Acceptance Test (FAT) Inspection Report 1.2', 'c1ebe29324830bfbb4df8c1f799458a2', false, false),
  ('ba8a3a57-2519-4c7f-9216-b3fa1ecaf272', 'Generator Factory Acceptance Test 1.1', 'bdf09c483bc03ffa05859b3b2e7a7ee1', false, false),
  ('875cb302-33b8-488f-a137-b415a51678ae', 'Generator Installation Inspection 1.1', 'ffff61caf6808773ec0e0014d946dd7a', false, false),
  ('7ac8eb1a-5ae3-423f-8f57-79c9667d14cf', 'Generator Installation Inspection 1.2', 'ce723af1d7d0834a1cd4d3fd4bdee9e7', false, false),
  ('0e44af07-c5bd-466b-8189-487bfd13c9bc', 'Low Voltage Line Shop Board Audit 1.0', 'b532ad35ff6b3dc0f6754767242aa36b', true, false),
  ('5218a607-d536-4a8c-b2af-f3267fab85eb', 'LV Board — Certificate of Compliance 1.0', '9e6eceaa5506a2d9cd9e091ba4645c1b', false, true),
  ('9ea07e16-7fbd-4377-8b3d-9c945a4a4481', 'MAIN BOARD FAT 1.4', '8831ad25ad013378af7c571467dc2cac', false, false),
  ('c6b285f6-ad65-462d-a90b-fcc1e3cd0147', 'Megger (Insulation) Test Record Sheet 1.0', '3b35a6f7fc652fb302d55f43e7e84ca8', false, true),
  ('6b991e32-36af-4869-a2cd-138f7ea52b45', 'Miniature Substation Inspection Report 1.0', '6b3dc10875d536df4df0bcec6e9f5cda', false, true),
  ('7042cac5-2647-4f85-983d-94ec5c2a5b3e', 'Miniature Substation Inspection Report 1.1', 'c4669675eaa6296b2f4a5404f688c398', false, true),
  ('4025fbf1-3f96-4ec3-89e1-4562a128b0d0', 'Miniature Substation Pre-FAT and Post-FAT 1.1', 'be7df32a2da83fd1cc269f0e016f0a22', false, false),
  ('f5c5cd3f-780a-4145-a34c-414c38afae0f', 'Miniature Substation Pre-FAT and Post-FAT 1.2', '5629992cca60b09adebc0d01e9adbdb6', false, false),
  ('cb6e830f-c2f8-4157-ae2b-446b3b48ed78', 'MV Cable Test Certificate (VLF) 1.0', 'd8c3d25e09c98196882e031e6ff035c3', false, true),
  ('d35e9a96-1e91-469f-b81d-8ff8980c5556', 'MV Installation Safety Report — SANS 10142-2 Annex B 1.0', 'b896cb90a13a02a5b8087fb44f5582f5', false, true),
  ('0ac2fdd4-7361-49fe-b2bf-b521efb38df8', 'MV Protection Settings Summary 1.0', '08b22e974264a277fb9bd1ced01cb640', false, false),
  ('923793d1-5672-42de-b247-2441c4fb2595', 'Phasing Test Record Sheet 1.0', '61d43f6ade93f925f55f8842bd3bf46c', false, true),
  ('ba143747-0b2c-4f41-ba0a-2534f021c1fa', 'RMU Snagging & Compliance Report 1.1', 'b03e3baf0817feb3f3e64d6f0804f118', false, false),
  ('4368ca9a-7b0c-47c5-870a-a7fc635f64ad', 'RMU Snagging & Compliance Report 1.2', 'cfaa7cbc94852eb7c4f8429bb59315dd', false, false),
  ('9bab5dc6-c997-4008-b491-40bd29311749', 'Site Drawing Inspection 1.1', '20de64c4aaed3b236f4a4423f149e3b7', false, false),
  ('55225369-c6c5-4fc3-942f-aaecd9c5a04c', 'Site Summary Report 1.1', 'af3e65537670d809c1311516a157e886', false, false),
  ('fd0925b8-780a-4881-8460-6548eaeb477b', 'Standalone Solar PV Installation Inspection 1.1', '8d41f814f0ad14c8ee675084ec4776fc', false, false),
  ('2f7feedb-9130-4a6d-9d8f-485185daa59f', 'Standard Progress Report 1.1', 'd626a6b0d56c318676ba1fc1b39486a8', false, false);

SELECT * FROM (
  SELECT r.label || ': one Snag List, high/critical fail' AS "check",
         coalesce((SELECT count(*) = 1 FROM inspections.templates t, jsonb_path_query(t.schema_json, '$.sections[*] ? (@.section_id == "snags")') s
                    WHERE t.id = r.id
                      AND jsonb_path_exists(s, '$.fields[*] ? (@.field_id == "snag_list").fields[*] ? (@.field_id == "risk_level" && @.fail_values[*] == "high" && @.fail_values[*] == "critical")')), false) AS ok
    FROM _rows r
  UNION ALL
  SELECT r.label || ': Snag List ' || CASE WHEN r.sig THEN 'just before the sign-off section' ELSE 'last' END,
         coalesce((SELECT (t.schema_json #>> ARRAY['sections', (jsonb_array_length(t.schema_json->'sections') - CASE WHEN r.sig THEN 2 ELSE 1 END)::text, 'section_id']) = 'snags'
                     FROM inspections.templates t WHERE t.id = r.id), false)
    FROM _rows r
  UNION ALL
  -- The LV row also strips `assess` from its top-level fields: 00256 adds it to the 20 photo items.
  SELECT r.label || ': nothing else changed',
         coalesce((SELECT md5((CASE WHEN r.lv THEN (jsonb_set(t.schema_json, '{sections}', (SELECT jsonb_agg(jsonb_set(x, '{fields}', coalesce((SELECT jsonb_agg((f - 'assess') ORDER BY fi) FROM jsonb_array_elements(x->'fields') WITH ORDINALITY ff(f, fi)), '[]'::jsonb)) ORDER BY o) FROM jsonb_array_elements(t.schema_json->'sections') WITH ORDINALITY e(x, o) WHERE x->>'section_id' <> 'snags'))) #- ARRAY['sections', '5', 'fields', '1', 'fail_values'] ELSE jsonb_set(t.schema_json, '{sections}', (SELECT jsonb_agg(x ORDER BY o) FROM jsonb_array_elements(t.schema_json->'sections') WITH ORDINALITY e(x, o) WHERE x->>'section_id' <> 'snags')) END)::text) = r.h
                     FROM inspections.templates t WHERE t.id = r.id), false)
    FROM _rows r
  UNION ALL
  SELECT 'LV Line Shop quality rating: 1 and 2 fail',
         coalesce((SELECT t.schema_json #> ARRAY['sections', '5', 'fields', '1', 'fail_values'] = '["1", "2"]'::jsonb
                     FROM inspections.templates t WHERE t.id = '0e44af07-c5bd-466b-8189-487bfd13c9bc'::uuid), false)
  UNION ALL
  SELECT 'Line Shop Handover 1.0 (under a certified inspection) is untouched and inactive',
         coalesce((SELECT NOT t.is_active AND md5(t.schema_json::text) = 'f08afdd9c536d3527d5bcdb3eb774fa9' FROM inspections.templates t WHERE t.id = '90c0df73-b053-4908-8b06-c1846453e8a4'::uuid), false)
  UNION ALL
  SELECT 'Line Shop Handover 1.1 is 1.0 plus the Snag List, active',
         coalesce((SELECT n.is_active AND md5((jsonb_set(n.schema_json, '{sections}', (SELECT jsonb_agg(x ORDER BY o) FROM jsonb_array_elements(n.schema_json->'sections') WITH ORDINALITY e(x, o) WHERE x->>'section_id' <> 'snags')) || jsonb_build_object('version', '1.0'))::text) = 'f08afdd9c536d3527d5bcdb3eb774fa9'
                     FROM inspections.templates n WHERE n.organisation_id = 'dddddddd-0000-0000-0000-000000000001'::uuid AND n.template_id = 'line-shop-handover' AND n.version = '1.1'), false)
  UNION ALL
  SELECT 'the certified inspection still uses Line Shop Handover 1.0',
         NOT EXISTS (SELECT 1 FROM inspections.inspections i WHERE i.status = 'certified' AND i.template_id <> '90c0df73-b053-4908-8b06-c1846453e8a4'::uuid
                       AND i.template_id IN (SELECT id FROM inspections.templates WHERE template_id = 'line-shop-handover'))
  UNION ALL
  SELECT 'the template immutability trigger is back on', (SELECT tgenabled = 'O' FROM pg_trigger WHERE tgname = 'trg_template_immutability')
) z;
