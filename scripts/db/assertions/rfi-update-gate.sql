-- Assertions for 00201: the RESTRICTIVE UPDATE gate and the BEFORE UPDATE
-- write guard on projects.rfis — who may answer, route, close and reopen an
-- RFI, which columns are fixed, and which stamps are the guard's.
-- Run inside the rolled-back transaction opened by try-rfi-update-gate.sh.
--
-- EVERY authorisation assertion runs AS A REAL AUTHENTICATED USER. Tested as
-- postgres, auth.uid() is NULL, the service-path exemption fires, RLS does not
-- apply at all, and the guard passes everything — the definition of a test that
-- cannot fail.
--
-- The rbac-test fixture (018f2d31-bbe8-4cc1-bbdd-63af0187081e — org-level
-- `contractor` on WM-Consulting, project `contractor` on (643) KINGSWALK;
-- never invite it, never email it) plays THREE parts, in this order:
--   * CONTRACTOR (1-9): in `rfi`'s write set (owner/admin/project_manager/
--     contractor, per projects.work_item_types) but not a governing role.
--     It may answer and route; it may close only what it raised.
--   * INSPECTOR (10-12): an effective role, but NOT in `rfi`'s write set.
--     It may answer; it may not route, and it may not close anything.
--   * PROJECT-SCOPED CLIENT_VIEWER (13): project_members.role flipped while
--     the ORG role stays `contractor`, so public.user_is_client_viewer() —
--     which reads only user_organisations — returns FALSE and 00161's
--     RESTRICTIVE block does NOT fire. This is the hole 00161 misses and the
--     reason this gate resolves the role with user_effective_project_role.
-- The project's governing actor (owner, resolved through
-- projects.resolve_project_pm) plays the fourth part (14-17).
--
-- ⚠ set_config(…, true) is TRANSACTION-local: after RESET ROLE, auth.uid()
-- still returns the last impersonated user, and the claim is re-set for each
-- actor. Every rfis row a postgres block seeds is therefore seeded BEFORE the
-- first SET LOCAL ROLE, and the one postgres block that must travel the
-- SERVICE PATH (auth.uid() NULL — the guard's exemption) clears the claim
-- first and proves auth.uid() reads NULL.
--
-- ⚠ Every id a role-scoped block needs is captured HERE, as postgres. Under
-- the demoted roles projects.projects and projects.project_members are
-- RLS-filtered, and a zero-row subquery would turn a SENTINEL into a false red.
--
-- The seeded rows carry subjects prefixed 'gate:' and are looked up by subject;
-- every one of them is rolled back with the transaction.

CREATE TEMP TABLE _t AS
SELECT pm.project_id,
       p.organisation_id,
       '018f2d31-bbe8-4cc1-bbdd-63af0187081e'::uuid AS actor_id,
       projects.resolve_project_pm(pm.project_id)   AS pm_id,
       -- A same-org project the actor holds NO effective role on (12 such
       -- exist, measured 2026-09-14). The RESTRICTIVE USING must fence the
       -- actor out of it entirely — that is the "any RFI in the org" half of
       -- the defect, and it is invisible to a guard that only sees rows RLS
       -- has already admitted.
       (SELECT p2.id FROM projects.projects p2
         WHERE p2.organisation_id = p.organisation_id
           AND p2.id <> pm.project_id
           AND public.user_effective_project_role(p2.id, pm.user_id) IS NULL
         ORDER BY p2.created_at, p2.id LIMIT 1) AS foreign_project_id
  FROM projects.project_members pm
  JOIN projects.projects p ON p.id = pm.project_id
 WHERE pm.user_id = '018f2d31-bbe8-4cc1-bbdd-63af0187081e' AND pm.is_active
 ORDER BY pm.created_at, pm.project_id
 LIMIT 1;
GRANT SELECT ON _t TO authenticated;

DO $$
DECLARE t record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _t) THEN
    RAISE EXCEPTION 'the rbac-test fixture has no active project membership; the RFI write gate cannot be exercised as a real user';
  END IF;
  SELECT * INTO t FROM _t;

  IF t.pm_id IS NULL THEN
    RAISE EXCEPTION 'resolve_project_pm(%) is NULL — the fixture project has nobody who can govern, and 14-17 have no actor', t.project_id;
  END IF;
  IF t.pm_id = t.actor_id THEN
    RAISE EXCEPTION 'the fixture actor IS the project PM; "a contractor may not close what it did not raise" cannot fail';
  END IF;
  IF t.foreign_project_id IS NULL THEN
    RAISE EXCEPTION 'no same-org project the fixture holds no role on; assertion 9 (the cross-project fence) has no target';
  END IF;

  -- The premises every later block rests on, asserted rather than assumed.
  IF public.user_effective_project_role(t.project_id, t.actor_id) IS DISTINCT FROM 'contractor' THEN
    RAISE EXCEPTION 'the rbac-test fixture''s effective role on % is % rather than contractor; 1-9 would prove something else',
      t.project_id, COALESCE(public.user_effective_project_role(t.project_id, t.actor_id), '<null>');
  END IF;
  IF NOT COALESCE(public.user_effective_project_role(t.project_id, t.pm_id) IN ('owner','admin','project_manager'), FALSE) THEN
    RAISE EXCEPTION 'the resolved PM''s effective role on % is %, not a governing role; 14-17 would pass for the wrong reason',
      t.project_id, COALESCE(public.user_effective_project_role(t.project_id, t.pm_id), '<null>');
  END IF;
  -- The org role must NOT be client_viewer, or assertion 13's whole point —
  -- that 00161 does not fire on a project-scoped viewer — evaporates.
  IF EXISTS (SELECT 1 FROM public.user_organisations uo
              WHERE uo.user_id = t.actor_id AND uo.is_active AND uo.role = 'client_viewer') THEN
    RAISE EXCEPTION 'the fixture is an ORG-level client_viewer; 00161 would fire in assertion 13 and this file would credit the new gate with 00161''s block';
  END IF;
  -- contractor must be in rfi's write set and inspector must not, or the
  -- routing assertions (4, 11) prove nothing about the write set.
  IF NOT EXISTS (SELECT 1 FROM projects.work_item_types wt
                  WHERE wt.key = 'rfi' AND 'contractor' = ANY (wt.write_roles)) THEN
    RAISE EXCEPTION 'contractor is not in the rfi write set in projects.work_item_types; assertion 4 would pass for the wrong reason';
  END IF;
  IF EXISTS (SELECT 1 FROM projects.work_item_types wt
              WHERE wt.key = 'rfi' AND 'inspector' = ANY (wt.write_roles)) THEN
    RAISE EXCEPTION 'inspector holds the rfi write role in projects.work_item_types; assertion 11 could never fail';
  END IF;

  -- ── Subjects. Seeded as postgres, before any impersonation. ──────────────
  -- A: raised by the PM, open. The contractor may route it and may answer it;
  --    it may not close it. The PM closes it in 15.
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description, raised_by, status)
  VALUES (t.project_id, t.organisation_id, 'gate: raised by the PM', 'assertion subject', t.pm_id, 'open');
  -- B: raised by the ACTOR, open. The raiser closes it in 5.
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description, raised_by, status)
  VALUES (t.project_id, t.organisation_id, 'gate: raised by the actor', 'assertion subject', t.actor_id, 'open');
  -- C: raised by the ACTOR, open. The forged closer (6) and the raiser's
  --    reopen (7) both run against this one.
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description, raised_by, status)
  VALUES (t.project_id, t.organisation_id, 'gate: forged closer', 'assertion subject', t.actor_id, 'open');
  -- D: raised by the PM, open. The answer path (3 as contractor, 10 as
  --    inspector) — answering is not governance.
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description, raised_by, status)
  VALUES (t.project_id, t.organisation_id, 'gate: answer path', 'assertion subject', t.pm_id, 'open');
  -- E: on the FOREIGN project, raised by the PM, open. Visible to the
  --    contractor (00034's SELECT policy is org-wide for a non-viewer) and
  --    therefore exactly the row the old USING admitted.
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description, raised_by, status)
  VALUES (t.foreign_project_id, t.organisation_id, 'gate: foreign project', 'assertion subject', t.pm_id, 'open');
  -- F: raised by the PM, open. The service path (18) closes it with a
  --    historical closed_at and a supplied closed_by.
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description, raised_by, status)
  VALUES (t.project_id, t.organisation_id, 'gate: service path', 'assertion subject', t.pm_id, 'open');
  -- G: raised by the PM, open. The stamp-restore control (8) runs against it.
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description, raised_by, status)
  VALUES (t.project_id, t.organisation_id, 'gate: stamps and dates', 'assertion subject', t.pm_id, 'open');
  -- H and I: ALREADY CLOSED, raised and closed by the PM. Reopening is the
  --    write set's or the raiser's (00196 §12 (c2)), which is a different
  --    sentence from closing — H proves the write-set arm reaches it (7c) and
  --    I proves a role outside the write set does not (12b). Two rows, because
  --    reopening H consumes it.
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description, raised_by, status, closed_at, closed_by)
  VALUES (t.project_id, t.organisation_id, 'gate: reopen by write role', 'assertion subject', t.pm_id, 'closed', now(), t.pm_id);
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description, raised_by, status, closed_at, closed_by)
  VALUES (t.project_id, t.organisation_id, 'gate: reopen refused', 'assertion subject', t.pm_id, 'closed', now(), t.pm_id);
