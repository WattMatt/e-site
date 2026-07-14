import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import {
  projectService,
  qcService,
  formatDate,
  QC_WRITE_ROLES,
  ORG_WRITE_ROLES,
} from '@esite/shared'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { AddQcEntryForm } from './AddQcEntryForm'
import { QcEntryCard, type QcEntryView } from './QcEntryCard'
import { QcReportsSection } from './QcReportsSection'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  params: Promise<{ id: string; reportId: string }>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const statusBadge = (s: string) =>
  ({
    draft: 'badge badge-muted',
    issued: 'badge badge-green',
    closed: 'badge badge-blue',
  }[s] ?? 'badge badge-muted')

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function QcReportDetailPage({ params }: Props) {
  const { id: projectId, reportId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const currentUserId = user?.id ?? ''

  const project = await projectService.getById(supabase as any, projectId).catch(() => null)
  if (!project) notFound()

  // Cookie/RLS read is the visibility gate — drafts stay invisible to client
  // viewers (00172), cross-tenant ids return nothing. Never the service client.
  const report = await qcService.getById(supabase as never, reportId).catch(() => null)
  if (!report || report.project_id !== projectId) notFound()

  const [writeGate, manageGate] = await Promise.all([
    requireEffectiveRole(supabase, projectId, QC_WRITE_ROLES),
    requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES),
  ])
  const canWrite = writeGate.ok
  const canManage = manageGate.ok
  const isClosed = report.status === 'closed'

  const rawEntries = await qcService.listEntriesWithPhotos(supabase as never, reportId).catch(() => [])

  // 1h signed URLs for every entry photo, signed server-side and passed down
  // (diary pattern — client components never touch storage for reads).
  const photoPaths = rawEntries.flatMap((e: any) =>
    (e.qc_entry_photos ?? []).map((p: any) => p.file_path as string),
  )
  const signedUrls = photoPaths.length
    ? (await supabase.storage.from('qc-report-entries').createSignedUrls(photoPaths, 3600)).data ?? []
    : []
  const urlByPath = new Map(signedUrls.map((s) => [s.path, s.signedUrl]))

  const entries: QcEntryView[] = rawEntries.map((e: any, i: number) => ({
    id: e.id,
    number: i + 1,
    title: e.title,
    description: e.description ?? null,
    createdBy: e.created_by,
    createdAt: e.created_at,
    authorName: e.author?.full_name ?? e.author?.email ?? null,
    photos: (e.qc_entry_photos ?? []).map((p: any, j: number) => ({
      id: p.id,
      index: j + 1,
      url: urlByPath.get(p.file_path) ?? '',
      fileName: p.file_name ?? null,
      caption: p.caption ?? null,
      kind: p.kind === 'markup' ? 'markup' : 'photo',
      uploadedBy: p.uploaded_by,
    })),
    comments: (e.qc_comments ?? []).map((c: any) => ({
      id: c.id,
      body: c.body,
      createdAt: c.created_at,
      createdBy: c.created_by,
      authorName: c.author?.full_name ?? c.author?.email ?? null,
      photoId: c.photo_id ?? null,
    })),
  }))

  return (
    <div className="animate-fadeup" style={{ maxWidth: 900 }}>
      {/* Breadcrumb */}
      <div
        style={{
          marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)',
        }}
      >
        <Link href={`/projects/${projectId}`} style={{ color: 'var(--c-text-dim)', textDecoration: 'none' }}>
          {(project as any).name}
        </Link>
        <span>/</span>
        <Link href={`/projects/${projectId}/quality-control`} style={{ color: 'var(--c-text-dim)', textDecoration: 'none' }}>
          Quality Control
        </Link>
        <span>/</span>
        <span style={{ color: 'var(--c-text-mid)' }}>QC-{report.report_no}</span>
      </div>

      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {report.title}
            <span className={statusBadge(report.status)}>{report.status}</span>
          </h1>
          <p className="page-subtitle">
            QC-{report.report_no}
            {report.raised_by_profile?.full_name && <> · raised by {report.raised_by_profile.full_name}</>}
            {report.inspection_date && <> · inspected {formatDate(report.inspection_date)}</>}
            {report.location && <> · {report.location}</>}
            {report.status === 'issued' && report.issued_at && (
              <> · issued {formatDate(report.issued_at)}{report.issued_by_profile?.full_name ? ` by ${report.issued_by_profile.full_name}` : ''}</>
            )}
          </p>
        </div>
      </div>

      {report.description && (
        <p style={{ fontSize: 13, color: 'var(--c-text)', whiteSpace: 'pre-wrap', lineHeight: 1.6, marginBottom: 16 }}>
          {report.description}
        </p>
      )}

      {/* Issue + saved reports */}
      <div style={{ marginBottom: 20 }}>
        <QcReportsSection
          projectId={projectId}
          reportId={reportId}
          status={report.status}
          canManage={canManage}
        />
      </div>

      {/* Entries */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {entries.length === 0 ? (
          <div className="data-panel">
            <div className="data-panel-empty" style={{ padding: '38px 18px' }}>
              📷 No entries yet — add a group of photos or a drawing markup
            </div>
          </div>
        ) : (
          entries.map((entry) => (
            <QcEntryCard
              key={entry.id}
              entry={entry}
              canWrite={canWrite}
              canManage={canManage}
              currentUserId={currentUserId}
              isClosed={isClosed}
            />
          ))
        )}
      </div>

      {/* Add entry — hidden for read-only roles and on closed reports */}
      {canWrite && !isClosed && (
        <AddQcEntryForm
          projectId={projectId}
          reportId={reportId}
          orgId={report.organisation_id}
          userId={currentUserId}
        />
      )}
    </div>
  )
}
