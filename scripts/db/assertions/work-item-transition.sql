-- Assertions for 00196 §12: projects.work_items_transition_guard() — the
-- status machine, "only the gatekeeper closes", the person-column rules, the
-- immutables, and the stamps that are the guard's to write. Run inside the
-- rolled-back transaction opened by try-work-item-spine.sh.
--
-- EVERY guard assertion runs AS A REAL AUTHENTICATED USER. Tested as postgres,
-- auth.uid() is NULL, the service-path exemption fires, and the guard passes
-- everything — the definition of a test that cannot fail.
--
-- ⚠ The assignee fixture must NOT hold a write role, or half of this file
-- cannot fail. Measured 2026-09-10 (and again 2026-09-12): every active
-- project_members row in production is contractor, project_manager or
-- client_viewer, and contractor IS in task's and rfi's write sets. The file
-- therefore DEMOTES the rbac-test fixture (018f2d31-bbe8-4cc1-bbdd-63af0187081e,
-- contractor on WM-Consulting and (643) KINGSWALK; never invite it, never
-- email it) to `inspector` for the duration of the transaction —
-- user_effective_project_role falls through to project_members.role for
-- anyone whose ORG role is not owner/admin/project_manager (00107:59-66) —
-- and asserts the demotion took.
--
-- ⚠ set_config(…, true) is TRANSACTION-local: after RESET ROLE, auth.uid()
-- still returns the last impersonated user. Every row a postgres block seeds
-- is therefore seeded BEFORE the first SET LOCAL ROLE, and the one postgres
-- block that must travel the SERVICE PATH (auth.uid() NULL — the guard's
-- exemption) clears the claim first and proves auth.uid() reads NULL:
-- auth.uid() is nullif(current_setting('request.jwt.claims', true), '')::jsonb
-- ->> 'sub', so an empty string parses to NULL (read back from production,
-- 2026-09-12).
--
-- ⚠ Every id a role-scoped block needs is captured HERE, as postgres. Under
-- the demoted role projects.rfis, projects.projects and project_members are
-- RLS-filtered, and a zero-row subquery would turn a SENTINEL into a false red.
CREATE TEMP TABLE _t AS
SELECT pm.project_id, p.organisation_id,
       '018f2d31-bbe8-4cc1-bbdd-63af0187081e'::uuid AS actor_id,
       projects.resolve_project_pm(pm.project_id) AS pm_id,
       -- A THIRD person — not the actor, not the PM, not a client viewer — for
       -- the "holder may hand it on" positive path (7f) and the one-statement
       -- self-appointment (7c), both of which need somebody to hand TO.
       (SELECT m.user_id FROM projects.project_members m
         WHERE m.project_id = pm.project_id AND m.is_active
           AND m.user_id <> '018f2d31-bbe8-4cc1-bbdd-63af0187081e'
           AND m.user_id IS DISTINCT FROM projects.resolve_project_pm(pm.project_id)
           AND m.role <> 'client_viewer'
         ORDER BY m.created_at, m.user_id
         LIMIT 1) AS other_id,
       -- Three rfis (3 exist on the fixture project, measured 2026-09-12):
       -- #1 backs the mirrored subject, #2 is the re-link target clause (a3)
       -- must refuse, #3 backs the service-path void mirror (15). Distinct
       -- rows, because work_items_src_rfi_uidx allows one mirror per rfi.
       (SELECT r.id FROM projects.rfis r WHERE r.project_id = pm.project_id
         ORDER BY r.created_at, r.id LIMIT 1) AS rfi_id,
       (SELECT r.id FROM projects.rfis r WHERE r.project_id = pm.project_id
         ORDER BY r.created_at, r.id LIMIT 1 OFFSET 1) AS rfi_id_2,
       (SELECT r.id FROM projects.rfis r WHERE r.project_id = pm.project_id
         ORDER BY r.created_at, r.id LIMIT 1 OFFSET 2) AS rfi_id_3,
       -- A project in the same org on which the actor holds NO effective role
       -- (12 such exist, measured 2026-09-12), for the trigger-order pin (5b).
       (SELECT p2.id FROM projects.projects p2
         WHERE p2.organisation_id = p.organisation_id AND p2.id <> pm.project_id
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
    RAISE EXCEPTION 'the rbac-test fixture has no project membership; the transition guard cannot be exercised as a real user';
  END IF;
  SELECT * INTO t FROM _t;
  IF t.pm_id IS NULL THEN
    RAISE EXCEPTION 'resolve_project_pm(%) is NULL — the fixture project has nobody to gatekeep', t.project_id;
  END IF;
  IF t.pm_id = t.actor_id THEN
    RAISE EXCEPTION 'the fixture actor IS the project PM; "the assignee may not close" cannot fail';
  END IF;
  IF t.other_id IS NULL THEN
    RAISE EXCEPTION 'no third non-client_viewer member (not the fixture, not the PM) on project %; 7c and 7f have nobody to hand to', t.project_id;
  END IF;
  IF t.rfi_id IS NULL OR t.rfi_id_2 IS NULL OR t.rfi_id_3 IS NULL THEN
    RAISE EXCEPTION 'fewer than three rfis on the fixture project %; the mirrored subject, the (a3) re-link target and the service-path void mirror need one each', t.project_id;
  END IF;
  IF t.foreign_project_id IS NULL THEN
    RAISE EXCEPTION 'no same-org project the fixture holds no role on; the trigger-order pin (5b) has no target';
  END IF;

  -- Every insert runs work_items_set_due_date -> add_working_days, which
  -- raises no_data_found on an unseeded year. Rolled back with everything else.
  INSERT INTO projects.calendar_years (year)
  VALUES (EXTRACT(YEAR FROM CURRENT_DATE)::int), (EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)
  ON CONFLICT DO NOTHING;

  -- Demote the actor to a NON-write role for the duration of this transaction.
  -- Every live project_members row in production is contractor /
  -- project_manager / client_viewer, and contractor IS in task's and rfi's
  -- write sets — so without this the "only the holder may shift the selected
  -- column" assertions pass vacuously.
  UPDATE projects.project_members SET role = 'inspector'
   WHERE project_id = t.project_id AND user_id = t.actor_id;
  IF public.user_effective_project_role(t.project_id, t.actor_id) IS DISTINCT FROM 'inspector' THEN
    RAISE EXCEPTION 'the demotion did not take (org-level role wins: effective role is %); pick a fixture whose org role is not owner/admin/project_manager',
      public.user_effective_project_role(t.project_id, t.actor_id);
  END IF;
  -- user_can_write_work_item() reads auth.uid(), which is NULL here; the
  -- registry is what is being checked, so read it directly.
  IF EXISTS (SELECT 1 FROM projects.work_item_types wt
              WHERE wt.key IN ('task','rfi') AND 'inspector' = ANY (wt.write_roles)) THEN
    RAISE EXCEPTION 'inspector holds a write role for task or rfi in the registry; the demoted actor would pass v_may_write and half this file cannot fail';
  END IF;

  -- Subject: assignee = the demoted actor, gatekeeper = the PM.
  -- origin = 'manual' EXPLICITLY. The column default is 'mirror', and clause
  -- (a2) freezes the title of a mirrored row — so a defaulted subject would
  -- make assertion 7 (the control proving 6 is not a blanket freeze) fail.
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, origin)
  VALUES (t.organisation_id, t.project_id, 'task', 'transition subject', t.actor_id, t.pm_id, t.pm_id, 'manual');

  -- A mirrored subject, for the title-immutability rule (6) and the
  -- source-FK re-link rule (7b). Born triage: the ball is with the assignee.
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, rfi_id, origin)
  VALUES (t.organisation_id, t.project_id, 'rfi', 'mirrored subject', t.actor_id, t.pm_id, t.pm_id, t.rfi_id, 'mirror');

  -- A subject the demoted actor HOLDS (triage, assignee = actor) and does not
  -- gatekeep, for the v_is_holder arm's one reachable positive path (7f):
  -- the holder may DROP their own item. (Handing it to someone else is what
  -- the arm was written for, but §9's RESTRICTIVE gate requires the actor to
  -- remain assignee or gatekeeper on the NEW row, so a non-write-role holder
  -- cannot move a row off themselves — that is 42501 before the guard runs,
  -- and it is the same WITH CHECK that makes 7c's one-statement trick the
  -- only hole. The void path keeps the actor on the row, so it is the arm's
  -- only live effect for a non-write-role holder.)
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, origin)
  VALUES (t.organisation_id, t.project_id, 'task', 'holder subject', t.actor_id, t.pm_id, t.pm_id, 'manual');

  -- A subject the demoted actor GATEKEEPS and does not hold (triage, assignee
  -- = the third member), for the due-date authority rule's second arm (7e):
  -- the reviewer sets the deadline even without a write role.
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, origin)
  VALUES (t.organisation_id, t.project_id, 'task', 'reviewer subject', t.other_id, t.actor_id, t.pm_id, 'manual');

  -- A VOID mirror seeded on the SERVICE PATH (auth.uid() is NULL here — this
  -- runs before the first impersonation), for 15: item 3's delete-to-void
  -- shape is the RI ON DELETE SET NULL, an UPDATE of a void row that changes
  -- ONLY a source FK, executed with no JWT. The guard must let it through.
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by,
     rfi_id, status, void_reason, origin)
  VALUES (t.organisation_id, t.project_id, 'rfi', 'void mirror subject', t.actor_id, t.pm_id, t.pm_id,
          t.rfi_id_3, 'void', 'assertion', 'mirror');
