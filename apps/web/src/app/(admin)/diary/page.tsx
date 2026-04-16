import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { diaryService, ENTRY_TYPE_LABELS, formatDate } from '@esite/shared'
import { PageHeader } from '@/components/layout/Header'
import { Card } from '@/components/ui/Card'
import type { DiaryEntryType } from '@esite/shared'

interface Props {
  searchParams: Promise<{
    dateFrom?: string
    dateTo?: string
    type?: string
    project?: string
  }>
}

const ENTRY_TYPE_COLOURS: Record<string, string> = {
  progress: 'bg-blue-900/30 text-blue-400',
  safety: 'bg-red-900/30 text-red-400',
  quality: 'bg-purple-900/30 text-purple-400',
  delay: 'bg-amber-900/30 text-amber-400',
  weather: 'bg-sky-900/30 text-sky-400',
  workforce: 'bg-emerald-900/30 text-emerald-400',
  general: 'bg-slate-700 text-slate-300',
}

export default async function DiaryListPage({ searchParams }: Props) {
  const params = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: mem } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user!.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  const orgId = mem?.organisation_id ?? ''

  const entries = await diaryService.listByOrg(supabase as any, orgId, {
    dateFrom: params.dateFrom || undefined,
    dateTo: params.dateTo || undefined,
    entryType: params.type as DiaryEntryType | undefined,
    projectId: params.project || undefined,
  }).catch(() => [])

  // Build project list for filter dropdown (from entries)
  const projectMap = new Map<string, string>()
  for (const e of entries) {
    const proj = (e as any).project
    if (proj?.id) projectMap.set(proj.id, proj.name)
  }

  // Current week as default date range hint
  const { weekStart, weekEnd } = diaryService.getWeekBounds()
  const hasFilter = params.dateFrom || params.dateTo || params.type || params.project

  return (
    <div>
      <PageHeader
        title="Site Diary"
        subtitle={`${entries.length} entries${hasFilter ? ' (filtered)' : ''}`}
        actions={
          <Link
            href="/diary/weekly"
            className="text-sm px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors"
          >
            Weekly Summary
          </Link>
        }
      />

      {/* Filters */}
      <form method="get" className="flex flex-wrap gap-3 mb-6">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400">From</label>
          <input
            type="date"
            name="dateFrom"
            defaultValue={params.dateFrom ?? ''}
            className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400">To</label>
          <input
            type="date"
            name="dateTo"
            defaultValue={params.dateTo ?? ''}
            className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
          />
        </div>
        <select
          name="type"
          defaultValue={params.type ?? ''}
          className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          <option value="">All types</option>
          {Object.entries(ENTRY_TYPE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        {projectMap.size > 0 && (
          <select
            name="project"
            defaultValue={params.project ?? ''}
            className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">All projects</option>
            {[...projectMap.entries()].map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        )}
        <button
          type="submit"
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
        >
          Filter
        </button>
        {hasFilter && (
          <Link
            href="/diary"
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm rounded-lg transition-colors"
          >
            Clear
          </Link>
        )}
        {/* Quick link to this week */}
        <Link
          href={`/diary?dateFrom=${weekStart}&dateTo=${weekEnd}`}
          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm rounded-lg transition-colors"
        >
          This week
        </Link>
      </form>

      {entries.length === 0 ? (
        <div className="flex flex-col items-center py-24 gap-3 text-center">
          <div className="text-5xl">📓</div>
          <p className="text-white font-semibold">No diary entries found</p>
          <p className="text-slate-400 text-sm">
            {hasFilter
              ? 'Try adjusting your filters.'
              : 'Diary entries are added from project pages.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry: any) => {
            const project = entry.project
            const entryType: string = entry.entry_type ?? 'progress'
            const typeColour = ENTRY_TYPE_COLOURS[entryType] ?? ENTRY_TYPE_COLOURS.general
            const typeLabel = ENTRY_TYPE_LABELS[entryType as DiaryEntryType] ?? entryType

            return (
              <Card key={entry.id}>
                <div className="px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeColour}`}>
                          {typeLabel}
                        </span>
                        {project && (
                          <Link
                            href={`/projects/${project.id}/diary`}
                            className="text-xs text-slate-400 hover:text-white transition-colors"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {project.name}
                          </Link>
                        )}
                      </div>
                      <p className="text-base font-semibold text-white">
                        {new Date(entry.entry_date).toLocaleDateString('en-ZA', {
                          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                        })}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        by {entry.author?.full_name ?? 'Unknown'} · {formatDate(entry.created_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {entry.weather && (
                        <span className="bg-slate-700 px-2.5 py-1 rounded-full text-xs text-slate-300">
                          {entry.weather}
                        </span>
                      )}
                      {entry.workers_on_site != null && (
                        <span className="text-xs text-slate-400">
                          {entry.workers_on_site} workers
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 space-y-2">
                    {entry.progress_notes && (
                      <div>
                        <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Progress</p>
                        <p className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed line-clamp-3">
                          {entry.progress_notes}
                        </p>
                      </div>
                    )}
                    {entry.safety_notes && (
                      <div className="pt-2 border-t border-slate-700">
                        <p className="text-xs text-red-400 uppercase tracking-wider mb-1">Safety</p>
                        <p className="text-sm text-slate-300 whitespace-pre-wrap line-clamp-2">
                          {entry.safety_notes}
                        </p>
                      </div>
                    )}
                    {(entry.delays || entry.delay_notes) && (
                      <div className="pt-2 border-t border-slate-700">
                        <p className="text-xs text-amber-400 uppercase tracking-wider mb-1">Delays</p>
                        <p className="text-sm text-slate-300 whitespace-pre-wrap line-clamp-2">
                          {entry.delay_notes ?? entry.delays}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
