-- Assertions for 00196 §8-§10: the two helpers, the RLS policy set, the grants
-- and the anon revokes. Run inside the rolled-back transaction opened by
-- try-work-item-spine.sh.
--
-- Three roles act, and every role-scoped block acts as a REAL user — the only
-- way a role assertion can fail:
--   * postgres — the structural checks (0-4), the seed rows, and one extra
--     watcher row (20-21) beside what §11's append trigger writes itself;
--   * the rbac-test contractor — 018f2d31-bbe8-4cc1-bbdd-63af0187081e,
--     contractor on WM-Consulting and (643) KINGSWALK, the permanent prod RBAC
--     fixture (CLAUDE.md "Key gotchas": never invite it, never email it) —
--     the write gate and every positive path through it (5-11);
--   * the oldest active client_viewer on the oldest ACTIVE project that HAS one
--     — measured 2026-09-12: three on (657) MAMAILA PHASE 2; KINGSWALK, the
--     oldest active project, has ten members and zero client viewers — the
--     read carve-out and the write block (12-21), then the same person with
--     their membership DEACTIVATED (22).
--
-- ⚠ A temp table created as postgres is unreadable after SET LOCAL ROLE
-- authenticated (42501 "permission denied for table _f", proven against
-- production). Every fixture table is GRANTed to authenticated, and the grant
-- is asserted first in every role-scoped block: without it that block dies on
-- its first statement and proves nothing.
--
-- ⚠ Every id a role-scoped block needs is captured HERE, as postgres — rfi_id
-- (7), foreign_org_id (9, 9b) and the two inspection ids (9e, 9f) in
-- particular. Under the contractor's role projects.rfis and
-- public.organisations are RLS-filtered (organisations is members-only, and
-- the fixture is in ONE of the 7 orgs), so an INSERT … SELECT from either
-- would select zero rows, insert nothing, and trip the SENTINEL — a false red
-- that reads like a policy failure. The prelude RAISEs if any capture is NULL
-- rather than letting that happen.
--
-- ⚠ set_config(…, true) is TRANSACTION-local, so after the first
-- impersonation auth.uid() stays set even under RESET ROLE. Every row the
-- postgres blocks seed is therefore seeded BEFORE the first SET LOCAL ROLE —
-- §5's opened_at stamp keys on auth.uid() IS NOT NULL.
CREATE TEMP TABLE _f AS
SELECT pm.project_id, p.organisation_id,
       '018f2d31-bbe8-4cc1-bbdd-63af0187081e'::uuid AS contractor_id,
       projects.resolve_project_pm(pm.project_id) AS pm_id,
       (SELECT r.id FROM projects.rfis r WHERE r.project_id = pm.project_id
         ORDER BY r.created_at, r.id LIMIT 1) AS rfi_id,
       (SELECT o.id FROM public.organisations o WHERE o.id <> p.organisation_id
         ORDER BY o.created_at, o.id LIMIT 1) AS foreign_org_id,
       -- inspection.write_roles = owner/admin/project_manager: the contractor
       -- holds NO write role for this type, so only an identity arm can admit
       -- them to an UPDATE of an inspection item (9e, 9f). Two ids, because
       -- work_items_src_inspection_uidx allows one mirror row per inspection.
       (SELECT i.id FROM inspections.inspections i WHERE i.project_id = pm.project_id
         ORDER BY i.created_at, i.id LIMIT 1) AS inspection_id,
       (SELECT i.id FROM inspections.inspections i WHERE i.project_id = pm.project_id
         ORDER BY i.created_at, i.id LIMIT 1 OFFSET 1) AS inspection_id_2
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
-- is NOT allowed to see (5d, 11e, 19, 22) without a title lookup that RLS
-- would turn into NULL.
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
  IF f.inspection_id IS NULL OR f.inspection_id_2 IS NULL THEN
    RAISE EXCEPTION 'fewer than two inspections on the fixture project % — 9e/9f (the UPDATE identity arms, exercised on a type the contractor cannot write) have no fixture', f.project_id;
  END IF;
  -- The fixture's org role is contractor. Were it ever elevated to
  -- owner/admin/PM, user_has_project_access() clause (b) would admit it to
  -- EVERY project in the org and 5d/11e/11f would go red for a reason that is
  -- not a policy defect. Pinned, so the failure names the cause.
  IF public.user_effective_project_role(f.project_id, f.contractor_id) IS DISTINCT FROM 'contractor' THEN
    RAISE EXCEPTION 'the rbac-test fixture''s effective role on % is % rather than contractor — the write-gate assertions assume a contractor',
      f.project_id, public.user_effective_project_role(f.project_id, f.contractor_id);
  END IF;
  -- 9e/9f rely on inspection.write_roles EXCLUDING contractor (§1 seed). If a
  -- later migration widens it, those two stop exercising the identity arms.
  IF EXISTS (SELECT 1 FROM projects.work_item_types t
              WHERE t.key = 'inspection' AND 'contractor' = ANY (t.write_roles)) THEN
    RAISE EXCEPTION 'inspection.write_roles now admits contractor — 9e/9f no longer isolate the UPDATE identity arms; pick a type that excludes contractor';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM _cv) THEN
    RAISE EXCEPTION 'no active client_viewer (effective role client_viewer, active org membership) on any active project; the client-viewer read and write assertions cannot fail and would be decorative. Create one inside this transaction rather than skipping them.';
  END IF;
  SELECT * INTO c FROM _cv;
  IF c.pm_id IS NULL THEN
    RAISE EXCEPTION 'resolve_project_pm(%) is NULL — the client-viewer project has nobody to gatekeep', c.project_id;
  END IF;
  -- 5d, 11e and 11f need the contractor to be a NON-member of the
  -- client-viewer project (true today, measured). Pinned so it cannot weaken
  -- silently.
  IF EXISTS (SELECT 1 FROM projects.project_members pm
              WHERE pm.project_id = c.project_id AND pm.user_id = f.contractor_id AND pm.is_active) THEN
    RAISE EXCEPTION 'the rbac-test fixture is now a member of the client-viewer project % — 5d/11e/11f (a non-member sees nothing) would pass for the wrong reason; pick a different client-viewer project', c.project_id;
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

  -- 0c. Every function §8 revokes must EXIST — has_function_privilege on a
  --     missing one aborts the transaction with a message about the wrong
  --     thing — and anon must hold no EXECUTE on any of the eight. This
  --     includes the three trigger functions: has_function_privilege('anon',
  --     …) was TRUE on all of them before §8 (measured), because a new
  --     function in projects inherits Postgres's built-in PUBLIC EXECUTE.
  --     (alias fn, not f: the record variable f above would shadow a table
  --     alias of the same name inside plpgsql — 42703 `record "f" has no
  --     field "sig"`.)
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
  --     the append-only event log, every write on the registry, and UPDATE on
  --     watchers (no UPDATE policy exists, and a standing grant with no policy
  --     is the silent zero-row shape §10 exists to avoid).
  SELECT count(*) INTO n FROM (VALUES
      ('projects.work_items','DELETE'),        ('projects.work_item_events','DELETE'),
      ('projects.work_item_events','INSERT'),  ('projects.work_item_events','UPDATE'),
      ('projects.work_item_types','INSERT'),   ('projects.work_item_types','UPDATE'),
      ('projects.work_item_types','DELETE'),   ('projects.work_item_watchers','UPDATE')) t(rel, priv)
   WHERE has_table_privilege('authenticated', t.rel, t.priv);
  IF n <> 0 THEN RAISE EXCEPTION 'authenticated still holds % of the 8 privileges §10 revokes', n; END IF;
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

