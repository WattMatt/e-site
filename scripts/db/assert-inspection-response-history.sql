-- scripts/db/assert-inspection-response-history.sql
-- An inspection answer saved by a signed-in user must land, with its history row, attributed to
-- the person who saved it. Before the fix every such insert failed: the history trigger ran as the
-- caller and inspections.response_history has a SELECT policy and no INSERT policy.
-- Run (red against a no-op, green with the fix):
--   scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/<NNNNN>_inspection_response_history_definer.sql \
--     scripts/db/assert-inspection-response-history.sql

-- C = the rbac-test contractor, active on KINGSWALK. A real client viewer and their project.
SELECT set_config('x.c', '018f2d31-bbe8-4cc1-bbdd-63af0187081e', true);
SELECT set_config('x.kw', (SELECT pm.project_id::text FROM projects.project_members pm
                            WHERE pm.user_id = current_setting('x.c')::uuid AND pm.is_active
                            ORDER BY pm.created_at LIMIT 1), true);
SELECT set_config('x.org', (SELECT organisation_id::text FROM projects.projects WHERE id = current_setting('x.kw')::uuid), true);
SELECT set_config('x.tmpl', (SELECT id::text FROM inspections.templates WHERE is_active ORDER BY created_at LIMIT 1), true);
SELECT set_config('x.cv', (SELECT pm.user_id::text FROM projects.project_members pm
                            WHERE pm.is_active AND public.user_effective_project_role(pm.project_id, pm.user_id) = 'client_viewer'
                            ORDER BY pm.created_at LIMIT 1), true);
SELECT set_config('x.someone', (SELECT id::text FROM public.profiles WHERE id <> current_setting('x.c')::uuid ORDER BY created_at LIMIT 1), true);
DO $$ BEGIN
  IF current_setting('x.kw', true) IS NULL OR current_setting('x.tmpl', true) IS NULL OR current_setting('x.cv', true) IS NULL THEN
    RAISE EXCEPTION 'fixture precondition failed: KINGSWALK, an active template or a client viewer is missing';
  END IF;
END $$;

WITH ins AS (INSERT INTO inspections.inspections (organisation_id, project_id, template_id, target_node_type, target_label, assigned_to_id, status, created_by)
  VALUES (current_setting('x.org')::uuid, current_setting('x.kw')::uuid, current_setting('x.tmpl')::uuid, 'adhoc', 'history probe',
          current_setting('x.c')::uuid, 'assigned', current_setting('x.c')::uuid) RETURNING id)
SELECT set_config('x.insp', (SELECT id::text FROM ins), true);

CREATE TEMP TABLE _o (k text PRIMARY KEY, v text);
GRANT ALL ON _o TO authenticated;

-- 1. C saves an answer the way upsertResponseAction does, but claims someone else wrote it.
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('x.c'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  INSERT INTO inspections.responses (inspection_id, section_id, field_id, value_text, latest_responded_by, latest_responded_at)
  VALUES (current_setting('x.insp')::uuid, 'probe_section', 'probe_field', 'first', current_setting('x.someone')::uuid, now());
  INSERT INTO _o VALUES ('insert', 'ok');
EXCEPTION WHEN OTHERS THEN INSERT INTO _o VALUES ('insert', SQLERRM);
END $$;
DO $$ BEGIN
  UPDATE inspections.responses SET value_text = 'second', latest_responded_by = current_setting('x.c')::uuid
   WHERE inspection_id = current_setting('x.insp')::uuid AND field_id = 'probe_field';
  INSERT INTO _o VALUES ('update', 'ok');
EXCEPTION WHEN OTHERS THEN INSERT INTO _o VALUES ('update', SQLERRM);
END $$;
-- C cannot write history directly.
DO $$ BEGIN
  INSERT INTO inspections.response_history (inspection_id, section_id, field_id, value_text, responded_by, responded_at)
  VALUES (current_setting('x.insp')::uuid, 'probe_section', 'forged', 'x', current_setting('x.c')::uuid, now());
  INSERT INTO _o VALUES ('direct_history', 'ok');
EXCEPTION WHEN OTHERS THEN INSERT INTO _o VALUES ('direct_history', SQLERRM);
END $$;
RESET ROLE;

-- 2. A client viewer still cannot answer.
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('x.cv'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  INSERT INTO inspections.responses (inspection_id, section_id, field_id, value_text, latest_responded_by)
  VALUES (current_setting('x.insp')::uuid, 'probe_section', 'cv_field', 'x', current_setting('x.cv')::uuid);
  INSERT INTO _o VALUES ('cv_insert', 'ok');
EXCEPTION WHEN OTHERS THEN INSERT INTO _o VALUES ('cv_insert', SQLERRM);
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

SELECT * FROM (VALUES
  ('a contributor can save an answer',          (SELECT v FROM _o WHERE k = 'insert') = 'ok'),
  ('a contributor can change an answer',        (SELECT v FROM _o WHERE k = 'update') = 'ok'),
  ('both saves are in the history',             (SELECT count(*) = 2 FROM inspections.response_history
                                                   WHERE inspection_id = current_setting('x.insp')::uuid AND field_id = 'probe_field')),
  ('history names the signed-in author, not the claimed one',
                                                NOT EXISTS (SELECT 1 FROM inspections.response_history
                                                   WHERE inspection_id = current_setting('x.insp')::uuid AND field_id = 'probe_field'
                                                     AND responded_by IS DISTINCT FROM current_setting('x.c')::uuid)),
  ('the first answer moved the status forward', (SELECT status = 'in_progress' FROM inspections.inspections WHERE id = current_setting('x.insp')::uuid)),
  ('history cannot be written directly',        (SELECT v FROM _o WHERE k = 'direct_history') <> 'ok'),
  ('a client viewer still cannot answer',       (SELECT v FROM _o WHERE k = 'cv_insert') <> 'ok'),
  ('the trigger function is SECURITY DEFINER',  (SELECT prosecdef FROM pg_proc WHERE oid = 'inspections.append_response_history()'::regprocedure)),
  ('it pins search_path',                       (SELECT proconfig::text LIKE '%search_path=%' FROM pg_proc WHERE oid = 'inspections.append_response_history()'::regprocedure)),
  ('authenticated cannot call it',              NOT has_function_privilege('authenticated', 'inspections.append_response_history()', 'EXECUTE')),
  ('anon cannot call it',                       NOT has_function_privilege('anon', 'inspections.append_response_history()', 'EXECUTE'))
) AS t("check", ok);
