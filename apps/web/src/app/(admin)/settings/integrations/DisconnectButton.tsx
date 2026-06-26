'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { disconnectCloudConnectionAction } from '@/actions/cloud-storage.actions'

export function DisconnectButton({
  connectionId,
  label,
}: {
  connectionId: string
  label: string
}) {
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function onClick() {
    if (!confirming) {
      setConfirming(true)
      // Auto-cancel confirm prompt after 4s of inactivity.
      window.setTimeout(() => setConfirming(false), 4000)
      return
    }
    startTransition(async () => {
      try {
        await disconnectCloudConnectionAction(connectionId)
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to disconnect')
        setConfirming(false)
      }
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
      <button
        onClick={onClick}
        disabled={pending}
        style={{
          background: 'none',
          border: '1px solid ' + (confirming ? 'var(--c-red)' : 'var(--c-border)'),
          color: confirming ? 'var(--c-red)' : 'var(--c-text-mid)',
          padding: '6px 10px',
          borderRadius: 6,
          cursor: pending ? 'wait' : 'pointer',
          fontSize: 12,
        }}
      >
        {pending
          ? 'Disconnecting…'
          : confirming
            ? `Disconnect ${label}? Click again to confirm`
            : 'Disconnect'}
      </button>
      {error && (
        <p style={{ color: 'var(--c-red)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>{error}</p>
      )}
    </div>
  )
}
