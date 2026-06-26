import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { snagService, formatDate, formatRelative } from '@esite/shared'
import { SnagStatusForm } from './SnagStatusForm'
import { SnagPhotoGrid } from './SnagPhotoGrid'

interface Props { params: Promise<{ id: string }> }

const priorityClass = (p: string) => ({
  critical: 'priority-critical',
  high:     'priority-high',
  medium:   'priority-medium',
  low:      'priority-low',
}[p] ?? 'priority-low')

const snagBadge = (s: string) => ({
  open:             'badge badge-red',
  in_progress:      'badge badge-blue',
  pending_sign_off: 'badge badge-amber',
  resolved:         'badge badge-green',
  signed_off:       'badge badge-green',
  closed:           'badge badge-muted',
}[s] ?? 'badge badge-muted')

export default async function SnagDetailPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  const snag = await snagService.getById(supabase as any, id).catch(() => null)
  if (!snag) notFound()

  const project = snag.project as any
  const raisedBy = (snag as any).raised_by_profile as any
  const assignedTo = (snag as any).assigned_to_profile as any
  const signedOffBy = (snag as any).signed_off_by_profile as any
  const photos = (snag as any).snag_photos as any[] ?? []

  const photoUrls = await Promise.all(
    photos.map(async (p: any) => {
      const { data } = await supabase.storage.from('snag-photos').createSignedUrl(p.file_path, 3600)
      return { ...p, url: data?.signedUrl }
    })
  )

  // ── Resolve visit linkage (additive — Task 4.4) ──
  // Raised-on and closed-on visit IDs reference field.snag_visits.
  // Use service client — RLS on snag_visits requires org membership check.
  // Gracefully handle the case where 00120 is not yet applied (no snag_visits table).
  const raisedOnVisitId: string | null = (snag as any).raised_on_visit_id ?? null
  const closedOnVisitId: string | null = (snag as any).closed_on_visit_id ?? null

  let raisedOnVisitNo: number | null = null
  let closedOnVisitNo: number | null = null
  // visitMap is also used by the photo group label renderer below.
  const visitMap = new Map<string, { visit_no: number; is_backlog: boolean }>()

  const photoVisitIds = photoUrls.map((p: any) => p.visit_id).filter(Boolean) as string[]
  const allVisitIdsToFetch = [...new Set([
    raisedOnVisitId,
    closedOnVisitId,
    ...photoVisitIds,
  ].filter(Boolean) as string[])]

  if (allVisitIdsToFetch.length > 0) {
    try {
      const serviceClient = createServiceClient() as any
      const { data: visitRows } = await serviceClient
        .schema('field')
        .from('snag_visits')
        .select('id, visit_no, is_backlog')
        .in('id', allVisitIdsToFetch)
      for (const v of visitRows ?? []) visitMap.set(v.id, v)
      if (raisedOnVisitId) {
        const v = visitMap.get(raisedOnVisitId)
        raisedOnVisitNo = v?.is_backlog ? null : (v?.visit_no ?? null)
      }
      if (closedOnVisitId && closedOnVisitId !== raisedOnVisitId) {
        const v = visitMap.get(closedOnVisitId)
        closedOnVisitNo = v?.is_backlog ? null : (v?.visit_no ?? null)
      } else if (closedOnVisitId === raisedOnVisitId && raisedOnVisitNo !== null) {
        closedOnVisitNo = raisedOnVisitNo
      }
    } catch {
      // Graceful fallback: snag_visits table may not exist pre-migration 00120.
    }
  }

  // Group photos by visit_id for the Evidence Photos panel.
  // visit_id column added by 00120; null visit_id photos appear in "General" group.
  const photosByVisit = new Map<string | null, typeof photoUrls>()
  for (const p of photoUrls) {
    const key: string | null = p.visit_id ?? null
    if (!photosByVisit.has(key)) photosByVisit.set(key, [])
    photosByVisit.get(key)!.push(p)
  }
  // Determine if photos need grouping (>1 distinct visit_id, or any non-null visit_id)
  const hasVisitGroups = photosByVisit.size > 1 || (photosByVisit.size === 1 && !photosByVisit.has(null))

  return (
    <div className="animate-fadeup" style={{ maxWidth: 860 }}>
      {/* Breadcrumb */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)' }}>
        <Link href="/snags" style={{ color: 'var(--c-text-dim)', textDecoration: 'none' }}>← Snags</Link>
        {project && (
          <>
            <span>/</span>
            <Link href={`/projects/${project.id}`} style={{ color: 'var(--c-text-dim)', textDecoration: 'none' }}>{project.name}</Link>
          </>
        )}
      </div>

      {/* Header */}
      <div className="page-header" style={{ alignItems: 'flex-start', marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <h1 className="page-title" style={{ marginBottom: 6 }}>{snag.title}</h1>
          {snag.location && (
            <p className="page-subtitle">📍 {snag.location}</p>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, paddingTop: 4 }}>
          <span className={priorityClass(snag.priority)} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            {snag.priority}
          </span>
          <span className={snagBadge(snag.status)}>{snag.status.replace(/_/g, ' ')}</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16 }}>
        {/* Main column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Description */}
          {snag.description && (
            <div className="data-panel">
              <div className="data-panel-header">
                <span className="data-panel-title">Description</span>
              </div>
              <div style={{ padding: '14px 18px' }}>
                <p style={{ fontSize: 13, color: 'var(--c-text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{snag.description}</p>
              </div>
            </div>
          )}

          {/* Photos — grouped by visit if visit_id column is populated (00120+) */}
          {photoUrls.length > 0 && (
            <div className="data-panel">
              <div className="data-panel-header">
                <span className="data-panel-title">Evidence Photos</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>{photoUrls.length} photo{photoUrls.length !== 1 ? 's' : ''}</span>
              </div>
              <div style={{ padding: '14px 18px' }}>
                {hasVisitGroups ? (
                  // Grouped by visit — each group gets a small caption label.
                  Array.from(photosByVisit.entries()).map(([visitId, groupPhotos]) => {
                    const visitNo = visitId ? visitMap.get(visitId)?.visit_no : undefined
                    const groupLabel = visitId
                      ? `Site Visit ${visitNo ?? visitId.slice(0, 8)}`
                      : 'General'
                    return (
                      <div key={visitId ?? '__general'} style={{ marginBottom: 16 }}>
                        <div style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 9,
                          fontWeight: 600,
                          letterSpacing: '0.1em',
                          textTransform: 'uppercase',
                          color: 'var(--c-text-dim)',
                          marginBottom: 8,
                        }}>
                          {groupLabel}
                        </div>
                        <SnagPhotoGrid photos={groupPhotos} />
                      </div>
                    )
                  })
                ) : (
                  <SnagPhotoGrid photos={photoUrls} />
                )}
              </div>
            </div>
          )}

          {/* Status update */}
          <div className="data-panel">
            <div className="data-panel-header">
              <span className="data-panel-title">Update Status</span>
            </div>
            <div style={{ padding: '14px 18px' }}>
              <SnagStatusForm snagId={id} currentStatus={snag.status} projectId={project?.id ?? ''} />
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="data-panel">
            <div className="data-panel-header">
              <span className="data-panel-title">Details</span>
            </div>
            <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                ['Category', snag.category],
                ['Location', snag.location],
                ['Project', project?.name],
                ['Raised by', raisedBy?.full_name],
                ['Raised', formatRelative(snag.created_at)],
                ['Assigned to', assignedTo?.full_name ?? 'Unassigned'],
              ].filter(([, v]) => v).map(([label, value]) => (
                <div key={label as string}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-text-dim)', marginBottom: 2 }}>
                    {label}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--c-text)' }}>{value}</div>
                </div>
              ))}

              {snag.signed_off_at && (
                <div style={{ paddingTop: 10, borderTop: '1px solid var(--c-border)' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-text-dim)', marginBottom: 2 }}>
                    Signed off by
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--c-green)' }}>{signedOffBy?.full_name}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>{formatDate(snag.signed_off_at)}</div>
                </div>
              )}

              {/* Visit linkage — additive, rendered when 00120 is applied */}
              {raisedOnVisitId && (
                <div style={{ paddingTop: 10, borderTop: '1px solid var(--c-border)' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-text-dim)', marginBottom: 2 }}>
                    Raised on
                  </div>
                  {project?.id && raisedOnVisitId ? (
                    <Link
                      href={`/projects/${project.id}/snags/visits/${raisedOnVisitId}`}
                      style={{ fontSize: 13, color: 'var(--c-blue)', textDecoration: 'none' }}
                    >
                      {raisedOnVisitNo != null ? `Site Visit ${raisedOnVisitNo}` : 'Initial backlog'}
                    </Link>
                  ) : (
                    <div style={{ fontSize: 13, color: 'var(--c-text)' }}>
                      {raisedOnVisitNo != null ? `Site Visit ${raisedOnVisitNo}` : 'Initial backlog'}
                    </div>
                  )}
                </div>
              )}

              {closedOnVisitId && closedOnVisitId !== raisedOnVisitId && (
                <div style={{ paddingTop: 10, borderTop: '1px solid var(--c-border)' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-text-dim)', marginBottom: 2 }}>
                    Closed on
                  </div>
                  {project?.id && closedOnVisitId ? (
                    <Link
                      href={`/projects/${project.id}/snags/visits/${closedOnVisitId}`}
                      style={{ fontSize: 13, color: 'var(--c-green)', textDecoration: 'none' }}
                    >
                      {closedOnVisitNo != null ? `Site Visit ${closedOnVisitNo}` : 'Initial backlog'}
                    </Link>
                  ) : (
                    <div style={{ fontSize: 13, color: 'var(--c-text)' }}>
                      {closedOnVisitNo != null ? `Site Visit ${closedOnVisitNo}` : 'Initial backlog'}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <Link
            href={`/projects/${project?.id}/snags/new`}
            className="btn-primary-amber"
            style={{ textAlign: 'center', textDecoration: 'none' }}
          >
            + Raise another snag
          </Link>
        </div>
      </div>
    </div>
  )
}
