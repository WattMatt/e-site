import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Inbox } from 'lucide-react'

// Standard empty-state for lists, queries that return zero rows, unfilled
// dashboard widgets. Replaces the previous slate-themed emoji version — now
// token-aligned with the warm-dark palette.
//
// Keep it boring on purpose — a flashy empty state draws the eye away from
// the real work. Amber is reserved for the action button, if any.

export interface EmptyStateProps {
  /** Lucide icon component. Falls back to <Inbox /> if omitted. */
  icon?: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  /** Shrink the vertical padding for use inside a card or panel. */
  dense?: boolean
}

export function EmptyState({ icon: Icon = Inbox, title, description, action, dense }: EmptyStateProps) {
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: dense ? '32px 16px' : '64px 24px',
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
          background: 'var(--c-elevated)',
          border: '1px solid var(--c-border)',
          color: 'var(--c-text-dim)',
          marginBottom: 4,
        }}
      >
        <Icon size={22} />
      </div>
      <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-text)', margin: 0 }}>{title}</h3>
      {description && (
        <p
          style={{
            color: 'var(--c-text-mid)',
            fontSize: 13,
            margin: 0,
            maxWidth: 360,
            lineHeight: 1.55,
          }}
        >
          {description}
        </p>
      )}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  )
}
