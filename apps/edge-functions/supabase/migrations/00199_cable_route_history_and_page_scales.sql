-- 00199_cable_route_history_and_page_scales.sql
--
-- Two things a launchable measuring tool needs that 00192 + 00198 do not give it.
--
-- 1. ROUTE HISTORY. `route_segments` are replaced wholesale on every save, with
--    no trail: who traced a leg, who moved a vertex, what the route looked like
--    before. `cable_schedule.route_history` is an append-only log, one row per
--    save, holding the full segment snapshot plus rise/drop, so any prior state
--    can be inspected and restored (server-side undo, itself logged). The
--    schedule's own `change_log` covers the ASSIGNED length; this covers the
--    geometry it came from.
--
-- 2. SCALE PER PDF PAGE. A drawing has had one `pixels_per_meter` since 00035
--    and 00198 records the page it was set on, but tracing on any other page
--    silently used it. Pages of one PDF can carry different sheet scales.
--    `tenants.floor_plan_page_scales` holds a scale per (drawing, page); the
--    drawing-level columns stay as the page-1 default and what the markup
--    measure tool reads, so nothing existing changes behaviour.
--
-- @verify:begin
-- table: cable_schedule.route_history
-- column: cable_schedule.route_history.snapshot
-- column: cable_schedule.route_history.saved_by
-- table: tenants.floor_plan_page_scales
-- column: tenants.floor_plan_page_scales.pixels_per_meter
-- constraint: floor_plan_page_scales_pkey ON tenants.floor_plan_page_scales
-- constraint: floor_plan_page_scales_ppm_positive ON tenants.floor_plan_page_scales
-- policy: route_history_select ON cable_schedule.route_history
-- policy: route_history_insert ON cable_schedule.route_history
-- policy: page_scales_select ON tenants.floor_plan_page_scales
-- policy: page_scales_write ON tenants.floor_plan_page_scales
-- index: route_history_route_saved_at_idx ON cable_schedule.route_history
-- function: tenants.floor_plan_page_scales_bind_org()
-- trigger: floor_plan_page_scales_bind_org ON tenants.floor_plan_page_scales
-- sql: (SELECT relrowsecurity FROM pg_class WHERE oid = 'cable_schedule.route_history'::regclass)
-- sql: (SELECT relrowsecurity FROM pg_class WHERE oid = 'tenants.floor_plan_page_scales'::regclass)
-- grant_absent: anon SELECT ON cable_schedule.route_history
-- constraint: product_events_event_check ON public.product_events
-- sql: (SELECT pg_get_constraintdef(oid) LIKE '%cable_route_leg_saved%' AND pg_get_constraintdef(oid) LIKE '%cable_route_sheet_exported%' FROM pg_constraint WHERE conname = 'product_events_event_check')
-- @verify:end

-- ── 1. Route history ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cable_schedule.route_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id        UUID NOT NULL REFERENCES cable_schedule.supply_routes(id) ON DELETE CASCADE,
    supply_id       UUID NOT NULL,
    revision_id     UUID NOT NULL REFERENCES cable_schedule.revisions(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL,
    rise_m          NUMERIC NOT NULL DEFAULT 0,
    drop_m          NUMERIC NOT NULL DEFAULT 0,
    /** The full segment list as saved: [{seq, floor_plan_id, floor_plan_name, page_index, points, pixels_per_meter, length_m}]. */
    snapshot        JSONB NOT NULL,
    /** Why this row exists: 'save' | 'restore' | 'remeasure'. */
    reason          TEXT NOT NULL DEFAULT 'save',
    saved_by        UUID NOT NULL,
    saved_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT route_history_snapshot_is_array CHECK (jsonb_typeof(snapshot) = 'array'),
    CONSTRAINT route_history_reason_check CHECK (reason IN ('save', 'restore', 'remeasure'))
);

CREATE INDEX IF NOT EXISTS route_history_route_saved_at_idx
    ON cable_schedule.route_history (route_id, saved_at DESC);

COMMENT ON TABLE cable_schedule.route_history IS
'Append-only: one row per save of a cable route, holding the whole segment list at that moment. Restoring a row writes the route AND a new history row with reason ''restore'', so the trail is never rewritten. Cascades with the route: a deleted route takes its history with it (the schedule''s change_log keeps the assigned lengths).';

ALTER TABLE cable_schedule.route_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE cable_schedule.route_history FORCE ROW LEVEL SECURITY;

-- Read: whoever can read the route (00192 route_select, verbatim shape).
DROP POLICY IF EXISTS route_history_select ON cable_schedule.route_history;
CREATE POLICY route_history_select ON cable_schedule.route_history FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR EXISTS (
                SELECT 1 FROM cable_schedule.revisions r
                JOIN projects.project_members pm ON pm.project_id = r.project_id
                WHERE r.id = route_history.revision_id
                  AND pm.user_id = auth.uid() AND pm.is_active = TRUE
            )
        )
    );

