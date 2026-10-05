'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { deleteTenderAction } from '@/actions/tender.actions'

/** Two-step inline confirm (window.confirm is suppressed by Safari). */
export function DeleteTenderButton({ tenderId, projectId }: { tenderId: string; projectId: string }) {
  const router = useRouter()
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function go() {
    if (!armed) {
      setArmed(true)
      setTimeout(() => setArmed(false), 4000)
      return
    }
    setBusy(true)
    const r = await deleteTenderAction(tenderId)
    setBusy(false)
    if ('error' in r) return setError(r.error)
    router.push(`/projects/${projectId}/tenders`)
  }

  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <Button variant="ghost" size="sm" isLoading={busy} onClick={go}>{armed ? 'Tap again to delete draft' : 'Delete draft'}</Button>
      {error && <span role="alert" style={{ color: 'var(--c-red)' }}>{error}</span>}
    </span>
  )
}
