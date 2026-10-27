-- 00255_inspection_snag_lists_and_quality_fail.sql
--
-- Owner decisions, 2026-10-27, after "I still can't pass or fail" on the LV Line Shop audit:
--   1. Low Voltage Line Shop Board Audit: "Overall Quality Rating (1-5)" scores 1 and 2 FAIL the
--      inspection (fail_values ['1','2']). It was a plain dropdown, so nothing could fail it.
--   2. Every inspection template gets the EMB-style Snag List (description, risk
--      low/medium/high/critical, photo); a high or critical snag FAILS the inspection. Only EMB
--      had one. The list is optional: no snags, no effect.
--   3. Both apply to the OPEN inspections too, so the change is made in place on every active
--      template row and every row an open inspection uses. Adding an optional section and a
--      fail_values key changes no stored answer. The immutability trigger exists so a closed
--      result never shifts under an edit, so rows used by a certified or abandoned inspection
--      are NOT edited: Line Shop Handover 1.0 (1 certified) gets a new version 1.1 instead, and
--      1.0 is deactivated (it stays attached to its certified inspection).
--
-- The Snag List is the last section, or the one before it when the last section is a sign-off
-- (has a signature field), so snags are not recorded after signing.
--
-- Production 2026-10-27: 27 rows without a snag list (26 in place, 1 new version).
-- One LV Line Shop inspection awaits verification with quality 2: it will now FAIL, and the
-- verifier sends it back (certify refuses a fail).
--
-- @verify:begin
-- sql: (SELECT count(*) = 26 FROM inspections.templates t WHERE t.id IN ('c0855579-c2ee-4799-bb6f-98c8cedb655d'::uuid, '28d86014-4f59-4f13-bfbf-ebe4a95ff04d'::uuid, '062cceb3-9dc0-4909-8098-c915d641604c'::uuid, '53dcc4c5-bfb9-4374-894a-71847bdb30a6'::uuid, '6bf6d805-c322-479f-b241-dd37f44099aa'::uuid, 'ba8a3a57-2519-4c7f-9216-b3fa1ecaf272'::uuid, '875cb302-33b8-488f-a137-b415a51678ae'::uuid, '7ac8eb1a-5ae3-423f-8f57-79c9667d14cf'::uuid, '0e44af07-c5bd-466b-8189-487bfd13c9bc'::uuid, '5218a607-d536-4a8c-b2af-f3267fab85eb'::uuid, '9ea07e16-7fbd-4377-8b3d-9c945a4a4481'::uuid, 'c6b285f6-ad65-462d-a90b-fcc1e3cd0147'::uuid, '6b991e32-36af-4869-a2cd-138f7ea52b45'::uuid, '7042cac5-2647-4f85-983d-94ec5c2a5b3e'::uuid, '4025fbf1-3f96-4ec3-89e1-4562a128b0d0'::uuid, 'f5c5cd3f-780a-4145-a34c-414c38afae0f'::uuid, 'cb6e830f-c2f8-4157-ae2b-446b3b48ed78'::uuid, 'd35e9a96-1e91-469f-b81d-8ff8980c5556'::uuid, '0ac2fdd4-7361-49fe-b2bf-b521efb38df8'::uuid, '923793d1-5672-42de-b247-2441c4fb2595'::uuid, 'ba143747-0b2c-4f41-ba0a-2534f021c1fa'::uuid, '4368ca9a-7b0c-47c5-870a-a7fc635f64ad'::uuid, '9bab5dc6-c997-4008-b491-40bd29311749'::uuid, '55225369-c6c5-4fc3-942f-aaecd9c5a04c'::uuid, 'fd0925b8-780a-4881-8460-6548eaeb477b'::uuid, '2f7feedb-9130-4a6d-9d8f-485185daa59f'::uuid) AND jsonb_path_exists(t.schema_json, '$.sections[*] ? (@.section_id == "snags").fields[*] ? (@.field_id == "snag_list").fields[*] ? (@.field_id == "risk_level" && @.fail_values[*] == "critical")'))
-- sql: (SELECT bool_and(t.schema_json::text LIKE '%"fail_values": ["1", "2"]%') FROM inspections.templates t WHERE t.organisation_id = 'dddddddd-0000-0000-0000-000000000001'::uuid AND t.template_id = 'lv-line-shop-board-audit' AND t.is_active)
-- sql: (SELECT t.is_active AND position('"snag_list"' in t.schema_json::text) > 0 FROM inspections.templates t WHERE t.organisation_id = 'dddddddd-0000-0000-0000-000000000001'::uuid AND t.template_id = 'line-shop-handover' AND t.version = '1.1')
-- sql: (SELECT NOT t.is_active AND md5(t.schema_json::text) = 'f08afdd9c536d3527d5bcdb3eb774fa9' FROM inspections.templates t WHERE t.id = '90c0df73-b053-4908-8b06-c1846453e8a4'::uuid)
-- sql: (SELECT tgenabled = 'O' FROM pg_trigger WHERE tgname = 'trg_template_immutability')
-- behaviour: each edited row is its old schema plus the Snag List section (and, for LV Line Shop, fail_values 1/2), nothing else; proven by scripts/db/assert-inspection-snag-lists.sql
-- @verify:end

ALTER TABLE inspections.templates DISABLE TRIGGER trg_template_immutability;

DO $do$
DECLARE
  r     RECORD;
  v_new JSONB;
  v_sig BOOLEAN;
