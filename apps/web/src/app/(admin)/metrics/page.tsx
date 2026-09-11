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
  method_version: number
  note: string | null
  detail: Record<string, unknown>
}

interface ReadError {
  message: string
}

/**
 * `platform_metrics_weekly` is absent from the generated Database types until
 * the migration is applied and `pnpm gen-types` re-run, so the client is cast
 * to the narrow shape this page uses. `PromiseLike`, not `Promise`: a PostgREST
 * filter builder is a thenable.
 */
type SnapshotQuery = PromiseLike<{ data: SnapshotRow[] | null; error: ReadError | null }> & {
  eq: (column: string, value: boolean) => SnapshotQuery
  order: (column: string, opts: { ascending: boolean }) => SnapshotQuery
  limit: (n: number) => SnapshotQuery
}
interface SnapshotClient {
  from: (table: string) => { select: (columns: string) => SnapshotQuery }
}

function present(row: SnapshotRow | undefined): string {
  if (!row || row.value === null) return '—'
  // An unmeasured ratio is never a number. The rollup's CASE writes NULL here,
  // but the page must not depend on it: a 0 that reached this cell would render
  // as "0.0%" beside "no honest number yet". Non-ratio keys keep their value —
  // report_schedules_per_project legitimately reads "0 per project" under
  // not_yet_instrumented, by plan.
  if (row.status !== 'measured' && RATIO_METRIC_KEYS.has(row.metric_key)) return '—'
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

/**
 * One row per metric key — the HIGHEST `method_version` wins, whatever order
 * the rows arrived in. A definition change writes new rows under a new version
 * beside the old ones (snapshots are never rewritten), and the page must show
 * the current definition without relying on the query's sort surviving a
 * refactor.
 */
function highestVersionByKey(rs: SnapshotRow[]): Map<MetricKey, SnapshotRow> {
  return rs.reduce((m, r) => {
    const cur = m.get(r.metric_key)
    if (!cur || r.method_version > cur.method_version) m.set(r.metric_key, r)
    return m
  }, new Map<MetricKey, SnapshotRow>())
}

export default async function MetricsPage() {
  // Gate one: the page does not render for anyone else.
  await requireRolePage(OWNER_ADMIN)

  // Gate two: read through the CALLER's session, so the RESTRICTIVE policy
  // calling public.user_is_org_admin() is exercised on every render. Never the
  // service client here — that would bypass the backstop this page exists to
  // demonstrate.
  const supabase = (await createClient()) as unknown as SnapshotClient
  const snapshots = () => supabase.from('platform_metrics_weekly').select('*')

  // Two reads, not one ordered `limit(200)`. Every Monday tick appends one row
  // per metric key (11) per method version, every one with a window_start later
  // than the baseline's 2026-09-03. Ordered newest-first under a single cap, the
  // baseline rows sit at the very END of the result and fall off it once ~17
  // ticks have landed (17 × 11 = 187 rows, sooner with a second method version)
  // — the "Sept-2026 baseline" column would then silently read "—" for the rest
  // of the quarter. So the baseline is read whole, and the weekly read caps at
  // two windows × 11 keys × up to two method versions = 44.
  const [baselineRead, weeklyRead] = await Promise.all([
    snapshots().eq('is_baseline', true),
    snapshots()
      .eq('is_baseline', false)
      .order('window_start', { ascending: false })
      .order('method_version', { ascending: true })
      .limit(44),
  ])
  const readError = baselineRead.error ?? weeklyRead.error

  const baseline = highestVersionByKey(baselineRead.data ?? [])
  const weekly: SnapshotRow[] = weeklyRead.data ?? []
  const windows = [...new Set(weekly.map((r) => r.window_start))].sort().reverse()
  const latestWindow = windows[0] ?? null
  const priorWindow = windows[1] ?? null
  const latest = highestVersionByKey(weekly.filter((r) => r.window_start === latestWindow))
  const prior = highestVersionByKey(weekly.filter((r) => r.window_start === priorWindow))

  // Staleness is measured from window_end — the day the data closed — not from
  // window_start. The Monday tick writes the week just CLOSED, so window_start
  // is already 7 days old on tick day; measured from there the banner read
  // "9 days old" on every healthy Wednesday. From window_end it is 0 on tick
  // day, and a missed Monday tick shows "9 days old" from the following
  // Wednesday. The baseline counts as a snapshot too: once it is captured and
  // the cron never fires, the page must not read "awaiting the first weekly
  // snapshot" forever — that state is exactly the one this banner exists for.
  const latestRow: SnapshotRow | undefined = [...latest.values()][0]
  const newest: SnapshotRow | undefined = latestRow ?? [...baseline.values()][0]
  const staleDays = newest ? daysBetween(newest.window_end, new Date()) : null
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

      {readError ? (
        <Card>
          <CardBody>
            <strong>Could not read platform_metrics_weekly: {readError.message}</strong>
            <p style={{ color: 'var(--c-text-dim)', marginTop: 6 }}>
              This is a read failure, not a missing tick — the job may well have run. The table is gated
              by a RESTRICTIVE SELECT policy calling <code>public.user_is_org_admin()</code>; if an org
              owner or admin sees this, that policy or the <code>authenticated</code> grant is wrong, or
              the migration has not applied.
            </p>
          </CardBody>
        </Card>
      ) : null}

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

      {!readError && weekly.length === 0 && baseline.size === 0 ? (
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
                  <th scope="col" style={{ padding: '6px 8px' }}>Metric</th>
                  <th scope="col" style={{ padding: '6px 8px' }}>Sept-2026 baseline</th>
                  <th scope="col" style={{ padding: '6px 8px' }}>Previous week</th>
                  <th scope="col" style={{ padding: '6px 8px' }}>Latest week</th>
                  <th scope="col" style={{ padding: '6px 8px' }}>Q1 target</th>
                  <th scope="col" style={{ padding: '6px 8px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {METRIC_KEYS.map((k) => {
                  const now = latest.get(k)
                  const was = prior.get(k)
                  const base = baseline.get(k)
                  const status = now?.status ?? base?.status
                  const phrase = status ? statusPhrase(status) : null
                  // A direction arrow only between two MEASURED numbers. An
                  // unmeasured week beside a measured one is not a fall.
                  const delta =
                    now?.status === 'measured' && was?.status === 'measured' && now.value != null && was.value != null
                      ? Number(now.value) - Number(was.value)
                      : null
                  const direction = delta !== null && delta !== 0 ? (delta > 0 ? 'up' : 'down') : null
                  // The baseline is a four-week window, not a seven-day one, and
                  // the two are not directly comparable; say so beside the number.
                  const windowDays = base?.detail?.window_days
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
                      <td style={{ padding: '8px' }}>
                        {present(base)}
                        {typeof windowDays === 'number' && windowDays !== 7 ? (
                          <abbr title={base?.note ?? ''} style={{ marginLeft: 6, color: 'var(--c-text-dim)', fontSize: 12 }}>{windowDays}d</abbr>
                        ) : null}
                      </td>
                      <td style={{ padding: '8px', color: 'var(--c-text-dim)' }}>{present(was)}</td>
                      <td style={{ padding: '8px' }}>
                        {present(now)}
                        {direction ? (
                          <span
                            style={{ marginLeft: 6, color: 'var(--c-text-dim)', fontSize: 12 }}
                            title={`${direction} from ${present(was)}`}
                            aria-label={`${direction} from ${present(was)}`}
                          >
                            {direction === 'up' ? '▲' : '▼'}
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
