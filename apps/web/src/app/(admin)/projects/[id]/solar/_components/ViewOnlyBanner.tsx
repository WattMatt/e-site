'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { requestSolarAccessAction } from '@/actions/solar-requests.actions'

/** Spec §0.3: shown to View-level users only. */
export function ViewOnlyBanner({ projectId }: { projectId: string }) {
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function ask() {
    setBusy(true)
    setError(null)
    const res = await requestSolarAccessAction({ projectId, level: 'edit' })
    setBusy(false)
    if ('error' in res) { setError(res.error); return }
    setSent(true)
  }

  return (
    <div
      role="note"
      style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 14px', margin: '0 0 12px', borderRadius: 6, border: '1px solid var(--c-border)', background: 'var(--c-panel)', fontSize: 13, color: 'var(--c-text-mid)' }}
    >
      <span>You have view access — ask an admin for edit access</span>
      {sent
        ? <span>Request sent — the organisation admins have been told.</span>
        : <Button type="button" size="sm" variant="secondary" onClick={ask} isLoading={busy}>Request edit access</Button>}
      {error && <span role="alert" style={{ color: 'var(--c-red)' }}>{error}</span>}
    </div>
  )
}
