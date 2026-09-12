-- Assertions for migration A (project_settings work-item columns).
-- Run inside the rolled-back transaction opened by try-work-item-spine.sh.
--
-- Two kinds of check live here, and the distinction matters when one goes red:
--   MECHANISM (hold on any estate): 1, 2, 3, 7, 8, 9, 10(a)-invariant, 10(b), 11.
--   LIVE ESTATE (measured 2026-09-12: 14 projects, one PM-less, none orphaned):
--     4, 5, 6, 10(a)-count, 10(c). A red here is a signal about production —
--     an orphaned project, a demo org that gained an owner — not a broken test.
DO $$
DECLARE
  n int; v_pm uuid; v_proj uuid; v_owner uuid; v_org uuid;
  v_pmless uuid[] := '{}';        -- every live PM-less project, captured in 6 for 10(c)
  v_new uuid; v_creator uuid;     -- assertion 7's project and the creator it was given
  v_total int; v_list text;
  v_tw_org uuid; v_tw_proj uuid;  -- assertion 10(b)'s throwaway org + project
  v_fixture uuid := '018f2d31-bbe8-4cc1-bbdd-63af0187081e';  -- rbac-test, the sanctioned prod fixture
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

  -- 4. EVERY live settings row now names a triage owner. This is a LIVE-ESTATE
  --    measurement, deliberately NOT a @verify directive: the resolvers return
  --    NULL for an orphaned project by contract, so a deploy gate on this would
  --    block every later migration the day one project loses its last owner.
  SELECT count(*) INTO n FROM projects.project_settings WHERE triage_owner_id IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'backfill left % project_settings rows with a NULL triage_owner_id', n; END IF;

  -- 5. Every resolved owner is a real, still-resolvable person on that project.
  SELECT count(*) INTO n
    FROM projects.project_settings ps
   WHERE public.user_effective_project_role(ps.project_id, ps.triage_owner_id) IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION '% triage owners have no effective role on their own project', n; END IF;

  -- 6. THE FALLBACK CASE, over EVERY live project with zero project_manager
  --    memberships (2026-09-12: exactly one, the Sandton demo). Each one's
  --    owner must come from created_by or an org admin — the arm that would
  --    otherwise never be exercised. COALESCE(…, '') so a NULL role reads as
  --    "not an admin" rather than making the whole IF vanish.
  n := 0;
  FOR v_proj, v_owner IN
    SELECT p.id, p.created_by
      FROM projects.projects p
     WHERE NOT EXISTS (SELECT 1 FROM projects.project_members pm
                        WHERE pm.project_id = p.id AND pm.is_active AND pm.role='project_manager')
     ORDER BY p.created_at, p.id
  LOOP
    n := n + 1;
    v_pmless := v_pmless || v_proj;
    SELECT ps.triage_owner_id INTO v_pm FROM projects.project_settings ps WHERE ps.project_id = v_proj;
    IF v_pm IS NULL THEN RAISE EXCEPTION 'PM-less project % resolved a NULL triage owner', v_proj; END IF;
    IF v_pm <> v_owner
       AND COALESCE(public.user_effective_project_role(v_proj, v_pm), '') NOT IN ('owner','admin','project_manager')
    THEN RAISE EXCEPTION 'PM-less project % fell through to % which is neither created_by nor an org admin', v_proj, v_pm; END IF;
  END LOOP;
  IF n = 0 THEN
    RAISE EXCEPTION 'no PM-less project found — the created_by/org-owner fallback is untested. Create one in this transaction rather than skipping the assertion.';
  END IF;

  -- 7. A NEW project gets a triage owner from the rewritten trigger, not from
  --    a backfill, and that owner is ITS CREATOR. Walk from the empty state:
  --    insert a project, read it back. The creator is an active org
  --    owner/admin/PM of the org — the shape of the real create flow — so at
  --    AFTER INSERT time, before any project_members row exists, they already
  --    hold an effective role and the created_by arm can validate them.
  SELECT p.organisation_id, p.created_by INTO v_org, v_creator
    FROM projects.projects p
    JOIN public.user_organisations uo
      ON uo.user_id = p.created_by AND uo.organisation_id = p.organisation_id
     AND uo.is_active AND uo.role IN ('owner','admin','project_manager')
   ORDER BY p.created_at, p.id LIMIT 1;
  IF v_creator IS NULL THEN
    RAISE EXCEPTION 'no live project whose creator is an active org owner/admin/PM — assertion 7 has no real create flow to walk';
  END IF;
  INSERT INTO projects.projects (organisation_id, name, created_by)
  VALUES (v_org, '_assert_new_project', v_creator)
  RETURNING id INTO v_new;
  SELECT ps.triage_owner_id INTO v_pm FROM projects.project_settings ps WHERE ps.project_id = v_new;
  IF v_pm IS NULL THEN
    RAISE EXCEPTION 'ensure_project_settings_row() left a brand-new project with no triage owner';
  END IF;
  IF v_pm <> v_creator THEN
    RAISE EXCEPTION 'brand-new project got triage owner % rather than its creator %', v_pm, v_creator;
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid=p.pronamespace
           WHERE nsp.nspname='projects' AND p.proname='ensure_project_settings_row')
  THEN RAISE EXCEPTION 'ensure_project_settings_row() is not SECURITY DEFINER — a contractor creating a project would resolve NULL under their own RLS'; END IF;

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
  --     type. The org-owner arm is NOT a guarantee (the demo org has no active
  --     owner, admin or PM), so created_by is the terminal arm, and EVERY arm
  --     validates its candidate's effective role.
  -- (a) Invariant over every live project: the answer is NULL or someone who
  --     holds an effective role there. Then the NULL count — a live-estate
  --     measurement, 0 on 2026-09-12.
  SELECT count(*) INTO v_total FROM projects.projects p WHERE p.id <> v_new;
  SELECT count(*), string_agg(p.name || ' [' || p.id || ']', '; ') INTO n, v_list
    FROM projects.projects p
   WHERE p.id <> v_new
     AND projects.resolve_project_pm(p.id) IS NOT NULL
     AND public.user_effective_project_role(p.id, projects.resolve_project_pm(p.id)) IS NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION 'resolve_project_pm() named someone with no effective role on % of % live projects: %', n, v_total, v_list;
  END IF;
  SELECT count(*), string_agg(p.name || ' [' || p.id || ']', '; ') INTO n, v_list
    FROM projects.projects p
   WHERE p.id <> v_new AND projects.resolve_project_pm(p.id) IS NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION 'resolve_project_pm() returned NULL for % of % live projects (0 expected on the 2026-09-12 estate): %', n, v_total, v_list;
  END IF;

  -- (b) A throwaway org + project whose creator is the ONLY member, and a
  --     contractor at that — no org owner/admin/PM exists, so the only arm
  --     that can answer in either chain is the terminal created_by arm, and it
  --     validates through the project_members row. Both resolvers must name
  --     the creator. (The AFTER INSERT trigger fires before that membership
  --     row exists, so the settings row itself is NOT asserted here.)
  INSERT INTO public.organisations (name) VALUES ('_assert_throwaway_org') RETURNING id INTO v_tw_org;
  INSERT INTO public.user_organisations (user_id, organisation_id, role) VALUES (v_fixture, v_tw_org, 'contractor');
  INSERT INTO projects.projects (organisation_id, name, created_by)
  VALUES (v_tw_org, '_assert_throwaway_project', v_fixture) RETURNING id INTO v_tw_proj;
  INSERT INTO projects.project_members (project_id, user_id, organisation_id, role)
  VALUES (v_tw_proj, v_fixture, v_tw_org, 'contractor');
  IF projects.resolve_project_pm(v_tw_proj) IS DISTINCT FROM v_fixture THEN
    RAISE EXCEPTION 'throwaway project (creator is the only member, org has no owner/admin/PM): resolve_project_pm() returned % rather than the creator % — the created_by terminal arm',
      projects.resolve_project_pm(v_tw_proj), v_fixture;
  END IF;
  IF projects.resolve_triage_owner(v_tw_proj) IS DISTINCT FROM v_fixture THEN
    RAISE EXCEPTION 'throwaway project (creator is the only member): resolve_triage_owner() returned % rather than the creator %',
      projects.resolve_triage_owner(v_tw_proj), v_fixture;
  END IF;

  -- (c) The live PM-less project(s): the answer is created_by ONLY while the
  --     org has no active owner/admin/PM — if it ever gains one, that person
  --     outranks the creator and this arm is correctly no longer exercised.
  FOREACH v_proj IN ARRAY v_pmless LOOP
    SELECT p.created_by, p.organisation_id INTO v_owner, v_org FROM projects.projects p WHERE p.id = v_proj;
    IF NOT EXISTS (SELECT 1 FROM public.user_organisations uo
                    WHERE uo.organisation_id = v_org AND uo.is_active
                      AND uo.role IN ('owner','admin','project_manager')) THEN
      IF projects.resolve_project_pm(v_proj) IS DISTINCT FROM v_owner THEN
        RAISE EXCEPTION 'PM-less project % (org has no active owner/admin/PM) resolve_project_pm() returned % rather than its created_by %',
          v_proj, projects.resolve_project_pm(v_proj), v_owner;
      END IF;
    END IF;
  END LOOP;

  -- 11. THE ORPHANED-PROJECT CONTRACT, proven. Deactivate the throwaway
  --     creator's memberships (project and org). Nobody on that project holds
  --     an effective role any more, so BOTH resolvers must return NULL rather
  --     than naming someone who cannot open it. This is the NULL that Task 8,
  --     Task 12 and item 3 must turn into "This project has nobody who can own
  --     work — add a project manager".
  UPDATE projects.project_members SET is_active = false WHERE project_id = v_tw_proj AND user_id = v_fixture;
  UPDATE public.user_organisations SET is_active = false WHERE organisation_id = v_tw_org AND user_id = v_fixture;
  IF projects.resolve_project_pm(v_tw_proj) IS NOT NULL THEN
    RAISE EXCEPTION 'orphaned project: resolve_project_pm() returned % — every arm must validate its candidate''s effective role',
      projects.resolve_project_pm(v_tw_proj);
  END IF;
  IF projects.resolve_triage_owner(v_tw_proj) IS NOT NULL THEN
    RAISE EXCEPTION 'orphaned project: resolve_triage_owner() returned % — every arm must validate its candidate''s effective role',
      projects.resolve_triage_owner(v_tw_proj);
  END IF;

  -- 12. The MM-DD CHECK refuses an impossible day. make_date(2001, mm, dd) raises
  --     datetime_field_overflow (22008) for '02-30' before the CHECK can return
  --     false, so either that or check_violation naming the constraint is the
  --     right refusal; acceptance is the failure.
  BEGIN
    UPDATE projects.project_settings SET builders_shutdown_start_md = '02-30'
     WHERE project_id = (SELECT project_id FROM projects.project_settings ORDER BY project_id LIMIT 1);
    RAISE EXCEPTION 'SENTINEL: builders_shutdown_start_md accepted the impossible day 02-30';
  EXCEPTION
    WHEN datetime_field_overflow THEN NULL;
    WHEN check_violation THEN
      DECLARE v_con text;
      BEGIN
        GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
        IF v_con <> 'project_settings_shutdown_md_format' THEN
          RAISE EXCEPTION 'the impossible-day case failed on constraint %, expected project_settings_shutdown_md_format', v_con;
        END IF;
      END;
    WHEN raise_exception THEN RAISE;
  END;

  RAISE NOTICE 'work-item-settings: 12/12 assertions passed (resolve_project_pm non-NULL on all % live projects)', v_total;
END $$;
