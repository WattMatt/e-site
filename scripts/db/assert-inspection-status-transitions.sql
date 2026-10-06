-- scripts/db/assert-inspection-status-transitions.sql
-- Who may move an inspection between statuses, and which columns each move may change.
-- Before the fix, inspections_update_contributors (00066) let any project member who is not an
-- ORG client viewer UPDATE any column to any value: the rbac-test contractor set a probe
-- inspection to 'certified' with verifier_id = self and overall_result = 'pass' (1 row). Every
-- certification rule (assigned verifier, separate verifier, signature qualifications, CoC number)
-- lived only in certifyInspectionAction. Reads used the ORG client-viewer flag too, so a client
-- viewer on the PROJECT read inspections and answers that were not yet certified.
--
-- Run (red on 00234 alone, green with the fix; 00234 is the inspection write gate it builds on):
--   cat <00234> > /tmp/base.sql;  cat <00234> <NNNNN_inspection_status_transitions> > /tmp/fix.sql
--   scripts/db/dry-run-migration.sh /tmp/base.sql scripts/db/assert-inspection-status-transitions.sql
--   scripts/db/dry-run-migration.sh /tmp/fix.sql  scripts/db/assert-inspection-status-transitions.sql
--
-- Every probe goes through pg_temp.try(), so a refusal is recorded, never raised, and the red run
-- reaches the final SELECT. Setup lines run as postgres with the session cleared (auth.uid() NULL),
-- the trusted path the guard exempts. Messages are matched where the assertion must fail for ONE
-- reason, so a mutation that removes an arm turns exactly that assertion red.

-- C   = the rbac-test contractor, active on KINGSWALK (the contributor).
-- PMU = an org owner/admin/PM with an active project_members row on KINGSWALK (the verifier and PM).
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
  IF (SELECT role FROM public.user_organisations WHERE user_id = current_setting('x.c')::uuid
        AND organisation_id = current_setting('x.org')::uuid AND is_active) IS DISTINCT FROM 'contractor' THEN
    RAISE EXCEPTION 'fixture precondition failed: C is not an active org contractor';
  END IF;
  IF (SELECT role FROM projects.project_members WHERE user_id = current_setting('x.c')::uuid
        AND project_id = current_setting('x.kw')::uuid AND is_active) IS DISTINCT FROM 'contractor' THEN
    RAISE EXCEPTION 'fixture precondition failed: C is not an active contractor on KINGSWALK; the promoted-PM probe would test nothing';
  END IF;
END $$;

-- Probe templates, so every certification rule is present and known:
--   T_SEP: inspection_only, requires_separate_verifier = true, one required pass/fail check and one
--          signature field that needs a registered person.
--   T_COC: coc, requires_separate_verifier = false (explicitly), no qualified signature.
WITH t AS (INSERT INTO inspections.templates (organisation_id, template_id, version, name, applies_to_node_types, deliverable_type, schema_json, is_active)
  VALUES (current_setting('x.org')::uuid, 'probe-status-sep', 1, 'status probe (separate verifier)', '{board}', 'inspection_only',
          '{"requires_separate_verifier": true, "sections": [{"section_id": "s1", "title": "S1", "fields": [
              {"field_id": "q1", "type": "pass_fail", "label": "Q1", "required": true},
              {"field_id": "sig", "type": "signature", "label": "Inspector signature", "required_qualifications": ["registered_person"]}]}]}'::jsonb,
          true) RETURNING id)
SELECT set_config('x.tsep', (SELECT id::text FROM t), true);
WITH t AS (INSERT INTO inspections.templates (organisation_id, template_id, version, name, applies_to_node_types, deliverable_type, schema_json, is_active)
  VALUES (current_setting('x.org')::uuid, 'probe-status-coc', 1, 'status probe (coc)', '{board}', 'coc',
          '{"requires_separate_verifier": false, "sections": [{"section_id": "s1", "title": "S1", "fields": [
              {"field_id": "q1", "type": "pass_fail", "label": "Q1", "required": true}]}]}'::jsonb,
          true) RETURNING id)
SELECT set_config('x.tcoc', (SELECT id::text FROM t), true);

-- Inspections. I1 walks the whole life cycle; I2 is a CoC; I3 is abandoned; I4 is driven by a
-- project-promoted PM; I5 stays uncertified for the read probes; I6 is submitted over WhatsApp.
CREATE FUNCTION pg_temp.mk(tmpl text, label text, st text) RETURNS text LANGUAGE sql AS $f$
  INSERT INTO inspections.inspections (organisation_id, project_id, template_id, target_node_type, target_label,
                                       assigned_to_id, verifier_id, status, created_by)
  VALUES (current_setting('x.org')::uuid, current_setting('x.kw')::uuid, tmpl::uuid, 'adhoc', label,
          current_setting('x.c')::uuid, current_setting('x.pmu')::uuid, st, current_setting('x.c')::uuid)
  RETURNING id::text
$f$;
SELECT set_config('x.i1', pg_temp.mk(current_setting('x.tsep'), 'status probe 1', 'assigned'), true);
SELECT set_config('x.i2', pg_temp.mk(current_setting('x.tcoc'), 'status probe 2', 'awaiting_verification'), true);
SELECT set_config('x.i3', pg_temp.mk(current_setting('x.tsep'), 'status probe 3', 'in_progress'), true);
SELECT set_config('x.i4', pg_temp.mk(current_setting('x.tsep'), 'status probe 4', 'assigned'), true);
SELECT set_config('x.i5', pg_temp.mk(current_setting('x.tsep'), 'status probe 5', 'in_progress'), true);
SELECT set_config('x.i6', pg_temp.mk(current_setting('x.tsep'), 'status probe 6', 'in_progress'), true);
-- An answer on I5 for the read probes (no session: the history trigger takes latest_responded_by).
INSERT INTO inspections.responses (inspection_id, section_id, field_id, pass_state, latest_responded_by)
VALUES (current_setting('x.i5')::uuid, 's1', 'q1', 'pass', current_setting('x.c')::uuid);

