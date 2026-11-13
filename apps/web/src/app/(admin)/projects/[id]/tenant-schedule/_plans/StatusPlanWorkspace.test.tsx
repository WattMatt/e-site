import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { StatusPlanPageProps, CanvasShape, SheetSummary } from '@/lib/status-plans/types'

// No jest-dom in this repo (vitest.config.ts has no setupFiles): assert on textContent.
const legendRow = (label: string) =>
  within(screen.getByRole('list', { name: 'Legend entries' })).getByText(label).closest('li')!.textContent
const canvasText = () => screen.getByTestId('canvas').textContent ?? ''
/** The colour key drawn over the canvas: one "label+count" string per row. */
const keyRows = () =>
  within(within(screen.getByTestId('canvas')).getByRole('list', { name: 'Colour key' })).getAllByRole('listitem').map((li) => li.textContent)

const SHEET: SheetSummary = {
  id: 'sh1', label: 'Ground floor', sortOrder: 0, fileName: 'E-100.pdf', mime: 'application/pdf', pageIndex: 1, revision: 1,
  replacedAt: null, pixelsPerMeter: 20, updatedAt: 'u0',
}
const SHEET2: SheetSummary = { ...SHEET, id: 'sh2', label: 'Level 1', sortOrder: 1, pageIndex: 2 }

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => '/' }))
vi.mock('next/dynamic', () => ({
  default: () => (props: { shapes: CanvasShape[]; selectedId: string | null; pageIndex: number; onSelect: (id: string | null) => void; onCreate: (c: unknown) => void; onDeleteRequest: () => void; onCalibrated: (s: SheetSummary) => void; requestedTool: { tool: string } | null; focus: { box: { minX: number; minY: number; maxX: number; maxY: number }; nonce: number } | null; overlay?: ReactNode; proposals?: number[][]; arm?: { link: { nodeId: string; detectedTag: string; replaceShapeId?: string }; nonce: number } | null }) => (
    <div data-testid="canvas">
      shapes:{props.shapes.length} selected:{props.selectedId ?? 'none'} tool:{props.requestedTool?.tool ?? 'none'} page:{props.pageIndex}
      {' '}proposals:{JSON.stringify(props.proposals ?? [])}
      {' '}focus:{props.focus ? `${props.focus.box.minX},${props.focus.box.minY},${props.focus.box.maxX},${props.focus.box.maxY}#${props.focus.nonce}` : 'none'}
      {' '}arm:{props.arm ? `${props.arm.link.nodeId}/${props.arm.link.detectedTag}#${props.arm.nonce}` : 'none'}
      <button onClick={() => props.onSelect('s1')}>stub-select-s1</button>
      <button onClick={() => props.onSelect(null)}>stub-deselect</button>
      <button onClick={() => props.onCreate({ shape: 'polygon', points: [0, 0, 40, 0, 40, 30], link: { nodeId: 'n1', detectedTag: 'ZZ01', replaceShapeId: 's1' } })}>stub-create-redraw</button>
      <button onClick={() => props.onCreate({ shape: 'rect', points: [0, 0, 10, 0, 10, 10, 0, 10], link: null })}>stub-create</button>
      <button onClick={() => props.onCreate({ shape: 'polygon', points: [0, 0, 10, 0, 10, 10], link: { nodeId: 'n7', detectedTag: 'DB-7' } })}>stub-create-linked</button>
      <button onClick={() => props.onDeleteRequest()}>stub-delete-key</button>
      <button onClick={() => props.onCalibrated({ ...SHEET, pixelsPerMeter: 25, updatedAt: 'u2' })}>stub-calibrated</button>
      {props.overlay}
    </div>
  ),
}))
const actions = vi.hoisted(() => ({
  createStatusPlanShapeAction: vi.fn(),
  updateStatusPlanShapeAction: vi.fn(),
  deleteStatusPlanShapeAction: vi.fn(),
}))
vi.mock('@/actions/status-plan.actions', () => actions)
const sheetActions = vi.hoisted(() => ({
  reanchorTenantPlanSheetAction: vi.fn(),
  renameTenantPlanSheetAction: vi.fn(),
  deleteTenantPlanSheetAction: vi.fn(),
  prepareTenantPlanSheetReplaceAction: vi.fn(),
  replaceTenantPlanSheetAction: vi.fn(),
  prepareTenantPlanUploadAction: vi.fn(),
  registerTenantPlanSheetsAction: vi.fn(),
}))
vi.mock('@/actions/tenant-plan-sheets.actions', () => sheetActions)
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: vi.fn() }) } }) }))
vi.mock('@/lib/status-plans/navigate', () => ({ navigateTo: vi.fn() }))
const detection = vi.hoisted(() => ({ extractPageText: vi.fn(), acceptDetectedBlocksAction: vi.fn() }))
vi.mock('@/lib/status-plans/extract-page-text', () => ({ extractPageText: detection.extractPageText }))
vi.mock('@/actions/status-plan-detection.actions', () => ({ acceptDetectedBlocksAction: detection.acceptDetectedBlocksAction }))
const realign = vi.hoisted(() => ({ realignShapesAction: vi.fn() }))
vi.mock('@/actions/status-plan-realign.actions', () => realign)
const linking = vi.hoisted(() => ({ linkShapesByLabelAction: vi.fn(), unlinkShapesAction: vi.fn() }))
vi.mock('@/actions/status-plan-link.actions', () => linking)

