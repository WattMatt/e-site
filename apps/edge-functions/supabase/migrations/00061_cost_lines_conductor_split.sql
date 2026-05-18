-- =============================================================================
-- Migration 00061 — Cost lines split by conductor (Cu vs Al)
-- =============================================================================
-- Background:
--   cost_lines was keyed by (revision_id, size_mm2) only — a 240mm² Cu
--   row and a 240mm² Al row shared the same supply/install/termination
--   rates. Aluminium is ~30% the price of copper at the same size; mixed-
--   metal projects produced wrong totals.
--
--   This adds a conductor column to cost_lines and replaces the UNIQUE
--   constraint with (revision, size, conductor). Existing rows backfill
--   to 'CU' (the implicit historical assumption — pre-2026-05-18 there
--   was no way to express Al pricing separately).
--
-- Schema delta:
--   ALTER cable_schedule.cost_lines
--     + conductor TEXT NOT NULL DEFAULT 'CU'
--       CHECK (conductor IN ('CU','AL'))
--   DROP CONSTRAINT cost_lines_revision_id_size_mm2_key (the inline
--     UNIQUE from 00051)
--   ADD CONSTRAINT cost_lines_revision_size_conductor_key
--     UNIQUE (revision_id, size_mm2, conductor)
--
-- App-side compatibility:
--   * ensureCostLinesAction must now enumerate (size, conductor) tuples
--     from cables, not just sizes.
--   * Cost page aggregates cables by (size, conductor); displays one
--     row per pair.
--   * updateCostLineAction unchanged — rate columns still per row.
-- =============================================================================

ALTER TABLE cable_schedule.cost_lines
    ADD COLUMN IF NOT EXISTS conductor TEXT NOT NULL DEFAULT 'CU'
        CHECK (conductor IN ('CU','AL'));

-- Drop the old (revision_id, size_mm2) UNIQUE. Inline UNIQUE constraints
-- from CREATE TABLE get the auto-name <table>_<col1>_<col2>_key.
ALTER TABLE cable_schedule.cost_lines
    DROP CONSTRAINT IF EXISTS cost_lines_revision_id_size_mm2_key;

-- Add the new conductor-aware UNIQUE.
ALTER TABLE cable_schedule.cost_lines
    ADD CONSTRAINT cost_lines_revision_size_conductor_key
        UNIQUE (revision_id, size_mm2, conductor);

NOTIFY pgrst, 'reload schema';
