import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({ gate: vi.fn(), load: vi.fn(), svc: vi.fn(() => ({})) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}), createServiceClient: h.svc }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.gate }))
vi.mock('@/lib/solar/cases/financials-page-data', () => ({ loadFinancialsPageData: h.load }))
vi.mock('./FinancialsEditor', () => ({ FinancialsEditor: () => <div>editor</div> }))
vi.mock('./FinancialResults', () => ({ FinancialResults: () => <div>results</div> }))
vi.mock('../../_components/StaleBanner', () => ({ StaleBanner: ({ caseName }: { caseName: string }) => <div>{`stale ${caseName}`}</div> }))
import SolarFinancialsPage from './page'

const props = { params: Promise.resolve({ id: 'p1' }), searchParams: Promise.resolve({ case: 'c1' }) }
beforeEach(() => vi.clearAllMocks())

describe('Financials page', () => {
  it('gates on edit_financials FIRST — a refused caller never reaches the loader or the service client', async () => {
    h.gate.mockRejectedValueOnce(new Error('NEXT_REDIRECT'))
    await expect(SolarFinancialsPage(props)).rejects.toThrow('NEXT_REDIRECT')
    expect(h.gate).toHaveBeenCalledWith('p1', 'edit_financials', expect.anything())
    expect(h.load).not.toHaveBeenCalled()
    expect(h.svc).not.toHaveBeenCalled()
  })
  it('renders the stale banners, editor and stored results', async () => {
    h.gate.mockResolvedValueOnce('edit_financials')
    h.load.mockResolvedValueOnce({ hasStudy: true, caseId: 'c1', caseName: 'Base', energyStale: true, financialsStale: true, configUpdatedAt: 'F1', results: {} })
    render(await SolarFinancialsPage(props))
    expect(h.load).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'p1', 'c1')
    expect(screen.getByText('stale Base')).toBeTruthy()
    expect(screen.getByText('These financials were computed on older inputs — press Run financials to update them.')).toBeTruthy()
    expect(screen.getByText('editor')).toBeTruthy()
    expect(screen.getByText('results')).toBeTruthy()
  })
  it('empty states: no study, no case, no result yet', async () => {
    h.gate.mockResolvedValue('edit_financials')
    h.load.mockResolvedValueOnce({ hasStudy: false })
    const a = render(await SolarFinancialsPage(props))
    expect(screen.getByText('Save Site & Supply first')).toBeTruthy()
    a.unmount()
    h.load.mockResolvedValueOnce({ hasStudy: true, caseId: null })
    const b = render(await SolarFinancialsPage(props))
    expect(screen.getByText('No cases yet')).toBeTruthy()
    b.unmount()
    h.load.mockResolvedValueOnce({ hasStudy: true, caseId: 'c1', caseName: 'Base', energyStale: false, financialsStale: false, configUpdatedAt: null, results: null })
    render(await SolarFinancialsPage(props))
    expect(screen.getByText('No financial results yet')).toBeTruthy()
  })
})
