-- ---------------------------------------------------------------------------
-- 00201_rfi_write_authority.sql
--
-- SECURITY (authz gap): give projects.rfis UPDATE a role gate, a column gate
-- and a status machine, so that "only the person who raised an RFI, or the
-- project's owners, admins and project managers, may close it" is true at the
-- database and not merely true of the button.
--
-- Root cause
-- ----------
-- 00027 §3 added the only UPDATE policy this table has ever had:
--
--   CREATE POLICY "Org members can update rfis" ON projects.rfis FOR UPDATE
--     USING (organisation_id = ANY(public.get_user_org_ids()));
--
-- No WITH CHECK (so Postgres reuses the USING expression, which tests only the
-- organisation), no role predicate, no column restriction. Every active member
-- of the organisation therefore holds full UPDATE on EVERY RFI in it —
-- including RFIs on projects they hold no role on. `closeRfiAction`
-- (apps/web/src/actions/rfi.actions.ts) and `rfiService.close`
-- (packages/shared/src/services/rfi.service.ts) check authentication only, and
-- both the web Close button and the mobile one are rendered for every role
-- that can see the record.
--
-- Reproduced on production 2026-09-14 inside a rolled-back transaction, as the
-- rbac-test fixture (a contractor on (643) KINGSWALK), in ONE statement:
-- RFI-4 — raised by the org owner — was closed by the contractor, with
-- `closed_by` forged to the raiser, `closed_at` backdated 400 days, the row
-- moved to a project the contractor holds no role on, `due_date` pushed to
-- 2036 and an assignee invented. Nothing refused any part of it.
--
-- Why it matters beyond the RFI module
-- ------------------------------------
-- Once item 3's projection triggers ship, the work item mirroring each RFI
-- follows every such write at trigger depth 2, where item 2's transition guard
-- is deliberately exempt (00196 §12 (a2), `pg_trigger_depth() > 1`). The
-- source table's gate IS the spine's gate for RFIs. Item 2 spent a whole
-- review closing "a contractor takes the gatekeeper seat and closes in one
-- statement" on projects.work_items; this migration closes the same move on
-- the table the mirror reads.
--
-- What production actually does, measured 2026-09-14 (read-only)
-- --------------------------------------------------------------
-- 15 RFIs, 6 closed. 2 closed by their raiser, 4 by the org owner — in every
-- case a governing role. **Zero were closed by someone who was neither the
-- raiser nor an owner/admin/project manager.** 12 of 15 were raised by
-- contractors and none of those closed themselves. This gate therefore refuses
-- nothing that has ever happened; it refuses what nothing has stopped.
--
-- The model
-- ---------
-- Roles are resolved as the caller's EFFECTIVE project role through
-- public.user_effective_project_role (00107: org owner/admin/project_manager
-- auto-win on every project in the org, else the projects.project_members row,
-- else NULL), never through org membership:
--
--   FLOOR      an effective role on the RFI's project that is not
--              client_viewer. Below this nothing is writable. (RESTRICTIVE
--              policy, both halves.)
--   ANSWER     any caller above the floor may move the status between open,
--              responded and draft->open. Answering is not governance:
--              projects.rfi_responses admits any non-client_viewer org member
--              (00009/00161), so an inspector's or supplier's answer must not
--              fail on the status flip that accompanies it.
--   ROUTE      subject, description, priority, category, assigned_to and
--              due_date are the `rfi` write set's — owner / admin /
--              project_manager / contractor, the same four this quarter's
--              registry gives the type (projects.work_item_types.write_roles,
--              00196:239) and the same set MARKUP_WRITE_ROLES already uses on
--              the /rfis surface. §03 §1.8/§1.9: a write-role holder may
--              assign and re-date.
--   CLOSE      the RAISER, or a governing role (owner / admin /
--              project_manager). After 00198 the RFI work item's gatekeeper is
--              its creator and a mirrored RFI item's creator is `raised_by`,
--              so this is §03 §1.8's "only the gatekeeper closes" written on
--              the source table; the governing arm is 00196 §12 (b)+(d)'s
--              "a governing actor takes the seat and closes in one statement",
--              collapsed, because projects.rfis has no gatekeeper column to
--              take.
--   REOPEN     the `rfi` write set, or the raiser — 00196 §12 (c2) exactly
--              ("the project team, or whoever signed it off").
--   FIXED      project_id, organisation_id, raised_by and created_at. Where an
--              RFI was raised, and by whom, decide who governs it and who may
--              close it; a row that can move carries its own authority with
--              it. (rfi_number is GENERATED ALWAYS AS IDENTITY and Postgres
--              already refuses to update it.)
--   STAMPS     closed_at and closed_by are the guard's, never the caller's.
--
-- Why a BEFORE UPDATE guard as well as a policy
-- ---------------------------------------------
-- RLS cannot compare OLD and NEW, so no policy can express "the status may go
-- open -> responded but not open -> draft", "closed_by must be the caller" or
-- "project_id may not change". The house already has this exact pattern and
-- this exact reason: projects.qc_reports_status_guard (00172:249-267) and
-- projects.work_items_transition_guard (00196 §12). Both are copied here,
-- including the rule that made the site-forms transition trigger inert on
-- first ship: the guard compares auth.uid(), never current_user, which in a
-- SECURITY DEFINER context resolves to the function owner and is true for
-- every caller.
--
-- Why RESTRICTIVE
-- ---------------
-- PostgreSQL OR-combines PERMISSIVE policies, so rewriting 00027's policy
-- would not stop a future permissive policy from re-granting the write. A
-- RESTRICTIVE policy is AND-combined and narrows regardless of how many
-- permissive policies exist now or later. Same pattern as 00161/00171/00193.
-- ⚠ The 00027 PERMISSIVE policy is deliberately LEFT IN PLACE: a RESTRICTIVE
-- policy grants nothing, and RLS consults one only after a PERMISSIVE policy
-- has already passed. Dropping 00027's would close UPDATE for everyone and
-- look like a working gate right up until someone tried to answer an RFI.
--
-- What this narrows, stated plainly
-- ---------------------------------
-- 1. An org member with NO effective role on the RFI's project loses UPDATE
--    on it. Measured on the four projects that hold RFIs: 43 of 108
--    (member x project) pairs — 15 distinct people, every one of them an org
--    `contractor` or `client_viewer` — have no effective role. They keep their
--    read (00034's SELECT policy is org-wide for a non-viewer) and they can
--    still write a response row; what they lose is the ability to close, move,
--    re-date and reassign RFIs on projects they are not on. The status flip
--    that accompanies their answer is refused SILENTLY by RLS (a policy that
--    matches no row raises nothing), so `rfiService.respond` and
--    `respondToRfiAction` are changed in this PR to assert rows-affected and
--    say so rather than leave the answer and the status disagreeing.
-- 2. A PROJECT-SCOPED client_viewer — `projects.project_members.role =
--    'client_viewer'` while the org role is something else — loses UPDATE.
--    00161's block reads public.user_is_client_viewer, which looks only at
--    public.user_organisations, so it never fired for this shape. Resolving
--    the role through user_effective_project_role closes it.
-- 3. inspector and supplier lose the ability to route and re-date (they were
--    never in the /rfis write set) and keep the ability to answer.
--
-- NOT covered here (deliberately)
-- -------------------------------
--   * INSERT. "Org members can create rfis" (00027 §3) checks only the
--     organisation: `raised_by` is caller-supplied and unverified, and an RFI
--     may be created on a project the creator holds no role on. That is a
--     sibling gap with a UI consequence (/rfis/new lists every project the
--     caller can see), it is recorded in docs/rbac-matrix.md's known gaps, and
--     it is not closed in a PR about who may change an RFI after it exists.
--     Note the interaction, which is contained: an RFI inserted with
--     `raised_by` = the caller on a foreign project still cannot be UPDATEd by
--     them, because the RESTRICTIVE USING here requires a role on that project.
--   * DELETE. projects.rfis has no PERMISSIVE DELETE policy at all, so
--     `authenticated` already deletes nothing. Unchanged.
--   * projects.rfi_responses. Its own policies are the answer surface and are
--     out of scope; an answer is not a status change.
--
-- Reversible:
--   DROP TRIGGER IF EXISTS rfis_write_guard_trg ON projects.rfis;
--   DROP POLICY  IF EXISTS rfis_update_gate     ON projects.rfis;
--   DROP FUNCTION IF EXISTS projects.rfis_write_guard();
--   DROP FUNCTION IF EXISTS projects.user_can_update_rfi(uuid);
--
-- Evidence: scripts/db/assertions/rfi-update-gate.sql, run by
-- scripts/db/try-rfi-update-gate.sh against production in a rolled-back
-- transaction (BARE=1 for the red run).
--
-- @verify:begin
-- function: projects.user_can_update_rfi(uuid)
-- function: projects.rfis_write_guard()
-- trigger: rfis_write_guard_trg ON projects.rfis
-- policy: rfis_update_gate ON projects.rfis RESTRICTIVE
-- grant_absent: anon EXECUTE ON projects.user_can_update_rfi(uuid)
-- grant_absent: anon EXECUTE ON projects.rfis_write_guard()
-- grant_absent: authenticated EXECUTE ON projects.rfis_write_guard()
-- grant_absent: anon UPDATE ON projects.rfis
-- grant_present: authenticated EXECUTE ON projects.user_can_update_rfi(uuid)
-- sql: SELECT polqual IS NOT NULL AND polwithcheck IS NOT NULL FROM pg_policy WHERE polrelid = 'projects.rfis'::regclass AND polname = 'rfis_update_gate'
-- sql: SELECT tgtype = 19 FROM pg_trigger WHERE tgrelid = 'projects.rfis'::regclass AND tgname = 'rfis_write_guard_trg'
-- sql: SELECT p.prosecdef AND 'row_security=off' = ANY (p.proconfig) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'projects' AND p.proname = 'user_can_update_rfi'
-- sql: SELECT regexp_replace(p.prosrc, '--[^\n]*', '', 'g') NOT ILIKE '%current_user%' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'projects' AND p.proname = 'rfis_write_guard'
-- sql: SELECT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'projects.rfis'::regclass AND polname = 'Org members can update rfis' AND polpermissive)
-- @verify:end
-- ---------------------------------------------------------------------------

