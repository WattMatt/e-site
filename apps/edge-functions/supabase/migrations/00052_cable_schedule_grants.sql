-- =============================================================================
-- Migration 00052 — cable_schedule: table-level GRANTs for authenticated/anon
-- =============================================================================
-- Supabase requires explicit GRANTs on tables in custom schemas for the
-- `authenticated` and `anon` roles before RLS is even consulted. Without
-- these, PostgREST returns 403 "permission denied for table X" before any
-- RLS policy is evaluated. The schema-level USAGE grant in 00051 covers
-- visibility; this one covers data access.
--
-- Idempotent — GRANTs are safely re-runnable.
-- =============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE
    ON ALL TABLES IN SCHEMA cable_schedule
    TO authenticated, service_role;

GRANT SELECT ON ALL TABLES IN SCHEMA cable_schedule TO anon;

-- Sequences (in case any SERIAL/IDENTITY columns are added later).
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA cable_schedule
    TO authenticated, service_role;

-- Default privileges for any future tables created in this schema —
-- avoids having to re-run a grants migration each time a new table lands.
ALTER DEFAULT PRIVILEGES IN SCHEMA cable_schedule
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA cable_schedule
    GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA cable_schedule
    GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
