-- 00198_floor_plan_calibration_geometry.sql
--
-- WHERE A DRAWING'S SCALE WAS TAKEN.
--
-- Since 00035 a drawing has carried `pixels_per_meter`, `calibrated_at` and
-- `calibrated_by` — a number, a time and a person. Not WHERE. The two points the
-- calibrator clicked and the metres they typed were thrown away the moment the
-- ratio was derived, so a calibrated sheet shows "18.8 px/m" and nothing else.
-- Nobody can see whether that came from a 5 m doorway or a 5 m car, and the
-- difference is every cable length measured on the sheet afterwards.
--
-- Found while walking the cable-route measuring flow on production data
-- (2026-09-14): "the calibration is not reflected after being set, leaving it
-- unknown as to where the point was set." Both calibration writers — the
-- markup toolbar's direct write and `calibrateFloorPlanAction` — now store the
-- line, and the route layer draws it on the sheet with its metres and px/m.
--
-- Additive and nullable. Every existing row stays valid; a sheet calibrated
-- before this migration simply has no line to show until it is recalibrated.
--
-- @verify:begin
-- column: tenants.floor_plans.calibration_points
-- column: tenants.floor_plans.calibration_metres
-- column: tenants.floor_plans.calibration_page_index
-- constraint: floor_plans_calibration_points_shape ON tenants.floor_plans
-- constraint: floor_plans_calibration_metres_positive ON tenants.floor_plans
-- constraint: floor_plans_calibration_page_positive ON tenants.floor_plans
-- sql: NOT EXISTS (SELECT 1 FROM tenants.floor_plans WHERE calibration_points IS NOT NULL AND (jsonb_typeof(calibration_points) <> 'array' OR jsonb_array_length(calibration_points) <> 4))
-- @verify:end

ALTER TABLE tenants.floor_plans
  ADD COLUMN IF NOT EXISTS calibration_points     JSONB,
  ADD COLUMN IF NOT EXISTS calibration_metres     NUMERIC,
  ADD COLUMN IF NOT EXISTS calibration_page_index INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'floor_plans_calibration_points_shape') THEN
    ALTER TABLE tenants.floor_plans ADD CONSTRAINT floor_plans_calibration_points_shape CHECK (
      calibration_points IS NULL
      OR (jsonb_typeof(calibration_points) = 'array' AND jsonb_array_length(calibration_points) = 4)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'floor_plans_calibration_metres_positive') THEN
    ALTER TABLE tenants.floor_plans ADD CONSTRAINT floor_plans_calibration_metres_positive CHECK (
      calibration_metres IS NULL OR calibration_metres > 0
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'floor_plans_calibration_page_positive') THEN
    ALTER TABLE tenants.floor_plans ADD CONSTRAINT floor_plans_calibration_page_positive CHECK (
      calibration_page_index IS NULL OR calibration_page_index >= 1
    );
  END IF;
END $$;

COMMENT ON COLUMN tenants.floor_plans.calibration_points IS
'The two points the calibrator clicked, as [x1, y1, x2, y2] in the drawing''s backing-canvas pixel space — the same space every markup shape and route segment uses. Stored so the sheet can SHOW where its scale was taken. pixels_per_meter is derived from these and calibration_metres by derivePixelsPerMeter() in @esite/shared; the three always come from one write.';

COMMENT ON COLUMN tenants.floor_plans.calibration_metres IS
'The real-world distance, in metres, the calibrator typed for the line in calibration_points.';

COMMENT ON COLUMN tenants.floor_plans.calibration_page_index IS
'1-based PDF page the calibration line was drawn on. The line is drawn only on that page.';

-- New columns on an exposed table: let PostgREST see them.
NOTIFY pgrst, 'reload schema';
