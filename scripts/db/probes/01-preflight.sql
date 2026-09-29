-- 01-preflight.sql — Task 2's gate. Asserts the objects 00202 reads from item 2
-- AS BUILT exist on production. Expected to pass; a FAIL here means a rollback,
-- a diverged branch or a wrong project ref — not an unapplied item. Run:
--   node --experimental-strip-types scripts/db/rehearse-sql.ts scripts/db/probes/01-preflight.sql
-- and again with --with 00202 stacked, which must still read 7/7.
SELECT 'spine_applied' AS probe,
       to_regclass('projects.work_items') IS NOT NULL AS ok,
       'A(f) ordinal 7 (00196) must be APPLIED to production, not merely merged' AS detail
UNION ALL
SELECT 'settings_applied',
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='projects' AND table_name='project_settings'
           AND column_name IN ('work_item_defaults','triage_owner_id',
                               'builders_shutdown_start_md','builders_shutdown_end_md')) = 4,
       'A(f) ordinal 6, item 2''s slice (00195:63-67): four columns. suppress_all_outbound is NOT one of them'
UNION ALL
SELECT 'watchers_pk_present',
       EXISTS (SELECT 1 FROM pg_indexes
                WHERE schemaname='projects' AND tablename='work_item_watchers'
                  AND indexdef ILIKE 'CREATE UNIQUE INDEX%' AND indexdef ILIKE '%work_item_id%'
                  AND indexdef ILIKE '%user_id%'),
       '00196:450 — PK (work_item_id, user_id). §11 seeds watchers; this plan seeds none'
UNION ALL
SELECT 'product_events_present',
       to_regclass('public.product_events') IS NOT NULL,
       'section I writes the backfill-completion row (A(f) ordinal 9)'
UNION ALL
SELECT 'backfill_completed_in_vocabulary',
       EXISTS (SELECT 1 FROM pg_constraint c
                WHERE c.conrelid = 'public.product_events'::regclass
                  AND pg_get_constraintdef(c.oid) ~ '''backfill_completed'''),
       'F11: product_events.event is a fixed CHECK (00194:231-238); a free-text name aborts section I with 23514'
UNION ALL
SELECT 'six_types_registered',
       (SELECT count(*) FROM projects.work_item_types
         WHERE key IN ('rfi','snag','qc_defect','inspection','diary_action','form_action')) = 6,
       'item_type is an FK to work_item_types; all six mirrored A(b) keys must be seeded (00196:236-247)'
UNION ALL
SELECT 'guard_present',
       to_regprocedure('projects.work_items_transition_guard()') IS NOT NULL,
       'section C'' CREATE OR REPLACEs item 2''s guard; replacing a missing function would create a guard with no trigger';
