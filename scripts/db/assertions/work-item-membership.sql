-- Assertions for 00196 §7 (resolve_work_item_assignee and the membership
-- trigger). Run inside the rolled-back transaction opened by
-- try-work-item-spine.sh.
--
-- Two guarantees, both about the person columns:
--   * an item can never point at someone who cannot open it — on INSERT, on
--     reassignment, and on a move to another project (1-4, 10);
--   * the chain answers from the RIGHT slot, a stale settings value never
--     blocks a source write, and the chain raises exactly once, with one
--     actionable sentence, for an ORPHANED project (5-9, 11-12).
--
-- LIVE-ESTATE fixtures (measured 2026-09-12): the oldest active project is
-- (643) KINGSWALK — 3 active PMs, 17 of 36 profiles with no effective role
-- there; 4 active client_viewer memberships, the oldest on (657) MAMAILA
-- PHASE 2; the Sandton demo project e51ede00-…-0002-000000000001 is active,
-- its org has no active owner/admin/PM and its creator is a contractor. Every
-- fixture RAISES when it cannot be found: a RAISE NOTICE skip is invisible
-- through the Management API, which returns rows only, and the harness would
-- print a green tick over a no-op.
--
-- The THROWAWAY fixture is built the way work-item-settings.sql builds its
-- own: an org whose only member is the rbac-test contractor, and a project
-- they created. It is ACTIVE from the prelude through 8a (an owner-less org
-- with a validated creator — the mechanism the demo project happens to
-- exhibit today) and ORPHANED at 9 (both memberships deactivated; the one
-- case in which the chain raises). 3b uses it as a foreign project: KINGSWALK's
-- PM has no membership in that org at all, whatever the fixture's own state.
DO $$
DECLARE
  v_proj uuid; v_org uuid; v_pm uuid; v_outsider uuid; v_second uuid;
  v_cv uuid; v_cv_proj uuid; v_cv_org uuid; v_cv_pm uuid; v_res uuid;
  v_demo    uuid := 'e51ede00-0000-0000-0002-000000000001';  -- Sandton demo
  v_demo_org uuid;
  v_fixture uuid := '018f2d31-bbe8-4cc1-bbdd-63af0187081e';  -- rbac-test, the sanctioned prod fixture
  v_tw_org uuid; v_tw_proj uuid;   -- the throwaway org + project (3b, 8a, 9)
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

  -- A SECOND member of the project with an effective role, who is NOT the PM
  -- resolver's answer. 11 and 12 assert the chain's answer by IDENTITY against
  -- this person; if they were the same as resolve_project_pm(), deleting a
  -- whole default arm would leave both green (reviewer mutations C and D).
  SELECT pm.user_id INTO v_second
    FROM projects.project_members pm
   WHERE pm.project_id = v_proj AND pm.is_active
     AND pm.user_id <> v_pm AND pm.user_id <> projects.resolve_project_pm(v_proj)
     AND public.user_effective_project_role(v_proj, pm.user_id) IS NOT NULL
   ORDER BY pm.created_at, pm.user_id LIMIT 1;
  IF v_second IS NULL THEN
    RAISE EXCEPTION 'no second active member with an effective role on % — assertions 11 and 12 could not distinguish a default arm from the PM resolver and would be decorative', v_proj;
  END IF;

  -- The throwaway org + project (see the header). Active for now.
  INSERT INTO public.organisations (name) VALUES ('_assert_membership_throwaway_org') RETURNING id INTO v_tw_org;
  INSERT INTO public.user_organisations (user_id, organisation_id, role) VALUES (v_fixture, v_tw_org, 'contractor');
  INSERT INTO projects.projects (organisation_id, name, created_by)
  VALUES (v_tw_org, '_assert_membership_throwaway_project', v_fixture) RETURNING id INTO v_tw_proj;
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role)
  VALUES (v_tw_proj, v_fixture, v_tw_org, 'contractor');
  IF public.user_effective_project_role(v_tw_proj, v_pm) IS NOT NULL THEN
    RAISE EXCEPTION 'the KINGSWALK PM % somehow holds a role on the throwaway project — 3b''s foreign project is not foreign', v_pm;
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
  --     the throwaway project — KINGSWALK's PM has no membership in that org.
  --     §12's work_items_transition_guard_trg also makes project_id immutable;
  --     this is the layer beneath it, and it fires FIRST because BEFORE ROW
  --     triggers run in name order — Task 11 must keep that trigger name.
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

  -- 8. AN OWNER-LESS ORG RESOLVES TO THE VALIDATED CREATOR. A chain that
  --    terminated at projects.org_owner() returned NULL here (deviations #9).
  -- 8a. The MECHANISM, on the throwaway: its org has no owner at all, its
  --     settings row was written before the creator's membership existed
  --     (AFTER INSERT ordering, 00195 §3), and its creator is an active
  --     contractor through project_members — so the only arm that can answer
  --     is resolve_project_pm()'s validated created_by. Asserted by identity.
  IF projects.org_owner(v_tw_org) IS NOT NULL THEN
    RAISE EXCEPTION 'the throwaway org has an owner (%) — 8a is not exercising the owner-less path', projects.org_owner(v_tw_org);
  END IF;
  v_res := projects.resolve_work_item_assignee(v_tw_proj, 'rfi', NULL);
  IF v_res IS DISTINCT FROM v_fixture THEN
    RAISE EXCEPTION 'owner-less org: the chain answered % rather than the validated creator %', v_res, v_fixture;
  END IF;
  -- 8b. The LIVE demo project, the estate's own instance of 8a. Its
  --     precondition is guarded so the arm cannot weaken silently: the day the
  --     demo org gains an active owner/admin/PM this reads red and the check
  --     should be dropped in favour of 8a, not left passing for a new reason.
  SELECT p.organisation_id INTO v_demo_org FROM projects.projects p WHERE p.id = v_demo;
  IF v_demo_org IS NULL THEN
    RAISE EXCEPTION 'demo project % is missing — drop 8b (8a covers the mechanism) rather than skipping it', v_demo;
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_organisations uo
              WHERE uo.organisation_id = v_demo_org AND uo.is_active
                AND uo.role IN ('owner','admin','project_manager')) THEN
    RAISE EXCEPTION 'the demo org % now has an active owner/admin/PM — 8b no longer exercises the owner-less path; drop it (8a covers the mechanism)', v_demo_org;
  END IF;
  v_res := projects.resolve_work_item_assignee(v_demo, 'rfi', NULL);
  IF v_res IS NULL THEN RAISE EXCEPTION 'demo project (org without an owner): the chain returned NULL'; END IF;
  IF public.user_effective_project_role(v_demo, v_res) IS NULL
  THEN RAISE EXCEPTION 'demo project (org without an owner): the chain named % who has no effective role there', v_res; END IF;

  -- 9. THE ORPHANED PROJECT RAISES — once, with the actionable sentence.
  --    Deactivate BOTH of the throwaway creator's memberships: every arm now
  --    validates to nothing, and returning NULL would let assignee_id NOT NULL
  --    — or the membership trigger's "not on this project" — report it as the
  --    wrong problem. Assert on the MESSAGE: a bare "it raised" passes for any
  --    failure, and a SENTINEL catches a chain that returns anything at all.
  UPDATE projects.project_members  SET is_active = false WHERE project_id = v_tw_proj AND user_id = v_fixture;
  UPDATE public.user_organisations SET is_active = false WHERE organisation_id = v_tw_org AND user_id = v_fixture;
  IF projects.resolve_project_pm(v_tw_proj) IS NOT NULL THEN
    RAISE EXCEPTION 'the throwaway project is not orphaned: resolve_project_pm() still names % — 9 is not exercising the raise', projects.resolve_project_pm(v_tw_proj);
  END IF;
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

  -- 11. THE PER-TYPE DEFAULT ARM ANSWERS, and outranks the settings owner.
  --     5 and 7 only prove the arms are SKIPPED when stale; deleting either
  --     default arm outright left every earlier assertion green (reviewer
  --     mutations C and D). Both slots hold a valid person, different from
  --     each other and from the PM resolver's answer, and the chain must
  --     return the per-type one — by identity.
  UPDATE projects.project_settings
     SET work_item_defaults = jsonb_build_object('rfi', jsonb_build_object(
           'days_to_respond', NULL, 'triage_owner_id', v_second, 'gatekeeper_id', NULL)),
         triage_owner_id = v_pm
   WHERE project_id = v_proj;
  v_res := projects.resolve_work_item_assignee(v_proj, 'rfi', NULL);
  IF v_res IS DISTINCT FROM v_second THEN
    RAISE EXCEPTION 'per-type default: the chain answered % rather than work_item_defaults.rfi.triage_owner_id %', v_res, v_second;
  END IF;

  -- 12. THE SETTINGS-OWNER ARM ANSWERS, and outranks the PM resolver. No
  --     per-type default at all; project_settings.triage_owner_id names the
  --     second member, who is not the PM resolver's answer.
  UPDATE projects.project_settings
     SET work_item_defaults = '{}'::jsonb, triage_owner_id = v_second
   WHERE project_id = v_proj;
  v_res := projects.resolve_work_item_assignee(v_proj, 'rfi', NULL);
  IF v_res IS DISTINCT FROM v_second THEN
    RAISE EXCEPTION 'settings owner: the chain answered % rather than project_settings.triage_owner_id %', v_res, v_second;
  END IF;

  RAISE NOTICE 'work-item-membership: 12/12 assertions passed';
END $$;
