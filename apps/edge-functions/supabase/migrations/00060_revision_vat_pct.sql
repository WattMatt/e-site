-- =============================================================================
-- Migration 00060 — VAT % on revisions table (replaces sentinel cost_lines row)
-- =============================================================================
-- Background:
--   Phase-1 cost summary stored revision-level VAT and contingency on a
--   sentinel cost_lines row with size_mm2 = 0. But cost_lines has
--   CHECK (size_mm2 > 0) per migration 00051 line 288 — the sentinel
--   insert always rejected. The bug was latent until ensureCostLinesAction
--   started firing on cost-page load (2026-05-17 commit fa4a056). Hot-
--   fixed by skipping the sentinel (commit 2a50fc5) — which left VAT
--   display-only at 15% default with no per-revision override.
--
--   Contingency was removed entirely on 2026-05-17 (net contracts) and
--   does NOT need a new home. Only VAT needs a per-revision column.
--
-- Schema delta:
--   ALTER cable_schedule.revisions ADD COLUMN vat_pct NUMERIC.
--   Backfill all existing revisions to 15 (the prior default).
--   No CHECK constraint — 0 is valid (rare 0%-VAT exemption case).
--
-- Compatibility:
--   * cost_lines.vat_pct column is KEPT (don't break archived data).
--     Code stops reading/writing it; defaults to NULL on new inserts.
--   * Future cleanup migration (defer): drop cost_lines.vat_pct +
--     cost_lines.contingency_pct columns after one ISSUED revision
--     cycle confirms nothing's regressing.
-- =============================================================================

ALTER TABLE cable_schedule.revisions
    ADD COLUMN IF NOT EXISTS vat_pct NUMERIC;

-- Backfill: every existing revision gets 15 (the prior in-app default).
UPDATE cable_schedule.revisions
SET vat_pct = 15
WHERE vat_pct IS NULL;

NOTIFY pgrst, 'reload schema';