END $$;

-- Act as the ASSIGNEE, who is neither the gatekeeper nor a write-role holder.
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT actor_id FROM _t), 'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE t record; v_id uuid; v_mirror uuid; v_holder uuid; v_reviewer uuid;
        v_due date; v_at timestamptz; v_by uuid; v_reason text;
BEGIN
  -- The fixture must be readable in this role, or the block dies on its first
  -- statement and proves nothing.
  BEGIN
    PERFORM 1 FROM _t;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'fixture _t is unreadable as authenticated — add GRANT SELECT ON _t TO authenticated';
  END;
  SELECT * INTO t FROM _t;
  IF auth.uid() IS DISTINCT FROM t.actor_id THEN
    RAISE EXCEPTION 'impersonation did not take: auth.uid() is %', auth.uid();
  END IF;
  -- The demotion must be what the policies and the guard see from here on.
  IF projects.user_can_write_work_item(t.project_id, 'task') THEN
    RAISE EXCEPTION 'the demoted actor still holds a write role for task as seen by user_can_write_work_item()';
  END IF;

  SELECT id INTO v_id       FROM projects.work_items WHERE title = 'transition subject';
  SELECT id INTO v_mirror   FROM projects.work_items WHERE title = 'mirrored subject';
  SELECT id INTO v_holder   FROM projects.work_items WHERE title = 'holder subject';
  SELECT id INTO v_reviewer FROM projects.work_items WHERE title = 'reviewer subject';
  IF v_id IS NULL OR v_mirror IS NULL OR v_holder IS NULL OR v_reviewer IS NULL THEN
    RAISE EXCEPTION 'the assignee cannot even SEE their subjects; the RLS SELECT policy is wrong';
  END IF;

  -- Every legal UPDATE below is checked with FOUND: under RLS an UPDATE that
  -- matches no row does NOT raise, and a later failure would then be about
  -- the wrong layer.

  -- 1. The assignee may move their own item forward. That is how a contractor
  --    answers, and it is the identity arm the RLS file's 9c relies on.
  UPDATE projects.work_items SET status = 'open'     WHERE id = v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'the triage -> open UPDATE matched no row under RLS'; END IF;
  UPDATE projects.work_items SET status = 'answered' WHERE id = v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'the open -> answered UPDATE matched no row under RLS'; END IF;

  -- 2. THE ASSIGNEE MAY NOT CLOSE. This is the rule that ends "any contractor
  --    can close any RFI in WM's org". Assert on the MESSAGE: a bare "it
  --    raised" handler passes whenever the statement failed for any reason.
  BEGIN
    UPDATE projects.work_items SET status = 'closed' WHERE id = v_id;
    RAISE EXCEPTION 'SENTINEL: the assignee closed an item they do not gatekeep';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%can close it%' THEN
      RAISE EXCEPTION 'the close attempt failed for the wrong reason: %', SQLERRM; END IF;
  END;

  -- 3. An illegal jump is refused. void is terminal; closed reopens only to open.
  BEGIN
    UPDATE projects.work_items SET status = 'triage' WHERE id = v_id;
    RAISE EXCEPTION 'SENTINEL: answered -> triage was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%cannot move from%' THEN
      RAISE EXCEPTION 'the illegal-jump attempt failed for the wrong reason: %', SQLERRM; END IF;
  END;

  -- 4. While ANSWERED the shift writes gatekeeper_id, never assignee_id —
  --    writing the unselected column would regenerate an unchanged
  --    ball-in-court and look like a broken control (§03 §1.4). This binds only
  --    to someone who is NOT a write-role holder; a PM correcting the same
  --    column is assertion 11.
  BEGIN
    UPDATE projects.work_items SET assignee_id = gatekeeper_id WHERE id = v_id;
    RAISE EXCEPTION 'SENTINEL: assignee_id was writable by a non-write-role holder while the item was answered';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%with the reviewer%' THEN
      RAISE EXCEPTION 'the answered-assignee-write attempt failed for the wrong reason: %', SQLERRM; END IF;
  END;

  -- 5. Immutable columns stay immutable. ref is a permanent identifier in
  --    emails, PDFs and other people's notes. (§6's suffix parse tolerates a
  --    junk ref precisely because there is no repair path once this holds.)
  BEGIN
    UPDATE projects.work_items SET ref = 'HACK-1' WHERE id = v_id;
    RAISE EXCEPTION 'SENTINEL: ref was mutable';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%cannot be renumbered%' THEN
      RAISE EXCEPTION 'the ref-mutation attempt failed for the wrong reason: %', SQLERRM; END IF;
  END;

  -- 5b. TRIGGER ORDER, pinned. A project move is refused twice over — by §7's
  --     membership trigger (the people are not on the target project) and by
  --     §12's immutability clause (a). BEFORE ROW triggers fire in NAME order,
  --     work_items_assert_membership_trg < work_items_transition_guard_trg, so
  --     the MEMBERSHIP sentence wins. That order is deliberate: the guard's
  --     name is declared in the @verify block and cannot sort first without
  --     breaking membership 3b, so the membership sentence is what a user
  --     sees for this move. This assertion passes with or without §12 — it is
  --     a pin, not a guard test.
  BEGIN
    UPDATE projects.work_items SET project_id = t.foreign_project_id WHERE id = v_id;
    RAISE EXCEPTION 'SENTINEL: the assignee moved their item to a project they are not on';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%not on this project%' THEN
      RAISE EXCEPTION 'the project move failed for the wrong reason (the membership trigger should fire first): %', SQLERRM; END IF;
  END;

  -- 6. A MIRRORED item's title belongs to its source. Without this rule, item
  --    3's mirror trigger and a PM's clarification silently overwrite each other.
  BEGIN
    UPDATE projects.work_items SET title = 'edited by hand' WHERE id = v_mirror;
    RAISE EXCEPTION 'SENTINEL: a mirrored item''s title was editable';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%mirrored from its source%' THEN
      RAISE EXCEPTION 'the mirrored-title attempt failed for the wrong reason: %', SQLERRM; END IF;
  END;

  -- 7. ...but a MANUAL item's title is editable, or assertion 6 would also
  --    pass for a guard that froze every title. The title must actually
  --    CHANGE: the plan's original wrote the value the row already held, so
  --    NEW.title was never distinct from OLD.title and a blanket freeze went
  --    undetected (the Step 7 mutation stayed green until this was fixed).
  --    Edited and restored, because the later blocks find the row by title.
  UPDATE projects.work_items SET title = 'transition subject (clarified)', priority = 'high' WHERE id = v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'the manual-title UPDATE matched no row under RLS'; END IF;
  IF (SELECT title FROM projects.work_items WHERE id = v_id) <> 'transition subject (clarified)' THEN
    RAISE EXCEPTION 'the manual title edit did not take';
  END IF;
  UPDATE projects.work_items SET title = 'transition subject' WHERE id = v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'the manual-title restore matched no row under RLS'; END IF;

  -- 7b. A source FK may change ONLY to NULL (item 3's delete-to-void RI path,
  --     assertion 15). The PERMISSIVE UPDATE policy would otherwise let the
  --     assignee re-point a mirrored item at a different RFI — the partial
  --     unique only stops two items per source, not one item per two sources.
  --     rfi_id_2 has no mirror, so nothing but the guard refuses this.
  BEGIN
    UPDATE projects.work_items SET rfi_id = t.rfi_id_2 WHERE id = v_mirror;
    RAISE EXCEPTION 'SENTINEL: a mirrored item was re-linked to a different rfi';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%cannot be re-linked%' THEN
      RAISE EXCEPTION 'the re-link attempt failed for the wrong reason: %', SQLERRM; END IF;
  END;

  -- 7c. ONE-STATEMENT SELF-APPOINTMENT (proven on production in review): an
  --     assignee holding an OPEN item writes `gatekeeper_id = auth.uid(),
  --     assignee_id = <someone else>` in a single UPDATE and passes the
  --     RESTRICTIVE gate's WITH CHECK (NEW.gatekeeper_id = auth.uid()). They
  --     would then be the only person who could close their own work. The
  --     assignee arm admits the hand-off (they hold the ball in 'open'); the
  --     gatekeeper arm refuses it, because a non-write-role holder may change
  --     the gatekeeper only while the item is 'answered'. Pull the item back
  --     to open first — the assignee may (answered -> open is a legal move
  --     and the machine gates only close and void by authority).
  UPDATE projects.work_items SET status = 'open' WHERE id = v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'the answered -> open UPDATE matched no row under RLS'; END IF;
  BEGIN
    UPDATE projects.work_items SET gatekeeper_id = auth.uid(), assignee_id = t.other_id WHERE id = v_id;
    RAISE EXCEPTION 'SENTINEL: the assignee appointed themselves gatekeeper in one statement';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%still being worked on%' THEN
      RAISE EXCEPTION 'the self-appointment failed for the wrong reason: %', SQLERRM; END IF;
  END;

  -- 7d. DUE-DATE AUTHORITY. The reviewer sets the deadline; the worker cannot
  --     extend their own (an assignee extended theirs by 365 days in a probe).
  BEGIN
    UPDATE projects.work_items SET due_date = due_date + 365 WHERE id = v_id;
    RAISE EXCEPTION 'SENTINEL: the assignee extended their own due date';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%can change when it is due%' THEN
      RAISE EXCEPTION 'the self-extension failed for the wrong reason: %', SQLERRM; END IF;
  END;
  -- 7e. ...but the GATEKEEPER may, even without a write role: on the reviewer
  --     subject the demoted actor signs off and does not hold, so this passes
  --     only through the `v_actor = OLD.gatekeeper_id` arm.
  SELECT due_date INTO v_due FROM projects.work_items WHERE id = v_reviewer;
  UPDATE projects.work_items SET due_date = due_date + 7 WHERE id = v_reviewer;
  IF NOT FOUND THEN RAISE EXCEPTION 'the gatekeeper''s due-date UPDATE matched no row under RLS'; END IF;
  IF (SELECT due_date FROM projects.work_items WHERE id = v_reviewer) <> v_due + 7 THEN
    RAISE EXCEPTION 'the gatekeeper''s due-date change did not take';
  END IF;

  -- 7f. THE HOLDER MAY DROP THEIR OWN ITEM — the v_is_holder arm's positive
  --     path. The demoted actor holds the holder subject (triage, assignee)
  --     and has no write role, so the void is admitted ONLY through
  --     `v_actor = OLD.ball_in_court_id`; without that arm it is refused as
  --     "Only the project team, or whoever is holding …, can drop it." (A
  --     hand-off to someone else would exercise the same arm, but §9's gate
  --     refuses any UPDATE that moves the row off a non-write-role actor —
  --     see the seed comment — so the void is the arm's reachable effect.)
  UPDATE projects.work_items SET status = 'void', void_reason = 'no longer needed' WHERE id = v_holder;
  IF NOT FOUND THEN RAISE EXCEPTION 'the holder''s void UPDATE matched no row under RLS'; END IF;
  IF (SELECT status FROM projects.work_items WHERE id = v_holder) <> 'void'
     OR (SELECT ball_in_court_id FROM projects.work_items WHERE id = v_holder) IS NOT NULL THEN
    RAISE EXCEPTION 'the holder''s void did not take, or the void item still holds a ball_in_court';
  END IF;

  -- 7g. THE CLOSE STAMPS AND THE VOID REASON ARE THE GUARD'S, NEVER THE
  --     CALLER'S. On an open item whose status does not change, a client-
  --     supplied closed_at / closed_by / void_reason is overwritten with the
  --     row's own values — not refused, because these are stamps, not
  --     identity, and a refusal would turn every innocent full-row save from
  --     a form into an error. The UPDATE succeeds; the row is unchanged.
  UPDATE projects.work_items
     SET closed_at = now(), closed_by = auth.uid(), void_reason = 'smuggled'
   WHERE id = v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'the stamp-smuggling UPDATE matched no row under RLS'; END IF;
  SELECT closed_at, closed_by, void_reason INTO v_at, v_by, v_reason
    FROM projects.work_items WHERE id = v_id;
  IF v_at IS NOT NULL OR v_by IS NOT NULL THEN
    RAISE EXCEPTION 'a client-supplied closed_at/closed_by was accepted on an open item (closed_at=%, closed_by=%)', v_at, v_by;
  END IF;
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'a client-supplied void_reason was accepted on a non-void item';
  END IF;

  -- Back to answered, so the gatekeeper block starts where the plan's does.
  UPDATE projects.work_items SET status = 'answered' WHERE id = v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'the open -> answered (second) UPDATE matched no row under RLS'; END IF;

  RAISE NOTICE 'work-item-transition (assignee): 1-7g passed';
END $$;

RESET ROLE;

-- Act as the GATEKEEPER, who is also the project PM and therefore a write-role
-- holder — the two affordances that role has are asserted together.
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT pm_id FROM _t), 'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE t record; v_id uuid; v_mirror uuid; v_at timestamptz; v_by uuid; v_bic uuid;
        v_status text; v_assignee uuid; v_gate uuid; v_reason text;
