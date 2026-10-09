-- scripts/db/assert-whatsapp-inspections.sql
-- Behaviour of the WhatsApp inspection-form functions, acting as real production users.
-- Run (red before the migration exists, green after):
--   scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/<NNNNN>_whatsapp_inspection_forms.sql \
--     scripts/db/assert-whatsapp-inspections.sql
-- Everything below runs inside the harness's rolled-back transaction.

-- Fixtures: C = the rbac-test contractor (active on KINGSWALK); a real client viewer.
SELECT set_config('x.c', '018f2d31-bbe8-4cc1-bbdd-63af0187081e', true);
SELECT set_config('x.kw', (SELECT pm.project_id::text FROM projects.project_members pm
                            WHERE pm.user_id = current_setting('x.c')::uuid AND pm.is_active
                            ORDER BY pm.created_at LIMIT 1), true);
SELECT set_config('x.org', (SELECT organisation_id::text FROM projects.projects WHERE id = current_setting('x.kw')::uuid), true);
SELECT set_config('x.mamaila', 'dbcfb404-0753-4042-85a1-020cbfacafca', true);
SELECT set_config('x.tmpl', (SELECT id::text FROM inspections.templates
                              WHERE template_id = 'miniature-substation-inspection' AND is_active LIMIT 1), true);
SELECT set_config('x.cv', (SELECT pm.user_id::text FROM projects.project_members pm
                            WHERE pm.is_active AND public.user_effective_project_role(pm.project_id, pm.user_id) = 'client_viewer'
                            ORDER BY pm.created_at LIMIT 1), true);
SELECT set_config('x.cv_proj', (SELECT pm.project_id::text FROM projects.project_members pm
                            WHERE pm.user_id = current_setting('x.cv')::uuid AND pm.is_active LIMIT 1), true);
SELECT set_config('x.cv_org', (SELECT organisation_id::text FROM projects.projects WHERE id = current_setting('x.cv_proj')::uuid), true);
-- A second active, non-client-viewer KINGSWALK member who will receive the summary.
SELECT set_config('x.peer', (SELECT pm.user_id::text FROM projects.project_members pm
                              JOIN public.user_organisations uo ON uo.user_id = pm.user_id AND uo.organisation_id = pm.organisation_id AND uo.is_active
                              WHERE pm.project_id = current_setting('x.kw')::uuid AND pm.is_active
                                AND pm.user_id <> current_setting('x.c')::uuid
                                AND public.user_effective_project_role(pm.project_id, pm.user_id) <> 'client_viewer'
                              ORDER BY pm.created_at LIMIT 1), true);
DO $$ BEGIN
  IF current_setting('x.kw', true) IS NULL OR current_setting('x.tmpl', true) IS NULL
     OR current_setting('x.cv', true) IS NULL OR current_setting('x.peer', true) IS NULL THEN
    RAISE EXCEPTION 'fixture precondition failed: KINGSWALK, the D2 template, a client viewer or a peer is missing; the probes would be vacuous';
  END IF;
END $$;

-- Inspections created for the probes: three for C on KINGSWALK, one for the client viewer, one certified.
CREATE TEMP TABLE _i (k text PRIMARY KEY, id uuid);
GRANT ALL ON _i TO service_role;
WITH ins AS (INSERT INTO inspections.inspections (organisation_id, project_id, template_id, target_node_type, target_label, assigned_to_id, status, created_by)
  SELECT current_setting('x.org')::uuid, current_setting('x.kw')::uuid, current_setting('x.tmpl')::uuid, 'adhoc', l, current_setting('x.c')::uuid, s, current_setting('x.c')::uuid
    FROM (VALUES ('WA probe main', 'assigned'), ('WA probe off', 'assigned'), ('WA probe certified', 'certified'), ('WA probe inactive', 'assigned')) v(l, s)
  RETURNING id, target_label)
