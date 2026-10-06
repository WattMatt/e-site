-- COVERAGE for site_scope: derived from the catalog.
--   scripts/db/dry-run-migration.sh scripts/db/fixtures/noop.sql scripts/db/assert-site-scope-coverage.sql            (red)
--   scripts/db/dry-run-migration.sh scripts/db/site-scope/site_scoped_access.sql scripts/db/assert-site-scope-coverage.sql (green)
-- A site table = a base table in a site schema with a project_id column, or a
-- single-column FK (up to 3 hops) to such a table or to projects.projects.
WITH RECURSIVE
site_schemas(s) AS (VALUES ('public'),('projects'),('inspections'),('field'),('tenants'),
                           ('structure'),('gcr'),('cable_schedule'),('marketplace'),('whatsapp')),
exempt(t, reason) AS (VALUES
  ('projects.jbcc_letter_number_seqs','allocator table, no end-user access (definer only)'),
  ('inspections.coc_number_seqs','allocator table, no end-user access (definer only)'),
  ('field.form_number_seqs','allocator table, no end-user access (definer only)'),
  ('marketplace.orders','two-party contractor/supplier model; marketplace IN DEV; own follow-up'),
  ('marketplace.order_items','child of marketplace.orders (exempt)'),
  ('marketplace.supplier_ratings','child of marketplace.orders (exempt)'),
  ('marketplace.commission_records','child of marketplace.orders (exempt)'),
  ('public.email_events','org-admin-only read; project_id is metadata'),
  ('public.product_events','insert-only telemetry; project_id is metadata'),
  ('public.rate_sources','org rate library (rate_library_can_access), not site data'),
  ('public.rate_observations','org rate library, not site data'),
  ('public.rate_source_lines','org rate library, not site data'),
  ('cable_schedule.rate_library','org rate library, not site data'),
  ('whatsapp.inbound','service/definer only; wa_* functions act as the user under real RLS'),
  ('whatsapp.outbox','service/definer only'),
  ('whatsapp.phone_links','own-row policy; current_project_id is a menu pointer, not site data'),
  ('whatsapp.form_sessions','service/definer only'),
  ('whatsapp.form_links','service/definer only')
),
tbl AS (
  SELECT c.oid, n.nspname||'.'||c.relname AS t,
         EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='project_id' AND NOT a.attisdropped) AS has_pid
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE c.relkind IN ('r','p') AND NOT c.relispartition AND n.nspname IN (SELECT s FROM site_schemas)
),
fk AS (
  SELECT con.conrelid AS child, con.confrelid AS parent FROM pg_constraint con
   WHERE con.contype='f' AND array_length(con.conkey,1)=1
),
reach(oid, depth) AS (
  SELECT oid, 0 FROM tbl WHERE has_pid OR t='projects.projects'
  UNION
  SELECT fk.child, r.depth+1 FROM reach r JOIN fk ON fk.parent=r.oid WHERE r.depth < 3
),
cand AS (
  SELECT DISTINCT t.t FROM tbl t JOIN reach r ON r.oid=t.oid WHERE t.t NOT IN (SELECT t FROM exempt)
),
gated AS (
  SELECT schemaname||'.'||tablename AS t FROM pg_policies
   WHERE policyname='site_scope' AND permissive='RESTRICTIVE' AND cmd='ALL'
)
SELECT 'site_scope present: '||c.t AS check, (c.t IN (SELECT t FROM gated)) AS ok
  FROM cand c
UNION ALL
SELECT 'exempt table still exists: '||e.t, EXISTS (SELECT 1 FROM tbl WHERE tbl.t=e.t) FROM exempt e
UNION ALL
SELECT 'storage site_scope_objects present',
       EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
                AND policyname='site_scope_objects' AND permissive='RESTRICTIVE')
ORDER BY 1;
