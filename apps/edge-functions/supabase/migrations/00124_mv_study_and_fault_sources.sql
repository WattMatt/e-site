-- 00124_mv_study_and_fault_sources.sql
-- Medium-Voltage protection & design calc — study settings + the source-side
-- fault-impedance facets that the calc engine needs but the model lacked
-- (utility S"k, transformer %Z / X/R / vector group / earthing, generator X"d,
-- inverter limit). Spec: docs/superpowers/specs/2026-06-09-medium-voltage-protection-spec.md (§5.1, §5.2).
--
-- Extends cable_schedule (no new schema -> no PostgREST db_schema PATCH). A
-- protection study is a facet of a cable_schedule.revision; these rows CASCADE
-- from the revision and inherit its DRAFT/ISSUED lifecycle (issue-time
-- immutability is app-enforced in the server actions). RLS matches the
-- cable_schedule org convention (get_user_org_ids + user_is_client_viewer),
-- NOT the structure project-access convention.
--
-- Cross-schema note: node_id references structure.nodes by plain UUID with NO
-- cross-schema FK (codebase convention); source_id / supply_id FK same-schema
-- cable_schedule tables.

BEGIN;

-- ---------------------------------------------------------------------------
-- mv_study_settings — one row per revision (the MV study facet)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cable_schedule.mv_study_settings (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id         UUID NOT NULL REFERENCES public.organisations(id),
    revision_id             UUID NOT NULL UNIQUE REFERENCES cable_schedule.revisions(id) ON DELETE CASCADE,
    base_mva                NUMERIC NOT NULL DEFAULT 100 CHECK (base_mva > 0),
    c_max                   NUMERIC NOT NULL DEFAULT 1.1 CHECK (c_max > 0),
    c_min                   NUMERIC NOT NULL DEFAULT 1.0 CHECK (c_min > 0),
    ef_fault_resistance_ohm NUMERIC NOT NULL DEFAULT 0   CHECK (ef_fault_resistance_ohm >= 0),
    frequency_hz            NUMERIC NOT NULL DEFAULT 50  CHECK (frequency_hz > 0),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER mv_study_settings_updated_at
    BEFORE UPDATE ON cable_schedule.mv_study_settings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE cable_schedule.mv_study_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mv_study_settings_rw" ON cable_schedule.mv_study_settings FOR ALL
    USING      (organisation_id = ANY(public.get_user_org_ids()))
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id));

-- ---------------------------------------------------------------------------
-- fault_sources — utility / transformer / generator / inverter impedances.
-- Keyed by node_id XOR source_id (mirrors the supplies origin XOR).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cable_schedule.fault_sources (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id      UUID NOT NULL REFERENCES public.organisations(id),
    revision_id          UUID NOT NULL REFERENCES cable_schedule.revisions(id) ON DELETE CASCADE,
    node_id              UUID,                                                   -- -> structure.nodes (no cross-schema FK)
    source_id            UUID REFERENCES cable_schedule.sources(id) ON DELETE CASCADE,
    role                 TEXT NOT NULL CHECK (role IN ('utility','transformer','generator','inverter')),
    -- utility
    ssc_mva              NUMERIC CHECK (ssc_mva IS NULL OR ssc_mva > 0),
    xr_ratio             NUMERIC CHECK (xr_ratio IS NULL OR xr_ratio >= 0),
    z0_over_z1           NUMERIC CHECK (z0_over_z1 IS NULL OR z0_over_z1 > 0),
    -- transformer
    uk_pct               NUMERIC CHECK (uk_pct IS NULL OR uk_pct > 0),
    pkr_w                NUMERIC CHECK (pkr_w IS NULL OR pkr_w >= 0),
    s_rated_va           NUMERIC CHECK (s_rated_va IS NULL OR s_rated_va > 0),
    vector_group         TEXT,
    lv_earthing_kind     TEXT CHECK (lv_earthing_kind IS NULL OR lv_earthing_kind IN ('solid','resistance','reactance')),
    lv_earthing_ohm      NUMERIC CHECK (lv_earthing_ohm IS NULL OR lv_earthing_ohm >= 0),
    -- generator
    xd_pct               NUMERIC CHECK (xd_pct IS NULL OR xd_pct > 0),
    -- inverter
    current_limit_factor NUMERIC CHECK (current_limit_factor IS NULL OR current_limit_factor > 0),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fault_sources_origin_xor CHECK ((node_id IS NOT NULL)::int + (source_id IS NOT NULL)::int = 1)
);

CREATE INDEX IF NOT EXISTS idx_fault_sources_revision ON cable_schedule.fault_sources (revision_id);

CREATE TRIGGER fault_sources_updated_at
    BEFORE UPDATE ON cable_schedule.fault_sources
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE cable_schedule.fault_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fault_sources_rw" ON cable_schedule.fault_sources FOR ALL
    USING      (organisation_id = ANY(public.get_user_org_ids()))
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id));

NOTIFY pgrst, 'reload schema';

COMMIT;
