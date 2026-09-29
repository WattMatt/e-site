import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ save: vi.fn(async () => ({ ok: true })), del: vi.fn(async () => ({ ok: true })), refresh: vi.fn() }))
vi.mock('@/actions/solar-operations.actions', () => ({ saveIrradiationAction: h.save, deleteIrradiationAction: h.del }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
import { IrradiationCard } from './IrradiationCard'
beforeEach(() => vi.clearAllMocks())

describe('IrradiationCard', () => {
  it('records a month with its plane and source', async () => {
    render(<IrradiationCard projectId="p1" installationId="i1" canEdit entries={[]} />)
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-03' } })
    fireEvent.change(screen.getByLabelText('Plane'), { target: { value: 'poa' } })
    fireEvent.change(screen.getByLabelText('Irradiation kWh/m²'), { target: { value: '150.5' } })
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'Site pyranometer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save irradiation' }))
    await waitFor(() => expect(h.save).toHaveBeenCalledWith({ projectId: 'p1', installationId: 'i1', month: '2026-03', plane: 'poa', kwhPerM2: 150.5, sourceNote: 'Site pyranometer' }))
  })
  it('Save irradiation is disabled while it is saving, so a double press cannot write twice (review round 2)', async () => {
    let release: (v: { ok: true }) => void = () => {}
    h.save.mockImplementationOnce((() => new Promise((r) => { release = r })) as never)
    render(<IrradiationCard projectId="p1" installationId="i1" canEdit entries={[]} />)
    const save = screen.getByRole('button', { name: 'Save irradiation' }) as HTMLButtonElement
    fireEvent.click(save)
    await waitFor(() => expect(save.disabled).toBe(true))
    fireEvent.click(save)
    expect(h.save).toHaveBeenCalledTimes(1)
    release({ ok: true })
    await waitFor(() => expect(save.disabled).toBe(false))
  })
  it('lists entries and removes one on the second press', async () => {
    render(<IrradiationCard projectId="p1" installationId="i1" canEdit entries={[{ month: '2026-03', plane: 'ghi', kwhPerM2: 180, sourceNote: 'Portal' }]} />)
    expect(screen.getByText('March 2026')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove March 2026' }))
    expect(h.del).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove March 2026' }))
    await waitFor(() => expect(h.del).toHaveBeenCalledWith({ projectId: 'p1', installationId: 'i1', month: '2026-03' }))
  })
  it('View level: entries only, no controls', () => {
    render(<IrradiationCard projectId="p1" installationId="i1" canEdit={false} entries={[{ month: '2026-03', plane: 'poa', kwhPerM2: 150, sourceNote: 'Portal' }]} />)
    expect(screen.getByText('Plane of array')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
