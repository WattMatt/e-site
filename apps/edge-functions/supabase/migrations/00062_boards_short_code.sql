-- =============================================================================
-- Migration 00062 — Short code on boards (greenfield abbreviation convention)
-- =============================================================================
-- Background:
--   boards.code carries the full descriptive name as entered by engineers
--   ("MINIATURE SUBSTATION 1", "MAIN BOARD 1.1", "Council RMU"). The
--   descriptive form is load-bearing for cross-document consistency — it
--   appears on cable schedules, single-line diagrams, and layout drawings.
--
--   Cable tag text is constructed as `{from_code}-{to_code}-{size}-{n}`
--   so it inherits the full descriptive code (e.g. 51 chars for
--   "MINIATURE SUBSTATION 1-MINIATURE SUBSTATION 2-120-1"). This doesn't
--   physically fit on any standard cable-tag media (Critchley engraved
--   Traffolyte 25×75mm, Avery laminate wraps, heat-shrink markers all
--   max out at ~8-12 chars at readable font size).
--
--   This adds an optional `short_code` column so engineers can attach a
--   compact form (e.g. "MS1", "MB1.1", "RMU-C") to each board without
--   disturbing the descriptive `code`. Tag construction reads
--   `short_code ?? code` — non-destructive fallback.
--
-- Schema delta:
--   ALTER cable_schedule.boards
--     + short_code TEXT NULL
--       CHECK (short_code IS NULL OR (length(short_code) BETWEEN 1 AND 12))
--
-- Compatibility:
--   * Existing rows: short_code defaults to NULL; tag construction falls
--     back to the existing code. Zero migration of existing data needed.
--   * New revisions inherit short_code from cloned boards (handled by
--     existing revision-clone logic if/when it copies board rows).
-- =============================================================================

ALTER TABLE cable_schedule.boards
    ADD COLUMN IF NOT EXISTS short_code TEXT;

-- Length check: 1-12 chars (or NULL). 12 chars fits any standard cable
-- tag media at readable font size.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        JOIN pg_namespace n ON t.relnamespace = n.oid
        WHERE n.nspname = 'cable_schedule'
          AND t.relname = 'boards'
          AND c.conname = 'boards_short_code_length_check'
    ) THEN
        ALTER TABLE cable_schedule.boards
            ADD CONSTRAINT boards_short_code_length_check
                CHECK (short_code IS NULL OR (length(short_code) BETWEEN 1 AND 12));
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
