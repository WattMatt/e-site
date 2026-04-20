import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { projectService, floorPlanService } from '@esite/shared'
import { FloorPlanUploadButton } from './FloorPlanUploadButton'

interface Props { params: Promise<{ id: string }> }

function formatBytes(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default async function FloorPlansPage({ params }: Props) {
  const { id: projectId } = await params
  const supabase = await createClient()

  const [project, plans] = await Promise.all([
    projectService.getById(supabase as any, projectId).catch(() => null),
    floorPlanService.listByProject(supabase as any, projectId).catch(() => []),
  ])
  if (!project) notFound()

  const orgId = (project as any).organisation_id as string

  const plansWithUrls = await Promise.all(
    plans.map(async (plan) => {
      const isImage = /\.(png|jpe?g|webp|svg)$/i.test(plan.file_path)
      if (!isImage) return { ...plan, previewUrl: null }
      const { data } = await supabase.storage.from('drawings').createSignedUrl(plan.file_path, 3600)
      return { ...plan, previewUrl: data?.signedUrl ?? null }
    })
  )

  return (
    <div className="animate-fadeup">
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}`}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← {project.name}
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Floor Plans</h1>
          <p className="page-subtitle">{project.name} · {plansWithUrls.length} plan{plansWithUrls.length !== 1 ? 's' : ''}</p>
        </div>
        <FloorPlanUploadButton projectId={projectId} orgId={orgId} />
      </div>

      {plansWithUrls.length === 0 ? (
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '48px 18px' }}>
            🗺️ No floor plans yet — upload a drawing to start placing snags on the plan
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {plansWithUrls.map((plan) => (
            <div key={plan.id} className="data-panel" style={{ overflow: 'hidden' }}>
              <div
                style={{
                  height: 160, background: 'var(--c-base)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderBottom: '1px solid var(--c-border)', overflow: 'hidden',
                }}
              >
                {plan.previewUrl ? (
                  <img
                    src={plan.previewUrl}
                    alt={plan.name}
                    style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                  />
                ) : (
                  <span style={{ fontSize: 40 }} aria-hidden="true">📄</span>
                )}
              </div>
              <div style={{ padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {plan.name}
                    </p>
                    {plan.level && (
                      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2, letterSpacing: '0.04em' }}>
                        {plan.level}
                      </p>
                    )}
                    <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
                      {plan.scale && (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>Scale: {plan.scale}</span>
                      )}
                      {plan.file_size_bytes && (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>{formatBytes(plan.file_size_bytes)}</span>
                      )}
                    </div>
                  </div>
                  {plan.previewUrl && (
                    <a
                      href={plan.previewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em',
                        color: 'var(--c-amber)', textDecoration: 'none', whiteSpace: 'nowrap',
                        padding: '4px 8px', borderRadius: 4, border: '1px solid var(--c-border)',
                        background: 'var(--c-panel)',
                      }}
                    >
                      Open ↗
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
