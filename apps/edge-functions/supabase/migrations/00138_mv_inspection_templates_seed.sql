-- 00138_mv_inspection_templates_seed.sql
-- Seed the 5 canonical Medium Voltage inspection templates into
-- inspections.templates for the WM-Consulting organisation
-- (dddddddd-0000-0000-0000-000000000001), all under category 'medium_voltage'.
--
-- Each schema_json is the EXACT contents of the corresponding canonical file
-- in packages/shared/src/inspections/mv-templates/, embedded as a dollar-quoted
-- literal (dollar-json tag) cast to jsonb. A drift-guard test
-- (packages/shared/src/inspections/mv-templates/mv-templates.test.ts) deep-equals
-- every embedded block against the canonical MV_TEMPLATES export, so this file
-- must stay byte-for-byte faithful to those JSON documents.
--
-- Idempotent: ON CONFLICT (organisation_id, template_id, version) DO NOTHING,
-- so re-running this migration never creates duplicate rows.

-- mv-cable-test-certificate
INSERT INTO inspections.templates
  (organisation_id, template_id, version, name, applies_to_node_types, node_subtypes,
   sans_reference, deliverable_type, schema_json, category, is_active)
VALUES (
  'dddddddd-0000-0000-0000-000000000001',
  'mv-cable-test-certificate', '1.0', 'MV Cable Test Certificate (VLF)',
  ARRAY['source','any'], ARRAY['mv_switchgear'],
  'SANS 1507 / SANS 97 / SANS 0198', 'inspection_only',
  $json${
  "template_id": "mv-cable-test-certificate",
  "name": "MV Cable Test Certificate (VLF)",
  "version": "1.0",
  "applies_to_node_types": ["source", "any"],
  "node_subtypes": ["mv_switchgear"],
  "sans_reference": "SANS 1507 / SANS 97 / SANS 0198",
  "deliverable_type": "inspection_only",
  "sections": [
    {
      "section_id": "contractor",
      "title": "Contractor",
      "fields": [
        { "field_id": "contractor_name", "label": "Contractor name", "type": "text" },
        { "field_id": "vat_no", "label": "VAT No", "type": "text" },
        { "field_id": "contractor_no", "label": "Contractor No", "type": "text" },
        { "field_id": "address", "label": "Address", "type": "textarea" },
        { "field_id": "email", "label": "Email", "type": "text" },
        { "field_id": "cell", "label": "Cell", "type": "text" }
      ]
    },
    {
      "section_id": "test_details",
      "title": "Test details",
      "fields": [
        { "field_id": "test_date", "label": "Date", "type": "date" },
        { "field_id": "order_no", "label": "Order No", "type": "text" },
        { "field_id": "res_charge_no", "label": "R.E.S / Charge No", "type": "text" },
        { "field_id": "cable_between", "label": "Cable between (A) and (B)", "type": "text" },
        { "field_id": "test_method", "label": "Test method", "type": "dropdown", "options": ["VLF", "DC HV"], "default_value": "VLF" },
        { "field_id": "instrument_used", "label": "Instrument used", "type": "text", "help_text": "e.g. HVA30 VLF & DC HV Test System" },
        { "field_id": "serial_no", "label": "Instrument serial No", "type": "text" },
        { "field_id": "calibration_expires", "label": "Calibration expires", "type": "date" },
        { "field_id": "location_of_test", "label": "Location of test", "type": "text" },
        { "field_id": "cable_type_insulation", "label": "Cable type & insulation", "type": "text", "help_text": "e.g. XLPE 50mm² Al" },
        { "field_id": "insulation_resistance_ohms", "label": "Insulation resistance", "type": "number", "unit": "Ω" },
        { "field_id": "rated_voltage", "label": "Rated test voltage", "type": "text", "help_text": "e.g. 22 kV rms, 0.1 Hz" },
        { "field_id": "duration_min", "label": "Duration", "type": "number", "unit": "min" }
      ]
    },
    {
      "section_id": "results",
      "title": "Results",
      "fields": [
        { "field_id": "test_phase_to_earth", "label": "Test phase ↔ earth", "type": "pass_fail" },
        { "field_id": "test_phase_to_phase", "label": "Test phase ↔ phase", "type": "pass_fail" },
        { "field_id": "test_completed_successfully", "label": "Test completed successfully", "type": "pass_fail", "help_text": "Standards: SANS 1507, SANS 97, SANS 0198 (part XIII). Acceptance criterion is typically a percentage of the relevant SANS test value — confirm against the current edition of the cited standards." }
      ]
    },
    {
      "section_id": "sign_off",
      "title": "Sign-off",
      "fields": [
        { "field_id": "signature", "label": "Signature", "type": "signature" }
      ]
    }
  ]
}
$json$::jsonb,
  'medium_voltage', true
)
ON CONFLICT (organisation_id, template_id, version) WHERE organisation_id IS NOT NULL DO NOTHING;

