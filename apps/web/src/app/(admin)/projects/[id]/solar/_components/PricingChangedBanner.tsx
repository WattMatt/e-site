'use client'
/**
 * "Pricing changed" — the sibling of the Stale banner. The study pricing (tariff override, export rule,
 * escalation, load growth) or the case's money-only inputs (degradation, load shedding — YF-01) moved
 * since the selected case's financials, but its ENERGY inputs did not,
 * so the energy results still hold and only the financials need re-running on the stored run. The
 * decision is made server-side (pricing-state.ts); this only shows it and offers the financials-only
 * re-run to a caller who may run financials (Edit + financials).
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { runSolarFinancialsAction } from '@/actions/solar-financials.actions'

export function PricingChangedBanner({ projectId, caseId, caseName, canRunFinancials }: {
  projectId: string; caseId: string; caseName: string; canRunFinancials: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div role="status" style={{ border: '1px solid var(--c-amber)', borderRadius: 8, padding: '10px 14px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <span>
        <strong>Pricing changed — Re-run financials.</strong>{' '}
        The pricing inputs for “{caseName}” (tariff, escalation, degradation or load shedding) changed since its financials were computed. Its energy results still hold
        {canRunFinancials ? '.' : '; someone with Edit + financials access needs to re-run the financials.'}
      </span>
      {canRunFinancials && (
        <Button type="button" size="sm" disabled={busy} onClick={async () => {
          setBusy(true); setError(null)
          const r = await runSolarFinancialsAction({ projectId, caseId })
          setBusy(false)
          if ('ok' in r) router.refresh(); else setError(r.error)
        }}>{busy ? 'Re-running financials…' : 'Re-run financials'}</Button>
      )}
      {error && <span role="alert" style={{ color: 'var(--c-red, #dc2626)' }}>{error}</span>}
    </div>
  )
}
