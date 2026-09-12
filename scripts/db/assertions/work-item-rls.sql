-- Assertions for 00196 §8-§10: the two helpers, the RLS policy set, the grants
-- and the anon revokes. Run inside the rolled-back transaction opened by
-- try-work-item-spine.sh.
--
-- Three roles act, and every role-scoped block acts as a REAL user — the only
-- way a role assertion can fail:
--   * postgres — the structural checks (0-4), the seed rows, and the watcher
--     and event rows that §11's append trigger will one day write itself;
--   * the rbac-test contractor — 018f2d31-bbe8-4cc1-bbdd-63af0187081e,
--     contractor on WM-Consulting and (643) KINGSWALK, the permanent prod RBAC
--     fixture (CLAUDE.md "Key gotchas": never invite it, never email it) —
--     the write gate and every positive path through it (5-11);
--   * the oldest active client_viewer on the oldest ACTIVE project that HAS one
--     — measured 2026-09-12: three on (657) MAMAILA PHASE 2; KINGSWALK, the
--     oldest active project, has ten members and zero client viewers — the
--     read carve-out and the write block (12-21).
--
-- ⚠ A temp table created as postgres is unreadable after SET LOCAL ROLE
-- authenticated (42501 "permission denied for table _f", proven against
-- production). Every fixture table is GRANTed to authenticated, and the grant
-- is asserted first in every role-scoped block: without it that block dies on
-- its first statement and proves nothing.
--
-- ⚠ Every id a role-scoped block needs is captured HERE, as postgres — rfi_id
-- (7) and foreign_org_id (9, 9b) in particular. Under the contractor's role
-- projects.rfis and public.organisations are RLS-filtered (organisations is
-- members-only, and the fixture is in ONE of the 7 orgs), so an INSERT … SELECT
-- from either would select zero rows, insert nothing, and trip the SENTINEL —
-- a false red that reads like a policy failure. The prelude RAISEs if either
-- capture is NULL rather than letting that happen.
CREATE TEMP TABLE _f AS
SELECT pm.project_id, p.organisation_id,
       '018f2d31-bbe8-4cc1-bbdd-63af0187081e'::uuid AS contractor_id,
       projects.resolve_project_pm(pm.project_id) AS pm_id,
       (SELECT r.id FROM projects.rfis r WHERE r.project_id = pm.project_id
         ORDER BY r.created_at, r.id LIMIT 1) AS rfi_id,
       (SELECT o.id FROM public.organisations o WHERE o.id <> p.organisation_id
         ORDER BY o.created_at, o.id LIMIT 1) AS foreign_org_id
  FROM projects.project_members pm
  JOIN projects.projects p ON p.id = pm.project_id
 WHERE pm.user_id = '018f2d31-bbe8-4cc1-bbdd-63af0187081e' AND pm.is_active
 ORDER BY pm.created_at, pm.project_id
 LIMIT 1;
GRANT SELECT ON _f TO authenticated;

-- The client-viewer fixture. Two extra predicates keep 13 and 14 honest:
--   * their EFFECTIVE role must be client_viewer — an org owner who also holds
--     a client_viewer membership resolves to owner (00107 clause 1) and would
--     pass both for the wrong reason;
--   * user_has_project_access() must be TRUE for them (00106 clause (a) needs
--     an ACTIVE user_organisations row beside the project_members row) — or
--     13 could never fail, because the project-access arm it guards would
--     already be false for them.
CREATE TEMP TABLE _cv AS
SELECT pm.user_id, pm.project_id, p.organisation_id,
       projects.resolve_project_pm(pm.project_id) AS pm_id
  FROM projects.project_members pm
  JOIN projects.projects p ON p.id = pm.project_id
 WHERE pm.is_active AND pm.role = 'client_viewer' AND p.status = 'active'
   AND public.user_effective_project_role(pm.project_id, pm.user_id) = 'client_viewer'
   AND EXISTS (SELECT 1 FROM public.user_organisations uo
                WHERE uo.user_id = pm.user_id
                  AND uo.organisation_id = pm.organisation_id AND uo.is_active)
 ORDER BY p.created_at, pm.created_at, pm.user_id
 LIMIT 1;
