-- =============================================================================
-- Migration: 00003_compliance_schema.sql
-- Description: compliance schema — sites, project_sites, subsections,
--              coc_uploads, qr_codes, inspection_requests.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- compliance.sites  (electrical installation sites, NOT projects)
-- ---------------------------------------------------------------------------
CREATE TABLE compliance.sites (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    address         TEXT NOT NULL,
    city            TEXT,
    province        TEXT,
    erf_number      TEXT,
    site_type       TEXT DEFAULT 'residential'
                    CHECK (site_type IN ('residential', 'commercial', 'industrial', 'mixed')),
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'archived')),
    created_by      UUID NOT NULL REFERENCES public.profiles(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER compliance_sites_updated_at
    BEFORE UPDATE ON compliance.sites
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- compliance.project_sites  (links a project to a compliance site)
-- ---------------------------------------------------------------------------
CREATE TABLE compliance.project_sites (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    site_id     UUID NOT NULL REFERENCES compliance.sites(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, site_id)
);

-- ---------------------------------------------------------------------------
-- compliance.subsections  (SANS 10142-1 sections within a site)
-- ---------------------------------------------------------------------------
CREATE TABLE compliance.subsections (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id         UUID NOT NULL REFERENCES compliance.sites(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    name            TEXT NOT NULL,
    description     TEXT,
    sans_ref        TEXT,   -- e.g. "Section 7.3.1"
    sort_order      INTEGER NOT NULL DEFAULT 0,
    coc_status      TEXT NOT NULL DEFAULT 'missing'
                    CHECK (coc_status IN ('missing', 'submitted', 'under_review', 'approved', 'rejected')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER subsections_updated_at
    BEFORE UPDATE ON compliance.subsections
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- compliance.coc_uploads
-- ---------------------------------------------------------------------------
CREATE TABLE compliance.coc_uploads (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subsection_id   UUID NOT NULL REFERENCES compliance.subsections(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    file_path       TEXT NOT NULL,
    file_size_bytes BIGINT,
    status          TEXT NOT NULL DEFAULT 'submitted'
                    CHECK (status IN ('submitted', 'under_review', 'approved', 'rejected')),
    rejection_reason TEXT,
    reviewed_by     UUID REFERENCES public.profiles(id),
    reviewed_at     TIMESTAMPTZ,
    uploaded_by     UUID NOT NULL REFERENCES public.profiles(id),
    version         INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER coc_uploads_updated_at
    BEFORE UPDATE ON compliance.coc_uploads
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-update subsection coc_status when upload status changes
CREATE OR REPLACE FUNCTION compliance.sync_subsection_coc_status()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE compliance.subsections
  SET coc_status = NEW.status, updated_at = NOW()
  WHERE id = NEW.subsection_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER coc_upload_status_sync
    AFTER INSERT OR UPDATE OF status ON compliance.coc_uploads
    FOR EACH ROW EXECUTE FUNCTION compliance.sync_subsection_coc_status();

-- ---------------------------------------------------------------------------
-- compliance.qr_codes  (QR code per site/subsection for field scanning)
-- ---------------------------------------------------------------------------
CREATE TABLE compliance.qr_codes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    site_id         UUID REFERENCES compliance.sites(id),
    subsection_id   UUID REFERENCES compliance.subsections(id),
    code            TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::TEXT,
    label           TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
