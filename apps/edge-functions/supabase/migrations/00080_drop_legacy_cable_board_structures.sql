-- =============================================================================
-- Migration 00080 — drop legacy cable-schedule board structures
-- =============================================================================
-- Background:
--   Final migration of the structure re-point. Migrations 00077/00078 collapsed
--   cable_schedule.boards (+ RMU/MINISUB sources) into structure.nodes and
--   re-pointed cable_schedule.supplies + inspections.inspections. This migration
--   removes the now-superseded legacy structures.
--
-- DESTRUCTIVE — apply only after 00076/00077/00078 are applied AND the cable
--   schedule has been smoke-tested against the migrated data. Rollback: the
--   pre-migration snapshot at
--   apps/edge-functions/supabase/migration-snapshots/2026-05-20-cable-schedule-
--   pre-structure.json, plus the main-pre-structure-2026-05-20 git tag.
--
-- Schema delta:
--   - cable_schedule.sources rows of type RMU / MINISUB        (DELETEd)
--   - cable_schedule.supplies.from_board_id / to_board_id      (DROPped; CASCADE
--     also removes their FK constraints + the old origin XOR CHECK that
--     referenced from_board_id)
--   ~ cable_schedule.supplies.to_node_id                       (now NOT NULL)
--   + cable_schedule.supplies origin XOR CHECK (from_node_id XOR from_source_id)
--   - cable_schedule.boards table                              (DROPped)
-- =============================================================================

-- ─── Safety guard ────────────────────────────────────────────────────────────
-- supplies.from_source_id has ON DELETE CASCADE → cable_schedule.sources.
-- Deleting RMU/MINISUB source rows while a supply still references one would
-- CASCADE-DELETE that supply. 00078 nulls from_source_id for RMU/MINISUB-fed
-- supplies; verify that held, and abort loudly if not.
DO $$
DECLARE
    _dangling INT;
BEGIN
    SELECT COUNT(*)
    INTO   _dangling
    FROM   cable_schedule.supplies s
    JOIN   cable_schedule.sources  src ON src.id = s.from_source_id
    WHERE  src.type IN ('RMU', 'MINISUB');

    IF _dangling > 0 THEN
        RAISE EXCEPTION
            '00080 aborted: % supply row(s) still reference an RMU/MINISUB '
            'source via from_source_id. Migration 00078 must null these first — '
            'deleting the sources now would ON DELETE CASCADE the supplies.',
            _dangling;
    END IF;
END $$;

-- 1. Remove the RMU/MINISUB source rows (migrated to structure.nodes by 00077).
DELETE FROM cable_schedule.sources WHERE type IN ('RMU', 'MINISUB');

-- 2. Drop the abandoned board-FK columns. CASCADE also drops their FK
--    constraints to cable_schedule.boards and the old origin XOR CHECK
--    constraint (which referenced from_board_id).
ALTER TABLE cable_schedule.supplies
    DROP COLUMN from_board_id CASCADE,
    DROP COLUMN to_board_id   CASCADE;

-- 3. Every supply now has a destination node (verified by 00078's invariant
--    block) — enforce it at the schema level.
ALTER TABLE cable_schedule.supplies
    ALTER COLUMN to_node_id SET NOT NULL;

-- 4. New origin rule: a supply starts at exactly one of a node or a source.
ALTER TABLE cable_schedule.supplies
    ADD CONSTRAINT supplies_origin_xor
    CHECK ((from_node_id IS NOT NULL)::int + (from_source_id IS NOT NULL)::int = 1);

-- 5. Drop the boards table — fully superseded by structure.nodes.
DROP TABLE cable_schedule.boards;

DO $$
BEGIN
    RAISE NOTICE '00080 complete: legacy cable_schedule.boards dropped, '
                 'RMU/MINISUB sources removed, supplies origin XOR re-based '
                 'on structure.nodes.';
END $$;
