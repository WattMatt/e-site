-- Assertions for 00196 §7 (resolve_work_item_assignee and the membership
-- trigger). Run inside the rolled-back transaction opened by
-- try-work-item-spine.sh.
--
-- Two guarantees, both about the person columns:
--   * an item can never point at someone who cannot open it — on INSERT, on
--     reassignment, and on a move to another project (1-4, 10);
--   * a stale settings value never blocks a source write, and the chain raises
--     exactly once, with one actionable sentence, for an ORPHANED project (5-9).
--
-- LIVE-ESTATE fixtures (measured 2026-09-12): the oldest active project is
-- (643) KINGSWALK — 3 active PMs, 17 of 36 profiles with no effective role
-- there; 4 active client_viewer memberships, the oldest on (657) MAMAILA
-- PHASE 2; the Sandton demo project e51ede00-…-0002-000000000001 is active and
-- its creator is a contractor. Every fixture RAISES when it cannot be found: a
-- RAISE NOTICE skip is invisible through the Management API, which returns
-- rows only, and the harness would print a green tick over a no-op.
DO $$
DECLARE
  v_proj uuid; v_org uuid; v_pm uuid; v_outsider uuid;
  v_cv uuid; v_cv_proj uuid; v_cv_org uuid; v_cv_pm uuid; v_res uuid;
  v_demo    uuid := 'e51ede00-0000-0000-0002-000000000001';  -- Sandton demo: org has no owner/admin/PM
  v_fixture uuid := '018f2d31-bbe8-4cc1-bbdd-63af0187081e';  -- rbac-test, the sanctioned prod fixture
  v_tw_org uuid; v_tw_proj uuid;   -- the throwaway ORPHANED project (3b, 9)
  v_col text;                      -- COLUMN_NAME from GET STACKED DIAGNOSTICS (10)
