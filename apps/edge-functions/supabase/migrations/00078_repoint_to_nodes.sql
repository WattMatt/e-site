-- =============================================================================
-- Migration 00078 — re-point supplies + inspections to structure.nodes
-- =============================================================================
-- Background:
--   Migration 00077 populated structure.nodes from cable_schedule.boards and
--   cable_schedule.sources (RMU/MINISUB only). Migration 00076 added nullable
--   from_node_id / to_node_id columns on cable_schedule.supplies. This
--   migration backfills those columns and migrates inspections.inspections
--   target_node_id from raw board/source UUIDs to structure.nodes.id, then
--   adds the real FK constraint.
--
-- Schema delta:
--   cable_schedule.supplies.to_node_id     — backfilled for all rows
--   cable_schedule.supplies.from_node_id   — backfilled for from_board_id
--                                            and RMU/MINISUB from_source_id
--                                            supplies; NULL for
--                                            UTILITY/PV/STANDBY from_source_id
--   inspections.inspections.target_node_id — backfilled (board + RMU/MINISUB
--                                            source rows); UTILITY/PV/STANDBY-
--                                            targeted rows degraded to adhoc
--   + FK inspections.inspections.target_node_id → structure.nodes(id)
--   + validate_target_node trigger DROPPED (was checking cable_schedule.boards
--     directly; superseded by the FK + updated application logic)
--
-- Join strategy: node lookup uses (project_id, code) because 00077 populated
--   nodes with the same `code` values as the originating board/source rows.
--   boards/sources are NOT yet dropped (that is a later migration), so the
--   joins are safe.
--
-- Part C note on cables: cable_schedule.cables references only supply_id
--   (→ cable_schedule.supplies). There is no direct FK to boards or sources on
--   cables. No re-point is needed for cables.
--
-- Do NOT apply until Task 1.8 (after 00077 has been applied).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Part A — supplies.to_node_id
-- Every supply's to_board_id → that board → its structure.nodes row.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE cable_schedule.supplies s
SET    to_node_id = n.id
FROM   cable_schedule.boards     b
JOIN   cable_schedule.revisions  r  ON r.id = b.revision_id
JOIN   structure.nodes           n  ON n.project_id = r.project_id
                                   AND n.code       = b.code
WHERE  b.id = s.to_board_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Part B — supplies.from_node_id
-- Two sub-cases share the same column; run them sequentially.
-- ─────────────────────────────────────────────────────────────────────────────

-- B-1: origin is a board (from_board_id IS NOT NULL)
UPDATE cable_schedule.supplies s
SET    from_node_id = n.id
FROM   cable_schedule.boards     b
JOIN   cable_schedule.revisions  r  ON r.id = b.revision_id
JOIN   structure.nodes           n  ON n.project_id = r.project_id
                                   AND n.code       = b.code
WHERE  b.id = s.from_board_id;

-- B-2: origin is an RMU or MINISUB source (type IN ('RMU','MINISUB')).
--   UTILITY / PV / STANDBY sources are not nodes; their supplies keep
--   from_node_id = NULL (they continue using from_source_id).
UPDATE cable_schedule.supplies s
SET    from_node_id   = n.id,
       -- Clear from_source_id: the supply is now fed by the RMU/MINISUB *node*.
       -- 00079 deletes those source rows; supplies.from_source_id has
       -- ON DELETE CASCADE, so leaving it set would cascade-delete this supply.
       from_source_id = NULL
FROM   cable_schedule.sources    src
JOIN   cable_schedule.revisions  r   ON r.id = src.revision_id
JOIN   structure.nodes           n   ON n.project_id = r.project_id
                                    AND n.code       = src.code
WHERE  src.id = s.from_source_id
  AND  src.type IN ('RMU', 'MINISUB');

-- ─────────────────────────────────────────────────────────────────────────────
-- Part C — cables
-- cable_schedule.cables references supply_id (→ cable_schedule.supplies) only.
-- There is no direct FK to cable_schedule.boards or cable_schedule.sources on
-- the cables table (confirmed against 00051). No re-point is required.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- Part D — inspections.target_node_id → real FK
-- ─────────────────────────────────────────────────────────────────────────────

-- D-1: Drop the trigger that validated target_node_id against
--   cable_schedule.boards / cable_schedule.sources directly. It will be
--   superseded by the FK added at the end of Part D and by updated application
--   logic that references structure.nodes.
DROP TRIGGER IF EXISTS trg_validate_target_node
    ON inspections.inspections;

DROP FUNCTION IF EXISTS inspections.validate_target_node();

-- D-2: Backfill board-targeted inspections.
UPDATE inspections.inspections i
SET    target_node_id = n.id
FROM   cable_schedule.boards     b
JOIN   cable_schedule.revisions  r  ON r.id = b.revision_id
JOIN   structure.nodes           n  ON n.project_id = r.project_id
                                   AND n.code       = b.code