END $$;

-- ── The trigger-depth probe (12c) ───────────────────────────────────────────
-- Item 3's assignment and due-date write-back updates projects.rfis from an
-- AFTER trigger on projects.work_items, in the SOURCE WRITER's session, where
-- auth.uid() is a person who frequently may not re-date by hand. The guard's
-- `pg_trigger_depth() > 1` exemption is what lets that through, and until
-- 00198 exists nothing in the repo would exercise it — the shape of deferred
-- mutation this codebase has been bitten by before. This stand-in reproduces
-- the depth exactly: an AFTER INSERT trigger (depth 1) whose body UPDATEs
-- projects.rfis (its triggers therefore fire at depth 2). SECURITY INVOKER, so
-- RLS and the guard both see the impersonated caller.
CREATE TEMP TABLE _depth_probe (rfi_id uuid, new_due date);
CREATE FUNCTION pg_temp.rfi_depth_probe() RETURNS trigger LANGUAGE plpgsql AS $probe$
BEGIN
  UPDATE projects.rfis SET due_date = NEW.new_due WHERE id = NEW.rfi_id;
  RETURN NEW;
END;
$probe$;
CREATE TRIGGER rfi_depth_probe_trg AFTER INSERT ON _depth_probe
  FOR EACH ROW EXECUTE FUNCTION pg_temp.rfi_depth_probe();
GRANT INSERT, SELECT ON _depth_probe TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- PART 1 — the CONTRACTOR: in rfi's write set, governs nothing.
-- ───────────────────────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT actor_id FROM _t), 'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE t record;
        v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_e uuid; v_g uuid; v_h uuid;
        v_status text; v_by uuid; v_at timestamptz; v_due date; v_proj uuid;
