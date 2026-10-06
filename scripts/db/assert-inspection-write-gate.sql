-- scripts/db/assert-inspection-write-gate.sql
-- Who may write to an inspection: answers, photos, signatures, and the verifier helpers.
-- Before the fix:
--   • inspections.user_can_write_responses() never checked project_members.is_active or the
--     PROJECT role, so a soft-deactivated member and a project-scoped client viewer could still
--     save answers and photos;
--   • the signatures_insert policy checked only the ORG role — no project membership at all;
--   • inspections.is_inspection_verifier() checked only verifier_id, so a deactivated verifier
--     kept verifier writes; inspections.user_can_verify() checked neither is_active flag.
-- Run (red against a no-op, green with the fix):
--   scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/<NNNNN>_inspection_write_gate.sql \
--     scripts/db/assert-inspection-write-gate.sql

-- C = the rbac-test contractor, active on KINGSWALK. PMU = an org owner/admin/PM with an active
-- project_members row on KINGSWALK (for user_can_verify, which requires one).
SELECT set_config('x.c', '018f2d31-bbe8-4cc1-bbdd-63af0187081e', true);
SELECT set_config('x.kw', (SELECT pm.project_id::text FROM projects.project_members pm
                            WHERE pm.user_id = current_setting('x.c')::uuid AND pm.is_active
                            ORDER BY pm.created_at LIMIT 1), true);
SELECT set_config('x.org', (SELECT organisation_id::text FROM projects.projects WHERE id = current_setting('x.kw')::uuid), true);
SELECT set_config('x.tmpl', (SELECT id::text FROM inspections.templates WHERE is_active ORDER BY created_at LIMIT 1), true);
SELECT set_config('x.pmu', (SELECT pm.user_id::text FROM projects.project_members pm
                             JOIN public.user_organisations uo ON uo.user_id = pm.user_id AND uo.organisation_id = pm.organisation_id
                             WHERE pm.project_id = current_setting('x.kw')::uuid AND pm.is_active AND uo.is_active
                               AND uo.role IN ('owner','admin','project_manager')
                             ORDER BY pm.created_at LIMIT 1), true);
DO $$ BEGIN
  IF current_setting('x.kw', true) IS NULL OR current_setting('x.tmpl', true) IS NULL OR current_setting('x.pmu', true) IS NULL THEN
    RAISE EXCEPTION 'fixture precondition failed: KINGSWALK, an active template or a PM-level member is missing — the probes would be vacuous';
  END IF;
  IF (SELECT role FROM public.user_organisations WHERE user_id = current_setting('x.c')::uuid
        AND organisation_id = current_setting('x.org')::uuid AND is_active) IS DISTINCT FROM 'contractor' THEN
    RAISE EXCEPTION 'fixture precondition failed: C is not an active org contractor — the project-scoped probes would test nothing';
  END IF;
END $$;

WITH ins AS (INSERT INTO inspections.inspections (organisation_id, project_id, template_id, target_node_type, target_label, assigned_to_id, status, created_by)
  VALUES (current_setting('x.org')::uuid, current_setting('x.kw')::uuid, current_setting('x.tmpl')::uuid, 'adhoc', 'write-gate probe',
          current_setting('x.c')::uuid, 'assigned', current_setting('x.c')::uuid) RETURNING id)
SELECT set_config('x.insp', (SELECT id::text FROM ins), true);
-- A saved answer for the UPDATE probes (no session → the history trigger takes latest_responded_by).
INSERT INTO inspections.responses (inspection_id, section_id, field_id, value_text, latest_responded_by)
VALUES (current_setting('x.insp')::uuid, 'probe_section', 'seed_field', 'seed', current_setting('x.c')::uuid);

CREATE TEMP TABLE _o (k text PRIMARY KEY, v text);
GRANT ALL ON _o TO authenticated;

