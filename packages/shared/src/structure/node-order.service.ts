/**
 * node-order.service.ts — pure derivation logic for structure.node_orders rows.
 *
 * Design spec: SPEC DOCS/2026-05-20-materials-integration-design.md §3 §4 §5.
 *
 * Two derivation paths:
 *
 *   1. Tenant orders — one per scope item (§3).
 *      Scope party = landlord → status 'required'
 *      Scope party = tenant   → status 'by_tenant'
 *      Re-derivation on a scope flip: ONLY status is updated; ordered_at /
 *      received_at / notes are preserved (safe default — the design doc says
 *      "flips its order between required and by_tenant" but does not say to
 *      destroy existing procurement progress data).
 *
 *   2. Equipment orders — one per equipment node, auto-created status 'required' (§4).
 *      scope_item_type_id = null; label = equipment code.
 *
 * These functions return plain objects (no DB calls). The caller owns the
 * upsert — use the partial unique indexes as ON CONFLICT targets:
 *   Tenant:    (node_id, scope_item_type_id) WHERE scope_item_type_id IS NOT NULL
 *   Equipment: (node_id)                     WHERE scope_item_type_id IS NULL
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** The two scope parties defined in the tenant schedule. */
export type ScopeParty = 'landlord' | 'tenant';

/** Node order statuses. */
export type NodeOrderStatus = 'required' | 'by_tenant' | 'ordered' | 'received';

/**
 * Everything needed to derive one tenant node-order row.
 * The caller supplies the scope item that drives this line.
 */
export interface TenantScopeItem {
  /** FK to structure.scope_item_types.id */
  scopeItemTypeId: string;
  /** Display label (e.g. "DB", "Lighting") — becomes node_order.label */
  label: string;
  /** Which party owns provisioning */
  party: ScopeParty;
}

/**
 * The scalar payload the derivation functions compute.
 * Matches the INSERT / ON CONFLICT DO UPDATE columns.
 */
export interface DerivedNodeOrder {
  node_id: string;
  project_id: string;
  organisation_id: string;
  label: string;
  /** null for equipment orders; set for tenant orders */
  scope_item_type_id: string | null;
  /** Only status is derived — dates and notes are left to DO UPDATE exclusion */
  status: NodeOrderStatus;
}

// ─────────────────────────────────────────────────────────────────────────────
// Derivation functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derive the correct status for a tenant scope item party.
 * Pure function — no side effects.
 *
 * §3: Landlord → 'required'; Tenant → 'by_tenant'.
 */
export function deriveTenantOrderStatus(party: ScopeParty): 'required' | 'by_tenant' {
  return party === 'landlord' ? 'required' : 'by_tenant';
}

/**
 * Derive a single tenant node-order row from one scope item.
 *
 * The returned object is the upsert payload. The caller should POST to
 * `node_orders?on_conflict=node_id,scope_item_type_id` with
 * `Prefer: resolution=merge-duplicates` and
 * `DO UPDATE SET status = EXCLUDED.status` (only status flips; dates preserved).
 */
export function deriveTenantNodeOrder(
  nodeId: string,
  projectId: string,
  organisationId: string,
  scopeItem: TenantScopeItem,
): DerivedNodeOrder {
  return {
    node_id: nodeId,
    project_id: projectId,
    organisation_id: organisationId,
    label: scopeItem.label,
    scope_item_type_id: scopeItem.scopeItemTypeId,
    status: deriveTenantOrderStatus(scopeItem.party),
  };
}

/**
 * Derive node-order rows for all scope items of a tenant node.
 * Returns one DerivedNodeOrder per scope item (§3: one order per scope item).
 */
export function deriveTenantNodeOrders(
  nodeId: string,
  projectId: string,
  organisationId: string,
  scopeItems: TenantScopeItem[],
): DerivedNodeOrder[] {
  return scopeItems.map((item) =>
    deriveTenantNodeOrder(nodeId, projectId, organisationId, item),
  );
}

/**
 * Derive the equipment node-order row for an equipment node (§4).
 * scope_item_type_id is null; status is always 'required'.
 * label = equipment code.
 */
export function deriveEquipmentNodeOrder(
  nodeId: string,
  projectId: string,
  organisationId: string,
  equipmentCode: string,
): DerivedNodeOrder {
  return {
    node_id: nodeId,
    project_id: projectId,
    organisation_id: organisationId,
    label: equipmentCode,
    scope_item_type_id: null,
    status: 'required',
  };
}
