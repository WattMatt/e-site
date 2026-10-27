-- scripts/db/assert-inspection-verdict-gate.sql
-- The database certifies only against the server's verdict, the verifier never edits answers,
-- and a contributor can delete answers (repeating-group entries). Migration 00253.
-- Before the fix:
--   • the transition guard took overall_result from the update itself: the assigned verifier could
--     certify an inspection the engine fails with status='certified', overall_result='pass';
--   • responses_update_verifier (00066, narrowed by 00250) let the verifier rewrite answers on a
--     template without a separate verifier — e.g. a critical snag into a low one — and certify;
--   • inspections.responses had no DELETE policy, so removing a repeating-group entry deleted
--     0 rows silently and the entry kept counting.
-- Run (red without the fix, green with it; 00250 is the separate-verifier migration it builds on):
--   M=apps/edge-functions/supabase/migrations
--   cat $M/00250_*.sql > /tmp/base.sql;  cat $M/00250_*.sql $M/00253_*.sql > /tmp/fix.sql
--   scripts/db/dry-run-migration.sh /tmp/base.sql scripts/db/assert-inspection-verdict-gate.sql
--   scripts/db/dry-run-migration.sh /tmp/fix.sql  scripts/db/assert-inspection-verdict-gate.sql

-- C   = the rbac-test contractor, active on KINGSWALK (the contributor).
-- PMU = an org owner/admin/PM with an active project_members row on KINGSWALK (the verifier).
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
DO $$ BEGIN
  IF current_setting('x.kw', true) IS NULL OR current_setting('x.pmu', true) IS NULL THEN
    RAISE EXCEPTION 'fixture precondition failed: KINGSWALK or a PM-level member is missing; the probes would be vacuous';
  END IF;
END $$;

-- A template without a separate verifier, so certification_blockers() passes and the verdict is
-- the only thing under test; and the verifier-edit probe targets exactly the case 00250 left open.
WITH t AS (INSERT INTO inspections.templates (organisation_id, template_id, version, name, applies_to_node_types, deliverable_type, schema_json, is_active)
  VALUES (current_setting('x.org')::uuid, 'probe-verdict', 1, 'verdict probe', '{board}', 'inspection_only',
          '{"requires_separate_verifier": false, "sections": [{"section_id": "s1", "title": "S1", "fields": [
              {"field_id": "cond", "type": "rating", "label": "Condition", "required": true},
              {"field_id": "g", "type": "repeating_group", "label": "Snags", "fields": [
                {"field_id": "risk", "type": "dropdown", "label": "Risk", "options": ["low","critical"], "fail_values": ["critical"]}]}]}]}'::jsonb,
          true) RETURNING id)
SELECT set_config('x.t', (SELECT id::text FROM t), true);

CREATE FUNCTION pg_temp.mk(label text, st text) RETURNS text LANGUAGE sql AS $f$
  INSERT INTO inspections.inspections (organisation_id, project_id, template_id, target_node_type, target_label,
                                       assigned_to_id, verifier_id, status, created_by, completed_at)
  VALUES (current_setting('x.org')::uuid, current_setting('x.kw')::uuid, current_setting('x.t')::uuid, 'adhoc', label,
          current_setting('x.c')::uuid, current_setting('x.pmu')::uuid, st, current_setting('x.c')::uuid,
          CASE WHEN st = 'awaiting_verification' THEN now() - interval '1 hour' END)
  RETURNING id::text
$f$;
SELECT set_config('x.i1', pg_temp.mk('verdict probe 1', 'awaiting_verification'), true);  -- certify probes
SELECT set_config('x.i2', pg_temp.mk('verdict probe 2', 'awaiting_verification'), true);  -- verifier edit
SELECT set_config('x.i3', pg_temp.mk('verdict probe 3', 'in_progress'), true);            -- delete
INSERT INTO inspections.responses (inspection_id, section_id, field_id, value_text, latest_responded_by) VALUES
  (current_setting('x.i2')::uuid, 's1', 'cond', 'poor', current_setting('x.c')::uuid),
  (current_setting('x.i2')::uuid, 's1', 'g[0].risk', 'critical', current_setting('x.c')::uuid),
  (current_setting('x.i3')::uuid, 's1', 'g[0].risk', 'critical', current_setting('x.c')::uuid),
  (current_setting('x.i3')::uuid, 's1', 'g[1].risk', 'low', current_setting('x.c')::uuid);

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
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF k IS NULL THEN
    PERFORM set_config('request.jwt.claims', '', true);
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('x.' || k), 'role', 'authenticated')::text, true);
  END IF;
