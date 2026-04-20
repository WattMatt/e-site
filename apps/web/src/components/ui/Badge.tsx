import { type ReactNode } from 'react'
import { clsx } from 'clsx'

type Variant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'ghost'

const variants: Record<Variant, string> = {
  default: 'badge badge-muted',
  success: 'badge badge-green',
  warning: 'badge badge-amber',
  danger: 'badge badge-red',
  info: 'badge badge-blue',
  ghost: 'badge badge-muted',
}

interface BadgeProps {
  children: ReactNode
  variant?: Variant
  className?: string
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return <span className={clsx(variants[variant], className)}>{children}</span>
}

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
