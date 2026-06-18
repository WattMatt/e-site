'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { regenerateInspectionReportAction } from '@/actions/inspection-report.actions'

export default function RegenerateButton({
  inspectionId,
  projectId,
  hasReport,
}: {
  inspectionId: string
  projectId: string
  hasReport: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <Button
        variant="primary"
        disabled={isPending}
        onClick={() => {
          setError(null)
          startTransition(async () => {
            const r = await regenerateInspectionReportAction(inspectionId, projectId)
            if ('error' in r) setError(r.error)
            else router.refresh()
          })
        }}
      >
        {isPending ? 'Generating…' : hasReport ? '↻ Regenerate' : 'Generate certificate'}
      </Button>
      {error && <span style={{ color: 'var(--c-red)', fontSize: 12 }}>{error}</span>}
    </div>
  )
}
