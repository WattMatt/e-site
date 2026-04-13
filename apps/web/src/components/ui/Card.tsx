import { type ReactNode } from 'react'
import { clsx } from 'clsx'

interface CardProps {
  children: ReactNode
  className?: string
  onClick?: () => void
}

export function Card({ children, className, onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        'bg-slate-800 border border-slate-700 rounded-xl',
        onClick && 'cursor-pointer hover:border-slate-500 transition-colors',
        className
      )}
    >
      {children}
    </div>
  )
}

export function CardHeader({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('px-6 py-4 border-b border-slate-700', className)}>{children}</div>
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('px-6 py-4', className)}>{children}</div>
}

export function KpiCard({ label, value, sub, variant = 'default' }: {
  label: string
  value: string | number
  sub?: string
  variant?: 'default' | 'danger' | 'warning' | 'success'
}) {
  const valueColors = {
    default: 'text-white',
    danger: 'text-red-400',
    warning: 'text-amber-400',
    success: 'text-emerald-400',
  }
  return (
    <Card className="p-6">
      <p className="text-slate-400 text-sm">{label}</p>
      <p className={clsx('text-3xl font-bold mt-1', valueColors[variant])}>{value}</p>
      {sub && <p className="text-slate-500 text-xs mt-1">{sub}</p>}
    </Card>
  )
}
