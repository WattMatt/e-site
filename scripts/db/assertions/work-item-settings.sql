-- Assertions for migration A (project_settings work-item columns).
-- Run inside the rolled-back transaction opened by try-work-item-spine.sh.
DO $$
DECLARE n int; v_pm uuid; v_proj uuid; v_owner uuid;
        v_pmless uuid; v_total int; v_list text;
BEGIN
  -- 1. The four columns exist with the shapes the spine depends on.
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema='projects' AND table_name='project_settings'
     AND column_name IN ('work_item_defaults','triage_owner_id',
                         'builders_shutdown_start_md','builders_shutdown_end_md');
  IF n <> 4 THEN RAISE EXCEPTION 'expected 4 new project_settings columns, found %', n; END IF;

  -- 2. triage_owner_id is NULLABLE. A NOT NULL column here breaks project creation.
  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema='projects' AND table_name='project_settings'
         AND column_name='triage_owner_id') <> 'YES'
  THEN RAISE EXCEPTION 'triage_owner_id must be NULLABLE (00103 inserts only project_id + organisation_id)'; END IF;

  -- 3. work_item_defaults is NOT NULL with a {} default, so the spine's
  --    `defaults -> type ->> key` never dereferences a NULL jsonb.
  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema='projects' AND table_name='project_settings'
         AND column_name='work_item_defaults') <> 'NO'
  THEN RAISE EXCEPTION 'work_item_defaults must be NOT NULL DEFAULT ''{}'''; END IF;

  -- 4. EVERY live settings row now names a triage owner. Zero exceptions:
  --    the backfill terminates at the project's creator (created_by is NOT NULL
  --    on every projects.projects row), so no project can be missed. The org
  --    owner is NOT the guarantee: the demo org has no active owner at all.
  SELECT count(*) INTO n FROM projects.project_settings WHERE triage_owner_id IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'backfill left % project_settings rows with a NULL triage_owner_id', n; END IF;

  -- 5. Every resolved owner is a real, still-resolvable person on that project.
  SELECT count(*) INTO n
    FROM projects.project_settings ps
   WHERE public.user_effective_project_role(ps.project_id, ps.triage_owner_id) IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION '% triage owners have no effective role on their own project', n; END IF;

  -- 6. THE FALLBACK CASE. Exactly one live project has zero project_manager
  --    memberships (the Sandton demo). Its owner must come from created_by or
  --    the org owner — this is the arm that would otherwise never be exercised.
  SELECT p.id INTO v_proj
    FROM projects.projects p
   WHERE NOT EXISTS (SELECT 1 FROM projects.project_members pm
                      WHERE pm.project_id = p.id AND pm.is_active AND pm.role='project_manager')
   LIMIT 1;
  IF v_proj IS NULL THEN
    RAISE EXCEPTION 'no PM-less project found — the created_by/org-owner fallback is untested. Create one in this transaction rather than skipping the assertion.';
  END IF;
  v_pmless := v_proj;  -- kept for assertion 10; assertion 7 reassigns v_proj
  SELECT ps.triage_owner_id INTO v_pm FROM projects.project_settings ps WHERE ps.project_id = v_proj;
  SELECT p.created_by INTO v_owner FROM projects.projects p WHERE p.id = v_proj;
  IF v_pm IS NULL THEN RAISE EXCEPTION 'PM-less project % resolved a NULL triage owner', v_proj; END IF;
  IF v_pm <> v_owner AND public.user_effective_project_role(v_proj, v_pm) NOT IN ('owner','admin','project_manager')
  THEN RAISE EXCEPTION 'PM-less project % fell through to % which is neither created_by nor an org admin', v_proj, v_pm; END IF;

  -- 7. A NEW project gets a triage owner from the rewritten trigger, not from
  --    a backfill. Walk from the empty state: insert a project, read it back.
  INSERT INTO projects.projects (organisation_id, name, created_by)
  SELECT p.organisation_id, '_assert_new_project', p.created_by FROM projects.projects p LIMIT 1
  RETURNING id INTO v_proj;
  SELECT ps.triage_owner_id INTO v_pm FROM projects.project_settings ps WHERE ps.project_id = v_proj;
  IF v_pm IS NULL THEN
    RAISE EXCEPTION 'ensure_project_settings_row() left a brand-new project with no triage owner';
  END IF;

  -- 8. ensure_project_settings_row() must NOT use current_user for anything.
  IF (SELECT prosrc FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid=p.pronamespace
       WHERE nsp.nspname='projects' AND p.proname='ensure_project_settings_row') ILIKE '%current_user%'
  THEN RAISE EXCEPTION 'ensure_project_settings_row() references current_user — inside SECURITY DEFINER that is the function OWNER (00179:341-346)'; END IF;

  -- 9. anon holds no EXECUTE on any of the three new resolvers.
  SELECT count(*) INTO n FROM (VALUES
    ('projects.org_owner(uuid)'),
    ('projects.resolve_project_pm(uuid)'),
    ('projects.resolve_triage_owner(uuid)')) AS f(sig)
   WHERE has_function_privilege('anon', f.sig, 'EXECUTE');
  IF n <> 0 THEN RAISE EXCEPTION '% new function(s) still executable by anon', n; END IF;

  -- 10. resolve_project_pm() — the GATEKEEPER default for every 'project_pm'
  --     type — resolves for EVERY project (the count includes the project
  --     assertion 7 just created). The org-owner arm is NOT a guarantee: the
  --     demo org e51ede00-…-0000-000000000001 has no active owner, admin or
  --     project_manager. created_by (NOT NULL on every projects.projects row)
  --     is the terminal arm, and for the PM-less project it is the arm that
  --     actually answers — so that project must resolve to its own created_by.
  SELECT count(*) INTO v_total FROM projects.projects;
  SELECT count(*), string_agg(p.name || ' [' || p.id || ']', '; ') INTO n, v_list
    FROM projects.projects p
   WHERE projects.resolve_project_pm(p.id) IS NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION 'resolve_project_pm() returned NULL for % of % projects: %', n, v_total, v_list;
  END IF;
  SELECT p.created_by INTO v_owner FROM projects.projects p WHERE p.id = v_pmless;
  IF projects.resolve_project_pm(v_pmless) IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'PM-less project % resolve_project_pm() returned % rather than its created_by %',
      v_pmless, projects.resolve_project_pm(v_pmless), v_owner;
  END IF;

  RAISE NOTICE 'work-item-settings: 10/10 assertions passed (resolve_project_pm non-NULL on all % projects)', v_total;
END $$;
