'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { generateSolarReportAction } from '@/actions/solar-reports.actions'

/** Overview shortcut (spec §2.2): the same action as Reports → Generate feasibility report. */
export function GenerateFeasibilityButton({ projectId, disabledReason }: { projectId: string; disabledReason: string | null }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      <Button type="button" size="sm" variant="secondary" disabled={Boolean(disabledReason) || busy} title={disabledReason ?? undefined}
        onClick={async () => {
          setBusy(true); setError(null)
          const r = await generateSolarReportAction({ projectId, kind: 'feasibility', note: null, options: { includeLayoutSheet: false, include8760: false } })
          setBusy(false)
          if ('error' in r) setError(r.error); else router.push(`/projects/${projectId}/solar/reports`)
        }}>
        {busy ? 'Generating…' : 'Generate feasibility report'}
      </Button>
      {error && <span role="alert" style={{ fontSize: 12 }}>{error}</span>}
    </>
  )
}
