'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { revokeCertificateAction } from '@/actions/inspections-certify.actions'

export default function RevokeButton({
  certificateId,
  inspectionId,
  projectId,
}: {
  certificateId: string
  inspectionId: string
  projectId: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onClick = async () => {
    const reason = window.prompt(
      'Revoke this certificate? Enter a reason (required, will appear on the cert page):',
    )
    if (!reason || !reason.trim()) return
    setError(null)
    setBusy(true)
    try {
      await revokeCertificateAction({
        certificateId,
        inspectionId,
        projectId,
        reason: reason.trim(),
      })
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <Button variant="danger" onClick={onClick} disabled={busy}>
        {busy ? 'Revoking…' : 'Revoke'}
      </Button>
      {error && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 6,
            fontSize: 11,
            color: 'var(--c-red)',
            background: 'var(--c-red-dim, rgba(192,57,43,0.12))',
            border: '1px solid var(--c-red-dim, rgba(192,57,43,0.3))',
            borderRadius: 6,
            padding: '6px 10px',
            whiteSpace: 'nowrap',
            maxWidth: 300,
            zIndex: 5,
          }}
        >
          {error}
        </div>
      )}
    </div>
  )
}
