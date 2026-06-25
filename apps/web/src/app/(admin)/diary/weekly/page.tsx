import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { diaryService, ENTRY_TYPE_LABELS } from '@esite/shared'
import { ReportButton } from '@/components/ui/ReportButton'

export const metadata: Metadata = { title: 'Weekly Summary' }

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

const ENTRY_TYPE_STYLES: Record<string, { color: string; bg: string }> = {
  progress:  { color: '#60a5fa',        bg: 'rgba(37,99,235,0.15)' },
  safety:    { color: '#f87171',        bg: 'rgba(127,29,29,0.25)' },
  quality:   { color: '#c084fc',        bg: 'rgba(88,28,135,0.2)' },
  delay:     { color: 'var(--c-amber)', bg: 'var(--c-amber-dim)' },
  weather:   { color: '#38bdf8',        bg: 'rgba(7,89,133,0.2)' },
  workforce: { color: '#34d399',        bg: 'rgba(5,150,105,0.15)' },
  general:   { color: 'var(--c-text-mid)', bg: 'var(--c-elevated)' },
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
    <div className="animate-fadeup">
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', letterSpacing: '0.06em' }}>
        <Link href="/diary" style={{ color: 'var(--c-text-dim)', textDecoration: 'none' }}>← Diary</Link>
        <span>/</span>
        <span>Weekly Summary</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Weekly Summary</h1>
          <p className="page-subtitle">{formatWeekLabel(weekStart, weekEnd)}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <ReportButton type="diary-weekly" entityId={`${weekStart}:${weekEnd}`} label="↓ Export PDF" />
          <Link href={`/diary/weekly?week=${prevWeek(weekStart)}`} className="filter-tab">← Prev week</Link>
          {!isCurrentWeek && (
            <Link href={`/diary/weekly?week=${nextWeek(weekStart)}`} className="filter-tab">Next week →</Link>
          )}
        </div>
      </div>

      {!summary || summary.totalEntries === 0 ? (
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '48px 18px' }}>
            📭 No entries for {formatWeekLabel(weekStart, weekEnd)}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* KPI strip */}
          <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            <div className="kpi-card">
              <div className="kpi-label">Total entries</div>
              <div className="kpi-value">{summary.totalEntries}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Days active</div>
              <div className="kpi-value">{summary.daysWithEntries}/7</div>
            </div>
            <div className="kpi-card kpi-success">
              <div className="kpi-label">Avg workers / day</div>
              <div className="kpi-value">{summary.avgWorkersPerDay}</div>
            </div>
            <div className={`kpi-card ${summary.delayCount > 0 ? 'kpi-warning' : ''}`}>
              <div className="kpi-label">Delay entries</div>
              <div className="kpi-value">{summary.delayCount}</div>
            </div>
          </div>

          {/* Safety callout */}
          {summary.safetyIncidentCount > 0 && (
            <div
              role="alert"
              style={{
                padding: '12px 16px', borderRadius: 8,
                background: 'rgba(127,29,29,0.22)', border: '1px solid #6b1e1e',
                color: 'var(--c-red)', fontSize: 13, fontWeight: 500,
              }}
            >
              {summary.safetyIncidentCount} safety-related {summary.safetyIncidentCount === 1 ? 'entry' : 'entries'} this week — review required.
            </div>
          )}

          {/* Project breakdown */}
          {summary.projectBreakdown.length > 0 && (
            <div className="data-panel">
              <div className="data-panel-header">
                <span className="data-panel-title">By Project</span>
              </div>
              <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {summary.projectBreakdown
                  .sort((a, b) => b.entryCount - a.entryCount)
                  .map((proj) => (
                    <div key={proj.projectName} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 13, color: 'var(--c-text)' }}>{proj.projectName}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)' }}>
                        {proj.entryCount} {proj.entryCount === 1 ? 'entry' : 'entries'}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-text-dim)', margin: 0 }}>
                  Entries
                </h2>
                {sortedDays.map((date) => (
                  <div key={date}>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--c-text-dim)', marginBottom: 8 }}>
                      {new Date(date).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' })}
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 12, borderLeft: '1px solid var(--c-border)' }}>
                      {byDay.get(date)!.map((entry: any) => {
                        const entryType: string = entry.entry_type ?? 'progress'
                        const typeStyle = ENTRY_TYPE_STYLES[entryType] ?? ENTRY_TYPE_STYLES.general
                        const typeLabel = ENTRY_TYPE_LABELS[entryType as keyof typeof ENTRY_TYPE_LABELS] ?? entryType
                        const project = entry.project

                        return (
                          <div key={entry.id} className="data-panel" style={{ padding: '12px 14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                              <span style={{
                                fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                                fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', textTransform: 'uppercase',
                                color: typeStyle.color, background: typeStyle.bg,
                              }}>
                                {typeLabel}
                              </span>
                              {project && (
                                <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>{project.name}</span>
                              )}
                              {entry.workers_on_site != null && (
                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                                  {entry.workers_on_site} workers
                                </span>
                              )}
                              {entry.weather && (
                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                                  {entry.weather}
                                </span>
                              )}
                            </div>
                            {entry.progress_notes && (
                              <p style={{ fontSize: 13, color: 'var(--c-text)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                                {entry.progress_notes}
                              </p>
                            )}
                            {entry.safety_notes && (
                              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--c-border)' }}>
                                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#f87171', marginBottom: 4 }}>Safety</p>
                                <p style={{ fontSize: 13, color: 'var(--c-text)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{entry.safety_notes}</p>
                              </div>
                            )}
                            {(entry.delays || entry.delay_notes) && (
                              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--c-border)' }}>
                                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-amber)', marginBottom: 4 }}>Delays</p>
                                <p style={{ fontSize: 13, color: 'var(--c-text)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{entry.delay_notes ?? entry.delays}</p>
                              </div>
                            )}
                            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 8 }}>
                              {entry.author?.full_name ?? 'Unknown'}
                            </p>
                          </div>
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
