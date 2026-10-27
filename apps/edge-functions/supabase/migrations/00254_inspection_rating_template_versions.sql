-- 00254_inspection_rating_template_versions.sql
--
-- New template versions in which the checks the owner approved on 2026-10-27 become Ratings
-- (Good / Fair / Poor; Poor fails the inspection — 00253 / packages/shared engine). 26 fields
-- across 7 templates; every other field is unchanged. The 31 safety yes/no checks stay
-- pass/fail records that never fail (owner decision, same day).
--
-- Why new versions, not in place: a Rating stores value_text where a pass/fail stored value_bool,
-- so converting a template that open inspections use would orphan their answers. Each existing
-- inspection keeps the template row it was created on (capture, certify and the report load the
-- template by id, never by is_active). New inspections pick the new versions: the older versions
-- of these 7 templates are deactivated, which only hides them from the new-inspection picker.
--
-- Base = the latest ACTIVE version of each template. FAT Inspection Report: 1.3 (active, unused),
-- not 1.2 (the one in use), so 1.3's own changes are kept.
--
-- Fields are matched by section_id/field_id, read from production on 2026-10-27; each is a
-- pass_fail field there (the block below leaves anything else untouched). On a database without
-- these organisation templates (local, CI) every statement matches no row and does nothing.
--
--   template                                   base -> new   ratings
--   Distribution Board Inspection              1.0 -> 1.1   1
--   Miniature Substation Inspection Report     1.0 -> 1.1   4
--   Miniature Substation Pre-FAT and Post-FAT  1.1 -> 1.2   6
--   Factory Acceptance Test (FAT) Inspection Report 1.3 -> 1.4   1
--   Electrical Main Board (EMB) Inspection     1.3 -> 1.4   1
--   RMU Snagging & Compliance Report           1.1 -> 1.2   10
--   Generator Installation Inspection          1.1 -> 1.2   3
--
-- @verify:begin
-- sql: (SELECT count(*) = 7 FROM inspections.templates t WHERE t.is_active AND (t.organisation_id, t.template_id, t.version) IN (('dddddddd-0000-0000-0000-000000000001'::uuid, 'distribution-board-inspection', '1.1'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'miniature-substation-inspection', '1.1'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'mini-sub-pre-post-fat', '1.2'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'fat-inspection-report', '1.4'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'electrical-main-board-inspection', '1.4'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'rmu-snagging', '1.2'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'generator-installation-nrs048', '1.2')))
-- sql: (SELECT count(*) = 26 FROM inspections.templates t, jsonb_path_query(t.schema_json, 'strict $.**.fields[*] ? (@.type == "rating")') f WHERE (t.organisation_id, t.template_id, t.version) IN (('dddddddd-0000-0000-0000-000000000001'::uuid, 'distribution-board-inspection', '1.1'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'miniature-substation-inspection', '1.1'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'mini-sub-pre-post-fat', '1.2'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'fat-inspection-report', '1.4'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'electrical-main-board-inspection', '1.4'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'rmu-snagging', '1.2'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'generator-installation-nrs048', '1.2')))
-- sql: (SELECT NOT EXISTS (SELECT 1 FROM inspections.templates t WHERE t.is_active AND (t.organisation_id, t.template_id) IN (('dddddddd-0000-0000-0000-000000000001'::uuid, 'distribution-board-inspection'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'miniature-substation-inspection'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'mini-sub-pre-post-fat'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'fat-inspection-report'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'electrical-main-board-inspection'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'rmu-snagging'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'generator-installation-nrs048')) AND (t.organisation_id, t.template_id, t.version) NOT IN (('dddddddd-0000-0000-0000-000000000001'::uuid, 'distribution-board-inspection', '1.1'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'miniature-substation-inspection', '1.1'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'mini-sub-pre-post-fat', '1.2'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'fat-inspection-report', '1.4'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'electrical-main-board-inspection', '1.4'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'rmu-snagging', '1.2'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'generator-installation-nrs048', '1.2'))))
-- behaviour: each new version differs from its base only in the approved fields' type and the version string; proven by scripts/db/assert-inspection-rating-templates.sql
-- @verify:end

-- One block, no helper functions: for each template, copy its base version with the named
-- pass_fail fields ("<section_id>/<field_id>") turned into ratings, in section fields and
-- subsection fields, keeping every other key and every other field as it is.
DO $do$
DECLARE
  r      RECORD;
  v_out  JSONB;
  v_secs JSONB;
  v_subs JSONB;
  v_fs   JSONB;
  s      JSONB;
  ss     JSONB;
  f      JSONB;
