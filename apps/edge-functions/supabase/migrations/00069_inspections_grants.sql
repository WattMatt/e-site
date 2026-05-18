-- 00069_inspections_grants.sql
-- Hotfix: 00066 only granted USAGE on the inspections schema to authenticated
-- and service_role. It missed (a) USAGE for anon, and (b) all table + sequence
-- privileges. With no SELECT/INSERT/UPDATE/DELETE grants, PostgREST's schema
-- cache rebuild was failing with PGRST002 across the entire REST API — every
-- query returned 503 "Could not query the database for the schema cache".
--
-- Match the convention used by projects/cable_schedule/tenants schemas:
--   anon          → USAGE on schema + SELECT on tables
--   authenticated → USAGE on schema + SELECT/INSERT/UPDATE/DELETE on tables + USAGE on sequences
--   service_role  → full
-- RLS policies (defined in 00066) still enforce row-level access; table-level
-- GRANTs only control which rows the role can SEE at the introspection layer.

BEGIN;

GRANT USAGE ON SCHEMA inspections TO anon;

GRANT SELECT ON ALL TABLES IN SCHEMA inspections TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA inspections TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA inspections TO service_role;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA inspections TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA inspections TO service_role;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA inspections TO authenticated, service_role;

-- Apply same defaults to future tables created in the inspections schema.
ALTER DEFAULT PRIVILEGES IN SCHEMA inspections
  GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA inspections
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA inspections
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA inspections
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA inspections
  GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA inspections
  GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