-- Runs as whoever is signed in. Every write is attempted; a refusal is recorded, not raised.
-- An UPDATE that RLS filters is silent, so it records the row count.
CREATE FUNCTION pg_temp.probe(tag text) RETURNS void LANGUAGE plpgsql AS $p$
DECLARE n int;
BEGIN
  INSERT INTO _o VALUES (tag || ':helper', inspections.user_can_write_responses(current_setting('x.insp')::uuid)::text);
  INSERT INTO _o VALUES (tag || ':verifier', inspections.is_inspection_verifier(current_setting('x.insp')::uuid)::text);
  BEGIN
    INSERT INTO inspections.responses (inspection_id, section_id, field_id, value_text, latest_responded_by)
    VALUES (current_setting('x.insp')::uuid, 'probe_section', 'f_' || tag, 'x', auth.uid());
    INSERT INTO _o VALUES (tag || ':resp_ins', 'ok');
  EXCEPTION WHEN OTHERS THEN INSERT INTO _o VALUES (tag || ':resp_ins', SQLERRM);
  END;
  BEGIN
    UPDATE inspections.responses SET value_text = 'by ' || tag, latest_responded_by = auth.uid()
     WHERE inspection_id = current_setting('x.insp')::uuid AND field_id = 'seed_field';
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO _o VALUES (tag || ':resp_upd', n::text);
  EXCEPTION WHEN OTHERS THEN INSERT INTO _o VALUES (tag || ':resp_upd', SQLERRM);
  END;
  BEGIN
    INSERT INTO inspections.photos (inspection_id, section_id, field_id, storage_path, uploaded_by)
    VALUES (current_setting('x.insp')::uuid, 'probe_section', 'f_' || tag, 'probe/' || tag || '.jpg', auth.uid());
    INSERT INTO _o VALUES (tag || ':photo', 'ok');
  EXCEPTION WHEN OTHERS THEN INSERT INTO _o VALUES (tag || ':photo', SQLERRM);
  END;
  BEGIN
    INSERT INTO inspections.signatures (inspection_id, section_id, field_id, role, signatory_name, storage_path, signed_by)
    VALUES (current_setting('x.insp')::uuid, 'probe_section', 's_' || tag, 'inspector', 'Probe', 'probe/' || tag || '.png', auth.uid());
    INSERT INTO _o VALUES (tag || ':sig', 'ok');
  EXCEPTION WHEN OTHERS THEN INSERT INTO _o VALUES (tag || ':sig', SQLERRM);
  END;
END $p$;

