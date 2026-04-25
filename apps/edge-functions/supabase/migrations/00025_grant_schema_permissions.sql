-- ---------------------------------------------------------------------------
-- Migration 00025: Grant schema-level permissions to Postgres roles
-- All custom schemas must grant USAGE + table privileges to the roles
-- that PostgREST impersonates: anon, authenticated, service_role.
-- Without these the REST API returns "permission denied for schema X".
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  s TEXT;
BEGIN
  FOREACH s IN ARRAY ARRAY['projects','compliance','field','marketplace','suppliers','billing','tenants']
  LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO anon, authenticated, service_role', s);
    EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %I TO service_role', s);
    EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA %I TO service_role', s);
    EXECUTE format('GRANT ALL ON ALL ROUTINES IN SCHEMA %I TO service_role', s);
    -- authenticated users get CRUD; anon gets SELECT only
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO authenticated', s);
    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO anon', s);
    EXECUTE format('GRANT USAGE ON ALL SEQUENCES IN SCHEMA %I TO authenticated', s);
    -- Default privileges so future tables inherit the same grants
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT ALL ON TABLES TO service_role', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT ALL ON SEQUENCES TO service_role', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT ON TABLES TO anon', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE ON SEQUENCES TO authenticated', s);
  END LOOP;
END $$;
