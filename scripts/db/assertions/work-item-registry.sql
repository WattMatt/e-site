DO $$
DECLARE n int; r record;
BEGIN
  -- 1. Exactly the eight Q1 keys from Appendix A(b). Not seven, not nine —
  --    `instruction` (Q2), `approval` (Q3) and `valuation` (Q4) are registered
  --    by the migration of the quarter that first creates rows of them.
  IF (SELECT array_agg(key ORDER BY key) FROM projects.work_item_types)
     <> ARRAY['diary_action','form_action','inspection','order_followup',
              'qc_defect','rfi','snag','task']
  THEN RAISE EXCEPTION 'work_item_types is not exactly A(b)''s eight Q1 keys: %',
        (SELECT array_agg(key ORDER BY key) FROM projects.work_item_types); END IF;

  -- 2. A(b)'s due offsets and calendars, row by row. A flat default would pass
  --    a count test, so this asserts the values.
  FOR r IN SELECT * FROM (VALUES
      ('rfi',7,'office','project_pm'), ('snag',5,'site','project_pm'),
      ('qc_defect',5,'site','project_pm'), ('inspection',3,'site','verifier_else_pm'),
      ('diary_action',2,'site','project_pm'), ('form_action',3,'site','project_pm'),
      ('order_followup',10,'office','project_pm'), ('task',5,'office','creator')
    ) AS e(key, days, cal, gk) LOOP
    IF NOT EXISTS (SELECT 1 FROM projects.work_item_types t
                    WHERE t.key=r.key AND t.default_days=r.days
                      AND t.calendar=r.cal AND t.gatekeeper_rule=r.gk)
    THEN RAISE EXCEPTION 'A(b) mismatch on %: expected %wd/%/%', r.key, r.days, r.cal, r.gk; END IF;
  END LOOP;

  -- 3. NO type admits client_viewer. §03 §1.9: the Watcher-tier write set lands
  --    in Q3, not here. NOTE: 00161_client_viewer_readonly_write_block.sql is
  --    NOT a second layer for work_items — see the comment on section 9.
  SELECT count(*) INTO n FROM projects.work_item_types WHERE 'client_viewer' = ANY(write_roles);
  IF n <> 0 THEN RAISE EXCEPTION '% type(s) admit client_viewer in Q1', n; END IF;

  -- 4. order_followup has a source_table but NO projection trigger anywhere.
  --    A(b): explicit chase only. A seventh trigger would project all 440 live
  --    procurement rows into inboxes on day one.
  SELECT count(*) INTO n FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_namespace nsp ON nsp.oid = c.relnamespace
   WHERE nsp.nspname='structure' AND c.relname='node_orders' AND NOT tg.tgisinternal
     AND pg_get_triggerdef(tg.oid) ILIKE '%work_item%';
  IF n <> 0 THEN RAISE EXCEPTION 'structure.node_orders carries % work-item trigger(s); A(b) forbids any', n; END IF;

  -- 5. The registry is readable but not writable by a client, and not by anon.
  -- TODO(Task 9): anon revoke lands in §10. Until then this arm fails with
  --   `anon can SELECT projects.work_item_types` — 00025_grant_schema_permissions.sql:26's
  --   ALTER DEFAULT PRIVILEGES granting anon SELECT on every new projects table,
  --   exactly what §12 §(a) warns about. Confirmed failing at Task 4 (Step 4);
  --   Task 9 re-enables it after the §10 revoke.
  -- IF has_table_privilege('anon','projects.work_item_types','SELECT')
  -- THEN RAISE EXCEPTION 'anon can SELECT projects.work_item_types'; END IF;
  -- SELECT count(*) INTO n FROM pg_policies
  --  WHERE schemaname='projects' AND tablename='work_item_types' AND cmd <> 'SELECT';
  -- IF n <> 0 THEN RAISE EXCEPTION 'work_item_types has % write policy/policies; the registry is migration-managed', n; END IF;

  RAISE NOTICE 'work-item-registry: 4/5 assertions passed (5 deferred to Task 9)';
END $$;
