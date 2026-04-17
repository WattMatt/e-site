import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function NewSnagPickerPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: membership } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user!.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  const { data: projects } = membership
    ? await (supabase as any)
        .schema('projects')
        .from('projects')
        .select('id, name, city, status')
        .eq('organisation_id', membership.organisation_id)
        .eq('status', 'active')
        .order('name', { ascending: true })
    : { data: [] }

  // If only one project, redirect straight to its snag form
  if ((projects ?? []).length === 1) {
    redirect(`/projects/${projects![0].id}/snags/new`)
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ marginBottom: 24 }}>
        <Link
          href="/snags"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← Snags
        </Link>
      </div>

      <div className="page-header" style={{ marginBottom: 28 }}>
        <div>
          <h1 className="page-title">Raise Snag</h1>
          <p className="page-subtitle">Select a project to log the snag against</p>
        </div>
      </div>

      {(projects ?? []).length === 0 ? (
        <div
          style={{
            padding: '40px 24px',
            background: 'var(--c-panel)',
            border: '1px solid var(--c-border)',
            borderRadius: 8,
            textAlign: 'center',
          }}
        >
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', marginBottom: 16, letterSpacing: '0.06em' }}>
            No active projects found
          </div>
          <Link
            href="/projects/new"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '9px 16px', background: 'var(--c-amber)', color: '#0D0B09',
              borderRadius: 6, fontSize: 13, fontWeight: 700, textDecoration: 'none',
            }}
          >
            Create a Project First
          </Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(projects ?? []).map((p: any) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}/snags/new`}
              className="bracket-card"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 18px',
                background: 'var(--c-panel)',
                border: '1px solid var(--c-border)',
                borderRadius: 8,
                textDecoration: 'none',
                transition: 'all 0.15s',
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text)' }}>{p.name}</div>
                {p.city && (
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2, letterSpacing: '0.04em' }}>
                    {p.city}
                  </div>
                )}
              </div>
              <svg viewBox="0 0 16 16" fill="none" stroke="var(--c-text-dim)" strokeWidth="1.5" width="14" height="14">
                <path d="M6 4l4 4-4 4" />
              </svg>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
