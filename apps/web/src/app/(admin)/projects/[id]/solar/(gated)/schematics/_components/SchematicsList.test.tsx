import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ create: vi.fn(), del: vi.fn(), waive: vi.fn(), replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/solar-schematics.actions', () => ({ createSchematicAction: h.create, deleteSchematicsAction: h.del, setSchematicWaivedAction: h.waive, replaceSchematicDrawingAction: h.replace }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push, refresh: h.refresh }) }))
vi.mock('@/components/reports/SavedReportsPanel', () => ({ SavedReportsPanel: ({ kind }: { kind: string }) => <div>saved:{kind}</div> }))
import { SchematicsList } from './SchematicsList'
import type { SchematicsListView } from '@/lib/solar/schematics/view-types'

const view: SchematicsListView = {
  studyId: 's1', studyUpdatedAt: 'T0', waived: false, studyMeterCount: 5,
  schematics: [
    { id: 'sc1', name: 'Main SLD', description: null, kind: 'drawing', drawingName: 'SLD', pageIndex: 2, placed: 3, updatedAt: 'U1' },
    { id: 'sc2', name: 'Blank', description: null, kind: 'blank', drawingName: null, pageIndex: 1, placed: 0, updatedAt: 'U2' },
  ],
  drawings: [{ id: 'fp1', name: 'SLD', isPdf: true }],
}
beforeEach(() => {
  vi.clearAllMocks()
  h.create.mockResolvedValue({ ok: true, id: 'sc9' })
  h.del.mockResolvedValue({ ok: true, deleted: 2 })
  h.waive.mockResolvedValue({ ok: true, updatedAt: 'T1' })
  h.replace.mockResolvedValue({ ok: true, updatedAt: 'U9' })
})

describe('SchematicsList', () => {
  it('lists name, drawing and page, meters placed of total, and the saved sheets', () => {
    render(<SchematicsList projectId="p1" view={view} canEdit />)
    expect(screen.getByRole('link', { name: 'Main SLD' }).getAttribute('href')).toBe('/projects/p1/solar/schematics/sc1')
    expect(screen.getByText('SLD · page 2')).toBeTruthy()
    expect(screen.getByText('Blank canvas')).toBeTruthy()
    expect(screen.getByText('3 / 5')).toBeTruthy()
    expect(screen.getByText('saved:solar_schematic_sheet')).toBeTruthy()
  })
  it('adds a schematic from a drawing and page, then opens it', async () => {
    render(<SchematicsList projectId="p1" view={view} canEdit />)
    await userEvent.click(screen.getByRole('button', { name: 'Add schematic' }))
    await userEvent.type(screen.getByLabelText('Name'), 'MV')
    await userEvent.selectOptions(screen.getByLabelText('Drawing'), 'fp1')
    await userEvent.clear(screen.getByLabelText('Page'))
    await userEvent.type(screen.getByLabelText('Page'), '3')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(h.create).toHaveBeenCalledWith({ projectId: 'p1', name: 'MV', description: null, source: { kind: 'drawing', floorPlanId: 'fp1', pageIndex: 3 } })
    expect(h.push).toHaveBeenCalledWith('/projects/p1/solar/schematics/sc9')
  })
  it('adds a blank canvas', async () => {
    render(<SchematicsList projectId="p1" view={view} canEdit />)
    await userEvent.click(screen.getByRole('button', { name: 'Add schematic' }))
    await userEvent.type(screen.getByLabelText('Name'), 'Sketch')
    await userEvent.click(screen.getByLabelText('Blank canvas'))
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(h.create).toHaveBeenCalledWith({ projectId: 'p1', name: 'Sketch', description: null, source: { kind: 'blank' } })
  })
  it('delete selected is two-step with the count', async () => {
    render(<SchematicsList projectId="p1" view={view} canEdit />)
    await userEvent.click(screen.getByLabelText('Select Main SLD'))
    await userEvent.click(screen.getByLabelText('Select Blank'))
    await userEvent.click(screen.getByRole('button', { name: 'Delete selected (2)' }))
    expect(h.del).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Delete 2 schematics?' }))
    expect(h.del).toHaveBeenCalledWith({ projectId: 'p1', ids: ['sc1', 'sc2'] })
    expect(h.refresh).toHaveBeenCalled()
  })
  it('replace drawing is two-step and carries the row version', async () => {
    render(<SchematicsList projectId="p1" view={view} canEdit />)
    await userEvent.click(screen.getByRole('button', { name: 'Replace drawing' }))
    const dialog = screen.getByRole('dialog', { name: 'Replace drawing' })
    expect(dialog.textContent).toContain('positions may need adjusting')
    await userEvent.selectOptions(screen.getByLabelText('Drawing'), 'fp1')
    await userEvent.click(screen.getByRole('button', { name: 'Replace' }))
    expect(h.replace).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Replace the drawing?' }))
    expect(h.replace).toHaveBeenCalledWith({ projectId: 'p1', schematicId: 'sc1', floorPlanId: 'fp1', pageIndex: 1, expectedUpdatedAt: 'U1' })
    expect(h.refresh).toHaveBeenCalled()
  })
  it('"No schematic required" is two-step and saves the waiver on the study version', async () => {
    render(<SchematicsList projectId="p1" view={view} canEdit />)
    await userEvent.click(screen.getByRole('button', { name: 'No schematic required' }))
    expect(h.waive).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Mark "No schematic required"?' }))
    expect(h.waive).toHaveBeenCalledWith({ projectId: 'p1', waived: true, expectedUpdatedAt: 'T0' })
    expect(await screen.findByText(/Marked "No schematic required"/)).toBeTruthy()
  })
  it('the waiver follows a refreshed study version (another Load-page control saved the same row)', async () => {
    const { rerender } = render(<SchematicsList projectId="p1" view={view} canEdit />)
    rerender(<SchematicsList projectId="p1" view={{ ...view, studyUpdatedAt: 'T6', waived: true }} canEdit />)
    expect(screen.getByText(/Marked "No schematic required"/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'A schematic is required' }))
    expect(h.waive).toHaveBeenCalledWith({ projectId: 'p1', waived: false, expectedUpdatedAt: 'T6' })
  })
  it('a refused waiver shows the reason and keeps the state', async () => {
    h.waive.mockResolvedValue({ error: 'Someone else changed this — reload to see their version.' })
    render(<SchematicsList projectId="p1" view={view} canEdit />)
    await userEvent.click(screen.getByRole('button', { name: 'No schematic required' }))
    await userEvent.click(screen.getByRole('button', { name: 'Mark "No schematic required"?' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Someone else changed this')
    expect(screen.getByRole('button', { name: 'No schematic required' })).toBeTruthy()
  })
  it('empty state; View hides every control', () => {
    const { unmount } = render(<SchematicsList projectId="p1" view={{ ...view, schematics: [] }} canEdit />)
    expect(screen.getByText("Add a single-line diagram from the project's drawings")).toBeTruthy()
    unmount()
    render(<SchematicsList projectId="p1" view={view} canEdit={false} />)
    expect(screen.queryByRole('button', { name: 'Add schematic' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'No schematic required' })).toBeNull()
    expect(screen.queryByLabelText('Select Main SLD')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Replace drawing' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Main SLD' })).toBeTruthy()
  })
})
