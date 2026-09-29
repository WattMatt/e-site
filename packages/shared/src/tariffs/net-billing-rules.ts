import { fyEndMonth, type TariffRegime } from './financial-year'
import type { SsegRule } from './types'

/**
 * NERSA Net-Billing Rules for licensed distributors (approved 17 Dec 2024),
 * pp7-12: monthly settlement, energy-only offset, no cash, carry forward within
 * the distributor's financial year, credited kWh capped per TOU period at
 * import, 1,000 kVA ceiling, bidirectional TOU meter. §5.4 allows a flat
 * (non-TOU) export tariff where a distributor cannot do TOU.
 * `rulesSha256` cites the stored Rules PDF (owner default 9).
 */
export function netBillingRule(regime: TariffRegime, opts: { touExport?: boolean; rulesSha256?: string | null } = {}): SsegRule {
  const tou = opts.touExport ?? true
  return {
    crediting: tou ? 'net_billing_tou' : 'net_billing_flat',
    carryForward: 'within_financial_year',
    fyEndMonth: fyEndMonth(regime),
    capRule: 'kwh_per_tou_period',
    offsets: 'energy_only',
    forfeitOnOwnershipChange: true,
    maxKva: 1000,
    requiresTou: tou,
    requiresBidirectionalMeter: true,
    locator: { document: 'NERSA Net-Billing Rules for licensed distributors', approved: '2024-12-17', pages: '7-12' },
    sourceDocumentSha256: opts.rulesSha256 ?? null,
  }
}