-- Seed rows while still postgres (and before any impersonation — see the
-- header). On the contractor's project: one they hold, one the PM holds, and
-- two INSPECTION items — a type they hold no write role for — one where they
-- are the assignee (born open, ball with them) and one where they are the
-- gatekeeper (born answered, ball with them). On the client viewer's project:
-- one they hold, and two they do not — one of which they will WATCH (20-21)
-- and one they never touch (13, 22). §11's trigger writes a 'created' event
-- for each, which is what work_item_events_select has to be right and wrong
-- about (15, 16, 21, 22c).
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
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, inspection_id, status)
  VALUES (f.organisation_id, f.project_id, 'inspection', 'inspection held by contractor', f.contractor_id, f.pm_id, f.pm_id, f.inspection_id, 'open')
  RETURNING id INTO v;
  INSERT INTO _seed VALUES ('insp_assignee', v);
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, inspection_id, status)
  VALUES (f.organisation_id, f.project_id, 'inspection', 'inspection gatekept by contractor', f.pm_id, f.contractor_id, f.pm_id, f.inspection_id_2, 'answered')
  RETURNING id INTO v;
  INSERT INTO _seed VALUES ('insp_gatekeeper', v);

  SELECT * INTO c FROM _cv;
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (c.organisation_id, c.project_id, 'task', 'client viewer holds this', c.user_id, c.pm_id, c.pm_id)
  RETURNING id INTO v;
  INSERT INTO _seed VALUES ('cv_mine', v);

  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (c.organisation_id, c.project_id, 'task', 'not the client viewers', c.pm_id, c.pm_id, c.pm_id)
  RETURNING id INTO v;
  INSERT INTO _seed VALUES ('theirs', v);

  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (c.organisation_id, c.project_id, 'task', 'not the client viewers either', c.pm_id, c.pm_id, c.pm_id)
  RETURNING id INTO v;
  INSERT INTO _seed VALUES ('theirs2', v);
