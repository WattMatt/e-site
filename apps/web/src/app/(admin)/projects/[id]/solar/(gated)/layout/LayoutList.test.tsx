import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ create: vi.fn(), dup: vi.fn(), rename: vi.fn(), del: vi.fn(), push: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/solar-layout.actions', () => ({ createLayoutAction: h.create, duplicateLayoutAction: h.dup, renameLayoutAction: h.rename, deleteLayoutAction: h.del }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push, refresh: h.refresh }) }))

import { LayoutList } from './LayoutList'

const sources = [{ id: 'rs1', label: 'Roof · page 1', pixelsPerMeter: 50 }]
const layouts = [{ id: 'L1', name: 'Option A', roofSourceId: 'rs1', dcKwp: 26.4, moduleCount: 48, updatedAt: '2026-09-28T10:00:00Z' }]
beforeEach(() => vi.clearAllMocks())

describe('LayoutList', () => {
  it('lists name, roof source, kWp and links to the editor', () => {
    render(<LayoutList projectId="p1" canEdit layouts={layouts} sources={sources} />)
    expect(screen.getByRole('link', { name: 'Option A' }).getAttribute('href')).toBe('/projects/p1/solar/layout/L1')
    expect(screen.getByText('Roof · page 1')).toBeTruthy()
    expect(screen.getByText('26.40 kWp')).toBeTruthy()
  })
  it('View level: no write controls', () => {
    render(<LayoutList projectId="p1" canEdit={false} layouts={layouts} sources={sources} />)
    for (const n of ['New layout', 'Duplicate', 'Rename', 'Delete']) expect(screen.queryByRole('button', { name: n })).toBeNull()
  })
  it('New layout shows the name error BEFORE anything is created and does not close', async () => {
    h.create.mockResolvedValue({ fieldErrors: { name: 'A layout with that name already exists.' } })
    render(<LayoutList projectId="p1" canEdit layouts={layouts} sources={sources} />)
    fireEvent.click(screen.getByRole('button', { name: 'New layout' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'option a' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(screen.getByText('A layout with that name already exists.')).toBeTruthy())
    expect(h.push).not.toHaveBeenCalled()
  })
  it('creates and opens the editor', async () => {
    h.create.mockResolvedValue({ ok: true, id: 'L9' })
    render(<LayoutList projectId="p1" canEdit layouts={[]} sources={sources} />)
    fireEvent.click(screen.getByRole('button', { name: 'New layout' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Option B' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/projects/p1/solar/layout/L9'))
    expect(h.create.mock.calls[0]![0]).toMatchObject({ projectId: 'p1', name: 'Option B', roofSourceId: 'rs1', defaultTiltDeg: 10 })
  })
  it('delete is two-step', async () => {
    h.del.mockResolvedValue({ ok: true })
    render(<LayoutList projectId="p1" canEdit layouts={layouts} sources={sources} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(h.del).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
    await waitFor(() => expect(h.del).toHaveBeenCalledWith({ projectId: 'p1', layoutId: 'L1' }))
  })
  it('no roof source yet: explains where to add one', () => {
    render(<LayoutList projectId="p1" canEdit layouts={[]} sources={[]} />)
    expect(screen.getByText('Add a roof source in Site & Supply first.')).toBeTruthy()
  })
})
