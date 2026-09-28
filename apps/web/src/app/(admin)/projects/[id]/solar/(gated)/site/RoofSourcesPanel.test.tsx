import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ add: vi.fn(), remove: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/solar-roof-sources.actions', () => ({ addDrawingRoofSourceAction: h.add, removeRoofSourceAction: h.remove }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))

import { RoofSourcesPanel } from './RoofSourcesPanel'
import type { RoofSourceRow } from '@/lib/solar/layout-loader'

const row: RoofSourceRow = {
  id: 'rs1', kind: 'drawing', floorPlanId: 'fp1', pageIndex: 1, label: 'Roof · page 1', pixelsPerMeter: 50,
  northBearingDeg: null, northSet: false, drawingChanged: false, attribution: null, updatedAt: 'T',
}
const base = { projectId: 'p1', drawings: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Roof plan' }], hasStudy: true, satelliteConfigured: true }

beforeEach(() => vi.clearAllMocks())

describe('RoofSourcesPanel', () => {
  it('empty state', () => {
    render(<RoofSourcesPanel {...base} canEdit sources={[]} />)
    expect(screen.getByText("Add the roof plan from the project's drawings")).toBeTruthy()
  })
  it('lists scale and north, links to the sheet', () => {
    render(<RoofSourcesPanel {...base} canEdit sources={[row]} />)
    expect(screen.getByText('Roof · page 1')).toBeTruthy()
    expect(screen.getByLabelText('Scale set')).toBeTruthy()
    expect(screen.getByLabelText('North not set')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open sheet' }).getAttribute('href')).toBe('/projects/p1/solar/layout/sources/rs1')
  })
  it('View level: no add, remove or capture', () => {
    render(<RoofSourcesPanel {...base} canEdit={false} sources={[row]} />)
    expect(screen.queryByRole('button', { name: 'Add roof drawing' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Capture satellite view' })).toBeNull()
  })
  it('adds a drawing page', async () => {
    h.add.mockResolvedValue({ ok: true, id: 'rs9' })
    render(<RoofSourcesPanel {...base} canEdit sources={[]} />)
    fireEvent.change(screen.getByLabelText('Drawing'), { target: { value: base.drawings[0]!.id } })
    fireEvent.change(screen.getByLabelText('Page'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add roof drawing' }))
    await waitFor(() => expect(h.add).toHaveBeenCalledWith({ projectId: 'p1', floorPlanId: base.drawings[0]!.id, pageIndex: 2 }))
    expect(h.refresh).toHaveBeenCalled()
  })
  it('remove is two-step', async () => {
    h.remove.mockResolvedValue({ ok: true })
    render(<RoofSourcesPanel {...base} canEdit sources={[row]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(h.remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove' }))
    await waitFor(() => expect(h.remove).toHaveBeenCalledWith({ projectId: 'p1', roofSourceId: 'rs1' }))
  })
  it('satellite capture is disabled, with the reason, when not configured', () => {
    render(<RoofSourcesPanel {...base} canEdit sources={[]} satelliteConfigured={false} />)
    const b = screen.getByRole('button', { name: 'Capture satellite view' }) as HTMLButtonElement
    expect(b.disabled).toBe(true)
    expect(screen.getByText('Satellite capture is not configured on this server.')).toBeTruthy()
  })
})
