import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OWNER_ADMIN } from '@esite/shared'

const requireRolePage = vi.fn()
vi.mock('@/lib/auth/require-role', () => ({ requireRolePage: (...a: unknown[]) => requireRolePage(...a) }))

type Row = Record<string, unknown>
type ReadResult = { data: Row[] | null; error: { message: string } | null }
interface QueryBuilder {
  eq: (column: string, value: unknown) => QueryBuilder
  order: (column: string, opts: { ascending: boolean }) => QueryBuilder
  limit: (n: number) => QueryBuilder
  then: PromiseLike<ReadResult>['then']
}

const rows: Row[] = []
let readError: { message: string } | null = null

// A thenable filter builder, the shape supabase-js hands back: `eq` narrows
// the row set, `order`/`limit` are accepted and ignored, and awaiting it yields
// `{ data, error }`. The page's two reads (is_baseline true / false) both go
// through it, so a row is only ever visible to the read whose filter it passes.
function query(filtered: Row[]): QueryBuilder {
  const result = (): Promise<ReadResult> =>
    Promise.resolve(readError ? { data: null, error: readError } : { data: filtered, error: null })
  const builder: QueryBuilder = {
    eq: (column, value) => query(filtered.filter((r) => r[column] === value)),
    order: () => builder,
    limit: () => builder,
    then: (onFulfilled, onRejected) => result().then(onFulfilled, onRejected),
  }
  return builder
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({ select: () => query(rows) }),
  }),
}))

import MetricsPage from './page'

// Plain matchers throughout — this workspace has no @testing-library/jest-dom
// and vitest.config.ts declares no setupFiles, so toBeInTheDocument() does not
// exist. Same convention as TenantsPanel.test.tsx:129.
beforeEach(() => {
  rows.length = 0
  readError = null
  requireRolePage.mockReset()
  requireRolePage.mockResolvedValue({ userId: 'u1', organisationId: 'o1', role: 'owner' })
})

const isoDate = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)

/**
 * A row that could exist in the database: a seven-day window that CLOSED
 * `endDaysAgo` days ago. `window_end` is exclusive — it is the Monday of the
 * tick that wrote the row — so `window_start` is seven days before it. This is
 * exactly what the cron writes; a fixture with window_start === window_end
 * cannot tell a start-based staleness check from an end-based one.
 */
function weekRow(endDaysAgo: number, overrides: Row = {}): Row {
  return {
    metric_key: 'weekly_active', iso_year: 2026, iso_week: 40,
    window_start: isoDate(endDaysAgo + 7), window_end: isoDate(endDaysAgo),
    numerator: 3, denominator: 23, value: 0.1304,
    status: 'measured', is_baseline: false, method_version: 1, note: null, detail: {},
    ...overrides,
  }
}

