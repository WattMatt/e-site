-- =============================================================================
-- Migration: 00006_tenants_schema.sql
-- Description: tenants schema — floor plans and zones for spatial snag pinning.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- tenants.floor_plans
-- ---------------------------------------------------------------------------
CREATE TABLE tenants.floor_plans (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    project_id      UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    level           TEXT, -- 'Ground', 'Level 1', 'Basement', etc.
    file_path       TEXT NOT NULL,
    file_size_bytes BIGINT,
    width_px        INTEGER,
    height_px       INTEGER,
    scale           TEXT, -- '1:100'
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    uploaded_by     UUID NOT NULL REFERENCES public.profiles(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER floor_plans_updated_at
    BEFORE UPDATE ON tenants.floor_plans
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- tenants.floor_plan_zones
-- ---------------------------------------------------------------------------
CREATE TABLE tenants.floor_plan_zones (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    floor_plan_id   UUID NOT NULL REFERENCES tenants.floor_plans(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    name            TEXT NOT NULL,
    -- Polygon as array of {x, y} coordinates (percentage of image dimensions)
    polygon         JSONB NOT NULL DEFAULT '[]',
    color           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
