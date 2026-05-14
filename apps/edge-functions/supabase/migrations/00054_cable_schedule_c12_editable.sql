-- =============================================================================
-- Migration 00054 — Cable Schedule C12 editable node management
-- =============================================================================
-- Background:
--   C12 makes the schedule's node graph editable: the supply voltage range
--   gains the SA MV steps (22kV, 33kV), boards become typed distribution
--   nodes via a new `kind` column, and the `sources` type list is reconciled
--   so an upstream "source" only ever means a true network origin. Mini Subs
--   were modelled as sources but are physically mid-network transformers, so
--   each existing MINISUB source is migrated to a TRANSFORMER board.
--
-- Schema delta (Before → After):
--   - supplies.voltage_v CHECK
--       Before: IN (230,400,525,1000,3300,6600,11000)
--       After : adds 22000, 33000
--   - boards gains `kind` TEXT NOT NULL
--       Before: boards had no node-type column
--       After : every board carries a kind; backfill defaults MAIN_BOARD
--               (top-level) / SUB_BOARD (has a parent)
--   - sources.type CHECK + data
--       Before: IN (MINISUB,STANDBY,PV,UTILITY,RMU)
--       After : IN (COUNCIL_RMU,UTILITY,PV,STANDBY); RMU → COUNCIL_RMU
--               in-place; every MINISUB source is moved to a TRANSFORMER
--               board and its supplies re-pointed (see DO block below)
--
-- This whole migration is wrapped in a single transaction — any failure
-- (including inside the DO block) rolls the entire thing back, so staging
-- never lands in a partial state.
-- =============================================================================

BEGIN;

-- ─── 1. Voltage CHECK — add 22kV + 33kV ──────────────────────────────
ALTER TABLE cable_schedule.supplies
  DROP CONSTRAINT IF EXISTS supplies_voltage_v_check;
ALTER TABLE cable_schedule.supplies
  ADD CONSTRAINT supplies_voltage_v_check
  CHECK (voltage_v IN (230, 400, 525, 1000, 3300, 6600, 11000, 22000, 33000));

-- ─── 2. boards.kind — structured distribution-node types ─────────────
ALTER TABLE cable_schedule.boards
  ADD COLUMN IF NOT EXISTS kind TEXT;

-- backfill existing rows: main board if top-level, else sub board
UPDATE cable_schedule.boards
  SET kind = CASE WHEN parent_board_id IS NULL THEN 'MAIN_BOARD' ELSE 'SUB_BOARD' END
  WHERE kind IS NULL;

ALTER TABLE cable_schedule.boards
  ALTER COLUMN kind SET NOT NULL;
-- MAIN_BOARD / SUB_BOARD are the only values the backfill assigns. CONSUMER_RMU
-- and TRANSFORMER are populated separately: CONSUMER_RMU only via future C12
-- node-management UI writes, TRANSFORMER both via that UI and by the MINISUB
-- source move in section 3 of this migration.
ALTER TABLE cable_schedule.boards
  ADD CONSTRAINT boards_kind_check
  CHECK (kind IN ('CONSUMER_RMU', 'TRANSFORMER', 'MAIN_BOARD', 'SUB_BOARD'));

-- ─── 3. sources.type — reconcile + restrict to origin types ──────────
-- RMU sources are council connection points → COUNCIL_RMU.
UPDATE cable_schedule.sources SET type = 'COUNCIL_RMU' WHERE type = 'RMU';

-- MINISUB sources are transformers → they belong as mid-network boards.
-- Move each MINISUB source to a TRANSFORMER board and re-point its supplies.
-- `boards` has no rating_kva / voltage_v columns (adding them is out of C12
-- scope), so the source's electrical data is preserved in the board's `notes`
-- rather than being silently dropped. The INSERT is conflict-safe against the
-- UNIQUE (revision_id, code) constraint on boards: DO UPDATE (not DO NOTHING)
-- guarantees RETURNING id yields a usable row whether a board was inserted or
-- an existing one matched.
DO $$
DECLARE
  src RECORD;
  new_board_id UUID;
BEGIN
  FOR src IN
    SELECT * FROM cable_schedule.sources WHERE type = 'MINISUB'
  LOOP
    INSERT INTO cable_schedule.boards (revision_id, organisation_id, code, kind, notes)
    VALUES (
      src.revision_id, src.organisation_id, src.code, 'TRANSFORMER',
      TRIM(BOTH E'\n' FROM
        COALESCE(src.notes, '') ||
        CASE WHEN src.rating_kva IS NOT NULL OR src.voltage_v IS NOT NULL
          THEN E'\n[migrated from MINISUB source]'
            || COALESCE(' rating_kva=' || src.rating_kva::text, '')
            || COALESCE(' voltage_v=' || src.voltage_v::text, '')
          ELSE '' END)
    )
    ON CONFLICT (revision_id, code) DO UPDATE SET kind = 'TRANSFORMER'
    RETURNING id INTO new_board_id;

    UPDATE cable_schedule.supplies
      SET from_board_id = new_board_id, from_source_id = NULL
      WHERE from_source_id = src.id;

    DELETE FROM cable_schedule.sources WHERE id = src.id;
  END LOOP;
END $$;
-- If the DO block above raises at any point, the surrounding transaction
-- rolls back cleanly — no half-moved sources, no orphaned boards.

ALTER TABLE cable_schedule.sources
  DROP CONSTRAINT IF EXISTS sources_type_check;
ALTER TABLE cable_schedule.sources
  ADD CONSTRAINT sources_type_check
  CHECK (type IN ('COUNCIL_RMU', 'UTILITY', 'PV', 'STANDBY'));

COMMIT;
