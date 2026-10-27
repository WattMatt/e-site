-- 00253_inspection_verdict_gate.sql
--
-- The pass/fail rule moves to one place and the database stops trusting the verifier with it.
-- Decided with the owner on 2026-10-27: an inspection FAILS only on a Rating of Poor or on an
-- answer its template marks as failing (`fail_values`, e.g. a snag's risk high/critical). Every
-- other check — a pass/fail tick, a reading outside its limit, a missing photo — is recorded and
-- printed, never failing. The rule lives in packages/shared/src/inspections/engine.ts
-- (verdictFailure / evaluateInspection); this migration makes the database enforce its result.
--
-- 1. inspections.verdicts: one row per inspection, the engine's result as the server computed
--    it. Written only with the service role (the certify action, after its checks); signed-in
--    users have no grant at all. computed_at is stamped by the database, so a clock difference
--    between the app host and Postgres cannot make a verdict look fresher than it is.
--
-- 2. inspections_transition_guard() (00235): on certify it no longer accepts the overall_result
--    the update sends. Before, any value in ('pass','conditional_pass') was taken as given, so
--    the assigned verifier could PATCH status='certified', overall_result='pass' over PostgREST
--    on an inspection the engine fails. Now the guard reads the verdict written after the latest
--    submit (computed_at >= completed_at), refuses when there is none or it is not 'pass', and
--    copies it into overall_result. certification_blockers() still runs first, so its sentences
--    (verifier, separate verifier, signatures, CoC number) are unchanged. The body is 00235's,
--    verified identical to production on 2026-10-27, with only that block replaced.
--
-- 3. responses_update_verifier is dropped. 00250 narrowed it to templates without a separate
--    verifier; the owner decided a verifier never edits answers (they certify or send back),
--    because an edit could quietly turn a critical snag into a low one or a Poor rating into a
--    Good one before certifying. The capture page no longer offers the edit.
--
-- 4. responses_delete_contributor: removing a repeating-group entry deletes its answers. There
--    was no DELETE policy on inspections.responses, so deleteRepeatingGroupEntryAction deleted 0
--    rows without an error and a removed entry kept counting (a removed "critical" snag would
--    still fail the inspection). Same gate as insert/update: user_can_write_responses().
--
-- 5. The EMB template's snag risk gets fail_values ['high','critical'] IN PLACE, on every EMB
--    version that has that field (1.1-1.3; 1.0's snag list has no risk). A new version would leave the 13 open EMB inspections (all on v1.3) outside the
--    rule. Templates are immutable by trigger (trg_template_immutability) because a certified
--    result must not shift under an edit; none of these inspections is certified (production
--    2026-10-27: 0 certified EMB inspections, 0 high/critical snags recorded), and the result is
--    stored on certify anyway. The trigger is disabled for this one UPDATE only.
--
-- Production 2026-10-27, read before writing: 52 inspections, 1 certified (a pass, engine
-- agrees); scripts/inspections/verdict-audit.ts shows the new rule fails none of them today.
--
-- @verify:begin
-- function: inspections.inspections_transition_guard()
-- table: inspections.verdicts
-- function: inspections.stamp_verdict()
-- policy: responses_delete_contributor ON inspections.responses PERMISSIVE
-- sql: (SELECT to_regclass('inspections.verdicts') IS NOT NULL)
-- sql: (SELECT relrowsecurity FROM pg_class WHERE oid = 'inspections.verdicts'::regclass)
-- sql: (SELECT NOT has_table_privilege('authenticated', 'inspections.verdicts', 'INSERT'))
-- sql: (SELECT NOT has_table_privilege('authenticated', 'inspections.verdicts', 'UPDATE'))
-- sql: (SELECT pg_get_functiondef('inspections.inspections_transition_guard()'::regprocedure) LIKE '%inspections.verdicts%')
-- sql: (SELECT NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'inspections' AND tablename = 'responses' AND policyname = 'responses_update_verifier'))
-- sql: (SELECT bool_and(t.schema_json::text LIKE '%"fail_values": ["high", "critical"]%') FROM inspections.templates t WHERE t.name = 'Electrical Main Board (EMB) Inspection' AND t.is_active)
-- sql: (SELECT tgenabled = 'O' FROM pg_trigger WHERE tgname = 'trg_template_immutability')
-- behaviour: a verifier cannot certify without a server verdict, a fail verdict, or a stale one; proven by scripts/db/assert-inspection-verdict-gate.sql
-- @verify:end

-- ── 1. Server verdicts ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inspections.verdicts (
  inspection_id  UUID PRIMARY KEY REFERENCES inspections.inspections(id) ON DELETE CASCADE,
  overall_result TEXT NOT NULL CHECK (overall_result IN ('pass','fail')),
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  computed_by    UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE inspections.verdicts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON inspections.verdicts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON inspections.verdicts TO service_role;

CREATE OR REPLACE FUNCTION inspections.stamp_verdict() RETURNS TRIGGER
  LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN
  NEW.computed_at := now();
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION inspections.stamp_verdict() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_verdicts_stamp ON inspections.verdicts;
CREATE TRIGGER trg_verdicts_stamp
  BEFORE INSERT OR UPDATE ON inspections.verdicts
  FOR EACH ROW EXECUTE FUNCTION inspections.stamp_verdict();

-- ── 2. The transition guard certifies against the server verdict ────────────────────────────
CREATE OR REPLACE FUNCTION inspections.inspections_transition_guard() RETURNS TRIGGER
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
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
END $fn$;
REVOKE ALL ON FUNCTION inspections.inspections_transition_guard() FROM PUBLIC, anon, authenticated;

-- ── 3. A verifier never edits answers ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS responses_update_verifier ON inspections.responses;

-- ── 4. Removing a repeating-group entry deletes its answers ──────────────────────────────────
DROP POLICY IF EXISTS responses_delete_contributor ON inspections.responses;
CREATE POLICY responses_delete_contributor ON inspections.responses
  FOR DELETE TO authenticated
  USING (inspections.user_can_write_responses(inspection_id));

-- ── 5. EMB snag risk: high and critical fail the inspection ──────────────────────────────────
ALTER TABLE inspections.templates DISABLE TRIGGER trg_template_immutability;

UPDATE inspections.templates t
   SET schema_json = jsonb_set(t.schema_json, '{sections}', (
     SELECT jsonb_agg(
              CASE WHEN s->>'section_id' = 'observations_snag_list' THEN
                jsonb_set(s, '{fields}', (
                  SELECT jsonb_agg(
                           CASE WHEN f->>'field_id' = 'snag_list' AND f->>'type' = 'repeating_group' THEN
                             jsonb_set(f, '{fields}', (
                               SELECT jsonb_agg(
                                        CASE WHEN g->>'field_id' = 'risk_level'
                                             THEN g || '{"fail_values": ["high", "critical"]}'::jsonb
                                             ELSE g END
                                        ORDER BY gi)
                                 FROM jsonb_array_elements(f->'fields') WITH ORDINALITY AS gx(g, gi)))
                           ELSE f END
                           ORDER BY fi)
                    FROM jsonb_array_elements(s->'fields') WITH ORDINALITY AS fx(f, fi)))
              ELSE s END
              ORDER BY si)
       FROM jsonb_array_elements(t.schema_json->'sections') WITH ORDINALITY AS sx(s, si)))
 WHERE t.name = 'Electrical Main Board (EMB) Inspection'
   AND t.schema_json @? '$.sections[*] ? (@.section_id == "observations_snag_list").fields[*] ? (@.field_id == "snag_list").fields[*] ? (@.field_id == "risk_level")';

ALTER TABLE inspections.templates ENABLE TRIGGER trg_template_immutability;
