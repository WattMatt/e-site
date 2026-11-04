-- scripts/db/assert-inspection-verifier-override.sql
-- An organisation owner or admin certifies in place of the assigned verifier. Migration 00260.
-- Before it, only the assigned verifier could certify (00235); an owner had to reassign the
-- verifier to themselves first, and nothing recorded that it was an override.
-- Run (red without the migration, green with it):
--   M=apps/edge-functions/supabase/migrations
--   printf 'SELECT 1;\n' > /tmp/base.sql;  cp $M/00260_*.sql /tmp/fix.sql
--   scripts/db/dry-run-migration.sh /tmp/base.sql scripts/db/assert-inspection-verifier-override.sql
--   scripts/db/dry-run-migration.sh /tmp/fix.sql  scripts/db/assert-inspection-verifier-override.sql

-- C   = the rbac-test contractor, active on KINGSWALK.
-- ADM = an active org owner/admin with an active project_members row on KINGSWALK (the overrider).
-- PMU = another org owner/admin/PM member of KINGSWALK (the assigned verifier).
SELECT set_config('x.c', '018f2d31-bbe8-4cc1-bbdd-63af0187081e', true);
SELECT set_config('x.kw', (SELECT pm.project_id::text FROM projects.project_members pm
                            WHERE pm.user_id = current_setting('x.c')::uuid AND pm.is_active
                            ORDER BY pm.created_at LIMIT 1), true);
SELECT set_config('x.org', (SELECT organisation_id::text FROM projects.projects WHERE id = current_setting('x.kw')::uuid), true);
SELECT set_config('x.adm', (SELECT pm.user_id::text FROM projects.project_members pm
                             JOIN public.user_organisations uo ON uo.user_id = pm.user_id AND uo.organisation_id = current_setting('x.org')::uuid
                             WHERE pm.project_id = current_setting('x.kw')::uuid AND pm.is_active AND uo.is_active
                               AND uo.role IN ('owner','admin') AND pm.user_id <> current_setting('x.c')::uuid
                             ORDER BY uo.role DESC, pm.created_at LIMIT 1), true);
SELECT set_config('x.pmu', (SELECT pm.user_id::text FROM projects.project_members pm
                             JOIN public.user_organisations uo ON uo.user_id = pm.user_id AND uo.organisation_id = current_setting('x.org')::uuid
                             WHERE pm.project_id = current_setting('x.kw')::uuid AND pm.is_active AND uo.is_active
                               AND uo.role IN ('owner','admin','project_manager')
                               AND pm.user_id NOT IN (current_setting('x.c')::uuid, current_setting('x.adm')::uuid)
                             ORDER BY pm.created_at LIMIT 1), true);
DO $$ BEGIN
  IF current_setting('x.kw', true) IS NULL OR current_setting('x.adm', true) IS NULL OR current_setting('x.pmu', true) IS NULL THEN
    RAISE EXCEPTION 'fixture precondition failed: KINGSWALK, an owner/admin or a second PM-level member is missing; the probes would be vacuous';
  END IF;
END $$;

-- No separate verifier, no qualified signatures, inspection_only (INS number auto-allocated): the
-- override is the only thing under test.
WITH t AS (INSERT INTO inspections.templates (organisation_id, template_id, version, name, applies_to_node_types, deliverable_type, schema_json, is_active)
  VALUES (current_setting('x.org')::uuid, 'probe-override', 1, 'override probe', '{board}', 'inspection_only',
          '{"requires_separate_verifier": false, "sections": [{"section_id": "s1", "title": "S1", "fields": [
              {"field_id": "ok", "type": "pass_fail", "label": "OK", "required": false}]}]}'::jsonb,
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
SELECT set_config('x.i1', pg_temp.mk('override probe 1', 'awaiting_verification'), true);  -- the override certifies
SELECT set_config('x.i2', pg_temp.mk('override probe 2', 'awaiting_verification'), true);  -- refusals
SELECT set_config('x.i3', pg_temp.mk('override probe 3', 'in_progress'), true);            -- not submitted
SELECT set_config('x.i4', pg_temp.mk('override probe 4', 'awaiting_verification'), true);  -- stamps + clearing
-- Server verdicts (the certify action writes these with the service role): I1 passes, I2 fails.
INSERT INTO inspections.verdicts (inspection_id, overall_result) VALUES
  (current_setting('x.i1')::uuid, 'pass'), (current_setting('x.i2')::uuid, 'fail');