import { StatusPlanWorkspace } from './StatusPlanWorkspace'

const SHAPE: CanvasShape = { id: 's1', sheetId: 'sh1', shape: 'rect', points: [100, 100, 300, 100, 300, 260, 100, 260], nodeId: null, areaType: null, detectedTag: null, source: 'manual', updatedAt: 't1' }

function props(o: Partial<StatusPlanPageProps> = {}): StatusPlanPageProps {
  return {
    projectId: 'p1',
    plan: { id: 'pl1', name: 'Floor plan', purpose: 'tenant_layout', updatedAt: 't0' },
    sheets: [SHEET],
    sheet: { ...SHEET, signedUrl: 'https://s/x', isPdf: true },
    shapes: [SHAPE],
    nodes: [{ id: 'n1', code: 'DB-ZZ01', kind: 'tenant_db', shopNumber: 'ZZ01', shopName: 'Lantern Books', scheduledM2: 80, decommissioned: false }],
    shopLinks: { n1: { state: 'active', facts: { scope: 'received', layoutIssued: true, db: 'received', lights: 'received', boDate: '2026-05-01' } } },
    dbOrders: {},
    today: '2026-06-20',
    canEdit: true,
    initialShapeId: null,
    feed: null,
    initialColourBy: 'status',
    ...o,
  }
}
const schematic = (o: Partial<StatusPlanPageProps> = {}) =>
  props({ plan: { ...props().plan, purpose: 'distribution_schematic', name: 'Line diagram' }, shopLinks: {}, ...o })

beforeEach(() => {
  vi.clearAllMocks()
  // A floor plan with no linked shop scans itself on open; by default that scan never answers.
  detection.extractPageText.mockReset().mockReturnValue(new Promise(() => {}))
})

