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
});
