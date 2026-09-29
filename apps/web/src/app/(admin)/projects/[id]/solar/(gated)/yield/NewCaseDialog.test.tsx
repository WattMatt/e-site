import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ create: vi.fn(), push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push, refresh: vi.fn() }) }))
vi.mock('@/actions/solar-cases.actions', () => ({ createSolarCaseAction: h.create }))
import { NewCaseDialog } from './NewCaseDialog'
import { setSolarDirty } from '@/lib/solar/dirty-store'

beforeEach(() => vi.clearAllMocks())
describe('NewCaseDialog', () => {
  it('From layout is disabled with the reason when no layout has modules; Manual creates and opens the case', async () => {
    h.create.mockResolvedValue({ ok: true, caseId: 'c9' })
    render(<NewCaseDialog projectId="p1" cases={[{ id: 'c1', name: 'Base' }]} layouts={[{ id: 'L0', name: 'Empty roof', moduleCount: 0, dcKwp: 0 }]} onClose={() => {}} />)
    const layout = screen.getByLabelText('From layout') as HTMLInputElement
    expect(layout.disabled).toBe(true)
    expect(screen.getByText(/draw a layout with modules on the Layout tab first/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Option B' } })
    fireEvent.change(screen.getByLabelText('DC size (kWp)'), { target: { value: '600' } })
    fireEvent.change(screen.getByLabelText('AC size (kW)'), { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create case' }))
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/projects/p1/solar/yield?case=c9'))
    expect(h.create).toHaveBeenCalledWith({ projectId: 'p1', name: 'Option B', start: { kind: 'manual', dcKwp: 600, acKw: 500 } })
  })
  it('Copy of case sends the source case', async () => {
    h.create.mockResolvedValue({ ok: true, caseId: 'c9' })
    render(<NewCaseDialog projectId="p1" cases={[{ id: 'c1', name: 'Base' }, { id: 'c2', name: 'Big' }]} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Big copy' } })
    fireEvent.click(screen.getByLabelText('Copy of case'))
    fireEvent.change(screen.getByLabelText('Case to copy'), { target: { value: 'c2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create case' }))
    await waitFor(() => expect(h.create).toHaveBeenCalledWith({ projectId: 'p1', name: 'Big copy', start: { kind: 'copy', fromCaseId: 'c2' } }))
  })
  it('field errors render beside their fields', async () => {
    h.create.mockResolvedValue({ fieldErrors: { name: 'A case with this name already exists' } })
    render(<NewCaseDialog projectId="p1" cases={[]} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Base' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create case' }))
    await screen.findByText('A case with this name already exists')
    expect(h.push).not.toHaveBeenCalled()
  })
  it('From layout sends the chosen layout (only layouts with modules are offered)', async () => {
    h.create.mockResolvedValue({ ok: true, caseId: 'c9' })
    render(<NewCaseDialog projectId="p1" cases={[]} layouts={[{ id: 'L0', name: 'Empty', moduleCount: 0, dcKwp: 0 }, { id: 'L1', name: 'Roof A', moduleCount: 182, dcKwp: 100.1 }, { id: 'L2', name: 'Roof B', moduleCount: 20, dcKwp: 11 }]} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Roof B case' } })
    fireEvent.click(screen.getByLabelText('From layout'))
    const pick = screen.getByLabelText('Layout') as HTMLSelectElement
    expect([...pick.options].map((o) => o.textContent)).toEqual(['Roof A — 100.1 kWp', 'Roof B — 11 kWp'])
    fireEvent.change(pick, { target: { value: 'L2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create case' }))
    await waitFor(() => expect(h.create).toHaveBeenCalledWith({ projectId: 'p1', name: 'Roof B case', start: { kind: 'layout', layoutId: 'L2' } }))
  })
  it('YF-08: with unsaved case edits, Create asks first and creates nothing until Discard', async () => {
    setSolarDirty(true)
    try {
      h.create.mockResolvedValue({ ok: true, caseId: 'c9' })
      render(<NewCaseDialog projectId="p1" cases={[]} onClose={() => {}} />)
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Option B' } })
      fireEvent.change(screen.getByLabelText('DC size (kWp)'), { target: { value: '600' } })
      fireEvent.change(screen.getByLabelText('AC size (kW)'), { target: { value: '500' } })
      fireEvent.click(screen.getByRole('button', { name: 'Create case' }))
      expect(screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeTruthy()
      expect(h.create).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
      await waitFor(() => expect(h.push).toHaveBeenCalledWith('/projects/p1/solar/yield?case=c9'))
    } finally { setSolarDirty(false) }
  })
})
