import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Site Diary' }
import { diaryService, ENTRY_TYPE_LABELS, formatDate } from '@esite/shared'
import type { DiaryEntryType } from '@esite/shared'

interface Props {
  searchParams: Promise<{
    dateFrom?: string
    dateTo?: string
    type?: string
    project?: string
  }>
}

const ENTRY_TYPE_STYLES: Record<string, { color: string; bg: string }> = {
  progress:  { color: '#60a5fa', bg: 'rgba(37,99,235,0.15)' },
  safety:    { color: '#f87171', bg: 'rgba(127,29,29,0.25)' },
  quality:   { color: '#c084fc', bg: 'rgba(88,28,135,0.2)' },
  delay:     { color: 'var(--c-amber)', bg: 'var(--c-amber-dim)' },
  weather:   { color: '#38bdf8', bg: 'rgba(7,89,133,0.2)' },
  workforce: { color: '#34d399', bg: 'rgba(5,150,105,0.15)' },
  general:   { color: 'var(--c-text-mid)', bg: 'var(--c-elevated)' },
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
    <div className="animate-fadeup">
      <div className="page-header">
        <div>
          <h1 className="page-title">Site Diary</h1>
          <p className="page-subtitle">{entries.length} entries{hasFilter ? ' (filtered)' : ''}</p>
        </div>
        <Link href="/diary/weekly" className="filter-tab">Weekly Summary</Link>
      </div>

      {/* Filters */}
      <form method="get" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20, alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label className="ob-label" style={{ margin: 0, whiteSpace: 'nowrap' }}>From</label>
          <input type="date" name="dateFrom" defaultValue={params.dateFrom ?? ''} className="ob-input" style={{ width: 'auto', padding: '6px 10px' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label className="ob-label" style={{ margin: 0, whiteSpace: 'nowrap' }}>To</label>
          <input type="date" name="dateTo" defaultValue={params.dateTo ?? ''} className="ob-input" style={{ width: 'auto', padding: '6px 10px' }} />
        </div>
        <select name="type" defaultValue={params.type ?? ''} className="ob-select" style={{ width: 'auto', padding: '6px 10px' }}>
          <option value="">All types</option>
          {Object.entries(ENTRY_TYPE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        {projectMap.size > 0 && (
          <select name="project" defaultValue={params.project ?? ''} className="ob-select" style={{ width: 'auto', padding: '6px 10px' }}>
            <option value="">All projects</option>
            {[...projectMap.entries()].map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        )}
        <button type="submit" className="btn-primary-amber" style={{ padding: '7px 14px', fontSize: 12 }}>Filter</button>
        {hasFilter && <Link href="/diary" className="filter-tab">Clear</Link>}
        <Link href={`/diary?dateFrom=${weekStart}&dateTo=${weekEnd}`} className="filter-tab">This week</Link>
      </form>

      {entries.length === 0 ? (
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '48px 18px' }}>
            📓 No diary entries {hasFilter ? 'match these filters' : 'yet — add them from project pages'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {entries.map((entry: any) => {
            const project = entry.project
            const entryType: string = entry.entry_type ?? 'progress'
            const typeStyle = ENTRY_TYPE_STYLES[entryType] ?? ENTRY_TYPE_STYLES.general
            const typeLabel = ENTRY_TYPE_LABELS[entryType as DiaryEntryType] ?? entryType

            return (
              <div key={entry.id} className="data-panel">
                <div className="data-panel-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                      fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', textTransform: 'uppercase',
                      color: typeStyle.color, background: typeStyle.bg,
                    }}>
                      {typeLabel}
                    </span>
                    {project && (
                      <Link
                        href={`/projects/${project.id}/diary`}
                        style={{ fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', fontFamily: 'var(--font-mono)' }}
                      >
                        {project.name}
                      </Link>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    {entry.weather && (
                      <span style={{ fontSize: 11, color: 'var(--c-text-mid)', background: 'var(--c-elevated)', border: '1px solid var(--c-border)', borderRadius: 20, padding: '2px 8px' }}>
                        {entry.weather}
                      </span>
                    )}
                    {entry.workers_on_site != null && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                        {entry.workers_on_site} workers
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ padding: '14px 18px' }}>
                  <div style={{ marginBottom: 10 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text)', marginBottom: 2 }}>
                      {new Date(entry.entry_date).toLocaleDateString('en-ZA', {
                        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                      })}
                    </p>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                      by {entry.author?.full_name ?? 'Unknown'} · {formatDate(entry.created_at)}
                    </p>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {entry.progress_notes && (
                      <div>
                        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#60a5fa', marginBottom: 4 }}>Progress</p>
                        <p style={{ fontSize: 13, color: 'var(--c-text)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                          {entry.progress_notes}
                        </p>
                      </div>
                    )}
                    {entry.safety_notes && (
                      <div style={{ paddingTop: 10, borderTop: '1px solid var(--c-border)' }}>
                        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#f87171', marginBottom: 4 }}>Safety</p>
                        <p style={{ fontSize: 13, color: 'var(--c-text)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                          {entry.safety_notes}
                        </p>
                      </div>
                    )}
                    {(entry.delays || entry.delay_notes) && (
                      <div style={{ paddingTop: 10, borderTop: '1px solid var(--c-border)' }}>
                        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-amber)', marginBottom: 4 }}>Delays</p>
                        <p style={{ fontSize: 13, color: 'var(--c-text)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                          {entry.delay_notes ?? entry.delays}
                        </p>
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
