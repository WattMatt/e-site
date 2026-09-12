-- Assertions for 00196 §0 + §2–§4 (the spine table, A(a)'s index set, events,
-- watchers). Run inside the rolled-back transaction opened by
-- try-work-item-spine.sh. Every constraint is asserted by ATTEMPTING THE
-- VIOLATION — "the table was created" always passes and proves nothing.
DO $$
DECLARE v_proj uuid; v_org uuid; v_pm uuid; v_rfi uuid; v_snag uuid; v_id uuid; n int; ok boolean;
BEGIN
  SELECT p.id, p.organisation_id INTO v_proj, v_org
    FROM projects.projects p WHERE p.status='active' ORDER BY p.created_at LIMIT 1;
  v_pm := projects.resolve_project_pm(v_proj);

  -- Seed the calendar years this file's inserts walk into. EVERY assertion file
  -- carries this prelude, because every insert runs work_items_set_due_date ->
  -- add_working_days, which raises no_data_found on an unseeded year — and a
  -- run in late December pushes the scan window into the following year.
  INSERT INTO projects.calendar_years (year)
  VALUES (EXTRACT(YEAR FROM CURRENT_DATE)::int), (EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)
  ON CONFLICT DO NOTHING;

  -- Source fixtures. RAISE rather than skip: a LIMIT 1 that returns nothing
  -- turns three constraint proofs into no-ops with a green tick.
  SELECT r.id INTO v_rfi FROM projects.rfis r WHERE r.project_id = v_proj LIMIT 1;
  IF v_rfi IS NULL THEN
    RAISE EXCEPTION 'no rfi on project % — work_items_one_source, the per-source partial UNIQUE and the split case cannot fail and would be decorative', v_proj;
  END IF;
  SELECT s.id INTO v_snag FROM field.snags s LIMIT 1;
  IF v_snag IS NULL THEN
    RAISE EXCEPTION 'no snag anywhere — the two-source violation in assertion 4 cannot be constructed';
  END IF;

  -- 1. A minimal legal row inserts, and every derived column is populated.
  --    status defaults to 'triage' AT THE COLUMN LEVEL, deliberately: the
  --    database cannot tell whether an assignee was chosen or resolved. §03
  --    §1.6's "born open when an assignee was named" is enforced where that
  --    fact is known — createWorkItemTaskAction (Task 13) and item 3's mirror
  --    triggers both supply status explicitly.
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (v_org, v_proj, 'task', 'assert row', v_pm, v_pm, v_pm)
  RETURNING id INTO v_id;

  SELECT ball_in_court_id = assignee_id AND due_date IS NOT NULL
     AND ref IS NOT NULL AND status='triage' AND origin='mirror' AND priority='medium'
    INTO ok FROM projects.work_items WHERE id = v_id;
  IF NOT ok THEN RAISE EXCEPTION 'defaults/generated columns wrong on a fresh row'; END IF;

  -- 2. work_items_bic_present — ball-in-court is generated, so this asserts the
  --    CASE, not a stored value. answered must point at the GATEKEEPER, which is
  --    the case the whole primitive exists for (§12 §(h)).
  UPDATE projects.work_items SET status='open'     WHERE id=v_id;
  SELECT ball_in_court_id = assignee_id   INTO ok FROM projects.work_items WHERE id=v_id;
  IF NOT ok THEN RAISE EXCEPTION 'open: ball_in_court must be the assignee'; END IF;
  UPDATE projects.work_items SET status='answered' WHERE id=v_id;
  SELECT ball_in_court_id = gatekeeper_id INTO ok FROM projects.work_items WHERE id=v_id;
  IF NOT ok THEN RAISE EXCEPTION 'answered: ball_in_court must be the GATEKEEPER, not the assignee'; END IF;

  -- 3. ball_in_court_id has NO write path at all. A generated column rejects a
  --    direct write, which is why §12 §(b) rule 4 needs no attribution guard for it.
  BEGIN
    EXECUTE format('UPDATE projects.work_items SET ball_in_court_id = %L WHERE id = %L', v_pm, v_id);
    RAISE EXCEPTION 'ball_in_court_id accepted a direct write';
  EXCEPTION WHEN generated_always THEN NULL; END;

  -- 4. work_items_one_source — two sources on one row is refused.
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by,
       rfi_id, snag_id)
    VALUES (v_org, v_proj, 'rfi', 'two sources', v_pm, v_pm, v_pm, v_rfi, v_snag);
    RAISE EXCEPTION 'work_items_one_source did not fire on two source columns';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 5. work_items_source_required — a MIRRORED type with no source is refused,
  --    while task/approval and any void row stay legal.
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
    VALUES (v_org, v_proj, 'rfi', 'sourceless rfi', v_pm, v_pm, v_pm);
    RAISE EXCEPTION 'work_items_source_required did not fire on a sourceless rfi';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 6. work_items_ref_unique — the same ref twice on one project is refused.
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, ref)
    SELECT v_org, v_proj, 'task', 'dupe ref', v_pm, v_pm, v_pm, ref
      FROM projects.work_items WHERE id = v_id;
    RAISE EXCEPTION 'work_items_ref_unique did not fire on a duplicate ref';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- 7. The per-source partial UNIQUE is idempotent for mirrors but permits a
  --    deliberate split — which is what makes two people on one source possible
  --    while an accidental double-mirror is not (§03 §1.3).
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, rfi_id, origin)
  VALUES (v_org, v_proj, 'rfi', 'mirror', v_pm, v_pm, v_pm, v_rfi, 'mirror');
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, rfi_id, origin)
    VALUES (v_org, v_proj, 'rfi', 'double mirror', v_pm, v_pm, v_pm, v_rfi, 'mirror');
    RAISE EXCEPTION 'a second mirror row on one rfi_id was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, rfi_id, origin)
  VALUES (v_org, v_proj, 'rfi', 'deliberate split', v_pm, v_pm, v_pm, v_rfi, 'split');

  -- 8. The four A(a) indexes exist under the names the Inbox and My Work read.
  SELECT count(*) INTO n FROM pg_indexes
   WHERE schemaname='projects' AND tablename='work_items'
     AND indexname IN ('work_items_my_work_idx','work_items_inbox_idx',
                       'work_items_project_module_idx','work_items_org_idx');
  IF n <> 4 THEN RAISE EXCEPTION 'expected A(a)''s 4 named indexes, found %', n; END IF;

  -- 9. work_item_events carries a SELECT policy and NO write policy (§12 §(a),
  --    the 00179:504-506 shape). An INSERT policy here lets a client forge history.
  --    (The SELECT policy itself is created in §9; here we assert only that no
  --    write policy exists, which is true from the moment the table does.)
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='projects' AND tablename='work_item_events' AND cmd <> 'SELECT';
  IF n <> 0 THEN RAISE EXCEPTION 'work_item_events has % write policy/policies; it must have none', n; END IF;

  -- 10. The three metric columns exist. They cannot be backfilled — the event
  --     stream is the only record of what a row used to be — so a migration
  --     that shipped without them would make metric 5's denominator and metric
  --     2a's role diagnostic permanently unanswerable for every row written
  --     before the fix.
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema='projects' AND table_name='work_item_events'
     AND column_name IN ('from_ball_in_court_id','to_ball_in_court_id','actor_role');
  IF n <> 3 THEN RAISE EXCEPTION 'work_item_events is missing % of the 3 metric columns', 3 - n; END IF;

  -- 11. Nothing anywhere references the Q2 column. Its FK target does not exist.
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema='projects' AND table_name='work_items' AND column_name='instruction_recipient_id';
  IF n <> 0 THEN RAISE EXCEPTION 'instruction_recipient_id is a Q2 column and must not exist yet'; END IF;

  RAISE NOTICE 'work-item-ddl: 11/11 assertions passed';
END $$;
