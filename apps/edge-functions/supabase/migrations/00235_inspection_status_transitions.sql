-- 00235_inspection_status_transitions.sql
-- Who may move an inspection between statuses, and which columns each move may change.
--
-- Before this, inspections_update_contributors (00066) let any project member who is not an ORG
-- client viewer UPDATE any column of inspections.inspections to any value, and the only trigger
-- was set_updated_at. Demonstrated on production in a rolled-back transaction: the rbac-test
-- contractor set a probe inspection to 'certified' with verifier_id = self and
-- overall_result = 'pass' (1 row). Every certification rule lived only in certifyInspectionAction.
-- The read policies used the same ORG flag, so a client viewer on the PROJECT read inspections and
-- answers that were not yet certified.
--
-- The rules (owner decisions 2026-10-05):
--   contributor   assigned | re-inspect_required -> in_progress     (00066's first-answer trigger, as the caller)
--                 in_progress | re-inspect_required -> awaiting_verification   (web, WhatsApp)
--   verifier      awaiting_verification -> certified      only if certification_blockers() is NULL and the
--                                                         result is pass or conditional_pass (a FAIL is sent back)
--                 awaiting_verification -> re-inspect_required   with a note
--   PM or above   any open status -> abandoned            with a reason
--   (effective    assignment and details (assignee, verifier, target label/location, schedule) while open
--    role)
--   everyone      nothing on a certified or abandoned row
--   service path  anything (auth.uid() IS NULL: service role, cron, migrations; as qc_reports_status_guard)
-- The guard stamps started_at, completed_at, certified_at, abandoned_at and abandoned_by itself, and
-- allocates the INS/FAT number itself, so none of them can be forged or back-dated. Any column not
-- named for a move is refused, including columns added later, so a new column is immutable to
-- signed-in callers until a migration says otherwise.
--
-- Builds on 00234 (inspection write gate): user_can_write_responses and is_inspection_verifier as
-- redefined there. Proven by scripts/db/assert-inspection-status-transitions.sql.

-- ── 1. PM or above, by EFFECTIVE project role (a PM promoted on the project counts) ─────────
-- user_can_verify (00066/00234) stays as it is for validate-inspection; it reads the org role only.
CREATE OR REPLACE FUNCTION inspections.user_can_manage_inspections(_project_id UUID) RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT public.user_has_project_access(_project_id)
     AND COALESCE(public.user_effective_project_role(_project_id, auth.uid()), '') IN ('owner','admin','project_manager');
$fn$;
REVOKE ALL ON FUNCTION inspections.user_can_manage_inspections(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION inspections.user_can_manage_inspections(UUID) TO authenticated, service_role;

-- ── 2. The certification rules, in one place ─────────────────────────────────────────────────
-- Returns NULL when the CALLER may certify the inspection now, else the first rule that fails, as
-- a sentence. The guard enforces it; certifyInspectionAction calls it first to show the sentence.
-- Mirrors what certifyInspectionAction checked in TypeScript before this migration:
--   • the caller is the assigned verifier and still has project access;
--   • requires_separate_verifier (default: deliverable coc or factory_test): the verifier wrote no answer;
--   • every signature field with required_qualifications is met by SOME signature on the inspection:
--     'registered_person' by a non-blank registration_number, any qualification by a
--     case-insensitive match in signatory_title (underscores read as spaces);
--   • deliverable coc: a non-blank CoC number not used by another inspection in the organisation.
CREATE OR REPLACE FUNCTION inspections.certification_blockers(_inspection_id UUID, _coc_number TEXT DEFAULT NULL) RETURNS TEXT
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  i inspections.inspections%ROWTYPE;
  t inspections.templates%ROWTYPE;
  v_uid UUID := auth.uid();
  v_sep BOOLEAN;
  r RECORD;
BEGIN
  SELECT * INTO i FROM inspections.inspections WHERE id = _inspection_id;
  IF NOT FOUND OR v_uid IS NULL OR NOT public.user_has_project_access(i.project_id) THEN
    RETURN 'Inspection not found.';
  END IF;
  IF i.status <> 'awaiting_verification' THEN
    RETURN 'This inspection is not awaiting verification.';
  END IF;
  IF i.verifier_id IS DISTINCT FROM v_uid OR NOT inspections.is_inspection_verifier(_inspection_id) THEN
    RETURN 'Only the assigned verifier can certify this inspection.';
  END IF;

  SELECT * INTO t FROM inspections.templates WHERE id = i.template_id;
  v_sep := CASE WHEN jsonb_typeof(t.schema_json->'requires_separate_verifier') = 'boolean'
                THEN (t.schema_json->>'requires_separate_verifier')::boolean
                ELSE t.deliverable_type IN ('coc','factory_test') END;
  IF v_sep AND EXISTS (SELECT 1 FROM inspections.response_history h
                        WHERE h.inspection_id = _inspection_id AND h.responded_by = v_uid) THEN
    RETURN 'Verifier cannot also be a contributor on this template type. Reassign the verifier to someone who has not filled in responses.';
  END IF;

  FOR r IN
    SELECT COALESCE(f->>'label', f->>'field_id') AS label,
           ARRAY(SELECT jsonb_array_elements_text(f->'required_qualifications')) AS quals
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.schema_json->'sections') = 'array'
                                     THEN t.schema_json->'sections' ELSE '[]'::jsonb END) s
     CROSS JOIN LATERAL (
       SELECT f FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s->'fields') = 'array' THEN s->'fields' ELSE '[]'::jsonb END) f
       UNION ALL
       SELECT f FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s->'subsections') = 'array' THEN s->'subsections' ELSE '[]'::jsonb END) ss,
                     jsonb_array_elements(CASE WHEN jsonb_typeof(ss->'fields') = 'array' THEN ss->'fields' ELSE '[]'::jsonb END) f
     ) ff
     WHERE f->>'type' = 'signature'
       AND jsonb_typeof(f->'required_qualifications') = 'array'
       AND jsonb_array_length(f->'required_qualifications') > 0
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM inspections.signatures sg
       WHERE sg.inspection_id = _inspection_id
         AND (('registered_person' = ANY (r.quals) AND btrim(COALESCE(sg.registration_number, '')) <> '')
              OR EXISTS (SELECT 1 FROM unnest(r.quals) q
                          WHERE strpos(lower(COALESCE(sg.signatory_title, '')), replace(lower(q), '_', ' ')) > 0))
    ) THEN
      RETURN format('Signature requirement not met for "%s": needs one of %s. None of the captured signatures satisfy this (check signatory title or registration number).',
                    r.label, array_to_string(r.quals, ', '));
    END IF;
  END LOOP;

  IF t.deliverable_type = 'coc' THEN
    IF btrim(COALESCE(_coc_number, '')) = '' THEN
      RETURN 'COC number is required (enter the number from your ECB pad).';
    END IF;
    IF EXISTS (SELECT 1 FROM inspections.inspections o
                WHERE o.organisation_id = i.organisation_id AND o.coc_number = btrim(_coc_number) AND o.id <> i.id) THEN
      RETURN format('COC number %s is already used by another inspection in this organisation.', btrim(_coc_number));
    END IF;
  END IF;

  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION inspections.certification_blockers(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION inspections.certification_blockers(UUID, TEXT) TO authenticated, service_role;

-- ── 3. The transition guard ──────────────────────────────────────────────────────────────────
-- SECURITY DEFINER so it can allocate CoC numbers (no longer callable by signed-in users, §4).
-- Identity comes from auth.uid() only, never current_user, which here is the owner. The WhatsApp
-- path (00229) runs as whatsapp_actor with auth.uid() set to the person, so it is judged as them.
CREATE OR REPLACE FUNCTION inspections.inspections_transition_guard() RETURNS TRIGGER
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_uid     UUID := auth.uid();
  v_changed TEXT[];
  v_allowed TEXT[];
  v_block   TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Columns this statement changes. updated_at is set by trg_inspections_updated_at, whose firing
  -- order relative to this trigger is a matter of names, so it is never counted.
  SELECT COALESCE(array_agg(n.key), '{}') INTO v_changed
    FROM jsonb_each(to_jsonb(NEW)) n
   WHERE n.key <> 'updated_at' AND n.value IS DISTINCT FROM (to_jsonb(OLD) -> n.key);

  -- A structure node deleted under the inspection nulls target_node_id (ON DELETE SET NULL); the
  -- node guard refuses that while the inspection is open, so it reaches final rows only. Allowed
  -- inside that cascade (a trigger-issued statement), never as a client's own UPDATE, which could
  -- otherwise detach a certified record from its board.
  IF v_changed = ARRAY['target_node_id'] AND NEW.target_node_id IS NULL AND pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('certified','abandoned') THEN
    RAISE EXCEPTION 'This inspection is % and can no longer be changed.', OLD.status USING ERRCODE = '42501';
  END IF;

  IF v_changed = '{}' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = OLD.status THEN
    -- Assignment and details, while open.
    IF NOT inspections.user_can_manage_inspections(OLD.project_id) THEN
      RAISE EXCEPTION 'Only a project manager or above can change an inspection''s assignment or details.' USING ERRCODE = '42501';
    END IF;
    v_allowed := ARRAY['assigned_to_id','verifier_id','target_label','target_location','scheduled_at'];

  ELSIF OLD.status IN ('assigned','re-inspect_required') AND NEW.status = 'in_progress' THEN
    -- Start (00066's first-answer trigger runs this as the contributor).
    IF NOT inspections.user_can_write_responses(OLD.id) THEN
      RAISE EXCEPTION 'Only a contributor can start this inspection.' USING ERRCODE = '42501';
    END IF;
    v_allowed := ARRAY['status','started_at'];
    NEW.started_at := COALESCE(OLD.started_at, now());

  ELSIF OLD.status IN ('in_progress','re-inspect_required') AND NEW.status = 'awaiting_verification' THEN
    -- Submit. The submit marker columns are policed by 00229's guard_submit_marker.
    IF NOT inspections.user_can_write_responses(OLD.id) THEN
      RAISE EXCEPTION 'Only a contributor can submit this inspection.' USING ERRCODE = '42501';
    END IF;
    v_allowed := ARRAY['status','completed_at','submitted_via','submitted_session_id'];
    NEW.completed_at := now();

  ELSIF OLD.status = 'awaiting_verification' AND NEW.status = 'certified' THEN
    -- Who may certify is certification_blockers()'s first rule (below), so it has one definition.
    v_allowed := ARRAY['status','overall_result','coc_number','certified_at'];

  ELSIF OLD.status = 'awaiting_verification' AND NEW.status = 're-inspect_required' THEN
    IF OLD.verifier_id IS DISTINCT FROM v_uid OR NOT inspections.is_inspection_verifier(OLD.id) THEN
      RAISE EXCEPTION 'Only the assigned verifier can send an inspection back.' USING ERRCODE = '42501';
    END IF;
    IF btrim(COALESCE(NEW.reinspection_notes, '')) = '' THEN
      RAISE EXCEPTION 'A send-back needs a note for the contributors.' USING ERRCODE = '23514';
    END IF;
    v_allowed := ARRAY['status','reinspection_notes'];

  ELSIF NEW.status = 'abandoned' THEN
    IF NOT inspections.user_can_manage_inspections(OLD.project_id) THEN
      RAISE EXCEPTION 'Only a project manager or above can abandon an inspection.' USING ERRCODE = '42501';
    END IF;
    IF btrim(COALESCE(NEW.abandoned_reason, '')) = '' THEN
      RAISE EXCEPTION 'An abandon needs a reason.' USING ERRCODE = '23514';
    END IF;
    v_allowed := ARRAY['status','abandoned_at','abandoned_by','abandoned_reason'];
    NEW.abandoned_by := v_uid;
    NEW.abandoned_at := now();

  ELSE
    RAISE EXCEPTION 'An inspection cannot move from % to %.', OLD.status, NEW.status USING ERRCODE = '42501';
  END IF;

  IF NOT (v_changed <@ v_allowed) THEN
    RAISE EXCEPTION 'This update may change only: %.', array_to_string(v_allowed, ', ') USING ERRCODE = '42501';
  END IF;

  IF NEW.status = 'certified' THEN
    v_block := inspections.certification_blockers(OLD.id, NEW.coc_number);
    IF v_block IS NOT NULL THEN
      RAISE EXCEPTION '%', v_block USING ERRCODE = '23514';
    END IF;
    IF NEW.overall_result IS NULL OR NEW.overall_result NOT IN ('pass','conditional_pass') THEN
      RAISE EXCEPTION 'An inspection can be certified only with a pass or conditional pass result. Send it back for re-inspection instead.' USING ERRCODE = '23514';
    END IF;
    IF (SELECT t.deliverable_type FROM inspections.templates t WHERE t.id = OLD.template_id) = 'coc' THEN
      NEW.coc_number := btrim(NEW.coc_number);
    ELSE
      NEW.coc_number := inspections.allocate_coc_number(OLD.id);
    END IF;
    NEW.certified_at := now();
  END IF;

  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION inspections.inspections_transition_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_inspections_transition_guard ON inspections.inspections;
CREATE TRIGGER trg_inspections_transition_guard
  BEFORE UPDATE ON inspections.inspections
  FOR EACH ROW EXECUTE FUNCTION inspections.inspections_transition_guard();

-- ── 4. CoC numbers are allocated by the guard only ───────────────────────────────────────────
-- Before, any signed-in user could call this for any inspection id and burn sequence numbers
-- (it reads the inspection as its owner). The certify action no longer calls it.
-- It also could never run: its variable `prefix` made `ON CONFLICT (project_id, year, prefix)`
-- ambiguous (42702), so certifying an inspection_only or factory_test inspection always failed
-- (and the action called it through the public schema, where it does not exist). The variables are
-- renamed; the number format is unchanged: <INS|FAT>-<project code>-<year>-<0001>.
CREATE OR REPLACE FUNCTION inspections.allocate_coc_number(_inspection_id UUID) RETURNS TEXT
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_code   TEXT;
  v_pid    UUID;
  v_type   TEXT;
  v_year   INT := EXTRACT(YEAR FROM now());
  v_seq    INT;
  v_prefix TEXT;
BEGIN
  SELECT i.project_id, p.code, t.deliverable_type
    INTO v_pid, v_code, v_type
    FROM inspections.inspections i
    JOIN projects.projects p ON p.id = i.project_id
    JOIN inspections.templates t ON t.id = i.template_id
   WHERE i.id = _inspection_id;

  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'Inspection % not found', _inspection_id;
  END IF;
  IF v_type = 'coc' THEN
    RAISE EXCEPTION 'COC numbers must be entered manually for deliverable_type = coc';
  END IF;

  v_prefix := CASE v_type WHEN 'inspection_only' THEN 'INS' WHEN 'factory_test' THEN 'FAT' END;

  INSERT INTO inspections.coc_number_seqs AS s (project_id, year, prefix, last_seq)
  VALUES (v_pid, v_year, v_prefix, 1)
  ON CONFLICT (project_id, year, prefix) DO UPDATE SET last_seq = s.last_seq + 1
  RETURNING s.last_seq INTO v_seq;

  RETURN format('%s-%s-%s-%s', v_prefix, v_code, v_year, lpad(v_seq::text, 4, '0'));
END $fn$;
REVOKE ALL ON FUNCTION inspections.allocate_coc_number(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION inspections.allocate_coc_number(UUID) TO service_role;

-- ── 5. Client viewers by EFFECTIVE project role, as well as by org role ──────────────────────
-- A NULL effective role counts as a client viewer, so it can only narrow.
DROP POLICY IF EXISTS inspections_update_contributors ON inspections.inspections;
CREATE POLICY inspections_update_contributors ON inspections.inspections
  FOR UPDATE TO authenticated
  USING (
    public.user_has_project_access(project_id)
    AND NOT public.user_is_client_viewer(organisation_id)
    AND COALESCE(public.user_effective_project_role(project_id, auth.uid()), 'client_viewer') <> 'client_viewer'
  )
  WITH CHECK (
    public.user_has_project_access(project_id)
    AND NOT public.user_is_client_viewer(organisation_id)
    AND COALESCE(public.user_effective_project_role(project_id, auth.uid()), 'client_viewer') <> 'client_viewer'
  );

DROP POLICY IF EXISTS inspections_select_members ON inspections.inspections;
CREATE POLICY inspections_select_members ON inspections.inspections
  FOR SELECT TO authenticated
  USING (
    public.user_has_project_access(project_id)
    AND NOT public.user_is_client_viewer(organisation_id)
    AND COALESCE(public.user_effective_project_role(project_id, auth.uid()), 'client_viewer') <> 'client_viewer'
  );

DROP POLICY IF EXISTS inspections_select_client_viewer ON inspections.inspections;
CREATE POLICY inspections_select_client_viewer ON inspections.inspections
  FOR SELECT TO authenticated
  USING (
    public.user_has_project_access(project_id)
    AND status = 'certified'
    AND (public.user_is_client_viewer(organisation_id)
         OR COALESCE(public.user_effective_project_role(project_id, auth.uid()), 'client_viewer') = 'client_viewer')
  );

-- The read gate for answers, photos, signatures, history, validations and the inspection buckets.
-- Adds pm.is_active, uo.is_active and the effective project role; certified stays readable.
CREATE OR REPLACE FUNCTION inspections.user_has_inspection_read(_inspection_id UUID) RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM inspections.inspections i
    JOIN projects.project_members pm ON pm.project_id = i.project_id AND pm.user_id = auth.uid()
    JOIN public.user_organisations uo
      ON uo.user_id = auth.uid() AND uo.organisation_id = i.organisation_id
    WHERE i.id = _inspection_id
      AND pm.is_active = TRUE
      AND uo.is_active = TRUE
      AND (
        i.status = 'certified'
        OR (uo.role <> 'client_viewer'
            AND COALESCE(public.user_effective_project_role(i.project_id, auth.uid()), 'client_viewer') <> 'client_viewer')
      )
  );
$fn$;
-- CREATE OR REPLACE keeps the ACL; restated so this file alone says who may call it (00186).
REVOKE ALL ON FUNCTION inspections.user_has_inspection_read(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION inspections.user_has_inspection_read(UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- @verify:begin
-- function: inspections.user_can_manage_inspections(uuid)
-- function: inspections.certification_blockers(uuid,text)
-- function: inspections.inspections_transition_guard()
-- function: inspections.allocate_coc_number(uuid)
-- function: inspections.user_has_inspection_read(uuid)
-- trigger: trg_inspections_transition_guard ON inspections.inspections
-- policy: inspections_update_contributors ON inspections.inspections PERMISSIVE
-- policy: inspections_select_members ON inspections.inspections PERMISSIVE
-- policy: inspections_select_client_viewer ON inspections.inspections PERMISSIVE
-- sql: (SELECT tgenabled = 'O' FROM pg_trigger WHERE tgrelid = 'inspections.inspections'::regclass AND tgname = 'trg_inspections_transition_guard')
-- sql: (SELECT bool_and(prosecdef AND proconfig::text LIKE '%search_path=%') FROM pg_proc WHERE oid IN ('inspections.user_can_manage_inspections(uuid)'::regprocedure, 'inspections.certification_blockers(uuid,text)'::regprocedure, 'inspections.inspections_transition_guard()'::regprocedure, 'inspections.user_has_inspection_read(uuid)'::regprocedure))
-- sql: (SELECT NOT has_function_privilege('authenticated', 'inspections.allocate_coc_number(uuid)', 'EXECUTE'))
-- sql: (SELECT pg_get_functiondef('inspections.allocate_coc_number(uuid)'::regprocedure) LIKE '%v_prefix%')
-- sql: (SELECT NOT has_function_privilege('authenticated', 'inspections.inspections_transition_guard()', 'EXECUTE'))
-- sql: (SELECT has_function_privilege('authenticated', 'inspections.certification_blockers(uuid,text)', 'EXECUTE') AND NOT has_function_privilege('anon', 'inspections.certification_blockers(uuid,text)', 'EXECUTE'))
-- sql: (SELECT coalesce(qual, '') LIKE '%user_effective_project_role%' FROM pg_policies WHERE schemaname = 'inspections' AND tablename = 'inspections' AND policyname = 'inspections_update_contributors')
-- sql: (SELECT coalesce(qual, '') LIKE '%user_effective_project_role%' FROM pg_policies WHERE schemaname = 'inspections' AND tablename = 'inspections' AND policyname = 'inspections_select_members')
-- sql: (SELECT pg_get_functiondef('inspections.user_has_inspection_read(uuid)'::regprocedure) LIKE '%pm.is_active%')
-- behaviour: only the assigned verifier certifies, only from awaiting_verification, only with the certification rules met and a pass or conditional pass; project client viewers read certified inspections only; proven by scripts/db/assert-inspection-status-transitions.sql
-- @verify:end
