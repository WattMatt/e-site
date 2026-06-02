/**
 * category-map.ts — pure handover-routing logic for material-order shop
 * drawings. No DB, no I/O. Decides which of the 13 handover categories an
 * approved drawing files into, from the order's item type plus optional
 * per-type / per-node overrides.
 */

import { ALL_CATEGORIES, type HandoverCategory } from './folder-templates'

/** Built-in equipment node `kind` → handover category. */
const EQUIPMENT_KIND_CATEGORY: Record<string, HandoverCategory> = {
  main_board: 'main_boards',
  common_area_board: 'main_boards',
  tenant_db: 'main_boards',
  rmu: 'switchgear',
  mini_sub: 'transformers',
  generator: 'generators',
}

/** Built-in scope-item-type key → handover category. */
const SCOPE_KEY_CATEGORY: Record<string, HandoverCategory> = {
  db: 'main_boards',
  lighting: 'lighting',
}

const VALID_CATEGORIES = new Set<string>(ALL_CATEGORIES)

function asCategory(value: string | null | undefined): HandoverCategory | null {
  return value && VALID_CATEGORIES.has(value) ? (value as HandoverCategory) : null
}

export interface CategoryResolutionInput {
  /** Scope-item-type key — present when the order is a tenant scope order. */
  scopeKey?: string | null
  /** structure.scope_item_types.handover_category — per-type override. */
  scopeTypeOverride?: string | null
  /** Equipment node kind — present when the order is an equipment order. */
  kind?: string | null
  /** structure.nodes.handover_category — per-node override (equipment only). */
  nodeOverride?: string | null
}

/**
 * Resolve the handover category for an order's shop drawing.
 *
 * Scope orders:     scopeTypeOverride → scope default → null.
 * Equipment orders: nodeOverride      → kind default  → null.
 *
 * A scope order never consults the node override — one tenant node can host
 * both a DB and a Lighting order, which must route to different categories.
 * Returns null when nothing maps; the caller then prompts the user.
 */
export function resolveHandoverCategory(input: CategoryResolutionInput): HandoverCategory | null {
  if (input.scopeKey) {
    return asCategory(input.scopeTypeOverride) ?? SCOPE_KEY_CATEGORY[input.scopeKey] ?? null
  }
  if (input.kind) {
    return asCategory(input.nodeOverride) ?? EQUIPMENT_KIND_CATEGORY[input.kind] ?? null
  }
  return null
}

/** Prefix a drawing's file name with its order label for the handover pack. */
export function buildHandoverDrawingName(itemLabel: string, fileName: string): string {
  const label = itemLabel.trim()
  if (!label) return fileName
  const prefix = `${label} — `
  return fileName.startsWith(prefix) ? fileName : `${prefix}${fileName}`
}