BEGIN
  SELECT p.id, p.organisation_id INTO v_proj, v_org
    FROM projects.projects p WHERE p.status='active' ORDER BY p.created_at LIMIT 1;
  IF v_proj IS NULL THEN RAISE EXCEPTION 'no active project — every insert below needs one'; END IF;
  v_pm := projects.resolve_project_pm(v_proj);
  IF v_pm IS NULL THEN
    RAISE EXCEPTION 'resolve_project_pm(%) returned NULL — the oldest active project has nobody who can own work', v_proj;
  END IF;
  -- Every insert runs work_items_set_due_date -> add_working_days, which raises
  -- no_data_found on an unseeded year. Rolled back with everything else.
  INSERT INTO projects.calendar_years (year)
  VALUES (EXTRACT(YEAR FROM CURRENT_DATE)::int), (EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)
  ON CONFLICT DO NOTHING;

  -- A real profile with NO effective role on this project. The fixture is only
  -- able to fail if such a person exists, so assert that it found one.
  SELECT pr.id INTO v_outsider FROM public.profiles pr
   WHERE public.user_effective_project_role(v_proj, pr.id) IS NULL
   ORDER BY pr.id LIMIT 1;
  IF v_outsider IS NULL THEN
    RAISE EXCEPTION 'no profile without access to % exists; the membership assertion cannot fail and is decorative', v_proj;
  END IF;

  -- The ORPHANED project, built the way work-item-settings.sql builds its
  -- fixture: a throwaway org whose only member is the rbac-test contractor, a
  -- project they created, then BOTH memberships deactivated. Nobody holds an
  -- effective role there any more. Used by 3b (a move nobody can receive) and
  -- by 9 (the one case in which the chain raises).
  INSERT INTO public.organisations (name) VALUES ('_assert_membership_orphan_org') RETURNING id INTO v_tw_org;
  INSERT INTO public.user_organisations (user_id, organisation_id, role) VALUES (v_fixture, v_tw_org, 'contractor');
  INSERT INTO projects.projects (organisation_id, name, created_by)
  VALUES (v_tw_org, '_assert_membership_orphan_project', v_fixture) RETURNING id INTO v_tw_proj;
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role)
  VALUES (v_tw_proj, v_fixture, v_tw_org, 'contractor');
  UPDATE projects.project_members    SET is_active = false WHERE project_id = v_tw_proj AND user_id = v_fixture;
  UPDATE public.user_organisations   SET is_active = false WHERE organisation_id = v_tw_org AND user_id = v_fixture;
  IF projects.resolve_project_pm(v_tw_proj) IS NOT NULL THEN
    RAISE EXCEPTION 'the throwaway project is not orphaned: resolve_project_pm() still names % — the fixture for 3b and 9 is wrong',
      projects.resolve_project_pm(v_tw_proj);
  END IF;

  -- 1. An outsider cannot be the assignee. Assert on the MESSAGE, not merely on
  --    failure: a bare "it raised" handler passes whenever the statement failed
  --    for ANY reason, which is not the reason under test.
  BEGIN
    INSERT INTO projects.work_items (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
    VALUES (v_org, v_proj, 'task', 'outsider assignee', v_outsider, v_pm, v_pm);
    RAISE EXCEPTION 'SENTINEL: an item was assigned to a user with no effective role on the project';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%not on this project%' THEN
      RAISE EXCEPTION 'wrong failure for the outsider-assignee case: %', SQLERRM;
    END IF;
  END;

  -- 2. ...nor the gatekeeper.
  BEGIN
    INSERT INTO projects.work_items (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
    VALUES (v_org, v_proj, 'task', 'outsider gatekeeper', v_pm, v_outsider, v_pm);
    RAISE EXCEPTION 'SENTINEL: an item named a gatekeeper with no effective role on the project';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%not on this project%' THEN
      RAISE EXCEPTION 'wrong failure for the outsider-gatekeeper case: %', SQLERRM;
    END IF;
  END;

  -- 3. ...nor by a later UPDATE. RLS cannot compare OLD and NEW, so the trigger
  --    must fire on UPDATE too or reassignment is the hole.
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (v_org, v_proj, 'task', 'reassign subject', v_pm, v_pm, v_pm);
  BEGIN
    UPDATE projects.work_items SET assignee_id = v_outsider
     WHERE project_id = v_proj AND title = 'reassign subject';
    RAISE EXCEPTION 'SENTINEL: an item was REASSIGNED to a user with no access';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%not on this project%' THEN
      RAISE EXCEPTION 'wrong failure for the reassign-to-outsider case: %', SQLERRM;
    END IF;
  END;

  -- 3b. ...nor by moving the item to a project its people are not on. The
  --     trigger is declared UPDATE OF project_id as well, and its body must
  --     honour that: the SAME assignee on a DIFFERENT project is a different
  --     membership question, and a body that re-checks only when a person
  --     column changed leaves the declared column decorative. The target is
  --     the orphaned throwaway project, where nobody holds a role. (§12 also
  --     makes project_id immutable; this is the layer beneath it, and it fires
  --     first — BEFORE ROW triggers run in name order.)
  BEGIN
    UPDATE projects.work_items SET project_id = v_tw_proj
     WHERE project_id = v_proj AND title = 'reassign subject';
    RAISE EXCEPTION 'SENTINEL: an item was MOVED to a project its assignee is not on';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%not on this project%' THEN
      RAISE EXCEPTION 'wrong failure for the move-to-foreign-project case: %', SQLERRM;
    END IF;
  END;

  -- 4. A client_viewer CAN be an assignee from Q1. The landlord is frequently
  --    the ball-in-court; their WRITE carve-out is Q3, their assignability is now.
  --    The fixture is the oldest active project THAT HAS one — measured on
  --    2026-09-12, KINGSWALK (the oldest active project) has none, and a
  --    RAISE NOTICE skip is invisible through the Management API, which returns
  --    rows only.
  SELECT pm.user_id, pm.project_id, p.organisation_id
    INTO v_cv, v_cv_proj, v_cv_org
    FROM projects.project_members pm
    JOIN projects.projects p ON p.id = pm.project_id
   WHERE pm.is_active AND pm.role='client_viewer' AND p.status='active'
   ORDER BY p.created_at, pm.created_at, pm.user_id LIMIT 1;
  IF v_cv IS NULL THEN
    RAISE EXCEPTION 'no active client_viewer membership anywhere; the client-viewer assignability assertion cannot fail and is decorative. Create one inside this transaction rather than skipping it.';
  END IF;
  v_cv_pm := projects.resolve_project_pm(v_cv_proj);
  IF v_cv_pm IS NULL THEN
    RAISE EXCEPTION 'resolve_project_pm(%) returned NULL — the client-viewer fixture project has nobody to gatekeep', v_cv_proj;
  END IF;
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (v_cv_org, v_cv_proj, 'task', 'client viewer holds the ball', v_cv, v_cv_pm, v_cv_pm);

  -- 5. THE CHAIN NEVER RAISES ON A STALE ID, at EITHER settings slot. The
  --    per-type default holds a dead uuid — no FK, and profiles cascade from
  --    auth.users (00001:62): the "departed employee makes RFIs unraisable"
  --    failure. project_settings.triage_owner_id holds a REAL profile with no
  --    role on the project — its FK is to profiles, not to a membership, so a
  --    person who left the project is still a legal value there. Both must be
  --    skipped and the chain must reach resolve_project_pm(), whose answer it
  --    returns — asserted by IDENTITY, so a reordered or short-circuited chain
  --    reads red rather than "someone with a role".
  UPDATE projects.project_settings
     SET work_item_defaults = jsonb_build_object('rfi', jsonb_build_object(
           'days_to_respond', NULL,
           'triage_owner_id', '00000000-0000-0000-0000-0000deadbeef'::uuid, 'gatekeeper_id', NULL)),
         triage_owner_id = v_outsider
   WHERE project_id = v_proj;
  v_res := projects.resolve_work_item_assignee(v_proj, 'rfi', NULL);
  IF v_res IS NULL THEN RAISE EXCEPTION 'the resolution chain returned NULL — assignee_id NOT NULL would abort the source write'; END IF;
  IF public.user_effective_project_role(v_proj, v_res) IS NULL
  THEN RAISE EXCEPTION 'the chain terminated on someone with no access: %', v_res; END IF;
  IF v_res <> projects.resolve_project_pm(v_proj) THEN
    RAISE EXCEPTION 'the chain skipped both stale slots but answered % rather than the PM resolver''s %', v_res, projects.resolve_project_pm(v_proj);
  END IF;

  -- 6. An explicit assignee wins over every default.
  IF projects.resolve_work_item_assignee(v_proj, 'rfi', v_pm) <> v_pm
  THEN RAISE EXCEPTION 'an explicit assignee was overridden by the default chain'; END IF;

  -- 7. An explicit assignee with NO access does NOT win — it falls through to
  --    the chain rather than being returned and blowing up in the trigger.
  IF projects.resolve_work_item_assignee(v_proj, 'rfi', v_outsider) = v_outsider
  THEN RAISE EXCEPTION 'the chain returned an explicit assignee who has no access to the project'; END IF;

  -- 8. THE LIVE DEMO PROJECT. Its org has no active owner, admin or PM
  --    (deviations #9), so a chain that terminated at projects.org_owner()
  --    returned NULL here and a chain that raised on it would have made the
  --    demo unusable. Today it resolves to its creator, a contractor — legal.
  --    RAISE if the project is gone rather than skip.
  IF NOT EXISTS (SELECT 1 FROM projects.projects WHERE id = v_demo) THEN
    RAISE EXCEPTION 'demo project % is missing — the owner-less-org path has no live fixture; create one in this transaction rather than skipping', v_demo;
  END IF;
  v_res := projects.resolve_work_item_assignee(v_demo, 'rfi', NULL);
  IF v_res IS NULL THEN RAISE EXCEPTION 'demo project (org without an owner): the chain returned NULL'; END IF;
  IF public.user_effective_project_role(v_demo, v_res) IS NULL
  THEN RAISE EXCEPTION 'demo project (org without an owner): the chain named % who has no effective role there', v_res; END IF;

  -- 9. THE ORPHANED PROJECT RAISES — once, with the actionable sentence. Every
  --    arm validates to nothing on the throwaway project, and returning NULL
  --    would let assignee_id NOT NULL — or the membership trigger's "not on
  --    this project" — report it as the wrong problem. Assert on the MESSAGE:
  --    a bare "it raised" passes for any failure, and a SENTINEL catches a
  --    chain that returns anything at all.
  BEGIN
    v_res := projects.resolve_work_item_assignee(v_tw_proj, 'task', NULL);
    RAISE EXCEPTION 'SENTINEL: the chain returned % for an orphaned project instead of raising', v_res;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%nobody who can own work%' THEN
      RAISE EXCEPTION 'wrong failure for the orphaned-project case: %', SQLERRM;
    END IF;
  END;

  -- 10. A NULL person column is the NOT NULL constraint's to report, not the
  --     trigger's. BEFORE ROW triggers run before the column constraints, and
  --     user_effective_project_role(project, NULL) is NULL (measured), so a
  --     trigger that did not guard the id would refuse the row as "not on this
  --     project" — sending a PM to look for a person who was never named.
  --     Pinned on the SQLSTATE and the COLUMN_NAME, for BOTH columns.
  BEGIN
    INSERT INTO projects.work_items (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
    VALUES (v_org, v_proj, 'task', 'null assignee', NULL, v_pm, v_pm);
    RAISE EXCEPTION 'SENTINEL: a row with a NULL assignee_id was accepted';
  EXCEPTION
    WHEN not_null_violation THEN
      GET STACKED DIAGNOSTICS v_col = COLUMN_NAME;
      IF v_col <> 'assignee_id' THEN RAISE EXCEPTION 'a NULL assignee_id was reported against column %', v_col; END IF;
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      RAISE EXCEPTION 'wrong failure for the NULL-assignee case (expected not_null_violation on assignee_id): %', SQLERRM;
  END;
  -- 10b. ...and the gatekeeper column.
  BEGIN
    INSERT INTO projects.work_items (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
    VALUES (v_org, v_proj, 'task', 'null gatekeeper', v_pm, NULL, v_pm);
    RAISE EXCEPTION 'SENTINEL: a row with a NULL gatekeeper_id was accepted';
  EXCEPTION
    WHEN not_null_violation THEN
      GET STACKED DIAGNOSTICS v_col = COLUMN_NAME;
      IF v_col <> 'gatekeeper_id' THEN RAISE EXCEPTION 'a NULL gatekeeper_id was reported against column %', v_col; END IF;
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      RAISE EXCEPTION 'wrong failure for the NULL-gatekeeper case (expected not_null_violation on gatekeeper_id): %', SQLERRM;
  END;

  RAISE NOTICE 'work-item-membership: 10/10 assertions passed';
END $$;
