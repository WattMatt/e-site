import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { projectService, snagService, snagVisitService, formatDate } from '@esite/shared'
import { VisitList, type VisitRow } from './_components/VisitList'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ status?: string; view?: string }>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const priorityClass = (p: string) =>
  ({
    critical: 'priority-critical',
    high: 'priority-high',
    medium: 'priority-medium',
    low: 'priority-low',
  }[p] ?? 'priority-low')

const statusBadge = (s: string) =>
  ({
    open: 'badge badge-red',
    in_progress: 'badge badge-blue',
    pending_sign_off: 'badge badge-amber',
    resolved: 'badge badge-green',
    signed_off: 'badge badge-green',
    closed: 'badge badge-muted',
  }[s] ?? 'badge badge-muted')

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ProjectSnagsPage({ params, searchParams }: Props) {
  const { id: projectId } = await params
  const { status, view } = await searchParams

  // Default lens is 'visits'; only 'all' explicitly switches to the flat register.
  const lens = view === 'all' ? 'all' : 'visits'

  const supabase = await createClient()

  const project = await projectService.getById(supabase as any, projectId).catch(() => null)
  if (!project) notFound()

  // ── Resolve the current user (needed for VisitForm default + member list) ──
  // Must be above any conditional returns to keep async order consistent.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const currentUserId = user?.id ?? ''

  // ── Shared data: project members (resolved via service client for full names) ──
  // public.profiles RLS only returns the viewer's own row — service client needed.
  const serviceClient = createServiceClient() as any
  const memberRows: Array<{ user_id: string; full_name: string | null; email: string | null }> = []
  {
    const { data: pmRows } = await (supabase as any)
      .schema('projects')
      .from('project_members')
      .select('user_id')
      .eq('project_id', projectId)
      .eq('is_active', true)

    const userIds: string[] = (pmRows ?? []).map((r: any) => r.user_id as string)
    // Always include current user (org-level owners/admins may not be in project_members)
    if (currentUserId && !userIds.includes(currentUserId)) userIds.push(currentUserId)

    if (userIds.length > 0) {
      const { data: profiles } = await serviceClient
        .from('profiles')
        .select('id, full_name, email')
        .in('id', userIds)

      for (const p of profiles ?? []) {
        memberRows.push({ user_id: p.id, full_name: p.full_name, email: p.email })
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // BY-VISIT lens
  // ═══════════════════════════════════════════════════════════════════

  if (lens === 'visits') {
    // Use service client — reads from field.snag_visits which may not exist yet
    // (pre-migration). Graceful fallback to [] keeps the page load safe.
    const rawVisits = await snagVisitService
      .listVisits(serviceClient as never, projectId)
      .catch(() => [])

    // Build a name-lookup map from the already-fetched member profiles
    const nameMap = new Map<string, string | null>()
    for (const m of memberRows) nameMap.set(m.user_id, m.full_name ?? m.email ?? null)

    // Shape into VisitRow (conductedBy name resolved server-side)
    const visits: VisitRow[] = (rawVisits as any[]).map((v) => ({
      id: v.id as string,
      visit_no: v.visit_no as number,
      is_backlog: (v.is_backlog ?? false) as boolean,
      visit_date: v.visit_date as string,
      conducted_by: v.conducted_by as string | null,
      conducted_by_name: v.conducted_by ? (nameMap.get(v.conducted_by as string) ?? null) : null,
      title: v.title as string | null,
      newCount: (v.newCount ?? 0) as number,
      openCount: (v.openCount ?? 0) as number,
      closedCount: (v.closedCount ?? 0) as number,
    }))

    return (
      <div className="animate-fadeup">
        {/* Back breadcrumb */}
        <div style={{ marginBottom: 16 }}>
          <Link
            href={`/projects/${projectId}`}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--c-text-dim)',
              textDecoration: 'none',
              letterSpacing: '0.06em',
            }}
          >
            ← {project.name}
          </Link>
        </div>

        {/* Page header */}
        <div className="page-header">
          <div>
            <h1 className="page-title">Snags</h1>
            <p className="page-subtitle">{project.name}</p>
          </div>
        </div>

        {/* Lens toggle */}
        <LensToggle projectId={projectId} active="visits" />

        <VisitList
          projectId={projectId}
          visits={visits}
          currentUserId={currentUserId}
          members={memberRows}
        />
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════
  // ALL-SNAGS lens (existing flat register — kept intact)
  // ═══════════════════════════════════════════════════════════════════

  const allSnags = await snagService.list(supabase as any, projectId).catch(() => [])
  const snags = status ? allSnags.filter((s) => s.status === status) : allSnags

  const stats = allSnags.reduce((acc: Record<string, number>, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="animate-fadeup">
      {/* Back breadcrumb */}
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}`}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--c-text-dim)',
            textDecoration: 'none',
            letterSpacing: '0.06em',
          }}
        >
          ← {project.name}
        </Link>
      </div>

      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Snags</h1>
          <p className="page-subtitle">{project.name}</p>
        </div>
        <Link href={`/projects/${projectId}/snags/new`} className="btn-primary-amber">
          + New Snag
        </Link>
      </div>

      {/* Lens toggle */}
      <LensToggle projectId={projectId} active="all" />

      {/* Status filter pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
        <Link
          href={`/projects/${projectId}/snags?view=all`}
          className={`filter-tab${!status ? ' active' : ''}`}
        >
          All ({allSnags.length})
        </Link>
        {Object.entries(stats).map(([s, count]) => (
          <Link
            key={s}
            href={
              status === s
                ? `/projects/${projectId}/snags?view=all`
                : `/projects/${projectId}/snags?view=all&status=${s}`
            }
            className={`filter-tab${status === s ? ' active' : ''}`}
            style={{ textTransform: 'capitalize' }}
          >
            {s.replace(/_/g, ' ')} ({count})
          </Link>
        ))}
      </div>

      {snags.length === 0 ? (
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '48px 18px' }}>
            No snags{status ? ` with status "${status.replace(/_/g, ' ')}"` : ''} — all clear
          </div>
        </div>
      ) : (
        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">
              {status ? status.replace(/_/g, ' ') : 'All Snags'}
            </span>
            <span
              style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}
            >
              {snags.length} snag{snags.length !== 1 ? 's' : ''}
            </span>
          </div>
          {snags.map((snag) => {
            const raisedBy = (snag as any).raised_by_profile
            const assignedTo = (snag as any).assigned_to_profile
            return (
              <Link
                key={snag.id}
                href={`/snags/${snag.id}`}
                className="data-panel-row"
                style={{ alignItems: 'flex-start', gap: 12 }}
              >
                <span
                  className={priorityClass(snag.priority)}
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    marginTop: 3,
                    flexShrink: 0,
                    width: 32,
                  }}
                >
                  {snag.priority?.slice(0, 4) ?? '—'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--c-text)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {snag.title}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      color: 'var(--c-text-dim)',
                      marginTop: 3,
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '0 12px',
                    }}
                  >
                    {snag.location && <span>📍 {snag.location}</span>}
                    {raisedBy && <span>By {raisedBy.full_name}</span>}
                    {assignedTo && <span>→ {assignedTo.full_name}</span>}
                    <span>{formatDate(snag.created_at)}</span>
                  </div>
                </div>
                <span className={statusBadge(snag.status)} style={{ marginTop: 2 }}>
                  {snag.status.replace(/_/g, ' ')}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Lens Toggle ──────────────────────────────────────────────────────────────

function LensToggle({ projectId, active }: { projectId: string; active: 'visits' | 'all' }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        background: 'var(--c-panel)',
        border: '1px solid var(--c-border)',
        borderRadius: 8,
        padding: 3,
        marginBottom: 20,
      }}
    >
      <Link
        href={`/projects/${projectId}/snags`}
        style={{
          padding: '6px 18px',
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 600,
          fontFamily: 'var(--font-mono)',
          textDecoration: 'none',
          letterSpacing: '0.04em',
          transition: 'background 0.12s, color 0.12s',
          ...(active === 'visits'
            ? {
                background: 'var(--c-amber)',
                color: 'var(--c-on-amber)',
              }
            : {
                background: 'transparent',
                color: 'var(--c-text-dim)',
              }),
        }}
      >
        By visit
      </Link>
      <Link
        href={`/projects/${projectId}/snags?view=all`}
        style={{
          padding: '6px 18px',
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 600,
          fontFamily: 'var(--font-mono)',
          textDecoration: 'none',
          letterSpacing: '0.04em',
          transition: 'background 0.12s, color 0.12s',
          ...(active === 'all'
            ? {
                background: 'var(--c-amber)',
                color: 'var(--c-on-amber)',
              }
            : {
                background: 'transparent',
                color: 'var(--c-text-dim)',
              }),
        }}
      >
        All snags
      </Link>
    </div>
  )
}
