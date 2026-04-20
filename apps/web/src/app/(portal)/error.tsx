'use client'

import { useEffect } from 'react'
import { ErrorState } from '@/components/ui/ErrorState'

export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[PortalError]', error)
  }, [error])

  return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <ErrorState
        title="Portal error"
        description="This page encountered an unexpected error. Please try again or contact your project manager."
        detail={error.digest ? `Error ID: ${error.digest}` : undefined}
        action={
          <button
            onClick={reset}
            style={{
              padding: '8px 18px', borderRadius: 6,
              background: 'var(--c-amber)', color: 'var(--c-base)',
              border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Try again
          </button>
        }
      />
    </div>
  )
}
