-- =============================================================================
-- Migration: 00148_floor_plan_versions_cloud_sync.sql
-- Description: Turn the one-shot cloud "import" into a change-detecting sync.
--
--   Problem (pre-00148): cloud-sync-project skipped any file whose
--   (project_id, source_provider, source_file_id) already existed, so a
--   drawing edited in Dropbox (same file id, new `rev`) was treated as
--   "already imported" and the app kept serving the stale copy forever.
--
--   Fix: the sync now compares the live Dropbox `rev` against the stored
--   one. Documents (no annotations) update in place. Drawings (markup,
--   snag pins and scale calibration are pinned to the FILE's pixel
--   geometry via tenants.floor_plans.id) get VERSIONED instead — the new
--   revision is downloaded as a new tenants.floor_plan_versions row and the
--   drawing is flagged `has_newer_version`, but the active file the markup
--   is attached to is NOT changed until a user explicitly migrates. This
--   never silently invalidates existing annotations.
--
--   Also adds tenants.cloud_sync_runs so every sync (manual or cron) is
--   observable without redeploying to add logging.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- tenants.floor_plans: currency flags for the "newer version available"
-- badge. Existing rows (local uploads + pre-00148 cloud imports) default to
-- has_newer_version = FALSE, so the UI is unchanged until a sync detects a
-- newer revision.
-- ---------------------------------------------------------------------------
ALTER TABLE tenants.floor_plans
    ADD COLUMN has_newer_version  BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN latest_revision_id TEXT,        -- newest Dropbox rev seen by sync
    ADD COLUMN latest_synced_at   TIMESTAMPTZ; -- when that newest rev was pulled

-- ---------------------------------------------------------------------------
-- tenants.floor_plan_versions — one row per imported revision of a drawing.
-- Files live in the `drawings` Storage bucket at a rev-keyed path so old
-- version bytes survive when a newer revision is pulled. The floor_plans row
-- stays the stable identity that markup / snag pins / calibration reference;
-- this table is purely the per-revision file history.
-- ---------------------------------------------------------------------------
CREATE TABLE tenants.floor_plan_versions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    floor_plan_id       UUID NOT NULL REFERENCES tenants.floor_plans(id) ON DELETE CASCADE,
    source_revision_id  TEXT NOT NULL,         -- provider rev / etag for this version
    file_path           TEXT NOT NULL,         -- {org}/{project}/{file_id}/{rev}{ext} in `drawings`
    file_size_bytes     BIGINT,
    source_modified_at  TIMESTAMPTZ,           -- provider server_modified for this rev
    synced_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- A given revision of a drawing is imported at most once.
    UNIQUE (floor_plan_id, source_revision_id)
);

CREATE INDEX idx_floor_plan_versions_plan ON tenants.floor_plan_versions(floor_plan_id);
CREATE INDEX idx_floor_plan_versions_org  ON tenants.floor_plan_versions(organisation_id);

ALTER TABLE tenants.floor_plan_versions ENABLE ROW LEVEL SECURITY;

-- SELECT mirrors tenants.documents (00041): org members see all; client
-- viewers (00034) see only versions for projects they're a member of.
CREATE POLICY "Org members and client viewers can view floor plan versions"
    ON tenants.floor_plan_versions FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR EXISTS (
                SELECT 1 FROM projects.project_members pm
                WHERE pm.project_id = tenants.floor_plan_versions.project_id
                  AND pm.user_id   = auth.uid()
                  AND pm.is_active = TRUE
            )
        )
    );

-- Writes are normally performed by the service-role sync (RLS-exempt); these
-- mirror documents so any future app-side write path stays consistent.
CREATE POLICY "Org members can insert floor plan versions"
    ON tenants.floor_plan_versions FOR INSERT
    WITH CHECK (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer(organisation_id)
    );

CREATE POLICY "Org members can delete floor plan versions"
    ON tenants.floor_plan_versions FOR DELETE
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer(organisation_id)
    );

-- ---------------------------------------------------------------------------
-- tenants.cloud_sync_runs — diagnostics. One row per sync invocation so
-- failures are observable from the app/DB without a redeploy-to-log cycle.
-- Written by the service-role edge function (RLS-exempt); read by org members.
-- ---------------------------------------------------------------------------
CREATE TABLE tenants.cloud_sync_runs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    trigger             TEXT NOT NULL CHECK (trigger IN ('manual', 'cron')),
    intent              TEXT,                  -- 'drawings' | 'documents' | 'auto'
    started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at         TIMESTAMPTZ,
    sent                INTEGER NOT NULL DEFAULT 0,  -- new files inserted
    updated             INTEGER NOT NULL DEFAULT 0,  -- documents updated in place
    new_versions        INTEGER NOT NULL DEFAULT 0,  -- drawing revisions versioned
    skipped             INTEGER NOT NULL DEFAULT 0,  -- unchanged (rev match)
    failed              INTEGER NOT NULL DEFAULT 0,
    error_text          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cloud_sync_runs_project ON tenants.cloud_sync_runs(project_id, started_at DESC);
CREATE INDEX idx_cloud_sync_runs_org     ON tenants.cloud_sync_runs(organisation_id);

ALTER TABLE tenants.cloud_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view cloud sync runs"
    ON tenants.cloud_sync_runs FOR SELECT
    USING (organisation_id = ANY(public.get_user_org_ids()));

-- Client viewers have no business reading sync operations.
CREATE POLICY "Client viewers blocked from cloud sync runs"
    ON tenants.cloud_sync_runs AS RESTRICTIVE FOR ALL
    USING (NOT public.user_is_client_viewer(organisation_id));

-- ---------------------------------------------------------------------------
-- Scheduled poll (informational — apply per environment after deploying the
-- cloud-sync-cron Edge Function). Every 15 minutes; cloud-sync-cron lists
-- projects with a mapped folder and re-syncs each. Dedup-by-rev keeps repeat
-- runs cheap (unchanged files are skipped after one metadata listing).
--
--   SELECT cron.schedule(
--     'cloud-sync-poll',
--     '*/15 * * * *',
--     $$ SELECT net.http_post(
--          url := 'https://<project-ref>.functions.supabase.co/cloud-sync-cron',
--          headers := jsonb_build_object(
--            'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
--            'Content-Type',  'application/json'
--          ),
--          body := '{}'::jsonb
--        ); $$
--   );
-- ---------------------------------------------------------------------------

NOTIFY pgrst, 'reload schema';
