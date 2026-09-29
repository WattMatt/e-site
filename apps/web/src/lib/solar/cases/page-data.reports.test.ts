import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ load: vi.fn(), ctx: vi.fn() }))
vi.mock('./run-context', async (orig) => ({ ...(await orig<typeof import('./run-context')>()), loadStudyInputs: h.load, contextForCase: h.ctx }))
import { loadSolarReadinessExtra } from './page-data'
import { fakeSupabase } from '@/test/fake-supabase'

const H = 'a'.repeat(64)
const user = (sourceId: string) => fakeSupabase({ tables: {
  'solar.cases': [{ id: 'c1', study_id: 's1', project_id: 'p1', name: 'Base', pv_source: 'manual', config: {}, updated_at: 'T' }],
  'solar.case_runs': [{ id: 'r1', case_id: 'c1', project_id: 'p1', status: 'succeeded', inputs_hash: H, started_at: new Date().toISOString(), finished_at: 'T', run_by: 'u' }],
  'solar.case_financials': [],
  'projects.reports': [{ id: 'f1', project_id: 'p1', kind: 'solar_feasibility', source_id: sourceId, status: 'issued' }],
} }).client

beforeEach(() => {
  vi.clearAllMocks()
  h.load.mockResolvedValue({ study: { id: 's1', organisation_id: 'o1', selected_case_id: 'c1', updated_at: 'T' }, siteLoad: null, tariff: { ok: false, reason: 'x' }, touPeriods: null })
  h.ctx.mockResolvedValue({ ok: true, ctx: { currentHash: H } })
})

describe('loadSolarReadinessExtra — Reports (Phase 6)', () => {
  it('green only when a feasibility report exists for the selected case’s latest run', async () => {
    await expect(loadSolarReadinessExtra(user('r1') as never, {} as never, 'p1', 'edit_financials')).resolves.toMatchObject({ reports: { hasCurrentFeasibility: true } })
    await expect(loadSolarReadinessExtra(user('r-old') as never, {} as never, 'p1', 'edit_financials')).resolves.toMatchObject({ reports: { hasCurrentFeasibility: false } })
  })
  it('null below Edit + financials (they cannot see feasibility reports)', async () => {
    await expect(loadSolarReadinessExtra(user('r1') as never, {} as never, 'p1', 'edit')).resolves.toMatchObject({ reports: null })
  })
  it('Edit + financials with no selected case or no study: "not yet" (grey), never the no-access reason', async () => {
    h.load.mockResolvedValueOnce({ study: { id: 's1', organisation_id: 'o1', selected_case_id: null, updated_at: 'T' }, siteLoad: null, tariff: { ok: false, reason: 'x' }, touPeriods: null })
    await expect(loadSolarReadinessExtra(user('r1') as never, {} as never, 'p1', 'edit_financials')).resolves.toMatchObject({ reports: { hasCurrentFeasibility: false } })
    h.load.mockResolvedValueOnce(null)
    await expect(loadSolarReadinessExtra(user('r1') as never, {} as never, 'p1', 'edit_financials')).resolves.toMatchObject({ reports: { hasCurrentFeasibility: false } })
    h.load.mockResolvedValueOnce(null)
    await expect(loadSolarReadinessExtra(user('r1') as never, {} as never, 'p1', 'view')).resolves.toEqual({ stale: null })
  })
})
