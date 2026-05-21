/**
 * ImportPreview — the diff shape returned by the parse route and consumed by
 * the commit route + the UI preview table.
 *
 * Design-doc §4: diff is keyed by `shop_number`.
 *
 * Pure types — no runtime dependencies.
 */

import type { Node, NodeKind } from './types';
import type { TenantImportRow, TenantImportError } from './tenant-import-parser';
import { deriveDbCode } from './derive-db-code';

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

/**
 * A new shop whose auto-derived DB `code` is already taken by another node on
 * the project — almost always a board entered via the Cable Schedule before
 * the Tenant module existed (e.g. a `main_board` coded `DB-18`).
 *
 * `structure.nodes` enforces UNIQUE(project_id, code), so a blind insert would
 * fail. The commit step SKIPS these rows; they need deliberate reconciliation
 * (the existing node converted into the tenant DB), not a duplicate insert.
 */
export interface ImportConflict {
  kind: 'conflict';
  /** The parsed row from the workbook. */
  row: TenantImportRow;
  /** The DB code the commit would otherwise have tried to create. */
  derived_code: string;
  /** The existing node already using that code. */
  conflicting_node: {
    id: string;
    kind: NodeKind;
    code: string;
    name: string | null;
  };
}

export type ImportDiffEntry =
  | ImportNew
  | ImportUpdated
  | ImportDecommissioned
  | ImportConflict;

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
  /**
   * New shops whose derived code collides with an existing node. The commit
   * step SKIPS these — they require deliberate manual reconciliation.
   */
  conflict_entries: ImportConflict[];
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

/**
 * Compute an {@link ImportPreview} from parsed rows + the current DB state.
 *
 * Pure function: no I/O, no side effects.
 *
 * @param rows - Valid rows from {@link parseTenantSchedule}.
 * @param parseErrors - Error rows from {@link parseTenantSchedule}.
 * @param allNodes - EVERY node on the project, all kinds. The `tenant_db`
 *   subset drives shop_number matching; the full set drives code-collision
 *   detection for new shops (UNIQUE(project_id, code) would otherwise reject
 *   the insert at commit time).
 */
export function diffTenantSchedule(
  rows: TenantImportRow[],
  parseErrors: TenantImportError[],
  allNodes: Node[],
): ImportPreview {
  // tenant_db nodes — matched against the file by shop_number.
  const tenantDbNodes = allNodes.filter((n) => n.kind === 'tenant_db');
  const existingByShopNumber = new Map<string, Node>();
  for (const node of tenantDbNodes) {
    if (node.shop_number) {
      existingByShopNumber.set(node.shop_number, node);
    }
  }

  // Every node's code — UNIQUE(project_id, code) means a new shop whose
  // derived code is already taken (typically by a cable-schedule board)
  // cannot be inserted.
  const nodeByCode = new Map<string, Node>();
  for (const node of allNodes) {
    if (node.code) {
      nodeByCode.set(node.code, node);
    }
  }

  // Track which shop_numbers appear in the new file
  const incomingShopNumbers = new Set<string>();

  const new_entries: ImportNew[] = [];
  const updated_entries: ImportUpdated[] = [];
  const conflict_entries: ImportConflict[] = [];

  for (const row of rows) {
    incomingShopNumbers.add(row.shop_number);
    const existing = existingByShopNumber.get(row.shop_number);

    if (existing) {
      // Existing shop — compute field-level deltas.
      const changes: ImportUpdated['changes'] = {};

      if (existing.shop_name !== row.shop_name) {
        changes.shop_name = { from: existing.shop_name, to: row.shop_name };
      }
      if (existing.shop_area_m2 !== row.shop_area_m2) {
        changes.shop_area_m2 = { from: existing.shop_area_m2, to: row.shop_area_m2 };
      }

      updated_entries.push({ kind: 'updated', row, existing, changes });
      continue;
    }

    // New shop — but only genuinely "new" if its derived code is free. A
    // collision means another node already owns that code (typically a
    // cable-schedule board); a blind insert would hit UNIQUE(project_id, code).
    const derived_code = deriveDbCode(row.shop_number);
    const colliding = nodeByCode.get(derived_code);
    if (colliding) {
      conflict_entries.push({
        kind: 'conflict',
        row,
        derived_code,
        conflicting_node: {
          id: colliding.id,
          kind: colliding.kind,
          code: colliding.code,
          name: colliding.name,
        },
      });
    } else {
      new_entries.push({ kind: 'new', row, derived_code });
    }
  }

  // Nodes in DB but not in the new file → decommissioned
  const decommissioned_entries: ImportDecommissioned[] = [];
  for (const node of tenantDbNodes) {
    if (node.shop_number && !incomingShopNumbers.has(node.shop_number)) {
      decommissioned_entries.push({ kind: 'decommissioned', existing: node });
    }
  }

  return {
    new_entries,
    updated_entries,
    conflict_entries,
    decommissioned_entries,
    parse_errors: parseErrors,
    parsed_row_count: rows.length,
  };
}
