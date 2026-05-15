'use client'

import { useTransition, useState } from 'react'
import { useRouter } from 'next/navigation'
import { initializeHandoverCategoryAction } from '@/actions/handover.actions'
import { CATEGORY_LABELS, type HandoverCategory } from '@esite/shared'
import { Button } from '@/components/ui/Button'

export function HandoverInitButton({
  projectId,
  category,
}: {
  projectId: string
  category: HandoverCategory
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  function onClick() {
    setMsg(null)
    startTransition(async () => {
      const res = await initializeHandoverCategoryAction(projectId, category)
      if ('error' in res) {
        setMsg(res.error)
        return
      }
      setMsg(
        `Created ${res.foldersCreated} folder${res.foldersCreated === 1 ? '' : 's'}${
          res.cloudMirrored > 0 ? ` (${res.cloudMirrored} cloud-mirrored)` : ''
        }`,
      )
      router.refresh()
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <Button type="button" variant="primary" size="sm" onClick={onClick} isLoading={pending}>
        Initialize {CATEGORY_LABELS[category]} template
      </Button>
      {msg && (
        <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>{msg}</span>
      )}
    </div>
  )
}
