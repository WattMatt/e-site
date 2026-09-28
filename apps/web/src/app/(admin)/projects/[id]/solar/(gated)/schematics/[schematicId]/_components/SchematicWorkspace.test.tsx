import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ save: vi.fn(), stub: vi.fn(), include: vi.fn(), exportPdf: vi.fn(), refresh: vi.fn(), getDraft: vi.fn(), setDraft: vi.fn(), clearDraft: vi.fn() }))
vi.mock('@/actions/solar-schematics.actions', () => ({
  saveSchematicAction: h.save, createMeterStubAction: h.stub, setIncludeInLoadAction: h.include, exportSchematicSheetAction: h.exportPdf,
  replaceSchematicDrawingAction: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }))
vi.mock('@/lib/sheet/draft-store', () => ({ getDraft: h.getDraft, setDraft: h.setDraft, clearDraft: h.clearDraft }))
vi.mock('@/components/reports/SavedReportsPanel', () => ({ SavedReportsPanel: () => null }))
// Konva does not run under jsdom: the canvas is a stub that turns buttons into the canvas's presses.
vi.mock('next/dynamic', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: () => function StubCanvas(p: any) {
    return (
      <div>
        <span>{`canvas-editable:${String(p.editable)}`}</span>
        <button type="button" onClick={() => p.onPress({ kind: 'empty', x: 100, y: 100, shift: false })}>canvas-empty</button>
        {p.doc.cards.map((c: { meterId: string; x: number; y: number }) => (
          <span key={c.meterId}>
            <button type="button" onClick={() => p.onPress({ kind: 'card', id: c.meterId, x: c.x, y: c.y, shift: false })}>{`card-${c.meterId}`}</button>
            <button type="button" onClick={() => p.onToggleInclude(c.meterId)}>{`include-${c.meterId}`}</button>
            <span>{`included-${c.meterId}:${String(p.meters.get(c.meterId)?.included)}`}</span>
          </span>
        ))}
      </div>
    )
  },
}))
import { SchematicWorkspace } from './SchematicWorkspace'
import type { EditorView } from '@/lib/solar/schematics/view-types'

const view: EditorView = {
  schematic: { id: 'sc1', name: 'Main', description: null, kind: 'blank', pageIndex: 1, updatedAt: 'U0', canvasW: 2400, canvasH: 1600, anchorChanged: false, floorPlanId: null },
  sheet: null,
  doc: { cards: [{ meterId: 'A', x: 0, y: 0, w: 180, h: 64, colour: null }, { meterId: 'B', x: 400, y: 0, w: 180, h: 64, colour: null }], lines: [] },
  meters: [
    { id: 'A', label: 'Bulk', kind: 'bulk', tenantLabel: null, nodeId: null, included: null },
    { id: 'B', label: 'Pep', kind: 'tenant', tenantLabel: '12 · Pep', nodeId: 'n1', included: true },
    { id: 'C', label: 'KFC', kind: 'tenant', tenantLabel: '13 · KFC', nodeId: 'n2', included: false },
  ],
  externalLines: [],
  drawings: [],
}
beforeEach(() => {
  vi.clearAllMocks()
  h.save.mockResolvedValue({ ok: true, updatedAt: 'U1' })
  h.include.mockResolvedValue({ ok: true, nodeId: 'n1', included: { B: false } })
  h.getDraft.mockResolvedValue(null)
  h.setDraft.mockResolvedValue(undefined)
  h.clearDraft.mockResolvedValue(undefined)
})