-- mv-megger-insulation-test
INSERT INTO inspections.templates
  (organisation_id, template_id, version, name, applies_to_node_types, node_subtypes,
   sans_reference, deliverable_type, schema_json, category, is_active)
VALUES (
  'dddddddd-0000-0000-0000-000000000001',
  'mv-megger-insulation-test', '1.0', 'Megger (Insulation) Test Record Sheet',
  ARRAY['source','any'], ARRAY['mv_switchgear'],
  'SANS 10142-2', 'inspection_only',
  $json${
  "template_id": "mv-megger-insulation-test",
  "name": "Megger (Insulation) Test Record Sheet",
  "version": "1.0",
  "applies_to_node_types": ["source", "any"],
  "node_subtypes": ["mv_switchgear"],
  "sans_reference": "SANS 10142-2",
  "deliverable_type": "inspection_only",
  "sections": [
    {
      "section_id": "details",
      "title": "Details",
      "fields": [
        { "field_id": "res_charge_no", "label": "R.E.S / Charge No", "type": "text" },
        { "field_id": "area", "label": "Area", "type": "text" },
        { "field_id": "unit_no", "label": "Unit No", "type": "text" },
        { "field_id": "contractor", "label": "Contractor", "type": "text" },
        { "field_id": "project_title", "label": "Project Title", "type": "text" },
        { "field_id": "conditions_note", "label": "Conditions", "type": "textarea", "help_text": "State switch/transformer state, e.g. 'All switches closed and transformers open.'" }
      ]
    },
    {
      "section_id": "mv_busbar",
      "title": "MV Busbar",
      "fields": [
        { "field_id": "test_voltage", "label": "Test voltage", "type": "number", "unit": "kV", "help_text": "e.g. 24 kV for 1 minute." },
        { "field_id": "duration", "label": "Duration", "type": "number", "unit": "min" },
        { "field_id": "busbar_reading_unit", "label": "Reading unit", "type": "dropdown", "options": ["GΩ", "MΩ"] },
        { "field_id": "red_white", "label": "RED → WHITE", "type": "number" },
        { "field_id": "red_blue", "label": "RED → BLUE", "type": "number" },
        { "field_id": "white_blue", "label": "WHITE → BLUE", "type": "number" },
        { "field_id": "red_earth", "label": "RED → EARTH", "type": "number" },
        { "field_id": "white_earth", "label": "WHITE → EARTH", "type": "number" },
        { "field_id": "blue_earth", "label": "BLUE → EARTH", "type": "number" },
        { "field_id": "tested_by", "label": "Tested by", "type": "text" },
        { "field_id": "date", "label": "Date", "type": "date" }
      ]
    },
    {
      "section_id": "mv_cable",
      "title": "MV Cable",
      "fields": [
        {
          "field_id": "cable",
          "label": "Cable",
          "type": "repeating_group",
          "item_label_template": "{{cable_id}}",
          "help_text": "e.g. 24 kV for 15 min, 0.1 Hz.",
          "fields": [
            { "field_id": "cable_id", "label": "Cable ID / description", "type": "text" },
            { "field_id": "voltage", "label": "Test voltage", "type": "number", "unit": "kV" },
            { "field_id": "duration", "label": "Duration", "type": "number", "unit": "min" },
            { "field_id": "frequency", "label": "Frequency", "type": "text", "default_value": "0.1 Hz" },
            { "field_id": "cable_reading_unit", "label": "Reading unit", "type": "dropdown", "options": ["GΩ", "MΩ"] },
            { "field_id": "red_white", "label": "RED → WHITE", "type": "number" },
            { "field_id": "red_blue", "label": "RED → BLUE", "type": "number" },
            { "field_id": "white_blue", "label": "WHITE → BLUE", "type": "number" },
            { "field_id": "rwb_earth", "label": "RWB → EARTH", "type": "number" },
            { "field_id": "tested_by", "label": "Tested by", "type": "text" },
            { "field_id": "date", "label": "Date", "type": "date" }
          ]
        }
      ]
    },
    {
      "section_id": "sign_off",
      "title": "Sign-off",
      "fields": [
        { "field_id": "signature", "label": "Signature", "type": "signature" }
      ]
    }
  ]
}
$json$::jsonb,
  'medium_voltage', true
)
ON CONFLICT (organisation_id, template_id, version) WHERE organisation_id IS NOT NULL DO NOTHING;