WHERE  i.target_node_type = 'board'
  AND  b.id = i.target_node_id;

-- D-3: Backfill source-targeted inspections for RMU / MINISUB sources only.
--   (UTILITY / PV / STANDBY sources are not nodes and are handled in D-4.)
UPDATE inspections.inspections i
SET    target_node_id = n.id
FROM   cable_schedule.sources    src
JOIN   cable_schedule.revisions  r   ON r.id = src.revision_id
JOIN   structure.nodes           n   ON n.project_id = r.project_id
                                    AND n.code       = src.code
WHERE  i.target_node_type = 'source'
  AND  src.id = i.target_node_id
  AND  src.type IN ('RMU', 'MINISUB');

-- D-4: Degrade any remaining board/source-typed inspection whose target_node_id
--   is still NOT a valid structure.nodes.id. This covers inspections that
--   targeted a UTILITY / PV / STANDBY source (not a node). They are converted
--   to adhoc so the FK added below does not reject them.
DO $$
DECLARE
    _degraded INT;
BEGIN
    UPDATE inspections.inspections i
    SET    target_node_type = 'adhoc',
           target_node_id   = NULL
    WHERE  i.target_node_type IN ('board', 'source')
      AND  NOT EXISTS (
               SELECT 1
               FROM   structure.nodes n
               WHERE  n.id = i.target_node_id
           );

    GET DIAGNOSTICS _degraded = ROW_COUNT;

    IF _degraded > 0 THEN
        RAISE NOTICE
            '00078 Part D: degraded % inspection row(s) to adhoc '
            '(target was a non-node source: UTILITY / PV / STANDBY). '
            'Review these rows before applying subsequent migrations.',
            _degraded;
    ELSE
        RAISE NOTICE
            '00078 Part D: no inspections degraded — all board/source targets '
            'resolved to structure.nodes successfully.';
    END IF;
END;
$$;

-- D-5: Add the real FK now that all target_node_id values are either
--   a valid structure.nodes.id or NULL (adhoc rows).
ALTER TABLE inspections.inspections
    ADD CONSTRAINT inspections_target_node_id_fkey
        FOREIGN KEY (target_node_id)
        REFERENCES  structure.nodes(id)
        ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Part E — verification
-- Aborts the transaction (RAISE EXCEPTION) if any invariant is violated.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
    _null_to_node        INT;
    _null_from_board     INT;
    _null_from_rmu       INT;
    _supply_count        INT;
    _inspection_board    INT;
    _inspection_source   INT;
BEGIN
    -- E-1: every supply must have to_node_id filled (all supplies have to_board_id)
    SELECT COUNT(*)
    INTO   _null_to_node
    FROM   cable_schedule.supplies
    WHERE  to_node_id IS NULL;

    IF _null_to_node > 0 THEN
        RAISE EXCEPTION
            '00078 invariant failed: % supply row(s) have to_node_id IS NULL. '
            'Ensure structure.nodes was populated by 00077 before applying this '
            'migration.',
            _null_to_node;
    END IF;

    -- E-2: every supply with from_board_id must have from_node_id filled
    SELECT COUNT(*)
    INTO   _null_from_board
    FROM   cable_schedule.supplies
    WHERE  from_board_id IS NOT NULL
      AND  from_node_id  IS NULL;

    IF _null_from_board > 0 THEN
        RAISE EXCEPTION
            '00078 invariant failed: % supply row(s) have from_board_id set but '
            'from_node_id IS NULL. Check that all boards have a matching node '
            'in structure.nodes.',
            _null_from_board;
    END IF;

    -- E-3: every supply whose from_source_id is an RMU/MINISUB must have
    --   from_node_id filled
    SELECT COUNT(*)
    INTO   _null_from_rmu
    FROM   cable_schedule.supplies s
    JOIN   cable_schedule.sources  src ON src.id = s.from_source_id
    WHERE  src.type IN ('RMU', 'MINISUB')
      AND  s.from_node_id IS NULL;

    IF _null_from_rmu > 0 THEN
        RAISE EXCEPTION
            '00078 invariant failed: % supply row(s) have an RMU/MINISUB '
            'from_source_id but from_node_id IS NULL. Check that all '
            'RMU/MINISUB sources have a matching node in structure.nodes.',
            _null_from_rmu;
    END IF;

    -- Summary notice on success
    SELECT COUNT(*) INTO _supply_count     FROM cable_schedule.supplies;
    SELECT COUNT(*) INTO _inspection_board
        FROM inspections.inspections WHERE target_node_type = 'board';
    SELECT COUNT(*) INTO _inspection_source
        FROM inspections.inspections WHERE target_node_type = 'source';

    RAISE NOTICE
        '00078 all invariants passed. '
        'Supplies re-pointed: % total. '
        'Inspection rows remaining as board-type: %, source-type: %.',
        _supply_count,
        _inspection_board,
        _inspection_source;
END;
$$;
