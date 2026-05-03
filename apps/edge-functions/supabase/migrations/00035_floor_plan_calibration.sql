-- ---------------------------------------------------------------------------
-- Migration 00035: floor_plan calibration for the measure tool
-- ---------------------------------------------------------------------------
-- The Konva/Skia markup canvas (added per migration 00033) ships with a
-- measure tool in v1. To convert pixel distances into real-world distances
-- (metres) the canvas needs a calibration value per drawing.
--
-- The existing `tenants.floor_plans.scale` column is a free-text descriptor
-- ('1:100', 'NTS', 'see notes') intended for human reference. It is NOT
-- machine-readable — site teams routinely upload phone photos of paper
-- drawings, scans cropped at unknown ratios, etc., where the printed scale
-- bar may be cropped, missing, or wrong. We therefore store a derived
-- `pixels_per_meter` calibrated by the user via a two-click "known distance"
-- modal in the markup canvas.
--
-- Calibration is a property of the DRAWING (intrinsic to the raster), not
-- of any individual markup. Storing it on `tenants.floor_plans` lets every
-- markup created against that drawing reuse the same calibration.
--
-- All three columns are nullable: a drawing without calibration loads in
-- the canvas with the measure tool disabled (gated on `pixels_per_meter
-- IS NOT NULL`) and an inline "Calibrate this drawing" prompt.
--
-- RLS: covered by the existing `Org members can manage floor plans` ALL
-- policy on tenants.floor_plans (added in 00009) — UPDATE writes from the
-- calibration modal are already authorised. No policy change needed.
-- ---------------------------------------------------------------------------

ALTER TABLE tenants.floor_plans
    ADD COLUMN IF NOT EXISTS pixels_per_meter NUMERIC,
    ADD COLUMN IF NOT EXISTS calibrated_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS calibrated_by    UUID REFERENCES public.profiles(id);

COMMENT ON COLUMN tenants.floor_plans.pixels_per_meter IS
    'Calibration: image pixels per real-world metre. NULL = uncalibrated; measure tool is disabled in the markup canvas until set. Set via two-click known-distance modal.';

COMMENT ON COLUMN tenants.floor_plans.calibrated_at IS
    'Timestamp the user last calibrated this drawing. NULL when uncalibrated.';

COMMENT ON COLUMN tenants.floor_plans.calibrated_by IS
    'Profile that last calibrated this drawing. NULL when uncalibrated.';

-- Sanity guard: pixels_per_meter must be positive when set.
ALTER TABLE tenants.floor_plans
    DROP CONSTRAINT IF EXISTS floor_plans_pixels_per_meter_positive;

ALTER TABLE tenants.floor_plans
    ADD CONSTRAINT floor_plans_pixels_per_meter_positive
    CHECK (pixels_per_meter IS NULL OR pixels_per_meter > 0);
