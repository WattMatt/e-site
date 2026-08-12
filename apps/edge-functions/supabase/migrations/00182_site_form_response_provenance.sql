-- 00182_site_form_response_provenance.sql
-- Records where a site-form answer came from.
--
-- A form is now pre-populated from the project record: project and client
-- details, board identity, the fed-from board and conductor sizes from the
-- cable schedule, and one circuit row per downstream board. That is a large
-- saving on a 23-circuit main board, and it is what was asked for.
--
-- But on a document that may be read in an incident enquiry, a value inherited
-- from a drawing and a value verified at the board should not look identical.
-- SANS 10142-1 6.6.1.21(a) says in terms to verify the fed-from label rather
-- than copy it, and the form's own as-found / as-verified split exists because
-- the record is so often wrong.
--
-- So: this column does NOT gate anything. Submission is unaffected. It simply
-- lets the PDF say which answers were inherited and which were typed on site.
-- NULL means the answer was entered by a person -- which is why the upsert in
-- upsertFormResponseAction clears it on every user edit.

BEGIN;

ALTER TABLE field.form_responses
  ADD COLUMN IF NOT EXISTS prefilled_from TEXT;

COMMENT ON COLUMN field.form_responses.prefilled_from IS
  'Source of a pre-populated answer (project | organisation | user | structure_node | cable_schedule | system). NULL once a person edits the value, so NULL means "entered on site".';

-- Same trail on the append-only history, otherwise the audit page cannot show
-- that the original value was inherited rather than stated.
ALTER TABLE field.form_response_history
  ADD COLUMN IF NOT EXISTS prefilled_from TEXT;

CREATE OR REPLACE FUNCTION field.append_form_response_history()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'field', 'public' AS $fn$
BEGIN
  INSERT INTO field.form_response_history (
    form_id, section_id, field_id, value_bool, value_number, value_text,
    value_array, value_json, pass_state, fail_reason, responded_by, responded_at,
    prefilled_from
  ) VALUES (
    NEW.form_id, NEW.section_id, NEW.field_id, NEW.value_bool, NEW.value_number,
    NEW.value_text, NEW.value_array, NEW.value_json, NEW.pass_state,
    NEW.fail_reason, NEW.latest_responded_by, NEW.latest_responded_at,
    NEW.prefilled_from
  );
  RETURN NEW;
END $fn$;

-- 00179 revoked this from PUBLIC; CREATE OR REPLACE preserves the existing ACL,
-- but re-assert it so a future plain CREATE cannot silently reopen it.
REVOKE ALL ON FUNCTION field.append_form_response_history() FROM PUBLIC;

COMMIT;

NOTIFY pgrst, 'reload schema';
