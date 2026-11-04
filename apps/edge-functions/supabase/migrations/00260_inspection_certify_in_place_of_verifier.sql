-- 00260_inspection_certify_in_place_of_verifier.sql
--
-- An organisation owner or admin can certify an inspection in place of its assigned verifier.
-- Owner report, 2026-11-03: three main-board inspections on (657) MAMAILA PHASE 2 could not be
-- reported because only the assigned verifier (00235) can certify, and "me as the main admin must
-- be able to override this". Reassigning the verifier to yourself and certifying already worked
-- for any owner/admin/PM, but in two steps, and nothing recorded that it was an override.
--
-- 1. Four columns on inspections.inspections record the override: who took over, whom they
--    replaced, why, and when. All four are set together or not at all (CHECK).
--
-- 2. inspections_transition_guard() gets one new branch, ahead of the assignment branch: an update
--    that touches any of the four override columns is an override. It is allowed only
--      • while the inspection is awaiting verification (submitted, not yet certified);
--      • for an active owner or admin of the inspection's organisation (an org or project PM is
--        refused: the guard's assignment rule already lets them reassign, without an override);
--      • when the caller makes themselves the verifier and names themselves as the overrider;
--      • when the caller is not already the verifier, and with a non-blank reason.
--    The guard stamps the replaced verifier, the time and the trimmed reason; nothing sent for
--    them is used. Any other change of verifier clears the four columns, so a stale override never
--    reaches a certificate. The rest of the body is the live production body of 2026-11-03 (00253),
--    unchanged; 00250's separation trigger still applies to the new verifier.
--
-- 3. inspections.certify_in_place_of_verifier(): the override and the certify in ONE transaction,
--    as the caller (SECURITY INVOKER), so the guard and certification_blockers() decide everything
--    and a refused certify (separate verifier, signature, CoC number, no PASS verdict) leaves the
--    original verifier in place. The pass-result rule is untouched: an override never certifies a
--    FAIL, an unsubmitted inspection or a stale verdict.
--
-- @verify:begin
-- column: inspections.inspections.verification_override_by
-- column: inspections.inspections.verification_override_replaced
-- column: inspections.inspections.verification_override_reason
-- column: inspections.inspections.verification_override_at
-- constraint: inspections_verification_override_complete ON inspections.inspections
-- function: inspections.certify_in_place_of_verifier(uuid,text,text)
-- function: inspections.user_can_override_verifier(uuid)
-- function: inspections.inspections_transition_guard()
-- grant_absent: anon EXECUTE ON inspections.certify_in_place_of_verifier(uuid,text,text)
-- grant_absent: anon EXECUTE ON inspections.user_can_override_verifier(uuid)
-- sql: (SELECT pg_get_functiondef('inspections.inspections_transition_guard()'::regprocedure) LIKE '%verification_override_by%')
-- sql: (SELECT pg_get_functiondef('inspections.inspections_transition_guard()'::regprocedure) LIKE '%inspections.verdicts%')
-- sql: (SELECT has_function_privilege('authenticated', 'inspections.certify_in_place_of_verifier(uuid,text,text)', 'EXECUTE'))
-- sql: (SELECT NOT prosecdef FROM pg_proc WHERE oid = 'inspections.certify_in_place_of_verifier(uuid,text,text)'::regprocedure)
-- behaviour: only an org owner/admin overrides, only while awaiting verification, never a FAIL; proven by scripts/db/assert-inspection-verifier-override.sql
-- @verify:end

-- ── 1. The override record ───────────────────────────────────────────────────────────────────
ALTER TABLE inspections.inspections
  ADD COLUMN IF NOT EXISTS verification_override_by       UUID NULL,
  ADD COLUMN IF NOT EXISTS verification_override_replaced UUID NULL,
  ADD COLUMN IF NOT EXISTS verification_override_reason   TEXT NULL,
  ADD COLUMN IF NOT EXISTS verification_override_at       TIMESTAMPTZ NULL;

-- No foreign keys: a certificate's record of who signed in whose place must outlive the accounts.
-- The replaced verifier may be NULL (an inspection submitted with no verifier).
ALTER TABLE inspections.inspections DROP CONSTRAINT IF EXISTS inspections_verification_override_complete;
ALTER TABLE inspections.inspections ADD CONSTRAINT inspections_verification_override_complete CHECK (
  (verification_override_by IS NULL AND verification_override_replaced IS NULL
     AND verification_override_reason IS NULL AND verification_override_at IS NULL)
  OR (verification_override_by IS NOT NULL AND verification_override_at IS NOT NULL
      AND btrim(COALESCE(verification_override_reason, '')) <> '')
);

-- ── 2. Who may override ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION inspections.user_can_override_verifier(_inspection_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM inspections.inspections i
    JOIN public.user_organisations uo
      ON uo.organisation_id = i.organisation_id AND uo.user_id = auth.uid()
    WHERE i.id = _inspection_id
      AND uo.is_active = TRUE
      AND uo.role IN ('owner', 'admin')
      AND public.user_has_project_access(i.project_id)
  );
