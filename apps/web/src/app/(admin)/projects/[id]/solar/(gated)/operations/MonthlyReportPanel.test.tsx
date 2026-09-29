import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ gen: vi.fn(async () => ({ ok: true, reportId: 'r2', version: 2, warning: null })), note: vi.fn(async () => ({ ok: true, updatedAt: 'N2' })), refresh: vi.fn() }))
vi.mock('@/actions/solar-monthly-report.actions', () => ({ generateSolarMonthlyReportAction: h.gen, saveMonthlyReportNoteAction: h.note }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
vi.mock('@/components/reports/SavedReportsPanel', () => ({ SavedReportsPanel: (p: { kind: string; source?: { table: string; id: string } }) => <div data-testid="saved">{`${p.kind}:${p.source?.table}:${p.source?.id}`}</div> }))
import { MonthlyReportPanel } from './MonthlyReportPanel'

const monthly = (reason: string | null) => ({
  notes: { summary: 'Good', performance: '', downtime: '', financial: '', actions: '' },
  notesUpdatedAt: { summary: 'N1', performance: null, downtime: null, financial: null, actions: null },
  generateReason: reason, tariffName: reason ? null : 'Business 1 (City of Tshwane, 2026/27)',
})
beforeEach(() => vi.clearAllMocks())

describe('MonthlyReportPanel', () => {
  it('Generate is disabled with the reason (e.g. no pinned tariff)', () => {
    render(<MonthlyReportPanel projectId="p1" installationId="i1" month="2026-03" monthly={monthly('No tariff is pinned for this study — pin one on the Tariff tab.')} />)
    expect((screen.getByRole('button', { name: 'Generate report for March 2026' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('No tariff is pinned for this study — pin one on the Tariff tab.')).toBeTruthy()
  })
  it('generates a new version with the revision note and lists versions for the installation', async () => {
    render(<MonthlyReportPanel projectId="p1" installationId="i1" month="2026-03" monthly={monthly(null)} />)
    expect(screen.getByText(/Business 1 \(City of Tshwane, 2026\/27\)/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Revision note'), { target: { value: 'Rev B' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate report for March 2026' }))
    await waitFor(() => expect(h.gen).toHaveBeenCalledWith({ projectId: 'p1', month: '2026-03', note: 'Rev B' }))
    expect(await screen.findByText('Version 2 saved.')).toBeTruthy()
    expect(screen.getByTestId('saved').textContent).toBe('solar_monthly:solar.installations:i1')
  })
  it('saves one commentary section on its own version (numbers are never frozen by typing)', async () => {
    render(<MonthlyReportPanel projectId="p1" installationId="i1" month="2026-03" monthly={monthly(null)} />)
    fireEvent.change(screen.getByLabelText('Summary commentary'), { target: { value: 'Great month' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Summary commentary' }))
    await waitFor(() => expect(h.note).toHaveBeenCalledWith({ projectId: 'p1', installationId: 'i1', month: '2026-03', section: 'summary', body: 'Great month', expectedUpdatedAt: 'N1' }))
    fireEvent.change(screen.getByLabelText('Actions'), { target: { value: 'Replace fuse' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Actions' }))
    await waitFor(() => expect(h.note).toHaveBeenLastCalledWith(expect.objectContaining({ section: 'actions', expectedUpdatedAt: null })))
  })
  it('no month yet: says why', () => {
    render(<MonthlyReportPanel projectId="p1" installationId="i1" month={null} monthly={monthly('Import generation data first.')} />)
    expect(screen.getByText('Import generation data first.')).toBeTruthy()
    expect(screen.queryByLabelText('Summary commentary')).toBeNull()
  })
})
