'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createRevisionAction } from '@/actions/cable-revision.actions'

export function CreateRevisionButton({
  projectId,
  hasDraft,
}: {
  projectId: string
  hasDraft: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onClick() {
    setError(null)
    startTransition(async () => {
      const res = await createRevisionAction({ projectId })
      if (res.error) { setError(res.error); return }
      router.refresh()
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      <button
        type="button"
        className="btn-primary-amber"
        onClick={onClick}
        disabled={pending || hasDraft}
        title={hasDraft
          ? 'Already a DRAFT revision — issue or discard it before starting another.'
          : 'Start a new draft revision'}
      >
        {pending ? 'Creating…' : '+ New revision'}
      </button>
      {error && (
        <div role="alert" style={{ color: '#dc2626', fontSize: 11 }}>{error}</div>
      )}
    </div>
  )
}
