'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[GlobalError]', error)
  }, [error])

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#0f1117', color: '#e2e8f0' }}>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            padding: '0 24px',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: 48, height: 48, borderRadius: '50%',
              background: 'rgba(232,85,85,0.15)',
              border: '1px solid rgba(232,85,85,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, marginBottom: 8,
            }}
          >
            ⚠
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Application error</h1>
          <p style={{ color: '#8b9ab0', fontSize: 14, margin: 0, maxWidth: 360, lineHeight: 1.55 }}>
            A critical error occurred and the app could not recover. Our team has been notified.
          </p>
          {error.digest && (
            <code
              style={{
                fontSize: 11, color: '#5a6a7e',
                background: '#1a2030', padding: '4px 8px', borderRadius: 4,
              }}
            >
              ID: {error.digest}
            </code>
          )}
          <button
            onClick={reset}
            style={{
              marginTop: 8, padding: '10px 20px', borderRadius: 6,
              background: '#e8a520', color: '#0f1117',
              border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  )
}
