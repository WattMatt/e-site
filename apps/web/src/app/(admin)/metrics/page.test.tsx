import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OWNER_ADMIN } from '@esite/shared'

const requireRolePage = vi.fn()
vi.mock('@/lib/auth/require-role', () => ({ requireRolePage: (...a: unknown[]) => requireRolePage(...a) }))

const rows: unknown[] = []
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({ order: () => ({ limit: async () => ({ data: rows, error: null }) }) }),
    }),
  }),
}))

import MetricsPage from './page'

// Plain matchers throughout — this workspace has no @testing-library/jest-dom
// and vitest.config.ts declares no setupFiles, so toBeInTheDocument() does not
// exist. Same convention as TenantsPanel.test.tsx:129.
beforeEach(() => {
  rows.length = 0
  requireRolePage.mockReset()
  requireRolePage.mockResolvedValue({ userId: 'u1', organisationId: 'o1', role: 'owner' })
})

const recentWindow = () => {
  const d = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
  return d.toISOString().slice(0, 10)
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
    rows.push({
      metric_key: 'weekly_active', iso_year: 2026, iso_week: 40,
      window_start: recentWindow(), window_end: recentWindow(),
      numerator: 3, denominator: 23, value: 0.1304,
      status: 'measured', is_baseline: false, note: null, detail: {},
    })
    render(await MetricsPage())
    expect(screen.queryByText(/Weekly active users/i)).not.toBeNull()
    expect(screen.queryByText('35% of the frozen cohort')).not.toBeNull()
    expect(screen.queryByText('13.0%')).not.toBeNull()
  })

  it('shows an unmeasurable metric as "no honest number yet", never as zero', async () => {
    rows.push({
      metric_key: 'inbox_engagement', iso_year: 2026, iso_week: 40,
      window_start: recentWindow(), window_end: recentWindow(),
      numerator: null, denominator: null, value: null,
      status: 'unmeasurable', is_baseline: false,
      note: 'read_at has never been written', detail: {},
    })
    render(await MetricsPage())
    expect(screen.queryByText(/no honest number yet/i)).not.toBeNull()
    expect(screen.queryByText('read_at has never been written')).not.toBeNull()
    expect(screen.queryByText('0.0%')).toBeNull()
  })

  // The state this team has actually lived through: cloud-sync-poll was
  // specified, merged, never scheduled, ran 11 times manually, and surfaced two
  // months later as a user complaint about stale floor plans. A dashboard that
  // renders three-week-old numbers with no signal is how that happens again.
  it('warns when the newest snapshot is more than a week old', async () => {
    const stale = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    rows.push({
      metric_key: 'weekly_active', iso_year: 2026, iso_week: 37,
      window_start: stale, window_end: stale,
      numerator: 3, denominator: 23, value: 0.1304,
      status: 'measured', is_baseline: false, note: null, detail: {},
    })
    render(await MetricsPage())
    expect(screen.queryByText(/snapshot is 20 days old/i)).not.toBeNull()
  })

  it('shows the previous week beside the latest one, so the reader can see direction', async () => {
    const thisWeek = recentWindow()
    const lastWeek = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    rows.push(
      { metric_key: 'weekly_active', iso_year: 2026, iso_week: 40, window_start: thisWeek, window_end: thisWeek,
        numerator: 3, denominator: 23, value: 0.1304, status: 'measured', is_baseline: false, note: null, detail: {} },
      { metric_key: 'weekly_active', iso_year: 2026, iso_week: 39, window_start: lastWeek, window_end: lastWeek,
        numerator: 2, denominator: 23, value: 0.0870, status: 'measured', is_baseline: false, note: null, detail: {} },
    )
    render(await MetricsPage())
    expect(screen.queryByText('13.0%')).not.toBeNull()
    expect(screen.queryByText('8.7%')).not.toBeNull()
  })

  it('names the number of headline metrics from the registry, not from a hardcoded word', async () => {
    render(await MetricsPage())
    expect(screen.queryByText(/11 headline metrics/i)).not.toBeNull()
  })
})
