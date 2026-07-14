import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { projectService, qcService, QC_WRITE_ROLES, formatDate } from '@esite/shared'
import { requireEffectiveRole } from '@/lib/auth/require-role'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  params: Promise<{ id: string }>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const statusBadge = (s: string) =>
  ({
    draft: 'badge badge-muted',
    issued: 'badge badge-green',
    closed: 'badge badge-blue',
  }[s] ?? 'badge badge-muted')

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function QualityControlPage({ params }: Props) {
  const { id: projectId } = await params

  const supabase = await createClient()

  const project = await projectService.getById(supabase as any, projectId).catch(() => null)
  if (!project) notFound()

  // Write affordances (New report). Server actions re-gate every mutation.
  const gate = await requireEffectiveRole(supabase, projectId, QC_WRITE_ROLES)
  const canWrite = gate.ok

  // Graceful pre-migration window: code deploys via Vercel while 00172 applies
  // via deploy-migrations.yml — a missing-table error renders the empty state,
  // not a crash (same posture as the snags visit list).
  const reports = await qcService.listByProject(supabase as never, projectId).catch(() => [])

  return (
    <div className="animate-fadeup">
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}`}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← {(project as any).name}
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Quality Control</h1>
          <p className="page-subtitle">{reports.length} report{reports.length === 1 ? '' : 's'}</p>
        </div>
        {canWrite && (
          <Link href={`/projects/${projectId}/quality-control/new`} className="btn-primary-amber" style={{ textDecoration: 'none' }}>
            + New report
          </Link>
        )}
      </div>

      {reports.length === 0 ? (
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '48px 18px' }}>
            🛡️ No QC reports yet — capture photos and drawing markups, then issue a branded PDF to the project team
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {reports.map((report) => (
            <Link
              key={report.id}
              href={`/projects/${projectId}/quality-control/${report.id}`}
              className="data-panel"
              style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
            >
              <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--c-amber)', whiteSpace: 'nowrap' }}>
                  QC-{report.report_no}
                </span>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text)', marginBottom: 2 }}>
                    {report.title}
                  </p>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                    {report.entryCount} entr{report.entryCount === 1 ? 'y' : 'ies'} · {report.photoCount} photo{report.photoCount === 1 ? '' : 's'}
                    {report.inspection_date && <> · inspected {formatDate(report.inspection_date)}</>}
                    {report.raised_by_profile?.full_name && <> · raised by {report.raised_by_profile.full_name}</>}
                  </p>
                </div>
                <span className={statusBadge(report.status)}>{report.status}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
