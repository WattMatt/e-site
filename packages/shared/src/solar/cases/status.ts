/** Case card status (functional spec §7.1) and the Stale rule (engine spec §1.3). */
export type CaseStatus = 'not_run' | 'running' | 'done' | 'failed' | 'stale'
export const RUN_TIMEOUT_MS = 90_000

export interface LatestRunLite { status: 'running' | 'succeeded' | 'failed' | 'cancelled'; inputsHash: string; startedAt: string }

export function caseStatus(
  latest: LatestRunLite | null,
  lastSucceeded: { inputsHash: string } | null,
  currentHash: string | null,
  now: number,
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
  return currentHash === lastSucceeded.inputsHash ? { status: 'done', label: 'Done' } : { status: 'stale', label: 'Stale' }
}
