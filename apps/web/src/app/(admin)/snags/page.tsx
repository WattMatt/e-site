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

  const snags = membership
    ? await snagService.listByOrg(supabase as any, membership.organisation_id, { status, priority })
    : []

  const STATUSES = ['open', 'in_progress', 'resolved', 'pending_sign_off', 'signed_off', 'closed']
  const PRIORITIES = ['critical', 'high', 'medium', 'low']

  return (
    <div>
      <PageHeader title="Snags" subtitle={`${snags.length} snag${snags.length !== 1 ? 's' : ''}`} />

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Link
          href="/snags"
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${!status ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}
        >
          All
        </Link>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/snags?status=${s}`}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${status === s ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}
          >
            {s.replace(/_/g, ' ')}
          </Link>
        ))}
        <span className="w-px bg-slate-700 mx-1" />
        {PRIORITIES.map((p) => (
          <Link
            key={p}
            href={`/snags?priority=${p}`}
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
