/**
 * Which status plans ride along with the tenant schedule report. Pure (no pdf-lib) so the report
 * dialog — a client component — can import it. Absent params = no appendix, so every existing
 * caller of the report routes is unchanged.
 */
import type { StatusPlanPurpose } from '@esite/shared/status-plans'

export interface StatusPlanAppendixOptions {
  tenantLayout: boolean
  schematic: boolean
  /** "Floor plan by main board" (spec 2026-10-13 §1): extra floor plan pages, off by default. */
  byBoard: boolean
}

export function statusPlanAppendixOptions(url: string | URL): StatusPlanAppendixOptions {
  const p = new URL(url).searchParams
  return { tenantLayout: p.get('tenantPlans') === '1', schematic: p.get('schematicPlans') === '1', byBoard: p.get('boardPlans') === '1' }
}

/** The STATUS-coloured purposes. Board pages are requested separately (byBoard). */
export function appendixPurposes(o: StatusPlanAppendixOptions): StatusPlanPurpose[] {
  const out: StatusPlanPurpose[] = []
  if (o.tenantLayout) out.push('tenant_layout')
  if (o.schematic) out.push('distribution_schematic')
  return out
}

export function appendixQuery(o: StatusPlanAppendixOptions): string {
  const p = new URLSearchParams()
  if (o.tenantLayout) p.set('tenantPlans', '1')
  if (o.schematic) p.set('schematicPlans', '1')
  if (o.byBoard) p.set('boardPlans', '1')
  const s = p.toString()
  return s ? `?${s}` : ''
}