END $$;

-- ── The contractor ──────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub','018f2d31-bbe8-4cc1-bbdd-63af0187081e','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE f record; c record; n int; v_id uuid; v_pm_item uuid; v_theirs uuid; v_new uuid; v_ref text;
        v_insp_a uuid; v_insp_g uuid; v_opened timestamptz; v_last timestamptz;
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
  SELECT * INTO c FROM _cv;
  IF auth.uid() IS DISTINCT FROM f.contractor_id THEN
    RAISE EXCEPTION 'impersonation did not take: auth.uid() is %', auth.uid();
  END IF;
  SELECT id INTO v_pm_item FROM _seed WHERE label = 'pm_item';
  SELECT id INTO v_theirs  FROM _seed WHERE label = 'theirs';
  SELECT id INTO v_insp_a  FROM _seed WHERE label = 'insp_assignee';
  SELECT id INTO v_insp_g  FROM _seed WHERE label = 'insp_gatekeeper';

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
  --    and the allocator, not the client, names it. origin = 'manual' is what
  --    every client insert must say (gate arm (d)); createWorkItemTaskAction
  --    (Task 13) does.
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, origin)
  VALUES (f.organisation_id, f.project_id, 'task', 'contractor task', f.contractor_id, f.pm_id, f.contractor_id, 'manual')
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
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, origin, status)
  VALUES (f.organisation_id, f.project_id, 'task', 'contractor task born open', f.contractor_id, f.pm_id, f.contractor_id, 'manual', 'open');
  -- 6c. opened_at and last_activity_at are STAMPED by §5's trigger for any
  --     client session (auth.uid() IS NOT NULL): a client never dictates the
  --     opening moment — a 400-day backdate would pre-age every escalation
  --     and a future last_activity_at would hide the item from every "stale"
  --     query. WITH CHECK cannot pin a timestamp, so the trigger does.
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, origin, status,
     opened_at, last_activity_at)
  VALUES (f.organisation_id, f.project_id, 'task', 'backdated task', f.contractor_id, f.pm_id, f.contractor_id, 'manual', 'open',
          now() - interval '400 days', now() + interval '400 days')
  RETURNING id INTO v_new;
  SELECT opened_at, last_activity_at INTO v_opened, v_last FROM projects.work_items WHERE id = v_new;
  IF v_opened IS NULL OR abs(EXTRACT(EPOCH FROM (v_opened - now()))) > 60 THEN
    RAISE EXCEPTION 'a client backdated opened_at by 400 days and it was accepted: % — §5 must stamp it for a client session', v_opened;
  END IF;
  IF v_last IS NULL OR abs(EXTRACT(EPOCH FROM (v_last - now()))) > 60 THEN
    RAISE EXCEPTION 'a client set last_activity_at 400 days ahead and it was accepted: % — §5 must stamp it for a client session', v_last;
  END IF;

  -- 7. They CANNOT create a mirrored type directly. The source row is the only
  --    entry point; a direct insert naming a mirrored key is refused by the
  --    RESTRICTIVE gate. The rfi_id is real and was captured as postgres.
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, origin, rfi_id)
    VALUES (f.organisation_id, f.project_id, 'rfi', 'forged rfi item', f.contractor_id, f.pm_id, f.contractor_id, 'manual', f.rfi_id);
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
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, origin, ref)
    VALUES (f.organisation_id, f.project_id, 'task', 'junk ref', f.contractor_id, f.pm_id, f.contractor_id, 'manual', 'JUNK');
    RAISE EXCEPTION 'SENTINEL: a client supplied the ref JUNK and it was accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      RAISE EXCEPTION 'the junk-ref case failed for the wrong reason: %', SQLERRM;
  END;

  -- 7c. Born VOID is refused by the gate: a client cannot manufacture a row
  --     with no events behind it (metrics 4, 7). §12's guard is BEFORE UPDATE
  --     only; this arm is the INSERT half. No void_reason is supplied here,
  --     so the STATUS arm alone is what refuses it (7g covers void_reason).
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, origin, status)
    VALUES (f.organisation_id, f.project_id, 'task', 'born void', f.contractor_id, f.pm_id, f.contractor_id, 'manual', 'void');
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
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, origin, status)
    VALUES (f.organisation_id, f.project_id, 'task', 'born closed', f.contractor_id, f.pm_id, f.contractor_id, 'manual', 'closed');
    RAISE EXCEPTION 'SENTINEL: a client inserted a born-closed work item';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      RAISE EXCEPTION 'the born-closed case failed for the wrong reason: %', SQLERRM;
  END;
  -- 7e-7g. The closure columns are the transition guard's (§12) to write, on
  --        the UPDATE that closes or voids — a client cannot pre-fill them on
  --        a born-open row (each column alone, so each arm is what refuses).
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, origin, status, closed_at)
    VALUES (f.organisation_id, f.project_id, 'task', 'pre-closed', f.contractor_id, f.pm_id, f.contractor_id, 'manual', 'open', now());
    RAISE EXCEPTION 'SENTINEL: a client supplied closed_at on a born-open work item';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      RAISE EXCEPTION 'the closed_at case failed for the wrong reason: %', SQLERRM;
  END;
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, origin, status, closed_by)
    VALUES (f.organisation_id, f.project_id, 'task', 'pre-closed by', f.contractor_id, f.pm_id, f.contractor_id, 'manual', 'open', f.pm_id);
    RAISE EXCEPTION 'SENTINEL: a client supplied closed_by on a born-open work item';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      RAISE EXCEPTION 'the closed_by case failed for the wrong reason: %', SQLERRM;
  END;
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, origin, status, void_reason)
    VALUES (f.organisation_id, f.project_id, 'task', 'pre-voided', f.contractor_id, f.pm_id, f.contractor_id, 'manual', 'open', 'forged');
    RAISE EXCEPTION 'SENTINEL: a client supplied void_reason on a born-open work item';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      RAISE EXCEPTION 'the void_reason case failed for the wrong reason: %', SQLERRM;
  END;
  -- 7h-7j. origin is gated: a client insert is 'manual' or nothing. The
  --        column DEFAULTS to 'mirror' (the source-driven case), so an insert
  --        that omits origin would otherwise be recorded as a mirror of a
  --        source it does not have, and 'split' is item 3's deliberate
  --        construction, never a client's.
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
    VALUES (f.organisation_id, f.project_id, 'task', 'origin defaulted', f.contractor_id, f.pm_id, f.contractor_id);
    RAISE EXCEPTION 'SENTINEL: a client insert with origin left to its default (mirror) was accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      RAISE EXCEPTION 'the origin-default case failed for the wrong reason: %', SQLERRM;
  END;
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, origin)
    VALUES (f.organisation_id, f.project_id, 'task', 'origin mirror', f.contractor_id, f.pm_id, f.contractor_id, 'mirror');
    RAISE EXCEPTION 'SENTINEL: a client inserted a work item claiming origin = mirror';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      RAISE EXCEPTION 'the origin-mirror case failed for the wrong reason: %', SQLERRM;
  END;
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, origin)
    VALUES (f.organisation_id, f.project_id, 'task', 'origin split', f.contractor_id, f.pm_id, f.contractor_id, 'split');
    RAISE EXCEPTION 'SENTINEL: a client inserted a work item claiming origin = split';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      RAISE EXCEPTION 'the origin-split case failed for the wrong reason: %', SQLERRM;
  END;

  -- 8. They cannot forge created_by.
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, origin)
    VALUES (f.organisation_id, f.project_id, 'task', 'forged author', f.contractor_id, f.pm_id, f.pm_id, 'manual');
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
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, origin)
    VALUES (f.foreign_org_id, f.project_id, 'task', 'org hop', f.contractor_id, f.pm_id, f.contractor_id, 'manual');
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
  --     so one clause suffices). §12's guard makes organisation_id immutable
  --     and, as a BEFORE trigger, fires BEFORE this WITH CHECK — so the refusal
  --     a user sees is the guard's sentence, and that sentence is pinned here.
  --     A guard that lost clause (a) would fall through to the WITH CHECK
  --     (42501); that is the layer beneath, and it reads as a wrong reason
  --     rather than as "either refusal", so the guard cannot go missing
  --     unnoticed. (Before Task 11 this branch accepted any non-SENTINEL
  --     raise_exception and tolerated 42501 — dead code then, live now.)
  BEGIN
    UPDATE projects.work_items SET organisation_id = f.foreign_org_id WHERE id = v_id;
    IF FOUND THEN RAISE EXCEPTION 'SENTINEL: organisation_id was re-bound to a foreign org by UPDATE'; END IF;
    RAISE EXCEPTION 'SENTINEL: the org re-bind UPDATE matched no row — the item the contractor holds is not updatable by them';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'the org re-bind UPDATE was refused by the WITH CHECK (42501) rather than by §12''s immutability clause, which should fire first';
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE '%cannot be renumbered, retyped or moved%' THEN
        RAISE EXCEPTION 'the org re-bind UPDATE failed for the wrong reason: %', SQLERRM; END IF;
  END;

  -- 9c. The POSITIVE update paths. The assignee moves their own TASK...
  UPDATE projects.work_items SET status = 'open' WHERE id = v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'the assignee cannot update the item they hold'; END IF;
  IF (SELECT status FROM projects.work_items WHERE id = v_id) <> 'open' THEN
    RAISE EXCEPTION 'the assignee''s update matched a row but did not take';
  END IF;
  -- 9d. ...a holder of the type's write role edits a project task they do
  --     not hold (the registry arm of work_items_update_gate)...
  UPDATE projects.work_items SET priority = 'high' WHERE id = v_pm_item;
  IF NOT FOUND THEN RAISE EXCEPTION 'a task write-role holder cannot edit a project task they do not hold — the write-role arm of work_items_update_gate is gone'; END IF;
  -- 9e. ...and the IDENTITY arms answer ON THEIR OWN. 9c cannot prove that:
  --     the contractor is in task.write_roles, so the registry arm admits
  --     them and the assignee arm could vanish unnoticed (reviewer's M6). An
  --     INSPECTION item is a type they hold NO write role for — the assignee
  --     moves it open -> answered (the transition §03 §1.4 gives the assignee;
  --     Task 11's guard keeps it legal)...
  UPDATE projects.work_items SET status = 'answered' WHERE id = v_insp_a;
  IF NOT FOUND THEN RAISE EXCEPTION 'an assignee with no write role for the type cannot update the item they hold — the assignee arm of work_items_update_gate is gone'; END IF;
  IF (SELECT status FROM projects.work_items WHERE id = v_insp_a) <> 'answered' THEN
    RAISE EXCEPTION 'the assignee''s inspection update matched a row but did not take';
  END IF;
  -- 9f. ...and the gatekeeper edits the item whose ball they hold (priority,
  --     not status: what a gatekeeper may do with status is §12's rule set,
  --     and this assertion is about whether the row is theirs to touch at all).
  UPDATE projects.work_items SET priority = 'high' WHERE id = v_insp_g;
  IF NOT FOUND THEN RAISE EXCEPTION 'a gatekeeper with no write role for the type cannot update the item they gatekeep — the gatekeeper arm of work_items_update_gate is gone'; END IF;
  IF (SELECT priority FROM projects.work_items WHERE id = v_insp_g) <> 'high' THEN
    RAISE EXCEPTION 'the gatekeeper''s inspection update matched a row but did not take';
  END IF;

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
  -- 11c. ...a holder of the type's write role can add someone else. §11
  --      already subscribed the PM to v_id as its gatekeeper at creation, so
  --      the write-role arm of work_item_watchers_delete removes that row
  --      first — a bare insert hits the primary key. (ON CONFLICT DO NOTHING
  --      would also pass the policy — Postgres evaluates the INSERT WITH
  --      CHECK before conflict detection, probed in review — but it would
  --      insert nothing and leave the delete arm unexercised.)
  DELETE FROM projects.work_item_watchers WHERE work_item_id = v_id AND user_id = f.pm_id;
  IF NOT FOUND THEN RAISE EXCEPTION '§11 did not subscribe the gatekeeper to the seeded item, or the write-role arm of work_item_watchers_delete is gone'; END IF;
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

  -- 11f. resolve_work_item_assignee() is not an oracle. It is callable by
  --      authenticated (Task 13's people-picker needs it) and SECURITY DEFINER
  --      with RLS off, so without its own access check it answered any project
  --      id with that project's PM uuid — and RAISED for an orphaned one,
  --      which is a yes/no about a project the caller cannot see. For a
  --      project the caller is not on it now returns NULL; for their own it
  --      still answers.
  IF projects.resolve_work_item_assignee(c.project_id, 'task', NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'resolve_work_item_assignee() answered for project % — a project the caller is not on; it is an oracle', c.project_id;
  END IF;
  IF projects.resolve_work_item_assignee(f.project_id, 'task', NULL) IS NULL THEN
    RAISE EXCEPTION 'resolve_work_item_assignee() returned NULL for the caller''s own project % — the access check is too tight', f.project_id;
  END IF;

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
  --     ball-in-court, and an inbox they cannot read is not an inbox. The id
  --     comes from _seed, and they UNFOLLOW the item first (the self arm of
  --     work_item_watchers_delete, for a client viewer): §11 subscribed them
  --     to it as its assignee, and through that row the WATCHER arm would
  --     answer 12-16 even with the holder arm deleted from both the policy
  --     and user_can_read_work_item() — proven in review; the file then died
  --     at 17's re-INSERT with a raw 42501 instead of 12's sentence.
  SELECT id INTO v_mine FROM _seed WHERE label = 'cv_mine';
  DELETE FROM projects.work_item_watchers WHERE work_item_id = v_mine AND user_id = c.user_id;
  IF NOT FOUND THEN RAISE EXCEPTION '§11 did not subscribe the assignee to the item they hold, or the self arm of work_item_watchers_delete is gone for a client viewer'; END IF;
  IF NOT EXISTS (SELECT 1 FROM projects.work_items WHERE id = v_mine) THEN
    RAISE EXCEPTION 'a client_viewer cannot see the item they are assigned';
  END IF;

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
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, origin)
    VALUES (c.organisation_id, c.project_id, 'task', 'client viewer task', c.user_id, c.pm_id, c.user_id, 'manual');
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

  -- 17. They can follow the item they hold (the self arm) — they unfollowed
  --     it at 12, so this is a real insert, not a primary-key collision.
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

-- §11 subscribes the incoming holder on reassign; this file never reassigns
-- the client viewer, so the watcher arm of work_items_select is exercised
-- with a row written here.
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

-- ── The SAME client viewer, membership deactivated ──────────────────────────
-- The platform's "remove from project" is a soft deactivate of the
-- project_members row. public.user_has_project_access() (00106) has NO
-- pm.is_active predicate; user_effective_project_role() requires it. A
-- deactivated client viewer therefore has access TRUE and role NULL — and a
-- `COALESCE(role, '') <> 'client_viewer'` reads NULL as "not a client viewer",
-- admitting them to the project-wide arm of every read (proven on the MAMAILA
-- fixture in review: every item and every event became visible). The four
-- COALESCEs (helper, select, gate USING, gate WITH CHECK) default to
-- 'client_viewer' instead, so an unknown role fails CLOSED.
UPDATE projects.project_members pm SET is_active = false
  FROM _cv c WHERE pm.user_id = c.user_id AND pm.project_id = c.project_id;

SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT user_id FROM _cv), 'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE c record; v_theirs2 uuid; n int;
BEGIN
  SELECT * INTO c FROM _cv;
  SELECT id INTO v_theirs2 FROM _seed WHERE label = 'theirs2';
  -- 22a. The precondition that makes this assertion able to fail: access TRUE
  --      and role NULL. The day 00106 checks is_active, access reads FALSE and
  --      this block stops exercising the NULL-role path — drop it then, do not
  --      leave it passing for a new reason.
  IF NOT public.user_has_project_access(c.project_id) THEN
    RAISE EXCEPTION 'user_has_project_access() is FALSE for a deactivated member — 00106 now checks is_active and 22 no longer exercises the NULL-role path; drop it';
  END IF;
  IF public.user_effective_project_role(c.project_id, auth.uid()) IS NOT NULL THEN
    RAISE EXCEPTION 'a deactivated member still has effective role % — 22 no longer exercises the NULL-role path', public.user_effective_project_role(c.project_id, auth.uid());
  END IF;
  -- 22b. A project-wide item they neither hold nor watch is invisible...
  IF EXISTS (SELECT 1 FROM projects.work_items WHERE id = v_theirs2) THEN
    RAISE EXCEPTION 'a DEACTIVATED client_viewer can see a project-wide work item — a NULL effective role is being read as "not a client viewer"';
  END IF;
  -- 22c. ...and so is its history, through the helper.
  SELECT count(*) INTO n FROM projects.work_item_events e WHERE e.work_item_id = v_theirs2;
  IF n <> 0 THEN
    RAISE EXCEPTION 'a DEACTIVATED client_viewer can read % event(s) of a project-wide item — user_can_read_work_item() reads a NULL role as "not a client viewer"', n;
  END IF;
  IF projects.user_can_read_work_item(v_theirs2) THEN
    RAISE EXCEPTION 'user_can_read_work_item() admits a DEACTIVATED client_viewer to a project-wide item';
  END IF;

  RAISE NOTICE 'work-item-rls (deactivated client_viewer): 22 passed';
END $$;

RESET ROLE;