INSERT INTO _i SELECT target_label, id FROM ins;
WITH ins AS (INSERT INTO inspections.inspections (organisation_id, project_id, template_id, target_node_type, target_label, status, created_by)
  VALUES (current_setting('x.cv_org')::uuid, current_setting('x.cv_proj')::uuid, current_setting('x.tmpl')::uuid, 'adhoc', 'WA probe cv', 'assigned', current_setting('x.c')::uuid)
  RETURNING id)
INSERT INTO _i SELECT 'WA probe cv', id FROM ins;
SELECT set_config('x.main', (SELECT id::text FROM _i WHERE k = 'WA probe main'), true);
SELECT set_config('x.cert', (SELECT id::text FROM _i WHERE k = 'WA probe certified'), true);
SELECT set_config('x.cvi', (SELECT id::text FROM _i WHERE k = 'WA probe cv'), true);

CREATE TEMP TABLE _r (k text PRIMARY KEY, v jsonb);
GRANT ALL ON _r TO service_role;

-- 1. Flag OFF (the default): nothing is visible or writable.
SET LOCAL ROLE service_role;
INSERT INTO _r VALUES
  ('gate_off',  whatsapp.wa_inspection_gate(current_setting('x.c')::uuid, current_setting('x.main')::uuid)),
  ('list_off',  whatsapp.wa_my_inspections(current_setting('x.c')::uuid, current_setting('x.kw')::uuid)),
  ('save_off',  whatsapp.wa_inspection_save(current_setting('x.c')::uuid, current_setting('x.main')::uuid,
                  '[{"section_id":"visual_structural_checks","field_id":"enclosure_integrity","value_bool":true,"pass_state":"pass"}]', NULL));
RESET ROLE;

-- 2. Flag ON for both orgs.
INSERT INTO whatsapp.org_settings (organisation_id, forms_enabled) VALUES
  (current_setting('x.org')::uuid, true), (current_setting('x.cv_org')::uuid, true)
  ON CONFLICT (organisation_id) DO UPDATE SET forms_enabled = true;

