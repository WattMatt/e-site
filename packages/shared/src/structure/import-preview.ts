/**
 * ImportPreview — the diff shape returned by the parse route and consumed by
 * the commit route + the UI preview table.
 *
 * Design-doc §4: diff is keyed by `shop_number`.
 *
 * Pure types — no runtime dependencies.
 */

import type { Node } from './types';
import type { TenantImportRow, TenantImportError } from './tenant-import-parser';

// ---------------------------------------------------------------------------
// Per-row diff entries
// ---------------------------------------------------------------------------

/** A shop_number that is new in the Excel file (no matching DB node). */
export interface ImportNew {
  kind: 'new';
  /** The parsed row from the workbook. */
  row: TenantImportRow;
  /** The DB code that would be created by the commit step. */
  derived_code: string;
}

/** A shop_number that already exists in the DB; name/area may have changed. */
export interface ImportUpdated {
  kind: 'updated';
  /** The parsed row from the workbook. */
  row: TenantImportRow;
  /** Existing DB node being updated. */
  existing: Node;
  /** Which fields will change — populated so the UI can highlight deltas. */
  changes: {
    shop_name?: { from: string | null; to: string | null };
    shop_area_m2?: { from: number | null; to: number };
  };
}

/**
 * A `tenant_db` node in the DB whose `shop_number` is absent from the new
 * Excel file.  The commit step sets its status → 'decommissioned'.
 */
export interface ImportDecommissioned {
  kind: 'decommissioned';
  /** The existing DB node that will be decommissioned. */
  existing: Node;
}

export type ImportDiffEntry = ImportNew | ImportUpdated | ImportDecommissioned;

// ---------------------------------------------------------------------------
// Top-level preview shape
// ---------------------------------------------------------------------------

/**
 * The full import preview returned by `POST /api/tenant-schedule/parse`.
 * The UI renders this before the user confirms the commit.
 */
export interface ImportPreview {
  /** Rows that will be INSERTed as new `tenant_db` nodes. */
  new_entries: ImportNew[];
  /** Rows that will UPDATE an existing node's shop_name / shop_area_m2. */
  updated_entries: ImportUpdated[];
  /** Existing nodes whose shop_number is absent from the file; will be decommissioned. */
  decommissioned_entries: ImportDecommissioned[];
  /**
   * Parse errors from the workbook (bad rows, duplicates, missing columns).
   * The UI should surface these so the user can fix the file before committing.
   */
  parse_errors: TenantImportError[];
  /** Total valid rows successfully parsed from the workbook. */
  parsed_row_count: number;
}

// ---------------------------------------------------------------------------
// Pure diff function — extract here so the route + commit step + tests can share
// ---------------------------------------------------------------------------

import { deriveDbCode } from './derive-db-code';

/**
 * Compute an {@link ImportPreview} from parsed rows + the current DB state.
 *
 * Pure function: no I/O, no side effects.
 *
 * @param rows - Valid rows from {@link parseTenantSchedule}.
 * @param parseErrors - Error rows from {@link parseTenantSchedule}.
 * @param existingNodes - All `tenant_db` nodes currently in the DB for the project.
 */
export function diffTenantSchedule(
  rows: TenantImportRow[],
  parseErrors: TenantImportError[],
  existingNodes: Node[],
): ImportPreview {
  // Build a lookup: shop_number → existing Node (only tenant_db nodes)
  const existingByShopNumber = new Map<string, Node>();
  for (const node of existingNodes) {
    if (node.shop_number) {
      existingByShopNumber.set(node.shop_number, node);
    }
  }

  // Track which shop_numbers appear in the new file
  const incomingShopNumbers = new Set<string>();

  const new_entries: ImportNew[] = [];
  const updated_entries: ImportUpdated[] = [];

  for (const row of rows) {
    incomingShopNumbers.add(row.shop_number);
    const existing = existingByShopNumber.get(row.shop_number);

    if (!existing) {
      // New shop — will be inserted
      new_entries.push({
        kind: 'new',
        row,
        derived_code: deriveDbCode(row.shop_number),
      });
    } else {
      // Existing shop — compute field-level deltas
      const changes: ImportUpdated['changes'] = {};

      if (existing.shop_name !== row.shop_name) {
        changes.shop_name = { from: existing.shop_name, to: row.shop_name };
      }
      if (existing.shop_area_m2 !== row.shop_area_m2) {
        changes.shop_area_m2 = { from: existing.shop_area_m2, to: row.shop_area_m2 };
      }

      updated_entries.push({ kind: 'updated', row, existing, changes });
    }
  }

  // Nodes in DB but not in the new file → decommissioned
  const decommissioned_entries: ImportDecommissioned[] = [];
  for (const node of existingNodes) {
    if (node.shop_number && !incomingShopNumbers.has(node.shop_number)) {
      decommissioned_entries.push({ kind: 'decommissioned', existing: node });
    }
  }

  return {
    new_entries,
    updated_entries,
    decommissioned_entries,
    parse_errors: parseErrors,
    parsed_row_count: rows.length,
  };
}
