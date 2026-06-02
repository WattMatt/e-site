import { describe, it, expect } from 'vitest';
import type { Node, NodeKind } from './types';
import {
  resolveOwningLease,
  buildAnchorGroups,
  computeNodeOrderRequiredBy,
  type LeaseBoInputs,
} from './owning-lease';

/** Build a full Node from id + kind, overriding only what a test cares about. */
function mkNode(id: string, kind: NodeKind, over: Partial<Node> = {}): Node {
  return {
    id,
    kind,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    project_id: 'p1',
    organisation_id: 'o1',
    custom_kind_label: null,
    code: id,
    name: null,
    coc_required: false,
    status: 'active',
    shop_number: null,
    shop_name: null,
    shop_area_m2: null,
    breaker_rating_a: null,
    pole_config: null,
    section: null,
    rating_kva: null,
    voltage_v: null,
    notes: null,
    decommission_reason: null,
    created_by: null,
    parent_node_id: null,
    ...over,
  };
}

/** Shoprite scenario: anchor → departments (one nested), a concession with its own
 *  board, a common-area subtree, and a standalone generator. */
function scenario() {
  const anchor = mkNode('anchor', 'tenant_db');
  const butchery = mkNode('butchery', 'sub_board', { parent_node_id: 'anchor' });
  const coldroom = mkNode('coldroom', 'sub_board', { parent_node_id: 'butchery' });
  const kiosk = mkNode('kiosk', 'tenant_db', { parent_node_id: 'anchor' });
  const kioskDb = mkNode('kioskDb', 'sub_board', { parent_node_id: 'kiosk' });
  const caBoard = mkNode('caBoard', 'common_area_board');
  const caSub = mkNode('caSub', 'sub_board', { parent_node_id: 'caBoard' });
  const gen = mkNode('gen', 'generator');
  const nodes = [anchor, butchery, coldroom, kiosk, kioskDb, caBoard, caSub, gen];
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  return { anchor, butchery, coldroom, kiosk, kioskDb, caBoard, caSub, gen, nodes, byId };
}

describe('resolveOwningLease', () => {
  it('a tenant_db is its own owning lease', () => {
    const s = scenario();
    expect(resolveOwningLease(s.anchor, s.byId)?.id).toBe('anchor');
  });

  it('a direct sub_board resolves to its anchor tenant_db', () => {
    const s = scenario();
    expect(resolveOwningLease(s.butchery, s.byId)?.id).toBe('anchor');
  });

  it('a nested sub_board resolves to the nearest tenant_db ancestor (the anchor)', () => {
    const s = scenario();
    expect(resolveOwningLease(s.coldroom, s.byId)?.id).toBe('anchor');
  });

  it('a concession (tenant_db under an anchor) is its own lease, not the anchor', () => {
    const s = scenario();
    expect(resolveOwningLease(s.kiosk, s.byId)?.id).toBe('kiosk');
  });

  it("a board under a concession resolves to the concession, NOT the anchor (lease boundary)", () => {
    const s = scenario();
    expect(resolveOwningLease(s.kioskDb, s.byId)?.id).toBe('kiosk');
  });

  it('a common-area sub_board has no owning lease (no tenant_db ancestor)', () => {
    const s = scenario();
    expect(resolveOwningLease(s.caSub, s.byId)).toBeNull();
  });

  it('a standalone equipment node has no owning lease', () => {
    const s = scenario();
    expect(resolveOwningLease(s.gen, s.byId)).toBeNull();
  });

  it('a dangling parent_node_id terminates the walk and yields null (no throw)', () => {
    const orphan = mkNode('orphan', 'sub_board', { parent_node_id: 'missing' });
    const byId = new Map([[orphan.id, orphan] as const]);
    expect(resolveOwningLease(orphan, byId)).toBeNull();
  });

  it('a malformed cyclic chain terminates instead of hanging', () => {
    // a → b → a (the DB forbids this; the helper must still not loop forever)
    const a = mkNode('a', 'sub_board', { parent_node_id: 'b' });
    const b = mkNode('b', 'sub_board', { parent_node_id: 'a' });
    const byId = new Map([[a.id, a], [b.id, b]] as const);
    expect(resolveOwningLease(a, byId)).toBeNull();
  });
});

describe('buildAnchorGroups', () => {
  it('groups each lease with its descendants and keeps concessions separate', () => {
    const s = scenario();
    const { groups, ungrouped } = buildAnchorGroups(s.nodes);

    const anchorGroup = groups.find((g) => g.lease.id === 'anchor')!;
    const kioskGroup = groups.find((g) => g.lease.id === 'kiosk')!;

    // Anchor group = the anchor + its two departments (NOT the concession's board).
    expect(anchorGroup.members.map((n) => n.id).sort()).toEqual(
      ['anchor', 'butchery', 'coldroom'].sort(),
    );
    // Concession group = the concession + its own board only (lease boundary).
    expect(kioskGroup.members.map((n) => n.id).sort()).toEqual(
      ['kiosk', 'kioskDb'].sort(),
    );
    // Common-area + equipment have no owning lease.
    expect(ungrouped.map((n) => n.id).sort()).toEqual(['caBoard', 'caSub', 'gen'].sort());
  });

  it('produces exactly one group per tenant_db', () => {
    const s = scenario();
    const { groups } = buildAnchorGroups(s.nodes);
    expect(groups.map((g) => g.lease.id).sort()).toEqual(['anchor', 'kiosk'].sort());
  });

  it('an empty anchor (no children) still appears, with itself as the only member', () => {
    const lone = mkNode('lone', 'tenant_db');
    const { groups, ungrouped } = buildAnchorGroups([lone]);
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((n) => n.id)).toEqual(['lone']);
    expect(ungrouped).toEqual([]);
  });
});

describe('computeNodeOrderRequiredBy', () => {
  /** Build a boInputsFor lookup from a plain id → inputs map. */
  const lookup = (m: Record<string, LeaseBoInputs>) => (id: string) => m[id] ?? null;

  it("a sub_board inherits its owning lease's BO override", () => {
    const s = scenario();
    const got = computeNodeOrderRequiredBy(
      s.butchery,
      s.byId,
      '2026-12-01',
      lookup({ anchor: { boPeriodDays: null, boDateOverride: '2026-05-15' } }),
    );
    expect(got).toBe('2026-05-15');
  });

  it("a nested sub_board inherits the anchor's BO period (opening - periodDays)", () => {
    const s = scenario();
    const got = computeNodeOrderRequiredBy(
      s.coldroom,
      s.byId,
      '2026-03-01',
      lookup({ anchor: { boPeriodDays: 30, boDateOverride: null } }),
    );
    expect(got).toBe('2026-01-30');
  });

  it('a node with no owning lease falls back to the project opening date', () => {
    const s = scenario();
    const got = computeNodeOrderRequiredBy(s.gen, s.byId, '2026-12-01', lookup({}));
    expect(got).toBe('2026-12-01');
  });

  it('a lease with no BO inputs falls back to the project opening date', () => {
    const s = scenario();
    // node is the anchor itself; its lease is itself, but no BO inputs are known.
    const got = computeNodeOrderRequiredBy(s.anchor, s.byId, '2026-12-01', lookup({}));
    expect(got).toBe('2026-12-01');
  });
});
