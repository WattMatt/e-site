-- assert-whatsapp-files.sql — WhatsApp drawings/documents/reports act as the person (sub-projects 3 + 4).
--   scripts/db/dry-run-migration.sh scripts/db/fixtures/noop.sql scripts/db/assert-whatsapp-files.sql                        (red)
--   scripts/db/dry-run-migration.sh scripts/db/whatsapp-files/whatsapp_files_reports.sql scripts/db/assert-whatsapp-files.sql (green)
-- Fixtures are real production rows picked by query; nothing persists (rolled back by the harness).
CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO service_role;

DO $$
DECLARE
  c_org CONSTANT uuid := 'dddddddd-0000-0000-0000-000000000001';
  v_con uuid; v_own uuid; v_foreign uuid; v_admin uuid;
  v_own_plan uuid; v_own_plan_name text; v_foreign_plan uuid; v_term text;
  j jsonb; v_n int; v_ok boolean;
  v_admin_kinds text[]; v_con_kinds text[]; v_restricted uuid;
BEGIN
  -- a contractor with exactly one active WM membership, on a site that has drawings
  SELECT pm.user_id, min(pm.project_id::text)::uuid INTO v_con, v_own
    FROM projects.project_members pm
    JOIN public.user_organisations uo ON uo.user_id = pm.user_id AND uo.organisation_id = c_org AND uo.is_active AND uo.role = 'contractor'
   WHERE pm.is_active AND pm.organisation_id = c_org
     AND EXISTS (SELECT 1 FROM tenants.floor_plans f WHERE f.project_id = pm.project_id AND f.is_active)
   GROUP BY pm.user_id HAVING count(*) = 1 LIMIT 1;
  IF v_con IS NULL THEN RAISE EXCEPTION 'fixture: no single-site contractor with drawings'; END IF;
  SELECT f.id, f.name INTO v_own_plan, v_own_plan_name FROM tenants.floor_plans f
   WHERE f.project_id = v_own AND f.is_active ORDER BY f.updated_at DESC LIMIT 1;
  SELECT f.project_id, f.id INTO v_foreign, v_foreign_plan FROM tenants.floor_plans f
   WHERE f.organisation_id = c_org AND f.is_active AND f.project_id <> v_own LIMIT 1;
  SELECT uo.user_id INTO v_admin FROM public.user_organisations uo
   WHERE uo.organisation_id = c_org AND uo.is_active AND uo.role = 'admin' LIMIT 1;
  -- a distinctive search term: the longest word of the newest own drawing's name
  SELECT w INTO v_term FROM regexp_split_to_table(v_own_plan_name, '[^A-Za-z0-9.]+') w ORDER BY length(w) DESC LIMIT 1;

  SET LOCAL ROLE service_role;

  -- ── drawings & documents ──
  j := whatsapp.wa_project_files(v_con, v_own, '');
  INSERT INTO _r VALUES ('contractor lists own-site files (1..10)', jsonb_array_length(j) BETWEEN 1 AND 10);
  INSERT INTO _r VALUES ('newest own drawing is first', j->0->>'id' = v_own_plan::text);
  j := whatsapp.wa_project_files(v_con, v_foreign, '');
  INSERT INTO _r VALUES ('contractor lists 0 files on a foreign site', jsonb_array_length(j) = 0);
  j := whatsapp.wa_project_files(v_admin, v_foreign, '');
  INSERT INTO _r VALUES ('admin lists files on that site (control)', jsonb_array_length(j) >= 1);
  j := whatsapp.wa_project_files(v_con, v_own, v_term);
  SELECT bool_and(e->>'name' ILIKE '%' || v_term || '%'), count(*) INTO v_ok, v_n FROM jsonb_array_elements(j) e;
  INSERT INTO _r VALUES ('search returns only matching names, including the source drawing',
    v_ok AND v_n >= 1 AND j @> jsonb_build_array(jsonb_build_object('id', v_own_plan::text)));
  j := whatsapp.wa_project_files(v_con, v_own, '%');
  SELECT count(*) INTO v_n FROM jsonb_array_elements(j) e WHERE e->>'name' NOT LIKE '%\%%';
  INSERT INTO _r VALUES ('a % in the search is literal, not a wildcard', v_n = 0);

  j := whatsapp.wa_file(v_con, 'p', v_own_plan);
  INSERT INTO _r VALUES ('own drawing resolves to the drawings bucket', j->>'code' = 'ok' AND j->>'bucket' = 'drawings' AND (j->>'path') IS NOT NULL);
  j := whatsapp.wa_file(v_con, 'p', v_foreign_plan);
  INSERT INTO _r VALUES ('foreign drawing is not_found for the contractor', j->>'code' = 'not_found');
  j := whatsapp.wa_file(v_admin, 'p', v_foreign_plan);
  INSERT INTO _r VALUES ('foreign drawing resolves for an admin (control)', j->>'code' = 'ok');
  j := whatsapp.wa_file(v_con, 'x', v_own_plan);
  INSERT INTO _r VALUES ('unknown file kind is not_found', j->>'code' = 'not_found');

  -- ── reports ──
  j := whatsapp.wa_project_reports(v_admin, v_own);
  SELECT coalesce(array_agg(e->>'kind'), '{}') INTO v_admin_kinds FROM jsonb_array_elements(j->'reports') e;
  j := whatsapp.wa_project_reports(v_con, v_own);
  SELECT coalesce(array_agg(e->>'kind'), '{}') INTO v_con_kinds FROM jsonb_array_elements(j->'reports') e;
  INSERT INTO _r VALUES ('contractor report kinds are a subset of the admin''s', v_con_kinds <@ v_admin_kinds);
  INSERT INTO _r VALUES ('contractor never sees equipment_materials or valuation reports',
    NOT (v_con_kinds && ARRAY['equipment_materials', 'valuation']));
  j := whatsapp.wa_project_reports(v_con, v_foreign);
  INSERT INTO _r VALUES ('contractor sees no reports and no cable schedule on a foreign site',
    jsonb_array_length(j->'reports') = 0 AND (j->>'cable_schedule')::boolean = false);

  SELECT r.id INTO v_restricted FROM projects.reports r
   WHERE r.project_id = v_own AND r.status = 'issued' AND r.kind IN ('equipment_materials', 'valuation') LIMIT 1;
  IF v_restricted IS NOT NULL THEN
    INSERT INTO _r VALUES ('a restricted report is not_found for the contractor', (whatsapp.wa_report(v_con, v_restricted))->>'code' = 'not_found');
    INSERT INTO _r VALUES ('a restricted report resolves for an admin (control)', (whatsapp.wa_report(v_admin, v_restricted))->>'code' = 'ok');
  END IF;

  RESET ROLE;
  INSERT INTO _r VALUES ('signed-in users cannot call the functions directly',
    NOT has_function_privilege('authenticated', 'whatsapp.wa_file(uuid,text,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'whatsapp.wa_project_files(uuid,uuid,text)', 'EXECUTE'));
END $$;

SELECT k AS check, v AS ok FROM _r ORDER BY k;
