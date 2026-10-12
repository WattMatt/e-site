-- E5: a bidder who answers CIDB grading "Not applicable" (00246) is not asked
-- for the CIDB certificate (owner, 2026-10-12). Before this, a tender that
-- listed "CIDB registration certificate" as a required document refused such a
-- bidder's submission ("1 required document(s) not uploaded").
--
-- The link is explicit: a document requirement carries cidb_certificate = true.
-- Only those requirements are waived, and only for a bidder whose stored
-- cidb_grade is 'N/A'. Every other required document is still enforced.

-- 1. The flag.
ALTER TABLE projects.tender_requirements
  ADD COLUMN cidb_certificate boolean NOT NULL DEFAULT false;
ALTER TABLE projects.tender_requirements
  ADD CONSTRAINT tender_requirements_cidb_certificate_is_document CHECK (NOT cidb_certificate OR kind = 'document');

-- 2. Existing CIDB-certificate requirements, by their label. Requirements on an
--    issued tender are frozen by tender_requirements_locked; this backfill only
--    adds the waiver (nothing a bidder priced against changes), so the trigger is
--    lifted for this statement alone.
ALTER TABLE projects.tender_requirements DISABLE TRIGGER tender_requirements_locked;
UPDATE projects.tender_requirements
   SET cidb_certificate = true
 WHERE kind = 'document' AND label ~* '\mcidb\M';
ALTER TABLE projects.tender_requirements ENABLE TRIGGER tender_requirements_locked;

-- 3. Bidders see the flag (the return type changes, so drop and recreate).
DROP FUNCTION projects.tender_portal_requirements(uuid);
CREATE FUNCTION projects.tender_portal_requirements(p_tender_id uuid)
RETURNS TABLE (id uuid, sort_order int, kind text, label text, detail text, mandatory boolean, cidb_certificate boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT r.id, r.sort_order, r.kind, r.label, r.detail, r.mandatory, r.cidb_certificate
    FROM projects.tender_requirements r
   WHERE r.tender_id = p_tender_id
     AND projects.tender_participant_can_read(p_tender_id)
   ORDER BY r.sort_order
$$;
REVOKE ALL ON FUNCTION projects.tender_portal_requirements(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.tender_portal_requirements(uuid) TO authenticated, service_role;

-- 4. Submit: the CIDB certificate is not required from a bidder with no CIDB grading.
--    Identical to 00244 except the required-documents count.
CREATE OR REPLACE FUNCTION projects.tender_submit(p_tender_id uuid)
RETURNS TABLE (submitted_at timestamptz, total numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_sub     uuid := projects.tender_lock_my_submission(p_tender_id);
  v_part    uuid := projects.tender_my_participant_id(p_tender_id);
  v_no_cidb boolean;
  v_decl    uuid[];
  v_missing int;
  v_at      timestamptz;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM projects.tender_participants tp WHERE tp.id = v_part AND tp.profile_completed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'complete your company details first' USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO v_missing
    FROM projects.tender_boq_items i
    LEFT JOIN projects.tender_submission_lines l ON l.submission_id = v_sub AND l.item_id = i.id
   WHERE i.tender_id = p_tender_id AND i.kind = 'item'
     AND i.rate_cell_type IN ('priced','rate_only')
     AND l.rate IS NULL;
  IF v_missing > 0 THEN
    RAISE EXCEPTION '% item(s) still need a rate', v_missing USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(tp.cidb_grade = 'N/A', false) INTO v_no_cidb
    FROM projects.tender_participants tp WHERE tp.id = v_part;
  SELECT count(*) INTO v_missing
    FROM projects.tender_requirements r
   WHERE r.tender_id = p_tender_id AND r.mandatory AND r.kind = 'document'
     AND NOT (r.cidb_certificate AND COALESCE(v_no_cidb, false))
     AND NOT EXISTS (SELECT 1 FROM projects.tender_submission_documents d
                      WHERE d.submission_id = v_sub AND d.requirement_id = r.id);
  IF v_missing > 0 THEN
    RAISE EXCEPTION '% required document(s) not uploaded', v_missing USING ERRCODE = '23514';
  END IF;
  SELECT s.declarations INTO v_decl FROM projects.tender_submissions s WHERE s.id = v_sub;
  SELECT count(*) INTO v_missing
    FROM projects.tender_requirements r
   WHERE r.tender_id = p_tender_id AND r.mandatory AND r.kind = 'declaration'
     AND NOT (r.id = ANY (v_decl));
  IF v_missing > 0 THEN
    RAISE EXCEPTION '% declaration(s) not accepted', v_missing USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO v_missing
    FROM projects.tender_clarifications c
   WHERE c.tender_id = p_tender_id AND c.kind = 'addendum' AND c.published_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM projects.tender_addendum_acks a
                      WHERE a.clarification_id = c.id AND a.participant_id = v_part);
  IF v_missing > 0 THEN
    RAISE EXCEPTION '% addendum/addenda not acknowledged', v_missing USING ERRCODE = '23514';
  END IF;

  v_at := now();
  UPDATE projects.tender_submissions
     SET status = 'submitted', submitted_at = v_at, submission_count = submission_count + 1
   WHERE id = v_sub;

  RETURN QUERY
  SELECT v_at,
         COALESCE((SELECT sum(l.amount) FROM projects.tender_submission_lines l WHERE l.submission_id = v_sub), 0)
       + COALESCE((SELECT sum(i.fixed_amount) FROM projects.tender_boq_items i
                    WHERE i.tender_id = p_tender_id AND i.kind = 'item' AND i.rate_cell_type = 'fixed'), 0);
END $$;
REVOKE ALL ON FUNCTION projects.tender_submit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.tender_submit(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- @verify:begin
-- column: projects.tender_requirements.cidb_certificate
-- constraint: tender_requirements_cidb_certificate_is_document ON projects.tender_requirements
-- trigger: tender_requirements_locked ON projects.tender_requirements
-- function: projects.tender_portal_requirements(uuid)
-- function: projects.tender_submit(uuid)
-- sql: (SELECT tgenabled = 'O' FROM pg_trigger WHERE tgname = 'tender_requirements_locked' AND tgrelid = 'projects.tender_requirements'::regclass)
-- sql: (SELECT prosrc LIKE '%cidb_certificate%' FROM pg_proc WHERE oid = 'projects.tender_submit(uuid)'::regprocedure)
-- sql: (SELECT pg_get_function_result(oid) LIKE '%cidb_certificate boolean%' FROM pg_proc WHERE oid = 'projects.tender_portal_requirements(uuid)'::regprocedure)
-- grant_absent: anon EXECUTE ON projects.tender_submit(uuid)
-- grant_absent: anon EXECUTE ON projects.tender_portal_requirements(uuid)
-- @verify:end