CREATE TEMP TABLE _o (k text PRIMARY KEY, v text);
GRANT ALL ON _o TO authenticated, anon, service_role;
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
GRANT EXECUTE ON FUNCTION pg_temp.try(text, text), pg_temp.who(text) TO authenticated, anon, service_role;
-- plpgsql, so the red run (no override columns yet) records each check instead of aborting.
CREATE FUNCTION pg_temp.state(i text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE r text;
BEGIN
  EXECUTE $q$SELECT status || '|' || (verifier_id = current_setting('x.adm')::uuid)::text || '|' || coalesce(verification_override_by::text, '-')
               FROM inspections.inspections WHERE id = $1$q$ INTO r USING current_setting('x.' || i)::uuid;
  RETURN r;
EXCEPTION WHEN undefined_column THEN RETURN 'no override columns';
END $f$;
CREATE FUNCTION pg_temp.capture(tag text, q text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE format('INSERT INTO _o SELECT %L, (%s)', tag, q);
EXCEPTION WHEN undefined_column THEN INSERT INTO _o VALUES (tag, 'no override columns');
END $f$;

-- ── A. An org owner/admin certifies in place of the verifier ───────────────────────────────
SELECT pg_temp.who('adm'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('adm:certify', $$INSERT INTO _o SELECT 'adm:number', inspections.certify_in_place_of_verifier(current_setting('x.i1')::uuid, '  Verifier away on leave  ', NULL)$$);
RESET ROLE; SELECT pg_temp.who(NULL);
SELECT pg_temp.capture('i1:row', $$SELECT status || '|' || overall_result || '|' || (verifier_id = current_setting('x.adm')::uuid)::text || '|'
  || (verification_override_by = current_setting('x.adm')::uuid)::text || '|'
  || (verification_override_replaced = current_setting('x.pmu')::uuid)::text || '|'
  || verification_override_reason || '|' || (verification_override_at > now() - interval '1 minute')::text
  FROM inspections.inspections WHERE id = current_setting('x.i1')::uuid$$);

-- ── B. A FAIL verdict: refused, and the override rolls back with it ────────────────────────
SELECT pg_temp.who('adm'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('adm:fail', $$SELECT inspections.certify_in_place_of_verifier(current_setting('x.i2')::uuid, 'reason', NULL)$$);
RESET ROLE; SELECT pg_temp.who(NULL);
INSERT INTO _o SELECT 'i2:after_fail', pg_temp.state('i2');

-- ── C. No reason ───────────────────────────────────────────────────────────────────────────
SELECT pg_temp.who('adm'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('adm:no_reason', $$SELECT inspections.certify_in_place_of_verifier(current_setting('x.i2')::uuid, '   ', NULL)$$);
RESET ROLE; SELECT pg_temp.who(NULL);

-- ── D. A project manager who is not an org owner/admin cannot override ─────────────────────
UPDATE projects.project_members SET role = 'project_manager' WHERE project_id = current_setting('x.kw')::uuid AND user_id = current_setting('x.c')::uuid;
SELECT pg_temp.who('c'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('pm:override', $$SELECT inspections.certify_in_place_of_verifier(current_setting('x.i2')::uuid, 'reason', NULL)$$);
SELECT pg_temp.try('pm:patch', $$UPDATE inspections.inspections SET verifier_id = auth.uid(), verification_override_by = auth.uid(),
                                   verification_override_reason = 'x' WHERE id = current_setting('x.i2')::uuid$$);
RESET ROLE; SELECT pg_temp.who(NULL);
UPDATE projects.project_members SET role = 'contractor' WHERE project_id = current_setting('x.kw')::uuid AND user_id = current_setting('x.c')::uuid;

-- ── E. Not yet submitted ───────────────────────────────────────────────────────────────────
SELECT pg_temp.who('adm'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('adm:in_progress', $$SELECT inspections.certify_in_place_of_verifier(current_setting('x.i3')::uuid, 'reason', NULL)$$);

-- ── F. An override recorded for someone else ───────────────────────────────────────────────
SELECT pg_temp.try('adm:for_other', $$UPDATE inspections.inspections SET verifier_id = current_setting('x.pmu')::uuid,
                                        verification_override_by = current_setting('x.pmu')::uuid, verification_override_reason = 'x'
                                        WHERE id = current_setting('x.i4')::uuid$$);

-- ── G. The guard stamps replaced/at; forged values are ignored ─────────────────────────────
SELECT pg_temp.try('adm:forged', $$UPDATE inspections.inspections SET verifier_id = auth.uid(), verification_override_by = auth.uid(),
                                     verification_override_reason = 'take over', verification_override_replaced = current_setting('x.c')::uuid,
                                     verification_override_at = '2000-01-01' WHERE id = current_setting('x.i4')::uuid$$);
RESET ROLE; SELECT pg_temp.who(NULL);
SELECT pg_temp.capture('i4:stamped', $$SELECT (verification_override_replaced = current_setting('x.pmu')::uuid)::text || '|'
  || (verification_override_at > now() - interval '1 minute')::text FROM inspections.inspections WHERE id = current_setting('x.i4')::uuid$$);

-- ── H. Overriding when already the verifier ────────────────────────────────────────────────
SELECT pg_temp.who('adm'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('adm:again', $$SELECT inspections.certify_in_place_of_verifier(current_setting('x.i4')::uuid, 'reason', NULL)$$);
-- ── I. An ordinary reassignment clears the override ────────────────────────────────────────
SELECT pg_temp.try('adm:reassign', $$UPDATE inspections.inspections SET verifier_id = current_setting('x.pmu')::uuid WHERE id = current_setting('x.i4')::uuid$$);
RESET ROLE; SELECT pg_temp.who(NULL);
INSERT INTO _o SELECT 'i4:cleared', pg_temp.state('i4');

-- ── J. anon has no EXECUTE ─────────────────────────────────────────────────────────────────
SET LOCAL ROLE anon;
SELECT pg_temp.try('anon:call', $$SELECT inspections.certify_in_place_of_verifier(current_setting('x.i2')::uuid, 'reason', NULL)$$);
RESET ROLE;

SELECT * FROM (VALUES
  ('an org owner/admin certifies in place of the verifier',     (SELECT v FROM _o WHERE k = 'adm:certify') = '1'
                                                                AND (SELECT v FROM _o WHERE k = 'adm:number') LIKE 'INS-%'),
  ('the row records who, whom, why (trimmed) and when',         (SELECT v FROM _o WHERE k = 'i1:row') = 'certified|pass|true|true|true|Verifier away on leave|true'),
  ('a FAIL verdict is never certified by an override',          (SELECT v FROM _o WHERE k = 'adm:fail') LIKE 'ERR %only with a pass result%'),
  ('a refused certify rolls the override back',                 (SELECT v FROM _o WHERE k = 'i2:after_fail') = 'awaiting_verification|false|-'),
  ('an override needs a reason',                                (SELECT v FROM _o WHERE k = 'adm:no_reason') LIKE 'ERR %needs a reason%'),
  ('a project manager cannot override (function)',              (SELECT v FROM _o WHERE k = 'pm:override') LIKE 'ERR %organisation owner or admin%'),
  ('a project manager cannot override (direct update)',         (SELECT v FROM _o WHERE k = 'pm:patch') LIKE 'ERR %organisation owner or admin%'),
  ('no override before the inspection is submitted',            (SELECT v FROM _o WHERE k = 'adm:in_progress') LIKE 'ERR %once the inspection has been submitted%'),
  ('an override cannot be recorded for someone else',           (SELECT v FROM _o WHERE k = 'adm:for_other') LIKE 'ERR %cannot be recorded for someone else%'),
  ('replaced verifier and time are stamped, forgeries ignored', (SELECT v FROM _o WHERE k = 'adm:forged') = '1'
                                                                AND (SELECT v FROM _o WHERE k = 'i4:stamped') = 'true|true'),
  ('no override when already the verifier',                     (SELECT v FROM _o WHERE k = 'adm:again') LIKE 'ERR %already the verifier%'),
  ('an ordinary reassignment clears the override',              (SELECT v FROM _o WHERE k = 'adm:reassign') = '1'
                                                                AND (SELECT v FROM _o WHERE k = 'i4:cleared') = 'awaiting_verification|false|-'),
  ('anon cannot call the override',                             (SELECT v FROM _o WHERE k = 'anon:call') LIKE 'ERR %permission denied%')
) AS t("check", ok);
