import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { fakeSupabase } from '@/test/fake-supabase'

const h = vi.hoisted(() => ({ gate: vi.fn() }))
vi.mock('@/lib/tariffs/admin-gate', () => ({ requirePlatformTariffAdminPage: h.gate }))
vi.mock('./_components/RunMonitorButton', () => ({ RunMonitorButton: ({ regime }: { regime: string }) => <button>Check {regime}</button> }))

import TariffLibraryOverview from './page'

beforeEach(() => vi.clearAllMocks())

describe('tariff library overview: due-year monitor', () => {
  it('never checked: does not claim coverage or an automatic schedule; says how to start it', async () => {
    h.gate.mockResolvedValue({ supabase: fakeSupabase({}).client, userId: 'a1' })
    render(await TariffLibraryOverview())
    expect(screen.queryByText(/Checked automatically/)).toBeNull()
    expect(screen.queryByText(/Every watched licensee has a published year/)).toBeNull()
    expect(screen.getByText(/No check has recorded a missing year yet — run a check now/)).toBeDefined()
    expect(screen.getByText(/automatic schedule \(1 April for Eskom, 1 July for municipal\) starts once the owner enables it/)).toBeDefined()
  })
  it('with alerts: lists them and shows when the latest was recorded', async () => {
    h.gate.mockResolvedValue({ supabase: fakeSupabase({ tables: { 'tariffs.due_year_alert': [
      { id: 'a1', regime: 'municipal', missing_financial_year: '2026/27', latest_published_fy: '2025/26', checked_on: '2026-07-01', resolved_at: null, created_at: '2026-07-01T05:00:00Z', licensee: { name: 'City of Probe' } },
    ] } }).client, userId: 'a1' })
    render(await TariffLibraryOverview())
    expect(screen.getByText(/City of Probe: no published 2026\/27/)).toBeDefined()
    expect(screen.getByText(/Latest alert recorded/)).toBeDefined()
  })
})
