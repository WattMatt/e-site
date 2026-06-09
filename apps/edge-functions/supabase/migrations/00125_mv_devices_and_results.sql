-- 00125_mv_devices_and_results.sql
-- MV protection: the device register + the computed fault-result / discrimination
-- caches. Spec §5.3, §5.4. Extends cable_schedule; CASCADE from the revision;
-- RLS matches the cable_schedule org convention. Results are engine output cached
-- for display / report / ISSUED-revision snapshots (recomputed on input change).

BEGIN;

-- ---------------------------------------------------------------------------
-- protection_devices — one row per protected point (relay/fuse/breaker)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cable_schedule.protection_devices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    revision_id     UUID NOT NULL REFERENCES cable_schedule.revisions(id) ON DELETE CASCADE,
    node_id         UUID,                                                       -- protected board/node (structure.nodes; no cross-schema FK)
    supply_id       UUID REFERENCES cable_schedule.supplies(id) ON DELETE SET NULL,  -- the feeder it protects
    device_role     TEXT NOT NULL CHECK (device_role IN ('incomer','feeder','transformer','sub_circuit')),
    device_type     TEXT NOT NULL CHECK (device_type IN ('relay','MCCB','ACB','fuse','RMU_fuse')),
    manufacturer    TEXT,
    model           TEXT,
    frame_rating_a  NUMERIC CHECK (frame_rating_a IS NULL OR frame_rating_a > 0),
    curve_ref       TEXT,                                                       -- -> sans protection-curve library code
    settings        JSONB NOT NULL DEFAULT '{}'::jsonb,                          -- std/curve/pickup_a/tms/td/dt_s/inst_multiple/inst_time_s
    created_by      UUID REFERENCES public.profiles(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_protection_devices_revision ON cable_schedule.protection_devices (revision_id);

CREATE TRIGGER protection_devices_updated_at
    BEFORE UPDATE ON cable_schedule.protection_devices
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE cable_schedule.protection_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "protection_devices_rw" ON cable_schedule.protection_devices FOR ALL
    USING      (organisation_id = ANY(public.get_user_org_ids()))
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id));

-- ---------------------------------------------------------------------------
-- fault_results — computed cache, one row per (revision, node)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cable_schedule.fault_results (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES public.organisations(id),
    revision_id     UUID NOT NULL REFERENCES cable_schedule.revisions(id) ON DELETE CASCADE,
    node_id         UUID NOT NULL,                                              -- structure.nodes (no cross-schema FK)
    ik3_max_ka      NUMERIC,
    ik3_min_ka      NUMERIC,
    ik1_max_ka      NUMERIC,
    ik1_min_ka      NUMERIC,
    xr_ratio        NUMERIC,
    ip_ka           NUMERIC,
    ic_amps         NUMERIC,                                                    -- unearthed capacitive earth-fault
    basis           TEXT,
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (revision_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_fault_results_revision ON cable_schedule.fault_results (revision_id);

ALTER TABLE cable_schedule.fault_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fault_results_rw" ON cable_schedule.fault_results FOR ALL
    USING      (organisation_id = ANY(public.get_user_org_ids()))
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id));

-- ---------------------------------------------------------------------------
-- discrimination_checks — computed cache, one row per upstream/downstream pair
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cable_schedule.discrimination_checks (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id      UUID NOT NULL REFERENCES public.organisations(id),
    revision_id          UUID NOT NULL REFERENCES cable_schedule.revisions(id) ON DELETE CASCADE,
    upstream_device_id   UUID NOT NULL REFERENCES cable_schedule.protection_devices(id) ON DELETE CASCADE,
    downstream_device_id UUID NOT NULL REFERENCES cable_schedule.protection_devices(id) ON DELETE CASCADE,
    at_fault_a           NUMERIC NOT NULL,
    t_up_s               NUMERIC,
    t_down_s             NUMERIC,
    margin_ms            NUMERIC,
    verdict              TEXT NOT NULL CHECK (verdict IN ('ok','marginal','fails')),
    computed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discrimination_checks_revision ON cable_schedule.discrimination_checks (revision_id);

ALTER TABLE cable_schedule.discrimination_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "discrimination_checks_rw" ON cable_schedule.discrimination_checks FOR ALL
    USING      (organisation_id = ANY(public.get_user_org_ids()))
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id));

NOTIFY pgrst, 'reload schema';

COMMIT;
