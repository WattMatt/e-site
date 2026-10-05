-- 00230_inspection_write_gate.sql
--
-- Writes to an inspection now follow the project membership, not only the org membership.
--
-- 1. inspections.user_can_write_responses() (00153) gates every answer, photo and file write
--    (responses_insert_contributor, responses_update_contributor, photos_insert, photos_delete
--    and the inspection-photos / -attachments / -signatures bucket policies). It joined
--    project_members but never checked pm.is_active, and it read only the ORG role. So:
--      • a soft-deactivated project member (pm.is_active = false, org row active) could still
--        save answers and photos over PostgREST;
--      • a client viewer on THIS project (project_members.role = 'client_viewer' while their
--        org role is, say, contractor) could still save answers and photos.
--    Both proven on production 2026-10-05 as the rbac-test contractor with its KINGSWALK row
--    flipped inside a rolled-back transaction (scripts/db/assert-inspection-write-gate.sql).
--    It now also requires pm.is_active and an effective project role that is not
--    client_viewer. A NULL effective role is treated as client_viewer (refused), never as
--    "not a client viewer" (the widening 00204 warns about). The org-role check stays, so a
--    user whose ORG role is client_viewer is still refused whatever their project row says.
--
-- 2. signatures_insert (00066) checked the ORG role only. Its EXISTS subquery reads
--    inspections.inspections as the caller, so that table's SELECT policy
--    (user_has_project_access, which honours pm.is_active since 00204) was the real, implicit
--    membership gate. A deactivated member or an org member off the project was refused by
--    accident; a project-scoped client viewer was admitted. The policy now names its gate:
--    a contributor (user_can_write_responses) or the assigned verifier, which is exactly what
--    the inspection-signatures bucket already requires before the web route inserts the row.
--
-- 3. inspections.is_inspection_verifier() checked only verifier_id = auth.uid(), so a verifier
--    who was later deactivated kept the verifier arm of responses_update_verifier and the
--    signatures bucket. It now also requires user_has_project_access(project_id).
--
-- 4. inspections.user_can_verify() (validate-inspection's PM+ arm) checked neither
--    uo.is_active nor pm.is_active. It now checks both.
--
-- NOT changed here: inspections.user_has_inspection_read() (reads; the parent inspection row
-- is already hidden from a deactivated member by inspections_select_members), and
-- inspections_update_contributors, which lets any non-client-viewer project member UPDATE any
-- column of an inspection, status included. Both are recorded in docs/rbac-matrix.md.
--
-- Nothing is revoked from anyone today: production holds 0 inactive project_members rows and
-- 0 project-scoped client viewers whose org role is not client_viewer.
--
-- @verify:begin
-- function: inspections.user_can_write_responses(uuid)
-- function: inspections.is_inspection_verifier(uuid)
-- function: inspections.user_can_verify(uuid)
-- policy: signatures_insert ON inspections.signatures PERMISSIVE
-- sql: (SELECT pg_get_functiondef('inspections.user_can_write_responses(uuid)'::regprocedure) LIKE '%pm.is_active%')
-- sql: (SELECT pg_get_functiondef('inspections.user_can_write_responses(uuid)'::regprocedure) LIKE '%user_effective_project_role%')
-- sql: (SELECT pg_get_functiondef('inspections.is_inspection_verifier(uuid)'::regprocedure) LIKE '%user_has_project_access%')
-- sql: (SELECT pg_get_functiondef('inspections.user_can_verify(uuid)'::regprocedure) LIKE '%pm.is_active%')
-- sql: (SELECT pg_get_functiondef('inspections.user_can_verify(uuid)'::regprocedure) LIKE '%uo.is_active%')
-- sql: (SELECT coalesce(with_check, '') LIKE '%user_can_write_responses%' FROM pg_policies WHERE schemaname = 'inspections' AND tablename = 'signatures' AND policyname = 'signatures_insert')
-- sql: (SELECT bool_and(prosecdef AND proconfig::text LIKE '%search_path=%') FROM pg_proc WHERE oid IN ('inspections.user_can_write_responses(uuid)'::regprocedure, 'inspections.is_inspection_verifier(uuid)'::regprocedure, 'inspections.user_can_verify(uuid)'::regprocedure))
-- sql: (SELECT NOT has_function_privilege('anon', 'inspections.user_can_write_responses(uuid)', 'EXECUTE'))
-- sql: (SELECT has_function_privilege('authenticated', 'inspections.user_can_write_responses(uuid)', 'EXECUTE'))
-- behaviour: deactivated members and project-scoped client viewers cannot write answers, photos or signatures; proven by scripts/db/assert-inspection-write-gate.sql
-- @verify:end

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
  );
$fn$;

CREATE OR REPLACE FUNCTION inspections.is_inspection_verifier(_inspection_id UUID) RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM inspections.inspections i
    WHERE i.id = _inspection_id
      AND i.verifier_id = auth.uid()
      AND public.user_has_project_access(i.project_id)
  );
$fn$;

CREATE OR REPLACE FUNCTION inspections.user_can_verify(_project_id UUID) RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM projects.project_members pm
    JOIN public.user_organisations uo
      ON uo.user_id = pm.user_id AND uo.organisation_id = pm.organisation_id
    WHERE pm.project_id = _project_id
      AND pm.user_id = auth.uid()
      AND pm.is_active = TRUE
      AND uo.is_active = TRUE
      AND uo.role IN ('owner','admin','project_manager')
  );
$fn$;

-- CREATE OR REPLACE keeps the ACL; restated so this file alone says who may call them (00186).
REVOKE ALL ON FUNCTION inspections.user_can_write_responses(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION inspections.user_can_write_responses(UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION inspections.is_inspection_verifier(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION inspections.is_inspection_verifier(UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION inspections.user_can_verify(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION inspections.user_can_verify(UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS signatures_insert ON inspections.signatures;
CREATE POLICY signatures_insert ON inspections.signatures
  FOR INSERT TO authenticated
  WITH CHECK (
    signed_by = auth.uid()
    AND (
      inspections.user_can_write_responses(inspection_id)
      OR (
        inspections.is_inspection_verifier(inspection_id)
        AND EXISTS (
          SELECT 1 FROM inspections.inspections i
          WHERE i.id = signatures.inspection_id
            AND i.status NOT IN ('certified','abandoned')
        )
      )
    )
  );
