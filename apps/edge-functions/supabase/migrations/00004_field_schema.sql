-- =============================================================================
-- Migration: 00004_field_schema.sql
-- Description: field schema — snags, snag_photos, cables,
--              inspection_milestones, inspection_requests.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- field.snags
-- ---------------------------------------------------------------------------
CREATE TABLE field.snags (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    title           TEXT NOT NULL,
    description     TEXT,
    location        TEXT,
    category        TEXT NOT NULL DEFAULT 'general',
    priority        TEXT NOT NULL DEFAULT 'medium'
                    CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'in_progress', 'resolved', 'pending_sign_off', 'signed_off', 'closed')),
    assigned_to     UUID REFERENCES public.profiles(id),
    raised_by       UUID NOT NULL REFERENCES public.profiles(id),
    floor_plan_pin  JSONB,  -- {x: float, y: float, floor_plan_id: uuid}
    signed_off_by   UUID REFERENCES public.profiles(id),
    signed_off_at   TIMESTAMPTZ,
    signature_path  TEXT,
    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER snags_updated_at
    BEFORE UPDATE ON field.snags
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- field.snag_photos
-- ---------------------------------------------------------------------------
CREATE TABLE field.snag_photos (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snag_id     UUID NOT NULL REFERENCES field.snags(id) ON DELETE CASCADE,
    file_path   TEXT NOT NULL,
    caption     TEXT,
    photo_type  TEXT NOT NULL DEFAULT 'evidence'
                CHECK (photo_type IN ('evidence', 'closeout', 'markup')),
    sort_order  INTEGER NOT NULL DEFAULT 0,
    uploaded_by UUID REFERENCES public.profiles(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- field.cables  (cable schedule / DB legend)
-- ---------------------------------------------------------------------------
CREATE TABLE field.cables (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    circuit_ref     TEXT NOT NULL,
    description     TEXT,
    cable_type      TEXT,
    conductor_size  TEXT,
    length_m        NUMERIC(10,2),
    from_location   TEXT,
    to_location     TEXT,
    protection      TEXT,
    notes           TEXT,
    created_by      UUID REFERENCES public.profiles(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER cables_updated_at
    BEFORE UPDATE ON field.cables
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- field.inspection_milestones
-- ---------------------------------------------------------------------------
CREATE TABLE field.inspection_milestones (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    name            TEXT NOT NULL,
    description     TEXT,
    scheduled_date  DATE,
    completed_date  DATE,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'scheduled', 'passed', 'failed', 'waived')),
    inspector_id    UUID REFERENCES public.profiles(id),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER inspection_milestones_updated_at
    BEFORE UPDATE ON field.inspection_milestones
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- field.inspection_requests  (formal DOL/municipal inspection booking)
-- ---------------------------------------------------------------------------
CREATE TABLE field.inspection_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    milestone_id    UUID REFERENCES field.inspection_milestones(id),
    authority       TEXT NOT NULL, -- 'DOL' | 'municipality' | 'private'
    requested_date  DATE,
    confirmed_date  DATE,
    outcome         TEXT CHECK (outcome IN ('passed', 'failed', 'deferred')),
    outcome_notes   TEXT,
    requested_by    UUID NOT NULL REFERENCES public.profiles(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER inspection_requests_updated_at
    BEFORE UPDATE ON field.inspection_requests
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