-- ─── 1. The floor ───────────────────────────────────────────────────────────
-- SECURITY DEFINER with row_security off, so the role that decides the gate is
-- read from projects.project_members and public.user_organisations directly
-- and cannot be hidden by the caller's own RLS visibility of those tables.
-- Takes auth.uid() rather than current_user. COALESCEd: a non-member's role is
-- NULL, `NULL <> 'client_viewer'` is NULL, and NULL in a USING clause is
-- treated as false — but the COALESCE says so out loud rather than relying on
-- it, which is the 00183 lesson.
CREATE OR REPLACE FUNCTION projects.user_can_update_rfi(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public' SET row_security TO 'off'
AS $fn$
  SELECT COALESCE(
    public.user_effective_project_role(p_project_id, auth.uid()) IS NOT NULL
    AND public.user_effective_project_role(p_project_id, auth.uid()) <> 'client_viewer',
    FALSE);
$fn$;

-- FROM PUBLIC is not enough where anon holds a DIRECT grant: Supabase's ALTER
-- DEFAULT PRIVILEGES grants anon EXECUTE at creation in `public`, a separate
-- grant (00113:15-24). In `projects` there is no function default ACL
-- (pg_default_acl, measured 2026-09-14: tables and sequences only), so anon's
-- EXECUTE here is the built-in PUBLIC grant and the FROM anon line is
-- belt-and-braces — kept, because has_function_privilege('anon', …) is the
-- check, never proacl, and a future default ACL on this schema must not
-- silently re-open it.
REVOKE ALL     ON FUNCTION projects.user_can_update_rfi(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.user_can_update_rfi(uuid) FROM anon;
-- The helper is evaluated AS THE CALLING ROLE inside the policy, so
-- authenticated must hold EXECUTE or every UPDATE fails with "permission
-- denied for function" — which would read exactly like a working gate.
GRANT EXECUTE ON FUNCTION projects.user_can_update_rfi(uuid) TO authenticated, service_role;

-- anon has never held UPDATE on this table (measured 2026-09-14:
-- has_table_privilege('anon','projects.rfis','UPDATE') is false; the standing
-- `projects` default privilege is SELECT only, 00025:20,26). Declared and
-- revoked anyway, in the 00168 posture: the grant that matters is the one
-- nobody checked.
REVOKE UPDATE ON projects.rfis FROM anon;

-- ─── 2. The guard ───────────────────────────────────────────────────────────
-- SECURITY INVOKER (the default) — a trigger function that authorises must not
-- be DEFINER, or `current_user` becomes the owner; it never reads current_user
-- in any case, and a sql: directive in the @verify block asserts that against
-- the deployed body with comments stripped.
--
-- Every RAISE below is a SENTENCE naming the RFI, because `closeRfiAction`
-- ends `return { error: error.message }` and the mobile close surfaces
-- `e.message` in an Alert — these strings are user-facing copy from the day
-- they ship.
--
-- Fires BEFORE rfis_updated_at (00002:100, also BEFORE UPDATE FOR EACH ROW):
-- BEFORE row triggers run in name order and `rfis_update_gate…` sorts before
-- `rfis_updated_at`, so updated_at is stamped over whatever this returns,
-- which is what that trigger is for.
CREATE OR REPLACE FUNCTION projects.rfis_write_guard() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'projects', 'public'
AS $fn$
DECLARE
  v_actor      uuid := auth.uid();
  v_role       text;
  v_may_write  boolean;
  v_may_govern boolean;
  v_is_raiser  boolean;
BEGIN
  -- THE STAMPS ARE THE GUARD'S, NEVER THE CALLER'S. closed_at and closed_by
  -- are written only by a status change (below, on both paths); on every other
  -- UPDATE they are restored from OLD. Restored, not refused: these are
  -- stamps, not identity, and a refusal would turn an innocent full-row PATCH
  -- that echoes the columns back into an error. To correct them by hand, do
  -- what the inspections.templates immutability trigger already requires —
  -- ALTER TABLE projects.rfis DISABLE TRIGGER rfis_write_guard_trg inside a
  -- transaction.
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    NEW.closed_at := OLD.closed_at;
    NEW.closed_by := OLD.closed_by;
  END IF;

  -- The service path (auth.uid() IS NULL — migrations, the service client,
  -- 00198's backfill) and trigger-driven writes are exempt from AUTHORISATION,
  -- never from the stamps' shape.
  --
  -- pg_trigger_depth() > 1 is item 2's documented bypass (00196:1590-1605): a
  -- client statement's own triggers run at depth 1, a trigger-driven UPDATE
  -- never does. Item 3's assignment and due-date write-back updates
  -- projects.rfis from an AFTER trigger on projects.work_items, in the SOURCE
  -- WRITER's session — where auth.uid() is a person, frequently a contractor
  -- with no right to re-date by hand — so without this the spine's own
  -- write-back would be refused by the ROUTE rule below, on the source edit.
  -- Not `auth.uid() IS NULL`: that would need the write-back to run under a
  -- definer that clears the claim.
  --
  -- A service close keeps the closer it was given (a backfill knows who closed
  -- the source record and there is no actor to invent) and any historical
  -- closed_at it was given; only a close with neither gets `now()`.
  IF v_actor IS NULL OR pg_trigger_depth() > 1 THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status = 'closed' THEN
        NEW.closed_at := COALESCE(NEW.closed_at, now());
      ELSE
        NEW.closed_at := NULL;
        NEW.closed_by := NULL;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- Authority is resolved against the row AS IT IS (OLD). The immutability
  -- check below means NEW carries the same project_id and raised_by or is a
  -- refused row, so there is no window in which a caller writes the columns
  -- that decide their own authority.
  v_role       := public.user_effective_project_role(OLD.project_id, v_actor);
  v_may_write  := COALESCE(v_role IN ('owner','admin','project_manager','contractor'), FALSE);
  v_may_govern := COALESCE(v_role IN ('owner','admin','project_manager'), FALSE);
  v_is_raiser  := COALESCE(v_actor = OLD.raised_by, FALSE);

  -- (a) FIXED COLUMNS. Where an RFI was raised, and by whom, decide who
  --     governs it and who may close it — so a row that can move carries its
  --     own authority with it. Proven on production before this migration: the
  --     rbac-test contractor moved RFI-4 to a project it holds no role on and
  --     made itself the raiser, in the same statement that closed it.
  --     created_at is here because it is what an SLA and every "days open"
  --     figure are measured from.
  IF NEW.project_id      IS DISTINCT FROM OLD.project_id
  OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
  OR NEW.raised_by       IS DISTINCT FROM OLD.raised_by
  OR NEW.created_at      IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'RFI-% cannot be moved to another project or organisation, or re-attributed to someone else — those details are fixed when it is raised.', OLD.rfi_number
      USING ERRCODE = 'raise_exception';
  END IF;

  -- (b) ROUTING AND CONTENT belong to the `rfi` write set — owner, admin,
  --     project manager, contractor (projects.work_item_types.write_roles for
  --     'rfi', 00196:239; the same four as MARKUP_WRITE_ROLES on this
  --     surface). §03 §1.8/§1.9: a write-role holder may assign and re-date.
  --     There is no UI for either today; this gate must not be the reason
  --     there never can be one.
  IF (NEW.subject     IS DISTINCT FROM OLD.subject
   OR NEW.description IS DISTINCT FROM OLD.description
   OR NEW.priority    IS DISTINCT FROM OLD.priority
   OR NEW.category    IS DISTINCT FROM OLD.category
   OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
   OR NEW.due_date    IS DISTINCT FROM OLD.due_date)
   AND NOT v_may_write THEN
    RAISE EXCEPTION 'Only the project team can change what RFI-% asks, who it is with, or when it is due.', OLD.rfi_number
      USING ERRCODE = 'raise_exception';
  END IF;

  -- (c) THE STATUS MACHINE. 'draft' is in the 00002:89-90 CHECK and no code
  --     path has ever written it (0 draft rows in production, measured
  --     2026-09-14) — `rfiService.create` hardcodes 'open'. It is reachable
  --     only forwards, never as somewhere to hide a live RFI. closed leaves
  --     only to open, so a closed RFI cannot be silently re-answered: the web
  --     detail page hides both the respond form and the Close button at
  --     'closed' (rfis/[id]/page.tsx:257,279) and mobile does the same, so no
  --     UI path reaches closed -> responded.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ( (OLD.status = 'draft'     AND NEW.status IN ('open','closed'))
          OR (OLD.status = 'open'      AND NEW.status IN ('responded','closed'))
          OR (OLD.status = 'responded' AND NEW.status IN ('open','closed'))
          OR (OLD.status = 'closed'    AND NEW.status = 'open') ) THEN
      RAISE EXCEPTION 'RFI-% cannot move from "%" to "%".', OLD.rfi_number, OLD.status, NEW.status
        USING ERRCODE = 'raise_exception';
    END IF;

    -- (c2) REOPENING is the project team's, or the raiser's — 00196 §12 (c2)
    --      ("the project team, or whoever signed it off"). The raiser is the
    --      RFI's gatekeeper after 00198, so the second arm is the same arm.
    IF OLD.status = 'closed' AND NOT (v_may_write OR v_is_raiser) THEN
      RAISE EXCEPTION 'Only the project team, or whoever raised RFI-%, can reopen it.', OLD.rfi_number
        USING ERRCODE = 'raise_exception';
    END IF;

    -- (d) ONLY THE RAISER, OR A GOVERNING ROLE, CLOSES. Compared against
    --     auth.uid(), never current_user. The governing arm is 00196 §12
    --     (b)+(d)'s "a governing actor takes the seat and closes in one
    --     statement", collapsed: projects.rfis has no gatekeeper column to
    --     take, and all six closed RFIs in production were closed by the org
    --     owner. THE WRITE SET IS NOT ENOUGH — `contractor` is in it, 12 of
    --     15 RFIs were raised by contractors, and "any contractor closes any
    --     RFI in the org" is the behaviour this whole migration exists to end.
    IF NEW.status = 'closed' AND NOT (v_is_raiser OR v_may_govern) THEN
      RAISE EXCEPTION 'Only the person who raised RFI-%, or the project''s owners, admins or project managers, can close it.', OLD.rfi_number
        USING ERRCODE = 'raise_exception';
    END IF;

    -- (e) THE CLOSER CANNOT BE FORGED. closeRfiAction and rfiService.close
    --     both send closed_by = the caller, so nothing legitimate is refused
    --     here; a direct PostgREST PATCH naming somebody else is. A NULL is
    --     accepted and filled in, so a caller that simply omits the column —
    --     as a UI that only flips the status would — is not punished for it.
    --     closed_at is stamped rather than checked: a backdated one is
    --     overwritten, not refused, because it is a stamp and not a claim
    --     about a person.
    IF NEW.status = 'closed' THEN
      IF NEW.closed_by IS NOT NULL AND NEW.closed_by IS DISTINCT FROM v_actor THEN
        RAISE EXCEPTION 'RFI-% records whoever closes it as the closer — you cannot close it in someone else''s name.', OLD.rfi_number
          USING ERRCODE = 'raise_exception';
      END IF;
      NEW.closed_at := now();
      NEW.closed_by := v_actor;
    ELSE
      NEW.closed_at := NULL;
      NEW.closed_by := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

-- A trigger function needs no GRANT: Postgres checks EXECUTE on it at
-- CREATE TRIGGER time, for the creator, never at fire time — so the trigger
-- fires for a contractor's UPDATE while the function stays uncallable by
-- anyone but the owner. Declared as two grant_absent: directives, which the
-- post-push verifier evaluates against production.
REVOKE ALL ON FUNCTION projects.rfis_write_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS rfis_write_guard_trg ON projects.rfis;
CREATE TRIGGER rfis_write_guard_trg
  BEFORE UPDATE ON projects.rfis
  FOR EACH ROW EXECUTE FUNCTION projects.rfis_write_guard();

-- ─── 3. The RESTRICTIVE gate ────────────────────────────────────────────────
-- USING fences the caller out of RFIs on projects they hold no role on — the
-- "any RFI in the org" half of the defect, which a BEFORE UPDATE guard alone
-- cannot see, because it only ever runs on rows RLS has already admitted.
-- WITH CHECK is the belt to the guard's braces: even with the trigger dropped,
-- a row could only ever land on a project the caller holds a role on.
DROP POLICY IF EXISTS rfis_update_gate ON projects.rfis;
CREATE POLICY rfis_update_gate ON projects.rfis
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING      (projects.user_can_update_rfi(project_id))
  WITH CHECK (projects.user_can_update_rfi(project_id));

-- Adding policies does not change the schema cache, but NOTIFY is harmless and
-- keeps parity with the project's migration conventions.
NOTIFY pgrst, 'reload schema';
