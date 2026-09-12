-- Assertions for 00196 §6 (work_items_ensure_ref, the per-project per-type ref
-- allocator and its permanent prefixes). Run inside the rolled-back transaction
-- opened by try-work-item-spine.sh.
--
-- The table is created in this same transaction, so it is EMPTY when the first
-- insert below runs: "the first task is TASK-1" is a real assertion here, not
-- an assumption about production.
DO $$
DECLARE v_proj uuid; v_org uuid; v_pm uuid; v_rfi uuid; v_a uuid; v_b uuid; r text; n int;
BEGIN
  SELECT p.id, p.organisation_id INTO v_proj, v_org
    FROM projects.projects p WHERE p.status='active' ORDER BY p.created_at LIMIT 1;
  v_pm := projects.resolve_project_pm(v_proj);
  -- Every insert runs work_items_set_due_date -> add_working_days, which raises
  -- no_data_found on an unseeded year. Rolled back with everything else.
  INSERT INTO projects.calendar_years (year)
  VALUES (EXTRACT(YEAR FROM CURRENT_DATE)::int), (EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)
  ON CONFLICT DO NOTHING;

  -- RAISE rather than skip: a LIMIT 1 that returns nothing would turn the
  -- per-type counter proof (assertion 2) into a no-op with a green tick.
  SELECT r2.id INTO v_rfi FROM projects.rfis r2 WHERE r2.project_id = v_proj LIMIT 1;
  IF v_rfi IS NULL THEN
    RAISE EXCEPTION 'no rfi on project % — the per-type counter assertion cannot fail and would be decorative', v_proj;
  END IF;

  -- 1. The first task on this project is TASK-1, and the counter is per type.
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (v_org, v_proj, 'task', 'first', v_pm, v_pm, v_pm) RETURNING id, ref INTO v_a, r;
  IF r !~ '^TASK-[0-9]+$' THEN RAISE EXCEPTION 'ref % is not <PREFIX>-<n>', r; END IF;
  IF r <> 'TASK-1' THEN RAISE EXCEPTION 'the first task on this project is %, expected TASK-1', r; END IF;

  INSERT INTO projects.work_items (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (v_org, v_proj, 'task', 'second', v_pm, v_pm, v_pm) RETURNING id INTO v_b;
  IF (SELECT regexp_replace(ref,'^.*-','')::int FROM projects.work_items WHERE id=v_b)
     <> (SELECT regexp_replace(ref,'^.*-','')::int FROM projects.work_items WHERE id=v_a) + 1
  THEN RAISE EXCEPTION 'the per-project per-type counter did not advance by 1'; END IF;

  -- 2. A DIFFERENT type on the SAME project starts its own series, under its own
  --    prefix. A single project-wide counter would pass a "ref exists" test.
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, rfi_id)
  VALUES (v_org, v_proj, 'rfi', 'first rfi', v_pm, v_pm, v_pm, v_rfi)
  RETURNING ref INTO r;
  IF r <> 'RFI-1' THEN RAISE EXCEPTION 'the first rfi on this project is %, expected RFI-1', r; END IF;

  -- 3. THE PREFIXES ARE THE SHORT HUMAN ONES, on every registered type. This is
  --    permanent: ref is immutable and travels into emails, PDFs and client deep
  --    links (§15 §(e)). upper(item_type) would have shipped QC_DEFECT-7.
  --    The ugliest case is asserted directly; the rest are covered by the
  --    both-directions contract test in Task 14, which parses this same CASE.
  IF (SELECT prosrc FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid=p.pronamespace
       WHERE nsp.nspname='projects' AND p.proname='work_items_ensure_ref')
     NOT LIKE '%''qc_defect''%THEN%''QC''%'
  THEN RAISE EXCEPTION 'work_items_ensure_ref does not map qc_defect to QC — upper(item_type) would ship QC_DEFECT-7 permanently'; END IF;

  -- ...and every registered key has an arm, so nothing falls through to the
  -- upper(item_type) ELSE.
  SELECT count(*) INTO n FROM projects.work_item_types t
   WHERE (SELECT prosrc FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid=p.pronamespace
           WHERE nsp.nspname='projects' AND p.proname='work_items_ensure_ref')
         NOT LIKE '%WHEN ''' || t.key || '''%';
  IF n <> 0 THEN RAISE EXCEPTION '% registered type(s) have no arm in work_items_ensure_ref''s prefix CASE', n; END IF;

  -- 4. An explicitly supplied ref is respected (item 3's backfill sets refs).
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, ref)
  VALUES (v_org, v_proj, 'task', 'explicit', v_pm, v_pm, v_pm, 'TASK-9999');
  IF NOT EXISTS (SELECT 1 FROM projects.work_items WHERE project_id=v_proj AND ref='TASK-9999')
  THEN RAISE EXCEPTION 'an explicit ref was overwritten'; END IF;

  -- 5. NEVER REUSED. After TASK-9999 the next allocation is 10000, not 3.
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (v_org, v_proj, 'task', 'after the gap', v_pm, v_pm, v_pm) RETURNING ref INTO r;
  IF r <> 'TASK-10000' THEN RAISE EXCEPTION 'ref after TASK-9999 was %, expected TASK-10000', r; END IF;

  -- 6. NEVER DELETED — there is no DELETE policy for authenticated at all, which
  --    is what makes MAX+1 monotonic. (Verified properly in the RLS assertions;
  --    here we assert the policy's absence.)
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='projects' AND tablename='work_items' AND cmd='DELETE';
  IF n <> 0 THEN RAISE EXCEPTION 'work_items has a DELETE policy; refs could then be reused'; END IF;

  RAISE NOTICE 'work-item-ref: 6/6 assertions passed';
END $$;
