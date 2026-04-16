/**
 * StatusBadge — shared status → colour/label mapping for snags, COCs, orders.
 * Platform-agnostic: returns metadata only. Each app renders with its own primitives.
 */

export type StatusVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'purple'

export interface StatusBadgeMeta {
  label: string
  variant: StatusVariant
  /** Tailwind CSS classes for web */
  webClasses: string
  /** React Native hex colour pair */
  nativeColors: { bg: string; text: string; border: string }
}

const BADGE_VARIANTS: Record<StatusVariant, { web: string; bg: string; text: string; border: string }> = {
  success: { web: 'bg-green-500/10 text-green-400 border-green-800',   bg: '#14532d44', text: '#4ade80', border: '#166534' },
  warning: { web: 'bg-amber-500/10 text-amber-400 border-amber-800',   bg: '#78350f44', text: '#fbbf24', border: '#92400e' },
  danger:  { web: 'bg-red-500/10 text-red-400 border-red-800',         bg: '#7f1d1d44', text: '#f87171', border: '#991b1b' },
  info:    { web: 'bg-blue-500/10 text-blue-400 border-blue-800',      bg: '#1e3a5f44', text: '#60a5fa', border: '#1e40af' },
  neutral: { web: 'bg-slate-700/50 text-slate-400 border-slate-600',   bg: '#33415544', text: '#94a3b8', border: '#475569' },
  purple:  { web: 'bg-purple-500/10 text-purple-400 border-purple-800', bg: '#3b0764aa', text: '#c084fc', border: '#6b21a8' },
}

function meta(label: string, variant: StatusVariant): StatusBadgeMeta {
  const v = BADGE_VARIANTS[variant]
  return {
    label,
    variant,
    webClasses: `text-xs px-2 py-0.5 rounded-full border font-medium ${v.web}`,
    nativeColors: { bg: v.bg, text: v.text, border: v.border },
  }
}

// ─── Snag status ─────────────────────────────────────────────────────────────
export const SNAG_STATUS_BADGE: Record<string, StatusBadgeMeta> = {
  open:            meta('Open', 'danger'),
  in_progress:     meta('In Progress', 'info'),
  pending_sign_off: meta('Pending Sign-off', 'warning'),
  resolved:        meta('Resolved', 'success'),
  signed_off:      meta('Signed Off', 'success'),
  closed:          meta('Closed', 'neutral'),
}

// ─── COC / compliance status ──────────────────────────────────────────────────
export const COC_STATUS_BADGE: Record<string, StatusBadgeMeta> = {
  missing:      meta('Missing', 'danger'),
  submitted:    meta('Submitted', 'info'),
  under_review: meta('Under Review', 'purple'),
  approved:     meta('Approved', 'success'),
  rejected:     meta('Rejected', 'danger'),
}

// ─── Order status ────────────────────────────────────────────────────────────
export const ORDER_STATUS_BADGE: Record<string, StatusBadgeMeta> = {
  draft:      meta('Draft', 'neutral'),
  submitted:  meta('Submitted', 'info'),
  confirmed:  meta('Confirmed', 'info'),
  in_transit: meta('In Transit', 'warning'),
  delivered:  meta('Delivered', 'success'),
  invoiced:   meta('Invoiced', 'purple'),
  cancelled:  meta('Cancelled', 'danger'),
}

// ─── Priority ────────────────────────────────────────────────────────────────
export const PRIORITY_BADGE: Record<string, StatusBadgeMeta> = {
  critical: meta('Critical', 'danger'),
  high:     meta('High', 'warning'),
  medium:   meta('Medium', 'info'),
  low:      meta('Low', 'neutral'),
}

export function getStatusBadge(
  type: 'snag' | 'coc' | 'order' | 'priority',
  status: string
): StatusBadgeMeta {
  const map = { snag: SNAG_STATUS_BADGE, coc: COC_STATUS_BADGE, order: ORDER_STATUS_BADGE, priority: PRIORITY_BADGE }
  return map[type][status] ?? meta(status, 'neutral')
}
