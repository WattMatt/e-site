import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { snagService, formatDate, SLA_DEFAULTS } from '@esite/shared'
import { AlertTriangle } from 'lucide-react'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Snags' }

const STATUS_TABS = [
  { value: '',                label: 'All' },
  { value: 'open',            label: 'Open' },
  { value: 'in_progress',     label: 'In Progress' },
  { value: 'pending_sign_off',label: 'Pending Sign-off' },
  { value: 'resolved',        label: 'Resolved' },
  { value: 'signed_off',      label: 'Signed Off' },
  { value: 'closed',          label: 'Closed' },
]

const PRIORITIES = ['critical', 'high', 'medium', 'low']

const priorityClass = (p: string) => ({
  critical: 'priority-critical',
  high:     'priority-high',
  medium:   'priority-medium',
  low:      'priority-low',
}[p] ?? 'priority-low')

const statusBadge = (s: string) => ({
  open:             'badge badge-red',
  in_progress:      'badge badge-blue',
  pending_sign_off: 'badge badge-amber',
  resolved:         'badge badge-green',
  signed_off:       'badge badge-green',
  closed:           'badge badge-muted',
}[s] ?? 'badge badge-muted')

interface Props {
  searchParams: Promise<{ status?: string; priority?: string; filter?: string }>
}

export default async function SnagsPage({ searchParams }: Props) {
  const { status, priority, filter } = await searchParams
  const isAging = filter === 'aging'
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: membership } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user!.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  const [allSnags, snags] = membership
    ? await Promise.all([
        snagService.listByOrg(supabase as any, membership.organisation_id),
        snagService.listByOrg(supabase as any, membership.organisation_id, {
          status,
          priority,
          agingDays: isAging ? SLA_DEFAULTS.AGING_SNAG_DAYS : undefined,
        }),
      ])
    : [[], []]

  const statusCounts = STATUS_TABS.slice(1).reduce<Record<string, number>>((acc, { value }) => {
    acc[value] = allSnags.filter((s) => s.status === value).length
    return acc
  }, {})

  return (
    <div className="animate-fadeup">
      <div className="page-header">
        <div>
          <h1 className="page-title">Snags</h1>
          <p className="page-subtitle">{allSnags.length} total</p>
        </div>
        <Link href="/snags/new" className="btn-primary-amber">+ New Snag</Link>
      </div>

      {isAging && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '10px 14px', marginBottom: 16,
          backgroundColor: 'var(--c-amber-dim)', border: '1px solid var(--c-amber-mid)',
          borderRadius: 8,
        }}>
          <div style={{ fontSize: 13, color: 'var(--c-amber)' }}>
            Showing snags open longer than {SLA_DEFAULTS.AGING_SNAG_DAYS} days. {snags.length} match.
          </div>
          <Link
            href="/snags"
            style={{ fontSize: 12, color: 'var(--c-amber)', textDecoration: 'underline' }}
          >
            Clear filter
          </Link>
        </div>
      )}

      {/* Status KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 20 }}>
        {STATUS_TABS.slice(1).map(({ value, label }) => {
          const count = statusCounts[value] ?? 0
          const variant =
            value === 'open' ? 'kpi-danger' :
            value === 'in_progress' || value === 'pending_sign_off' ? 'kpi-warning' :
            value === 'signed_off' || value === 'resolved' ? 'kpi-success' : ''
          return (
            <Link
              key={value}
              href={status === value ? '/snags' : `/snags?status=${value}`}
              className={`kpi-card ${status === value ? variant || 'kpi-warning' : ''}`}
              style={{ textDecoration: 'none', cursor: 'pointer' }}
            >
              <div className="kpi-label">{label}</div>
              <div className={`kpi-value${count === 0 ? '' : ''}`} style={{ fontSize: 22 }}>{count}</div>
            </Link>
          )
        })}
      </div>

      {/* Priority filter pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
        <Link
          href={priority ? '/snags' : (status ? `/snags?status=${status}` : '/snags')}
          className={`filter-tab${!priority ? ' active' : ''}`}
        >
          All priorities
        </Link>
        {PRIORITIES.map((p) => (
          <Link
            key={p}
            href={priority === p
              ? (status ? `/snags?status=${status}` : '/snags')
              : (status ? `/snags?status=${status}&priority=${p}` : `/snags?priority=${p}`)
            }
            className={`filter-tab${priority === p ? ' active' : ''}`}
            style={{ textTransform: 'capitalize' }}
          >
            {p}
          </Link>
        ))}
      </div>

      {/* Snag list */}
      {snags.length === 0 ? (
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '48px 18px' }}>
            <AlertTriangle size={24} style={{ margin: '0 auto 12px', opacity: 0.3, display: 'block' }} />
            No snags found
          </div>
        </div>
      ) : (
        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">
              {status ? STATUS_TABS.find(t => t.value === status)?.label : 'All Snags'}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
              {snags.length} result{snags.length !== 1 ? 's' : ''}
            </span>
          </div>
          {snags.map((snag) => (
            <Link key={snag.id} href={`/snags/${snag.id}`} className="data-panel-row" style={{ gap: 12 }}>
              <span
                className={priorityClass(snag.priority)}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', flexShrink: 0, width: 32 }}
              >
                {snag.priority?.slice(0, 4) ?? '—'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {snag.title}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>
                  {(snag as any).project?.name ?? '—'}
                  {snag.location ? ` · ${snag.location}` : ''}
                  {` · ${formatDate(snag.created_at)}`}
                </div>
              </div>
              <span className={statusBadge(snag.status)}>
                {snag.status.replace(/_/g, ' ')}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
