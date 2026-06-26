import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { rfiService, formatDate, formatRelative } from '@esite/shared'
import { RfiRespondForm } from './RfiRespondForm'
import { RfiCloseButton } from './RfiCloseButton'
import { fetchAttachments } from '@/components/attachments/fetch'
import { AttachmentGallery } from '@/components/attachments/AttachmentGallery'
import { ExportMarkupButton } from '@/components/markup/ExportMarkupButton'

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ projectId?: string }>
}

const priorityClass = (p: string) => ({
  critical: 'priority-critical',
  high:     'priority-high',
  medium:   'priority-medium',
  low:      'priority-low',
}[p] ?? 'priority-low')

const rfiBadge = (s: string) => ({
  draft:     'badge badge-muted',
  open:      'badge badge-red',
  responded: 'badge badge-amber',
  closed:    'badge badge-green',
}[s] ?? 'badge badge-muted')

export default async function RfiDetailPage({ params, searchParams }: Props) {
  const { id } = await params
  const { projectId } = await searchParams
  const supabase = await createClient()

  const [rfi, projectRow] = await Promise.all([
    rfiService.getById(supabase as any, id).catch(() => null),
    projectId
      ? supabase.schema('projects').from('projects').select('id, name').eq('id', projectId).single().then(r => r.data)
      : Promise.resolve(null),
  ])

  if (!rfi) notFound()

  const raisedBy = (rfi as any).raised_by_profile as any
  const assignedTo = (rfi as any).assigned_to_profile as any
  const responses = (rfi as any).rfi_responses as any[] ?? []
  const rfiProjectId = (rfi as any).project_id as string

  // Load attachments for the RFI + each response in parallel.
  const [rfiAttachments, ...responseAttachments] = await Promise.all([
    fetchAttachments(supabase as any, 'rfi', id),
    ...responses.map((r: any) => fetchAttachments(supabase as any, 'rfi_response', r.id)),
  ])

  // Drawing markups attached to this RFI (for re-edit).
  const { data: annotationsRaw } = await (supabase as any)
    .from('rfi_annotations')
    .select('id, source_floor_plan_id, attachment_id, created_at, attachments:attachment_id(file_path)')
    .eq('rfi_id', id)
    .order('created_at', { ascending: false })
  const annotations: Array<{
    id: string
    sourceFloorPlanId: string | null
    createdAt: string
    thumbnailUrl: string | null
  }> = await Promise.all(
    ((annotationsRaw ?? []) as any[]).map(async (a) => {
      const filePath = a.attachments?.file_path as string | undefined
      let thumbnailUrl: string | null = null
      if (filePath) {
        const { data } = await supabase.storage
          .from('rfi-attachments')
          .createSignedUrl(filePath, 3600)
        thumbnailUrl = data?.signedUrl ?? null
      }
      return {
        id: a.id,
        sourceFloorPlanId: a.source_floor_plan_id,
        createdAt: a.created_at,
        thumbnailUrl,
      }
    }),
  )

  const { data: { user: viewer } } = await supabase.auth.getUser()
  const canEdit = !!viewer

  const backHref = projectId ? `/projects/${projectId}` : '/rfis'
  const backLabel = projectId ? `← ${projectRow?.name ?? 'Project'}` : '← RFIs'

  return (
    <div className="animate-fadeup" style={{ maxWidth: 760 }}>
      {/* Breadcrumb */}
      <div style={{ marginBottom: 16, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)' }}>
        <Link href={backHref} style={{ color: 'var(--c-text-dim)', textDecoration: 'none' }}>{backLabel}</Link>
      </div>

      {/* Header */}
      <div className="page-header" style={{ alignItems: 'flex-start', marginBottom: 20 }}>
        <h1 className="page-title" style={{ flex: 1 }}>{rfi.subject}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, paddingTop: 4 }}>
          <span className={priorityClass(rfi.priority)} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            {rfi.priority}
          </span>
          <span className={rfiBadge(rfi.status)}>{rfi.status}</span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Original RFI */}
        <div className="data-panel">
          <div className="data-panel-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: 'var(--c-blue-dim)', border: '1px solid var(--c-blue)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: 'var(--c-blue)', flexShrink: 0,
              }}>
                {raisedBy?.full_name?.[0] ?? '?'}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>{raisedBy?.full_name}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>{formatRelative(rfi.created_at)}</div>
              </div>
            </div>
            {rfi.due_date && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>Due {formatDate(rfi.due_date)}</span>
            )}
          </div>
          <div style={{ padding: '14px 18px' }}>
            <p style={{ fontSize: 13, color: 'var(--c-text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{rfi.description}</p>
            {rfi.category && (
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 10 }}>Category: {rfi.category}</p>
            )}
            {rfiAttachments.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <AttachmentGallery
                  attachments={rfiAttachments}
                  canEdit={canEdit}
                  projectId={rfiProjectId}
                />
              </div>
            )}
          </div>
        </div>

        {/* Drawing markups */}
        {annotations.length > 0 && (
          <div className="data-panel">
            <div className="data-panel-header">
              <span className="data-panel-title">Drawing markups</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                {annotations.length}
              </span>
            </div>
            <div style={{ padding: '14px 18px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
              {annotations.map((a) => (
                <div
                  key={a.id}
                  style={{
                    border: '1px solid var(--c-border)',
                    borderRadius: 6,
                    overflow: 'hidden',
                    background: 'var(--c-base)',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <div
                    style={{
                      height: 140,
                      background: 'var(--c-elevated)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                      borderBottom: '1px solid var(--c-border)',
                    }}
                  >
                    {a.thumbnailUrl ? (
                      <img
                        src={a.thumbnailUrl}
                        alt="Markup"
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      />
                    ) : (
                      <span style={{ fontSize: 28 }} aria-hidden="true">🗺️</span>
                    )}
                  </div>
                  <div style={{ padding: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                      {formatRelative(a.createdAt)}
                    </span>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <ExportMarkupButton annotationId={a.id} />
                      {a.sourceFloorPlanId && rfiProjectId && canEdit ? (
                        <Link
                          href={`/projects/${rfiProjectId}/floor-plans/${a.sourceFloorPlanId}?annotation=${a.id}`}
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 10,
                            letterSpacing: '0.06em',
                            color: 'var(--c-amber)',
                            textDecoration: 'none',
                            padding: '4px 8px',
                            borderRadius: 4,
                            border: '1px solid var(--c-border)',
                          }}
                        >
                          Edit ↗
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Responses */}
        {responses.map((r: any, idx: number) => (
          <div key={r.id} className="data-panel" style={{ marginLeft: 20, borderLeft: '3px solid var(--c-blue)' }}>
            <div className="data-panel-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: 'var(--c-green-dim)', border: '1px solid var(--c-green)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: 'var(--c-green)', flexShrink: 0,
                }}>
                  {r.responder?.full_name?.[0] ?? '?'}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>{r.responder?.full_name}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>{formatRelative(r.created_at)}</div>
                </div>
              </div>
            </div>
            <div style={{ padding: '14px 18px' }}>
              <p style={{ fontSize: 13, color: 'var(--c-text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{r.body}</p>
              {responseAttachments[idx] && responseAttachments[idx]!.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <AttachmentGallery
                    attachments={responseAttachments[idx]!}
                    canEdit={canEdit}
                    projectId={rfiProjectId}
                  />
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Respond */}
        {rfi.status !== 'closed' && (
          <div className="data-panel">
            <div className="data-panel-header">
              <span className="data-panel-title">{responses.length === 0 ? 'Respond to RFI' : 'Add follow-up'}</span>
            </div>
            <div style={{ padding: '14px 18px' }}>
              <RfiRespondForm rfiId={id} />
            </div>
          </div>
        )}

        {/* Meta + close */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 }}>
          <div style={{ display: 'flex', gap: 20, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
            {assignedTo && (
              <span>Assigned to <span style={{ color: 'var(--c-text)' }}>{assignedTo.full_name}</span></span>
            )}
            <span>Raised <span style={{ color: 'var(--c-text)' }}>{formatDate(rfi.created_at)}</span></span>
            {rfi.closed_at && (
              <span>Closed <span style={{ color: 'var(--c-text)' }}>{formatDate(rfi.closed_at)}</span></span>
            )}
          </div>
          {rfi.status !== 'closed' && <RfiCloseButton rfiId={id} />}
        </div>
      </div>
    </div>
  )
}
