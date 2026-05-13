-- =============================================================================
-- Migration 00048 — Project budget + procurement rollup indexes
-- =============================================================================
-- Background:
--   Phase 3 of the procurement build-out. Adds the budget column the
--   procurement rollups compare against, plus a few status-scoped
--   indexes that make the dashboard cards (outstanding procurement /
--   quotes pending / deliveries this week) cheap.
--
-- Schema delta:
--   ALTER projects.projects
--     + budget_amount NUMERIC(14,2)
--     + budget_currency TEXT default 'ZAR'
--   Indexes on procurement_items and procurement_quotes for the
--   per-org dashboard queries.
--
-- Idempotent — IF NOT EXISTS guards.
-- =============================================================================

ALTER TABLE projects.projects
    ADD COLUMN IF NOT EXISTS budget_amount   NUMERIC(14,2);
ALTER TABLE projects.projects
    ADD COLUMN IF NOT EXISTS budget_currency TEXT NOT NULL DEFAULT 'ZAR';

-- Dashboard query indexes ---------------------------------------------------

-- "Outstanding procurement" — items with no PO yet (status in
-- draft / sent / quoted). One per org.
CREATE INDEX IF NOT EXISTS idx_procurement_items_org_outstanding
    ON projects.procurement_items(organisation_id, status)
    WHERE status IN ('draft', 'sent', 'quoted');

-- "Pending review" — quotes whose parent item is still draft/sent (need
-- the quotation decision). The status lives on the parent, so this index
-- just speeds up the per-org filter.
CREATE INDEX IF NOT EXISTS idx_procurement_quotes_org_pending
    ON projects.procurement_quotes(organisation_id)
    WHERE is_selected = FALSE;

-- "Deliveries this week" — GRNs with delivered_at within the rolling
-- 7-day window. Partial-index trick isn't applicable (CURRENT_DATE is
-- non-immutable), so a simple covering index on (org, delivered_at).
CREATE INDEX IF NOT EXISTS idx_grn_org_delivered_at
    ON projects.goods_received_notes(organisation_id, delivered_at DESC);

-- Project rollup index — scan procurement_items by project, useful for
-- the project overview "committed spend" panel.
CREATE INDEX IF NOT EXISTS idx_procurement_items_project_status
    ON projects.procurement_items(project_id, status);

NOTIFY pgrst, 'reload schema';
