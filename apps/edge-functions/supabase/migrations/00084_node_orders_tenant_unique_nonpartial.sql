-- =============================================================================
-- Migration 00084 — node_orders tenant uniqueness: partial → non-partial index
-- =============================================================================
-- Bug:
--   Migration 00083 created idx_node_orders_tenant_unique as a PARTIAL unique
--   index (WHERE scope_item_type_id IS NOT NULL). PostgREST's `on_conflict=`
--   upsert can only target a NON-partial unique index or constraint, so the
--   tenant node-order upsert in tenant-scope.actions.ts failed with:
--     42P10 "there is no unique or exclusion constraint matching the
--            ON CONFLICT specification"
--   00083's own comment says the index was meant to be "a conflict target for
--   idempotent upserts" — a partial index defeats that intent.
--
-- Fix:
--   Recreate the index WITHOUT the partial WHERE clause. Tenant orders always
--   set scope_item_type_id, so a plain UNIQUE(node_id, scope_item_type_id)
--   still enforces "one tenant order per (node, scope_item_type)". Equipment
--   orders have a NULL scope_item_type_id; NULLs are distinct in a plain unique
--   index, so this index does not constrain them — idx_node_orders_equipment_
--   unique (the separate partial index) continues to enforce one equipment
--   order per node.
--
-- Idempotent: DROP INDEX IF EXISTS + CREATE — safe to re-run.
-- =============================================================================

DROP INDEX IF EXISTS structure.idx_node_orders_tenant_unique;

CREATE UNIQUE INDEX idx_node_orders_tenant_unique
    ON structure.node_orders (node_id, scope_item_type_id);