-- mv-phasing-test-record
INSERT INTO inspections.templates
  (organisation_id, template_id, version, name, applies_to_node_types, node_subtypes,
   sans_reference, deliverable_type, schema_json, category, is_active)
VALUES (
  'dddddddd-0000-0000-0000-000000000001',
  'mv-phasing-test-record', '1.0', 'Phasing Test Record Sheet',
  ARRAY['source','any'], ARRAY['mv_switchgear'],
  'SANS 10142-2', 'inspection_only',
  $json${
  "template_id": "mv-phasing-test-record",
  "name": "Phasing Test Record Sheet",
  "version": "1.0",
  "applies_to_node_types": ["source", "any"],
  "node_subtypes": ["mv_switchgear"],
  "sans_reference": "SANS 10142-2",
  "deliverable_type": "inspection_only",
  "sections": [
    {
      "section_id": "details",
      "title": "Details",
      "fields": [
        { "field_id": "res_charge_no", "label": "R.E.S / Charge No", "type": "text" },
        { "field_id": "area", "label": "Area", "type": "text" },
        { "field_id": "unit_no", "label": "Unit No", "type": "text", "default_value": "Medium voltage" },
        { "field_id": "contractor", "label": "Contractor", "type": "text" },
        { "field_id": "project_title", "label": "Project Title", "type": "text" }
      ]
    },
    {
      "section_id": "phasing_tests",
      "title": "Phasing tests",
      "fields": [
        {
          "field_id": "equipment_item",
          "label": "Equipment item",
          "type": "repeating_group",
          "min_count": 1,
          "item_label_template": "{{equipment_description}}",
          "help_text": "On a correctly-phased system: like→like = 0 kV; cross-phase = line voltage (e.g. 11 kV).",
          "fields": [
            { "field_id": "equipment_description", "label": "Equipment description (e.g. Spoor–OHL MV Cable)", "type": "text" },
            { "field_id": "red_red", "label": "RED → RED", "type": "number", "unit": "kV" },
            { "field_id": "red_blue", "label": "RED → BLUE", "type": "number", "unit": "kV" },
            { "field_id": "red_white", "label": "RED → WHITE", "type": "number", "unit": "kV" },
            { "field_id": "white_white", "label": "WHITE → WHITE", "type": "number", "unit": "kV" },
            { "field_id": "white_blue", "label": "WHITE → BLUE", "type": "number", "unit": "kV" },
            { "field_id": "white_red", "label": "WHITE → RED", "type": "number", "unit": "kV" },
            { "field_id": "blue_blue", "label": "BLUE → BLUE", "type": "number", "unit": "kV" },
            { "field_id": "blue_red", "label": "BLUE → RED", "type": "number", "unit": "kV" },
            { "field_id": "blue_white", "label": "BLUE → WHITE", "type": "number", "unit": "kV" },
            { "field_id": "tested_by", "label": "Tested by", "type": "text" },
            { "field_id": "date", "label": "Date", "type": "date" }
          ]
        }
      ]
    },
    {
      "section_id": "sign_off",
      "title": "Sign-off",
      "fields": [
        { "field_id": "signature", "label": "Signature (Contractor)", "type": "signature" },
        { "field_id": "copies_to", "label": "Copies to", "type": "text" }
      ]
    }
  ]
}
$json$::jsonb,
  'medium_voltage', true
)
ON CONFLICT (organisation_id, template_id, version) WHERE organisation_id IS NOT NULL DO NOTHING;

-- mv-protection-settings-summary
INSERT INTO inspections.templates
  (organisation_id, template_id, version, name, applies_to_node_types, node_subtypes,
   sans_reference, deliverable_type, schema_json, category, is_active)
