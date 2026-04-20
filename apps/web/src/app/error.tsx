'use client'

import { useEffect } from 'react'
import { ErrorState } from '@/components/ui/ErrorState'

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[RootError]', error)
  }, [error])

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <ErrorState
        title="Something went wrong"
        description="An unexpected error occurred. Our team has been notified."
        detail={error.digest ? `Error ID: ${error.digest}` : undefined}
        action={
          <button
            onClick={reset}
            style={{
              padding: '8px 20px', borderRadius: 6,
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
