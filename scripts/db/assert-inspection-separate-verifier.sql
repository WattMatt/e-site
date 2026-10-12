-- scripts/db/assert-inspection-separate-verifier.sql
-- On a template that needs a separate verifier (coc / factory_test, or requires_separate_verifier),
-- the verifier may not be the inspector and may not fill in the inspection (00248). Before it, the
-- rule lived only in certification_blockers(), so "Shoprite" and "Boxer" on ZZ status-guard test
-- (2026-10-12) were built in a state that could never be certified.
--
-- Run (red without the fix, green with it):
--   scripts/db/dry-run-migration.sh /tmp/noop.sql  scripts/db/assert-inspection-separate-verifier.sql
--   scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00248_inspection_separate_verifier_at_assignment.sql scripts/db/assert-inspection-separate-verifier.sql
--
-- C   = the rbac-test contractor, active on KINGSWALK (the inspector).
-- PMU = an org owner/admin/PM with an active project_members row on KINGSWALK (the verifier, a PM).
SELECT set_config('x.c', '018f2d31-bbe8-4cc1-bbdd-63af0187081e', true);
SELECT set_config('x.kw', (SELECT pm.project_id::text FROM projects.project_members pm
                            WHERE pm.user_id = current_setting('x.c')::uuid AND pm.is_active
                            ORDER BY pm.created_at LIMIT 1), true);
SELECT set_config('x.org', (SELECT organisation_id::text FROM projects.projects WHERE id = current_setting('x.kw')::uuid), true);
SELECT set_config('x.pmu', (SELECT pm.user_id::text FROM projects.project_members pm
                             JOIN public.user_organisations uo ON uo.user_id = pm.user_id AND uo.organisation_id = pm.organisation_id
                             WHERE pm.project_id = current_setting('x.kw')::uuid AND pm.is_active AND uo.is_active
                               AND uo.role IN ('owner','admin','project_manager')
                               AND pm.user_id <> current_setting('x.c')::uuid
                             ORDER BY pm.created_at LIMIT 1), true);
-- PM2 = a second owner/admin/PM on KINGSWALK: eligible to verify by role, so only "has answered"
-- can refuse them (the contractor C would be refused for the role first, testing nothing).
SELECT set_config('x.pm2', (SELECT pm.user_id::text FROM projects.project_members pm
                             JOIN public.user_organisations uo ON uo.user_id = pm.user_id AND uo.organisation_id = pm.organisation_id
                             WHERE pm.project_id = current_setting('x.kw')::uuid AND pm.is_active AND uo.is_active
                               AND uo.role IN ('owner','admin','project_manager')
                               AND pm.user_id NOT IN (current_setting('x.c')::uuid, current_setting('x.pmu')::uuid)
                             ORDER BY pm.created_at LIMIT 1), true);
DO $$ BEGIN
  IF current_setting('x.kw', true) IS NULL OR current_setting('x.pmu', true) IS NULL OR current_setting('x.pm2', true) IS NULL THEN
    RAISE EXCEPTION 'fixture precondition failed: KINGSWALK or a PM-level member is missing; the probes would be vacuous';
  END IF;
END $$;

-- T_COC: coc, so a separate verifier by default. T_IO: inspection_only, self-verification allowed.
WITH t AS (INSERT INTO inspections.templates (organisation_id, template_id, version, name, applies_to_node_types, deliverable_type, schema_json, is_active)
  VALUES (current_setting('x.org')::uuid, 'probe-sepver-coc', 1, 'separate verifier probe (coc)', '{board}', 'coc',
          '{"sections": [{"section_id": "s1", "title": "S1", "fields": [{"field_id": "q1", "type": "pass_fail", "label": "Q1", "required": true}]}]}'::jsonb,
          true) RETURNING id)
SELECT set_config('x.tcoc', (SELECT id::text FROM t), true);
WITH t AS (INSERT INTO inspections.templates (organisation_id, template_id, version, name, applies_to_node_types, deliverable_type, schema_json, is_active)
  VALUES (current_setting('x.org')::uuid, 'probe-sepver-io', 1, 'separate verifier probe (inspection only)', '{board}', 'inspection_only',
          '{"sections": [{"section_id": "s1", "title": "S1", "fields": [{"field_id": "q1", "type": "pass_fail", "label": "Q1", "required": true}]}]}'::jsonb,
          true) RETURNING id)
SELECT set_config('x.tio', (SELECT id::text FROM t), true);

CREATE FUNCTION pg_temp.mk(tmpl text, label text, assignee text, verifier text) RETURNS text LANGUAGE sql AS $f$
  INSERT INTO inspections.inspections (organisation_id, project_id, template_id, target_node_type, target_label,
                                       assigned_to_id, verifier_id, status, created_by)
  VALUES (current_setting('x.org')::uuid, current_setting('x.kw')::uuid, tmpl::uuid, 'adhoc', label,
          assignee::uuid, verifier::uuid, 'in_progress', current_setting('x.pmu')::uuid)
  RETURNING id::text