VALUES (
  'dddddddd-0000-0000-0000-000000000001',
  'mv-protection-settings-summary', '1.0', 'MV Protection Settings Summary',
  ARRAY['source','any'], ARRAY['mv_switchgear'],
  'SANS 10142-2', 'inspection_only',
  $json${
  "template_id": "mv-protection-settings-summary",
  "name": "MV Protection Settings Summary",
  "version": "1.0",
  "applies_to_node_types": ["source", "any"],
  "node_subtypes": ["mv_switchgear"],
  "sans_reference": "SANS 10142-2",
  "deliverable_type": "inspection_only",
  "sections": [
    {
      "section_id": "network",
      "title": "Network",
      "fields": [
        { "field_id": "voltage_kv", "label": "Voltage", "type": "number", "unit": "kV" },
        { "field_id": "fault_level_ka", "label": "Fault level", "type": "number", "unit": "kA" },
        { "field_id": "default_relay", "label": "Default relay", "type": "text", "default_value": "P122", "help_text": "Default relay device (e.g. Schneider MiCOM P122)." },
        { "field_id": "default_curve", "label": "Default curve", "type": "dropdown", "options": ["SI", "VI", "EI", "DT"], "default_value": "SI", "help_text": "IEC/IEEE curve: SI (Standard Inverse), VI (Very Inverse), EI (Extremely Inverse), DT (Definite Time). High-set (I>>) stage left blank where not applied. Pick-ups are primary amps. Verify Panel-5 low values against the issued document." }
      ]
    },
    {
      "section_id": "relay_settings",
      "title": "Relay settings",
      "fields": [
        {
          "field_id": "relay_feeder",
          "label": "Relay / feeder",
          "type": "repeating_group",
          "min_count": 1,
          "item_label_template": "Panel {{panel}} — {{feeder}}",
          "fields": [
            { "field_id": "panel", "label": "Panel", "type": "text" },
            { "field_id": "feeder", "label": "Feeder / description", "type": "text" },
            { "field_id": "relay", "label": "Relay device", "type": "text", "default_value": "P122" },
            { "field_id": "cable_size", "label": "Cable", "type": "text", "help_text": "e.g. 185mm" },
            { "field_id": "ctr", "label": "CT ratio", "type": "text", "help_text": "e.g. 400/1" },
            { "field_id": "oc_lowset_curve", "label": "O/C I> (low-set) curve", "type": "dropdown", "options": ["SI", "VI", "EI", "DT"], "default_value": "SI", "help_text": "IEC/IEEE curve for the low-set overcurrent stage." },
            { "field_id": "oc_lowset_pu", "label": "O/C I> (low-set) pick-up", "type": "number", "unit": "A", "help_text": "Pick-up, primary amps." },
            { "field_id": "oc_lowset_tm", "label": "O/C I> (low-set) time multiplier", "type": "number", "help_text": "Time multiplier." },
            { "field_id": "oc_highset_curve", "label": "O/C I>> (high-set) curve", "type": "dropdown", "options": ["SI", "VI", "EI", "DT"], "help_text": "IEC/IEEE curve for the high-set overcurrent stage. Leave blank where not applied." },
            { "field_id": "oc_highset_pu", "label": "O/C I>> (high-set) pick-up", "type": "number", "unit": "A", "help_text": "Pick-up, primary amps." },
            { "field_id": "oc_highset_tm", "label": "O/C I>> (high-set) time multiplier", "type": "number", "help_text": "Time multiplier." },
            { "field_id": "ef_curve", "label": "E/F Io> curve", "type": "dropdown", "options": ["SI", "VI", "EI", "DT"], "default_value": "SI", "help_text": "IEC/IEEE curve for the earth-fault stage." },
            { "field_id": "ef_pu", "label": "E/F Io> pick-up", "type": "number", "unit": "A", "help_text": "Pick-up, primary amps." },
            { "field_id": "ef_tm", "label": "E/F Io> time multiplier", "type": "number", "help_text": "Time multiplier." }
          ]
        }
      ]
    }
  ]
}
$json$::jsonb,
  'medium_voltage', true
)
ON CONFLICT (organisation_id, template_id, version) WHERE organisation_id IS NOT NULL DO NOTHING;

-- mv-safety-report-annex-b
INSERT INTO inspections.templates
  (organisation_id, template_id, version, name, applies_to_node_types, node_subtypes,
   sans_reference, deliverable_type, schema_json, category, is_active)
