/**
 * The Tariff row of the readiness rules (spec §2.3): "Missing rule blocks
 * Tariff readiness" (spec §5). A post-processor over computeSolarReadiness
 * rather than a new parameter on it: Phase 5 adds its own positional
 * parameter on a sibling branch, and two different third parameters would
 * conflict on merge.
 */
import type { ReadinessStatus, ReadinessStep } from '../readiness'
import { parseExportRule } from './export-rule'

export interface TariffReadinessInput {
  tariffId: string | null
  exportRule: unknown
  /** Whether the PINNED tariff has an export_tariff_id: a linked-tariff rule is only met when it does. */
  hasLinkedExportTariff: boolean
}

export function tariffReadiness(i: TariffReadinessInput | null): { status: ReadinessStatus; reason: string } {
  if (!i || !i.tariffId) return { status: 'grey', reason: 'Not started' }
  const rule = parseExportRule(i.exportRule)
  if (!rule) return { status: 'amber', reason: 'Missing: export credit rule' }
  // A rule saved against an earlier tariff: the new one may have nothing to link to.
  if (rule.method === 'linked_tariff' && !i.hasLinkedExportTariff) {
    return { status: 'amber', reason: 'The pinned tariff has no linked export tariff: choose another export rule' }
  }
  return { status: 'green', reason: 'Tariff and export credit rule are set' }
}

export function toTariffReadinessInput(row: Record<string, unknown> | null | undefined, hasLinkedExportTariff: boolean): TariffReadinessInput | null {
  if (!row) return null
  return { tariffId: typeof row.tariff_id === 'string' ? row.tariff_id : null, exportRule: row.export_rule ?? null, hasLinkedExportTariff }
}

export function withTariffReadiness(steps: ReadinessStep[], input: TariffReadinessInput | null): ReadinessStep[] {
  return steps.map((s) => (s.slug === 'tariff' ? { ...s, live: true, ...tariffReadiness(input) } : s))
}
