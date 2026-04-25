-- ---------------------------------------------------------------------------
-- Migration 00028: Force PostgREST schema-cache reload
-- ---------------------------------------------------------------------------
-- Embedded joins across schemas (e.g. projects.projects → public.profiles via
-- site_manager_id / created_by) were failing with PGRST200 because PostgREST
-- had not introspected the cross-schema FKs after the recent schema changes
-- (migrations 00025–00027). A reload forces re-introspection.
-- ---------------------------------------------------------------------------

NOTIFY pgrst, 'reload schema';