BEGIN
  SELECT * INTO t FROM _t;
  IF auth.uid() IS DISTINCT FROM t.pm_id THEN
    RAISE EXCEPTION 'impersonation did not take: auth.uid() is %', auth.uid();
  END IF;
  SELECT id INTO v_id     FROM projects.work_items WHERE title = 'transition subject';
  SELECT id INTO v_mirror FROM projects.work_items WHERE title = 'mirrored subject';
  IF v_id IS NULL OR v_mirror IS NULL THEN
    RAISE EXCEPTION 'the gatekeeper cannot see the subjects; the RLS SELECT policy is wrong';
  END IF;

  -- 8. VOID DEMANDS A REASON. Run here, not as the assignee: while the item is
  --    `answered` the ball is with the GATEKEEPER, so an assignee attempting a
  --    void is refused for lack of authority and never reaches the reason check.
  BEGIN
    UPDATE projects.work_items SET status = 'void' WHERE id = v_id;
    RAISE EXCEPTION 'SENTINEL: void was accepted with no void_reason';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%needs a short reason%' THEN
      RAISE EXCEPTION 'the reasonless void failed for the wrong reason: %', SQLERRM; END IF;
  END;

  -- 9. The gatekeeper closes, and closed_at/closed_by are STAMPED by the guard,
  --    not supplied by the caller.
  UPDATE projects.work_items SET status = 'closed' WHERE id = v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'the gatekeeper''s close matched no row under RLS'; END IF;
  SELECT closed_at, closed_by, ball_in_court_id INTO v_at, v_by, v_bic
    FROM projects.work_items WHERE id = v_id;
  IF v_at IS NULL OR v_by IS NULL THEN RAISE EXCEPTION 'close did not stamp closed_at/closed_by'; END IF;
  IF v_by <> auth.uid() THEN RAISE EXCEPTION 'closed_by is % not the closer', v_by; END IF;
  IF v_bic IS NOT NULL THEN RAISE EXCEPTION 'a closed item still holds a ball_in_court'; END IF;

  -- 10. Reopening clears the close stamps rather than leaving a lie behind.
  UPDATE projects.work_items SET status = 'open' WHERE id = v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'the reopen matched no row under RLS'; END IF;
  SELECT closed_at, closed_by INTO v_at, v_by FROM projects.work_items WHERE id = v_id;
  IF v_at IS NOT NULL OR v_by IS NOT NULL THEN RAISE EXCEPTION 'reopen left closed_at/closed_by set'; END IF;

  -- 11. A WRITE-ROLE HOLDER MAY CORRECT THE GATEKEEPER WHILE THE ITEM IS OPEN.
  --     A(b) makes task's gatekeeper the CREATOR, so without this a contractor
  --     who raises a task for a WM engineer is the only person who may ever
  --     close it, and the PM cannot fix that until the work is already done.
  --     Correcting a gatekeeper while the item is open moves no ball.
  UPDATE projects.work_items SET gatekeeper_id = t.actor_id WHERE id = v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'the gatekeeper correction matched no row under RLS'; END IF;
  IF (SELECT gatekeeper_id FROM projects.work_items WHERE id = v_id) <> t.actor_id
  THEN RAISE EXCEPTION 'a write-role holder could not correct the gatekeeper on an open item'; END IF;
  UPDATE projects.work_items SET gatekeeper_id = t.pm_id WHERE id = v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'the gatekeeper restore matched no row under RLS'; END IF;

  -- 12. ...but NOT once the item is closed or void. A closed item's people are
  --     part of the record.
  UPDATE projects.work_items SET status = 'answered' WHERE id = v_id;
  UPDATE projects.work_items SET status = 'closed'   WHERE id = v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'the second close matched no row under RLS'; END IF;
  BEGIN
    UPDATE projects.work_items SET gatekeeper_id = t.actor_id WHERE id = v_id;
    RAISE EXCEPTION 'SENTINEL: a closed item''s gatekeeper was changed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%Reopen it before changing%' THEN
      RAISE EXCEPTION 'the closed-item person change failed for the wrong reason: %', SQLERRM; END IF;
  END;

  -- 13. Void with a reason is accepted, and the item leaves every inbox.
  UPDATE projects.work_items SET status = 'open' WHERE id = v_id;
  UPDATE projects.work_items SET status = 'void', void_reason = 'assertion' WHERE id = v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'the void matched no row under RLS'; END IF;
  IF (SELECT ball_in_court_id FROM projects.work_items WHERE id = v_id) IS NOT NULL
  THEN RAISE EXCEPTION 'a void item still holds a ball_in_court'; END IF;

  -- 14. A VOID item's source FK may be nulled by a signed-in write-role
  --     holder — the gatekeeper here — with NO other clause raising: status
  --     stays void (no machine check), the people are unchanged (clause (b)
  --     stays quiet), the reason stays (void_reason is editable while void),
  --     and clause (a3) admits a change TO NULL. This is item 3's
  --     delete-to-void shape on the signed-in path; 15 is the service path.
  UPDATE projects.work_items SET status = 'void', void_reason = 'assertion' WHERE id = v_mirror;
  IF NOT FOUND THEN RAISE EXCEPTION 'voiding the mirrored subject matched no row under RLS'; END IF;
  UPDATE projects.work_items SET rfi_id = NULL WHERE id = v_mirror;
  IF NOT FOUND THEN RAISE EXCEPTION 'the SET NULL on the void mirrored subject matched no row under RLS'; END IF;
  SELECT status, assignee_id, gatekeeper_id, void_reason INTO v_status, v_assignee, v_gate, v_reason
    FROM projects.work_items WHERE id = v_mirror;
  IF (SELECT rfi_id FROM projects.work_items WHERE id = v_mirror) IS NOT NULL THEN
    RAISE EXCEPTION 'the SET NULL on the void mirrored subject did not take';
  END IF;
  IF v_status <> 'void' OR v_assignee <> t.actor_id OR v_gate <> t.pm_id OR v_reason <> 'assertion' THEN
    RAISE EXCEPTION 'nulling the source FK on a void item changed something else: status=% assignee=% gatekeeper=% void_reason=%',
      v_status, v_assignee, v_gate, v_reason;
  END IF;

  RAISE NOTICE 'work-item-transition (gatekeeper): 8-14 passed';
