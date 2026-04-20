import type { ReactNode } from 'react'

// Visual flag that wraps placeholder legal copy. Appears at the top of every
// /privacy, /terms, /acceptable-use and /cookies page until the lawyer-drafted
// content replaces the placeholder sections.
//
// Rendered as a warning banner so staging / QA can immediately see that the
// public pages still contain non-legal copy.

export function LegalPlaceholderBanner({ children }: { children?: ReactNode }) {
  return (
    <div
      role="alert"
      style={{
        background: 'var(--c-amber-dim)',
        color: 'var(--c-amber)',
        border: '1px solid var(--c-amber-mid)',
        borderRadius: 6,
        padding: '10px 14px',
        fontSize: 12,
        marginBottom: 28,
        lineHeight: 1.5,
      }}
    >
      <strong>Placeholder content — awaiting lawyer review.</strong>
      {' '}
      {children ??
        'The structure below matches the statutory requirements but the wording has not been drafted by a qualified legal practitioner. Do not publish until replaced.'}
    </div>
  )
}

export function H1({ children }: { children: ReactNode }) {
  return <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8, color: 'var(--c-text)' }}>{children}</h1>
}

export function LastUpdated({ iso }: { iso: string }) {
  return (
    <p style={{ fontSize: 12, color: 'var(--c-text-dim)', marginBottom: 32 }}>
      Last updated: {iso}
    </p>
  )
}

export function H2({ children }: { children: ReactNode }) {
  return (
    <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 32, marginBottom: 10, color: 'var(--c-text)' }}>
      {children}
    </h2>
  )
}

export function P({ children }: { children: ReactNode }) {
  return <p style={{ color: 'var(--c-text-mid)', marginBottom: 14 }}>{children}</p>
}

export function Ul({ children }: { children: ReactNode }) {
  return (
    <ul style={{ color: 'var(--c-text-mid)', marginBottom: 14, paddingLeft: 20, lineHeight: 1.7 }}>
      {children}
    </ul>
  )
}
