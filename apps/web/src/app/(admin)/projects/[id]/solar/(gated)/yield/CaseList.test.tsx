import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), dup: vi.fn(), del: vi.fn(), sel: vi.fn(), ren: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push, refresh: h.refresh }) }))
vi.mock('@/actions/solar-cases.actions', () => ({ duplicateSolarCaseAction: h.dup, deleteSolarCaseAction: h.del, setSelectedSolarCaseAction: h.sel, renameSolarCaseAction: h.ren, createSolarCaseAction: vi.fn() }))
import { CaseList } from './CaseList'
import type { CaseCardView } from '@/lib/solar/cases/page-data'

const card = (over: Partial<CaseCardView>): CaseCardView => ({ id: 'c1', name: 'Base', pvSource: 'manual', dcKwp: 500, acKw: 400, batteryKwh: null, updatedAt: 'T', status: 'done', statusLabel: 'Done', lastRunAt: '2026-09-28T09:00:05Z', annualPvKwh: 800_000, year1SavingZar: 400_000, selected: true, canSelect: true, ...over })
const big = (over: Partial<CaseCardView> = {}) => card({ id: 'c2', name: 'Big', dcKwp: 800, acKw: 600, annualPvKwh: null, year1SavingZar: null, selected: false, ...over })
beforeEach(() => vi.clearAllMocks())

describe('CaseList', () => {
  it('cards show kWp, status, yield; saving only when given (cost-view)', () => {
    render(<CaseList projectId="p1" level="edit_financials" cases={[card({}), big({ status: 'stale', statusLabel: 'Stale' })]} studyUpdatedAt="T0" openCaseId="c1" />)
    expect(screen.getByText('500.0 kWp · 400.0 kW AC')).toBeTruthy()
    expect(screen.getByText('Stale')).toBeTruthy()
    expect(screen.getByText('800.0 MWh/yr')).toBeTruthy()
    expect(screen.getByText('Year-1 bill saving R 400 000')).toBeTruthy()
    expect(screen.getAllByText(/Year-1 bill saving/)).toHaveLength(1)
    expect(screen.getByText('Selected')).toBeTruthy()
  })
  it('View users see no write controls', () => {
    render(<CaseList projectId="p1" level="view" cases={[card({})]} studyUpdatedAt="T0" openCaseId="c1" />)
    for (const name of ['New case', 'Duplicate', 'Rename', 'Delete', 'Set as selected']) expect(screen.queryByRole('button', { name })).toBeNull()
    expect(screen.getByRole('button', { name: 'Compare' })).toBeTruthy()
  })
  it('Delete arms first, commits on the second press; selected case delete shows the server sentence', async () => {
    h.del.mockResolvedValue({ error: 'This is the selected case — choose another selected case first.' })
    render(<CaseList projectId="p1" level="edit" cases={[card({})]} studyUpdatedAt="T0" openCaseId="c1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(h.del).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete “Base”?' }))
    await screen.findByText('This is the selected case — choose another selected case first.')
    expect(h.del).toHaveBeenCalledWith({ projectId: 'p1', caseId: 'c1' })
    expect(h.refresh).not.toHaveBeenCalled()
  })
  it('Compare needs 2–4 ticked cases and navigates with their ids', () => {
    render(<CaseList projectId="p1" level="view" cases={[card({}), big()]} studyUpdatedAt="T0" openCaseId="c1" />)
    const compare = screen.getByRole('button', { name: 'Compare' }) as HTMLButtonElement
    expect(compare.disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('Compare Base'))
    fireEvent.click(screen.getByLabelText('Compare Big'))
    fireEvent.click(compare)
    expect(h.push).toHaveBeenCalledWith('/projects/p1/solar/yield?compare=c1,c2')
  })
  it('Set as selected is offered only for a case with a completed run', async () => {
    h.sel.mockResolvedValue({ ok: true, updatedAt: 'T1' })
    render(<CaseList projectId="p1" level="edit" cases={[card({ selected: false }), big({ canSelect: false })]} studyUpdatedAt="T0" openCaseId="c1" />)
    const buttons = screen.getAllByRole('button', { name: 'Set as selected' }) as HTMLButtonElement[]
    expect(buttons.map((b) => b.disabled)).toEqual([false, true])
    fireEvent.click(buttons[0]!)
    await waitFor(() => expect(h.sel).toHaveBeenCalledWith({ projectId: 'p1', caseId: 'c1', expectedUpdatedAt: 'T0' }))
    await waitFor(() => expect(h.refresh).toHaveBeenCalled())
  })
  it('Rename sends the new name with expectedUpdatedAt', async () => {
    h.ren.mockResolvedValue({ ok: true, updatedAt: 'T2' })
    render(<CaseList projectId="p1" level="edit" cases={[card({ updatedAt: 'U1' })]} studyUpdatedAt="T0" openCaseId="c1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    fireEvent.change(screen.getByLabelText('New name'), { target: { value: 'Option A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    await waitFor(() => expect(h.ren).toHaveBeenCalledWith({ projectId: 'p1', caseId: 'c1', name: 'Option A', expectedUpdatedAt: 'U1' }))
  })
  it('no cases → empty state with New case for writers', () => {
    render(<CaseList projectId="p1" level="edit" cases={[]} studyUpdatedAt="T0" openCaseId={null} />)
    expect(screen.getByText('No cases yet')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'New case' }).length).toBeGreaterThan(0)
  })
})
