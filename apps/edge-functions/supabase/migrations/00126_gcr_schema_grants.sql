-- ---------------------------------------------------------------------------
-- Migration 00126: Grant schema-level permissions on the gcr schema
-- The gcr schema (00124) was created WITHOUT the standard API-role grants that
-- every other custom schema gets via 00025, so the Supabase REST API returned
-- "permission denied for schema gcr" and the Generator Cost-Recovery page threw
-- on its first authenticated .schema('gcr') read. This applies the identical
-- grant block (USAGE + table/sequence/routine privileges + default privileges)
-- for the roles PostgREST impersonates: anon, authenticated, service_role.
--
-- NEW-SCHEMA CHECKLIST (learned the hard way here): a brand-new schema needs
-- BOTH (1) this grant block AND (2) to be added to PostgREST's exposed schemas.
-- (2) is project config, NOT a migration: add the schema to
-- apps/edge-functions/supabase/config.toml [api].schemas (local) AND to the prod
-- project's db_schema (Supabase Dashboard -> API -> Exposed schemas, or the
-- Management API: PATCH /v1/projects/{ref}/postgrest). gcr's (2) was applied to
-- prod via the Management API on 2026-06-09. Migration 00124 shipped neither,
-- which is why the page threw "permission denied for schema gcr".
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  s TEXT;
BEGIN
  FOREACH s IN ARRAY ARRAY['gcr']
  LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO anon, authenticated, service_role', s);
    EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %I TO service_role', s);
    EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA %I TO service_role', s);
    EXECUTE format('GRANT ALL ON ALL ROUTINES IN SCHEMA %I TO service_role', s);
    -- authenticated users get CRUD (RLS still constrains rows); anon gets SELECT only
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

NOTIFY pgrst, 'reload schema';
