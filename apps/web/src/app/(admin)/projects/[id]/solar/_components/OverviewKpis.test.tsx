import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ sel: vi.fn(), refresh: vi.fn(), push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh, push: h.push }) }))
vi.mock('@/actions/solar-cases.actions', () => ({ setSelectedSolarCaseAction: h.sel }))
vi.mock('@/actions/solar-reports.actions', () => ({ generateSolarReportAction: vi.fn() }))
import { OverviewKpis } from './OverviewKpis'
import type { HeadlineKpis } from '@/lib/solar/cases/page-data'

const kpis: HeadlineKpis = {
  caseId: 'c1', caseName: 'Base',
  energy: { dcKwp: 500, acKw: 400, batteryKwh: null, batteryKw: null, annualAcKwh: 845_000, specificYieldKwhPerKwp: 1690, selfConsumption: 0.83, solarFraction: 0.58, exportKwh: 140_000 },
  money: { billBeforeZar: 1_000_000, billAfterZar: 600_000, savingZar: 400_000, simplePaybackYears: 4.6, irr: 0.21, npvZar: 2_000_000, lcoeZarPerKwh: 0.95 },
}
const selectable = [{ id: 'c1', name: 'Base' }, { id: 'c2', name: 'Big' }]
beforeEach(() => vi.clearAllMocks())