describe('SchematicWorkspace', () => {
  it('places an unplaced meter where the user clicked; undo and redo', async () => {
    render(<SchematicWorkspace projectId="p1" view={view} canEdit />)
    await userEvent.click(screen.getByRole('button', { name: 'Place meter (P)' }))
    await userEvent.click(screen.getByText('canvas-empty'))
    const dialog = screen.getByRole('dialog', { name: 'Place meter' })
    expect(dialog.textContent).toContain('KFC')
    expect(dialog.textContent).not.toContain('Pep')
    await userEvent.click(screen.getByRole('button', { name: /KFC/ }))
    expect(screen.getByText('card-C')).toBeTruthy()
    expect(h.setDraft).toHaveBeenCalledWith('solar-schematic:sc1', expect.objectContaining({ basedOn: 'U0' }))
    await userEvent.click(screen.getByRole('button', { name: 'Undo (⌘Z)' }))
    expect(screen.queryByText('card-C')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Redo (⇧⌘Z)' }))
    expect(screen.getByText('card-C')).toBeTruthy()
  })
  it('undo / redo with nothing to undo is a no-op: the schematic does not become dirty', async () => {
    render(<SchematicWorkspace projectId="p1" view={{ ...view, schematic: { ...view.schematic, kind: 'drawing' } }} canEdit />)
    await userEvent.keyboard('{Meta>}z{/Meta}')
    await userEvent.keyboard('{Meta>}{Shift>}z{/Shift}{/Meta}')
    expect(screen.getByRole('button', { name: 'Replace drawing' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Replace drawing (save first)' })).toBeNull()
    expect(h.setDraft).not.toHaveBeenCalled()
  })
  it('the IndexedDB draft follows undo and redo, not just new edits', async () => {
    render(<SchematicWorkspace projectId="p1" view={view} canEdit />)
    await userEvent.click(screen.getByRole('button', { name: 'Place meter (P)' }))
    await userEvent.click(screen.getByText('canvas-empty'))
    await userEvent.click(screen.getByRole('button', { name: /KFC/ }))
    const lastDraftCards = () => (h.setDraft.mock.calls.at(-1)![1] as { doc: { cards: Array<{ meterId: string }> } }).doc.cards.map((c) => c.meterId)
    expect(lastDraftCards()).toEqual(['A', 'B', 'C'])
    await userEvent.click(screen.getByRole('button', { name: 'Undo (⌘Z)' }))
    expect(lastDraftCards()).toEqual(['A', 'B'])
    await userEvent.click(screen.getByRole('button', { name: 'Redo (⇧⌘Z)' }))
    expect(lastDraftCards()).toEqual(['A', 'B', 'C'])
  })
  it('creates a meter stub for an unmetered point and places it', async () => {
    h.stub.mockResolvedValue({ ok: true, meter: { id: 'D', label: 'DB-4 incomer', kind: 'unknown' } })
    render(<SchematicWorkspace projectId="p1" view={view} canEdit />)
    await userEvent.click(screen.getByRole('button', { name: 'Place meter (P)' }))
    await userEvent.click(screen.getByText('canvas-empty'))
    await userEvent.type(screen.getByLabelText('New meter label'), 'DB-4 incomer')
    await userEvent.click(screen.getByRole('button', { name: 'Create meter' }))
    expect(h.stub).toHaveBeenCalledWith({ projectId: 'p1', label: 'DB-4 incomer', kind: 'unknown' })
    expect(await screen.findByText('card-D')).toBeTruthy()
  })
  it('connects two cards (parent → child) and refuses the reverse loop', async () => {
    render(<SchematicWorkspace projectId="p1" view={view} canEdit />)
    await userEvent.click(screen.getByRole('button', { name: 'Connect (C)' }))
    await userEvent.click(screen.getByText('card-A'))
    await userEvent.click(screen.getByText('card-B'))
    expect(screen.getByRole('region', { name: 'Connections' }).textContent).toContain('Bulk → Pep')
    await userEvent.click(screen.getByText('card-B'))
    await userEvent.click(screen.getByText('card-A'))
    expect(screen.getByRole('alert').textContent).toContain('That connection would make a loop in the supply hierarchy.')
  })
  it('the connections manager adds and deletes a line', async () => {
    render(<SchematicWorkspace projectId="p1" view={view} canEdit />)
    await userEvent.selectOptions(screen.getByLabelText('Connection from'), 'A')
    await userEvent.selectOptions(screen.getByLabelText('Connection to'), 'B')
    await userEvent.selectOptions(screen.getByLabelText('Line type'), 'check')
    await userEvent.click(screen.getByRole('button', { name: 'Add connection' }))
    const region = screen.getByRole('region', { name: 'Connections' })
    expect(region.textContent).toContain('Bulk → Pep')
    expect(region.textContent).toContain('Check')
    await userEvent.click(screen.getByRole('button', { name: 'Delete Bulk to Pep' }))
    expect(screen.getByRole('region', { name: 'Connections' }).textContent).toContain('No connections yet')
  })
  it('saves on the loaded version, then on the new one, and reports a stale refusal', async () => {
    render(<SchematicWorkspace projectId="p1" view={view} canEdit />)
    await userEvent.click(screen.getByRole('button', { name: 'Save (⌘S)' }))
    expect(h.save).toHaveBeenCalledWith({ projectId: 'p1', schematicId: 'sc1', expectedUpdatedAt: 'U0', cards: expect.any(Array), lines: [] })
    expect(h.clearDraft).toHaveBeenCalledWith('solar-schematic:sc1')
    h.save.mockResolvedValue({ error: 'Someone else changed this — reload to see their version.' })
    await userEvent.click(screen.getByRole('button', { name: 'Save (⌘S)' }))
    expect(h.save).toHaveBeenLastCalledWith(expect.objectContaining({ expectedUpdatedAt: 'U1' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Someone else changed this')
  })
  it('include-in-load: refused with the reason for an unlinked meter, written for a linked one', async () => {
    render(<SchematicWorkspace projectId="p1" view={view} canEdit />)
    await userEvent.click(screen.getByText('include-A'))
    expect(h.include).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('Link this meter to a tenant first')
    await userEvent.click(screen.getByText('include-B'))
    expect(h.include).toHaveBeenCalledWith({ projectId: 'p1', meterId: 'B', include: false })
    expect((await screen.findByRole('status')).textContent).toContain('Pep excluded from the site load')
  })
  it('include-in-load: sibling cards of the same tenant follow the returned state', async () => {
    const twin: EditorView = {
      ...view,
      doc: { cards: [...view.doc.cards, { meterId: 'E', x: 800, y: 0, w: 180, h: 64, colour: null }], lines: [] },
      meters: [...view.meters, { id: 'E', label: 'Pep 2', kind: 'tenant', tenantLabel: '12 · Pep', nodeId: 'n1', included: true }],
    }
    h.include.mockResolvedValueOnce({ ok: true, nodeId: 'n1', included: { B: false, E: false } })
    render(<SchematicWorkspace projectId="p1" view={twin} canEdit />)
    expect(screen.getByText('included-E:true')).toBeTruthy()
    await userEvent.click(screen.getByText('include-B'))
    expect(await screen.findByText('included-E:false')).toBeTruthy()
    expect(screen.getByText('included-B:false')).toBeTruthy()
    await userEvent.click(screen.getByText('include-E'))
    expect(h.include).toHaveBeenLastCalledWith({ projectId: 'p1', meterId: 'E', include: true })
  })
  it('offers a draft saved against this version', async () => {
    h.getDraft.mockResolvedValue({ basedOn: 'U0', doc: { cards: [...view.doc.cards, { meterId: 'C', x: 9, y: 9, w: 180, h: 64, colour: null }], lines: [] } })
    render(<SchematicWorkspace projectId="p1" view={view} canEdit />)
    await userEvent.click(await screen.findByRole('button', { name: 'Restore' }))
    expect(screen.getByText('card-C')).toBeTruthy()
  })
  it('View level: no tools, no save, no connection editing; layers and SVG download still there', () => {
    render(<SchematicWorkspace projectId="p1" view={view} canEdit={false} />)
    expect(screen.queryByRole('button', { name: 'Place meter (P)' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save (⌘S)' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Export PDF sheet' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add connection' })).toBeNull()
    expect(screen.getByText('canvas-editable:false')).toBeTruthy()
    expect(screen.getByLabelText('Meters layer')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Download SVG' })).toBeTruthy()
    expect(h.getDraft).not.toHaveBeenCalled()
  })
})
