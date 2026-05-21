import { describe, it, expect } from 'vitest';
import { diffTenantSchedule } from './import-preview';
import type { TenantImportRow, TenantImportError } from './tenant-import-parser';
import type { Node } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(shop_number: string, shop_name: string | null, shop_area_m2: number): TenantImportRow {
  return { source_row: 2, shop_number, shop_name, shop_area_m2 };
}

function makeNode(overrides: Partial<Node> & { shop_number: string }): Node {
  return {
    id: 'node-' + overrides.shop_number,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    project_id: 'proj-1',
    organisation_id: 'org-1',
    kind: 'tenant_db',
    code: 'DB-' + overrides.shop_number,
    name: null,
    coc_required: false,
    status: 'active',
    shop_name: null,
    shop_area_m2: null,
    breaker_rating_a: null,
    pole_config: null,
    section: null,
    rating_kva: null,
    voltage_v: null,
    notes: null,
    created_by: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('diffTenantSchedule', () => {
  it('classifies a new shop_number as new', () => {
    const rows: TenantImportRow[] = [makeRow('SHOP 1', 'Pick n Pay', 120)];
    const existing: Node[] = [];
    const preview = diffTenantSchedule(rows, [], existing);

    expect(preview.new_entries).toHaveLength(1);
    expect(preview.new_entries[0].kind).toBe('new');
    expect(preview.new_entries[0].row.shop_number).toBe('SHOP 1');
    expect(preview.new_entries[0].derived_code).toBe('DB-1');
    expect(preview.updated_entries).toHaveLength(0);
    expect(preview.decommissioned_entries).toHaveLength(0);
  });

  it('classifies a matched shop_number with changed fields as updated', () => {
    const rows: TenantImportRow[] = [makeRow('SHOP 2', 'Woolworths', 200)];
    const existing: Node[] = [
      makeNode({ shop_number: 'SHOP 2', shop_name: 'Old Name', shop_area_m2: 180 }),
    ];
    const preview = diffTenantSchedule(rows, [], existing);

    expect(preview.updated_entries).toHaveLength(1);
    const entry = preview.updated_entries[0];
    expect(entry.kind).toBe('updated');
    expect(entry.changes.shop_name).toEqual({ from: 'Old Name', to: 'Woolworths' });
    expect(entry.changes.shop_area_m2).toEqual({ from: 180, to: 200 });
    expect(preview.new_entries).toHaveLength(0);
    expect(preview.decommissioned_entries).toHaveLength(0);
  });

  it('produces an updated entry with empty changes when nothing changed', () => {
    const rows: TenantImportRow[] = [makeRow('SHOP 3', 'Clicks', 95)];
    const existing: Node[] = [
      makeNode({ shop_number: 'SHOP 3', shop_name: 'Clicks', shop_area_m2: 95 }),
    ];
    const preview = diffTenantSchedule(rows, [], existing);

    expect(preview.updated_entries).toHaveLength(1);
    expect(preview.updated_entries[0].changes).toEqual({});
    expect(preview.new_entries).toHaveLength(0);
    expect(preview.decommissioned_entries).toHaveLength(0);
  });

  it('classifies a DB node absent from the file as decommissioned', () => {
    const rows: TenantImportRow[] = [makeRow('SHOP 4', 'Game', 300)];
    const existing: Node[] = [
      makeNode({ shop_number: 'SHOP 4', shop_name: 'Game', shop_area_m2: 300 }),
      makeNode({ shop_number: 'SHOP 5', shop_name: 'Mr Price', shop_area_m2: 80 }),
    ];
    const preview = diffTenantSchedule(rows, [], existing);

    expect(preview.decommissioned_entries).toHaveLength(1);
    expect(preview.decommissioned_entries[0].existing.shop_number).toBe('SHOP 5');
    expect(preview.decommissioned_entries[0].kind).toBe('decommissioned');
  });

  it('passes parse_errors and parsed_row_count through', () => {
    const errors: TenantImportError[] = [
      { source_row: 3, message: 'Row 3: SHOP NO. is required.' },
    ];
    const rows: TenantImportRow[] = [makeRow('SHOP 6', null, 50)];
    const preview = diffTenantSchedule(rows, errors, []);

    expect(preview.parse_errors).toEqual(errors);
    expect(preview.parsed_row_count).toBe(1);
  });

  it('handles a mix of new / updated / decommissioned in one call', () => {
    const rows: TenantImportRow[] = [
      makeRow('SHOP 1', 'A', 100),       // new
      makeRow('SHOP 2', 'B-new', 200),   // updated (name changed)
    ];
    const existing: Node[] = [
      makeNode({ shop_number: 'SHOP 2', shop_name: 'B-old', shop_area_m2: 200 }),
      makeNode({ shop_number: 'SHOP 3', shop_name: 'C', shop_area_m2: 50 }), // decommissioned
    ];
    const preview = diffTenantSchedule(rows, [], existing);

    expect(preview.new_entries).toHaveLength(1);
    expect(preview.updated_entries).toHaveLength(1);
    expect(preview.decommissioned_entries).toHaveLength(1);
    expect(preview.decommissioned_entries[0].existing.shop_number).toBe('SHOP 3');
  });

  it('ignores non-tenant_db nodes with null shop_number during decommission check', () => {
    // A main_board node has no shop_number — must not appear in decommissioned
    const rows: TenantImportRow[] = [];
    const existing: Node[] = [
      makeNode({ shop_number: null as any, kind: 'main_board' }),
    ];
    const preview = diffTenantSchedule(rows, [], existing);
    expect(preview.decommissioned_entries).toHaveLength(0);
  });

  it('last-one-wins when two existing nodes share the same shop_number (Map.set behaviour)', () => {
    // Data anomaly: two tenant_db rows in the DB with the same shop_number.
    // existingByShopNumber is built with Map.set, so the second node replaces
    // the first.  The first node silently drops out of the diff.
    // This test documents the CURRENT behaviour so it is not a silent surprise.
    const nodeA = makeNode({ shop_number: 'SHOP 9', id: 'node-A', shop_name: 'First', shop_area_m2: 100 });
    const nodeB = makeNode({ shop_number: 'SHOP 9', id: 'node-B', shop_name: 'Second', shop_area_m2: 200 });
    const rows: TenantImportRow[] = [makeRow('SHOP 9', 'Second', 200)];

    const preview = diffTenantSchedule(rows, [], [nodeA, nodeB]);

    // nodeB wins (last set), incoming matches nodeB exactly → no field changes
    expect(preview.updated_entries).toHaveLength(1);
    expect(preview.updated_entries[0].existing.id).toBe('node-B');
    expect(preview.updated_entries[0].changes).toEqual({});
    // nodeA is not reachable from the map, so it does NOT appear as decommissioned
    expect(preview.decommissioned_entries).toHaveLength(0);
    expect(preview.new_entries).toHaveLength(0);
  });

  it('detects shop_area_m2 change from null to a value, but not 0 vs 0', () => {
    // null → number: change detected
    const rowWithArea = makeRow('SHOP 10', 'Edgars', 0);
    const nodeNull = makeNode({ shop_number: 'SHOP 10', shop_area_m2: null });
    const previewNull = diffTenantSchedule([rowWithArea], [], [nodeNull]);
    expect(previewNull.updated_entries).toHaveLength(1);
    expect(previewNull.updated_entries[0].changes.shop_area_m2).toEqual({ from: null, to: 0 });

    // 0 → 0: no change
    const nodeZero = makeNode({ shop_number: 'SHOP 10', shop_area_m2: 0 });
    const previewZero = diffTenantSchedule([rowWithArea], [], [nodeZero]);
    expect(previewZero.updated_entries).toHaveLength(1);
    expect(previewZero.updated_entries[0].changes.shop_area_m2).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Code-collision detection (new shop vs an existing cable-schedule board)
// ---------------------------------------------------------------------------

describe('diffTenantSchedule — code conflicts', () => {
  it('flags a new shop whose derived code is taken by another node as a conflict', () => {
    // A cable-schedule board already occupies code DB-18.
    const existing: Node[] = [
      makeNode({ shop_number: null as any, kind: 'main_board', code: 'DB-18', id: 'board-18' }),
    ];
    const rows: TenantImportRow[] = [makeRow('18', 'SHOPRITE', 2720.3)];
    const preview = diffTenantSchedule(rows, [], existing);

    expect(preview.new_entries).toHaveLength(0);
    expect(preview.conflict_entries).toHaveLength(1);
    const c = preview.conflict_entries[0];
    expect(c.kind).toBe('conflict');
    expect(c.row.shop_number).toBe('18');
    expect(c.derived_code).toBe('DB-18');
    expect(c.conflicting_node.id).toBe('board-18');
    expect(c.conflicting_node.kind).toBe('main_board');
    expect(c.conflicting_node.code).toBe('DB-18');
  });

  it('keeps a new shop with a free derived code as new', () => {
    const existing: Node[] = [
      makeNode({ shop_number: null as any, kind: 'main_board', code: 'DB-18' }),
    ];
    const rows: TenantImportRow[] = [makeRow('19', 'TRUWORTHS', 920)];
    const preview = diffTenantSchedule(rows, [], existing);

    expect(preview.conflict_entries).toHaveLength(0);
    expect(preview.new_entries).toHaveLength(1);
    expect(preview.new_entries[0].derived_code).toBe('DB-19');
  });

  it('a shop matched by shop_number is updated, never a conflict (re-import safe)', () => {
    // shop 18 is already a tenant_db node (post-reconciliation); re-import updates it.
    const existing: Node[] = [
      makeNode({ shop_number: '18', kind: 'tenant_db', code: 'DB-18', shop_name: 'SHOPRITE', shop_area_m2: 2720.3 }),
    ];
    const rows: TenantImportRow[] = [makeRow('18', 'SHOPRITE', 2720.3)];
    const preview = diffTenantSchedule(rows, [], existing);

    expect(preview.conflict_entries).toHaveLength(0);
    expect(preview.updated_entries).toHaveLength(1);
  });

  it('mixes new / conflict / updated correctly in one call', () => {
    const existing: Node[] = [
      makeNode({ shop_number: null as any, kind: 'main_board', code: 'DB-18' }), // board → conflicts with shop 18
      makeNode({ shop_number: '5', kind: 'tenant_db', code: 'DB-5', shop_name: 'BOXER', shop_area_m2: 1800 }),
    ];
    const rows: TenantImportRow[] = [
      makeRow('18', 'SHOPRITE', 2720), // conflict
      makeRow('5', 'BOXER', 1809),     // updated (area changed)
      makeRow('99', 'NEW SHOP', 100),  // new
    ];
    const preview = diffTenantSchedule(rows, [], existing);

    expect(preview.conflict_entries).toHaveLength(1);
    expect(preview.conflict_entries[0].row.shop_number).toBe('18');
    expect(preview.updated_entries).toHaveLength(1);
    expect(preview.updated_entries[0].row.shop_number).toBe('5');
    expect(preview.new_entries).toHaveLength(1);
    expect(preview.new_entries[0].row.shop_number).toBe('99');
  });
});
