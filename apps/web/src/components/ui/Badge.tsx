import { type ReactNode } from 'react'
import { clsx } from 'clsx'

type Variant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'ghost'

const variants: Record<Variant, string> = {
  default: 'bg-slate-700 text-slate-300',
  success: 'bg-emerald-900/50 text-emerald-400 border border-emerald-800',
  warning: 'bg-amber-900/50 text-amber-400 border border-amber-800',
  danger: 'bg-red-900/50 text-red-400 border border-red-800',
  info: 'bg-blue-900/50 text-blue-400 border border-blue-800',
  ghost: 'bg-transparent text-slate-400 border border-slate-700',
}

interface BadgeProps {
  children: ReactNode
  variant?: Variant
  className?: string
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', variants[variant], className)}>
      {children}
    </span>
  )
}

// Domain-specific badge factories
export function snagStatusBadge(status: string) {
  const map: Record<string, Variant> = {
    open: 'danger',
    in_progress: 'warning',
    resolved: 'info',
    pending_sign_off: 'warning',
    signed_off: 'success',
    closed: 'ghost',
  }
  return <Badge variant={map[status] ?? 'default'}>{status.replace(/_/g, ' ')}</Badge>
}

export function priorityBadge(priority: string) {
  const map: Record<string, Variant> = {
    low: 'ghost',
    medium: 'info',
    high: 'warning',
    critical: 'danger',
  }
  return <Badge variant={map[priority] ?? 'default'}>{priority}</Badge>
}

export function cocStatusBadge(status: string) {
  const map: Record<string, Variant> = {
    missing: 'danger',
    submitted: 'info',
    under_review: 'warning',
    approved: 'success',
    rejected: 'danger',
  }
  return <Badge variant={map[status] ?? 'default'}>{status.replace(/_/g, ' ')}</Badge>
}

export function projectStatusBadge(status: string) {
  const map: Record<string, Variant> = {
    planning: 'info',
    active: 'success',
    on_hold: 'warning',
    completed: 'ghost',
    cancelled: 'danger',
  }
  return <Badge variant={map[status] ?? 'default'}>{status.replace(/_/g, ' ')}</Badge>
}
