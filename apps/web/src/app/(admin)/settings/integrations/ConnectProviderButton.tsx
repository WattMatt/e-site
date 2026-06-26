'use client'

import { useState, useTransition } from 'react'
import type { ProviderName } from '@esite/shared'
import { startCloudOAuthAction } from '@/actions/cloud-storage.actions'

export function ConnectProviderButton({
  provider,
  label,
}: {
  provider: ProviderName
  label: string
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onClick() {
    setError(null)
    startTransition(async () => {
      try {
        const { authUrl } = await startCloudOAuthAction(provider)
        window.location.href = authUrl
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to start OAuth')
      }
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <button
        onClick={onClick}
        disabled={pending}
        style={{
          background: 'var(--c-amber)',
          color: 'var(--c-bg)',
          border: '1px solid var(--c-amber)',
          padding: '8px 14px',
          borderRadius: 6,
          cursor: pending ? 'wait' : 'pointer',
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {pending ? `Connecting ${label}…` : `Connect ${label}`}
      </button>
      {error && (
        <p style={{ color: 'var(--c-red)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>{error}</p>
      )}
    </div>
  )
}