BEGIN
  BEGIN
    PERFORM 1 FROM _t;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'fixture _t is unreadable as authenticated — add GRANT SELECT ON _t TO authenticated';
  END;
  SELECT * INTO t FROM _t;
  IF auth.uid() IS DISTINCT FROM t.actor_id THEN
    RAISE EXCEPTION 'impersonation did not take: auth.uid() is %', auth.uid();
  END IF;

  SELECT id INTO v_a FROM projects.rfis WHERE subject = 'gate: raised by the PM';
  SELECT id INTO v_b FROM projects.rfis WHERE subject = 'gate: raised by the actor';
  SELECT id INTO v_c FROM projects.rfis WHERE subject = 'gate: forged closer';
  SELECT id INTO v_d FROM projects.rfis WHERE subject = 'gate: answer path';
  SELECT id INTO v_e FROM projects.rfis WHERE subject = 'gate: foreign project';
  SELECT id INTO v_g FROM projects.rfis WHERE subject = 'gate: stamps and dates';
  SELECT id INTO v_h FROM projects.rfis WHERE subject = 'gate: reopen by write role';
  IF v_a IS NULL OR v_b IS NULL OR v_c IS NULL OR v_d IS NULL OR v_g IS NULL OR v_h IS NULL THEN
    RAISE EXCEPTION 'the contractor cannot see the seeded subjects on its own project; 00034''s SELECT policy is not what this file assumes';
  END IF;
  -- The cross-project row must be VISIBLE and (after this migration) not
  -- writable. If it were invisible, assertion 9 would pass on a read gate and
  -- say nothing about the write gate.
  IF v_e IS NULL THEN
    RAISE EXCEPTION 'the contractor cannot SEE the foreign-project RFI; assertion 9 would prove a read gate, not the new write gate';
  END IF;

  -- 1. A CONTRACTOR MAY NOT CLOSE AN RFI IT DID NOT RAISE. This is the rule
  --    that ends "any org member closes any RFI in the org". Assert on the
  --    MESSAGE: a bare "it raised" handler passes whenever the statement
  --    failed for any reason at all.
  BEGIN
    UPDATE projects.rfis SET status = 'closed' WHERE id = v_a;
    RAISE EXCEPTION 'SENTINEL: a contractor closed an RFI raised by the project manager';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%can close it%' THEN
      RAISE EXCEPTION 'the close attempt failed for the wrong reason: %', SQLERRM; END IF;
  END;

  -- 2. Nor by moving it somewhere else first. project_id, organisation_id,
  --    raised_by and created_at are fixed when the RFI is raised — a move
  --    would otherwise carry the row out of the project whose roles govern it,
  --    and a raised_by rewrite would hand the closer's seat to anyone.
  BEGIN
    UPDATE projects.rfis SET project_id = t.foreign_project_id WHERE id = v_a;
    RAISE EXCEPTION 'SENTINEL: a contractor moved an RFI to another project';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%fixed when it is raised%' THEN
      RAISE EXCEPTION 'the project move failed for the wrong reason: %', SQLERRM; END IF;
  END;
  BEGIN
    UPDATE projects.rfis SET raised_by = auth.uid() WHERE id = v_a;
    RAISE EXCEPTION 'SENTINEL: a contractor made itself the raiser of somebody else''s RFI';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%fixed when it is raised%' THEN
      RAISE EXCEPTION 'the raiser rewrite failed for the wrong reason: %', SQLERRM; END IF;
  END;

  -- 3. POSITIVE — answering is not governance. The respond path
  --    (respondToRfiAction / rfiService.respond) flips status to 'responded'
  --    for whoever wrote the answer, and it must keep working.
  UPDATE projects.rfis SET status = 'responded' WHERE id = v_d;
  IF NOT FOUND THEN RAISE EXCEPTION 'the open -> responded flip matched no row under RLS'; END IF;
  SELECT status, closed_at, closed_by INTO v_status, v_at, v_by FROM projects.rfis WHERE id = v_d;
  IF v_status <> 'responded' THEN RAISE EXCEPTION 'the answer did not take: status is %', v_status; END IF;
  IF v_at IS NOT NULL OR v_by IS NOT NULL THEN
    RAISE EXCEPTION 'answering stamped a closer: closed_at=% closed_by=%', v_at, v_by; END IF;

  -- 4. POSITIVE — a write-role holder may route and re-date (§03 §1.8/§1.9).
  --    There is no UI for this today; the gate must not be the reason there
  --    never can be.
  UPDATE projects.rfis SET due_date = CURRENT_DATE + 14, assigned_to = t.pm_id WHERE id = v_a;
  IF NOT FOUND THEN RAISE EXCEPTION 'the contractor''s re-date matched no row under RLS'; END IF;
  SELECT due_date INTO v_due FROM projects.rfis WHERE id = v_a;
  IF v_due <> CURRENT_DATE + 14 THEN RAISE EXCEPTION 'the re-date did not take: due_date is %', v_due; END IF;

  -- 5. POSITIVE — THE RAISER CLOSES. After 00198 the RFI work item's
  --    gatekeeper is its creator, and the creator of a mirrored RFI item is
  --    raised_by; this is the same sentence on the source table.
  UPDATE projects.rfis SET status = 'closed' WHERE id = v_b;
  IF NOT FOUND THEN RAISE EXCEPTION 'the raiser''s close matched no row under RLS'; END IF;
  SELECT status, closed_at, closed_by INTO v_status, v_at, v_by FROM projects.rfis WHERE id = v_b;
  IF v_status <> 'closed' THEN RAISE EXCEPTION 'the raiser''s close did not take: status is %', v_status; END IF;
  IF v_at IS NULL THEN RAISE EXCEPTION 'the close did not stamp closed_at'; END IF;
  IF v_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'the close recorded % as the closer rather than the caller %', v_by, auth.uid(); END IF;

  -- 6. A CLOSER CANNOT BE FORGED. closeRfiAction and rfiService.close both
  --    send closed_by = the caller, so nothing legitimate is refused here;
  --    a direct PostgREST PATCH naming somebody else is.
  BEGIN
    UPDATE projects.rfis SET status = 'closed', closed_by = t.pm_id WHERE id = v_c;
    RAISE EXCEPTION 'SENTINEL: a contractor closed an RFI in the project manager''s name';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%in someone else%' THEN
      RAISE EXCEPTION 'the forged close failed for the wrong reason: %', SQLERRM; END IF;
  END;
  -- ...and a backdated closed_at is overwritten by the guard's own stamp
  -- rather than honoured: 400 days of ageing is what a real close would need
  -- to look historical.
  UPDATE projects.rfis
     SET status = 'closed', closed_at = now() - interval '400 days', closed_by = auth.uid()
   WHERE id = v_c;
  IF NOT FOUND THEN RAISE EXCEPTION 'the raiser''s close of the forged-closer subject matched no row'; END IF;
  SELECT closed_at, closed_by INTO v_at, v_by FROM projects.rfis WHERE id = v_c;
  IF v_at < now() - interval '1 hour' THEN
    RAISE EXCEPTION 'the caller backdated closed_at to %', v_at; END IF;
  IF v_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'closed_by is % rather than the caller', v_by; END IF;

  -- 7. POSITIVE — the raiser reopens what it closed, and the stamps are
  --    cleared with the status. closed -> open is the only legal way out of
  --    closed; every other move from closed is refused (7b).
  UPDATE projects.rfis SET status = 'open' WHERE id = v_c;
  IF NOT FOUND THEN RAISE EXCEPTION 'the raiser''s reopen matched no row under RLS'; END IF;
  SELECT status, closed_at, closed_by INTO v_status, v_at, v_by FROM projects.rfis WHERE id = v_c;
  IF v_status <> 'open' THEN RAISE EXCEPTION 'the reopen did not take: status is %', v_status; END IF;
  IF v_at IS NOT NULL OR v_by IS NOT NULL THEN
    RAISE EXCEPTION 'the reopen left a closer behind: closed_at=% closed_by=%', v_at, v_by; END IF;

  -- 7b. The status machine refuses what the module has no path for. 'draft' is
  --     in the 00002 CHECK and no code path ever writes it; an RFI that has
  --     been asked cannot become a draft again.
  BEGIN
    UPDATE projects.rfis SET status = 'draft' WHERE id = v_c;
    RAISE EXCEPTION 'SENTINEL: an open RFI was pushed back to draft';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%cannot move from%' THEN
      RAISE EXCEPTION 'the illegal transition failed for the wrong reason: %', SQLERRM; END IF;
  END;

  -- 7c. POSITIVE — a write-role holder reopens an RFI it did not raise and
  --     did not close. Reopening is the project team's (00196 §12 (c2)); it is
  --     deliberately a WIDER set than closing, and asserting it here is what
  --     stops a later edit from collapsing the two rules into one.
  UPDATE projects.rfis SET status = 'open' WHERE id = v_h;
  IF NOT FOUND THEN RAISE EXCEPTION 'the contractor''s reopen matched no row under RLS'; END IF;
  SELECT status, closed_at, closed_by INTO v_status, v_at, v_by FROM projects.rfis WHERE id = v_h;
  IF v_status <> 'open' THEN RAISE EXCEPTION 'the write-role reopen did not take: status is %', v_status; END IF;
  IF v_at IS NOT NULL OR v_by IS NOT NULL THEN
    RAISE EXCEPTION 'the reopen left the previous closer behind: closed_at=% closed_by=%', v_at, v_by; END IF;

  -- 8. The stamps are the guard's on EVERY path: a save that does not change
  --    status cannot smuggle a closed_at or a closed_by onto a live RFI.
  --    Restored, not refused — a full-row PATCH that happens to echo the
  --    columns back must not become an error.
  UPDATE projects.rfis SET closed_at = now(), closed_by = auth.uid(), priority = 'high' WHERE id = v_g;
  IF NOT FOUND THEN RAISE EXCEPTION 'the stamp-smuggle UPDATE matched no row under RLS'; END IF;
  SELECT status, closed_at, closed_by INTO v_status, v_at, v_by FROM projects.rfis WHERE id = v_g;
  IF v_status <> 'open' THEN RAISE EXCEPTION 'the smuggle changed the status to %', v_status; END IF;
  IF v_at IS NOT NULL OR v_by IS NOT NULL THEN
    RAISE EXCEPTION 'a save with no status change smuggled a closer in: closed_at=% closed_by=%', v_at, v_by; END IF;

  -- 9. THE CROSS-PROJECT FENCE. The contractor can SEE this RFI (00034's
  --    SELECT policy is org-wide for a non-viewer) and, before this
  --    migration, could close it, move it and re-date it. The RESTRICTIVE
  --    USING now matches no row — RLS is silent, so this is asserted with
  --    FOUND and by reading the row back, never by expecting an error.
  --    The guard is NOT allowed to be what saves this: if the policy admits
  --    the row and only the trigger refuses it, the fence has failed and the
  --    layers are named separately so a kill is unambiguous.
  BEGIN
    UPDATE projects.rfis SET status = 'closed', due_date = CURRENT_DATE + 3650 WHERE id = v_e;
    IF FOUND THEN
      RAISE EXCEPTION 'SENTINEL: a contractor updated an RFI on a project it holds no role on';
    END IF;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    RAISE EXCEPTION 'the RESTRICTIVE USING admitted a foreign-project row and only the guard refused it (%); the policy is the fence, the guard is not', SQLERRM;
  END;
  SELECT status, project_id INTO v_status, v_proj FROM projects.rfis WHERE id = v_e;
  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'the foreign-project RFI changed status to % despite the UPDATE matching no row', v_status; END IF;

  RAISE NOTICE 'rfi-update-gate (contractor): 1-9 passed';