SET LOCAL ROLE service_role;
INSERT INTO _r VALUES
  ('gate_ok',      whatsapp.wa_inspection_gate(current_setting('x.c')::uuid, current_setting('x.main')::uuid)),
  ('list_c',       whatsapp.wa_my_inspections(current_setting('x.c')::uuid, current_setting('x.kw')::uuid)),
  ('list_mamaila', whatsapp.wa_my_inspections(current_setting('x.c')::uuid, current_setting('x.mamaila')::uuid)),
  ('gate_cert',    whatsapp.wa_inspection_gate(current_setting('x.c')::uuid, current_setting('x.cert')::uuid)),
  ('gate_cv',      whatsapp.wa_inspection_gate(current_setting('x.cv')::uuid, current_setting('x.cvi')::uuid)),
  ('save_cv',      whatsapp.wa_inspection_save(current_setting('x.cv')::uuid, current_setting('x.cvi')::uuid,
                     '[{"section_id":"visual_structural_checks","field_id":"enclosure_integrity","value_bool":true,"pass_state":"pass"}]', NULL)),
  ('gate_foreign', whatsapp.wa_inspection_gate(current_setting('x.c')::uuid, current_setting('x.cvi')::uuid)),
  ('submit_empty', whatsapp.wa_inspection_submit(current_setting('x.c')::uuid, current_setting('x.main')::uuid, NULL)),
  ('save_ok',      whatsapp.wa_inspection_save(current_setting('x.c')::uuid, current_setting('x.main')::uuid,
                     '[{"section_id":"visual_structural_checks","field_id":"enclosure_integrity","value_bool":true,"pass_state":"pass"},
                       {"section_id":"visual_structural_checks","field_id":"plinth_condition","value_bool":false,"pass_state":"fail","fail_reason":"Cracked"},
                       {"section_id":"electrical_functional_thermal_checks","field_id":"max_winding_temp","value_number":72.5},
                       {"section_id":"visual_structural_checks","field_id":"corrosion_level","value_text":"light"}]', NULL)),
  ('save_again',   whatsapp.wa_inspection_save(current_setting('x.c')::uuid, current_setting('x.main')::uuid,
                     '[{"section_id":"visual_structural_checks","field_id":"enclosure_integrity","value_bool":false,"pass_state":"fail","fail_reason":"Door hinge"}]', NULL)),
  ('save_bad',     whatsapp.wa_inspection_save(current_setting('x.c')::uuid, current_setting('x.main')::uuid,
                     '[{"section_id":"x","field_id":"y","pass_state":"bogus"}]', NULL)),
  ('photo_out',    whatsapp.wa_inspection_add_photo(current_setting('x.c')::uuid, current_setting('x.main')::uuid,
                     'electrical_functional_thermal_checks', 'thermographic_survey',
                     current_setting('x.kw') || '/' || current_setting('x.cert') || '/a/b/wa-1.jpg', 1000, 1600, 1200)),
  ('photo_dots',   whatsapp.wa_inspection_add_photo(current_setting('x.c')::uuid, current_setting('x.main')::uuid,
                     'electrical_functional_thermal_checks', 'thermographic_survey',
                     current_setting('x.kw') || '/' || current_setting('x.main') || '/../../x.jpg', 1000, 1600, 1200)),
  ('photo_ok',     whatsapp.wa_inspection_add_photo(current_setting('x.c')::uuid, current_setting('x.main')::uuid,
                     'electrical_functional_thermal_checks', 'thermographic_survey',
                     current_setting('x.kw') || '/' || current_setting('x.main') || '/electrical_functional_thermal_checks/thermographic_survey/wa-1.jpg', 1000, 1600, 1200));
RESET ROLE;

-- 3. Submit, then the fan-out.
INSERT INTO whatsapp.phone_links (user_id, phone_e164, status, verified_at, consent_at, consent_text_version)
VALUES (current_setting('x.c')::uuid,    '+27000000101', 'active', now(), now(), 'test'),
       (current_setting('x.peer')::uuid, '+27000000102', 'active', now(), now(), 'test'),
       (current_setting('x.cv')::uuid,   '+27000000103', 'active', now(), now(), 'test')
  ON CONFLICT DO NOTHING;
UPDATE projects.project_settings SET notify_whatsapp = true WHERE project_id = current_setting('x.kw')::uuid;
INSERT INTO whatsapp.form_sessions (token_hash, user_id, inspection_id, template_row_id, expires_at)
VALUES ('probe-hash-1', current_setting('x.c')::uuid, current_setting('x.main')::uuid, current_setting('x.tmpl')::uuid, now() + interval '1 day');
SELECT set_config('x.sess', (SELECT id::text FROM whatsapp.form_sessions WHERE token_hash = 'probe-hash-1'), true);

SET LOCAL ROLE service_role;
INSERT INTO _r VALUES
  ('submit_ok',    whatsapp.wa_inspection_submit(current_setting('x.c')::uuid, current_setting('x.main')::uuid, current_setting('x.sess')::uuid)),
  ('save_after',   whatsapp.wa_inspection_save(current_setting('x.c')::uuid, current_setting('x.main')::uuid,
                     '[{"section_id":"visual_structural_checks","field_id":"perimeter_fence","value_bool":true,"pass_state":"pass"}]', NULL)),
  ('fanout',       to_jsonb(whatsapp.enqueue_form_submitted(current_setting('x.sess')::uuid))),
  ('fanout_again', to_jsonb(whatsapp.enqueue_form_submitted(current_setting('x.sess')::uuid))),
  ('hold_1',  to_jsonb(whatsapp.form_session_hold_photo(current_setting('x.sess')::uuid, 'aaaaaaaa-0000-4000-8000-000000000001'))),
  ('hold_2',  to_jsonb(whatsapp.form_session_hold_photo(current_setting('x.sess')::uuid, 'aaaaaaaa-0000-4000-8000-000000000002'))),
  ('hold_dup', to_jsonb(whatsapp.form_session_hold_photo(current_setting('x.sess')::uuid, 'aaaaaaaa-0000-4000-8000-000000000001'))),
  ('release', to_jsonb(whatsapp.form_session_release_photos(current_setting('x.sess')::uuid, ARRAY['aaaaaaaa-0000-4000-8000-000000000001']::uuid[])));
RESET ROLE;

-- 4a. A PROJECT-scoped client viewer whose org role is contractor: user_can_write_responses() only reads
--     the org role, so only the effective-project-role check in the gate refuses this.
UPDATE projects.project_members SET role = 'client_viewer'
 WHERE user_id = current_setting('x.c')::uuid AND project_id = current_setting('x.kw')::uuid;
SET LOCAL ROLE service_role;
INSERT INTO _r VALUES
  ('gate_pcv', whatsapp.wa_inspection_gate(current_setting('x.c')::uuid, (SELECT id FROM _i WHERE k = 'WA probe inactive'))),
  ('list_pcv', whatsapp.wa_my_inspections(current_setting('x.c')::uuid, current_setting('x.kw')::uuid));
RESET ROLE;
UPDATE projects.project_members SET role = 'contractor'
 WHERE user_id = current_setting('x.c')::uuid AND project_id = current_setting('x.kw')::uuid;

-- 4b. A deactivated project member keeps an active org row: the gate must still refuse.
UPDATE projects.project_members SET is_active = false
 WHERE user_id = current_setting('x.c')::uuid AND project_id = current_setting('x.kw')::uuid;
SET LOCAL ROLE service_role;
INSERT INTO _r VALUES
  ('gate_inactive', whatsapp.wa_inspection_gate(current_setting('x.c')::uuid, (SELECT id FROM _i WHERE k = 'WA probe inactive'))),
  ('save_inactive', whatsapp.wa_inspection_save(current_setting('x.c')::uuid, (SELECT id FROM _i WHERE k = 'WA probe inactive'),
                      '[{"section_id":"visual_structural_checks","field_id":"enclosure_integrity","value_bool":true,"pass_state":"pass"}]', NULL));
RESET ROLE;

-- 5. The submit marker cannot be forged through PostgREST (only the WhatsApp actor may set it).
CREATE TEMP TABLE _f (k text PRIMARY KEY, v text);
GRANT ALL ON _f TO authenticated;
GRANT SELECT ON _i TO authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('x.c'), 'role', 'authenticated')::text, true);
UPDATE projects.project_members SET is_active = true
 WHERE user_id = current_setting('x.c')::uuid AND project_id = current_setting('x.kw')::uuid;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  UPDATE inspections.inspections SET submitted_session_id = current_setting('x.sess')::uuid WHERE id = (SELECT id FROM _i WHERE k = 'WA probe off');
  INSERT INTO _f VALUES ('forge_session', 'ok');
