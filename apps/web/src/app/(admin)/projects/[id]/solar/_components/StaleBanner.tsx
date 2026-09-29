'use client'
/**
 * Spec §0.3 "Stale" banner — Yield, Financials (and Reports later). The decision is made server-side
 * (page-data: the case's current inputs hash vs its latest succeeded run's inputs_hash); this only shows it.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { postRun } from './runCase'

export function StaleBanner({ projectId, caseId, caseName, canRun }: { projectId: string; caseId: string; caseName: string; canRun: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div role="status" style={{ border: '1px solid var(--c-amber)', borderRadius: 8, padding: '10px 14px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <span>Results for “{caseName}” no longer match its inputs — they are Stale.</span>
      {canRun && (
        <Button type="button" size="sm" disabled={busy} onClick={async () => {
          setBusy(true); setError(null)
          const r = await postRun(projectId, caseId)
          setBusy(false)
          if (r.ok) router.refresh(); else setError(r.error)
        }}>{busy ? 'Running…' : 'Re-run selected case'}</Button>
      )}
      {error && <span role="alert" style={{ color: 'var(--c-red, #dc2626)' }}>{error}</span>}
    </div>
  )
}
