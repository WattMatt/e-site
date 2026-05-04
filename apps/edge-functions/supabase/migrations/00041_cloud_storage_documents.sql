-- =============================================================================
-- Migration: 00041_cloud_storage_documents.sql
-- Description: Per-project cloud-folder mapping on projects.projects, new
--              tenants.documents table for generic project documents, and
--              source-provenance columns on tenants.floor_plans so cloud-
--              synced files can be traced back to their source. Files for
--              tenants.documents live in the `project-documents` Supabase
--              Storage bucket created by 00042.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- projects.projects: per-project cloud folder mapping
-- ---------------------------------------------------------------------------
ALTER TABLE projects.projects
    ADD COLUMN cloud_storage_connection_id UUID
        REFERENCES public.org_storage_connections(id) ON DELETE SET NULL,
    ADD COLUMN cloud_storage_folder_id    TEXT,    -- provider-stable folder ID
    ADD COLUMN cloud_storage_folder_path  TEXT,    -- human-readable path (display only)
    ADD COLUMN cloud_storage_last_sync_at TIMESTAMPTZ;

CREATE INDEX idx_projects_cloud_storage_connection
    ON projects.projects(cloud_storage_connection_id)
    WHERE cloud_storage_connection_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- tenants.documents — generic project documents (specs, contracts,
-- handover packs, photos, anything that isn't a floor plan or RFI
-- attachment). Files live in the `project-documents` Storage bucket.
-- ---------------------------------------------------------------------------
CREATE TABLE tenants.documents (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    category            TEXT,                  -- 'spec', 'contract', 'handover', 'photo', 'misc' (free-form for now)
    storage_path        TEXT NOT NULL,         -- {org_id}/{project_id}/{filename} in `project-documents` bucket
    mime_type           TEXT,
    size_bytes          BIGINT,
    -- Provenance: NULL source_provider = locally uploaded; populated = cloud-synced.
    source_provider     TEXT
        CHECK (source_provider IS NULL OR source_provider IN ('dropbox', 'google_drive', 'onedrive')),
    source_file_id      TEXT,                  -- provider-stable file ID
    source_revision_id  TEXT,                  -- provider rev / etag (for change detection)
    source_path         TEXT,                  -- human-readable path at source
    synced_at           TIMESTAMPTZ,
    uploaded_by         UUID REFERENCES public.profiles(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Either both source_provider AND source_file_id are NULL, or both are populated.
    CHECK (
        (source_provider IS NULL AND source_file_id IS NULL)
        OR (source_provider IS NOT NULL AND source_file_id IS NOT NULL)
    )
);

CREATE INDEX idx_documents_org              ON tenants.documents(organisation_id);
CREATE INDEX idx_documents_project          ON tenants.documents(project_id);
CREATE INDEX idx_documents_source_provider  ON tenants.documents(source_provider) WHERE source_provider IS NOT NULL;
CREATE UNIQUE INDEX idx_documents_source_dedup
    ON tenants.documents(project_id, source_provider, source_file_id)
    WHERE source_provider IS NOT NULL;

CREATE TRIGGER documents_updated_at
    BEFORE UPDATE ON tenants.documents
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE tenants.documents ENABLE ROW LEVEL SECURITY;

-- Org members see all documents in their org. Client viewers (per 00034)
-- see only documents in projects they're members of via projects.project_members.
CREATE POLICY "Org members and project-scoped client viewers can view documents"
    ON tenants.documents FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR EXISTS (
                SELECT 1 FROM projects.project_members pm
                WHERE pm.project_id = tenants.documents.project_id
                  AND pm.user_id   = auth.uid()
                  AND pm.is_active = TRUE
            )
        )
    );

CREATE POLICY "Org members can insert documents"
    ON tenants.documents FOR INSERT
    WITH CHECK (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer(organisation_id)
    );

CREATE POLICY "Org members can update documents"
    ON tenants.documents FOR UPDATE
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer(organisation_id)
    );

CREATE POLICY "Org members can delete documents"
    ON tenants.documents FOR DELETE
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer(organisation_id)
    );

-- ---------------------------------------------------------------------------
-- tenants.floor_plans: same provenance shape so the cloud sync can target
-- it when the file is classified as a drawing. Existing rows have NULL
-- source_* (locally uploaded — back-compat preserved).
-- ---------------------------------------------------------------------------
ALTER TABLE tenants.floor_plans
    ADD COLUMN source_provider    TEXT
        CHECK (source_provider IS NULL OR source_provider IN ('dropbox', 'google_drive', 'onedrive')),
    ADD COLUMN source_file_id     TEXT,
    ADD COLUMN source_revision_id TEXT,
    ADD COLUMN source_path        TEXT,
    ADD COLUMN synced_at          TIMESTAMPTZ,
    ADD CONSTRAINT floor_plans_source_provider_pair
        CHECK (
            (source_provider IS NULL AND source_file_id IS NULL)
            OR (source_provider IS NOT NULL AND source_file_id IS NOT NULL)
        );

CREATE UNIQUE INDEX idx_floor_plans_source_dedup
    ON tenants.floor_plans(project_id, source_provider, source_file_id)
    WHERE source_provider IS NOT NULL;

NOTIFY pgrst, 'reload schema';