EXCEPTION WHEN OTHERS THEN INSERT INTO _f VALUES ('forge_session', SQLERRM);
END $$;
DO $$ BEGIN
  UPDATE inspections.inspections SET submitted_via = 'whatsapp' WHERE id = (SELECT id FROM _i WHERE k = 'WA probe off');
  INSERT INTO _f VALUES ('forge_via', 'ok');
EXCEPTION WHEN OTHERS THEN INSERT INTO _f VALUES ('forge_via', SQLERRM);
END $$;
-- A real web submit (00234's status guard admits marker changes only as part of the submit itself):
-- answer once (assigned -> in_progress), then exactly what submitInspectionAction sends.
DO $$ DECLARE n int; BEGIN
  INSERT INTO inspections.responses (inspection_id, section_id, field_id, value_text, latest_responded_by)
  VALUES ((SELECT id FROM _i WHERE k = 'WA probe off'), 'visual_structural_checks', 'probe_note', 'x', current_setting('x.c')::uuid);
  UPDATE inspections.inspections SET status = 'awaiting_verification', completed_at = now(), submitted_via = 'web', submitted_session_id = NULL
   WHERE id = (SELECT id FROM _i WHERE k = 'WA probe off') AND status IN ('in_progress', 're-inspect_required');
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO _f VALUES ('clear', CASE WHEN n = 1 THEN 'ok' ELSE 'no row moved' END);
EXCEPTION WHEN OTHERS THEN INSERT INTO _f VALUES ('clear', SQLERRM);
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

SELECT * FROM (VALUES
  ('a contributor cannot forge the submit session marker', (SELECT v FROM _f WHERE k = 'forge_session') <> 'ok'),
  ('a contributor cannot mark a submit as WhatsApp',       (SELECT v FROM _f WHERE k = 'forge_via') <> 'ok'),
  ('a real web submit clears the marker and says web',     (SELECT v FROM _f WHERE k = 'clear') = 'ok'),
  ('flag off: gate refuses',                 (SELECT v->>'code' FROM _r WHERE k = 'gate_off') = 'flag_off'),
  ('flag off: nothing listed',               (SELECT v = '[]'::jsonb FROM _r WHERE k = 'list_off')),
  ('flag off: save refused',                 (SELECT v->>'code' FROM _r WHERE k = 'save_off') = 'flag_off'),
  ('flag on: gate ok for C',                 (SELECT v->>'code' = 'ok' AND v->>'template_row_id' = current_setting('x.tmpl') FROM _r WHERE k = 'gate_ok')),
  ('C lists the probe inspection',           (SELECT v::text LIKE '%' || current_setting('x.main') || '%' FROM _r WHERE k = 'list_c')),
  ('C does not list the certified one',      (SELECT v::text NOT LIKE '%' || current_setting('x.cert') || '%' FROM _r WHERE k = 'list_c')),
  ('nothing listed on a foreign project',    (SELECT v = '[]'::jsonb FROM _r WHERE k = 'list_mamaila')),
  ('certified: not writable',                (SELECT v->>'code' FROM _r WHERE k = 'gate_cert') = 'not_writable'),
  ('client viewer: refused at the gate',     (SELECT v->>'code' FROM _r WHERE k = 'gate_cv') IN ('no_access', 'not_found')),
  ('client viewer: save refused',            (SELECT v->>'code' FROM _r WHERE k = 'save_cv') IN ('no_access', 'not_found')),
  ('client viewer wrote nothing',            NOT EXISTS (SELECT 1 FROM inspections.responses WHERE inspection_id = current_setting('x.cvi')::uuid)),
  ('C cannot reach another project''s form', (SELECT v->>'code' FROM _r WHERE k = 'gate_foreign') IN ('no_access', 'not_found')),
  ('submit with no answers refused',         (SELECT v->>'code' FROM _r WHERE k = 'submit_empty') = 'nothing_answered'),
  ('save ok: 4 rows',                        (SELECT v->>'code' = 'ok' AND (v->>'saved')::int = 4 FROM _r WHERE k = 'save_ok')),
  ('answers carry via=whatsapp and author',  (SELECT count(*) = 4 FROM inspections.responses WHERE inspection_id = current_setting('x.main')::uuid
                                                AND via = 'whatsapp' AND latest_responded_by = current_setting('x.c')::uuid)),
  ('re-answer updates in place',             (SELECT value_bool = false AND fail_reason = 'Door hinge' FROM inspections.responses
                                                WHERE inspection_id = current_setting('x.main')::uuid AND field_id = 'enclosure_integrity')),
  ('history records both answers',           (SELECT count(*) = 2 FROM inspections.response_history h
                                                WHERE h.inspection_id = current_setting('x.main')::uuid AND h.field_id = 'enclosure_integrity')),
  ('a malformed row is refused whole',       (SELECT v->>'code' FROM _r WHERE k = 'save_bad') = 'refused'),
  ('first answer moved status forward',      (SELECT status IN ('in_progress', 'awaiting_verification') FROM inspections.inspections WHERE id = current_setting('x.main')::uuid)),
  ('photo path into another inspection refused', (SELECT v->>'code' FROM _r WHERE k = 'photo_out') = 'bad_path'),
  ('photo path with .. refused',             (SELECT v->>'code' FROM _r WHERE k = 'photo_dots') = 'bad_path'),
  ('photo ok with via, uploader, size',      (SELECT count(*) = 1 FROM inspections.photos WHERE inspection_id = current_setting('x.main')::uuid
                                                AND via = 'whatsapp' AND uploaded_by = current_setting('x.c')::uuid AND width_px = 1600)),
  ('submit ok',                              (SELECT v->>'code' FROM _r WHERE k = 'submit_ok') = 'ok'),
  ('submit stamped status, channel and session', (SELECT status = 'awaiting_verification' AND submitted_via = 'whatsapp' AND completed_at IS NOT NULL
                                                AND submitted_session_id = current_setting('x.sess')::uuid
                                                FROM inspections.inspections WHERE id = current_setting('x.main')::uuid)),
  ('no answers after submit',                (SELECT v->>'code' FROM _r WHERE k = 'save_after') = 'not_writable'),
  ('fan-out: confirm to C',                  EXISTS (SELECT 1 FROM whatsapp.outbox WHERE trigger = 'form_confirm' AND user_id = current_setting('x.c')::uuid
                                                AND form_session_id = current_setting('x.sess')::uuid)),
  ('fan-out: summary to the peer',           EXISTS (SELECT 1 FROM whatsapp.outbox WHERE trigger = 'form_submitted' AND user_id = current_setting('x.peer')::uuid
                                                AND form_session_id = current_setting('x.sess')::uuid)),
  ('fan-out: no summary to the submitter',   NOT EXISTS (SELECT 1 FROM whatsapp.outbox WHERE trigger = 'form_submitted' AND user_id = current_setting('x.c')::uuid)),
  ('fan-out: no summary to a client viewer', NOT EXISTS (SELECT 1 FROM whatsapp.outbox WHERE trigger IN ('form_submitted', 'form_confirm') AND user_id = current_setting('x.cv')::uuid)),
  ('the confirmation waits a minute for the PDF', (SELECT send_after > now() + interval '50 seconds' FROM whatsapp.outbox
                                                WHERE trigger = 'form_confirm' AND form_session_id = current_setting('x.sess')::uuid)),
  ('held photos append in order, without duplicates', (SELECT v = '["aaaaaaaa-0000-4000-8000-000000000001", "aaaaaaaa-0000-4000-8000-000000000002"]'::jsonb FROM _r WHERE k = 'hold_dup')),
  ('release removes only what was attached',  (SELECT v = '["aaaaaaaa-0000-4000-8000-000000000002"]'::jsonb FROM _r WHERE k = 'release')),
  ('authenticated cannot hold photos',        NOT has_function_privilege('authenticated', 'whatsapp.form_session_hold_photo(uuid,uuid)', 'EXECUTE')),
  ('fan-out is idempotent',                  (SELECT v::int = 0 FROM _r WHERE k = 'fanout_again') AND (SELECT v::int >= 2 FROM _r WHERE k = 'fanout')),
  -- not_found since 00234/00238: a client viewer cannot see an uncertified inspection at all, so the read refuses first.
  ('project-scoped client viewer: gate refuses', (SELECT v->>'code' FROM _r WHERE k = 'gate_pcv') IN ('no_access', 'not_found')),
  ('project-scoped client viewer: nothing listed', (SELECT v = '[]'::jsonb FROM _r WHERE k = 'list_pcv')),
  ('inactive member: gate refuses',          (SELECT v->>'code' FROM _r WHERE k = 'gate_inactive') IN ('no_access', 'not_found')),
  ('inactive member: save refused',          (SELECT v->>'code' FROM _r WHERE k = 'save_inactive') IN ('no_access', 'not_found')),
  ('authenticated cannot call the functions', NOT has_function_privilege('authenticated', 'whatsapp.wa_inspection_save(uuid,uuid,jsonb,uuid)', 'EXECUTE')),
  ('anon cannot call the functions',         NOT has_function_privilege('anon', 'whatsapp.wa_inspection_gate(uuid,uuid)', 'EXECUTE')),
  ('authenticated cannot read sessions',     NOT has_table_privilege('authenticated', 'whatsapp.form_sessions', 'SELECT')),
  ('flag defaults to off',                   (SELECT column_default = 'false' FROM information_schema.columns
                                                WHERE table_schema = 'whatsapp' AND table_name = 'org_settings' AND column_name = 'forms_enabled'))
) AS t("check", ok);
