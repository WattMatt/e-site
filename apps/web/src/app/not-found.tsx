import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'

export default function NotFound() {
  return (
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
        background: 'var(--c-base)',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 48, height: 48, borderRadius: 999,
          background: 'var(--c-red-dim)',
          border: '1px solid rgba(232,85,85,0.3)',
          color: 'var(--c-red)',
          marginBottom: 4,
        }}
      >
        <AlertTriangle size={22} />
      </div>
      <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--c-text)', margin: 0 }}>
        Page not found
      </h1>
      <p style={{ color: 'var(--c-text-mid)', fontSize: 13, margin: 0, maxWidth: 340, lineHeight: 1.55 }}>
        The page you're looking for doesn't exist or you may not have permission to view it.
      </p>
      <Link
        href="/dashboard"
        style={{
          marginTop: 8,
          padding: '8px 20px', borderRadius: 6,
          background: 'var(--c-amber)', color: 'var(--c-base)',
          fontSize: 13, fontWeight: 600, textDecoration: 'none',
          display: 'inline-block',
        }}
      >
        Back to Dashboard
      </Link>
    </div>
  )
}
