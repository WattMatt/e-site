/**
 * The Layout step of the readiness checklist (functional spec, readiness
 * table: green ≥ 1 array with ≥ 1 module and a north reference; amber layout
 * started but no north reference; red an array lies outside every roof area).
 * Input is aggregated from solar.layouts.summary and solar.roof_sources, so
 * no geometry is loaded to render a tab dot.
 */
import type { ReadinessStatus } from '../readiness'

export interface LayoutReadinessInput {
  layouts: number
  arraysWithModules: number
  northSet: boolean
  arrayOutsideRoof: boolean
}

export function layoutReadiness(l: LayoutReadinessInput | null): { status: ReadinessStatus; reason: string } {
  if (!l || l.layouts === 0) return { status: 'grey', reason: 'Not started' }
  if (l.arrayOutsideRoof) return { status: 'red', reason: 'An array lies outside every roof area' }
  if (!l.northSet) return { status: 'amber', reason: 'Layout started but no north reference' }
  if (l.arraysWithModules === 0) return { status: 'amber', reason: 'Layout started but no array has modules yet' }
  return {
    status: 'green',
    reason: `${l.arraysWithModules} array${l.arraysWithModules === 1 ? '' : 's'} placed with a north reference`,
  }
}
