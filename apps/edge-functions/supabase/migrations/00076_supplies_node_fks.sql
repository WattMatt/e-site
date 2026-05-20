-- =============================================================================
-- Migration 00076 — supplies node FK columns
-- =============================================================================
-- Background:
--   Adds from_node_id / to_node_id to cable_schedule.supplies, referencing
--   the new structure.nodes table (00074). Both columns are nullable; the
--   existing from_source_id / from_board_id / to_board_id columns and the
--   CHECK constraint are left untouched. A later migration will backfill
--   these columns and drop the old ones.
--
-- Schema delta:
--   ~ cable_schedule.supplies  + from_node_id uuid → structure.nodes(id)
--   ~ cable_schedule.supplies  + to_node_id   uuid → structure.nodes(id)
--   + idx_cable_supplies_from_node
--   + idx_cable_supplies_to_node
--
-- Do NOT apply this migration directly — apply via the standard migration
-- workflow after 00075 has been applied.
-- =============================================================================

ALTER TABLE cable_schedule.supplies
    ADD COLUMN from_node_id UUID REFERENCES structure.nodes(id);

ALTER TABLE cable_schedule.supplies
    ADD COLUMN to_node_id UUID REFERENCES structure.nodes(id);

CREATE INDEX IF NOT EXISTS idx_cable_supplies_from_node
    ON cable_schedule.supplies(from_node_id)
    WHERE from_node_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cable_supplies_to_node
    ON cable_schedule.supplies(to_node_id)
    WHERE to_node_id IS NOT NULL;
