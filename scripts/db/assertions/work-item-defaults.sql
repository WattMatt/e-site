-- Assertions for 00196 §13 (validate_work_item_defaults and the
-- work_item_defaults seed). Run inside the rolled-back transaction opened by
-- try-work-item-spine.sh. Runs entirely as postgres — no impersonation, so
-- set_config's transaction-local claim never leaks into §5's opened_at stamp.
-- Assertion 8 plants a fixture PAST the validator with
-- SET LOCAL session_replication_role = replica (the membership file's
-- pattern; SET LOCAL, not set_config() — supautils escalates only the utility
-- statement for the non-superuser postgres role).
--
-- Two kinds of check, and the distinction matters when one goes red:
--   APPLY-TIME MEASUREMENT: 1 (every live settings row carries every active
--     type after the seed). True inside this harness and on the day of the
--     apply; a project created AFTERWARDS gets '{}' from
--     ensure_project_settings_row (00195 §3) and stays at registry defaults
--     until the settings surface writes keys — every reader (§5, §7)
--     tolerates an absent key, and 14 proves it. NEVER a `sql:` directive.
--   MECHANISM (hold on any estate): everything else.
--
-- Expected due dates copy §5's EXACT start-date expression
-- ((now() AT TIME ZONE 'Africa/Johannesburg')::date), the type's calendar read
-- from the registry as §5 reads it, and the same shutdown push — a
-- CURRENT_DATE here would be a midnight-window flake, and now() is
-- transaction-stable so the two sides cannot straddle midnight.
DO $$
DECLARE
  v_proj uuid; v_org uuid; v_pm uuid; v_rfi uuid; v_id uuid; v_cal text; v_days int;
  n int; v_dead uuid; d date; d_expected date; v_bad text; v_obj jsonb; v_got text;
  v_creator uuid; v_new uuid;