BEGIN
  FOR r IN
    SELECT t.*, e.next, e.keys
      FROM (VALUES
        ('dddddddd-0000-0000-0000-000000000001'::uuid, 'distribution-board-inspection', '1.0', '1.1', ARRAY['visual_inspection/enclosure_condition']::text[]),
        ('dddddddd-0000-0000-0000-000000000001'::uuid, 'miniature-substation-inspection', '1.0', '1.1', ARRAY['visual_structural_checks/enclosure_integrity', 'visual_structural_checks/plinth_condition', 'visual_structural_checks/perimeter_fence', 'electrical_functional_thermal_checks/bushing_condition']::text[]),
        ('dddddddd-0000-0000-0000-000000000001'::uuid, 'mini-sub-pre-post-fat', '1.1', '1.2', ARRAY['electrical_details/cable_lug_crimping', 'electrical_details/busbar_connection_torque', 'visual/enclosure_physical', 'visual/cable_entries', 'visual/ventilation_louvers', 'visual/locking_mechanisms']::text[]),
        ('dddddddd-0000-0000-0000-000000000001'::uuid, 'fat-inspection-report', '1.3', '1.4', ARRAY['physical_inspection/workmanship']::text[]),
        ('dddddddd-0000-0000-0000-000000000001'::uuid, 'electrical-main-board-inspection', '1.3', '1.4', ARRAY['control_voltage_checks/discharge_test']::text[]),
        ('dddddddd-0000-0000-0000-000000000001'::uuid, 'rmu-snagging', '1.1', '1.2', ARRAY['physical_checks/housing_corrosion', 'physical_checks/weatherproofing_seal', 'physical_checks/foundation_plinth', 'physical_checks/cable_gland_plates', 'electrical_checks/insulator_contamination', 'electrical_checks/busbar_connections', 'electrical_checks/gas_pressure', 'electrical_checks/ct_vt_condition', 'electrical_checks/protection_relay', 'electrical_checks/battery_tripping_unit']::text[]),
        ('dddddddd-0000-0000-0000-000000000001'::uuid, 'generator-installation-nrs048', '1.1', '1.2', ARRAY['physical_inspection/generator_enclosure_condition', 'physical_inspection/exhaust_cooling_systems_checked', 'physical_inspection/fuel_system_inspection']::text[])
           ) AS e(org, template_id, base, next, keys)
      JOIN inspections.templates t
        ON t.organisation_id = e.org AND t.template_id = e.template_id AND t.version = e.base
     WHERE NOT EXISTS (SELECT 1 FROM inspections.templates x
                        WHERE x.organisation_id = e.org AND x.template_id = e.template_id AND x.version = e.next)
  LOOP
    v_secs := '[]'::jsonb;
    FOR s IN SELECT value FROM jsonb_array_elements(r.schema_json->'sections') WITH ORDINALITY ORDER BY ordinality LOOP
      IF jsonb_typeof(s->'fields') = 'array' AND jsonb_array_length(s->'fields') > 0 THEN
        v_fs := '[]'::jsonb;
        FOR f IN SELECT value FROM jsonb_array_elements(s->'fields') WITH ORDINALITY ORDER BY ordinality LOOP
          IF (s->>'section_id') || '/' || (f->>'field_id') = ANY(r.keys) AND f->>'type' = 'pass_fail' THEN
            f := f || '{"type": "rating"}'::jsonb;
          END IF;
          v_fs := v_fs || jsonb_build_array(f);
        END LOOP;
        s := jsonb_set(s, '{fields}', v_fs);
      END IF;
      IF jsonb_typeof(s->'subsections') = 'array' AND jsonb_array_length(s->'subsections') > 0 THEN
        v_subs := '[]'::jsonb;
        FOR ss IN SELECT value FROM jsonb_array_elements(s->'subsections') WITH ORDINALITY ORDER BY ordinality LOOP
          IF jsonb_typeof(ss->'fields') = 'array' AND jsonb_array_length(ss->'fields') > 0 THEN
            v_fs := '[]'::jsonb;
            FOR f IN SELECT value FROM jsonb_array_elements(ss->'fields') WITH ORDINALITY ORDER BY ordinality LOOP
              IF (s->>'section_id') || '/' || (f->>'field_id') = ANY(r.keys) AND f->>'type' = 'pass_fail' THEN
                f := f || '{"type": "rating"}'::jsonb;
              END IF;
              v_fs := v_fs || jsonb_build_array(f);
            END LOOP;
            ss := jsonb_set(ss, '{fields}', v_fs);
          END IF;
          v_subs := v_subs || jsonb_build_array(ss);
        END LOOP;
        s := jsonb_set(s, '{subsections}', v_subs);
      END IF;
      v_secs := v_secs || jsonb_build_array(s);
    END LOOP;
    v_out := jsonb_set(r.schema_json, '{sections}', v_secs) || jsonb_build_object('version', r.next);

    INSERT INTO inspections.templates (organisation_id, template_id, version, name, applies_to_node_types, node_subtypes,
                                       sans_reference, deliverable_type, schema_json, is_active, description, category)
    VALUES (r.organisation_id, r.template_id, r.next, r.name, r.applies_to_node_types, r.node_subtypes,
            r.sans_reference, r.deliverable_type, v_out, true, r.description, r.category);
  END LOOP;
END $do$;

-- Older versions leave the new-inspection picker; inspections created on them are unaffected.
-- Only for templates whose new version now exists.
UPDATE inspections.templates t
   SET is_active = false
 WHERE t.is_active
   AND (t.organisation_id, t.template_id) IN (
         SELECT n.organisation_id, n.template_id FROM inspections.templates n
          WHERE (n.organisation_id, n.template_id, n.version) IN (('dddddddd-0000-0000-0000-000000000001'::uuid, 'distribution-board-inspection', '1.1'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'miniature-substation-inspection', '1.1'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'mini-sub-pre-post-fat', '1.2'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'fat-inspection-report', '1.4'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'electrical-main-board-inspection', '1.4'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'rmu-snagging', '1.2'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'generator-installation-nrs048', '1.2')))
   AND (t.organisation_id, t.template_id, t.version) NOT IN (('dddddddd-0000-0000-0000-000000000001'::uuid, 'distribution-board-inspection', '1.1'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'miniature-substation-inspection', '1.1'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'mini-sub-pre-post-fat', '1.2'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'fat-inspection-report', '1.4'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'electrical-main-board-inspection', '1.4'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'rmu-snagging', '1.2'), ('dddddddd-0000-0000-0000-000000000001'::uuid, 'generator-installation-nrs048', '1.2'));
