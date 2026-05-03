-- ---------------------------------------------------------------------------
-- Migration 00036: PostgREST schema-cache reload
-- ---------------------------------------------------------------------------
-- After 00033 added `public.rfi_annotations` (with `rfi_id` FK), the staging
-- PostgREST schema cache went stale. Symptom: 400 PGRST204 "Could not find
-- the 'rfi_id' column of 'rfi_annotations' in the schema cache" on every
-- attempt to insert/select using rfi_id.
--
-- This migration emits a NOTIFY that PostgREST listens for; it reloads its
-- schema introspection on receipt. No schema change. Safe to re-run.
-- ---------------------------------------------------------------------------

NOTIFY pgrst, 'reload schema';
