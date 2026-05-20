/**
 * Tests for node-order.service.ts — derivation logic for structure.node_orders.
 * Design spec: §3 (tenant orders), §4 (equipment orders), §5 (status lifecycle).
 */

import { describe, it, expect } from 'vitest';
import {
  deriveTenantOrderStatus,
  deriveTenantNodeOrder,
  deriveTenantNodeOrders,
  deriveEquipmentNodeOrder,
} from './node-order.service';
import type { TenantScopeItem } from './node-order.service';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const NODE_ID = 'aaaa0000-0000-0000-0000-000000000001';
const PROJECT_ID = 'bbbb0000-0000-0000-0000-000000000001';
const ORG_ID = 'cccc0000-0000-0000-0000-000000000001';
const SCOPE_TYPE_DB = 'dddd0000-0000-0000-0000-000000000001';
const SCOPE_TYPE_LIGHTING = 'eeee0000-0000-0000-0000-000000000002';

const dbItem: TenantScopeItem = {
  scopeItemTypeId: SCOPE_TYPE_DB,
  label: 'DB',
  party: 'landlord',
};

const lightingItem: TenantScopeItem = {
  scopeItemTypeId: SCOPE_TYPE_LIGHTING,
  label: 'Lighting',
  party: 'tenant',
};

// ─────────────────────────────────────────────────────────────────────────────
// deriveTenantOrderStatus — §3
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveTenantOrderStatus', () => {
  it('landlord → required', () => {
    expect(deriveTenantOrderStatus('landlord')).toBe('required');
  });

  it('tenant → by_tenant', () => {
    expect(deriveTenantOrderStatus('tenant')).toBe('by_tenant');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deriveTenantNodeOrder — single scope item
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveTenantNodeOrder', () => {
  it('landlord scope item produces required order with correct fields', () => {
    const order = deriveTenantNodeOrder(NODE_ID, PROJECT_ID, ORG_ID, dbItem);
    expect(order).toEqual({
      node_id: NODE_ID,
      project_id: PROJECT_ID,
      organisation_id: ORG_ID,
      label: 'DB',
      scope_item_type_id: SCOPE_TYPE_DB,
      status: 'required',
    });
  });

  it('tenant scope item produces by_tenant order', () => {
    const order = deriveTenantNodeOrder(NODE_ID, PROJECT_ID, ORG_ID, lightingItem);
    expect(order).toMatchObject({
      label: 'Lighting',
      scope_item_type_id: SCOPE_TYPE_LIGHTING,
      status: 'by_tenant',
    });
  });

  it('scope_item_type_id is NOT null for tenant orders (distinguishes from equipment)', () => {
    const order = deriveTenantNodeOrder(NODE_ID, PROJECT_ID, ORG_ID, dbItem);
    expect(order.scope_item_type_id).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deriveTenantNodeOrders — multiple scope items (§3: one order per scope item)
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveTenantNodeOrders', () => {
  it('returns one order per scope item', () => {
    const orders = deriveTenantNodeOrders(NODE_ID, PROJECT_ID, ORG_ID, [dbItem, lightingItem]);
    expect(orders).toHaveLength(2);
  });

  it('empty scope items → empty orders', () => {
    const orders = deriveTenantNodeOrders(NODE_ID, PROJECT_ID, ORG_ID, []);
    expect(orders).toHaveLength(0);
  });

  it('each order carries the correct scope_item_type_id', () => {
    const orders = deriveTenantNodeOrders(NODE_ID, PROJECT_ID, ORG_ID, [dbItem, lightingItem]);
    const ids = orders.map((o) => o.scope_item_type_id);
    expect(ids).toContain(SCOPE_TYPE_DB);
    expect(ids).toContain(SCOPE_TYPE_LIGHTING);
  });

  it('each order carries the correct status (landlord=required, tenant=by_tenant)', () => {
    const orders = deriveTenantNodeOrders(NODE_ID, PROJECT_ID, ORG_ID, [dbItem, lightingItem]);
    const byId = Object.fromEntries(orders.map((o) => [o.scope_item_type_id, o.status]));
    expect(byId[SCOPE_TYPE_DB]).toBe('required');
    expect(byId[SCOPE_TYPE_LIGHTING]).toBe('by_tenant');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Re-derivation / scope flip — §3, §5
// ─────────────────────────────────────────────────────────────────────────────

describe('scope flip re-derivation', () => {
  it('Landlord→Tenant flip produces by_tenant', () => {
    const before = deriveTenantNodeOrder(NODE_ID, PROJECT_ID, ORG_ID, {
      ...dbItem,
      party: 'landlord',
    });
    const after = deriveTenantNodeOrder(NODE_ID, PROJECT_ID, ORG_ID, {
      ...dbItem,
      party: 'tenant',
    });
    expect(before.status).toBe('required');
    expect(after.status).toBe('by_tenant');
    // Same conflict key — idempotent upsert target
    expect(before.node_id).toBe(after.node_id);
    expect(before.scope_item_type_id).toBe(after.scope_item_type_id);
  });

  it('Tenant→Landlord flip produces required', () => {
    const order = deriveTenantNodeOrder(NODE_ID, PROJECT_ID, ORG_ID, {
      ...lightingItem,
      party: 'landlord',
    });
    expect(order.status).toBe('required');
  });

  it('idempotency: deriving twice with same party yields identical output', () => {
    const a = deriveTenantNodeOrder(NODE_ID, PROJECT_ID, ORG_ID, dbItem);
    const b = deriveTenantNodeOrder(NODE_ID, PROJECT_ID, ORG_ID, dbItem);
    expect(a).toEqual(b);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deriveEquipmentNodeOrder — §4
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveEquipmentNodeOrder', () => {
  it('produces status required', () => {
    const order = deriveEquipmentNodeOrder(NODE_ID, PROJECT_ID, ORG_ID, 'MB-01');
    expect(order.status).toBe('required');
  });

  it('label equals equipment code', () => {
    const order = deriveEquipmentNodeOrder(NODE_ID, PROJECT_ID, ORG_ID, 'GEN-2');
    expect(order.label).toBe('GEN-2');
  });

  it('scope_item_type_id is null (equipment = no scope item)', () => {
    const order = deriveEquipmentNodeOrder(NODE_ID, PROJECT_ID, ORG_ID, 'RMU-1');
    expect(order.scope_item_type_id).toBeNull();
  });

  it('carries correct node_id / project_id / org_id', () => {
    const order = deriveEquipmentNodeOrder(NODE_ID, PROJECT_ID, ORG_ID, 'MS-3');
    expect(order.node_id).toBe(NODE_ID);
    expect(order.project_id).toBe(PROJECT_ID);
    expect(order.organisation_id).toBe(ORG_ID);
  });

  it('idempotency: deriving twice yields identical output', () => {
    const a = deriveEquipmentNodeOrder(NODE_ID, PROJECT_ID, ORG_ID, 'CB-1');
    const b = deriveEquipmentNodeOrder(NODE_ID, PROJECT_ID, ORG_ID, 'CB-1');
    expect(a).toEqual(b);
  });
});
