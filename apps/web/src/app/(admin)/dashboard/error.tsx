'use client'

export default function DashboardError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div style={{ padding: '48px 0', textAlign: 'center' }}>
      <p style={{ color: 'var(--c-text)', fontWeight: 600, marginBottom: 8 }}>Dashboard failed to load</p>
      <p style={{ color: 'var(--c-text-dim)', fontSize: 13, marginBottom: 20 }}>{error.message}</p>
      <button onClick={reset} className="btn-primary-amber" style={{ fontSize: 13 }}>
        Retry
      </button>
    </div>
  )
}