$f$;
-- I1: CoC, C inspects, PMU verifies (the right shape). I2: inspection-only, PMU does both.
SELECT set_config('x.i1', pg_temp.mk(current_setting('x.tcoc'), 'sepver probe 1', current_setting('x.c'), current_setting('x.pmu')), true);
SELECT set_config('x.i2', pg_temp.mk(current_setting('x.tio'), 'sepver probe 2', current_setting('x.pmu'), current_setting('x.pmu')), true);
-- I3: CoC already in the bad state (as Shoprite is today), built with triggers off.
DO $$ BEGIN
  SET LOCAL session_replication_role = replica;
  PERFORM set_config('x.i3', pg_temp.mk(current_setting('x.tcoc'), 'sepver probe 3', current_setting('x.pmu'), current_setting('x.pmu')), true);
  SET LOCAL session_replication_role = origin;
END $$;

CREATE TEMP TABLE _o (k text PRIMARY KEY, v text);
GRANT ALL ON _o TO authenticated, service_role;
CREATE FUNCTION pg_temp.try(tag text, stmt text) RETURNS void LANGUAGE plpgsql AS $p$
DECLARE n int;
BEGIN
  EXECUTE stmt;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO _o VALUES (tag, n::text);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _o VALUES (tag, 'ERR ' || SQLERRM);
END $p$;
CREATE FUNCTION pg_temp.who(k text) RETURNS void LANGUAGE plpgsql AS $p$
BEGIN
  IF k IS NULL THEN
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
  ELSE
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('x.' || k), 'role', 'authenticated')::text, true);
  END IF;
END $p$;
GRANT EXECUTE ON FUNCTION pg_temp.try(text, text), pg_temp.who(text) TO authenticated, service_role;

-- I4 / I5: submitted, each with one answer by C, to probe the verifier's flip while awaiting.
SELECT set_config('x.i4', pg_temp.mk(current_setting('x.tcoc'), 'sepver probe 4', current_setting('x.c'), current_setting('x.pmu')), true);
SELECT set_config('x.i5', pg_temp.mk(current_setting('x.tio'), 'sepver probe 5', current_setting('x.c'), current_setting('x.pmu')), true);
INSERT INTO inspections.responses (inspection_id, section_id, field_id, pass_state, latest_responded_by)
VALUES (current_setting('x.i4')::uuid, 's1', 'q1', 'pass', current_setting('x.c')::uuid),
       (current_setting('x.i5')::uuid, 's1', 'q1', 'pass', current_setting('x.c')::uuid);
UPDATE inspections.inspections SET status = 'awaiting_verification'
 WHERE id IN (current_setting('x.i4')::uuid, current_setting('x.i5')::uuid);

-- PM2 answers I1 too (no session: the history trigger records latest_responded_by).
INSERT INTO inspections.responses (inspection_id, section_id, field_id, pass_state, latest_responded_by)
VALUES (current_setting('x.i1')::uuid, 's1', 'q9', 'pass', current_setting('x.pm2')::uuid);

