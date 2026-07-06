-- =============================================================================
-- 00154 — enforce per-project SHOP NO. uniqueness at the database
--
-- The Excel-import diff and the tenant-edit form both key update/decommission
-- matching on structure.nodes.shop_number, and both enforce uniqueness in
-- application code — but check-then-write races (two concurrent edits, or an
-- edit racing an import commit) could still create duplicate live tenants,
-- which silently corrupts the next re-import (Map keying keeps only one).
--
-- Partial index: live (not soft-deleted) tenant boards only. Soft-deleted
-- tenants keep their number without blocking (the edit action separately
-- treats binned numbers as reserved); NULL shop_numbers never collide.
-- Pre-checked in prod 2026-07-03: 394 live tenant rows, 0 duplicate pairs.
--
-- Violations surface as 23505 → the edit action and the import commit route
-- both report per-row errors rather than aborting.
--
-- Idempotent: CREATE UNIQUE INDEX IF NOT EXISTS.
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS nodes_project_shop_number_tenant_live
  ON structure.nodes (project_id, shop_number)
  WHERE kind = 'tenant_db' AND deleted_at IS NULL;
