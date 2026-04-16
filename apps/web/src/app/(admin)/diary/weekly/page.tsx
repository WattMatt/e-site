import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { diaryService, ENTRY_TYPE_LABELS } from '@esite/shared'
import { PageHeader } from '@/components/layout/Header'
import { Card, CardBody } from '@/components/ui/Card'
import { ReportButton } from '@/components/ui/ReportButton'

interface Props {
  searchParams: Promise<{ week?: string }>
}

function formatWeekLabel(weekStart: string, weekEnd: string) {
  const s = new Date(weekStart)
  const e = new Date(weekEnd)
  return `${s.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })} – ${e.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}`
}

function prevWeek(weekStart: string) {
  const d = new Date(weekStart)
  d.setUTCDate(d.getUTCDate() - 7)
  return d.toISOString().slice(0, 10)
}

function nextWeek(weekStart: string) {
  const d = new Date(weekStart)
  d.setUTCDate(d.getUTCDate() + 7)
  return d.toISOString().slice(0, 10)
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

export default async function WeeklyDiaryPage({ searchParams }: Props) {
  const { week } = await searchParams
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

  const { weekStart, weekEnd } = diaryService.getWeekBounds(week)
  const summary = await diaryService.getWeeklySummary(supabase as any, orgId, weekStart, weekEnd).catch(() => null)

  const isCurrentWeek = weekStart === diaryService.getWeekBounds().weekStart

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 text-sm text-slate-400">
        <Link href="/diary" className="hover:text-white">Diary</Link>
        <span>/</span>
        <span>Weekly Summary</span>
      </div>

      <PageHeader
        title="Weekly Summary"
        subtitle={formatWeekLabel(weekStart, weekEnd)}
        actions={
          <div className="flex items-center gap-2">
            <ReportButton type="diary-weekly" entityId={`${weekStart}:${weekEnd}`} label="↓ Export PDF" />
            <Link
              href={`/diary/weekly?week=${prevWeek(weekStart)}`}
              className="text-sm px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors"
            >
              ← Prev week
            </Link>
            {!isCurrentWeek && (
              <Link
                href={`/diary/weekly?week=${nextWeek(weekStart)}`}
                className="text-sm px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors"
              >
                Next week →
              </Link>
            )}
          </div>
        }
      />

      {!summary || summary.totalEntries === 0 ? (
        <div className="flex flex-col items-center py-24 gap-3 text-center">
          <div className="text-5xl">📭</div>
          <p className="text-white font-semibold">No entries this week</p>
          <p className="text-slate-400 text-sm">
            {formatWeekLabel(weekStart, weekEnd)}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total entries', value: summary.totalEntries, colour: 'text-white' },
              { label: 'Days active', value: `${summary.daysWithEntries}/7`, colour: 'text-blue-400' },
              { label: 'Avg workers / day', value: summary.avgWorkersPerDay, colour: 'text-emerald-400' },
              { label: 'Delay entries', value: summary.delayCount, colour: summary.delayCount > 0 ? 'text-amber-400' : 'text-slate-400' },
            ].map(({ label, value, colour }) => (
              <div key={label} className="bg-slate-800 border border-slate-700 rounded-xl p-4 text-center">
                <p className={`text-2xl font-bold ${colour}`}>{value}</p>
                <p className="text-xs text-slate-400 mt-1">{label}</p>
              </div>
            ))}
          </div>

          {/* Safety callout */}
          {summary.safetyIncidentCount > 0 && (
            <div className="bg-red-900/20 border border-red-700/40 rounded-xl px-4 py-3 text-sm text-red-400">
              {summary.safetyIncidentCount} safety-related {summary.safetyIncidentCount === 1 ? 'entry' : 'entries'} this week — review required.
            </div>
          )}

          {/* Project breakdown */}
          {summary.projectBreakdown.length > 0 && (
            <Card>
              <CardBody>
                <h3 className="text-sm font-semibold text-slate-300 mb-3">By Project</h3>
                <div className="space-y-2">
                  {summary.projectBreakdown
                    .sort((a, b) => b.entryCount - a.entryCount)
                    .map((proj) => (
                      <div key={proj.projectName} className="flex items-center justify-between">
                        <span className="text-sm text-white">{proj.projectName}</span>
                        <span className="text-sm text-slate-400">
                          {proj.entryCount} {proj.entryCount === 1 ? 'entry' : 'entries'}
                        </span>
                      </div>
                    ))}
                </div>
              </CardBody>
            </Card>
          )}

          {/* Entries grouped by day */}
          {(() => {
            const byDay = new Map<string, typeof summary.entries>()
            for (const entry of summary.entries) {
              const date = (entry as any).entry_date as string
              if (!byDay.has(date)) byDay.set(date, [])
              byDay.get(date)!.push(entry)
            }
            const sortedDays = [...byDay.keys()].sort((a, b) => b.localeCompare(a))

            return (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-slate-300">Entries</h3>
                {sortedDays.map((date) => (
                  <div key={date}>
                    <p className="text-xs text-slate-400 uppercase tracking-wider mb-2">
                      {new Date(date).toLocaleDateString('en-ZA', {
                        weekday: 'long', day: 'numeric', month: 'long',
                      })}
                    </p>
                    <div className="space-y-2 pl-3 border-l border-slate-700">
                      {byDay.get(date)!.map((entry: any) => {
                        const entryType: string = entry.entry_type ?? 'progress'
                        const typeColour = ENTRY_TYPE_COLOURS[entryType] ?? ENTRY_TYPE_COLOURS.general
                        const typeLabel = ENTRY_TYPE_LABELS[entryType as keyof typeof ENTRY_TYPE_LABELS] ?? entryType
                        const project = entry.project

                        return (
                          <Card key={entry.id}>
                            <div className="px-4 py-3">
                              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeColour}`}>
                                  {typeLabel}
                                </span>
                                {project && (
                                  <span className="text-xs text-slate-400">{project.name}</span>
                                )}
                                {entry.workers_on_site != null && (
                                  <span className="text-xs text-slate-500">
                                    {entry.workers_on_site} workers
                                  </span>
                                )}
                                {entry.weather && (
                                  <span className="text-xs text-slate-500">{entry.weather}</span>
                                )}
                              </div>
                              {entry.progress_notes && (
                                <p className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">
                                  {entry.progress_notes}
                                </p>
                              )}
                              {entry.safety_notes && (
                                <div className="mt-2 pt-2 border-t border-slate-700">
                                  <p className="text-xs text-red-400 uppercase tracking-wider mb-1">Safety</p>
                                  <p className="text-sm text-slate-300">{entry.safety_notes}</p>
                                </div>
                              )}
                              {(entry.delays || entry.delay_notes) && (
                                <div className="mt-2 pt-2 border-t border-slate-700">
                                  <p className="text-xs text-amber-400 uppercase tracking-wider mb-1">Delays</p>
                                  <p className="text-sm text-slate-300">{entry.delay_notes ?? entry.delays}</p>
                                </div>
                              )}
                              <p className="text-xs text-slate-600 mt-2">
                                {entry.author?.full_name ?? 'Unknown'}
                              </p>
                            </div>
                          </Card>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
