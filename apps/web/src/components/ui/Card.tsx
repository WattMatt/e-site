import { type ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
  onClick?: () => void
}

export function Card({ children, className, onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--c-panel)',
        border: '1px solid var(--c-border)',
        borderRadius: 8,
        cursor: onClick ? 'pointer' : undefined,
        transition: 'border-color 0.15s, background 0.15s',
      }}
      className={className}
    >
      {children}
    </div>
  )
}

export function CardHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      style={{ padding: '14px 18px', borderBottom: '1px solid var(--c-border)' }}
      className={className}
    >
      {children}
    </div>
  )
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div style={{ padding: '14px 18px' }} className={className}>
      {children}
    </div>
  )
}

export function KpiCard({ label, value, sub, variant = 'default' }: {
  label: string
  value: string | number
  sub?: string
  variant?: 'default' | 'danger' | 'warning' | 'success'
}) {
  const variantClass =
    variant === 'danger' ? 'kpi-danger' :
    variant === 'warning' ? 'kpi-warning' :
    variant === 'success' ? 'kpi-success' : ''

  return (
    <div className={`kpi-card ${variantClass}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-meta">{sub}</div>}
    </div>
  )
}