END $$;

RESET ROLE;

-- The SERVICE PATH. set_config(…, true) is transaction-local, so auth.uid()
-- still names the PM here; clear the claim and PROVE it reads NULL before
-- relying on the guard's exemption.
SELECT set_config('request.jwt.claims', '', true);

DO $$
DECLARE t record; v_void uuid; v_reviewer uuid; v_status text; v_assignee uuid; v_gate uuid; v_reason text;
        v_at timestamptz; v_by uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'the claim was not cleared: auth.uid() is % — the service-path assertions would run as a person', auth.uid();
  END IF;
  SELECT * INTO t FROM _t;

  -- 15. Item 3's delete-to-void shape, exactly: a source-row delete on a VOID
  --     mirrored item runs the RI ON DELETE SET NULL as an UPDATE of that row
  --     changing only one FK column, with no JWT. The guard's exemption
  --     returns the row untouched but for last_activity_at; nothing raises.
  SELECT id INTO v_void FROM projects.work_items WHERE title = 'void mirror subject';
  IF v_void IS NULL THEN RAISE EXCEPTION 'the void mirror subject was not seeded'; END IF;
  UPDATE projects.work_items SET rfi_id = NULL WHERE id = v_void;
  IF NOT FOUND THEN RAISE EXCEPTION 'the service-path SET NULL matched no row'; END IF;
  SELECT status, assignee_id, gatekeeper_id, void_reason INTO v_status, v_assignee, v_gate, v_reason
    FROM projects.work_items WHERE id = v_void;
  IF (SELECT rfi_id FROM projects.work_items WHERE id = v_void) IS NOT NULL THEN
    RAISE EXCEPTION 'the service-path SET NULL on the void mirror did not take';
  END IF;
  IF v_status <> 'void' OR v_assignee <> t.actor_id OR v_gate <> t.pm_id OR v_reason <> 'assertion' THEN
    RAISE EXCEPTION 'the service-path SET NULL changed something else: status=% assignee=% gatekeeper=% void_reason=%',
      v_status, v_assignee, v_gate, v_reason;
  END IF;

  -- 16. The exemption still owns the stamps: a service-path save that does
  --     not change status cannot smuggle a closed_at in, and a service-path
  --     close stamps closed_at while closed_by stays whatever the caller
  --     supplied — NULL here, because there is no actor to invent. The
  --     reviewer subject is still triage (7e changed only its due date); the
  --     exemption does not run the machine, so open it first as the action
  --     layer would.
  SELECT id INTO v_reviewer FROM projects.work_items WHERE title = 'reviewer subject';
  IF v_reviewer IS NULL THEN RAISE EXCEPTION 'the reviewer subject was not seeded'; END IF;
  UPDATE projects.work_items SET closed_at = now() - interval '1 day' WHERE id = v_reviewer;
  SELECT closed_at INTO v_at FROM projects.work_items WHERE id = v_reviewer;
  IF v_at IS NOT NULL THEN RAISE EXCEPTION 'a service-path save smuggled closed_at onto a non-closed item'; END IF;
  UPDATE projects.work_items SET status = 'open'   WHERE id = v_reviewer;
  UPDATE projects.work_items SET status = 'closed' WHERE id = v_reviewer;
  SELECT closed_at, closed_by INTO v_at, v_by FROM projects.work_items WHERE id = v_reviewer;
  IF v_at IS NULL THEN RAISE EXCEPTION 'a service-path close did not stamp closed_at'; END IF;
  IF v_by IS NOT NULL THEN RAISE EXCEPTION 'a service-path close invented a closer: %', v_by; END IF;

  RAISE NOTICE 'work-item-transition (service path): 15-16 passed';
