import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ refresh: vi.fn(), runFin: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
vi.mock('@/actions/solar-financials.actions', () => ({ runSolarFinancialsAction: h.runFin }))
import { PricingChangedBanner } from './PricingChangedBanner'

beforeEach(() => vi.clearAllMocks())
describe('PricingChangedBanner', () => {
  it('says Pricing changed — Re-run financials, and re-runs ONLY the financials', async () => {
    h.runFin.mockResolvedValue({ ok: true, id: 'f2' })
    render(<PricingChangedBanner projectId="p1" caseId="c1" caseName="Base" canRunFinancials />)
    const text = screen.getByRole('status').textContent ?? ''
    expect(text).toContain('Pricing changed — Re-run financials')
    expect(text).toContain('Its energy results still hold')
    expect(text).not.toContain('Stale')
    fireEvent.click(screen.getByRole('button', { name: 'Re-run financials' }))
    await waitFor(() => expect(h.refresh).toHaveBeenCalled())
    expect(h.runFin).toHaveBeenCalledWith({ projectId: 'p1', caseId: 'c1' })
    expect(screen.queryByRole('button', { name: 'Re-run selected case' })).toBeNull()
  })
  it('shows the server sentence on failure', async () => {
    h.runFin.mockResolvedValue({ error: 'Add capex lines (or apply the org rate card) first.' })
    render(<PricingChangedBanner projectId="p1" caseId="c1" caseName="Base" canRunFinancials />)
    fireEvent.click(screen.getByRole('button', { name: 'Re-run financials' }))
    await screen.findByText('Add capex lines (or apply the org rate card) first.')
    expect(h.refresh).not.toHaveBeenCalled()
  })
  it('without Edit + financials there is no button, and it says who can re-run', () => {
    render(<PricingChangedBanner projectId="p1" caseId="c1" caseName="Base" canRunFinancials={false} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('someone with Edit + financials access needs to re-run the financials')
  })
})