END $$;

RESET ROLE;

-- ───────────────────────────────────────────────────────────────────────────
-- PART 2 — the INSPECTOR: an effective role, but not in rfi's write set.
-- Runs as postgres; auth.uid() still names the actor (the claim is
-- transaction-local), which is harmless — no rfis row is written here.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t record;
BEGIN
  SELECT * INTO t FROM _t;
  UPDATE projects.project_members SET role = 'inspector'
   WHERE project_id = t.project_id AND user_id = t.actor_id;
  IF public.user_effective_project_role(t.project_id, t.actor_id) IS DISTINCT FROM 'inspector' THEN
    RAISE EXCEPTION 'the demotion to inspector did not take (effective role is %); the org role must not be owner/admin/project_manager',
      COALESCE(public.user_effective_project_role(t.project_id, t.actor_id), '<null>');
  END IF;
END $$;

SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT actor_id FROM _t), 'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE t record; v_a uuid; v_d uuid; v_i uuid; v_status text; v_due date; v_due_after date;
BEGIN
  SELECT * INTO t FROM _t;
  IF auth.uid() IS DISTINCT FROM t.actor_id THEN
    RAISE EXCEPTION 'impersonation did not take: auth.uid() is %', auth.uid();
  END IF;
  SELECT id INTO v_a FROM projects.rfis WHERE subject = 'gate: raised by the PM';
  SELECT id INTO v_d FROM projects.rfis WHERE subject = 'gate: answer path';
  SELECT id INTO v_i FROM projects.rfis WHERE subject = 'gate: reopen refused';
  IF v_a IS NULL OR v_d IS NULL OR v_i IS NULL THEN
    RAISE EXCEPTION 'the inspector cannot see the seeded subjects; the SELECT policy is not what this file assumes';
  END IF;

  -- 10. POSITIVE — an inspector may still ANSWER. inspector and supplier are
  --     not in rfi's write set, but projects.rfi_responses admits any
  --     non-client_viewer org member, so the status flip that accompanies
  --     their answer must not be the thing that fails. (D is 'responded'
  --     from assertion 3; take it back to open first, which is the same
  --     non-governing arm.)
  UPDATE projects.rfis SET status = 'open' WHERE id = v_d;
  IF NOT FOUND THEN RAISE EXCEPTION 'the inspector''s responded -> open flip matched no row under RLS'; END IF;
  UPDATE projects.rfis SET status = 'responded' WHERE id = v_d;
  IF NOT FOUND THEN RAISE EXCEPTION 'the inspector''s open -> responded flip matched no row under RLS'; END IF;
  SELECT status INTO v_status FROM projects.rfis WHERE id = v_d;
  IF v_status <> 'responded' THEN RAISE EXCEPTION 'the inspector''s answer did not take: status is %', v_status; END IF;

  -- 11. ...but may NOT route or re-date it. This is what distinguishes the
  --     write set from the floor; without it assertion 4 would only be
  --     asserting that somebody with a role can write.
  SELECT due_date INTO v_due FROM projects.rfis WHERE id = v_a;
  BEGIN
    UPDATE projects.rfis SET due_date = CURRENT_DATE + 3650 WHERE id = v_a;
    RAISE EXCEPTION 'SENTINEL: an inspector re-dated an RFI';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%Only the project team%' THEN
      RAISE EXCEPTION 'the inspector''s re-date failed for the wrong reason: %', SQLERRM; END IF;
  END;
  BEGIN
    UPDATE projects.rfis SET assigned_to = auth.uid() WHERE id = v_a;
    RAISE EXCEPTION 'SENTINEL: an inspector assigned an RFI to itself';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%Only the project team%' THEN
      RAISE EXCEPTION 'the inspector''s self-assignment failed for the wrong reason: %', SQLERRM; END IF;
  END;
  SELECT due_date INTO v_due_after FROM projects.rfis WHERE id = v_a;
  IF v_due_after IS DISTINCT FROM v_due THEN
    RAISE EXCEPTION 'the refused re-date changed due_date from % to % anyway', v_due, v_due_after; END IF;

  -- 12. ...and may not close it either. Not being in the write set is not the
  --     reason: the closer's seat is the raiser's or a governing role's, and
  --     an inspector is neither.
  BEGIN
    UPDATE projects.rfis SET status = 'closed' WHERE id = v_a;
    RAISE EXCEPTION 'SENTINEL: an inspector closed an RFI';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%can close it%' THEN
      RAISE EXCEPTION 'the inspector''s close failed for the wrong reason: %', SQLERRM; END IF;
  END;

  -- 12b. ...nor reopen one. The reopen sentence is its own, so a collapse of
  --      the reopen rule into the close rule (or vice versa) reads here as a
  --      wrong reason rather than as a pass.
  BEGIN
    UPDATE projects.rfis SET status = 'open' WHERE id = v_i;
    RAISE EXCEPTION 'SENTINEL: an inspector reopened a closed RFI';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%can reopen it%' THEN
      RAISE EXCEPTION 'the inspector''s reopen failed for the wrong reason: %', SQLERRM; END IF;
  END;

  -- 12c. POSITIVE — a TRIGGER-DRIVEN re-date goes through, for the same actor
  --      whose direct re-date was just refused by 11. This is item 3's
  --      assignment/due-date write-back, reproduced at the depth it will run
  --      at. Without the guard's pg_trigger_depth() > 1 exemption every
  --      mirrored RFI edit would raise on the SOURCE write, in the source
  --      writer's session — F8 of the item-3 plan, on the other side of the
  --      mirror.
  BEGIN
    INSERT INTO _depth_probe (rfi_id, new_due) VALUES (v_a, CURRENT_DATE + 99);
  EXCEPTION WHEN raise_exception THEN
    RAISE EXCEPTION 'a trigger-driven re-date was refused (%); the guard''s pg_trigger_depth() > 1 exemption is gone and item 3''s write-back would raise on every source edit', SQLERRM;
  END;
  SELECT due_date INTO v_due_after FROM projects.rfis WHERE id = v_a;
  IF v_due_after IS DISTINCT FROM CURRENT_DATE + 99 THEN
    RAISE EXCEPTION 'the trigger-driven re-date did not take (due_date is %); item 3''s write-back would be refused on the source edit', v_due_after;
  END IF;

  RAISE NOTICE 'rfi-update-gate (inspector): 10-12c passed';