-- 1. C, active contractor: the control. Every write lands.
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('x.c'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.probe('active');
RESET ROLE;

-- 2. C soft-deactivated on the project (org row still active).
SELECT set_config('request.jwt.claims', '', true);
UPDATE projects.project_members SET is_active = false
 WHERE project_id = current_setting('x.kw')::uuid AND user_id = current_setting('x.c')::uuid;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('x.c'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.probe('inactive');
RESET ROLE;

-- 3. C active again, but a client viewer on THIS project (org role stays contractor).
SELECT set_config('request.jwt.claims', '', true);
UPDATE projects.project_members SET is_active = true, role = 'client_viewer'
 WHERE project_id = current_setting('x.kw')::uuid AND user_id = current_setting('x.c')::uuid;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('x.c'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.probe('pcv');
RESET ROLE;

-- 4. Verifier arm: C is the assigned verifier and the inspection awaits verification, so
--    user_can_write_responses is false by status and only the verifier arm can admit a signature.
SELECT set_config('request.jwt.claims', '', true);
UPDATE projects.project_members SET role = 'contractor'
 WHERE project_id = current_setting('x.kw')::uuid AND user_id = current_setting('x.c')::uuid;
UPDATE inspections.inspections SET status = 'awaiting_verification', verifier_id = current_setting('x.c')::uuid
 WHERE id = current_setting('x.insp')::uuid;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('x.c'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.probe('ver_active');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
UPDATE projects.project_members SET is_active = false
 WHERE project_id = current_setting('x.kw')::uuid AND user_id = current_setting('x.c')::uuid;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('x.c'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.probe('ver_inactive');
RESET ROLE;

-- 5. PMU (org owner/admin/PM, whose ORG role wins inside user_effective_project_role, so only
--    pm.is_active can refuse them as a contributor) and user_can_verify: active, then project row
--    deactivated, then org row deactivated. The inspection is back in a writable status.
SELECT set_config('request.jwt.claims', '', true);
UPDATE inspections.inspections SET status = 'in_progress', verifier_id = NULL WHERE id = current_setting('x.insp')::uuid;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('x.pmu'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
INSERT INTO _o VALUES ('ucv:active', inspections.user_can_verify(current_setting('x.kw')::uuid)::text);
INSERT INTO _o VALUES ('pmu:helper_active', inspections.user_can_write_responses(current_setting('x.insp')::uuid)::text);
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
UPDATE projects.project_members SET is_active = false
 WHERE project_id = current_setting('x.kw')::uuid AND user_id = current_setting('x.pmu')::uuid;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('x.pmu'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
INSERT INTO _o VALUES ('ucv:pm_inactive', inspections.user_can_verify(current_setting('x.kw')::uuid)::text);
INSERT INTO _o VALUES ('pmu:helper_inactive', inspections.user_can_write_responses(current_setting('x.insp')::uuid)::text);
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
UPDATE projects.project_members SET is_active = true
 WHERE project_id = current_setting('x.kw')::uuid AND user_id = current_setting('x.pmu')::uuid;
UPDATE public.user_organisations SET is_active = false
 WHERE organisation_id = current_setting('x.org')::uuid AND user_id = current_setting('x.pmu')::uuid;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('x.pmu'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
INSERT INTO _o VALUES ('ucv:org_inactive', inspections.user_can_verify(current_setting('x.kw')::uuid)::text);
RESET ROLE;

-- 6. C is an active org contractor with NO row on the project at all.
SELECT set_config('request.jwt.claims', '', true);
DELETE FROM projects.project_members
 WHERE project_id = current_setting('x.kw')::uuid AND user_id = current_setting('x.c')::uuid;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('x.c'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.probe('nonmember');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

SELECT * FROM (VALUES
  -- Controls: an active contributor can do everything. Without these the refusals prove nothing.
  ('active: helper true',                         (SELECT v FROM _o WHERE k = 'active:helper') = 'true'),
  ('active: can save an answer',                  (SELECT v FROM _o WHERE k = 'active:resp_ins') = 'ok'),
  ('active: can change an answer',                (SELECT v FROM _o WHERE k = 'active:resp_upd') = '1'),
  ('active: can add a photo',                     (SELECT v FROM _o WHERE k = 'active:photo') = 'ok'),
  ('active: can sign',                            (SELECT v FROM _o WHERE k = 'active:sig') = 'ok'),
  -- Deactivated project member.
  ('inactive: helper false',                      (SELECT v FROM _o WHERE k = 'inactive:helper') = 'false'),
  ('inactive: cannot save an answer',             (SELECT v FROM _o WHERE k = 'inactive:resp_ins') <> 'ok'),
  ('inactive: cannot change an answer',           (SELECT v FROM _o WHERE k = 'inactive:resp_upd') = '0'),
  ('inactive: cannot add a photo',                (SELECT v FROM _o WHERE k = 'inactive:photo') <> 'ok'),
  ('inactive: cannot sign',                       (SELECT v FROM _o WHERE k = 'inactive:sig') <> 'ok'),
  -- Project-scoped client viewer.
  ('project client viewer: helper false',         (SELECT v FROM _o WHERE k = 'pcv:helper') = 'false'),
  ('project client viewer: cannot save',          (SELECT v FROM _o WHERE k = 'pcv:resp_ins') <> 'ok'),
  ('project client viewer: cannot change',        (SELECT v FROM _o WHERE k = 'pcv:resp_upd') = '0'),
  ('project client viewer: cannot add a photo',   (SELECT v FROM _o WHERE k = 'pcv:photo') <> 'ok'),
  ('project client viewer: cannot sign',          (SELECT v FROM _o WHERE k = 'pcv:sig') <> 'ok'),
  -- Verifier arm.
  ('verifier, awaiting verification: not a contributor by status', (SELECT v FROM _o WHERE k = 'ver_active:helper') = 'false'),
  ('verifier, active: is_inspection_verifier true', (SELECT v FROM _o WHERE k = 'ver_active:verifier') = 'true'),
  ('verifier, active: can sign',                  (SELECT v FROM _o WHERE k = 'ver_active:sig') = 'ok'),
  ('verifier, deactivated: is_inspection_verifier false', (SELECT v FROM _o WHERE k = 'ver_inactive:verifier') = 'false'),
  ('verifier, deactivated: cannot sign',          (SELECT v FROM _o WHERE k = 'ver_inactive:sig') <> 'ok'),
  -- An org PM-level member: the effective role cannot refuse them, so pm.is_active must.
  ('org PM-level member, active on the project: helper true',  (SELECT v FROM _o WHERE k = 'pmu:helper_active') = 'true'),
  ('org PM-level member, deactivated on the project: helper false', (SELECT v FROM _o WHERE k = 'pmu:helper_inactive') = 'false'),
  -- user_can_verify.
  ('user_can_verify: active PM-level member true',     (SELECT v FROM _o WHERE k = 'ucv:active') = 'true'),
  ('user_can_verify: deactivated on the project false', (SELECT v FROM _o WHERE k = 'ucv:pm_inactive') = 'false'),
  ('user_can_verify: deactivated in the org false',    (SELECT v FROM _o WHERE k = 'ucv:org_inactive') = 'false'),
  -- Org member who is not on the project.
  ('non-member: cannot sign',                     (SELECT v FROM _o WHERE k = 'nonmember:sig') <> 'ok'),
  ('non-member: cannot save an answer',           (SELECT v FROM _o WHERE k = 'nonmember:resp_ins') <> 'ok'),
  -- Function attributes and grants survive the redefinition.
  ('the three helpers stay SECURITY DEFINER with a pinned search_path',
     (SELECT bool_and(prosecdef AND proconfig::text LIKE '%search_path=%') FROM pg_proc
       WHERE oid IN ('inspections.user_can_write_responses(uuid)'::regprocedure,
                     'inspections.is_inspection_verifier(uuid)'::regprocedure,
                     'inspections.user_can_verify(uuid)'::regprocedure))),
  ('authenticated can still execute them',
     has_function_privilege('authenticated', 'inspections.user_can_write_responses(uuid)', 'EXECUTE')
     AND has_function_privilege('authenticated', 'inspections.is_inspection_verifier(uuid)', 'EXECUTE')
     AND has_function_privilege('authenticated', 'inspections.user_can_verify(uuid)', 'EXECUTE')),
  ('anon cannot execute them',
     NOT has_function_privilege('anon', 'inspections.user_can_write_responses(uuid)', 'EXECUTE')
     AND NOT has_function_privilege('anon', 'inspections.is_inspection_verifier(uuid)', 'EXECUTE')
     AND NOT has_function_privilege('anon', 'inspections.user_can_verify(uuid)', 'EXECUTE'))
) AS t("check", ok);
