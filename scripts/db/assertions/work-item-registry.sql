DO $$
DECLARE n int; r record; v_con text;
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
      -- rfi: 'creator', amended by 00199 C' (improvement 4). This file asserts
      -- the registry as of the LATEST migration: green with WITH_EXTRA=<00199>
      -- stacked, red against production until 00199 applies.
      ('rfi',7,'office','creator'), ('snag',5,'site','project_pm'),
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
  --    A(b): explicit chase only. A seventh trigger would project all 448
  --    (measured 2026-09-12) live procurement rows into inboxes on day one.
  --    Two arms: the trigger's own definition AND the body of the function it
  --    fires — a trigger named `touch_row` whose function writes work_items
  --    would sail past a name-only test.
  SELECT count(*) INTO n FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_namespace nsp ON nsp.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = tg.tgfoid
   WHERE nsp.nspname='structure' AND c.relname='node_orders' AND NOT tg.tgisinternal
     AND (p.prosrc ILIKE '%work_items%' OR pg_get_triggerdef(tg.oid) ILIKE '%work_item%');
  IF n <> 0 THEN RAISE EXCEPTION 'structure.node_orders carries % work-item trigger(s); A(b) forbids any', n; END IF;
  --    And the baseline: the ONLY non-internal trigger on node_orders is its
  --    updated_at touch (live set read 2026-09-12: {node_orders_updated_at}).
  --    A new trigger of ANY name lands here even if its body dodges both
  --    patterns above. IS DISTINCT FROM so an empty set (NULL) reads red too.
  --    tgname is `name`, not text — cast, or name[] <> text[] has no operator.
  IF (SELECT array_agg(tg.tgname::text ORDER BY tg.tgname) FROM pg_trigger tg
        JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_namespace nsp ON nsp.oid = c.relnamespace
       WHERE nsp.nspname='structure' AND c.relname='node_orders' AND NOT tg.tgisinternal)
     IS DISTINCT FROM ARRAY['node_orders_updated_at']::text[]
  THEN RAISE EXCEPTION 'structure.node_orders trigger set is not exactly {node_orders_updated_at}: %',
        (SELECT array_agg(tg.tgname::text ORDER BY tg.tgname) FROM pg_trigger tg
           JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_namespace nsp ON nsp.oid = c.relnamespace
          WHERE nsp.nspname='structure' AND c.relname='node_orders' AND NOT tg.tgisinternal); END IF;

  -- 5. The registry is readable but not writable by a client, and not by anon.
  --    The anon revoke is §10's: before it this arm failed with
  --    `anon can SELECT projects.work_item_types` (confirmed at Task 4, Step 4)
  --    — 00025_grant_schema_permissions.sql:26's ALTER DEFAULT PRIVILEGES
  --    granting anon SELECT on every new projects table, exactly what §12 §(a)
  --    warns about. The write grants are revoked from authenticated in §10 too,
  --    so a client insert is a permission error, not merely a policy one.
  IF has_table_privilege('anon','projects.work_item_types','SELECT')
  THEN RAISE EXCEPTION 'anon can SELECT projects.work_item_types'; END IF;
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='projects' AND tablename='work_item_types' AND cmd <> 'SELECT';
  IF n <> 0 THEN RAISE EXCEPTION 'work_item_types has % write policy/policies; the registry is migration-managed', n; END IF;
  IF has_table_privilege('authenticated','projects.work_item_types','INSERT, UPDATE, DELETE')
  THEN RAISE EXCEPTION 'authenticated holds a write grant on projects.work_item_types; the registry is migration-managed'; END IF;

  -- 6. A type can never exclude the GOVERNING roles from its write set. §12's
  --    guard reaches owner/admin/PM for the triage/open hand-off, the due
  --    date, the reopen and the void ONLY through the type's write_roles
  --    (v_may_write, and v_may_manage through it) — so a future seed that
  --    dropped admin would lock every admin out of managing that type, with
  --    nothing at CREATE time to say so. The vocabulary CHECK alone admits
  --    such a row (it only bounds the set from above). Pinned on the
  --    constraint NAME: a row refused by some other CHECK would otherwise
  --    pass for this one.
  BEGIN
    INSERT INTO projects.work_item_types (key, label, default_days, calendar, gatekeeper_rule, write_roles)
    VALUES ('_assert_no_admin', 'no admin', 1, 'office', 'project_pm', ARRAY['owner','project_manager','contractor']);
    RAISE EXCEPTION 'SENTINEL: a type whose write_roles omit admin was registered';
  EXCEPTION
    WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF v_con <> 'work_item_types_write_roles_govern' THEN
        RAISE EXCEPTION 'a type omitting admin was refused by % rather than work_item_types_write_roles_govern', v_con;
      END IF;
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'SENTINEL:%' THEN RAISE; END IF;
      RAISE EXCEPTION 'wrong failure for the admin-less write set: %', SQLERRM;
  END;

  RAISE NOTICE 'work-item-registry: 6/6 assertions passed';
END $$;
