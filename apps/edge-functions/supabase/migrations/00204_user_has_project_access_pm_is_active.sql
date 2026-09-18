-- ---------------------------------------------------------------------------
-- Migration 00204: public.user_has_project_access AND public.custom_jwt_claims
--                  — clause (a) requires the
--                  projects.project_members row itself to be active
-- ---------------------------------------------------------------------------
-- WHY.
--
-- Two SQL helpers encode "does this user have this project":
--
--   public.user_has_project_access(_project_id)            (00106)
--     the predicate behind 93 RLS policies on 63 tables across
--     cable_schedule (15), field (9), gcr (5), inspections (4), projects
--     (21), storage (3), structure (33) and tenants (3), and inherited by
--     field.user_has_form_read / field.user_can_write_form  — measured on
--     production 2026-09-12 from pg_policies + pg_proc.
--
--   public.user_effective_project_role(p_project_id, p_user_id)  (00107)
--     the predicate behind every requireEffectiveRole() page and action gate.
--
-- 00107's project_members arm requires `pm.is_active = TRUE`. 00106's clause
-- (a) joins projects.project_members to an ACTIVE public.user_organisations
-- row (`uo.is_active`) but never looks at the membership row's own flag. So a
-- member whose project_members row is soft-deactivated:
--
--   * still passes every policy and helper gated on user_has_project_access
--     — the database keeps serving them everything the app says they lost;
--   * resolves to a NULL effective role, so any
--       COALESCE(user_effective_project_role(...), '') <> 'client_viewer'
--     predicate reads them as NOT a client viewer. A deactivated CLIENT
--     VIEWER is therefore WIDENED to the whole project by the very policies
--     written to narrow them. (Measured on the work-item spine branch, whose
--     own policies fail closed on NULL as their own fix; this migration
--     closes the shared helper underneath them.)
--
-- DEMONSTRATED ON PRODUCTION, 2026-09-12, inside rolled-back transactions,
-- as the `rbac-test` fixture (018f2d31-bbe8-4cc1-bbdd-63af0187081e, org
-- role contractor on WM-Consulting), its (643) KINGSWALK project_members row
-- flipped to is_active = false IN THE SAME TRANSACTION and read back
-- exactly as PostgREST would (request.jwt.claims + SET LOCAL ROLE
-- authenticated). structure.nodes and projects.qc_reports were chosen
-- because user_has_project_access is their ONLY permissive SELECT gate:
--
--                                              before 00204   after 00204
--   user_has_project_access(KINGSWALK)         true           false
--   user_effective_project_role(KINGSWALK)     NULL           NULL
--   structure.nodes visible                    134 of 134     0 of 134
--   projects.qc_reports visible                1 of 1         0 of 1
--
-- Controls in the same run, unchanged before and after: the fixture with
-- its row left active (true / contractor / 134 / 1), and an org admin
-- holding NO KINGSWALK membership row at all — clause (b) — (true / admin /
-- 134). Production read back with 0 inactive rows of 47 afterwards; the
-- fixture's row is still active.
--
-- (projects.rfis is NOT a clean probe for this fixture and was not used as
-- evidence: its "Org members can view" policy also admits any active
-- non-client-viewer member of the project's org, which the fixture is — it
-- read 3 of 3 both before and after. The hole matters most for exactly the
-- members that policy does not cover: cross-org members and client viewers,
-- whose only path is the project_members row.)
--
-- REACHABILITY TODAY: NOT through the UI. removeProjectMember
-- (apps/web/src/actions/project-members.actions.ts) hard-DELETEs the row;
-- no code in apps/web, apps/mobile, apps/edge-functions or packages writes
-- projects.project_members.is_active = false (the only writers of that
-- shape target user_organisations, inspection templates, notifications and
-- cloud-sync mappings); production holds 0 inactive rows of 47. The
-- org-level revocation that IS used — removeSubOrgMember flipping
-- user_organisations.is_active — was already honoured by both helpers. This
-- is a loaded trap, not a live leak: the first "deactivate member" feature,
-- a Studio edit, or a future change of that DELETE into an UPDATE would
-- open it silently, with the UI reporting access revoked. 00152 closed
-- exactly this class for user_organisations.is_active.
--
-- WHAT CHANGES: one predicate. Clause (a) gains `AND pm.is_active = TRUE`.
-- Clause (b) — the org-level owner/admin/project_manager auto-pass, which
-- never reads project_members — is untouched. SECURITY DEFINER, STABLE,
-- search_path = public and row_security = off are re-stated verbatim
-- (CREATE OR REPLACE would otherwise reset the SET clauses), and CREATE OR
-- REPLACE preserves the owner (postgres) and the ACL — anon's EXECUTE was
-- revoked by 00186's sweep and stays revoked; authenticated and service_role
-- keep EXECUTE. All 93 policies inherit the fix with no change to any
-- policy body. No existing row changes behaviour (0 inactive rows).
--
-- THE MOBILE HALF, CHANGED IN THE SAME FILE (owner's call, 2026-09-18):
--
--   public.custom_jwt_claims (00164) mirrors clause (a) with its OWN query —
--   it is not a caller of this helper — and deliberately omitted the
--   membership flag, its comment reading "Deliberately does NOT filter
--   pm.is_active (00106 clause (a) doesn't), keeping mobile == web". Fixing
--   only the helper would have kept that parity but in the WRONG direction:
--   a soft-deactivated member would lose every database read while their next
--   mobile token still listed the project in `project_ids`, so the PowerSync
--   sync rule would keep syncing it. Both halves now carry the predicate, so
--   mobile == web still holds and both are now closed.
--
--   The hook runs on EVERY token mint, so nothing else about the function
--   moves: same signature, plpgsql, SECURITY DEFINER, VOLATILE,
--   search_path=public, owner postgres, and the ACL is left to CREATE OR
--   REPLACE (postgres + supabase_auth_admin hold EXECUTE; anon and
--   authenticated hold none, and the @verify block asserts that is still
--   true afterwards). A member whose row is active — all 47 on production
--   today — mints exactly the token they minted before.
--
-- NOT CHANGED, STATED RATHER THAN IMPLIED AWAY:
--
--   * inspections.user_has_inspection_read, inspections.user_can_write_
--     responses and inspections.user_can_verify carry their OWN
--     project_members joins without the membership flag (the first and
--     third without the org flag either). They do not call this helper, so
--     they do not inherit the fix — same class, separate change.
--
-- Guarded by apps/web/src/lib/project-member-active-predicate.contract.test.ts,
-- which resolves the FINAL definition of both helpers from the migration
-- files and fails the build if either loses the predicate (run red against
-- 00106 alone before this file existed). Dry-run assertion files for
-- scripts/db/dry-run-migration.sh: scripts/db/assert-uhpa-*.sql.
--
-- Reversible: re-apply 00106's body (drop the one predicate).
--
-- No new schema, table or function signature: a NOTIFY is enough; no
-- Management-API PostgREST db_schema PATCH is required.
--
-- @verify:begin
-- function: public.user_has_project_access(uuid)
-- sql: (SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'public.user_has_project_access(uuid)'::regprocedure)
--        LIKE '%pm.is_active%'
-- sql: NOT ((SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'public.user_has_project_access(uuid)'::regprocedure)
--        ~* 'NOT\s+pm\.is_active')
-- sql: (SELECT p.prosecdef AND p.provolatile = 's'
--          AND 'row_security=off' = ANY (p.proconfig)
--          AND 'search_path=public' = ANY (p.proconfig)
--        FROM pg_proc p WHERE p.oid = 'public.user_has_project_access(uuid)'::regprocedure)
-- sql: public.user_has_project_access('00000000-0000-0000-0000-000000000000'::uuid) IS FALSE
--        /* no session: auth.uid() is NULL, so the helper must answer FALSE, never
--           NULL - data-independent, a NULL user matches no membership row */
-- grant_present: authenticated EXECUTE ON public.user_has_project_access(uuid)
-- grant_present: service_role EXECUTE ON public.user_has_project_access(uuid)
-- grant_absent: anon EXECUTE ON public.user_has_project_access(uuid)
-- behaviour: a member whose project_members row is is_active = false reads 0 rows
--            from every table whose SELECT is gated on user_has_project_access
--            (scripts/db/assert-uhpa-deactivated-member.sql)
-- behaviour: an active member and an org admin with no membership row read
--            exactly what they read before (scripts/db/assert-uhpa-*-control.sql)
-- function: public.custom_jwt_claims(jsonb)
-- sql: (SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'public.custom_jwt_claims(jsonb)'::regprocedure)
--        LIKE '%pm.is_active%'
-- sql: NOT ((SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'public.custom_jwt_claims(jsonb)'::regprocedure)
--        ~* 'NOT\s+pm\.is_active')
-- sql: (SELECT p.prosecdef AND p.provolatile = 'v'
--          AND 'search_path=public' = ANY (p.proconfig)
--          AND pg_get_userbyid(p.proowner) = 'postgres'
--        FROM pg_proc p WHERE p.oid = 'public.custom_jwt_claims(jsonb)'::regprocedure)
-- grant_present: supabase_auth_admin EXECUTE ON public.custom_jwt_claims(jsonb)
-- grant_absent: anon EXECUTE ON public.custom_jwt_claims(jsonb)
-- grant_absent: authenticated EXECUTE ON public.custom_jwt_claims(jsonb)
-- behaviour: a deactivated member's next token drops that project from
--            claims.project_ids, so PowerSync stops syncing it, while an
--            active member's token is unchanged (scripts/db/assert-uhpa-jwt-claims.sql)
-- @verify:end
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.user_has_project_access(_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
  SELECT
    -- Clause (a): explicit project_members entry. 00204: the membership row
    -- itself must be active, matching user_effective_project_role (00107).
    EXISTS (
      SELECT 1
      FROM projects.project_members pm
      JOIN public.user_organisations uo
        ON uo.user_id = pm.user_id
       AND uo.organisation_id = pm.organisation_id
      WHERE pm.project_id = _project_id
        AND pm.user_id = auth.uid()
        AND pm.is_active = TRUE
        AND uo.is_active = TRUE
    )
    -- Clause (b): org-level owner / admin / project_manager auto-pass (00106).
    OR EXISTS (
      SELECT 1
      FROM projects.projects p
      JOIN public.user_organisations uo
        ON uo.organisation_id = p.organisation_id
      WHERE p.id = _project_id
        AND uo.user_id = auth.uid()
        AND uo.is_active = TRUE
        AND uo.role IN ('owner', 'admin', 'project_manager')
    )
$function$;

COMMENT ON FUNCTION public.user_has_project_access(uuid) IS
'TRUE when the caller may see the project: an ACTIVE projects.project_members row whose identity org the caller is still ACTIVE in (clause a), or an active owner/admin/project_manager role in the project''s organisation (clause b). 00204 added the membership-row flag to clause (a) so a soft-deactivated member is revoked at the database, not only in the app — the same rule user_effective_project_role (00107) already applied.';

-- ---------------------------------------------------------------------------
-- The mobile half. 00164's body verbatim apart from the one predicate and the
-- comment that described its absence; keeping it whole (rather than patching)
-- is deliberate, because this is the function every token mint runs through
-- and the next reader must be able to see all of it in one place.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.custom_jwt_claims(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _user_id      UUID;
  _org_id       UUID;
  _project_ids  JSONB;
  _claims       JSONB;
BEGIN
  _user_id := (event ->> 'user_id')::UUID;

  -- Unchanged: the user's first active organisation (drives the org_* buckets).
  SELECT organisation_id INTO _org_id
  FROM public.user_organisations
  WHERE user_id = _user_id
    AND is_active = true
  ORDER BY created_at ASC
  LIMIT 1;

  -- Projects reachable via an ACTIVE explicit membership whose identity org
  -- the user is still ACTIVE in. Exact mirror of public.user_has_project_access
  -- clause (a), including the user_organisations.is_active join the sync rule
  -- cannot express. 00204: pm.is_active joins uo.is_active here, so a
  -- soft-deactivated member's next token drops the project and PowerSync stops
  -- syncing it — mobile == web, which is what 00164 was keeping.
  SELECT COALESCE(jsonb_agg(DISTINCT pm.project_id), '[]'::jsonb)
  INTO   _project_ids
  FROM   projects.project_members pm
  JOIN   public.user_organisations uo
    ON   uo.user_id = pm.user_id
   AND   uo.organisation_id = pm.organisation_id
  WHERE  pm.user_id = _user_id
    AND  pm.is_active = TRUE
    AND  uo.is_active = TRUE;

  _claims := event -> 'claims';

  IF _org_id IS NOT NULL THEN
    _claims := jsonb_set(_claims, '{org_id}', to_jsonb(_org_id::TEXT));
  END IF;

  -- Always set (defaults to '[]') so the sync rule's json_each degrades cleanly.
  _claims := jsonb_set(_claims, '{project_ids}', _project_ids);

  RETURN jsonb_set(event, '{claims}', _claims);
END;
$function$;

COMMENT ON FUNCTION public.custom_jwt_claims(jsonb) IS
'GoTrue custom-access-token hook. Stamps claims.org_id (first active organisation) and claims.project_ids (projects reachable through an ACTIVE projects.project_members row whose identity org the user is still ACTIVE in). 00204 added pm.is_active so the mobile token tracks public.user_has_project_access clause (a) exactly: a soft-deactivated member''s next token drops the project and PowerSync stops syncing it. Existing tokens are unaffected until they are re-minted — deactivation is not a session kill.';

NOTIFY pgrst, 'reload schema';