END $$;

RESET ROLE;

-- ───────────────────────────────────────────────────────────────────────────
-- PART 3 — the PROJECT-SCOPED CLIENT_VIEWER. The hole 00161 misses.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t record;
BEGIN
  SELECT * INTO t FROM _t;
  UPDATE projects.project_members SET role = 'client_viewer'
   WHERE project_id = t.project_id AND user_id = t.actor_id;
  IF public.user_effective_project_role(t.project_id, t.actor_id) IS DISTINCT FROM 'client_viewer' THEN
    RAISE EXCEPTION 'the demotion to client_viewer did not take: effective role is %',
      COALESCE(public.user_effective_project_role(t.project_id, t.actor_id), '<null>');
  END IF;
END $$;

SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT actor_id FROM _t), 'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE t record; v_a uuid; v_status text; v_prio text;
BEGIN
  SELECT * INTO t FROM _t;
  IF auth.uid() IS DISTINCT FROM t.actor_id THEN
    RAISE EXCEPTION 'impersonation did not take: auth.uid() is %', auth.uid();
  END IF;

  -- The premise: 00161's RESTRICTIVE block reads public.user_is_client_viewer,
  -- which looks ONLY at user_organisations. This actor's ORG role is still
  -- contractor, so 00161 lets the write through and anything refused below is
  -- refused by THIS migration. Without this check the assertion would silently
  -- credit 00161 and could never fail.
  IF public.user_is_client_viewer(t.organisation_id) THEN
    RAISE EXCEPTION '00161''s block fires for this actor; assertion 13 would credit 00161 rather than the new gate';
  END IF;

  SELECT id INTO v_a FROM projects.rfis WHERE subject = 'gate: raised by the PM';
  IF v_a IS NULL THEN
    RAISE EXCEPTION 'the project-scoped client_viewer cannot see the subject; 00034 scopes its reads to its own projects and this is one of them';
  END IF;

  -- 13. A project-scoped client viewer writes nothing. RLS is silent, so this
  --     is asserted with FOUND and by reading the row back.
  BEGIN
    UPDATE projects.rfis SET status = 'closed', priority = 'critical' WHERE id = v_a;
    IF FOUND THEN
      RAISE EXCEPTION 'SENTINEL: a project-scoped client_viewer updated an RFI — 00161 does not see it and this gate must';
    END IF;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    RAISE EXCEPTION 'the floor admitted a project-scoped client_viewer and only the guard refused it (%); user_can_update_rfi must exclude the role, not lean on the column rules', SQLERRM;
  END;
  SELECT status, priority INTO v_status, v_prio FROM projects.rfis WHERE id = v_a;
  IF v_status = 'closed' OR v_prio = 'critical' THEN
    RAISE EXCEPTION 'the row changed despite the UPDATE matching no row: status=% priority=%', v_status, v_prio; END IF;

  RAISE NOTICE 'rfi-update-gate (project-scoped client_viewer): 13 passed';