describe('StatusPlanWorkspace', () => {
  it('shows the legend counts from live facts', () => {
    render(<StatusPlanWorkspace {...props()} />)
    expect(legendRow('Unassigned')).toBe('Unassigned1')
    expect(legendRow('Complete')).toBe('Complete0')
  })

  it('assigning a shop folds the stored shape into state', async () => {
    actions.updateStatusPlanShapeAction.mockResolvedValue({ ok: true, data: { ...SHAPE, nodeId: 'n1', updatedAt: 't2' } })
    render(<StatusPlanWorkspace {...props()} />)
    fireEvent.click(screen.getByText('stub-select-s1'))
    fireEvent.click(screen.getByRole('button', { name: /ZZ01 — Lantern Books/ }))
    await waitFor(() => expect(legendRow('Complete')).toBe('Complete1'))
    expect(actions.updateStatusPlanShapeAction).toHaveBeenCalledWith({ shapeId: 's1', expectedUpdatedAt: 't1', nodeId: 'n1' })
  })

  it('a conflict shows the sentence and a Reload button', async () => {
    actions.updateStatusPlanShapeAction.mockResolvedValue({ ok: false, error: 'This shape was changed by someone else — reload to see it.', conflict: true })
    render(<StatusPlanWorkspace {...props()} />)
    fireEvent.click(screen.getByText('stub-select-s1'))
    fireEvent.click(screen.getByRole('button', { name: /ZZ01 — Lantern Books/ }))
    expect(await screen.findByText(/changed by someone else/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
  })

  it('deleting a shape takes two presses (Delete key arms, panel confirms)', async () => {
    actions.deleteStatusPlanShapeAction.mockResolvedValue({ ok: true, data: { id: 's1' } })
    render(<StatusPlanWorkspace {...props()} />)
    fireEvent.click(screen.getByText('stub-select-s1'))
    fireEvent.click(screen.getByText('stub-delete-key'))
    expect(actions.deleteStatusPlanShapeAction).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Press again to delete' }))
    await waitFor(() => expect(canvasText()).toContain('shapes:0'))
  })

  it('a polygon drawn for a tenant is created already linked, still source manual', async () => {
    actions.createStatusPlanShapeAction.mockResolvedValue({ ok: true, data: { ...SHAPE, id: 's3' } })
    render(<StatusPlanWorkspace {...props()} />)
    await act(async () => { fireEvent.click(screen.getByText('stub-create-linked')) })
    expect(actions.createStatusPlanShapeAction).toHaveBeenCalledWith({
      sheetId: 'sh1', shape: 'polygon', points: [0, 0, 10, 0, 10, 10], nodeId: 'n7', detectedTag: 'DB-7',
    })
  })

  it('a new shape is created on the current sheet, added and selected', async () => {
    actions.createStatusPlanShapeAction.mockResolvedValue({ ok: true, data: { ...SHAPE, id: 's2' } })
    render(<StatusPlanWorkspace {...props()} />)
    await act(async () => { fireEvent.click(screen.getByText('stub-create')) })
    expect(actions.createStatusPlanShapeAction).toHaveBeenCalledWith({ sheetId: 'sh1', shape: 'rect', points: [0, 0, 10, 0, 10, 10, 0, 10], nodeId: null, detectedTag: null })
    expect(canvasText()).toMatch(/shapes:2\s+selected:s2/)
  })

  it('the canvas shows this sheet only; the legend shows this sheet and all sheets', () => {
    render(<StatusPlanWorkspace {...props({
      sheets: [SHEET, SHEET2],
      shapes: [SHAPE, { ...SHAPE, id: 's2', sheetId: 'sh2', nodeId: 'n1' }],
    })} />)
    expect(canvasText()).toContain('shapes:1')
    expect(legendRow('Complete')).toBe('Complete01')
    expect(legendRow('Unassigned')).toBe('Unassigned11')
    expect(screen.getByRole('navigation', { name: 'Sheets' })).toBeTruthy()
  })

  it('a replaced sheet warns, and "Shapes checked" re-anchors it in place', async () => {
    sheetActions.reanchorTenantPlanSheetAction.mockResolvedValue({ ok: true, data: { ...SHEET, revision: 2, replacedAt: null, updatedAt: 'u1' } })
    render(<StatusPlanWorkspace {...props({ sheet: { ...SHEET, revision: 2, replacedAt: 't9', signedUrl: 'https://s/x', isPdf: true } })} />)
    expect(screen.getByText(/file was replaced/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Shapes checked/ }))
    await waitFor(() => expect(screen.queryByText(/file was replaced/)).toBeNull())
    expect(sheetActions.reanchorTenantPlanSheetAction).toHaveBeenCalledWith({ sheetId: 'sh1', expectedUpdatedAt: 'u0' })
  })

  it('no scale: banner, "Set scale" asks the canvas for the calibrate tool, and a saved scale clears it', () => {
    render(<StatusPlanWorkspace {...props({ sheet: { ...SHEET, pixelsPerMeter: null, signedUrl: 'https://s/x', isPdf: true }, sheets: [{ ...SHEET, pixelsPerMeter: null }] })} />)
    expect(screen.getByText(/Set this sheet.s scale to measure areas\. Until then/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Set scale' }))
    expect(canvasText()).toContain('tool:calibrate')
    fireEvent.click(screen.getByText('stub-calibrated'))
    expect(screen.queryByRole('button', { name: 'Set scale' })).toBeNull()
  })

  it('a line diagram with shapes offers Scan sheet for blocks in the side panel, no auto scan, no scale banner; a floor plan does not', () => {
    const { unmount, container } = render(<StatusPlanWorkspace {...schematic({ sheet: { ...SHEET, pixelsPerMeter: null, signedUrl: 'https://s/x', isPdf: true } })} />)
    expect(screen.getByRole('button', { name: 'Scan sheet for blocks' })).toBeTruthy()
    expect(container.querySelector('[data-slot="schematic-detection"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="schematic-scan-primary"]')).toBeNull()
    expect(detection.extractPageText).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Set scale' })).toBeNull()
    unmount()
    render(<StatusPlanWorkspace {...props()} />)
    expect(screen.queryByRole('button', { name: 'Scan sheet for blocks' })).toBeNull()
  })

  it('an empty line-diagram sheet scans itself on open and puts the review above the drawing', async () => {
    const ITEMS = ['NO:', 'NAME:', 'AREA:', 'RATING:', 'CABLE:', 'SERIAL:', 'CT:'].flatMap((l, row) => [
      { str: l, x: 500, baseline: 500 + row * 16, top: 490 + row * 16, width: l.length * 6, height: 10 },
      { str: ['DB-ZZ01', 'LANTERN', '1', '2', '3', '4', '5'][row]!, x: 550, baseline: 500 + row * 16, top: 490 + row * 16, width: 30, height: 10 },
    ])
    detection.extractPageText.mockResolvedValue({ ok: true, items: ITEMS, rawItemCount: ITEMS.length, width: 2000, height: 2000 })
    const { container } = render(<StatusPlanWorkspace {...schematic({ shapes: [] })} />)
    expect(await screen.findByText('Scanned this sheet — 1 block: 1 matched · 0 need you')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Accept all 1 matched' })).toBeTruthy()
    const primary = container.querySelector('[data-slot="schematic-scan-primary"]')!
    expect(primary).not.toBeNull()
    // Above the canvas in document order, and not repeated in the side panel.
    expect(primary.compareDocumentPosition(screen.getByTestId('canvas')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.querySelector('[data-slot="schematic-detection"]')).toBeNull()
    expect(detection.extractPageText).toHaveBeenCalledTimes(1)
    // Accepting gives the sheet a shape; the review stays where it is, state intact.
    detection.acceptDetectedBlocksAction.mockResolvedValue({
      ok: true,
      data: [{ id: 's9', sheetId: 'sh1', shape: 'rect', points: [495, 485, 585, 485, 585, 601, 495, 601], nodeId: 'n1', areaType: null, detectedTag: 'DB-ZZ01', source: 'detected', updatedAt: 't9' }],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Accept all 1 matched' }))
    expect(await screen.findByText('Every detected block has been handled.')).not.toBeNull()
    expect(container.querySelector('[data-slot="schematic-scan-primary"]')).not.toBeNull()
    expect(canvasText()).toContain('shapes:1')
    expect(detection.extractPageText).toHaveBeenCalledTimes(1)
  })

  it('an empty line-diagram sheet does not scan for a read-only viewer', async () => {
    render(<StatusPlanWorkspace {...schematic({ shapes: [], canEdit: false })} />)
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(detection.extractPageText).not.toHaveBeenCalled()
  })

  it('renders ShopsPanel for tenant_layout and not DetectBlocksPanel; the reverse for distribution_schematic', () => {
    const pdf = { sheet: { ...SHEET, signedUrl: 'https://s/x', isPdf: true } }
    const { unmount } = render(<StatusPlanWorkspace {...props({ ...pdf, shapes: [{ ...SHAPE, nodeId: 'n1' }] })} />)
    expect(screen.getByRole('region', { name: 'Shops on this sheet' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Scan sheet for shops' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Scan sheet for blocks' })).toBeNull()
    unmount()
    render(<StatusPlanWorkspace {...schematic(pdf)} />)
    expect(screen.getByRole('button', { name: 'Scan sheet for blocks' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Shops on this sheet' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Scan sheet for shops' })).toBeNull()
  })

  it('a floor plan with no linked shop scans itself on open, with the Shops panel above the drawing', () => {
    const { container } = render(<StatusPlanWorkspace {...props()} />)
    const primary = container.querySelector('[data-slot="shops-scan-primary"]')!
    expect(primary).not.toBeNull()
    expect(primary.compareDocumentPosition(screen.getByTestId('canvas')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(detection.extractPageText).toHaveBeenCalledWith({ url: 'https://s/x' }, 1)
    expect(container.querySelector('[data-slot="shops-panel"]')).toBeNull()
  })

  it('Draw on a Shops row arms the canvas with the tenant link', async () => {
    detection.extractPageText.mockResolvedValue({
      ok: true,
      items: [{ str: 'SHOP ZZ01', x: 900, baseline: 900, top: 890, width: 54, height: 10 }],
      allItems: [{ str: 'SHOP ZZ01', x: 900, baseline: 900, top: 890, width: 54, height: 10 }],
      rawItemCount: 1, width: 2000, height: 2000,
    })
    render(<StatusPlanWorkspace {...props()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Draw SHOP ZZ01' }))
    expect(canvasText()).toContain('arm:n1/ZZ01#1')
    expect(canvasText()).toContain('focus:500,490,1354,1300#1')
  })

  it('the Shops panel keeps its review when a shape is selected and deselected', async () => {
    const label = { str: 'SHOP ZZ02', x: 900, baseline: 900, top: 890, width: 54, height: 10 }
    detection.extractPageText.mockResolvedValue({ ok: true, items: [label], allItems: [label], rawItemCount: 1, width: 2000, height: 2000 })
    const { container } = render(<StatusPlanWorkspace {...props({
      // One shop already linked: no auto scan, so the panel sits in the side column.
      shapes: [{ ...SHAPE, nodeId: 'n1' }, { ...SHAPE, id: 's2', points: [800, 800, 1100, 800, 1100, 1000, 800, 1000] }],
      nodes: [...props().nodes, { id: 'n2', code: 'DB-ZZ02', kind: 'tenant_db', shopNumber: 'ZZ02', shopName: 'Copper Kettle', scheduledM2: 60, decommissioned: false }],
    })} />)
    expect(container.querySelector('[data-slot="shops-panel"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Scan sheet for shops' }))
    expect(await screen.findByRole('button', { name: 'Link SHOP ZZ02' })).toBeTruthy()
    const summary = screen.getByText(/1 label · 1 item read/).textContent
    fireEvent.click(screen.getByText('stub-select-s1'))
    expect(canvasText()).toContain('selected:s1')
    expect(screen.getByRole('button', { name: 'Link SHOP ZZ02' })).toBeTruthy()
    fireEvent.click(screen.getByText('stub-deselect'))
    expect(canvasText()).toContain('selected:none')
    expect(screen.getByRole('button', { name: 'Link SHOP ZZ02' })).toBeTruthy()
    expect(screen.getByText(/1 label · 1 item read/).textContent).toBe(summary)
    expect(detection.extractPageText).toHaveBeenCalledTimes(1)
  })

  it('Redraw of a moved shop replaces that shape\'s outline with its live updatedAt, never creates a second shape', async () => {
    const linked = { ...SHAPE, nodeId: 'n1' }
    render(<StatusPlanWorkspace {...props({ shapes: [linked] })} />)
    // An earlier write moved the shape's updatedAt on: t1 → t2.
    actions.updateStatusPlanShapeAction.mockResolvedValueOnce({ ok: true, data: { ...linked, areaType: null, updatedAt: 't2' } })
    fireEvent.click(screen.getByText('stub-select-s1'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Unassign' })) })
    fireEvent.click(screen.getByText('stub-deselect'))
    actions.updateStatusPlanShapeAction.mockResolvedValueOnce({ ok: true, data: { ...linked, shape: 'polygon', points: [0, 0, 40, 0, 40, 30], updatedAt: 't3' } })
    await act(async () => { fireEvent.click(screen.getByText('stub-create-redraw')) })
    expect(actions.createStatusPlanShapeAction).not.toHaveBeenCalled()
    expect(actions.updateStatusPlanShapeAction).toHaveBeenLastCalledWith({ shapeId: 's1', expectedUpdatedAt: 't2', points: [0, 0, 40, 0, 40, 30] })
    expect(canvasText()).toMatch(/shapes:1\s+selected:s1/)
    // A stale updatedAt: the action's sentence shows, nothing is folded in.
    actions.updateStatusPlanShapeAction.mockResolvedValueOnce({ ok: false, error: 'This shape was changed by someone else — reload to see it.', conflict: true })
    await act(async () => { fireEvent.click(screen.getByText('stub-create-redraw')) })
    expect(actions.updateStatusPlanShapeAction).toHaveBeenLastCalledWith({ shapeId: 's1', expectedUpdatedAt: 't3', points: [0, 0, 40, 0, 40, 30] })
    expect(screen.getByRole('alert').textContent).toContain('changed by someone else')
    expect(actions.createStatusPlanShapeAction).not.toHaveBeenCalled()
    expect(canvasText()).toContain('shapes:1')
  })

  it('a line diagram\'s scan decision is not re-made when the sheet\'s replacedAt changes', async () => {
    const ITEMS = ['NO:', 'NAME:', 'AREA:', 'RATING:', 'CABLE:', 'SERIAL:', 'CT:'].flatMap((l, row) => [
      { str: l, x: 500, baseline: 500 + row * 16, top: 490 + row * 16, width: l.length * 6, height: 10 },
      { str: ['DB-ZZ01', 'LANTERN', '1', '2', '3', '4', '5'][row]!, x: 550, baseline: 500 + row * 16, top: 490 + row * 16, width: 30, height: 10 },
    ])
    detection.extractPageText.mockResolvedValue({ ok: true, items: ITEMS, rawItemCount: ITEMS.length, width: 2000, height: 2000 })
    const { container } = render(<StatusPlanWorkspace {...schematic({ shapes: [], sheet: { ...SHEET, replacedAt: 't9', signedUrl: 'https://s/x', isPdf: true } })} />)
    expect(await screen.findByText('Scanned this sheet — 1 block: 1 matched · 0 need you')).not.toBeNull()
    detection.acceptDetectedBlocksAction.mockResolvedValue({
      ok: true,
      data: [{ id: 's9', sheetId: 'sh1', shape: 'rect', points: [495, 485, 585, 485, 585, 601, 495, 601], nodeId: 'n1', areaType: null, detectedTag: 'DB-ZZ01', source: 'detected', updatedAt: 't9' }],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Accept all 1 matched' }))
    expect(await screen.findByText('Every detected block has been handled.')).not.toBeNull()
    // Re-anchoring clears replacedAt; the sheet now has a shape, so a fresh decision would move the review aside.
    sheetActions.reanchorTenantPlanSheetAction.mockResolvedValue({ ok: true, data: { ...SHEET, replacedAt: null, updatedAt: 'u1' } })
    fireEvent.click(screen.getByRole('button', { name: /Shapes checked/ }))
    await waitFor(() => expect(screen.queryByText(/file was replaced/)).toBeNull())
    expect(container.querySelector('[data-slot="schematic-scan-primary"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="schematic-detection"]')).toBeNull()
    expect(screen.getByText('Every detected block has been handled.')).toBeTruthy()
    expect(detection.extractPageText).toHaveBeenCalledTimes(1)
  })

  it('Re-align blocks shows for an editor on a line diagram with a rectangle, and nowhere else', () => {
    const pdf = { sheet: { ...SHEET, signedUrl: 'https://s/x', isPdf: true } }
    const { unmount, container } = render(<StatusPlanWorkspace {...schematic(pdf)} />)
    expect(within(container.querySelector('[data-slot="schematic-realign"]') as HTMLElement)
      .getByRole('button', { name: 'Re-align blocks to the drawing' })).toBeTruthy()
    unmount()
    for (const p of [schematic({ ...pdf, canEdit: false }), schematic({ ...pdf, shapes: [] }), props()]) {
      const r = render(<StatusPlanWorkspace {...p} />)
      expect(screen.queryByRole('button', { name: 'Re-align blocks to the drawing' })).toBeNull()
      r.unmount()
    }
  })

  it('re-align: the canvas draws the proposed outline, and Apply folds the moved shape in', async () => {
    const ITEMS = ['NO:', 'NAME:', 'AREA:', 'RATING:', 'CABLE:', 'SERIAL:', 'CT:'].flatMap((l, row) => [
      { str: l, x: 500, baseline: 500 + row * 16, top: 490 + row * 16, width: l.length * 6, height: 10 },
      { str: ['DB-ZZ01', 'LANTERN', '1', '2', '3', '4', '5'][row]!, x: 550, baseline: 500 + row * 16, top: 490 + row * 16, width: 30, height: 10 },
    ])
    const h = (at: number, from: number, to: number) => ({ axis: 'h' as const, at, from, to })
    const v = (at: number, from: number, to: number) => ({ axis: 'v' as const, at, from, to })
    const LINES = [h(487, 497, 600), h(601, 497, 600), v(497, 487, 601), v(546, 487, 601), v(600, 487, 601),
      ...Array.from({ length: 6 }, (_, r) => h(505 + r * 16, 497, 600))]
    detection.extractPageText.mockResolvedValue({ ok: true, items: ITEMS, rawItemCount: ITEMS.length, lines: LINES, width: 2000, height: 2000 })
    const hand: CanvasShape = { ...SHAPE, points: [495, 485, 590, 485, 590, 605, 495, 605], nodeId: 'n1' }
    const border = [497, 487, 600, 487, 600, 601, 497, 601]
    realign.realignShapesAction.mockResolvedValue({ ok: true, data: [{ ...hand, points: border, updatedAt: 't2' }] })
    render(<StatusPlanWorkspace {...schematic({ shapes: [hand], sheet: { ...SHEET, signedUrl: 'https://s/x', isPdf: true } })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Re-align blocks to the drawing' }))
    await screen.findByText(/1 will snap to their table/)
    expect(canvasText()).toContain(`proposals:${JSON.stringify([border])}`)
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await screen.findByText('Re-aligned 1 block')
    expect(canvasText()).toContain('proposals:[]')
    expect(realign.realignShapesAction.mock.calls[0][0]).toEqual({ sheetId: 'sh1', moves: [{ shapeId: 's1', expectedUpdatedAt: 't1', points: border }] })
    // Folded in: a second scan finds it already aligned.
    fireEvent.click(screen.getByRole('button', { name: 'Re-align blocks to the drawing' }))
    expect(await screen.findByText('0 will snap to their table (avg 0 px) · 1 already aligned · 0 left as they are')).not.toBeNull()
  })

  it('detection reads the sheet\'s own page and accepted blocks fold into the canvas', async () => {
    const ITEMS = ['NO:', 'NAME:', 'AREA:', 'RATING:', 'CABLE:', 'SERIAL:', 'CT:'].flatMap((l, row) => [
      { str: l, x: 500, baseline: 500 + row * 16, top: 490 + row * 16, width: l.length * 6, height: 10 },
      { str: ['DB-ZZ01', 'LANTERN', '1', '2', '3', '4', '5'][row]!, x: 550, baseline: 500 + row * 16, top: 490 + row * 16, width: 30, height: 10 },
    ])
    detection.extractPageText.mockResolvedValue({ ok: true, items: ITEMS, rawItemCount: ITEMS.length, width: 2000, height: 2000 })
    detection.acceptDetectedBlocksAction.mockResolvedValue({
      ok: true,
      data: [{ id: 's9', sheetId: 'sh1', shape: 'rect', points: [495, 485, 585, 485, 585, 601, 495, 601], nodeId: 'n1', areaType: null, detectedTag: 'DB-ZZ01', source: 'detected', updatedAt: 't9' }],
    })
    render(<StatusPlanWorkspace {...schematic({ sheet: { ...SHEET, pageIndex: 2, signedUrl: 'https://s/x', isPdf: true } })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Scan sheet for blocks' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Accept all 1 matched' }))
    await waitFor(() => expect(canvasText()).toContain('shapes:2'))
    expect(detection.extractPageText).toHaveBeenCalledWith({ url: 'https://s/x' }, 2)
    expect(detection.acceptDetectedBlocksAction.mock.calls[0][0].sheetId).toBe('sh1')
  })

  it('read-only: no sheet controls, no Add sheets, no Set scale, no re-anchor', () => {
    render(<StatusPlanWorkspace {...props({ canEdit: false, sheet: { ...SHEET, pixelsPerMeter: null, replacedAt: 't9', signedUrl: 'https://s/x', isPdf: true } })} />)
    for (const name of ['Rename', 'Replace file', 'Delete sheet', 'Add sheets', 'Set scale']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    expect(screen.queryByRole('button', { name: /Shapes checked/ })).toBeNull()
    expect(screen.getByText(/file was replaced/)).toBeTruthy()
  })

  it('selection is mirrored to ?sheet=&shape= without a navigation', () => {
    const spy = vi.spyOn(window.history, 'replaceState')
    render(<StatusPlanWorkspace {...props()} />)
    fireEvent.click(screen.getByText('stub-select-s1'))
    expect(spy.mock.calls.at(-1)?.[2]).toBe('/projects/p1/tenant-schedule/floor-plan?sheet=sh1&shape=s1')
  })

  const FEED_OK = {
    state: 'ok' as const, revisionCode: 'Rev 2',
    boards: [{ id: 'mb1', name: 'MB 1.1', colour: '#1F5FBF' }],
    byNode: { n1: { boardId: 'mb1', also: [] } },
  }

  it('Colour by: Main board re-colours the legend and mirrors ?colour=board', () => {
    const replace = vi.spyOn(window.history, 'replaceState')
    render(<StatusPlanWorkspace {...props({ shapes: [{ ...SHAPE, nodeId: 'n1' }], feed: FEED_OK })} />)
    expect(legendRow('Complete')).toBe('Complete1')
    fireEvent.click(screen.getByRole('button', { name: 'Colour by main board' }))
    expect(legendRow('MB 1.1')!.endsWith('1')).toBe(true)
    expect(screen.queryByText('Complete')).toBeNull()
    expect(String(replace.mock.calls.at(-1)![2])).toContain('colour=board')
    fireEvent.click(screen.getByRole('button', { name: 'Colour by status' }))
    expect(legendRow('Complete')).toBe('Complete1')
    expect(String(replace.mock.calls.at(-1)![2])).not.toContain('colour=')
  })

  it('opens in board mode from ?colour=board', () => {
    render(<StatusPlanWorkspace {...props({ shapes: [{ ...SHAPE, nodeId: 'n1' }], feed: FEED_OK, initialColourBy: 'board' })} />)
    expect((screen.getByRole('button', { name: 'Colour by main board' }) as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true')
    expect(legendRow('MB 1.1')).toBeTruthy()
  })

  it('an unreadable cable schedule says so in board mode and keeps the status colours', () => {
    const feed = { state: 'unavailable' as const, reason: 'Main board view unavailable — the cable schedule could not be read.', omission: 'x' }
    render(<StatusPlanWorkspace {...props({ shapes: [{ ...SHAPE, nodeId: 'n1' }], feed, initialColourBy: 'board' })} />)
    expect(screen.getByText(/Main board view unavailable — the cable schedule could not be read\./)).toBeTruthy()
    expect(legendRow('Complete')).toBe('Complete1')
  })

  it('the canvas carries a colour key: line diagram statuses with this sheet\'s counts', () => {
    const blocks: CanvasShape[] = [
      { ...SHAPE, id: 'b1', nodeId: 'm1' },
      { ...SHAPE, id: 'b2', nodeId: 'm2' },
      { ...SHAPE, id: 'b3', nodeId: null },
      { ...SHAPE, id: 'b4', sheetId: 'sh2', nodeId: 'm1' },
    ]
    const nodes = [
      { id: 'm1', code: 'MB-ZZ1', kind: 'main_board', shopNumber: null, shopName: null, scheduledM2: null, decommissioned: false },
      { id: 'm2', code: 'MS-ZZ2', kind: 'mini_sub', shopNumber: null, shopName: null, scheduledM2: null, decommissioned: false },
    ]
    render(<StatusPlanWorkspace {...schematic({ sheets: [SHEET, SHEET2], shapes: blocks, nodes, dbOrders: { m1: 'received', m2: 'ordered' } })} />)
    expect(keyRows()).toEqual([
      'Received1', 'Ordered1', 'Required — not yet ordered0', 'Supplied by tenant0', 'No order line0', 'Not linked to a board1',
    ])
  })

  it('the colour key follows Colour by: status rows, then the main boards', () => {
    render(<StatusPlanWorkspace {...props({ shapes: [{ ...SHAPE, nodeId: 'n1' }], feed: FEED_OK })} />)
    expect(keyRows()[0]).toBe('Complete1')
    fireEvent.click(screen.getByRole('button', { name: 'Colour by main board' }))
    expect(keyRows()[0]).toBe('MB 1.11')
    expect(keyRows()).not.toContain('Complete1')
  })

  it('a line diagram has no colour switch', () => {
    render(<StatusPlanWorkspace {...schematic()} />)
    expect(screen.queryByRole('button', { name: 'Colour by main board' })).toBeNull()
  })

  it('Show on a needs-attention row selects the shape and focuses its box; Show again re-triggers', () => {
    // A link to a board that is not live: "needs attention".
    render(<StatusPlanWorkspace {...props({ shapes: [{ ...SHAPE, nodeId: 'gone' }] })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show Unassigned on the drawing' }))
    expect(canvasText()).toContain('selected:s1')
    expect(canvasText()).toContain('focus:100,100,300,260#1')
    fireEvent.click(screen.getByRole('button', { name: 'Show Unassigned on the drawing' }))
    expect(canvasText()).toContain('focus:100,100,300,260#2')
  })
})
