/** Tiny shared presentational pieces for the read-only client portal. */

export function PortalCard({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--c-panel)', border: '1px solid var(--c-border)',
      borderRadius: 8, padding: 20, marginBottom: 16,
    }}>
      {children}
    </div>
  )
}

export function PortalTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--c-text)' }}>{children}</h1>
      {sub && <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--c-text-mid)' }}>{sub}</p>}
    </div>
  )
}

export function EmptyState({ label }: { label: string }) {
  return (
    <p style={{ fontSize: 13, color: 'var(--c-text-dim)', padding: '18px 0', textAlign: 'center' }}>
      {label}
    </p>
  )
}

const STATUS_COLORS: Record<string, string> = {
  open: 'var(--c-amber)',
  in_progress: 'var(--c-amber)',
  pending_sign_off: 'var(--c-amber)',
  resolved: 'var(--c-success, #22C55E)',
  signed_off: 'var(--c-success, #22C55E)',
  closed: 'var(--c-text-dim)',
  pass: 'var(--c-success, #22C55E)',
  fail: 'var(--c-danger)',
  conditional_pass: 'var(--c-amber)',
  active: 'var(--c-success, #22C55E)',
  ISSUED: 'var(--c-success, #22C55E)',
  DRAFT: 'var(--c-text-dim)',
  // QC report statuses are lowercase (00172 CHECK constraint) — the uppercase
  // pair above is the cable-schedule revision casing, so both must map.
  issued: 'var(--c-success, #22C55E)',
  draft: 'var(--c-text-dim)',
}

export function StatusBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span style={{ color: 'var(--c-text-dim)', fontSize: 12 }}>—</span>
  const color = STATUS_COLORS[value] ?? 'var(--c-text-mid)'
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 11, color,
      border: `1px solid ${color}`, borderRadius: 4, padding: '1px 7px',
      textTransform: 'capitalize', whiteSpace: 'nowrap',
    }}>
      {value.replace(/_/g, ' ')}
    </span>
  )
}

export const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', fontSize: 11, fontFamily: 'var(--font-mono)',
  textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--c-text-dim)',
  borderBottom: '1px solid var(--c-border)',
}

export const tdStyle: React.CSSProperties = {
  padding: '9px 10px', fontSize: 13, color: 'var(--c-text)',
  borderBottom: '1px solid var(--c-border)', verticalAlign: 'top',
}

export function fmtDate(v: string | null | undefined): string {
  if (!v) return '—'
  return v.slice(0, 10)
}