END $$;

RESET ROLE;

-- ───────────────────────────────────────────────────────────────────────────
-- PART 4 — the GOVERNING actor (owner / admin / project_manager).
-- ───────────────────────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT pm_id FROM _t), 'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE t record; v_a uuid; v_c uuid; v_status text; v_due date; v_by uuid; v_at timestamptz;
BEGIN
  SELECT * INTO t FROM _t;
  IF auth.uid() IS DISTINCT FROM t.pm_id THEN
    RAISE EXCEPTION 'impersonation did not take: auth.uid() is %', auth.uid();
  END IF;

  SELECT id INTO v_a FROM projects.rfis WHERE subject = 'gate: raised by the PM';
  SELECT id INTO v_c FROM projects.rfis WHERE subject = 'gate: forged closer';
  IF v_a IS NULL OR v_c IS NULL THEN
    RAISE EXCEPTION 'the governing actor cannot see the seeded subjects';
  END IF;

  -- 14. POSITIVE — a project manager re-dates. This is the one the module
  --     will need first: a due date that can be moved by whoever runs the job.
  UPDATE projects.rfis SET due_date = CURRENT_DATE + 21 WHERE id = v_a;
  IF NOT FOUND THEN RAISE EXCEPTION 'the PM''s re-date matched no row under RLS'; END IF;
  SELECT due_date INTO v_due FROM projects.rfis WHERE id = v_a;
  IF v_due <> CURRENT_DATE + 21 THEN RAISE EXCEPTION 'the PM''s re-date did not take: due_date is %', v_due; END IF;

  -- 15. POSITIVE — a governing actor closes an RFI it did not raise. In
  --     production all six closed RFIs were closed by the org owner, four of
  --     them raised by a contractor; that path must survive this migration.
  --     (It IS the raiser of A, so close C instead — raised by the actor of
  --     part 1 and reopened in assertion 7.)
  UPDATE projects.rfis SET status = 'closed' WHERE id = v_c;
  IF NOT FOUND THEN RAISE EXCEPTION 'the governing close matched no row under RLS'; END IF;
  SELECT status, closed_by, closed_at INTO v_status, v_by, v_at FROM projects.rfis WHERE id = v_c;
  IF v_status <> 'closed' THEN RAISE EXCEPTION 'the governing close did not take: status is %', v_status; END IF;
  IF v_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'the governing close recorded % as the closer rather than %', v_by, auth.uid(); END IF;
  IF v_at IS NULL THEN RAISE EXCEPTION 'the governing close did not stamp closed_at'; END IF;

  -- 16. POSITIVE — and reopens it.
  UPDATE projects.rfis SET status = 'open' WHERE id = v_c;
  IF NOT FOUND THEN RAISE EXCEPTION 'the governing reopen matched no row under RLS'; END IF;
  SELECT status INTO v_status FROM projects.rfis WHERE id = v_c;
  IF v_status <> 'open' THEN RAISE EXCEPTION 'the governing reopen did not take: status is %', v_status; END IF;

  -- 17. Governance is not a licence to move the record. The immutables hold
  --     for every role, including the one that governs the project.
  BEGIN
    UPDATE projects.rfis SET organisation_id = gen_random_uuid() WHERE id = v_a;
    RAISE EXCEPTION 'SENTINEL: a project manager moved an RFI to another organisation';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%fixed when it is raised%' THEN
      RAISE EXCEPTION 'the org move failed for the wrong reason: %', SQLERRM; END IF;
  END;

  RAISE NOTICE 'rfi-update-gate (governing actor): 14-17 passed';