BEGIN
  -- The fixture must be a project that HAS an rfi, because 3 and 4 insert
  -- rfi items (work_items_source_required). RAISE rather than skip: a
  -- RAISE NOTICE skip is invisible through the Management API.
  SELECT p.id, p.organisation_id INTO v_proj, v_org
    FROM projects.projects p
   WHERE p.status='active' AND EXISTS (SELECT 1 FROM projects.rfis r WHERE r.project_id = p.id)
   ORDER BY p.created_at, p.id LIMIT 1;
  IF v_proj IS NULL THEN
    RAISE EXCEPTION 'no active project with an rfi; the live default_rfi_due_days assertion cannot be constructed';
  END IF;
  v_pm := projects.resolve_project_pm(v_proj);
  IF v_pm IS NULL THEN
    RAISE EXCEPTION 'resolve_project_pm(%) returned NULL — the fixture project has nobody who can own work', v_proj;
  END IF;
  SELECT r.id INTO v_rfi FROM projects.rfis r WHERE r.project_id = v_proj ORDER BY r.created_at, r.id LIMIT 1;
  -- The calendar §5 will use for an rfi, read the way §5 reads it.
  SELECT t.calendar INTO v_cal FROM projects.work_item_types t WHERE t.key = 'rfi';
  IF v_cal IS NULL THEN RAISE EXCEPTION 'rfi is not in the registry'; END IF;
  -- Every insert runs work_items_set_due_date -> add_working_days, which
  -- raises no_data_found on an unseeded year. Rolled back with everything else.
  INSERT INTO projects.calendar_years (year)
  VALUES (EXTRACT(YEAR FROM CURRENT_DATE)::int), (EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)
  ON CONFLICT DO NOTHING;

  -- 1. EVERY project's defaults carry EVERY active type. A partial seed would
  --    silently fall back to the registry for the missing ones and look fine.
  --    (Apply-time measurement — see the header.)
  SELECT count(*) INTO n
    FROM projects.project_settings ps
   WHERE (SELECT count(*) FROM jsonb_object_keys(ps.work_item_defaults))
      <> (SELECT count(*) FROM projects.work_item_types WHERE is_active);
  IF n <> 0 THEN RAISE EXCEPTION '% project(s) have incomplete work_item_defaults', n; END IF;
  -- 1b. ...and every non-rfi key carries the REGISTRY's default_days, so the
  --     seed's positive path is pinned: a seed writing NULL everywhere, or a
  --     flat number, passes 1 and fails here.
  SELECT count(*) INTO n
    FROM projects.project_settings ps
    CROSS JOIN projects.work_item_types t
   WHERE t.is_active AND t.key <> 'rfi'
     AND (ps.work_item_defaults -> t.key ->> 'days_to_respond') IS DISTINCT FROM t.default_days::text;
  IF n <> 0 THEN RAISE EXCEPTION '% (project, type) pair(s) were seeded with a days_to_respond that is not the registry default', n; END IF;

  -- 2. rfi's days_to_respond is seeded NULL, ON PURPOSE. A copy of
  --    default_rfi_due_days taken at migration time would be right only until
  --    the first PM edited the setting.
  SELECT count(*) INTO n FROM projects.project_settings ps
   WHERE ps.work_item_defaults -> 'rfi' ->> 'days_to_respond' IS NOT NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION '% project(s) hold a COPY of default_rfi_due_days in work_item_defaults; the trigger must read the column live', n;
  END IF;

  -- 3. THE BEHAVIOUR THAT MATTERS. Move default_rfi_due_days and the next RFI's
  --    due date moves with it. This is the assertion a copy design cannot pass.
  --    (This UPDATE does not touch work_item_defaults — the validator's no-op
  --    guard, asserted at 8.)
  UPDATE projects.project_settings SET default_rfi_due_days = 14 WHERE project_id = v_proj;
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, rfi_id, origin)
  VALUES (v_org, v_proj, 'rfi', 'live default probe', v_pm, v_pm, v_pm, v_rfi, 'split')
  RETURNING id INTO v_id;
  SELECT due_date INTO d FROM projects.work_items WHERE id = v_id;
  d_expected := projects.push_past_builders_shutdown(
                  projects.add_working_days(
                    (now() AT TIME ZONE 'Africa/Johannesburg')::date, 14, v_proj, v_cal),
                  v_proj);
  IF d <> d_expected THEN
    RAISE EXCEPTION 'an rfi work item is due % but default_rfi_due_days = 14 implies %', d, d_expected;
  END IF;

  -- 4. A per-type OVERRIDE typed into work_item_defaults still wins over the
  --    column — which is the whole reason the key exists. Two 'split' rows on
  --    one rfi are legal: the partial UNIQUE is scoped to origin = 'mirror'.
  UPDATE projects.project_settings ps
     SET work_item_defaults = jsonb_set(ps.work_item_defaults, '{rfi,days_to_respond}', to_jsonb(3))
   WHERE ps.project_id = v_proj;
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, rfi_id, origin)
  VALUES (v_org, v_proj, 'rfi', 'override probe', v_pm, v_pm, v_pm, v_rfi, 'split')
  RETURNING id INTO v_id;
  SELECT due_date INTO d FROM projects.work_items WHERE id = v_id;
  d_expected := projects.push_past_builders_shutdown(
                  projects.add_working_days(
                    (now() AT TIME ZONE 'Africa/Johannesburg')::date, 3, v_proj, v_cal),
                  v_proj);
  IF d <> d_expected THEN
    RAISE EXCEPTION 'a per-project override of 3 days produced %, expected %', d, d_expected;
  END IF;

  -- 5. An unknown TYPE key is REFUSED. A CHECK cannot reference
  --    work_item_types, so this has to be a trigger, and a typo'd key would
  --    otherwise sit in the jsonb forever, silently doing nothing.
  BEGIN
    UPDATE projects.project_settings
       SET work_item_defaults = work_item_defaults || jsonb_build_object('rfl', '{}'::jsonb)
     WHERE project_id = v_proj;
    RAISE EXCEPTION 'SENTINEL: an unregistered work_item_defaults key was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%"rfl"%is not a registered work-item type%' THEN
      RAISE EXCEPTION 'the unknown-key case failed for the wrong reason: %', SQLERRM; END IF;
  END;

  -- 6. A STALE id is NULLED, not rejected. Rejecting it would make every
  --    settings write on that project fail; leaving it would hand a dead uuid
  --    to assignee_id NOT NULL and abort the source write. BOTH person slots.
  v_dead := '00000000-0000-0000-0000-0000deadbeef'::uuid;
  UPDATE projects.project_settings
     SET work_item_defaults = jsonb_set(work_item_defaults, '{task,triage_owner_id}', to_jsonb(v_dead))
   WHERE project_id = v_proj;
  IF (SELECT work_item_defaults -> 'task' ->> 'triage_owner_id'
        FROM projects.project_settings WHERE project_id = v_proj) IS NOT NULL
  THEN RAISE EXCEPTION 'a stale triage_owner_id survived in work_item_defaults'; END IF;
  UPDATE projects.project_settings
     SET work_item_defaults = jsonb_set(work_item_defaults, '{task,gatekeeper_id}', to_jsonb(v_dead))
   WHERE project_id = v_proj;
  IF (SELECT work_item_defaults -> 'task' ->> 'gatekeeper_id'
        FROM projects.project_settings WHERE project_id = v_proj) IS NOT NULL
  THEN RAISE EXCEPTION 'a stale gatekeeper_id survived in work_item_defaults'; END IF;

  -- 7. A LIVE id is kept, in both slots, and the value round-trips intact. 6
  --    alone would pass if the trigger nulled everything, which would silently
  --    disable per-type overrides entirely. Read the whole object back so a
  --    validator that "cleans" by dropping sibling keys reads red too.
  UPDATE projects.project_settings ps
     SET work_item_defaults = jsonb_set(ps.work_item_defaults, '{task}',
           jsonb_build_object('days_to_respond', 4, 'triage_owner_id', v_pm, 'gatekeeper_id', v_pm))
   WHERE ps.project_id = v_proj;
  SELECT ps.work_item_defaults -> 'task' INTO v_obj FROM projects.project_settings ps WHERE ps.project_id = v_proj;
  IF v_obj ->> 'triage_owner_id' IS NULL THEN RAISE EXCEPTION 'the validator nulled a LIVE triage_owner_id'; END IF;
  IF v_obj ->> 'gatekeeper_id'   IS NULL THEN RAISE EXCEPTION 'the validator nulled a LIVE gatekeeper_id'; END IF;
  IF v_obj <> jsonb_build_object('days_to_respond', 4, 'triage_owner_id', v_pm, 'gatekeeper_id', v_pm) THEN
    RAISE EXCEPTION 'a valid task default did not round-trip intact: %', v_obj;
  END IF;

  -- 8. A settings UPDATE that does NOT touch work_item_defaults skips the
  --    validator entirely — that guard lives in the function body, because a
  --    trigger WHEN clause cannot reference TG_OP or OLD on an INSERT-covering
  --    trigger (proven on production: ERROR 42703 column "tg_op" does not exist).
  --    Made OBSERVABLE (review 12): "the unrelated update took" was green with
  --    the guard deleted. So plant a dead uuid PAST the validator with the
  --    membership file's replica bypass (every non-ALWAYS trigger on
  --    project_settings is skipped for that one statement, the FK RI trigger
  --    included — nothing here relies on it), pin that it landed, run the
  --    unrelated UPDATE, and assert the dead uuid SURVIVED: a validator
  --    without the guard re-validates on every save and nulls it.
  SET LOCAL session_replication_role = replica;
  UPDATE projects.project_settings
     SET work_item_defaults = jsonb_set(work_item_defaults, '{task,triage_owner_id}', to_jsonb(v_dead))
   WHERE project_id = v_proj;
  SET LOCAL session_replication_role = origin;
  SELECT work_item_defaults -> 'task' ->> 'triage_owner_id' INTO v_got
    FROM projects.project_settings WHERE project_id = v_proj;
  IF v_got IS DISTINCT FROM v_dead::text THEN
    RAISE EXCEPTION 'the bypass did not take (% planted, % read)', v_dead, v_got;
  END IF;
  UPDATE projects.project_settings SET default_rfi_due_days = 9 WHERE project_id = v_proj;
  SELECT work_item_defaults -> 'task' ->> 'triage_owner_id' INTO v_got
    FROM projects.project_settings WHERE project_id = v_proj;
  IF v_got IS DISTINCT FROM v_dead::text THEN
    RAISE EXCEPTION 'the no-op guard is not honoured: an unrelated settings update re-validated work_item_defaults and nulled the planted id (read %)', v_got;
  END IF;
  IF (SELECT default_rfi_due_days FROM projects.project_settings WHERE project_id = v_proj) <> 9
  THEN RAISE EXCEPTION 'an unrelated settings update did not take'; END IF;

  -- 9. VALUES are validated, not just keys. §5 casts days_to_respond with
  --    ::int at INSERT time, so a bad value stored here would surface as a
  --    22P02 on the next source write — to a foreman, not to whoever typed
  --    it. Every one of these must RAISE a sentence naming the type, never a
  --    cast error: "abc", a numeric STRING, 0, -1, 1.5, and 1.0 (jsonb keeps
  --    the trailing .0 and ::int refuses it — measured).
  FOREACH v_bad IN ARRAY ARRAY['"abc"', '"5"', '0', '-1', '1.5', '1.0'] LOOP
    BEGIN
      UPDATE projects.project_settings
         SET work_item_defaults = jsonb_set(work_item_defaults, '{snag,days_to_respond}', v_bad::jsonb)
       WHERE project_id = v_proj;
      RAISE EXCEPTION 'SENTINEL: days_to_respond = % was accepted for snag', v_bad;
    EXCEPTION
      WHEN raise_exception THEN
        IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%days to respond%' OR SQLERRM NOT LIKE '%"snag"%' THEN
          RAISE EXCEPTION 'days_to_respond = % failed for the wrong reason: %', v_bad, SQLERRM;
        END IF;
      WHEN OTHERS THEN
        RAISE EXCEPTION 'days_to_respond = % died with SQLSTATE % rather than a sentence: %', v_bad, SQLSTATE, SQLERRM;
    END;
  END LOOP;
  -- 9b. A CLEARED numeric input serialises as "" and is ACCEPTED, landing as
  --     JSON null ("use the default") the way the person slots treat '' —
  --     decided in review 12. The key must still be present, as null: an
  --     absent key would read the same to §5 but is not what was written.
  UPDATE projects.project_settings
     SET work_item_defaults = jsonb_set(work_item_defaults, '{snag,days_to_respond}', '""'::jsonb)
   WHERE project_id = v_proj;
  IF (SELECT work_item_defaults -> 'snag' -> 'days_to_respond' FROM projects.project_settings WHERE project_id = v_proj)
     IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'days_to_respond = "" did not normalise to JSON null: snag reads %',
      (SELECT work_item_defaults -> 'snag' FROM projects.project_settings WHERE project_id = v_proj);
  END IF;

  -- 10. A junk person id RAISES a sentence, never 22P02 — pg_input_is_valid
  --     before the cast. Both slots; a string and a number.
  BEGIN
    UPDATE projects.project_settings
       SET work_item_defaults = jsonb_set(work_item_defaults, '{snag,triage_owner_id}', '"not-a-uuid"'::jsonb)
     WHERE project_id = v_proj;
    RAISE EXCEPTION 'SENTINEL: a junk triage_owner_id was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE '%triage owner%"snag"%person''s id%' THEN
        RAISE EXCEPTION 'the junk triage_owner_id failed for the wrong reason: %', SQLERRM; END IF;
    WHEN OTHERS THEN
      RAISE EXCEPTION 'a junk triage_owner_id died with SQLSTATE % rather than a sentence: %', SQLSTATE, SQLERRM;
  END;
  BEGIN
    UPDATE projects.project_settings
       SET work_item_defaults = jsonb_set(work_item_defaults, '{snag,gatekeeper_id}', '12345'::jsonb)
     WHERE project_id = v_proj;
    RAISE EXCEPTION 'SENTINEL: a numeric gatekeeper_id was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE '%gatekeeper%"snag"%person''s id%' THEN
        RAISE EXCEPTION 'the numeric gatekeeper_id failed for the wrong reason: %', SQLERRM; END IF;
    WHEN OTHERS THEN
      RAISE EXCEPTION 'a numeric gatekeeper_id died with SQLSTATE % rather than a sentence: %', SQLSTATE, SQLERRM;
  END;

  -- 11. An unknown SUB-KEY is refused, naming the type AND the key. The
  --     plan's own argument for 5 applies one level down: `day_to_respond`
  --     would otherwise sit in the jsonb forever while the registry default
  --     quietly applied.
  BEGIN
    UPDATE projects.project_settings
       SET work_item_defaults = jsonb_set(work_item_defaults, '{task,day_to_respond}', '2'::jsonb)
     WHERE project_id = v_proj;
    RAISE EXCEPTION 'SENTINEL: an unknown sub-key (day_to_respond) was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%"day_to_respond"%not a setting%"task"%' THEN
      RAISE EXCEPTION 'the unknown sub-key failed for the wrong reason: %', SQLERRM; END IF;
  END;

  -- 12. A type's value must be an OBJECT: `"rfi": 5` raises a sentence naming
  --     the type rather than being silently ignored (->> on a scalar is NULL,
  --     so without this check the 5 would vanish and the registry default
  --     apply). And the column itself must be an object: an array of types
  --     raises a sentence, not jsonb_each's 22023.
  BEGIN
    UPDATE projects.project_settings
       SET work_item_defaults = jsonb_set(work_item_defaults, '{rfi}', '5'::jsonb)
     WHERE project_id = v_proj;
    RAISE EXCEPTION 'SENTINEL: a scalar type value ("rfi": 5) was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE '%"rfi"%named settings%' THEN
        RAISE EXCEPTION 'the scalar type value failed for the wrong reason: %', SQLERRM; END IF;
    WHEN OTHERS THEN
      RAISE EXCEPTION 'a scalar type value died with SQLSTATE % rather than a sentence: %', SQLSTATE, SQLERRM;
  END;
  BEGIN
    UPDATE projects.project_settings SET work_item_defaults = '[]'::jsonb WHERE project_id = v_proj;
    RAISE EXCEPTION 'SENTINEL: a non-object work_item_defaults was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE '%keyed by work-item type%' THEN
        RAISE EXCEPTION 'the non-object column failed for the wrong reason: %', SQLERRM; END IF;
    WHEN OTHERS THEN
      RAISE EXCEPTION 'a non-object column died with SQLSTATE % rather than a sentence: %', SQLSTATE, SQLERRM;
  END;
  -- 12c. `"rfi": null` is refused (decided in review 12: an absent key and {}
  --      both mean "registry defaults"; a JSON null is neither) — and the
  --      sentence must say what to send instead, pinned here: naming the
  --      type and {}.
  BEGIN
    UPDATE projects.project_settings
       SET work_item_defaults = jsonb_set(work_item_defaults, '{rfi}', 'null'::jsonb)
     WHERE project_id = v_proj;
    RAISE EXCEPTION 'SENTINEL: a null type value ("rfi": null) was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE '%"rfi"%send {} to clear%not null%' THEN
        RAISE EXCEPTION 'the null type value failed for the wrong reason: %', SQLERRM; END IF;
    WHEN OTHERS THEN
      RAISE EXCEPTION 'a null type value died with SQLSTATE % rather than a sentence: %', SQLSTATE, SQLERRM;
  END;

  -- 13. A NULL write lands as '{}' — the BEFORE trigger normalises it before
  --     the NOT NULL constraint sees it, so a client clearing the column gets
  --     "no overrides" rather than an error. (Positive path.)
  UPDATE projects.project_settings SET work_item_defaults = NULL WHERE project_id = v_proj;
  IF (SELECT work_item_defaults FROM projects.project_settings WHERE project_id = v_proj) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'a NULL work_item_defaults write did not land as {}';
  END IF;

  -- 14. THE EMPTY-STATE CONTRACT. A project created AFTER the apply gets '{}'
  --     from ensure_project_settings_row (00195 §3) — the seed is a one-off —
  --     and every reader tolerates the absent key: an item on that project is
  --     due at the REGISTRY default and the assignee chain still answers.
  --     Walk it from the empty state: create the project, read it back. The
  --     creator holds an org-level owner/admin/PM role (the real create flow),
  --     so they hold an effective role on the new project with no
  --     project_members row.
  SELECT p.created_by INTO v_creator
    FROM projects.projects p
    JOIN public.user_organisations uo
      ON uo.user_id = p.created_by AND uo.organisation_id = p.organisation_id
     AND uo.is_active AND uo.role IN ('owner','admin','project_manager')
   WHERE p.organisation_id = v_org
   ORDER BY p.created_at, p.id LIMIT 1;
  IF v_creator IS NULL THEN
    RAISE EXCEPTION 'no project in org % whose creator is an active org owner/admin/PM — 14 has no real create flow to walk', v_org;
  END IF;
  INSERT INTO projects.projects (organisation_id, name, created_by)
  VALUES (v_org, '_assert_defaults_new_project', v_creator)
  RETURNING id INTO v_new;
  IF (SELECT ps.work_item_defaults FROM projects.project_settings ps WHERE ps.project_id = v_new) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'a brand-new project did not arrive with work_item_defaults = {}: %',
      (SELECT ps.work_item_defaults FROM projects.project_settings ps WHERE ps.project_id = v_new);
  END IF;
  SELECT t.default_days, t.calendar INTO v_days, v_cal FROM projects.work_item_types t WHERE t.key = 'task';
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (v_org, v_new, 'task', 'empty-state probe', v_creator, v_creator, v_creator)
  RETURNING id INTO v_id;
  SELECT due_date INTO d FROM projects.work_items WHERE id = v_id;
  d_expected := projects.push_past_builders_shutdown(
                  projects.add_working_days(
                    (now() AT TIME ZONE 'Africa/Johannesburg')::date, v_days, v_new, v_cal),
                  v_new);
  IF d <> d_expected THEN
    RAISE EXCEPTION 'with no task key at all, a task is due % rather than the registry''s % (%wd/%)', d, d_expected, v_days, v_cal;
  END IF;
  IF projects.resolve_work_item_assignee(v_new, 'task', NULL) IS NULL THEN
    RAISE EXCEPTION 'with no task key at all, the assignee chain returned NULL for the new project';
  END IF;

  RAISE NOTICE 'work-item-defaults: 14/14 assertions passed';
END $$;
