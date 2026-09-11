import {
  OWNER_ADMIN, METRIC_KEYS, METRIC_LABELS, METRIC_UNITS, METRIC_TARGET_Q1,
  RATIO_METRIC_KEYS, type MetricKey,
} from '@esite/shared'
import { requireRolePage } from '@/lib/auth/require-role'
import { createClient } from '@/lib/supabase/server'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'

export const dynamic = 'force-dynamic'

interface SnapshotRow {
  metric_key: MetricKey
  iso_year: number
  iso_week: number | null
  window_start: string
  window_end: string
  numerator: number | null
  denominator: number | null
  value: number | null
  status: 'measured' | 'censored' | 'unmeasurable' | 'not_yet_instrumented'
  is_baseline: boolean
  note: string | null
  detail: Record<string, unknown>
}

function present(row: SnapshotRow | undefined): string {
  if (!row || row.value === null) return '—'
  const n = Number(row.value)
  if (RATIO_METRIC_KEYS.has(row.metric_key)) return `${(n * 100).toFixed(1)}%`
  return `${n}${METRIC_UNITS[row.metric_key]}`
}

/**
 * Four status words go in the DATABASE, where the distinction is load-bearing.
 * On the page a reader experiences three of them as one thing — "you cannot
 * tell me yet" — so they render as two phrases and the `note` underneath
 * carries the actual reason. The note is doing the real work.
 */
function statusPhrase(s: SnapshotRow['status']): { label: string; variant: 'success' | 'warning' } {
  return s === 'measured'
    ? { label: 'measured', variant: 'success' }
    : { label: 'no honest number yet', variant: 'warning' }
}

function daysBetween(a: string, b: Date): number {
  return Math.floor((b.getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000)
}

export default async function MetricsPage() {
  // Gate one: the page does not render for anyone else.
  await requireRolePage(OWNER_ADMIN)

  // Gate two: read through the CALLER's session, so the RESTRICTIVE policy
  // calling public.user_is_org_admin() is exercised on every render. Never the
  // service client here — that would bypass the backstop this page exists to
  // demonstrate.
  const supabase = await createClient()
  const { data } = await (supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => { order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: SnapshotRow[] | null }> } }
    }
  })
    .from('platform_metrics_weekly')
    .select('*')
    .order('window_start', { ascending: false })
    .limit(200)

  const rows: SnapshotRow[] = data ?? []
  const baseline = new Map(rows.filter((r) => r.is_baseline).map((r) => [r.metric_key, r]))
  const weekly = rows.filter((r) => !r.is_baseline)
  const windows = [...new Set(weekly.map((r) => r.window_start))].sort().reverse()
  const latestWindow = windows[0] ?? null
  const priorWindow = windows[1] ?? null
  const latest = new Map(weekly.filter((r) => r.window_start === latestWindow).map((r) => [r.metric_key, r]))
  const prior = new Map(weekly.filter((r) => r.window_start === priorWindow).map((r) => [r.metric_key, r]))

  const staleDays = latestWindow ? daysBetween(latestWindow, new Date()) : null
  const isStale = staleDays !== null && staleDays > 8

  return (
    <div style={{ padding: 24, display: 'grid', gap: 16 }}>
      <div>
        <h1 style={{ margin: 0 }}>Adoption</h1>
        <p style={{ color: 'var(--c-text-dim)', marginTop: 4 }}>
          Computed in Postgres from first-party tables. Snapshots are append-only and are never rewritten;
          changing a definition writes new rows under a new method version. Method, bounds and every
          unmeasurable cell are recorded in <code>docs/metrics-baseline-2026-10.md</code>.
        </p>
      </div>

      {isStale ? (
        <Card>
          <CardBody>
            <strong>Last snapshot is {staleDays} days old.</strong>
            <p style={{ color: 'var(--c-text-dim)', marginTop: 6 }}>
              The <code>platform-metrics-weekly</code> job may not be running. Check it with{' '}
              <code>SELECT * FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = &apos;platform-metrics-weekly&apos;) ORDER BY start_time DESC LIMIT 5;</code>
            </p>
          </CardBody>
        </Card>
      ) : null}

      {weekly.length === 0 && baseline.size === 0 ? (
        <Card>
          <CardBody>
            <strong>No snapshot yet.</strong>
            <p style={{ color: 'var(--c-text-dim)', marginTop: 6 }}>
              The <code>platform-metrics-weekly</code> job runs Mondays 04:00 UTC (06:00 SAST) and writes a
              row for every metric on every tick — including a tick that measured nothing. If this stays
              empty past a Monday, the job did not run. Confirm with{' '}
              <code>SELECT * FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = &apos;platform-metrics-weekly&apos;) ORDER BY start_time DESC LIMIT 5;</code>{' '}
              — the <code>cron</code> schema is not exposed through PostgREST, so this page cannot read it for you.
            </p>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <strong>{METRIC_KEYS.length} headline metrics</strong>{' '}
          <span style={{ color: 'var(--c-text-dim)' }}>
            {latestWindow ? `· week of ${latestWindow}` : '· awaiting the first weekly snapshot'}
          </span>
        </CardHeader>
        <CardBody>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--c-text-dim)' }}>
                  <th style={{ padding: '6px 8px' }}>Metric</th>
                  <th style={{ padding: '6px 8px' }}>Sept-2026 baseline</th>
                  <th style={{ padding: '6px 8px' }}>Previous week</th>
                  <th style={{ padding: '6px 8px' }}>Latest week</th>
                  <th style={{ padding: '6px 8px' }}>Q1 target</th>
                  <th style={{ padding: '6px 8px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {METRIC_KEYS.map((k) => {
                  const now = latest.get(k)
                  const was = prior.get(k)
                  const base = baseline.get(k)
                  const status = now?.status ?? base?.status
                  const phrase = status ? statusPhrase(status) : null
                  const delta =
                    now?.value != null && was?.value != null
                      ? Number(now.value) - Number(was.value)
                      : null
                  return (
                    <tr key={k} style={{ borderTop: '1px solid var(--c-border)' }}>
                      <td style={{ padding: '8px' }}>
                        {METRIC_LABELS[k]}
                        {(now?.note ?? base?.note) ? (
                          <div style={{ color: 'var(--c-text-dim)', fontSize: 12, marginTop: 2 }}>
                            {now?.note ?? base?.note}
                          </div>
                        ) : null}
                      </td>
                      <td style={{ padding: '8px' }}>{present(base)}</td>
                      <td style={{ padding: '8px', color: 'var(--c-text-dim)' }}>{present(was)}</td>
                      <td style={{ padding: '8px' }}>
                        {present(now)}
                        {delta !== null && delta !== 0 ? (
                          <span style={{ marginLeft: 6, color: 'var(--c-text-dim)', fontSize: 12 }}>
                            {delta > 0 ? '▲' : '▼'}
                          </span>
                        ) : null}
                      </td>
                      <td style={{ padding: '8px', color: 'var(--c-text-dim)' }}>{METRIC_TARGET_Q1[k] ?? '—'}</td>
                      <td style={{ padding: '8px' }}>
                        {phrase ? <Badge variant={phrase.variant}>{phrase.label}</Badge> : <Badge variant="ghost">no row</Badge>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
