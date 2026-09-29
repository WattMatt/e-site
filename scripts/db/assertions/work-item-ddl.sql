-- Assertions for 00196 §0 + §2–§4 (the spine table, A(a)'s index set, events,
-- watchers). Run inside the rolled-back transaction opened by
-- try-work-item-spine.sh. Every constraint is asserted by ATTEMPTING THE
-- VIOLATION — "the table was created" always passes and proves nothing.
DO $$
DECLARE v_proj uuid; v_org uuid; v_pm uuid; v_rfi uuid; v_snag uuid; v_id uuid; n int; ok boolean;
        v_con text;    -- CONSTRAINT_NAME from GET STACKED DIAGNOSTICS: every
                       -- "it was refused" arm pins WHICH constraint refused it
        v_def text;
        v_idx record;  -- NOT `r`: a PL/pgSQL variable shadows the SQL alias `r`
                       -- that the rfis fixture SELECT below uses (measured)
BEGIN
  SELECT p.id, p.organisation_id INTO v_proj, v_org
    FROM projects.projects p WHERE p.status='active' ORDER BY p.created_at LIMIT 1;
  IF v_proj IS NULL THEN
    RAISE EXCEPTION 'no active project — every insert below needs one, and a NULL here would fail assertion 1 on a FK rather than on the DDL under test';
  END IF;
  v_pm := projects.resolve_project_pm(v_proj);
  IF v_pm IS NULL THEN
    RAISE EXCEPTION 'resolve_project_pm(%) returned NULL — the oldest active project has nobody who can own work; the NOT NULL people columns would fail on that, not on the DDL under test', v_proj;
  END IF;

  -- Seed the calendar years this file's inserts walk into. EVERY assertion file
  -- carries this prelude, because every insert runs work_items_set_due_date ->
  -- add_working_days, which raises no_data_found on an unseeded year — and a
  -- run in late December pushes the scan window into the following year.
  INSERT INTO projects.calendar_years (year)
  VALUES (EXTRACT(YEAR FROM CURRENT_DATE)::int), (EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)
  ON CONFLICT DO NOTHING;

  -- Source fixtures, CREATED HERE rather than picked off the live estate.
  -- ⚠ This used to be `SELECT r.id FROM projects.rfis r … LIMIT 1` (and an
  -- unordered `field.snags LIMIT 1`). Once item 3's backfill (00202 section H)
  -- is stacked, every non-demo RFI already carries a mirror item and
  -- work_items_src_rfi_uidx admits exactly ONE, so assertion 7's own
  -- origin='mirror' insert aborted the whole file with
  --   ERROR: 23505: duplicate key value violates unique constraint "work_items_src_rfi_uidx"
  -- (measured 2026-09-15, Task 15 Step 6b). A row the file owns is also
  -- independent of which live row LIMIT 1 happens to return, which is the
  -- second reason: the old form asserted against KINGSWALK's oldest RFI and
  -- would have changed meaning the day someone raised an older one.
  -- Both inserts are unconditional, so nothing here can be vacuous.
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                             priority, status, raised_by)
  VALUES (v_proj, v_org, 'assertion fixture rfi', 'body', 'medium', 'open', v_pm)
  RETURNING id INTO v_rfi;
  INSERT INTO field.snags (project_id, organisation_id, title, location, priority,
                           status, raised_by)
  VALUES (v_proj, v_org, 'assertion fixture snag', 'Level 1', 'medium', 'open', v_pm)
  RETURNING id INTO v_snag;

  -- 00202's live mirror triggers project both rows on insert, and assertion 7
  -- asserts on a mirror row it inserts ITSELF. Remove the trigger-made ones:
  -- 0 rows before 00202 applies, 1 each after — correct in both windows.
  DELETE FROM projects.work_items WHERE rfi_id  = v_rfi  AND origin = 'mirror';
  DELETE FROM projects.work_items WHERE snag_id = v_snag AND origin = 'mirror';

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

  -- 4. work_items_one_source — two sources on one row is refused. item_type is
  --    'task' so work_items_source_required short-circuits on its first arm and
  --    ONLY one_source can fire; the handler then pins the constraint NAME, so a
  --    check_violation from any other CHECK reads red instead of green.
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by,
       rfi_id, snag_id)
    VALUES (v_org, v_proj, 'task', 'two sources', v_pm, v_pm, v_pm, v_rfi, v_snag);
    RAISE EXCEPTION 'work_items_one_source did not fire on two source columns';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con <> 'work_items_one_source' THEN RAISE EXCEPTION 'wrong constraint fired: %', v_con; END IF;
  END;

  -- 5. work_items_source_required — a MIRRORED type with no source is refused,
  --    while task/approval and any void row stay legal.
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
    VALUES (v_org, v_proj, 'rfi', 'sourceless rfi', v_pm, v_pm, v_pm);
    RAISE EXCEPTION 'work_items_source_required did not fire on a sourceless rfi';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con <> 'work_items_source_required' THEN RAISE EXCEPTION 'wrong constraint fired: %', v_con; END IF;
  END;

  -- 6. work_items_ref_unique — the same ref twice on one project is refused.
  BEGIN
    INSERT INTO projects.work_items
      (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, ref)
    SELECT v_org, v_proj, 'task', 'dupe ref', v_pm, v_pm, v_pm, ref
      FROM projects.work_items WHERE id = v_id;
    RAISE EXCEPTION 'work_items_ref_unique did not fire on a duplicate ref';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con <> 'work_items_ref_unique' THEN RAISE EXCEPTION 'wrong constraint fired: %', v_con; END IF;
  END;

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
  EXCEPTION WHEN unique_violation THEN
    -- A unique INDEX (not a constraint) still reports its name as CONSTRAINT_NAME.
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con <> 'work_items_src_rfi_uidx' THEN RAISE EXCEPTION 'wrong constraint fired: %', v_con; END IF;
  END;
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, rfi_id, origin)
  VALUES (v_org, v_proj, 'rfi', 'deliberate split', v_pm, v_pm, v_pm, v_rfi, 'split');

  -- 8. The four A(a) indexes exist under the names the Inbox and My Work read,
  --    WITH the column lists and partial predicates A(a) specifies. Pinned
  --    against the full pg_indexes.indexdef text (the normalised form PG 17.6
  --    prints, read back from a rolled-back apply on production, 2026-09-12),
  --    because an index with the right name and the wrong predicate is a full
  --    scan with a green tick.
  FOR v_idx IN SELECT * FROM (VALUES
      ('work_items_my_work_idx',
       'CREATE INDEX work_items_my_work_idx ON projects.work_items USING btree (assignee_id, status, due_date) WHERE (status <> ''closed''::text)'),
      ('work_items_inbox_idx',
       'CREATE INDEX work_items_inbox_idx ON projects.work_items USING btree (ball_in_court_id, due_date) WHERE (status = ANY (ARRAY[''triage''::text, ''open''::text, ''answered''::text]))'),
      ('work_items_project_module_idx',
       'CREATE INDEX work_items_project_module_idx ON projects.work_items USING btree (project_id, item_type, status)'),
      ('work_items_org_idx',
       'CREATE INDEX work_items_org_idx ON projects.work_items USING btree (organisation_id)')
    ) AS e(idx_name, idx_def) LOOP
    SELECT indexdef INTO v_def FROM pg_indexes
     WHERE schemaname='projects' AND tablename='work_items' AND indexname = v_idx.idx_name;
    IF v_def IS NULL THEN RAISE EXCEPTION 'A(a) index % is missing', v_idx.idx_name; END IF;
    IF v_def <> v_idx.idx_def THEN
      RAISE EXCEPTION 'A(a) index % has the wrong definition: got [%], expected [%]', v_idx.idx_name, v_def, v_idx.idx_def;
    END IF;
  END LOOP;

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