END $p$;
GRANT EXECUTE ON FUNCTION pg_temp.try(text, text), pg_temp.who(text) TO authenticated, service_role;
-- Puts I1 back in the queue between probes (session cleared: the guard's trusted path).
CREATE FUNCTION pg_temp.reset_i1() RETURNS void LANGUAGE sql AS $f$
  UPDATE inspections.inspections SET status = 'awaiting_verification', overall_result = NULL, certified_at = NULL,
         coc_number = NULL, completed_at = now() - interval '1 hour'
   WHERE id = current_setting('x.i1')::uuid;
$f$;
-- A verdict as the server would write it (verdicts may not exist on the red run: recorded, not raised).
CREATE FUNCTION pg_temp.verdict(res text) RETURNS void LANGUAGE plpgsql AS $p$
BEGIN
  EXECUTE format('INSERT INTO inspections.verdicts (inspection_id, overall_result, computed_at) VALUES (%L, %L, ''2000-01-01'')
                  ON CONFLICT (inspection_id) DO UPDATE SET overall_result = EXCLUDED.overall_result, computed_at = EXCLUDED.computed_at',
                 current_setting('x.i1'), res);
EXCEPTION WHEN undefined_table THEN NULL;
END $p$;

-- ── A. No verdict: the verifier's own PASS is refused ────────────────────────────────────────
SELECT pg_temp.who('pmu'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('v:no_verdict', $$UPDATE inspections.inspections SET status = 'certified', overall_result = 'pass' WHERE id = current_setting('x.i1')::uuid$$);
RESET ROLE; SELECT pg_temp.who(NULL); SELECT pg_temp.reset_i1();

-- ── B. A FAIL verdict cannot be certified, whatever the update claims ───────────────────────
SELECT pg_temp.verdict('fail');
SELECT pg_temp.who('pmu'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('v:fail_verdict', $$UPDATE inspections.inspections SET status = 'certified', overall_result = 'pass' WHERE id = current_setting('x.i1')::uuid$$);
RESET ROLE; SELECT pg_temp.who(NULL); SELECT pg_temp.reset_i1();

-- ── C. A verdict from before the latest submit is stale ─────────────────────────────────────
SELECT pg_temp.verdict('pass');
UPDATE inspections.inspections SET completed_at = now() + interval '1 hour' WHERE id = current_setting('x.i1')::uuid;
SELECT pg_temp.who('pmu'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('v:stale_verdict', $$UPDATE inspections.inspections SET status = 'certified', overall_result = 'pass' WHERE id = current_setting('x.i1')::uuid$$);
RESET ROLE; SELECT pg_temp.who(NULL); SELECT pg_temp.reset_i1();

-- ── D. A current PASS verdict certifies, and the stored result is the verdict's ─────────────
SELECT pg_temp.verdict('pass');
DO $$ BEGIN
  EXECUTE $q$INSERT INTO _o SELECT 'verdict:stamped_now', (computed_at > '2001-01-01')::text
               FROM inspections.verdicts WHERE inspection_id = current_setting('x.i1')::uuid$q$;
EXCEPTION WHEN undefined_table THEN INSERT INTO _o VALUES ('verdict:stamped_now', 'no verdicts table');
END $$;
SELECT pg_temp.who('pmu'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('v:certify', $$UPDATE inspections.inspections SET status = 'certified', overall_result = 'conditional_pass' WHERE id = current_setting('x.i1')::uuid$$);
RESET ROLE; SELECT pg_temp.who(NULL);
INSERT INTO _o SELECT 'i1:stored', status || '/' || coalesce(overall_result, '<null>') FROM inspections.inspections WHERE id = current_setting('x.i1')::uuid;

-- ── E. Signed-in users cannot write verdicts ────────────────────────────────────────────────
SELECT pg_temp.who('pmu'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('v:write_verdict', $$INSERT INTO inspections.verdicts (inspection_id, overall_result) VALUES (current_setting('x.i2')::uuid, 'pass')$$);
RESET ROLE; SELECT pg_temp.who(NULL);
SELECT pg_temp.who('c'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('c:write_verdict', $$INSERT INTO inspections.verdicts (inspection_id, overall_result) VALUES (current_setting('x.i2')::uuid, 'pass')$$);
RESET ROLE; SELECT pg_temp.who(NULL);

-- ── F. The verifier cannot edit answers (template without a separate verifier) ──────────────
SELECT pg_temp.who('pmu'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('v:edit_rating', $$UPDATE inspections.responses SET value_text = 'good', latest_responded_by = auth.uid()
                                       WHERE inspection_id = current_setting('x.i2')::uuid AND field_id = 'cond'$$);
SELECT pg_temp.try('v:edit_snag',   $$UPDATE inspections.responses SET value_text = 'low', latest_responded_by = auth.uid()
                                       WHERE inspection_id = current_setting('x.i2')::uuid AND field_id = 'g[0].risk'$$);
RESET ROLE; SELECT pg_temp.who(NULL);

-- ── G. The contributor deletes a repeating-group entry while the inspection is open ─────────
SELECT pg_temp.who('c'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('c:delete_entry',     $$DELETE FROM inspections.responses WHERE inspection_id = current_setting('x.i3')::uuid AND field_id LIKE 'g[0].%'$$);
SELECT pg_temp.try('c:delete_submitted', $$DELETE FROM inspections.responses WHERE inspection_id = current_setting('x.i2')::uuid AND field_id LIKE 'g[0].%'$$);
RESET ROLE; SELECT pg_temp.who(NULL);
INSERT INTO _o SELECT 'i3:left', string_agg(field_id, ',' ORDER BY field_id) FROM inspections.responses WHERE inspection_id = current_setting('x.i3')::uuid;
-- A client viewer on the project cannot delete.
UPDATE projects.project_members SET role = 'client_viewer' WHERE project_id = current_setting('x.kw')::uuid AND user_id = current_setting('x.c')::uuid;
SELECT pg_temp.who('c'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('pcv:delete', $$DELETE FROM inspections.responses WHERE inspection_id = current_setting('x.i3')::uuid$$);
RESET ROLE; SELECT pg_temp.who(NULL);
UPDATE projects.project_members SET role = 'contractor' WHERE project_id = current_setting('x.kw')::uuid AND user_id = current_setting('x.c')::uuid;

SELECT * FROM (VALUES
  ('no verdict: the verifier cannot certify with their own PASS', (SELECT v FROM _o WHERE k = 'v:no_verdict') LIKE 'ERR %no current result%'),
  ('a FAIL verdict cannot be certified',                         (SELECT v FROM _o WHERE k = 'v:fail_verdict') LIKE 'ERR %only with a pass result%'),
  ('a verdict older than the latest submit is refused',          (SELECT v FROM _o WHERE k = 'v:stale_verdict') LIKE 'ERR %no current result%'),
  ('the database stamps computed_at (sent value ignored)',       (SELECT v FROM _o WHERE k = 'verdict:stamped_now') = 'true'),
  ('a current PASS verdict certifies',                           (SELECT v FROM _o WHERE k = 'v:certify') = '1'),
  ('the stored result is the verdict, not the sent value',       (SELECT v FROM _o WHERE k = 'i1:stored') = 'certified/pass'),
  ('the verifier cannot write a verdict',                        (SELECT v FROM _o WHERE k = 'v:write_verdict') LIKE 'ERR %permission denied%'),
  ('the contributor cannot write a verdict',                     (SELECT v FROM _o WHERE k = 'c:write_verdict') LIKE 'ERR %permission denied%'),
  ('the verifier cannot turn a Poor rating into Good',           (SELECT v FROM _o WHERE k = 'v:edit_rating') = '0'),
  ('the verifier cannot turn a critical snag into a low one',    (SELECT v FROM _o WHERE k = 'v:edit_snag') = '0'),
  ('the contributor can delete a repeating-group entry',         (SELECT v FROM _o WHERE k = 'c:delete_entry') = '1'
                                                                 AND (SELECT v FROM _o WHERE k = 'i3:left') = 'g[1].risk'),
  ('no deletes once submitted',                                  (SELECT v FROM _o WHERE k = 'c:delete_submitted') = '0'),
  ('a project client viewer cannot delete answers',              (SELECT v FROM _o WHERE k = 'pcv:delete') = '0'),
  -- Every EMB version that has the snag risk field (1.1-1.3; 1.0's snag list has none), the active one included.
  ('EMB snag risk high/critical fails, every version with the field', (SELECT bool_and(jsonb_path_exists(t.schema_json,
                                                                    '$.sections[*].fields[*] ? (@.field_id == "snag_list").fields[*] ? (@.field_id == "risk_level" && @.fail_values[*] == "critical")'))
                                                                  FROM inspections.templates t WHERE t.name = 'Electrical Main Board (EMB) Inspection'
                                                                   AND jsonb_path_exists(t.schema_json, '$.sections[*].fields[*] ? (@.field_id == "snag_list").fields[*] ? (@.field_id == "risk_level")'))),
  ('the ACTIVE EMB version carries the rule',                    (SELECT bool_and(t.schema_json::text LIKE '%"fail_values": ["high", "critical"]%')
                                                                  FROM inspections.templates t WHERE t.name = 'Electrical Main Board (EMB) Inspection' AND t.is_active)),
  ('the template immutability trigger is back on',               (SELECT tgenabled = 'O' FROM pg_trigger WHERE tgname = 'trg_template_immutability'))
) AS t("check", ok);
