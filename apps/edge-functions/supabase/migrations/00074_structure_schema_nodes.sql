-- =============================================================================
-- Migration 00074 — structure schema + nodes table
-- =============================================================================
-- Background:
--   Introduces the `structure` schema and its foundational `nodes` table — a
--   unified project-level entity registry covering tenant DBs, main boards,
--   common-area boards, RMUs, mini-subs, and generators. This single table
--   replaces the per-module ad-hoc lists that live in cable_schedule.boards /
--   sources today and will be shared across the cable schedule, tenant
--   schedule, equipment schedule, and materials modules.
--
-- Schema delta:
--   + new schema `structure`
--   + structure.nodes  (project-scoped node registry)
--   + index on (project_id, kind)
--   + BEFORE UPDATE trigger → public.set_updated_at()
--
-- RLS policies and GRANTs are added in a separate migration (00075).
-- This migration does NOT apply to any database — apply via Task 0.3.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS structure;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. nodes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE structure.nodes (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID        NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id     UUID        NOT NULL REFERENCES public.organisations(id),

    kind                TEXT        NOT NULL CHECK (kind IN (
                            'tenant_db',
                            'main_board',
                            'common_area_board',
                            'rmu',
                            'mini_sub',
                            'generator'
                        )),
    code                TEXT        NOT NULL,
    name                TEXT,

    coc_required        BOOLEAN     NOT NULL DEFAULT false,
    status              TEXT        NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'decommissioned')),

    -- Tenant facet — meaningful only when kind = 'tenant_db'
    shop_number         TEXT,
    shop_name           TEXT,
    shop_area_m2        NUMERIC,

    -- Electrical facet
    breaker_rating_a    NUMERIC,
    pole_config         TEXT,
    section             TEXT,           -- intended values: NORMAL | EMERGENCY | MIXED

    -- Generator / transformer facet
    rating_kva          NUMERIC,
    voltage_v           NUMERIC,

    notes               TEXT,

    created_by          UUID        REFERENCES public.profiles(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (project_id, code)
);

CREATE INDEX idx_structure_nodes_project_kind
    ON structure.nodes (project_id, kind);

CREATE TRIGGER structure_nodes_updated_at
    BEFORE UPDATE ON structure.nodes
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
