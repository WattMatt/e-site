-- 00054_cable_schedule_c12_editable.sql
-- C12: extend the supply voltage range (22kV, 33kV) and introduce
-- structured node types. Transformer becomes a mid-network board kind.

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
ALTER TABLE cable_schedule.boards
  ADD CONSTRAINT boards_kind_check
  CHECK (kind IN ('CONSUMER_RMU', 'TRANSFORMER', 'MAIN_BOARD', 'SUB_BOARD'));

-- ─── 3. sources.type — reconcile + restrict to origin types ──────────
-- RMU sources are council connection points → COUNCIL_RMU.
UPDATE cable_schedule.sources SET type = 'COUNCIL_RMU' WHERE type = 'RMU';

-- MINISUB sources are transformers → they belong as mid-network boards.
-- Move each MINISUB source to a TRANSFORMER board and re-point its supplies.
DO $$
DECLARE
  src RECORD;
  new_board_id UUID;
BEGIN
  FOR src IN
    SELECT * FROM cable_schedule.sources WHERE type = 'MINISUB'
  LOOP
    INSERT INTO cable_schedule.boards (revision_id, organisation_id, code, kind, notes)
    VALUES (src.revision_id, src.organisation_id, src.code, 'TRANSFORMER', src.notes)
    RETURNING id INTO new_board_id;

    UPDATE cable_schedule.supplies
      SET from_board_id = new_board_id, from_source_id = NULL
      WHERE from_source_id = src.id;

    DELETE FROM cable_schedule.sources WHERE id = src.id;
  END LOOP;
END $$;

ALTER TABLE cable_schedule.sources
  DROP CONSTRAINT IF EXISTS sources_type_check;
ALTER TABLE cable_schedule.sources
  ADD CONSTRAINT sources_type_check
  CHECK (type IN ('COUNCIL_RMU', 'UTILITY', 'PV', 'STANDBY'));

COMMIT;
