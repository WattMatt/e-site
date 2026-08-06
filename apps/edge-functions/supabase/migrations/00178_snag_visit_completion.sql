-- =============================================================================
-- Migration 00178 — snag site-visit completion
-- =============================================================================
-- Adds the missing lifecycle event for a snag site visit.
--
-- Before this, `field.snag_visits` (00120) had no notion of being finished: a
-- visit could be created and snags hung off it, but nothing marked the walk as
-- done. Consequently the only notifications the snag module could emit were
-- per-snag (one email per snag raised, one per status change) — never the
-- message a project team actually wants: "the site visit is complete, here is
-- the summary, here is the report".
--
-- Additive, idempotent, reversible. `field` and `projects` are already
-- PostgREST-exposed (no schema CREATE/DROP) -> a trailing NOTIFY suffices, no
-- config PATCH (see the 00120 header for the same reasoning).
--
-- Reversible:
--   ALTER TABLE field.snag_visits
--     DROP COLUMN completed_at, DROP COLUMN completed_by, DROP COLUMN report_id;
--   (and re-declare notifications_type_check without 'snag_visit_completed')
-- =============================================================================

-- 1. Completion stamps ---------------------------------------------------------
ALTER TABLE field.snag_visits ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE field.snag_visits ADD COLUMN IF NOT EXISTS completed_by UUID;
ALTER TABLE field.snag_visits ADD COLUMN IF NOT EXISTS report_id    UUID;

ALTER TABLE field.snag_visits DROP CONSTRAINT IF EXISTS snag_visits_completed_by_fk;
ALTER TABLE field.snag_visits ADD  CONSTRAINT snag_visits_completed_by_fk
    FOREIGN KEY (completed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- The issued Snag & Defect Report for this visit. ON DELETE SET NULL so purging
-- a report row never blocks or cascades into the visit record.
ALTER TABLE field.snag_visits DROP CONSTRAINT IF EXISTS snag_visits_report_fk;
ALTER TABLE field.snag_visits ADD  CONSTRAINT snag_visits_report_fk
    FOREIGN KEY (report_id) REFERENCES projects.reports(id) ON DELETE SET NULL;

-- completed_by is only meaningful alongside completed_at.
ALTER TABLE field.snag_visits DROP CONSTRAINT IF EXISTS snag_visits_completion_coherent;
ALTER TABLE field.snag_visits ADD  CONSTRAINT snag_visits_completion_coherent
    CHECK (completed_by IS NULL OR completed_at IS NOT NULL);

-- Partial index: the "still open" visit lookup is the hot path (the per-snag
-- email suppression checks it on every snag raised against a visit).
CREATE INDEX IF NOT EXISTS snag_visits_open_idx
    ON field.snag_visits (project_id)
    WHERE completed_at IS NULL;

COMMENT ON COLUMN field.snag_visits.completed_at IS
  'When the site visit was marked complete (report issued + roster notified). NULL = still in progress.';
COMMENT ON COLUMN field.snag_visits.report_id IS
  'The projects.reports row issued at completion. Re-completing supersedes the prior report and repoints this.';

-- 2. notifications_type_check — re-ADD the full 00176 enum + the new bell -------
--    The constraint is re-declared wholesale each time (00066 -> 00072 -> 00173
--    -> 00176), so every existing value must be re-listed here, not appended.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    -- pre-existing types (from 00066)
    'snag_status_changed',
    'rfi_assigned',
    'rfi_closed',
    'rfi_response',
    'grn_recorded',
    -- inspection lifecycle types (from 00066)
    'inspection_assigned',
    'inspection_awaiting_verification',
    'inspection_certified',
    'inspection_re_inspect_required',
    'inspection_revoked',
    -- abandon event (from 00072)
    'inspection_abandoned',
    -- QC reports + previously-missing "created" bells (from 00173)
    'qc_issued',
    'rfi_created',
    'snag_created',
    'diary_created',
    -- QC per-photo/entry comment bell (from 00176)
    'qc_comment',
    -- new (00178): snag site visit completed
    'snag_visit_completed'
  )
);

-- 3. PostgREST reload (new columns on already-exposed tables; no schema
--    CREATE/DROP -> NOTIFY suffices, no config PATCH).
NOTIFY pgrst, 'reload schema';
