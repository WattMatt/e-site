/** Case card status (functional spec §7.1) and the Stale rule (engine spec §1.3). */
export type CaseStatus = 'not_run' | 'running' | 'done' | 'failed' | 'stale' | 'pricing_changed'
export const RUN_TIMEOUT_MS = 90_000

export interface LatestRunLite { status: 'running' | 'succeeded' | 'failed' | 'cancelled'; inputsHash: string; startedAt: string }

/**
 * What separates "the energy is out of date" from "only the pricing moved". The case hash
 * (case_runs.inputs_hash) is energy + study pricing (I-1), so either change makes it differ; the
 * run's own energy hash (outputs.provenance.inputsHash) tells them apart.
 */
export interface CaseStatusPricing {
  /** inputsHash(build.input) for the case as it stands now; null when it cannot be built. */
  currentEnergyHash?: string | null
  /** The latest financial result prices THIS run on the CURRENT study pricing (a financials-only re-run happened). */
  financialsOnCurrentPricing?: boolean
}

export function caseStatus(
  latest: LatestRunLite | null,
  lastSucceeded: { inputsHash: string; energyHash?: string | null } | null,
  currentHash: string | null,
  now: number,
  pricing: CaseStatusPricing = {},
): { status: CaseStatus; label: string } {
  if (!latest) return { status: 'not_run', label: 'Not run' }
  if (latest.status === 'running') {
    return now - Date.parse(latest.startedAt) > RUN_TIMEOUT_MS
      ? { status: 'failed', label: 'Failed (timed out)' }
      : { status: 'running', label: 'Running' }
  }
  if (latest.status === 'failed') return { status: 'failed', label: 'Failed' }
  if (!lastSucceeded) return { status: 'not_run', label: latest.status === 'cancelled' ? 'Cancelled' : 'Not run' }
  if (currentHash === null) return { status: 'stale', label: 'Stale (inputs incomplete)' }
  if (currentHash === lastSucceeded.inputsHash) return { status: 'done', label: 'Done' }
  // Only the pricing moved when the energy input is provably the one the run simulated. Anything
  // unknown is Stale: a pricing-only verdict must never hide an energy change.
  const stored = lastSucceeded.energyHash ?? null
  const current = pricing.currentEnergyHash ?? null
  if (stored !== null && current !== null && stored === current) {
    return pricing.financialsOnCurrentPricing ? { status: 'done', label: 'Done' } : { status: 'pricing_changed', label: 'Pricing changed' }
  }
  return { status: 'stale', label: 'Stale' }
}