VALUES (
  'dddddddd-0000-0000-0000-000000000001',
  'mv-safety-report-annex-b', '1.0', 'MV Installation Safety Report — SANS 10142-2 Annex B',
  ARRAY['source','any'], ARRAY['mv_switchgear','substation'],
  'SANS 10142-2 Annex B', 'coc',
  $json${
  "template_id": "mv-safety-report-annex-b",
  "name": "MV Installation Safety Report — SANS 10142-2 Annex B",
  "version": "1.0",
  "applies_to_node_types": ["source", "any"],
  "node_subtypes": ["mv_switchgear", "substation"],
  "sans_reference": "SANS 10142-2 Annex B",
  "deliverable_type": "coc",
  "sections": [
    {
      "section_id": "declaration",
      "title": "Declaration",
      "fields": [
        { "field_id": "declaration_statement", "label": "Declaration", "type": "header", "help_text": "Design approved per SANS 10142-2 and installation safe for operation as intended." },
        { "field_id": "ip_note", "label": "Issuing note", "type": "header", "help_text": "This is the statutory Annex B form published in SANS 10142-2. Issue on the official SANS Annex B blank; this is for data capture only and intentionally does not reproduce the standard's checklist wording." },
        { "field_id": "registered_person_signature", "label": "Registered person — signature", "type": "signature", "required_qualifications": ["registered_person"] },
        { "field_id": "ecsa_reg_no", "label": "ECSA Professional Registration No", "type": "text" },
        { "field_id": "physical_address", "label": "Physical address", "type": "text" },
        { "field_id": "telephone", "label": "Telephone", "type": "text" },
        { "field_id": "cellular", "label": "Cellular", "type": "text" },
        { "field_id": "contractor_signature", "label": "Contractor — signature", "type": "signature" },
        { "field_id": "contractor_name", "label": "Contractor name", "type": "text" },
        { "field_id": "business_registration", "label": "Business registration", "type": "text" },
        { "field_id": "eir_registration_no", "label": "Registration No (Electrical Installation Regulations)", "type": "text" },
        { "field_id": "telephone_c", "label": "Telephone (contractor)", "type": "text" },
        { "field_id": "cellular_c", "label": "Cellular (contractor)", "type": "text" }
      ]
    },
    {
      "section_id": "installation_details",
      "title": "Installation details",
      "fields": [
        { "field_id": "installation_name", "label": "Installation name", "type": "text" },
        { "field_id": "gps_coordinates", "label": "GPS coordinates", "type": "text" },
        { "field_id": "municipality", "label": "Municipality", "type": "text" },
        { "field_id": "supply_authority", "label": "Supply authority", "type": "text" },
        { "field_id": "voltage_kv", "label": "Voltage", "type": "number", "unit": "kV" },
        { "field_id": "fault_level_ka", "label": "Fault level", "type": "number", "unit": "kA" },
        { "field_id": "sld_description", "label": "Feeder configuration (per SLD)", "type": "textarea" },
        { "field_id": "continuation_notes", "label": "Continuation / additional notes", "type": "textarea", "help_text": "SANS 10142-2 Annex B.1.3 — any additional notes." }
      ]
    },
    {
      "section_id": "inspection_checklist",
      "title": "Inspection checklist",
      "fields": [
        {
          "field_id": "checklist_item",
          "label": "Checklist item",
          "type": "repeating_group",
          "item_label_template": "{{clause_ref}}",
          "help_text": "Populate clause_ref from the SANS 10142-2 Annex B.2 numbered items; do not transcribe the standard's wording.",
          "fields": [
            { "field_id": "clause_ref", "label": "Clause ref", "type": "text" },
            { "field_id": "result", "label": "Result", "type": "pass_fail" },
            { "field_id": "comment", "label": "Comment", "type": "text" }
          ]
        }
      ]
    },
    {
      "section_id": "test_results",
      "title": "Test results",
      "fields": [
        { "field_id": "earth_resistance_ohm", "label": "Earth resistance", "type": "number", "unit": "Ω" },
        { "field_id": "earth_instrument", "label": "Earth instrument", "type": "text" },
        { "field_id": "insulation_resistance", "label": "Insulation resistance", "type": "number", "help_text": "e.g. KEW4106 / KEW416" },
        { "field_id": "insulation_instrument", "label": "Insulation instrument", "type": "text" },
        { "field_id": "continuity", "label": "Continuity", "type": "pass_fail" },
        { "field_id": "phase_rotation", "label": "Phase rotation", "type": "dropdown", "options": ["R,W,B", "R,B,W"] }
      ]
    },
    {
      "section_id": "acceptance",
      "title": "Acceptance",
      "fields": [
        { "field_id": "accepted_by_signature", "label": "Accepted by — signature", "type": "signature" },
        { "field_id": "acceptance_date", "label": "Acceptance date", "type": "date" }
      ]
    }
  ]
}
$json$::jsonb,
  'medium_voltage', true
)
ON CONFLICT (organisation_id, template_id, version) WHERE organisation_id IS NOT NULL DO NOTHING;

NOTIFY pgrst, 'reload schema';
