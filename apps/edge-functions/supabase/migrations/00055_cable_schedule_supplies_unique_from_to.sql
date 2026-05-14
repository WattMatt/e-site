-- =============================================================================
-- Migration 00055 — Cable Schedule: unique (from, to) supply per revision
-- =============================================================================
-- Background:
--   cable_schedule.supplies (migration 00051) carries only single-column
--   partial indexes on from_source_id / from_board_id, plus the XOR CHECK
--   that forces exactly one origin per row. Nothing stops two supplies with
--   an identical (revision_id, origin, to_board_id) triple. A C12 code review
--   found this gap: findOrCreateSupplyAction does a .maybeSingle()
--   find-then-insert, so duplicate (from, to) supplies would (a) make
--   .maybeSingle() throw PGRST116, and (b) leave the non-atomic
--   find-then-insert open to a TOCTOU race where two concurrent adds both
--   miss the find and both insert.
--
--   A "supply" is the logical feed from one origin to one destination board
--   within a revision — there is never a legitimate second supply for the
--   same (revision, origin, destination). This migration makes that a hard
--   constraint.
--
-- Schema delta:
--   + UNIQUE INDEX supplies_unique_from_source_to
--       ON supplies(revision_id, from_source_id, to_board_id)
--       WHERE from_source_id IS NOT NULL
--   + UNIQUE INDEX supplies_unique_from_board_to
--       ON supplies(revision_id, from_board_id, to_board_id)
--       WHERE from_board_id IS NOT NULL
--   Two partial indexes (not one) because from_source_id and from_board_id
--   are mutually exclusive (XOR CHECK in 00051): every row has exactly one
--   origin and therefore lands in exactly one of these indexes.
--
-- Pre-flight duplicate guard:
--   Staging carried 0 supply rows when this migration was written, so there
--   was nothing to resolve there. Production has had the cable-schedule
--   module live since the C9 fast-forward and could hold real supply rows,
--   so the migration self-checks first: the DO block below RAISE EXCEPTIONs
--   (rolling the whole transaction back) with the exact conflicting supply
--   ids if any duplicate (from, to) group exists. Resolve those deliberately
--   — merge the cables onto the oldest supply, delete the younger duplicate
--   supplies — then re-run. It does NOT auto-delete: destroying supply rows
--   blind in a migration is not safe, and the conflict set is expected to be
--   empty or tiny.
--
-- Index build strategy:
--   Plain CREATE UNIQUE INDEX (not CONCURRENTLY) — matches every other index
--   in 00051/00023 and keeps the migration runnable inside the single
--   transaction (CONCURRENTLY cannot run in a transaction block). The brief
--   ACCESS EXCLUSIVE lock is a non-issue: the table is empty on staging and
--   holds at most a handful of rows on production — the cable-schedule
--   module is days old. Revisit if supplies ever becomes high-traffic.
--
-- Rollback (repo is forward-only — no .down.sql):
--   DROP INDEX IF EXISTS cable_schedule.supplies_unique_from_source_to;
--   DROP INDEX IF EXISTS cable_schedule.supplies_unique_from_board_to;
--
-- This whole migration is wrapped in a single transaction — any failure
-- (including inside the DO block) rolls the entire thing back, so the
-- database never lands in a partial state.
-- =============================================================================

BEGIN;

-- ─── 1. Pre-flight: refuse to proceed if duplicate (from, to) supplies exist ─
DO $$
DECLARE
  dup_groups INTEGER;
  dup_detail TEXT;
BEGIN
  SELECT count(*), string_agg(line, E'\n  ')
    INTO dup_groups, dup_detail
  FROM (
    SELECT format('revision %s  from_source %s → to_board %s : %s supplies %s',
                   revision_id, from_source_id, to_board_id,
                   count(*), array_agg(id ORDER BY created_at)) AS line
    FROM cable_schedule.supplies
    WHERE from_source_id IS NOT NULL
    GROUP BY revision_id, from_source_id, to_board_id
    HAVING count(*) > 1
    UNION ALL
    SELECT format('revision %s  from_board %s → to_board %s : %s supplies %s',
                   revision_id, from_board_id, to_board_id,
                   count(*), array_agg(id ORDER BY created_at))
    FROM cable_schedule.supplies
    WHERE from_board_id IS NOT NULL
    GROUP BY revision_id, from_board_id, to_board_id
    HAVING count(*) > 1
  ) d;

  IF dup_groups > 0 THEN
    RAISE EXCEPTION
      'Cannot add unique (from, to) supply indexes — % duplicate group(s) exist. Resolve each (merge its cables onto the oldest supply, then delete the younger duplicate supplies) and re-run this migration. Conflicting groups:%',
      dup_groups, E'\n  ' || dup_detail;
  END IF;
END $$;

-- ─── 2. Unique (from, to) supply per revision ────────────────────────────────
-- One supply == one logical feed from one origin to one destination board,
-- scoped to a revision. The two indexes are partial + mutually exclusive: a
-- source-origin supply lands only in the first, a board-origin supply only in
-- the second (00051's XOR CHECK guarantees exactly one origin per row).
CREATE UNIQUE INDEX IF NOT EXISTS supplies_unique_from_source_to
    ON cable_schedule.supplies (revision_id, from_source_id, to_board_id)
    WHERE from_source_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS supplies_unique_from_board_to
    ON cable_schedule.supplies (revision_id, from_board_id, to_board_id)
    WHERE from_board_id IS NOT NULL;

COMMIT;
