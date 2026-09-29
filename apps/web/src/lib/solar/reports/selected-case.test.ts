import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ loadStudyInputs: vi.fn(), contextForCase: vi.fn(), runsByCase: vi.fn() }))
vi.mock('@/lib/solar/cases/run-context', () => ({ loadStudyInputs: h.loadStudyInputs, contextForCase: h.contextForCase }))
vi.mock('@/lib/solar/cases/page-data', () => ({ runsByCase: h.runsByCase }))

import { loadSelectedCase, SELECTED_CASE_REASONS } from './selected-case'
import { fakeSupabase } from '@/test/fake-supabase'

const H1 = 'a'.repeat(64), H2 = 'b'.repeat(64)
const study = { id: 's1', project_id: 'p1', organisation_id: 'o1', selected_case_id: 'c1', updated_at: 'T' }
const caseRow = { id: 'c1', study_id: 's1', project_id: 'p1', name: 'Base', pv_source: 'manual', layout_id: null, config: {}, updated_at: 'T' }
const runRow = { id: 'r1', case_id: 'c1', status: 'succeeded', inputs_hash: H1, started_at: new Date().toISOString(), finished_at: '2026-09-28T10:00:00Z', outputs: { kpis: { dcKwp: 500 } }, config_snapshot: {}, hourly_path: 'o1/r1.csv.gz' }
const user = () => fakeSupabase({ tables: { 'solar.cases': [caseRow], 'solar.case_runs': [runRow] } }).client

beforeEach(() => {
  vi.clearAllMocks()
  h.loadStudyInputs.mockResolvedValue({ study })
  h.runsByCase.mockResolvedValue({ latest: new Map([['c1', runRow]]), ok: new Map([['c1', runRow]]) })
  h.contextForCase.mockResolvedValue({ ok: true, ctx: { currentHash: H1 } })
})

describe('loadSelectedCase', () => {
  it('returns the selected case and its latest succeeded run when current', async () => {
    const r = await loadSelectedCase(user() as never, {} as never, 'p1')
    expect(r).toMatchObject({ ok: true, caseRow: { id: 'c1', name: 'Base' }, run: { id: 'r1', inputsHash: H1, hourlyPath: 'o1/r1.csv.gz' } })
  })
  it('refuses a Stale case (current inputs hash differs from the run’s)', async () => {
    h.contextForCase.mockResolvedValue({ ok: true, ctx: { currentHash: H2 } })
    await expect(loadSelectedCase(user() as never, {} as never, 'p1')).resolves.toEqual({ ok: false, stale: true, reason: SELECTED_CASE_REASONS.stale })
  })
  it('refuses when inputs are incomplete (Stale by the rule)', async () => {
    h.contextForCase.mockResolvedValue({ ok: true, ctx: { currentHash: null } })
    expect((await loadSelectedCase(user() as never, {} as never, 'p1')).ok).toBe(false)
  })
  it('names every other missing step', async () => {
    h.loadStudyInputs.mockResolvedValueOnce(null)
    await expect(loadSelectedCase(user() as never, {} as never, 'p1')).resolves.toMatchObject({ reason: SELECTED_CASE_REASONS.noStudy })
    h.loadStudyInputs.mockResolvedValueOnce({ study: { ...study, selected_case_id: null } })
    await expect(loadSelectedCase(user() as never, {} as never, 'p1')).resolves.toMatchObject({ reason: SELECTED_CASE_REASONS.noSelection })
    h.runsByCase.mockResolvedValueOnce({ latest: new Map(), ok: new Map() })
    await expect(loadSelectedCase(user() as never, {} as never, 'p1')).resolves.toMatchObject({ reason: SELECTED_CASE_REASONS.noRun })
  })
})