CREATE TEMP TABLE _o (k text PRIMARY KEY, v text);
GRANT ALL ON _o TO authenticated, service_role;

-- Runs the statement as whoever is signed in. Records the row count, or 'ERR <message>'.
CREATE FUNCTION pg_temp.try(tag text, stmt text) RETURNS void LANGUAGE plpgsql AS $p$
DECLARE n int;
BEGIN
  EXECUTE stmt;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO _o VALUES (tag, n::text);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _o VALUES (tag, 'ERR ' || SQLERRM);
END $p$;
-- Records a value read as the signed-in user (a refusal is recorded too).
CREATE FUNCTION pg_temp.val(tag text, q text) RETURNS void LANGUAGE plpgsql AS $p$
DECLARE r text;
BEGIN
  EXECUTE q INTO r;
  INSERT INTO _o VALUES (tag, coalesce(r, '<null>'));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _o VALUES (tag, 'ERR ' || SQLERRM);
END $p$;
-- Signs in as x.<who>, or clears the session for NULL. Both claim forms are cleared, because
-- whatsapp.act_as sets request.jwt.claim.sub as well and it outlives the call.
CREATE FUNCTION pg_temp.who(k text) RETURNS void LANGUAGE plpgsql AS $p$
BEGIN
  IF k IS NULL THEN
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claim.role', '', true);
  ELSE
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('x.' || k), 'role', 'authenticated')::text, true);
  END IF;
END $p$;
GRANT EXECUTE ON FUNCTION pg_temp.try(text, text), pg_temp.val(text, text), pg_temp.who(text) TO authenticated, service_role;

