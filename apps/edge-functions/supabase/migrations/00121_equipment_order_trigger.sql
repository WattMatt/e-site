-- =============================================================================
-- Migration 00121 — equipment node_order auto-create trigger (spec D9)
-- =============================================================================
-- Every equipment node (kind <> 'tenant_db'/'sub_board') must have exactly one
-- equipment node_order (scope_item_type_id IS NULL, status 'required') so it
-- always surfaces in the Material Order Tracker. createEquipmentNodeAction
-- created this for UI-added equipment, but nodes added by any OTHER path (bulk
-- import, manual SQL) skipped it — which is how 6 Kings Walk common-area boards
-- ended up absent from Materials despite the one-time backfill 00089.
--
-- This trigger enforces the invariant at the source: an equipment order is
-- created in the same statement as the node, on every insert path. Idempotent —
-- the partial unique index idx_node_orders_equipment_unique plus the NOT EXISTS
-- guard make a duplicate impossible and re-runs a no-op.
-- =============================================================================

-- SECURITY DEFINER is deliberate: the equipment order must be created no matter
-- who inserts the node. The UI path uses the service-role key today, but the
-- invariant must also hold for future bulk-import / lower-privilege insert paths
-- WITHOUT the node insert failing because the caller lacks INSERT on node_orders.
-- The function only inserts the one order derived from the node just inserted
-- (same project/org/code) — it cannot write arbitrary rows, so there is no
-- escalation surface. All identifiers below are schema-qualified, so search_path
-- is locked to '' (matches the 00120 SECURITY DEFINER convention).
CREATE OR REPLACE FUNCTION structure.create_equipment_node_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Equipment kinds = the EQUIPMENT_KINDS set in @esite/shared
  -- (everything except 'tenant_db' and 'sub_board').
  -- No status guard (unlike the 00089 backfill): the order is created regardless
  -- of node status, so a board inserted-then-reactivated never lacks one. The
  -- Materials/Equipment views filter decommissioned boards at the display layer.
  IF NEW.kind IN (
    'rmu', 'mini_sub', 'generator', 'main_board',
    'common_area_board', 'common_area_lighting', 'custom'
  ) THEN
    INSERT INTO structure.node_orders
      (node_id, project_id, organisation_id, label, scope_item_type_id, status)
    SELECT NEW.id, NEW.project_id, NEW.organisation_id, NEW.code, NULL, 'required'
    WHERE NOT EXISTS (
      SELECT 1 FROM structure.node_orders o
      WHERE o.node_id = NEW.id AND o.scope_item_type_id IS NULL
    );
  END IF;
  RETURN NEW;
END;
$$;

-- SECURITY DEFINER functions must not be PUBLIC-executable (project convention).
REVOKE EXECUTE ON FUNCTION structure.create_equipment_node_order() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_create_equipment_node_order ON structure.nodes;
CREATE TRIGGER trg_create_equipment_node_order
  AFTER INSERT ON structure.nodes
  FOR EACH ROW
  EXECUTE FUNCTION structure.create_equipment_node_order();

NOTIFY pgrst, 'reload schema';
