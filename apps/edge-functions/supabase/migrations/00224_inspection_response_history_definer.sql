-- 00224_inspection_response_history_definer.sql
--
-- No signed-in user has ever been able to save an inspection answer.
--
-- inspections.append_response_history() (00066 §12.4) is the AFTER INSERT/UPDATE trigger on
-- inspections.responses that copies every write into inspections.response_history. It was
-- created SECURITY INVOKER, and response_history has RLS on with a SELECT policy and no INSERT
-- policy (00066 §13). So the trigger's insert ran as the caller and was refused, and the
-- caller's whole response write rolled back with it: "new row violates row-level security
-- policy for table response_history". Production held 20 inspections, all `assigned`, and
-- zero responses, zero history rows. Reproduced 2026-10-05 as the rbac-test contractor inside
-- a rolled-back transaction: user_can_write_responses() = true, insert refused.
--
-- The site-forms twin, field.append_form_response_history() (00179), is SECURITY DEFINER for
-- exactly this reason, and so is projects' event trigger (00196 §11).
--
-- While the function is being redefined it also stops trusting the client for the author.
-- responses.latest_responded_by is written by the client and no policy pins it to auth.uid(),
-- and certifyInspectionAction reads response_history.responded_by to enforce "the verifier did
-- not contribute". History now records the signed-in user (auth.uid()); only a write with no
-- session at all (service role) falls back to latest_responded_by.
--
-- @verify:begin
-- function: inspections.append_response_history()
-- trigger: trg_append_response_history ON inspections.responses
-- sql: (SELECT prosecdef FROM pg_proc WHERE oid = 'inspections.append_response_history()'::regprocedure)
-- sql: (SELECT proconfig::text LIKE '%search_path=%' FROM pg_proc WHERE oid = 'inspections.append_response_history()'::regprocedure)
-- sql: (SELECT pg_get_userbyid(proowner) = 'postgres' FROM pg_proc WHERE oid = 'inspections.append_response_history()'::regprocedure)
-- sql: (SELECT NOT has_function_privilege('authenticated', 'inspections.append_response_history()', 'EXECUTE'))
-- sql: (SELECT pg_get_functiondef('inspections.append_response_history()'::regprocedure) LIKE '%auth.uid()%')
-- behaviour: a contributor's answer and its attributed history row land; proven by scripts/db/assert-inspection-response-history.sql
-- @verify:end

CREATE OR REPLACE FUNCTION inspections.append_response_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  INSERT INTO inspections.response_history (
    inspection_id, section_id, field_id,
    value_bool, value_number, value_text, value_array, value_json,
    pass_state, fail_reason, responded_by, responded_at
  ) VALUES (
    NEW.inspection_id, NEW.section_id, NEW.field_id,
    NEW.value_bool, NEW.value_number, NEW.value_text, NEW.value_array, NEW.value_json,
    NEW.pass_state, NEW.fail_reason,
    COALESCE(auth.uid(), NEW.latest_responded_by),
    COALESCE(NEW.latest_responded_at, now())
  );
  RETURN NEW;
END $fn$;

ALTER FUNCTION inspections.append_response_history() OWNER TO postgres;
-- A trigger function's EXECUTE is checked when the trigger is created, not when it fires (00186),
-- so nobody needs to hold it.
REVOKE ALL ON FUNCTION inspections.append_response_history() FROM PUBLIC;
REVOKE ALL ON FUNCTION inspections.append_response_history() FROM anon;
REVOKE ALL ON FUNCTION inspections.append_response_history() FROM authenticated;
