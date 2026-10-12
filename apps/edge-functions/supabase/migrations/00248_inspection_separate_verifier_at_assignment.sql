-- 00248_inspection_separate_verifier_at_assignment.sql
--
-- On a template that needs a separate verifier (CoC and factory-test by default, or
-- requires_separate_verifier in the template), the verifier must be someone who did not fill in
-- the inspection. Until now that rule was checked only at the very end, by
-- inspections.certification_blockers() (00235), when the verifier pressed Certify. Nothing
-- stopped the same person being named inspector AND verifier, or the verifier entering answers.
--
-- Seen on production 2026-10-12, project "ZZ status-guard test": on "Shoprite" (LV line shop
-- board audit, a CoC template) Ernst was inspector and verifier and entered 35 answers; on "Boxer"
-- (same template) he was verifier and entered 2. Both inspections could never be certified, and
-- nothing said so until the last step.
--
-- 1. inspections.template_requires_separate_verifier(template_id): the one statement of the rule,
--    the same expression certification_blockers() uses.
-- 2. inspections.user_can_write_responses(): the verifier of such an inspection can no longer
--    write its answers, photos or files (the gate behind responses_insert/update_contributor,
--    photos_insert/delete and the inspection-photos / -attachments / -signatures buckets). The
--    verifier keeps signatures_insert through its verifier arm (00234), so they can still sign.
-- 3. trg_inspections_verifier_separation: an INSERT, or an UPDATE that changes verifier_id or
--    assigned_to_id, is refused when the verifier is the inspector or has already answered.
--    Updates that do not touch either column (status moves, abandon) are untouched, so an
--    existing row in that state can still be reassigned out of it or abandoned. The name sorts
--    after trg_inspections_transition_guard (00235), so the guard's refusals (status, role) are
--    the ones a person sees first; this one speaks only to an otherwise allowed reassignment.
-- 5. The same trigger refuses a verifier (on INSERT, or when verifier_id changes) whose effective
--    role on the project is not owner, admin or project manager: the role set the assignment
--    forms offer, and the only people who could certify it in practice. Before, any id could be
--    written there over the API, including someone with no access to the project at all, which
--    left an inspection nobody could ever certify. Production (2026-10-12): every open
--    inspection's verifier is an owner or admin, so no row changes.
--
-- 4. responses_update_verifier (00066) let the verifier flip answers while the inspection awaits
--    verification. A flip is an answer: response_history records the verifier, and on a
--    separate-verifier template certification_blockers() then refuses them for good. It now
--    excludes those templates; on the others the verifier may still correct an answer.
--
-- certification_blockers() is left as it is: it stays the last line of defence.
--
-- @verify:begin
-- function: inspections.template_requires_separate_verifier(uuid)
-- function: inspections.enforce_separate_verifier()
-- function: inspections.user_can_write_responses(uuid)
-- trigger: trg_inspections_verifier_separation ON inspections.inspections
-- policy: responses_update_verifier ON inspections.responses PERMISSIVE
-- sql: (SELECT coalesce(qual, '') LIKE '%template_requires_separate_verifier%' FROM pg_policies WHERE schemaname = 'inspections' AND tablename = 'responses' AND policyname = 'responses_update_verifier')
-- sql: (SELECT pg_get_functiondef('inspections.user_can_write_responses(uuid)'::regprocedure) LIKE '%template_requires_separate_verifier%')
-- sql: (SELECT pg_get_functiondef('inspections.enforce_separate_verifier()'::regprocedure) LIKE '%user_effective_project_role%')
-- sql: (SELECT pg_get_functiondef('inspections.user_can_write_responses(uuid)'::regprocedure) LIKE '%pm.is_active%')
-- sql: (SELECT pg_get_functiondef('inspections.user_can_write_responses(uuid)'::regprocedure) LIKE '%user_effective_project_role%')
-- sql: (SELECT bool_and(prosecdef AND proconfig::text LIKE '%search_path=%') FROM pg_proc WHERE oid IN ('inspections.user_can_write_responses(uuid)'::regprocedure, 'inspections.template_requires_separate_verifier(uuid)'::regprocedure, 'inspections.enforce_separate_verifier()'::regprocedure))
-- sql: (SELECT NOT has_function_privilege('anon', 'inspections.template_requires_separate_verifier(uuid)', 'EXECUTE'))
-- sql: (SELECT NOT has_function_privilege('authenticated', 'inspections.enforce_separate_verifier()', 'EXECUTE'))
-- sql: (SELECT has_function_privilege('authenticated', 'inspections.user_can_write_responses(uuid)', 'EXECUTE'))
-- behaviour: the verifier of a separate-verifier inspection cannot answer it and cannot be its inspector or a past contributor; proven by scripts/db/assert-inspection-separate-verifier.sql
-- @verify:end