-- Write: INSERT only, by whoever may edit the schedule. No UPDATE, no DELETE
-- policy at all: a log that can be edited is not a log.
DROP POLICY IF EXISTS route_history_insert ON cable_schedule.route_history;
CREATE POLICY route_history_insert ON cable_schedule.route_history FOR INSERT
    TO authenticated
    WITH CHECK (
        organisation_id = ANY(public.get_user_org_ids())
        AND cable_schedule.user_can_edit_schedule(organisation_id)
    );

GRANT SELECT, INSERT ON cable_schedule.route_history TO authenticated;
GRANT ALL ON cable_schedule.route_history TO service_role;
REVOKE ALL ON cable_schedule.route_history FROM anon;

-- ── 2. Scale per PDF page ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenants.floor_plan_page_scales (
    floor_plan_id          UUID NOT NULL REFERENCES tenants.floor_plans(id) ON DELETE CASCADE,
    page_index             INTEGER NOT NULL,
    organisation_id        UUID NOT NULL,
    pixels_per_meter       NUMERIC NOT NULL,
    calibration_points     JSONB,
    calibration_metres     NUMERIC,
    calibrated_by          UUID,
    calibrated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT floor_plan_page_scales_pkey PRIMARY KEY (floor_plan_id, page_index),
    CONSTRAINT floor_plan_page_scales_page_positive CHECK (page_index >= 1),
    CONSTRAINT floor_plan_page_scales_ppm_positive CHECK (pixels_per_meter > 0),
    CONSTRAINT floor_plan_page_scales_points_shape CHECK (
        calibration_points IS NULL
        OR (jsonb_typeof(calibration_points) = 'array' AND jsonb_array_length(calibration_points) = 4)
    ),
    CONSTRAINT floor_plan_page_scales_metres_positive CHECK (calibration_metres IS NULL OR calibration_metres > 0)
);

COMMENT ON TABLE tenants.floor_plan_page_scales IS
'One scale per (drawing, PDF page). The drawing-level pixels_per_meter on tenants.floor_plans remains the page-1 default and what the markup measure tool reads; route mode reads THIS table for the page it is on and falls back to the drawing-level scale for page 1 only. A route segment still stores the scale in force when it was traced (00192) — this table is where the current scale lives, not where a length is recomputed from.';

-- organisation_id follows the drawing, never the caller (the PR #160 finding-3 shape).
CREATE OR REPLACE FUNCTION tenants.floor_plan_page_scales_bind_org()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  SELECT organisation_id INTO NEW.organisation_id FROM tenants.floor_plans WHERE id = NEW.floor_plan_id;
  IF NEW.organisation_id IS NULL THEN
    RAISE EXCEPTION 'floor_plan_page_scales: drawing % not found', NEW.floor_plan_id USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS floor_plan_page_scales_bind_org ON tenants.floor_plan_page_scales;
CREATE TRIGGER floor_plan_page_scales_bind_org
    BEFORE INSERT OR UPDATE ON tenants.floor_plan_page_scales
    FOR EACH ROW EXECUTE FUNCTION tenants.floor_plan_page_scales_bind_org();

ALTER TABLE tenants.floor_plan_page_scales ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants.floor_plan_page_scales FORCE ROW LEVEL SECURITY;

-- Mirrors tenants.floor_plans: org members read; org members except client
-- viewers write. The app narrows writes further (ORG_WRITE_ROLES) via
-- calibrateFloorPlanAction; this is the database backstop, like 00161's.
DROP POLICY IF EXISTS page_scales_select ON tenants.floor_plan_page_scales;
CREATE POLICY page_scales_select ON tenants.floor_plan_page_scales FOR SELECT
    USING (organisation_id = ANY(public.get_user_org_ids()));
DROP POLICY IF EXISTS page_scales_write ON tenants.floor_plan_page_scales;
CREATE POLICY page_scales_write ON tenants.floor_plan_page_scales FOR ALL
    TO authenticated
    USING      (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id))
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON tenants.floor_plan_page_scales TO authenticated;
GRANT ALL ON tenants.floor_plan_page_scales TO service_role;
REVOKE ALL ON tenants.floor_plan_page_scales FROM anon;

-- ── 3. Telemetry: three events so the tool's use is measurable ───────────────
-- product_events.event is enumerated by a CHECK (00194). packages/shared
-- PRODUCT_EVENTS and product-events.contract.test.ts are updated with it.

ALTER TABLE public.product_events DROP CONSTRAINT IF EXISTS product_events_event_check;
ALTER TABLE public.product_events ADD CONSTRAINT product_events_event_check CHECK (event IN (
    'rfi_created',
    'rfi_responded',
    'rfi_closed',
    'snag_resolved',
    'project_created',
    'project_deleted',
    'marketplace_order_placed',
    'onboarding_started',
    'backfill_completed',
    'cable_route_leg_saved',
    'cable_route_assigned',
    'cable_route_sheet_exported'
));

NOTIFY pgrst, 'reload schema';
