import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import type { HealthTier } from '@esite/shared'

// Phase 1 health dashboard. Lists every org the viewer is a member of, with
// its most recent snapshot from public.organisation_health_scores. RLS filters
// what the viewer can see; role gating (admin-only) lives at the layout
// level — Phase 1 scope assumes only admins reach this route.
//
// Spec: spec-v2.md §17, build-action-plan.md Session 3.

type TierFilter = HealthTier | 'all'

interface HealthRow {
  organisation_id: string
  score: number
  tier: HealthTier
  calculated_at: string
  signals: {
    login_recency?: { raw: number | null; normalized: number }
    compliance_activity?: { raw: number; normalized: number }
  }
  organisation?: { id: string; name: string } | null
}

const TIER_META: Record<HealthTier, { label: string; bg: string; fg: string; border: string }> = {
  green:  { label: 'Green',  bg: 'var(--c-green-dim)',  fg: 'var(--c-green)',  border: 'rgba(61,184,130,0.3)' },
  yellow: { label: 'Yellow', bg: 'var(--c-amber-dim)',  fg: 'var(--c-amber)',  border: 'var(--c-amber-mid)' },
  orange: { label: 'Orange', bg: 'rgba(240,128,48,0.15)', fg: 'var(--c-orange)', border: 'rgba(240,128,48,0.35)' },
  red:    { label: 'Red',    bg: 'var(--c-red-dim)',    fg: 'var(--c-red)',    border: 'rgba(232,85,85,0.3)' },
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatLoginRecency(raw: number | null | undefined): string {
  if (raw === null || raw === undefined) return 'never'
  if (raw === 0) return 'today'
  if (raw === 1) return 'yesterday'
  return `${raw}d ago`
}

export default async function HealthDashboardPage(props: {
  searchParams: Promise<{ tier?: string }>
}) {
  const searchParams = await props.searchParams
  const tierFilter: TierFilter =
    searchParams.tier === 'green' || searchParams.tier === 'yellow' ||
    searchParams.tier === 'orange' || searchParams.tier === 'red'
      ? searchParams.tier
      : 'all'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Scope: only orgs where the viewer is an org_admin. Members of other roles
  // drop straight to an empty state — Phase 1 treats health as a founder tool.
  const { data: adminMemberships } = await (supabase as any)
    .from('user_organisations')
    .select('organisation_id, role')
    .eq('user_id', user!.id)
    .eq('is_active', true)
    .in('role', ['org_admin'])

  const adminOrgIds = ((adminMemberships ?? []) as Array<{ organisation_id: string }>)
    .map(m => m.organisation_id)

  // Pull the most recent snapshot per org the viewer admins. A window function
  // would be cleaner, but Supabase REST can't express it; grab the latest 500
  // rows sorted DESC and dedupe in TS. Fine for Phase 1 volumes.
  let rows: HealthRow[] = []
  if (adminOrgIds.length > 0) {
    const { data } = await (supabase as any)
      .from('organisation_health_scores')
      .select('organisation_id, score, tier, calculated_at, signals, organisation:organisations!organisation_id(id, name)')
      .in('organisation_id', adminOrgIds)
      .order('calculated_at', { ascending: false })
      .limit(500)

    const seen = new Set<string>()
    for (const row of (data ?? []) as HealthRow[]) {
      if (seen.has(row.organisation_id)) continue
      seen.add(row.organisation_id)
      rows.push(row)
    }
  }

  if (tierFilter !== 'all') rows = rows.filter(r => r.tier === tierFilter)
  rows.sort((a, b) => a.score - b.score)

  const counts: Record<HealthTier, number> = { green: 0, yellow: 0, orange: 0, red: 0 }
  for (const r of rows) counts[r.tier] += 1

  return (
    <div className="animate-fadeup">
      <div className="page-header">
        <div>
          <h1 className="page-title">Organisation health</h1>
          <p className="page-subtitle">
            Phase 1: login recency (60%) + compliance activity (40%). Sorted worst first.
          </p>
        </div>
      </div>

      {/* Tier filter pills */}
      <div className="animate-fadeup animate-fadeup-1" style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <TierPill href="/admin/health"             active={tierFilter === 'all'}    label="All"    count={rows.length} />
        <TierPill href="/admin/health?tier=red"    active={tierFilter === 'red'}    label="Red"    count={counts.red}    tier="red" />
        <TierPill href="/admin/health?tier=orange" active={tierFilter === 'orange'} label="Orange" count={counts.orange} tier="orange" />
        <TierPill href="/admin/health?tier=yellow" active={tierFilter === 'yellow'} label="Yellow" count={counts.yellow} tier="yellow" />
        <TierPill href="/admin/health?tier=green"  active={tierFilter === 'green'}  label="Green"  count={counts.green}  tier="green" />
      </div>

      <div className="data-panel animate-fadeup animate-fadeup-2">
        {rows.length === 0 ? (
          <div className="data-panel-empty">
            {adminOrgIds.length === 0
              ? 'No organisations to report. Health scores appear once you admin at least one org with active projects and the daily cron has run.'
              : tierFilter === 'all'
                ? 'No health snapshots yet. The daily cron populates this table at 02:00 SAST.'
                : `No organisations in the ${tierFilter.toUpperCase()} tier right now.`}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--c-border)', textAlign: 'left' }}>
                <Th>Organisation</Th>
                <Th>Score</Th>
                <Th>Tier</Th>
                <Th>Last login</Th>
                <Th>COCs 30d</Th>
                <Th>Updated</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const meta = TIER_META[row.tier]
                return (
                  <tr key={row.organisation_id} style={{ borderBottom: '1px solid var(--c-border)' }}>
                    <Td>
                      <Link
                        href={`/settings/team?org=${row.organisation_id}`}
                        style={{ color: 'var(--c-text)', textDecoration: 'none', fontWeight: 600 }}
                      >
                        {row.organisation?.name ?? row.organisation_id.slice(0, 8)}
                      </Link>
                    </Td>
                    <Td>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 14 }}>
                        {row.score}
                      </span>
                    </Td>
                    <Td>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '3px 8px',
                          borderRadius: 4,
                          background: meta.bg,
                          color: meta.fg,
                          border: `1px solid ${meta.border}`,
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: '0.05em',
                          textTransform: 'uppercase',
                        }}
                      >
                        {meta.label}
                      </span>
                    </Td>
                    <Td style={{ color: 'var(--c-text-mid)' }}>
                      {formatLoginRecency(row.signals?.login_recency?.raw)}
                    </Td>
                    <Td style={{ color: 'var(--c-text-mid)' }}>
                      {row.signals?.compliance_activity?.raw ?? 0}
                    </Td>
                    <Td style={{ color: 'var(--c-text-dim)', fontSize: 12 }}>
                      {formatRelative(row.calculated_at)}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        padding: '10px 12px',
        fontSize: 10,
        fontWeight: 700,
        color: 'var(--c-text-dim)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        fontFamily: 'var(--font-mono)',
      }}
    >
      {children}
    </th>
  )
}

function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <td style={{ padding: '12px', fontSize: 13, ...style }}>{children}</td>
  )
}

function TierPill({
  href, active, label, count, tier,
}: {
  href: string
  active: boolean
  label: string
  count: number
  tier?: HealthTier
}) {
  const meta = tier ? TIER_META[tier] : null
  return (
    <Link
      href={href}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        borderRadius: 999,
        border: `1px solid ${active ? (meta?.border ?? 'var(--c-amber)') : 'var(--c-border)'}`,
        background: active ? (meta?.bg ?? 'var(--c-elevated)') : 'transparent',
        color: active ? (meta?.fg ?? 'var(--c-text)') : 'var(--c-text-mid)',
        fontSize: 12,
        fontWeight: 600,
        textDecoration: 'none',
      }}
    >
      {label}
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, opacity: 0.75 }}>{count}</span>
    </Link>
  )
}
