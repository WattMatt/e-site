/**
 * db-legend — types + pure helpers for tenant DB legend cards
 * (structure.node_circuits, migration 00169).
 */

export interface LegendCircuit {
  id: string
  node_id: string
  circuit_no: string
  description: string | null
  phase: 'L1' | 'L2' | 'L3' | '3P' | null
  breaker_rating_a: number | null
  poles: 1 | 2 | 3 | 4 | null
  curve: 'B' | 'C' | 'D' | null
  cable_size: string | null
  is_spare: boolean
  sort_order: number
}

/** Card-header fields stored on structure.tenant_details (00169). */
export interface LegendHeader {
  node_id: string
  db_location: string | null
  db_fed_from: string | null
  db_earth_leakage_ma: number | null
  legend_card_size: 'A4' | 'A5'
}

export const QUICK_ADD_MAX = 60

/**
 * Circuit numbers for a quick-add of `count` ways: sequential integers
 * continuing from the highest existing integer circuit_no (non-integer
 * numbers like "3+5+7" are ignored). count is clamped to [1, QUICK_ADD_MAX].
 */
export function planQuickAddWays(existingCircuitNos: string[], count: number): string[] {
  const n = Math.min(Math.max(Math.trunc(count) || 1, 1), QUICK_ADD_MAX)
  let max = 0
  for (const raw of existingCircuitNos) {
    const t = raw.trim()
    if (/^\d+$/.test(t)) max = Math.max(max, parseInt(t, 10))
  }
  return Array.from({ length: n }, (_, i) => String(max + 1 + i))
}
