-- Migration 00175: cloud-sync freshness — run lifecycle, walk telemetry,
-- connection health.
--
-- Companion to the cloud-sync-project engine rewrite (2026-07-23). The old
-- engine walked at most 50 files per run WITH unchanged files consuming the
-- budget, so folders >50 files never synced their tail; runs were logged
-- only after completion (no in-flight detection); a dead refresh token had
-- nowhere to surface. This migration adds:
--
--   1. tenants.cloud_sync_runs lifecycle + telemetry columns. Runs are now
--      INSERTed at start (status='running') and UPDATEd at completion, so
--      "a sync is already in flight" is a cheap DB question (the guard for
--      the new auto-sync-on-tab-open trigger). files_seen / downloads /
--      walk_complete / remaining make truncation observable instead of
--      silent.
--   2. trigger CHECK widened with 'auto' (sync fired by opening the
--      floor-plans/documents tab, in addition to 'manual' and 'cron').
--   3. public.org_storage_connections.needs_reauth + last_sync_error —
--      set when a token refresh fails, cleared on the next successful
--      refresh/reconnect, surfaced in the toolbar + settings/integrations.
--
-- Numbering note: 00174 is intentionally left for open PR #151
-- (fix/tenant-documents-effective-role-rls), which is renumbering its
-- migration to 00174 on rebase.
--
-- Plain column adds on existing tables — no schema create/drop, so no
-- PostgREST db_schema config PATCH is needed; the NOTIFY at the end
-- refreshes the schema cache.

-- 1. Run lifecycle + walk telemetry ------------------------------------------

ALTER TABLE tenants.cloud_sync_runs
    ADD COLUMN IF NOT EXISTS status        TEXT    NOT NULL DEFAULT 'done',
    ADD COLUMN IF NOT EXISTS files_seen    INTEGER,
    ADD COLUMN IF NOT EXISTS downloads     INTEGER,
    ADD COLUMN IF NOT EXISTS walk_complete BOOLEAN,
    ADD COLUMN IF NOT EXISTS remaining     INTEGER;

ALTER TABLE tenants.cloud_sync_runs
    DROP CONSTRAINT IF EXISTS cloud_sync_runs_status_check;
ALTER TABLE tenants.cloud_sync_runs
    ADD CONSTRAINT cloud_sync_runs_status_check
    CHECK (status IN ('running', 'done', 'error'));

COMMENT ON COLUMN tenants.cloud_sync_runs.status IS
    'running = in flight (inserted at start; the auto-sync in-flight guard); done/error = terminal. Pre-00175 rows default to done.';
COMMENT ON COLUMN tenants.cloud_sync_runs.files_seen IS
    'Files enumerated by the metadata walk this run (all of them, not just processed).';
COMMENT ON COLUMN tenants.cloud_sync_runs.downloads IS
    'Files actually downloaded this run (new + changed, capped by the per-run budget).';
COMMENT ON COLUMN tenants.cloud_sync_runs.walk_complete IS
    'TRUE when the whole mapped folder tree was enumerated (reconcile ran).';
COMMENT ON COLUMN tenants.cloud_sync_runs.remaining IS
    'New/changed files left un-downloaded when the budget ran out; callers loop until 0.';

-- finished_at now nullable in spirit: a 'running' row has no finish yet.
-- (Column was already nullable — no change needed; noted for readers.)

-- Widen the trigger CHECK with 'auto' (tab-open trigger). The original
-- constraint from 00148 is unnamed-inline, so its generated name is
-- cloud_sync_runs_trigger_check.
ALTER TABLE tenants.cloud_sync_runs
    DROP CONSTRAINT IF EXISTS cloud_sync_runs_trigger_check;
ALTER TABLE tenants.cloud_sync_runs
    ADD CONSTRAINT cloud_sync_runs_trigger_check
    CHECK (trigger IN ('manual', 'cron', 'auto'));

-- 2. Per-project default sync target -----------------------------------------
--
-- The folder mapping is created from a specific tab (Floor Plans or
-- Documents) — that tab IS the mapping's declared purpose. Persisting it
-- lets un-attended triggers (cron ticks, tab-open auto-sync) classify NEW
-- files the way the mapper intended, instead of (a) racing on whichever tab
-- a member happens to open first (the manual intent override) or (b) the
-- filename/folder heuristic, which misroutes root-level PDFs in folders
-- like ".../PDF/LATEST PDF" (segment names don't match the drawings regex)
-- into Documents. NULL = fall back to the per-file heuristic.

ALTER TABLE projects.projects
    ADD COLUMN IF NOT EXISTS cloud_storage_default_target TEXT
    CHECK (cloud_storage_default_target IN ('drawings', 'documents'));

COMMENT ON COLUMN projects.projects.cloud_storage_default_target IS
    'Which table NEW files from the mapped cloud folder default into for cron/auto syncs. Set from the tab the mapping was created on; NULL = per-file heuristic.';

-- Backfill existing mappings from observed reality: every current mapping
-- whose imports are floor plans was mapped from the drawings tab (verified
-- in prod 2026-07-23: all 4 mapped projects sync ".../PDF/LATEST PDF"
-- drawing folders and hold cloud-synced floor_plans rows only).
UPDATE projects.projects p
SET    cloud_storage_default_target = 'drawings'
WHERE  p.cloud_storage_connection_id IS NOT NULL
  AND  p.cloud_storage_default_target IS NULL
  AND  EXISTS (
         SELECT 1 FROM tenants.floor_plans fp
         WHERE fp.project_id = p.id AND fp.source_provider IS NOT NULL
       )
  AND  NOT EXISTS (
         SELECT 1 FROM tenants.documents d
         WHERE d.project_id = p.id AND d.source_provider IS NOT NULL
       );

-- 3. Connection health -------------------------------------------------------

ALTER TABLE public.org_storage_connections
    ADD COLUMN IF NOT EXISTS needs_reauth    BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS last_sync_error TEXT;

COMMENT ON COLUMN public.org_storage_connections.needs_reauth IS
    'Set by the sync engine when a token refresh fails; cleared on successful refresh or OAuth reconnect. UI shows a Reconnect affordance while TRUE.';
COMMENT ON COLUMN public.org_storage_connections.last_sync_error IS
    'Most recent connection-level sync failure (token refresh / auth), for the settings card. NULL when healthy.';

NOTIFY pgrst, 'reload schema';
