import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { fakeSupabase } from '@/test/fake-supabase'

const h = vi.hoisted(() => ({
  client: vi.fn(), svc: vi.fn(() => ({ svc: true })), gate: vi.fn(),
  extra: vi.fn(), kpis: vi.fn(), runs: vi.fn(), overview: vi.fn(), checklist: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.client, createServiceClient: h.svc }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.gate }))
vi.mock('@/lib/solar/activity', () => ({ loadSolarActivity: async () => [] }))
vi.mock('@/lib/solar/cases/page-data', () => ({ loadSolarReadinessExtra: h.extra, loadHeadlineKpis: h.kpis, runsByCase: h.runs }))
vi.mock('../../_components/OverviewKpis', () => ({ OverviewKpis: (p: unknown) => { h.overview(p); return <div>kpis</div> } }))
vi.mock('../../_components/ReadinessChecklist', () => ({ ReadinessChecklist: (p: unknown) => { h.checklist(p); return <div>checklist</div> } }))
vi.mock('../../_components/ActivityList', () => ({ ActivityList: () => <div>activity</div> }))
vi.mock('../../_components/StudyHeader', () => ({ StudyHeader: () => <div>header</div> }))
import SolarOverviewPage from './page'

const args = { params: Promise.resolve({ id: 'p1' }) }
const HK = { caseId: 'c1', caseName: 'Base', energy: {}, money: null }
beforeEach(() => vi.clearAllMocks())

describe('Solar Overview page', () => {
  it('gates FIRST — a refused caller reaches no loader and no service client', async () => {
    h.client.mockResolvedValue(fakeSupabase({}).client)
    h.gate.mockRejectedValueOnce(new Error('NEXT_REDIRECT'))
    await expect(SolarOverviewPage(args)).rejects.toThrow('NEXT_REDIRECT')
    expect(h.extra).not.toHaveBeenCalled()
    expect(h.kpis).not.toHaveBeenCalled()
    expect(h.svc).not.toHaveBeenCalled()
  })
  it('hands the stored KPIs, the run-having cases, the study stale guard and the stale flag to OverviewKpis', async () => {
    h.client.mockResolvedValue(fakeSupabase({ rpc: { solar_is_grantor: { data: false, error: null } }, tables: {
      'projects.projects': [{ id: 'p1', name: 'Kings' }],
      'solar.studies': [{ project_id: 'p1', latitude: -26, longitude: 28, licensee_name: 'City Power', nmd_kva: 500, selected_case_id: 'c1', updated_at: 'T0' }],
      'solar.cases': [{ id: 'c1', project_id: 'p1', name: 'Base' }, { id: 'c2', project_id: 'p1', name: 'Never run' }],
    } }).client)
    h.gate.mockResolvedValueOnce('edit')
    h.extra.mockResolvedValueOnce({ yield: { caseCount: 2, selectedCaseId: 'c1', selectedStatus: 'stale' }, stale: { caseId: 'c1', caseName: 'Base' } })
    h.runs.mockResolvedValueOnce({ latest: new Map(), ok: new Map([['c1', { id: 'r1' }]]) })
    h.kpis.mockResolvedValueOnce(HK)
    render(await SolarOverviewPage(args))
    expect(screen.getByText('kpis')).toBeTruthy()
    expect(h.extra).toHaveBeenCalledWith(expect.anything(), { svc: true }, 'p1', 'edit')
    expect(h.kpis).toHaveBeenCalledWith(expect.anything(), 'p1', 'edit', 'c1')
    expect(h.overview).toHaveBeenCalledWith({ projectId: 'p1', level: 'edit', kpis: HK, selectable: [{ id: 'c1', name: 'Base' }], selectedCaseId: 'c1', studyUpdatedAt: 'T0', stale: true })
    const steps = (h.checklist.mock.calls[0]![0] as { steps: Array<{ slug: string; reason: string }> }).steps
    expect(steps.find((s) => s.slug === 'yield')?.reason).toBe('The selected case is stale — re-run it')
  })
})
