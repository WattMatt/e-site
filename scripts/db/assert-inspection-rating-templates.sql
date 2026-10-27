-- scripts/db/assert-inspection-rating-templates.sql
-- Migration 00254: new versions of 7 templates in which 26 owner-approved checks become Ratings.
-- Checks, independently of the migration's own transform:
--   • each new version exists, is active, and is the only active version of its template;
--   • each new version, with "rating" turned back into "pass_fail" and its version string reset,
--     is byte-for-byte its base: nothing else changed;
--   • each approved check, found by its LABEL, is a rating; the rating count per template is right;
--   • every existing inspection still points at the template row it was created on.
-- Run (red without the migration, green with it):
--   printf 'SELECT 1;\n' > /tmp/noop.sql
--   scripts/db/dry-run-migration.sh /tmp/noop.sql scripts/db/assert-inspection-rating-templates.sql
--   scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00254_inspection_rating_template_versions.sql \
--     scripts/db/assert-inspection-rating-templates.sql

-- Which template row every inspection uses, before the migration ran in this transaction is not
-- observable here, so the check is that no inspection points at a new version.
CREATE FUNCTION pg_temp.no_snags(s jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $f$
  SELECT jsonb_set(s, '{sections}', (SELECT jsonb_agg(x ORDER BY o) FROM jsonb_array_elements(s->'sections') WITH ORDINALITY e(x, o)
                                      WHERE x->>'section_id' <> 'snags'))
$f$;
CREATE TEMP TABLE _expect (org uuid, template_id text, base text, next text, labels text[]);
INSERT INTO _expect VALUES
  ('dddddddd-0000-0000-0000-000000000001', 'distribution-board-inspection', '1.0', '1.1', ARRAY['Enclosure condition']),
  ('dddddddd-0000-0000-0000-000000000001', 'miniature-substation-inspection', '1.0', '1.1', ARRAY['Enclosure integrity', 'Plinth condition', 'Perimeter fence', 'Bushing condition']),
  ('dddddddd-0000-0000-0000-000000000001', 'mini-sub-pre-post-fat', '1.1', '1.2', ARRAY['All cable lug crimping and heat shrink', 'Busbar & Connection Torque (Visual)', 'Enclosure Physical', 'Cable Entries', 'Ventilation louvers', 'Locking Mechanisms & Door Hinges']),
  ('dddddddd-0000-0000-0000-000000000001', 'fat-inspection-report', '1.3', '1.4', ARRAY['Workmanship']),
  ('dddddddd-0000-0000-0000-000000000001', 'electrical-main-board-inspection', '1.3', '1.4', ARRAY['Discharge test']),
  ('dddddddd-0000-0000-0000-000000000001', 'rmu-snagging', '1.1', '1.2', ARRAY['Housing Corrosion Assessment (Visual)', 'Weatherproofing & Seal Integrity (Visual)', 'Foundation/Plinth Condition (Visual)', 'Cable Gland Plates & Entry Points (Visual)', 'Insulator Contamination/Damage (Visual)', 'Busbar & Connection Torque (Visual/Thermal)', 'SF6 Gas Pressure/Density Gauge Reading (Visual)', 'CT/VT Condition & Wiring (Visual)', 'Protection Relay Health & Settings (Visual)', 'Battery/Tripping Unit Health (Visual/Test)']),
  ('dddddddd-0000-0000-0000-000000000001', 'generator-installation-nrs048', '1.1', '1.2', ARRAY['Generator enclosure condition', 'Exhaust & cooling systems checked', 'Fuel system inspection']);

SELECT * FROM (
  SELECT 'new version ' || e.template_id || ' ' || e.next || ' exists and is active' AS "check",
         coalesce((SELECT n.is_active FROM inspections.templates n WHERE n.organisation_id = e.org AND n.template_id = e.template_id AND n.version = e.next), false) AS ok
    FROM _expect e
  UNION ALL
  SELECT 'only ' || e.next || ' is active for ' || e.template_id,
         (SELECT count(*) = 1 FROM inspections.templates t WHERE t.organisation_id = e.org AND t.template_id = e.template_id AND t.is_active)
    FROM _expect e
  UNION ALL
  SELECT e.template_id || ' ' || e.next || ' is ' || e.base || ' with only the approved types changed',
         -- 00255 later added a Snag List section to most templates (to a base too, when it was in
         -- use); it is not part of 00254's change, so it is left out of both sides.
         coalesce((SELECT (replace(pg_temp.no_snags(n.schema_json)::text, '"type": "rating"', '"type": "pass_fail"')::jsonb || jsonb_build_object('version', b.schema_json->'version')) = pg_temp.no_snags(b.schema_json)
                     FROM inspections.templates n JOIN inspections.templates b
                       ON b.organisation_id = n.organisation_id AND b.template_id = n.template_id AND b.version = e.base
                    WHERE n.organisation_id = e.org AND n.template_id = e.template_id AND n.version = e.next), false)
    FROM _expect e
  UNION ALL
  SELECT e.template_id || ' ' || e.next || ': every approved check (by label) is a rating, and only those',
         coalesce((SELECT array_agg(f->>'label' ORDER BY f->>'label') = (SELECT array_agg(l ORDER BY l) FROM unnest(e.labels) l)
                     FROM inspections.templates n, jsonb_path_query(n.schema_json, 'strict $.**.fields[*] ? (@.type == "rating")') f
                    WHERE n.organisation_id = e.org AND n.template_id = e.template_id AND n.version = e.next), false)
    FROM _expect e
  UNION ALL
  SELECT 'schema_json.version matches the row version on ' || e.template_id,
         coalesce((SELECT n.schema_json->>'version' = n.version FROM inspections.templates n
                    WHERE n.organisation_id = e.org AND n.template_id = e.template_id AND n.version = e.next), false)
    FROM _expect e
  UNION ALL
  SELECT 'no existing inspection was moved to a new version',
         NOT EXISTS (SELECT 1 FROM inspections.inspections i JOIN inspections.templates n ON n.id = i.template_id
                       JOIN _expect e ON e.org = n.organisation_id AND e.template_id = n.template_id AND e.next = n.version)
  UNION ALL
  SELECT '26 ratings across the new versions',
         (SELECT count(*) = 26 FROM _expect e JOIN inspections.templates n ON n.organisation_id = e.org AND n.template_id = e.template_id AND n.version = e.next,
                 jsonb_path_query(n.schema_json, 'strict $.**.fields[*] ? (@.type == "rating")') f)
) r;