describe('/metrics', () => {
  it('gates on OWNER_ADMIN before reading anything', async () => {
    render(await MetricsPage())
    expect(requireRolePage).toHaveBeenCalledWith(OWNER_ADMIN)
  })

  // Verification walks from the empty state a real user starts in — an
  // uploader that rendered correctly on a page nobody could reach passed
  // verification once already.
  it('renders a usable empty state before the first snapshot lands', async () => {
    render(await MetricsPage())
    expect(screen.queryByText(/no snapshot yet/i)).not.toBeNull()
    expect(screen.queryByText(/Mondays 04:00 UTC/i)).not.toBeNull()
    // The empty state must tell the reader how to check the scheduler. `cron`
    // is not a PostgREST-exposed schema (config.toml:9), so the page cannot
    // read cron.job_run_details itself — it names the command instead.
    expect(screen.queryByText(/cron\.job_run_details/i)).not.toBeNull()
  })

  it('renders every metric with its Q1 target once a snapshot exists', async () => {
    rows.push(weekRow(3))
    render(await MetricsPage())
    expect(screen.queryByText(/Weekly active users/i)).not.toBeNull()
    expect(screen.queryByText('35% of the frozen cohort')).not.toBeNull()
    expect(screen.queryByText('13.0%')).not.toBeNull()
  })

  it('shows an unmeasurable metric as "no honest number yet", never as zero', async () => {
    rows.push(weekRow(3, {
      metric_key: 'inbox_engagement',
      numerator: null, denominator: null, value: null,
      status: 'unmeasurable', note: 'read_at has never been written',
    }))
    render(await MetricsPage())
    expect(screen.queryByText(/no honest number yet/i)).not.toBeNull()
    expect(screen.queryByText('read_at has never been written')).not.toBeNull()
    expect(screen.queryByText('0.0%')).toBeNull()
  })

  // The rollup's CASE writes value NULL for an unmeasured ratio, but the page
  // must not depend on that: a 0 that reached this cell would render "0.0%"
  // beside "no honest number yet" — the number nobody can read.
  it('never renders an unmeasured ratio as a number, even when value is 0', async () => {
    rows.push(weekRow(3, {
      metric_key: 'inbox_engagement',
      numerator: 0, denominator: 0, value: 0,
      status: 'unmeasurable', note: 'read_at has never been written',
    }))
    render(await MetricsPage())
    expect(screen.queryByText('0.0%')).toBeNull()
    const row = screen.getByText(/Inbox engagement/i).closest('tr')
    expect(row).not.toBeNull()
    // Column order: Metric, Sept-2026 baseline, Previous week, Latest week, Q1 target, Status.
    expect(row!.querySelectorAll('td')[3].textContent).toBe('—')
  })

  // The state this team has actually lived through: cloud-sync-poll was
  // specified, merged, never scheduled, ran 11 times manually, and surfaced two
  // months later as a user complaint about stale floor plans. A dashboard that
  // renders three-week-old numbers with no signal is how that happens again.
  //
  // Staleness is measured from window_end (the day the data closed). This row
  // closed 20 days ago and STARTED 27 days ago — a regression to the
  // start-based check would read "27 days old" and fail here.
  it('warns when the newest snapshot is more than a week old', async () => {
    rows.push(weekRow(20, { iso_week: 37 }))
    render(await MetricsPage())
    expect(screen.queryByText(/snapshot is 20 days old/i)).not.toBeNull()
  })

  // Task 17's first state: the baseline is captured, the cron has never fired.
  // Measured from the weekly rows alone this page read "awaiting the first
  // weekly snapshot" forever, which is the silence the banner exists to break.
  it('warns from the baseline alone when no weekly snapshot has ever landed', async () => {
    rows.push(weekRow(20, {
      is_baseline: true, iso_week: null, window_start: isoDate(48),
      detail: { window_days: 28 }, note: 'four-week window, not seven',
    }))
    render(await MetricsPage())
    expect(screen.queryByText(/snapshot is 20 days old/i)).not.toBeNull()
    expect(screen.queryByText(/no snapshot yet/i)).toBeNull()
    expect(screen.queryByText(/awaiting the first weekly snapshot/i)).not.toBeNull()
    // The baseline window is not a week; the cell says so, and the note is the tooltip.
    expect(screen.getByText('28d').getAttribute('title')).toBe('four-week window, not seven')
  })

  // A read error is not "the job did not run". Rendering the empty-state card
  // over a permission failure would send an owner off to inspect pg_cron for a
  // problem that lives in the RLS policy.
  it('surfaces a read error instead of the empty state', async () => {
    readError = { message: 'permission denied for table platform_metrics_weekly' }
    render(await MetricsPage())
    expect(screen.queryByText(/Could not read platform_metrics_weekly/i)).not.toBeNull()
    expect(screen.queryByText(/permission denied for table platform_metrics_weekly/)).not.toBeNull()
    expect(screen.queryByText(/no snapshot yet/i)).toBeNull()
  })

  it('shows the previous week beside the latest one, so the reader can see direction', async () => {
    rows.push(
      weekRow(3, { iso_week: 40 }),
      weekRow(10, { iso_week: 39, numerator: 2, value: 0.0870 }),
    )
    render(await MetricsPage())
    expect(screen.queryByText('13.0%')).not.toBeNull()
    expect(screen.queryByText('8.7%')).not.toBeNull()
  })

  // Snapshots are never rewritten: a definition change writes new rows under a
  // new method_version beside the old ones. The page shows the current
  // definition. v2 is pushed FIRST so a last-write-wins map would show v1.
  it('renders the highest method_version when a week carries two', async () => {
    rows.push(
      weekRow(3, { method_version: 2, numerator: 5, value: 0.2174 }),
      weekRow(3, { method_version: 1 }),
    )
    render(await MetricsPage())
    expect(screen.queryByText('21.7%')).not.toBeNull()
    expect(screen.queryByText('13.0%')).toBeNull()
  })

  // An unmeasured week beside a measured one is not a fall. The arrow renders
  // only between two measured numbers, and says what it is relative to.
  it('omits the direction arrow when the latest row is not measured', async () => {
    rows.push(
      weekRow(3, { status: 'unmeasurable', numerator: null, denominator: null, value: null, note: 'user_sessions has no writer yet' }),
      weekRow(10, { iso_week: 39, numerator: 2, value: 0.0870 }),
      weekRow(3, { metric_key: 'contractor_active_all', numerator: 5, denominator: 12, value: 0.4167 }),
      weekRow(10, { metric_key: 'contractor_active_all', iso_week: 39, numerator: 2, denominator: 12, value: 0.1667 }),
    )
    render(await MetricsPage())
    // Positive control: the measured pair carries the arrow, labelled for a screen reader.
    expect(screen.getByLabelText('up from 16.7%').textContent).toBe('▲')
    // The unmeasured pair does not, even though its previous week has a number.
    const row = screen.getByText(/Weekly active users/i).closest('tr')
    expect(row).not.toBeNull()
    expect(row!.querySelector('[aria-label]')).toBeNull()
    expect(row!.textContent).not.toMatch(/[▲▼]/)
    expect(screen.queryByText('8.7%')).not.toBeNull()
  })

  it('names the number of headline metrics from the registry, not from a hardcoded word', async () => {
    render(await MetricsPage())
    expect(screen.queryByText(/11 headline metrics/i)).not.toBeNull()
  })
})
