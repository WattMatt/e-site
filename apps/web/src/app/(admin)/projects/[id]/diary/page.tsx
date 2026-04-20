import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { projectService, diaryService, formatDate, ENTRY_TYPE_LABELS } from '@esite/shared'
import type { DiaryEntryType } from '@esite/shared'
import { AddDiaryEntryForm } from './AddDiaryEntryForm'

interface Props { params: Promise<{ id: string }> }

const ENTRY_TYPE_STYLES: Record<string, { color: string; bg: string }> = {
  progress:  { color: '#60a5fa', bg: 'rgba(37,99,235,0.15)' },
  safety:    { color: '#f87171', bg: 'rgba(127,29,29,0.25)' },
  quality:   { color: '#c084fc', bg: 'rgba(88,28,135,0.2)' },
  delay:     { color: 'var(--c-amber)', bg: 'var(--c-amber-dim)' },
  weather:   { color: '#38bdf8', bg: 'rgba(7,89,133,0.2)' },
  workforce: { color: '#34d399', bg: 'rgba(5,150,105,0.15)' },
  general:   { color: 'var(--c-text-mid)', bg: 'var(--c-elevated)' },
}

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
    <div className="animate-fadeup">
      <div style={{ marginBottom: 16 }}>
        <Link href={`/projects/${id}`} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}>
          ← {project.name}
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Site Diary</h1>
          <p className="page-subtitle">{entries.length} entr{entries.length === 1 ? 'y' : 'ies'}</p>
        </div>
        <AddDiaryEntryForm projectId={id} orgId={orgId} userId={user!.id} />
      </div>

      {entries.length === 0 ? (
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '48px 18px' }}>
            📓 No diary entries yet — record daily site progress, weather, and workforce
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {entries.map((entry: any) => {
            const entryType: string = entry.entry_type ?? 'progress'
            const typeStyle = ENTRY_TYPE_STYLES[entryType] ?? ENTRY_TYPE_STYLES.general
            const typeLabel = ENTRY_TYPE_LABELS[entryType as DiaryEntryType] ?? entryType

            return (
              <div key={entry.id} className="data-panel">
                <div className="data-panel-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                      fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', textTransform: 'uppercase',
                      color: typeStyle.color, background: typeStyle.bg,
                    }}>
                      {typeLabel}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    {entry.weather && (
                      <span style={{ fontSize: 11, color: 'var(--c-text-mid)', background: 'var(--c-elevated)', border: '1px solid var(--c-border)', borderRadius: 20, padding: '2px 8px' }}>
                        {entry.weather}
                      </span>
                    )}
                    {entry.workers_on_site != null && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                        {entry.workers_on_site} worker{entry.workers_on_site !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ padding: '14px 18px' }}>
                  <div style={{ marginBottom: 12 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text)', marginBottom: 2 }}>
                      {new Date(entry.entry_date).toLocaleDateString('en-ZA', {
                        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                      })}
                    </p>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                      Logged by {entry.author?.full_name ?? 'Unknown'} · {formatDate(entry.created_at)}
                    </p>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {entry.progress_notes && (
                      <div>
                        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#60a5fa', marginBottom: 4 }}>Progress</p>
                        <p style={{ fontSize: 13, color: 'var(--c-text)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{entry.progress_notes}</p>
                      </div>
                    )}
                    {entry.safety_notes && (
                      <div style={{ paddingTop: 10, borderTop: '1px solid var(--c-border)' }}>
                        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#f87171', marginBottom: 4 }}>Safety</p>
                        <p style={{ fontSize: 13, color: 'var(--c-text)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{entry.safety_notes}</p>
                      </div>
                    )}
                    {(entry.delays || entry.delay_notes) && (
                      <div style={{ paddingTop: 10, borderTop: '1px solid var(--c-border)' }}>
                        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-amber)', marginBottom: 4 }}>Delays</p>
                        <p style={{ fontSize: 13, color: 'var(--c-text)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{entry.delay_notes ?? entry.delays}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
