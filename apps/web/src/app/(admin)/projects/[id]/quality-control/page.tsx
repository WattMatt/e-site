import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { projectService, qcService, QC_WRITE_ROLES, formatDate } from '@esite/shared'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { ConformanceTally, type ConformanceCounts } from './ConformanceBadge'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ status?: string; q?: string }>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const statusBadge = (s: string) =>
  ({
    draft: 'badge badge-muted',
    issued: 'badge badge-green',
    closed: 'badge badge-blue',
  }[s] ?? 'badge badge-muted')

const STATUS_TABS = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'issued', label: 'Issued' },
  { value: 'closed', label: 'Closed' },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function QualityControlPage({ params, searchParams }: Props) {
  const { id: projectId } = await params
  const { status: statusRaw, q: qRaw } = await searchParams
  // Only accept a known status; anything else is treated as "All".
  const status = ['draft', 'issued', 'closed'].includes(statusRaw ?? '') ? statusRaw : undefined
  const q = (qRaw ?? '').trim()
  const qLower = q.toLowerCase()

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

  // Per-report conformance tally (one project-scoped, RLS-bound read — cheap:
  // two indexed columns). Degrades to no tally pre-00176 (missing column).
  const tallyByReport = new Map<string, ConformanceCounts>()
  try {
    const { data: entryConf } = await (supabase as any)
      .schema('projects')
      .from('qc_entries')
      .select('report_id, conformance')
      .eq('project_id', projectId)
    for (const row of (entryConf ?? []) as Array<{ report_id: string; conformance: string }>) {
      const counts = tallyByReport.get(row.report_id) ?? { pass: 0, fail: 0, na: 0 }
      if (row.conformance === 'pass') counts.pass += 1
      else if (row.conformance === 'fail') counts.fail += 1
      else counts.na += 1
      tallyByReport.set(row.report_id, counts)
    }
  } catch {
    // No tally available (pre-migration) — rows just omit the conformance chips.
  }

  // Server-side status + text filter (report_no desc default preserved from
  // listByProject). Small per-project N, so an in-memory filter is fine —
  // listByProject has no filter args and is shared, so it isn't extended here.
  const filtered = reports.filter((r) => {
    if (status && r.status !== status) return false
    if (qLower) {
      const hay = `${r.title} ${r.location ?? ''}`.toLowerCase()
      if (!hay.includes(qLower)) return false
    }
    return true
  })

  const buildHref = (nextStatus?: string) => {
    const sp = new URLSearchParams()
    if (nextStatus) sp.set('status', nextStatus)
    if (q) sp.set('q', q)
    const qs = sp.toString()
    return `/projects/${projectId}/quality-control${qs ? `?${qs}` : ''}`
  }

  const isFiltering = !!status || !!q

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

      {/* Status filter + text search */}
      {reports.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 18 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {STATUS_TABS.map((t) => {
              const active = (t.value || undefined) === status
              return (
                <Link
                  key={t.value || 'all'}
                  href={buildHref(t.value || undefined)}
                  className={`filter-tab${active ? ' active' : ''}`}
                >
                  {t.label}
                </Link>
              )
            })}
          </div>
          <form method="get" style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
            {status && <input type="hidden" name="status" value={status} />}
            <label htmlFor="qc-search" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
              Search reports
            </label>
            <input
              id="qc-search"
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search title or location…"
              className="ob-input"
              style={{ width: 220 }}
            />
            <button
              type="submit"
              style={{
                whiteSpace: 'nowrap', fontSize: 12, fontWeight: 600, padding: '8px 14px',
                borderRadius: 6, border: '1px solid var(--c-border)', background: 'var(--c-panel)',
                color: 'var(--c-text-mid)', cursor: 'pointer',
              }}
            >
              Search
            </button>
          </form>
        </div>
      )}

      {reports.length === 0 ? (
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '48px 18px' }}>
            🛡️ No QC reports yet — capture photos and drawing markups, then issue a branded PDF to the project team
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '38px 18px' }}>
            No reports match this filter.{' '}
            <Link href={buildHref(undefined)} style={{ color: 'var(--c-amber)', textDecoration: 'underline' }}>
              Clear filters
            </Link>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {isFiltering && (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
              {filtered.length} result{filtered.length === 1 ? '' : 's'}
            </p>
          )}
          {filtered.map((report) => (
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
                    {report.location && <> · {report.location}</>}
                    {report.inspection_date && <> · inspected {formatDate(report.inspection_date)}</>}
                    {report.raised_by_profile?.full_name && <> · raised by {report.raised_by_profile.full_name}</>}
                  </p>
                </div>
                <ConformanceTally counts={tallyByReport.get(report.id) ?? { pass: 0, fail: 0, na: 0 }} />
                <span className={statusBadge(report.status)}>{report.status}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
