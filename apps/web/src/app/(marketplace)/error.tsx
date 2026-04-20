'use client'

import { useEffect } from 'react'
import { ErrorState } from '@/components/ui/ErrorState'

export default function MarketplaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[MarketplaceError]', error)
  }, [error])

  return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <ErrorState
        title="Page failed to load"
        description="This page encountered an unexpected error. Your data is safe."
        detail={error.digest ? `Error ID: ${error.digest}` : undefined}
        action={
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
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
            <a
              href="/supplier/profile"
              style={{
                padding: '8px 18px', borderRadius: 6,
                background: 'var(--c-panel)', color: 'var(--c-text-mid)',
                border: '1px solid var(--c-border)',
                fontSize: 13, fontWeight: 500, textDecoration: 'none',
                display: 'inline-block',
              }}
            >
              Supplier Portal
            </a>
          </div>
        }
      />
    </div>
  )
}
