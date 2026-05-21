-- =============================================================================
-- Migration 00089 — back-fill equipment node_orders
-- =============================================================================
-- Every equipment node (kind <> 'tenant_db') should have exactly one equipment
-- node_order (scope_item_type_id IS NULL, status 'required') so it surfaces in
-- the Material Order Tracker.
--
-- createEquipmentNodeAction creates this order for newly-added equipment, but
-- the cable-schedule boards/sources collapsed into structure.nodes by migration
-- 00077 predate the node_orders table (00083) and never received one. This
-- back-fills the gap so existing equipment is tracked for ordering.
--
-- Idempotent: the NOT EXISTS guard skips any node that already has an equipment
-- order, and the partial unique index idx_node_orders_equipment_unique would
-- reject a duplicate regardless. Decommissioned nodes are excluded. Safe to
-- re-run; a no-op on a database with no un-ordered equipment nodes.
-- =============================================================================

INSERT INTO structure.node_orders
  (node_id, project_id, organisation_id, label, scope_item_type_id, status)
SELECT
  n.id,
  n.project_id,
  n.organisation_id,
  n.code,
  NULL,
  'required'
FROM structure.nodes n
WHERE n.kind <> 'tenant_db'
  AND n.status = 'active'
  AND NOT EXISTS (
    SELECT 1
    FROM structure.node_orders o
    WHERE o.node_id = n.id
      AND o.scope_item_type_id IS NULL
  );
