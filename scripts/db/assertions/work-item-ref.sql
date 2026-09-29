-- Assertions for 00196 §6 (work_items_ensure_ref, the per-project per-type ref
-- allocator and its permanent prefixes). Run inside the rolled-back transaction
-- opened by try-work-item-spine.sh.
--
-- ⚠ This file no longer relies on projects.work_items being empty, and must
-- not: stacked behind 00202 (WITH_EXTRA), section H has already backfilled 35
-- mirror items before these assertions run. Every ref assertion instead uses a
-- project this file CREATES, which is empty in both windows — unstacked, where
-- the table itself is new, and stacked, where it is not. "The first task is
-- TASK-1" is therefore a real assertion about a known-empty (project, type)
-- pair, not an assumption about the estate.
DO $$
DECLARE v_proj uuid; v_org uuid; v_pm uuid; v_rfi uuid; v_a uuid; v_b uuid; r text; n int;
        v_proj2 uuid; v_org2 uuid; v_pm2 uuid;
BEGIN
  -- ⚠ A project this file CREATES, not the oldest live one. Assertions 1b, 2
  -- and 3a all read "the first <type> on this project is <PREFIX>-1", which is
  -- only true while work_items holds nothing for that project. That was free
  -- while the table was created inside this same transaction — but once item
  -- 3's backfill (00202 section H) is stacked it projects a mirror item for
  -- every live RFI, inspection and site form, so the oldest live project
  -- already holds RFI-1 and this file aborted with
  --   ERROR: 23505: duplicate key value violates unique constraint "work_items_src_rfi_uidx"
  -- on the fixture RFI it shared with the backfill (measured 2026-09-15, Task
  -- 15 Step 6b). A project created here is empty in BOTH windows, and the
  -- allocator assertions are about mechanics, not about live data.
  SELECT p.organisation_id INTO v_org
    FROM projects.projects p WHERE p.status='active' ORDER BY p.created_at LIMIT 1;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'no active project — there is no organisation to hang the fixture project on';
  END IF;
  -- The org owner/admin: 00107 gives owner/admin/project_manager an effective
  -- role on every project of their org from user_organisations alone, so this
  -- person passes item 2's assignee-membership trigger on a brand-new project
  -- (resolve_project_pm returns NULL on one, and the NOT NULL people columns
  -- would then fail on the FK rather than on the allocator under test).
  SELECT u.user_id INTO v_pm FROM public.user_organisations u
   WHERE u.organisation_id = v_org AND u.role IN ('owner','admin') AND u.is_active
     AND EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = u.user_id)
   ORDER BY u.created_at, u.user_id LIMIT 1;
  IF v_pm IS NULL THEN
    RAISE EXCEPTION 'organisation % has no active owner/admin with a profile — nobody can own the fixture work items', v_org;
  END IF;
  INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
  VALUES (v_org, '_probe_ref_allocator', 'active', 'ZAR', v_pm) RETURNING id INTO v_proj;

  -- Every insert runs work_items_set_due_date -> add_working_days, which raises
  -- no_data_found on an unseeded year. Rolled back with everything else.
  INSERT INTO projects.calendar_years (year)
  VALUES (EXTRACT(YEAR FROM CURRENT_DATE)::int), (EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)
  ON CONFLICT DO NOTHING;

  -- The file's own RFI. Unconditional, so assertion 2 can never be decorative.
  INSERT INTO projects.rfis (project_id, organisation_id, subject, description,
                             priority, status, raised_by)
  VALUES (v_proj, v_org, 'assertion fixture rfi', 'body', 'medium', 'open', v_pm)
  RETURNING id INTO v_rfi;
  -- 00202's live trigger mirrors this RFI on insert and that mirror takes RFI-1;
  -- assertion 2 inserts the rfi item ITSELF and reads the ref back. Removing the
  -- trigger-made row restores an empty rfi series (the allocator is MAX+1 over
  -- rows that exist): 0 rows before 00202 applies, 1 after — correct in both.
  DELETE FROM projects.work_items WHERE rfi_id = v_rfi AND origin = 'mirror';

  -- 1a. The first task on this project is <PREFIX>-<n> ...
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (v_org, v_proj, 'task', 'first', v_pm, v_pm, v_pm) RETURNING id, ref INTO v_a, r;
  IF r !~ '^TASK-[0-9]+$' THEN RAISE EXCEPTION 'ref % is not <PREFIX>-<n>', r; END IF;
  -- 1b. ...and specifically TASK-1, because the table is empty at this point.
  IF r <> 'TASK-1' THEN RAISE EXCEPTION 'the first task on this project is %, expected TASK-1', r; END IF;

  -- 1c. The counter advances by exactly 1.
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

  -- 3a. THE PREFIXES ARE THE SHORT HUMAN ONES. This is permanent: ref is
  --     immutable and travels into emails, PDFs and client deep links (§15
  --     §(e)). upper(item_type) would have shipped QC_DEFECT-7. Asserted on
  --     BEHAVIOUR — the ref an actual qc_defect row receives — because a scan
  --     of the function's source text stays green under
  --     `WHEN 'qc_defect' THEN 'QC' || '_DEFECT'` while the row gets QC_DEFECT-1.
  --     status='void' is the one state work_items_source_required accepts
  --     without a source column, so no qc_entries fixture is needed.
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, status)
  VALUES (v_org, v_proj, 'qc_defect', 'prefix probe', v_pm, v_pm, v_pm, 'void')
  RETURNING ref INTO r;
  IF r <> 'QC-1' THEN
    RAISE EXCEPTION 'the first qc_defect on this project is %, expected QC-1 — upper(item_type) would ship QC_DEFECT-7 permanently', r;
  END IF;

  -- 3b. ...and every registered key has an arm, so nothing falls through to the
  --     upper(item_type) ELSE. This one IS a source-text scan, deliberately: it
  --     is the only way to assert the ABSENCE of a fall-through for every key
  --     without a fixture row per type. Task 14's contract test parses this
  --     same CASE against REF_PREFIXES in both directions.
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

  -- 7. A MALFORMED EXPLICIT REF MUST NOT BREAK ALLOCATION FOR THAT TYPE FOREVER.
  --    ref is immutable from Task 11 and rows are never deleted after Task 9,
  --    so there is no repair path — and after Task 9 any member with a task
  --    write role can POST {"ref":"JUNK"} over PostgREST (a WITH CHECK cannot
  --    require ref IS NULL: it is evaluated AFTER the BEFORE triggers). Casting
  --    every row's tail raised 22P02 on 'JUNK' and 22003 on an int4 overflow
  --    (measured on production, rolled back). The allocator must count only
  --    tails it can parse, and the next auto ref is max(parseable) + 1.
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, ref)
  VALUES (v_org, v_proj, 'task', 'junk ref', v_pm, v_pm, v_pm, 'JUNK');
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, ref)
  VALUES (v_org, v_proj, 'task', 'overflow ref', v_pm, v_pm, v_pm, 'TASK-2147483647');
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (v_org, v_proj, 'task', 'after junk', v_pm, v_pm, v_pm) RETURNING ref INTO r;
  IF r <> 'TASK-10001' THEN
    RAISE EXCEPTION 'ref allocated after a JUNK and an overflowing explicit ref was %, expected TASK-10001', r;
  END IF;

  -- 8. THE COUNTER IS PER PROJECT. The first task on a SECOND project is TASK-1
  --    while the first project already holds several — a MAX that forgot the
  --    project predicate would hand it TASK-10002. A SECOND project this file
  --    creates, for the same reason as the first: a live second project holds
  --    backfilled items once 00202 is stacked, and "only one active project"
  --    would have made the assertion decorative.
  v_org2 := v_org;
  v_pm2  := v_pm;
  INSERT INTO projects.projects (organisation_id, name, status, currency, created_by)
  VALUES (v_org2, '_probe_ref_allocator_2', 'active', 'ZAR', v_pm2) RETURNING id INTO v_proj2;
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by)
  VALUES (v_org2, v_proj2, 'task', 'first on another project', v_pm2, v_pm2, v_pm2) RETURNING ref INTO r;
  IF r <> 'TASK-1' THEN
    RAISE EXCEPTION 'the first task on a second project is %, expected TASK-1 — the counter leaked across projects', r;
  END IF;

  RAISE NOTICE 'work-item-ref: 11/11 assertions passed';
END $$;
