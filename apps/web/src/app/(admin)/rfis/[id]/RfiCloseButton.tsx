'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { closeRfiAction } from '@/actions/rfi.actions'

export function RfiCloseButton({ rfiId }: { rfiId: string }) {
  const [closing, setClosing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function close() {
    if (!confirm('Close this RFI? This cannot be undone.')) return
    setClosing(true)
    setError(null)
    const result = await closeRfiAction(rfiId)
    if (result.error) {
      setError(result.error)
      setClosing(false)
      return
    }
    router.refresh()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
      <button
        onClick={close}
        disabled={closing}
        style={{
          fontSize: 12, color: 'var(--c-text-dim)', background: 'var(--c-panel)',
          border: '1px solid var(--c-border)', borderRadius: 6, padding: '6px 14px',
          cursor: closing ? 'not-allowed' : 'pointer', opacity: closing ? 0.5 : 1,
          transition: 'all 0.12s',
        }}
      >
        {closing ? 'Closing…' : 'Close RFI'}
      </button>
      {error && <p style={{ color: 'var(--c-red)', fontSize: 11, margin: 0 }}>{error}</p>}
    </div>
  )
}
