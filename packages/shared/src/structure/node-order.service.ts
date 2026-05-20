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
 *      Re-derivation on a scope flip (§5 — monotonic lifecycle):
 *        - No existing order   → INSERT with derived status.
 *        - Existing at required/by_tenant → UPDATE status to new derived value.
 *        - Existing at ordered/received   → SKIP — procurement progress is preserved.
 *      The caller MUST read the existing status first and call
 *      planTenantOrderReconcile() to decide the correct action.
 *      A plain merge-duplicates upsert MUST NOT be used for re-derivation because
 *      it overwrites every payload column on conflict, including status — which
 *      would regress an order already at 'ordered' or 'received' back to
 *      'required'/'by_tenant', destroying procurement progress.
 *
 *   2. Equipment orders — one per equipment node, auto-created status 'required' (§4).
 *      scope_item_type_id = null; label = equipment code.
 *      Equipment orders are always INSERTs on a brand-new node; the on_conflict
 *      guard is purely defensive for retries. merge-duplicates is safe here
 *      because it cannot clobber an existing order at ordered/received.
 *
 * These functions return plain objects (no DB calls). The caller owns the
 * persistence logic.
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

// ─────────────────────────────────────────────────────────────────────────────
// Scope-flip reconciliation (§5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of planTenantOrderReconcile — tells the caller what DB operation to run.
 *
 * - insert:        No existing order row; INSERT with `status`.
 * - update_status: Existing row is at required/by_tenant; PATCH its `status` (and
 *                  optionally refresh `label`). Dates, notes, etc. are untouched.
 * - skip:          Existing row is at ordered/received — procurement progress must
 *                  NOT be regressed. Leave the row completely unchanged.
 */
export type TenantOrderReconcilePlan =
  | { action: 'insert'; status: 'required' | 'by_tenant' }
  | { action: 'update_status'; status: 'required' | 'by_tenant' }
  | { action: 'skip' };

/**
 * Decide what DB operation is needed when a scope item's party is set or flipped.
 *
 * This is the safe alternative to an unconditional merge-duplicates upsert.
 * merge-duplicates overwrites EVERY payload column on conflict, so a status
 * column included in the upsert body would unconditionally overwrite 'ordered'
 * or 'received' with 'required'/'by_tenant' — destroying procurement progress.
 *
 * §5 defines a monotonic lifecycle: required → ordered → received.
 * ordered and received are terminal states for the purpose of scope flips.
 *
 * @param existingStatus - The current `status` value from the DB, or null if no
 *   node_order row yet exists for (node_id, scope_item_type_id).
 * @param party - The new scope party being set.
 */
export function planTenantOrderReconcile(
  existingStatus: NodeOrderStatus | null,
  party: ScopeParty,
): TenantOrderReconcilePlan {
  const newStatus = deriveTenantOrderStatus(party);
  if (existingStatus === null) {
    return { action: 'insert', status: newStatus };
  }
  if (existingStatus === 'ordered' || existingStatus === 'received') {
    return { action: 'skip' };
  }
  // existingStatus is 'required' or 'by_tenant'
  return { action: 'update_status', status: newStatus };
}

/**
 * Derive a single tenant node-order row from one scope item.
 *
 * The returned object is the INSERT payload. For re-derivation on a scope flip,
 * the caller must first call planTenantOrderReconcile() to determine the correct
 * DB action — a plain merge-duplicates upsert with this payload is NOT safe for
 * re-derivation because it overwrites status unconditionally on conflict.
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