END $$;

-- The static shape, last — so that a file run against a migration WITHOUT §12
-- (the Step 2 red run) fails on assertion 2's SENTINEL, today's production
-- behaviour, and not on "the function does not exist".
DO $$
DECLARE v_tgtype smallint;
BEGIN
  -- 17. The guard exists, anon cannot call it (CASE-guarded on
  --     to_regprocedure so an absent function reads red instead of aborting
  --     inside has_function_privilege), it never reads current_user, and its
  --     trigger is BEFORE UPDATE FOR EACH ROW and nothing else — an INSERT arm
  --     would fire on work-item-ref.sql 3a, which inserts as the table owner.
  IF to_regprocedure('projects.work_items_transition_guard()') IS NULL THEN
    RAISE EXCEPTION 'projects.work_items_transition_guard() does not exist';
  END IF;
  IF has_function_privilege('anon', 'projects.work_items_transition_guard()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon holds EXECUTE on work_items_transition_guard(); the @verify grant_absent directive would block every later deploy';
  END IF;
  IF has_function_privilege('authenticated', 'projects.work_items_transition_guard()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated holds EXECUTE on work_items_transition_guard(); a trigger function needs no grant';
  END IF;
  -- Comments are stripped first: the body's own comments SAY "never
  -- current_user", and prosrc carries them. Only code counts.
  IF regexp_replace(
       (SELECT prosrc FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
         WHERE nsp.nspname = 'projects' AND p.proname = 'work_items_transition_guard'),
       '--[^\n]*', '', 'g') ILIKE '%current_user%'
  THEN RAISE EXCEPTION 'work_items_transition_guard references current_user in code — a rule about people cannot be written in terms of a role, in any security context'; END IF;
  SELECT tg.tgtype INTO v_tgtype FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'projects' AND c.relname = 'work_items' AND tg.tgname = 'work_items_transition_guard_trg';
  IF v_tgtype IS NULL THEN RAISE EXCEPTION 'work_items_transition_guard_trg is missing'; END IF;
  -- tgtype bits: 1 = ROW, 2 = BEFORE, 4 = INSERT, 8 = DELETE, 16 = UPDATE.
  IF v_tgtype <> (1 | 2 | 16) THEN
    RAISE EXCEPTION 'work_items_transition_guard_trg is not BEFORE UPDATE FOR EACH ROW only (tgtype = %)', v_tgtype;
  END IF;

  RAISE NOTICE 'work-item-transition: 17 passed (static shape)';
END $$;
