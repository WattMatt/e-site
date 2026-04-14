import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { projectService, diaryService, formatDate } from '@esite/shared'
import { PageHeader } from '@/components/layout/Header'
import { Card } from '@/components/ui/Card'
import { AddDiaryEntryForm } from './AddDiaryEntryForm'

interface Props { params: Promise<{ id: string }> }

export default async function DiaryPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: mem } = await supabase
    .from('user_organisations')
    .select('organisation_id, role')
    .eq('user_id', user!.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  const orgId = mem?.organisation_id ?? ''

  const [project, entries] = await Promise.all([
    projectService.getById(supabase as any, id).catch(() => null),
    diaryService.list(supabase as any, id).catch(() => []),
  ])

  if (!project) notFound()

  return (
    <div>
      <div className="mb-4">
        <Link href={`/projects/${id}`} className="text-slate-400 hover:text-white text-sm">
          ← {project.name}
        </Link>
      </div>

      <PageHeader
        title="Site Diary"
        subtitle={`${entries.length} entries`}
        actions={
          <AddDiaryEntryForm projectId={id} orgId={orgId} userId={user!.id} />
        }
      />

      {entries.length === 0 ? (
        <div className="flex flex-col items-center py-24 gap-3 text-center">
          <div className="text-5xl">📓</div>
          <p className="text-white font-semibold">No diary entries yet</p>
          <p className="text-slate-400 text-sm">Record daily site progress, weather, and workforce.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {entries.map((entry: any) => (
            <Card key={entry.id}>
              <div className="px-6 py-4">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <p className="text-base font-semibold text-white">
                      {new Date(entry.entry_date).toLocaleDateString('en-ZA', {
                        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                      })}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Logged by {entry.author?.full_name ?? 'Unknown'} · {formatDate(entry.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-slate-300 flex-shrink-0">
                    {entry.weather && (
                      <span className="bg-slate-700 px-2.5 py-1 rounded-full text-xs">{entry.weather}</span>
                    )}
                    {entry.workers_on_site != null && (
                      <span className="text-xs text-slate-400">
                        {entry.workers_on_site} worker{entry.workers_on_site !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <div>
                    <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Progress</p>
                    <p className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">
                      {entry.progress_notes}
                    </p>
                  </div>
                  {entry.delays && (
                    <div className="mt-3 pt-3 border-t border-slate-700">
                      <p className="text-xs text-amber-400 uppercase tracking-wider mb-1">Delays / Issues</p>
                      <p className="text-sm text-slate-300 whitespace-pre-wrap">{entry.delays}</p>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
