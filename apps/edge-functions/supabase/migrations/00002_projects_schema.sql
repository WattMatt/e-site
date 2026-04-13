-- =============================================================================
-- Migration: 00002_projects_schema.sql
-- Description: projects schema — projects, project_members, drawings, rfis,
--              rfi_responses, procurement_items, site_diary_entries, handover,
--              contacts.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- projects.projects
-- ---------------------------------------------------------------------------
CREATE TABLE projects.projects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT,
    address         TEXT,
    city            TEXT,
    province        TEXT,
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('planning', 'active', 'on_hold', 'completed', 'cancelled')),
    start_date      DATE,
    end_date        DATE,
    contract_value  NUMERIC(14,2),
    currency        TEXT NOT NULL DEFAULT 'ZAR',
    client_name     TEXT,
    client_contact  TEXT,
    site_manager_id UUID REFERENCES public.profiles(id),
    created_by      UUID NOT NULL REFERENCES public.profiles(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER projects_updated_at
    BEFORE UPDATE ON projects.projects
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- projects.project_members
-- ---------------------------------------------------------------------------
CREATE TABLE projects.project_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    role            TEXT NOT NULL DEFAULT 'contractor'
                    CHECK (role IN ('project_manager', 'contractor', 'inspector', 'supplier', 'client_viewer')),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    added_by        UUID REFERENCES public.profiles(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, user_id)
);

-- ---------------------------------------------------------------------------
-- projects.drawings
-- ---------------------------------------------------------------------------
CREATE TABLE projects.drawings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    title           TEXT NOT NULL,
    revision        TEXT,
    file_path       TEXT NOT NULL,
    file_size_bytes BIGINT,
    discipline      TEXT, -- 'electrical' | 'civil' | 'structural' | 'mechanical'
    status          TEXT NOT NULL DEFAULT 'current'
                    CHECK (status IN ('draft', 'current', 'superseded', 'archived')),
    uploaded_by     UUID NOT NULL REFERENCES public.profiles(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER drawings_updated_at
    BEFORE UPDATE ON projects.drawings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- projects.rfis
-- ---------------------------------------------------------------------------
CREATE TABLE projects.rfis (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    rfi_number      INTEGER GENERATED ALWAYS AS IDENTITY,
    subject         TEXT NOT NULL,
    description     TEXT NOT NULL,
    priority        TEXT NOT NULL DEFAULT 'medium'
                    CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    category        TEXT,
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'open', 'responded', 'closed')),
    due_date        DATE,
    raised_by       UUID NOT NULL REFERENCES public.profiles(id),
    assigned_to     UUID REFERENCES public.profiles(id),
    closed_at       TIMESTAMPTZ,
    closed_by       UUID REFERENCES public.profiles(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER rfis_updated_at
    BEFORE UPDATE ON projects.rfis
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- projects.rfi_responses
-- ---------------------------------------------------------------------------
CREATE TABLE projects.rfi_responses (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rfi_id      UUID NOT NULL REFERENCES projects.rfis(id) ON DELETE CASCADE,
    body        TEXT NOT NULL,
    responded_by UUID NOT NULL REFERENCES public.profiles(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- projects.procurement_items
-- ---------------------------------------------------------------------------
CREATE TABLE projects.procurement_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    description     TEXT NOT NULL,
    quantity        NUMERIC,
    unit            TEXT,
    supplier_id     UUID, -- references suppliers.suppliers(id) — FK added in 00005
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'sent', 'quoted', 'approved', 'fulfilled', 'cancelled')),
    required_by     DATE,
    quoted_price    NUMERIC(12,2),
    currency        TEXT NOT NULL DEFAULT 'ZAR',
    po_number       TEXT,
    delivery_date   DATE,
    notes           TEXT,
    created_by      UUID REFERENCES public.profiles(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER procurement_items_updated_at
    BEFORE UPDATE ON projects.procurement_items
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- projects.site_diary_entries
-- ---------------------------------------------------------------------------
CREATE TABLE projects.site_diary_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    entry_date      DATE NOT NULL,
    weather         TEXT,
    workers_on_site INTEGER,
    progress_notes  TEXT NOT NULL,
    delays          TEXT,
    created_by      UUID NOT NULL REFERENCES public.profiles(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER site_diary_entries_updated_at
    BEFORE UPDATE ON projects.site_diary_entries
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- projects.contacts
-- ---------------------------------------------------------------------------
CREATE TABLE projects.contacts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    name            TEXT NOT NULL,
    role            TEXT,
    company         TEXT,
    email           TEXT,
    phone           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- projects.handover_checklist
-- ---------------------------------------------------------------------------
CREATE TABLE projects.handover_checklist (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    item            TEXT NOT NULL,
    is_complete     BOOLEAN NOT NULL DEFAULT FALSE,
    completed_by    UUID REFERENCES public.profiles(id),
    completed_at    TIMESTAMPTZ,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
