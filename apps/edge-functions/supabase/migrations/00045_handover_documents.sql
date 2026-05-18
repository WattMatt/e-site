-- =============================================================================
-- Migration: 00054_handover_documents.sql
-- Description: Handover Documents module — per-project folder tree organised
--              by 13 SANS-aligned categories (generators, transformers, main
--              boards, switchgear, etc.) with the option to mirror the same
--              structure + files into the org's connected cloud-storage
--              provider (Dropbox / Google Drive / OneDrive).
--
--              Storage:
--                - File metadata reuses the existing tenants.documents table
--                  (provenance + bucket already shipped by 00041/00042).
--                - tenants.handover_folders adds the tree.
--                - Both gain cloud-mirror columns so a successful push to
--                  the provider is recorded against the local row.
--
--              Cloud-mirror columns are NULL when the project has no cloud
--              connection OR the push failed. Local rows are authoritative;
--              cloud is a (best-effort) mirror.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- projects.projects: dedicated "Handover" wrapper folder in the cloud.
-- Auto-created the first time any handover category is initialised on a
-- project that has a cloud_storage_folder_id mapping. Sits at:
--   {project cloud root}/Handover/{category}/...
-- so handover content stays cleanly separated from any other docs the
-- user has under the project's mapped cloud folder.
-- ---------------------------------------------------------------------------
ALTER TABLE projects.projects
    ADD COLUMN handover_cloud_folder_id   TEXT,
    ADD COLUMN handover_cloud_folder_path TEXT;

