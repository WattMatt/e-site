import type { GeneratorSettings, ZoneInput, TenantInput } from './types'
import { calculateTotalCapitalCost } from './capital'

export interface CapitalBreakdown {
  generators: number
  boardMods: number
  cabling: number
  controlWiring: number
  total: number
}

/**
 * Decompose the total capital cost into its four line items.
 *
 * `total` is derived from `calculateTotalCapitalCost` (single source of truth).
 * The four components sum to that same value:
 *   generators + boardMods + cabling + controlWiring === total.
 */
export function capitalCostBreakdown(
  zones: ZoneInput[],
  tenants: TenantInput[],
  s: GeneratorSettings,
): CapitalBreakdown {
  const generators = zones.reduce(
    (sum, z) => sum + z.generators.reduce((g, gen) => g + gen.cost, 0),
    0,
  )
  // 'own' and 'none' are excluded from the board-mod count (shared only).
  const numTenantDBs = tenants.filter((t) => t.participation === 'shared').length
  const boardMods = numTenantDBs * s.ratePerTenantDb + s.numMainBoards * s.ratePerMainBoard
  const cabling = s.additionalCablingCost
  const controlWiring = s.controlWiringCost
  // Use calculateTotalCapitalCost as the single source of truth for the total,
  // so this function is always consistent with the engine.
  const total = calculateTotalCapitalCost(zones, tenants, s)
  return { generators, boardMods, cabling, controlWiring, total }
}