END $$;

RESET ROLE;

-- ───────────────────────────────────────────────────────────────────────────
-- PART 5 — the SERVICE PATH. auth.uid() IS NULL: migrations, the service
-- client, and 00198's backfill. The action layer gates these.
-- ───────────────────────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '', true);

DO $$
DECLARE t record; v_f uuid; v_status text; v_by uuid; v_at timestamptz;
BEGIN
  -- Production's auth.uid() reads request.jwt.claim.sub first, then
  -- request.jwt.claims->>'sub'. This file never sets the first (missing_ok
  -- reads NULL) and has just cleared the second to '', and nullif('','') is
  -- NULL — so both arms read NULL and the exemption is genuinely under test.
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'the claim did not clear: auth.uid() is % — the service-path exemption is not being exercised', auth.uid();
  END IF;
  SELECT * INTO t FROM _t;
  SELECT id INTO v_f FROM projects.rfis WHERE subject = 'gate: service path';
  IF v_f IS NULL THEN RAISE EXCEPTION 'the service-path subject was not seeded'; END IF;

  -- 18. A service close keeps the closer it was given — a backfill knows who
  --     closed the source record and there is no actor to invent — and the
  --     historical closed_at it was given survives. 00198's backfill is the
  --     caller this exists for.
  UPDATE projects.rfis
     SET status = 'closed', closed_at = now() - interval '300 days', closed_by = t.pm_id
   WHERE id = v_f;
  IF NOT FOUND THEN RAISE EXCEPTION 'the service-path close matched no row'; END IF;
  SELECT status, closed_by, closed_at INTO v_status, v_by, v_at FROM projects.rfis WHERE id = v_f;
  IF v_status <> 'closed' THEN RAISE EXCEPTION 'the service-path close did not take: status is %', v_status; END IF;
  IF v_by IS DISTINCT FROM t.pm_id THEN
    RAISE EXCEPTION 'the service path overwrote the supplied closer with %', v_by; END IF;
  IF v_at > now() - interval '299 days' THEN
    RAISE EXCEPTION 'the service path overwrote the supplied historical closed_at with %', v_at; END IF;

  -- 19. The service path still owns the stamps on a REOPEN: a row that leaves
  --     'closed' cannot keep a closer, whoever is driving.
  UPDATE projects.rfis SET status = 'open' WHERE id = v_f;
  SELECT closed_at, closed_by INTO v_at, v_by FROM projects.rfis WHERE id = v_f;
  IF v_at IS NOT NULL OR v_by IS NOT NULL THEN
    RAISE EXCEPTION 'a service-path reopen left a closer behind: closed_at=% closed_by=%', v_at, v_by; END IF;

  RAISE NOTICE 'rfi-update-gate (service path): 18-19 passed';
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- PART 6 — the static shape, LAST, so that a run against a migration without
-- the guard fails on assertion 1's SENTINEL — today's production behaviour —
-- and not on "the function does not exist".
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_tgtype smallint; v_qual text; v_check text; v_perm text;
BEGIN
  -- 20. The helper exists, is SECURITY DEFINER with row_security off (or a
  --     caller's own RLS on project_members could hide the row that decides
  --     their role), and anon holds no EXECUTE — checked with
  --     has_function_privilege, never by reading proacl, because a NULL
  --     proacl looks empty but IS the PUBLIC grant.
  IF to_regprocedure('projects.user_can_update_rfi(uuid)') IS NULL THEN
    RAISE EXCEPTION 'projects.user_can_update_rfi(uuid) does not exist';
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'projects' AND p.proname = 'user_can_update_rfi') THEN
    RAISE EXCEPTION 'projects.user_can_update_rfi is not SECURITY DEFINER';
  END IF;
  IF NOT (SELECT 'row_security=off' = ANY (p.proconfig) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'projects' AND p.proname = 'user_can_update_rfi') THEN
    RAISE EXCEPTION 'projects.user_can_update_rfi does not SET row_security TO off';
  END IF;
  IF has_function_privilege('anon', 'projects.user_can_update_rfi(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon holds EXECUTE on user_can_update_rfi(uuid); the @verify grant_absent directive would block every later deploy';
  END IF;
  IF NOT has_function_privilege('authenticated', 'projects.user_can_update_rfi(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated does NOT hold EXECUTE on user_can_update_rfi(uuid); every UPDATE would fail with "permission denied for function"';
  END IF;

  -- 21. The guard exists, anon and authenticated hold no EXECUTE (a trigger
  --     function needs none: Postgres checks EXECUTE at CREATE TRIGGER time,
  --     for the creator, never at fire time), and it never reads current_user
  --     — comments stripped first, because the body's own comments say the
  --     words and prosrc carries them.
  IF to_regprocedure('projects.rfis_write_guard()') IS NULL THEN
    RAISE EXCEPTION 'projects.rfis_write_guard() does not exist';
  END IF;
  IF has_function_privilege('anon', 'projects.rfis_write_guard()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon holds EXECUTE on rfis_write_guard(); the @verify grant_absent directive would block every later deploy';
  END IF;
  IF has_function_privilege('authenticated', 'projects.rfis_write_guard()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated holds EXECUTE on rfis_write_guard(); a trigger function needs no grant';
  END IF;
  IF regexp_replace(
       (SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'projects' AND p.proname = 'rfis_write_guard'),
       '--[^\n]*', '', 'g') ILIKE '%current_user%'
  THEN RAISE EXCEPTION 'rfis_write_guard references current_user in code — a rule about people cannot be written in terms of a role, in any security context'; END IF;

  -- 22. The trigger is BEFORE UPDATE FOR EACH ROW and nothing else. An INSERT
  --     arm would fire on every seeded subject above, as the table owner.
  SELECT tg.tgtype INTO v_tgtype FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'projects' AND c.relname = 'rfis' AND tg.tgname = 'rfis_write_guard_trg';
  IF v_tgtype IS NULL THEN RAISE EXCEPTION 'rfis_write_guard_trg is missing'; END IF;
  -- tgtype bits: 1 = ROW, 2 = BEFORE, 4 = INSERT, 8 = DELETE, 16 = UPDATE.
  IF v_tgtype <> (1 | 2 | 16) THEN
    RAISE EXCEPTION 'rfis_write_guard_trg is not BEFORE UPDATE FOR EACH ROW only (tgtype = %)', v_tgtype;
  END IF;

  -- 23. The policy is RESTRICTIVE and carries BOTH halves. A RESTRICTIVE
  --     policy shipped PERMISSIVE would widen where it was meant to narrow;
  --     one with a USING and no WITH CHECK is the 00027 shape this migration
  --     exists to replace, and would let the row land anywhere.
  SELECT pol.polpermissive::text,
         pg_get_expr(pol.polqual, pol.polrelid),
         pg_get_expr(pol.polwithcheck, pol.polrelid)
    INTO v_perm, v_qual, v_check
    FROM pg_policy pol
   WHERE pol.polrelid = 'projects.rfis'::regclass AND pol.polname = 'rfis_update_gate';
  IF v_perm IS NULL THEN RAISE EXCEPTION 'the rfis_update_gate policy is missing'; END IF;
  IF v_perm <> 'false' THEN RAISE EXCEPTION 'rfis_update_gate is PERMISSIVE — it would widen, not narrow'; END IF;
  IF v_qual IS NULL THEN RAISE EXCEPTION 'rfis_update_gate has no USING half'; END IF;
  IF v_check IS NULL THEN
    RAISE EXCEPTION 'rfis_update_gate has no WITH CHECK half — the row could still land on a project the caller holds no role on';
  END IF;
  IF v_qual NOT LIKE '%user_can_update_rfi%' OR v_check NOT LIKE '%user_can_update_rfi%' THEN
    RAISE EXCEPTION 'rfis_update_gate does not resolve the role through user_can_update_rfi (USING: %, WITH CHECK: %)', v_qual, v_check;
  END IF;

  -- 24. The 00027 PERMISSIVE policy is still there. This migration narrows;
  --     it does not replace the permissive grant, and RLS consults a
  --     RESTRICTIVE policy only after a PERMISSIVE one has passed. Dropping
  --     the permissive policy would close UPDATE for everyone and look like
  --     a working gate right up until someone tried to answer an RFI.
  IF NOT EXISTS (SELECT 1 FROM pg_policy pol
                  WHERE pol.polrelid = 'projects.rfis'::regclass
                    AND pol.polname = 'Org members can update rfis' AND pol.polpermissive) THEN
    RAISE EXCEPTION 'the PERMISSIVE UPDATE policy is gone; a RESTRICTIVE policy grants nothing and every UPDATE would now fail';
  END IF;

  RAISE NOTICE 'rfi-update-gate: 20-24 passed (static shape)';
END $$;
