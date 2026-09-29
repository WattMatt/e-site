import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ gen: vi.fn(), push: vi.fn() }))
vi.mock('@/actions/solar-reports.actions', () => ({ generateSolarReportAction: h.gen }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push }) }))
import { GenerateFeasibilityButton } from './GenerateFeasibilityButton'

beforeEach(() => vi.clearAllMocks())

describe('GenerateFeasibilityButton (Overview §2.2 shortcut = Reports → Generate)', () => {
  it('disabled with the reason', () => {
    render(<GenerateFeasibilityButton projectId="p1" disabledReason="The selected case is stale — re-run it first" />)
    const b = screen.getByRole('button', { name: 'Generate feasibility report' }) as HTMLButtonElement
    expect(b.disabled).toBe(true)
    expect(b.title).toBe('The selected case is stale — re-run it first')
  })
  it('runs the SAME action as the Reports tab, then opens the Reports tab', async () => {
    h.gen.mockResolvedValue({ ok: true, reportId: 'r', version: 1, warning: null })
    render(<GenerateFeasibilityButton projectId="p1" disabledReason={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Generate feasibility report' }))
    await waitFor(() => expect(h.gen).toHaveBeenCalledWith({ projectId: 'p1', kind: 'feasibility', note: null, options: { includeLayoutSheet: false, include8760: false } }))
    expect(h.push).toHaveBeenCalledWith('/projects/p1/solar/reports')
  })
  it('shows a refusal as a sentence', async () => {
    h.gen.mockResolvedValue({ error: 'Run financials for the selected case first (Financials tab).' })
    render(<GenerateFeasibilityButton projectId="p1" disabledReason={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Generate feasibility report' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Run financials for the selected case first (Financials tab).')
  })
})
