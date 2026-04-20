import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

// Shown when a query or server action fails. Distinct from EmptyState:
//   - Red tint, not neutral — failure is a problem, not a zero-rows state
//   - Always offers a recovery path (retry button or fallback link)
//   - Shorter vertical padding so the layout doesn't feel abandoned

export interface ErrorStateProps {
  title?: string
  description?: string
  /** Optional error message — shown in monospace below the description. */
  detail?: string
  /** Primary recovery action — a retry button or link. */
  action?: ReactNode
  dense?: boolean
}

export function ErrorState({
  title = 'Something went wrong',
  description = 'This bit of the page failed to load. Reloading usually helps.',
  detail,
  action,
  dense,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: dense ? '32px 16px' : '56px 24px',
        textAlign: 'center',
        gap: 12,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 48,
          height: 48,
          borderRadius: 999,
          background: 'var(--c-red-dim)',
          border: '1px solid rgba(232,85,85,0.3)',
          color: 'var(--c-red)',
          marginBottom: 4,
        }}
      >
        <AlertTriangle size={22} />
      </div>
      <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-text)', margin: 0 }}>{title}</h3>
      {description && (
        <p style={{ color: 'var(--c-text-mid)', fontSize: 13, margin: 0, maxWidth: 360, lineHeight: 1.55 }}>
          {description}
        </p>
      )}
      {detail && (
        <code
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--c-text-dim)',
            background: 'var(--c-panel)',
            border: '1px solid var(--c-border)',
            borderRadius: 4,
            padding: '6px 10px',
            maxWidth: '90%',
            overflowX: 'auto',
            whiteSpace: 'nowrap',
          }}
        >
          {detail}
        </code>
      )}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  )
}
