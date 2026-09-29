import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ load: vi.fn(), ops: vi.fn() }))
vi.mock('./run-context', async (orig) => ({ ...(await orig<typeof import('./run-context')>()), loadStudyInputs: h.load }))
vi.mock('@/lib/solar/operations/data', () => ({ loadOperationsReadiness: h.ops }))
import { loadSolarReadinessExtra } from './page-data'
import { fakeSupabase } from '@/test/fake-supabase'

beforeEach(() => {
  vi.clearAllMocks()
  h.load.mockResolvedValue({ study: { id: 's1', organisation_id: 'o1', selected_case_id: null, updated_at: 'T' }, siteLoad: null, tariff: { ok: false, reason: 'x' }, touPeriods: null })
  h.ops.mockResolvedValue({ installed: true, commissioningDate: '2026-02-15', monthsWithData: 2 })
})

describe('loadSolarReadinessExtra — Operations (Phase 7)', () => {
  it('carries the operations readiness input for every level', async () => {
    const user = fakeSupabase({ tables: { 'solar.cases': [] } }).client
    await expect(loadSolarReadinessExtra(user as never, {} as never, 'p1', 'view')).resolves.toMatchObject({ operations: { installed: true, monthsWithData: 2 } })
    expect(h.ops).toHaveBeenCalledWith(user, 'p1')
  })
})
