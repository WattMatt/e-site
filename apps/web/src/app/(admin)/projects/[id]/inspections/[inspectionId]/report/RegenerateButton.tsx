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
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
      <Button
        variant={hasReport ? 'ghost' : 'primary'}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setErr(null)
            const res = await regenerateInspectionReportAction(inspectionId, projectId)
            if (res?.error) setErr(res.error)
            else router.refresh()
          })
        }
      >
        {pending ? 'Generating…' : hasReport ? '↻ Regenerate' : 'Generate certificate'}
      </Button>
      {err && <span style={{ color: 'var(--c-red)', fontSize: 11 }}>{err}</span>}
    </div>
  )
}