BEGIN
  FOR r IN SELECT t.id, t.schema_json FROM inspections.templates t
            WHERE t.id IN ('c0855579-c2ee-4799-bb6f-98c8cedb655d'::uuid,
                           '28d86014-4f59-4f13-bfbf-ebe4a95ff04d'::uuid,
                           '062cceb3-9dc0-4909-8098-c915d641604c'::uuid,
                           '53dcc4c5-bfb9-4374-894a-71847bdb30a6'::uuid,
                           '6bf6d805-c322-479f-b241-dd37f44099aa'::uuid,
                           'ba8a3a57-2519-4c7f-9216-b3fa1ecaf272'::uuid,
                           '875cb302-33b8-488f-a137-b415a51678ae'::uuid,
                           '7ac8eb1a-5ae3-423f-8f57-79c9667d14cf'::uuid,
                           '0e44af07-c5bd-466b-8189-487bfd13c9bc'::uuid,
                           '5218a607-d536-4a8c-b2af-f3267fab85eb'::uuid,
                           '9ea07e16-7fbd-4377-8b3d-9c945a4a4481'::uuid,
                           'c6b285f6-ad65-462d-a90b-fcc1e3cd0147'::uuid,
                           '6b991e32-36af-4869-a2cd-138f7ea52b45'::uuid,
                           '7042cac5-2647-4f85-983d-94ec5c2a5b3e'::uuid,
                           '4025fbf1-3f96-4ec3-89e1-4562a128b0d0'::uuid,
                           'f5c5cd3f-780a-4145-a34c-414c38afae0f'::uuid,
                           'cb6e830f-c2f8-4157-ae2b-446b3b48ed78'::uuid,
                           'd35e9a96-1e91-469f-b81d-8ff8980c5556'::uuid,
                           '0ac2fdd4-7361-49fe-b2bf-b521efb38df8'::uuid,
                           '923793d1-5672-42de-b247-2441c4fb2595'::uuid,
                           'ba143747-0b2c-4f41-ba0a-2534f021c1fa'::uuid,
                           '4368ca9a-7b0c-47c5-870a-a7fc635f64ad'::uuid,
                           '9bab5dc6-c997-4008-b491-40bd29311749'::uuid,
                           '55225369-c6c5-4fc3-942f-aaecd9c5a04c'::uuid,
                           'fd0925b8-780a-4881-8460-6548eaeb477b'::uuid,
                           '2f7feedb-9130-4a6d-9d8f-485185daa59f'::uuid)
              AND position('"snag_list"' in t.schema_json::text) = 0
  LOOP
    v_sig := jsonb_path_exists(r.schema_json, '$.sections[last].fields[*] ? (@.type == "signature")');
    v_new := jsonb_insert(r.schema_json, '{sections,-1}', '{"section_id":"snags","title":"Snag List","fields":[{"field_id":"snag_list","label":"Snag list","type":"repeating_group","item_label_template":"{{description}} ({{risk_level}})","fields":[{"field_id":"description","label":"Description","type":"textarea","required":true},{"field_id":"risk_level","label":"Risk","type":"dropdown","options":["low","medium","high","critical"],"fail_values":["high","critical"],"required":true},{"field_id":"photo","label":"Photo","type":"photo","min_count":1}]}]}'::jsonb, NOT v_sig);
    UPDATE inspections.templates SET schema_json = v_new WHERE id = r.id;
  END LOOP;
END $do$;

-- LV Line Shop: scores 1 and 2 fail.
UPDATE inspections.templates t
   SET schema_json = jsonb_set(t.schema_json, ARRAY['sections', '5', 'fields', '1', 'fail_values'], '["1", "2"]'::jsonb)
 WHERE t.id = '0e44af07-c5bd-466b-8189-487bfd13c9bc'::uuid
   AND t.schema_json #>> ARRAY['sections', '5', 'fields', '1', 'field_id'] = 'quality_rating';

ALTER TABLE inspections.templates ENABLE TRIGGER trg_template_immutability;

-- Line Shop Handover 1.0 is under a certified inspection: new version 1.1 with the Snag List.
INSERT INTO inspections.templates (organisation_id, template_id, version, name, applies_to_node_types, node_subtypes,
                                   sans_reference, deliverable_type, schema_json, is_active, description, category)
SELECT t.organisation_id, t.template_id, '1.1', t.name, t.applies_to_node_types, t.node_subtypes,
       t.sans_reference, t.deliverable_type,
       jsonb_insert(t.schema_json, '{sections,-1}', '{"section_id":"snags","title":"Snag List","fields":[{"field_id":"snag_list","label":"Snag list","type":"repeating_group","item_label_template":"{{description}} ({{risk_level}})","fields":[{"field_id":"description","label":"Description","type":"textarea","required":true},{"field_id":"risk_level","label":"Risk","type":"dropdown","options":["low","medium","high","critical"],"fail_values":["high","critical"],"required":true},{"field_id":"photo","label":"Photo","type":"photo","min_count":1}]}]}'::jsonb,
                    NOT jsonb_path_exists(t.schema_json, '$.sections[last].fields[*] ? (@.type == "signature")'))
         || jsonb_build_object('version', '1.1'),
       true, t.description, t.category
  FROM inspections.templates t
 WHERE t.id = '90c0df73-b053-4908-8b06-c1846453e8a4'::uuid
   AND NOT EXISTS (SELECT 1 FROM inspections.templates x WHERE x.organisation_id = t.organisation_id
                     AND x.template_id = t.template_id AND x.version = '1.1');
UPDATE inspections.templates SET is_active = false
 WHERE id = '90c0df73-b053-4908-8b06-c1846453e8a4'::uuid
   AND EXISTS (SELECT 1 FROM inspections.templates x WHERE x.organisation_id = 'dddddddd-0000-0000-0000-000000000001'::uuid
                 AND x.template_id = 'line-shop-handover' AND x.version = '1.1');