CREATE OR REPLACE FUNCTION inspections.template_requires_separate_verifier(_template_id UUID) RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT COALESCE((
    SELECT CASE WHEN jsonb_typeof(t.schema_json->'requires_separate_verifier') = 'boolean'
                THEN (t.schema_json->>'requires_separate_verifier')::boolean
                ELSE t.deliverable_type IN ('coc','factory_test') END
      FROM inspections.templates t WHERE t.id = _template_id), false);
$fn$;

REVOKE ALL ON FUNCTION inspections.template_requires_separate_verifier(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION inspections.template_requires_separate_verifier(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION inspections.user_can_write_responses(_inspection_id UUID) RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM inspections.inspections i
    JOIN projects.project_members pm ON pm.project_id = i.project_id AND pm.user_id = auth.uid()
    JOIN public.user_organisations uo
      ON uo.user_id = auth.uid() AND uo.organisation_id = i.organisation_id
    WHERE i.id = _inspection_id
      AND pm.is_active = TRUE
      AND uo.is_active = TRUE
      AND uo.role <> 'client_viewer'
      AND COALESCE(public.user_effective_project_role(i.project_id, auth.uid()), 'client_viewer') <> 'client_viewer'
      AND i.status IN ('assigned','in_progress','re-inspect_required')
      -- The verifier of a separate-verifier inspection checks the work; they do not do it (00248).
      AND NOT (i.verifier_id IS NOT DISTINCT FROM auth.uid()
               AND inspections.template_requires_separate_verifier(i.template_id))
  );
$fn$;

CREATE OR REPLACE FUNCTION inspections.enforce_separate_verifier() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_name TEXT;
BEGIN
  IF NEW.verifier_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.verifier_id IS NOT DISTINCT FROM OLD.verifier_id
     AND NEW.assigned_to_id IS NOT DISTINCT FROM OLD.assigned_to_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), p.email, 'This person') INTO v_name
    FROM public.profiles p WHERE p.id = NEW.verifier_id;
  v_name := COALESCE(v_name, 'This person');

  IF (TG_OP = 'INSERT' OR NEW.verifier_id IS DISTINCT FROM OLD.verifier_id)
     AND COALESCE(public.user_effective_project_role(NEW.project_id, NEW.verifier_id), '')
         NOT IN ('owner', 'admin', 'project_manager') THEN
    RAISE EXCEPTION '% cannot verify inspections on this project: the verifier must be an owner, admin or project manager with access to it. Choose someone else to verify.', v_name
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT inspections.template_requires_separate_verifier(NEW.template_id) THEN
    RETURN NEW;
  END IF;

  IF NEW.verifier_id = NEW.assigned_to_id THEN
    RAISE EXCEPTION '% cannot be both the inspector and the verifier: this template needs a separate verifier. Choose someone else to verify.', v_name
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM inspections.response_history h
              WHERE h.inspection_id = NEW.id AND h.responded_by = NEW.verifier_id) THEN
    RAISE EXCEPTION '% has already filled in answers on this inspection, so they cannot verify it: this template needs a separate verifier. Choose someone who has not.', v_name
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION inspections.enforce_separate_verifier() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_inspections_verifier_separation ON inspections.inspections;
CREATE TRIGGER trg_inspections_verifier_separation
  BEFORE INSERT OR UPDATE OF verifier_id, assigned_to_id ON inspections.inspections
  FOR EACH ROW EXECUTE FUNCTION inspections.enforce_separate_verifier();

DROP POLICY IF EXISTS responses_update_verifier ON inspections.responses;
CREATE POLICY responses_update_verifier ON inspections.responses
  FOR UPDATE TO authenticated
  USING (
    inspections.is_inspection_verifier(inspection_id)
    AND EXISTS (
      SELECT 1 FROM inspections.inspections i
       WHERE i.id = responses.inspection_id
         AND i.status = 'awaiting_verification'
         AND NOT inspections.template_requires_separate_verifier(i.template_id)
    )
  );
