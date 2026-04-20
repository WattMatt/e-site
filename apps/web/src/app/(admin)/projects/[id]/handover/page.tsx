import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { projectService } from '@esite/shared'
import { HandoverActions } from './HandoverActions'

const DEFAULT_ITEMS = [
  'All snags signed off',
  'COC issued and filed',
  'As-built drawings complete',
  'Client walkthrough completed',
  'Punch list cleared',
  'Warranties and manuals handed over',
  'Final invoice submitted',
  'Project photos archived',
]

interface Props { params: Promise<{ id: string }> }

export default async function HandoverPage({ params }: Props) {
  const { id } = await params
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

  const [project, { data: rawItems }] = await Promise.all([
    projectService.getById(supabase as any, id).catch(() => null),
    supabase
      .schema('projects')
      .from('handover_checklist')
      .select('*')
      .eq('project_id', id)
      .order('sort_order'),
  ])

  if (!project) notFound()

  let items = rawItems ?? []
  if (items.length === 0) {
    const { data: seeded } = await supabase
      .schema('projects')
      .from('handover_checklist')
      .insert(
        DEFAULT_ITEMS.map((item, i) => ({
          project_id: id,
          organisation_id: orgId,
          item,
          sort_order: i,
        }))
      )
      .select('*')
    items = seeded ?? []
  }

  const total = items.length
  const done = items.filter((i: any) => i.is_complete).length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  const barColor = pct === 100 ? '#22c55e' : 'var(--c-amber)'

  return (
    <div className="animate-fadeup">
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${id}`}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← {project.name}
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Handover Checklist</h1>
          <p className="page-subtitle">{done} / {total} complete</p>
        </div>
      </div>

      <div
        style={{
          background: 'var(--c-elevated)', borderRadius: 999,
          height: 6, overflow: 'hidden', marginBottom: 20,
          border: '1px solid var(--c-border)',
        }}
      >
        <div
          style={{
            width: `${pct}%`, height: '100%', background: barColor,
            transition: 'width 0.5s ease, background 0.3s ease',
          }}
        />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
          gap: 16,
        }}
      >
        <div className="data-panel">
          <div style={{ padding: '16px 18px' }}>
            <HandoverActions
              projectId={id}
              orgId={orgId}
              userId={user!.id}
              items={items as any}
            />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="data-panel">
            <div style={{ padding: '18px', textAlign: 'center' }}>
              <p style={{ fontSize: 36, fontWeight: 700, color: 'var(--c-text)', marginBottom: 2 }}>{pct}%</p>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Completion</p>
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: 'var(--c-text-dim)' }}>Complete</span>
                  <span style={{ color: '#4ade80', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{done}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: 'var(--c-text-dim)' }}>Remaining</span>
                  <span style={{ color: 'var(--c-amber)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{total - done}</span>
                </div>
              </div>
            </div>
          </div>

          {pct === 100 && (
            <div
              className="data-panel"
              style={{ background: 'rgba(34,197,94,0.08)', borderColor: 'rgba(34,197,94,0.3)' }}
            >
              <div style={{ padding: '18px', textAlign: 'center' }}>
                <p style={{ fontSize: 30, marginBottom: 6 }}>🎉</p>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#4ade80' }}>All items complete!</p>
                <p style={{ fontSize: 11, color: 'var(--c-text-dim)', marginTop: 4 }}>Project is ready for handover.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