GRANT SELECT ON _cv TO authenticated;

-- Ids of the rows seeded as postgres, so a role-scoped block can name a row it
-- is NOT allowed to see (5d, 11e, 19) without a title lookup that RLS would
-- turn into NULL.
CREATE TEMP TABLE _seed (label text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT ON _seed TO authenticated;

DO $$
DECLARE n int; f record; c record; v_missing text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _f) THEN
    RAISE EXCEPTION 'the rbac-test contractor fixture has no active project membership; every role assertion below would pass vacuously';
  END IF;
  SELECT * INTO f FROM _f;
  IF f.pm_id IS NULL THEN
    RAISE EXCEPTION 'resolve_project_pm(%) is NULL — the fixture project has nobody to gatekeep', f.project_id;
  END IF;
  IF f.rfi_id IS NULL THEN
    RAISE EXCEPTION 'no RFI on the fixture project % — assertion 7 needs a real rfi_id captured as postgres, or a zero-row INSERT … SELECT trips its SENTINEL', f.project_id;
  END IF;
  IF f.foreign_org_id IS NULL THEN
    RAISE EXCEPTION 'no second organisation exists — assertions 9 and 9b need a real foreign org id captured as postgres';
  END IF;
  -- The fixture's org role is contractor. Were it ever elevated to
  -- owner/admin/PM, user_has_project_access() clause (b) would admit it to
  -- EVERY project in the org and 5d/11e would go red for a reason that is not
  -- a policy defect. Pinned, so the failure names the cause.
  IF public.user_effective_project_role(f.project_id, f.contractor_id) IS DISTINCT FROM 'contractor' THEN
    RAISE EXCEPTION 'the rbac-test fixture''s effective role on % is % rather than contractor — the write-gate assertions assume a contractor',
      f.project_id, public.user_effective_project_role(f.project_id, f.contractor_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM _cv) THEN
    RAISE EXCEPTION 'no active client_viewer (effective role client_viewer, active org membership) on any active project; the client-viewer read and write assertions cannot fail and would be decorative. Create one inside this transaction rather than skipping them.';
  END IF;
  SELECT * INTO c FROM _cv;
  IF c.pm_id IS NULL THEN
    RAISE EXCEPTION 'resolve_project_pm(%) is NULL — the client-viewer project has nobody to gatekeep', c.project_id;
  END IF;
  -- 5d and 11e need the contractor to be a NON-member of the client-viewer
  -- project (true today, measured). Pinned so it cannot weaken silently.
  IF EXISTS (SELECT 1 FROM projects.project_members pm
              WHERE pm.project_id = c.project_id AND pm.user_id = f.contractor_id AND pm.is_active) THEN
    RAISE EXCEPTION 'the rbac-test fixture is now a member of the client-viewer project % — 5d/11e (a non-member sees nothing) would pass for the wrong reason; pick a different client-viewer project', c.project_id;
  END IF;

  -- Every insert runs work_items_set_due_date -> add_working_days, which
  -- raises no_data_found on an unseeded year. Rolled back with everything else.
  INSERT INTO projects.calendar_years (year)
  VALUES (EXTRACT(YEAR FROM CURRENT_DATE)::int), (EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)
  ON CONFLICT DO NOTHING;

  -- 0a. anon holds NO SELECT on any of the four tables. This is the arm the
  --     red run (Step 2) fails on: 00025:26's ALTER DEFAULT PRIVILEGES births
  --     every projects table with anon SELECT, exactly what §12 §(a) warns about.
  SELECT count(*) INTO n FROM (VALUES
      ('projects.work_items'),('projects.work_item_types'),
      ('projects.work_item_events'),('projects.work_item_watchers')) t(rel)
   WHERE has_table_privilege('anon', t.rel, 'SELECT');
  IF n <> 0 THEN RAISE EXCEPTION 'anon can SELECT % of the 4 new tables', n; END IF;
  -- 0b. ...and nothing else either: §10 revokes ALL, not SELECT.
  --     has_table_privilege with a list is TRUE if ANY listed privilege is held.
  SELECT count(*) INTO n FROM (VALUES
      ('projects.work_items'),('projects.work_item_types'),
      ('projects.work_item_events'),('projects.work_item_watchers')) t(rel)
   WHERE has_table_privilege('anon', t.rel, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER');
  IF n <> 0 THEN RAISE EXCEPTION 'anon still holds a privilege on % of the 4 new tables', n; END IF;

  -- 0c. Every function §10 revokes must EXIST — has_function_privilege on a
  --     missing one aborts the transaction with a message about the wrong
  --     thing — and anon must hold no EXECUTE on any of the eight. This
  --     includes the three trigger functions: has_function_privilege('anon',
  --     …) was TRUE on all of them before §10 (measured), because a new
  --     function in projects inherits Postgres's built-in PUBLIC EXECUTE.
  -- (alias fn, not f: the record variable f above would shadow a table alias
  -- of the same name inside plpgsql — 42703 `record "f" has no field "sig"`.)
  SELECT string_agg(fn.sig, ', ') INTO v_missing FROM (VALUES
      ('projects.user_can_read_work_item(uuid)'),
      ('projects.user_can_write_work_item(uuid,text)'),
      ('projects.add_working_days(date,int,uuid,text)'),
      ('projects.push_past_builders_shutdown(date,uuid)'),
      ('projects.resolve_work_item_assignee(uuid,text,uuid)'),
      ('projects.work_items_set_due_date()'),
      ('projects.work_items_ensure_ref()'),
      ('projects.work_items_assert_membership()')) fn(sig)
   WHERE to_regprocedure(fn.sig) IS NULL;
  IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'function(s) missing, so their grants cannot be checked: %', v_missing; END IF;
  SELECT count(*) INTO n FROM (VALUES
      ('projects.user_can_read_work_item(uuid)'),
      ('projects.user_can_write_work_item(uuid,text)'),
      ('projects.add_working_days(date,int,uuid,text)'),
      ('projects.push_past_builders_shutdown(date,uuid)'),
      ('projects.resolve_work_item_assignee(uuid,text,uuid)'),
      ('projects.work_items_set_due_date()'),
      ('projects.work_items_ensure_ref()'),
      ('projects.work_items_assert_membership()')) fn(sig)
   WHERE has_function_privilege('anon', fn.sig, 'EXECUTE');
  IF n <> 0 THEN RAISE EXCEPTION '% of the 8 §5-§8 functions still executable by anon', n; END IF;

  -- 0d. The authenticated revokes of §10: DELETE on the two tables whose rows
  --     are never deleted (what keeps §6's MAX+1 monotonic), every write on
  --     the append-only event log, every write on the registry.
  SELECT count(*) INTO n FROM (VALUES
      ('projects.work_items','DELETE'),        ('projects.work_item_events','DELETE'),
      ('projects.work_item_events','INSERT'),  ('projects.work_item_events','UPDATE'),
      ('projects.work_item_types','INSERT'),   ('projects.work_item_types','UPDATE'),
      ('projects.work_item_types','DELETE')) t(rel, priv)
   WHERE has_table_privilege('authenticated', t.rel, t.priv);
  IF n <> 0 THEN RAISE EXCEPTION 'authenticated still holds % of the 7 privileges §10 revokes', n; END IF;
  -- 0e. ...while keeping what the app needs. A revoke typo would otherwise
  --     surface as a dead feature rather than a red assertion.
  SELECT count(*) INTO n FROM (VALUES
      ('projects.work_items','SELECT'), ('projects.work_items','INSERT'), ('projects.work_items','UPDATE'),
      ('projects.work_item_types','SELECT'), ('projects.work_item_events','SELECT'),
      ('projects.work_item_watchers','SELECT'), ('projects.work_item_watchers','INSERT'),
      ('projects.work_item_watchers','DELETE')) t(rel, priv)
   WHERE NOT has_table_privilege('authenticated', t.rel, t.priv);
  IF n <> 0 THEN RAISE EXCEPTION 'authenticated is missing % of the 8 privileges the app needs', n; END IF;

  -- 1. The default privilege that births anon-readable tables is gone for good.
  --    pg_default_acl for projects is owned by postgres (measured 2026-09-12:
  --    anon=r on tables, nothing on sequences), and both db push and the
  --    Management API run as postgres, so §10's REVOKE edits that same entry.
  SELECT count(*) INTO n
    FROM pg_default_acl d JOIN pg_namespace nsp ON nsp.oid = d.defaclnamespace
   WHERE nsp.nspname = 'projects' AND d.defaclobjtype = 'r'
     AND array_to_string(d.defaclacl, ',') LIKE '%anon=%';
  IF n <> 0 THEN RAISE EXCEPTION 'ALTER DEFAULT PRIVILEGES still grants anon a privilege on future projects tables'; END IF;

  -- 2. There is a PERMISSIVE policy for INSERT and for UPDATE. A RESTRICTIVE-only
  --    table rejects every write and looks like a broken feature.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='projects' AND tablename='work_items'
     AND permissive='PERMISSIVE' AND cmd IN ('INSERT','UPDATE');
  IF n < 2 THEN RAISE EXCEPTION 'work_items has % permissive write policies; RESTRICTIVE alone grants nothing', n; END IF;

  -- 3. ...and a RESTRICTIVE one for each.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='projects' AND tablename='work_items'
     AND permissive='RESTRICTIVE' AND cmd IN ('INSERT','UPDATE');
  IF n < 2 THEN RAISE EXCEPTION 'work_items has % restrictive write policies, expected 2', n; END IF;

  -- 4. No DELETE policy anywhere: an item becomes void, it never disappears.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='projects' AND tablename='work_items' AND cmd='DELETE';
  IF n <> 0 THEN RAISE EXCEPTION 'work_items has a DELETE policy'; END IF;
  -- 4b. The event log has a SELECT policy and NO write policy (ruling 2 in the
  --     plan preamble): an INSERT policy here would let a client forge the
  --     audit trail — PR #160 defect 6 in a new place.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='projects' AND tablename='work_item_events' AND cmd <> 'SELECT';
  IF n <> 0 THEN RAISE EXCEPTION 'work_item_events has % write policy/policies; it is written only by the §11 definer trigger', n; END IF;
END $$;

-- Seed rows while still postgres. On the contractor's project: one they hold,
-- one they do not (the PM holds it). On the client viewer's project: one they
-- hold, one they do not. Plus one event per client-viewer item, standing in
-- for what §11's trigger will write, so work_item_events_select has rows to
-- be right and wrong about.
DO $$
DECLARE f record; c record; v uuid;
BEGIN
  SELECT * INTO f FROM _f;
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (f.organisation_id, f.project_id, 'task', 'contractor holds this', f.contractor_id, f.pm_id, f.pm_id)
  RETURNING id INTO v;
  INSERT INTO _seed VALUES ('mine', v);
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (f.organisation_id, f.project_id, 'task', 'pm holds this on the contractor project', f.pm_id, f.pm_id, f.pm_id)
  RETURNING id INTO v;
  INSERT INTO _seed VALUES ('pm_item', v);

  SELECT * INTO c FROM _cv;
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (c.organisation_id, c.project_id, 'task', 'client viewer holds this', c.user_id, c.pm_id, c.pm_id)
  RETURNING id INTO v;
  INSERT INTO _seed VALUES ('cv_mine', v);
  INSERT INTO projects.work_item_events
    (work_item_id, project_id, organisation_id, verb, to_status, actor_id, to_ball_in_court_id)
  VALUES (v, c.project_id, c.organisation_id, 'created', 'triage', c.pm_id, c.user_id);

  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (c.organisation_id, c.project_id, 'task', 'not the client viewers', c.pm_id, c.pm_id, c.pm_id)
  RETURNING id INTO v;
  INSERT INTO _seed VALUES ('theirs', v);
  INSERT INTO projects.work_item_events
    (work_item_id, project_id, organisation_id, verb, to_status, actor_id, to_ball_in_court_id)
  VALUES (v, c.project_id, c.organisation_id, 'created', 'triage', c.pm_id, c.pm_id);
END $$;

-- ── The contractor ──────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub','018f2d31-bbe8-4cc1-bbdd-63af0187081e','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE f record; n int; v_id uuid; v_pm_item uuid; v_theirs uuid; v_new uuid; v_ref text;
BEGIN
  -- 5a. The fixture itself must be readable in this role, or every assertion
  --     below dies on its first statement and the file proves nothing. The
  --     SELECT itself raises 42501 without the grant, so it is caught and
  --     re-raised with the fix in the message.
  BEGIN
    PERFORM 1 FROM _f;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'fixture _f is unreadable as authenticated — add GRANT SELECT ON _f TO authenticated';
  END;
  SELECT * INTO f FROM _f;
  IF auth.uid() IS DISTINCT FROM f.contractor_id THEN
    RAISE EXCEPTION 'impersonation did not take: auth.uid() is %', auth.uid();
  END IF;
  SELECT id INTO v_pm_item FROM _seed WHERE label = 'pm_item';
  SELECT id INTO v_theirs  FROM _seed WHERE label = 'theirs';

  -- 5b. The contractor can SEE the item they hold.
  SELECT id INTO v_id FROM projects.work_items WHERE title='contractor holds this';
  IF v_id IS NULL THEN RAISE EXCEPTION 'the assignee cannot see their own work item — the worst failure an inbox can have'; END IF;
  -- 5c. ...and, as a project member who is NOT a client viewer, an item on
  --     their project they neither hold nor gatekeep nor watch: the
  --     project-access arm. Narrower would give a user who sees the RFI in the
  --     module list but not its work item.
  IF NOT EXISTS (SELECT 1 FROM projects.work_items WHERE id = v_pm_item) THEN
    RAISE EXCEPTION 'a non-client-viewer project member cannot see a project item they do not hold — the project-access arm of work_items_select is gone';
  END IF;
  -- 5d. ...but NOTHING on a project they are not a member of.
  IF EXISTS (SELECT 1 FROM projects.work_items WHERE id = v_theirs) THEN
    RAISE EXCEPTION 'a non-member can see a work item on a project they are not on';
  END IF;

  -- 6. They can create a TASK: the only client-insertable type in Q1, and
  --    task.write_roles admits contractor (§1 seed). Born 'triage' by default,
  --    and the allocator, not the client, names it.
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (f.organisation_id, f.project_id, 'task', 'contractor task', f.contractor_id, f.pm_id, f.contractor_id)
  RETURNING id INTO v_new;
  SELECT ref INTO v_ref FROM projects.work_items WHERE id = v_new;
  IF v_ref !~ '^TASK-[0-9]+$' THEN RAISE EXCEPTION 'a contractor task was allocated ref %', v_ref; END IF;
  IF (SELECT status FROM projects.work_items WHERE id = v_new) <> 'triage' THEN
    RAISE EXCEPTION 'a task inserted without a status is not born triage';
  END IF;
  -- 6b. ...and born 'open' when the writer says so: createWorkItemTaskAction
  --     (Task 13) inserts status = 'open' as a server-side literal — §03 §1.6,
  --     a named assignee — and the gate's status arm must admit it.
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, status)
  VALUES (f.organisation_id, f.project_id, 'task', 'contractor task born open', f.contractor_id, f.pm_id, f.contractor_id, 'open');

  -- 7. They CANNOT create a mirrored type directly. The source row is the only
  --    entry point; a direct insert naming a mirrored key is refused by the
  --    RESTRICTIVE gate. The rfi_id is real and was captured as postgres.
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, rfi_id)
    VALUES (f.organisation_id, f.project_id, 'rfi', 'forged rfi item', f.contractor_id, f.pm_id, f.contractor_id, f.rfi_id);
    RAISE EXCEPTION 'SENTINEL: a client inserted a MIRRORED work item directly';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      RAISE EXCEPTION 'the mirrored-insert case failed for the wrong reason: %', SQLERRM;
  END;

  -- 7b. A client-supplied junk ref is refused. The allocator passes an
  --     explicit ref through untouched, ref is immutable (§12) and rows are
  --     never deleted, so 'JUNK' would be a permanent row §6's suffix filter
  --     must dodge forever. WITH CHECK runs after the BEFORE triggers, so the
  --     allocator's own output always passes this arm.
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, ref)
    VALUES (f.organisation_id, f.project_id, 'task', 'junk ref', f.contractor_id, f.pm_id, f.contractor_id, 'JUNK');
    RAISE EXCEPTION 'SENTINEL: a client supplied the ref JUNK and it was accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      RAISE EXCEPTION 'the junk-ref case failed for the wrong reason: %', SQLERRM;
  END;

  -- 7c. Born VOID is refused by the gate: a client cannot manufacture a row
  --     with no events behind it (metrics 4, 7) and a void_reason nobody wrote.
  --     §12's guard is BEFORE UPDATE only; this arm is the INSERT half.
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, status, void_reason)
    VALUES (f.organisation_id, f.project_id, 'task', 'born void', f.contractor_id, f.pm_id, f.contractor_id, 'void', 'forged');
    RAISE EXCEPTION 'SENTINEL: a client inserted a born-void work item';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      RAISE EXCEPTION 'the born-void case failed for the wrong reason: %', SQLERRM;
  END;
  -- 7d. Born CLOSED likewise — metric 7 counts a user moving an item TO closed.
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, status)
    VALUES (f.organisation_id, f.project_id, 'task', 'born closed', f.contractor_id, f.pm_id, f.contractor_id, 'closed');
    RAISE EXCEPTION 'SENTINEL: a client inserted a born-closed work item';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      RAISE EXCEPTION 'the born-closed case failed for the wrong reason: %', SQLERRM;
  END;

  -- 8. They cannot forge created_by.
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
    VALUES (f.organisation_id, f.project_id, 'task', 'forged author', f.contractor_id, f.pm_id, f.pm_id);
    RAISE EXCEPTION 'SENTINEL: created_by was forgeable';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      RAISE EXCEPTION 'the created_by case failed for the wrong reason: %', SQLERRM;
  END;

  -- 9. They cannot bind the row to a FOREIGN organisation — the site-form
  --    org-hop (PR #160 defect 3) in a new place. The foreign org id is real
  --    and was captured as postgres; under this role the fixture sees one org.
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
    VALUES (f.foreign_org_id, f.project_id, 'task', 'org hop', f.contractor_id, f.pm_id, f.contractor_id);
    RAISE EXCEPTION 'SENTINEL: organisation_id was not bound to the project''s own org';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      RAISE EXCEPTION 'the org-hop case failed for the wrong reason: %', SQLERRM;
  END;
  -- 9b. ...nor re-bind it by UPDATE. The PERMISSIVE work_items_update WITH
  --     CHECK is the binding layer on UPDATE (the RESTRICTIVE gate's WITH
  --     CHECK does not repeat it — RESTRICTIVE and PERMISSIVE checks are ANDed,
  --     so one clause suffices). Once §12's guard (Task 11) makes
  --     organisation_id immutable it fires BEFORE this WITH CHECK and refuses
  --     the same update with a sentence; either refusal is the right refusal,
  --     so a non-SENTINEL raise_exception is accepted here too.
  BEGIN
    UPDATE projects.work_items SET organisation_id = f.foreign_org_id WHERE id = v_id;
    IF FOUND THEN RAISE EXCEPTION 'SENTINEL: organisation_id was re-bound to a foreign org by UPDATE'; END IF;
    RAISE EXCEPTION 'SENTINEL: the org re-bind UPDATE matched no row — the item the contractor holds is not updatable by them';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
  END;

  -- 9c. The POSITIVE update paths. The assignee moves their own item (the
  --     identity arm of both UPDATE policies; Task 10's event sequence and
  --     every Task 13 verb depend on it)...
  UPDATE projects.work_items SET status = 'open' WHERE id = v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'the assignee cannot update the item they hold'; END IF;
  IF (SELECT status FROM projects.work_items WHERE id = v_id) <> 'open' THEN
    RAISE EXCEPTION 'the assignee''s update matched a row but did not take';
  END IF;
  -- 9d. ...and a holder of the type's write role edits a project item they do
  --     not hold (the registry arm of work_items_update_gate).
  UPDATE projects.work_items SET priority = 'high' WHERE id = v_pm_item;
  IF NOT FOUND THEN RAISE EXCEPTION 'a task write-role holder cannot edit a project task they do not hold — the write-role arm of work_items_update_gate is gone'; END IF;

  -- 10. They cannot DELETE, which is what keeps refs monotonic. No policy AND
  --     the grant is revoked, so this is a permission error, not a zero-row
  --     update.
  BEGIN
    DELETE FROM projects.work_items WHERE id = v_id;
    IF FOUND THEN RAISE EXCEPTION 'SENTINEL: a work item was DELETED by a client'; END IF;
    RAISE EXCEPTION 'SENTINEL: the DELETE was a silent zero-row statement — the authenticated DELETE grant is back';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      RAISE EXCEPTION 'the delete case failed for the wrong reason: %', SQLERRM;
  END;

  -- 11. They cannot write work_item_events directly — no INSERT policy exists
  --     AND the INSERT grant is revoked, so this is a permission error.
  BEGIN
    INSERT INTO projects.work_item_events
      (work_item_id, project_id, organisation_id, verb, to_status, actor_id)
    VALUES (v_id, f.project_id, f.organisation_id, 'closed', 'closed', f.pm_id);
    RAISE EXCEPTION 'SENTINEL: a client forged a work_item_events row';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      RAISE EXCEPTION 'the event-forgery case failed for the wrong reason: %', SQLERRM;
  END;

  -- 11b. Watchers, the positive paths: they can follow an item they can read
  --      (the self arm of work_item_watchers_insert)...
  INSERT INTO projects.work_item_watchers (work_item_id, user_id, reason) VALUES (v_pm_item, f.contractor_id, 'manual');
  -- 11c. ...a holder of the type's write role can add someone else...
  INSERT INTO projects.work_item_watchers (work_item_id, user_id, reason) VALUES (v_id, f.pm_id, 'manual');
  -- 11d. ...and both arms of work_item_watchers_delete answer: their own row,
  --      and — with the write role — another person's.
  DELETE FROM projects.work_item_watchers WHERE work_item_id = v_pm_item AND user_id = f.contractor_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'a user cannot unfollow an item (self arm of work_item_watchers_delete)'; END IF;
  DELETE FROM projects.work_item_watchers WHERE work_item_id = v_id AND user_id = f.pm_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'a write-role holder cannot remove another watcher (write-role arm of work_item_watchers_delete)'; END IF;
  -- 11e. ...but nobody follows an item they cannot read.
  BEGIN
    INSERT INTO projects.work_item_watchers (work_item_id, user_id, reason) VALUES (v_theirs, f.contractor_id, 'manual');
    RAISE EXCEPTION 'SENTINEL: a non-member subscribed to a work item they cannot read';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      RAISE EXCEPTION 'the watch-unreadable case failed for the wrong reason: %', SQLERRM;
  END;

  RAISE NOTICE 'work-item-rls (contractor): 5-11 passed';
END $$;

RESET ROLE;

-- ── The client viewer: sees only what they hold or watch, writes nothing ────
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT user_id FROM _cv), 'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE c record; v_mine uuid; v_theirs uuid; n int;
BEGIN
  -- 12a. As 5a.
  BEGIN
    PERFORM 1 FROM _cv;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'fixture _cv is unreadable as authenticated — add GRANT SELECT ON _cv TO authenticated';
  END;
  SELECT * INTO c FROM _cv;
  IF auth.uid() IS DISTINCT FROM c.user_id THEN
    RAISE EXCEPTION 'impersonation did not take: auth.uid() is %', auth.uid();
  END IF;
  SELECT id INTO v_theirs FROM _seed WHERE label = 'theirs';

  -- 12. They CAN see an item they hold. The landlord is frequently the
  --     ball-in-court, and an inbox they cannot read is not an inbox.
  SELECT id INTO v_mine FROM projects.work_items WHERE title='client viewer holds this';
  IF v_mine IS NULL THEN RAISE EXCEPTION 'a client_viewer cannot see the item they are assigned'; END IF;

  -- 13. They CANNOT see a project-wide item they do not hold or watch. This is
  --     PR #162's defect in a new place: user_has_project_access() is TRUE for
  --     ANY project_members row regardless of role (00106 clause (a)) — and it
  --     IS true for this fixture, which is what lets this assertion fail.
  IF EXISTS (SELECT 1 FROM projects.work_items WHERE id = v_theirs) THEN
    RAISE EXCEPTION 'a client_viewer can list every work item on the project — the saved-report read gap (PR #162) re-opened on work_items';
  END IF;

  -- 14. They cannot WRITE, even to the item they hold. work_items_update_gate
  --     is the ONLY layer here: 00161 covers a fixed list of 13 tables and does
  --     not cover work_items.
  UPDATE projects.work_items SET status='open' WHERE id = v_mine;
  IF FOUND THEN RAISE EXCEPTION 'a client_viewer wrote to work_items in Q1'; END IF;
  IF (SELECT status FROM projects.work_items WHERE id = v_mine) <> 'triage' THEN
    RAISE EXCEPTION 'the client_viewer''s update took effect despite FOUND being false';
  END IF;
  -- 14b. Nor INSERT: no registered type admits client_viewer in write_roles
  --      (§1 seed, registry assertion 3), so work_items_insert_gate refuses
  --      them — the other half of the one-layer client-viewer write block.
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
    VALUES (c.organisation_id, c.project_id, 'task', 'client viewer task', c.user_id, c.pm_id, c.user_id);
    RAISE EXCEPTION 'SENTINEL: a client_viewer inserted a work item in Q1';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      RAISE EXCEPTION 'the client-viewer insert case failed for the wrong reason: %', SQLERRM;
  END;

  -- 15. Read the history if you can read the item...
  SELECT count(*) INTO n FROM projects.work_item_events e WHERE e.work_item_id = v_mine;
  IF n = 0 THEN RAISE EXCEPTION 'a client_viewer cannot read the history of the item they hold'; END IF;
  -- 16. ...and only then. Every other event on the platform is invisible.
  SELECT count(*) INTO n FROM projects.work_item_events e WHERE e.work_item_id <> v_mine;
  IF n <> 0 THEN RAISE EXCEPTION 'a client_viewer can read % event(s) of items they do not hold — work_item_events_select is wider than work_items_select', n; END IF;

  -- 17. They can follow the item they hold (the self arm)...
  INSERT INTO projects.work_item_watchers (work_item_id, user_id, reason) VALUES (v_mine, c.user_id, 'manual');
  -- 18. ...but cannot add anyone else: no write role.
  BEGIN
    INSERT INTO projects.work_item_watchers (work_item_id, user_id, reason) VALUES (v_mine, c.pm_id, 'manual');
    RAISE EXCEPTION 'SENTINEL: a client_viewer subscribed another person to a work item';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      RAISE EXCEPTION 'the client-viewer add-watcher case failed for the wrong reason: %', SQLERRM;
  END;
  -- 19. ...nor follow an item they cannot read.
  BEGIN
    INSERT INTO projects.work_item_watchers (work_item_id, user_id, reason) VALUES (v_theirs, c.user_id, 'manual');
    RAISE EXCEPTION 'SENTINEL: a client_viewer subscribed to a work item they cannot read';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      RAISE EXCEPTION 'the client-viewer watch-unreadable case failed for the wrong reason: %', SQLERRM;
  END;

  RAISE NOTICE 'work-item-rls (client_viewer): 12-19 passed';
END $$;

RESET ROLE;

-- §11 will add the incoming holder as a watcher on reassign; until then the
-- watcher arm of work_items_select is exercised with a row written here.
INSERT INTO projects.work_item_watchers (work_item_id, user_id, reason)
SELECT s.id, c.user_id, 'manual' FROM _seed s, _cv c WHERE s.label = 'theirs';

SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT user_id FROM _cv), 'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE v_theirs uuid; n int;
BEGIN
  SELECT id INTO v_theirs FROM _seed WHERE label = 'theirs';
  -- 20. A watcher sees the item — the arm §11 populates and item 4 fans out on.
  IF NOT EXISTS (SELECT 1 FROM projects.work_items WHERE id = v_theirs) THEN
    RAISE EXCEPTION 'a watcher cannot see the item they watch — the watcher arm of work_items_select is gone';
  END IF;
  -- 21. ...and its history.
  SELECT count(*) INTO n FROM projects.work_item_events e WHERE e.work_item_id = v_theirs;
  IF n = 0 THEN RAISE EXCEPTION 'a watcher cannot read the history of the item they watch'; END IF;

  RAISE NOTICE 'work-item-rls (watcher): 20-21 passed';
END $$;

RESET ROLE;