describe('OverviewKpis (§2.2, §2.4)', () => {
  it('empty state when no case has been run; View sees no controls', () => {
    render(<OverviewKpis projectId="p1" level="view" kpis={null} selectable={[]} selectedCaseId={null} studyUpdatedAt={null} stale={false} />)
    expect(screen.getByText('No case has been run yet — start at Site & Supply.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to Site & Supply' }).getAttribute('href')).toBe('/projects/p1/solar/site')
    expect(screen.queryByLabelText('Change selected case')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Generate feasibility report' })).toBeNull()
  })
  it('runs exist but no case is selected: points at choosing the selected case, not "no case has been run"', () => {
    const { rerender } = render(<OverviewKpis projectId="p1" level="edit" kpis={null} selectable={selectable} selectedCaseId={null} studyUpdatedAt="T0" stale={false} />)
    expect(screen.queryByText(/No case has been run yet/)).toBeNull()
    expect(screen.getByText('Choose the selected case — reports and proposals use it.')).toBeTruthy()
    expect(screen.getByText('Use Change selected case below.')).toBeTruthy()
    rerender(<OverviewKpis projectId="p1" level="view" kpis={null} selectable={selectable} selectedCaseId={null} studyUpdatedAt="T0" stale={false} />)
    expect(screen.getByRole('link', { name: 'Open Yield & Scenarios' }).getAttribute('href')).toBe('/projects/p1/solar/yield')
  })
  it('Edit with no completed runs: the selected-case control is disabled with its reason', () => {
    render(<OverviewKpis projectId="p1" level="edit" kpis={null} selectable={[]} selectedCaseId={null} studyUpdatedAt="T0" stale={false} />)
    expect((screen.getByLabelText('Change selected case') as HTMLSelectElement).disabled).toBe(true)
    expect(screen.getByText('Run a case on Yield & Scenarios first')).toBeTruthy()
  })
  it('energy KPIs for everyone; rand values only with money', () => {
    const { rerender } = render(<OverviewKpis projectId="p1" level="edit_financials" kpis={kpis} selectable={selectable} selectedCaseId="c1" studyUpdatedAt="T0" stale={false} />)
    for (const t of ['500.0 kWp / 400.0 kW', '845.0 MWh (1 690 kWh/kWp)', '83.0 %', '58.0 %', '140.0 MWh', 'R 1 000 000 → R 600 000', 'R 400 000', 'Year-1 bill saving', '4.6 years', '21.0 %', 'R 2 000 000', 'R 0.95/kWh']) expect(screen.getByText(t)).toBeTruthy()
    rerender(<OverviewKpis projectId="p1" level="edit" kpis={{ ...kpis, money: null }} selectable={selectable} selectedCaseId="c1" studyUpdatedAt="T0" stale={false} />)
    expect(screen.queryByText('R 400 000')).toBeNull()
    expect(screen.queryByText('IRR')).toBeNull()
    expect(screen.queryByText(/^R /)).toBeNull()
  })
  it('an Edit caller never renders money even if a money object were handed over', () => {
    render(<OverviewKpis projectId="p1" level="edit" kpis={kpis} selectable={selectable} selectedCaseId="c1" studyUpdatedAt="T0" stale={false} />)
    expect(screen.queryByText('R 400 000')).toBeNull()
    expect(screen.queryByText('NPV')).toBeNull()
  })
  it('Edit + financials without a financial result: a pointer, no rand values', () => {
    render(<OverviewKpis projectId="p1" level="edit_financials" kpis={{ ...kpis, money: null }} selectable={selectable} selectedCaseId="c1" studyUpdatedAt="T0" stale={false} />)
    expect(screen.getByText('Run financials for this case to see rand values.')).toBeTruthy()
  })
  it('Change selected case (write) calls the action with the study stale guard', async () => {
    h.sel.mockResolvedValue({ ok: true, updatedAt: 'T1' })
    render(<OverviewKpis projectId="p1" level="edit" kpis={kpis} selectable={selectable} selectedCaseId="c1" studyUpdatedAt="T0" stale={false} />)
    fireEvent.change(screen.getByLabelText('Change selected case'), { target: { value: 'c2' } })
    await waitFor(() => expect(h.sel).toHaveBeenCalledWith({ projectId: 'p1', caseId: 'c2', expectedUpdatedAt: 'T0' }))
    await waitFor(() => expect(h.refresh).toHaveBeenCalled())
    expect(screen.getByRole('link', { name: 'Open case' }).getAttribute('href')).toBe('/projects/p1/solar/yield?case=c1')
  })
  it('a refused selection shows its sentence', async () => {
    h.sel.mockResolvedValue({ error: 'Someone else changed this study — reload.' })
    render(<OverviewKpis projectId="p1" level="edit" kpis={kpis} selectable={selectable} selectedCaseId="c1" studyUpdatedAt="T0" stale={false} />)
    fireEvent.change(screen.getByLabelText('Change selected case'), { target: { value: 'c2' } })
    await screen.findByText('Someone else changed this study — reload.')
  })
  it('Generate feasibility report: cost-view writers only, disabled while stale with the reason', () => {
    render(<OverviewKpis projectId="p1" level="edit_financials" kpis={kpis} selectable={selectable} selectedCaseId="c1" studyUpdatedAt="T0" stale />)
    const b = screen.getByRole('button', { name: 'Generate feasibility report' }) as HTMLButtonElement
    expect(b.disabled).toBe(true)
    expect(b.title).toBe('The selected case is stale — re-run it first')
  })
  it('Generate feasibility report is enabled when current and priced', () => {
    render(<OverviewKpis projectId="p1" level="edit_financials" kpis={kpis} selectable={selectable} selectedCaseId="c1" studyUpdatedAt="T0" stale={false} />)
    expect((screen.getByRole('button', { name: 'Generate feasibility report' }) as HTMLButtonElement).disabled).toBe(false)
  })
  it('Generate feasibility report is disabled with the reason when the case has no financials yet', () => {
    render(<OverviewKpis projectId="p1" level="edit_financials" kpis={{ ...kpis, money: null }} selectable={selectable} selectedCaseId="c1" studyUpdatedAt="T0" stale={false} />)
    const b = screen.getByRole('button', { name: 'Generate feasibility report' }) as HTMLButtonElement
    expect(b.disabled).toBe(true)
    expect(b.title).toBe('Run financials for the selected case first')
  })
})
