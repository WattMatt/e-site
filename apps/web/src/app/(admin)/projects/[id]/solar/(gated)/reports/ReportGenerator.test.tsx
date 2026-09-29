import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ gen: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/solar-reports.actions', () => ({ generateSolarReportAction: h.gen }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
import { ReportGenerator } from './ReportGenerator'

const ok = { ok: true as const, caseId: 'c1', caseName: 'Base', runId: 'r1' }
beforeEach(() => vi.clearAllMocks())

describe('ReportGenerator (§9.2)', () => {
  it('View: renders nothing (controls above the level are hidden)', () => {
    const { container } = render(<ReportGenerator projectId="p1" level="view" selected={ok} feasibility={{ ok: false, reason: null }} layoutSheet={{ available: false, reason: 'x' }} />)
    expect(container.innerHTML).toBe('')
  })
  it('Edit: technical only; both disabled with the reason when Stale', () => {
    render(<ReportGenerator projectId="p1" level="edit" selected={{ ok: false, stale: true, reason: 'The selected case is stale — re-run it first.' }} feasibility={{ ok: false, reason: null }} layoutSheet={{ available: false, reason: 'x' }} />)
    const t = screen.getByRole('button', { name: 'Generate technical report' }) as HTMLButtonElement
    expect(t.disabled).toBe(true)
    expect(t.title).toBe('The selected case is stale — re-run it first.')
    expect(screen.queryByRole('button', { name: 'Generate feasibility report' })).toBeNull()
  })
  it('options: layout sheet disabled with its reason; bill check disabled until Phase 2b', () => {
    render(<ReportGenerator projectId="p1" level="edit_financials" selected={ok} feasibility={{ ok: true, reason: null }} layoutSheet={{ available: false, reason: 'This case uses a manual system size.' }} />)
    expect((screen.getByLabelText('Include layout sheet') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText('This case uses a manual system size.')).toBeTruthy()
    expect((screen.getByLabelText('Include bill check') as HTMLInputElement).disabled).toBe(true)
  })
  it('generates with the note and options, then reports the version and any branding warning', async () => {
    h.gen.mockResolvedValue({ ok: true, reportId: 'r', version: 3, warning: 'Your organisation has no report branding, so a neutral template was used.' })
    render(<ReportGenerator projectId="p1" level="edit_financials" selected={ok} feasibility={{ ok: true, reason: null }} layoutSheet={{ available: true, reason: null }} />)
    fireEvent.change(screen.getByLabelText('Revision note'), { target: { value: 'Rev C' } })
    fireEvent.click(screen.getByLabelText('Include 8760 appendix'))
    fireEvent.click(screen.getByRole('button', { name: 'Generate feasibility report' }))
    await waitFor(() => expect(h.gen).toHaveBeenCalledWith({ projectId: 'p1', kind: 'feasibility', note: 'Rev C', options: { includeLayoutSheet: false, include8760: true } }))
    expect(await screen.findByText('Feasibility report v3 saved.')).toBeTruthy()
    expect(screen.getByText(/neutral template/)).toBeTruthy()
    expect(h.refresh).toHaveBeenCalled()
  })
  it('shows a refusal as a sentence', async () => {
    h.gen.mockResolvedValue({ error: 'Run financials for the selected case first (Financials tab).' })
    render(<ReportGenerator projectId="p1" level="edit_financials" selected={ok} feasibility={{ ok: true, reason: null }} layoutSheet={{ available: true, reason: null }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Generate technical report' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Run financials for the selected case first (Financials tab).')
  })
})