-- ---------------------------------------------------------------------------
-- tenants.handover_folders — tree of folders per (project, category).
-- ---------------------------------------------------------------------------
CREATE TABLE tenants.handover_folders (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    parent_folder_id    UUID REFERENCES tenants.handover_folders(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    -- 13 SANS-aligned category slugs. Drives the category-tab UI and the
    -- "Initialize from template" dropdown.
    category            TEXT NOT NULL CHECK (category IN (
        'generators', 'transformers', 'main_boards', 'switchgear',
        'earthing_bonding', 'surge_protection', 'cable_installation',
        'emergency_systems', 'lighting', 'metering',
        'test_certificates', 'commissioning_docs', 'compliance_certs'
    )),
    -- Denormalised '/category/parent/child' — maintained by trigger.
    -- Used for breadcrumb rendering + duplicate-detection on init-template.
    folder_path         TEXT NOT NULL DEFAULT '',
    -- Cloud-mirror provenance: filled in when push-to-cloud succeeds.
    cloud_provider      TEXT
        CHECK (cloud_provider IS NULL OR cloud_provider IN ('dropbox', 'google_drive', 'onedrive')),
    cloud_folder_id     TEXT,
    cloud_folder_path   TEXT,
    cloud_synced_at     TIMESTAMPTZ,
    created_by          UUID REFERENCES public.profiles(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Either both cloud_provider AND cloud_folder_id are NULL, or both populated.
    CHECK (
        (cloud_provider IS NULL AND cloud_folder_id IS NULL)
        OR (cloud_provider IS NOT NULL AND cloud_folder_id IS NOT NULL)
    ),
    -- A sibling-name collision within the same parent+category is a UX bug.
    -- Parent NULL is the category root; (project, category, NULL, name)
    -- still needs uniqueness, so a partial index handles the NULL parent.
    UNIQUE (project_id, category, parent_folder_id, name)
);

CREATE INDEX idx_handover_folders_org      ON tenants.handover_folders(organisation_id);
CREATE INDEX idx_handover_folders_project  ON tenants.handover_folders(project_id);
CREATE INDEX idx_handover_folders_parent   ON tenants.handover_folders(parent_folder_id);
CREATE INDEX idx_handover_folders_category ON tenants.handover_folders(project_id, category);
-- Unique-WHERE for category roots (parent_folder_id IS NULL).
CREATE UNIQUE INDEX idx_handover_folders_root_unique
    ON tenants.handover_folders(project_id, category, name)
    WHERE parent_folder_id IS NULL;

-- ---------------------------------------------------------------------------
-- folder_path trigger — recompute on INSERT or UPDATE OF parent/name.
-- Format: '/{category}/{parent_path}/{name}'  — leading slash, no trailing.
-- Category root: '/{category}/{name}'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tenants.update_handover_folder_path()
RETURNS TRIGGER AS $$
DECLARE
    parent_path TEXT;
BEGIN
    IF NEW.parent_folder_id IS NULL THEN
        NEW.folder_path := '/' || NEW.category || '/' || NEW.name;
    ELSE
        SELECT folder_path INTO parent_path
        FROM tenants.handover_folders
        WHERE id = NEW.parent_folder_id;
        IF parent_path IS NULL THEN
            RAISE EXCEPTION 'parent folder % not found', NEW.parent_folder_id;
        END IF;
        NEW.folder_path := parent_path || '/' || NEW.name;
    END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER handover_folders_path_trigger
    BEFORE INSERT OR UPDATE OF parent_folder_id, name, category
    ON tenants.handover_folders
    FOR EACH ROW EXECUTE FUNCTION tenants.update_handover_folder_path();

-- ---------------------------------------------------------------------------
-- tenants.documents: extend with handover linkage + cloud-mirror columns.
-- An existing document becomes "handover content" by setting
-- handover_folder_id (which implies the category).
-- ---------------------------------------------------------------------------
ALTER TABLE tenants.documents
    ADD COLUMN handover_folder_id UUID
        REFERENCES tenants.handover_folders(id) ON DELETE SET NULL,
    ADD COLUMN handover_category  TEXT,
    -- Cloud-mirror provenance: where the file lives at the provider, if any.
    -- Distinct from the existing source_* columns (which describe an
    -- INBOUND cloud → E-Site sync). These describe an OUTBOUND E-Site →
    -- cloud push. A single row can have both populated when a file was
    -- both imported from cloud AND mirrored back into a handover folder.
    ADD COLUMN cloud_mirror_provider  TEXT
        CHECK (cloud_mirror_provider IS NULL
               OR cloud_mirror_provider IN ('dropbox', 'google_drive', 'onedrive')),
    ADD COLUMN cloud_mirror_file_id   TEXT,
    ADD COLUMN cloud_mirror_path      TEXT,
    ADD COLUMN cloud_mirror_synced_at TIMESTAMPTZ,
    ADD CONSTRAINT documents_cloud_mirror_pair
        CHECK (
            (cloud_mirror_provider IS NULL AND cloud_mirror_file_id IS NULL)
            OR (cloud_mirror_provider IS NOT NULL AND cloud_mirror_file_id IS NOT NULL)
        );

CREATE INDEX idx_documents_handover_folder
    ON tenants.documents(handover_folder_id)
    WHERE handover_folder_id IS NOT NULL;
CREATE INDEX idx_documents_handover_category
    ON tenants.documents(project_id, handover_category)
    WHERE handover_category IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RLS — mirror the tenants.documents pattern from 00041.
-- Org members can see/CRUD; client_viewers are scoped to their projects.
-- ---------------------------------------------------------------------------
ALTER TABLE tenants.handover_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members and project-scoped client viewers can view handover folders"
    ON tenants.handover_folders FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR EXISTS (
                SELECT 1 FROM projects.project_members pm
                WHERE pm.project_id = tenants.handover_folders.project_id
                  AND pm.user_id   = auth.uid()
                  AND pm.is_active = TRUE
            )
        )
    );

CREATE POLICY "Org members can insert handover folders"
    ON tenants.handover_folders FOR INSERT
    WITH CHECK (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer(organisation_id)
    );

CREATE POLICY "Org members can update handover folders"
    ON tenants.handover_folders FOR UPDATE
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer(organisation_id)
    );

CREATE POLICY "Org members can delete handover folders"
    ON tenants.handover_folders FOR DELETE
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer(organisation_id)
    );

-- ---------------------------------------------------------------------------
-- Bucket grant on `project-documents` for handover uploads is already in
-- place via 00042. No new bucket needed — handover files live under
-- {org_id}/{project_id}/handover/{folder_path}/{filename}.
-- ---------------------------------------------------------------------------

NOTIFY pgrst, 'reload schema';
