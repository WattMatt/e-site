import { createClient } from '@/lib/supabase/server'
import { snagService } from '@esite/shared'
import { PageHeader } from '@/components/layout/Header'
import { EmptyState } from '@/components/ui/EmptyState'
import { snagStatusBadge, priorityBadge } from '@/components/ui/Badge'
import { formatDate } from '@esite/shared'
import Link from 'next/link'

interface Props {
  searchParams: Promise<{ status?: string; priority?: string }>
}

const STATUS_KPI = [
  { value: 'open', label: 'Open', colour: 'text-red-400', bg: 'border-red-700/40' },
  { value: 'in_progress', label: 'In Progress', colour: 'text-amber-400', bg: 'border-amber-700/40' },
  { value: 'pending_sign_off', label: 'Pending Sign-off', colour: 'text-purple-400', bg: 'border-purple-700/40' },
  { value: 'resolved', label: 'Resolved', colour: 'text-blue-400', bg: 'border-blue-700/40' },
  { value: 'signed_off', label: 'Signed Off', colour: 'text-emerald-400', bg: 'border-emerald-700/40' },
  { value: 'closed', label: 'Closed', colour: 'text-slate-400', bg: 'border-slate-600' },
]

const PRIORITIES = ['critical', 'high', 'medium', 'low']

export default async function SnagsPage({ searchParams }: Props) {
  const { status, priority } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: membership } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user!.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  // Fetch all snags for counts (unfiltered), then filtered for display
  const [allSnags, snags] = membership
    ? await Promise.all([
        snagService.listByOrg(supabase as any, membership.organisation_id),
        snagService.listByOrg(supabase as any, membership.organisation_id, { status, priority }),
      ])
    : [[], []]

  // Compute counts by status
  const statusCounts = STATUS_KPI.reduce<Record<string, number>>((acc, { value }) => {
    acc[value] = allSnags.filter((s) => s.status === value).length
    return acc
  }, {})

  return (
    <div>
      <PageHeader title="Snags" subtitle={`${allSnags.length} total`} />

      {/* KPI cards */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-6">
        {STATUS_KPI.map(({ value, label, colour, bg }) => (
          <Link
            key={value}
            href={status === value ? '/snags' : `/snags?status=${value}`}
            className={`bg-slate-800 border rounded-xl p-3 text-center transition-colors hover:border-slate-500 ${
              status === value ? bg : 'border-slate-700'
            }`}
          >
            <p className={`text-2xl font-bold ${colour}`}>{statusCounts[value] ?? 0}</p>
            <p className="text-xs text-slate-400 mt-1 leading-tight">{label}</p>
          </Link>
        ))}
      </div>

      {/* Priority filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Link
          href="/snags"
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${!status && !priority ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}
        >
          All priorities
        </Link>
        {PRIORITIES.map((p) => (
          <Link
            key={p}
            href={priority === p ? '/snags' : `/snags?priority=${p}`}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${priority === p ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}
          >
            {p}
          </Link>
        ))}
      </div>

      {snags.length === 0 ? (
        <EmptyState icon="⚠" title="No snags found" description="Snags raised in the field will appear here." />
      ) : (
        <div className="space-y-2">
          {snags.map((snag) => (
            <Link
              key={snag.id}
              href={`/snags/${snag.id}`}
              className="flex items-center gap-4 p-4 bg-slate-800 border border-slate-700 rounded-xl hover:border-slate-500 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-white truncate">{snag.title}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {(snag as any).project?.name} · {snag.location ?? 'No location'} · {formatDate(snag.created_at)}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {priorityBadge(snag.priority)}
                {snagStatusBadge(snag.status)}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