-- ── The inspector answers the CoC; the verifier tries to ──────────────────────────────────────
SELECT pg_temp.who('c'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('c:answer_coc', $$INSERT INTO inspections.responses (inspection_id, section_id, field_id, pass_state, latest_responded_by)
  VALUES (current_setting('x.i1')::uuid, 's1', 'q1', 'pass', auth.uid())$$);
RESET ROLE; SELECT pg_temp.who(NULL);

SELECT pg_temp.who('pmu'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('v:answer_coc', $$UPDATE inspections.responses SET pass_state = 'fail', latest_responded_by = auth.uid()
  WHERE inspection_id = current_setting('x.i1')::uuid AND field_id = 'q1'$$);
SELECT pg_temp.try('v:new_answer_coc', $$INSERT INTO inspections.responses (inspection_id, section_id, field_id, pass_state, latest_responded_by)
  VALUES (current_setting('x.i1')::uuid, 's1', 'q2', 'pass', auth.uid())$$);
SELECT pg_temp.try('v:photo_coc', $$INSERT INTO inspections.photos (inspection_id, section_id, field_id, storage_path, uploaded_by)
  VALUES (current_setting('x.i1')::uuid, 's1', 'q1', 'probe/sepver.jpg', auth.uid())$$);
SELECT pg_temp.try('v:answer_io', $$INSERT INTO inspections.responses (inspection_id, section_id, field_id, pass_state, latest_responded_by)
  VALUES (current_setting('x.i2')::uuid, 's1', 'q1', 'pass', auth.uid())$$);
SELECT pg_temp.try('v:flip_coc', $$UPDATE inspections.responses SET pass_state = 'fail', latest_responded_by = auth.uid()
  WHERE inspection_id = current_setting('x.i4')::uuid AND field_id = 'q1'$$);
SELECT pg_temp.try('v:flip_io', $$UPDATE inspections.responses SET pass_state = 'fail', latest_responded_by = auth.uid()
  WHERE inspection_id = current_setting('x.i5')::uuid AND field_id = 'q1'$$);
-- Assignment, as the PM: the contributor cannot become verifier, nor the verifier the inspector.
SELECT pg_temp.try('pm:contributor_as_verifier', $$UPDATE inspections.inspections SET verifier_id = current_setting('x.pm2')::uuid
  WHERE id = current_setting('x.i1')::uuid$$);
SELECT pg_temp.try('pm:verifier_as_inspector', $$UPDATE inspections.inspections SET assigned_to_id = current_setting('x.pmu')::uuid
  WHERE id = current_setting('x.i1')::uuid$$);
SELECT pg_temp.try('pm:create_self_verified_coc', $$INSERT INTO inspections.inspections (organisation_id, project_id, template_id, target_node_type, target_label, assigned_to_id, verifier_id, status, created_by)
  VALUES (current_setting('x.org')::uuid, current_setting('x.kw')::uuid, current_setting('x.tcoc')::uuid, 'adhoc', 'sepver probe 4', auth.uid(), auth.uid(), 'assigned', auth.uid())$$);
-- The verifier must hold a verifying role: the contractor C cannot be made verifier, on any template.
SELECT pg_temp.try('pm:contractor_as_verifier', $$UPDATE inspections.inspections SET verifier_id = current_setting('x.c')::uuid, assigned_to_id = NULL
  WHERE id = current_setting('x.i2')::uuid$$);
-- A row already in the bad state can still be edited, and fixed by reassigning.
SELECT pg_temp.try('pm:edit_bad_row', $$UPDATE inspections.inspections SET target_label = 'sepver probe 3 renamed' WHERE id = current_setting('x.i3')::uuid$$);
SELECT pg_temp.try('pm:fix_bad_row', $$UPDATE inspections.inspections SET assigned_to_id = current_setting('x.c')::uuid WHERE id = current_setting('x.i3')::uuid$$);
RESET ROLE; SELECT pg_temp.who(NULL);

SELECT * FROM (VALUES
  ('the inspector can answer a CoC inspection',
     (SELECT v FROM _o WHERE k = 'c:answer_coc') = '1'),
  ('the verifier cannot change an answer on a CoC inspection',
     (SELECT v FROM _o WHERE k = 'v:answer_coc') = '0'),
  ('the verifier cannot add an answer to a CoC inspection',
     (SELECT v FROM _o WHERE k = 'v:new_answer_coc') LIKE 'ERR %row-level security%'),
  ('the verifier cannot add a photo to a CoC inspection',
     (SELECT v FROM _o WHERE k = 'v:photo_coc') LIKE 'ERR %row-level security%'),
  ('awaiting verification, the verifier cannot flip an answer on a CoC inspection',
     (SELECT v FROM _o WHERE k = 'v:flip_coc') = '0'),
  ('awaiting verification, the verifier may still correct an answer on an inspection-only template',
     (SELECT v FROM _o WHERE k = 'v:flip_io') = '1'),
  ('on an inspection-only template the verifier may still answer',
     (SELECT v FROM _o WHERE k = 'v:answer_io') = '1'),
  ('someone who answered cannot be made verifier of a CoC inspection',
     (SELECT v FROM _o WHERE k = 'pm:contributor_as_verifier') LIKE 'ERR %already filled in answers%'),
  ('the verifier cannot be made inspector of a CoC inspection',
     (SELECT v FROM _o WHERE k = 'pm:verifier_as_inspector') LIKE 'ERR %cannot be both the inspector and the verifier%'),
  ('a CoC inspection cannot be created with one person as inspector and verifier',
     (SELECT v FROM _o WHERE k = 'pm:create_self_verified_coc') LIKE 'ERR %cannot be both the inspector and the verifier%'),
  ('a contractor cannot be made verifier, even on a template that allows self-verification',
     (SELECT v FROM _o WHERE k = 'pm:contractor_as_verifier') LIKE 'ERR %the verifier must be an owner, admin or project manager%'),
  ('a row already in the bad state can still be edited without touching the assignment',
     (SELECT v FROM _o WHERE k = 'pm:edit_bad_row') = '1'),
  ('a row already in the bad state can be fixed by reassigning',
     (SELECT v FROM _o WHERE k = 'pm:fix_bad_row') = '1'),
  ('nobody signed in can call the trigger function directly',
     to_regprocedure('inspections.enforce_separate_verifier()') IS NOT NULL
     AND NOT has_function_privilege('authenticated', 'inspections.enforce_separate_verifier()', 'EXECUTE'))
) AS t("check", ok);