$fn$;
REVOKE ALL ON FUNCTION inspections.user_can_override_verifier(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION inspections.user_can_override_verifier(uuid) TO authenticated, service_role;

-- ── 3. The transition guard (00253's body + the override branch) ─────────────────────────────
CREATE OR REPLACE FUNCTION inspections.inspections_transition_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     UUID := auth.uid();
  v_changed TEXT[];
  v_allowed TEXT[];
  v_block   TEXT;
  v_result  TEXT;
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

  IF NEW.status = OLD.status
     AND v_changed && ARRAY['verification_override_by','verification_override_replaced',
                            'verification_override_reason','verification_override_at'] THEN
    -- An org owner/admin takes over verification in place of the assigned verifier (00260).
    IF OLD.status <> 'awaiting_verification' THEN
      RAISE EXCEPTION 'You can certify in place of the verifier only once the inspection has been submitted.' USING ERRCODE = '42501';
    END IF;
    IF NOT inspections.user_can_override_verifier(OLD.id) THEN
      RAISE EXCEPTION 'Only an organisation owner or admin can certify in place of the assigned verifier.' USING ERRCODE = '42501';
    END IF;
    IF NEW.verification_override_by IS DISTINCT FROM v_uid OR NEW.verifier_id IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'An override makes you the verifier: it cannot be recorded for someone else.' USING ERRCODE = '42501';
    END IF;
    IF OLD.verifier_id IS NOT DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'You are already the verifier of this inspection: certify it directly.' USING ERRCODE = '42501';
    END IF;
    IF btrim(COALESCE(NEW.verification_override_reason, '')) = '' THEN
      RAISE EXCEPTION 'Certifying in place of the verifier needs a reason.' USING ERRCODE = '23514';
    END IF;
    v_allowed := ARRAY['verifier_id','verification_override_by','verification_override_replaced',
                       'verification_override_reason','verification_override_at'];
    NEW.verification_override_replaced := OLD.verifier_id;
    NEW.verification_override_reason := btrim(NEW.verification_override_reason);
    NEW.verification_override_at := now();

  ELSIF NEW.status = OLD.status THEN
    -- Assignment and details, while open.
    IF NOT inspections.user_can_manage_inspections(OLD.project_id) THEN
      RAISE EXCEPTION 'Only a project manager or above can change an inspection''s assignment or details.' USING ERRCODE = '42501';
    END IF;
    v_allowed := ARRAY['assigned_to_id','verifier_id','target_label','target_location','scheduled_at'];
    -- A new verifier by ordinary reassignment ends any earlier override (00260).
    IF NEW.verifier_id IS DISTINCT FROM OLD.verifier_id THEN
      NEW.verification_override_by := NULL;
      NEW.verification_override_replaced := NULL;
      NEW.verification_override_reason := NULL;
      NEW.verification_override_at := NULL;
    END IF;

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
    -- The result is the server's verdict (00253), never the value this update sends: the
    -- engine's evaluation, written by the certify action with the service role after the
    -- inspection was last submitted. A verdict from before the latest submit is stale.
    SELECT v.overall_result INTO v_result
      FROM inspections.verdicts v
     WHERE v.inspection_id = OLD.id
       AND v.computed_at >= COALESCE(OLD.completed_at, '-infinity'::timestamptz);
    IF v_result IS NULL THEN
      RAISE EXCEPTION 'Certify through the app: there is no current result for this inspection.' USING ERRCODE = '23514';
    END IF;
    IF v_result <> 'pass' THEN
      RAISE EXCEPTION 'An inspection can be certified only with a pass result. Send it back for re-inspection instead.' USING ERRCODE = '23514';
    END IF;
    NEW.overall_result := v_result;
    IF (SELECT t.deliverable_type FROM inspections.templates t WHERE t.id = OLD.template_id) = 'coc' THEN
      NEW.coc_number := btrim(NEW.coc_number);
    ELSE
      NEW.coc_number := inspections.allocate_coc_number(OLD.id);
    END IF;
    NEW.certified_at := now();
  END IF;

  RETURN NEW;
END $function$;

-- ── 4. Override + certify, one transaction ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION inspections.certify_in_place_of_verifier(
  _inspection_id uuid, _reason text, _coc_number text DEFAULT NULL)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid UUID := auth.uid();
  v_number TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '42501';
  END IF;

  -- The guard decides the override (who, when, reason) and stamps the record.
  UPDATE inspections.inspections
     SET verifier_id = v_uid,
         verification_override_by = v_uid,
         verification_override_reason = _reason
   WHERE id = _inspection_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inspection not found.' USING ERRCODE = 'P0002';
  END IF;

  -- Then the ordinary certify: certification_blockers() and the verdict gate. A refusal here
  -- rolls the override back with it.
  UPDATE inspections.inspections
     SET status = 'certified', coc_number = _coc_number
   WHERE id = _inspection_id AND status = 'awaiting_verification'
  RETURNING coc_number INTO v_number;
  IF v_number IS NULL THEN
    RAISE EXCEPTION 'Nothing was certified: the inspection may have moved on. Reload and try again.' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_number;
END $fn$;
REVOKE ALL ON FUNCTION inspections.certify_in_place_of_verifier(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION inspections.certify_in_place_of_verifier(uuid, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
