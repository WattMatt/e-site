-- Migration 00064 — Cables grouping arrangement (touching vs spaced)
-- =============================================================================
-- T6.3.6 stores BOTH `factor_touching` and `factor_clearance_d` per n_cables.
-- Engineers couldn't pick between them — `lookupDeratingFactors` defaulted
-- to touching, hardest derate (e.g. 0.84 for 3 cables vs 0.90 spaced).
--
-- This adds the layout choice to the cable so the lookup can pick the
-- right factor. Default 'TOUCHING' is conservative — existing cables get
-- the same factor they have today.
-- =============================================================================

ALTER TABLE cable_schedule.cables
    ADD COLUMN IF NOT EXISTS grouping_arrangement TEXT NOT NULL DEFAULT 'TOUCHING';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        JOIN pg_namespace n ON t.relnamespace = n.oid
        WHERE n.nspname = 'cable_schedule'
          AND t.relname = 'cables'
          AND c.conname = 'cables_grouping_arrangement_check'
    ) THEN
        ALTER TABLE cable_schedule.cables
            ADD CONSTRAINT cables_grouping_arrangement_check
                CHECK (grouping_arrangement IN ('TOUCHING', 'SPACING_D'));
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