-- ── A. The contributor, on I1 (assigned) ─────────────────────────────────────────────────────
SELECT pg_temp.who('c'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('c:certify',      $$UPDATE inspections.inspections SET status = 'certified', verifier_id = auth.uid(), overall_result = 'pass' WHERE id = current_setting('x.i1')::uuid$$);
SELECT pg_temp.try('c:result',       $$UPDATE inspections.inspections SET overall_result = 'pass' WHERE id = current_setting('x.i1')::uuid$$);
SELECT pg_temp.try('c:verifier',     $$UPDATE inspections.inspections SET verifier_id = auth.uid() WHERE id = current_setting('x.i1')::uuid$$);
SELECT pg_temp.try('c:label',        $$UPDATE inspections.inspections SET target_label = 'renamed by contractor' WHERE id = current_setting('x.i1')::uuid$$);
SELECT pg_temp.try('c:abandon',      $$UPDATE inspections.inspections SET status = 'abandoned', abandoned_reason = 'mine' WHERE id = current_setting('x.i1')::uuid$$);
SELECT pg_temp.try('c:skip_submit',  $$UPDATE inspections.inspections SET status = 'awaiting_verification' WHERE id = current_setting('x.i1')::uuid$$);
SELECT pg_temp.try('c:noop',         $$UPDATE inspections.inspections SET target_label = target_label WHERE id = current_setting('x.i1')::uuid$$);
RESET ROLE; SELECT pg_temp.who(NULL);
-- Undo whatever the red run let through, so each later probe starts from the state it names.
UPDATE inspections.inspections SET status = 'assigned', verifier_id = current_setting('x.pmu')::uuid, overall_result = NULL,
       target_label = 'status probe 1', abandoned_reason = NULL, abandoned_at = NULL, abandoned_by = NULL, completed_at = NULL
 WHERE id = current_setting('x.i1')::uuid;

-- The first answer starts the inspection through 00066's trigger, which runs as the contributor.
SELECT pg_temp.who('c'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('c:first_answer', $$INSERT INTO inspections.responses (inspection_id, section_id, field_id, pass_state, latest_responded_by)
                                       VALUES (current_setting('x.i1')::uuid, 's1', 'q1', 'pass', auth.uid())$$);
RESET ROLE; SELECT pg_temp.who(NULL);
INSERT INTO _o SELECT 'i1:after_first_answer', status || '/' || (started_at IS NOT NULL)::text FROM inspections.inspections WHERE id = current_setting('x.i1')::uuid;
-- now() is fixed for the whole transaction, so the first start time is pinned to a past value;
-- otherwise "keeps the first start time" could not tell COALESCE(OLD.started_at, now()) from now().
UPDATE inspections.inspections SET started_at = '2020-01-01 00:00:00+00' WHERE id = current_setting('x.i1')::uuid;
SELECT set_config('x.started1', (SELECT started_at::text FROM inspections.inspections WHERE id = current_setting('x.i1')::uuid), true);

-- Submit, with a back-dated completed_at the guard must replace.
SELECT pg_temp.who('c'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('c:submit',       $$UPDATE inspections.inspections SET status = 'awaiting_verification', completed_at = '2000-01-01',
                                              submitted_via = 'web', submitted_session_id = NULL
                                       WHERE id = current_setting('x.i1')::uuid AND status IN ('in_progress','re-inspect_required')$$);
SELECT pg_temp.try('c:unsubmit',     $$UPDATE inspections.inspections SET status = 'in_progress' WHERE id = current_setting('x.i1')::uuid$$);
SELECT pg_temp.try('c:send_back',    $$UPDATE inspections.inspections SET status = 're-inspect_required', reinspection_notes = 'n' WHERE id = current_setting('x.i1')::uuid$$);
RESET ROLE; SELECT pg_temp.who(NULL);
INSERT INTO _o SELECT 'i1:completed_at', (completed_at > '2001-01-01')::text FROM inspections.inspections WHERE id = current_setting('x.i1')::uuid;
UPDATE inspections.inspections SET status = 'awaiting_verification', reinspection_notes = NULL WHERE id = current_setting('x.i1')::uuid;

-- ── B. Certification of I1 (awaiting verification, verifier PMU, C answered) ─────────────────
-- No qualified signature yet.
SELECT pg_temp.who('pmu'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('v:no_signature', $$UPDATE inspections.inspections SET status = 'certified', overall_result = 'pass' WHERE id = current_setting('x.i1')::uuid$$);
RESET ROLE; SELECT pg_temp.who(NULL);
UPDATE inspections.inspections SET status = 'awaiting_verification', overall_result = NULL, certified_at = NULL, coc_number = NULL WHERE id = current_setting('x.i1')::uuid;
INSERT INTO inspections.signatures (inspection_id, section_id, field_id, role, signatory_name, signatory_title, registration_number, storage_path, signed_by)
VALUES (current_setting('x.i1')::uuid, 's1', 'sig', 'inspector', 'Probe Inspector', 'Electrician', 'RP-12345', 'probe/sig.png', current_setting('x.c')::uuid);

-- The contributor as verifier: the template needs a separate verifier.
UPDATE inspections.inspections SET verifier_id = current_setting('x.c')::uuid WHERE id = current_setting('x.i1')::uuid;
SELECT pg_temp.who('c'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('c_as_verifier:certify', $$UPDATE inspections.inspections SET status = 'certified', overall_result = 'pass' WHERE id = current_setting('x.i1')::uuid$$);
RESET ROLE; SELECT pg_temp.who(NULL);
UPDATE inspections.inspections SET status = 'awaiting_verification', verifier_id = current_setting('x.pmu')::uuid, overall_result = NULL,
       certified_at = NULL, coc_number = NULL WHERE id = current_setting('x.i1')::uuid;

-- The real verifier, each wrong shape on its own (the template rules are all met from here on).
SELECT pg_temp.who('pmu'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('v:fail',          $$UPDATE inspections.inspections SET status = 'certified', overall_result = 'fail' WHERE id = current_setting('x.i1')::uuid$$);
SELECT pg_temp.try('v:no_result',     $$UPDATE inspections.inspections SET status = 'certified' WHERE id = current_setting('x.i1')::uuid$$);
SELECT pg_temp.try('v:extra_column',  $$UPDATE inspections.inspections SET status = 'certified', overall_result = 'pass', target_label = 'x' WHERE id = current_setting('x.i1')::uuid$$);
SELECT pg_temp.try('v:blank_notes',   $$UPDATE inspections.inspections SET status = 're-inspect_required', reinspection_notes = '   ' WHERE id = current_setting('x.i1')::uuid$$);
SELECT pg_temp.val('v:blockers_ok',   $$SELECT inspections.certification_blockers(current_setting('x.i1')::uuid)$$);
RESET ROLE; SELECT pg_temp.who(NULL);
UPDATE inspections.inspections SET status = 'awaiting_verification', overall_result = NULL, certified_at = NULL, coc_number = NULL,
       target_label = 'status probe 1', reinspection_notes = NULL WHERE id = current_setting('x.i1')::uuid;

-- A PM who is not the verifier (C promoted to project_manager on the project).
UPDATE projects.project_members SET role = 'project_manager' WHERE project_id = current_setting('x.kw')::uuid AND user_id = current_setting('x.c')::uuid;
SELECT pg_temp.who('c'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('pm_not_verifier:certify',   $$UPDATE inspections.inspections SET status = 'certified', overall_result = 'pass' WHERE id = current_setting('x.i1')::uuid$$);
SELECT pg_temp.try('pm_not_verifier:send_back', $$UPDATE inspections.inspections SET status = 're-inspect_required', reinspection_notes = 'n' WHERE id = current_setting('x.i1')::uuid$$);
SELECT pg_temp.val('pm_not_verifier:blockers',  $$SELECT inspections.certification_blockers(current_setting('x.i1')::uuid)$$);
RESET ROLE; SELECT pg_temp.who(NULL);
UPDATE projects.project_members SET role = 'contractor' WHERE project_id = current_setting('x.kw')::uuid AND user_id = current_setting('x.c')::uuid;
UPDATE inspections.inspections SET status = 'awaiting_verification', overall_result = NULL, certified_at = NULL, coc_number = NULL,
       reinspection_notes = NULL WHERE id = current_setting('x.i1')::uuid;

-- Send back, re-answer (keeps the first start time), resubmit, certify.
SELECT pg_temp.who('pmu'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('v:send_back',    $$UPDATE inspections.inspections SET status = 're-inspect_required', reinspection_notes = 'Re-test Q1'
                                       WHERE id = current_setting('x.i1')::uuid AND status = 'awaiting_verification'$$);
RESET ROLE; SELECT pg_temp.who(NULL);
SELECT pg_temp.who('c'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('c:reanswer',     $$INSERT INTO inspections.responses (inspection_id, section_id, field_id, pass_state, latest_responded_by)
                                       VALUES (current_setting('x.i1')::uuid, 's1', 'q1_note', 'pass', auth.uid())$$);
RESET ROLE; SELECT pg_temp.who(NULL);
INSERT INTO _o SELECT 'i1:after_reanswer', status || '/' || (started_at::text = current_setting('x.started1'))::text FROM inspections.inspections WHERE id = current_setting('x.i1')::uuid;
SELECT pg_temp.who('c'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('c:resubmit',     $$UPDATE inspections.inspections SET status = 'awaiting_verification', completed_at = now()
                                       WHERE id = current_setting('x.i1')::uuid AND status IN ('in_progress','re-inspect_required')$$);
RESET ROLE; SELECT pg_temp.who(NULL);
SELECT pg_temp.who('pmu'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('v:certify',      $$UPDATE inspections.inspections SET status = 'certified', overall_result = 'pass',
                                              certified_at = '2000-01-01', coc_number = 'FORGED-0001'
                                       WHERE id = current_setting('x.i1')::uuid$$);
RESET ROLE; SELECT pg_temp.who(NULL);
INSERT INTO _o SELECT 'i1:certified', status || '/' || (certified_at > '2001-01-01')::text || '/' || coalesce(coc_number, '<null>')
  FROM inspections.inspections WHERE id = current_setting('x.i1')::uuid;

-- Certified is final for every signed-in caller.
SELECT pg_temp.who('pmu'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('certified:pm_label',   $$UPDATE inspections.inspections SET target_label = 'after the fact' WHERE id = current_setting('x.i1')::uuid$$);
SELECT pg_temp.try('certified:pm_abandon', $$UPDATE inspections.inspections SET status = 'abandoned', abandoned_reason = 'r' WHERE id = current_setting('x.i1')::uuid$$);
RESET ROLE; SELECT pg_temp.who(NULL);
SELECT pg_temp.who('c'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('certified:c_result',   $$UPDATE inspections.inspections SET overall_result = 'conditional_pass' WHERE id = current_setting('x.i1')::uuid$$);
RESET ROLE; SELECT pg_temp.who(NULL);
-- A node deleted under a certified inspection nulls target_node_id through the FK cascade, which
-- the guard must allow; the same change as a client's own UPDATE must not be.
WITH n AS (INSERT INTO structure.nodes (project_id, organisation_id, kind, code)
           VALUES (current_setting('x.kw')::uuid, current_setting('x.org')::uuid, 'sub_board', 'PROBE-STATUS-NODE') RETURNING id)
SELECT set_config('x.node', (SELECT id::text FROM n), true);
UPDATE inspections.inspections SET status = 'certified', target_node_type = 'board', target_node_id = current_setting('x.node')::uuid
 WHERE id = current_setting('x.i1')::uuid;
SELECT pg_temp.who('pmu'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('certified:pm_detach', $$UPDATE inspections.inspections SET target_node_id = NULL WHERE id = current_setting('x.i1')::uuid$$);
RESET ROLE;
-- Still signed in as PMU (auth.uid() set) but as postgres, so the node table's own RLS is not the subject.
SELECT pg_temp.try('certified:node_deleted', $$DELETE FROM structure.nodes WHERE id = current_setting('x.node')::uuid$$);
SELECT pg_temp.who(NULL);
INSERT INTO _o SELECT 'i1:after_node_delete', status || '/' || coalesce(target_node_id::text, '<null>') FROM inspections.inspections WHERE id = current_setting('x.i1')::uuid;
-- Undo what the red run let through: the read probes in G need I1 certified.
UPDATE inspections.inspections SET status = 'certified', target_label = 'status probe 1', overall_result = 'pass',
       abandoned_reason = NULL, abandoned_at = NULL, abandoned_by = NULL WHERE id = current_setting('x.i1')::uuid;
-- ...but not for the service role.
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SET LOCAL ROLE service_role;
SELECT pg_temp.try('service:edit_certified', $$UPDATE inspections.inspections SET reinspection_notes = 'ops note' WHERE id = current_setting('x.i1')::uuid$$);
RESET ROLE; SELECT pg_temp.who(NULL);

-- ── C. CoC numbers, on I2 (coc template, awaiting verification) ─────────────────────────────
SELECT pg_temp.who('pmu'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('coc:missing',    $$UPDATE inspections.inspections SET status = 'certified', overall_result = 'pass' WHERE id = current_setting('x.i2')::uuid$$);
SELECT pg_temp.try('coc:blank',      $$UPDATE inspections.inspections SET status = 'certified', overall_result = 'pass', coc_number = '  ' WHERE id = current_setting('x.i2')::uuid$$);
RESET ROLE; SELECT pg_temp.who(NULL);
UPDATE inspections.inspections SET status = 'awaiting_verification', overall_result = NULL, certified_at = NULL, coc_number = NULL WHERE id = current_setting('x.i2')::uuid;
SELECT pg_temp.who('pmu'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('coc:given',      $$UPDATE inspections.inspections SET status = 'certified', overall_result = 'conditional_pass', coc_number = 'ECB-PROBE-77'
                                       WHERE id = current_setting('x.i2')::uuid$$);
RESET ROLE; SELECT pg_temp.who(NULL);
INSERT INTO _o SELECT 'i2:certified', status || '/' || coalesce(coc_number, '<null>') FROM inspections.inspections WHERE id = current_setting('x.i2')::uuid;

-- ── D. Abandon, on I3 (in progress) ──────────────────────────────────────────────────────────
SELECT pg_temp.who('pmu'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('pm:abandon_no_reason', $$UPDATE inspections.inspections SET status = 'abandoned', abandoned_reason = '' WHERE id = current_setting('x.i3')::uuid$$);
RESET ROLE; SELECT pg_temp.who(NULL);
UPDATE inspections.inspections SET status = 'in_progress', abandoned_reason = NULL, abandoned_at = NULL, abandoned_by = NULL WHERE id = current_setting('x.i3')::uuid;
SELECT pg_temp.who('pmu'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('pm:abandon',     $$UPDATE inspections.inspections SET status = 'abandoned', abandoned_reason = 'Board replaced',
                                              abandoned_by = current_setting('x.c')::uuid, abandoned_at = '2000-01-01'
                                       WHERE id = current_setting('x.i3')::uuid$$);
SELECT pg_temp.try('abandoned:pm_reassign', $$UPDATE inspections.inspections SET assigned_to_id = auth.uid() WHERE id = current_setting('x.i3')::uuid$$);
RESET ROLE; SELECT pg_temp.who(NULL);
INSERT INTO _o SELECT 'i3:abandoned', status || '/' || (abandoned_by = current_setting('x.pmu')::uuid)::text || '/' || (abandoned_at > '2001-01-01')::text
  FROM inspections.inspections WHERE id = current_setting('x.i3')::uuid;

-- ── E. PM-or-above by project promotion, on I4; identity columns; contractor reassign ───────
SELECT pg_temp.who('c'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('contractor:reassign', $$UPDATE inspections.inspections SET assigned_to_id = current_setting('x.pmu')::uuid WHERE id = current_setting('x.i4')::uuid$$);
RESET ROLE; SELECT pg_temp.who(NULL);
UPDATE inspections.inspections SET assigned_to_id = current_setting('x.c')::uuid WHERE id = current_setting('x.i4')::uuid;
UPDATE projects.project_members SET role = 'project_manager' WHERE project_id = current_setting('x.kw')::uuid AND user_id = current_setting('x.c')::uuid;
SELECT pg_temp.who('c'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('promoted_pm:reassign', $$UPDATE inspections.inspections SET verifier_id = current_setting('x.pmu')::uuid, assigned_to_id = current_setting('x.pmu')::uuid,
                                                     scheduled_at = now() + interval '1 day'
                                              WHERE id = current_setting('x.i4')::uuid$$);
SELECT pg_temp.try('promoted_pm:abandon',  $$UPDATE inspections.inspections SET status = 'abandoned', abandoned_reason = 'Duplicate' WHERE id = current_setting('x.i4')::uuid$$);
RESET ROLE; SELECT pg_temp.who(NULL);
UPDATE projects.project_members SET role = 'contractor' WHERE project_id = current_setting('x.kw')::uuid AND user_id = current_setting('x.c')::uuid;
SELECT pg_temp.who('pmu'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('pm:reassign',      $$UPDATE inspections.inspections SET verifier_id = current_setting('x.c')::uuid WHERE id = current_setting('x.i5')::uuid$$);
SELECT pg_temp.try('pm:created_by',    $$UPDATE inspections.inspections SET created_by = auth.uid() WHERE id = current_setting('x.i5')::uuid$$);
SELECT pg_temp.try('pm:template',      $$UPDATE inspections.inspections SET template_id = current_setting('x.tcoc')::uuid WHERE id = current_setting('x.i5')::uuid$$);
RESET ROLE; SELECT pg_temp.who(NULL);
UPDATE inspections.inspections SET created_by = current_setting('x.c')::uuid, template_id = current_setting('x.tsep')::uuid WHERE id = current_setting('x.i5')::uuid;

-- ── F. WhatsApp submit (00229) still works: it runs as the person, through the same guard ────
INSERT INTO whatsapp.org_settings (organisation_id, forms_enabled) VALUES (current_setting('x.org')::uuid, true)
ON CONFLICT (organisation_id) DO UPDATE SET forms_enabled = true;
WITH s AS (INSERT INTO whatsapp.form_sessions (token_hash, user_id, inspection_id, template_row_id, expires_at)
           VALUES ('status-probe-' || gen_random_uuid(), current_setting('x.c')::uuid, current_setting('x.i6')::uuid,
                   current_setting('x.tsep')::uuid, now() + interval '1 hour') RETURNING id)
SELECT set_config('x.sess', (SELECT id::text FROM s), true);
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
SET LOCAL ROLE service_role;
SELECT pg_temp.val('wa:submit', $$SELECT whatsapp.wa_inspection_submit(current_setting('x.c')::uuid, current_setting('x.i6')::uuid, current_setting('x.sess')::uuid)->>'code'$$);
RESET ROLE; SELECT pg_temp.who(NULL);
INSERT INTO _o SELECT 'i6:submitted', status || '/' || coalesce(submitted_via, '<null>') || '/' || (submitted_session_id::text = current_setting('x.sess'))::text
  FROM inspections.inspections WHERE id = current_setting('x.i6')::uuid;

-- ── F2. A manager who is not a contributor: the org PM with their project row DEACTIVATED is still
--        in through user_has_project_access clause (b) and manages through the org role, but may not
--        start or submit, and may not read answers. (For a contractor, a NULL effective role already
--        refuses; only an org PM-level member isolates pm.is_active, as 00234 found.) ─────────────
SELECT set_config('x.i7', pg_temp.mk(current_setting('x.tsep'), 'status probe 7', 'assigned'), true);
UPDATE projects.project_members SET is_active = false WHERE project_id = current_setting('x.kw')::uuid AND user_id = current_setting('x.pmu')::uuid;
SELECT pg_temp.who('pmu'); SET LOCAL ROLE authenticated;
SELECT pg_temp.try('offproject_pm:start',    $$UPDATE inspections.inspections SET status = 'in_progress' WHERE id = current_setting('x.i7')::uuid$$);
SELECT pg_temp.try('offproject_pm:submit',   $$UPDATE inspections.inspections SET status = 'awaiting_verification' WHERE id = current_setting('x.i5')::uuid$$);
SELECT pg_temp.try('offproject_pm:reassign', $$UPDATE inspections.inspections SET assigned_to_id = auth.uid() WHERE id = current_setting('x.i7')::uuid$$);
SELECT pg_temp.val('offproject_pm:answers_i5', $$SELECT count(*) FROM inspections.responses WHERE inspection_id = current_setting('x.i5')::uuid$$);
RESET ROLE; SELECT pg_temp.who(NULL);
UPDATE inspections.inspections SET status = 'in_progress' WHERE id = current_setting('x.i5')::uuid;

-- ── G. Reads and the UPDATE policy. I5 is uncertified with an answer; I1 is certified. ──────
-- Control: the active contractor.
SELECT pg_temp.who('c'); SET LOCAL ROLE authenticated;
SELECT pg_temp.val('c:sees_i5',        $$SELECT count(*) FROM inspections.inspections WHERE id = current_setting('x.i5')::uuid$$);
SELECT pg_temp.val('c:answers_i5',     $$SELECT count(*) FROM inspections.responses WHERE inspection_id = current_setting('x.i5')::uuid$$);
RESET ROLE; SELECT pg_temp.who(NULL);
-- A client viewer on the PROJECT whose org role is contractor.
UPDATE projects.project_members SET role = 'client_viewer' WHERE project_id = current_setting('x.kw')::uuid AND user_id = current_setting('x.c')::uuid;
SELECT pg_temp.who('c'); SET LOCAL ROLE authenticated;
SELECT pg_temp.val('pcv:sees_i5',      $$SELECT count(*) FROM inspections.inspections WHERE id = current_setting('x.i5')::uuid$$);
SELECT pg_temp.val('pcv:answers_i5',   $$SELECT count(*) FROM inspections.responses WHERE inspection_id = current_setting('x.i5')::uuid$$);
SELECT pg_temp.val('pcv:sees_i1',      $$SELECT count(*) FROM inspections.inspections WHERE id = current_setting('x.i1')::uuid$$);
SELECT pg_temp.val('pcv:answers_i1',   $$SELECT count(*) FROM inspections.responses WHERE inspection_id = current_setting('x.i1')::uuid$$);
SELECT pg_temp.try('pcv:update_i5',    $$UPDATE inspections.inspections SET target_label = target_label WHERE id = current_setting('x.i5')::uuid$$);
-- I1 is certified, so the SELECT policy shows it to them: only the UPDATE policy can match zero rows here
-- (without it the row reaches the guard and is refused with an error instead).
SELECT pg_temp.try('pcv:update_i1',    $$UPDATE inspections.inspections SET target_label = target_label WHERE id = current_setting('x.i1')::uuid$$);
RESET ROLE; SELECT pg_temp.who(NULL);
-- The same person deactivated on the project.
UPDATE projects.project_members SET role = 'contractor', is_active = false WHERE project_id = current_setting('x.kw')::uuid AND user_id = current_setting('x.c')::uuid;
SELECT pg_temp.who('c'); SET LOCAL ROLE authenticated;
SELECT pg_temp.val('inactive:answers_i5', $$SELECT count(*) FROM inspections.responses WHERE inspection_id = current_setting('x.i5')::uuid$$);
RESET ROLE; SELECT pg_temp.who(NULL);
-- An ORG client viewer (control: unchanged by the fix).
UPDATE projects.project_members SET is_active = true WHERE project_id = current_setting('x.kw')::uuid AND user_id = current_setting('x.c')::uuid;
UPDATE public.user_organisations SET role = 'client_viewer' WHERE organisation_id = current_setting('x.org')::uuid AND user_id = current_setting('x.c')::uuid;
SELECT pg_temp.who('c'); SET LOCAL ROLE authenticated;
SELECT pg_temp.val('ocv:sees_i5',      $$SELECT count(*) FROM inspections.inspections WHERE id = current_setting('x.i5')::uuid$$);
SELECT pg_temp.val('ocv:sees_i1',      $$SELECT count(*) FROM inspections.inspections WHERE id = current_setting('x.i1')::uuid$$);
SELECT pg_temp.val('ocv:answers_i1',   $$SELECT count(*) FROM inspections.responses WHERE inspection_id = current_setting('x.i1')::uuid$$);
RESET ROLE; SELECT pg_temp.who(NULL);

SELECT * FROM (VALUES
  -- A. The contributor cannot certify, set a result, name themselves verifier, rename, abandon or skip a step.
  ('contributor cannot certify (the demonstrated bug)',   (SELECT v FROM _o WHERE k = 'c:certify') LIKE 'ERR %'),
  ('contributor cannot set overall_result',               (SELECT v FROM _o WHERE k = 'c:result') LIKE 'ERR %'),
  ('contributor cannot name themselves verifier',         (SELECT v FROM _o WHERE k = 'c:verifier') LIKE 'ERR %project manager%'),
  ('contributor cannot rename the target',                (SELECT v FROM _o WHERE k = 'c:label') LIKE 'ERR %project manager%'),
  ('contributor cannot abandon',                          (SELECT v FROM _o WHERE k = 'c:abandon') LIKE 'ERR %project manager%'),
  ('contributor cannot submit an unstarted inspection',   (SELECT v FROM _o WHERE k = 'c:skip_submit') LIKE 'ERR %cannot move from assigned%'),
  ('a no-op update passes the guard',                     (SELECT v FROM _o WHERE k = 'c:noop') = '1'),
  ('first answer saves and starts the inspection',        (SELECT v FROM _o WHERE k = 'c:first_answer') = '1'
                                                          AND (SELECT v FROM _o WHERE k = 'i1:after_first_answer') = 'in_progress/true'),
  ('contributor can submit',                              (SELECT v FROM _o WHERE k = 'c:submit') = '1'),
  ('submit stamps completed_at itself (no back-dating)',  (SELECT v FROM _o WHERE k = 'i1:completed_at') = 'true'),
  ('contributor cannot pull a submission back',           (SELECT v FROM _o WHERE k = 'c:unsubmit') LIKE 'ERR %cannot move from awaiting_verification%'),
  ('contributor cannot send back',                        (SELECT v FROM _o WHERE k = 'c:send_back') LIKE 'ERR %verifier%'),
  -- B. Certification.
  ('verifier cannot certify without the qualified signature', (SELECT v FROM _o WHERE k = 'v:no_signature') LIKE 'ERR %Signature requirement%'),
  ('a contributor cannot certify as the verifier',        (SELECT v FROM _o WHERE k = 'c_as_verifier:certify') LIKE 'ERR %also be a contributor%'),
  ('verifier cannot certify a FAIL',                      (SELECT v FROM _o WHERE k = 'v:fail') LIKE 'ERR %pass or conditional pass%'),
  ('verifier cannot certify without a result',            (SELECT v FROM _o WHERE k = 'v:no_result') LIKE 'ERR %pass or conditional pass%'),
  ('certify cannot change other columns',                 (SELECT v FROM _o WHERE k = 'v:extra_column') LIKE 'ERR %may change only%'),
  ('send back needs a note',                              (SELECT v FROM _o WHERE k = 'v:blank_notes') LIKE 'ERR %note%'),
  ('certification_blockers is NULL for the verifier when all rules are met', (SELECT v FROM _o WHERE k = 'v:blockers_ok') = '<null>'),
  ('a PM who is not the verifier cannot certify',         (SELECT v FROM _o WHERE k = 'pm_not_verifier:certify') LIKE 'ERR %assigned verifier%'),
  ('a PM who is not the verifier cannot send back',       (SELECT v FROM _o WHERE k = 'pm_not_verifier:send_back') LIKE 'ERR %verifier%'),
  ('certification_blockers names the verifier rule to a non-verifier', (SELECT v FROM _o WHERE k = 'pm_not_verifier:blockers') LIKE '%assigned verifier%'),
  ('verifier can send back with a note',                  (SELECT v FROM _o WHERE k = 'v:send_back') = '1'),
  ('re-answering restarts and keeps the first start time', (SELECT v FROM _o WHERE k = 'c:reanswer') = '1'
                                                          AND (SELECT v FROM _o WHERE k = 'i1:after_reanswer') = 'in_progress/true'),
  ('contributor can resubmit',                            (SELECT v FROM _o WHERE k = 'c:resubmit') = '1'),
  ('verifier can certify',                                (SELECT v FROM _o WHERE k = 'v:certify') = '1'),
  ('certify stamps certified_at and allocates the INS number (forged values ignored)',
                                                          (SELECT v FROM _o WHERE k = 'i1:certified') LIKE 'certified/true/INS-%'),
  ('certified: PM cannot edit',                           (SELECT v FROM _o WHERE k = 'certified:pm_label') LIKE 'ERR %no longer be changed%'),
  ('certified: PM cannot abandon',                        (SELECT v FROM _o WHERE k = 'certified:pm_abandon') LIKE 'ERR %no longer be changed%'),
  ('certified: contributor cannot change the result',     (SELECT v FROM _o WHERE k = 'certified:c_result') LIKE 'ERR %'),
  ('service role can still correct a certified row',      (SELECT v FROM _o WHERE k = 'service:edit_certified') = '1'),
  ('certified: a client cannot detach the record from its board', (SELECT v FROM _o WHERE k = 'certified:pm_detach') LIKE 'ERR %no longer be changed%'),
  ('certified: deleting the board still nulls target_node_id', (SELECT v FROM _o WHERE k = 'certified:node_deleted') = '1'
                                                          AND (SELECT v FROM _o WHERE k = 'i1:after_node_delete') = 'certified/<null>'),
  -- C. CoC numbers.
  ('CoC: certify refused without a number',               (SELECT v FROM _o WHERE k = 'coc:missing') LIKE 'ERR %COC number is required%'),
  ('CoC: certify refused with a blank number',            (SELECT v FROM _o WHERE k = 'coc:blank') LIKE 'ERR %COC number is required%'),
  ('CoC: the verifier''s number is kept',                 (SELECT v FROM _o WHERE k = 'coc:given') = '1'
                                                          AND (SELECT v FROM _o WHERE k = 'i2:certified') = 'certified/ECB-PROBE-77'),
  -- D. Abandon.
  ('abandon needs a reason',                              (SELECT v FROM _o WHERE k = 'pm:abandon_no_reason') LIKE 'ERR %reason%'),
  ('PM can abandon',                                      (SELECT v FROM _o WHERE k = 'pm:abandon') = '1'),
  ('abandon stamps abandoned_by = caller and abandoned_at itself', (SELECT v FROM _o WHERE k = 'i3:abandoned') = 'abandoned/true/true'),
  ('abandoned: PM cannot reassign',                       (SELECT v FROM _o WHERE k = 'abandoned:pm_reassign') LIKE 'ERR %no longer be changed%'),
  -- E. PM or above, including by project promotion; identity columns.
  ('a contractor cannot reassign',                        (SELECT v FROM _o WHERE k = 'contractor:reassign') LIKE 'ERR %project manager%'),
  ('a project-promoted PM can reassign and reschedule',   (SELECT v FROM _o WHERE k = 'promoted_pm:reassign') = '1'),
  ('a project-promoted PM can abandon',                   (SELECT v FROM _o WHERE k = 'promoted_pm:abandon') = '1'),
  ('an org PM can reassign the verifier',                 (SELECT v FROM _o WHERE k = 'pm:reassign') = '1'),
  ('nobody signed in can change created_by',              (SELECT v FROM _o WHERE k = 'pm:created_by') LIKE 'ERR %may change only%'),
  ('nobody signed in can change the template',            (SELECT v FROM _o WHERE k = 'pm:template') LIKE 'ERR %may change only%'),
  -- F. WhatsApp.
  ('WhatsApp submit still moves the inspection',          (SELECT v FROM _o WHERE k = 'wa:submit') = 'ok'
                                                          AND (SELECT v FROM _o WHERE k = 'i6:submitted') = 'awaiting_verification/whatsapp/true'),
  ('a manager who is not a contributor cannot start',     (SELECT v FROM _o WHERE k = 'offproject_pm:start') LIKE 'ERR %contributor can start%'),
  ('a manager who is not a contributor cannot submit',    (SELECT v FROM _o WHERE k = 'offproject_pm:submit') LIKE 'ERR %contributor can submit%'),
  ('an org PM deactivated on the project can still reassign', (SELECT v FROM _o WHERE k = 'offproject_pm:reassign') = '1'),
  ('an org PM deactivated on the project cannot read answers', (SELECT v FROM _o WHERE k = 'offproject_pm:answers_i5') = '0'),
  -- G. Reads and the UPDATE policy.
  ('control: contractor sees an uncertified inspection',  (SELECT v FROM _o WHERE k = 'c:sees_i5') = '1'),
  ('control: contractor reads its answers',               (SELECT v FROM _o WHERE k = 'c:answers_i5') = '1'),
  ('project client viewer cannot see an uncertified inspection', (SELECT v FROM _o WHERE k = 'pcv:sees_i5') = '0'),
  ('project client viewer cannot read uncertified answers', (SELECT v FROM _o WHERE k = 'pcv:answers_i5') = '0'),
  ('project client viewer sees a certified inspection',   (SELECT v FROM _o WHERE k = 'pcv:sees_i1') = '1'),
  ('project client viewer reads certified answers',       (SELECT v FROM _o WHERE k = 'pcv:answers_i1') <> '0' AND (SELECT v FROM _o WHERE k = 'pcv:answers_i1') NOT LIKE 'ERR%'),
  ('project client viewer cannot update',                 (SELECT v FROM _o WHERE k = 'pcv:update_i5') = '0'),
  ('project client viewer: the UPDATE policy matches no row it can see', (SELECT v FROM _o WHERE k = 'pcv:update_i1') = '0'),
  ('deactivated member cannot read answers',              (SELECT v FROM _o WHERE k = 'inactive:answers_i5') = '0'),
  ('control: org client viewer sees certified only',      (SELECT v FROM _o WHERE k = 'ocv:sees_i5') = '0' AND (SELECT v FROM _o WHERE k = 'ocv:sees_i1') = '1'),
  ('control: org client viewer reads certified answers',  (SELECT v FROM _o WHERE k = 'ocv:answers_i1') <> '0' AND (SELECT v FROM _o WHERE k = 'ocv:answers_i1') NOT LIKE 'ERR%'),
  -- H. Objects, attributes and grants.
  ('the guard trigger is installed and enabled',
     EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'inspections.inspections'::regclass
              AND tgname = 'trg_inspections_transition_guard' AND tgenabled = 'O')),
  ('signed-in users cannot call allocate_coc_number',     NOT has_function_privilege('authenticated', 'inspections.allocate_coc_number(uuid)', 'EXECUTE')),
  ('anon cannot call allocate_coc_number',                NOT has_function_privilege('anon', 'inspections.allocate_coc_number(uuid)', 'EXECUTE')),
  ('the new helpers are SECURITY DEFINER with a pinned search_path',
     coalesce((SELECT bool_and(prosecdef AND proconfig::text LIKE '%search_path=%') FROM pg_proc
                WHERE oid IN (to_regprocedure('inspections.certification_blockers(uuid,text)'),
                              to_regprocedure('inspections.user_can_manage_inspections(uuid)'),
                              to_regprocedure('inspections.inspections_transition_guard()'))
               HAVING count(*) = 3), false)),
  ('signed-in users can call the two helpers, anon cannot',
     to_regprocedure('inspections.certification_blockers(uuid,text)') IS NOT NULL
     AND to_regprocedure('inspections.user_can_manage_inspections(uuid)') IS NOT NULL
     AND has_function_privilege('authenticated', 'inspections.certification_blockers(uuid,text)', 'EXECUTE')
     AND has_function_privilege('authenticated', 'inspections.user_can_manage_inspections(uuid)', 'EXECUTE')
     AND NOT has_function_privilege('anon', 'inspections.certification_blockers(uuid,text)', 'EXECUTE')
     AND NOT has_function_privilege('anon', 'inspections.user_can_manage_inspections(uuid)', 'EXECUTE')),
  ('nobody signed in can call the guard function directly',
     to_regprocedure('inspections.inspections_transition_guard()') IS NOT NULL
     AND NOT has_function_privilege('authenticated', 'inspections.inspections_transition_guard()', 'EXECUTE')
     AND NOT has_function_privilege('anon', 'inspections.inspections_transition_guard()', 'EXECUTE'))
) AS t("check", ok);
