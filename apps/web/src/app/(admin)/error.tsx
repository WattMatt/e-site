'use client'

import { useEffect } from 'react'
import { ErrorState } from '@/components/ui/ErrorState'

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[AdminError]', error)
  }, [error])

  // On non-production deploys, expose the full error so we can debug without
  // having to dig through Vercel function logs by digest. NEXT_PUBLIC_VERCEL_ENV
  // is set automatically by Vercel; "production" only on the production env.
  const showDebugDetail =
    process.env.NEXT_PUBLIC_VERCEL_ENV !== 'production' ||
    process.env.NODE_ENV !== 'production'

  return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ maxWidth: 720, width: '100%' }}>
        <ErrorState
          title="Page failed to load"
          description="This page encountered an unexpected error. Your data is safe — try again or return to the dashboard."
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
                href="/dashboard"
                style={{
                  padding: '8px 18px', borderRadius: 6,
                  background: 'var(--c-panel)', color: 'var(--c-text-mid)',
                  border: '1px solid var(--c-border)',
                  fontSize: 13, fontWeight: 500, textDecoration: 'none',
                  display: 'inline-block',
                }}
              >
                Back to Dashboard
              </a>
            </div>
          }
        />
        {showDebugDetail && (
          <pre style={{
            marginTop: 24, padding: 14,
            background: 'rgba(248,113,113,0.08)',
            border: '1px solid rgba(248,113,113,0.3)',
            color: '#f87171',
            fontFamily: 'monospace', fontSize: 11, whiteSpace: 'pre-wrap',
            borderRadius: 6, maxHeight: 400, overflow: 'auto',
          }}>
{`name:    ${error.name}
message: ${error.message}
digest:  ${error.digest ?? '(none)'}
stack:
${error.stack ?? '(no stack)'}`}
          </pre>
        )}
      </div>
    </div>
  )
}
